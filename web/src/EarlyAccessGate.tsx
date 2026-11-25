import { useCallback, useEffect, useState } from "react";
import { world, type EarlyAccessStatus } from "./game/world";
import "./site-pages.css";

// EARLY ACCESS gate screen (pre-launch burn gate). This is the front
// door: when the server says the gate is active and this account has
// not unlocked yet, a locked player lands here straight off the splash
// (App routes the menu's first step to the gate) — and Play/roster
// entry routes here too. The burn runs on the player's IN-GAME wallet:
// send ORBITX to the in-game wallet address shown here, tap BURN
// SUPPLY, and the server burns the $5 worth straight out of that
// wallet and unlocks the account. Players who exported the wallet and
// burned the tokens themselves can instead prove that burn with its
// Solscan link (the fallback below — it is still checked against the
// in-game wallet address; there is no external/connect wallet flow).
// The unlock lives on the account, so guests get the account-required
// card and are routed to sign-in first. Once the server reports the
// gate inactive (launch day), this screen never renders and the entry
// flow is untouched.

export const INCINERATOR_ADDRESS = "1nc1nerator11111111111111111111111111111111";
const DEX_URL = "https://orbitx.world/ORBITX_DEX/";

/** Pull the base58 signature out of a Solscan tx URL, or accept a raw one. */
export function extractSignature(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{32,128})/);
  if (fromUrl) return fromUrl[1];
  return /^[1-9A-HJ-NP-Za-km-z]{43,128}$/.test(text) ? text : null;
}

function formatPrice(priceUsd: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return "—";
  return `$${Number(priceUsd.toPrecision(4))}`;
}

function formatTokens(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  return Math.round(amount).toLocaleString("en-US");
}

interface EarlyAccessGateProps {
  status: EarlyAccessStatus;
  signedIn: boolean;
  // True when this presentation IS the splash landing (the front
  // door): the Back button is hidden — a locked player has no menu
  // behind this screen to go back to. The header chrome above the
  // gate still carries sign-out / account switching.
  landing?: boolean;
  // A burn or verify succeeded: App records the unlock and re-reads
  // the status.
  onUnlocked: (proof: { amountTokens: number; usd: number }) => void;
  // Guest tapped the sign-in route — App shows the login UI.
  onNeedAccount: () => void;
  // Back to the menu home (only offered when the gate was reached
  // through the Play door, never on the landing gate).
  onBack: () => void;
  // Enter after unlocking — App re-checks the gate and routes on.
  onEnter: () => void;
}

export function EarlyAccessGate({ status, signedIn, landing = false, onUnlocked, onNeedAccount, onBack, onEnter }: EarlyAccessGateProps) {
  const [proof, setProof] = useState<{ amountTokens: number; usd: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // The in-game (server) wallet: the session populates world.chain,
  // and walletView() is the same refresh the Bank/Wallet panel uses —
  // run it on mount and on demand so a player who just sent ORBITX to
  // the address sees the balance land here.
  const [chain, setChain] = useState(() => world.chain);
  const [refreshing, setRefreshing] = useState(false);
  const refreshChain = useCallback(async () => {
    setRefreshing(true);
    try {
      await world.walletView();
    } catch {
      // Keep the last known read — the burn op is the authority, and
      // its own message will say if the wallet is not ready.
    }
    setChain(world.chain);
    setRefreshing(false);
  }, []);
  useEffect(() => {
    // walletView is account-only; guests get the account card below
    // and never reach the wallet block.
    if (!signedIn) return;
    void refreshChain();
  }, [signedIn, refreshChain]);

  // BURN SUPPLY (in-game burn).
  const [pin, setPin] = useState("");
  const [burning, setBurning] = useState(false);
  const [burnError, setBurnError] = useState("");

  // Fallback: prove a self-made burn (exported wallet) by Solscan link.
  const [showFallback, setShowFallback] = useState(false);
  const [txInput, setTxInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const usdRequired = status.gate.usdRequired || 5;
  const tokensNeeded = status.gate.tokensApprox || 0;
  const address = chain?.address || "";
  const orbitxBalance = chain?.orbitx ?? null;
  const shortfall =
    orbitxBalance != null && tokensNeeded > 0 && orbitxBalance < tokensNeeded ? tokensNeeded - orbitxBalance : 0;

  const copyAddress = () => {
    if (!address || !navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  const burn = async () => {
    setBurnError("");
    setBurning(true);
    try {
      const result = await world.earlyAccessBurn(pin.trim());
      if (result.unlocked) {
        const next = { amountTokens: result.amountTokens, usd: result.usd };
        setProof(next);
        setPin("");
        onUnlocked(next);
        void refreshChain();
      } else {
        setBurnError("The server did not unlock this account. Check your balance and try again.");
      }
    } catch (err) {
      // The API's standard error shape: the server's message, verbatim
      // (e.g. how much ORBITX the wallet is short of the burn).
      setBurnError(err instanceof Error ? err.message : "The burn failed. Try again in a moment.");
    } finally {
      setBurning(false);
    }
  };

  const verify = async () => {
    setVerifyError("");
    if (!address) {
      setVerifyError("Your in-game wallet is not ready yet — refresh the balance above and try again.");
      return;
    }
    const signature = extractSignature(txInput);
    if (!signature) {
      setVerifyError("Paste the Solscan link for the burn transaction (or the transaction signature itself).");
      return;
    }
    setVerifying(true);
    try {
      const result = await world.earlyAccessVerify(address, signature);
      if (result.unlocked) {
        const next = { amountTokens: result.amountTokens, usd: result.usd };
        setProof(next);
        onUnlocked(next);
      } else {
        setVerifyError("The server did not unlock this account for that transaction. Check the burn and try again.");
      }
    } catch (err) {
      // The API's standard error shape: the server's message, verbatim.
      setVerifyError(err instanceof Error ? err.message : "Verification failed. Try again in a moment.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="card menu-wide ea-gate">
      <p className="ea-kicker">ORBITX CITY · BEFORE LAUNCH</p>
      <h2>EARLY ACCESS</h2>
      <p className="muted">
        Burn ${usdRequired} of ORBITX to enter the city before launch. Everyone plays free on December 5.
      </p>

      <div className="ea-live" aria-label="Live ORBITX price">
        <span className="ea-chip">
          ORBITX price <b>{formatPrice(status.gate.priceUsd)}</b>
        </span>
        <span className="ea-chip">
          ${usdRequired} ≈ <b>{formatTokens(tokensNeeded)} ORBITX</b>
        </span>
      </div>

      <ol className="ea-steps">
        <li>
          <b>1 · Send ORBITX to your in-game wallet</b>
          <span>
            Send at least ≈{formatTokens(tokensNeeded)} ORBITX (${usdRequired}) to your in-game wallet
            {signedIn ? " address below" : ""} — from an exchange or any other wallet. It has to arrive in{" "}
            <b>this</b> wallet; the burn spends from here. Need ORBITX?{" "}
            <a href={DEX_URL} target="_blank" rel="noreferrer">
              Open the OrbitX DEX ↗
            </a>{" "}
            — or anywhere ORBITX trades.
          </span>
          {signedIn ? (
            <>
              <span className="ea-addrrow">
                <code className="ea-addr">{address || "Creating the wallet…"}</code>
                <button type="button" className="ea-small" onClick={copyAddress} disabled={!address}>
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </span>
              <span className="ea-row">
                <span className="ea-note">
                  In-game balance:{" "}
                  <b>{orbitxBalance == null ? "not read yet" : `${formatTokens(orbitxBalance)} ORBITX`}</b>
                  {chain?.network ? ` · ${chain.network}` : ""}
                </span>
                <button type="button" className="ea-small" onClick={() => void refreshChain()} disabled={refreshing}>
                  {refreshing ? "Refreshing…" : "Refresh balance"}
                </button>
              </span>
            </>
          ) : null}
        </li>
        <li>
          <b>2 · Burn it here</b>
          <span>
            Tap <b>BURN SUPPLY</b> below and the city burns ≈{formatTokens(tokensNeeded)} ORBITX (${usdRequired})
            straight out of your in-game wallet, on-chain. Burned is forever — and this account unlocks the moment
            it lands.
          </span>
        </li>
      </ol>

      {proof ? (
        <div className="ea-unlocked">
          <p className="ea-unlocked-title">EARLY ACCESS UNLOCKED ✓</p>
          <p className="ea-unlocked-line">
            Burn verified — {formatTokens(proof.amountTokens)} ORBITX (~${proof.usd.toFixed(2)}). This account
            enters the city from now on, and everyone joins free on December 5.
          </p>
          <button type="button" className="menu-cta ea-cta" onClick={onEnter}>
            ENTER THE CITY →
          </button>
        </div>
      ) : signedIn ? (
        <div className="ea-verify">
          <label className="ea-field">
            Wallet PIN — only if your wallet asks for one
            <input
              id="ea-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Leave blank if you never set one"
            />
          </label>
          {shortfall > 0 ? (
            <p className="ea-note">
              Your in-game wallet is about {formatTokens(shortfall)} ORBITX short of the ≈
              {formatTokens(tokensNeeded)} needed — send more to the address above, refresh the balance, then burn.
            </p>
          ) : null}
          {burnError ? (
            <p className="ea-error" role="alert">
              {burnError}
            </p>
          ) : null}
          <button type="button" className="menu-cta ea-cta" disabled={burning} onClick={() => void burn()}>
            {burning ? "BURNING…" : "BURN SUPPLY"}
          </button>
          <button
            type="button"
            className="ea-back"
            aria-expanded={showFallback}
            onClick={() => setShowFallback((open) => !open)}
          >
            Exported your wallet and burned it yourself?
          </button>
          {showFallback ? (
            <>
              <p className="ea-note">
                Then prove that burn here. It is checked against your in-game wallet address — the burn has to
                have come <b>from</b> this wallet:
              </p>
              <span className="ea-addrrow">
                <code className="ea-addr">{address || "Creating the wallet…"}</code>
              </span>
              <label className="ea-field">
                Burn transaction — Solscan link or signature
                <input
                  value={txInput}
                  onChange={(event) => setTxInput(event.target.value)}
                  placeholder="https://solscan.io/tx/…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {verifyError ? (
                <p className="ea-error" role="alert">
                  {verifyError}
                </p>
              ) : null}
              <button type="button" className="menu-cta ea-cta" disabled={verifying} onClick={() => void verify()}>
                {verifying ? "CHECKING THE BURN…" : "VERIFY & UNLOCK"}
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="ea-need-account">
          <p>
            <b>An account is required.</b> The burn spends from your in-game wallet, and the unlock lives on your
            OrbitX City account — a guest session can't hold either. Sign in or create an account first, then send
            ORBITX to your in-game wallet and burn it here; the unlock stays on that account for good.
          </p>
          <button type="button" className="menu-cta ea-cta" onClick={onNeedAccount}>
            SIGN IN / CREATE ACCOUNT
          </button>
        </div>
      )}

      <div className="ea-foot">
        {landing ? null : (
          <button type="button" className="ea-back" onClick={onBack}>
            ← Back to menu
          </button>
        )}
        <span className="ea-foot-note">No burn yet? The city opens free to everyone on December 5.</span>
      </div>
    </div>
  );
}
