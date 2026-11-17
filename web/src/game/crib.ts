// ---------------------------------------------------------------------------
// OrbitX City — CRIB (home life): bills, sleep + energy, pets, home
// upgrades, walls & floors, working stuff (TV / fridge / lights).
// ---------------------------------------------------------------------------
// Client mirror of the server CRIB block in api/city.js — the server is
// the price authority; this file is display + the offline/validation
// mirror. All City Sol, per (player, server). Data lives in the existing
// player_saves `homes` JSON column and rides on `me.crib` (see
// api/city.js sanitizeCrib); the client never invents prices.
// ---------------------------------------------------------------------------

import type { HomeDef } from "./homes";

export interface CribBill {
  homeId: string;
  amount: number;
  dueAt: number;
  paidUntil: number;
  overdue: boolean;
  lightsOff: boolean;
}

export interface CribHomeState {
  homeId: string;
  tier: number;
  tierName: string;
  decor: { wall: string; floor: string; light: string };
  style: { exterior: string; roof: string; yard: string };
  lightsOn: boolean;
  tvOn: boolean;
  bills: CribBill;
}

export interface CribPetState {
  kind: string;
  name: string;
  happy: boolean;
  fedAt: number;
}

export interface CribState {
  energy: number;
  pet: CribPetState | null;
  food: Record<string, number>;
  homes: CribHomeState[];
}

export function emptyCrib(): CribState {
  return { energy: 100, pet: null, food: {}, homes: [] };
}

export function cribForHome(crib: CribState | undefined | null, homeId: string): CribHomeState | null {
  if (!crib) return null;
  return crib.homes.find((h) => h.homeId === homeId) ?? null;
}

/** Weekly bill: rent (2% of price, min 40) + lights (20). Mirrors the server. */
export function cribBillAmount(price: number): number {
  return Math.max(40, Math.round(price * 0.02)) + 20;
}

export const CRIB_TIERS: { tier: number; name: string; price: number; blurb: string }[] = [
  { tier: 0, name: "Apartment", price: 0, blurb: "Your starter pad." },
  { tier: 1, name: "House", price: 1500, blurb: "A second lounge, a bookshelf, room to breathe." },
  { tier: 2, name: "Mansion", price: 5000, blurb: "Dining set, fireplace glow, gold trim." },
  { tier: 3, name: "Penthouse", price: 12000, blurb: "Chandelier, gold trim, a balcony over the city." },
];

export function nextTier(tier: number) {
  return CRIB_TIERS[tier + 1] ?? null;
}

export const CRIB_PETS: Record<string, { name: string; price: number; blurb: string }> = {
  dog: { name: "Dog", price: 500, blurb: "A loyal dog — follows you around your home." },
  cat: { name: "Cat", price: 400, blurb: "A cool cat — follows you around your home." },
};

export const CRIB_FOODS: Record<string, { name: string; price: number; energy: number }> = {
  pizza: { name: "Pizza slice", price: 12, energy: 12 },
  burger: { name: "Burger", price: 10, energy: 10 },
  soda: { name: "Soda", price: 5, energy: 4 },
  petfood: { name: "Pet food", price: 15, energy: 0 },
};

export const CRIB_WALLS: Record<string, { name: string; price: number; color: number }> = {
  cream: { name: "Cream paint", price: 60, color: 0xe8dcc8 },
  gold: { name: "Gold paint", price: 80, color: 0xe0b33a },
  cyan: { name: "Aqua paint", price: 60, color: 0x7eefff },
  red: { name: "Ember paint", price: 60, color: 0xd43a2e },
  black: { name: "Midnight paint", price: 60, color: 0x16181f },
  white: { name: "Cloud paint", price: 60, color: 0xf4f6fa },
};

export const CRIB_FLOORS: Record<string, { name: string; price: number; color: number }> = {
  wood: { name: "Wood floor", price: 80, color: 0x8a5a2e },
  marble: { name: "Marble floor", price: 150, color: 0xe8e8ec },
  gold: { name: "Gold floor", price: 120, color: 0xe0b33a },
  black: { name: "Onyx floor", price: 100, color: 0x16181f },
  grass: { name: "Grass floor", price: 90, color: 0x4a9a3a },
};

export const CRIB_LIGHTS: Record<string, { name: string; price: number; color: number }> = {
  warm: { name: "Warm lights", price: 50, color: 0xffd9a0 },
  cool: { name: "Cool lights", price: 50, color: 0xdfefff },
  gold: { name: "Gold lights", price: 70, color: 0xe0b33a },
  cyan: { name: "Aqua lights", price: 60, color: 0x7eefff },
};

/** Energy -> speed multiplier. Mirrors the server's rested rule (>= 70). */
export function energySpeedFactor(energy: number): number {
  if (energy <= 0) return 0.65;
  if (energy >= 70) return 1.15;
  return 1;
}

export function energyLabel(energy: number): string {
  if (energy <= 0) return "Exhausted";
  if (energy < 30) return "Tired";
  if (energy >= 70) return "Rested";
  return "Awake";
}

/** Client-side drain: 1 energy per 15 s while moving, per 60 s idle. */
export const CRIB_DRAIN_ACTIVE_MS = 15000;
export const CRIB_DRAIN_IDLE_MS = 60000;

/**
 * The bed spot inside a state home — same placement as homes.ts
 * furnishStateHome (south-east, or south-west when the kitchen is on
 * the south-east side). The runtime's sleep prompt + the pet's home
 * anchor both read this, so the bed is one fact, not two guesses.
 */
export function bedSpot(home: HomeDef): { x: number; z: number } {
  const bedSE = home.door === "s" || home.door === "e";
  return {
    x: bedSE ? home.x0 + home.w - 3.4 : home.x0 + 3.4,
    z: home.z0 + home.d - 3.4,
  };
}

/** The fridge spot — the kitchenette's fridge, same as furnishStateHome. */
export function fridgeSpot(home: HomeDef): { x: number; z: number } {
  const alongX = home.door === "n" || home.door === "s";
  const cx = home.x0 + home.w / 2;
  const cz = home.z0 + home.d / 2;
  const backZ = home.door === "n" ? home.z0 + home.d - 2.4 : home.z0 + 2.4;
  const backX = home.door === "w" ? home.x0 + home.w - 2.4 : home.x0 + 2.4;
  if (alongX) return { x: cx + 5 + 2.8, z: backZ };
  return { x: backX, z: cz + 5 + 2.8 };
}

/** The TV spot — the far wall, same as furnishStateHome's back point. */
export function tvSpot(home: HomeDef): { x: number; z: number } {
  const cx = home.x0 + home.w / 2;
  const cz = home.z0 + home.d / 2;
  if (home.door === "w") return { x: home.x0 + home.w - 2.4, z: cz };
  if (home.door === "e") return { x: home.x0 + 2.4, z: cz };
  if (home.door === "n") return { x: cx, z: home.z0 + home.d - 2.4 };
  return { x: cx, z: home.z0 + 2.4 };
}

/** The door's outside point, for the "lights off — bills due" notice. */
export function doorSpot(home: HomeDef): { x: number; z: number } {
  const cx = home.x0 + home.w / 2;
  const cz = home.z0 + home.d / 2;
  if (home.door === "w") return { x: home.x0 - 1.5, z: cz };
  if (home.door === "e") return { x: home.x0 + home.w + 1.5, z: cz };
  if (home.door === "n") return { x: cx, z: home.z0 - 1.5 };
  return { x: cx, z: home.z0 + home.d + 1.5 };
}

/** Days left on a bill, for the panel ("due in 3 days" / "overdue"). */
// ---------------------------------------------------------------------------
// EXTERIOR + THEMES — client mirrors of the server catalogs in api/city.js.
// The server owns prices and validation; these mirrors carry the render
// colours (trim / roof / yard) and the theme preset copy for the editor.
// ---------------------------------------------------------------------------

/** Exterior trim (front band + door frame) — "default" renders nothing. */
export const HOME_EXTERIORS: Record<string, { label: string; price: number; trim: number }> = {
  default: { label: "Classic trim", price: 0, trim: 0xe8dcc8 },
  gold: { label: "Gold trim", price: 150, trim: 0xe0b33a },
  beach: { label: "Beach trim", price: 120, trim: 0x7eefff },
  neon: { label: "Neon trim", price: 180, trim: 0xff5ad0 },
  midnight: { label: "Midnight trim", price: 150, trim: 0x3a4a6b },
};

/** Roof edge — "standard" renders nothing. */
export const HOME_ROOFS: Record<string, { label: string; price: number; roof: number }> = {
  standard: { label: "Standard roof", price: 0, roof: 0x8a5a2e },
  gold: { label: "Gold roof", price: 120, roof: 0xe0b33a },
  neon: { label: "Neon roof", price: 150, roof: 0xff5ad0 },
};

/** Front yard — "none" renders nothing. */
export const HOME_YARDS: Record<string, { label: string; price: number; yard: number }> = {
  none: { label: "No yard", price: 0, yard: 0x000000 },
  deck: { label: "Wooden deck", price: 200, yard: 0x8a5a2e },
  patio: { label: "Stone patio", price: 150, yard: 0x9aa0a8 },
  garden: { label: "Garden", price: 100, yard: 0x3a7d44 },
};

/** One-tap presets: interior decor + exterior together. */
export const HOME_THEMES: Record<string, { label: string; price: number; wall: string; floor: string; light: string; exterior: string; roof: string; yard: string }> = {
  classic: { label: "Classic", price: 0, wall: "cream", floor: "wood", light: "warm", exterior: "default", roof: "standard", yard: "none" },
  "orbitx-gold": { label: "OrbitX Gold", price: 400, wall: "gold", floor: "gold", light: "gold", exterior: "gold", roof: "gold", yard: "deck" },
  beach: { label: "Beach House", price: 250, wall: "cream", floor: "wood", light: "warm", exterior: "beach", roof: "standard", yard: "patio" },
  neon: { label: "Neon Nights", price: 350, wall: "black", floor: "black", light: "cyan", exterior: "neon", roof: "neon", yard: "none" },
  midnight: { label: "Midnight", price: 300, wall: "black", floor: "marble", light: "cool", exterior: "midnight", roof: "standard", yard: "garden" },
};

/** Office themes — same presets, applied to a claimed office suite. */
export const OFFICE_THEMES: Record<string, { label: string; price: number }> = {
  default: { label: "Default", price: 0 },
  gold: { label: "OrbitX Gold", price: 200 },
  beach: { label: "Beach", price: 200 },
  neon: { label: "Neon Nights", price: 200 },
  midnight: { label: "Midnight", price: 200 },
};

export function billDaysLeft(bill: CribBill, now = Date.now()): number {
  return Math.ceil((bill.dueAt - now) / 86400000);
}
