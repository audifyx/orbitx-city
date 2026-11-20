// MODES CORE: pins the pure scoring maths behind Hijack Mode (distance
// × wanted multiplier, bust consolation, XP tiers, the 5-minute scoring
// cap constant) and Bank Heist Mode (vault crack loot curve, alarm heat
// steps, cooldown). Imports the real TS module the game ships — if the
// numbers drift, this fails.
//
// Run: node --test tests/modes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  HIJACK_RATE_PER_UNIT,
  HIJACK_SCORE_CAP_MS,
  hijackStarMult,
  hijackAccrue,
  hijackConsolation,
  hijackXp,
  HEIST_CRACK_MS,
  HEIST_MAX_CRACK_MS,
  HEIST_COOLDOWN_MS,
  HEIST_XP,
  heistLootFor,
  heistCrackDone,
  heistStarsFor,
  heistCooldownSecs,
} from "../web/src/game/modes.ts";

test("hijack star multiplier: 1x clean, +0.5 per star, clamped 0-5", () => {
  assert.equal(hijackStarMult(0), 1);
  assert.equal(hijackStarMult(1), 1.5);
  assert.equal(hijackStarMult(2), 2);
  assert.equal(hijackStarMult(5), 3.5);
  assert.equal(hijackStarMult(9), 3.5, "clamps at 5 stars");
  assert.equal(hijackStarMult(-2), 1, "never below 1x");
});

test("hijack accrual: distance x rate x multiplier", () => {
  assert.equal(HIJACK_RATE_PER_UNIT, 0.35);
  assert.equal(hijackAccrue(100, 0), 35);
  assert.equal(hijackAccrue(100, 2), 70);
  assert.equal(hijackAccrue(200, 5), 245);
  assert.equal(hijackAccrue(0, 5), 0);
  assert.equal(hijackAccrue(-10, 5), 0, "no negative distance");
  assert.equal(HIJACK_SCORE_CAP_MS, 300_000, "scoring caps at 5 minutes");
});

test("hijack bust consolation: 10% of accrued, floored", () => {
  assert.equal(hijackConsolation(245), 24);
  assert.equal(hijackConsolation(100), 10);
  assert.equal(hijackConsolation(9), 0);
  assert.equal(hijackConsolation(0), 0);
  assert.equal(hijackConsolation(-50), 0);
});

test("hijack XP: flat 12 plus score tiers", () => {
  assert.equal(hijackXp(0), 12);
  assert.equal(hijackXp(49), 12);
  assert.equal(hijackXp(50), 16);
  assert.equal(hijackXp(119), 16);
  assert.equal(hijackXp(120), 20);
  assert.equal(hijackXp(249), 20);
  assert.equal(hijackXp(250), 27);
  assert.equal(hijackXp(900), 27);
});

test("heist loot: nothing before 20s, 400 base, +100 per extra 5s to 35s", () => {
  assert.equal(HEIST_CRACK_MS, 20_000);
  assert.equal(HEIST_MAX_CRACK_MS, 35_000);
  assert.equal(heistLootFor(0), 0);
  assert.equal(heistLootFor(19_999), 0);
  assert.equal(heistLootFor(20_000), 400);
  assert.equal(heistLootFor(24_999), 400);
  assert.equal(heistLootFor(25_000), 500);
  assert.equal(heistLootFor(30_000), 600);
  assert.equal(heistLootFor(35_000), 700);
  assert.equal(heistLootFor(60_000), 700, "greed caps at 35s of cracking");
  assert.equal(heistCrackDone(19_999), false);
  assert.equal(heistCrackDone(20_000), true);
});

test("heist alarm heat: 2 stars at start, 3 at 10s, 4 past 30s", () => {
  assert.equal(heistStarsFor(0), 2);
  assert.equal(heistStarsFor(9_999), 2);
  assert.equal(heistStarsFor(10_000), 3);
  assert.equal(heistStarsFor(29_999), 3);
  assert.equal(heistStarsFor(30_000), 4);
  assert.equal(heistStarsFor(35_000), 4);
});

test("heist cooldown: 10 real minutes, whole seconds left", () => {
  assert.equal(HEIST_COOLDOWN_MS, 600_000);
  assert.equal(HEIST_XP, 25);
  const t0 = 1_700_000_000_000;
  assert.equal(heistCooldownSecs(t0 + HEIST_COOLDOWN_MS, t0), 600);
  assert.equal(heistCooldownSecs(t0 + 90_500, t0), 91, "rounds up to whole seconds");
  assert.equal(heistCooldownSecs(t0, t0), 0);
  assert.equal(heistCooldownSecs(t0 - 5_000, t0), 0, "never negative");
});
