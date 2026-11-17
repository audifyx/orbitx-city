// Office leases in real SOL (no network): pricing (every term under $5),
// quote validation, the lease claim row, and the public lease shape.
// The SOL price is pinned here (read at call time), so this file passes
// with or without SOL_USD on the command line.
// Run: node --test tests/office-sol.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

process.env.SOL_USD = "100";

import {
  OFFICE_SOL_MAX_USD,
  OFFICE_SOL_USD_PRICE,
  leaseClaimRow,
  officeSolPriceLamports,
  officeSolPriceUsd,
  officeSolQuote,
  publicLease,
} from "../api/ads.js";

const SUITE = { id: "office-f2-a", name: "Suite 2A", floor: 2, tier: "standard", claimable: true };
const PREMIUM = { id: "office-f4-a", name: "Suite 4A", floor: 4, tier: "premium", claimable: true };
const FOUNDER = { id: "office-f4-founder", name: "Founder's Office", floor: 4, tier: "founder", claimable: false };
const PLAYER = { id: "player-1", name: "Tester", authUser: "user-1", burned: 0 };

function ctxFor(taken = null) {
  return {
    sb: () => null,
    note: () => {},
    officeSuite: (id) => [SUITE, PREMIUM, FOUNDER].find((s) => s.id === id) || null,
    officeTaken: async () => taken,
    saveOfficeLeaseClaim: async () => {},
    savePlayer: async () => {},
  };
}

test("every office SOL term costs under $5", () => {
  for (const [tier, table] of Object.entries(OFFICE_SOL_USD_PRICE)) {
    for (const days of [1, 7, 30]) {
      assert.ok(table[days] > 0, `${tier} ${days}d priced`);
      assert.ok(table[days] < OFFICE_SOL_MAX_USD, `${tier} ${days}d $${table[days]} under $5`);
    }
  }
  assert.equal(officeSolPriceUsd("standard", 1), 0.99);
  assert.equal(officeSolPriceUsd("standard", 7), 2.99);
  assert.equal(officeSolPriceUsd("standard", 30), 4.49);
  assert.equal(officeSolPriceUsd("premium", 1), 1.49);
  assert.equal(officeSolPriceUsd("premium", 7), 3.99);
  assert.equal(officeSolPriceUsd("premium", 30), 4.99);
  assert.equal(officeSolPriceUsd("standard", 2), 0);
  assert.equal(officeSolPriceUsd("nope", 1), 0);
});

test("SOL amounts follow the pinned SOL price", async () => {
  // SOL_USD=100: $0.99 = 0.0099 SOL = 9,900,000 lamports.
  assert.equal(await officeSolPriceLamports("standard", 1), 9_900_000);
  assert.equal(await officeSolPriceLamports("standard", 30), 44_900_000);
  assert.equal(await officeSolPriceLamports("premium", 30), 49_900_000);
  assert.equal(await officeSolPriceLamports("standard", 2), 0);
});

test("quote validation fails before any quote is made (no network)", async () => {
  const ctx = ctxFor();
  const noAuth = await officeSolQuote(ctx, { ...PLAYER, authUser: "" }, { suite: "office-f2-a", term_days: 7, project: "P" });
  assert.equal(noAuth.ok, false);
  assert.match(noAuth.message, /Create an account/);
  const unknown = await officeSolQuote(ctx, PLAYER, { suite: "office-nope", term_days: 7, project: "P" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.message, /Unknown office suite/);
  const founder = await officeSolQuote(ctx, PLAYER, { suite: "office-f4-founder", term_days: 7, project: "P" });
  assert.equal(founder.ok, false);
  assert.match(founder.message, /Founder's Office/);
  const badTerm = await officeSolQuote(ctx, PLAYER, { suite: "office-f2-a", term_days: 2, project: "P" });
  assert.equal(badTerm.ok, false);
  assert.match(badTerm.message, /1-day, 7-day, or 30-day/);
  const noProject = await officeSolQuote(ctx, PLAYER, { suite: "office-f2-a", term_days: 7, project: "  " });
  assert.equal(noProject.ok, false);
  assert.match(noProject.message, /Name the project/);
  const badLogo = await officeSolQuote(ctx, PLAYER, { suite: "office-f2-a", term_days: 7, project: "P", logo: "not-a-url" });
  assert.equal(badLogo.ok, false);
  assert.match(badLogo.message, /http/);
  const takenCtx = ctxFor({ suite: "office-f2-a", project: "Someone Else", until: "2099-01-01", owner_id: "player-2" });
  const taken = await officeSolQuote(takenCtx, PLAYER, { suite: "office-f2-a", term_days: 7, project: "P" });
  assert.equal(taken.ok, false);
  assert.match(taken.message, /already claimed by Someone Else/);
  // Extending your own claim passes validation, then fails at the live
  // Jupiter quote with 502 — no network in this test — proving the
  // availability check let it through.
  const ownCtx = ctxFor({ suite: "office-f2-a", project: "Mine", until: "2099-01-01", owner_id: "player-1" });
  const ext = await officeSolQuote(ownCtx, PLAYER, { suite: "office-f2-a", term_days: 7, project: "Mine", extend: true });
  assert.equal(ext.ok, false);
  assert.equal(ext.status, 502);
});

test("the lease claim row is the office claim (paid sol, price 0)", () => {
  const order = {
    suite: "office-f2-a",
    server: 1,
    days: 7,
    project: "My Project",
    logo: "https://x/logo.png",
    site: "https://x",
    solLamports: 29_900_000,
    burnSignature: "sig",
    orbitxAmount: "990000",
    id: "lease_abc",
    createdAt: "2026-11-17T10:00:00.000Z",
  };
  const claim = leaseClaimRow(order, PLAYER);
  assert.equal(claim.suite, "office-f2-a");
  assert.equal(claim.server_id, 1);
  assert.equal(claim.owner_id, "player-1");
  assert.equal(claim.project, "My Project");
  assert.equal(claim.term_days, 7);
  assert.equal(claim.price, 0);
  assert.equal(claim.paid, "sol");
  assert.equal(claim.sol_lamports, 29_900_000);
  assert.equal(claim.burn_signature, "sig");
  assert.equal(claim.orbitx_amount, "990000");
  assert.equal(claim.order_id, "lease_abc");
  const startMs = Date.parse(`${claim.start}T00:00:00Z`);
  const untilMs = Date.parse(`${claim.until}T00:00:00Z`);
  assert.equal(untilMs - startMs, 7 * 86400000, "until is start + 7 days");
});

test("publicLease maps the lease for the client", () => {
  const lease = {
    id: "lease_1",
    suite: "office-f2-a",
    server: 1,
    tier: "standard",
    days: 7,
    extend: false,
    project: "P",
    logo: "",
    site: "",
    status: "live",
    solLamports: 29_900_000,
    priceUsd: 2.99,
    orbitxAmount: "990000",
    swapSignature: "sig1",
    burnSignature: "sig1",
    error: "",
    createdAt: "2026-11-17T10:00:00.000Z",
    expiresAt: "2026-11-24",
  };
  const pub = publicLease(lease);
  assert.equal(pub.suite, "office-f2-a");
  assert.equal(pub.priceUsd, 2.99);
  assert.equal(pub.priceSol, 0.0299);
  assert.equal(pub.burnUrl, "https://solscan.io/tx/sig1?cluster=devnet");
});
