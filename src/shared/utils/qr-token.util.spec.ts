import { verifyQrToken } from './qr-token.util';

describe('verifyQrToken', () => {
  const secret = 'test-secret-key-for-hmac-qr';

  function buildToken(uid: string, iat: number): string {
    const encodedPayload = Buffer.from(JSON.stringify({ uid, iat })).toString(
      'base64url',
    );
    const crypto = require('crypto') as typeof import('crypto');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  it('accepts a valid token within the 10s window', () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = buildToken('550e8400-e29b-41d4-a716-446655440000', iat);
    const result = verifyQrToken(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe('550e8400-e29b-41d4-a716-446655440000');
    }
  });

  it('rejects expired tokens', () => {
    const iat = Math.floor(Date.now() / 1000) - 30;
    const token = buildToken('550e8400-e29b-41d4-a716-446655440000', iat);
    const result = verifyQrToken(token, secret);
    expect(result.ok).toBe(false);
  });

  it('rejects tampered signatures', () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = buildToken('550e8400-e29b-41d4-a716-446655440000', iat);
    const result = verifyQrToken(`${token}x`, secret);
    expect(result.ok).toBe(false);
  });
});
