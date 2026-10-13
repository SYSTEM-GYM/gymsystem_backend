import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';

const MINUTE_MS = 60_000;

/**
 * Lockout after the 1st, 2nd and 3rd attempt. The 3rd lockout ends the cycle:
 * once it expires the counter starts over (max. 3 attempts per hour).
 */
export const REGISTER_BLOCK_STEPS_MS = [15, 30, 60].map((m) => m * MINUTE_MS);

/** After the 1st/2nd lockout, an idle hour also resets the counter. */
export const REGISTER_IDLE_RESET_MS = 60 * MINUTE_MS;

interface AttemptState {
  count: number;
  blockedUntil: number;
  /** Logical expiry — checked explicitly so the rule doesn't rely on cache TTL precision. */
  resetAt: number;
}

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Staggered backoff for POST /auth/register, tracked per key (IP and e-mail).
 * An attempt is refused while ANY of its keys is locked; an accepted attempt
 * advances every key one step.
 */
@Injectable()
export class RegisterThrottleService {
  // Serialises check-and-record so two concurrent requests can't both slip
  // through the same window (cache reads/writes are async).
  private queue: Promise<unknown> = Promise.resolve();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  consume(keys: string[]): Promise<ThrottleDecision> {
    const run = this.queue.then(() => this.consumeNow(keys));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async consumeNow(keys: string[]): Promise<ThrottleDecision> {
    const now = Date.now();
    const states = await Promise.all(keys.map((key) => this.read(key, now)));

    const retryAfterMs = Math.max(
      0,
      ...states.map((s) => (s ? s.blockedUntil - now : 0)),
    );
    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterMs };
    }

    await Promise.all(
      keys.map((key, i) => {
        const prev = states[i];
        const count =
          prev && prev.count < REGISTER_BLOCK_STEPS_MS.length
            ? prev.count + 1
            : 1;
        const blockMs = REGISTER_BLOCK_STEPS_MS[count - 1];
        const isLastStep = count === REGISTER_BLOCK_STEPS_MS.length;
        const ttlMs = isLastStep ? blockMs : blockMs + REGISTER_IDLE_RESET_MS;

        const next: AttemptState = {
          count,
          blockedUntil: now + blockMs,
          resetAt: now + ttlMs,
        };
        return this.cache.set(key, next, ttlMs);
      }),
    );

    return { allowed: true };
  }

  private async read(
    key: string,
    now: number,
  ): Promise<AttemptState | undefined> {
    const state = await this.cache.get<AttemptState>(key);
    return state && state.resetAt > now ? state : undefined;
  }
}
