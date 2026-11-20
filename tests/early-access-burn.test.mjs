// Early access in-game burn (no network): the early-access-burn op with
// a mocked RPC and a real (in-memory) in-app wallet — the wallet is
// created through ensureWallet with a pinned master key, and the mock
// chain captures the signed burn transaction so the test can decode the
// exact amount the Burn instruction carries. No real ORBITX, no real
// burn. Note on PIN: the server-signed spend flows this op mirrors
// (billboardOrbitxBuy, wallet-confirm) take NO PIN in the body — the
// PIN belongs to the separate on-device wallet — so the authorization
// gate under test here is the account session (authUser), like verify.
// Run: node --test tests/early-access-burn.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.WALLET_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.ORBITX_USD = "0.0001"; // pinned price: $5 = 50,000 ORBITX

import { TOKEN_INCINERATOR, earlyAccessBurn, earlyAccessStatus } from "../api/ads.js";
import { createSolanaKeypair, ensureWallet, setRpcForTests } from "../api/wallet.js";

const MINT = createSolanaKeypair().publicKey;
process.env.ORBITX_MINT = MINT;
const BLOCKHASH = createSolanaKeypair().publicKey;
const TOKEN_ACCT = createSolanaKeypair().publicKey;
const INC_ACCT = createSolanaKeypair().publicKey;
const BURN_SIG = `sigInGameBurn${"7".repeat(72)}`;
const RECONCILE_SIG = `sigReconciledBurn${"8".repeat(68)}`;
const FRESH = 1795140000; // 2026-11-20T02:00:00Z — after the Nov 20 cutoff

// Mutable mock-chain state, reset per test.
let tokenBalance = "0"; // base units sitting in TOKEN_ACCT
let sentTxs = []; // base64 transactions handed to sendTransaction
let sigList = []; // getSignaturesForAddress result for any address
let txBySig = {}; // getTransaction fixtures by signature

function decimalsAccountInfo() {
  const raw = Buffer.alloc(45);
  raw[44] = 6;
  return { value: { data: [raw.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
}

setRpcForTests(async (method, params) => {
  if (method === "getAccountInfo") return decimalsAccountInfo();
  if (method === "getTokenAccountsByOwner") {
    return { value: [{ pubkey: TOKEN_ACCT, account: { data: { parsed: { info: { tokenAmount: { amount: tokenBalance, decimals: 6 } } } } } }] };
  }
  if (method === "getLatestBlockhash") return { value: { blockhash: BLOCKHASH } };
  if (method === "sendTransaction") {
    sentTxs.push(params[0]);
    return BURN_SIG;
  }
  if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed", err: null }] };
  if (method === "getSignaturesForAddress") return sigList;
  if (method === "getTransaction") return txBySig[params[0]] ?? null;
  return { value: [] };
});

function resetChain({ balance = "0" } = {}) {
  tokenBalance = balance;
  sentTxs = [];
  sigList = [];
  txBySig = {};
}

function makeCtx() {
  const unlocks = [];
  return {
    unlocks,
    ctx: {
      isAdmin: false,
      readEarlyUnlocks: async () => unlocks.map((row) => ({ ...row })),
      saveEarlyUnlock: async (record) => {
        if (unlocks.some((row) => row.signature === record.signature)) return false;
        unlocks.push(record);
        return true;
      },
    },
  };
}

function playerFor(user) {
  return { id: user, name: "Tester", authUser: user, email: "fan@example.com" };
}

// buildTokenBurn's legacy message layout is fixed: sig count + 64-byte
// signature, header, 4 account keys, blockhash, one instruction whose
// data is [8, amount u64 LE] — the amount lands at byte 237 of the
// serialized transaction. Pin it so "exactly $5" is proven, not assumed.
function burnAmountFromTx(b64) {
  const buf = Buffer.from(b64, "base64");
  assert.equal(buf[230], 3, "burn instruction must target the token program (account index 3)");
  assert.equal(buf[236], 8, "instruction must be a token Burn (8)");
  return buf.readBigUInt64LE(237);
}

function incineratorBurnTx({ wallet, amount = "60000000000" }) {
  const bal = (accountIndex, owner, amt) => ({
    accountIndex,
    mint: MINT,
    owner,
    uiTokenAmount: { amount: amt, decimals: 6, uiAmount: Number(amt) / 1e6, uiAmountString: String(Number(amt) / 1e6) },
  });
  return {
    blockTime: FRESH,
    slot: 1,
    meta: {
      err: null,
      preTokenBalances: [bal(1, wallet, amount)],
      postTokenBalances: [bal(1, wallet, "0"), bal(2, TOKEN_INCINERATOR, amount)],
      innerInstructions: [],
    },
    transaction: {
      signatures: [RECONCILE_SIG],
      message: {
        accountKeys: [wallet, TOKEN_ACCT, INC_ACCT].map((pubkey) => ({ pubkey, signer: false, writable: true })),
        instructions: [
          {
            program: "spl-token",
            programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            parsed: {
              type: "transferChecked",
              info: {
                source: TOKEN_ACCT,
                destination: INC_ACCT,
                authority: wallet,
                mint: MINT,
                tokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) },
              },
            },
          },
        ],
      },
    },
  };
}

test("burn: guests are refused — the account session is the authorization gate", async () => {
  resetChain({ balance: "60000000000" });
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessBurn(ctx, { id: "guest-1", name: "Guest", authUser: "" });
  assert.equal(res.ok, false);
  assert.match(res.message, /Create an account/);
  assert.equal(sentTxs.length, 0);
  assert.equal(unlocks.length, 0);
});

test("burn: an account with no in-app wallet fails cleanly", async () => {
  resetChain({ balance: "60000000000" });
  const { ctx } = makeCtx();
  const res = await earlyAccessBurn(ctx, playerFor("user-burn-nowallet"));
  assert.equal(res.ok, false);
  assert.match(res.message, /No in-app wallet yet/);
  assert.equal(sentTxs.length, 0);
});

test("burn: insufficient balance refuses with the shortfall in the message", async () => {
  resetChain({ balance: "10000000000" }); // 10,000 ORBITX — 40,000 short of the 50,000 needed
  const user = "user-burn-poor";
  await ensureWallet(user);
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessBurn(ctx, playerFor(user));
  assert.equal(res.ok, false);
  assert.match(res.message, /50,000 ORBITX/);
  assert.match(res.message, /you have 10,000/);
  assert.match(res.message, /40,000 more ORBITX/);
  assert.equal(sentTxs.length, 0, "nothing may be sent when the balance is short");
  assert.equal(unlocks.length, 0);
});

test("burn: burns exactly $5 of ORBITX from the in-game wallet and records the unlock", async () => {
  resetChain({ balance: "60000000000" }); // 60,000 ORBITX — more than the 50,000 needed
  const user = "user-burn-rich";
  const made = await ensureWallet(user);
  const { ctx, unlocks } = makeCtx();
  const player = playerFor(user);
  const res = await earlyAccessBurn(ctx, player);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.unlocked, true);
  assert.equal(res.amountTokens, 50000, "exactly the $5 amount in whole tokens — the extra 10,000 stays");
  assert.ok(Math.abs(res.usd - 5) < 1e-9, `usd ${res.usd}`);
  assert.equal(res.signature, BURN_SIG);
  assert.equal(sentTxs.length, 1, "exactly one transaction is sent");
  assert.equal(burnAmountFromTx(sentTxs[0]), 50000000000n, "the Burn instruction carries exactly 50,000 ORBITX in base units");
  assert.equal(unlocks.length, 1);
  assert.equal(unlocks[0].accountId, user);
  assert.equal(unlocks[0].wallet, made.publicKey, "the unlock is keyed to the in-game wallet address");
  assert.equal(unlocks[0].signature, BURN_SIG);
  assert.equal(unlocks[0].amountTokens, 50000);
  const status = await earlyAccessStatus(ctx, player, {});
  assert.equal(status.unlocked, true);
});

test("burn: an already-unlocked account short-circuits and never burns again", async () => {
  resetChain({ balance: "60000000000" });
  const user = "user-burn-twice";
  await ensureWallet(user);
  const { ctx, unlocks } = makeCtx();
  const player = playerFor(user);
  const first = await earlyAccessBurn(ctx, player);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(sentTxs.length, 1);
  const second = await earlyAccessBurn(ctx, player);
  assert.equal(second.ok, true);
  assert.equal(second.unlocked, true);
  assert.equal(second.amountTokens, 50000, "the stored record answers, not a new burn");
  assert.equal(sentTxs.length, 1, "no second transaction is sent");
  assert.equal(unlocks.length, 1);
});

test("burn: an unlock recorded by verify short-circuits the burn too", async () => {
  resetChain({ balance: "60000000000" });
  const user = "user-burn-preunlocked";
  const made = await ensureWallet(user);
  const { ctx, unlocks } = makeCtx();
  // A prior unlock (e.g. via early-access-verify) already exists.
  await ctx.saveEarlyUnlock({ accountId: user, wallet: made.publicKey, signature: "sigFromVerify111", amountTokens: 51234, usd: 5.12, at: new Date().toISOString() });
  const res = await earlyAccessBurn(ctx, playerFor(user));
  assert.equal(res.ok, true);
  assert.equal(res.amountTokens, 51234);
  assert.equal(sentTxs.length, 0);
  assert.equal(unlocks.length, 1);
});

test("burn: a confirmed burn already on-chain from this wallet reconciles — no second burn", async () => {
  resetChain({ balance: "0" }); // nothing left to burn: the burn already happened
  const user = "user-burn-retry";
  const made = await ensureWallet(user);
  sigList = [{ signature: RECONCILE_SIG, err: null, confirmationStatus: "confirmed", blockTime: FRESH }];
  txBySig = { [RECONCILE_SIG]: incineratorBurnTx({ wallet: made.publicKey }) };
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessBurn(ctx, playerFor(user));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.unlocked, true);
  assert.equal(res.amountTokens, 60000);
  assert.equal(res.signature, RECONCILE_SIG);
  assert.equal(sentTxs.length, 0, "the retry must not burn a second time");
  assert.equal(unlocks.length, 1);
  assert.equal(unlocks[0].signature, RECONCILE_SIG);
  assert.equal(unlocks[0].wallet, made.publicKey);
});

test("burn: a recent burn from a DIFFERENT wallet does not reconcile", async () => {
  resetChain({ balance: "0" });
  const user = "user-burn-stranger";
  await ensureWallet(user);
  const stranger = createSolanaKeypair().publicKey;
  sigList = [{ signature: RECONCILE_SIG, err: null, confirmationStatus: "confirmed", blockTime: FRESH }];
  txBySig = { [RECONCILE_SIG]: incineratorBurnTx({ wallet: stranger }) };
  const { ctx, unlocks } = makeCtx();
  const res = await earlyAccessBurn(ctx, playerFor(user));
  assert.equal(res.ok, false, "no reconcile, and the empty wallet cannot burn either");
  assert.match(res.message, /Send about 50,000 more ORBITX/);
  assert.equal(sentTxs.length, 0);
  assert.equal(unlocks.length, 0);
});
