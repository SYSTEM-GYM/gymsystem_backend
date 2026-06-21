import { createHmac, timingSafeEqual } from 'crypto';

export type QrTokenPayload = { uid: string; iat: number };

const QR_VALIDITY_SECONDS = 10;

export function verifyQrToken(
  token: string,
  secret: string,
): { ok: true; userId: string } | { ok: false; reason: string } {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { ok: false, reason: 'Token QR inválido' };
  }

  const [encodedPayload, signature] = parts;
  const expected = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: 'Assinatura QR inválida' };
  }

  let payload: QrTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as QrTokenPayload;
  } catch {
    return { ok: false, reason: 'Payload QR inválido' };
  }

  if (!payload.uid || typeof payload.iat !== 'number') {
    return { ok: false, reason: 'Payload QR incompleto' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - payload.iat > QR_VALIDITY_SECONDS) {
    return { ok: false, reason: 'QR expirado — gere um novo código' };
  }

  return { ok: true, userId: payload.uid };
}

/** Legacy MVP: raw UUID v4 passed directly by older edge clients. */
export function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
