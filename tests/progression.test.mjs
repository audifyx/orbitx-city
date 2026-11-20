// PROGRESSION CORE: pins the pure logic behind Citizen Rank, daily
// streaks, weekly-quest seeding windows, NPC favor pay and the
// delivery/taxi board pay maths. Imports the real TS module the game
// ships (Node strips the types) — if the numbers drift, this fails.
//
// Run: node --test tests/progression.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  hashSeed,
  mulberry32,
  localDateStr,
  shiftDateStr,
  nextStreak,
  streakBonus,
  isoWeekKey,
  weekDaysLeft,
  rankForXp,
  rankUpBonus,
  favorRewardFor,
  deliveryPay,
  taxiPay,
  boardParMs,
} from "../web/src/game/progression.ts";

test("hashSeed + mulberry32 are deterministic per seed", () => {
  assert.equal(hashSeed("player|2026-11-20"), hashSeed("player|2026-11-20"));
  assert.notEqual(hashSeed("player|2026-11-20"), hashSeed("player|2026-11-21"));
  const a = mulberry32(hashSeed("seed-a"));
  const b = mulberry32(hashSeed("seed-a"));
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1, "rng stays in [0,1)");
  const c = mulberry32(hashSeed("seed-b"));
  assert.notDeepEqual([c(), c(), c()], seqA);
});

test("date shifting crosses month + year boundaries", () => {
  assert.equal(localDateStr(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(shiftDateStr("2026-01-31", 1), "2026-02-01");
  assert.equal(shiftDateStr("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDateStr("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDateStr("2026-11-20", 0), "2026-11-20");
});

test("streak: yesterday extends, a gap restarts, same day is stable", () => {
  assert.equal(nextStreak(0, "", "2026-11-20"), 1);
  assert.equal(nextStreak(3, "2026-11-19", "2026-11-20"), 4);
  assert.equal(nextStreak(3, "2026-11-18", "2026-11-20"), 1);
  assert.equal(nextStreak(3, "2026-11-20", "2026-11-20"), 3);
  assert.equal(nextStreak(0, "2026-11-20", "2026-11-20"), 1);
  assert.equal(streakBonus(1), 10);
  assert.equal(streakBonus(7), 70);
  assert.equal(streakBonus(30), 70, "bonus caps at +70");
  assert.equal(streakBonus(0), 0);
});

test("iso week keys + days left", () => {
  // 2026-11-20 is a Friday of ISO week 47.
  assert.equal(isoWeekKey(new Date(2026, 10, 20)), "2026-W47");
  assert.equal(weekDaysLeft(new Date(2026, 10, 20)), 3);
  // Monday starts a new week with 7 days left; Sunday has 1.
  assert.equal(isoWeekKey(new Date(2026, 10, 16)), "2026-W47");
  assert.equal(weekDaysLeft(new Date(2026, 10, 16)), 7);
  assert.equal(weekDaysLeft(new Date(2026, 10, 22)), 1);
  assert.equal(isoWeekKey(new Date(2026, 10, 23)), "2026-W48");
  // Year boundary: 2026-01-01 is a Thursday — ISO week 1 of 2026.
  assert.equal(isoWeekKey(new Date(2026, 0, 1)), "2026-W01");
});

test("rank curve: thresholds, titles, spans, max rank", () => {
  assert.deepEqual(rankForXp(0), { rank: 1, title: "Visitor", into: 0, span: 100, nextAt: 100 });
  assert.equal(rankForXp(99).rank, 1);
  assert.deepEqual(rankForXp(100), { rank: 2, title: "Newcomer", into: 0, span: 150, nextAt: 250 });
  assert.equal(rankForXp(449).rank, 3);
  assert.equal(rankForXp(450).title, "Local");
  assert.equal(rankForXp(3199).rank, 9);
  const max = rankForXp(3200);
  assert.equal(max.rank, 10);
  assert.equal(max.title, "City Legend");
  assert.equal(max.nextAt, null);
  assert.equal(rankForXp(99999).rank, 10, "rank never exceeds 10");
  assert.equal(rankForXp(-50).rank, 1, "negative XP clamps to rank 1");
  assert.equal(rankUpBonus(2), 200);
  assert.equal(rankUpBonus(10), 1000);
});

test("favor pay scales with distance inside 40–90", () => {
  assert.equal(favorRewardFor(0), 40);
  assert.equal(favorRewardFor(100), 50);
  assert.equal(favorRewardFor(250), 65);
  assert.equal(favorRewardFor(500), 90);
  assert.equal(favorRewardFor(5000), 90, "caps at 90");
});

test("board pay: base ranges + gold/silver/base time tiers", () => {
  const par = boardParMs(390);
  assert.equal(par, 30000, "par is route distance at 13 u/s");
  const gold = deliveryPay(300, par, par);
  assert.equal(gold.base, 98);
  assert.equal(gold.tier, "gold");
  assert.equal(gold.bonus, 30);
  assert.equal(gold.total, 128);
  const silver = deliveryPay(300, par * 1.4, par);
  assert.equal(silver.tier, "silver");
  assert.equal(silver.bonus, 15);
  const late = deliveryPay(300, par * 1.41, par);
  assert.equal(late.tier, "base");
  assert.equal(late.bonus, 0);
  // Range clamps from the brief: delivery 60–180 total, taxi 50–160.
  assert.equal(deliveryPay(0, 1, par).base, 60);
  assert.ok(deliveryPay(100000, 1, par).total <= 180);
  assert.equal(taxiPay(0, 1, par).base, 50);
  assert.ok(taxiPay(100000, 1, par).total <= 160);
  const fare = taxiPay(400, par, par);
  assert.equal(fare.base, 105);
  assert.equal(fare.total, 135);
});
