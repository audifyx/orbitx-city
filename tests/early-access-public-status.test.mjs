// Early access status, pre-session (no network): the status op must
// answer WITHOUT a session — the title screen asks on a fresh visit,
// before the client ever calls the session op — while verify and burn
// stay behind the player gate. POST-level, mocked RPC and in-memory
// stores, mirroring tests/city-stats.test.mjs. The burn fixture is the
// transfer-to-incinerator shape from tests/early-access.test.mjs.
// Run: node --test tests/early-access-public-status.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.ORBITX_USD = "0.0001"; // pinned price: $5 = 50,000 ORBITX

import { POST } from "../api/city.js";
import {
  EARLY_ACCESS_GATE_END_MS,
  TOKEN_INCINERATOR,
  earlyAccessStatus,
} from "../api/ads.js";
import { createSolanaKeypair, setRpcForTests } from "../api/wallet.js";

const MINT = createSolanaKeypair().publicKey;
process.env.ORBITX_MINT = MINT;
const WALLET = createSolanaKeypair().publicKey;
const ACCT_A = createSolanaKeypair().publicKey; // WALLET's ORBITX account
const ACCT_INC = createSolanaKeypair().publicKey; // incinerator's token account
const KEYS = [WALLET, ACCT_A, ACCT_INC];
const FRESH = 1795140000; // 2026-11-20T02:00:00Z — after the Nov 20 cutoff
const SIG_BURN = `sigPublicBurn${"5".repeat(64)}`;

function bal(accountIndex, owner, amount = "60000000000") {
  return {
    accountIndex,
    mint: MINT,
    owner,
    uiTokenAmount: {
      amount: String(amount),
      decimals: 6,
      uiAmount: Number(amount) / 1e6,
      uiAmountString: String(Number(amount) / 1e6),
    },
  };
}

const txTransferBurn = {
  blockTime: FRESH,
  slot: 1,
  meta: {
    err: null,
    fee: 5000,
    preTokenBalances: [bal(1, WALLET)],
    postTokenBalances: [bal(1, WALLET, "0"), bal(2, TOKEN_INCINERATOR)],
    innerInstructions: [],
  },
  transaction: {
    signatures: [SIG_BURN],
    message: {
      accountKeys: KEYS.map((pubkey) => ({ pubkey, signer: false, writable: true })),
      instructions: [
        {
          program: "spl-token",
          programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          parsed: {
            type: "transferChecked",
            info: {
              source: ACCT_A,
              destination: ACCT_INC,
              authority: WALLET,
              mint: MINT,
              tokenAmount: { amount: "60000000000", decimals: 6, uiAmount: 60000, uiAmountString: "60000" },
            },
          },
        },
      ],
    },
  },
};

function decimalsAccountInfo() {
  const raw = Buffer.alloc(45);
  raw[44] = 6;
  return { value: { data: [raw.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
}

setRpcForTests(async (method, params) => {
  if (method === "getTransaction") return params[0] === SIG_BURN ? txTransferBurn : null;
  if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed", err: null }] };
  if (method === "getAccountInfo") return decimalsAccountInfo();
  return { value: [] };
});

// --- POST plumbing (mirrors tests/city-stats.test.mjs) ----------------------

function req(op, body = {}, token = "") {
  return new Request("http://local/api/city", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ op, ...body }),
  });
}

async function call(op, body, token) {
  const res = await POST(req(op, body, token));
  const data = await res.json();
  return { status: res.status, data };
}

async function signup(email) {
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  assert.equal(signed.data.ok, true, `signup failed for ${email}: ${JSON.stringify(signed.data)}`);
  return signed.data.token;
}

function assertGateShape(data) {
  assert.equal(data.ok, true);
  assert.equal(data.gate.usdRequired, 5);
  assert.equal(data.gate.priceUsd, "0.0001");
  assert.equal(data.gate.tokensApprox, 50000);
  assert.equal(data.gate.active, Date.now() < EARLY_ACCESS_GATE_END_MS);
  // eaReply shape: exact payload, no `me` mixed in.
  assert.equal(data.me, undefined);
}

// --- Op level: the null-player public answer --------------------------------

test("status op: a null player gets the public answer, never an unlock", async () => {
  const anon = await earlyAccessStatus({ isAdmin: false, readEarlyUnlocks: async () => [] }, null);
  assert.equal(anon.ok, true);
  assert.equal(anon.gate.usdRequired, 5);
  assert.equal(anon.gate.priceUsd, "0.0001");
  assert.equal(anon.gate.tokensApprox, 50000);
  assert.equal(anon.unlocked, false);
  // Even an admin-flavored ctx does not unlock an unresolved caller.
  const adminCtx = await earlyAccessStatus({ isAdmin: true, readEarlyUnlocks: async () => [] }, null);
  assert.equal(adminCtx.unlocked, false);
});

// --- POST level: pre-session answers -----------------------------------------

test("status POST: no token at all -> 200 public answer (never 401)", async () => {
  const res = await call("early-access-status", {});
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assertGateShape(res.data);
  assert.equal(res.data.unlocked, false);
});

test("status POST: garbage tokens -> the same public answer (never 401)", async () => {
  const plain = await call("early-access-status", {}, "definitely-not-a-token");
  assert.equal(plain.status, 200, JSON.stringify(plain.data));
  assertGateShape(plain.data);
  assert.equal(plain.data.unlocked, false);
  // Account-shaped but unverifiable (bad mock signature -> no account).
  const mockShaped = await call("early-access-status", {}, "mock.garbage.signature");
  assert.equal(mockShaped.status, 200, JSON.stringify(mockShaped.data));
  assertGateShape(mockShaped.data);
  assert.equal(mockShaped.data.unlocked, false);
});

test("status POST: a guest session player resolves and stays locked", async () => {
  const guest = await call("session", { name: "Gate Guest" });
  assert.equal(guest.data.ok, true);
  const res = await call("early-access-status", {}, guest.data.token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assertGateShape(res.data);
  assert.equal(res.data.unlocked, false);
});

test("status POST: an unlocked account reads unlocked:true, before and after the burn", async () => {
  const token = await signup("gatefan@example.com");
  const session = await call("session", {}, token);
  assert.equal(session.data.ok, true);
  const before = await call("early-access-status", {}, token);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assertGateShape(before.data);
  assert.equal(before.data.unlocked, false);
  const verify = await call("early-access-verify", { wallet: WALLET, signature: SIG_BURN }, token);
  assert.equal(verify.data.ok, true, JSON.stringify(verify.data));
  assert.equal(verify.data.unlocked, true);
  const after = await call("early-access-status", {}, token);
  assert.equal(after.status, 200, JSON.stringify(after.data));
  assertGateShape(after.data);
  assert.equal(after.data.unlocked, true);
});

test("status POST: the admin account is unlocked", async () => {
  const token = await signup("audifyx@gmail.com");
  const session = await call("session", {}, token);
  assert.equal(session.data.ok, true);
  const res = await call("early-access-status", {}, token);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assertGateShape(res.data);
  assert.equal(res.data.unlocked, true);
});

// --- POST level: verify and burn stay behind the gate ------------------------

test("verify/burn POST: no session is still refused at the player gate", async () => {
  const verify = await call("early-access-verify", { wallet: WALLET, signature: SIG_BURN });
  assert.equal(verify.status, 401);
  assert.equal(verify.data.ok, false);
  assert.match(verify.data.message, /Sign in first/);
  const burn = await call("early-access-burn", {});
  assert.equal(burn.status, 401);
  assert.equal(burn.data.ok, false);
  assert.match(burn.data.message, /Sign in first/);
});

test("burn POST: a guest session is still refused by the op itself", async () => {
  const guest = await call("session", { name: "Gate Guest Two" });
  assert.equal(guest.data.ok, true);
  const burn = await call("early-access-burn", {}, guest.data.token);
  assert.equal(burn.data.ok, false);
  assert.match(burn.data.message, /Create an account/);
});
