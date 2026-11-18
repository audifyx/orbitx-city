// ORBITX billboards (no network): the $1 / 7-day product — quote
// validation, the burn amount, a full buy -> live flow with mocked RPC,
// double-booking refusal, and expiry. No real SOL, no real ORBITX, no
// real burn.
// Run: node --test tests/billboard-orbitx.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.WALLET_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.ORBITX_USD = "0.0001"; // pinned price: $1 = 10,000 ORBITX

import {
  AD_BOARDS,
  BILLBOARD_ORBITX_DAYS,
  BILLBOARD_ORBITX_USD,
  billboardImageExtOk,
  billboardImageOk,
  billboardOrbitxBuy,
  billboardOrbitxOrders,
  billboardOrbitxQuote,
  billboardOrbitxStatus,
  orbitxBaseAmount,
} from "../api/ads.js";
import {
  createSolanaKeypair,
  ensureWallet,
  setRpcForTests,
} from "../api/wallet.js";

const MINT = createSolanaKeypair().publicKey;
process.env.ORBITX_MINT = MINT;
const BLOCKHASH = createSolanaKeypair().publicKey;
const TOKEN_ACCT = createSolanaKeypair().publicKey;
const FAKE_SIG = "5FakeBurnSig1111111111111111111111111111111111111111111111111";

function decimalsAccountInfo() {
  const raw = Buffer.alloc(45);
  raw[44] = 6;
  return { value: { data: [raw.toString("base64"), "base64"], owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" } };
}

setRpcForTests(async (method) => {
  if (method === "getAccountInfo") return decimalsAccountInfo();
  // 1,000,000 ORBITX in the in-app wallet (decimals 6), jsonParsed shape.
  if (method === "getTokenAccountsByOwner") return { value: [{ pubkey: TOKEN_ACCT, account: { data: { parsed: { info: { tokenAmount: { amount: "1000000000000", decimals: 6 } } } } } }] };
  if (method === "getLatestBlockhash") return { value: { blockhash: BLOCKHASH } };
  if (method === "sendTransaction") return FAKE_SIG;
  if (method === "getSignatureStatuses") return { value: [{ confirmationStatus: "confirmed" }] };
  if (method === "getTransaction") return { meta: { preTokenBalances: [], postTokenBalances: [] } };
  return { value: [] };
});

const PLAYER = { id: "player-1", name: "Tester", authUser: "user-1", burned: 0 };
const bookings = [];
const ctx = {
  sb: () => null,
  note: () => {},
  readBookings: async () => bookings,
  saveBooking: async (info) => {
    bookings.push(info);
  },
  savePlayer: async () => {},
};

const today = new Date().toISOString().slice(0, 10);
const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const BUCKET_IMG = "https://xyz.supabase.co/storage/v1/object/public/billboard-ads/abc.png";

test("the product is $1 for 7 days on all 25 boards", () => {
  assert.equal(BILLBOARD_ORBITX_USD, 1);
  assert.equal(BILLBOARD_ORBITX_DAYS, 7);
  assert.equal(AD_BOARDS.length, 25);
  assert.ok(AD_BOARDS.includes("plaza-east") && AD_BOARDS.includes("ny-tower") && AD_BOARDS.includes("fl-plaza-west"));
});

test("the burn amount is exactly $1 of ORBITX at the pinned price", async () => {
  // $1 / $0.0001 = 10,000 ORBITX; decimals 6 -> 10,000,000,000 base units.
  assert.equal(orbitxBaseAmount(1, "0.0001", 6), 10_000_000_000n);
  assert.equal(orbitxBaseAmount(1, "", 6), 0n);
  const q = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "P", text: "Hi", image: "" });
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.priceUsd, 1);
  assert.equal(q.days, 7);
  assert.equal(q.orbitxAmount, "10000000000");
  assert.equal(q.orbitxUi, 10000);
  assert.equal(q.balanceUi, 0); // no in-app wallet yet: balance reads 0
  assert.equal(q.enough, false);
  assert.equal(q.endsAt, in7);
});

test("quote validation fails before any price is read", async () => {
  const noAuth = await billboardOrbitxQuote(ctx, { ...PLAYER, authUser: "" }, { board: "hall-front", project: "P" });
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.message, /Create an account/);
  const unknown = await billboardOrbitxQuote(ctx, PLAYER, { board: "nope", project: "P" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /one of the 25 billboards/);
  const denied = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "Double your money" });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /not allowed/);
  const badImg = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "P", image: "https://evil.example.com/x.png" });
  assert.equal(badImg.ok, false);
  assert.match(badImg.message, /upload it in the Ads panel/);
  const badExt = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "P", image: BUCKET_IMG.replace(".png", ".bmp") });
  assert.equal(badExt.ok, false);
  assert.match(badExt.message, /\.jpg, \.png, \.webp, or \.gif/);
  // A taken board refuses; an expired booking is available again.
  bookings.push({ id: "hall-front", project: "Someone", text: "", end: "2099-01-01", owner_id: "player-2" });
  const taken = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "P" });
  assert.equal(taken.ok, false);
  assert.match(taken.message, /Someone has hall-front until 2099-01-01/);
  bookings[0].end = yesterday;
  const expired = await billboardOrbitxQuote(ctx, PLAYER, { board: "hall-front", project: "P" });
  assert.equal(expired.ok, true, JSON.stringify(expired));
  bookings.length = 0;
});

test("image validation only accepts the billboard bucket (or a local path)", () => {
  assert.equal(billboardImageOk(""), true);
  assert.equal(billboardImageOk("/game/billboard.png"), true);
  assert.equal(billboardImageOk(BUCKET_IMG), true);
  assert.equal(billboardImageOk("https://evil.example.com/x.png"), false);
  assert.equal(billboardImageExtOk(BUCKET_IMG), true);
  assert.equal(billboardImageExtOk(BUCKET_IMG.replace(".png", ".bmp")), false);
});

test("a buy without an in-app wallet fails cleanly, then a full buy burns $1 and goes live", async () => {
  const noWallet = await billboardOrbitxBuy(ctx, { ...PLAYER, authUser: "user-nowallet" }, { board: "market-road", project: "P", text: "Hi", image: "", idempotencyKey: "bbx-test-nowallet" });
  assert.equal(noWallet.ok, false);
  assert.match(noWallet.message, /No in-app wallet yet/);

  const made = await ensureWallet("user-1");
  assert.ok(made?.publicKey, "in-app wallet created");
  const res = await billboardOrbitxBuy(ctx, PLAYER, { board: "market-road", project: "My Project", text: "We are live", image: BUCKET_IMG, idempotencyKey: "bbx-test-1" });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.order.status, "burning");
  assert.equal(res.order.kind, "orbitx-week");
  assert.equal(res.order.image, BUCKET_IMG);
  assert.equal(res.order.orbitxAmount, "10000000000");
  assert.equal(res.order.burnSignature, FAKE_SIG);
  assert.equal(res.order.board, "market-road");

  const st = await billboardOrbitxStatus(ctx, PLAYER, { orderId: res.order.id });
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.equal(st.order.status, "live");
  assert.equal(st.order.burnSignature, FAKE_SIG);
  // The placement landed with the image, and runs 7 days from today.
  assert.equal(bookings.length, 1);
  assert.equal(bookings[0].id, "market-road");
  assert.equal(bookings[0].image, BUCKET_IMG);
  assert.equal(bookings[0].start, today);
  assert.equal(bookings[0].end, in7);
  assert.equal(PLAYER.burned, 10000);

  // The board is now taken for everyone else: a second quote and a
  // second buy both refuse. (The owner may re-quote their own board to
  // extend — boardAvailability lets the owner through by design.)
  const OTHER = { id: "player-2", name: "Other", authUser: "user-2", burned: 0 };
  const takenQ = await billboardOrbitxQuote(ctx, OTHER, { board: "market-road", project: "Other" });
  assert.equal(takenQ.ok, false);
  assert.match(takenQ.message, /My Project has market-road until/);
  const takenB = await billboardOrbitxBuy(ctx, OTHER, { board: "market-road", project: "Other", idempotencyKey: "bbx-test-2" });
  assert.equal(takenB.ok, false);
  assert.match(takenB.message, /My Project has market-road until/);

  const mine = await billboardOrbitxOrders(ctx, PLAYER);
  assert.equal(mine.ok, true);
  assert.equal(mine.orders.length, 1);
  assert.equal(mine.orders[0].kind, "orbitx-week");
  assert.equal(mine.orders[0].status, "live");
});
