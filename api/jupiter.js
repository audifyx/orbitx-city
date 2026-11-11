// Jupiter Swap API client (no SDK — raw REST + hand-signed transactions).
// The billboard flow is SOL-denominated: the buyer pays SOL, the swap buys
// whatever ORBITX that SOL gets (ExactIn), and ALL of the received ORBITX
// is burned. ExactOut has no route for this token, so an exact-ORBITX
// price cannot be quoted — the amount burned is the swap's actual output.
// 100% of the payment is buy + burn. OrbitX takes no fee and no cut.
//
// Hosts: api.jup.ag/swap/v1 is tried first (it answers from this network),
// quote-api.jup.ag/v6 is the fallback with the same shapes.
// An API key is optional: set JUP_API_KEY and it is sent as x-api-key.

import { signMessage } from "./wallet.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export function orbitxMint() {
  return process.env.ORBITX_MINT || "";
}

const HOSTS = [
  { base: "https://api.jup.ag/swap/v1", swapPath: "/swap" },
  { base: "https://quote-api.jup.ag/v6", swapPath: "/swap" },
];

let fetchImpl = null;
export function setJupiterFetch(fn) {
  fetchImpl = fn;
}

async function jupFetch(url, options) {
  const fn = fetchImpl || fetch;
  const headers = { ...(options?.headers || {}) };
  if (process.env.JUP_API_KEY) headers["x-api-key"] = process.env.JUP_API_KEY;
  const res = await fn(url, { ...options, headers, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || `Jupiter ${res.status}`);
  }
  return data;
}

/**
 * ExactIn quote: how much ORBITX does inLamports of SOL buy?
 * Returns { inAmount, outAmount, quoteResponse } with amounts as base-unit strings.
 */
export async function getQuote(inLamports, slippageBps = 100) {
  const mint = orbitxMint();
  if (!mint) throw new Error("ORBITX_MINT is not set, so no quote was made.");
  const amount = String(Math.round(Number(inLamports) || 0));
  if (!Number(amount) || Number(amount) <= 0) throw new Error("Quote amount must be positive.");
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: mint,
    amount,
    slippageBps: String(slippageBps),
  });
  let lastError = null;
  for (const host of HOSTS) {
    try {
      const quote = await jupFetch(`${host.base}/quote?${params.toString()}`);
      if (!quote || !quote.outAmount) throw new Error(quote?.error || "Jupiter returned no route.");
      return { inAmount: quote.inAmount, outAmount: quote.outAmount, quoteResponse: quote };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Jupiter quote failed (${lastError?.message || "no route"}). Nothing was bought.`);
}

/** Ask Jupiter to build the swap transaction for a quote. Returns { swapTransaction, lastValidBlockHeight }. */
export async function buildSwap(quoteResponse, userPublicKey) {
  const body = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };
  let lastError = null;
  for (const host of HOSTS) {
    try {
      const data = await jupFetch(`${host.base}${host.swapPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!data?.swapTransaction) throw new Error(data?.error || "Jupiter returned no swap transaction.");
      return { swapTransaction: data.swapTransaction, lastValidBlockHeight: data.lastValidBlockHeight };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Jupiter swap build failed (${lastError?.message || "unknown"}). Nothing was signed.`);
}

function readVarint(bytes, offset) {
  let value = 0;
  let shift = 0;
  let at = offset;
  while (true) {
    const byte = bytes[at++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 28) throw new Error("Varint too long.");
  }
  return { value, next: at };
}

function writeVarint(value) {
  const out = [];
  let left = value;
  while (true) {
    let elem = left & 0x7f;
    left = Math.floor(left / 128);
    if (left) elem |= 0x80;
    out.push(elem);
    if (!left) break;
  }
  return Buffer.from(out);
}

/**
 * Sign a versioned (v0) transaction produced by Jupiter.
 * Layout: [sig-count varint][signatures (64 bytes each)][serialized message].
 * The message bytes are signed as-is; the signature is spliced into slot 0
 * (the fee payer = the user's in-app wallet).
 * Returns { signedTx (base64), signature (base58) }.
 */
export function signVersionedTransaction(swapTransactionBase64, secret, b58encode) {
  const bytes = Buffer.from(swapTransactionBase64, "base64");
  const { value: sigCount, next: sigStart } = readVarint(bytes, 0);
  if (sigCount < 1) throw new Error("Swap transaction has no signature slot.");
  const message = bytes.subarray(sigStart + sigCount * 64);
  if (!message.length) throw new Error("Swap transaction has no message to sign.");
  const sig = signMessage(secret, message);
  const signed = Buffer.concat([
    bytes.subarray(0, sigStart),
    sig,
    bytes.subarray(sigStart + 64, sigStart + sigCount * 64),
    message,
  ]);
  return { signedTx: signed.toString("base64"), signature: b58encode(sig) };
}

/** Decode a versioned transaction's message bytes (for tests / inspection). */
export function versionedMessage(swapTransactionBase64) {
  const bytes = Buffer.from(swapTransactionBase64, "base64");
  const { value: sigCount, next: sigStart } = readVarint(bytes, 0);
  return bytes.subarray(sigStart + sigCount * 64);
}
