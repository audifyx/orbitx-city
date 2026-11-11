// Real billboard ads: pay SOL from the in-app wallet, Jupiter swaps
// SOL -> ORBITX, then the received ORBITX is burned with the Token program's
// Burn instruction (which reduces the mint's supply).
//
// 100% of the payment is buy + burn. OrbitX takes NO fee, NO cut, NO
// treasury — nothing is held anywhere. The UI sells "100% buy + burn" and
// never shows a fee/revenue line.
//
// Price is SOL-denominated (Jupiter has no ExactOut route for this token,
// so an exact-ORBITX price cannot be quoted). The swap buys whatever
// ORBITX the SOL gets, and ALL of it is burned. The amount burned is
// measured from the confirmed swap transaction, never guessed from the quote.
//
// Because Vercel functions are short-lived, the buy is a state machine the
// client polls: ad-buy sends the swap and returns at once; ad-status
// advances swapping -> burning -> live. If the browser closes mid-flow,
// the order resumes on the next visit. A burn that fails after a good swap
// is NEVER silent: the order sits at burn-pending with the swap signature
// on record, and the user retries the burn from the Ads panel.
//
// DEVNET ONLY until the user flips SOLANA_NETWORK. No mainnet code path is
// enabled here — the network comes from wallet.js networkName().

import { buildSwap, getQuote, signVersionedTransaction, orbitxMint } from "./jupiter.js";
import {
  TOKEN_PROGRAM_ID,
  audit,
  buildTokenBurn,
  getSignatureStatus,
  getTokenAccounts,
  getTransactionMeta,
  openSecret,
  sendSignedTx,
  signLegacyMessage,
  solanaRpc,
  tokenProgramForMint,
  walletRow,
} from "./wallet.js";
import { b58encode as encode58 } from "./live.js";

const LAMPORTS_PER_SOL = 1e9;
const DAY_MS = 86400000;

function envNum(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

// Pricing (SOL per duration, whole-board price). Plaza boards pay the premium.
// Proposed defaults — pricing is the user's call. Tune with env vars.
export const AD_SOL_PRICE = {
  1: envNum("AD_PRICE_DAY_SOL", 0.01),
  7: envNum("AD_PRICE_WEEK_SOL", 0.05),
  30: envNum("AD_PRICE_MONTH_SOL", 0.15),
};
export const PLAZA_BOARDS = new Set(["plaza-east", "plaza-west"]);
export const PLAZA_MULT = envNum("AD_PLAZA_MULTIPLIER", 2);
export const AD_SLIPPAGE_BPS = 100;
export const AD_MAX_SOL_LAMPORTS = envNum("AD_MAX_SOL_LAMPORTS", 0.5 * LAMPORTS_PER_SOL);
export const AD_DAILY_SOL_CAP_LAMPORTS = envNum("AD_DAILY_SOL_CAP_LAMPORTS", 1 * LAMPORTS_PER_SOL);
export const AD_BUYS_PER_HOUR = 3;
const FEE_BUFFER_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;

export const AD_BOARDS = ["plaza-east", "plaza-west", "hall-front", "district-row"];

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
    slot.__orbitxAds = { orders: new Map(), limits: new Map(), decimals: 0, mintProgram: new Map() };
  }
  return slot.__orbitxAds;
}

export function priceLamports(board, days) {
  const base = AD_SOL_PRICE[Number(days)];
  if (!base) return 0;
  const mult = PLAZA_BOARDS.has(board) ? PLAZA_MULT : 1;
  return Math.round(base * mult * LAMPORTS_PER_SOL);
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
  if (!AD_BOARDS.includes(board) || !AD_SOL_PRICE[days]) {
    return fail("Pick a billboard and 1, 7, or 30 days.");
  }
  const price = priceLamports(board, days);
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
    priceSol: price / LAMPORTS_PER_SOL,
    priceLamports: price,
    estOrbitx: quote.outAmount,
    estOrbitxUi: (estOrbitx / 10 ** dec).toFixed(0),
    usd: usd ? `~$${(Number(usd) * (estOrbitx / 10 ** dec)).toFixed(2)}` : "",
    endsAt: endStr(days),
    burnNote: "100% buy + burn. No fee, no cut — every ORBITX bought is burned.",
  };
}

// Measure exactly how much ORBITX the swap credited to the buyer.
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
// swapping -> (swap confirmed) -> send burn -> burning
// burning -> (burn confirmed) -> booking + live
// Any burn failure lands on burn-pending with the swap signature kept,
// so the user can retry instead of silently losing the burn.
export async function advanceAdOrder(ctx, order, player) {
  if (order.status === "swapping") {
    const status = await getSignatureStatus(order.swapSignature);
    if (!status) return order;
    if (status === "failed") {
      order.status = "swap-failed";
      order.error = "The swap transaction failed on-chain. No ORBITX was bought and no booking was made.";
      await persistOrder(ctx, order);
      return order;
    }
    const measured = await measureCredited(order);
    if (measured.credited <= 0n) {
      order.status = "burn-pending";
      order.error = "The swap confirmed, but no ORBITX arrived in the wallet to burn. Open the burn retry and it will re-measure.";
      await persistOrder(ctx, order);
      return order;
    }
    order.orbitxAmount = measured.credited.toString();
    order.meta.tokenAccount = measured.tokenAccount;
    try {
      const burnSig = await sendBurn(ctx, order);
      order.burnSignature = burnSig;
      order.status = "burning";
      order.error = "";
    } catch (err) {
      order.status = "burn-pending";
      order.error = `The swap bought ORBITX but the burn did not send (${err.message || "burn"}). Your ORBITX is still in your wallet — retry the burn.`;
    }
    await persistOrder(ctx, order);
    return order;
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

export async function adBuy(ctx, player, body) {
  if (!player.authUser) return fail("Create an account to book a billboard. Guests keep City Sol only.");
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return fail("Missing a confirm id. Open the billboard sheet again.", 400);
  const existing = await loadOrderByKey(ctx, idem);
  if (existing) {
    if (existing.status === "swapping" || existing.status === "burning") await advanceAdOrder(ctx, existing, player);
    return { ok: true, order: publicOrder(existing), message: "This booking was already started. No second payment was made." };
  }
  const board = String(body.board || body.id || "").slice(0, 40);
  const days = Number(body.days);
  if (!AD_BOARDS.includes(board) || !AD_SOL_PRICE[days]) {
    return fail("Pick a billboard and 1, 7, or 30 days.");
  }
  const project = String(body.project || player.name || "").slice(0, 32);
  const text = String(body.text || "").slice(0, 32);
  const hit = denied(project, text);
  if (hit) return fail(`That text is not allowed on a billboard ("${hit}").`);
  const taken = await boardAvailability(ctx, board, player.id);
  if (taken) return fail(`${taken.takenBy} has ${board} until ${taken.end}. Pick another board.`);
  if (hitLimit(`adbuy:${player.authUser}`, AD_BUYS_PER_HOUR, 60 * 60 * 1000)) {
    return fail("Too many billboard buys this hour. Wait and try again.", 429);
  }
  const price = priceLamports(board, days);
  if (price > AD_MAX_SOL_LAMPORTS) {
    return fail(`That booking is over the ${AD_MAX_SOL_LAMPORTS / LAMPORTS_PER_SOL} SOL per-buy cap.`);
  }
  if (adSpendToday(player.authUser) + price > AD_DAILY_SOL_CAP_LAMPORTS) {
    return fail("That booking is over the daily ad cap.", 400);
  }
  const row = await walletRow(player.authUser);
  if (!row) return fail("This account has no in-app wallet yet.");
  const owner = row.public_key;
  let balance = 0;
  try {
    const raw = await solanaRpc("getBalance", [owner]);
    balance = typeof raw === "number" ? raw : raw?.value || 0;
  } catch (err) {
    return fail(`The SOL balance was not read (${err.message || "RPC"}). Nothing was bought.`, 502);
  }
  if (balance < price + FEE_BUFFER_LAMPORTS) {
    return fail(`Not enough SOL in the in-app wallet. This board costs ${price / LAMPORTS_PER_SOL} SOL plus a small fee buffer.`);
  }
  let preBalances = {};
  try {
    const before = await getTokenAccounts(owner, orbitxMint());
    preBalances = Object.fromEntries(before.map((item) => [item.pubkey, item.amount]));
  } catch {
    preBalances = {};
  }
  const now = new Date().toISOString();
  const order = {
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
  await persistOrder(ctx, order);
  let quote;
  try {
    quote = await getQuote(price);
  } catch (err) {
    order.status = "swap-failed";
    order.error = err.message || "The quote failed.";
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  let swap;
  try {
    swap = await buildSwap(quote.quoteResponse, owner);
  } catch (err) {
    order.status = "swap-failed";
    order.error = err.message || "The swap could not be built.";
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  let signed;
  try {
    const secret = openSecret(row);
    try {
      signed = signVersionedTransaction(swap.swapTransaction, secret, encode58);
    } finally {
      secret.fill(0);
    }
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The swap could not be signed (${err.message || "signing"}).`;
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  let swapSig = "";
  try {
    swapSig = await sendSignedTx(signed.signedTx);
  } catch (err) {
    order.status = "swap-failed";
    order.error = `The swap was not accepted (${err.message || "RPC"}).`;
    await persistOrder(ctx, order);
    return fail(order.error, 502);
  }
  order.swapSignature = swapSig || signed.signature;
  order.status = "swapping";
  await persistOrder(ctx, order);
  await audit(player.authUser, "ad-swap", `${board} ${days}d swap sent (${price / LAMPORTS_PER_SOL} SOL)`);
  return {
    ok: true,
    order: publicOrder(order),
    message: `Swap sent for ${board}. The city is watching it confirm, then it burns the ORBITX.`,
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
