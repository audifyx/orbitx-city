// Trading Floor — real Solana swaps via Jupiter (api/trade.js).
// No network: Jupiter is mocked (setJupiterFetch) and the RPC is mocked
// (setRpcForTests). The swap transaction is a real versioned tx built
// with @solana/web3.js, signed with a real keypair — so compose/submit
// verification runs exactly as it does live.
// Run: SOL_USD=100 node --test tests/trading-floor.test.mjs
process.env.SOL_USD ||= "100";
process.env.ORBITX_MINT ||= "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9";
import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { setJupiterFetch, SOL_MINT } from "../api/jupiter.js";
import { setRpcForTests } from "../api/wallet.js";
import { tradeCompose, tradeHoldings, tradeQuote, tradeStatus, tradeSubmit } from "../api/trade.js";
import { signVersionedTransaction } from "../api/jupiter.js";
import { b58encode } from "../api/live.js";

const ORBITX = "13H4WJvGEg4xrrBwWn2vsQgz7xhmhxgNdw19i1QsxPX9";
const ctx = { sb: null, note: () => {} };
const player = { authUser: "user-test-1", id: "player-test-1" };
const guest = { authUser: null, id: "guest" };

// A real versioned tx the mock Jupiter "builds": a 0-lamport self-transfer
// (valid shape, one signer = the payer). The compose stores its message
// hash; submit verifies a signature on exactly this message.
function mockSwapTx(payer) {
  const msg = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(payer), toPubkey: new PublicKey(payer), lamports: 0 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

function mockJupiter(payer) {
  return async (url, options) => {
    if (String(url).includes("/quote?")) {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            inputMint: SOL_MINT,
            outputMint: ORBITX,
            inAmount: "10000000",
            outAmount: "72548158631",
            otherAmountThreshold: "71822677045",
            swapMode: "ExactIn",
            slippageBps: 100,
          }),
      };
    }
    if (String(url).includes("/swap")) {
      return {
        ok: true,
        text: async () => JSON.stringify({ swapTransaction: mockSwapTx(payer), lastValidBlockHeight: 1 }),
      };
    }
    throw new Error(`unexpected jupiter url ${url}`);
  };
}

test("trade-quote validation (no network)", async () => {
  const guestRes = await tradeQuote(ctx, guest, { inputMint: SOL_MINT, outputMint: ORBITX, amount: "10000000" });
  assert.equal(guestRes.ok, false);
  assert.match(guestRes.message, /Sign in/);
  const badMint = await tradeQuote(ctx, player, { inputMint: "nope", outputMint: ORBITX, amount: "10000000" });
  assert.equal(badMint.ok, false);
  const same = await tradeQuote(ctx, player, { inputMint: SOL_MINT, outputMint: SOL_MINT, amount: "10000000" });
  assert.equal(same.ok, false);
  assert.match(same.message, /same/);
  const zero = await tradeQuote(ctx, player, { inputMint: SOL_MINT, outputMint: ORBITX, amount: "0" });
  assert.equal(zero.ok, false);
});

test("trade-compose validation (no network)", async () => {
  const badAddr = await tradeCompose(ctx, player, { inputMint: SOL_MINT, outputMint: ORBITX, amount: "10000000", address: "nope", idempotencyKey: "k1" });
  assert.equal(badAddr.ok, false);
  const noKey = await tradeCompose(ctx, player, { inputMint: SOL_MINT, outputMint: ORBITX, amount: "10000000", address: Keypair.generate().publicKey.toBase58(), idempotencyKey: "" });
  assert.equal(noKey.ok, false);
  assert.match(noKey.message, /confirm id/);
  const dust = await tradeCompose(ctx, player, { inputMint: SOL_MINT, outputMint: ORBITX, amount: "100", address: Keypair.generate().publicKey.toBase58(), idempotencyKey: "k2" });
  assert.equal(dust.ok, false);
  assert.match(dust.message, /at least/);
});

test("trade compose -> submit happy path (mocked Jupiter + RPC)", async () => {
  const user = Keypair.generate();
  const address = user.publicKey.toBase58();
  const secretB64 = Buffer.from(user.secretKey).toString("base64");
  setJupiterFetch(mockJupiter(address));
  setRpcForTests(async (method) => {
    if (method === "getBalance") return { value: 10_000_000_000 };
    if (method === "sendTransaction") return "MOCK-SIGNATURE-123";
    throw new Error(`unexpected rpc ${method}`);
  });
  const composed = await tradeCompose(ctx, player, {
    inputMint: SOL_MINT,
    outputMint: ORBITX,
    amount: "10000000",
    address,
    idempotencyKey: "trade-test-1",
    slippageBps: 100,
  });
  assert.equal(composed.ok, true, JSON.stringify(composed));
  assert.equal(composed.trade.status, "composed");
  assert.equal(composed.trade.direction, "buy");
  assert.ok(composed.unsignedTx, "compose returns an unsigned tx");
  assert.ok(composed.trade.id.startsWith("trade-"));
  // Resume: the same idempotency key returns the same composed trade.
  const resumed = await tradeCompose(ctx, player, {
    inputMint: SOL_MINT,
    outputMint: ORBITX,
    amount: "10000000",
    address,
    idempotencyKey: "trade-test-1",
    slippageBps: 100,
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.trade.id, composed.trade.id);
  // Sign exactly the composed transaction with the user's key, submit.
  const secret = Buffer.from(secretB64, "base64");
  const signed = signVersionedTransaction(composed.unsignedTx, secret, (b) => b58encode(b));
  const submitted = await tradeSubmit(ctx, player, { tradeId: composed.trade.id, signedTx: signed.signedTx });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  assert.equal(submitted.trade.status, "submitted");
  assert.equal(submitted.signature, "MOCK-SIGNATURE-123");
  // Status: submitted (mock RPC has no confirmation, so it stays submitted).
  const status = await tradeStatus(ctx, player, { tradeId: composed.trade.id });
  assert.equal(status.ok, true);
  assert.equal(status.trade.status, "submitted");
  // A second submit is a no-op, not a second swap.
  const again = await tradeSubmit(ctx, player, { tradeId: composed.trade.id, signedTx: signed.signedTx });
  assert.equal(again.ok, true);
  assert.equal(again.trade.status, "submitted");
});

test("trade-submit refuses a signature on another transaction", async () => {
  const user = Keypair.generate();
  const address = user.publicKey.toBase58();
  const secretB64 = Buffer.from(user.secretKey).toString("base64");
  setJupiterFetch(mockJupiter(address));
  setRpcForTests(async (method) => {
    if (method === "getBalance") return { value: 10_000_000_000 };
    if (method === "sendTransaction") return "MOCK-SIGNATURE-999";
    throw new Error(`unexpected rpc ${method}`);
  });
  const composed = await tradeCompose(ctx, player, {
    inputMint: SOL_MINT,
    outputMint: ORBITX,
    amount: "10000000",
    address,
    idempotencyKey: "trade-test-2",
    slippageBps: 100,
  });
  assert.equal(composed.ok, true);
  // Sign a DIFFERENT transaction (another mock swap) and try to submit it
  // against this trade — the message hash must not match.
  const otherTx = mockSwapTx(Keypair.generate().publicKey.toBase58());
  const secret = Buffer.from(secretB64, "base64");
  const wrong = signVersionedTransaction(otherTx, secret, (b) => b58encode(b));
  const refused = await tradeSubmit(ctx, player, { tradeId: composed.trade.id, signedTx: wrong.signedTx });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /not for this trade/);
});

test("trade-holdings reads SOL + ORBITX (mocked RPC)", async () => {
  const address = Keypair.generate().publicKey.toBase58();
  setRpcForTests(async (method, params) => {
    if (method === "getBalance") return { value: 2_500_000_000 };
    if (method === "getTokenAccountsByOwner") {
      return { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: 1234.5 } } } } } }] };
    }
    throw new Error(`unexpected rpc ${method}`);
  });
  const out = await tradeHoldings(ctx, player, { address });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.sol, 2.5);
  assert.equal(out.orbitx, 1234.5);
});
