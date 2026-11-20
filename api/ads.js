// Real billboard ads: pay SOL from the in-app wallet, Jupiter swaps
// SOL -> ORBITX, and the received ORBITX is burned — in the SAME
// transaction, signed ONCE. Jupiter builds the swap and the Token-2022
// Burn instruction is appended to it (attachBurnToSwap — the OrbitX desk
// shop's compose), so one click from the user is one signature and one
// on-chain transaction that does both jobs. There is no second step and
// no burn retry for the user to click: if the transaction fails to send
// or fails on-chain, nothing was bought, and the same click retries the
// whole buy+burn.
//
// 100% of the payment is buy + burn. OrbitX takes NO fee, NO cut, NO
// treasury — nothing is held anywhere. The UI sells "100% buy + burn" and
// never shows a fee/revenue line.
//
// Price is USD-denominated — the user set it: 10 cents a day, for now.
// Week and month scale by the same 5x/15x as the old SOL table. The SOL
// amount is computed at quote and buy time from the live SOL price, so
// the dollar price stays 10 cents even as SOL moves. Jupiter has no
// ExactOut route for this token, so an exact-ORBITX price cannot be
// quoted — the swap buys whatever ORBITX the SOL gets, and the burn is
// built for the quote's guaranteed minimum output
// (otherAmountThreshold) — so the burn can never exceed what the swap
// delivered. Any dust above the threshold stays in the wallet. The
// amount actually burned is measured from the confirmed transaction's
// token balances, never guessed from the quote.
//
// Because Vercel functions are short-lived, the buy is a state machine the
// client polls: ad-buy sends the single transaction and returns at once;
// ad-status advances swapping -> live. If the browser closes mid-flow,
// the order resumes on the next visit. A pre-change order that is still
// sitting at burn-pending (separate swap + burn) keeps its retry path
// (ad-retry-burn) — the new flow never creates one.
//
// DEVNET ONLY until the user flips SOLANA_NETWORK. No mainnet code path is
// enabled here — the network comes from wallet.js networkName().

import { attachBurnToSwap, buildSwap, getQuote, signVersionedTransaction, orbitxMint, versionedMessage } from "./jupiter.js";
import {
  TOKEN_PROGRAM_ID,
  audit,
  buildTokenBurn,
  createSolanaKeypair,
  getSignatureStatus,
  getTokenAccounts,
  getTransactionMeta,
  messageHash,
  openSecret,
  sealSecret,
  sendSignedTx,
  signLegacyMessage,
  solanaRpc,
  tokenProgramForMint,
  verifySignedTx,
  walletRow,
} from "./wallet.js";
import { b58decode, b58encode as encode58 } from "./live.js";
import { randomBytes, randomInt } from "node:crypto";

const LAMPORTS_PER_SOL = 1e9;
const DAY_MS = 86400000;

function envNum(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Pricing (USD per duration, whole-board price). Plaza boards pay the premium.
// User-set defaults: 10 cents a day, for now. Tune with env vars.
export const AD_USD_PRICE = {
  1: envNum("AD_PRICE_DAY_USD", 0.1),
  7: envNum("AD_PRICE_WEEK_USD", 0.5),
  30: envNum("AD_PRICE_MONTH_USD", 1.5),
};
export const PLAZA_BOARDS = new Set(["plaza-east", "plaza-west"]);
export const PLAZA_MULT = envNum("AD_PLAZA_MULTIPLIER", 2);
export const AD_SLIPPAGE_BPS = 100;
export const AD_MAX_SOL_LAMPORTS = envNum("AD_MAX_SOL_LAMPORTS", 0.5 * LAMPORTS_PER_SOL);
export const AD_DAILY_SOL_CAP_LAMPORTS = envNum("AD_DAILY_SOL_CAP_LAMPORTS", 1 * LAMPORTS_PER_SOL);
export const AD_BUYS_PER_HOUR = 3;
// Fee buffer: the composed transaction creates the ORBITX output ATA when
// it does not exist yet (rent ~0.002 SOL) plus network fees. 0.003 SOL
// covers both with room to spare; it is not part of the price.
const FEE_BUFFER_LAMPORTS = 0.003 * LAMPORTS_PER_SOL;

// Live SOL/USD price, for converting the USD ad price to SOL at quote
// and buy time. Jupiter's price API is unreachable from this runtime, so
// CoinGecko is the source. Cached 60s; a stale (<=1h) price is the
// fallback when the fetch fails; SOL_USD pins a fixed price (tests,
// operators). Throws when no price is available — the quote/buy fails
// cleanly rather than charging a guessed amount.
let solUsdCache = { price: 0, at: 0 };
export async function solUsdPrice() {
  const pinned = Number(process.env.SOL_USD);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  const now = Date.now();
  if (solUsdCache.price > 0 && now - solUsdCache.at < 60_000) return solUsdCache.price;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const price = Number(data?.solana?.usd);
      if (Number.isFinite(price) && price > 0) {
        solUsdCache = { price, at: now };
        return price;
      }
    }
  } catch {
    // Fall through to the stale cache, then the clean failure below.
  }
  if (solUsdCache.price > 0 && now - solUsdCache.at < 3_600_000) return solUsdCache.price;
  throw new Error("The SOL price could not be read. Try again in a moment.");
}

export const AD_BOARDS = [
  "plaza-east", "plaza-west", "hall-front", "district-row",
  "plaza-south-east", "plaza-south-west", "station-row", "market-road",
  "arcade-row", "garage-row", "bank-row", "harbor-row",
  "north-east", "north-west", "district-north", "district-far-south",
  "ny-plaza-east", "ny-plaza-west", "ny-tower",
  "la-plaza-east", "la-plaza-west", "la-tower",
  "fl-plaza-east", "fl-plaza-west", "fl-tower",
];

// ORBITX billboards (2026-11-18, user-set): a flat $1 for 7 days, paid
// in ORBITX straight from the buyer's in-app ORBITX balance — no SOL, no
// swap, no plaza premium. 100% of the ORBITX paid is burned on-chain,
// same as the merch drop. The buyer needs an account; the burn amount is
// $1 converted at the live ORBITX price (DexScreener), computed at quote
// and re-checked at buy time.
export const BILLBOARD_ORBITX_USD = envNum("BILLBOARD_ORBITX_USD", 1);
export const BILLBOARD_ORBITX_DAYS = 7;
export const BILLBOARD_IMAGE_BUCKET = "billboard-ads";
export const BILLBOARD_IMAGE_MAX_MB = 5;
const BILLBOARD_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
// An ORBITX-billboard image must be a Supabase Storage object in the
// billboard-ads bucket (signed-upload flow) or a path inside this game.
// Anything else is rejected — no hotlinked URLs on the boards.
export function billboardImageOk(image) {
  const url = String(image || "");
  if (!url) return true; // text-only ad
  const path = url.split("?")[0].split("#")[0];
  if (path.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes(`/${BILLBOARD_IMAGE_BUCKET}/`);
  } catch {
    return false;
  }
}
export function billboardImageExtOk(image) {
  const path = String(image || "").split("?")[0].split("#")[0].toLowerCase();
  return BILLBOARD_IMAGE_EXTS.some((ext) => path.endsWith(ext));
}
// Base units of ORBITX for `usd` dollars at `priceUsd` per ORBITX
// (pure math — unit-tested, no network). priceUsd "" means the live price
// could not be read; the caller fails cleanly instead of guessing.
export function orbitxBaseAmount(usd, priceUsd, decimals) {
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price <= 0) return 0n;
  const whole = Math.floor((Number(usd) / price) * 10 ** Number(decimals));
  return BigInt(whole);
}

// Moderation: a denylist, checked at quote and buy time, plus an
// owner/admin removal path. No approval queue by default — that, and the
// list itself, are the user's decision.
const DEFAULT_DENY = [
  "double your",
  "2x your",
  "free mint",
  "send sol",
  "send us sol",
  "guaranteed profit",
  "guaranteed returns",
  "pump and dump",
  "rugpull",
  "seed phrase",
  "private key",
];
function denyList() {
  const extra = String(process.env.AD_DENYLIST || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_DENY, ...extra];
}
function denied(project, text) {
  const hay = `${project} ${text}`.toLowerCase();
  for (const phrase of denyList()) {
    if (phrase && hay.includes(phrase)) return phrase;
  }
  return "";
}

function admins() {
  return new Set(
    String(process.env.AD_ADMINS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function store() {
  const slot = globalThis;
  if (!slot.__orbitxAds) {
    slot.__orbitxAds = { orders: new Map(), limits: new Map(), decimals: 0, mintProgram: new Map(), officeLeases: new Map(), arcadeGames: new Map(), arcadeEscrow: null, arcadePaper: new Map() };
  }
  if (!slot.__orbitxAds.officeLeases) slot.__orbitxAds.officeLeases = new Map();
  if (!slot.__orbitxAds.arcadeGames) slot.__orbitxAds.arcadeGames = new Map();
  if (!slot.__orbitxAds.arcadePaper) slot.__orbitxAds.arcadePaper = new Map();
  return slot.__orbitxAds;
}

export function priceUsd(board, days) {
  const usd = AD_USD_PRICE[Number(days)];
  if (!usd) return 0;
  const mult = PLAZA_BOARDS.has(board) ? PLAZA_MULT : 1;
  return usd * mult;
}

export async function priceLamports(board, days) {
  const usd = AD_USD_PRICE[Number(days)];
  if (!usd) return 0;
  const mult = PLAZA_BOARDS.has(board) ? PLAZA_MULT : 1;
  const solPrice = await solUsdPrice();
  return Math.round(((usd * mult) / solPrice) * LAMPORTS_PER_SOL);
}

function todayStr(time = Date.now()) {
  return new Date(time).toISOString().slice(0, 10);
}

function endStr(days, time = Date.now()) {
  return new Date(time + Number(days) * DAY_MS).toISOString().slice(0, 10);
}

function fail(message, status = 400) {
  return { ok: false, status, message };
}

async function decimals() {
  const slot = store();
  if (slot.decimals) return slot.decimals;
  const mint = orbitxMint();
  try {
    const info = await solanaRpc("getAccountInfo", [mint, { encoding: "base64" }]);
    const value = info?.value || info;
    if (value?.data?.[0]) {
      const raw = Buffer.from(value.data[0], "base64");
      if (raw.length > 44) slot.decimals = raw[44];
    }
  } catch {
    // Fall through to the default.
  }
  if (!slot.decimals) slot.decimals = 6;
  return slot.decimals;
}

function orderFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    playerId: row.player_id || "",
    board: row.board_id,
    days: Number(row.days || 0),
    project: row.project || "",
    text: row.text || "",
    status: row.status,
    solLamports: Number(row.sol_lamports || 0),
    orbitxAmount: String(row.orbitx_amount || ""),
    swapSignature: row.swap_signature || "",
    burnSignature: row.burn_signature || "",
    idempotencyKey: row.idempotency_key || "",
    error: row.error || "",
    createdAt: row.created_at || "",
    expiresAt: row.expires_at || "",
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
  };
}

function orderToRow(order) {
  return {
    id: order.id,
    user_id: order.userId,
    player_id: order.playerId,
    board_id: order.board,
    days: order.days,
    project: order.project,
    text: order.text,
    status: order.status,
    sol_lamports: order.solLamports,
    orbitx_amount: order.orbitxAmount ? String(order.orbitxAmount) : "0",
    swap_signature: order.swapSignature || "",
    burn_signature: order.burnSignature || "",
    idempotency_key: order.idempotencyKey || "",
    error: order.error || "",
    expires_at: order.expiresAt || null,
    meta: order.meta || {},
  };
}

async function persistOrder(ctx, order) {
  store().orders.set(order.id, order);
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return;
  const { error } = await client.from("ad_orders").upsert(orderToRow(order));
  if (error && ctx.note) ctx.note(error.message);
}

async function loadOrder(ctx, id) {
  const local = store().orders.get(id);
  if (local) return local;
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("ad_orders").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const order = orderFromRow(data);
  if (order) store().orders.set(order.id, order);
  return order;
}

async function loadOrderByKey(ctx, key) {
  for (const order of store().orders.values()) {
    if (order.idempotencyKey === key) return order;
  }
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("ad_orders").select("*").eq("idempotency_key", key).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const order = orderFromRow(data);
  if (order) store().orders.set(order.id, order);
  return order;
}

function hitLimit(key, limit, windowMs) {
  const now = Date.now();
  const list = (store().limits.get(key) || []).filter((at) => now - at < windowMs);
  if (list.length >= limit) {
    store().limits.set(key, list);
    return true;
  }
  list.push(now);
  store().limits.set(key, list);
  return false;
}

function adSpendToday(userId) {
  const since = Date.now() - DAY_MS;
  let sum = 0;
  for (const order of store().orders.values()) {
    if (order.userId !== userId) continue;
    if (!["processing", "swapping", "burning", "live"].includes(order.status)) continue;
    if (Date.parse(order.createdAt || "") < since) continue;
    sum += Number(order.solLamports || 0);
  }
  return sum;
}

function explorerUrl(signature) {
  if (!signature) return "";
  const net = process.env.SOLANA_NETWORK === "mainnet-beta" ? "" : "?cluster=devnet";
  return `https://solscan.io/tx/${signature}${net}`;
}

export function publicOrder(order) {
  return {
    id: order.id,
    board: order.board,
    days: order.days,
    project: order.project,
    text: order.text,
    status: order.status,
    kind: order.meta?.kind || "sol",
    image: order.meta?.image || "",
    solLamports: order.solLamports,
    priceSol: Number(order.solLamports || 0) / LAMPORTS_PER_SOL,
    orbitxAmount: order.orbitxAmount || "",
    swapSignature: order.swapSignature || "",
    burnSignature: order.burnSignature || "",
    swapUrl: explorerUrl(order.swapSignature),
    burnUrl: explorerUrl(order.burnSignature),
    error: order.error || "",
    createdAt: order.createdAt || "",
    expiresAt: order.expiresAt || "",
  };
}

async function boardAvailability(ctx, board, playerId) {
  const bookings = await ctx.readBookings();
  const today = todayStr();
  const hit = (bookings || []).find((row) => row.id === board && row.end && row.end >= today);
  if (!hit) return null;
  if (hit.owner_id && hit.owner_id === playerId) return null; // owner may re-book (extend).
  return { takenBy: hit.project || "Someone", end: hit.end };
}

async function dexUsd() {
  // ORBITX_USD pins a fixed price (tests, operators, rig). Otherwise the
  // live DexScreener price, like the old flow.
  const pinned = Number(process.env.ORBITX_USD);
  if (Number.isFinite(pinned) && pinned > 0) return String(pinned);
  const mint = orbitxMint();
  if (!mint) return "";
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return "";
    const data = await res.json();
    return String(data.pairs?.[0]?.priceUsd || "");
  } catch {
    return "";
  }
}

export async function adQuote(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const board = String(body.board || body.id || "").slice(0, 40);
  const days = Number(body.days);
  if (!AD_BOARDS.includes(board) || !AD_USD_PRICE[days]) {
    return fail("Pick a billboard and 1, 7, or 30 days.");
  }
  let price;
  try {
    price = await priceLamports(board, days);
  } catch (err) {
    return fail(err.message || "The SOL price could not be read. Nothing was bought.", 502);
  }
  if (price > AD_MAX_SOL_LAMPORTS) {
    return fail(`That booking is over the ${AD_MAX_SOL_LAMPORTS / LAMPORTS_PER_SOL} SOL per-buy cap.`);
  }
  const project = String(body.project || player.name || "").slice(0, 32);
  const text = String(body.text || "").slice(0, 32);
  const hit = denied(project, text);
  if (hit) return fail(`That text is not allowed on a billboard ("${hit}").`);
  const taken = await boardAvailability(ctx, board, player.id);
  if (taken) return fail(`${taken.takenBy} has ${board} until ${taken.end}. Pick another board.`);
  let quote;
  try {
    quote = await getQuote(price);
  } catch (err) {
    return fail(err.message || "The quote failed. Nothing was bought.", 502);
  }
  const dec = await decimals();
  const estOrbitx = Number(quote.outAmount || 0);
  const usd = await dexUsd();
  return {
    ok: true,
    board,
    days,
    plaza: PLAZA_BOARDS.has(board),
    priceUsd: priceUsd(board, days),
    priceSol: price / LAMPORTS_PER_SOL,
    priceLamports: price,
    estOrbitx: quote.outAmount,
    estOrbitxUi: (estOrbitx / 10 ** dec).toFixed(0),
    usd: usd ? `~$${(Number(usd) * (estOrbitx / 10 ** dec)).toFixed(2)}` : "",
    endsAt: endStr(days),
    burnNote: "100% buy + burn. No fee, no cut — every ORBITX bought is burned.",
  };
}

// How much ORBITX did the single buy+burn transaction actually burn?
// The swap moves ORBITX from the pool to the buyer (net zero across all
// accounts) and the burn destroys it — so the net ORBITX delta across
// every account in the confirmed transaction is negative by exactly the
// burned amount. Returns 0n when the transaction cannot be read yet.
async function measureBurned(signature) {
  const mint = orbitxMint();
  try {
    const meta = await getTransactionMeta(signature);
    if (!meta) return 0n;
    let pre = 0n;
    let post = 0n;
    for (const row of meta.preTokenBalances || []) {
      if (row.mint === mint) pre += BigInt(row.uiTokenAmount?.amount || "0");
    }
    for (const row of meta.postTokenBalances || []) {
      if (row.mint === mint) post += BigInt(row.uiTokenAmount?.amount || "0");
    }
    const delta = post - pre;
    return delta < 0n ? -delta : 0n;
  } catch {
    return 0n;
  }
}

// Measure exactly how much ORBITX the swap credited to the buyer.
// (Legacy path only — pre-change orders whose burn was a separate
// transaction. The single-transaction flow uses measureBurned instead.)
// Prefers the confirmed transaction's pre/post token balances; falls back
// to the balance diff against the pre-swap snapshot stored on the order.
async function measureCredited(order) {
  const mint = orbitxMint();
  const owner = order.meta.owner;
  if (!owner) return { credited: 0n, tokenAccount: "" };
  if (order.swapSignature) {
    try {
      const meta = await getTransactionMeta(order.swapSignature);
      if (meta) {
        let pre = 0n;
        let post = 0n;
        let account = "";
        for (const row of meta.preTokenBalances || []) {
          if (row.mint === mint && row.owner === owner) pre += BigInt(row.uiTokenAmount?.amount || "0");
        }
        for (const row of meta.postTokenBalances || []) {
          if (row.mint === mint && row.owner === owner) {
            post += BigInt(row.uiTokenAmount?.amount || "0");
            account = row.owner === owner ? row.accountIndex : account;
          }
        }
        if (post > pre) {
          // Find the token account address from the post balances via the
          // account keys in the transaction.
          const accounts = await solanaRpc("getTransaction", [order.swapSignature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
          const keys = accounts?.transaction?.message?.accountKeys || [];
          for (const row of meta.postTokenBalances || []) {
            if (row.mint === mint && row.owner === owner) account = keys[row.accountIndex]?.pubkey || account;
          }
          return { credited: post - pre, tokenAccount: account };
        }
      }
    } catch {
      // Fall through to the balance diff.
    }
  }
  const pre = new Map(Object.entries(order.meta.preBalances || {}));
  try {
    const after = await getTokenAccounts(owner, mint);
    let credited = 0n;
    let account = "";
    for (const row of after) {
      const before = BigInt(pre.get(row.pubkey) || "0");
      const now = BigInt(row.amount || "0");
      if (now > before) {
        credited += now - before;
        account = row.pubkey;
      }
    }
    return { credited, tokenAccount: account };
  } catch {
    return { credited: 0n, tokenAccount: "" };
  }
}

async function sendBurn(ctx, order) {
  const mint = orbitxMint();
  const owner = order.meta.owner;
  const amount = BigInt(order.orbitxAmount || "0");
  if (!owner || amount <= 0n) throw new Error("Nothing measured to burn yet.");
  const accounts = await getTokenAccounts(owner, mint);
  // Prefer the account the swap credited; otherwise the largest balance.
  let target = accounts.find((row) => row.pubkey === order.meta.tokenAccount);
  if (!target) target = [...accounts].sort((a, b) => BigInt(b.amount) - BigInt(a.amount))[0];
  if (!target || BigInt(target.amount || "0") < amount) {
    throw new Error("The wallet no longer holds the full swap output to burn.");
  }
  const program = await tokenProgramForMint(mint, store().mintProgram);
  const latest = await solanaRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const blockhash = latest?.value?.blockhash || latest?.blockhash || "";
  if (!blockhash) throw new Error("The RPC did not return a blockhash. Nothing was signed.");
  const message = buildTokenBurn(owner, target.pubkey, mint, amount, blockhash, program);
  if (!message) throw new Error("Could not build the burn transaction.");
  const row = await walletRow(order.userId);
  if (!row) throw new Error("This account has no in-app wallet yet.");
  const secret = openSecret(row);
  let signed;
  try {
    signed = signLegacyMessage(secret, message);
  } finally {
    secret.fill(0);
  }
  const signature = await sendSignedTx(signed.signedTx);
  return signature || signed.signature;
}

// Advance one order one step. Safe to call repeatedly (polling).
// swapping -> (single buy+burn tx confirmed) -> booking + live
// burning -> (legacy separate burn confirmed) -> booking + live
// A failed single transaction lands on swap-failed: nothing was bought,
// so the same click retries the whole buy+burn (adBuy re-runs a
// swap-failed order on the same idempotency key).
export async function advanceAdOrder(ctx, order, player) {
  if (order.status === "swapping") {
    const status = await getSignatureStatus(order.swapSignature);
    if (!status) return order;
    if (status === "failed") {
      order.status = "swap-failed";
      order.error = "The buy+burn transaction failed on-chain. No ORBITX was bought and no booking was made — buy again and it retries in one click.";
      await persistOrder(ctx, order);
      return order;
    }
    // One transaction did both jobs: measure what it actually burned.
    // Fall back to the guaranteed burn recorded when the transaction was
    // composed — a confirmed transaction ran its burn instruction, so the
    // guaranteed amount is what was burned.
    const burned = await measureBurned(order.swapSignature);
    const guaranteed = BigInt(order.meta.burnRaw || "0");
    const amount = burned > 0n ? burned : guaranteed;
    if (amount <= 0n) {
      order.status = "burn-pending";
      order.error = "The transaction confirmed but no burn was measured. The burn retry will re-measure.";
      await persistOrder(ctx, order);
      return order;
    }
    order.orbitxAmount = amount.toString();
    order.burnSignature = order.swapSignature; // same transaction
    order.status = "burning";
    order.error = "";
    await persistOrder(ctx, order);
    // Falls through to the "burning" branch below, which confirms the
    // same signature and finalizes the booking.
  }
  if (order.status === "burning") {
    const status = await getSignatureStatus(order.burnSignature);
    if (!status) return order;
    if (status === "failed") {
      order.status = "burn-pending";
      order.error = "The burn transaction failed on-chain. Your ORBITX is still in your wallet — retry the burn.";
      await persistOrder(ctx, order);
      return order;
    }
    const dec = await decimals();
    const burnedUi = Math.floor(Number(order.orbitxAmount || "0") / 10 ** dec);
    const info = {
      id: order.board,
      project: order.project,
      text: order.text,
      image: order.meta?.image || "",
      start: todayStr(),
      end: endStr(order.days),
      burned: burnedUi,
      owner_id: order.playerId,
      swap_signature: order.swapSignature,
      burn_signature: order.burnSignature,
      status: "live",
      orbitx_amount: order.orbitxAmount,
      sol_lamports: order.solLamports,
    };
    await ctx.saveBooking(info);
    order.status = "live";
    order.error = "";
    await persistOrder(ctx, order);
    if (player) {
      player.burned = Number(player.burned || 0) + burnedUi;
      if (ctx.savePlayer) await ctx.savePlayer(player);
    }
    await audit(order.userId, "ad-burn", `${order.board} ${order.days}d burned ${burnedUi} ORBITX (${order.orbitxAmount} base)`);
    return order;
  }
  return order;
}

// Shared preparation for BOTH ad-buy paths: validate, price, cap-check,
// quote, build the Jupiter swap, and append the Token-2022 burn —
// everything up to the signature. The LEGACY path (adBuy) then signs with
// the server-held wallet key; the ON-DEVICE path (adCompose/adSubmit)
// returns the unsigned transaction so the device's PIN-unlocked wallet
// signs it instead. The server never sees the device key.
//
// Returns { order, composed, burnRaw } when a fresh unsigned transaction
// is ready, { reuse: true, order } when the idempotency key already
// started/finished this booking (no second payment), or
// { error, status } when nothing could be prepared.
async function prepareAdBuy(ctx, player, body, owner, resumeComposed) {
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return { error: "Missing a confirm id. Open the billboard sheet again.", status: 400 };
  const existing = await loadOrderByKey(ctx, idem);
  let reuse = null;
  if (existing) {
    if (existing.status === "swapping" || existing.status === "burning") {
      await advanceAdOrder(ctx, existing, player);
      return { reuse: true, order: existing };
    }
    if (existing.status === "composed") {
      if (resumeComposed && existing.meta.unsignedTx) {
        return {
          order: existing,
          composed: existing.meta.unsignedTx,
          burnRaw: String(existing.meta.burnRaw || "0"),
          resumed: true,
        };
      }
      if (resumeComposed && !existing.meta.unsignedTx) {
        // No stored transaction to sign: re-run the whole buy+burn on
        // the same order and the same idempotency key.
        reuse = existing;
      } else {
        // The legacy path never re-runs a device-composed order: its fee
        // payer is the device address, so a server-key signature would
        // be invalid. The device flow resumes it instead.
        return { reuse: true, order: existing };
      }
    } else if (existing.status === "swap-failed") {
      // The first attempt never landed, so nothing was bought or burned.
      // One more click re-runs the whole buy+burn on the same order and
      // the same idempotency key.
      reuse = existing;
    } else {
      return { reuse: true, order: existing };
    }
  }
  const board = String(body.board || body.id || "").slice(0, 40);
  const days = Number(body.days);
  if (!AD_BOARDS.includes(board) || !AD_USD_PRICE[days]) {
    return { error: "Pick a billboard and 1, 7, or 30 days.", status: 400 };
  }
  const project = String(body.project || player.name || "").slice(0, 32);
  const text = String(body.text || "").slice(0, 32);
  const hit = denied(project, text);
  if (hit) return { error: `That text is not allowed on a billboard ("${hit}").`, status: 400 };
  const taken = await boardAvailability(ctx, board, player.id);
  if (taken) return { error: `${taken.takenBy} has ${board} until ${taken.end}. Pick another board.`, status: 400 };
  if (hitLimit(`adbuy:${player.authUser}`, AD_BUYS_PER_HOUR, 60 * 60 * 1000)) {
    return { error: "Too many billboard buys this hour. Wait and try again.", status: 429 };
  }
  let price;
  try {
    price = await priceLamports(board, days);
  } catch (err) {
    return { error: err.message || "The SOL price could not be read. Nothing was bought.", status: 502 };
  }
  if (price > AD_MAX_SOL_LAMPORTS) {
    return { error: `That booking is over the ${AD_MAX_SOL_LAMPORTS / LAMPORTS_PER_SOL} SOL per-buy cap.`, status: 400 };
  }
  if (adSpendToday(player.authUser) + price > AD_DAILY_SOL_CAP_LAMPORTS) {
    return { error: "That booking is over the daily ad cap.", status: 400 };
  }
  let balance = 0;
  try {
    const raw = await solanaRpc("getBalance", [owner]);
    balance = typeof raw === "number" ? raw : raw?.value || 0;
  } catch (err) {
    return { error: `The SOL balance was not read (${err.message || "RPC"}). Nothing was bought.`, status: 502 };
  }
  if (balance < price + FEE_BUFFER_LAMPORTS) {
    return { error: `Not enough SOL in the in-app wallet. This board costs $${priceUsd(board, days).toFixed(2)} (about ${price / LAMPORTS_PER_SOL} SOL) plus a small fee buffer.`, status: 400 };
  }
  let preBalances = {};
  try {
    const before = await getTokenAccounts(owner, orbitxMint());
    preBalances = Object.fromEntries(before.map((item) => [item.pubkey, item.amount]));
  } catch {
    preBalances = {};
  }
  const now = new Date().toISOString();
  let order;
  if (reuse) {
    reuse.board = board;
    reuse.days = days;
    reuse.project = project;
    reuse.text = text;
    reuse.solLamports = price;
    reuse.status = "processing";
    reuse.error = "";
    reuse.swapSignature = "";
    reuse.burnSignature = "";
    reuse.orbitxAmount = "";
    reuse.createdAt = now;
    reuse.expiresAt = endStr(days);
    reuse.meta = { ...(reuse.meta || {}), owner, preBalances };
    order = reuse;
  } else {
    order = {
      id: `ad_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      userId: player.authUser,
      playerId: player.id,
      board,
      days,
      project,
      text,
      status: "processing",
      solLamports: price,
      orbitxAmount: "",
      swapSignature: "",
      burnSignature: "",
      idempotencyKey: idem,
      error: "",
      createdAt: now,
      expiresAt: endStr(days),
      meta: { owner, preBalances },
    };
  }
  await persistOrder(ctx, order);
  let quote;
  try {
    quote = await getQuote(price);
  } catch (err) {
    order.status = "swap-failed";
    order.error = err.message || "The quote failed.";
    await persistOrder(ctx, order);
    return { error: order.error, status: 502 };
  }
  let swap;
  try {
    swap = await buildSwap(quote.quoteResponse, owner);
  } catch (err) {
    order.status = "swap-failed";
    order.error = err.message || "The swap could not be built.";
    await persistOrder(ctx, order);
    return { error: order.error, status: 502 };
  }
  // ONE transaction, ONE signature: append the Token-2022 burn for the
  // quote's guaranteed minimum output to Jupiter's swap transaction.
  // The wallet signs the composed transaction once — either the
  // server-held key (adBuy) or the device's PIN-unlocked key (adSubmit).
  let composed;
  let burnRaw = "0";
  try {
    burnRaw = String(BigInt(quote.otherAmountThreshold || quote.outAmount || "0"));
    if (BigInt(burnRaw) <= 0n) throw new Error("Jupiter quoted no ORBITX output to burn.");
    composed = await attachBurnToSwap(swap.swapTransaction, { owner, mint: orbitxMint(), burnRaw });
    order.meta.burnRaw = burnRaw;
    order.meta.unsignedTx = composed;
    order.meta.messageHash = messageHash(versionedMessage(composed));
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The buy+burn transaction could not be composed (${err.message || "compose"}). Nothing was signed.`;
    await persistOrder(ctx, order);
    return { error: order.error, status: 502 };
  }
  order.status = "composed";
  await persistOrder(ctx, order);
  return { order, composed, burnRaw };
}

export async function adBuy(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const row = await walletRow(player.authUser);
  if (!row) return fail("This account has no in-app wallet yet.");
  const prepared = await prepareAdBuy(ctx, player, body, row.public_key, false);
  if (prepared.error) return fail(prepared.error, prepared.status || 400);
  if (prepared.reuse) {
    return { ok: true, order: publicOrder(prepared.order), message: "This booking was already started. No second payment was made." };
  }
  const { order, composed, burnRaw } = prepared;
  let signed;
  try {
    const secret = openSecret(row);
    try {
      signed = signVersionedTransaction(composed, secret, encode58);
    } finally {
      secret.fill(0);
    }
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The transaction could not be signed (${err.message || "signing"}).`;
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  let swapSig = "";
  try {
    swapSig = await sendSignedTx(signed.signedTx);
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The transaction was not accepted (${err.message || "RPC"}).`;
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  order.swapSignature = swapSig || signed.signature;
  order.burnSignature = order.swapSignature; // same transaction
  order.orbitxAmount = burnRaw; // guaranteed burn; measured on confirm
  order.status = "swapping";
  await persistOrder(ctx, order);
  await audit(player.authUser, "ad-swap", `${order.board} ${order.days}d buy+burn sent (${order.solLamports / LAMPORTS_PER_SOL} SOL, one tx)`);
  return {
    ok: true,
    order: publicOrder(order),
    message: `One transaction sent for ${order.board} — it buys the ORBITX and burns it in the same signature. The city is watching it confirm.`,
  };
}

// ON-DEVICE wallet ad buy, step 1: compose the same buy+burn transaction
// prepareAdBuy builds, but do NOT sign it here — return it unsigned so
// the device's PIN-unlocked wallet signs it in the browser (adSubmit).
// The address comes from the device; the session already ties the order
// to the account, and adSubmit verifies the signature is from that
// address before anything is broadcast.
export async function adCompose(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const owner = String(body.address || "").trim();
  const decoded = b58decode(owner);
  if (!decoded || decoded.length !== 32) return fail("That on-device wallet address is not valid.", 400);
  const prepared = await prepareAdBuy(ctx, player, body, owner, true);
  if (prepared.error) return fail(prepared.error, prepared.status || 400);
  if (prepared.reuse) {
    return { ok: true, order: publicOrder(prepared.order), message: "This booking was already started. No second payment was made." };
  }
  return {
    ok: true,
    order: publicOrder(prepared.order),
    unsignedTx: prepared.composed,
    priceSol: Number(prepared.order.solLamports || 0) / LAMPORTS_PER_SOL,
    message: "Sign this transaction with your on-device wallet to pay.",
  };
}

// ON-DEVICE wallet ad buy, step 2: the device signed the composed
// transaction — verify it is EXACTLY this booking's transaction, signed
// by the booking's wallet, then broadcast it. A valid signature on any
// other transaction is refused: the message hash must match the one
// recorded at compose time, so a substituted transaction can never claim
// this booking's burn.
export async function adSubmit(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const order = await loadOrder(ctx, String(body.orderId || ""));
  if (!order) return fail("That booking was not found.", 404);
  if (order.userId !== player.authUser) return fail("That booking is not yours.", 403);
  if (order.status !== "composed") {
    if (["swapping", "burning"].includes(order.status)) await advanceAdOrder(ctx, order, player);
    return { ok: true, order: publicOrder(order), message: "This booking does not need another signature." };
  }
  const signedTx = String(body.signedTx || "");
  if (!signedTx) return fail("No signed transaction was sent.", 400);
  let submittedHash = "";
  try {
    submittedHash = messageHash(versionedMessage(signedTx));
  } catch {
    return fail("That signed transaction could not be read.", 400);
  }
  if (!order.meta.messageHash || submittedHash !== order.meta.messageHash) {
    return fail("That signature is not for this booking. Compose it again.", 400);
  }
  const verified = verifySignedTx(signedTx, order.meta.owner);
  if (!verified.ok) return fail(verified.message || "That signature does not verify.", 400);
  let swapSig = "";
  try {
    swapSig = await sendSignedTx(signedTx);
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The transaction was not accepted (${err.message || "RPC"}).`;
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  order.swapSignature = swapSig || verified.signature;
  order.burnSignature = order.swapSignature; // same transaction
  order.orbitxAmount = String(order.meta.burnRaw || "0"); // guaranteed burn; measured on confirm
  order.status = "swapping";
  order.error = "";
  await persistOrder(ctx, order);
  await audit(player.authUser, "ad-swap", `${order.board} ${order.days}d buy+burn sent from the on-device wallet (${order.solLamports / LAMPORTS_PER_SOL} SOL, one tx)`);
  return {
    ok: true,
    order: publicOrder(order),
    message: `One transaction sent for ${order.board} — it buys the ORBITX and burns it in the same signature. The city is watching it confirm.`,
  };
}

export async function adStatus(ctx, player, body) {
  const order = await loadOrder(ctx, String(body.orderId || ""));
  if (!order) return fail("That booking was not found.", 404);
  if (order.userId !== player.authUser) return fail("That booking is not yours.", 403);
  if (["swapping", "burning"].includes(order.status)) await advanceAdOrder(ctx, order, player);
  return { ok: true, order: publicOrder(order) };
}

export async function adRetryBurn(ctx, player, body) {
  // LEGACY: only orders created before the single-transaction change can
  // sit at burn-pending (separate swap + burn). The new flow never creates
  // one — a failed buy+burn retries with one click in adBuy instead.
  const order = await loadOrder(ctx, String(body.orderId || ""));
  if (!order) return fail("That booking was not found.", 404);
  if (order.userId !== player.authUser) return fail("That booking is not yours.", 403);
  if (order.status !== "burn-pending") {
    return { ok: true, order: publicOrder(order), message: "This booking does not need a burn retry." };
  }
  if (!order.orbitxAmount) {
    const measured = await measureCredited(order);
    if (measured.credited <= 0n) {
      order.error = "Still no ORBITX in the wallet to burn. The swap output may not have landed.";
      await persistOrder(ctx, order);
      return { ok: false, status: 409, order: publicOrder(order), message: order.error };
    }
    order.orbitxAmount = measured.credited.toString();
    order.meta.tokenAccount = measured.tokenAccount;
  }
  try {
    const burnSig = await sendBurn(ctx, order);
    order.burnSignature = burnSig;
    order.status = "burning";
    order.error = "";
  } catch (err) {
    order.error = `The burn did not send (${err.message || "burn"}). Your ORBITX is still in your wallet — try again.`;
  }
  await persistOrder(ctx, order);
  return { ok: order.status === "burning", order: publicOrder(order), message: order.error || "Burn sent. The city is watching it confirm." };
}

export async function adRemove(ctx, player, body) {
  const board = String(body.board || body.id || "").slice(0, 40);
  if (!AD_BOARDS.includes(board)) return fail("Unknown billboard.");
  const bookings = await ctx.readBookings();
  const today = todayStr();
  const hit = (bookings || []).find((row) => row.id === board && row.end && row.end >= today);
  if (!hit) return fail("That board has no live booking to remove.");
  const isAdmin = admins().has(player.authUser || "");
  const isOwner = hit.owner_id && hit.owner_id === player.id;
  if (!isAdmin && !isOwner) return fail("Only the booking owner or an admin can take a billboard down.", 403);
  // End yesterday, so the board reverts to its default face immediately
  // (end is the last live day, inclusive).
  const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  await ctx.saveBooking({ ...hit, end: yesterday, status: "removed" });
  for (const order of store().orders.values()) {
    if (order.board === board && order.status === "live") {
      order.status = "removed";
      await persistOrder(ctx, order);
    }
  }
  await audit(player.authUser, "ad-remove", `${board} taken down by ${isAdmin ? "admin" : "owner"}. The burn already happened — no refund.`);
  return { ok: true, message: `${board} is down. The burn already happened, so there is no refund.` };
}

export async function adOrdersFor(ctx, player) {
  const mine = [...store().orders.values()].filter((order) => order.userId === player.authUser);
  const client = ctx.sb ? ctx.sb() : null;
  if (client && mine.length === 0) {
    const { data, error } = await client.from("ad_orders").select("*").eq("user_id", player.authUser).order("created_at", { ascending: false }).limit(10);
    if (!error && data) {
      for (const row of data) {
        const order = orderFromRow(row);
        if (order) {
          store().orders.set(order.id, order);
          mine.push(order);
        }
      }
    }
  }
  mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { ok: true, orders: mine.slice(0, 10).map(publicOrder) };
}

// ===========================================================================
// ORBITX billboards — $1 for 7 days, paid in ORBITX, 100% burned
// ===========================================================================
// The second ad product (2026-11-18, user-set): flat $1 for 7 days on
// ANY of the 25 boards, paid in ORBITX straight from the buyer's in-app
// wallet — no SOL, no swap, no plaza premium. The flow is the same state
// machine shape as the SOL ads (processing -> burning -> live), but the
// burn is a direct Token-2022 burn of already-held ORBITX via sendBurn
// (the same helper the legacy burn-retry uses). The quote re-checks the
// price at buy time; if the ORBITX price moved, the buy recomputes and
// the order records the amount actually burned.
//
// An ORBITX order is an ad order with meta.kind = "orbitx-week" and
// meta.image = the ad image URL ("" for text-only). The placement lands
// in the same `bookings` table as the SOL ads (advanceAdOrder's
// "burning" branch writes it, image included), so boardAvailability —
// the single source of truth — refuses a second buy on a taken board no
// matter which product holds it, and expiry is the same: readBookings
// only returns rows with end >= today, so an expired placement reverts
// to the house face with no cleanup.

async function orbitxWalletBalance(ctx, player) {
  const row = await walletRow(player.authUser);
  if (!row) return { address: "", balance: 0n };
  const dec = await decimals();
  const accounts = await getTokenAccounts(row.public_key, orbitxMint());
  let balance = 0n;
  for (const account of accounts || []) {
    const amount = BigInt(account?.amount || "0");
    if (amount > balance) balance = amount;
  }
  return { address: row.public_key, balance, decimals: dec };
}

export async function billboardOrbitxQuote(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const board = String(body.board || body.id || "").slice(0, 40);
  if (!AD_BOARDS.includes(board)) return fail("Pick one of the 25 billboards.");
  const project = String(body.project || player.name || "").slice(0, 40);
  const text = String(body.text || "").slice(0, 60);
  const image = String(body.image || "").slice(0, 500);
  const hit = denied(project, text);
  if (hit) return fail(`That text is not allowed on a billboard ("${hit}").`);
  if (!billboardImageOk(image)) return fail("That image must come from the billboard upload — upload it in the Ads panel first.");
  if (image && !billboardImageExtOk(image)) return fail("That image must be a .jpg, .png, .webp, or .gif.");
  const taken = await boardAvailability(ctx, board, player.id);
  if (taken) return fail(`${taken.takenBy} has ${board} until ${taken.end}. Pick another board.`);
  const priceUsd = await dexUsd();
  if (!priceUsd) return fail("The ORBITX price could not be read. Try again in a moment.", 502);
  const dec = await decimals();
  const amount = orbitxBaseAmount(BILLBOARD_ORBITX_USD, priceUsd, dec);
  if (amount <= 0n) return fail("The ORBITX price could not be read. Try again in a moment.", 502);
  const { balance } = await orbitxWalletBalance(ctx, player);
  const ui = Number(amount) / 10 ** dec;
  return {
    ok: true,
    board,
    days: BILLBOARD_ORBITX_DAYS,
    priceUsd: BILLBOARD_ORBITX_USD,
    priceUsdPerOrbitx: priceUsd,
    orbitxAmount: amount.toString(),
    orbitxUi: ui,
    balanceUi: Number(balance) / 10 ** dec,
    enough: balance >= amount,
    endsAt: endStr(BILLBOARD_ORBITX_DAYS),
  };
}

export async function billboardOrbitxBuy(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const board = String(body.board || body.id || "").slice(0, 40);
  if (!AD_BOARDS.includes(board)) return fail("Pick one of the 25 billboards.");
  const project = String(body.project || player.name || "").slice(0, 40);
  const text = String(body.text || "").slice(0, 60);
  const image = String(body.image || "").slice(0, 500);
  const hit = denied(project, text);
  if (hit) return fail(`That text is not allowed on a billboard ("${hit}").`);
  if (!billboardImageOk(image)) return fail("That image must come from the billboard upload — upload it in the Ads panel first.");
  if (image && !billboardImageExtOk(image)) return fail("That image must be a .jpg, .png, .webp, or .gif.");
  const taken = await boardAvailability(ctx, board, player.id);
  if (taken) return fail(`${taken.takenBy} has ${board} until ${taken.end}. Pick another board.`);
  if (hitLimit(`billboard-orbitx:${player.authUser}`, AD_BUYS_PER_HOUR, 60 * 60 * 1000)) {
    return fail("Too many billboard buys this hour. Wait and try again.", 429);
  }
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return fail("Missing a confirm id. Open the billboard sheet again.");
  const existing = await loadOrderByKey(ctx, idem);
  if (existing) {
    if (existing.status === "burning") {
      await advanceAdOrder(ctx, existing, player);
      return { ok: true, order: publicOrder(existing), message: "Burn sent. The city is watching it confirm." };
    }
    if (existing.status === "live") {
      return { ok: true, order: publicOrder(existing), message: "Your billboard is live." };
    }
    if (existing.status !== "processing" || existing.burnSignature) {
      // Finished, failed, or already has a burn signature: a re-burn
      // would double-charge. Start over with a fresh confirm id.
      return fail("That booking already finished or failed. Open the billboard sheet again for a fresh buy.");
    }
    // "processing" with no burn signature yet: the first attempt never
    // sent, so re-run it on the same order and key below.
  }
  // Price at buy time, from the live ORBITX price.
  const priceUsd = await dexUsd();
  if (!priceUsd) return fail("The ORBITX price could not be read. Nothing was bought.", 502);
  const dec = await decimals();
  const amount = orbitxBaseAmount(BILLBOARD_ORBITX_USD, priceUsd, dec);
  if (amount <= 0n) return fail("The ORBITX price could not be read. Nothing was bought.", 502);
  const row = await walletRow(player.authUser);
  if (!row) return fail("No in-app wallet yet. Create your wallet first, then book.");
  const { balance } = await orbitxWalletBalance(ctx, player);
  if (balance < amount) {
    return fail(`You need ${(Number(amount) / 10 ** dec).toFixed(2)} ORBITX in your in-app wallet — you have ${(Number(balance) / 10 ** dec).toFixed(2)}. Top up first.`, 402);
  }
  const now = new Date().toISOString();
  let order = existing;
  if (!order) {
    order = {
      id: `ad_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      userId: player.authUser,
      playerId: player.id,
      board,
      days: BILLBOARD_ORBITX_DAYS,
      project,
      text,
      status: "processing",
      solLamports: 0,
      orbitxAmount: amount.toString(),
      swapSignature: "",
      burnSignature: "",
      idempotencyKey: idem,
      error: "",
      createdAt: now,
      expiresAt: endStr(BILLBOARD_ORBITX_DAYS),
      meta: { kind: "orbitx-week", image, owner: row.public_key },
    };
  } else {
    order.board = board;
    order.project = project;
    order.text = text;
    order.orbitxAmount = amount.toString();
    order.meta = { ...(order.meta || {}), kind: "orbitx-week", image, owner: row.public_key };
    order.status = "processing";
    order.error = "";
  }
  await persistOrder(ctx, order);
  try {
    const burnSig = await sendBurn(ctx, order);
    order.burnSignature = burnSig;
    order.status = "burning";
    order.error = "";
  } catch (err) {
    order.status = "burn-pending";
    order.error = `The burn did not send (${err.message || "burn"}). Your ORBITX is still in your wallet — try again.`;
    await persistOrder(ctx, order);
    return { ok: false, status: 502, order: publicOrder(order), message: order.error };
  }
  await persistOrder(ctx, order);
  return { ok: true, order: publicOrder(order), message: "Burn sent. The city is watching it confirm." };
}

export async function billboardOrbitxStatus(ctx, player, body) {
  const order = await loadOrder(ctx, String(body.orderId || ""));
  if (!order) return fail("That booking was not found.", 404);
  if (order.userId !== player.authUser) return fail("That booking is not yours.", 403);
  if (order.status === "burning") await advanceAdOrder(ctx, order, player);
  return { ok: true, order: publicOrder(order) };
}

export async function billboardOrbitxOrders(ctx, player) {
  const { orders } = await adOrdersFor(ctx, player);
  return { ok: true, orders: (orders || []).filter((o) => o.kind === "orbitx-week") };
}

// ===========================================================================
// Early access burn gate (2026-11-20)
// ===========================================================================
// Until the Dec 5 launch, a new player unlocks the city by burning $5 of
// ORBITX from their OWN wallet and proving it with the burn transaction:
// they paste their wallet address + the Solscan signature, and the server
// verifies the burn on-chain, read-only (no wallet connect, no signing,
// no custody). A burn counts when the transaction:
//   - is confirmed/finalized and did not fail on-chain,
//   - burns ORBITX from a token account the named wallet owns — an SPL
//     burn/burnChecked instruction (top-level or inner), or a transfer
//     of ORBITX from the wallet's account to the incinerator,
//   - is worth >= $5 at the live ORBITX price when verified,
//   - landed on/after Nov 20, 2026 (no recycling old burns), and
//   - has never unlocked an account before (one burn, one unlock — the
//     unlock record is keyed by signature in city.js storage).
// The gate opens for everyone at launch: at/after 2026-12-05T05:00:00Z
// (Dec 5, 00:00 EST) the status op reports the gate inactive and every
// player unlocked. Storage comes from the caller through ctx, like the
// bookings above:
//   ctx.readEarlyUnlocks() -> [ { accountId, wallet, signature,
//     amountTokens, usd, at } ]
//   ctx.saveEarlyUnlock(record) -> false when the signature is taken
//   ctx.isAdmin -> the stats-page admin account (always unlocked)

export const EARLY_ACCESS_USD_REQUIRED = 5;
export const EARLY_ACCESS_GATE_END_MS = Date.parse("2026-12-05T05:00:00Z");
export const EARLY_ACCESS_MIN_BLOCK_TIME = Math.floor(Date.parse("2026-11-20T00:00:00Z") / 1000);
// Tokens sent to a token account owned by this address are gone for
// good — the documented SPL burn-by-transfer destination. (Not the
// wallet.js INCINERATOR, which is the system-program address used for
// SOL; token burns by transfer go to the 1nc1nerator account.)
export const TOKEN_INCINERATOR = "1nc1nerator11111111111111111111111111111111";

export function earlyAccessGateActive(now = Date.now()) {
  return now < EARLY_ACCESS_GATE_END_MS;
}

/** Sum the ORBITX a wallet burned in a jsonParsed transaction: SPL
 * burn/burnChecked instructions (top-level or inner) whose source token
 * account belongs to the wallet, plus transfers of ORBITX out of the
 * wallet's accounts to an incinerator-owned account. Ownership and mint
 * come from the transaction's own token-balance table (the only place a
 * parsed instruction proves which wallet a token account belongs to).
 * Returns { amountBase: bigint, decimals: number|null }, or null when
 * the transaction holds no qualifying burn from this wallet. Pure. */
export function parseOrbitxBurn(txJson, wallet, mint) {
  if (!txJson || !wallet || !mint) return null;
  if (txJson.meta?.err) return null;
  const message = txJson.transaction?.message;
  if (!message) return null;
  const keys = (message.accountKeys || []).map((k) => (typeof k === "string" ? k : k?.pubkey || ""));
  const accounts = new Map();
  for (const list of [txJson.meta?.preTokenBalances, txJson.meta?.postTokenBalances]) {
    for (const entry of list || []) {
      const pubkey = keys[entry.accountIndex];
      if (!pubkey) continue;
      accounts.set(pubkey, {
        mint: entry.mint || "",
        owner: entry.owner || "",
        decimals: entry.uiTokenAmount?.decimals,
      });
    }
  }
  const instructions = [...(message.instructions || [])];
  for (const group of txJson.meta?.innerInstructions || []) {
    for (const ix of group.instructions || []) instructions.push(ix);
  }
  let total = 0n;
  let seenDecimals = null;
  const noteDecimals = (d) => {
    if (seenDecimals === null && Number.isFinite(d)) seenDecimals = Number(d);
  };
  for (const ix of instructions) {
    const parsed = ix?.parsed;
    if (!parsed || (ix.program !== "spl-token" && ix.program !== "spl-token-2022")) continue;
    const info = parsed.info || {};
    const amountRaw = info.tokenAmount?.amount ?? info.amount;
    if (amountRaw == null) continue;
    let amount;
    try {
      amount = BigInt(String(amountRaw));
    } catch {
      continue;
    }
    if (amount <= 0n) continue;
    if (parsed.type === "burn" || parsed.type === "burnChecked") {
      const source = accounts.get(info.account);
      const mintOk = info.mint ? info.mint === mint : source?.mint === mint;
      // The source account must be the wallet's own. A real burn always
      // leaves a balance-table row for its source; the authority fallback
      // only covers payloads where that row is absent entirely.
      const ownerOk = source ? source.owner === wallet : info.authority === wallet && info.mint === mint;
      if (!mintOk || !ownerOk) continue;
      total += amount;
      noteDecimals(info.tokenAmount?.decimals ?? source?.decimals);
    } else if (parsed.type === "transfer" || parsed.type === "transferChecked") {
      const source = accounts.get(info.source);
      const dest = accounts.get(info.destination);
      const mintOk = info.mint ? info.mint === mint : source?.mint === mint;
      const ownerOk = source ? source.owner === wallet : info.authority === wallet && info.mint === mint;
      const destOk = dest ? dest.owner === TOKEN_INCINERATOR : info.destination === TOKEN_INCINERATOR;
      if (!mintOk || !ownerOk || !destOk) continue;
      total += amount;
      noteDecimals(info.tokenAmount?.decimals ?? source?.decimals);
    }
  }
  if (total <= 0n) return null;
  return { amountBase: total, decimals: seenDecimals };
}

/** USD value of a parsed burn (base units) at a per-token USD price. */
export function orbitxBurnUsdValue(amountBase, decimals, priceUsd) {
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return (Number(amountBase) / 10 ** Number(decimals || 0)) * price;
}

export async function earlyAccessStatus(ctx, player) {
  const active = earlyAccessGateActive();
  let price = 0;
  try {
    price = await orbitxUsdPrice();
  } catch {
    price = 0; // Price unreadable: the gate block still renders, tokensApprox 0.
  }
  const tokensApprox = price > 0 ? Math.ceil(EARLY_ACCESS_USD_REQUIRED / price) : 0;
  let unlocked = !active || !!ctx.isAdmin;
  if (!unlocked && ctx.readEarlyUnlocks) {
    const rows = await ctx.readEarlyUnlocks();
    unlocked = (rows || []).some((row) => row.accountId === player.id);
  }
  return {
    ok: true,
    gate: {
      active,
      usdRequired: EARLY_ACCESS_USD_REQUIRED,
      priceUsd: price > 0 ? String(price) : "",
      tokensApprox,
    },
    unlocked,
  };
}

export async function earlyAccessVerify(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to unlock early access. Guests keep City Sol only.");
  const rows = ctx.readEarlyUnlocks ? await ctx.readEarlyUnlocks() : [];
  const mine = (rows || []).find((row) => row.accountId === player.id);
  if (mine) {
    // Already unlocked: never consume a second burn for this account.
    return { ok: true, unlocked: true, amountTokens: Number(mine.amountTokens || 0), usd: Number(mine.usd || 0) };
  }
  if (!earlyAccessGateActive()) return { ok: true, unlocked: true, amountTokens: 0, usd: 0 };
  const wallet = String(body?.wallet || "").trim();
  const signature = String(body?.signature || "").trim();
  const rawWallet = b58decode(wallet);
  if (!rawWallet || rawWallet.length !== 32) return fail("That is not a Solana wallet address.");
  if (!signature || signature.length < 32 || signature.length > 128) {
    return fail("Paste the burn transaction signature from Solscan.");
  }
  if ((rows || []).some((row) => row.signature === signature)) {
    return fail("That burn was already used to unlock early access. Each burn unlocks one account.");
  }
  const mint = orbitxMint();
  if (!mint) return fail("ORBITX is not configured on this server.", 500);
  let tx = null;
  try {
    tx = await solanaRpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  } catch (err) {
    return fail(`The burn transaction could not be read (${err.message || "RPC"}). Try again in a moment.`, 502);
  }
  if (!tx) return fail("That transaction was not found. Wait for it to confirm, then try again.");
  if (tx.meta?.err) return fail("That transaction failed on-chain, so nothing was burned.");
  const confirm = await getSignatureStatus(signature);
  if (confirm === "failed") return fail("That transaction failed on-chain, so nothing was burned.");
  if (confirm !== "confirmed" && confirm !== "finalized") {
    return fail("That transaction is not confirmed yet. Give it a moment, then try again.");
  }
  const blockTime = Number(tx.blockTime || 0);
  if (!blockTime) return fail("That transaction is still confirming. Give it a moment, then try again.");
  if (blockTime < EARLY_ACCESS_MIN_BLOCK_TIME) {
    return fail("That burn is from before Nov 20, 2026 — only a fresh burn counts for early access.");
  }
  const parsed = parseOrbitxBurn(tx, wallet, mint);
  if (!parsed) {
    return fail("No ORBITX burn from that wallet was found in that transaction. Burn ORBITX from the wallet you entered — or send it to the incinerator — and paste that transaction.");
  }
  const dec = parsed.decimals != null ? parsed.decimals : await decimals();
  const amountTokens = Number(parsed.amountBase) / 10 ** dec;
  let price = 0;
  try {
    price = await orbitxUsdPrice();
  } catch {
    return fail("The ORBITX price could not be read. Try again in a moment.", 502);
  }
  const usd = orbitxBurnUsdValue(parsed.amountBase, dec, price);
  if (usd < EARLY_ACCESS_USD_REQUIRED) {
    const need = Math.ceil(EARLY_ACCESS_USD_REQUIRED / price).toLocaleString("en-US");
    return fail(`That burn is about $${usd.toFixed(2)} of ORBITX — early access needs a $5.00 burn (about ${need} ORBITX at the current price). Burn a little more and paste the new transaction.`);
  }
  const record = { accountId: player.id, wallet, signature, amountTokens, usd, at: new Date().toISOString() };
  if (ctx.saveEarlyUnlock) {
    const saved = await ctx.saveEarlyUnlock(record);
    if (saved === false) {
      return fail("That burn was already used to unlock early access. Each burn unlocks one account.");
    }
  }
  return { ok: true, unlocked: true, amountTokens, usd };
}

// ===========================================================================
// Office leases in real SOL
// ===========================================================================
// Projects can rent an office suite in real SOL: the payment buys ORBITX
// and burns it all — the SAME single-transaction Jupiter swap + Token-2022
// burn as billboards (composeBuyBurn below). Offices cost City Sol
// in-game by default; the real-SOL lease is the second way in, and it is
// one of only TWO real-money products (ads/banners + office rentals).
// Nothing else in the game takes real money.
//
// Price is USD per term, per tier, and stays under $5 by design:
// standard $0.99 / $2.99 / $4.49, premium $1.49 / $3.99 / $4.99.
// The SOL amount is computed at quote and buy time from the live SOL
// price, like ads. Same caps as ads: 0.5 SOL per buy, 1 SOL/day,
// 3 buys/hour. A lease is an order with the same state machine as an ad
// (processing -> composed -> swapping -> burning -> live); when it goes
// live the suite is claimed in the shared office_claims table with
// paid: "sol" (ctx.saveOfficeLeaseClaim), so a SOL lease blocks a City
// Sol claim on the same suite and vice versa, and the directory shows it.
//
// The suite lookup, availability check and claim write come from the
// caller through ctx (city.js owns the office tables):
//   ctx.officeSuite(id) -> { id, name, floor, tier, claimable } | null
//   ctx.officeTaken(id, server) -> active claim row | null
//   ctx.saveOfficeLeaseClaim(claim) -> persists the claim row
// An extend (body.extend) re-leases a suite the player already holds:
// the availability check passes for their own claim and the finalize
// moves that claim's end date instead of writing a fresh claim.

export const OFFICE_SOL_USD_PRICE = {
  standard: { 1: envNum("OFFICE_SOL_DAY_USD", 0.99), 7: envNum("OFFICE_SOL_WEEK_USD", 2.99), 30: envNum("OFFICE_SOL_MONTH_USD", 4.49) },
  premium: { 1: envNum("OFFICE_SOL_DAY_USD_PREMIUM", 1.49), 7: envNum("OFFICE_SOL_WEEK_USD_PREMIUM", 3.99), 30: envNum("OFFICE_SOL_MONTH_USD_PREMIUM", 4.99) },
};
// Hard ceiling: no office lease may cost $5 or more, whatever the env vars say.
export const OFFICE_SOL_MAX_USD = 5;

export function officeSolPriceUsd(tier, days) {
  const table = OFFICE_SOL_USD_PRICE[tier];
  if (!table) return 0;
  return table[Number(days)] || 0;
}

export async function officeSolPriceLamports(tier, days) {
  const usd = officeSolPriceUsd(tier, days);
  if (!usd) return 0;
  const solPrice = await solUsdPrice();
  return Math.round((usd / solPrice) * LAMPORTS_PER_SOL);
}

// One buy+burn transaction for an arbitrary real-SOL payment: Jupiter
// quotes the SOL amount, builds the swap, and the Token-2022 burn for the
// quote's guaranteed minimum output is appended — the same
// single-transaction shape as billboards (prepareAdBuy). The caller owns
// the order row and the finalize step; this only composes.
export async function composeBuyBurn(owner, priceLamports) {
  const quote = await getQuote(priceLamports);
  const swap = await buildSwap(quote.quoteResponse, owner);
  const burnRaw = String(BigInt(quote.otherAmountThreshold || quote.outAmount || "0"));
  if (BigInt(burnRaw) <= 0n) throw new Error("Jupiter quoted no ORBITX output to burn.");
  const composed = await attachBurnToSwap(swap.swapTransaction, { owner, mint: orbitxMint(), burnRaw });
  return { composed, burnRaw, quote };
}

function leaseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    playerId: row.player_id || "",
    suite: row.suite,
    server: Number(row.server_id || 1),
    tier: row.tier || "standard",
    days: Number(row.days || 0),
    extend: !!row.extend,
    project: row.project || "",
    logo: row.logo || "",
    site: row.site || "",
    status: row.status,
    solLamports: Number(row.sol_lamports || 0),
    priceUsd: Number(row.price_usd || 0),
    orbitxAmount: String(row.orbitx_amount || ""),
    swapSignature: row.swap_signature || "",
    burnSignature: row.burn_signature || "",
    idempotencyKey: row.idempotency_key || "",
    error: row.error || "",
    createdAt: row.created_at || "",
    expiresAt: row.expires_at || "",
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
  };
}

function leaseToRow(lease) {
  return {
    id: lease.id,
    user_id: lease.userId,
    player_id: lease.playerId,
    suite: lease.suite,
    server_id: lease.server,
    tier: lease.tier,
    days: lease.days,
    extend: !!lease.extend,
    project: lease.project,
    logo: lease.logo || "",
    site: lease.site || "",
    status: lease.status,
    sol_lamports: lease.solLamports,
    price_usd: lease.priceUsd,
    orbitx_amount: lease.orbitxAmount ? String(lease.orbitxAmount) : "0",
    swap_signature: lease.swapSignature || "",
    burn_signature: lease.burnSignature || "",
    idempotency_key: lease.idempotencyKey || "",
    error: lease.error || "",
    expires_at: lease.expiresAt || null,
    meta: lease.meta || {},
  };
}

async function persistLease(ctx, lease) {
  store().officeLeases.set(lease.id, lease);
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return;
  const { error } = await client.from("office_leases").upsert(leaseToRow(lease));
  if (error && ctx.note) ctx.note(error.message);
}

async function loadLease(ctx, id) {
  const local = store().officeLeases.get(id);
  if (local) return local;
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("office_leases").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const lease = leaseFromRow(data);
  if (lease) store().officeLeases.set(lease.id, lease);
  return lease;
}

async function loadLeaseByKey(ctx, key) {
  for (const lease of store().officeLeases.values()) {
    if (lease.idempotencyKey === key) return lease;
  }
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("office_leases").select("*").eq("idempotency_key", key).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const lease = leaseFromRow(data);
  if (lease) store().officeLeases.set(lease.id, lease);
  return lease;
}

export function publicLease(lease) {
  return {
    id: lease.id,
    suite: lease.suite,
    server: lease.server,
    tier: lease.tier,
    days: lease.days,
    extend: !!lease.extend,
    project: lease.project,
    logo: lease.logo || "",
    site: lease.site || "",
    status: lease.status,
    solLamports: lease.solLamports,
    priceUsd: lease.priceUsd,
    priceSol: Number(lease.solLamports || 0) / LAMPORTS_PER_SOL,
    orbitxAmount: lease.orbitxAmount || "",
    swapSignature: lease.swapSignature || "",
    burnSignature: lease.burnSignature || "",
    swapUrl: explorerUrl(lease.swapSignature),
    burnUrl: explorerUrl(lease.burnSignature),
    error: lease.error || "",
    createdAt: lease.createdAt || "",
    expiresAt: lease.expiresAt || "",
  };
}

function officeSolSpendToday(userId) {
  const since = Date.now() - DAY_MS;
  let sum = 0;
  for (const lease of store().officeLeases.values()) {
    if (lease.userId !== userId) continue;
    if (!["processing", "swapping", "burning", "live"].includes(lease.status)) continue;
    if (Date.parse(lease.createdAt || "") < since) continue;
    sum += Number(lease.solLamports || 0);
  }
  return sum;
}

function addDaysISO(isoDate, days) {
  const at = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(at)) return endStr(days);
  return new Date(at + Number(days) * DAY_MS).toISOString().slice(0, 10);
}

// The office_claims row a live SOL lease writes. Pure (testable): the
// claim is the lease — same table, same key, same directory as a City
// Sol claim, plus paid: "sol" and the burn receipt. price stays 0
// (no City Sol changed hands).
export function leaseClaimRow(order, player) {
  const start = todayStr();
  return {
    suite: order.suite,
    server_id: order.server,
    owner_id: player.id,
    owner_name: player.name,
    project: order.project,
    logo: order.logo || "",
    site: order.site || "",
    term_days: order.days,
    start,
    until: endStr(order.days),
    price: 0,
    claimed_at: order.createdAt || new Date().toISOString(),
    paid: "sol",
    sol_lamports: order.solLamports,
    burn_signature: order.burnSignature || "",
    orbitx_amount: order.orbitxAmount || "",
    order_id: order.id,
  };
}

function leaseProjectFields(body) {
  const project = String(body.project || "").trim().slice(0, 48);
  const logo = String(body.logo || "").trim().slice(0, 200);
  const site = String(body.site || "").trim().slice(0, 200);
  if (!project) return { error: "Name the project renting this office." };
  for (const url of [logo, site]) {
    if (url && !/^https?:\/\//i.test(url)) return { error: "Logo and site links must start with http:// or https://." };
  }
  return { project, logo, site };
}

function leaseServer(body) {
  const server = Number(body.server) || 1;
  return [1, 2, 3, 4, 5].includes(server) ? server : 0;
}

export async function officeSolQuote(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to rent an office in SOL. Guests keep City Sol only.");
  const server = leaseServer(body);
  if (!server) return fail("Pick a server (1-5).");
  const suite = ctx.officeSuite ? ctx.officeSuite(String(body.suite || "")) : null;
  if (!suite) return fail("Unknown office suite.");
  if (!suite.claimable) return fail("The Founder's Office belongs to OrbitX. It is never for sale.");
  const days = Number(body.term_days ?? body.days);
  if (![1, 7, 30].includes(days)) return fail("Pick a 1-day, 7-day, or 30-day lease.");
  const fields = leaseProjectFields(body);
  if (fields.error) return fail(fields.error);
  const usd = officeSolPriceUsd(suite.tier, days);
  if (!usd || usd >= OFFICE_SOL_MAX_USD) return fail("That lease is over the $5 cap.");
  const taken = ctx.officeTaken ? await ctx.officeTaken(suite.id, server) : null;
  const extend = !!body.extend;
  if (taken && !(extend && taken.owner_id === player.id)) {
    return fail(`${suite.name} is already claimed by ${taken.project} until ${taken.until}.`);
  }
  let price;
  try {
    price = await officeSolPriceLamports(suite.tier, days);
  } catch (err) {
    return fail(err.message || "The SOL price could not be read. Nothing was bought.", 502);
  }
  if (price > AD_MAX_SOL_LAMPORTS) {
    return fail(`That lease is over the ${AD_MAX_SOL_LAMPORTS / LAMPORTS_PER_SOL} SOL per-buy cap.`);
  }
  let quote;
  try {
    quote = await getQuote(price);
  } catch (err) {
    return fail(err.message || "The quote failed. Nothing was bought.", 502);
  }
  const dec = await decimals();
  const estOrbitx = Number(quote.outAmount || 0);
  return {
    ok: true,
    suite: suite.id,
    name: suite.name,
    tier: suite.tier,
    server,
    days,
    extend,
    priceUsd: usd,
    priceSol: price / LAMPORTS_PER_SOL,
    priceLamports: price,
    estOrbitx: quote.outAmount,
    estOrbitxUi: (estOrbitx / 10 ** dec).toFixed(0),
    endsAt: endStr(days),
    pricesUsd: OFFICE_SOL_USD_PRICE,
    burnNote: "100% buy + burn. No fee, no cut — every ORBITX bought is burned.",
  };
}

// Advance one lease one step. Safe to call repeatedly (polling).
// swapping -> (single buy+burn tx confirmed) -> claim written + live
// A failed single transaction lands on swap-failed: nothing was bought,
// so the same click retries the whole buy+burn (officeSolBuy re-runs a
// swap-failed lease on the same idempotency key).
export async function advanceOfficeLease(ctx, order, player) {
  if (order.status === "swapping") {
    const status = await getSignatureStatus(order.swapSignature);
    if (!status) return order;
    if (status === "failed") {
      order.status = "swap-failed";
      order.error = "The buy+burn transaction failed on-chain. No ORBITX was bought and no lease was made — try again and it retries in one click.";
      await persistLease(ctx, order);
      return order;
    }
    // One transaction did both jobs: measure what it actually burned.
    const burned = await measureBurned(order.swapSignature);
    const guaranteed = BigInt(order.meta.burnRaw || "0");
    const amount = burned > 0n ? burned : guaranteed;
    if (amount <= 0n) {
      order.status = "burn-pending";
      order.error = "The transaction confirmed but no burn was measured. The burn retry will re-measure.";
      await persistLease(ctx, order);
      return order;
    }
    order.orbitxAmount = amount.toString();
    order.burnSignature = order.swapSignature; // same transaction
    order.status = "burning";
    order.error = "";
    await persistLease(ctx, order);
    // Falls through to the "burning" branch below, which confirms the
    // same signature and finalizes the lease.
  }
  if (order.status === "burning") {
    const status = await getSignatureStatus(order.burnSignature);
    if (!status) return order;
    if (status === "failed") {
      order.status = "burn-pending";
      order.error = "The burn transaction failed on-chain. Your ORBITX is still in your wallet — retry the lease.";
      await persistLease(ctx, order);
      return order;
    }
    const dec = await decimals();
    const burnedUi = Math.floor(Number(order.orbitxAmount || "0") / 10 ** dec);
    // Finalize: the lease IS the claim row (paid: "sol"). An extend moves
    // the existing claim's end date instead of writing a fresh claim.
    let claim = null;
    if (order.extend && ctx.officeTaken) {
      const existing = await ctx.officeTaken(order.suite, order.server);
      if (existing && existing.owner_id === player.id) {
        const until = addDaysISO(existing.until, order.days);
        claim = {
          ...existing,
          until,
          term_days: Math.max(1, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${existing.start}T00:00:00Z`)) / DAY_MS)),
          sol_lamports: Number(existing.sol_lamports || 0) + Number(order.solLamports || 0),
          burn_signature: order.burnSignature,
          orbitx_amount: order.orbitxAmount,
          order_id: order.id,
        };
      }
    }
    if (!claim) claim = leaseClaimRow(order, player);
    if (ctx.saveOfficeLeaseClaim) await ctx.saveOfficeLeaseClaim(claim);
    order.status = "live";
    order.error = "";
    await persistLease(ctx, order);
    if (player) {
      player.burned = Number(player.burned || 0) + burnedUi;
      if (ctx.savePlayer) await ctx.savePlayer(player);
    }
    await audit(order.userId, "office-sol-burn", `${order.suite} ${order.days}d burned ${burnedUi} ORBITX (${order.orbitxAmount} base)`);
    return order;
  }
  return order;
}

// Shared preparation for BOTH office-lease buy paths (same shape as
// prepareAdBuy): validate, price, cap-check, quote, build the Jupiter
// swap, and append the Token-2022 burn — everything up to the signature.
// The LEGACY path (officeSolBuy) then signs with the server-held wallet
// key; the ON-DEVICE path (officeSolCompose/officeSolSubmit) returns the
// unsigned transaction so the device's PIN-unlocked wallet signs it
// instead. The server never sees the device key.
async function prepareOfficeLease(ctx, player, body, owner, resumeComposed) {
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return { error: "Missing a confirm id. Open the office sheet again.", status: 400 };
  const existing = await loadLeaseByKey(ctx, idem);
  let reuse = null;
  if (existing) {
    if (existing.status === "swapping" || existing.status === "burning") {
      await advanceOfficeLease(ctx, existing, player);
      return { reuse: true, lease: existing };
    }
    if (existing.status === "composed") {
      if (resumeComposed && existing.meta.unsignedTx) {
        return {
          lease: existing,
          composed: existing.meta.unsignedTx,
          burnRaw: String(existing.meta.burnRaw || "0"),
          resumed: true,
        };
      }
      if (resumeComposed && !existing.meta.unsignedTx) {
        // No stored transaction to sign: re-run the whole buy+burn on
        // the same lease and the same idempotency key.
        reuse = existing;
      } else {
        // The legacy path never re-runs a device-composed lease: its fee
        // payer is the device address, so a server-key signature would
        // be invalid. The device flow resumes it instead.
        return { reuse: true, lease: existing };
      }
    } else if (existing.status === "swap-failed") {
      // The first attempt never landed, so nothing was bought or burned.
      // One more click re-runs the whole buy+burn on the same lease and
      // the same idempotency key.
      reuse = existing;
    } else {
      return { reuse: true, lease: existing };
    }
  }
  const server = leaseServer(body);
  if (!server) return { error: "Pick a server (1-5).", status: 400 };
  const suite = ctx.officeSuite ? ctx.officeSuite(String(body.suite || "")) : null;
  if (!suite) return { error: "Unknown office suite.", status: 400 };
  if (!suite.claimable) return { error: "The Founder's Office belongs to OrbitX. It is never for sale.", status: 400 };
  const days = Number(body.term_days ?? body.days);
  if (![1, 7, 30].includes(days)) return { error: "Pick a 1-day, 7-day, or 30-day lease.", status: 400 };
  const fields = leaseProjectFields(body);
  if (fields.error) return { error: fields.error, status: 400 };
  const usd = officeSolPriceUsd(suite.tier, days);
  if (!usd || usd >= OFFICE_SOL_MAX_USD) return { error: "That lease is over the $5 cap.", status: 400 };
  const taken = ctx.officeTaken ? await ctx.officeTaken(suite.id, server) : null;
  const extend = !!body.extend;
  if (taken && !(extend && taken.owner_id === player.id)) {
    return { error: `${suite.name} is already claimed by ${taken.project} until ${taken.until}.`, status: 400 };
  }
  if (hitLimit(`officelease:${player.authUser}`, AD_BUYS_PER_HOUR, 60 * 60 * 1000)) {
    return { error: "Too many office leases this hour. Wait and try again.", status: 429 };
  }
  let price;
  try {
    price = await officeSolPriceLamports(suite.tier, days);
  } catch (err) {
    return { error: err.message || "The SOL price could not be read. Nothing was bought.", status: 502 };
  }
  if (price > AD_MAX_SOL_LAMPORTS) {
    return { error: `That lease is over the ${AD_MAX_SOL_LAMPORTS / LAMPORTS_PER_SOL} SOL per-buy cap.`, status: 400 };
  }
  if (officeSolSpendToday(player.authUser) + price > AD_DAILY_SOL_CAP_LAMPORTS) {
    return { error: "That lease is over the daily real-money cap.", status: 400 };
  }
  let balance = 0;
  try {
    const raw = await solanaRpc("getBalance", [owner]);
    balance = typeof raw === "number" ? raw : raw?.value || 0;
  } catch (err) {
    return { error: `The SOL balance was not read (${err.message || "RPC"}). Nothing was bought.`, status: 502 };
  }
  if (balance < price + FEE_BUFFER_LAMPORTS) {
    return { error: `Not enough SOL in the in-app wallet. This lease costs $${usd.toFixed(2)} (about ${price / LAMPORTS_PER_SOL} SOL) plus a small fee buffer.`, status: 400 };
  }
  const now = new Date().toISOString();
  let lease;
  if (reuse) {
    reuse.suite = suite.id;
    reuse.server = server;
    reuse.tier = suite.tier;
    reuse.days = days;
    reuse.extend = extend;
    reuse.project = fields.project;
    reuse.logo = fields.logo;
    reuse.site = fields.site;
    reuse.solLamports = price;
    reuse.priceUsd = usd;
    reuse.status = "processing";
    reuse.error = "";
    reuse.swapSignature = "";
    reuse.burnSignature = "";
    reuse.orbitxAmount = "";
    reuse.createdAt = now;
    reuse.expiresAt = endStr(days);
    reuse.meta = { ...(reuse.meta || {}), owner };
    lease = reuse;
  } else {
    lease = {
      id: `lease_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      userId: player.authUser,
      playerId: player.id,
      suite: suite.id,
      server,
      tier: suite.tier,
      days,
      extend,
      project: fields.project,
      logo: fields.logo,
      site: fields.site,
      status: "processing",
      solLamports: price,
      priceUsd: usd,
      orbitxAmount: "",
      swapSignature: "",
      burnSignature: "",
      idempotencyKey: idem,
      error: "",
      createdAt: now,
      expiresAt: endStr(days),
      meta: { owner },
    };
  }
  await persistLease(ctx, lease);
  let composed;
  let burnRaw = "0";
  try {
    const built = await composeBuyBurn(owner, price);
    composed = built.composed;
    burnRaw = built.burnRaw;
    lease.meta.burnRaw = burnRaw;
    lease.meta.unsignedTx = composed;
    lease.meta.messageHash = messageHash(versionedMessage(composed));
  } catch (err) {
    lease.status = "swap-failed";
    lease.error = `The buy+burn transaction could not be composed (${err.message || "compose"}). Nothing was signed.`;
    await persistLease(ctx, lease);
    return { error: lease.error, status: 502 };
  }
  lease.status = "composed";
  await persistLease(ctx, lease);
  return { lease, composed, burnRaw };
}

export async function officeSolBuy(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to rent an office in SOL. Guests keep City Sol only.");
  const row = await walletRow(player.authUser);
  if (!row) return fail("This account has no in-app wallet yet.");
  const prepared = await prepareOfficeLease(ctx, player, body, row.public_key, false);
  if (prepared.error) return fail(prepared.error, prepared.status || 400);
  if (prepared.reuse) {
    return { ok: true, lease: publicLease(prepared.lease), message: "This lease was already started. No second payment was made." };
  }
  const { lease, composed, burnRaw } = prepared;
  let signed;
  try {
    const secret = openSecret(row);
    try {
      signed = signVersionedTransaction(composed, secret, encode58);
    } finally {
      secret.fill(0);
    }
  } catch (err) {
    lease.status = "swap-failed";
    lease.error = `The transaction could not be signed (${err.message || "signing"}).`;
    await persistLease(ctx, lease);
    return fail(lease.error, 502);
  }
  let swapSig = "";
  try {
    swapSig = await sendSignedTx(signed.signedTx);
  } catch (err) {
    lease.status = "swap-failed";
    lease.error = `The transaction was not accepted (${err.message || "RPC"}).`;
    await persistLease(ctx, lease);
    return fail(lease.error, 502);
  }
  lease.swapSignature = swapSig || signed.signature;
  lease.burnSignature = lease.swapSignature; // same transaction
  lease.orbitxAmount = burnRaw; // guaranteed burn; measured on confirm
  lease.status = "swapping";
  await persistLease(ctx, lease);
  await audit(player.authUser, "office-sol-swap", `${lease.suite} ${lease.days}d buy+burn sent (${lease.solLamports / LAMPORTS_PER_SOL} SOL, one tx)`);
  return {
    ok: true,
    lease: publicLease(lease),
    message: `One transaction sent for ${lease.suite} — it buys the ORBITX and burns it in the same signature. The city is watching it confirm.`,
  };
}

// ON-DEVICE wallet office lease, step 1: compose the same buy+burn
// transaction prepareOfficeLease builds, but do NOT sign it here — return
// it unsigned so the device's PIN-unlocked wallet signs it in the browser
// (officeSolSubmit). The server never sees the device key.
export async function officeSolCompose(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to rent an office in SOL. Guests keep City Sol only.");
  const owner = String(body.address || "").trim();
  const decoded = b58decode(owner);
  if (!decoded || decoded.length !== 32) return fail("That on-device wallet address is not valid.", 400);
  const prepared = await prepareOfficeLease(ctx, player, body, owner, true);
  if (prepared.error) return fail(prepared.error, prepared.status || 400);
  if (prepared.reuse) {
    return { ok: true, lease: publicLease(prepared.lease), message: "This lease was already started. No second payment was made." };
  }
  return {
    ok: true,
    lease: publicLease(prepared.lease),
    unsignedTx: prepared.composed,
    priceSol: Number(prepared.lease.solLamports || 0) / LAMPORTS_PER_SOL,
    message: "Sign this transaction with your on-device wallet to pay.",
  };
}

// ON-DEVICE wallet office lease, step 2: the device signed the composed
// transaction — verify it is EXACTLY this lease's transaction, signed by
// the lease's wallet, then broadcast it. A valid signature on any other
// transaction is refused: the message hash must match the one recorded
// at compose time, so a substituted transaction can never claim this
// lease's burn.
export async function officeSolSubmit(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to rent an office in SOL. Guests keep City Sol only.");
  const lease = await loadLease(ctx, String(body.orderId || body.leaseId || ""));
  if (!lease) return fail("That lease was not found.", 404);
  if (lease.userId !== player.authUser) return fail("That lease is not yours.", 403);
  if (lease.status !== "composed") {
    if (["swapping", "burning"].includes(lease.status)) await advanceOfficeLease(ctx, lease, player);
    return { ok: true, lease: publicLease(lease), message: "This lease does not need another signature." };
  }
  const signedTx = String(body.signedTx || "");
  if (!signedTx) return fail("No signed transaction was sent.", 400);
  let submittedHash = "";
  try {
    submittedHash = messageHash(versionedMessage(signedTx));
  } catch {
    return fail("That signed transaction could not be read.", 400);
  }
  if (!lease.meta.messageHash || submittedHash !== lease.meta.messageHash) {
    return fail("That signature is not for this lease. Compose it again.", 400);
  }
  const verified = verifySignedTx(signedTx, lease.meta.owner);
  if (!verified.ok) return fail(verified.message || "That signature does not verify.", 400);
  let swapSig = "";
  try {
    swapSig = await sendSignedTx(signedTx);
  } catch (err) {
    lease.status = "swap-failed";
    lease.error = `The transaction was not accepted (${err.message || "RPC"}).`;
    await persistLease(ctx, lease);
    return fail(lease.error, 502);
  }
  lease.swapSignature = swapSig || verified.signature;
  lease.burnSignature = lease.swapSignature; // same transaction
  lease.orbitxAmount = String(lease.meta.burnRaw || "0"); // guaranteed burn; measured on confirm
  lease.status = "swapping";
  lease.error = "";
  await persistLease(ctx, lease);
  await audit(player.authUser, "office-sol-swap", `${lease.suite} ${lease.days}d buy+burn sent from the on-device wallet (${lease.solLamports / LAMPORTS_PER_SOL} SOL, one tx)`);
  return {
    ok: true,
    lease: publicLease(lease),
    message: `One transaction sent for ${lease.suite} — it buys the ORBITX and burns it in the same signature. The city is watching it confirm.`,
  };
}

export async function officeSolStatus(ctx, player, body) {
  const lease = await loadLease(ctx, String(body.orderId || body.leaseId || ""));
  if (!lease) return fail("That lease was not found.", 404);
  if (lease.userId !== player.authUser) return fail("That lease is not yours.", 403);
  if (["swapping", "burning"].includes(lease.status)) await advanceOfficeLease(ctx, lease, player);
  return { ok: true, lease: publicLease(lease) };
}

export async function officeSolLeasesFor(ctx, player) {
  const mine = [...store().officeLeases.values()].filter((lease) => lease.userId === player.authUser);
  const client = ctx.sb ? ctx.sb() : null;
  if (client && mine.length === 0) {
    const { data, error } = await client.from("office_leases").select("*").eq("user_id", player.authUser).order("created_at", { ascending: false }).limit(10);
    if (!error && data) {
      for (const row of data) {
        const lease = leaseFromRow(row);
        if (lease) {
          store().officeLeases.set(lease.id, lease);
          mine.push(lease);
        }
      }
    }
  }
  mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { ok: true, leases: mine.slice(0, 10).map(publicLease) };
}

// ===========================================================================
// Mini-Games Hub — 2-player PvP pot games in real ORBITX
// ===========================================================================
// Real games, pot-pooled, winner takes ALL (user, 2026-11-18): two players
// put in the same entry, the server flips/rolls, the winner automatically
// gets both entries — no house cut, no 90/10 split. 50/50 games only in
// this slice: Coin Flip (heads/tails) and Dice Roll (high/low).
//
// Money model: the entry is $1 / $2 / $5 / $10 in ORBITX at buy time
// (DexScreener ORBITX price, same source as the ad USD display). The
// entry leaves the player's ON-DEVICE (PIN) wallet in a transaction the
// device signs — the server never sees the device key (the adCompose /
// adSubmit pattern). The entry goes to the arcade ESCROW address, a
// server-held keypair sealed with WALLET_MASTER_KEY and stored in
// arcade_state; the escrow only ever holds entries of in-progress games.
// At resolve the server pays the FULL pot (2x entry) from the escrow to
// the winner, server-side. If no opponent joins in time the entry is
// refunded from the escrow automatically. No custody beyond one
// in-progress game's escrow.
//
// Paper mode (rig/tests only): ARCADE_PAPER=1 records transfers instead
// of broadcasting them and seeds every address with paper ORBITX, so the
// whole sign/verify/resolve/payout path runs with zero real funds. The
// real on-chain flow is proven by the user's phone test, same as the
// push-10 real-economy rule.
//
// Ops (wired in api/city.js): arcade-lobby, arcade-compose,
// arcade-submit, arcade-cancel, arcade-history, arcade-leaders,
// arcade-act (moves inside the interactive matches: rps, highcard,
// quickdraw — same escrow, same tiers, winner takes the full pot).
// A game row is the matchmaking authority: open games live in the
// in-memory store AND Supabase (arcade_games) so a creator and a joiner
// on different lambda instances see the same game.

export const ARCADE_GAMES = {
  coinflip: { name: "Coin Flip", picks: ["heads", "tails"] },
  diceroll: { name: "Dice Roll", picks: ["high", "low"] },
  // Interactive matches (v48): both entries land in escrow exactly like
  // the flip/dice games, then the match plays out over arcade-act calls
  // and settles through settleArcadeMatch — the same escrow payout path,
  // with the win decision recorded before any payment so a retry can
  // never pay twice. No side is picked at create/join time (picks: []);
  // each round's choices happen inside the match, server-side only.
  rps: { name: "Rock Paper Scissors", picks: [], interactive: true },
  highcard: { name: "High Card", picks: [], interactive: true },
  quickdraw: { name: "Quick Draw", picks: [], interactive: true },
};
export const RPS_PICKS = ["rock", "paper", "scissors"];
// How long a player may stall a match phase before the sweep calls it:
// the player who acted wins by forfeit; if neither acted, both entries
// come back (split). Generous — a match is a conversation, not a reflex
// test (Quick Draw's reflex part is measured separately, in-round).
export const ARCADE_MATCH_ACTION_MS = 90_000;
export const QD_MIN_DELAY_MS = 1_200;
export const QD_MAX_DELAY_MS = 3_500;
export const QD_TAP_WINDOW_MS = 10_000;
export const HIGHCARD_MAX_REDRAWS = 3;
export const ARCADE_TIERS_USD = [1, 2, 5, 10];
export const ARCADE_JOIN_TIMEOUT_MS = 120_000;
export const ARCADE_JOIN_COMPOSE_MS = 60_000;
export const ARCADE_MAX_PER_HOUR = 20;
// The escrow needs a little SOL for the payout transaction fee and the
// rent of its ORBITX token account. The first creator funds it once
// (0.005 SOL, inside their entry transaction, same fee-buffer pattern
// as ads) — after that the escrow pays its own way for hundreds of games.
export const ARCADE_ESCROW_FUND_LAMPORTS = 5_000_000;
const ARCADE_PAPER_SEED_UI = 10_000_000;

function arcadePaper() {
  return process.env.ARCADE_PAPER === "1";
}

function arcadeNow(ctx) {
  return typeof ctx?.now === "function" ? ctx.now() : Date.now();
}

function arcadeUserId(player) {
  return String(player?.authUser || player?.id || "");
}

function oppositePick(game, pick) {
  const picks = ARCADE_GAMES[game]?.picks || [];
  if (picks.length !== 2) return "";
  return pick === picks[0] ? picks[1] : picks[0];
}

// Live ORBITX price in USD, same source as the ad USD display
// (DexScreener). Cached 60s; a stale (<=1h) price is the fallback when
// the fetch fails; ORBITX_USD pins a fixed price (tests, rig, operators).
// Throws when no price is available — the quote fails, nothing is bought.
let orbitxUsdCache = { price: 0, at: 0 };
export async function orbitxUsdPrice() {
  const pinned = Number(process.env.ORBITX_USD);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  const now = Date.now();
  if (orbitxUsdCache.price > 0 && now - orbitxUsdCache.at < 60_000) return orbitxUsdCache.price;
  const fresh = Number(await dexUsd());
  if (Number.isFinite(fresh) && fresh > 0) {
    orbitxUsdCache = { price: fresh, at: now };
    return fresh;
  }
  if (orbitxUsdCache.price > 0 && now - orbitxUsdCache.at < 3_600_000) return orbitxUsdCache.price;
  throw new Error("The ORBITX price could not be read. Try again in a moment.");
}

export async function arcadeEntryRaw(tierUsd) {
  const usd = Number(tierUsd);
  if (!ARCADE_TIERS_USD.includes(usd)) return 0n;
  const price = await orbitxUsdPrice();
  const dec = await decimals();
  return BigInt(Math.round((usd / price) * 10 ** dec));
}

export async function arcadeTiers() {
  const dec = await decimals();
  const out = [];
  for (const usd of ARCADE_TIERS_USD) {
    const raw = await arcadeEntryRaw(usd);
    out.push({ usd, entryRaw: raw.toString(), entryUi: Number(raw) / 10 ** dec, potUi: (Number(raw) * 2) / 10 ** dec });
  }
  return out;
}

// --- Paper ledger (ARCADE_PAPER=1 only): every address starts with a
// paper ORBITX balance; paper transfers move it and return paper sigs.
// Nothing here touches the chain.
function paperLedger() {
  return store().arcadePaper;
}

function paperBalanceRaw(address) {
  const ledger = paperLedger();
  if (!ledger.has(address)) {
    const dec = 6;
    ledger.set(address, BigInt(ARCADE_PAPER_SEED_UI) * 10n ** BigInt(dec));
  }
  return ledger.get(address);
}

function paperMove(from, to, raw) {
  const ledger = paperLedger();
  const amount = BigInt(raw);
  ledger.set(from, paperBalanceRaw(from) - amount);
  ledger.set(to, paperBalanceRaw(to) + amount);
  return `paper_${randomBytes(8).toString("hex")}`;
}

async function orbitxBalanceRaw(ctx, address) {
  if (typeof ctx?.orbitxBalance === "function") return BigInt(await ctx.orbitxBalance(address));
  if (arcadePaper()) return paperBalanceRaw(address);
  const accounts = await getTokenAccounts(address, orbitxMint());
  const seen = new Set();
  let total = 0n;
  for (const item of accounts || []) {
    if (seen.has(item.pubkey)) continue; // the RPC double-count quirk: same account under both programs
    seen.add(item.pubkey);
    total += BigInt(item.amount || "0");
  }
  return total;
}

async function arcadeBlockhash() {
  if (arcadePaper()) return "11111111111111111111111111111111";
  const latest = await solanaRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const blockhash = latest?.value?.blockhash || latest?.blockhash || "";
  if (!blockhash) throw new Error("The RPC did not return a blockhash.");
  return blockhash;
}

// --- Escrow: one server-held keypair, sealed with WALLET_MASTER_KEY.
// Created lazily on the first game and stored in arcade_state (Supabase)
// so every lambda instance pays out from the same address. Without a
// master key the escrow is ephemeral in-memory only (paper/tests) and
// compose refuses to run in production.
async function arcadeEscrow(ctx) {
  const slot = store();
  if (slot.arcadeEscrow) return slot.arcadeEscrow;
  const client = ctx?.sb ? ctx.sb() : null;
  if (client) {
    try {
      const { data } = await client.from("arcade_state").select("*").eq("id", "escrow").maybeSingle();
      if (data?.public_key) {
        slot.arcadeEscrow = { publicKey: data.public_key, sealed: data.sealed || null, funded: !!data.funded, ataReady: !!data.ata_ready };
        return slot.arcadeEscrow;
      }
    } catch {
      // Fall through to creating one.
    }
  }
  const made = createSolanaKeypair();
  let sealed = null;
  try {
    sealed = sealSecret(made.secret);
  } catch {
    sealed = null;
  }
  const rec = { publicKey: made.publicKey, sealed, funded: false, ataReady: false, ephemeral: !sealed };
  if (sealed && client) {
    await client.from("arcade_state").upsert({ id: "escrow", public_key: made.publicKey, sealed, funded: false, ata_ready: false });
  }
  slot.arcadeEscrow = rec;
  return rec;
}

async function markEscrowReady(ctx, escrow) {
  escrow.funded = true;
  escrow.ataReady = true;
  const client = ctx?.sb ? ctx.sb() : null;
  if (client && !escrow.ephemeral) {
    await client.from("arcade_state").upsert({ id: "escrow", public_key: escrow.publicKey, sealed: escrow.sealed, funded: true, ata_ready: true });
  }
}

async function escrowNeedsFunding(ctx, escrow) {
  if (arcadePaper()) return !escrow.funded;
  try {
    const raw = await solanaRpc("getBalance", [escrow.publicKey]);
    const lamports = typeof raw === "number" ? raw : raw?.value || 0;
    return lamports < 3_000_000;
  } catch {
    return true;
  }
}

async function escrowAtaExists(ctx, escrowAta) {
  if (arcadePaper()) return store().arcadeEscrow?.ataReady === true;
  try {
    const info = await solanaRpc("getAccountInfo", [escrowAta, { encoding: "base64" }]);
    return !!(info?.value || info);
  } catch {
    return false;
  }
}

// --- Transaction builders (versioned tx, device-signed for entries,
// escrow-signed for payouts/refunds). The entry tx is built fresh (not
// decompiled) — the same @solana/web3.js + @solana/spl-token calls the
// Jupiter burn path uses in attachBurnToSwap.
async function buildArcadeTx({ from, to, rawAmount, blockhash, fundLamports }) {
  const { PublicKey, VersionedTransaction, TransactionMessage, SystemProgram } = await import("@solana/web3.js");
  const {
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountIdempotentInstruction,
    createTransferInstruction,
  } = await import("@solana/spl-token");
  const mint = orbitxMint();
  if (!mint) throw new Error("ORBITX_MINT is not set.");
  const fromPk = new PublicKey(from);
  const toPk = new PublicKey(to);
  const mintPk = new PublicKey(mint);
  const fromAta = getAssociatedTokenAddressSync(mintPk, fromPk, false, TOKEN_2022_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mintPk, toPk, false, TOKEN_2022_PROGRAM_ID);
  const instructions = [];
  if (fundLamports > 0) {
    instructions.push(SystemProgram.transfer({ fromPubkey: fromPk, toPubkey: toPk, lamports: fundLamports }));
  }
  // Idempotent: a no-op when the escrow token account already exists.
  instructions.push(createAssociatedTokenAccountIdempotentInstruction(fromPk, toAta, toPk, mintPk, TOKEN_2022_PROGRAM_ID));
  instructions.push(createTransferInstruction(fromAta, toAta, fromPk, BigInt(rawAmount), [], TOKEN_2022_PROGRAM_ID));
  const message = new TransactionMessage({ payerKey: fromPk, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString("base64");
}

// Pay out of the escrow (winner payout / refund). Paper mode moves the
// paper ledger; production signs with the escrow key and broadcasts.
async function sendFromEscrow(ctx, escrow, toAddress, rawAmount) {
  const amount = BigInt(rawAmount);
  if (amount <= 0n) throw new Error("Nothing to pay out.");
  if (arcadePaper()) return paperMove(escrow.publicKey, toAddress, amount);
  if (!escrow.sealed) throw new Error("The arcade escrow is not set up yet. No payout was sent.");
  const secret = openSecret(escrow.sealed);
  try {
    const blockhash = await arcadeBlockhash();
    const unsigned = await buildArcadeTx({ from: escrow.publicKey, to: toAddress, rawAmount: amount, blockhash, fundLamports: 0 });
    const { signedTx, signature } = signVersionedTransaction(unsigned, secret, encode58);
    const sent = await sendSignedTx(signedTx);
    return String(sent || signature);
  } finally {
    secret.fill(0);
  }
}

// --- Game rows (memory + Supabase arcade_games, same pattern as orders).
function gameFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || "",
    joinerId: row.joiner_id || "",
    game: row.game,
    tierUsd: Number(row.tier_usd || 0),
    entryRaw: String(row.entry_raw || "0"),
    status: row.status,
    creatorName: row.creator_name || "",
    creatorPick: row.creator_pick || "",
    creatorAddress: row.creator_address || "",
    joinerName: row.joiner_name || "",
    joinerPick: row.joiner_pick || "",
    joinerAddress: row.joiner_address || "",
    result: row.result || "",
    winnerId: row.winner_id || "",
    winnerName: row.winner_name || "",
    payoutSignature: row.payout_signature || "",
    refundSignature: row.refund_signature || "",
    entrySignature: row.entry_signature || "",
    joinerEntrySignature: row.joiner_entry_signature || "",
    messageHash: row.message_hash || "",
    joinerMessageHash: row.joiner_message_hash || "",
    idempotencyKey: row.idempotency_key || "",
    createdAt: row.created_at || "",
    expiresAt: row.expires_at || "",
    joinExpiresAt: row.join_expires_at || "",
    resolvedAt: row.resolved_at || "",
    error: row.error || "",
    meta: row.meta && typeof row.meta === "object" ? row.meta : {},
  };
}

function gameToRow(game) {
  return {
    id: game.id,
    user_id: game.userId,
    joiner_id: game.joinerId || "",
    game: game.game,
    tier_usd: game.tierUsd,
    entry_raw: String(game.entryRaw || "0"),
    status: game.status,
    creator_name: game.creatorName || "",
    creator_pick: game.creatorPick || "",
    creator_address: game.creatorAddress || "",
    joiner_name: game.joinerName || "",
    joiner_pick: game.joinerPick || "",
    joiner_address: game.joinerAddress || "",
    result: game.result || "",
    winner_id: game.winnerId || "",
    winner_name: game.winnerName || "",
    payout_signature: game.payoutSignature || "",
    refund_signature: game.refundSignature || "",
    entry_signature: game.entrySignature || "",
    joiner_entry_signature: game.joinerEntrySignature || "",
    message_hash: game.messageHash || "",
    joiner_message_hash: game.joinerMessageHash || "",
    idempotency_key: game.idempotencyKey || "",
    created_at: game.createdAt || null,
    expires_at: game.expiresAt || null,
    join_expires_at: game.joinExpiresAt || null,
    resolved_at: game.resolvedAt || null,
    error: game.error || "",
    meta: game.meta || {},
  };
}

async function persistArcadeGame(ctx, game) {
  store().arcadeGames.set(game.id, game);
  const client = ctx?.sb ? ctx.sb() : null;
  if (!client) return;
  const { error } = await client.from("arcade_games").upsert(gameToRow(game));
  if (error && ctx.note) ctx.note(error.message);
}

async function loadArcadeGame(ctx, id) {
  const local = store().arcadeGames.get(String(id));
  if (local) return local;
  const client = ctx?.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("arcade_games").select("*").eq("id", String(id)).maybeSingle();
  if (error || !data) return null;
  const game = gameFromRow(data);
  if (game) store().arcadeGames.set(game.id, game);
  return game;
}

async function loadArcadeGameByKey(ctx, key) {
  for (const game of store().arcadeGames.values()) {
    if (game.idempotencyKey === key) return game;
  }
  const client = ctx?.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("arcade_games").select("*").eq("idempotency_key", key).maybeSingle();
  if (error || !data) return null;
  const game = gameFromRow(data);
  if (game) store().arcadeGames.set(game.id, game);
  return game;
}

function publicArcadeGame(game, dec = 6) {
  if (!game) return null;
  const entryUi = Number(BigInt(game.entryRaw || "0")) / 10 ** dec;
  return {
    id: game.id,
    game: game.game,
    gameName: ARCADE_GAMES[game.game]?.name || game.game,
    tierUsd: game.tierUsd,
    entryUi,
    potUi: entryUi * 2,
    status: game.status,
    creator: { id: game.userId, name: game.creatorName || "Player" },
    creatorPick: game.creatorPick,
    joiner: game.joinerId ? { id: game.joinerId, name: game.joinerName || "Player" } : null,
    joinerPick: game.joinerPick || "",
    result: game.result || "",
    winnerId: game.winnerId || "",
    winnerName: game.winnerName || "",
    payoutSignature: game.payoutSignature || "",
    refundSignature: game.refundSignature || "",
    entrySignature: game.entrySignature || "",
    joinerEntrySignature: game.joinerEntrySignature || "",
    createdAt: game.createdAt || "",
    expiresAt: game.expiresAt || "",
    resolvedAt: game.resolvedAt || "",
    error: game.error || "",
  };
}

function liveGameFor(userId) {
  for (const game of store().arcadeGames.values()) {
    if (!["composed", "open", "join-composed", "playing", "settling"].includes(game.status)) continue;
    if (game.userId === userId || game.joinerId === userId) return game;
  }
  return null;
}

function flipResult(game, ctx) {
  if (ctx?.fixedResult) return String(ctx.fixedResult);
  if (game.game === "diceroll") return String(randomInt(1, 7));
  return randomInt(0, 2) === 0 ? "heads" : "tails";
}

function winnerOf(game, result) {
  if (game.game === "diceroll") {
    const roll = Number(result);
    const side = roll >= 4 ? "high" : "low";
    return side === game.creatorPick ? "creator" : "joiner";
  }
  return result === game.creatorPick ? "creator" : "joiner";
}

// --- Interactive match games (RPS / High Card / Quick Draw) ----------
// Pure resolvers first — exported for tests, no state, no money.

const RPS_BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };

// One RPS round: "creator" | "joiner" | "tie".
export function rpsRoundWinner(creatorPick, joinerPick) {
  if (!RPS_PICKS.includes(creatorPick) || !RPS_PICKS.includes(joinerPick)) return "tie";
  if (creatorPick === joinerPick) return "tie";
  return RPS_BEATS[creatorPick] === joinerPick ? "creator" : "joiner";
}

// Cards are { r: 2..14 (ace high), s: "s"|"h"|"d"|"c" }. Suits NEVER
// break a tie — compare is rank only. Returns 1 / -1 / 0.
export function compareCards(a, b) {
  const ra = Number(a?.r || 0);
  const rb = Number(b?.r || 0);
  if (ra === rb) return 0;
  return ra > rb ? 1 : -1;
}

const CARD_RANKS = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const CARD_SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };
export function cardLabel(card) {
  if (!card) return "?";
  return `${CARD_RANKS[card.r] || card.r}${CARD_SUITS[card.s] || ""}`;
}

// A fresh 52-card deck, Fisher-Yates with crypto randomness. The deck
// lives only in game.meta (server-side) — clients see cards solely
// through the sanitized match view, after a reveal.
export function shuffledDeck() {
  const deck = [];
  for (const s of ["s", "h", "d", "c"]) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// One Quick Draw tap judged by SERVER receipt time: a tap before the
// signal is a false start (loses the round on the spot); a tap at/after
// it is a draw with a server-measured reaction time.
export function quickDrawTap(signalAt, tapAt) {
  const signal = Number(signalAt || 0);
  const tap = Number(tapAt || 0);
  if (!signal || tap < signal) return { falseStart: true, reactionMs: 0 };
  return { falseStart: false, reactionMs: tap - signal };
}

function isInteractiveGame(game) {
  return !!ARCADE_GAMES[game?.game]?.interactive;
}

function matchDeadlineIso(ctx, extraMs = 0) {
  return new Date(arcadeNow(ctx) + ARCADE_MATCH_ACTION_MS + extraMs).toISOString();
}

// Match state lives in game.meta.match — persisted with the row, never
// sent raw to clients (arcadeMatchView is the only way out).
function initArcadeMatch(ctx, game) {
  const now = arcadeNow(ctx);
  const base = {
    round: 1,
    score: { creator: 0, joiner: 0 },
    history: [],
    startedAt: new Date(now).toISOString(),
    deadlineAt: matchDeadlineIso(ctx),
  };
  if (game.game === "rps") {
    game.meta = { ...game.meta, match: { ...base, phase: "pick", picks: {} } };
  } else if (game.game === "highcard") {
    game.meta = { ...game.meta, match: { ...base, phase: "reveal", revealed: {}, redraws: 0, hands: {} } };
    dealHighCards(ctx, game);
  } else if (game.game === "quickdraw") {
    game.meta = { ...game.meta, match: { ...base, phase: "ready", ready: {}, signalAt: 0, taps: {} } };
  }
  return game.meta.match;
}

// Deal a fresh pair for High Card. ctx.fixedDeck (tests only, same
// spirit as ctx.fixedResult) deals from the front of a given deck.
function dealHighCards(ctx, game) {
  const match = game.meta.match;
  const deck = Array.isArray(ctx?.fixedDeck) && ctx.fixedDeck.length >= 2 ? ctx.fixedDeck.slice() : shuffledDeck();
  match.hands = { creator: deck[0], joiner: deck[1] };
  match.revealed = {};
  match.phase = "reveal";
}

// The ONLY client-facing view of a match, built per viewer: your own
// locked pick is yours to see; the opponent's pick/card stays hidden
// until the round resolves into history. Quick Draw's signal time is
// never exposed — only whether it has fired.
export function arcadeMatchView(game, viewerId, now = Date.now()) {
  const match = game?.meta?.match;
  if (!match) return null;
  const over = ["resolved", "refunded"].includes(game.status);
  const isCreator = !!viewerId && viewerId === game.userId;
  const isJoiner = !!viewerId && viewerId === game.joinerId;
  const view = {
    kind: game.game,
    phase: match.phase || "",
    round: match.round || 1,
    score: { creator: match.score?.creator || 0, joiner: match.score?.joiner || 0 },
    history: Array.isArray(match.history) ? match.history : [],
    // Quick Draw's wait-phase deadline is derived from the secret
    // signal time — showing it would hand clients the exact moment to
    // tap. It stays blank until the round is decided.
    deadlineAt: game.game === "quickdraw" && match.phase === "wait" ? "" : match.deadlineAt || "",
    over,
  };
  if (game.game === "rps") {
    const picks = match.picks || {};
    view.myPick = isCreator ? picks.creator || "" : isJoiner ? picks.joiner || "" : "";
    view.oppPicked = isCreator ? !!picks.joiner : isJoiner ? !!picks.creator : false;
  } else if (game.game === "highcard") {
    view.redraws = match.redraws || 0;
    view.myRevealed = isCreator ? !!match.revealed?.creator : isJoiner ? !!match.revealed?.joiner : false;
    view.oppRevealed = isCreator ? !!match.revealed?.joiner : isJoiner ? !!match.revealed?.creator : false;
    // Face-down means face-down: cards appear only in resolved history.
    view.myCard = null;
    view.oppCard = null;
  } else if (game.game === "quickdraw") {
    const ready = match.ready || {};
    view.myReady = isCreator ? !!ready.creator : isJoiner ? !!ready.joiner : false;
    view.oppReady = isCreator ? !!ready.joiner : isJoiner ? !!ready.creator : false;
    view.fired = match.phase === "wait" && !!match.signalAt && now >= match.signalAt;
  }
  return view;
}

// Settle a finished interactive match through the SAME escrow payout
// path as the flip/dice games (sendFromEscrow, full pot, no cut). The
// decision is recorded in meta.settle and the game moves to "settling"
// BEFORE any payment; each completed payment is recorded too, so the
// sweep can retry a half-paid settlement without ever paying a side
// twice. side: "creator" | "joiner" | "split" (split returns each
// entry — used for max-redraw ties and double-stall timeouts).
async function settleArcadeMatch(ctx, game, side, result) {
  if (["resolved", "refunded"].includes(game.status)) return game;
  if (!game.meta.settle) {
    game.meta = { ...game.meta, settle: { side: side || "split", result: result || "", paid: {} } };
    game.status = "settling";
    await persistArcadeGame(ctx, game);
  }
  const decision = game.meta.settle;
  const entryRaw = BigInt(game.entryRaw || "0");
  const payments =
    decision.side === "split"
      ? [
          { key: "creator", to: game.creatorAddress, raw: entryRaw },
          { key: "joiner", to: game.joinerAddress, raw: entryRaw },
        ]
      : [
          {
            key: "winner",
            to: decision.side === "creator" ? game.creatorAddress : game.joinerAddress,
            raw: entryRaw * 2n,
          },
        ];
  try {
    const escrow = await arcadeEscrow(ctx);
    for (const pay of payments) {
      if (decision.paid[pay.key]) continue;
      decision.paid[pay.key] = await sendFromEscrow(ctx, escrow, pay.to, pay.raw);
      await persistArcadeGame(ctx, game);
    }
  } catch (err) {
    // Stays "settling" with the decision + partial payments recorded —
    // the sweep retries and skips anything already paid.
    game.error = `The payout did not send (${err.message || "payout"}). It will retry.`;
    await persistArcadeGame(ctx, game);
    return game;
  }
  game.result = decision.result;
  game.error = "";
  if (decision.side === "split") {
    game.status = "refunded";
    game.refundSignature = decision.paid.creator || "";
    game.meta = { ...game.meta, settle: decision, splitJoinerSignature: decision.paid.joiner || "" };
  } else {
    game.status = "resolved";
    game.winnerId = decision.side === "creator" ? game.userId : game.joinerId;
    game.winnerName = decision.side === "creator" ? game.creatorName : game.joinerName;
    game.payoutSignature = decision.paid.winner || "";
    game.resolvedAt = new Date(arcadeNow(ctx)).toISOString();
  }
  await persistArcadeGame(ctx, game);
  return game;
}

// Which sides have completed the action the current phase waits on.
function matchActedSides(game) {
  const match = game.meta?.match;
  if (!match) return new Set();
  const acted = new Set();
  const mark = (bag) => {
    if (bag?.creator) acted.add("creator");
    if (bag?.joiner) acted.add("joiner");
  };
  if (game.game === "rps" && match.phase === "pick") mark(match.picks);
  else if (game.game === "highcard" && match.phase === "reveal") mark(match.revealed);
  else if (game.game === "quickdraw" && match.phase === "ready") mark(match.ready);
  return acted;
}

// Lazy match upkeep, run from the sweep and before every act: Quick
// Draw rounds nobody tapped in time are voided and replayed; a phase
// stalled past its deadline is a forfeit for the player who never acted
// (or a split refund when NEITHER player acted).
async function arcadeMatchTimeout(ctx, game) {
  if (game.status !== "playing") return game;
  const match = game.meta?.match;
  if (!match) return game;
  const now = arcadeNow(ctx);
  if (game.game === "quickdraw" && match.phase === "wait" && match.signalAt && now > match.signalAt + QD_TAP_WINDOW_MS) {
    match.history = [...(match.history || []), { round: match.round, winner: "", reason: "void" }];
    match.phase = "ready";
    match.ready = {};
    match.signalAt = 0;
    match.taps = {};
    match.deadlineAt = matchDeadlineIso(ctx);
    await persistArcadeGame(ctx, game);
    return game;
  }
  if (match.deadlineAt && now > Date.parse(match.deadlineAt)) {
    const acted = matchActedSides(game);
    if (acted.size === 1) {
      const side = [...acted][0];
      return settleArcadeMatch(ctx, game, side, "forfeit");
    }
    if (acted.size === 0) {
      return settleArcadeMatch(ctx, game, "split", "abandoned");
    }
  }
  return game;
}

// Resolve a fully-paid game: server RNG decides, the escrow pays the
// FULL pot (2x entry) to the winner. Called from join-submit and retried
// by the sweep when a payout fails.
async function resolveArcadeGame(ctx, game) {
  if (game.status !== "ready") return game;
  const result = flipResult(game, ctx);
  const side = winnerOf(game, result);
  const winnerId = side === "creator" ? game.userId : game.joinerId;
  const winnerName = side === "creator" ? game.creatorName : game.joinerName;
  const winnerAddress = side === "creator" ? game.creatorAddress : game.joinerAddress;
  const potRaw = BigInt(game.entryRaw || "0") * 2n;
  game.result = result;
  game.winnerId = winnerId;
  game.winnerName = winnerName;
  try {
    const escrow = await arcadeEscrow(ctx);
    game.payoutSignature = await sendFromEscrow(ctx, escrow, winnerAddress, potRaw);
    game.status = "resolved";
    game.resolvedAt = new Date(arcadeNow(ctx)).toISOString();
    game.error = "";
  } catch (err) {
    // The pot stays in escrow and the game stays "ready" — the next
    // lobby read retries the payout. Nothing is lost, nothing is paid
    // twice: the status only flips to resolved after a payout signature.
    game.error = `The payout did not send (${err.message || "payout"}). It will retry.`;
  }
  await persistArcadeGame(ctx, game);
  return game;
}

async function refundArcadeGame(ctx, game) {
  if (game.status !== "open") return game;
  try {
    const escrow = await arcadeEscrow(ctx);
    game.refundSignature = await sendFromEscrow(ctx, escrow, game.creatorAddress, BigInt(game.entryRaw || "0"));
    game.status = "refunded";
    game.error = "";
  } catch (err) {
    game.error = `The refund did not send (${err.message || "refund"}). It will retry.`;
  }
  await persistArcadeGame(ctx, game);
  return game;
}

// Lazy sweep, run on every lobby/compose/join read — no cron needed:
// expired composes die unpaid, expired opens are refunded, stuck
// ready games retry their payout, abandoned join-composes reopen.
export async function arcadeSweep(ctx) {
  const now = arcadeNow(ctx);
  for (const game of [...store().arcadeGames.values()]) {
    if (game.status === "composed" && game.expiresAt && now > Date.parse(game.expiresAt)) {
      game.status = "expired";
      await persistArcadeGame(ctx, game);
    } else if (game.status === "join-composed" && game.joinExpiresAt && now > Date.parse(game.joinExpiresAt)) {
      game.status = "open";
      game.joinerId = "";
      game.joinerName = "";
      game.joinerPick = "";
      game.joinerAddress = "";
      game.joinerMessageHash = "";
      game.joinExpiresAt = "";
      game.meta = { ...game.meta, joinerUnsignedTx: "" };
      await persistArcadeGame(ctx, game);
    } else if (game.status === "open" && game.expiresAt && now > Date.parse(game.expiresAt)) {
      await refundArcadeGame(ctx, game);
    } else if (game.status === "ready") {
      await resolveArcadeGame(ctx, game);
    } else if (game.status === "settling") {
      // Interactive match whose payout failed mid-settle: the recorded
      // decision is replayed, skipping any side already paid.
      await settleArcadeMatch(ctx, game);
    } else if (game.status === "playing") {
      await arcadeMatchTimeout(ctx, game);
    }
  }
}

export async function arcadeLobby(ctx, player, body) {
  await arcadeSweep(ctx);
  const dec = await decimals();
  const tiers = await arcadeTiers();
  const userId = arcadeUserId(player);
  const address = String(body?.address || "").trim();
  let orbitx = null;
  if (address && b58decode(address)?.length === 32) {
    try {
      orbitx = Number(await orbitxBalanceRaw(ctx, address)) / 10 ** dec;
    } catch {
      orbitx = null;
    }
  }
  const games = [...store().arcadeGames.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const withMatch = (g) => {
    const pub = publicArcadeGame(g, dec);
    const view = arcadeMatchView(g, userId, arcadeNow(ctx));
    if (view) pub.match = view;
    return pub;
  };
  return {
    ok: true,
    you: userId,
    tiers,
    joinTimeoutMs: ARCADE_JOIN_TIMEOUT_MS,
    escrowNote: "Entries go to the arcade escrow. The winner takes the full pot — no house cut.",
    orbitx,
    open: games.filter((g) => g.status === "open").map((g) => publicArcadeGame(g, dec)),
    mine: games.filter((g) => g.userId === userId || g.joinerId === userId).slice(0, 10).map(withMatch),
  };
}

function validArcadeAddress(value) {
  const decoded = b58decode(String(value || "").trim());
  return decoded && decoded.length === 32 ? String(value).trim() : "";
}

// Step 1 (create or join): validate everything, then compose the unsigned
// entry transaction for the device wallet to sign. Nothing moves yet.
export async function arcadeCompose(ctx, player, body) {
  await arcadeSweep(ctx);
  const userId = arcadeUserId(player);
  if (!userId) return fail("Sign in first.");
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return fail("Missing a confirm id. Open the game sheet again.", 400);
  const gameKind = String(body.game || "");
  if (!ARCADE_GAMES[gameKind]) return fail("Pick a game from the Mini-Games Hub.");
  const tierUsd = Number(body.tier);
  if (!ARCADE_TIERS_USD.includes(tierUsd)) return fail("Pick a $1, $2, $5, or $10 game.");
  const address = validArcadeAddress(body.address);
  if (!address) return fail("That on-device wallet address is not valid.", 400);
  if (hitLimit(`arcade:${userId}`, ARCADE_MAX_PER_HOUR, 60 * 60 * 1000)) {
    return fail("Too many arcade games this hour. Wait and try again.", 429);
  }
  const existing = await loadArcadeGameByKey(ctx, idem);
  if (existing) {
    if (existing.status === "composed" && existing.userId === userId && existing.meta.unsignedTx) {
      return { ok: true, game: publicArcadeGame(existing), unsignedTx: existing.meta.unsignedTx, resumed: true };
    }
    if (existing.status === "join-composed" && existing.joinerId === userId && existing.meta.joinerUnsignedTx) {
      return { ok: true, game: publicArcadeGame(existing), unsignedTx: existing.meta.joinerUnsignedTx, resumed: true };
    }
    return { ok: true, game: publicArcadeGame(existing), message: "This game was already started. No second payment was made." };
  }
  const joinId = String(body.joinId || "");
  let entryRaw;
  try {
    entryRaw = await arcadeEntryRaw(tierUsd);
  } catch (err) {
    return fail(err.message || "The ORBITX price could not be read. Nothing was bought.", 502);
  }
  if (entryRaw <= 0n) return fail("That entry could not be priced. Try again in a moment.", 502);
  let balance = 0n;
  try {
    balance = await orbitxBalanceRaw(ctx, address);
  } catch (err) {
    return fail(`The ORBITX balance was not read (${err.message || "RPC"}). Nothing was bought.`, 502);
  }
  if (balance < entryRaw) {
    const dec = await decimals();
    return fail(`Not enough ORBITX in the on-device wallet. This game costs $${tierUsd} (about ${(Number(entryRaw) / 10 ** dec).toLocaleString()} ORBITX).`, 400);
  }
  let game;
  let pick = String(body.pick || "");
  if (joinId) {
    game = await loadArcadeGame(ctx, joinId);
    if (!game) return fail("That game was not found.", 404);
    if (game.status !== "open") return fail("That game is no longer open.", 409);
    if (game.userId === userId) return fail("That is your own game. Wait for an opponent.", 400);
    if (game.game !== gameKind) return fail("That game is a different game. Pick it from the lobby.", 400);
    if (game.tierUsd !== tierUsd) return fail("That game is a different entry. Pick it from the lobby.", 400);
    // The join pays the game's STORED entry, not a fresh price — the pot
    // is exactly 2x one entry even if the ORBITX price moved since the
    // creator opened the game.
    entryRaw = BigInt(game.entryRaw || "0");
    if (entryRaw <= 0n) return fail("That game has no entry. Pick it from the lobby.", 400);
    if (ARCADE_GAMES[game.game]?.interactive) {
      // Interactive match: no side exists to take — both players play
      // their rounds inside the match after both entries land.
      pick = "";
    } else {
      // The joiner always takes the opposite side — the flip then has
      // exactly one winner. A same-side join is refused, never resolved.
      if (!pick) pick = oppositePick(game.game, game.creatorPick);
      if (pick !== oppositePick(game.game, game.creatorPick)) {
        return fail(`That game is ${game.creatorPick} — take the other side.`, 400);
      }
    }
    if (liveGameFor(userId)) return fail("Finish your open game first.", 400);
  } else {
    if (ARCADE_GAMES[gameKind].interactive) {
      pick = "";
    } else if (!ARCADE_GAMES[gameKind].picks.includes(pick)) {
      return fail(`Pick ${ARCADE_GAMES[gameKind].picks.join(" or ")}.`);
    }
    if (liveGameFor(userId)) return fail("Finish your open game first.", 400);
    const now = new Date(arcadeNow(ctx)).toISOString();
    game = {
      id: `arc_${randomBytes(8).toString("hex")}`,
      userId,
      joinerId: "",
      game: gameKind,
      tierUsd,
      entryRaw: entryRaw.toString(),
      status: "composed",
      creatorName: String(player.name || "Player").slice(0, 32),
      creatorPick: pick,
      creatorAddress: address,
      joinerName: "",
      joinerPick: "",
      joinerAddress: "",
      result: "",
      winnerId: "",
      winnerName: "",
      payoutSignature: "",
      refundSignature: "",
      entrySignature: "",
      joinerEntrySignature: "",
      messageHash: "",
      joinerMessageHash: "",
      idempotencyKey: idem,
      createdAt: now,
      expiresAt: new Date(arcadeNow(ctx) + ARCADE_JOIN_TIMEOUT_MS).toISOString(),
      joinExpiresAt: "",
      resolvedAt: "",
      error: "",
      meta: {},
    };
  }
  let escrow;
  try {
    escrow = await arcadeEscrow(ctx);
  } catch (err) {
    return fail(err.message || "The arcade escrow is not set up yet.", 502);
  }
  if (escrow.ephemeral && !arcadePaper()) {
    return fail("The arcade escrow is not set up yet. No entry was taken.", 502);
  }
  let blockhash = "";
  try {
    blockhash = await arcadeBlockhash();
  } catch (err) {
    return fail(`The RPC did not return a blockhash (${err.message || "RPC"}). Nothing was signed.`, 502);
  }
  let fund = 0;
  try {
    if (await escrowNeedsFunding(ctx, escrow)) fund = ARCADE_ESCROW_FUND_LAMPORTS;
  } catch {
    fund = 0;
  }
  let unsignedTx = "";
  try {
    unsignedTx = await buildArcadeTx({ from: address, to: escrow.publicKey, rawAmount: entryRaw, blockhash, fundLamports: fund });
  } catch (err) {
    return fail(`That entry transaction could not be built (${err.message || "build"}). Nothing was signed.`, 502);
  }
  let hash = "";
  try {
    hash = messageHash(versionedMessage(unsignedTx));
  } catch {
    return fail("That entry transaction could not be read.", 400);
  }
  if (joinId) {
    game.joinerId = userId;
    game.joinerName = String(player.name || "Player").slice(0, 32);
    game.joinerPick = pick;
    game.joinerAddress = address;
    game.joinerMessageHash = hash;
    game.joinExpiresAt = new Date(arcadeNow(ctx) + ARCADE_JOIN_COMPOSE_MS).toISOString();
    game.meta = { ...game.meta, joinerUnsignedTx: unsignedTx };
    game.status = "join-composed";
  } else {
    game.messageHash = hash;
    game.meta = { ...game.meta, unsignedTx, fundLamports: fund };
  }
  await persistArcadeGame(ctx, game);
  const dec = await decimals();
  return {
    ok: true,
    game: publicArcadeGame(game, dec),
    unsignedTx,
    entryUi: Number(entryRaw) / 10 ** dec,
    potUi: (Number(entryRaw) * 2) / 10 ** dec,
    fundNote: fund > 0 ? "This first game also funds the escrow with 0.005 SOL for payout fees." : "",
    message: "Sign this transaction with your on-device wallet to put your entry in.",
  };
}

// Step 2: the device signed the composed transaction — verify it is
// EXACTLY this game's transaction, signed by this game's wallet, then
// broadcast it. A valid signature on any other transaction is refused:
// the message hash must match the one recorded at compose time, so a
// substituted transaction can never claim this game's pot.
export async function arcadeSubmit(ctx, player, body) {
  const userId = arcadeUserId(player);
  if (!userId) return fail("Sign in first.");
  const game = await loadArcadeGame(ctx, String(body.gameId || ""));
  if (!game) return fail("That game was not found.", 404);
  const isCreator = game.userId === userId;
  const isJoiner = game.joinerId === userId;
  if (!isCreator && !isJoiner) return fail("That game is not yours.", 403);
  if (isCreator && game.status !== "composed") {
    return { ok: true, game: publicArcadeGame(game), message: "This game does not need another signature." };
  }
  if (isJoiner && game.status !== "join-composed") {
    return { ok: true, game: publicArcadeGame(game), message: "This game does not need another signature." };
  }
  const signedTx = String(body.signedTx || "");
  if (!signedTx) return fail("No signed transaction was sent.", 400);
  const expectedHash = isCreator ? game.messageHash : game.joinerMessageHash;
  const expectedAddress = isCreator ? game.creatorAddress : game.joinerAddress;
  let submittedHash = "";
  try {
    submittedHash = messageHash(versionedMessage(signedTx));
  } catch {
    return fail("That signed transaction could not be read.", 400);
  }
  if (!expectedHash || submittedHash !== expectedHash) {
    return fail("That signature is not for this game. Compose it again.", 400);
  }
  const verified = verifySignedTx(signedTx, expectedAddress);
  if (!verified.ok) return fail(verified.message || "That signature does not verify.", 400);
  let entrySig = "";
  try {
    if (arcadePaper()) {
      const escrow = await arcadeEscrow(ctx);
      entrySig = paperMove(expectedAddress, escrow.publicKey, BigInt(game.entryRaw || "0"));
      if (isCreator && game.meta?.fundLamports > 0) await markEscrowReady(ctx, escrow);
    } else {
      entrySig = await sendSignedTx(signedTx);
      if (isCreator && game.meta?.fundLamports > 0) {
        const escrow = await arcadeEscrow(ctx);
        await markEscrowReady(ctx, escrow);
      }
    }
  } catch (err) {
    return fail(`The entry transaction was not accepted (${err.message || "RPC"}). Nothing was paid.`, 502);
  }
  if (isCreator) {
    game.entrySignature = entrySig || verified.signature || "";
    game.status = "open";
  } else if (isInteractiveGame(game)) {
    // Both entries are in escrow — the match starts now and plays out
    // over arcade-act until settleArcadeMatch pays the pot.
    game.joinerEntrySignature = entrySig || verified.signature || "";
    game.status = "playing";
    initArcadeMatch(ctx, game);
  } else {
    game.joinerEntrySignature = entrySig || verified.signature || "";
    game.status = "ready";
  }
  game.error = "";
  await persistArcadeGame(ctx, game);
  if (game.status === "ready") await resolveArcadeGame(ctx, game);
  const dec = await decimals();
  const done = await loadArcadeGame(ctx, game.id);
  const pub = publicArcadeGame(done || game, dec);
  const view = arcadeMatchView(done || game, userId, arcadeNow(ctx));
  if (view) pub.match = view;
  return {
    ok: true,
    game: pub,
    message:
      done?.status === "resolved"
        ? done.winnerId === userId
          ? `You won the pot — ${(Number(BigInt(done.entryRaw || "0")) * 2) / 10 ** dec} ORBITX is on its way to your wallet.`
          : `${done.winnerName || "Your opponent"} won the pot.`
        : done?.status === "playing"
          ? "You're in — the match is live. Play your rounds in the hub."
          : "Your entry is in. Waiting for an opponent.",
  };
}

// One move inside an interactive match (RPS pick / High Card reveal /
// Quick Draw ready + tap). The server is the only referee: picks and
// cards live in meta.match and reach clients only through the sanitized
// arcadeMatchView; Quick Draw is judged on server receipt time. A move
// that changes nothing (double pick, double ready) is a safe no-op, so
// a retried request can never double-play a round — and no move here
// ever moves money; settlement happens once, in settleArcadeMatch.
export async function arcadeAct(ctx, player, body) {
  const userId = arcadeUserId(player);
  if (!userId) return fail("Sign in first.");
  const game = await loadArcadeGame(ctx, String(body.gameId || ""));
  if (!game) return fail("That game was not found.", 404);
  const isCreator = game.userId === userId;
  const isJoiner = game.joinerId === userId;
  if (!isCreator && !isJoiner) return fail("That game is not yours.", 403);
  if (!isInteractiveGame(game)) return fail("That game plays itself — no moves to make.", 400);
  const dec = await decimals();
  const reply = (message) => {
    const pub = publicArcadeGame(game, dec);
    const view = arcadeMatchView(game, userId, arcadeNow(ctx));
    if (view) pub.match = view;
    return { ok: true, game: pub, message };
  };
  if (game.status === "settling") return reply("The match is decided — the pot is on its way.");
  if (game.status !== "playing") return reply("This match is over.");
  // A stalled phase resolves (forfeit / split / voided round) before
  // this move is judged — nobody acts inside a dead match.
  await arcadeMatchTimeout(ctx, game);
  if (game.status !== "playing") return reply("The match just ended.");
  const match = game.meta.match;
  const side = isCreator ? "creator" : "joiner";
  const other = side === "creator" ? "joiner" : "creator";
  const action = String(body.action || "");
  const value = String(body.value || "");
  const touch = () => {
    match.deadlineAt = matchDeadlineIso(ctx);
  };
  let message = "";

  if (game.game === "rps") {
    if (action !== "pick") return fail("Send a pick: rock, paper, or scissors.", 400);
    if (!RPS_PICKS.includes(value)) return fail("Pick rock, paper, or scissors.", 400);
    if (match.phase !== "pick") return fail("Picks are not open right now.", 409);
    if (match.picks[side]) return reply("Your pick is locked in — picks can't change.");
    match.picks[side] = value;
    touch();
    message = "Pick locked in.";
    if (match.picks.creator && match.picks.joiner) {
      const winner = rpsRoundWinner(match.picks.creator, match.picks.joiner);
      match.history = [
        ...(match.history || []),
        { round: match.round, creatorPick: match.picks.creator, joinerPick: match.picks.joiner, winner },
      ];
      match.picks = {};
      if (winner !== "tie") {
        match.score[winner] += 1;
        match.round += 1;
      }
      if (match.score.creator >= 2 || match.score.joiner >= 2) {
        const winSide = match.score.creator >= 2 ? "creator" : "joiner";
        await settleArcadeMatch(ctx, game, winSide, `${match.score.creator}–${match.score.joiner}`);
        message = "Match over — the pot is settled.";
      } else {
        message = winner === "tie" ? "Tie — replay the round." : "Round scored.";
      }
    }
  } else if (game.game === "highcard") {
    if (action !== "reveal") return fail("Send a reveal.", 400);
    if (match.phase !== "reveal") return fail("Nothing to reveal right now.", 409);
    if (match.revealed[side]) return reply("You're revealed — waiting on your opponent.");
    match.revealed[side] = true;
    touch();
    message = "Revealed.";
    if (match.revealed.creator && match.revealed.joiner) {
      const cmp = compareCards(match.hands.creator, match.hands.joiner);
      if (cmp === 0) {
        match.history = [
          ...(match.history || []),
          { round: match.round, creatorCard: match.hands.creator, joinerCard: match.hands.joiner, winner: "tie", redraw: match.redraws },
        ];
        if (match.redraws >= HIGHCARD_MAX_REDRAWS) {
          await settleArcadeMatch(ctx, game, "split", "split");
          message = "Dead even after every redraw — the pot splits.";
        } else {
          match.redraws += 1;
          match.round += 1;
          dealHighCards(ctx, game);
          message = "Tie — fresh cards dealt.";
        }
      } else {
        const winSide = cmp > 0 ? "creator" : "joiner";
        match.history = [
          ...(match.history || []),
          { round: match.round, creatorCard: match.hands.creator, joinerCard: match.hands.joiner, winner: winSide, redraw: match.redraws },
        ];
        const winCard = winSide === "creator" ? match.hands.creator : match.hands.joiner;
        const loseCard = winSide === "creator" ? match.hands.joiner : match.hands.creator;
        await settleArcadeMatch(ctx, game, winSide, `${cardLabel(winCard)} over ${cardLabel(loseCard)}`);
        message = "Match over — the pot is settled.";
      }
    }
  } else if (game.game === "quickdraw") {
    if (action === "ready") {
      if (match.phase !== "ready") return reply("Already past the ready check.");
      if (match.ready[side]) return reply("You're ready — waiting on your opponent.");
      match.ready[side] = true;
      touch();
      message = "Ready.";
      if (match.ready.creator && match.ready.joiner) {
        match.phase = "wait";
        const pinned = Number(ctx?.qdDelayMs);
        const delay =
          Number.isFinite(pinned) && pinned >= 0 ? pinned : QD_MIN_DELAY_MS + randomInt(0, QD_MAX_DELAY_MS - QD_MIN_DELAY_MS + 1);
        match.signalAt = arcadeNow(ctx) + delay;
        match.taps = {};
        match.deadlineAt = new Date(match.signalAt + QD_TAP_WINDOW_MS + ARCADE_MATCH_ACTION_MS).toISOString();
        message = "Both ready — wait for DRAW…";
      }
    } else if (action === "tap") {
      if (match.phase !== "wait") return reply("No draw is live — ready up first.");
      const outcome = quickDrawTap(match.signalAt, arcadeNow(ctx));
      if (outcome.falseStart) {
        match.history = [...(match.history || []), { round: match.round, winner: other, reason: "false-start", loser: side }];
        match.score[other] += 1;
        message = "False start — tapped before DRAW. The round goes to your opponent.";
      } else {
        match.history = [...(match.history || []), { round: match.round, winner: side, reason: "draw", reactionMs: outcome.reactionMs }];
        match.score[side] += 1;
        message = `Drawn in ${outcome.reactionMs}ms (server-timed).`;
      }
      if (match.score.creator >= 2 || match.score.joiner >= 2) {
        const winSide = match.score.creator >= 2 ? "creator" : "joiner";
        await settleArcadeMatch(ctx, game, winSide, `${match.score.creator}–${match.score.joiner}`);
        message += " Match over — the pot is settled.";
      } else {
        match.round += 1;
        match.phase = "ready";
        match.ready = {};
        match.signalAt = 0;
        match.taps = {};
        touch();
      }
    } else {
      return fail("Send ready or tap.", 400);
    }
  } else {
    return fail("That game has no moves.", 400);
  }

  if (game.status === "playing") await persistArcadeGame(ctx, game);
  return reply(message);
}

export async function arcadeCancel(ctx, player, body) {
  await arcadeSweep(ctx);
  const userId = arcadeUserId(player);
  if (!userId) return fail("Sign in first.");
  const game = await loadArcadeGame(ctx, String(body.gameId || ""));
  if (!game) return fail("That game was not found.", 404);
  if (game.userId !== userId) return fail("Only the player who created the game can cancel it.", 403);
  if (game.status === "composed") {
    game.status = "expired";
    await persistArcadeGame(ctx, game);
    return { ok: true, game: publicArcadeGame(game), message: "Game cancelled. Nothing was paid." };
  }
  if (game.status !== "open") {
    return { ok: true, game: publicArcadeGame(game), message: "This game can no longer be cancelled." };
  }
  await refundArcadeGame(ctx, game);
  return { ok: true, game: publicArcadeGame(game), message: "Game cancelled. Your entry was refunded." };
}

export async function arcadeHistory(ctx, player) {
  const userId = arcadeUserId(player);
  if (!userId) return fail("Sign in first.");
  const dec = await decimals();
  const mine = [...store().arcadeGames.values()]
    .filter((g) => g.userId === userId || g.joinerId === userId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const client = ctx?.sb ? ctx.sb() : null;
  if (client && mine.length === 0) {
    const { data } = await client.from("arcade_games").select("*").or(`user_id.eq.${userId},joiner_id.eq.${userId}`).order("created_at", { ascending: false }).limit(20);
    for (const row of data || []) {
      const game = gameFromRow(row);
      if (game) {
        store().arcadeGames.set(game.id, game);
        mine.push(game);
      }
    }
    mine.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }
  return {
    ok: true,
    you: userId,
    games: mine.slice(0, 20).map((g) => {
      const pub = publicArcadeGame(g, dec);
      // Finished matches are public record: the final view reveals
      // every pick and card so the history reads as a real result.
      const view = arcadeMatchView(g, userId, arcadeNow(ctx));
      if (view) pub.match = view;
      return pub;
    }),
  };
}

export async function arcadeLeaders(ctx, player) {
  const userId = arcadeUserId(player);
  const dec = await decimals();
  const resolved = [...store().arcadeGames.values()].filter((g) => g.status === "resolved");
  const client = ctx?.sb ? ctx.sb() : null;
  if (client && resolved.length === 0) {
    const { data } = await client.from("arcade_games").select("*").eq("status", "resolved").order("resolved_at", { ascending: false }).limit(100);
    for (const row of data || []) {
      const game = gameFromRow(row);
      if (game) store().arcadeGames.set(game.id, game);
    }
  }
  const all = [...store().arcadeGames.values()].filter((g) => g.status === "resolved");
  const byId = new Map();
  for (const game of all) {
    const pot = Number(BigInt(game.entryRaw || "0")) * 2 / 10 ** dec;
    const row = byId.get(game.winnerId) || { id: game.winnerId, name: game.winnerName || "Player", wins: 0, biggest: 0, games: 0 };
    row.wins += 1;
    row.biggest = Math.max(row.biggest, pot);
    byId.set(game.winnerId, row);
    for (const pid of [game.userId, game.joinerId]) {
      const p = byId.get(pid) || { id: pid, name: pid === game.userId ? game.creatorName : game.joinerName, wins: 0, biggest: 0, games: 0 };
      p.games += 1;
      byId.set(pid, p);
    }
  }
  const leaders = [...byId.values()].sort((a, b) => b.wins - a.wins || b.biggest - a.biggest).slice(0, 10);
  return { ok: true, you: userId, leaders, mine: userId ? byId.get(userId) || { id: userId, name: "", wins: 0, biggest: 0, games: 0 } : null };
}
