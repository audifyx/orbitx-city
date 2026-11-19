// Trading Floor terminal — the OrbitX exchange hall's computers.
// Trade real SOL <-> any Solana token (Jupiter, via the city API),
// launch a real pump.fun coin (platform Launchpad), scan any token
// (OG score 0-100), trending (live screener), and the on-device PIN
// wallet's holdings. All data is live from the platform / city APIs —
// nothing is faked. Real-money steps always show the quote/fee and ask
// for a confirm before anything is signed.
import { useCallback, useEffect, useState } from "react";
import type { Runtime, Snap } from "./game/runtime";
import { hasLocalWallet, isLocalWalletUnlocked, localWalletAddress, shortAddress, signVersionedTxSlot } from "./game/localWallet";
import nacl from "tweetnacl";
import bs58 from "bs58";

const PLATFORM = "https://orbitx-platform-api.onrender.com";
export const ORBITX_MINT = "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOL_DECIMALS = 9;

type Tab = "trade" | "launch" | "scan" | "trending" | "wallet";

interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  icon: string;
  priceUsd: number;
  mcap: number;
  fdv: number;
  liquidity: number;
  holderCount: number;
  volume: number;
  change1h: number | null;
  change6h: number | null;
  change24h: number | null;
  decimals: number;
  score: number | null;
  verdict: string;
}

interface Quote {
  direction: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
}

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

function fmtPrice(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

function shortMint(m: string) {
  if (!m) return "";
  return m.length > 12 ? `${m.slice(0, 5)}…${m.slice(-4)}` : m;
}

async function platformGet(path: string) {
  const res = await fetch(`${PLATFORM}${path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Platform ${res.status}`);
  return res.json();
}

async function platformPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLATFORM}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error || data.message || `Platform ${res.status}`));
  return data;
}

function tokenFromPlatform(data: Record<string, unknown>): TokenInfo | null {
  const t = data.token as Record<string, unknown> | undefined;
  if (!t || typeof t.mint !== "string") return null;
  const score = data.score as { total?: number } | undefined;
  return {
    mint: String(t.mint),
    name: String(t.name || ""),
    symbol: String(t.symbol || ""),
    icon: String(t.icon || ""),
    priceUsd: Number(t.priceUsd || 0),
    mcap: Number(t.mcap || 0),
    fdv: Number(t.fdv || 0),
    liquidity: Number(t.liquidity || 0),
    holderCount: Number(t.holderCount || 0),
    volume: Number(t.volume || 0),
    change1h: t.change1h == null ? null : Number(t.change1h),
    change6h: t.change6h == null ? null : Number(t.change6h),
    change24h: t.change24h == null ? null : Number(t.change24h),
    decimals: Number(t.decimals || 0),
    score: score && typeof score.total === "number" ? score.total : null,
    verdict: String(data.verdict || ""),
  };
}

export function TradingFloorPanel({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const [tab, setTab] = useState<Tab>("trade");
  const [selectedMint, setSelectedMint] = useState(ORBITX_MINT);
  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");

  const openToken = useCallback((mint: string) => {
    setSelectedMint(mint);
    setTab("trade");
  }, []);

  const unlockWallet = useCallback(async () => {
    if (!rt) return false;
    if (!hasLocalWallet()) {
      setPinMsg("No on-device wallet yet — create one in the Wallet panel first.");
      return false;
    }
    if (isLocalWalletUnlocked()) return true;
    const res = await rt.unlockLocalWallet(pin);
    if (!res.ok) {
      setPinMsg(String(res.message || "Wrong PIN."));
      return false;
    }
    setPinMsg("Wallet unlocked.");
    return true;
  }, [rt, pin]);

  return (
    <div className="list">
      <p className="muted">OrbitX Trading Floor — real Solana, real money. Trade, launch, scan. Nothing here is paper.</p>
      <div className="days">
        <button type="button" className={tab === "trade" ? "on" : undefined} onClick={() => setTab("trade")}>Trade</button>
        <button type="button" className={tab === "launch" ? "on" : undefined} onClick={() => setTab("launch")}>Launch</button>
        <button type="button" className={tab === "scan" ? "on" : undefined} onClick={() => setTab("scan")}>Scan</button>
        <button type="button" className={tab === "trending" ? "on" : undefined} onClick={() => setTab("trending")}>Trending</button>
        <button type="button" className={tab === "wallet" ? "on" : undefined} onClick={() => setTab("wallet")}>Wallet</button>
      </div>
      {tab === "trade" && <TradeTab snap={snap} rt={rt} mint={selectedMint} onSelectMint={setSelectedMint} />}
      {tab === "launch" && <LaunchTab rt={rt} pin={pin} setPin={setPin} pinMsg={pinMsg} unlockWallet={unlockWallet} />}
      {tab === "scan" && <ScanTab mint={selectedMint} onSelectMint={setSelectedMint} />}
      {tab === "trending" && <TrendingTab onOpen={openToken} />}
      {tab === "wallet" && <WalletTab rt={rt} />}
    </div>
  );
}

// ── Trade ──────────────────────────────────────────────────────────────────
function TradeTab({ snap, rt, mint, onSelectMint }: { snap: Snap; rt: Runtime | null; mint: string; onSelectMint: (m: string) => void }) {
  const [mintInput, setMintInput] = useState(mint);
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.1");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [execBusy, setExecBusy] = useState(false);
  const [execMsg, setExecMsg] = useState("");
  const [lastSig, setLastSig] = useState("");

  const loadToken = useCallback(async (m: string) => {
    if (!m) return;
    setLoading(true);
    setError("");
    setQuote(null);
    setExecMsg("");
    try {
      const data = await platformGet(`/api/ogdex/token?mint=${encodeURIComponent(m)}`);
      const info = tokenFromPlatform(data);
      if (!info) throw new Error("That token was not found.");
      setToken(info);
    } catch (err) {
      setToken(null);
      setError(err instanceof Error ? err.message : "Could not load that token.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMintInput(mint);
    void loadToken(mint);
  }, [mint, loadToken]);

  const baseAmount = useCallback(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (direction === "buy") return String(Math.round(n * 10 ** SOL_DECIMALS));
    const dec = token?.decimals ?? 0;
    return String(Math.round(n * 10 ** dec));
  }, [amount, direction, token]);

  const getQuote = useCallback(async () => {
    if (!rt || !token) return;
    const base = baseAmount();
    if (!base) {
      setError("Enter an amount above 0.");
      return;
    }
    setQuoteBusy(true);
    setError("");
    setExecMsg("");
    try {
      const inputMint = direction === "buy" ? SOL_MINT : token.mint;
      const outputMint = direction === "buy" ? token.mint : SOL_MINT;
      const data = (await rt.tradeQuote(inputMint, outputMint, base, 100)) as { ok?: boolean; message?: string; quote?: Quote };
      if (!data || data.ok === false) throw new Error(String(data?.message || "The quote failed."));
      if (!data.quote) throw new Error("The quote came back empty.");
      setQuote(data.quote);
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : "The quote failed.");
    } finally {
      setQuoteBusy(false);
    }
  }, [rt, token, direction, baseAmount]);

  const execute = useCallback(async () => {
    if (!rt || !token || !quote) return;
    setExecBusy(true);
    setExecMsg("");
    try {
      const data = (await rt.tradeExecute(quote.inputMint, quote.outputMint, quote.inAmount, 100)) as { ok?: boolean; message?: string; signature?: string };
      if (!data || data.ok === false) throw new Error(String(data?.message || "The trade was refused."));
      setLastSig(String(data.signature || ""));
      setExecMsg(String(data.message || "Swap sent."));
      setQuote(null);
    } catch (err) {
      setExecMsg(err instanceof Error ? err.message : "The trade failed.");
    } finally {
      setExecBusy(false);
    }
  }, [rt, token, quote]);

  const outUi = quote && token ? (direction === "buy" ? Number(quote.outAmount) / 10 ** (token.decimals || 0) : Number(quote.outAmount) / 1e9) : 0;
  const minUi = quote && token ? (direction === "buy" ? Number(quote.otherAmountThreshold) / 10 ** (token.decimals || 0) : Number(quote.otherAmountThreshold) / 1e9) : 0;

  return (
    <div>
      <p>
        <input
          type="text"
          value={mintInput}
          onChange={(e) => setMintInput(e.target.value)}
          placeholder="Paste a Solana mint…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ width: "100%" }}
        />
      </p>
      <p>
        <button type="button" disabled={loading || !mintInput} onClick={() => { onSelectMint(mintInput.trim()); }}>
          {loading ? "Loading…" : "Load token"}
        </button>{" "}
        <button type="button" onClick={() => onSelectMint(ORBITX_MINT)}>ORBITX</button>
      </p>
      {error ? <p>{error}</p> : null}
      {token ? (
        <div>
          <h3>
            {token.icon ? <img src={token.icon} alt="" style={{ width: 22, height: 22, verticalAlign: "middle", marginRight: 6 }} /> : null}
            {token.symbol || token.name} {token.score != null ? `· OG ${token.score}/100` : ""} {token.verdict ? `· ${token.verdict}` : ""}
          </h3>
          <p className="muted">
            {fmtPrice(token.priceUsd)} · MCAP {fmtUsd(token.mcap)} · Liq {fmtUsd(token.liquidity)} · Holders {fmtNum(token.holderCount)}
            <br />
            1h {fmtPct(token.change1h)} · 6h {fmtPct(token.change6h)} · 24h {fmtPct(token.change24h)} · Vol 24h {fmtUsd(token.volume)}
          </p>
          <iframe
            title={`${token.symbol || "token"} chart`}
            src={`https://dexscreener.com/solana/${encodeURIComponent(token.mint)}?embed=1&theme=dark&trades=0&info=0`}
            style={{ width: "100%", height: 320, border: "1px solid #333", background: "#000" }}
            loading="lazy"
          />
          <h3>{direction === "buy" ? `Buy ${token.symbol || "token"} with SOL` : `Sell ${token.symbol || "token"} for SOL`}</h3>
          <div className="days">
            <button type="button" className={direction === "buy" ? "on" : undefined} onClick={() => { setDirection("buy"); setQuote(null); setAmount("0.1"); }}>Buy</button>
            <button type="button" className={direction === "sell" ? "on" : undefined} onClick={() => { setDirection("sell"); setQuote(null); setAmount("1000"); }}>Sell</button>
          </div>
          <p>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
              placeholder={direction === "buy" ? "SOL amount" : `${token.symbol || "Token"} amount`}
              style={{ width: "100%" }}
            />
          </p>
          <p className="muted">{direction === "buy" ? "You pay SOL from your on-device wallet." : "You sell from your on-device wallet."} No per-trade cap beyond the wallet itself.</p>
          <p>
            <button type="button" disabled={quoteBusy || !amount} onClick={() => void getQuote()}>
              {quoteBusy ? "Pricing…" : "Get quote"}
            </button>
          </p>
          {quote ? (
            <div>
              <p>
                You {direction === "buy" ? "pay" : "sell"} <b>{direction === "buy" ? `${Number(quote.inAmount) / 1e9} SOL` : `${Number(quote.inAmount) / 10 ** (token.decimals || 0)} ${token.symbol}`}</b>
                {" → "}receive about <b>{direction === "buy" ? `${outUi.toLocaleString()} ${token.symbol}` : `${outUi.toFixed(6)} SOL`}</b>
                <br />
                Minimum out (1% slippage): <b>{direction === "buy" ? `${minUi.toLocaleString()} ${token.symbol}` : `${minUi.toFixed(6)} SOL`}</b>
              </p>
              <p>
                <button type="button" disabled={execBusy} onClick={() => void execute()}>
                  {execBusy ? "Signing…" : `Confirm ${direction === "buy" ? "buy" : "sell"}`}
                </button>
              </p>
              <p className="muted">Confirming signs once with your PIN-unlocked wallet and broadcasts the swap. Real SOL, real tokens.</p>
            </div>
          ) : null}
          {execMsg ? <p>{execMsg}</p> : null}
          {lastSig ? (
            <p className="muted">
              Tx: {shortMint(lastSig)} ·{" "}
              <a href={`https://solscan.io/tx/${lastSig}`} target="_blank" rel="noreferrer">Solscan</a>
            </p>
          ) : null}
          {!snap.playing ? null : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Launch ─────────────────────────────────────────────────────────────────
interface LaunchConfig {
  feeUsd: number;
  payWallet: string;
  solPrice: number;
}

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      resolve({ base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, mime: file.type || "image/png" });
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

async function urlToBase64(url: string): Promise<{ base64: string; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("That image URL did not load.");
  const blob = await res.blob();
  const mime = blob.type || "image/png";
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { base64: btoa(binary), mime };
}

function LaunchTab({ rt, pin, setPin, pinMsg, unlockWallet }: {
  rt: Runtime | null;
  pin: string;
  setPin: (v: string) => void;
  pinMsg: string;
  unlockWallet: () => Promise<boolean>;
}) {
  const [config, setConfig] = useState<LaunchConfig | null>(null);
  const [configErr, setConfigErr] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [devBuy, setDevBuy] = useState("0");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ mint: string; signature: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    platformGet("/api/ogdex/launch?config=1&chain=solana")
      .then((d) => {
        if (!cancelled) setConfig({ feeUsd: Number(d.feeUsd || 0.9), payWallet: String(d.payWallet || ""), solPrice: Number(d.solPrice || 0) });
      })
      .catch(() => {
        if (!cancelled) setConfigErr("Launch config did not load — check the connection and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const feeSol = config && config.solPrice > 0 ? config.feeUsd / config.solPrice : 0;

  const launch = useCallback(async () => {
    if (!rt) return;
    const cleanName = name.trim();
    const cleanSymbol = symbol.trim().toUpperCase();
    if (!cleanName || !cleanSymbol) {
      setError("Give the coin a name and a symbol.");
      return;
    }
    if (!config || !config.payWallet) {
      setError("Launch config did not load yet.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      // Unlock the wallet first (fee + create tx both sign from it).
      setStatus("Unlocking your on-device wallet…");
      const unlocked = await unlockWallet();
      if (!unlocked) throw new Error(pinMsg || "Unlock your on-device wallet with your PIN first.");
      const address = localWalletAddress();
      if (!address) throw new Error("No on-device wallet address.");
      // Icon -> base64 (file upload first, URL second).
      setStatus("Reading the coin image…");
      let image: { base64: string; mime: string };
      if (iconFile) image = await fileToBase64(iconFile);
      else if (iconUrl.trim()) image = await urlToBase64(iconUrl.trim());
      else throw new Error("Add a coin image — upload a file or paste an image URL.");
      // 1 — IPFS metadata.
      setStatus("Uploading image & metadata to IPFS…");
      const ipfs = await platformPost("/api/ogdex/launch", {
        step: "ipfs",
        imageBase64: image.base64,
        imageMimeType: image.mime,
        name: cleanName,
        symbol: cleanSymbol,
        description: description.trim(),
        twitter: twitter.trim(),
        telegram: telegram.trim(),
        website: website.trim(),
      });
      const metadataUri = String(ipfs.metadataUri || "");
      if (!metadataUri) throw new Error("IPFS upload did not return metadata.");
      // 2 — pay the $0.90 launch fee in SOL to the platform wallet.
      setStatus(`Paying the $${config.feeUsd.toFixed(2)} launch fee (${feeSol.toFixed(5)} SOL)…`);
      const fee = await rt.sendLocalSol(config.payWallet, feeSol.toFixed(6));
      const feeRes = fee as { ok?: boolean; message?: string; signature?: string };
      if (!feeRes || feeRes.ok === false) throw new Error(String(feeRes?.message || "The fee payment failed."));
      const paymentTx = String(feeRes.signature || "");
      if (!paymentTx) throw new Error("The fee payment returned no signature.");
      // 3 — mint keypair + build the create tx via PumpPortal.
      setStatus("Generating the coin mint…");
      const mintPair = nacl.sign.keyPair();
      const mintPublicKey = bs58.encode(mintPair.publicKey);
      setStatus("Building the launch transaction…");
      const created = await platformPost("/api/ogdex/launch", {
        step: "create",
        publicKey: address,
        metadataUri,
        name: cleanName,
        symbol: cleanSymbol,
        mintPublicKey,
        devBuySol: Number(devBuy) || 0,
        slippage: 15,
      });
      const unsignedTx = String(created.transaction || "");
      if (!unsignedTx) throw new Error("The launch transaction was not built.");
      // 4 — sign: mint keypair (slot 1) then the PIN wallet (slot 0).
      setStatus("Signing the launch — mint + your wallet…");
      const withMint = signVersionedTxSlot(unsignedTx, mintPair.secretKey, 1);
      const signed = (await rt.signVersionedTx(withMint)) as { ok?: boolean; message?: string; signedTx?: string };
      if (!signed || signed.ok === false || !signed.signedTx) throw new Error(String(signed?.message || "Wallet signing failed."));
      // 5 — broadcast.
      setStatus("Broadcasting the launch…");
      const sent = (await rt.submitSignedTx(signed.signedTx)) as { ok?: boolean; message?: string; signature?: string };
      if (!sent || sent.ok === false || !sent.signature) throw new Error(String(sent?.message || "Broadcast failed."));
      const launchTx = String(sent.signature);
      // 6 — record the launch (verifies the fee on-chain, stores it).
      setStatus("Recording the launch…");
      await platformPost("/api/ogdex/launch", {
        step: "record",
        payment_tx: paymentTx,
        pay_currency: "sol",
        creator_wallet: address,
        mint: mintPublicKey,
        name: cleanName,
        symbol: cleanSymbol,
        icon: metadataUri,
        description: description.trim(),
        launch_tx: launchTx,
        links: { twitter: twitter.trim(), telegram: telegram.trim(), website: website.trim() },
        chain: "solana",
      });
      setResult({ mint: mintPublicKey, signature: launchTx });
      setStatus("Launched.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The launch failed.");
    } finally {
      setBusy(false);
    }
  }, [rt, name, symbol, description, twitter, telegram, website, iconUrl, iconFile, devBuy, config, feeSol, unlockWallet, pinMsg]);

  return (
    <div>
      <p className="muted">
        Launch a real pump.fun coin from the City. Fee ${config ? config.feeUsd.toFixed(2) : "0.90"}
        {config && config.solPrice > 0 ? ` (≈ ${feeSol.toFixed(5)} SOL)` : ""} — paid from your on-device wallet, then the coin deploys on Solana.
      </p>
      {configErr ? <p>{configErr}</p> : null}
      <p><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Coin name" maxLength={32} style={{ width: "100%" }} /></p>
      <p><input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="Symbol (e.g. ORBITX)" maxLength={10} style={{ width: "100%" }} /></p>
      <p><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" maxLength={200} style={{ width: "100%" }} /></p>
      <p><input type="text" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="Twitter / X link (optional)" style={{ width: "100%" }} /></p>
      <p><input type="text" value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="Telegram link (optional)" style={{ width: "100%" }} /></p>
      <p><input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (optional)" style={{ width: "100%" }} /></p>
      <p>
        <label className="muted">Coin image (PNG/JPG, under 5 MB)</label>
        <br />
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setIconFile(e.target.files?.[0] || null)} />
        {iconFile ? <span className="muted"> {iconFile.name}</span> : null}
      </p>
      <p><input type="text" value={iconUrl} onChange={(e) => setIconUrl(e.target.value)} placeholder="…or paste an image URL" style={{ width: "100%" }} /></p>
      <p>
        <label className="muted">Dev buy (SOL, optional — buys your own coin at launch)</label>
        <br />
        <input type="number" inputMode="decimal" min="0" step="any" value={devBuy} onChange={(e) => setDevBuy(e.target.value)} style={{ width: "100%" }} />
      </p>
      {!isLocalWalletUnlocked() && hasLocalWallet() ? (
        <p>
          <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Wallet PIN to unlock" style={{ width: "100%" }} />
        </p>
      ) : null}
      {pinMsg ? <p className="muted">{pinMsg}</p> : null}
      <p>
        <button type="button" disabled={busy || !config} onClick={() => void launch()}>
          {busy ? "Launching…" : `Launch coin — $${config ? config.feeUsd.toFixed(2) : "0.90"} fee`}
        </button>
      </p>
      {status ? <p>{status}</p> : null}
      {error ? <p>{error}</p> : null}
      {result ? (
        <div>
          <h3>Launched.</h3>
          <p>
            Mint: {shortMint(result.mint)}
            <br />
            Tx: <a href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">{shortMint(result.signature)}</a>
            <br />
            <a href={`https://dexscreener.com/solana/${result.mint}`} target="_blank" rel="noreferrer">View on DexScreener</a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── Scan ───────────────────────────────────────────────────────────────────
interface ScanResult {
  token: TokenInfo;
  safety: Record<string, unknown> | null;
  forensics: Record<string, unknown> | null;
  bundle: Record<string, unknown> | null;
}

function ScanTab({ mint, onSelectMint }: { mint: string; onSelectMint: (m: string) => void }) {
  const [mintInput, setMintInput] = useState(mint);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scan = useCallback(async (m: string) => {
    const clean = m.trim();
    if (!clean) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const [tok, forensics, bundle] = await Promise.all([
        platformGet(`/api/ogdex/token?mint=${encodeURIComponent(clean)}`),
        platformGet(`/api/ogdex/forensics?mint=${encodeURIComponent(clean)}`).catch(() => null),
        platformGet(`/api/ogdex/bundle?mint=${encodeURIComponent(clean)}`).catch(() => null),
      ]);
      const info = tokenFromPlatform(tok);
      if (!info) throw new Error("That token was not found.");
      setResult({
        token: info,
        safety: (tok.safety as Record<string, unknown> | undefined) || null,
        forensics: (forensics as Record<string, unknown> | null) || null,
        bundle: (bundle as Record<string, unknown> | null) || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The scan failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMintInput(mint);
  }, [mint]);

  const s = result?.safety as { mintRenounced?: boolean; freezeRenounced?: boolean; lpLockedPct?: number; lpBurnedPct?: number; riskScore?: number; rugged?: boolean } | null;
  const f = result?.forensics as { dev?: { wallet?: string; holding?: { pct?: number }; sold?: boolean }; concentration?: { top10Pct?: number; topHolderPct?: number; totalHolders?: number } } | null;
  const b = result?.bundle as { analysis?: { bundledPct?: number; holdersAnalyzed?: number; state?: string; reason?: string } } | null;

  return (
    <div>
      <p className="muted">OG-score scanner — the same engine as the platform. Paste any Solana mint.</p>
      <p>
        <input type="text" value={mintInput} onChange={(e) => setMintInput(e.target.value)} placeholder="Paste a Solana mint…" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ width: "100%" }} />
      </p>
      <p>
        <button type="button" disabled={loading || !mintInput} onClick={() => { onSelectMint(mintInput.trim()); void scan(mintInput); }}>
          {loading ? "Scanning…" : "Scan"}
        </button>{" "}
        <button type="button" onClick={() => { onSelectMint(ORBITX_MINT); void scan(ORBITX_MINT); }}>ORBITX</button>
      </p>
      {error ? <p>{error}</p> : null}
      {result ? (
        <div>
          <h3>
            {result.token.symbol || result.token.name} · OG Score {result.token.score != null ? `${result.token.score}/100` : "—"} {result.token.verdict ? `· ${result.token.verdict}` : ""}
          </h3>
          <p className="muted">
            {fmtPrice(result.token.priceUsd)} · MCAP {fmtUsd(result.token.mcap)} · Liq {fmtUsd(result.token.liquidity)} · Holders {fmtNum(result.token.holderCount)}
            <br />
            24h {fmtPct(result.token.change24h)} · Vol 24h {fmtUsd(result.token.volume)}
          </p>
          <h3>Safety</h3>
          <p>
            Mint renounced: <b>{s?.mintRenounced ? "Yes" : "No"}</b>
            <br />
            Freeze renounced: <b>{s?.freezeRenounced ? "Yes" : "No"}</b>
            <br />
            LP locked: <b>{s?.lpLockedPct != null ? `${s.lpLockedPct}%` : "—"}</b> · LP burned: <b>{s?.lpBurnedPct != null ? `${s.lpBurnedPct}%` : "—"}</b>
            <br />
            Risk score: <b>{s?.riskScore != null ? `${s.riskScore}` : "—"}</b> {s?.rugged ? "· RUGGED" : ""}
          </p>
          <h3>Dev &amp; holders</h3>
          <p>
            Dev: <b>{f?.dev?.wallet ? shortMint(String(f.dev.wallet)) : "—"}</b> · Dev holding: <b>{f?.dev?.holding?.pct != null ? `${Number(f.dev.holding.pct).toFixed(1)}%` : "—"}</b> {f?.dev?.sold ? "· Dev sold out" : ""}
            <br />
            Top 10 holders: <b>{f?.concentration?.top10Pct != null ? `${Number(f.concentration.top10Pct).toFixed(1)}%` : "—"}</b> · Top holder: <b>{f?.concentration?.topHolderPct != null ? `${Number(f.concentration.topHolderPct).toFixed(1)}%` : "—"}</b>
            <br />
            Total holders: <b>{f?.concentration?.totalHolders != null ? fmtNum(Number(f.concentration.totalHolders)) : "—"}</b>
          </p>
          <h3>Bundle</h3>
          <p>
            {b?.analysis ? (
              <>
                Bundled: <b>{b.analysis.bundledPct != null ? `${Number(b.analysis.bundledPct).toFixed(1)}%` : "—"}</b> · Analyzed {b.analysis.holdersAnalyzed ?? "—"} holders · {b.analysis.state || ""}
                {b.analysis.reason ? <><br />{String(b.analysis.reason)}</> : null}
              </>
            ) : (
              "Bundle check did not answer."
            )}
          </p>
          <p>
            <button type="button" onClick={() => onSelectMint(result.token.mint)}>Trade this token</button>
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ── Trending ───────────────────────────────────────────────────────────────
interface TrendRow {
  mint: string;
  name: string;
  symbol: string;
  icon: string;
  priceUsd: number;
  mcap: number;
  change24h: number | null;
  volume: number;
}

function TrendingTab({ onOpen }: { onOpen: (mint: string) => void }) {
  const [rows, setRows] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await platformGet("/api/ogdex/screener");
      const list = (data.rows || []) as Array<Record<string, unknown>>;
      setRows(
        list.slice(0, 30).map((r) => ({
          mint: String(r.mint || ""),
          name: String(r.name || ""),
          symbol: String(r.symbol || ""),
          icon: String(r.icon || ""),
          priceUsd: Number(r.priceUsd || 0),
          mcap: Number(r.mcap || 0),
          change24h: r.change24h == null ? null : Number(r.change24h),
          volume: Number(r.volume || 0),
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trending did not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <p className="muted">Live from the OrbitX screener — tap a token to trade it.</p>
      <p>
        <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button>
      </p>
      {error ? <p>{error}</p> : null}
      {rows.map((r, i) => (
        <p key={r.mint || i}>
          <button type="button" onClick={() => onOpen(r.mint)} style={{ width: "100%", textAlign: "left" }}>
            {i + 1}. {r.symbol || r.name} · {fmtPrice(r.priceUsd)} · MCAP {fmtUsd(r.mcap)} · 24h {fmtPct(r.change24h)}
          </button>
        </p>
      ))}
      {!loading && rows.length === 0 && !error ? <p className="muted">No trending tokens right now.</p> : null}
    </div>
  );
}

// ── Wallet ─────────────────────────────────────────────────────────────────
interface HoldingToken {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

function WalletTab({ rt }: { rt: Runtime | null }) {
  const [holdings, setHoldings] = useState<{ sol: number | null; orbitx: number | null; tokens: HoldingToken[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const address = hasLocalWallet() ? localWalletAddress() : "";
  const unlocked = isLocalWalletUnlocked();

  const load = useCallback(async () => {
    if (!rt || !address) return;
    setLoading(true);
    setError("");
    try {
      const data = (await rt.tradeHoldings()) as { ok?: boolean; message?: string; sol?: number | null; orbitx?: number | null; tokens?: HoldingToken[] };
      if (!data || data.ok === false) throw new Error(String(data?.message || "Holdings did not load."));
      setHoldings({ sol: data.sol ?? null, orbitx: data.orbitx ?? null, tokens: data.tokens || [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Holdings did not load.");
    } finally {
      setLoading(false);
    }
  }, [rt, address]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <p className="muted">Your on-device PIN wallet — the same wallet the terminal trades and launches from. Keys never leave this device.</p>
      {!address ? (
        <p>No on-device wallet yet — create one in the Wallet panel first.</p>
      ) : (
        <div>
          <p>
            Address: <b>{shortAddress(address)}</b>
            <br />
            {unlocked ? "Unlocked." : "Locked — unlock it in the Wallet panel (or on the Launch tab) before trading."}
          </p>
          <p>
            <button type="button" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh balances"}</button>
          </p>
          {error ? <p>{error}</p> : null}
          {holdings ? (
            <div>
              <p>
                SOL: <b>{holdings.sol != null ? holdings.sol.toFixed(6) : "—"}</b>
                <br />
                ORBITX: <b>{holdings.orbitx != null ? holdings.orbitx.toLocaleString() : "—"}</b>
              </p>
              {holdings.tokens.length > 0 ? (
                <div>
                  <h3>Other tokens</h3>
                  {holdings.tokens.map((t) => (
                    <p key={t.mint}>
                      {shortMint(t.mint)}: <b>{t.uiAmount.toLocaleString()}</b>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="muted">No other token holdings yet — trade something and it shows here.</p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
