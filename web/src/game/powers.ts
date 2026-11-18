// HERO POWERS — wave 1: 12 TV-inspired heroes (renamed, launch-safe versions).
// Pure logic: no three.js, no DOM, no imports — unit-testable in node via
// esbuild (same pattern as the doors-floor probe). The runtime (runtime.ts)
// owns the live state (cooldowns, projectiles, NPC overrides) and calls
// these helpers; nothing here touches the scene.
//
// Power model: every hero look maps to exactly one PowerDef. Press powers
// fire once per press (KeyY / HUD Power button); hold powers stay active
// while held (Speed Force). Trick arrows cycle one type per shot.

export type PowerId =
  | "speed-force"
  | "trick-arrows"
  | "crossbow"
  | "katana"
  | "bessie"
  | "rally"
  | "stealth"
  | "sharpshooter"
  | "baton"
  | "charm"
  | "staff";

export type TrickArrow = "standard" | "explosive" | "smoke";

export const TRICK_ARROWS: TrickArrow[] = ["standard", "explosive", "smoke"];

export const TRICK_ARROW_LABEL: Record<TrickArrow, string> = {
  standard: "Standard",
  explosive: "Explosive",
  smoke: "Smoke",
};

export interface PowerDef {
  id: PowerId;
  /** Hero look id (characters.json). */
  heroId: string;
  heroName: string;
  name: string;
  blurb: string;
  key: string;
  /** Cooldown after the power ends (ms). */
  cooldownMs: number;
  /** How long the effect lasts once active (ms, 0 = instant). */
  durationMs: number;
  /** Melee / projectile / aura radius in world units. */
  range: number;
  /** Melee arc in degrees (360 = full sweep). */
  arcDeg: number;
  /** True = active while held (Speed Force). */
  hold: boolean;
  /** Speed multiplier while the power is active. */
  speedMult?: number;
  /** True = fires trick arrows, one type per shot. */
  trick?: boolean;
}

export const POWER_DEFS: PowerDef[] = [
  {
    id: "rally",
    heroId: "cole-maddox",
    heroName: "Sheriff Cole Maddox",
    name: "Rally",
    blurb: "Nearby citizens rally to you and follow for 20s. You run 25% faster while they do.",
    key: "KeyY",
    cooldownMs: 30000,
    durationMs: 20000,
    range: 12,
    arcDeg: 360,
    hold: false,
    speedMult: 1.25,
  },
  {
    id: "crossbow",
    heroId: "ryder-cross",
    heroName: "Ryder Cross",
    name: "Crossbow",
    blurb: "Silent bolt at range. Firing it also pings nearby citizens and spots for 10s.",
    key: "KeyY",
    cooldownMs: 3000,
    durationMs: 0,
    range: 35,
    arcDeg: 0,
    hold: false,
  },
  {
    id: "katana",
    heroId: "mika-reyes",
    heroName: "Mika Reyes",
    name: "Katana Combo",
    blurb: "Fast slashes in a wide arc in front of you.",
    key: "KeyY",
    cooldownMs: 1200,
    durationMs: 0,
    range: 3.2,
    arcDeg: 100,
    hold: false,
  },
  {
    id: "stealth",
    heroId: "carolyn-marsh",
    heroName: "Carolyn Marsh",
    name: "Vanish",
    blurb: "Undetectable for 12s — citizens ignore you and you go translucent.",
    key: "KeyY",
    cooldownMs: 25000,
    durationMs: 12000,
    range: 0,
    arcDeg: 0,
    hold: false,
  },
  {
    id: "bessie",
    heroId: "nolan-graves",
    heroName: "Nolan Graves",
    name: "Bessie",
    blurb: "Heavy swing with big knockback. Citizens nearby flee in fear for 6s.",
    key: "KeyY",
    cooldownMs: 3500,
    durationMs: 0,
    range: 3.5,
    arcDeg: 110,
    hold: false,
  },
  {
    id: "sharpshooter",
    heroId: "maggie-hart",
    heroName: "Maggie Hart",
    name: "Deadeye Shot",
    blurb: "Long-range rifle shot with a scope zoom.",
    key: "KeyY",
    cooldownMs: 6000,
    durationMs: 0,
    range: 60,
    arcDeg: 0,
    hold: false,
  },
  {
    id: "rally",
    heroId: "mara-clarke",
    heroName: "Mara Clarke",
    name: "Rally",
    blurb: "Nearby citizens rally to you and follow for 15s. You run 15% faster while they do.",
    key: "KeyY",
    cooldownMs: 30000,
    durationMs: 15000,
    range: 8,
    arcDeg: 360,
    hold: false,
    speedMult: 1.15,
  },
  {
    id: "baton",
    heroId: "alyssa-clark",
    heroName: "Alyssa Clark",
    name: "Baton Combo",
    blurb: "Fast close-range baton strikes.",
    key: "KeyY",
    cooldownMs: 900,
    durationMs: 0,
    range: 2.6,
    arcDeg: 90,
    hold: false,
  },
  {
    id: "charm",
    heroId: "victor-vale",
    heroName: "Victor Vale",
    name: "Silver Tongue",
    blurb: "Nearby citizens stop what they are doing and gather around you for 15s.",
    key: "KeyY",
    cooldownMs: 30000,
    durationMs: 15000,
    range: 10,
    arcDeg: 360,
    hold: false,
  },
  {
    id: "staff",
    heroId: "morgan-pierce",
    heroName: "Morgan Pierce",
    name: "Bo Staff Sweep",
    blurb: "A full 360° staff sweep that knocks back everyone close.",
    key: "KeyY",
    cooldownMs: 3000,
    durationMs: 0,
    range: 3.8,
    arcDeg: 360,
    hold: false,
  },
  {
    id: "speed-force",
    heroId: "dash-vance",
    heroName: "Dash Vance",
    name: "Speed Force",
    blurb: "Hold to run at 3x speed with a lightning trail. 5s recharge after it ends.",
    key: "KeyY",
    cooldownMs: 5000,
    durationMs: 8000,
    range: 0,
    arcDeg: 0,
    hold: true,
    speedMult: 3,
  },
  {
    id: "trick-arrows",
    heroId: "owen-quinn",
    heroName: "Owen Quinn",
    name: "Trick Arrows",
    blurb: "Ranged arrows — one type per shot, cycling Standard, Explosive, Smoke.",
    key: "KeyY",
    cooldownMs: 2500,
    durationMs: 0,
    range: 40,
    arcDeg: 0,
    hold: false,
    trick: true,
  },
];

export function powerForLook(lookId: string): PowerDef | null {
  return POWER_DEFS.find((def) => def.heroId === lookId) ?? null;
}

/** Next trick arrow in the cycle (one type per shot). */
export function nextTrickArrow(current: TrickArrow): TrickArrow {
  const index = TRICK_ARROWS.indexOf(current);
  return TRICK_ARROWS[(index + 1) % TRICK_ARROWS.length];
}

export function cooldownReady(nowMs: number, lastUsedAtMs: number, cooldownMs: number): boolean {
  return nowMs - lastUsedAtMs >= cooldownMs;
}

export function cooldownRemainingMs(nowMs: number, lastUsedAtMs: number, cooldownMs: number): number {
  return Math.max(0, lastUsedAtMs + cooldownMs - nowMs);
}

export function isPowerActive(nowMs: number, activeUntilMs: number): boolean {
  return nowMs < activeUntilMs;
}

/** Speed multiplier a power grants while active (1 when inactive). */
export function powerSpeedMult(def: PowerDef | null, nowMs: number, activeUntilMs: number): number {
  if (!def || !def.speedMult) return 1;
  return isPowerActive(nowMs, activeUntilMs) ? def.speedMult : 1;
}

/** Wrapped angle difference in [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Melee arc check. The game measures yaw as atan2(dx, -dz) — forward is
 * (sin(yaw), -cos(yaw)) — so a target's yaw-angle is atan2(tx - px, -(tz - pz)).
 * arcDeg 360 always hits within range.
 */
export function inMeleeArc(
  px: number,
  pz: number,
  yaw: number,
  tx: number,
  tz: number,
  range: number,
  arcDeg: number,
): boolean {
  const dx = tx - px;
  const dz = tz - pz;
  if (Math.hypot(dx, dz) > range) return false;
  if (arcDeg >= 360) return true;
  const targetAngle = Math.atan2(dx, -dz);
  return Math.abs(angleDiff(targetAngle, yaw)) <= ((arcDeg / 2) * Math.PI) / 180;
}
