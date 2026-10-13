import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { isIP } from 'net';
import type { Request, Response } from 'express';
import { RegisterThrottleService } from './register-throttle.service';

/**
 * Applies the staggered backoff (15 → 30 → 60 min) to POST /auth/register,
 * keyed by client IP and by e-mail. Runs before validation, so every request
 * that reaches the endpoint counts as an attempt.
 */
@Injectable()
export class RegisterThrottleGuard implements CanActivate {
  constructor(private readonly throttle: RegisterThrottleService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const keys = [`register:ip:${resolveClientIp(req)}`];
    const email = (req.body as { email?: unknown } | undefined)?.email;
    if (typeof email === 'string' && email.trim()) {
      keys.push(`register:email:${email.trim().toLowerCase()}`);
    }

    const decision = await this.throttle.consume(keys);
    if (decision.allowed) return true;

    const minutes = Math.max(1, Math.ceil(decision.retryAfterMs / 60_000));
    res.setHeader('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
    throw new HttpException(
      `Muitas tentativas de cadastro. Tente novamente em ${minutes} ${
        minutes === 1 ? 'minuto' : 'minutos'
      }.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * The frontend calls this endpoint server-to-server (Next.js server action),
 * so the socket address is the Next server for every user. It forwards the
 * real client IP in X-Client-IP, which is trusted ONLY together with a valid
 * X-Internal-Api-Key — otherwise anyone could spoof the header and dodge the
 * IP limit.
 */
export function resolveClientIp(req: Request): string {
  const forwarded = header(req, 'x-client-ip');
  if (forwarded && isIP(forwarded) && hasValidInternalKey(req)) {
    return normalizeIp(forwarded);
  }
  return normalizeIp(req.socket.remoteAddress ?? 'unknown');
}

function hasValidInternalKey(req: Request): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  const provided = header(req, 'x-internal-api-key');
  if (!expected || !provided || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
