// MODES CORE (pure logic, no DOM / no storage): the scoring maths for
// the two scored street modes — Hijack runs and Bank Heists — plus the
// heist cooldown. Everything here is a pure function so
// tests/modes.test.mjs can pin it down; runtime.ts owns the state,
// this file owns the numbers. All payouts are City Sol (the game's own
// money) and land through the existing earn() path in the runtime.

// ---- Hijack Mode -------------------------------------------------------
// A run scores while you drive the marked car: distance accrues at a
// per-unit rate multiplied by your wanted level — the hotter the heat,
// the faster the money. Scoring stops at the 5-minute cap (the run
// itself continues until you ditch + evade, or get busted).
export const HIJACK_RATE_PER_UNIT = 0.35;
export const HIJACK_SCORE_CAP_MS = 300_000;
/** Getting busted mid-run banks this fraction of the accrued score. */
export const HIJACK_BUST_FRACTION = 0.1;

/** Wanted multiplier: 1× clean, +0.5 per star, so 5 stars pays 3.5×. */
export function hijackStarMult(wanted: number): number {
  const stars = Math.max(0, Math.min(5, Math.floor(wanted)));
  return 1 + 0.5 * stars;
}

/** City Sol accrued for driving `distUnits` at a steady wanted level. */
export function hijackAccrue(distUnits: number, wanted: number): number {
  if (distUnits <= 0) return 0;
  return distUnits * HIJACK_RATE_PER_UNIT * hijackStarMult(wanted);
}

/** What a busted run still banks: 10% of the accrued score, floored. */
export function hijackConsolation(accrued: number): number {
  return Math.floor(Math.max(0, accrued) * HIJACK_BUST_FRACTION);
}

/**
 * XP for a banked hijack run: a flat 12 plus a score tier —
 * ≥50 accrued adds 4, ≥120 adds 8, ≥250 adds 15.
 */
export function hijackXp(accrued: number): number {
  const a = Math.max(0, accrued);
  const tier = a >= 250 ? 15 : a >= 120 ? 8 : a >= 50 ? 4 : 0;
  return 12 + tier;
}

// ---- Bank Heist Mode ---------------------------------------------------
// Crack the vault: 20s of holding the vault zone secures the base
// loot. Greed pays — every extra full 5s of cracking (up to 35s)
// adds 100 — but the alarm keeps raising the heat while you crack.
export const HEIST_CRACK_MS = 20_000;
export const HEIST_MAX_CRACK_MS = 35_000;
export const HEIST_BASE_LOOT = 400;
export const HEIST_GREED_STEP_MS = 5_000;
export const HEIST_GREED_STEP_LOOT = 100;
/** Real-time cooldown between heists (10 minutes). */
export const HEIST_COOLDOWN_MS = 600_000;
/** XP for a banked heist (flat — the loot is the variable part). */
export const HEIST_XP = 25;

/** Loot secured after `crackMs` in the vault (0 before the crack lands). */
export function heistLootFor(crackMs: number): number {
  if (crackMs < HEIST_CRACK_MS) return 0;
  const extraSteps = Math.min(
    3,
    Math.floor((Math.min(crackMs, HEIST_MAX_CRACK_MS) - HEIST_CRACK_MS) / HEIST_GREED_STEP_MS),
  );
  return HEIST_BASE_LOOT + extraSteps * HEIST_GREED_STEP_LOOT;
}

/** The crack is done (loot securable) once this much time is banked. */
export function heistCrackDone(crackMs: number): boolean {
  return crackMs >= HEIST_CRACK_MS;
}

/**
 * Wanted level the alarm raises you TO while cracking: 2 stars the
 * moment the crack starts, 3 once you're 10s in, 4 if you greed past
 * 30s. Never lowers an existing higher level (the caller maxes).
 */
export function heistStarsFor(crackMs: number): number {
  if (crackMs >= 30_000) return 4;
  if (crackMs >= 10_000) return 3;
  return 2;
}

/** Whole seconds of heist cooldown left (0 = ready to plan again). */
export function heistCooldownSecs(readyAt: number, now: number): number {
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
}
