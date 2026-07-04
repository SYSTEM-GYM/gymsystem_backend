/**
 * Decodes (without re-verifying) the payload of an already-authenticated JWT.
 * Signature/expiry trust is established upstream by supabase.auth.getUser(token)
 * — this only reads the app_metadata claims the Custom Access Token Hook
 * injects, which supabase-js's verified user object does not expose.
 */
export function decodeJwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type JwtAppMetadata = {
  role?: string;
  gym_id?: string | null;
};

export function extractAppMetadata(token: string): JwtAppMetadata | null {
  const payload = decodeJwtPayload(token);
  const appMetadata = payload?.app_metadata;
  if (!appMetadata || typeof appMetadata !== 'object') return null;
  return appMetadata;
}
