import type { Request } from 'express';
import { resolveClientIp } from './register-throttle.guard';

const KEY = 'k'.repeat(48);

function req(
  headers: Record<string, string>,
  remoteAddress = '::ffff:10.0.0.5',
) {
  return { headers, socket: { remoteAddress } } as unknown as Request;
}

describe('resolveClientIp', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.INTERNAL_API_KEY;
  });

  it('trusts X-Client-IP only with a valid internal key', () => {
    expect(
      resolveClientIp(
        req({ 'x-client-ip': '203.0.113.9', 'x-internal-api-key': KEY }),
      ),
    ).toBe('203.0.113.9');
  });

  it('ignores a spoofed X-Client-IP without the key', () => {
    expect(resolveClientIp(req({ 'x-client-ip': '203.0.113.9' }))).toBe(
      '10.0.0.5',
    );
  });

  it('ignores X-Client-IP with a wrong key', () => {
    expect(
      resolveClientIp(
        req({
          'x-client-ip': '203.0.113.9',
          'x-internal-api-key': 'x'.repeat(48),
        }),
      ),
    ).toBe('10.0.0.5');
  });

  it('ignores a malformed X-Client-IP', () => {
    expect(
      resolveClientIp(
        req({ 'x-client-ip': 'not-an-ip', 'x-internal-api-key': KEY }),
      ),
    ).toBe('10.0.0.5');
  });

  it('falls back to the socket address when no key is configured', () => {
    delete process.env.INTERNAL_API_KEY;
    expect(
      resolveClientIp(
        req({ 'x-client-ip': '203.0.113.9', 'x-internal-api-key': KEY }),
      ),
    ).toBe('10.0.0.5');
  });
});
