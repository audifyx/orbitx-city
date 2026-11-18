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
  getSignatureStatus,
  getTokenAccounts,
  getTransactionMeta,
  messageHash,
  openSecret,
  sendSignedTx,
  signLegacyMessage,
  solanaRpc,
  tokenProgramForMint,
  verifySignedTx,
  walletRow,
} from "./wallet.js";
import { b58decode, b58encode as encode58 } from "./live.js";

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
    slot.__orbitxAds = { orders: new Map(), limits: new Map(), decimals: 0, mintProgram: new Map(), officeLeases: new Map() };
  }
  if (!slot.__orbitxAds.officeLeases) slot.__orbitxAds.officeLeases = new Map();
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
  const accounts = await getTokenAccounts(row.address, orbitxMint());
  let balance = 0n;
  for (const account of accounts || []) {
    const amount = BigInt(account?.amount || "0");
    if (amount > balance) balance = amount;
  }
  return { address: row.address, balance, decimals: dec };
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
      meta: { kind: "orbitx-week", image, owner: row.address },
    };
  } else {
    order.board = board;
    order.project = project;
    order.text = text;
    order.orbitxAmount = amount.toString();
    order.meta = { ...(order.meta || {}), kind: "orbitx-week", image, owner: row.address };
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
