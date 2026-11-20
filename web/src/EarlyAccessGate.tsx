import { useState } from "react";
import { world, type EarlyAccessStatus } from "./game/world";

// EARLY ACCESS gate screen (pre-launch burn gate). Shown instead of the
// character roster when the server says the gate is active and this
// account has not unlocked yet: buy ORBITX → burn it to the incinerator
// from the wallet you will verify with → paste the Solscan link and the
// server checks the burn on-chain. The unlock lives on the account, so
// guests get the account-required card and are routed to sign-in first.
// Once the server reports the gate inactive (launch day), this screen
// never renders and the entry flow is untouched.

export const INCINERATOR_ADDRESS = "1nc1nerator11111111111111111111111111111111";
const DEX_URL = "https://orbitx.world/ORBITX_DEX/";

interface SolanaProvider {
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey?: { toString(): string } } | unknown>;
}

/** Pull the base58 signature out of a Solscan tx URL, or accept a raw one. */
export function extractSignature(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{32,128})/);
  if (fromUrl) return fromUrl[1];
  return /^[1-9A-HJ-NP-Za-km-z]{43,128}$/.test(text) ? text : null;
}

export function isWalletAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.trim());
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
  // A verify succeeded: App records the unlock and re-reads the status.
  onUnlocked: (proof: { amountTokens: number; usd: number }) => void;
  // Guest tapped the sign-in route — App shows the login UI.
  onNeedAccount: () => void;
  // Back to the menu home (a locked player is never trapped here).
  onBack: () => void;
  // Enter after unlocking — App re-checks the gate and routes on.
  onEnter: () => void;
}

export function EarlyAccessGate({ status, signedIn, onUnlocked, onNeedAccount, onBack, onEnter }: EarlyAccessGateProps) {
  const [wallet, setWallet] = useState("");
  const [txInput, setTxInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [proof, setProof] = useState<{ amountTokens: number; usd: number } | null>(null);

  const usdRequired = status.gate.usdRequired || 5;

  const copyAddress = () => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard
      .writeText(INCINERATOR_ADDRESS)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  };

  // Read-only connect: ask the injected provider (Phantom / Solflare)
  // for its public key and fill the address field with it. Nothing is
  // ever signed — verification reads the burn on-chain server-side.
  const connectWallet = async () => {
    setError("");
    setNote("");
    const w = window as unknown as {
      solana?: SolanaProvider;
      solflare?: SolanaProvider & { solana?: SolanaProvider };
    };
    const provider = w.solana ?? w.solflare?.solana ?? w.solflare;
    if (!provider || typeof provider.connect !== "function") {
      setNote("No wallet extension found in this browser — paste the address of the wallet you burned from instead. It verifies exactly the same.");
      return;
    }
    setConnecting(true);
    try {
      const result = (await provider.connect()) as { publicKey?: { toString(): string } } | null;
      const key = result?.publicKey ?? provider.publicKey;
      const address = key ? key.toString() : "";
      if (address) {
        setWallet(address);
        setNote("Wallet connected — address filled in. Connecting only reads your public address; nothing was signed.");
      } else {
        setError("The wallet connected but shared no address. Paste the address you burned from instead.");
      }
    } catch {
      setError("Wallet connection was cancelled. Paste the address instead — verification works the same.");
    } finally {
      setConnecting(false);
    }
  };

  const verify = async () => {
    setError("");
    const address = wallet.trim();
    if (!isWalletAddress(address)) {
      setError("That wallet address does not look right — connect your wallet or paste the address you burned from.");
      return;
    }
    const signature = extractSignature(txInput);
    if (!signature) {
      setError("Paste the Solscan link for the burn transaction (or the transaction signature itself).");
      return;
    }
    setBusy(true);
    try {
      const result = await world.earlyAccessVerify(address, signature);
      if (result.unlocked) {
        const next = { amountTokens: result.amountTokens, usd: result.usd };
        setProof(next);
        onUnlocked(next);
      } else {
        setError("The server did not unlock this account for that transaction. Check the burn and try again.");
      }
    } catch (err) {
      // The API's standard error shape: the server's message, verbatim.
      setError(err instanceof Error ? err.message : "Verification failed. Try again in a moment.");
    } finally {
      setBusy(false);
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
          ${usdRequired} ≈ <b>{formatTokens(status.gate.tokensApprox)} ORBITX</b>
        </span>
      </div>

      <ol className="ea-steps">
        <li>
          <b>1 · Buy ORBITX</b>
          <span>
            Get at least ${usdRequired} of ORBITX.{" "}
            <a href={DEX_URL} target="_blank" rel="noreferrer">
              Open the OrbitX DEX ↗
            </a>{" "}
            — or anywhere ORBITX trades.
          </span>
        </li>
        <li>
          <b>2 · Burn it</b>
          <span>
            Send it to the incinerator address below <b>from the wallet you will verify with</b>. That send is the
            burn — the tokens are gone for good, and the transaction is your proof.
          </span>
          <span className="ea-addrrow">
            <code className="ea-addr">{INCINERATOR_ADDRESS}</code>
            <button type="button" className="ea-small" onClick={copyAddress}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </span>
        </li>
        <li>
          <b>3 · Verify</b>
          <span>Connect that same wallet (or paste its address), paste the Solscan link for the burn, and verify.</span>
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
            Wallet you burned from
            <span className="ea-row">
              <input
                value={wallet}
                onChange={(event) => setWallet(event.target.value)}
                placeholder="Wallet address"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="ea-connect" disabled={connecting} onClick={() => void connectWallet()}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            </span>
          </label>
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
          {note ? <p className="ea-note">{note}</p> : null}
          {error ? (
            <p className="ea-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="menu-cta ea-cta" disabled={busy} onClick={() => void verify()}>
            {busy ? "CHECKING THE BURN…" : "VERIFY & UNLOCK"}
          </button>
        </div>
      ) : (
        <div className="ea-need-account">
          <p>
            <b>An account is required.</b> The unlock lives on your OrbitX City account — a guest session can't hold
            it. Sign in or create an account first, then burn and verify here; the unlock stays on that account for
            good.
          </p>
          <button type="button" className="menu-cta ea-cta" onClick={onNeedAccount}>
            SIGN IN / CREATE ACCOUNT
          </button>
        </div>
      )}

      <div className="ea-foot">
        <button type="button" className="ea-back" onClick={onBack}>
          ← Back to menu
        </button>
        <span className="ea-foot-note">No burn yet? The city opens free to everyone on December 5.</span>
      </div>
    </div>
  );
}
