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
  const response = await fetch("/api/city");
  const data = (await response.json()) as { auth?: AuthConfig };
  config = data.auth?.mode ? data.auth : { mode: "mock", url: "", anon: "" };
  return config;
}

async function browser() {
  const cfg = await loadAuthConfig();
  if (cfg.mode !== "supabase" || !cfg.url || !cfg.anon) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(cfg.url, cfg.anon, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" },
  });
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
  const response = await fetch("/api/city", {
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
