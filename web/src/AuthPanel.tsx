import { useEffect, useRef, useState } from "react";
import { finishMagic, loadAuthConfig, requestExportCode, restoreAccount, sendMagicLink, signIn, signUp, type Account, type AuthConfig } from "./auth";

type Props = {
  onAccount: (account: Account) => void;
  onGuest: () => void;
};

export function AuthPanel({ onAccount, onGuest }: Props) {
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const onAccountRef = useRef(onAccount);
  onAccountRef.current = onAccount;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    void (async () => {
      const next = await loadAuthConfig();
      setCfg(next);
      const code = params.get("magic");
      if (code && next.mode === "mock") {
        try {
          const result = await finishMagic(code);
          if (result.account) onAccountRef.current(result.account);
          return;
        } catch (err) {
          setNote(err instanceof Error ? err.message : "That link did not work.");
        }
      }
      const existing = await restoreAccount();
      if (existing) onAccountRef.current(existing);
    })();
  }, []);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNote("");
    try {
      await task();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth" id="auth">
      <p className="tag">Sign in, or play as a guest and upgrade later</p>
      <label>
        Email
        <input id="auth-email" value={email} autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password
        <input id="auth-password" type="password" value={password} autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} />
      </label>
      <div className="auth-actions">
        <button id="auth-login" type="button" disabled={busy} onClick={() => run(async () => {
          const result = await signIn(email, password);
          if (result.account) onAccount(result.account);
        })}>Log in</button>
        <button id="auth-signup" type="button" disabled={busy} onClick={() => run(async () => {
          const result = await signUp(email, password);
          if (result.account) onAccount(result.account);
          else setNote(result.message || "Check your email.");
        })}>Sign up</button>
        <button id="auth-magic" type="button" disabled={busy} onClick={() => run(async () => {
          const result = await sendMagicLink(email);
          setNote(result.devLink ? `${result.message} ${result.devLink}` : result.message || "Check your email.");
          if (result.devLink) {
            const code = result.devLink.split("magic=")[1];
            const done = await finishMagic(code);
            if (done.account) onAccount(done.account);
          }
        })}>Email me a link</button>
      </div>
      <button id="auth-guest" type="button" onClick={onGuest}>Play as guest</button>
      <p className="help">{cfg?.mode === "supabase" ? "Supabase Auth is on. Email sign-in only." : "No Supabase keys in this server, so login stays on this machine until you connect a project."}</p>
      {note ? <p className="help" id="auth-note">{note}</p> : null}
    </div>
  );
}

export async function sendReauthCode(email: string) {
  return requestExportCode(email);
}
