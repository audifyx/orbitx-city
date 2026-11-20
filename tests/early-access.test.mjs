// Early access burn gate (no network): the pure burn parser against
// hand-built jsonParsed transactions, plus the status/verify ops with a
// mocked RPC and in-memory unlock storage. No real ORBITX, no real burn.
// Run: node --test tests/early-access.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.ORBITX_USD = "0.0001"; // pinned price: $5 = 50,000 ORBITX

import {
  EARLY_ACCESS_GATE_END_MS,
  EARLY_ACCESS_USD_REQUIRED,
  TOKEN_INCINERATOR,
  earlyAccessStatus,
  earlyAccessVerify,
  orbitxBurnUsdValue,
  parseOrbitxBurn,
} from "../api/ads.js";
import { createSolanaKeypair, setRpcForTests } from "../api/wallet.js";

const MINT = createSolanaKeypair().publicKey;
process.env.ORBITX_MINT = MINT;
const OTHER_MINT = createSolanaKeypair().publicKey;
const WALLET = createSolanaKeypair().publicKey;
const OTHER = createSolanaKeypair().publicKey;
const ACCT_A = createSolanaKeypair().publicKey; // WALLET's ORBITX account
const ACCT_B = createSolanaKeypair().publicKey; // OTHER's ORBITX account
const ACCT_INC = createSolanaKeypair().publicKey; // incinerator's token account
const KEYS = [WALLET, OTHER, ACCT_A, ACCT_B, ACCT_INC];
const IDX = { WALLET: 0, OTHER: 1, A: 2, B: 3, INC: 4 };

const FRESH = 1795140000; // 2026-11-20T02:00:00Z — after the Nov 20 cutoff
const OLD = 1795000000; // 2026-11-18 — before the Nov 20, 2026 cutoff
const TOKENS_60K = "60000000000"; // 60,000 tokens at 6 decimals = $6.00
const TOKENS_40K = "40000000000"; // 40,000 tokens = $4.00 (too small)

function bal(accountIndex, owner, { mint = MINT, amount = TOKENS_60K, decimals = 6 } = {}) {
  return {
    accountIndex,
    mint,
    owner,
    uiTokenAmount: {
      amount: String(amount),
      decimals,
      uiAmount: Number(amount) / 10 ** decimals,
      uiAmountString: String(Number(amount) / 10 ** decimals),
    },
  };
}

function makeTx({ instructions = [], inner = [], pre = [], post = [], blockTime = FRESH, err = null } = {}) {
  return {
    blockTime,
    slot: 1,
    meta: {
      err,
      fee: 5000,
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: inner.length ? [{ index: 0, instructions: inner }] : [],
    },
    transaction: {
      signatures: ["fakesig"],
      message: {
        accountKeys: KEYS.map((pubkey) => ({ pubkey, signer: false, writable: true })),
        instructions,
      },
    },
  };
}

function burnCheckedIx(account, authority, { amount = TOKENS_60K, mint = MINT, program = "spl-token-2022" } = {}) {
  return {
    program,
    programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    parsed: {
      type: "burnChecked",
      info: {
        account,
        authority,
        mint,
        tokenAmount: { amount: String(amount), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
      },
    },
  };
}

function transferCheckedIx(source, destination, authority, { amount = TOKENS_60K, mint = MINT } = {}) {
  return {
    program: "spl-token",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    parsed: {
      type: "transferChecked",
      info: {
        source,
        destination,
        authority,
        mint,
        tokenAmount: { amount: String(amount), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
      },
    },
  };
}

// --- Fixture transactions -------------------------------------------------
const txTransferBurn = makeTx({
  instructions: [transferCheckedIx(ACCT_A, ACCT_INC, WALLET)],
  pre: [bal(IDX.A, WALLET)],
  post: [bal(IDX.A, WALLET, { amount: "0" }), bal(IDX.INC, TOKEN_INCINERATOR)],
});
const txInnerBurn = makeTx({
  instructions: [
    {
      program: "system",
      programId: "11111111111111111111111111111111",
      parsed: { type: "transfer", info: { source: WALLET, destination: OTHER, lamports: 1000 } },
    },
  ],
  inner: [burnCheckedIx(ACCT_A, WALLET)],
  pre: [bal(IDX.A, WALLET)],
  post: [bal(IDX.A, WALLET, { amount: "0" })],
});
const txSmallBurn = makeTx({
  instructions: [transferCheckedIx(ACCT_A, ACCT_INC, WALLET, { amount: TOKENS_40K })],
  pre: [bal(IDX.A, WALLET)],
  post: [bal(IDX.INC, TOKEN_INCINERATOR, { amount: TOKENS_40K })],
});
const txOldBurn = makeTx({
  instructions: [transferCheckedIx(ACCT_A, ACCT_INC, WALLET)],
  pre: [bal(IDX.A, WALLET)],
  post: [bal(IDX.INC, TOKEN_INCINERATOR)],
  blockTime: OLD,
});

// --- Parser: the six required cases ----------------------------------------

test("parser: a transfer of ORBITX to the incinerator counts as a burn", () => {
  const parsed = parseOrbitxBurn(txTransferBurn, WALLET, MINT);
  assert.ok(parsed, "expected a parsed burn");
  assert.equal(parsed.amountBase, 60000000000n);
  assert.equal(parsed.decimals, 6);
});

test("parser: a top-level burnChecked instruction counts", () => {
  const tx = makeTx({
    instructions: [burnCheckedIx(ACCT_A, WALLET)],
    pre: [bal(IDX.A, WALLET)],
    post: [bal(IDX.A, WALLET, { amount: "0" })],
  });
  const parsed = parseOrbitxBurn(tx, WALLET, MINT);
  assert.ok(parsed);
  assert.equal(parsed.amountBase, 60000000000n);
});

test("parser: a plain burn instruction counts (mint/decimals from the balance table)", () => {
  const tx = makeTx({
    instructions: [
      {
        program: "spl-token-2022",
        programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        parsed: { type: "burn", info: { account: ACCT_A, authority: WALLET, amount: TOKENS_60K } },
      },
    ],
    pre: [bal(IDX.A, WALLET)],
    post: [bal(IDX.A, WALLET, { amount: "0" })],
  });
  const parsed = parseOrbitxBurn(tx, WALLET, MINT);
  assert.ok(parsed);
  assert.equal(parsed.amountBase, 60000000000n);
  assert.equal(parsed.decimals, 6);
});

test("parser: an inner burn instruction counts", () => {
  const parsed = parseOrbitxBurn(txInnerBurn, WALLET, MINT);
  assert.ok(parsed);
  assert.equal(parsed.amountBase, 60000000000n);
});

test("parser: a burn from a different wallet is rejected", () => {
  const tx = makeTx({
    instructions: [burnCheckedIx(ACCT_B, OTHER)],
    pre: [bal(IDX.B, OTHER)],
    post: [bal(IDX.B, OTHER, { amount: "0" })],
  });
  assert.equal(parseOrbitxBurn(tx, WALLET, MINT), null);
  // ...and the same tx DOES count for the wallet that actually burned.
  assert.ok(parseOrbitxBurn(tx, OTHER, MINT));
});

test("parser: a burn of a different mint is rejected", () => {
  const tx = makeTx({
    instructions: [burnCheckedIx(ACCT_A, WALLET, { mint: OTHER_MINT })],
    pre: [bal(IDX.A, WALLET, { mint: OTHER_MINT })],
    post: [bal(IDX.A, WALLET, { mint: OTHER_MINT, amount: "0" })],
  });
  assert.equal(parseOrbitxBurn(tx, WALLET, MINT), null);
});

test("parser: a plain wallet-to-wallet transfer is not a burn", () => {
  const tx = makeTx({
    instructions: [transferCheckedIx(ACCT_A, ACCT_B, WALLET)],
    pre: [bal(IDX.A, WALLET)],
    post: [bal(IDX.B, OTHER)],
  });
  assert.equal(parseOrbitxBurn(tx, WALLET, MINT), null);
});

test("parser: a failed transaction burns nothing", () => {
  const tx = makeTx({
    instructions: [burnCheckedIx(ACCT_A, WALLET)],
    pre: [bal(IDX.A, WALLET)],
    err: { InstructionError: [0, "Custom"] },
  });
  assert.equal(parseOrbitxBurn(tx, WALLET, MINT), null);
});

test("value helper: base units x price, with a dead price worth zero", () => {
  assert.ok(Math.abs(orbitxBurnUsdValue(60000000000n, 6, 0.0001) - 6) < 1e-9);
  assert.equal(orbitxBurnUsdValue(60000000000n, 6, 0), 0);
  assert.equal(orbitxBurnUsdValue(60000000000n, 6, ""), 0);
});

// --- Ops --------------------------------------------------------------------

// Real signatures are ~88 base58 chars; the fixtures use padded stand-ins
// so the op's signature shape check treats them like real ones.
const SIG_TRANSFER = `sigTransferBurn${"1".repeat(64)}`;
const SIG_INNER = `sigInnerBurn${"2".repeat(64)}`;
const SIG_SMALL = `sigSmallBurn${"3".repeat(64)}`;
const SIG_OLD = `sigOldBurn${"4".repeat(64)}`;

const TX_BY_SIG = {
  [SIG_TRANSFER]: txTransferBurn,
  [SIG_INNER]: txInnerBurn,
  [SIG_SMALL]: txSmallBurn,
  [SIG_OLD]: txOldBurn,
};

function decimalsAccountInfo() {
  const raw = Buffer.alloc(45);
  raw[44] = 6;
  return { value: { data: [raw.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
}

setRpcForTests(async (method, params) => {
  if (method === "getTransaction") return TX_BY_SIG[params[0]] ?? null;
  if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed", err: null }] };
  if (method === "getAccountInfo") return decimalsAccountInfo();
  return { value: [] };
});

function makeCtx({ isAdmin = false } = {}) {
  const unlocks = [];
  return {
    unlocks,
    ctx: {
      isAdmin,
      readEarlyUnlocks: async () => unlocks.map((row) => ({ ...row })),
      saveEarlyUnlock: async (record) => {
        if (unlocks.some((row) => row.signature === record.signature)) return false;
        unlocks.push(record);
        return true;
      },
    },
  };
}

const PLAYER = { id: "acct-1", name: "Tester", authUser: "acct-1", email: "fan@example.com" };
const PLAYER2 = { id: "acct-2", name: "Second", authUser: "acct-2", email: "two@example.com" };
const GUEST = { id: "guest-1", name: "Guest", authUser: "" };

test("status: gate shape at the pinned price, locked before any burn", async () => {
  const { ctx } = makeCtx();
  const res = await earlyAccessStatus(ctx, PLAYER, {});
  assert.equal(res.ok, true);
  assert.equal(res.gate.usdRequired, EARLY_ACCESS_USD_REQUIRED);
  assert.equal(res.gate.usdRequired, 5);
  assert.equal(res.gate.priceUsd, "0.0001");
  assert.equal(res.gate.tokensApprox, 50000);
  assert.equal(res.gate.active, Date.now() < EARLY_ACCESS_GATE_END_MS);
  assert.equal(res.unlocked, false);
});

test("verify: a $6 incinerator burn unlocks, and status then reads unlocked", async () => {
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_TRANSFER });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.unlocked, true);
  assert.equal(res.amountTokens, 60000);
  assert.ok(Math.abs(res.usd - 6) < 1e-6, `usd ${res.usd}`);
  assert.equal(unlocks.length, 1);
  assert.equal(unlocks[0].accountId, "acct-1");
  assert.equal(unlocks[0].wallet, WALLET);
  assert.equal(unlocks[0].signature, SIG_TRANSFER);
  const status = await earlyAccessStatus(ctx, PLAYER, {});
  assert.equal(status.unlocked, true);
});

test("verify: an inner-instruction burn unlocks too", async () => {
  const { ctx } = makeCtx();
  const res = await earlyAccessVerify(ctx, PLAYER2, { wallet: WALLET, signature: SIG_INNER });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.unlocked, true);
  assert.equal(res.amountTokens, 60000);
});

test("verify: one burn unlocks one account — a second account reusing it fails", async () => {
  const { ctx, unlocks } = makeCtx();
  const first = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_TRANSFER });
  assert.equal(first.ok, true);
  const second = await earlyAccessVerify(ctx, PLAYER2, { wallet: WALLET, signature: SIG_TRANSFER });
  assert.equal(second.ok, false);
  assert.match(second.message, /already used/);
  assert.equal(unlocks.length, 1);
});

test("verify: an already-unlocked account does not consume a second burn", async () => {
  const { ctx, unlocks } = makeCtx();
  await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_TRANSFER });
  const again = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_INNER });
  assert.equal(again.ok, true);
  assert.equal(again.unlocked, true);
  assert.equal(again.amountTokens, 60000);
  assert.equal(unlocks.length, 1);
});

test("verify: a burn under $5 is refused with the shortfall in the message", async () => {
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_SMALL });
  assert.equal(res.ok, false);
  assert.match(res.message, /\$4\.00/);
  assert.match(res.message, /\$5\.00/);
  assert.equal(unlocks.length, 0);
});

test("verify: a burn from before Nov 20, 2026 is refused", async () => {
  const { ctx } = makeCtx();
  const res = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: SIG_OLD });
  assert.equal(res.ok, false);
  assert.match(res.message, /before Nov 20, 2026/);
});

test("verify: a burn from a different wallet than the one pasted is refused", async () => {
  const { ctx } = makeCtx();
  const res = await earlyAccessVerify(ctx, PLAYER, { wallet: OTHER, signature: SIG_TRANSFER });
  assert.equal(res.ok, false);
  assert.match(res.message, /No ORBITX burn from that wallet/);
});

test("verify: guests cannot unlock, and an unknown signature is a clean failure", async () => {
  const { ctx } = makeCtx();
  const guest = await earlyAccessVerify(ctx, GUEST, { wallet: WALLET, signature: SIG_TRANSFER });
  assert.equal(guest.ok, false);
  assert.match(guest.message, /Create an account/);
  const missing = await earlyAccessVerify(ctx, PLAYER, { wallet: WALLET, signature: "sig-not-on-chain-yet-1111111111111111" });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /was not found/);
});

test("status: the admin account is always unlocked", async () => {
  const { ctx } = makeCtx({ isAdmin: true });
  const res = await earlyAccessStatus(ctx, PLAYER, {});
  assert.equal(res.unlocked, true);
});
