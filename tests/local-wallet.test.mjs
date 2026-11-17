// On-device wallet tests: the device holds the key, the server only
// verifies + broadcasts. Covers wallet-balance / wallet-blockhash /
// wallet-submit (relay) and the ad-compose -> device-sign -> ad-submit
// -> live billboard flow, all with mocked RPC + mocked Jupiter — no
// network, no real SOL, no real burn.
import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { POST } from "../api/city.js";
import { setJupiterFetch } from "../api/jupiter.js";
import { b58encode } from "../api/live.js";
import {
  buildSolTransfer,
  createSolanaKeypair,
  setRpcForTests,
  signLegacyMessage,
} from "../api/wallet.js";
import { signVersionedTransaction } from "../api/jupiter.js";

process.env.WALLET_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.SOL_USD = "100";
const MINT = createSolanaKeypair().publicKey;
process.env.ORBITX_MINT = MINT;
const BLOCKHASH = createSolanaKeypair().publicKey;
const BURN_RAW = "4500000";

function req(op, body = {}, token = "") {
  return new Request("http://local/api/city", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify({ op, ...body }),
  });
}

async function call(op, body, token) {
  const res = await POST(req(op, body, token));
  return { status: res.status, data: await res.json() };
}

async function signup() {
  const email = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const token = signed.data.token;
  await call("session", {}, token);
  return token;
}

function decimalsAccountInfo() {
  const raw = Buffer.alloc(45);
  raw[44] = 6;
  return { value: { data: [raw.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
}

setRpcForTests(async (method, params) => {
  if (method === "getBalance") return 2_000_000_000; // 2 SOL in the device wallet.
  if (method === "getTokenAccountsByOwner") return { value: [] };
  if (method === "getLatestBlockhash") return { value: { blockhash: BLOCKHASH } };
  if (method === "getAccountInfo") return decimalsAccountInfo();
  if (method === "sendTransaction") return "5FakeAdSig11111111111111111111111111111111111111111111111111";
  if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed" }] };
  if (method === "getTransaction") {
    return {
      meta: {
        preTokenBalances: [{ mint: MINT, uiTokenAmount: { amount: "1000000000" } }],
        postTokenBalances: [{ mint: MINT, uiTokenAmount: { amount: "995500000" } }],
      },
    };
  }
  return { value: [] };
});

// A well-formed (but fake) Jupiter swap transaction: one v0 transfer.
// attachBurnToSwap appends the ATA-create + burn to it, no lookup tables.
function fakeSwapTx(payerAddress) {
  const payer = new PublicKey(payerAddress);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey(createSolanaKeypair().publicKey), lamports: 1000 }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

setJupiterFetch(async (url) => {
  const text = String(url);
  if (text.includes("/quote")) {
    return { ok: true, text: async () => JSON.stringify({ inAmount: "2000000", outAmount: "5000000", otherAmountThreshold: BURN_RAW }) };
  }
  // The swap build: the payer is inside the posted body; the fake tx is
  // rebuilt per call below via the request body.
  return { ok: true, text: async () => JSON.stringify({ swapTransaction: "", lastValidBlockHeight: 1 }) };
});

test("wallet-balance reads SOL + ORBITX for any address, and refuses a bad one", async () => {
  const token = await signup();
  const device = createSolanaKeypair();
  const bal = await call("wallet-balance", { address: device.publicKey }, token);
  assert.equal(bal.data.ok, true, JSON.stringify(bal.data));
  assert.equal(bal.data.network, "devnet");
  assert.equal(bal.data.sol, 2);
  assert.equal(bal.data.orbitx, 0);
  assert.equal(bal.data.holder, false);
  const bad = await call("wallet-balance", { address: "nope" }, token);
  assert.equal(bad.data.ok, false);
  assert.equal(bad.status, 400);
});

test("wallet-blockhash returns a blockhash and the relay broadcasts a device-signed transfer", async () => {
  const token = await signup();
  const device = createSolanaKeypair();
  const dest = createSolanaKeypair().publicKey;
  const hash = await call("wallet-blockhash", {}, token);
  assert.equal(hash.data.ok, true);
  assert.equal(hash.data.blockhash, BLOCKHASH);
  const message = buildSolTransfer(device.publicKey, dest, 1_000_000, BLOCKHASH);
  assert.ok(message);
  const { signedTx, signature } = signLegacyMessage(device.secret, message);
  const sent = await call("wallet-submit", { signedTx, address: device.publicKey }, token);
  assert.equal(sent.data.ok, true, JSON.stringify(sent.data));
  assert.equal(sent.data.signature, "5FakeAdSig11111111111111111111111111111111111111111111111111");
  assert.ok(signature);
  // A signature from a different wallet is refused.
  const other = createSolanaKeypair();
  const wrong = await call("wallet-submit", { signedTx, address: other.publicKey }, token);
  assert.equal(wrong.data.ok, false);
  assert.match(wrong.data.message, /not from this wallet/);
  // A tampered signature is refused.
  const bytes = Buffer.from(signedTx, "base64");
  bytes[10] ^= 0xff;
  const tampered = await call("wallet-submit", { signedTx: bytes.toString("base64"), address: device.publicKey }, token);
  assert.equal(tampered.data.ok, false);
  assert.match(tampered.data.message, /does not verify/);
});

test("on-device ad buy: compose -> device sign -> submit -> live, burn measured", async () => {
  const token = await signup();
  const device = createSolanaKeypair();
  // The swap mock needs the payer address from the posted body.
  setJupiterFetch(async (url, options) => {
    const text = String(url);
    if (text.includes("/quote")) {
      return { ok: true, text: async () => JSON.stringify({ inAmount: "2000000", outAmount: "5000000", otherAmountThreshold: BURN_RAW }) };
    }
    const body = JSON.parse(String(options?.body || "{}"));
    return { ok: true, text: async () => JSON.stringify({ swapTransaction: fakeSwapTx(body.userPublicKey), lastValidBlockHeight: 1 }) };
  });
  const composed = await call(
    "ad-compose",
    { board: "plaza-east", days: 1, project: "TEST", text: "ORBITX LIVE", address: device.publicKey, idempotencyKey: "local-ad-1" },
    token,
  );
  assert.equal(composed.data.ok, true, JSON.stringify(composed.data));
  assert.equal(composed.data.order.status, "composed");
  assert.equal(composed.data.priceSol, 0.002); // $0.20 plaza day / $100 SOL.
  assert.ok(composed.data.unsignedTx, "compose returns the unsigned transaction");
  // The device signs the composed transaction (stand-in for the browser's
  // PIN-unlocked signer — same layout, same ed25519 over the message).
  const signed = signVersionedTransaction(composed.data.unsignedTx, device.secret, b58encode);
  const submitted = await call("ad-submit", { orderId: composed.data.order.id, signedTx: signed.signedTx }, token);
  assert.equal(submitted.data.ok, true, JSON.stringify(submitted.data));
  assert.equal(submitted.data.order.status, "swapping");
  assert.equal(submitted.data.order.swapSignature, "5FakeAdSig11111111111111111111111111111111111111111111111111");
  // One status poll advances swapping -> burning -> live, measuring the
  // burn from the confirmed transaction (4,500,000 base units).
  const status = await call("ad-status", { orderId: composed.data.order.id }, token);
  assert.equal(status.data.ok, true, JSON.stringify(status.data));
  assert.equal(status.data.order.status, "live");
  assert.equal(status.data.order.orbitxAmount, BURN_RAW);
  const mine = await call("ad-orders", {}, token);
  assert.equal(mine.data.orders.some((row) => row.id === composed.data.order.id && row.status === "live"), true);
  // Re-composing the same idempotency key does not charge twice.
  const again = await call(
    "ad-compose",
    { board: "plaza-east", days: 1, project: "TEST", text: "ORBITX LIVE", address: device.publicKey, idempotencyKey: "local-ad-1" },
    token,
  );
  assert.equal(again.data.ok, true);
  assert.equal(again.data.order.status, "live");
  assert.match(again.data.message, /already started/);
});

test("ad-submit refuses a signature on a different transaction", async () => {
  const token = await signup();
  const device = createSolanaKeypair();
  setJupiterFetch(async (url, options) => {
    const text = String(url);
    if (text.includes("/quote")) {
      return { ok: true, text: async () => JSON.stringify({ inAmount: "2000000", outAmount: "5000000", otherAmountThreshold: BURN_RAW }) };
    }
    const body = JSON.parse(String(options?.body || "{}"));
    return { ok: true, text: async () => JSON.stringify({ swapTransaction: fakeSwapTx(body.userPublicKey), lastValidBlockHeight: 1 }) };
  });
  const composed = await call(
    "ad-compose",
    { board: "hall-front", days: 1, project: "TEST", text: "ORBITX LIVE", address: device.publicKey, idempotencyKey: "local-ad-2" },
    token,
  );
  assert.equal(composed.data.ok, true, JSON.stringify(composed.data));
  // A valid signature, but on a plain SOL transfer — not this booking.
  const dest = createSolanaKeypair().publicKey;
  const message = buildSolTransfer(device.publicKey, dest, 1_000_000, BLOCKHASH);
  const { signedTx } = signLegacyMessage(device.secret, message);
  const refused = await call("ad-submit", { orderId: composed.data.order.id, signedTx }, token);
  assert.equal(refused.data.ok, false);
  assert.match(refused.data.message, /not for this booking/);
  // The order is still composed and can still be signed properly.
  const signed = signVersionedTransaction(composed.data.unsignedTx, device.secret, b58encode);
  const ok = await call("ad-submit", { orderId: composed.data.order.id, signedTx: signed.signedTx }, token);
  assert.equal(ok.data.ok, true, JSON.stringify(ok.data));
  assert.equal(ok.data.order.status, "swapping");
});

test("ad-compose refuses a bad device address", async () => {
  const token = await signup();
  const bad = await call(
    "ad-compose",
    { board: "hall-front", days: 1, project: "TEST", text: "ORBITX LIVE", address: "nope", idempotencyKey: "local-ad-3" },
    token,
  );
  assert.equal(bad.data.ok, false);
  assert.match(bad.data.message, /not valid/);
});
