// Session expiry: the "sign in expired, log in again" kick.
//
// Root cause (client, web/src/auth.ts): at sign-in the Supabase access
// token — a JWT that lives ~1h — was snapshotted into localStorage
// `orbitx-account`, and every game API call sent that snapshot. Nothing
// ever refreshed it during play (no long-lived Supabase client, no
// onAuthStateChange listener, no refreshSession/getSession call after the
// one at menu mount), so after ~1h the server's verifyAccessToken
// (api/auth.js, via Supabase getUser) rejected the expired JWT and every
// op 401'd with "That login expired. Sign in again." (api/city.js).
//
// The fix refreshes the token client-side before it dies. These tests
// pin the two halves the harness can check: (a) the server boundary the
// fix works against — an expired token MUST 401 with the expiry message
// and a still-valid one MUST open the session, so the client can tell
// "refresh me" apart from "log in again"; (b) the refresh decision
// itself — tokenNeedsRefresh fires BEFORE expiry (inside the 5-minute
// margin), not after, and never fires for tokens with no JWT expiry
// (mock tokens, guests).
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { POST } from "../api/city.js";
import { SESSION_REFRESH_MARGIN_MS, jwtExpiryMs, tokenNeedsRefresh } from "../web/src/tokenExpiry.ts";

function req(op, body = {}, token = "") {
  return new Request("http://local/api/city", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ op, ...body }),
  });
}

async function call(op, body, token) {
  const res = await POST(req(op, body, token));
  const data = await res.json();
  return { status: res.status, data };
}

// Same HMAC scheme as signMock in api/auth.js (7-day default there);
// the exp here is the test's own choice, so the boundary is exercised.
function mockToken(expMs, sub = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`) {
  const payload = Buffer.from(JSON.stringify({
    sub,
    email: `${sub}@example.com`,
    name: "Session",
    avatar: "",
    provider: "email",
    exp: expMs,
  })).toString("base64url");
  const sig = createHmac("sha256", process.env.ORBITX_AUTH_SECRET || "orbitx-dev-auth-secret").update(payload).digest("base64url");
  return `mock.${payload}.${sig}`;
}

const EXPIRED = mockToken(Date.now() - 60 * 1000);
const ABOUT_TO_EXPIRE = mockToken(Date.now() + 2 * 60 * 1000);
const FRESH = mockToken(Date.now() + 60 * 60 * 1000);

test("an expired account token gets the login-expired 401 on session open", async () => {
  const res = await call("session", {}, EXPIRED);
  assert.equal(res.status, 401);
  assert.equal(res.data.message, "That login expired. Sign in again.");
});

test("an expired account token gets the login-expired 401 on any later op, not a silent guest session", async () => {
  const res = await call("me", {}, EXPIRED);
  assert.equal(res.status, 401);
  assert.equal(res.data.message, "That login expired. Sign in again.");
});

test("a token that is still valid — even one expiring in minutes — still opens the session", async () => {
  // The boundary is exp: the client refreshes inside the margin, so a
  // token with 2 minutes left must work right up until it is replaced.
  const res = await call("session", {}, ABOUT_TO_EXPIRE);
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.me.account, true);
});

test("the refresh decision fires before expiry, not after", () => {
  assert.equal(SESSION_REFRESH_MARGIN_MS, 5 * 60 * 1000);
  const now = Date.now();
  assert.equal(tokenNeedsRefresh(mockToken(now + 4 * 60 * 1000), now), true);
  assert.equal(tokenNeedsRefresh(mockToken(now + 6 * 60 * 1000), now), false);
  assert.equal(tokenNeedsRefresh(mockToken(now - 1000), now), true);
  assert.equal(tokenNeedsRefresh(mockToken(now + 60 * 60 * 1000), now), false);
});

test("tokens with no JWT expiry never trigger a refresh decision", () => {
  assert.equal(jwtExpiryMs(""), null);
  assert.equal(jwtExpiryMs("not-a-token"), null);
  assert.equal(jwtExpiryMs("guest-token-abc"), null);
  assert.equal(tokenNeedsRefresh(""), false);
  assert.equal(tokenNeedsRefresh("not-a-token"), false);
  // A real Supabase access token is a JWT: exp decodes, and a token
  // expiring in an hour does not need a refresh yet.
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const jwt = `${header}.${payload}.sig`;
  const jwtExp = jwtExpiryMs(jwt);
  assert.ok(jwtExp !== null && jwtExp > Date.now());
  assert.equal(tokenNeedsRefresh(jwt), false);
  const dying = `${header}.${Buffer.from(JSON.stringify({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url")}.sig`;
  assert.equal(tokenNeedsRefresh(dying), true);
});

test("a fresh token still opens the session after an expired one was rejected", async () => {
  const res = await call("session", {}, FRESH);
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
});
