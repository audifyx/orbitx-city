import test from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { POST } from "./city.js";
import { b58decode } from "./live.js";
import { buildSolTransfer, createSolanaKeypair, openSecret, sealSecret, setRpcForTests, signMessage } from "./wallet.js";

process.env.WALLET_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
setRpcForTests(async (method) => {
  if (method === "getBalance") return 0;
  if (method === "getTokenAccountsByOwner") return { value: [] };
  if (method === "getLatestBlockhash") return { value: { blockhash: "11111111111111111111111111111111" } };
  if (method === "sendTransaction") return "ok-signature";
  return { value: [] };
});

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

test("a sealed key round-trips and a transfer signature verifies", () => {
  const made = createSolanaKeypair();
  const sealed = sealSecret(made.secret);
  const opened = openSecret(sealed);
  assert.equal(Buffer.from(opened).equals(made.secret), true);
  const system = b58decode("11111111111111111111111111111111");
  assert.equal(system?.length, 32);
  const pub = b58decode(made.publicKey);
  const other = createSolanaKeypair();
  const message = buildSolTransfer(made.publicKey, other.publicKey, 1000, other.publicKey);
  assert.ok(message);
  const sig = signMessage(opened, message);
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub.toString("base64url") }, format: "jwk" });
  assert.equal(verify(null, message, key, sig), true);
  opened.fill(0);
});

test("export needs a fresh password, and the session response has no secret", async () => {
  const email = `wallet-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const token = signed.data.token;
  const session = await call("session", {}, token);
  assert.equal(session.data.me.account, true);
  assert.ok(session.data.me.address);
  assert.equal(JSON.stringify(session.data).includes("secret"), false);
  const blocked = await call("wallet-export", { confirm: "EXPORT" }, token);
  assert.equal(blocked.status, 401);
  const exported = await call("wallet-export", { confirm: "EXPORT", password: "correct-horse" }, token);
  assert.equal(exported.data.ok, true);
  assert.equal(exported.data.phantom.length, 64);
  assert.ok(exported.data.secretBase58);
  const view = await call("me", {}, token);
  assert.equal(JSON.stringify(view.data).includes(exported.data.secretBase58), false);
});

test("a confirm is idempotent and a bad destination is refused", async () => {
  setRpcForTests(async (method) => {
    if (method === "getLatestBlockhash") return { value: { blockhash: createSolanaKeypair().publicKey } };
    if (method === "getBalance") return 0;
    if (method === "sendTransaction") return "ok-signature";
    return { value: [] };
  });
  const email = `send-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const token = signed.data.token;
  await call("session", {}, token);
  const bad = await call("wallet-confirm", { idempotencyKey: "bad", destination: "nope", amount: "0.1" }, token);
  assert.equal(bad.data.ok, false);
  const dest = createSolanaKeypair().publicKey;
  const sent = await call("wallet-confirm", { idempotencyKey: "once", destination: dest, amount: "0.1" }, token);
  assert.equal(sent.data.ok, true, sent.data.message);
  const replay = await call("wallet-confirm", { idempotencyKey: "once", destination: dest, amount: "0.1" }, token);
  assert.match(replay.data.message, /not broadcast again/);
});

test("mainnet sends stay off unless the transfer flag is set", async () => {
  process.env.SOLANA_NETWORK = "mainnet-beta";
  delete process.env.ONCHAIN_TRANSFERS_ENABLED;
  const email = `main-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const token = signed.data.token;
  await call("session", {}, token);
  const dest = createSolanaKeypair().publicKey;
  const blocked = await call("wallet-confirm", { idempotencyKey: "main", destination: dest, amount: "0.01" }, token);
  assert.equal(blocked.data.ok, false);
  assert.match(blocked.data.message, /Mainnet sends are off/);
  delete process.env.SOLANA_NETWORK;
});

test("the shop still spends demo credits when the on-chain shop flag is off", async () => {
  process.env.ONCHAIN_SHOP_ENABLED = "false";
  const email = `shop-${Date.now()}@example.com`;
  const signed = await call("auth-signup", { email, password: "correct-horse" });
  const token = signed.data.token;
  await call("session", {}, token);
  const spent = await call("spend", { item: "color-white" }, token);
  assert.equal(spent.data.ok, true);
  assert.equal(spent.data.me.balance, 230);
  assert.equal(JSON.stringify(spent.data).includes("signature"), false);
});
