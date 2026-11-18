import type { SupabaseClient } from "@supabase/supabase-js";
import { jwtExpiryMs, tokenNeedsRefresh } from "./tokenExpiry";
import { apiUrl } from "./game/net";

const KEY = "orbitx-account";

export type Account = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  provider: string;
  token: string;
};

export type AuthConfig = { mode: "supabase" | "mock"; url: string; anon: string };

type AuthResult = { account?: Account | null; pending?: boolean; message?: string; devLink?: string; devCode?: string };

export function readAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Account;
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

export function accountToken() {
  return readAccount()?.token || "";
}

export function saveAccount(account: Account) {
  localStorage.setItem(KEY, JSON.stringify(account));
}

export function clearAccount() {
  localStorage.removeItem(KEY);
}

let config: AuthConfig | null = null;

export async function loadAuthConfig(): Promise<AuthConfig> {
  if (config) return config;
  const response = await fetch(apiUrl("/api/city"));
  const data = (await response.json()) as { auth?: AuthConfig };
  config = data.auth?.mode ? data.auth : { mode: "mock", url: "", anon: "" };
  return config;
}

// Auth config without throwing: the session watchdog and the pre-call
// refresh check run on the hot path (every 250ms sync) and must never
// break play when /api is unreachable — they just fall back to the
// stored token, exactly like before this fix.
async function supabaseConfig(): Promise<AuthConfig | null> {
  try {
    return await loadAuthConfig();
  } catch {
    return null;
  }
}

// ONE Supabase client for the whole page. Before this fix browser()
// built a fresh client per call and threw it away, so no client instance
// ever lived long enough to run supabase-js's auto-refresh — and the
// refreshed token only ever landed in Supabase's own storage key, never
// in the `orbitx-account` snapshot the game actually sends. A singleton
// keeps auto-refresh alive and gives onAuthStateChange one place to
// rewrite the snapshot from.
let browserClient: SupabaseClient | null = null;
let authListenerStarted = false;
let watchdogStarted = false;
let refreshInFlight: Promise<string> | null = null;
let lastRefreshAt = 0;
let lastRefreshOk: boolean | null = null;

async function browser(): Promise<SupabaseClient | null> {
  const cfg = await loadAuthConfig();
  if (cfg.mode !== "supabase" || !cfg.url || !cfg.anon) return null;
  if (browserClient) return browserClient;
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(cfg.url, cfg.anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
  });
  browserClient = client;
  if (!authListenerStarted) {
    authListenerStarted = true;
    // TOKEN_REFRESHED / SIGNED_IN carry the fresh access token: rewrite
    // the snapshot every API call reads. SIGNED_OUT is deliberately
    // ignored here — a failed refresh must not kick a playing user to
    // the login screen; the server's 401 stays the authority, and the
    // menu sign-in flow is unchanged. signOutAccount() clears the
    // snapshot explicitly.
    client.auth.onAuthStateChange((event, session) => {
      if (event !== "TOKEN_REFRESHED" && event !== "SIGNED_IN") return;
      const account = fromSession(session);
      if (account) {
        saveAccount(account);
        lastRefreshAt = Date.now();
        lastRefreshOk = true;
      }
    });
  }
  startSessionWatchdog();
  return client;
}

// Session watchdog: refresh the access token on a timer and whenever the
// tab comes back to the foreground (mobile browsers throttle background
// timers, so a phone left locked past the 1h token expiry must refresh
// on return, not on the next failed API call). Started once, from the
// first browser() call. Never clears the account and never throws.
function startSessionWatchdog() {
  if (watchdogStarted || typeof window === "undefined") return;
  watchdogStarted = true;
  window.setInterval(() => void ensureFreshAccountToken().catch(() => {}), 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void ensureFreshAccountToken().catch(() => {});
  });
  window.addEventListener("online", () => void ensureFreshAccountToken().catch(() => {}));
}

/** Force a refresh of the stored session via the refresh token and save the fresh access token. Returns the current (possibly still stale) token when no refresh is possible — never throws, never signs the player out. */
export async function refreshAccountToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const cfg = await supabaseConfig();
      if (cfg?.mode !== "supabase") return readAccount()?.token || "";
      const client = await browser();
      if (!client) return readAccount()?.token || "";
      // refreshSession() with no args reads the stored session; getSession()
      // also refreshes an expired access token, so it is the fallback when
      // the direct refresh errors but a session still exists.
      let session: Parameters<typeof fromSession>[0] = null;
      const { data, error } = await client.auth.refreshSession();
      session = data?.session ?? null;
      if (error || !session) {
        const { data: again } = await client.auth.getSession();
        session = again?.session ?? null;
      }
      const account = fromSession(session);
      if (account) {
        saveAccount(account);
        lastRefreshAt = Date.now();
        lastRefreshOk = true;
        return account.token;
      }
      lastRefreshOk = false;
      return readAccount()?.token || "";
    } catch {
      lastRefreshOk = false;
      return readAccount()?.token || "";
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Make sure the token the game is about to send is still valid.
 * Supabase access tokens live ~1h: if the stored one expires within 5
 * minutes (or already expired — e.g. the tab was backgrounded past
 * expiry), refresh it now and save the fresh snapshot. Cheap when the
 * token is fresh (a JWT `exp` decode, no network). No-op in mock mode
 * (mock tokens live 7 days) and when nobody is signed in.
 */
export async function ensureFreshAccountToken(): Promise<string> {
  const stored = readAccount();
  if (!stored) return "";
  if (!tokenNeedsRefresh(stored.token)) return stored.token;
  return refreshAccountToken();
}

/** Debug/verification handle for the session fix: token expiry, whether a refresh is due, and the last refresh outcome. Read-only; the game never calls it. */
export function getSessionStatus() {
  const stored = readAccount();
  const exp = stored ? jwtExpiryMs(stored.token) : null;
  return {
    mode: config?.mode ?? "unknown",
    hasAccount: !!stored,
    tokenExpiresInMs: exp === null ? null : exp - Date.now(),
    needsRefresh: stored ? tokenNeedsRefresh(stored.token) : false,
    lastRefreshAt,
    lastRefreshOk,
  };
}

if (typeof window !== "undefined") {
  (window as unknown as { __orbitxSession?: unknown }).__orbitxSession = {
    status: getSessionStatus,
    refresh: refreshAccountToken,
    ensureFresh: ensureFreshAccountToken,
  };
}

function fromSession(session: { access_token?: string; user?: { id: string; email?: string; user_metadata?: Record<string, string>; app_metadata?: { provider?: string } } } | null): Account | null {
  if (!session?.access_token || !session.user) return null;
  const meta = session.user.user_metadata || {};
  const email = session.user.email || "";
  return {
    id: session.user.id,
    email,
    name: String(meta.full_name || meta.name || meta.user_name || email.split("@")[0] || "Player").slice(0, 18),
    avatar: String(meta.avatar_url || ""),
    provider: String(session.user.app_metadata?.provider || "email"),
    token: session.access_token,
  };
}

export async function restoreAccount(): Promise<Account | null> {
  const cfg = await loadAuthConfig();
  if (cfg.mode !== "supabase") return readAccount();
  const client = await browser();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  const account = fromSession(data.session);
  if (account) saveAccount(account);
  else clearAccount();
  return account;
}

async function mockPost(op: string, body: Record<string, unknown>) {
  const response = await fetch(apiUrl("/api/city"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...body }),
  });
  const data = (await response.json()) as { ok?: boolean; message?: string; token?: string; account?: Omit<Account, "token">; devLink?: string; devCode?: string };
  if (!response.ok || data.ok === false) throw new Error(data.message || "Auth failed.");
  return data;
}

function keep(data: { token?: string; account?: Omit<Account, "token"> }) {
  if (!data.token || !data.account) return null;
  const account = { ...data.account, token: data.token };
  saveAccount(account);
  return account;
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const cfg = await loadAuthConfig();
  if (cfg.mode === "supabase") {
    const client = await browser();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    const account = fromSession(data.session);
    if (!account) return { pending: true, message: "Check your email to confirm the account, then log in." };
    saveAccount(account);
    return { account };
  }
  const data = await mockPost("auth-signup", { email, password });
  return { account: keep(data) };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const cfg = await loadAuthConfig();
  if (cfg.mode === "supabase") {
    const client = await browser();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const account = fromSession(data.session);
    if (!account) throw new Error("Supabase did not return a session.");
    saveAccount(account);
    return { account };
  }
  const data = await mockPost("auth-login", { email, password });
  return { account: keep(data) };
}

export async function sendMagicLink(email: string): Promise<AuthResult> {
  const cfg = await loadAuthConfig();
  if (cfg.mode === "supabase") {
    const client = await browser();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) throw new Error(error.message);
    return { pending: true, message: "Check your email for the login link." };
  }
  const data = await mockPost("auth-magic", { email });
  return { pending: true, message: data.message, devLink: data.devLink };
}

export async function finishMagic(code: string): Promise<AuthResult> {
  const data = await mockPost("auth-magic-finish", { code });
  return { account: keep(data) };
}

export async function requestExportCode(email: string): Promise<AuthResult> {
  const cfg = await loadAuthConfig();
  if (cfg.mode === "supabase") {
    const client = await browser();
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) throw new Error(error.message);
    return { pending: true, message: "Check your email for a code, then enter it here." };
  }
  const data = await mockPost("auth-reauth", { email });
  return { message: data.message, devCode: data.devCode };
}

export async function signOutAccount() {
  const cfg = await loadAuthConfig();
  if (cfg.mode === "supabase") {
    const client = await browser();
    if (client) await client.auth.signOut();
  }
  clearAccount();
}
