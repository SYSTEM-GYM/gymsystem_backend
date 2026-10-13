import type { Cache } from 'cache-manager';
import { RegisterThrottleService } from './register-throttle.service';

const MIN = 60_000;

/** Map-backed cache; TTL is ignored on purpose — the service must enforce expiry itself. */
function fakeCache(): Cache {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve(value);
    },
  } as unknown as Cache;
}

describe('RegisterThrottleService', () => {
  let now: number;
  let service: RegisterThrottleService;
  const ip = ['register:ip:203.0.113.7'];

  beforeEach(() => {
    now = Date.UTC(2026, 9, 12, 12, 0, 0);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    service = new RegisterThrottleService(fakeCache());
  });

  afterEach(() => jest.restoreAllMocks());

  const at = (minutes: number) => {
    now = Date.UTC(2026, 9, 12, 12, 0, 0) + minutes * MIN;
  };
  const retryMinutes = async (keys = ip) => {
    const d = await service.consume(keys);
    return d.allowed ? 0 : Math.ceil(d.retryAfterMs / MIN);
  };

  it('applies 15 → 30 → 60 minute lockouts, then resets the cycle', async () => {
    // 1st attempt
    expect(await retryMinutes()).toBe(0);
    at(1);
    expect(await retryMinutes()).toBe(14);
    at(14.5);
    expect(await retryMinutes()).toBe(1);

    // 2nd attempt, right after the 15 min lockout
    at(15);
    expect(await retryMinutes()).toBe(0);
    at(16);
    expect(await retryMinutes()).toBe(29);

    // 3rd attempt, right after the 30 min lockout
    at(45);
    expect(await retryMinutes()).toBe(0);
    at(46);
    expect(await retryMinutes()).toBe(59);
    at(104);
    expect(await retryMinutes()).toBe(1);

    // 1 h after the 3rd attempt the counter is back to zero: 15 min again
    at(105);
    expect(await retryMinutes()).toBe(0);
    at(106);
    expect(await retryMinutes()).toBe(14);
  });

  it('refused attempts do not advance the counter', async () => {
    await service.consume(ip);
    at(5);
    await service.consume(ip);
    at(10);
    await service.consume(ip);
    at(15);
    expect(await retryMinutes()).toBe(0); // still the 2nd attempt
    at(16);
    expect(await retryMinutes()).toBe(29);
  });

  it('resets after an idle hour following the 1st or 2nd lockout', async () => {
    await service.consume(ip);
    at(15 + 60); // lockout over + 1 idle hour
    expect(await retryMinutes()).toBe(0);
    at(76);
    expect(await retryMinutes()).toBe(14); // treated as a 1st attempt again
  });

  it('blocks when any key is locked (same IP, different e-mail)', async () => {
    await service.consume(['register:ip:1.1.1.1', 'register:email:a@x.com']);
    at(2);
    expect(
      await retryMinutes(['register:ip:1.1.1.1', 'register:email:b@x.com']),
    ).toBe(13);
    expect(
      await retryMinutes(['register:ip:2.2.2.2', 'register:email:a@x.com']),
    ).toBe(13);
    expect(
      await retryMinutes(['register:ip:2.2.2.2', 'register:email:b@x.com']),
    ).toBe(0);
  });

  it('lets only one of two concurrent attempts through', async () => {
    const [a, b] = await Promise.all([
      service.consume(ip),
      service.consume(ip),
    ]);
    expect([a.allowed, b.allowed].sort()).toEqual([false, true]);
  });
});
