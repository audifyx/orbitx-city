// PROGRESSION CORE (pure logic, no DOM / no storage): the seeded RNG
// the local quest systems share, the Citizen Rank XP curve, the daily
// streak math, ISO-week helpers for weekly quests, and the pay maths
// for NPC favors + the delivery/taxi board. Everything here is a pure
// function so tests/progression.test.mjs can pin it down — runtime.ts
// owns the state, this file owns the numbers.

// ---- Seeded RNG (FNV-1a + mulberry32 — same algorithms the daily
// quests shipped with; new systems import these so the whole game
// seeds identically). -------------------------------------------------
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Local dates -----------------------------------------------------
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shift a YYYY-MM-DD local date string by whole days. */
export function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map((n) => Number(n));
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return localDateStr(dt);
}

// ---- Daily streaks ---------------------------------------------------
// A streak counts consecutive local days where ALL daily quests were
// finished. Completing today: yesterday's completion extends the
// streak, anything older restarts it at 1, a same-day repeat is a
// no-op (the caller only fires once a day, but stay safe).
export function nextStreak(prevStreak: number, lastAllDone: string, today: string): number {
  if (lastAllDone === today) return Math.max(1, prevStreak);
  if (lastAllDone === shiftDateStr(today, -1)) return Math.max(0, prevStreak) + 1;
  return 1;
}

/** Streak bonus for finishing all dailies: +10 per streak day, capped. */
export function streakBonus(streak: number): number {
  return Math.min(70, Math.max(0, streak) * 10);
}

// ---- ISO weeks (weekly quests) ---------------------------------------
/** ISO-8601 week key, e.g. "2026-W47" (weeks start Monday). */
export function isoWeekKey(d: Date): string {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Shift to the Thursday of this week — its year owns the week number.
  const isoDay = ((date.getDay() + 6) % 7) + 1; // Mon=1 .. Sun=7
  date.setDate(date.getDate() + (4 - isoDay));
  const year = date.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Days left in the current ISO week including today (Mon=7 .. Sun=1). */
export function weekDaysLeft(d: Date): number {
  const isoDay = ((d.getDay() + 6) % 7) + 1;
  return 8 - isoDay;
}

// ---- Citizen Rank ------------------------------------------------------
// Cumulative XP needed to REACH each rank (index 0 = rank 1).
export const RANK_THRESHOLDS: readonly number[] = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
export const RANK_TITLES: readonly string[] = [
  "Visitor",
  "Newcomer",
  "Citizen",
  "Local",
  "Hustler",
  "Player",
  "Big Shot",
  "Tycoon",
  "Kingpin",
  "City Legend",
];

export interface RankInfo {
  /** 1-based rank. */
  rank: number;
  title: string;
  /** XP earned inside the current rank. */
  into: number;
  /** XP span of the current rank (0 at max rank). */
  span: number;
  /** Cumulative XP at which the next rank lands (null at max rank). */
  nextAt: number | null;
}

export function rankForXp(xp: number): RankInfo {
  const total = Math.max(0, Math.floor(xp));
  let rank = 1;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (total >= RANK_THRESHOLDS[i]) rank = i + 1;
  }
  const floor = RANK_THRESHOLDS[rank - 1];
  const nextAt = rank < RANK_THRESHOLDS.length ? RANK_THRESHOLDS[rank] : null;
  return {
    rank,
    title: RANK_TITLES[rank - 1],
    into: total - floor,
    span: nextAt === null ? 0 : nextAt - floor,
    nextAt,
  };
}

/** One-time City Sol bonus paid when a rank is reached. */
export function rankUpBonus(rank: number): number {
  return rank * 100;
}

// ---- Favor pay ---------------------------------------------------------
// One favor pays 40–90 City Sol scaled by the one-way distance from
// the quest giver to the favor's target, rounded to a clean 5.
export function favorRewardFor(oneWayDist: number): number {
  const raw = 40 + Math.max(0, oneWayDist) / 10;
  return Math.min(90, Math.max(40, Math.round(raw / 5) * 5));
}

// ---- Delivery / taxi board pay ----------------------------------------
// Base pay scales with the paying leg (pickup → dropoff). The time
// tier compares the full run (accept → dropoff) against a par built
// from the whole route at city pace: gold (≤ par) pays the full
// bonus, silver (≤ 1.4× par) pays half, later pays base only.
export interface BoardPay {
  base: number;
  bonus: number;
  total: number;
  tier: "gold" | "silver" | "base";
}

function boardPay(kind: "delivery" | "taxi", legDist: number, timeMs: number, parMs: number): BoardPay {
  const base =
    kind === "delivery"
      ? Math.min(150, Math.max(60, Math.round(50 + legDist * 0.16)))
      : Math.min(130, Math.max(50, Math.round(45 + legDist * 0.15)));
  const maxBonus = 30;
  let tier: BoardPay["tier"] = "base";
  let bonus = 0;
  if (parMs > 0 && timeMs <= parMs) {
    tier = "gold";
    bonus = maxBonus;
  } else if (parMs > 0 && timeMs <= parMs * 1.4) {
    tier = "silver";
    bonus = Math.floor(maxBonus / 2);
  }
  return { base, bonus, total: base + bonus, tier };
}

export function deliveryPay(legDist: number, timeMs: number, parMs: number): BoardPay {
  return boardPay("delivery", legDist, timeMs, parMs);
}

export function taxiPay(legDist: number, timeMs: number, parMs: number): BoardPay {
  return boardPay("taxi", legDist, timeMs, parMs);
}

/** Par for a board run: whole route at ~13 units/sec of avenue pace. */
export function boardParMs(routeDist: number): number {
  return Math.round((Math.max(0, routeDist) / 13) * 1000);
}
