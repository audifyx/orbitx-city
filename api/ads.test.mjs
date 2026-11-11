// Unit tests for the real billboard flow (no network): pricing, the
// versioned-transaction signer, and the Token burn message builder.
// Run: node --test api/ads.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { AD_SOL_PRICE, PLAZA_BOARDS, priceLamports } from "./ads.js";
import { signVersionedTransaction, versionedMessage } from "./jupiter.js";
import { b58decode, b58encode } from "./live.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  buildTokenBurn,
  createSolanaKeypair,
  signLegacyMessage,
} from "./wallet.js";

function spki(pubkeyBytes) {
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({ key: Buffer.concat([prefix, Buffer.from(pubkeyBytes)]), format: "der", type: "spki" });
}

test("pricing is SOL-denominated with a plaza premium", () => {
  assert.equal(AD_SOL_PRICE[1], 0.01);
  assert.equal(AD_SOL_PRICE[7], 0.05);
  assert.equal(AD_SOL_PRICE[30], 0.15);
  assert.equal(priceLamports("hall-front", 1), 10_000_000);
  assert.equal(priceLamports("district-row", 7), 50_000_000);
  assert.equal(priceLamports("plaza-east", 1), 20_000_000);
  assert.equal(priceLamports("plaza-west", 30), 300_000_000);
  assert.equal(priceLamports("plaza-east", 2), 0);
  // priceLamports is pure pricing math; board validation lives in the ops.
  assert.equal(priceLamports("nope", 1), 10_000_000);
  assert.ok(PLAZA_BOARDS.has("plaza-east") && PLAZA_BOARDS.has("plaza-west"));
  assert.ok(!PLAZA_BOARDS.has("hall-front"));
});

test("a hand-built versioned transaction signs and verifies", () => {
  const kp = createSolanaKeypair();
  const message = Buffer.from("orbitx-versioned-message-fixture");
  const unsigned = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), message]);
  const signed = signVersionedTransaction(unsigned.toString("base64"), kp.secret, b58encode);
  const bytes = Buffer.from(signed.signedTx, "base64");
  assert.equal(bytes[0], 1);
  assert.deepEqual(versionedMessage(signed.signedTx), message);
  const sig = bytes.subarray(1, 65);
  const pub = Buffer.from(kp.secret.subarray(32));
  assert.ok(verify(null, message, spki(pub), sig));
  assert.equal(signed.signature, b58encode(sig));
});

test("a Token burn message builds, signs, and verifies (both programs)", () => {
  const kp = createSolanaKeypair();
  const owner = kp.publicKey;
  const tokenAccount = createSolanaKeypair().publicKey;
  const mint = createSolanaKeypair().publicKey;
  const blockhash = "11111111111111111111111111111111";
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const message = buildTokenBurn(owner, tokenAccount, mint, 400_000n, blockhash, program);
    assert.ok(message, `burn message for ${program}`);
    // Accounts: [owner, tokenAccount, mint, program].
    const count = message[3];
    assert.equal(count, 4);
    assert.deepEqual(message.subarray(4, 36), b58decode(owner));
    assert.deepEqual(message.subarray(36, 68), b58decode(tokenAccount));
    assert.deepEqual(message.subarray(68, 100), b58decode(mint));
    assert.deepEqual(message.subarray(100, 132), b58decode(program));
    // Instruction: program index 3, accounts [0,1,2], data [8, amount LE].
    const { signedTx, signature } = signLegacyMessage(kp.secret, message);
    const sig = Buffer.from(signedTx, "base64").subarray(1, 65);
    const pub = Buffer.from(kp.secret.subarray(32));
    assert.ok(verify(null, message, spki(pub), sig));
    assert.equal(signature, b58encode(sig));
    const tail = message.subarray(message.length - 9);
    assert.equal(tail[0], 8);
    assert.equal(tail.readBigUInt64LE(1), 400_000n);
  }
  assert.equal(buildTokenBurn(owner, tokenAccount, mint, 0n, blockhash, TOKEN_PROGRAM_ID), null);
  assert.equal(buildTokenBurn(owner, "not-an-address", mint, 100n, blockhash, TOKEN_PROGRAM_ID), null);
});
