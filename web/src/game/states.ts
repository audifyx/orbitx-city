// ---------------------------------------------------------------------------
// OrbitX City — GTA / FiveM expansion: STATES + MAGIC BRIDGES
// ---------------------------------------------------------------------------
// DEAD CODE until wired (see WIRING.md). This module ONLY ADDS new geometry
// to a City object — it never edits the home city's buildCity() itself.
//
// DESIGN RULE (user): "clone each to look similar but different."
//   One shared template builds every state (same road grid, same plaza +
//   landmark tower, same district blocks, same emergency services, same
//   office tower, same bridge gates) — and a per-state / per-district STYLE
//   TABLE varies the look (palettes, heights, rooflines, props, signage) so
//   each state reads as its own place. Never a bare copy-paste: the structure
//   lives in the builders below, the variation lives in STATE_THEMES +
//   DISTRICTS.
//
// LAYOUT (world units; Z+ is south, same as the home city):
//   Home (existing OrbitX City) ....... center (0, 0), x -190..190, z -190..258
//   NY  (New York City) .............. center (-800, 0), x -990..-610
//   LA  (Los Angeles) ................ center (800, 0),  x 610..990
//   FL  (Florida) .................... center (0, 900),  z 710..1090
//   420 units of void sit between the home city and each state. The void is
//   NEVER built out — the magic bridge (a short physical deck + a portal
//   gate at its end) hops you across it. See BRIDGES below.
//
// ECONOMY: City Sol only. No real money, no SOL, no ORBITX, no burn anywhere
// in this file. Office leases mirror the HQ office prices (City Sol only).
// ---------------------------------------------------------------------------

import type {
  Anchor,
  Box,
  City,
  Collider,
  Face,
  Facade,
  Lift,
  Mat,
  Zone,
} from "./city";
import { makeRng, type Rng } from "./seed";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** The home city's road grid, reused verbatim for every state (city.ts:216). */
export const REGION_ROAD_CENTERS = [
  -180, -144, -108, -72, -36, 0, 36, 72, 108, 144, 180,
] as const;
/** Block centres sit 18 units off a road line (the middle of each block). */
export const BLOCK_CENTERS = [
  -162, -126, -90, -54, -18, 18, 54, 90, 126, 162,
] as const;
/** Half-width of one region — same extent as the home city. */
export const REGION_HALF = 190;
/** Road half-width (city.ts:217). */
export const ROAD_HALF = 5;

/** The existing OrbitX City hub. Untouched by this module. */
export const HOME_CENTER = { x: 0, z: 0 } as const;

export type StateId = "ny" | "la" | "fl";

export const REGION_CENTERS: Record<StateId, { x: number; z: number }> = {
  ny: { x: -800, z: 0 },
  la: { x: 800, z: 0 },
  fl: { x: 0, z: 900 },
};

/** Expanded world bounds once the states are wired in (see WIRING.md §2). */
export const WORLD_BOUNDS = {
  minX: -990,
  maxX: 990,
  minZ: -190,
  maxZ: 1090,
} as const;

export type DistrictQuadrant = "nw" | "ne" | "sw" | "se";

/** Per-state look. One row per state — this is where "different" lives. */
export interface StateTheme {
  /** Landmark tower height (home-city tower is the reference). */
  towerH: number;
  /** District building height range. */
  bldMin: number;
  bldMax: number;
  /** Preferred roofline for district buildings (30% vary off it). */
  roof: "flat" | "gable" | "hip" | "stepped";
  /** pretty.ts roof material index: 0 charcoal, 1 terracotta, 2 slate, 3 gold. */
  roofMat: number;
  /** Facade paint style (pretty.ts paints, 0-5). */
  style: number;
  /** Props that say "this state": palms, beach umbrellas, or dense-city none. */
  props: "palms" | "umbrellas" | "none";
  /** Boulevard centre-line accent material. */
  boulevard: Mat;
  /** Gold cornice band on district buildings (NY only). */
  cornice: boolean;
  /** Ground-floor awning on district buildings (FL only). */
  awning: boolean;
  /** Office tower height (lobby + 3 floors + roof). */
  officeH: number;
  /** Office tower finish accent. */
  officeAccent: Mat;
  /** Emergency-service names, in order [fire, police, hospital]. */
  services: [string, string, string];
  /** Plaza citizens' names. */
  citizens: [string, string, string];
}

export interface DistrictDef {
  id: string;
  state: StateId;
  name: string;
  quadrant: DistrictQuadrant;
  blurb: string;
  /** What the district is known for — rendered on its landmark board. */
  landmark: string;
  /** District wall/accent override. Falls back to the state palette. */
  wall: Mat;
  accent: Mat;
  /** 0.8 = cheap end of the state, 1.8 = the expensive end. Drives home prices. */
  priceTier: number;
}

export interface StateDef {
  id: StateId;
  name: string;
  tagline: string;
  theme: StateTheme;
  districts: [DistrictDef, DistrictDef, DistrictDef, DistrictDef];
}

// --- NY: dense, skyscraper-heavy, charcoal + glass + gold -------------------
const NY_DISTRICTS: [DistrictDef, DistrictDef, DistrictDef, DistrictDef] = [
  { id: "ny-harlem", state: "ny", name: "Harlem", quadrant: "nw", blurb: "Brownstones and jazz corners.", landmark: "Apollo Corner", wall: "red", accent: "gold", priceTier: 0.9 },
  { id: "ny-midtown", state: "ny", name: "Midtown", quadrant: "ne", blurb: "The towers that never sleep.", landmark: "Empire Spire", wall: "black", accent: "gold", priceTier: 1.6 },
  { id: "ny-brooklyn", state: "ny", name: "Brooklyn", quadrant: "sw", blurb: "Stoops, bridges, brownstones.", landmark: "Bridge View", wall: "warm", accent: "gold", priceTier: 1.0 },
  { id: "ny-queens", state: "ny", name: "Queens", quadrant: "se", blurb: "Every language on one block.", landmark: "Flushing Wall", wall: "gray", accent: "cyan", priceTier: 0.9 },
];

// --- LA: sprawl, low and wide, warm stucco + palms --------------------------
const LA_DISTRICTS: [DistrictDef, DistrictDef, DistrictDef, DistrictDef] = [
  { id: "la-hollywood", state: "la", name: "Hollywood", quadrant: "nw", blurb: "Boulevards and billboards.", landmark: "Walk of Fame", wall: "warm", accent: "red", priceTier: 1.2 },
  { id: "la-downtown", state: "la", name: "Downtown", quadrant: "ne", blurb: "Glass towers over the freeway.", landmark: "Grand Central", wall: "white", accent: "cyan", priceTier: 1.0 },
  { id: "la-venice", state: "la", name: "Venice", quadrant: "sw", blurb: "Canals, boards and beach air.", landmark: "Boardwalk", wall: "cream", accent: "cyan", priceTier: 1.3 },
  { id: "la-beverly", state: "la", name: "Beverly Hills", quadrant: "se", blurb: "Palm-lined and polished.", landmark: "Rodeo Row", wall: "cream", accent: "gold", priceTier: 1.8 },
];

// --- FL: beachy, pastel, low resort blocks + umbrellas ----------------------
const FL_DISTRICTS: [DistrictDef, DistrictDef, DistrictDef, DistrictDef] = [
  { id: "fl-orlando", state: "fl", name: "Orlando", quadrant: "nw", blurb: "Theme-park sprawl, family streets.", landmark: "Lake Eola", wall: "cream", accent: "cyan", priceTier: 0.8 },
  { id: "fl-tampa", state: "fl", name: "Tampa", quadrant: "ne", blurb: "Bay breeze and brick streets.", landmark: "Bayshore Walk", wall: "warm", accent: "white", priceTier: 0.9 },
  { id: "fl-keywest", state: "fl", name: "Key West", quadrant: "sw", blurb: "Conch cottages at the end of the road.", landmark: "Southernmost Point", wall: "white", accent: "red", priceTier: 1.1 },
  { id: "fl-miami", state: "fl", name: "Miami Beach", quadrant: "se", blurb: "Art deco pastels on the ocean.", landmark: "Ocean Drive", wall: "white", accent: "cyan", priceTier: 1.5 },
];

export const STATES: StateDef[] = [
  {
    id: "ny",
    name: "New York City",
    tagline: "Dense towers, gold trim, streets that never sleep.",
    theme: {
      towerH: 56, bldMin: 26, bldMax: 52, roof: "stepped", roofMat: 0,
      style: 1, props: "none", boulevard: "gold", cornice: true, awning: false,
      officeH: 40, officeAccent: "gold",
      services: ["FDNY Ladder 1", "NYPD 1st Precinct", "Bellevue Hospital"],
      citizens: ["Sal", "Dee", "Marcus"],
    },
    districts: NY_DISTRICTS,
  },
  {
    id: "la",
    name: "Los Angeles",
    tagline: "Low sprawl, warm stucco, palms on every boulevard.",
    theme: {
      towerH: 30, bldMin: 10, bldMax: 22, roof: "flat", roofMat: 1,
      style: 2, props: "palms", boulevard: "lane", cornice: false, awning: false,
      officeH: 26, officeAccent: "warm",
      services: ["LAFD Station 9", "LAPD Central", "County General"],
      citizens: ["Marisol", "Dante", "Lucia"],
    },
    districts: LA_DISTRICTS,
  },
  {
    id: "fl",
    name: "Florida",
    tagline: "Pastel resort blocks, boardwalk air, umbrellas out.",
    theme: {
      towerH: 24, bldMin: 8, bldMax: 18, roof: "hip", roofMat: 2,
      style: 3, props: "umbrellas", boulevard: "cyan", cornice: false, awning: true,
      officeH: 22, officeAccent: "cyan",
      services: ["Miami Fire Rescue", "Miami PD", "Jackson Memorial"],
      citizens: ["Coral", "Manny", "Sofia"],
    },
    districts: FL_DISTRICTS,
  },
];

export function stateById(id: StateId): StateDef {
  const found = STATES.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown state: ${id}`);
  return found;
}

export function districtById(id: string): DistrictDef {
  for (const s of STATES) {
    const d = s.districts.find((x) => x.id === id);
    if (d) return d;
  }
  throw new Error(`Unknown district: ${id}`);
}

/** Which district quadrant a region-local block centre belongs to. */
export function quadrantForLocal(lx: number, lz: number): DistrictQuadrant {
  if (lx < 0 && lz < 0) return "nw";
  if (lx >= 0 && lz < 0) return "ne";
  if (lx < 0) return "sw";
  return "se";
}

export function districtForLocal(state: StateDef, lx: number, lz: number): DistrictDef {
  const q = quadrantForLocal(lx, lz);
  const found = state.districts.find((d) => d.quadrant === q);
  if (!found) throw new Error(`No ${q} district in ${state.id}`);
  return found;
}

/** Outer-ring blocks (max(|x|,|z|) >= 108) are the residential ring. */
export function isOuterRingPlot(lx: number, lz: number): boolean {
  return Math.max(Math.abs(lx), Math.abs(lz)) >= 108;
}

// ---------------------------------------------------------------------------
// Shared box / collider helpers (also used by homes.ts)
// ---------------------------------------------------------------------------

export function pushBox(
  city: City,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  mat: Mat, ry = 0,
): Box {
  const b: Box = { x, y, z, sx, sy, sz, mat, ry };
  city.boxes.push(b);
  return b;
}

export function pushCol(
  city: City,
  cx: number, cy: number, cz: number,
  sx: number, sy: number, sz: number,
  tag?: string,
): Collider {
  const c: Collider = {
    minX: cx - sx / 2, minY: cy - sy / 2, minZ: cz - sz / 2,
    maxX: cx + sx / 2, maxY: cy + sy / 2, maxZ: cz + sz / 2,
  };
  if (tag) c.tag = tag;
  city.colliders.push(c);
  return c;
}

/**
 * Wall colliders for an enterable shell at (x0,z0,w,d), height h, with a
 * 4-wide door gap centred on the `door` face — the same gap pretty.ts's
 * hollow() renders, so the visual shell and the solid shell agree.
 * Includes the lintel collider above the door (y 3..h).
 */
export function pushWallColliders(
  city: City,
  x0: number, z0: number, w: number, d: number, h: number, door: Face,
): void {
  const t = 0.6;
  const gap = 4;
  const midY = h / 2;
  const run = (
    cx: number, cz: number, sx: number, sz: number,
    cy: number = midY, sy: number = h,
  ) => pushCol(city, cx, cy, cz, sx, sy, sz);
  const gapRuns = (alongX: boolean, fixed: number) => {
    // Two runs either side of the gap + a lintel above it.
    const span = alongX ? w : d;
    const origin = alongX ? x0 : z0;
    const gap0 = origin + (span - gap) / 2;
    const gap1 = gap0 + gap;
    if (alongX) {
      run((x0 + gap0) / 2, fixed, gap0 - x0, t);
      run((gap1 + x0 + w) / 2, fixed, x0 + w - gap1, t);
      run((gap0 + gap1) / 2, fixed, gap, t, 3 + (h - 3) / 2, h - 3);
    } else {
      run(fixed, (z0 + gap0) / 2, t, gap0 - z0);
      run(fixed, (gap1 + z0 + d) / 2, t, z0 + d - gap1);
      run(fixed, (gap0 + gap1) / 2, t, gap, 3 + (h - 3) / 2, h - 3);
    }
  };
  // North wall (z = z0) and south wall (z = z0 + d).
  if (door === "n") gapRuns(true, z0 + t / 2);
  else run(x0 + w / 2, z0 + t / 2, w, t);
  if (door === "s") gapRuns(true, z0 + d - t / 2);
  else run(x0 + w / 2, z0 + d - t / 2, w, t);
  // West wall (x = x0) and east wall (x = x0 + w).
  if (door === "w") gapRuns(false, x0 + t / 2);
  else run(x0 + t / 2, z0 + d / 2, t, d);
  if (door === "e") gapRuns(false, x0 + w - t / 2);
  else run(x0 + w - t / 2, z0 + d / 2, t, d);
}

/** Door face pointing from a plot toward the region centre (street-facing). */
export function doorFaceTowardCenter(
  px: number, pz: number, cx: number, cz: number,
): Face {
  const dx = cx - px;
  const dz = cz - pz;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? "e" : "w";
  return dz >= 0 ? "s" : "n";
}

/** Anchor yaw convention from city.ts doorAnchor: n=π, s=0, w=π/2, e=-π/2. */
export function yawForFace(face: Face): number {
  if (face === "n") return Math.PI;
  if (face === "s") return 0;
  if (face === "w") return Math.PI / 2;
  return -Math.PI / 2;
}

/** Door anchor one step outside the door face (city.ts doorAnchor). */
export function doorAnchorFor(
  id: string, name: string, kind: Anchor["kind"],
  x0: number, z0: number, w: number, d: number, door: Face, slot = 0,
): Anchor {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "n") return { id, name, kind, x: cx, y: 0, z: z0 - 1.4, yaw: Math.PI, slot };
  if (door === "s") return { id, name, kind, x: cx, y: 0, z: z0 + d + 1.4, yaw: 0, slot };
  if (door === "w") return { id, name, kind, x: x0 - 1.4, y: 0, z: cz, yaw: Math.PI / 2, slot };
  return { id, name, kind, x: x0 + w + 1.4, y: 0, z: cz, yaw: -Math.PI / 2, slot };
}

// ---------------------------------------------------------------------------
// Region template — one builder, styled per state
// ---------------------------------------------------------------------------

/** N/S + E/W road grid (same CENTERS spacing as the home city) + sidewalks. */
export function buildRegionRoads(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const span = REGION_HALF * 2;
  for (const c of REGION_ROAD_CENTERS) {
    // N/S strip.
    pushBox(city, cx + c, 0.06, cz, ROAD_HALF * 2, 0.12, span, "asphalt");
    pushBox(city, cx + c - 6.5, 0.1, cz, 2, 0.12, span, "sidewalk");
    pushBox(city, cx + c + 6.5, 0.1, cz, 2, 0.12, span, "sidewalk");
    // E/W strip.
    pushBox(city, cx, 0.06, cz + c, span, 0.12, ROAD_HALF * 2, "asphalt");
    pushBox(city, cx, 0.1, cz + c - 6.5, span, 0.12, 2, "sidewalk");
    pushBox(city, cx, 0.1, cz + c + 6.5, span, 0.12, 2, "sidewalk");
  }
  // Boulevard centre-line dashes on the two central avenues only.
  for (let o = -168; o <= 168; o += 24) {
    pushBox(city, cx + o, 0.13, cz, 8, 0.04, 0.8, state.theme.boulevard);
    pushBox(city, cx, 0.13, cz + o, 0.8, 0.04, 8, state.theme.boulevard);
  }
  // Florida: a boardwalk strip along the region's south edge.
  if (state.id === "fl") {
    pushBox(city, cx, 0.1, cz + 186, span, 0.12, 8, "warm");
  }
}

/** Plaza + landmark tower at the region centre. */
export function buildRegionCore(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const t = state.theme;
  pushBox(city, cx, 0.08, cz, 58, 0.08, 58, "plaza");
  // Fountain: stone base + water + pillar.
  pushBox(city, cx, 0.5, cz, 8, 1, 8, "stone");
  pushBox(city, cx, 1.05, cz, 6, 0.3, 6, "water");
  pushBox(city, cx, 1.8, cz, 1.2, 1.6, 1.2, "stone");
  // Landmark tower: one textured facade (pretty renders the box + roof kit),
  // one solid collider. Height + style carry the state's character.
  const tw = 24;
  const tower: Facade = {
    id: `${state.id}-landmark`,
    x: cx - tw / 2, z: cz - tw / 2, w: tw, d: tw, h: t.towerH,
    style: t.style, door: "", enterable: false, hero: true,
    face: "s", roof: "stepped", roofMat: t.roofMat, cornice: t.cornice,
  };
  city.facades.push(tower);
  pushCol(city, cx, t.towerH / 2, cz, tw, t.towerH, tw);
  // Gold beacon on top.
  pushBox(city, cx, t.towerH + 1, cz, 3, 2, 3, "gold");
  // Plaza corner lamps + state props.
  for (const [lx, lz] of [[-26, -26], [26, -26], [-26, 26], [26, 26]] as const) {
    pushBox(city, cx + lx, 1.5, cz + lz, 0.3, 3, 0.3, "black");
    pushBox(city, cx + lx, 3.1, cz + lz, 0.9, 0.5, 0.9, "gold");
  }
  addStateProps(city, cx - 40, cz + 40, t);
  addStateProps(city, cx + 40, cz - 40, t);
}

/** One palm (LA) or beach umbrella (FL) at a spot. NY gets none — dense. */
export function addStateProps(city: City, x: number, z: number, t: StateTheme): void {
  if (t.props === "palms") {
    pushBox(city, x, 2, z, 0.6, 4, 0.6, "trunk");
    pushBox(city, x, 4.6, z, 3.4, 1.1, 3.4, "leaves");
    pushCol(city, x, 2, z, 0.6, 4, 0.6);
  } else if (t.props === "umbrellas") {
    pushBox(city, x, 1.2, z, 0.3, 2.4, 0.3, "trunk");
    pushBox(city, x, 2.6, z, 3.2, 0.25, 3.2, "white");
  }
}

/**
 * Mid-ring district buildings: the 6x6 ring of blocks around the plaza,
 * minus the plaza blocks, the office superblock and the services plots.
 * Same loop for every state; height, roofline, palette and props vary.
 */
export function buildDistrictBlocks(city: City, state: StateDef, rng: Rng): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const t = state.theme;
  const servicePlots = new Set(["-90,-54", "90,-54", "-90,54"]);
  let n = 0;
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (Math.abs(bx) > 90 || Math.abs(bz) > 90) continue; // mid ring only
      if (Math.abs(bx) <= 18 && Math.abs(bz) <= 18) continue; // plaza
      if (Math.abs(bx) <= 18 && bz === -54) continue; // office superblock
      if (servicePlots.has(`${bx},${bz}`)) continue; // emergency services
      const district = districtForLocal(state, bx, bz);
      const h = t.bldMin + rng() * (t.bldMax - t.bldMin);
      const fw = 20 + rng() * 6;
      const fd = 20 + rng() * 6;
      // Roofline: the theme's roof most of the time, a neighbour's sometimes.
      const roofRoll = rng();
      const roof = roofRoll < 0.7 ? t.roof : roofRoll < 0.85 ? "gable" : "flat";
      const facade: Facade = {
        id: `${state.id}-b-${n}`,
        x: cx + bx - fw / 2, z: cz + bz - fd / 2, w: fw, d: fd, h,
        style: (t.style + (district.quadrant === "ne" || district.quadrant === "sw" ? 1 : 0)) % 6,
        door: "", enterable: false, hero: false,
        face: "s", roof, roofMat: t.roofMat,
        cornice: t.cornice, awning: t.awning,
      };
      city.facades.push(facade);
      pushCol(city, cx + bx, h / 2, cz + bz, fw, h, fd);
      // A gold band under the roofline for NY; a street awning for FL.
      if (t.cornice) pushBox(city, cx + bx, h - 0.4, cz + bz, fw + 0.2, 0.5, fd + 0.2, "gold");
      if (t.awning) pushBox(city, cx + bx, 3.4, cz + bz + fd / 2 + 0.8, fw * 0.7, 0.25, 1.6, "white");
      // State props at the block corner, so each street reads differently.
      if (t.props !== "none" && rng() < 0.5) {
        addStateProps(city, cx + bx + fw / 2 + 3, cz + bz + fd / 2 + 3, t);
      }
      n++;
    }
  }
}

/**
 * Emergency services — fire, police, hospital. One shared enterable shell;
 * the name, sign and interior accent change per state. Anchors are kind
 * "jobs" (they are job sites: firefighter / doctor jobs live here) and the
 * walk-in zone is kind "hall" until a dedicated services panel exists
 * (see WIRING.md §5).
 */
export function buildEmergencyServices(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const plots: Array<{ lx: number; lz: number; name: string; accent: Mat; slot: number }> = [
    { lx: -90, lz: -54, name: state.theme.services[0], accent: "red", slot: 1000 },
    { lx: 90, lz: -54, name: state.theme.services[1], accent: "black", slot: 1001 },
    { lx: -90, lz: 54, name: state.theme.services[2], accent: "white", slot: 1002 },
  ];
  for (const p of plots) {
    const w = 20;
    const d = 16;
    const h = 7;
    const x0 = cx + p.lx - w / 2;
    const z0 = cz + p.lz - d / 2;
    const door = doorFaceTowardCenter(p.lx, p.lz, 0, 0);
    const id = `${state.id}-service-${p.slot - 1000}`;
    city.facades.push({
      id, x: x0, z: z0, w, d, h, style: 2, door, enterable: true,
      hero: false, face: door, roof: "flat", roofMat: 0,
    });
    pushWallColliders(city, x0, z0, w, d, h, door);
    pushBox(city, x0 + w / 2, 0.08, z0 + d / 2, w - 2.4, 0.08, d - 2.4, "wood");
    // Reception counter + accent wall — same shell, different accent per service.
    const mx = x0 + w / 2;
    const mz = z0 + d / 2;
    pushBox(city, mx, 0.55, mz + 3, 6, 1.05, 1.1, "stone");
    pushCol(city, mx, 0.55, mz + 3, 6, 1.05, 1.1);
    pushBox(city, mx, 1.5, mz - 5, 4, 2, 0.2, p.accent);
    const zone: Zone = {
      id, name: p.name, kind: "hall", slot: p.slot,
      minX: x0 + 1.15, maxX: x0 + w - 1.15, minZ: z0 + 1.15, maxZ: z0 + d - 1.15,
      serviceX: mx, serviceZ: mz, signX: mx, signY: 2.35, signZ: z0 + d + 0.55, signRot: 0,
    };
    city.zones.push(zone);
    city.anchors.push(doorAnchorFor(id, p.name, "jobs", x0, z0, w, d, door, p.slot));
  }
}

// ---------------------------------------------------------------------------
// Office tower — one shared builder, per-state finish (clones the HQ pattern)
// ---------------------------------------------------------------------------

export interface OfficeSuite {
  id: string;
  name: string;
  floor: 2 | 3 | 4;
  tier: "standard" | "premium";
  claimable: boolean;
}

/** 12 claimable suites per state tower (floors 2-4 x A-D). City Sol leases. */
export function stateOfficeSuites(stateId: StateId): OfficeSuite[] {
  const suites: OfficeSuite[] = [];
  for (const floor of [2, 3, 4] as const) {
    for (const letter of ["a", "b", "c", "d"] as const) {
      suites.push({
        id: `office-${stateId}-f${floor}-${letter}`,
        name: `Suite ${floor}${letter.toUpperCase()}`,
        floor,
        tier: floor === 4 ? "premium" : "standard",
        claimable: true,
      });
    }
  }
  return suites;
}

/** Same lease prices as the HQ offices (api/city.js OFFICE_PRICES). City Sol only. */
export const STATE_OFFICE_PRICES = {
  standard: { 1: 100, 7: 500, 30: 1500 },
  premium: { 1: 250, 7: 1200, 30: 3500 },
} as const;

/**
 * The state's office tower, north of the plaza (local 0,-58): a glass lobby
 * you can walk into, a solid upper tower, and a working lift. The finish —
 * height, accent, style — comes from the state theme.
 */
export function buildOfficeTower(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const t = state.theme;
  const lobbyW = 40;
  const lobbyD = 28;
  const lx0 = cx - lobbyW / 2;
  const lz0 = cz - 72;
  const lobbyH = 8;
  // Lobby: enterable shell, lobby zone + "offices" anchor (opens the panel).
  city.facades.push({
    id: `${state.id}-tower`, x: lx0, z: lz0, w: lobbyW, d: lobbyD, h: lobbyH,
    style: t.style, door: "s", enterable: true, hero: false,
    face: "s", roof: "flat", roofMat: t.roofMat, cornice: t.cornice,
  });
  pushWallColliders(city, lx0, lz0, lobbyW, lobbyD, lobbyH, "s");
  pushBox(city, cx, 0.08, cz - 58, lobbyW - 2.4, 0.08, lobbyD - 2.4, "plaza");
  // Front desk + accent band.
  pushBox(city, cx, 0.55, cz - 52, 8, 1.05, 1.2, "stone");
  pushCol(city, cx, 0.55, cz - 52, 8, 1.05, 1.2);
  pushBox(city, cx, 4.5, cz - 72 + 0.4, lobbyW - 4, 1, 0.3, t.officeAccent);
  city.zones.push({
    id: `${state.id}-offices`, name: `${state.name} Tower`, kind: "office", slot: 0,
    minX: lx0 + 1.15, maxX: lx0 + lobbyW - 1.15, minZ: lz0 + 1.15, maxZ: lz0 + lobbyD - 1.15,
    serviceX: cx, serviceZ: cz - 58, signX: cx, signY: 2.35, signZ: lz0 + lobbyD + 0.55, signRot: 0,
  });
  city.anchors.push(doorAnchorFor(`${state.id}-offices`, `${state.name} Tower`, "offices", lx0, lz0, lobbyW, lobbyD, "s", 0));
  // Upper tower: solid textured facade + collider.
  const upW = 30;
  const upD = 20;
  const upH = t.officeH;
  city.facades.push({
    id: `${state.id}-tower-upper`, x: cx - upW / 2, z: lz0 + 4, w: upW, d: upD, h: upH,
    style: (t.style + 1) % 6, door: "", enterable: false, hero: false,
    face: "s", roof: "stepped", roofMat: t.roofMat, cornice: t.cornice,
  });
  pushCol(city, cx, upH / 2, lz0 + 4 + upD / 2, upW, upH, upD);
  pushBox(city, cx, upH + 0.8, lz0 + 4 + upD / 2, 4, 1.6, 4, t.officeAccent);
  // Lift shaft on the tower's east side, floors 0/8/16/24 (matches the HQ lift
  // pattern: shaft + per-floor door blockers tagged lift-door:<id>:<floor>).
  const liftId = `${state.id}-lift`;
  const liftX = cx + lobbyW / 2 - 3;
  const liftZ = cz - 58;
  const floors = [0, 8, 16, 24];
  const lift: Lift = {
    id: liftId, name: `${state.name} Tower Lift`,
    x: liftX, z: liftZ, w: 4, d: 4, floors,
    stops: ["Lobby", "Floor 2", "Floor 3", "Floor 4"],
    landing: "s",
  };
  city.lifts.push(lift);
  // Glass shaft walls (visual) + solid colliders on three sides; the landing
  // side stays open and is gated by the tagged door blockers below.
  for (const [sx, sz, w, d] of [
    [liftX - 2.1, liftZ, 0.3, 4.6],
    [liftX + 2.1, liftZ, 0.3, 4.6],
    [liftX, liftZ - 2.1, 4.6, 0.3],
  ] as const) {
    pushBox(city, sx, 12, sz, w, 24, d, "cyan");
    pushCol(city, sx, 12, sz, w, 24, d);
  }
  pushBox(city, liftX, 24.2, liftZ, 4.6, 0.4, 4.6, "black");
  for (let f = 0; f < floors.length; f++) {
    pushCol(city, liftX, floors[f] + 1.5, liftZ + 2.1, 3.2, 3, 0.3, `lift-door:${liftId}:${f}`);
    city.anchors.push({
      id: `${liftId}-f${f}`, name: lift.stops[f] ?? `Floor ${f + 1}`,
      kind: "lift", x: liftX, y: floors[f] ?? 0, z: liftZ + 3.4,
      yaw: 0, slot: f, liftId, liftFloor: f,
    });
  }
}

/** One state's full region: roads -> core -> blocks -> services -> tower. */
export function buildStateRegion(stateId: StateId, city: City, seed = 1): void {
  const state = stateById(stateId);
  const idx = STATES.findIndex((s) => s.id === stateId);
  const rng = makeRng((seed || 1) * 31 + idx * 1013 + 7);
  buildRegionRoads(city, state);
  buildRegionCore(city, state);
  buildDistrictBlocks(city, state, rng);
  buildEmergencyServices(city, state);
  buildOfficeTower(city, state);
  // A few locals on the plaza so the state feels lived-in on arrival.
  const { x: cx, z: cz } = REGION_CENTERS[stateId];
  const colors = ["sunset", "cyan", "gold"] as const;
  state.theme.citizens.forEach((name, i) => {
    city.citizens.push({
      name, color: colors[i % colors.length],
      x: cx - 12 + i * 12, z: cz + 20,
    });
  });
}

/** All three states, in one call. */
export function buildAllRegions(city: City, seed = 1): void {
  for (const s of STATES) buildStateRegion(s.id, city, seed);
}

// ---------------------------------------------------------------------------
// Magic bridges — a short physical deck + a portal gate that hops you across
// the void. Chosen approach: ZONE-TRIGGERED HOP, not a 420-unit drive.
// ---------------------------------------------------------------------------
// Why: the void between regions is empty by design (no roads, no ground
// detail, no fog budget for it). A long physical span would be a 420-unit
// dead drive through nothing; a hop keeps the magic (walk through the gold
// portal) and is deterministic in this engine — the runtime tick just checks
// the player's x/z against the gate rects and re-places them at the paired
// landing. No new physics, no moving platform, no desync. The deck itself IS
// physical (rails are real colliders, so you cannot fall off the side).
// ---------------------------------------------------------------------------

export interface BridgeGate {
  bridgeId: string;
  side: "a" | "b";
  /** The state you ARRIVE in when you cross this gate. */
  to: StateId | "home";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  landing: { x: number; z: number; yaw: number };
}

export interface BridgeDef {
  id: string;
  name: string;
  /** Deck rects: [home-side deck, state-side deck] as x0,z0,x1,z1. */
  decks: [{ x0: number; z0: number; x1: number; z1: number }, { x0: number; z0: number; x1: number; z1: number }];
  gates: [BridgeGate, BridgeGate];
}

/**
 * Gate yaw convention (engine tick: forward = (sin yaw, -cos yaw)):
 * yaw 0 = north (-z), π/2 = east (+x), -π/2 = west (-x), π = south (+z).
 * You keep walking the way you were walking — the landing faces onward.
 */
export const BRIDGES: BridgeDef[] = [
  {
    id: "bridge-west",
    name: "Empire Span",
    decks: [
      { x0: -250, z0: -12, x1: -190, z1: 12 },
      { x0: -610, z0: -12, x1: -550, z1: 12 },
    ],
    gates: [
      {
        bridgeId: "bridge-west", side: "a", to: "ny",
        minX: -250, maxX: -246, minZ: -8, maxZ: 8,
        landing: { x: -556, z: 0, yaw: -Math.PI / 2 },
      },
      {
        bridgeId: "bridge-west", side: "b", to: "home",
        minX: -554, maxX: -550, minZ: -8, maxZ: 8,
        landing: { x: -244, z: 0, yaw: Math.PI / 2 },
      },
    ],
  },
  {
    id: "bridge-east",
    name: "Sunset Span",
    decks: [
      { x0: 190, z0: -12, x1: 250, z1: 12 },
      { x0: 550, z0: -12, x1: 610, z1: 12 },
    ],
    gates: [
      {
        bridgeId: "bridge-east", side: "a", to: "la",
        minX: 246, maxX: 250, minZ: -8, maxZ: 8,
        landing: { x: 556, z: 0, yaw: Math.PI / 2 },
      },
      {
        bridgeId: "bridge-east", side: "b", to: "home",
        minX: 550, maxX: 554, minZ: -8, maxZ: 8,
        landing: { x: 244, z: 0, yaw: -Math.PI / 2 },
      },
    ],
  },
  {
    id: "bridge-south",
    name: "Palms Span",
    decks: [
      { x0: -12, z0: 258, x1: 12, z1: 318 },
      { x0: -12, z0: 650, x1: 12, z1: 710 },
    ],
    gates: [
      {
        bridgeId: "bridge-south", side: "a", to: "fl",
        minX: -8, maxX: 8, minZ: 314, maxZ: 318,
        landing: { x: 0, z: 656, yaw: Math.PI },
      },
      {
        bridgeId: "bridge-south", side: "b", to: "home",
        minX: -8, maxX: 8, minZ: 650, maxZ: 654,
        landing: { x: 0, z: 312, yaw: 0 },
      },
    ],
  },
];

export const BRIDGE_GATES: BridgeGate[] = BRIDGES.flatMap((b) => b.gates);

/** Tick hook input: which gate (if any) the player just stepped into. */
export function bridgeGateFor(x: number, z: number): BridgeGate | null {
  for (const g of BRIDGE_GATES) {
    if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return g;
  }
  return null;
}

/** Builds one bridge's physical deck: slab, sidewalks, gold rails, lamps,
 *  gate pillars and the glowing portal slab you walk through. */
export function buildBridge(city: City, bridge: BridgeDef): void {
  for (const deck of bridge.decks) {
    const cx = (deck.x0 + deck.x1) / 2;
    const cz = (deck.z0 + deck.z1) / 2;
    const w = deck.x1 - deck.x0;
    const d = deck.z1 - deck.z0;
    const alongX = w > d;
    pushBox(city, cx, 0.06, cz, w, 0.12, d, "asphalt");
    // Sidewalk edges.
    if (alongX) {
      pushBox(city, cx, 0.1, cz - 10.5, w, 0.12, 3, "sidewalk");
      pushBox(city, cx, 0.1, cz + 10.5, w, 0.12, 3, "sidewalk");
    } else {
      pushBox(city, cx - 10.5, 0.1, cz, 3, 0.12, d, "sidewalk");
      pushBox(city, cx + 10.5, 0.1, cz, 3, 0.12, d, "sidewalk");
    }
    // Gold rails along both long edges (real colliders — no falling off).
    const railLen = alongX ? w : d;
    const railOff = 11.4;
    for (const s of [-1, 1]) {
      const rx = alongX ? cx : cx + s * railOff;
      const rz = alongX ? cz + s * railOff : cz;
      pushBox(city, rx, 0.7, rz, alongX ? railLen : 0.4, 0.5, alongX ? 0.4 : railLen, "gold");
      pushCol(city, rx, 0.7, rz, alongX ? railLen : 0.4, 1.2, alongX ? 0.4 : railLen);
    }
    // Lamps down the middle.
    const steps = Math.floor(railLen / 20);
    for (let i = -steps; i <= steps; i++) {
      const lx = alongX ? cx + i * 20 : cx;
      const lz = alongX ? cz : cz + i * 20;
      pushBox(city, lx, 1.5, lz, 0.3, 3, 0.3, "black");
      pushBox(city, lx, 3.1, lz, 0.9, 0.5, 0.9, "gold");
    }
  }
  // Gate pillars + the glowing portal slab at each gate's outer edge.
  for (const gate of bridge.gates) {
    const gx = (gate.minX + gate.maxX) / 2;
    const gz = (gate.minZ + gate.maxZ) / 2;
    const alongX = gate.maxX - gate.minX < gate.maxZ - gate.minZ;
    const px = alongX ? 0 : 9;
    const pz = alongX ? 9 : 0;
    for (const s of [-1, 1]) {
      pushBox(city, gx + s * px, 3, gz + s * pz, 1.5, 6, 1.5, "gold");
    }
    // Portal: a thin glowing slab spanning the deck. Visual only (no
    // collider) — you walk straight through it and the tick hook hops you.
    pushBox(
      city, gx, 2.5, gz,
      alongX ? 0.4 : 18, 5, alongX ? 18 : 0.4,
      "cyanhot",
    );
  }
  // A sign board at the home-side gate naming the crossing.
  const homeGate = bridge.gates[0];
  const toName = homeGate.to === "home" ? "OrbitX City" : stateById(homeGate.to).name;
  city.art.push({
    id: `${bridge.id}-sign`,
    x: (homeGate.minX + homeGate.maxX) / 2,
    y: 4.2,
    z: (homeGate.minZ + homeGate.maxZ) / 2,
    rotY: bridge.id === "bridge-south" ? 0 : Math.PI / 2,
    w: 14,
    h: 3,
    lines: [bridge.name.toUpperCase(), `TO ${toName.toUpperCase()}`],
    sub: "Walk through the portal",
  });
}

/** All three bridges, in one call. */
export function buildAllBridges(city: City): void {
  for (const b of BRIDGES) buildBridge(city, b);
}
