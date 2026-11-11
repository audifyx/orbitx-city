// Login for OrbitX City. With Supabase keys this checks the hosted JWT.
// With no keys, a local signer covers dev and tests. It never handles a Solana key.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const OPS = new Set(["auth-signup", "auth-login", "auth-magic", "auth-magic-finish", "auth-oauth", "auth-reauth"]);

function authStore() {
  const slot = globalThis;
  if (!slot.__orbitxAuth) slot.__orbitxAuth = { users: new Map(), byEmail: new Map(), otps: new Map() };
  return slot.__orbitxAuth;
}

export function supabasePublic() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return url && (anon || service) ? { url, anon, service } : null;
}

export function authMode() {
  return supabasePublic() ? "supabase" : "mock";
}

function mockSecret() {
  return process.env.ORBITX_AUTH_SECRET || "orbitx-dev-auth-secret";
}

function signMock(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar || "",
    provider: user.provider || "email",
    exp: Date.now() + 7 * 86400000,
  })).toString("base64url");
  const sig = createHmac("sha256", mockSecret()).update(payload).digest("base64url");
  return `mock.${payload}.${sig}`;
}

export function verifyMockToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "mock") return null;
  const expected = createHmac("sha256", mockSecret()).update(parts[1]).digest("base64url");
  const left = Buffer.from(parts[2]);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
  if (!payload?.sub || Number(payload.exp) < Date.now()) return null;
  return {
    id: String(payload.sub),
    email: String(payload.email || ""),
    name: String(payload.name || "Player").slice(0, 18),
    avatar: String(payload.avatar || ""),
    provider: String(payload.provider || "email"),
  };
}

const verified = new Map();

export async function verifyAccessToken(token, fresh = false) {
  const raw = String(token || "");
  if (!raw.includes(".")) return null;
  if (raw.startsWith("mock.")) return verifyMockToken(raw);
  if (!raw.startsWith("eyJ")) return null;
  const pub = supabasePublic();
  if (!pub?.service) return null;
  if (!fresh) {
    const hit = verified.get(raw);
    if (hit && hit.until > Date.now()) return hit.user;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(pub.url, pub.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(raw);
  if (error || !data?.user) return null;
  const meta = data.user.user_metadata || {};
  const user = {
    id: data.user.id,
    email: data.user.email || "",
    name: String(meta.full_name || meta.name || meta.user_name || (data.user.email || "player").split("@")[0]).slice(0, 18),
    avatar: String(meta.avatar_url || ""),
    provider: String(data.user.app_metadata?.provider || "email"),
  };
  verified.set(raw, { user, until: Date.now() + 5000 });
  return user;
}

export function looksLikeAccountToken(token) {
  const raw = String(token || "");
  return raw.startsWith("mock.") || raw.startsWith("eyJ");
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function nameFrom(email) {
  const local = email.split("@")[0].replace(/[^a-zA-Z0-9]+/g, " ").trim();
  return (local || "Player").slice(0, 18);
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 32).toString("base64url");
}

function checkPassword(user, password) {
  if (!user?.passwordHash || !user.salt) return false;
  const got = Buffer.from(hashPassword(password, user.salt));
  const want = Buffer.from(user.passwordHash);
  return got.length === want.length && timingSafeEqual(got, want);
}

function issue(user) {
  return {
    ok: true,
    token: signMock(user),
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar || "",
      provider: user.provider || "email",
    },
  };
}

function putUser(user) {
  const store = authStore();
  store.users.set(user.id, user);
  store.byEmail.set(user.email.toLowerCase(), user);
  return user;
}

export function mockUserByEmail(email) {
  return authStore().byEmail.get(String(email || "").toLowerCase()) || null;
}

export async function checkReauth(account, body) {
  const password = String(body.password || "");
  const otp = String(body.otp || "").trim();
  if (authMode() === "mock") {
    const user = authStore().users.get(account.id);
    if (!user) return false;
    if (password && checkPassword(user, password)) return true;
    if (otp) {
      const row = authStore().otps.get(`${account.id}:reauth`);
      if (!row || row.exp < Date.now() || row.code !== otp) return false;
      authStore().otps.delete(`${account.id}:reauth`);
      return true;
    }
    return false;
  }
  const pub = supabasePublic();
  if (!pub?.anon) return false;
  if (password && account.email) {
    const res = await fetch(`${pub.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: pub.anon, authorization: `Bearer ${pub.anon}` },
      body: JSON.stringify({ email: account.email, password }),
    });
    return res.ok;
  }
  if (otp && account.email) {
    const res = await fetch(`${pub.url}/auth/v1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: pub.anon, authorization: `Bearer ${pub.anon}` },
      body: JSON.stringify({ type: "email", email: account.email, token: otp }),
    });
    return res.ok;
  }
  return false;
}

export async function handleAuthOp(op, body) {
  if (!OPS.has(op)) return null;
  if (authMode() === "supabase" && op !== "auth-reauth") {
    return { ok: false, status: 400, message: "This project uses Supabase Auth. Sign in from the city menu." };
  }
  if (op === "auth-reauth") {
    if (authMode() === "supabase") {
      return { ok: true, message: "Enter the code from your email, or your password, on the export screen." };
    }
    const email = String(body.email || "").trim().toLowerCase();
    const user = mockUserByEmail(email);
    if (!user) return { ok: false, status: 404, message: "No account with that email." };
    const code = String(100000 + Math.floor(Math.random() * 900000));
    authStore().otps.set(`${user.id}:reauth`, { code, exp: Date.now() + 10 * 60 * 1000 });
    return { ok: true, message: "Dev mailbox only. A hosted project emails this code.", devCode: code };
  }
  if (op === "auth-signup") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!emailOk(email)) return { ok: false, status: 400, message: "Enter a real email address." };
    if (password.length < 8) return { ok: false, status: 400, message: "Use at least 8 characters." };
    if (mockUserByEmail(email)) return { ok: false, status: 409, message: "That email already has an account. Log in." };
    const salt = randomBytes(16).toString("base64url");
    const user = putUser({
      id: `acct_${randomBytes(12).toString("hex")}`,
      email,
      name: nameFrom(email),
      avatar: "",
      provider: "email",
      salt,
      passwordHash: hashPassword(password, salt),
    });
    return issue(user);
  }
  if (op === "auth-login") {
    const email = String(body.email || "").trim().toLowerCase();
    const user = mockUserByEmail(email);
    if (!user || !checkPassword(user, String(body.password || ""))) {
      return { ok: false, status: 401, message: "Email or password did not match." };
    }
    return issue(user);
  }
  if (op === "auth-magic") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!emailOk(email)) return { ok: false, status: 400, message: "Enter a real email address." };
    let user = mockUserByEmail(email);
    if (!user) {
      user = putUser({
        id: `acct_${randomBytes(12).toString("hex")}`,
        email,
        name: nameFrom(email),
        avatar: "",
        provider: "email",
        salt: "",
        passwordHash: "",
      });
    }
    const code = randomBytes(18).toString("hex");
    authStore().otps.set(code, { id: user.id, exp: Date.now() + 15 * 60 * 1000 });
    return {
      ok: true,
      message: "Dev mailbox only. A hosted project emails the link instead of returning it.",
      devLink: `/?magic=${code}`,
    };
  }
  if (op === "auth-magic-finish") {
    const code = String(body.code || "");
    const row = authStore().otps.get(code);
    if (!row || row.exp < Date.now()) return { ok: false, status: 400, message: "That link expired. Send a new one." };
    authStore().otps.delete(code);
    const user = authStore().users.get(row.id);
    if (!user) return { ok: false, status: 400, message: "That account is gone." };
    return issue(user);
  }
  if (op === "auth-oauth") {
    const provider = ["google", "discord", "twitter"].includes(body.provider) ? body.provider : "";
    if (!provider) return { ok: false, status: 400, message: "Choose Google, Discord, or X." };
    const email = `${provider}.player@orbitx.dev`;
    let user = mockUserByEmail(email);
    if (!user) {
      const label = provider === "twitter" ? "X" : provider[0].toUpperCase() + provider.slice(1);
      user = putUser({
        id: `acct_${provider}_${randomBytes(8).toString("hex")}`,
        email,
        name: `${label} player`.slice(0, 18),
        avatar: "",
        provider,
        salt: "",
        passwordHash: "",
      });
    }
    return { ...issue(user), dev: true, message: "Dev login. With Supabase this redirects to the provider." };
  }
  return { ok: false, status: 400, message: "Unknown auth request." };
}
