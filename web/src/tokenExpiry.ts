// Pure helpers for the Supabase access-token expiry the game plays
// against. A signed-in player's access token is a JWT that lives ~1h
// (Supabase's default), so the client must refresh it BEFORE it dies
// mid-play — it cannot just keep sending the token snapshotted at
// sign-in. These helpers only READ the token's `exp` claim to decide a
// refresh is due. They never accept, mint, or verify anything:
// verification stays server-side in api/auth.js verifyAccessToken, which
// keeps rejecting expired tokens. Non-JWT tokens (mock account tokens,
// guest tokens, garbage) return null/false — nothing to refresh there.

export const SESSION_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** `exp` of a JWT access token, in ms since epoch — null when the token is not a JWT. */
export function jwtExpiryMs(token: string): number | null {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: unknown };
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp) || exp <= 0) return null;
    // JWT `exp` is seconds — but the mock account token (api/auth.js
    // signMock) stores milliseconds. Seconds stay below 1e11 until the
    // year 5138; milliseconds are already above 1e12, so the size tells
    // them apart with no ambiguity in practice.
    return exp > 1e11 ? exp : exp * 1000;
  } catch {
    return null;
  }
}

/** True when the token is already expired, or will expire within the margin — a refresh is due before the next API call. */
export function tokenNeedsRefresh(token: string, nowMs: number = Date.now(), marginMs: number = SESSION_REFRESH_MARGIN_MS): boolean {
  const exp = jwtExpiryMs(token);
  if (exp === null) return false;
  return exp - nowMs <= marginMs;
}
