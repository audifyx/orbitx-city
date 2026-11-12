// vehicles.ts — OrbitX City vehicle system (GTA / FiveM expansion).
//
// NEW MODULE, not wired yet: nothing in the game imports this file, so it
// is dead code until the wiring steps in WIRING.md (repo root) are applied.
// It compiles under the project's TypeScript on its own.
//
// DESIGN — "clone each to look similar but different":
//   Every vehicle is built by ONE shared builder (buildVehicle) from ONE
//   parametric body-plan system (BodyPlan). Same pattern, distinct character:
//   each catalog entry supplies its own proportions — length, width, body
//   height, cabin position/length/height, hood, trunk/bed, spoiler, rails,
//   fenders, wheel size and axle placement — plus its own extra parts
//   (light bars, scoops, falcon doors, thruster pods...). The builder never
//   recolors one box and calls it a new car: a Cybertruck wedge, a limo
//   stretch, a low sportbike and a skateboard deck are different shapes
//   coming out of the same template.
//   Follows the existing makeCar approach in runtime.ts: one shared unit
//   BoxGeometry, scaled meshes, wheels named "wheel" (so the existing
//   wheel-spin code in drive() keeps working), and group.userData.paints
//   (so the existing retint() keeps working).
//
// ECONOMY: every price is City Sol. No real money, no burn, no ORBITX.
//   Prices are balanced against job pay (40-90 City Sol per job) and the
//   old repaint-only car colors (50-80 City Sol): a starter car is a few
//   jobs' pay, the Roadster is a long-term goal.

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
} from "three";
import { GOLD, MATERIALS } from "./materials";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VehicleKind = "car" | "flying" | "bike" | "atv" | "skateboard";

/** 0-10 display stats. Physics mapping lives in driveParamsFor(). */
export interface VehicleStats {
  /** Top speed, 0-10. */
  speed: number;
  /** Acceleration, 0-10. */
  accel: number;
  /** Handling / steering, 0-10. */
  handling: number;
  /** Seats (passengers are visual only for now — see WIRING.md). */
  seats: number;
}

export type PartMat =
  | "paint"
  | "glass"
  | "chrome"
  | "dark"
  | "gold"
  | "white"
  | "headlight"
  | "tail"
  | "tire"
  | "glow";

/** One extra box part, in vehicle-local space. Front of the car is +X.
 * `name` is the mesh name when built — "rotor" (helicopter main rotor)
 * and "prop" (propeller blades) are spun by drive() while airborne or
 * moving; anything else is unnamed. */
export interface VehiclePart {
  mat: PartMat;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  name?: string;
}

/** One wheel, in vehicle-local space. Named "wheel" when built. */
export interface WheelSpec {
  x: number;
  z: number;
  /** Wheel radius. */
  r: number;
  /** Wheel width (axle direction). */
  w: number;
}

/**
 * Parametric body plan. One template, every field per-vehicle.
 * All sizes are in world units; front of the vehicle is +X, ground is y=0.
 */
export interface BodyPlan {
  /** Overall body length (nose to tail). */
  length: number;
  /** Overall body width. */
  width: number;
  /** Center height of the main body slab. */
  bodyY: number;
  /** Height of the main body slab. */
  bodyH: number;
  /** Hood / nose section length (front). 0 = no separate hood. */
  hoodLen: number;
  /** Hood slab height (sits on top of the body slab's front). */
  hoodH: number;
  /** Cabin center X (negative = toward the rear). */
  cabinX: number;
  /** Cabin length. 0 = open-top (roadster / bike): no cabin box. */
  cabinLen: number;
  /** Cabin height above the body slab. */
  cabinH: number;
  /** Cabin width. */
  cabinW: number;
  /** True = glass canopy over the cabin (see-through), false = painted roof. */
  glassCabin: boolean;
  /** Trunk / rear deck length. 0 = none. */
  trunkLen: number;
  /** Open pickup bed length. 0 = no bed (not a truck). */
  bedLen: number;
  /** Rear spoiler blade. Omit = none. */
  spoiler?: { x: number; y: number; w: number; h: number };
  /** Roof rails (wagon / SUV). */
  rails?: boolean;
  /** Fender flares over the wheels. */
  fenders?: boolean;
  /** Side skirts along the lower body. */
  skirt?: boolean;
  /** Full-width front + rear light bars (Cybertruck / Cybercab / Roadster). */
  lightBar?: boolean;
  /** Single sloped wedge body (Cybertruck): cabin is a sloped slab, no glass. */
  wedge?: boolean;
  /** Extra signature parts for this vehicle only. */
  extras?: VehiclePart[];
}

/** One catalog entry. */
export interface VehicleDef {
  id: string;
  name: string;
  /** Shown in the shop ("Orbit" / "Tesla" / ...). */
  brand: string;
  kind: VehicleKind;
  /** True = this vehicle flies (see fly rules below). */
  fly: boolean;
  /** Max cruise altitude in world units (flying vehicles only). */
  maxAltitude?: number;
  /** Climb rate in world units / second (flying vehicles only).
   * Default 10. The blimp climbs gently at 4, the jet at 12. */
  climb?: number;
  /** One line for the shop card. Black text on white, white on black. */
  blurb: string;
  /** Price in City Sol. */
  price: number;
  stats: VehicleStats;
  plan: BodyPlan;
  wheels: WheelSpec[];
  /** Paint keys this vehicle can wear (see VEHICLE_COLORS). */
  colors: string[];
  /** Default paint key. */
  defaultColor: string;
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

/** Paint keys -> hex. Mirrors the COLORS map in runtime.ts, plus Tesla tones. */
export const VEHICLE_COLORS: Record<string, number> = {
  white: 0xf4f6fa,
  black: 0x16181f,
  gold: 0xe0b33a,
  cyan: 0x7eefff,
  sunset: 0xff7a3c,
  red: 0xd43a2e,
  silver: 0xc9ced6,
  blue: 0x2456d6,
  green: 0x2e7d4f,
  purple: 0x7a3fd1,
  pink: 0xff6fa5,
  orange: 0xff8c1a,
  pearl: 0xeef1f6,
  midnight: 0x1b2a3a,
  quicksilver: 0x9aa3ad,
  stealth: 0x3a3f45,
  crimson: 0x8f1d22,
  lime: 0xa8d81a,
};

const STANDARD_COLORS = ["white", "black", "silver", "red", "blue", "cyan", "gold"];
const TESLA_COLORS = ["pearl", "midnight", "quicksilver", "stealth", "crimson", "red", "blue", "white", "black"];

// ---------------------------------------------------------------------------
// Customization — CARS expansion (City Sol only, no burn).
// Premium paints live here, NOT in VEHICLE_COLORS: the shop color picker
// iterates VEHICLE_COLORS, so a premium key there would be a free repaint
// at buy time. Premium paint is bought per-car via customize-car (150)
// and then rides on the vehicle's `color` field like any other paint.
// paintHex() resolves both maps, so buildVehicle/retint just work.
// ---------------------------------------------------------------------------

/** Premium paint keys -> hex. Bought per car, 150 City Sol each. */
export const CUSTOM_PAINT_HEX: Record<string, number> = {
  "matte-black": 0x1a1a1c,
  chrome: 0xdfe3e8,
  "rose-gold": 0xe0a387,
  "pearl-pink": 0xf2c4d4,
  mint: 0x9fe8c0,
  "midnight-purple": 0x2e1a4d,
  lava: 0xff4d00,
  ice: 0xcfeeff,
};

export const CUSTOM_PAINT_PRICE = 150;
export const CUSTOM_PAINT_NAMES: Record<string, string> = {
  "matte-black": "Matte Black",
  chrome: "Chrome",
  "rose-gold": "Rose Gold",
  "pearl-pink": "Pearl Pink",
  mint: "Mint",
  "midnight-purple": "Midnight Purple",
  lava: "Lava",
  ice: "Ice",
};

export type RimStyle = "stock" | "sport" | "chrome" | "gold" | "black";
export const RIM_STYLES: RimStyle[] = ["stock", "sport", "chrome", "gold", "black"];
export const RIM_PRICES: Record<RimStyle, number> = { stock: 0, sport: 200, chrome: 250, gold: 300, black: 150 };
export const RIM_NAMES: Record<RimStyle, string> = {
  stock: "Stock",
  sport: "Sport",
  chrome: "Chrome",
  gold: "Gold",
  black: "Stealth Black",
};

export type SpoilerStyle = "none" | "lip" | "gt" | "drag" | "delete";
export const SPOILER_STYLES: SpoilerStyle[] = ["none", "lip", "gt", "drag", "delete"];
export const SPOILER_PRICES: Record<SpoilerStyle, number> = { none: 0, lip: 180, gt: 320, drag: 450, delete: 0 };
export const SPOILER_NAMES: Record<SpoilerStyle, string> = {
  none: "As built",
  lip: "Lip spoiler",
  gt: "GT wing",
  drag: "Drag wing",
  delete: "Wing delete",
};

export const NEON_COLORS = ["cyan", "pink", "gold", "green", "purple", "red"] as const;
export const NEON_PRICE = 220;
/** Neon underglow hex per colour key (see NEON_COLORS). */
export const NEON_HEX: Record<string, number> = {
  cyan: 0x00e5ff,
  pink: 0xff4fd8,
  gold: 0xffc93c,
  green: 0x39ff88,
  purple: 0xb26bff,
  red: 0xff3b30,
};
export const NEON_NAMES: Record<string, string> = {
  cyan: "Cyan",
  pink: "Pink",
  gold: "Gold",
  green: "Green",
  purple: "Purple",
  red: "Red",
};

/** Window tint level: 0 clear (free), 1 light, 2 medium, 3 dark. */
export const TINT_PRICES = [0, 80, 140, 200];
export const TINT_NAMES = ["Clear", "Light tint", "Medium tint", "Dark tint"];

/** Engine level: 0 stock, 1-3 tuned. Each level is a real stat change
 * (see driveParamsFor). Levels must be bought in order. */
export const ENGINE_PRICES = [0, 600, 1400, 2600];
export const ENGINE_NAMES = ["Stock engine", "Stage 1 tune", "Stage 2 tune", "Stage 3 tune"];

/** Tire level: 0 stock, 1 street (grip), 2 race (grip+). In order. */
export const TIRE_PRICES = [0, 350, 800];
export const TIRE_NAMES = ["Stock tires", "Street tires", "Race tires"];

/** Per-car mods, stored on the owned-vehicle entry (see OwnedVehicle). */
export interface VehicleMods {
  rims: RimStyle;
  spoiler: SpoilerStyle;
  /** Neon underglow paint key, or null = off. */
  neon: string | null;
  /** Window tint level 0-3. */
  tint: number;
  /** Engine tune level 0-3. */
  engine: number;
  /** Tire level 0-2. */
  tires: number;
}

export const DEFAULT_MODS: VehicleMods = {
  rims: "stock",
  spoiler: "none",
  neon: null,
  tint: 0,
  engine: 0,
  tires: 0,
};

/** Wear: 0-100 each. Dirt builds with driving distance, damage with
 * crashes (see accumulateWear). Both dull the look and soften the stats
 * (see driveParamsFor); wash/repair reset them. */
export interface VehicleWear {
  dirt: number;
  damage: number;
}

export function normalizeMods(mods?: Partial<VehicleMods> | null): VehicleMods {
  const m = mods ?? {};
  return {
    rims: RIM_STYLES.includes(m.rims as RimStyle) ? (m.rims as RimStyle) : "stock",
    spoiler: SPOILER_STYLES.includes(m.spoiler as SpoilerStyle) ? (m.spoiler as SpoilerStyle) : "none",
    neon: typeof m.neon === "string" && (NEON_COLORS as readonly string[]).includes(m.neon) ? m.neon : null,
    tint: Number.isFinite(m.tint) ? Math.max(0, Math.min(3, Math.floor(m.tint as number))) : 0,
    engine: Number.isFinite(m.engine) ? Math.max(0, Math.min(3, Math.floor(m.engine as number))) : 0,
    tires: Number.isFinite(m.tires) ? Math.max(0, Math.min(2, Math.floor(m.tires as number))) : 0,
  };
}

export function normalizeWear(wear?: Partial<VehicleWear> | null): VehicleWear {
  const clamp = (n: unknown) => (Number.isFinite(n as number) ? Math.max(0, Math.min(100, Math.round(n as number))) : 0);
  return { dirt: clamp(wear?.dirt), damage: clamp(wear?.damage) };
}

/** Price of one mod change, or null when the (mod, value) pair is invalid.
 * Mirrors api/city.js — the server is the price authority. */
export function modPrice(mod: string, value: unknown): number | null {
  switch (mod) {
    case "paint":
      return typeof value === "string" && value in CUSTOM_PAINT_HEX ? CUSTOM_PAINT_PRICE : null;
    case "rims":
      return typeof value === "string" && value in RIM_PRICES ? RIM_PRICES[value as RimStyle] : null;
    case "spoiler":
      return typeof value === "string" && value in SPOILER_PRICES ? SPOILER_PRICES[value as SpoilerStyle] : null;
    case "neon":
      if (value === null) return 0;
      return typeof value === "string" && (NEON_COLORS as readonly string[]).includes(value) ? NEON_PRICE : null;
    case "tint": {
      const level = Math.floor(Number(value));
      return Number.isInteger(level) && level >= 0 && level <= 3 ? TINT_PRICES[level] : null;
    }
    case "engine": {
      const level = Math.floor(Number(value));
      return Number.isInteger(level) && level >= 0 && level <= 3 ? ENGINE_PRICES[level] : null;
    }
    case "tires": {
      const level = Math.floor(Number(value));
      return Number.isInteger(level) && level >= 0 && level <= 2 ? TIRE_PRICES[level] : null;
    }
    default:
      return null;
  }
}

/** Wear accumulation: ~1 dirt per 60 units driven, 4 damage per crash.
 * Pure + clamped, so the client and the server apply the same rule. */
export function accumulateWear(
  wear: VehicleWear,
  distance: number,
  crashes: number,
): VehicleWear {
  const d = Math.max(0, Math.min(100, wear.dirt + Math.floor(Math.max(0, distance) / 60)));
  const g = Math.max(0, Math.min(100, wear.damage + Math.max(0, Math.floor(crashes)) * 4));
  return { dirt: d, damage: g };
}

/** Wash price: 30 + dirt (30-130 City Sol). Repair: 50 + 2 per damage
 * point (50-250 City Sol). Mirrors api/city.js. */
export function washCost(dirt: number): number {
  return 30 + Math.max(0, Math.min(100, Math.round(dirt)));
}
export function repairCost(damage: number): number {
  return 50 + Math.max(0, Math.min(100, Math.round(damage))) * 2;
}

// --- Garage upgrades (per-server save, see api/city.js) ------------------
// Base parking: 3 owned cars per universe. Each slots tier adds 2.
// Workshop unlocks tuning/wash/repair at the home garage; showroom puts
// the whole collection on display, lit up.
/** Extra parking slots per universe: 3 base + 2 per tier (max 9). */
export const GARAGE_BASE_SLOTS = 3;
export const GARAGE_SLOT_PRICES = [800, 1800, 3200];
export const GARAGE_WORKSHOP_PRICE = 1500;
export const GARAGE_SHOWROOM_PRICE = 2500;

export interface GarageUpgrades {
  /** Slots tiers bought, 0-3. */
  slots: number;
  workshop: boolean;
  showroom: boolean;
}

export const DEFAULT_GARAGE: GarageUpgrades = { slots: 0, workshop: false, showroom: false };

export function normalizeGarage(g?: Partial<GarageUpgrades> | null): GarageUpgrades {
  return {
    slots: Number.isFinite(g?.slots) ? Math.max(0, Math.min(3, Math.floor(g?.slots as number))) : 0,
    workshop: !!g?.workshop,
    showroom: !!g?.showroom,
  };
}

/** Owned-car cap for a garage level. */
export function garageCap(garage?: GarageUpgrades | null): number {
  return GARAGE_BASE_SLOTS + normalizeGarage(garage).slots * 2;
}

export function garageUpgradePrice(upgrade: string, garage?: GarageUpgrades | null): number | null {
  const g = normalizeGarage(garage);
  if (upgrade === "slots") return g.slots >= 3 ? null : GARAGE_SLOT_PRICES[g.slots];
  if (upgrade === "workshop") return g.workshop ? null : GARAGE_WORKSHOP_PRICE;
  if (upgrade === "showroom") return g.showroom ? null : GARAGE_SHOWROOM_PRICE;
  return null;
}


// ---------------------------------------------------------------------------
// Plan helpers — small builders so each entry reads as its own shape.
// ---------------------------------------------------------------------------

function plan(p: Partial<BodyPlan> & Pick<BodyPlan, "length" | "width">): BodyPlan {
  return {
    bodyY: 0.5,
    bodyH: 0.42,
    hoodLen: 0,
    hoodH: 0.1,
    cabinX: -0.2,
    cabinLen: 1.65,
    cabinH: 0.36,
    cabinW: 1.42,
    glassCabin: true,
    trunkLen: 0,
    bedLen: 0,
    ...p,
  };
}

/** Four wheels: front/rear axles at +/-axle, track +/-track. */
function fourWheels(axle: number, track: number, r: number, w: number): WheelSpec[] {
  return [
    { x: axle, z: track, r, w },
    { x: axle, z: -track, r, w },
    { x: -axle, z: track, r, w },
    { x: -axle, z: -track, r, w },
  ];
}

/** Two inline wheels (bikes): front/rear on the centerline. */
function twoWheels(axle: number, r: number, w: number): WheelSpec[] {
  return [
    { x: axle, z: 0, r, w },
    { x: -axle, z: 0, r, w },
  ];
}

/** Four small deck wheels (skateboard). */
function deckWheels(axle: number, track: number): WheelSpec[] {
  return [
    { x: axle, z: track, r: 0.09, w: 0.08 },
    { x: axle, z: -track, r: 0.09, w: 0.08 },
    { x: -axle, z: track, r: 0.09, w: 0.08 },
    { x: -axle, z: -track, r: 0.09, w: 0.08 },
  ];
}

function def(v: VehicleDef): VehicleDef {
  return v;
}

// ---------------------------------------------------------------------------
// Catalog — City cars
// Each plan is deliberately different: length, stance, cabin and details
// vary so no two cars share a silhouette.
// ---------------------------------------------------------------------------

const CITY_CARS: VehicleDef[] = [
  def({
    id: "city-compact",
    name: "Orbit Compact",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Short tall hatch. Cheap, nippy, parks anywhere.",
    price: 220,
    stats: { speed: 4, accel: 6, handling: 8, seats: 4 },
    plan: plan({
      length: 2.6, width: 1.5, bodyY: 0.52, bodyH: 0.5,
      hoodLen: 0.45, hoodH: 0.08,
      cabinX: -0.1, cabinLen: 1.5, cabinH: 0.42, cabinW: 1.35,
      fenders: true,
      extras: [
        { mat: "dark", x: 1.28, y: 0.5, z: 0, sx: 0.08, sy: 0.2, sz: 1.0 },
        { mat: "chrome", x: 0, y: 0.86, z: 0, sx: 1.1, sy: 0.06, sz: 1.2 },
      ],
    }),
    wheels: fourWheels(0.85, 0.72, 0.26, 0.2),
    colors: [...STANDARD_COLORS, "green", "pink"],
    defaultColor: "cyan",
  }),
  def({
    id: "city-sedan",
    name: "Orbit Sedan",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "The everyday four-door. Balanced in every stat.",
    price: 450,
    stats: { speed: 5, accel: 5, handling: 6, seats: 5 },
    plan: plan({
      length: 3.45, width: 1.62, bodyY: 0.5, bodyH: 0.42,
      hoodLen: 0.62, hoodH: 0.1,
      cabinX: -0.2, cabinLen: 1.65, cabinH: 0.36, cabinW: 1.42,
      trunkLen: 0.55,
      extras: [
        { mat: "chrome", x: 0.9, y: 0.32, z: 0.78, sx: 1.9, sy: 0.06, sz: 0.06 },
        { mat: "chrome", x: 0.9, y: 0.32, z: -0.78, sx: 1.9, sy: 0.06, sz: 0.06 },
      ],
    }),
    wheels: fourWheels(1.15, 0.78, 0.28, 0.22),
    colors: STANDARD_COLORS,
    defaultColor: "black",
  }),
  def({
    id: "city-suv",
    name: "Orbit Ridge SUV",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Tall wagon with roof rails. Room for the whole crew.",
    price: 900,
    stats: { speed: 5, accel: 4, handling: 5, seats: 7 },
    plan: plan({
      length: 3.6, width: 1.7, bodyY: 0.66, bodyH: 0.62,
      hoodLen: 0.6, hoodH: 0.12,
      cabinX: -0.25, cabinLen: 2.2, cabinH: 0.52, cabinW: 1.5,
      rails: true, fenders: true, skirt: true,
      extras: [
        { mat: "gold", x: -0.15, y: 1.52 - 0.06, z: 0, sx: 0.55, sy: 0.16, sz: 0.7 },
        { mat: "dark", x: 0.4, y: 1.05, z: 0, sx: 0.8, sy: 0.06, sz: 1.3 },
      ],
    }),
    wheels: fourWheels(1.2, 0.82, 0.34, 0.26),
    colors: [...STANDARD_COLORS, "green", "orange"],
    defaultColor: "white",
  }),
  def({
    id: "city-sports",
    name: "Orbit Falcon GT",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Low coupe, big wing, loud presence. Fast and twitchy.",
    price: 2800,
    stats: { speed: 9, accel: 9, handling: 8, seats: 2 },
    plan: plan({
      length: 3.7, width: 1.74, bodyY: 0.4, bodyH: 0.32,
      hoodLen: 1.1, hoodH: 0.1,
      cabinX: -0.25, cabinLen: 1.55, cabinH: 0.28, cabinW: 1.42,
      spoiler: { x: -1.55, y: 0.86, w: 0.5, h: 0.07 },
      skirt: true,
      extras: [
        { mat: "dark", x: 1.55, y: 0.42, z: 0, sx: 0.5, sy: 0.12, sz: 1.5 },
        { mat: "gold", x: -0.2, y: 0.62, z: 0.72, sx: 2.2, sy: 0.05, sz: 0.08 },
        { mat: "gold", x: -0.2, y: 0.62, z: -0.72, sx: 2.2, sy: 0.05, sz: 0.08 },
      ],
    }),
    wheels: fourWheels(1.2, 0.8, 0.3, 0.3),
    colors: ["red", "black", "gold", "cyan", "purple", "white"],
    defaultColor: "red",
  }),
  def({
    id: "city-muscle",
    name: "Orbit Thunder V8",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Long hood, hood scoop, fat rear tires. Old-school muscle.",
    price: 2400,
    stats: { speed: 8, accel: 8, handling: 4, seats: 4 },
    plan: plan({
      length: 4.0, width: 1.7, bodyY: 0.48, bodyH: 0.4,
      hoodLen: 1.35, hoodH: 0.14,
      cabinX: -0.55, cabinLen: 1.5, cabinH: 0.34, cabinW: 1.44,
      trunkLen: 0.5,
      extras: [
        // Hood scoop + twin racing stripes.
        { mat: "dark", x: 1.35, y: 0.78, z: 0, sx: 0.7, sy: 0.14, sz: 0.6 },
        { mat: "white", x: 0.1, y: 0.7, z: 0.3, sx: 3.6, sy: 0.03, sz: 0.22 },
        { mat: "white", x: 0.1, y: 0.7, z: -0.3, sx: 3.6, sy: 0.03, sz: 0.22 },
        { mat: "chrome", x: 1.96, y: 0.44, z: 0, sx: 0.08, sy: 0.1, sz: 1.5 },
      ],
    }),
    wheels: [
      { x: 1.35, z: 0.8, r: 0.28, w: 0.24 },
      { x: 1.35, z: -0.8, r: 0.28, w: 0.24 },
      { x: -1.35, z: 0.8, r: 0.32, w: 0.34 },
      { x: -1.35, z: -0.8, r: 0.32, w: 0.34 },
    ],
    colors: ["red", "black", "orange", "gold", "blue", "crimson"],
    defaultColor: "crimson",
  }),
  def({
    id: "city-truck",
    name: "Orbit Hauler",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Pickup with an open bed. Hauls more than groceries.",
    price: 1400,
    stats: { speed: 6, accel: 5, handling: 5, seats: 5 },
    plan: plan({
      length: 4.1, width: 1.72, bodyY: 0.6, bodyH: 0.5,
      hoodLen: 0.7, hoodH: 0.12,
      cabinX: 0.35, cabinLen: 1.25, cabinH: 0.42, cabinW: 1.5,
      bedLen: 1.5, fenders: true,
      extras: [
        // Bed walls + roll bar.
        { mat: "dark", x: -1.5, y: 0.95, z: 0.78, sx: 1.4, sy: 0.3, sz: 0.08 },
        { mat: "dark", x: -1.5, y: 0.95, z: -0.78, sx: 1.4, sy: 0.3, sz: 0.08 },
        { mat: "dark", x: -2.0, y: 0.95, z: 0, sx: 0.08, sy: 0.3, sz: 1.56 },
        { mat: "chrome", x: -0.45, y: 1.18, z: 0.62, sx: 0.1, sy: 0.4, sz: 0.1 },
        { mat: "chrome", x: -0.45, y: 1.18, z: -0.62, sx: 0.1, sy: 0.4, sz: 0.1 },
      ],
    }),
    wheels: fourWheels(1.35, 0.82, 0.34, 0.28),
    colors: [...STANDARD_COLORS, "orange", "green"],
    defaultColor: "blue",
  }),
  def({
    id: "city-van",
    name: "Orbit Metro Van",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Tall delivery box on wheels. Slow, huge, impossible to miss.",
    price: 1100,
    stats: { speed: 4, accel: 3, handling: 4, seats: 3 },
    plan: plan({
      length: 3.9, width: 1.78, bodyY: 0.68, bodyH: 0.66,
      hoodLen: 0.4, hoodH: 0.1,
      cabinX: -0.55, cabinLen: 2.6, cabinH: 0.55, cabinW: 1.6,
      glassCabin: false,
      extras: [
        { mat: "glass", x: 1.35, y: 1.05, z: 0, sx: 0.5, sy: 0.3, sz: 1.4 },
        { mat: "gold", x: -0.55, y: 0.95, z: 0.82, sx: 2.2, sy: 0.28, sz: 0.04 },
        { mat: "gold", x: -0.55, y: 0.95, z: -0.82, sx: 2.2, sy: 0.28, sz: 0.04 },
      ],
    }),
    wheels: fourWheels(1.3, 0.84, 0.3, 0.26),
    colors: ["white", "black", "cyan", "gold", "blue"],
    defaultColor: "white",
  }),
  def({
    id: "city-limo",
    name: "Orbit Grand Limo",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Stretched six-door limo. Turns like a boat, arrives like a boss.",
    price: 5200,
    stats: { speed: 6, accel: 4, handling: 3, seats: 8 },
    plan: plan({
      length: 6.4, width: 1.66, bodyY: 0.5, bodyH: 0.44,
      hoodLen: 0.7, hoodH: 0.1,
      cabinX: -0.4, cabinLen: 3.9, cabinH: 0.38, cabinW: 1.46,
      trunkLen: 0.5, skirt: true,
      extras: [
        { mat: "chrome", x: 0.4, y: 0.34, z: 0.8, sx: 4.6, sy: 0.06, sz: 0.06 },
        { mat: "chrome", x: 0.4, y: 0.34, z: -0.8, sx: 4.6, sy: 0.06, sz: 0.06 },
        { mat: "gold", x: -0.4, y: 0.9, z: 0, sx: 3.6, sy: 0.05, sz: 0.1 },
        { mat: "dark", x: -0.4, y: 0.88, z: 0.55, sx: 3.2, sy: 0.3, sz: 0.04 },
        { mat: "dark", x: -0.4, y: 0.88, z: -0.55, sx: 3.2, sy: 0.3, sz: 0.04 },
      ],
    }),
    wheels: [
      { x: 2.2, z: 0.78, r: 0.28, w: 0.22 },
      { x: 2.2, z: -0.78, r: 0.28, w: 0.22 },
      { x: -1.1, z: 0.78, r: 0.28, w: 0.22 },
      { x: -1.1, z: -0.78, r: 0.28, w: 0.22 },
      { x: -2.2, z: 0.78, r: 0.28, w: 0.22 },
      { x: -2.2, z: -0.78, r: 0.28, w: 0.22 },
    ],
    colors: ["black", "white", "gold", "silver"],
    defaultColor: "black",
  }),
  def({
    id: "city-roadster",
    name: "Orbit Sunset Roadster",
    brand: "Orbit",
    kind: "car",
    fly: false,
    blurb: "Open-top two-seater. No roof, no worries, low windshield.",
    price: 1800,
    stats: { speed: 8, accel: 7, handling: 9, seats: 2 },
    plan: plan({
      length: 3.3, width: 1.6, bodyY: 0.44, bodyH: 0.36,
      hoodLen: 1.0, hoodH: 0.08,
      cabinX: -0.5, cabinLen: 0, cabinH: 0, cabinW: 1.4,
      trunkLen: 0.4, skirt: true,
      extras: [
        // Low windshield + two seat humps + roll hoops.
        { mat: "glass", x: 0.35, y: 0.78, z: 0, sx: 0.08, sy: 0.3, sz: 1.3 },
        { mat: "dark", x: -0.55, y: 0.68, z: 0.38, sx: 0.6, sy: 0.18, sz: 0.55 },
        { mat: "dark", x: -0.55, y: 0.68, z: -0.38, sx: 0.6, sy: 0.18, sz: 0.55 },
        { mat: "chrome", x: -0.95, y: 0.82, z: 0.38, sx: 0.08, sy: 0.22, sz: 0.08 },
        { mat: "chrome", x: -0.95, y: 0.82, z: -0.38, sx: 0.08, sy: 0.22, sz: 0.08 },
      ],
    }),
    wheels: fourWheels(1.1, 0.76, 0.28, 0.26),
    colors: ["sunset", "red", "gold", "cyan", "white", "black"],
    defaultColor: "sunset",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Flying cars
// fly: true. Flight rules in driveParamsFor() + WIRING.md: hold Space to
// climb, Shift/C to descend, gravity off while flying, hard ceiling at
// maxAltitude, landing back on the road returns to ground mode.
// ---------------------------------------------------------------------------

const FLYING_CARS: VehicleDef[] = [
  def({
    id: "fly-skyhopper",
    name: "Skyhopper",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 26,
    blurb: "City car with folding wings. Lifts off the road, parks in the sky.",
    price: 6000,
    stats: { speed: 7, accel: 6, handling: 6, seats: 4 },
    plan: plan({
      length: 3.4, width: 1.6, bodyY: 0.5, bodyH: 0.4,
      hoodLen: 0.6, hoodH: 0.1,
      cabinX: -0.2, cabinLen: 1.6, cabinH: 0.36, cabinW: 1.4,
      extras: [
        // Folded wing panels along the sides + tail fins.
        { mat: "paint", x: -0.1, y: 0.72, z: 0.95, sx: 1.6, sy: 0.06, sz: 0.3 },
        { mat: "paint", x: -0.1, y: 0.72, z: -0.95, sx: 1.6, sy: 0.06, sz: 0.3 },
        { mat: "gold", x: -1.6, y: 0.85, z: 0.5, sx: 0.08, sy: 0.35, sz: 0.3 },
        { mat: "gold", x: -1.6, y: 0.85, z: -0.5, sx: 0.08, sy: 0.35, sz: 0.3 },
        { mat: "glow", x: 0, y: 0.18, z: 0, sx: 2.0, sy: 0.06, sz: 0.5 },
      ],
    }),
    wheels: fourWheels(1.1, 0.76, 0.26, 0.2),
    colors: ["cyan", "white", "silver", "gold", "blue"],
    defaultColor: "cyan",
  }),
  def({
    id: "fly-aero",
    name: "Aero Coupe",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 34,
    blurb: "Sleek flying coupe. Swept wings, glass bubble canopy.",
    price: 9500,
    stats: { speed: 9, accel: 8, handling: 7, seats: 2 },
    plan: plan({
      length: 3.8, width: 1.7, bodyY: 0.42, bodyH: 0.32,
      hoodLen: 1.0, hoodH: 0.08,
      cabinX: -0.3, cabinLen: 1.4, cabinH: 0.3, cabinW: 1.2,
      spoiler: { x: -1.6, y: 0.8, w: 0.55, h: 0.06 },
      extras: [
        { mat: "paint", x: 0.1, y: 0.6, z: 1.05, sx: 1.9, sy: 0.06, sz: 0.42 },
        { mat: "paint", x: 0.1, y: 0.6, z: -1.05, sx: 1.9, sy: 0.06, sz: 0.42 },
        { mat: "glow", x: -1.7, y: 0.5, z: 0.4, sx: 0.3, sy: 0.08, sz: 0.12 },
        { mat: "glow", x: -1.7, y: 0.5, z: -0.4, sx: 0.3, sy: 0.08, sz: 0.12 },
      ],
    }),
    wheels: fourWheels(1.2, 0.78, 0.26, 0.22),
    colors: ["silver", "black", "red", "cyan", "purple"],
    defaultColor: "silver",
  }),
  def({
    id: "fly-starlifter",
    name: "Orbit Starlifter",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 42,
    blurb: "Flying SUV with a roof pod and twin tail fins. The sky bus.",
    price: 12000,
    stats: { speed: 8, accel: 5, handling: 5, seats: 7 },
    plan: plan({
      length: 4.0, width: 1.8, bodyY: 0.64, bodyH: 0.58,
      hoodLen: 0.6, hoodH: 0.12,
      cabinX: -0.3, cabinLen: 2.3, cabinH: 0.5, cabinW: 1.55,
      rails: true, fenders: true,
      extras: [
        { mat: "dark", x: -0.3, y: 1.32, z: 0, sx: 1.4, sy: 0.22, sz: 1.0 },
        { mat: "paint", x: -0.2, y: 0.85, z: 1.1, sx: 2.2, sy: 0.06, sz: 0.4 },
        { mat: "paint", x: -0.2, y: 0.85, z: -1.1, sx: 2.2, sy: 0.06, sz: 0.4 },
        { mat: "gold", x: -1.85, y: 1.0, z: 0.55, sx: 0.08, sy: 0.5, sz: 0.3 },
        { mat: "gold", x: -1.85, y: 1.0, z: -0.55, sx: 0.08, sy: 0.5, sz: 0.3 },
      ],
    }),
    wheels: fourWheels(1.3, 0.84, 0.3, 0.26),
    colors: ["gold", "white", "black", "cyan"],
    defaultColor: "gold",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Planes
// All fly (kind "flying", fly: true) on the SAME flight path as the
// flying cars (driveParamsFor climb + the driving tick). Propellers are
// named "prop" so drive() spins them while airborne or moving.
// ---------------------------------------------------------------------------

const PLANES: VehicleDef[] = [
  def({
    id: "fly-prop",
    name: "Orbit Prop Plane",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 30,
    climb: 8,
    blurb: "Small prop plane. Short takeoffs, low ceiling, pure fun.",
    price: 8000,
    stats: { speed: 7, accel: 6, handling: 6, seats: 2 },
    plan: plan({
      length: 4.2, width: 1.4, bodyY: 0.55, bodyH: 0.45,
      hoodLen: 0.8, hoodH: 0.1,
      cabinX: -0.3, cabinLen: 1.2, cabinH: 0.35, cabinW: 1.1,
      extras: [
        // High main wing + tail stabilizer + vertical fin.
        { mat: "paint", x: 0.1, y: 0.92, z: 0, sx: 1.3, sy: 0.06, sz: 5.0 },
        { mat: "paint", x: -1.9, y: 0.75, z: 0, sx: 0.7, sy: 0.05, sz: 2.2 },
        { mat: "paint", x: -1.9, y: 1.05, z: 0, sx: 0.6, sy: 0.6, sz: 0.06 },
        // Propeller: hub + two crossed blades (they spin, see drive()).
        { mat: "dark", x: 2.14, y: 0.7, z: 0, sx: 0.1, sy: 0.16, sz: 0.16 },
        { mat: "dark", x: 2.2, y: 0.7, z: 0, sx: 0.05, sy: 1.7, sz: 0.1, name: "prop" },
        { mat: "dark", x: 2.2, y: 0.7, z: 0, sx: 0.05, sy: 0.1, sz: 1.7, name: "prop" },
        // Wingtip nav lights: red left, cyan right.
        { mat: "tail", x: 0.1, y: 0.92, z: 2.5, sx: 0.1, sy: 0.08, sz: 0.1 },
        { mat: "glow", x: 0.1, y: 0.92, z: -2.5, sx: 0.1, sy: 0.08, sz: 0.1 },
      ],
    }),
    wheels: [
      { x: 1.3, z: 0, r: 0.16, w: 0.14 },
      { x: -0.3, z: 0.62, r: 0.22, w: 0.16 },
      { x: -0.3, z: -0.62, r: 0.22, w: 0.16 },
    ],
    colors: ["white", "red", "blue", "gold"],
    defaultColor: "white",
  }),
  def({
    id: "fly-jet",
    name: "Orbit Jet",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 60,
    climb: 12,
    blurb: "Private jet. The fastest way across the states — ceiling 60.",
    price: 25000,
    stats: { speed: 10, accel: 9, handling: 7, seats: 6 },
    plan: plan({
      length: 5.2, width: 1.6, bodyY: 0.5, bodyH: 0.42,
      hoodLen: 1.2, hoodH: 0.08,
      cabinX: -0.4, cabinLen: 2.2, cabinH: 0.32, cabinW: 1.2,
      extras: [
        // Swept low wing + tail stabilizer + vertical fin.
        { mat: "paint", x: -0.2, y: 0.5, z: 0, sx: 1.5, sy: 0.06, sz: 5.6 },
        { mat: "paint", x: -2.3, y: 0.7, z: 0, sx: 0.8, sy: 0.05, sz: 2.4 },
        { mat: "paint", x: -2.3, y: 1.0, z: 0, sx: 0.7, sy: 0.7, sz: 0.06 },
        // Twin jet engines under the wings + glowing exhausts.
        { mat: "dark", x: -0.2, y: 0.32, z: 1.3, sx: 1.0, sy: 0.34, sz: 0.34 },
        { mat: "dark", x: -0.2, y: 0.32, z: -1.3, sx: 1.0, sy: 0.34, sz: 0.34 },
        { mat: "glow", x: -0.75, y: 0.32, z: 1.3, sx: 0.08, sy: 0.2, sz: 0.2 },
        { mat: "glow", x: -0.75, y: 0.32, z: -1.3, sx: 0.08, sy: 0.2, sz: 0.2 },
        // Gold cheatline along the fuselage.
        { mat: "gold", x: 0, y: 0.62, z: 0, sx: 4.6, sy: 0.05, sz: 1.62 },
      ],
    }),
    wheels: [
      { x: 1.6, z: 0, r: 0.18, w: 0.14 },
      { x: -0.4, z: 0.7, r: 0.24, w: 0.18 },
      { x: -0.4, z: -0.7, r: 0.24, w: 0.18 },
    ],
    colors: ["white", "silver", "black", "midnight"],
    defaultColor: "white",
  }),
  def({
    id: "fly-stunt",
    name: "Orbit Stunt Plane",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 40,
    climb: 11,
    blurb: "Biplane stunt flyer. Tight turns, big wings, tiny cockpit.",
    price: 12000,
    stats: { speed: 9, accel: 8, handling: 9, seats: 1 },
    plan: plan({
      length: 3.4, width: 1.3, bodyY: 0.55, bodyH: 0.4,
      hoodLen: 0.7, hoodH: 0.1,
      cabinX: -0.2, cabinLen: 0.9, cabinH: 0.4, cabinW: 1.0,
      extras: [
        // Biplane: big upper wing + lower wing + struts between them.
        { mat: "paint", x: 0.2, y: 0.85, z: 0, sx: 1.1, sy: 0.06, sz: 4.4 },
        { mat: "paint", x: 0.2, y: 0.35, z: 0, sx: 1.0, sy: 0.05, sz: 3.6 },
        { mat: "chrome", x: 0.5, y: 0.6, z: 1.2, sx: 0.06, sy: 0.5, sz: 0.06 },
        { mat: "chrome", x: 0.5, y: 0.6, z: -1.2, sx: 0.06, sy: 0.5, sz: 0.06 },
        { mat: "paint", x: -1.5, y: 0.7, z: 0, sx: 0.6, sy: 0.05, sz: 1.8 },
        { mat: "paint", x: -1.5, y: 0.95, z: 0, sx: 0.5, sy: 0.5, sz: 0.06 },
        // Dark band + propeller (spins, see drive()).
        { mat: "dark", x: -1.2, y: 0.7, z: 0, sx: 0.5, sy: 0.06, sz: 1.32 },
        { mat: "dark", x: 1.74, y: 0.7, z: 0, sx: 0.1, sy: 0.16, sz: 0.16 },
        { mat: "dark", x: 1.8, y: 0.7, z: 0, sx: 0.05, sy: 1.5, sz: 0.1, name: "prop" },
        { mat: "dark", x: 1.8, y: 0.7, z: 0, sx: 0.05, sy: 0.1, sz: 1.5, name: "prop" },
      ],
    }),
    wheels: [
      { x: 0.8, z: 0.55, r: 0.2, w: 0.14 },
      { x: 0.8, z: -0.55, r: 0.2, w: 0.14 },
      { x: -1.5, z: 0, r: 0.1, w: 0.1 },
    ],
    colors: ["red", "sunset", "lime", "white"],
    defaultColor: "red",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Helicopters
// Main rotor is named "rotor" so drive() spins it while airborne or
// moving. Skids are the landing gear; the tiny wheels under them are the
// landing-gear wheels the builder needs (wheelR) and read as gear.
// ---------------------------------------------------------------------------

const HELICOPTERS: VehicleDef[] = [
  def({
    id: "fly-heli",
    name: "Orbit Heli",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 36,
    climb: 9,
    blurb: "The workhorse. Rotor lift, hover anywhere, land anywhere.",
    price: 15000,
    stats: { speed: 5, accel: 6, handling: 8, seats: 4 },
    plan: plan({
      length: 3.2, width: 1.5, bodyY: 0.7, bodyH: 0.5,
      hoodLen: 0, hoodH: 0.1,
      cabinX: 0.3, cabinLen: 1.4, cabinH: 0.4, cabinW: 1.3,
      extras: [
        // Tail boom + vertical fin + a small static tail rotor (+).
        { mat: "paint", x: -2.2, y: 0.85, z: 0, sx: 1.8, sy: 0.18, sz: 0.18 },
        { mat: "paint", x: -3.0, y: 1.1, z: 0, sx: 0.08, sy: 0.6, sz: 0.4 },
        { mat: "dark", x: -3.05, y: 1.1, z: 0.22, sx: 0.05, sy: 0.5, sz: 0.05 },
        { mat: "dark", x: -3.05, y: 1.1, z: 0.22, sx: 0.5, sy: 0.05, sz: 0.05 },
        // Rotor mast + two crossed main rotor blades (they spin).
        { mat: "dark", x: 0, y: 1.35, z: 0, sx: 0.12, sy: 0.3, sz: 0.12 },
        { mat: "dark", x: 0, y: 1.55, z: 0, sx: 0.28, sy: 0.05, sz: 5.4, name: "rotor" },
        { mat: "dark", x: 0, y: 1.55, z: 0, sx: 5.4, sy: 0.05, sz: 0.28, name: "rotor" },
        // Skids + struts.
        { mat: "chrome", x: 0, y: 0.12, z: 0.65, sx: 2.6, sy: 0.06, sz: 0.08 },
        { mat: "chrome", x: 0, y: 0.12, z: -0.65, sx: 2.6, sy: 0.06, sz: 0.08 },
        { mat: "dark", x: 0.6, y: 0.3, z: 0.65, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: -0.6, y: 0.3, z: 0.65, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: 0.6, y: 0.3, z: -0.65, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: -0.6, y: 0.3, z: -0.65, sx: 0.08, sy: 0.35, sz: 0.08 },
      ],
    }),
    wheels: [
      { x: 0.6, z: 0.65, r: 0.12, w: 0.1 },
      { x: 0.6, z: -0.65, r: 0.12, w: 0.1 },
      { x: -0.6, z: 0.65, r: 0.12, w: 0.1 },
      { x: -0.6, z: -0.65, r: 0.12, w: 0.1 },
    ],
    colors: ["white", "red", "blue", "black"],
    defaultColor: "white",
  }),
  def({
    id: "fly-rescue",
    name: "Orbit Rescue Heli",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 40,
    climb: 9,
    blurb: "Search and rescue. Bigger cabin, searchlight, red and white.",
    price: 20000,
    stats: { speed: 6, accel: 6, handling: 8, seats: 6 },
    plan: plan({
      length: 3.6, width: 1.6, bodyY: 0.72, bodyH: 0.55,
      hoodLen: 0, hoodH: 0.1,
      cabinX: 0.2, cabinLen: 1.8, cabinH: 0.45, cabinW: 1.4,
      extras: [
        // Tail boom + fin + static tail rotor (+).
        { mat: "paint", x: -2.5, y: 0.9, z: 0, sx: 1.8, sy: 0.2, sz: 0.2 },
        { mat: "paint", x: -3.3, y: 1.15, z: 0, sx: 0.08, sy: 0.65, sz: 0.45 },
        { mat: "dark", x: -3.35, y: 1.15, z: 0.24, sx: 0.05, sy: 0.55, sz: 0.05 },
        { mat: "dark", x: -3.35, y: 1.15, z: 0.24, sx: 0.55, sy: 0.05, sz: 0.05 },
        // Bigger rotor mast + crossed blades (they spin).
        { mat: "dark", x: 0, y: 1.45, z: 0, sx: 0.14, sy: 0.3, sz: 0.14 },
        { mat: "dark", x: 0, y: 1.65, z: 0, sx: 0.3, sy: 0.05, sz: 6.0, name: "rotor" },
        { mat: "dark", x: 0, y: 1.65, z: 0, sx: 6.0, sy: 0.05, sz: 0.3, name: "rotor" },
        // Rescue stripe + nose searchlight.
        { mat: "white", x: 0, y: 0.9, z: 0, sx: 2.8, sy: 0.06, sz: 1.62 },
        { mat: "tail", x: -0.5, y: 0.95, z: 0, sx: 1.2, sy: 0.06, sz: 1.62 },
        { mat: "glow", x: 1.7, y: 0.6, z: 0, sx: 0.15, sy: 0.15, sz: 0.15 },
        // Skids + struts.
        { mat: "chrome", x: 0, y: 0.12, z: 0.7, sx: 2.9, sy: 0.06, sz: 0.08 },
        { mat: "chrome", x: 0, y: 0.12, z: -0.7, sx: 2.9, sy: 0.06, sz: 0.08 },
        { mat: "dark", x: 0.7, y: 0.3, z: 0.7, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: -0.7, y: 0.3, z: 0.7, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: 0.7, y: 0.3, z: -0.7, sx: 0.08, sy: 0.35, sz: 0.08 },
        { mat: "dark", x: -0.7, y: 0.3, z: -0.7, sx: 0.08, sy: 0.35, sz: 0.08 },
      ],
    }),
    wheels: [
      { x: 0.7, z: 0.7, r: 0.12, w: 0.1 },
      { x: 0.7, z: -0.7, r: 0.12, w: 0.1 },
      { x: -0.7, z: 0.7, r: 0.12, w: 0.1 },
      { x: -0.7, z: -0.7, r: 0.12, w: 0.1 },
    ],
    colors: ["red", "white", "orange"],
    defaultColor: "red",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Airships
// The blimp is a big, slow, very high flyer. Its envelope is the body
// slab; the gondola hangs underneath. Two small tail props (named "prop")
// spin while airborne or moving, like the plane propellers.
// ---------------------------------------------------------------------------

const AIRSHIPS: VehicleDef[] = [
  def({
    id: "fly-blimp",
    name: "Orbit Blimp",
    brand: "Orbit",
    kind: "flying",
    fly: true,
    maxAltitude: 70,
    climb: 4,
    blurb: "The gentle giant. Slow, huge, and the highest ceiling in the city.",
    price: 18000,
    stats: { speed: 2, accel: 3, handling: 4, seats: 8 },
    plan: plan({
      length: 6.0, width: 2.0, bodyY: 1.4, bodyH: 1.4,
      hoodLen: 0, hoodH: 0.1,
      cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0, glassCabin: false,
      extras: [
        // Gondola + glass window band underneath the envelope.
        { mat: "dark", x: 0.3, y: 0.35, z: 0, sx: 1.8, sy: 0.5, sz: 0.9 },
        { mat: "glass", x: 0.3, y: 0.45, z: 0, sx: 1.4, sy: 0.25, sz: 0.92 },
        // Gold nose cap + cheatline along the envelope.
        { mat: "gold", x: 2.95, y: 1.4, z: 0, sx: 0.12, sy: 1.0, sz: 1.6 },
        { mat: "gold", x: 0, y: 1.4, z: 0, sx: 5.6, sy: 0.08, sz: 2.02 },
        // Tail fins: top + two side fins.
        { mat: "paint", x: -2.7, y: 2.3, z: 0, sx: 0.5, sy: 0.9, sz: 0.06 },
        { mat: "paint", x: -2.7, y: 1.4, z: 0.95, sx: 0.5, sy: 0.06, sz: 0.9 },
        { mat: "paint", x: -2.7, y: 1.4, z: -0.95, sx: 0.5, sy: 0.06, sz: 0.9 },
        // Two small tail propellers (they spin, see drive()).
        { mat: "dark", x: -3.05, y: 1.4, z: 0.6, sx: 0.05, sy: 0.7, sz: 0.1, name: "prop" },
        { mat: "dark", x: -3.05, y: 1.4, z: -0.6, sx: 0.05, sy: 0.7, sz: 0.1, name: "prop" },
      ],
    }),
    wheels: [
      { x: 0.9, z: 0.35, r: 0.12, w: 0.1 },
      { x: 0.9, z: -0.35, r: 0.12, w: 0.1 },
      { x: -0.3, z: 0.35, r: 0.12, w: 0.1 },
      { x: -0.3, z: -0.35, r: 0.12, w: 0.1 },
    ],
    colors: ["white", "gold", "silver", "blue"],
    defaultColor: "white",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Bikes, ATVs, skateboards
// Bikes: 2 inline wheels, lean into turns (see driveParamsFor lean).
// ATVs: 4 chunky wheels, off-road bonus.
// Boards: 4 tiny wheels, standing ride, push to accelerate.
// ---------------------------------------------------------------------------

const BIKES: VehicleDef[] = [
  def({
    id: "bike-street",
    name: "Street Comet 250",
    brand: "Orbit",
    kind: "bike",
    fly: false,
    blurb: "Naked street bike. Light, quick, easy to throw around.",
    price: 700,
    stats: { speed: 6, accel: 7, handling: 9, seats: 2 },
    plan: plan({
      length: 2.0, width: 0.5, bodyY: 0.62, bodyH: 0.22,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.4,
      extras: [
        { mat: "paint", x: 0.55, y: 0.78, z: 0, sx: 0.5, sy: 0.18, sz: 0.42 },
        { mat: "dark", x: -0.35, y: 0.8, z: 0, sx: 0.7, sy: 0.1, sz: 0.4 },
        { mat: "chrome", x: 0.85, y: 0.85, z: 0, sx: 0.08, sy: 0.08, sz: 0.55 },
        { mat: "glass", x: 0.8, y: 0.95, z: 0, sx: 0.3, sy: 0.22, sz: 0.34 },
        { mat: "paint", x: 0.95, y: 0.55, z: 0, sx: 0.1, sy: 0.3, sz: 0.3 },
      ],
    }),
    wheels: twoWheels(0.75, 0.3, 0.14),
    colors: ["red", "black", "cyan", "gold", "blue"],
    defaultColor: "red",
  }),
  def({
    id: "bike-sport",
    name: "Apex R1 Sportbike",
    brand: "Orbit",
    kind: "bike",
    fly: false,
    blurb: "Full-fairing sportbike. Crouched, faired, fastest on two wheels.",
    price: 3200,
    stats: { speed: 10, accel: 10, handling: 7, seats: 2 },
    plan: plan({
      length: 2.1, width: 0.52, bodyY: 0.55, bodyH: 0.24,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.4,
      extras: [
        // Full fairing: tall nose cone + bubble screen + tail hump.
        { mat: "paint", x: 0.7, y: 0.7, z: 0, sx: 0.7, sy: 0.42, sz: 0.48 },
        { mat: "glass", x: 0.62, y: 0.98, z: 0, sx: 0.35, sy: 0.2, sz: 0.3 },
        { mat: "paint", x: -0.75, y: 0.82, z: 0, sx: 0.5, sy: 0.16, sz: 0.34 },
        { mat: "dark", x: -0.2, y: 0.76, z: 0, sx: 0.7, sy: 0.1, sz: 0.4 },
        { mat: "gold", x: 0.1, y: 0.68, z: 0.24, sx: 1.3, sy: 0.05, sz: 0.05 },
        { mat: "gold", x: 0.1, y: 0.68, z: -0.24, sx: 1.3, sy: 0.05, sz: 0.05 },
      ],
    }),
    wheels: twoWheels(0.8, 0.32, 0.16),
    colors: ["blue", "red", "black", "lime", "white"],
    defaultColor: "blue",
  }),
  def({
    id: "bike-cruiser",
    name: "Highway King Cruiser",
    brand: "Orbit",
    kind: "bike",
    fly: false,
    blurb: "Long chrome cruiser. Low seat, wide bars, slow and proud.",
    price: 1800,
    stats: { speed: 6, accel: 5, handling: 6, seats: 2 },
    plan: plan({
      length: 2.4, width: 0.56, bodyY: 0.58, bodyH: 0.22,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.44,
      extras: [
        { mat: "chrome", x: 0.95, y: 0.72, z: 0, sx: 0.55, sy: 0.2, sz: 0.4 },
        { mat: "dark", x: -0.45, y: 0.74, z: 0, sx: 0.8, sy: 0.12, sz: 0.44 },
        { mat: "chrome", x: 0.9, y: 1.0, z: 0, sx: 0.08, sy: 0.08, sz: 0.7 },
        { mat: "paint", x: -0.9, y: 0.6, z: 0, sx: 0.4, sy: 0.3, sz: 0.36 },
        { mat: "gold", x: 0.3, y: 0.62, z: 0, sx: 0.9, sy: 0.06, sz: 0.3 },
      ],
    }),
    wheels: twoWheels(0.95, 0.34, 0.18),
    colors: ["black", "crimson", "silver", "gold"],
    defaultColor: "black",
  }),
  def({
    id: "bike-dirt",
    name: "Trailblazer Dirt Bike",
    brand: "Orbit",
    kind: "bike",
    fly: false,
    blurb: "Knobby-tired dirt bike. Loves grass, gravel and bad decisions.",
    price: 1200,
    stats: { speed: 6, accel: 8, handling: 8, seats: 1 },
    plan: plan({
      length: 2.0, width: 0.5, bodyY: 0.72, bodyH: 0.2,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.4,
      extras: [
        { mat: "paint", x: 0.55, y: 0.86, z: 0, sx: 0.55, sy: 0.16, sz: 0.4 },
        { mat: "dark", x: -0.3, y: 0.9, z: 0, sx: 0.7, sy: 0.1, sz: 0.36 },
        { mat: "chrome", x: 0.85, y: 0.95, z: 0, sx: 0.08, sy: 0.08, sz: 0.5 },
        // High front fender + skid plate.
        { mat: "paint", x: 0.9, y: 0.92, z: 0, sx: 0.45, sy: 0.06, sz: 0.3 },
        { mat: "chrome", x: 0.1, y: 0.5, z: 0, sx: 0.9, sy: 0.08, sz: 0.3 },
      ],
    }),
    wheels: twoWheels(0.75, 0.34, 0.18),
    colors: ["orange", "lime", "red", "blue", "white"],
    defaultColor: "orange",
  }),
];

const ATVS: VehicleDef[] = [
  def({
    id: "atv-trail",
    name: "Trail Boss ATV",
    brand: "Orbit",
    kind: "atv",
    fly: false,
    blurb: "Four chunky tires and a rack. Slow on road, king off it.",
    price: 1500,
    stats: { speed: 5, accel: 6, handling: 7, seats: 2 },
    plan: plan({
      length: 2.1, width: 1.1, bodyY: 0.62, bodyH: 0.3,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.5,
      fenders: true,
      extras: [
        { mat: "dark", x: -0.35, y: 0.82, z: 0, sx: 0.6, sy: 0.1, sz: 0.6 },
        { mat: "paint", x: 0.55, y: 0.75, z: 0, sx: 0.5, sy: 0.16, sz: 0.6 },
        { mat: "chrome", x: 0.85, y: 0.8, z: 0, sx: 0.08, sy: 0.08, sz: 0.5 },
        { mat: "dark", x: -0.95, y: 0.7, z: 0, sx: 0.15, sy: 0.12, sz: 0.9 },
      ],
    }),
    wheels: fourWheels(0.7, 0.5, 0.32, 0.3),
    colors: ["green", "red", "black", "orange", "cyan"],
    defaultColor: "green",
  }),
  def({
    id: "atv-quad",
    name: "Mud King 4x4",
    brand: "Orbit",
    kind: "atv",
    fly: false,
    blurb: "Lifted quad with a winch and mud flaps. Goes where roads end.",
    price: 2600,
    stats: { speed: 6, accel: 7, handling: 6, seats: 2 },
    plan: plan({
      length: 2.3, width: 1.25, bodyY: 0.72, bodyH: 0.34,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.55,
      fenders: true,
      extras: [
        { mat: "dark", x: -0.4, y: 0.94, z: 0, sx: 0.7, sy: 0.1, sz: 0.7 },
        { mat: "paint", x: 0.6, y: 0.85, z: 0, sx: 0.55, sy: 0.18, sz: 0.7 },
        { mat: "chrome", x: 0.9, y: 0.9, z: 0, sx: 0.08, sy: 0.08, sz: 0.55 },
        { mat: "gold", x: 1.1, y: 0.55, z: 0, sx: 0.1, sy: 0.14, sz: 0.3 },
        { mat: "dark", x: -1.05, y: 0.75, z: 0.5, sx: 0.06, sy: 0.3, sz: 0.3 },
        { mat: "dark", x: -1.05, y: 0.75, z: -0.5, sx: 0.06, sy: 0.3, sz: 0.3 },
      ],
    }),
    wheels: fourWheels(0.75, 0.56, 0.36, 0.34),
    colors: ["orange", "black", "red", "lime", "blue"],
    defaultColor: "orange",
  }),
];

const BOARDS: VehicleDef[] = [
  def({
    id: "board-street",
    name: "Orbit Deck",
    brand: "Orbit",
    kind: "skateboard",
    fly: false,
    blurb: "A skateboard. Push to go, lean to turn. Cheapest ride in town.",
    price: 150,
    stats: { speed: 3, accel: 5, handling: 10, seats: 1 },
    plan: plan({
      length: 0.9, width: 0.28, bodyY: 0.14, bodyH: 0.06,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.2,
      extras: [
        { mat: "dark", x: 0.38, y: 0.18, z: 0, sx: 0.14, sy: 0.04, sz: 0.26 },
        { mat: "gold", x: 0, y: 0.18, z: 0, sx: 0.5, sy: 0.02, sz: 0.1 },
      ],
    }),
    wheels: deckWheels(0.32, 0.12),
    colors: ["black", "red", "cyan", "gold", "purple"],
    defaultColor: "black",
  }),
  def({
    id: "board-long",
    name: "Cruiser Longboard",
    brand: "Orbit",
    kind: "skateboard",
    fly: false,
    blurb: "Long low deck for cruising the plaza. Smooth and surfy.",
    price: 350,
    stats: { speed: 4, accel: 4, handling: 9, seats: 1 },
    plan: plan({
      length: 1.25, width: 0.3, bodyY: 0.14, bodyH: 0.06,
      hoodLen: 0, cabinX: 0, cabinLen: 0, cabinH: 0, cabinW: 0.2,
      extras: [
        { mat: "dark", x: 0.52, y: 0.18, z: 0, sx: 0.16, sy: 0.04, sz: 0.28 },
        { mat: "dark", x: -0.52, y: 0.18, z: 0, sx: 0.16, sy: 0.04, sz: 0.28 },
        { mat: "gold", x: 0, y: 0.18, z: 0, sx: 0.8, sy: 0.02, sz: 0.12 },
      ],
    }),
    wheels: deckWheels(0.45, 0.12),
    colors: ["sunset", "cyan", "lime", "black", "pink"],
    defaultColor: "sunset",
  }),
];

// ---------------------------------------------------------------------------
// Catalog — Tesla (all Elon cars)
// Sourced Nov 2026: the current lineup is Model 3, Model Y, Model S,
// Model X and Cybertruck, plus the Cybercab robotaxi (in service in Austin
// since 3 Sep 2026) and the all-new 2nd-gen Roadster, revealed 15 Oct 2026
// (production from 2028) — the newest Tesla car as of November 2026.
// NOTE: Model S and Model X stopped selling new in 2026 (factory space
// went to Optimus), but they are still Tesla cars and stay in the lineup.
// Each Tesla is a different body out of the same template: the 3 is a low
// flush sedan, the Y a tall crossover, the S a long sleek sedan, the X a
// tall SUV with falcon doors, the Cybertruck a steel wedge, the Cybercab a
// tiny two-seat pod, the Roadster the lowest and widest of all.
// ---------------------------------------------------------------------------

const TESLAS: VehicleDef[] = [
  def({
    id: "tesla-model-3",
    name: "Tesla Model 3",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Low flush sedan, one long glass roof, no grille at all.",
    price: 1600,
    stats: { speed: 8, accel: 8, handling: 8, seats: 5 },
    plan: plan({
      length: 3.5, width: 1.62, bodyY: 0.44, bodyH: 0.36,
      hoodLen: 0.85, hoodH: 0.08,
      cabinX: -0.3, cabinLen: 2.0, cabinH: 0.3, cabinW: 1.4,
      trunkLen: 0.4,
      extras: [
        // Single-piece glass roof + slim light strip, no grille.
        { mat: "glass", x: -0.3, y: 0.78, z: 0, sx: 1.9, sy: 0.1, sz: 1.3 },
        { mat: "headlight", x: 1.72, y: 0.48, z: 0, sx: 0.06, sy: 0.1, sz: 1.2 },
        { mat: "chrome", x: 0, y: 0.3, z: 0.78, sx: 2.6, sy: 0.05, sz: 0.05 },
        { mat: "chrome", x: 0, y: 0.3, z: -0.78, sx: 2.6, sy: 0.05, sz: 0.05 },
      ],
    }),
    wheels: fourWheels(1.15, 0.78, 0.28, 0.22),
    colors: TESLA_COLORS,
    defaultColor: "pearl",
  }),
  def({
    id: "tesla-model-y",
    name: "Tesla Model Y",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Tall Model 3 crossover. High roof, hatchback tail, roomier cabin.",
    price: 1900,
    stats: { speed: 7, accel: 8, handling: 7, seats: 5 },
    plan: plan({
      length: 3.6, width: 1.66, bodyY: 0.56, bodyH: 0.5,
      hoodLen: 0.7, hoodH: 0.1,
      cabinX: -0.35, cabinLen: 2.25, cabinH: 0.46, cabinW: 1.46,
      trunkLen: 0.35, rails: false,
      extras: [
        { mat: "glass", x: -0.35, y: 1.02, z: 0, sx: 2.1, sy: 0.12, sz: 1.36 },
        { mat: "headlight", x: 1.78, y: 0.6, z: 0, sx: 0.06, sy: 0.1, sz: 1.25 },
        // Hatchback seam across the tail.
        { mat: "dark", x: -1.78, y: 0.8, z: 0, sx: 0.06, sy: 0.4, sz: 1.3 },
      ],
    }),
    wheels: fourWheels(1.2, 0.8, 0.3, 0.24),
    colors: TESLA_COLORS,
    defaultColor: "quicksilver",
  }),
  def({
    id: "tesla-model-s",
    name: "Tesla Model S",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Long sleek flagship sedan. Lowest roofline of the four-doors.",
    price: 3600,
    stats: { speed: 9, accel: 9, handling: 8, seats: 5 },
    plan: plan({
      length: 3.95, width: 1.64, bodyY: 0.44, bodyH: 0.36,
      hoodLen: 1.0, hoodH: 0.08,
      cabinX: -0.35, cabinLen: 2.1, cabinH: 0.3, cabinW: 1.42,
      trunkLen: 0.5, skirt: true,
      extras: [
        { mat: "glass", x: -0.35, y: 0.78, z: 0, sx: 2.0, sy: 0.1, sz: 1.32 },
        { mat: "chrome", x: 0.2, y: 0.32, z: 0.8, sx: 3.0, sy: 0.05, sz: 0.05 },
        { mat: "chrome", x: 0.2, y: 0.32, z: -0.8, sx: 3.0, sy: 0.05, sz: 0.05 },
        { mat: "headlight", x: 1.95, y: 0.48, z: 0, sx: 0.06, sy: 0.1, sz: 1.25 },
      ],
    }),
    wheels: fourWheels(1.3, 0.78, 0.28, 0.24),
    colors: TESLA_COLORS,
    defaultColor: "midnight",
  }),
  def({
    id: "tesla-model-x",
    name: "Tesla Model X",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Tall SUV with falcon-wing doors and a huge windshield.",
    price: 4200,
    stats: { speed: 8, accel: 9, handling: 6, seats: 7 },
    plan: plan({
      length: 3.9, width: 1.72, bodyY: 0.62, bodyH: 0.56,
      hoodLen: 0.7, hoodH: 0.1,
      cabinX: -0.3, cabinLen: 2.3, cabinH: 0.48, cabinW: 1.5,
      rails: true, fenders: true,
      extras: [
        // Falcon-wing doors, shown raised/open on the rear sides.
        { mat: "paint", x: -0.85, y: 1.35, z: 0.55, sx: 0.9, sy: 0.06, sz: 0.5 },
        { mat: "paint", x: -0.85, y: 1.35, z: -0.55, sx: 0.9, sy: 0.06, sz: 0.5 },
        { mat: "glass", x: 0.55, y: 1.05, z: 0, sx: 1.1, sy: 0.28, sz: 1.4 },
        { mat: "headlight", x: 1.93, y: 0.66, z: 0, sx: 0.06, sy: 0.1, sz: 1.3 },
      ],
    }),
    wheels: fourWheels(1.3, 0.82, 0.32, 0.26),
    colors: TESLA_COLORS,
    defaultColor: "stealth",
  }),
  def({
    id: "tesla-cybertruck",
    name: "Tesla Cybertruck",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Stainless steel wedge. Flat panels, light bar, nothing curved.",
    price: 5200,
    stats: { speed: 8, accel: 9, handling: 5, seats: 6 },
    plan: plan({
      length: 4.2, width: 1.8, bodyY: 0.66, bodyH: 0.5,
      hoodLen: 0.9, hoodH: 0.2,
      cabinX: -0.6, cabinLen: 1.9, cabinH: 0.42, cabinW: 1.55,
      bedLen: 0.9, wedge: true, lightBar: true, fenders: true,
      extras: [
        // Flat tonneau cover over the bed + angular sail panels.
        { mat: "chrome", x: -1.65, y: 0.98, z: 0, sx: 1.15, sy: 0.06, sz: 1.5 },
        { mat: "chrome", x: -0.75, y: 1.02, z: 0.7, sx: 1.1, sy: 0.06, sz: 0.18 },
        { mat: "chrome", x: -0.75, y: 1.02, z: -0.7, sx: 1.1, sy: 0.06, sz: 0.18 },
      ],
    }),
    wheels: fourWheels(1.4, 0.86, 0.36, 0.3),
    colors: ["silver", "stealth", "black", "white"],
    defaultColor: "silver",
  }),
  def({
    id: "tesla-cybercab",
    name: "Tesla Cybercab",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "Two-seat robotaxi. Butterfly doors, gold light bar, no mirrors.",
    price: 4800,
    stats: { speed: 7, accel: 8, handling: 9, seats: 2 },
    plan: plan({
      length: 3.0, width: 1.58, bodyY: 0.46, bodyH: 0.38,
      hoodLen: 0.75, hoodH: 0.08,
      cabinX: -0.35, cabinLen: 1.35, cabinH: 0.34, cabinW: 1.35,
      lightBar: true,
      extras: [
        // Butterfly doors angled up + gold light bar + no mirrors by design.
        { mat: "gold", x: -0.35, y: 1.0, z: 0.62, sx: 0.9, sy: 0.06, sz: 0.4 },
        { mat: "gold", x: -0.35, y: 1.0, z: -0.62, sx: 0.9, sy: 0.06, sz: 0.4 },
        { mat: "glass", x: -0.35, y: 0.82, z: 0, sx: 1.25, sy: 0.12, sz: 1.25 },
        { mat: "dark", x: 1.45, y: 0.5, z: 0, sx: 0.08, sy: 0.14, sz: 1.1 },
      ],
    }),
    wheels: fourWheels(1.0, 0.76, 0.28, 0.22),
    colors: ["gold", "silver", "black", "white"],
    defaultColor: "gold",
  }),
  def({
    id: "tesla-roadster",
    name: "Tesla Roadster (2026)",
    brand: "Tesla",
    kind: "car",
    fly: false,
    blurb: "The newest Tesla — revealed 15 Oct 2026. Lowest, widest, fastest. SpaceX thrusters at the rear.",
    price: 20000,
    stats: { speed: 10, accel: 10, handling: 9, seats: 2 },
    plan: plan({
      length: 3.9, width: 1.85, bodyY: 0.38, bodyH: 0.3,
      hoodLen: 1.15, hoodH: 0.08,
      cabinX: -0.3, cabinLen: 1.5, cabinH: 0.26, cabinW: 1.4,
      trunkLen: 0.35, spoiler: { x: -1.7, y: 0.78, w: 0.5, h: 0.06 },
      lightBar: true, skirt: true,
      extras: [
        // Removable glass roof panel + SpaceX cold-gas thruster pods.
        { mat: "glass", x: -0.3, y: 0.66, z: 0, sx: 1.3, sy: 0.08, sz: 1.3 },
        { mat: "dark", x: -1.85, y: 0.55, z: 0.55, sx: 0.22, sy: 0.22, sz: 0.22 },
        { mat: "dark", x: -1.85, y: 0.55, z: -0.55, sx: 0.22, sy: 0.22, sz: 0.22 },
        { mat: "gold", x: -1.85, y: 0.55, z: 0, sx: 0.1, sy: 0.1, sz: 0.5 },
        { mat: "chrome", x: 0.3, y: 0.3, z: 0.86, sx: 2.4, sy: 0.05, sz: 0.06 },
        { mat: "chrome", x: 0.3, y: 0.3, z: -0.86, sx: 2.4, sy: 0.05, sz: 0.06 },
      ],
    }),
    wheels: fourWheels(1.3, 0.84, 0.3, 0.3),
    colors: ["crimson", "black", "pearl", "silver", "red"],
    defaultColor: "crimson",
  }),
];

// ---------------------------------------------------------------------------
// Catalog assembly + shop
// ---------------------------------------------------------------------------

export const VEHICLES: VehicleDef[] = [
  ...CITY_CARS,
  ...TESLAS,
  ...FLYING_CARS,
  ...PLANES,
  ...HELICOPTERS,
  ...AIRSHIPS,
  ...BIKES,
  ...ATVS,
  ...BOARDS,
];

export const VEHICLE_IDS: string[] = VEHICLES.map((v) => v.id);

export const DEFAULT_VEHICLE_ID = "city-compact";

export function getVehicle(id: string): VehicleDef | undefined {
  return VEHICLES.find((v) => v.id === id);
}

export function vehiclesByKind(kind: VehicleKind): VehicleDef[] {
  return VEHICLES.filter((v) => v.kind === kind);
}

export function flyingVehicles(): VehicleDef[] {
  return VEHICLES.filter((v) => v.fly);
}

/** Shop sections for the garage panel, in display order. */
export interface CarShopSection {
  title: string;
  blurb: string;
  ids: string[];
}

export const CAR_SHOP: CarShopSection[] = [
  {
    title: "City Cars",
    blurb: "Everyday rides. Buy one, pick a color, drive it out of the garage.",
    ids: CITY_CARS.map((v) => v.id),
  },
  {
    title: "Tesla — Elon cars",
    blurb: "The full Tesla lineup, from Model 3 to the all-new 2026 Roadster.",
    ids: TESLAS.map((v) => v.id),
  },
  {
    title: "Flying Cars",
    blurb: "Road cars that lift off. Fly takes off or lands, Jump climbs, Down comes down.",
    ids: FLYING_CARS.map((v) => v.id),
  },
  {
    title: "Planes",
    blurb: "Real aircraft. Fly takes off or lands, Jump climbs, Down comes down.",
    ids: PLANES.map((v) => v.id),
  },
  {
    title: "Helicopters",
    blurb: "Rotor lift. Hover anywhere, land anywhere.",
    ids: HELICOPTERS.map((v) => v.id),
  },
  {
    title: "Airships",
    blurb: "Slow, huge, and the highest ceiling in the city.",
    ids: AIRSHIPS.map((v) => v.id),
  },
  {
    title: "Bikes",
    blurb: "Two wheels, lean into the turn. Fast, light, no roof.",
    ids: BIKES.map((v) => v.id),
  },
  {
    title: "ATVs",
    blurb: "Four fat tires. Slow on the road, unstoppable off it.",
    ids: ATVS.map((v) => v.id),
  },
  {
    title: "Skateboards",
    blurb: "Stand up, push to go. The cheapest way to move in the city.",
    ids: BOARDS.map((v) => v.id),
  },
];

/** Flat shop inventory: every vehicle, with the section it belongs to. */
export const CAR_SHOP_ITEMS: Array<Pick<VehicleDef, "id" | "name" | "brand" | "kind" | "price" | "stats" | "blurb"> & { section: string }> =
  CAR_SHOP.flatMap((section) =>
    section.ids.map((id) => {
      const v = getVehicle(id);
      if (!v) throw new Error(`CAR_SHOP lists unknown vehicle ${id}`);
      return {
        id: v.id,
        name: v.name,
        brand: v.brand,
        kind: v.kind,
        price: v.price,
        stats: v.stats,
        blurb: v.blurb,
        section: section.title,
      };
    }),
  );

/** A player's owned vehicle: which car, in which paint — plus, since the
 * CARS expansion, its per-car mods and wear. Stored verbatim in the
 * per-server save's `vehicles` JSON (api/city.js, no new DB column):
 * `{ id, color, mods: {...}, dirt, damage }`. `mods`/`dirt`/`damage`
 * are optional so pre-expansion saves (plain `{id, color}`) still load. */
export interface OwnedVehicle {
  id: string;
  color: string;
  mods?: VehicleMods;
  dirt?: number;
  damage?: number;
}

/** Total price of the whole catalog, for shop sanity checks. */
export const CATALOG_TOTAL_CITY_SOL: number = VEHICLES.reduce((sum, v) => sum + v.price, 0);

// ---------------------------------------------------------------------------
// Builder — one shared builder for the whole catalog.
// Mirrors makeCar in runtime.ts so the wiring is a drop-in: same unit box,
// same named "wheel" children, same userData.paints for retint().
// ---------------------------------------------------------------------------

/** Resolve a paint key (or raw hex) to a hex number. Premium custom
 * paints resolve here too (CUSTOM_PAINT_HEX) — they ride on `color`
 * like any other paint once bought. */
export function paintHex(color: string, fallback = "black"): number {
  if (color.startsWith("#")) {
    const n = Number.parseInt(color.slice(1), 16);
    return Number.isNaN(n) ? VEHICLE_COLORS[fallback] : n;
  }
  return VEHICLE_COLORS[color] ?? CUSTOM_PAINT_HEX[color] ?? VEHICLE_COLORS[fallback];
}

function partMaterial(mat: PartMat, paint: MeshStandardMaterial, tint = 0): Material {
  switch (mat) {
    case "paint":
      return paint;
    case "glass": {
      // Window tint: darker + less see-through as the level rises.
      const t = Math.max(0, Math.min(3, tint)) / 3;
      const c = new Color().setHex(0xbfe6ff).lerp(new Color().setHex(0x0a0f14), t);
      return new MeshStandardMaterial({
        color: c.getHex(), emissive: 0x3d7fa8, emissiveIntensity: 0.55 * (1 - t * 0.8),
        roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.85 - t * 0.4,
      });
    }
    case "chrome":
      return new MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.8 });
    case "dark":
      return new MeshStandardMaterial({ color: 0x111318, roughness: 0.5, metalness: 0.5 });
    case "gold":
      return GOLD;
    case "white":
      return new MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.4, metalness: 0.2 });
    case "headlight":
      return new MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.4, roughness: 0.2 });
    case "tail":
      return new MeshStandardMaterial({ color: 0xff4b5c, emissive: 0xaa1830, emissiveIntensity: 0.8, roughness: 0.3 });
    case "tire":
      return new MeshStandardMaterial({ color: 0x111318, roughness: 0.6, metalness: 0.4 });
    case "glow":
      return MATERIALS.cyan;
  }
}

/**
 * Dirt-darkened paint: a dirty car reads brown-grey, worse as dirt
 * climbs. retint() uses the same rule, so a repainted dirty car stays
 * dirty until it is washed.
 */
export function dirtPaintHex(hex: number, dirt: number): number {
  const d = Math.max(0, Math.min(100, dirt)) / 100;
  if (d <= 0) return hex;
  const c = new Color(hex);
  c.lerp(new Color(0x6b543a), d * 0.6);
  return c.getHex();
}

/**
 * Build a THREE.Group for a catalog vehicle.
 * @param id Vehicle id from VEHICLES.
 * @param color Paint key (see VEHICLE_COLORS) or "#rrggbb". Defaults to the
 *   vehicle's defaultColor. Unknown ids throw — the shop must never pass
 *   a bad id (see WIRING.md: the server validates before the client builds).
 * @param opts Per-car mods + wear from the owned-vehicle entry
 *   (OwnedVehicle.mods / .dirt / .damage): paint reads the color, rims
 *   recolour the hubs, spoiler overrides the plan spoiler, neon changes
 *   the underglow, tint darkens the glass, dirt dulls the paint and
 *   damage adds dents.
 */
export function buildVehicle(id: string, color?: string, opts?: { mods?: Partial<VehicleMods> | null; wear?: Partial<VehicleWear> | null }): Group {
  const v = getVehicle(id);
  if (!v) throw new Error(`Unknown vehicle ${id}`);
  const mods = normalizeMods(opts?.mods);
  const wear = normalizeWear(opts?.wear);
  const p = v.plan;
  const group = new Group();
  group.rotation.order = "YXZ";
  const box = new BoxGeometry(1, 1, 1);
  const paints: MeshStandardMaterial[] = [];
  const paint = new MeshStandardMaterial({
    color: dirtPaintHex(paintHex(color ?? v.defaultColor), wear.dirt),
    emissive: 0x12141c,
    emissiveIntensity: 0.28,
    // Dirt kills the shine: roughness climbs with the dirt level.
    roughness: 0.35 + 0.55 * (wear.dirt / 100),
    metalness: 0.45,
  });
  paints.push(paint);
  // Damage dulls the paint a touch more (a banged-up car never shines).
  if (wear.damage > 0) paint.color.multiplyScalar(1 - 0.25 * (wear.damage / 100));
  const add = (material: Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const mesh = new Mesh(box, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    group.add(mesh);
    return mesh;
  };
  const addPart = (part: VehiclePart) => {
    const mesh = add(partMaterial(part.mat, paint, part.mat === "glass" ? mods.tint : 0), part.x, part.y, part.z, part.sx, part.sy, part.sz);
    if (part.name) mesh.name = part.name;
  };
  const half = p.length / 2;

  // Main body slab.
  add(paint, 0, p.bodyY, 0, p.length, p.bodyH, p.width);

  // Hood / nose slab at the front (+X).
  if (p.hoodLen > 0) {
    add(paint, half - p.hoodLen / 2, p.bodyY + p.bodyH / 2 + p.hoodH / 2 - 0.02, 0, p.hoodLen, p.hoodH, p.width - 0.14);
  }

  if (p.wedge) {
    // Cybertruck wedge: stepped slabs rising from nose to tail, no glasshouse.
    add(paint, half - 0.9, p.bodyY + p.bodyH / 2 + 0.12, 0, 1.8, 0.24, p.width - 0.2);
    add(paint, -0.3, p.bodyY + p.bodyH / 2 + 0.3, 0, 2.2, 0.42, p.width - 0.25);
    add(partMaterial("glass", paint, mods.tint), 0.35, p.bodyY + p.bodyH / 2 + 0.32, 0, 0.9, 0.24, p.width - 0.6);
  } else if (p.cabinLen > 0) {
    // Cabin box + glass canopy inset on top (or painted roof if no glass).
    const cabinY = p.bodyY + p.bodyH / 2 + p.cabinH / 2;
    add(paint, p.cabinX, cabinY, 0, p.cabinLen, p.cabinH, p.cabinW);
    if (p.glassCabin) {
      add(partMaterial("glass", paint, mods.tint), p.cabinX + 0.05, cabinY + p.cabinH / 2 - 0.02, 0, p.cabinLen - 0.5, 0.16, p.cabinW - 0.22);
    } else {
      add(paint, p.cabinX, cabinY + p.cabinH / 2 + 0.05, 0, p.cabinLen - 0.2, 0.1, p.cabinW - 0.1);
    }
  }

  // Trunk / rear deck slab.
  if (p.trunkLen > 0) {
    add(paint, -half + p.trunkLen / 2, p.bodyY + p.bodyH / 2 + 0.04, 0, p.trunkLen, 0.12, p.width - 0.2);
  }

  // Spoiler: blade on two struts. The mod overrides the plan spoiler —
  // "none" keeps whatever the car was built with, "delete" removes it
  // even when the plan has one, "lip"/"gt"/"drag" draw that style at the
  // plan position (or a sensible default when the plan has none).
  const spoilerStyle: SpoilerStyle = mods.spoiler;
  if (spoilerStyle !== "delete") {
    const s = p.spoiler;
    if (spoilerStyle === "lip") {
      const x = s ? s.x : -half + 0.15;
      const y = s ? s.y - 0.18 : p.bodyY + p.bodyH / 2 + 0.1;
      add(paint, x, y, 0, 0.5, 0.05, p.width - 0.3);
    } else if (spoilerStyle === "gt") {
      const gx = s ? s.x : -half + 0.2;
      const gy = s ? s.y + 0.12 : p.bodyY + p.bodyH / 2 + 0.35;
      add(paint, gx, gy, 0, s?.w ?? 0.55, 0.06, p.width - 0.2);
      add(partMaterial("dark", paint), gx, gy - 0.16, 0.35, 0.08, 0.26, 0.08);
      add(partMaterial("dark", paint), gx, gy - 0.16, -0.35, 0.08, 0.26, 0.08);
    } else if (spoilerStyle === "drag") {
      const dx = s ? s.x : -half + 0.25;
      const dy = s ? s.y + 0.2 : p.bodyY + p.bodyH / 2 + 0.45;
      add(paint, dx, dy, 0, 0.7, 0.05, p.width + 0.15);
      add(partMaterial("dark", paint), dx, dy - 0.2, 0.45, 0.08, 0.34, 0.08);
      add(partMaterial("dark", paint), dx, dy - 0.2, -0.45, 0.08, 0.34, 0.08);
    } else if (s) {
      add(paint, s.x, s.y, 0, s.w, s.h, p.width - 0.2);
      add(partMaterial("dark", paint), s.x, s.y - 0.14, 0.35, 0.08, 0.22, 0.08);
      add(partMaterial("dark", paint), s.x, s.y - 0.14, -0.35, 0.08, 0.22, 0.08);
    }
  }

  // Roof rails.
  if (p.rails && p.cabinLen > 0) {
    const railY = p.bodyY + p.bodyH / 2 + p.cabinH + 0.08;
    add(partMaterial("chrome", paint), p.cabinX, railY, p.cabinW / 2 - 0.08, p.cabinLen - 0.3, 0.06, 0.08);
    add(partMaterial("chrome", paint), p.cabinX, railY, -p.cabinW / 2 + 0.08, p.cabinLen - 0.3, 0.06, 0.08);
  }

  // Side skirts.
  if (p.skirt) {
    add(partMaterial("dark", paint), 0, p.bodyY - p.bodyH / 2 + 0.05, p.width / 2 - 0.02, p.length - 0.6, 0.1, 0.06);
    add(partMaterial("dark", paint), 0, p.bodyY - p.bodyH / 2 + 0.05, -p.width / 2 + 0.02, p.length - 0.6, 0.1, 0.06);
  }

  // Fender flares over each wheel.
  if (p.fenders) {
    for (const w of v.wheels) {
      add(paint, w.x, w.r + 0.18, w.z, w.r * 1.7, 0.12, w.w + 0.22);
    }
  }

  // Full-width light bars (front + rear) for Cybertruck / Cybercab / Roadster.
  const isBoard = v.kind === "skateboard";
  const isBike = v.kind === "bike" || v.kind === "atv";
  if (p.lightBar) {
    add(partMaterial("headlight", paint), half - 0.02, p.bodyY + 0.08, 0, 0.06, 0.1, p.width - 0.3);
    add(partMaterial("tail", paint), -half + 0.02, p.bodyY + 0.08, 0, 0.06, 0.1, p.width - 0.3);
  } else if (!isBoard) {
    // Standard lights: white headlight pair, red tail pair. Bikes get one each.
    const frontX = half - 0.02;
    const rearX = -half + 0.02;
    const lightY = p.bodyY + 0.04;
    if (isBike) {
      add(partMaterial("headlight", paint), frontX, lightY + 0.15, 0, 0.1, 0.14, 0.3);
      add(partMaterial("tail", paint), rearX, lightY + 0.15, 0, 0.1, 0.14, 0.3);
    } else {
      const zOff = p.width / 2 - 0.3;
      add(partMaterial("headlight", paint), frontX, lightY, zOff, 0.1, 0.14, 0.34);
      add(partMaterial("headlight", paint), frontX, lightY, -zOff, 0.1, 0.14, 0.34);
      add(partMaterial("tail", paint), rearX, lightY, zOff, 0.1, 0.16, 0.34);
      add(partMaterial("tail", paint), rearX, lightY, -zOff, 0.1, 0.16, 0.34);
    }
  }

  // Vehicle-signature extras (scoops, stripes, doors, thrusters...).
  for (const part of p.extras ?? []) addPart(part);

  // Wheels: named "wheel" so drive()'s spin loop finds them. Hubcaps + glow
  // match makeCar; boards get no hubcaps or underglow (tiny wheels).
  // Rim mod recolours the hub: stock chrome, sport dark, chrome bright,
  // gold gold, stealth black.
  const wheelMat = partMaterial("tire", paint);
  const rimMat =
    mods.rims === "gold" ? GOLD :
    mods.rims === "sport" || mods.rims === "black" ? partMaterial("dark", paint) :
    partMaterial("chrome", paint);
  for (const w of v.wheels) {
    const wheel = new CylinderGeometry(w.r, w.r, w.w, 12);
    const mesh = new Mesh(wheel, wheelMat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(w.x, w.r, w.z);
    mesh.name = "wheel";
    group.add(mesh);
    if (!isBoard) {
      const hub = new Mesh(new CylinderGeometry(w.r * 0.45, w.r * 0.45, w.w + 0.02, 10), rimMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(w.x, w.r, w.z);
      group.add(hub);
    }
  }
  // Underglow: neon (when bought) replaces the stock cyan strip with the
  // chosen colour — bigger and brighter, so it reads at night.
  if (!isBoard && !isBike) {
    if (mods.neon) {
      const hex = NEON_HEX[mods.neon] ?? 0x00e5ff;
      add(
        new MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.6, roughness: 0.3 }),
        0, 0.05, 0, p.length - 0.7, 0.06, 0.5,
      );
    } else {
      add(MATERIALS.cyan, 0, 0.06, 0, p.length - 0.9, 0.05, 0.3);
    }
  }

  // Damage: dark dent patches on the body, one at 40+ damage, a second
  // at 70+. Fixed offsets (not random) so a rebuild looks the same.
  if (wear.damage >= 40) {
    const dent = partMaterial("dark", paint);
    add(dent, p.length * 0.18, p.bodyY + 0.1, p.width / 2 + 0.01, 0.5, 0.3, 0.03);
    add(dent, -p.length * 0.15, p.bodyY + 0.12, -p.width / 2 - 0.01, 0.45, 0.26, 0.03);
  }
  if (wear.damage >= 70) {
    const dent = partMaterial("dark", paint);
    add(dent, p.length * 0.05, p.bodyY + p.bodyH / 2 + 0.03, 0, 0.6, 0.04, p.width - 0.5);
  }

  group.userData.paints = paints;
  group.userData.vehicleId = v.id;
  group.userData.kind = v.kind;
  group.userData.fly = v.fly;
  group.userData.maxAltitude = v.maxAltitude ?? 0;
  group.userData.length = p.length;
  group.userData.width = p.width;
  group.userData.wheelR = Math.max(...v.wheels.map((w) => w.r));
  return group;
}

// ---------------------------------------------------------------------------
// Physics — maps catalog stats onto the existing drive() numbers.
// Existing drive() baseline (runtime.ts): accel += f * 18 * dt, drag
// *= 1 - 1.6*dt, max 12 (22 with Ctrl), reverse -6, steering is a
// bicycle model — full lock turns a constant radius (9 / steer units,
// yaw rate capped at 2.4 rad/s), lean target steer * 0.28.
// driveParamsFor() returns the per-vehicle replacements; see WIRING.md for
// the exact drive() edit. Flying / bike / ATV / board rules are in the
// fields below, not in magic numbers elsewhere.
// ---------------------------------------------------------------------------

export interface DriveParams {
  /** Top speed on the road, world units / second. */
  maxSpeed: number;
  /** Acceleration constant (replaces the 18 in drive()). */
  accel: number;
  /** Steering rate (replaces the 1.5 in drive()). */
  steer: number;
  /** Max reverse speed (negative). Boards cannot reverse: 0. */
  reverse: number;
  /** Body lean into turns (replaces the 0.28 in drive()). */
  lean: number;
  /** Drag per second (replaces the 1.6 in drive()). */
  drag: number;
  /** Climb rate in world units / second. 0 = cannot fly. */
  climb: number;
  /** Hard altitude ceiling. 0 = ground vehicle. */
  maxAltitude: number;
  /** True = full speed off-road (grass / plaza); road speed unchanged. */
  offroad: boolean;
  /** True = W gives a push impulse instead of steady throttle (boards). */
  pushToGo: boolean;
  /** Resting hover height of the group (replaces the 0.12 in drive()). */
  hover: number;
}

export function driveParamsFor(id: string, opts?: { mods?: Partial<VehicleMods> | null; wear?: Partial<VehicleWear> | null }): DriveParams {
  const v = getVehicle(id);
  if (!v) throw new Error(`Unknown vehicle ${id}`);
  const s = v.stats;
  const mods = normalizeMods(opts?.mods);
  const wear = normalizeWear(opts?.wear);
  const base: DriveParams = {
    maxSpeed: 7 + s.speed * 1.7,
    accel: 10 + s.accel * 1.2,
    steer: 0.8 + s.handling * 0.09,
    reverse: -6,
    lean: 0.28,
    drag: 1.6,
    climb: 0,
    maxAltitude: 0,
    offroad: false,
    pushToGo: false,
    hover: 0.12,
  };
  // Engine tune: +10% top speed and +12% accel per stage. Tires: +10%
  // steering per level (grip). Both are real stat changes, bought
  // per-car via customize-car.
  base.maxSpeed *= 1 + 0.1 * mods.engine;
  base.accel *= 1 + 0.12 * mods.engine;
  base.steer *= 1 + 0.1 * mods.tires;
  // Wear: a dirty car drags a little; a banged-up car is slower,
  // slower to accelerate and lazier to steer (up to -10% / -15% / -8%
  // at 100 damage). Wash/repair restore the numbers.
  base.maxSpeed *= 1 - 0.03 * Math.min(1, wear.dirt / 100) - 0.1 * (wear.damage / 100);
  base.accel *= 1 - 0.15 * (wear.damage / 100);
  base.steer *= 1 - 0.08 * (wear.damage / 100);
  if (v.fly) {
    base.climb = v.climb ?? 10;
    base.maxAltitude = v.maxAltitude ?? 26;
    base.drag = 1.2;
    base.hover = 0.12;
  }
  if (v.kind === "bike") {
    base.steer += 0.3;
    base.lean = 0.5;
    base.reverse = -4;
    base.hover = 0.06;
  }
  if (v.kind === "atv") {
    base.offroad = true;
    base.lean = 0.35;
    // ATVs are slower on the road than their stats suggest.
    base.maxSpeed *= 0.85;
  }
  if (v.id === "bike-dirt") base.offroad = true;
  if (v.kind === "skateboard") {
    base.maxSpeed = 5 + s.speed * 0.8;
    base.accel = 0; // push impulse only — see WIRING.md drive() edit.
    base.steer = 2.4;
    base.reverse = 0;
    base.lean = 0.15;
    // Glide, not a dead stop: drag 1.2 (was 2.2) so a push carries ~2.5
    // units and the cruise between pushes (0.45s cadence) is smooth.
    // At 2.2 a single push died in ~1s and the board felt broken.
    base.drag = 1.2;
    base.pushToGo = true;
    base.hover = 0.04;
  }
  return base;
}

/** Flying controls, for the panel help text and WIRING.md.
 * `note` is the desktop wording (Space / Shift / C). `touchNote` is what
 * a phone shows — a phone has no Space key, so showing the desktop note
 * on a phone told the player to press a key that does not exist, and the
 * player never learned that Jump climbs the car. */
export const FLY_CONTROLS = {
  climbKey: "Space",
  descendKeys: ["Shift", "C"],
  note: "Hold Space to climb. Hold Shift or C to descend. Gravity is off while flying. Ceiling is the vehicle's maxAltitude; drop below it to land.",
  touchNote: "Tap Fly to take off or land. Hold Jump to climb, Down to come down. Gravity is off while flying.",
} as const;
