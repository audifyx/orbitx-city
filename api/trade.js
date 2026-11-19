// Trading Floor — real Solana swaps (SOL <-> any token) via Jupiter.
//
// Same shape as the billboard / arcade flows: the server quotes +
// composes the Jupiter swap, the player's on-device PIN wallet signs it
// ONCE in the browser, the server verifies the signature is for exactly
// this trade and broadcasts it. No per-trade cap beyond the wallet
// itself. A trade is real money — the terminal always shows the quote
// and asks for a confirm before anything is signed.
//
// Flow (client, runtime.ts tradeQuote/tradeExecute):
//   trade-quote   { inputMint, outputMint, amount, slippageBps }
//                 -> { quote } (Jupiter ExactIn, no record)
//   trade-compose { inputMint, outputMint, amount, address,
//                   idempotencyKey, slippageBps }
//                 -> { trade, unsignedTx } (status "composed")
//   trade-submit  { tradeId, signedTx }
//                 -> { trade, signature } (status "submitted")
//   trade-status  { tradeId } -> { trade } (advances to "confirmed")
//   trade-holdings{ address } -> { sol, orbitx, tokens[] }
//
// Trades are stored in Supabase `city_trades` (migrations/city-trades.sql)
// plus an in-memory store, same as ad_orders / arcade_games.

import { randomBytes } from "node:crypto";
import { buildSwap, getQuoteFor, SOL_MINT, versionedMessage } from "./jupiter.js";
import {
  audit,
  getSignatureStatus,
  getTokenAccounts,
  messageHash,
  publicBalance,
  sendSignedTx,
  solanaRpc,
  verifySignedTx,
} from "./wallet.js";
import { b58decode } from "./live.js";

const LAMPORTS_PER_SOL = 1e9;
const TRADE_SLIPPAGE_BPS = 100;
// A trade must be at least this much input (dust swaps fail on Jupiter
// and waste the user's fee). 0.001 SOL / 1000 base units of a token.
const MIN_INPUT_SOL = 0.001;

function store() {
  const slot = globalThis;
  if (!slot.__orbitxTrades) slot.__orbitxTrades = { trades: new Map() };
  if (!slot.__orbitxTrades.trades) slot.__orbitxTrades.trades = new Map();
  return slot.__orbitxTrades;
}

function fail(message, status = 400) {
  return { ok: false, status, message };
}

function validMint(value) {
  const raw = b58decode(String(value || "").trim());
  return raw && raw.length === 32 ? String(value).trim() : "";
}

function newId() {
  return `trade-${randomBytes(8).toString("hex")}`;
}

function publicTrade(trade) {
  return {
    id: trade.id,
    direction: trade.direction,
    inputMint: trade.inputMint,
    outputMint: trade.outputMint,
    inputAmount: trade.inputAmount,
    expectedOut: trade.expectedOut,
    status: trade.status,
    signature: trade.signature || "",
    error: trade.error || "",
    createdAt: trade.createdAt,
    confirmedAt: trade.confirmedAt || "",
  };
}

function tradeToRow(trade) {
  return {
    id: trade.id,
    user_id: trade.userId,
    player_id: trade.playerId || "",
    direction: trade.direction,
    input_mint: trade.inputMint,
    output_mint: trade.outputMint,
    input_amount: String(trade.inputAmount),
    expected_out: String(trade.expectedOut || "0"),
    status: trade.status,
    signature: trade.signature || "",
    idempotency_key: trade.idempotencyKey || "",
    error: trade.error || "",
    meta: trade.meta || {},
  };
}

function tradeFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    playerId: row.player_id || "",
    direction: row.direction,
    inputMint: row.input_mint,
    outputMint: row.output_mint,
    inputAmount: row.input_amount,
    expectedOut: row.expected_out,
    status: row.status,
    signature: row.signature || "",
    idempotencyKey: row.idempotency_key || "",
    error: row.error || "",
    createdAt: row.created_at || "",
    confirmedAt: row.confirmed_at || "",
    meta: row.meta || {},
  };
}

async function persistTrade(ctx, trade) {
  store().trades.set(trade.id, trade);
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return;
  const { error } = await client.from("city_trades").upsert(tradeToRow(trade));
  if (error && ctx.note) ctx.note(error.message);
}

async function loadTrade(ctx, id) {
  const local = store().trades.get(id);
  if (local) return local;
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("city_trades").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const trade = tradeFromRow(data);
  if (trade) store().trades.set(trade.id, trade);
  return trade;
}

async function loadTradeByKey(ctx, key) {
  for (const trade of store().trades.values()) {
    if (trade.idempotencyKey === key) return trade;
  }
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return null;
  const { data, error } = await client.from("city_trades").select("*").eq("idempotency_key", key).maybeSingle();
  if (error) {
    if (ctx.note) ctx.note(error.message);
    return null;
  }
  const trade = tradeFromRow(data);
  if (trade) store().trades.set(trade.id, trade);
  return trade;
}

async function tradesForUser(ctx, userId, limit = 20) {
  const client = ctx.sb ? ctx.sb() : null;
  if (!client) return [...store().trades.values()].filter((t) => t.userId === userId).slice(-limit);
  const { data, error } = await client
    .from("city_trades")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []).map(tradeFromRow).filter(Boolean);
}

// The input balance, so a compose never builds a swap the wallet cannot
// afford. SOL reads the native balance; a token reads its token accounts.
async function inputBalanceRaw(address, inputMint) {
  if (inputMint === SOL_MINT) {
    const raw = await solanaRpc("getBalance", [address]);
    const lamports = typeof raw === "number" ? raw : raw?.value;
    return BigInt(typeof lamports === "number" ? lamports : 0);
  }
  const accounts = await getTokenAccounts(address, inputMint);
  let total = 0n;
  for (const acc of accounts) {
    try {
      total += BigInt(acc.amount || "0");
    } catch {
      // Ignore a malformed account.
    }
  }
  return total;
}

/** Quote only — no record, no signature. Jupiter ExactIn. */
export async function tradeQuote(ctx, player, body) {
  if (!player.authUser) return fail("Sign in to price a trade. Guests keep City Sol only.");
  const inputMint = validMint(body.inputMint);
  const outputMint = validMint(body.outputMint);
  if (!inputMint || !outputMint) return fail("That trade needs two real token addresses.", 400);
  if (inputMint === outputMint) return fail("The input and output tokens are the same.", 400);
  const amount = String(body.amount || "").trim();
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) return fail("The trade amount must be a positive whole number of base units.", 400);
  const slippageBps = Math.max(1, Math.min(1000, Number(body.slippageBps) || TRADE_SLIPPAGE_BPS));
  let quote;
  try {
    quote = await getQuoteFor(inputMint, outputMint, amount, slippageBps);
  } catch (err) {
    return fail(err.message || "Jupiter could not price that trade.", 502);
  }
  const direction = inputMint === SOL_MINT ? "buy" : outputMint === SOL_MINT ? "sell" : "swap";
  return {
    ok: true,
    quote: {
      direction,
      inputMint,
      outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,
      slippageBps,
    },
  };
}

/** Step 1: quote + build the Jupiter swap, store the trade, return the
 * unsigned transaction for the device to sign. Idempotent on the key. */
export async function tradeCompose(ctx, player, body) {
  if (!player.authUser) return fail("Sign in to trade. Guests keep City Sol only.");
  const inputMint = validMint(body.inputMint);
  const outputMint = validMint(body.outputMint);
  if (!inputMint || !outputMint) return fail("That trade needs two real token addresses.", 400);
  if (inputMint === outputMint) return fail("The input and output tokens are the same.", 400);
  const amount = String(body.amount || "").trim();
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) return fail("The trade amount must be a positive whole number of base units.", 400);
  const address = validMint(body.address);
  if (!address) return fail("That on-device wallet address is not valid.", 400);
  const idem = String(body.idempotencyKey || "").slice(0, 80);
  if (!idem) return fail("Missing a confirm id. Open the terminal again.", 400);
  const slippageBps = Math.max(1, Math.min(1000, Number(body.slippageBps) || TRADE_SLIPPAGE_BPS));
  const existing = await loadTradeByKey(ctx, idem);
  if (existing) {
    if (existing.status === "composed" && existing.userId === player.authUser && existing.meta.unsignedTx) {
      return { ok: true, trade: publicTrade(existing), unsignedTx: existing.meta.unsignedTx, resumed: true };
    }
    return { ok: true, trade: publicTrade(existing), message: "This trade was already started. No second swap was made." };
  }
  // Dust guard: a swap under ~0.001 SOL of input fails on Jupiter and
  // wastes the user's fee.
  if (inputMint === SOL_MINT && BigInt(amount) < BigInt(Math.round(MIN_INPUT_SOL * LAMPORTS_PER_SOL))) {
    return fail(`Trade at least ${MIN_INPUT_SOL} SOL — smaller swaps fail on Jupiter.`, 400);
  }
  let balance = 0n;
  try {
    balance = await inputBalanceRaw(address, inputMint);
  } catch (err) {
    return fail(`The wallet balance was not read (${err.message || "RPC"}). Nothing was bought.`, 502);
  }
  if (balance < BigInt(amount)) {
    return fail("Not enough in the on-device wallet for that trade.", 400);
  }
  let quote;
  try {
    quote = await getQuoteFor(inputMint, outputMint, amount, slippageBps);
  } catch (err) {
    return fail(err.message || "Jupiter could not price that trade.", 502);
  }
  let built;
  try {
    built = await buildSwap(quote.quoteResponse, address);
  } catch (err) {
    return fail(err.message || "Jupiter could not build that swap.", 502);
  }
  const direction = inputMint === SOL_MINT ? "buy" : outputMint === SOL_MINT ? "sell" : "swap";
  const trade = {
    id: newId(),
    userId: player.authUser,
    playerId: player.id || "",
    direction,
    inputMint,
    outputMint,
    inputAmount: amount,
    expectedOut: quote.outAmount,
    status: "composed",
    signature: "",
    idempotencyKey: idem,
    error: "",
    createdAt: new Date().toISOString(),
    confirmedAt: "",
    meta: {
      owner: address,
      unsignedTx: built.swapTransaction,
      messageHash: messageHash(versionedMessage(built.swapTransaction)),
      otherAmountThreshold: quote.otherAmountThreshold,
      slippageBps,
    },
  };
  await persistTrade(ctx, trade);
  return {
    ok: true,
    trade: publicTrade(trade),
    unsignedTx: built.swapTransaction,
    message: "Sign this transaction with your on-device wallet to trade.",
  };
}

/** Step 2: the device signed the composed transaction — verify it is
 * EXACTLY this trade's transaction, signed by the trade's wallet, then
 * broadcast it. A valid signature on any other transaction is refused. */
export async function tradeSubmit(ctx, player, body) {
  if (!player.authUser) return fail("Sign in to trade. Guests keep City Sol only.");
  const trade = await loadTrade(ctx, String(body.tradeId || ""));
  if (!trade) return fail("That trade was not found.", 404);
  if (trade.userId !== player.authUser) return fail("That trade is not yours.", 403);
  if (trade.status !== "composed") {
    if (trade.status === "submitted" || trade.status === "confirmed") {
      await advanceTrade(ctx, trade);
      return { ok: true, trade: publicTrade(trade), signature: trade.signature, message: "This trade does not need another signature." };
    }
    return fail("That trade cannot be submitted.", 400);
  }
  const signedTx = String(body.signedTx || "");
  if (!signedTx) return fail("No signed transaction was sent.", 400);
  let submittedHash = "";
  try {
    submittedHash = messageHash(versionedMessage(signedTx));
  } catch {
    return fail("That signed transaction could not be read.", 400);
  }
  if (!trade.meta.messageHash || submittedHash !== trade.meta.messageHash) {
    return fail("That signature is not for this trade. Compose it again.", 400);
  }
  const verified = verifySignedTx(signedTx, trade.meta.owner);
  if (!verified.ok) return fail(verified.message || "That signature does not verify.", 400);
  let sig = "";
  try {
    sig = await sendSignedTx(signedTx);
  } catch (err) {
    trade.status = "swap-failed";
    trade.error = `The transaction was not accepted (${err.message || "RPC"}).`;
    await persistTrade(ctx, trade);
    return fail(trade.error, 502);
  }
  trade.signature = sig || verified.signature;
  trade.status = "submitted";
  trade.error = "";
  await persistTrade(ctx, trade);
  await audit(player.authUser, "trade-swap", `${trade.direction} ${trade.inputAmount} ${trade.inputMint.slice(0, 6)}… -> ${trade.outputMint.slice(0, 6)}… sent (${trade.signature})`);
  return {
    ok: true,
    trade: publicTrade(trade),
    signature: trade.signature,
    message: "Swap sent — the city is watching it confirm.",
  };
}

/** Advance a submitted trade to confirmed once the signature lands. */
export async function advanceTrade(ctx, trade) {
  if (trade.status !== "submitted" || !trade.signature) return trade;
  try {
    const status = await getSignatureStatus(trade.signature);
    const conf = status?.confirmationStatus || status?.confirmations;
    if (conf === "confirmed" || conf === "finalized" || (typeof conf === "number" && conf > 0)) {
      trade.status = "confirmed";
      trade.confirmedAt = new Date().toISOString();
      await persistTrade(ctx, trade);
    }
  } catch {
    // RPC hiccup — the next status check retries.
  }
  return trade;
}

export async function tradeStatus(ctx, player, body) {
  if (!player.authUser) return fail("Sign in to check a trade.");
  const trade = await loadTrade(ctx, String(body.tradeId || ""));
  if (!trade) return fail("That trade was not found.", 404);
  if (trade.userId !== player.authUser) return fail("That trade is not yours.", 403);
  await advanceTrade(ctx, trade);
  return { ok: true, trade: publicTrade(trade) };
}

/** Wallet holdings for the terminal: SOL + ORBITX + every token this
 * account has traded (balances read live from the chain). */
export async function tradeHoldings(ctx, player, body) {
  if (!player.authUser) return fail("Sign in to see holdings.");
  const address = validMint(body.address);
  if (!address) return fail("That on-device wallet address is not valid.", 400);
  let sol = null;
  let orbitx = null;
  try {
    const bal = await publicBalance(address);
    sol = bal.sol;
    orbitx = bal.orbitx;
  } catch {
    // Balances stay null — the terminal says so instead of inventing.
  }
  const tokens = [];
  const seen = new Set([SOL_MINT]);
  try {
    const history = await tradesForUser(ctx, player.authUser, 20);
    for (const t of history) {
      for (const mint of [t.inputMint, t.outputMint]) {
        if (!mint || seen.has(mint)) continue;
        seen.add(mint);
        try {
          const accounts = await getTokenAccounts(address, mint);
          let total = 0n;
          let decimals = 0;
          for (const acc of accounts) {
            total += BigInt(acc.amount || "0");
            decimals = acc.decimals || decimals;
          }
          tokens.push({ mint, amount: total.toString(), decimals, uiAmount: decimals ? Number(total) / 10 ** decimals : Number(total) });
        } catch {
          tokens.push({ mint, amount: "0", decimals: 0, uiAmount: 0 });
        }
      }
    }
  } catch {
    // Trade history is best-effort; SOL + ORBITX still show.
  }
  return { ok: true, address, sol, orbitx, tokens };
}
