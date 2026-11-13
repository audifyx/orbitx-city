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
//   420 units of void sit between the home city and each state. The straits
//   are crossed by REAL drivable bridges (see BRIDGES below): one continuous
//   physical deck from the home-side road to the state-side road, over the
//   water — walk it or drive it, no hop, no portal.
//
// ECONOMY: City Sol only. No real money, no SOL, no ORBITX, no burn anywhere
// in this file. Office leases mirror the HQ office prices (City Sol only).
// ---------------------------------------------------------------------------

import type {
  Anchor,
  Art,
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
import { buildStraitWater } from "./water";

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
 * Wall colliders for an enterable shell at (x0,z0,w,d), height h.
 * Closed real doors (2026-11-12): the door face is a FULL solid wall —
 * the door panel is visual + solid, and entry is E at the door anchor
 * (runtime stepInside), never a walk-through gap. The old 4-wide gap +
 * lintel made every building an open arch.
 */
export function pushWallColliders(
  city: City,
  x0: number, z0: number, w: number, d: number, h: number, _door: Face,
): void {
  const t = 0.6;
  const midY = h / 2;
  const run = (
    cx: number, cz: number, sx: number, sz: number,
    cy: number = midY, sy: number = h,
  ) => pushCol(city, cx, cy, cz, sx, sy, sz);
  // North wall (z = z0) and south wall (z = z0 + d).
  run(x0 + w / 2, z0 + t / 2, w, t);
  run(x0 + w / 2, z0 + d - t / 2, w, t);
  // West wall (x = x0) and east wall (x = x0 + w).
  run(x0 + t / 2, z0 + d / 2, t, d);
  run(x0 + w - t / 2, z0 + d / 2, t, d);
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
  // At o=0 the two dashes would both sit on the region centre and
  // overlap (z-fight) — the E/W dash alone marks the crossing.
  for (let o = -168; o <= 168; o += 24) {
    pushBox(city, cx + o, 0.13, cz, 8, 0.04, 0.8, state.theme.boulevard);
    if (o !== 0) pushBox(city, cx, 0.13, cz + o, 0.8, 0.04, 8, state.theme.boulevard);
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
  // Landmark tower: one textured facade (pretty renders the box + roof
  // kit). 2026-11-12: was a solid block (full-volume collider, no
  // inside). Now enterable: a furnished lobby on the ground floor with
  // the plaza fountain as its centrepiece, solid only above it.
  const tw = 24;
  const tower: Facade = {
    id: `${state.id}-landmark`,
    x: cx - tw / 2, z: cz - tw / 2, w: tw, d: tw, h: t.towerH,
    style: t.style, door: "s", enterable: true, hero: true,
    face: "s", roof: "stepped", roofMat: t.roofMat, cornice: t.cornice,
    glass: "curtain",
  };
  city.facades.push(tower);
  pushWallColliders(city, cx - tw / 2, cz - tw / 2, tw, tw, 8, "s");
  if (t.towerH > 8) pushCol(city, cx, (8 + t.towerH) / 2, cz, tw, t.towerH - 8, tw);
  city.zones.push(furnishStateLandmark(city, state));
  // Closed door (2026-11-12): the landmark lobby is only reachable
  // through its door anchor now — E at the door spawns inside.
  city.anchors.push(doorAnchorFor(`${state.id}-landmark`, `${state.name} Landmark`, "hall", cx - tw / 2, cz - tw / 2, tw, tw, "s", 0));
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

// ---------------------------------------------------------------------------
// STATE BUILDING FINISH — shared wallpaper / furniture helpers (audit pass,
// 2026-11-11: the state service halls and office towers were enterable but
// nearly empty inside). Same finish language as city.ts wallpaperWalls,
// adapted to the two wall systems used here:
//   - facade shells (pretty hollow(): 0.45 thick, inner face at inset
//     0.45) -> paint centre inset 0.55, band centre 0.62.
//   - voxel shells (0.6 thick, centred on the rect edge, inner face at
//     inset 0.3) -> paint centre inset 0.40, band centre 0.47.
// Paint is always proud of the wall face and the bands proud of the paint,
// so nothing z-fights. All helpers take absolute coordinates and the floor
// elevation y0, so a moved building keeps its interior.
// ---------------------------------------------------------------------------

/** One wallpapered wall segment: striped paint + wainscot + chair rail +
 * top stripe + baseboard. alongX: the wall runs along X (fixed z) or along
 * Z (fixed x). paintC/bandC are the absolute paint-centre / band-centre
 * coordinates (band proud toward the room). from/to are the segment ends
 * along the wall; y0 is the floor elevation. */
function stateWallpaperWall(
  city: City,
  alongX: boolean,
  paintC: number,
  bandC: number,
  from: number,
  to: number,
  y0: number,
  wall: Mat,
  accent: Mat,
): void {
  if (to - from < 0.2) return;
  const mid = (from + to) / 2;
  let u = from;
  while (u < to - 0.05) {
    const wallEnd = Math.min(u + 3.05, to);
    const accEnd = Math.min(u + 3.4, to);
    if (alongX) {
      pushBox(city, (u + wallEnd) / 2, y0 + 1.85, paintC, wallEnd - u, 3.15, 0.08, wall);
      if (accEnd - wallEnd > 0.05) {
        pushBox(city, (wallEnd + accEnd) / 2, y0 + 1.85, paintC, accEnd - wallEnd, 3.15, 0.08, accent);
      }
    } else {
      pushBox(city, paintC, y0 + 1.85, (u + wallEnd) / 2, 0.08, 3.15, wallEnd - u, wall);
      if (accEnd - wallEnd > 0.05) {
        pushBox(city, paintC, y0 + 1.85, (wallEnd + accEnd) / 2, 0.08, 3.15, accEnd - wallEnd, accent);
      }
    }
    u += 3.4;
  }
  const len = to - from;
  const band = (y: number, h: number, mat: Mat) => {
    if (alongX) pushBox(city, mid, y0 + y, bandC, len, h, 0.08, mat);
    else pushBox(city, bandC, y0 + y, mid, 0.08, h, len, mat);
  };
  band(0.55, 1.0, accent); // wainscot
  band(1.18, 0.12, accent); // chair rail
  band(3.25, 0.18, accent); // top stripe
  band(0.12, 0.18, "black"); // baseboard
}

/** A potted plant: stone pot + dark leaves, with a collider. */
function statePlant(city: City, x: number, z: number, y0 = 0): void {
  pushBox(city, x, y0 + 0.2, z, 0.9, 0.4, 0.9, "stone");
  pushBox(city, x, y0 + 0.5, z, 0.8, 0.9, 0.8, "leavesDark");
  pushCol(city, x, y0 + 0.5, z, 0.8, 0.9, 0.8);
}

/** A standing floor lamp: gray pole + warm head, with a collider. */
function stateLamp(city: City, x: number, z: number, y0 = 0): void {
  pushBox(city, x, y0 + 0.9, z, 0.15, 1.8, 0.15, "gray");
  pushBox(city, x, y0 + 1.85, z, 0.5, 0.3, 0.5, "warm");
  pushCol(city, x, y0 + 0.9, z, 0.3, 1.8, 0.3);
}

/** A low sofa / bench along X, with a collider. */
function stateSofa(city: City, x: number, z: number, y0: number, w: number, mat: Mat): void {
  pushBox(city, x, y0 + 0.38, z, w, 0.45, 1.1, mat);
  pushCol(city, x, y0 + 0.38, z, w, 0.45, 1.1);
}

/** A flat rug (walkable, no collider). */
function stateRug(city: City, x: number, z: number, y0: number, w: number, d: number, mat: Mat): void {
  pushBox(city, x, y0 + 0.09, z, w, 0.06, d, mat);
}

/** Ceiling for a 7-high room: slab at 3.42 + two wood beams + pendant
 * lights, mirroring the base-city venue ceilings. */
function stateCeiling(city: City, x0: number, z0: number, w: number, d: number): void {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  pushBox(city, cx, 3.42, cz, w - 0.8, 0.12, d - 0.8, "cream");
  pushCol(city, cx, 3.42, cz, w - 0.8, 0.12, d - 0.8);
  for (const off of [-w / 6, w / 6]) {
    pushBox(city, cx + off, 3.3, cz, 0.5, 0.24, d - 2.5, "wood");
  }
  for (const [px, pz] of [[cx - w / 4, cz], [cx + w / 4, cz], [cx, cz - d / 4]] as Array<[number, number]>) {
    pushBox(city, px, 3.0, pz, 0.1, 0.8, 0.1, "black");
    pushBox(city, px, 2.55, pz, 0.6, 0.3, 0.6, "warm");
  }
}

/** A wall sign plate (art) on a black board, like the district towers.
 * The board sits 0.15 behind the art plane (toward the wall), the art
 * plane 0.15 in front of the board — no coplanar faces. rotY follows the
 * art convention: 0 = faces +z (south), PI = faces -z, +/-PI/2 = faces +/-x. */
function stateSignBoard(
  city: City,
  id: string,
  x: number,
  y: number,
  z: number,
  rotY: number,
  w: number,
  h: number,
  lines: string[],
  sub: string,
): void {
  const alongX = Math.abs(Math.cos(rotY)) > 0.5;
  const s = Math.sin(rotY);
  const c = Math.cos(rotY);
  // Wall direction = opposite the facing: facing (s, 0, c) in (x, z).
  // Board centre 0.25 behind the art plane: 0.05 off the wall, 0.1 behind
  // the art — no coplanar faces anywhere.
  const bx = alongX ? x : x - 0.25 * s;
  const bz = alongX ? z - 0.25 * c : z;
  if (alongX) pushBox(city, bx, y, bz, w, h, 0.3, "black");
  else pushBox(city, bx, y, bz, 0.3, h, w, "black");
  const art: Art = { id, x, y, z, rotY, w, h, lines, sub };
  city.art.push(art);
}

/** A framed painting on a wall (gold frame + colour panels), the state
 * twin of city.ts voxelPainting. rotY follows the art convention:
 * 0 = faces +z, PI = faces -z, +/-PI/2 = faces +/-x. */
function statePainting(city: City, x: number, y: number, z: number, rotY: number, w: number, h: number): void {
  const nx = Math.sin(rotY);
  const nz = Math.cos(rotY);
  const alongX = Math.abs(nz) > 0.5;
  const t = 0.12;
  if (alongX) {
    pushBox(city, x, y, z, w + 0.3, h + 0.3, t, "gold");
    pushBox(city, x - w * 0.22, y + h * 0.1, z + nz * 0.1, w * 0.42, h * 0.5, 0.06, "cyan");
    pushBox(city, x + w * 0.2, y - h * 0.12, z + nz * 0.1, w * 0.38, h * 0.42, 0.06, "warm");
    pushBox(city, x + w * 0.05, y + h * 0.28, z + nz * 0.1, w * 0.24, h * 0.24, 0.06, "red");
  } else {
    pushBox(city, x, y, z, t, h + 0.3, w + 0.3, "gold");
    pushBox(city, x + nx * 0.1, y + h * 0.1, z - w * 0.22, 0.06, h * 0.5, w * 0.42, "cyan");
    pushBox(city, x + nx * 0.1, y - h * 0.12, z + w * 0.2, 0.06, h * 0.42, w * 0.38, "warm");
    pushBox(city, x + nx * 0.1, y + h * 0.28, z + w * 0.05, 0.06, h * 0.24, w * 0.24, "red");
  }
}

// ---------------------------------------------------------------------------
// District blocks — the 2026-11-12 audit found all 81 mid-ring blocks
// (27/state) were solid: a facade + a full-volume collider, nothing
// inside. Each one now gets a furnished ground-floor interior (same
// layout math as city.ts furnishBlock, in the state's finish language)
// and its own zone, with a south door. Every offset derives from w/d
// and is clamped; the 4-wide door lane stays clear of solid furniture.
// ---------------------------------------------------------------------------

type StateBlockKindDef = { kind: Zone["kind"]; label: string; accent: Mat; floor: Mat };

const STATE_BLOCK_KINDS: StateBlockKindDef[] = [
  { kind: "shop", label: "Shop", accent: "gold", floor: "cream" },
  { kind: "cafe", label: "Cafe", accent: "warm", floor: "wood" },
  { kind: "market", label: "Market", accent: "red", floor: "cream" },
  { kind: "bank", label: "Bank", accent: "cyan", floor: "stone" },
  { kind: "library", label: "Reading Room", accent: "wood", floor: "wood" },
  { kind: "gym", label: "Gym", accent: "red", floor: "black" },
  { kind: "museum", label: "Museum", accent: "gold", floor: "cream" },
  { kind: "hall", label: "Hall", accent: "white", floor: "wood" },
  { kind: "office", label: "Office", accent: "cyan", floor: "cream" },
  { kind: "hotel", label: "Inn", accent: "warm", floor: "wood" },
];

// Room-space point: `a` runs along the door wall, `t` runs inward from
// the door wall (0 = door wall, T = back wall).
function blockRoomPoint(door: Face, x0: number, z0: number, w: number, d: number, a: number, t: number) {
  if (door === "n") return { x: x0 + a, z: z0 + t };
  if (door === "s") return { x: x0 + w - a, z: z0 + d - t };
  if (door === "w") return { x: x0 + t, z: z0 + a };
  return { x: x0 + w - t, z: z0 + d - a };
}

// Furnished ground-floor interior for one district block (w/d 20-26).
// Returns the block's zone (id = the facade id, unique).
function furnishStateBlock(
  city: City,
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
  def: StateBlockKindDef,
  district: DistrictDef,
  id: string,
): Zone {
  const { kind, label, accent, floor } = def;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const mx = cx;
  const mz = cz;
  const alongX = door === "n" || door === "s";
  const S = alongX ? w : d;
  const T = alongX ? d : w;
  const rput = (a: number, t: number, sa: number, y: number, sy: number, st: number, mat: Mat) => {
    const p = blockRoomPoint(door, x0, z0, w, d, a, t);
    pushBox(city, p.x, y, p.z, alongX ? sa : st, sy, alongX ? st : sa, mat);
  };
  const rcol = (a: number, t: number, sa: number, y: number, sy: number, st: number) => {
    const p = blockRoomPoint(door, x0, z0, w, d, a, t);
    pushCol(city, p.x, y, p.z, alongX ? sa : st, sy, alongX ? st : sa);
  };

  // Shell finish: floor, ceiling, striped wallpaper (district wall +
  // kind accent), plants flanking the door.
  pushBox(city, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, floor);
  stateCeiling(city, x0, z0, w, d);
  // The door wall keeps its wallpaper except across the 4-wide gap.
  if (door === "w") {
    stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, mz - 2, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, mz + 2, z0 + d - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
  } else if (door === "e") {
    stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, mz - 2, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, mz + 2, z0 + d - 1.25, 0, district.wall, accent);
  } else if (door === "n") {
    stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, mx - 2, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, mx + 2, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
  } else {
    stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, mx - 2, 0, district.wall, accent);
    stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, mx + 2, x0 + w - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, z0 + d - 1.25, 0, district.wall, accent);
  }
  // Plants flanking the door wall.
  for (const a of [2.6, S - 2.6]) {
    const p = blockRoomPoint(door, x0, z0, w, d, a, 2.6);
    statePlant(city, p.x, p.z);
  }

  // Rug: centre, or pulled toward the door when a centre piece exists.
  const big = S >= 17 && T >= 16;
  const rugT = big ? T * 0.3 : T * 0.52;
  {
    const p = blockRoomPoint(door, x0, z0, w, d, S / 2, rugT);
    // Rug base 0.06: the room floor slab tops out at 0.12, and a rug at
    // base 0 has its top flush with the floor (z-fight). Base 0.06 puts
    // the rug bottom on the floor, top at 0.18.
    stateRug(city, p.x, p.z, 0.06, Math.min(6, S - 6), Math.min(4, T - 6), accent);
  }

  // Back piece on the wall opposite the door (the door lane ends here).
  const backW = Math.min(6.4, S - 6.4);
  const backT = T - 2.4;
  if (kind === "library") {
    rput(S / 2, backT, backW, 1.1, 2.2, 1.15, "wood");
    rcol(S / 2, backT, backW, 1.1, 2.2, 1.15);
    for (let i = 0; i < 3; i++) {
      rput(S / 2 - 2 + i * 2, backT, 0.4, 2.4, 0.4, 0.4, (["red", "cyan", "gold"] as Mat[])[i] as Mat);
    }
  } else if (kind === "gym") {
    rput(S / 2, backT, backW, 0.9, 1.8, 1.0, "black");
    rcol(S / 2, backT, backW, 0.9, 1.8, 1.0);
    rput(S / 2, backT, 1.6, 1.95, 0.3, 0.6, "gold");
  } else if (kind === "museum") {
    rput(S / 2, backT, backW, 0.45, 0.9, 1.1, "stone");
    rcol(S / 2, backT, backW, 0.45, 0.9, 1.1);
    rput(S / 2, backT, 0.7, 1.2, 0.5, 0.7, "gold");
  } else if (kind === "hall") {
    // Low wooden dais at the back. Centre y 0.18 so it sits ON the floor
    // (floor top 0.12) — at 0.06 its top was flush with the floor (z-fight).
    rput(S / 2, backT, Math.min(9, S - 4), 0.18, 0.12, 2.2, "wood");
    rput(S / 2, T - 1.4, Math.min(9, S - 4), 1.7, 1.6, 0.1, accent);
  } else {
    rput(S / 2, backT, backW, 0.55, 1.05, 1.15, kind === "hotel" ? "stone" : "wood");
    rcol(S / 2, backT, backW, 0.55, 1.05, 1.15);
    rput(S / 2, backT, backW + 0.2, 1.15, 0.12, 1.25, "stone");
    rput(S / 2, backT, 0.35, 1.55, 0.55, 0.35, "gold");
    if (kind === "cafe" || kind === "office") {
      for (const side of [-1, 1]) {
        rput(S / 2 + side * 2.8, T - 3.8, 0.45, 0.4, 0.45, 0.45, "black");
        rcol(S / 2 + side * 2.8, T - 3.8, 0.45, 0.4, 0.45, 0.45);
      }
    } else if (kind === "bank") {
      for (const side of [-1, 1]) {
        rput(S / 2 + side * 2.8, T - 3.6, 0.15, 0.55, 1.1, 0.15, "gold");
      }
    }
  }

  // Side furniture: two units per side wall, at 38% and 66% of the depth.
  const sideUnit = (a: number, t: number) => {
    if (kind === "shop" || kind === "market") {
      rput(a, t, 0.9, 1.2, 2.4, 2.4, "wood");
      rcol(a, t, 0.9, 1.2, 2.4, 2.4);
      for (let i = 0; i < 2; i++) {
        rput(a, t - 0.6 + i * 1.2, 0.4, 2.6, 0.4, 0.4, (["cyan", "gold"] as Mat[])[i] as Mat);
      }
    } else if (kind === "cafe") {
      rput(a, t, 1.0, 0.75, 0.1, 1.4, "wood");
      rput(a, t, 0.2, 0.35, 0.7, 0.2, "black");
      rcol(a, t, 1.0, 0.4, 0.8, 1.4);
      rput(a + (a < S / 2 ? 1.1 : -1.1), t, 0.45, 0.4, 0.45, 0.45, "black");
      rcol(a + (a < S / 2 ? 1.1 : -1.1), t, 0.45, 0.4, 0.45, 0.45);
    } else if (kind === "library") {
      rput(a, t, 0.9, 1.1, 2.2, 2.4, "wood");
      rcol(a, t, 0.9, 1.1, 2.2, 2.4);
      for (let i = 0; i < 3; i++) {
        rput(a, t - 0.7 + i * 0.7, 0.4, 2.4, 0.4, 0.4, (["red", "cyan", "gold"] as Mat[])[i] as Mat);
      }
    } else if (kind === "gym") {
      rput(a, t, 1.0, 0.4, 0.45, 2.4, "wood");
      rcol(a, t, 1.0, 0.4, 0.45, 2.4);
      rput(a, t - 0.6, 0.4, 0.75, 0.3, 0.4, "black");
      rput(a, t + 0.6, 0.4, 0.75, 0.3, 0.4, "black");
    } else if (kind === "museum") {
      rput(a, t, 1.0, 0.55, 1.1, 1.1, "stone");
      rcol(a, t, 1.0, 0.55, 1.1, 1.1);
      rput(a, t, 0.5, 1.35, 0.5, 0.5, "cyan");
    } else if (kind === "bank") {
      rput(a, t, 0.9, 0.45, 0.85, 1.1, "black");
      rcol(a, t, 0.9, 0.45, 0.85, 1.1);
      rput(a, t, 0.15, 0.55, 1.1, 0.15, "gold");
    } else if (kind === "hotel") {
      rput(a, t, 1.1, 0.4, 0.45, 2.4, "warm");
      rcol(a, t, 1.1, 0.4, 0.45, 2.4);
      rput(a, t, 0.5, 0.7, 0.25, 0.5, "gold");
    } else if (kind === "office") {
      rput(a, t, 1.0, 0.55, 0.9, 2.2, "wood");
      rcol(a, t, 1.0, 0.55, 0.9, 2.2);
      rput(a, t, 0.5, 1.2, 0.6, 0.1, "cyan");
    } else {
      rput(a, t, 1.0, 0.4, 0.45, 2.4, "wood");
      rcol(a, t, 1.0, 0.4, 0.45, 2.4);
      rput(a, t, 0.5, 0.7, 0.2, 0.5, accent);
    }
  };
  for (const a of [1.9, S - 1.9]) {
    sideUnit(a, T * 0.38);
    sideUnit(a, T * 0.66);
  }

  // Centre piece in big rooms only (the door lane runs around it).
  if (big) {
    if (kind === "museum") {
      rput(S / 2, T * 0.5, 1.0, 0.55, 1.1, 1.1, "stone");
      rcol(S / 2, T * 0.5, 1.0, 0.55, 1.1, 1.1);
      rput(S / 2, T * 0.5, 0.5, 1.35, 0.5, 0.5, "gold");
    } else if (kind === "gym") {
      rput(S / 2, T * 0.5, 3.2, 0.06, 0.12, 2.2, "red");
    } else if (kind !== "hall") {
      rput(S / 2, T * 0.5, 3.2, 0.5, 1.0, 1.6, "wood");
      rcol(S / 2, T * 0.5, 3.2, 0.5, 1.0, 1.6);
      rput(S / 2, T * 0.5, 3.4, 1.05, 0.12, 1.8, "stone");
    }
  }

  // Paintings on the side walls at mid-depth, a floor lamp mid-room,
  // plants in the back corners.
  const sideRot = (atStart: boolean): number => {
    if (door === "n") return atStart ? Math.PI / 2 : -Math.PI / 2;
    if (door === "s") return atStart ? -Math.PI / 2 : Math.PI / 2;
    if (door === "w") return atStart ? 0 : Math.PI;
    return atStart ? Math.PI : 0;
  };
  if (T >= 15) {
    for (const atStart of [true, false]) {
      const a = atStart ? 1.65 : S - 1.65;
      const p = blockRoomPoint(door, x0, z0, w, d, a, T / 2);
      statePainting(city, p.x, 1.9, p.z, sideRot(atStart), 1.6, 1.4);
    }
  }
  {
    const lamp = blockRoomPoint(door, x0, z0, w, d, S - 2.6, T * 0.5);
    stateLamp(city, lamp.x, lamp.z);
  }
  for (const a of [2.6, S - 2.6]) {
    const p = blockRoomPoint(door, x0, z0, w, d, a, T - 2.6);
    statePlant(city, p.x, p.z);
  }

  // Point `inset` inside from the wall opposite the door, centred.
  const backPt = (inset: number) => {
    if (door === "n") return { x: cx, z: z0 + d - inset, rot: Math.PI };
    if (door === "s") return { x: cx, z: z0 + inset, rot: 0 };
    if (door === "w") return { x: x0 + w - inset, z: cz, rot: -Math.PI / 2 };
    return { x: x0 + inset, z: cz, rot: Math.PI / 2 };
  };
  const back = backPt(2.4);
  const service = backPt(4.1);
  return {
    id,
    name: `${district.name} ${label}`,
    kind,
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: service.x,
    serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.55 : door === "e" ? 0.55 : 0),
    signY: 2.35,
    signZ: back.z + (door === "n" ? -0.55 : door === "s" ? 0.55 : 0),
    signRot: back.rot,
  };
}

/**
 * Furnished lobby for one state landmark tower (24x24, door "s"). The
 * plaza fountain becomes the lobby's centrepiece: benches face it on
 * all four sides, plants in the corners, a rug under it all, a sign
 * board on the north wall. The fountain gets colliders so the player
 * walks around it, not through it.
 */
function furnishStateLandmark(city: City, state: StateDef): Zone {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const x0 = cx - 12;
  const z0 = cz - 12;
  const w = 24;
  const d = 24;
  // Wallpaper (door wall split around the gap) + ceiling + rug.
  stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, x0 + w - 1.25, 0, "white", "gold");
  stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, cx - 2, 0, "white", "gold");
  stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, cx + 2, x0 + w - 1.25, 0, "white", "gold");
  stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, z0 + d - 1.25, 0, "white", "gold");
  stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, z0 + d - 1.25, 0, "white", "gold");
  stateCeiling(city, x0, z0, w, d);
  // Rug base 0.06 so it sits on the plaza slab (top 0.12), not flush with it.
  stateRug(city, cx, cz, 0.06, 20, 20, "gold");
  // Fountain colliders (base + pillar): walk around the centrepiece.
  pushCol(city, cx, 0.5, cz, 8, 1, 8);
  pushCol(city, cx, 1.8, cz, 1.2, 1.6, 1.2);
  // Benches facing the fountain on all four sides.
  stateSofa(city, cx, cz - 7, 0, 3.4, "warm");
  stateSofa(city, cx, cz + 7, 0, 3.4, "warm");
  for (const sx of [cx - 7, cx + 7]) {
    pushBox(city, sx, 0.38, cz, 1.1, 0.45, 3.4, "warm");
    pushCol(city, sx, 0.38, cz, 1.1, 0.45, 3.4);
  }
  // Plants in the corners, lamps mid-room on the side walls.
  for (const [px, pz] of [[x0 + 2.6, z0 + 2.6], [x0 + w - 2.6, z0 + 2.6], [x0 + 2.6, z0 + d - 2.6], [x0 + w - 2.6, z0 + d - 2.6]] as Array<[number, number]>) {
    statePlant(city, px, pz);
  }
  stateLamp(city, x0 + 2.6, cz);
  stateLamp(city, x0 + w - 2.6, cz);
  // Sign board on the north (back) wall.
  stateSignBoard(city, `${state.id}-landmark-sign`, cx, 2.35, z0 + 0.7, 0, 6, 1.8, [`${state.name} Landmark`], state.tagline);
  return {
    id: `${state.id}-landmark`,
    name: `${state.name} Landmark`,
    kind: "hall",
    slot: 0,
    minX: x0 + 1.15,
    maxX: x0 + w - 1.15,
    minZ: z0 + 1.15,
    maxZ: z0 + d - 1.15,
    serviceX: cx,
    serviceZ: cz - 5.5,
    signX: cx,
    signY: 2.35,
    signZ: z0 + 0.55,
    signRot: 0,
  };
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
        // 2026-11-12: was a solid block (facade + full-volume collider,
        // nothing inside). Now a real building: ground-floor shell with
        // a south door + furnished interior, solid only above the
        // ground floor. Placement (cx+bx, cz+bz, fw, fd, h) untouched.
        door: "s", enterable: true, hero: false,
        face: "s", roof, roofMat: t.roofMat,
        cornice: t.cornice, awning: t.awning,
      };
      city.facades.push(facade);
      const bx0 = cx + bx - fw / 2;
      const bz0 = cz + bz - fd / 2;
      const GH = 8;
      pushWallColliders(city, bx0, bz0, fw, fd, GH, "s");
      if (h > GH) pushCol(city, cx + bx, (GH + h) / 2, cz + bz, fw, h - GH, fd);
      const def = STATE_BLOCK_KINDS[n % STATE_BLOCK_KINDS.length] as StateBlockKindDef;
      city.zones.push(furnishStateBlock(city, bx0, bz0, fw, fd, "s", def, district, facade.id));
      // Closed door (2026-11-12): a state block interior is only reachable
      // through its door anchor now — E at the door spawns inside, E
      // inside by the door steps back out. Anchor id = zone id.
      city.anchors.push(doorAnchorFor(facade.id, def.label, def.kind, bx0, bz0, fw, fd, "s", 0));
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
 * Furnished interior for one state emergency-service hall (20x16, 7 high).
 * The shell already has a floor, a reception counter and an accent panel;
 * this adds wallpaper, a ceiling, and per-service furniture. kind: 0 =
 * fire, 1 = police, 2 = hospital. The door lane (z mz+-2, full width)
 * stays clear of solid furniture; the door is on the east or west wall
 * (doorFaceTowardCenter), so everything solid sits north/south of it.
 */
function furnishStateService(
  city: City,
  x0: number,
  z0: number,
  w: number,
  d: number,
  door: Face,
  kind: 0 | 1 | 2,
  accent: Mat,
): void {
  const mx = x0 + w / 2;
  const mz = z0 + d / 2;
  const wpAccent: Mat = kind === 2 ? "cyan" : accent; // hospital: cyan, not white-on-white
  // Wallpaper (facade hollow walls, inner face 0.45 -> paint 0.55, band 0.62).
  stateWallpaperWall(city, true, z0 + 0.55, z0 + 0.62, x0 + 1.25, x0 + w - 1.25, 0, "white", wpAccent);
  stateWallpaperWall(city, true, z0 + d - 0.55, z0 + d - 0.62, x0 + 1.25, x0 + w - 1.25, 0, "white", wpAccent);
  if (door === "w") {
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, mz - 2, 0, "white", wpAccent);
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, mz + 2, z0 + d - 1.25, 0, "white", wpAccent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, z0 + d - 1.25, 0, "white", wpAccent);
  } else {
    stateWallpaperWall(city, false, x0 + 0.55, x0 + 0.62, z0 + 1.25, z0 + d - 1.25, 0, "white", wpAccent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, z0 + 1.25, mz - 2, 0, "white", wpAccent);
    stateWallpaperWall(city, false, x0 + w - 0.55, x0 + w - 0.62, mz + 2, z0 + d - 1.25, 0, "white", wpAccent);
  }
  stateCeiling(city, x0, z0, w, d);
  const rugMat: Mat = kind === 0 ? "red" : kind === 1 ? "black" : "white";
  // Rug base 0.06 so it sits on the wood floor (top 0.12), not flush with it.
  stateRug(city, mx, mz + 0.8, 0.06, 5, 2.6, rugMat);
  const plantX = door === "e" ? x0 + 17.5 : x0 + 2.5;
  if (kind === 0) {
    // Fire: engine truck + gear lockers + hose rack + brass pole + benches.
    pushBox(city, mx - 1, 1.0, mz - 4.5, 5.5, 1.8, 2.4, "red");
    pushCol(city, mx - 1, 1.0, mz - 4.5, 5.5, 1.8, 2.4);
    pushBox(city, mx + 2.6, 0.9, mz - 4.5, 1.6, 1.4, 2.2, "black");
    pushCol(city, mx + 2.6, 0.9, mz - 4.5, 1.6, 1.4, 2.2);
    for (const [wx, wz] of [[mx - 3.5, mz - 5.7], [mx - 3.5, mz - 3.3], [mx + 1.5, mz - 5.7], [mx + 1.5, mz - 3.3]] as Array<[number, number]>) {
      pushBox(city, wx, 0.35, wz, 0.7, 0.7, 0.4, "black");
    }
    for (const lx of [mx - 8.5, mx - 6.5, mx - 4.5]) {
      pushBox(city, lx, 1.1, mz - 6.8, 2, 2.2, 0.8, "gray");
      pushCol(city, lx, 1.1, mz - 6.8, 2, 2.2, 0.8);
    }
    pushBox(city, x0 + 1.2, 1.2, mz + 4.5, 0.4, 2.2, 2.4, "wood");
    pushBox(city, x0 + 1.2, 1.5, mz - 4.5, 0.4, 3.0, 0.4, "gold");
    stateSofa(city, mx - 5, mz + 6, 0, 2.4, "red");
    stateSofa(city, mx + 5, mz + 6, 0, 2.4, "red");
    statePlant(city, plantX, mz - 4.5);
  } else if (kind === 1) {
    // Police: patrol desks + screens, holding cells, evidence lockers.
    for (const dx of [mx - 4, mx + 4]) {
      pushBox(city, dx, 0.55, mz - 3.5, 3, 0.9, 1.2, "wood");
      pushCol(city, dx, 0.55, mz - 3.5, 3, 0.9, 1.2);
      pushBox(city, dx, 1.35, mz - 3.9, 1.4, 0.9, 0.1, "cyan");
    }
    for (const bx of [mx - 6, mx - 4.5, mx - 3]) {
      pushBox(city, bx, 1.6, mz - 6.5, 0.25, 3.2, 0.25, "black");
    }
    pushBox(city, mx - 4.5, 0.4, mz - 6.5, 4.5, 0.5, 1.0, "red");
    pushCol(city, mx - 4.5, 0.4, mz - 6.5, 4.5, 0.5, 1.0);
    pushBox(city, mx + 8.5, 1.1, mz + 5, 0.8, 2.2, 3, "gray");
    pushCol(city, mx + 8.5, 1.1, mz + 5, 0.8, 2.2, 3);
    statePlant(city, plantX, mz - 4.5);
  } else {
    // Hospital: three ward beds + triage desk + privacy screens.
    for (const bx of [mx - 5.5, mx, mx + 5.5]) {
      pushBox(city, bx, 0.45, mz - 4.5, 2.0, 0.6, 3.2, "white");
      pushCol(city, bx, 0.45, mz - 4.5, 2.0, 0.6, 3.2);
      pushBox(city, bx, 0.8, mz - 5.7, 1.4, 0.25, 0.7, "cream");
    }
    pushBox(city, mx - 6, 0.55, mz + 3.5, 3, 0.9, 1.2, "wood");
    pushCol(city, mx - 6, 0.55, mz + 3.5, 3, 0.9, 1.2);
    pushBox(city, mx - 6, 1.35, mz + 3.9, 1.4, 0.9, 0.1, "cyanhot");
    for (const sx of [mx - 2.75, mx + 2.75]) {
      pushBox(city, sx, 1.0, mz - 4.5, 0.15, 2.0, 3.0, "cream");
    }
    statePlant(city, plantX, door === "e" ? mz + 4.5 : mz - 4.5);
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
    // Accent panel on the north wall (was floating mid-room at mz-5, where
    // the furnished interior now sits — see furnishStateService).
    pushBox(city, mx, 1.5, mz - 7.15, 4, 2, 0.2, p.accent);
    furnishStateService(city, x0, z0, w, d, door, (p.slot - 1000) as 0 | 1 | 2, p.accent);
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
 * Furnished interior for one state office tower (audit pass, 2026-11-11).
 * Before: the lobby held a front desk + an accent band and the upper tower
 * was a SOLID block — the lift offered Floors 2-4 and the catalog sold 12
 * suites per tower, but no floor existed above the lobby (the front desk
 * was even embedded inside the solid core). After: a furnished lobby + hall,
 * and real walkable suite floors at 8/12/16 (the lift's stops, re-spaced
 * from [0,8,16,24] — 24 did not fit the FL tower at 22 high, and LA's 26
 * left only 2 units of headroom).
 *
 * How the upper floors connect: the lift shaft sits half outside the
 * tower's east face, so each floor has a balcony slab under the lift's
 * landing anchor (the runtime deposits the rider exactly on the anchor —
 * no floor there means a fall back to the lobby), a doorway panel on the
 * tower's east face, and a full-height slot in the voxel east wall that
 * opens into the floor's corridor. The upper facade is flipped to
 * enterable (door "s") so pretty renders it hollow with the ground-floor
 * south gap the voxel walls mirror; the voxel shell is 0.6 thick centred
 * on the tower edges (district-tower pattern), inner face at inset 0.3.
 */
function furnishStateTower(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const t = state.theme;
  const accent = t.officeAccent;
  const lobbyW = 40;
  const lx0 = cx - lobbyW / 2;
  const lz0 = cz - 72;
  const upX0 = cx - 15;
  const upZ0 = cz - 68;
  const upH = t.officeH;

  // ---- Lobby wallpaper (facade hollow walls, inner face 0.45). ----
  stateWallpaperWall(city, true, lz0 + 0.55, lz0 + 0.62, lx0 + 1.25, lx0 + 38.75, 0, "white", accent);
  stateWallpaperWall(city, true, lz0 + 27.45, lz0 + 27.38, lx0 + 1.25, cx - 2, 0, "white", accent);
  stateWallpaperWall(city, true, lz0 + 27.45, lz0 + 27.38, cx + 2, lx0 + 38.75, 0, "white", accent);
  stateWallpaperWall(city, false, lx0 + 0.55, lx0 + 0.62, lz0 + 1.25, lz0 + 26.75, 0, "white", accent);
  stateWallpaperWall(city, false, lx0 + 39.45, lx0 + 39.38, lz0 + 1.25, lz0 + 26.75, 0, "white", accent);

  // ---- Lobby ring: west lounge, east lift side, north benches, south rug. ----
  stateRug(city, cx - 17.5, cz - 58, 0, 3, 8, accent);
  stateSofa(city, cx - 17.5, cz - 52, 0, 3.4, "red");
  stateSofa(city, cx - 17.5, cz - 64, 0, 3.4, "red");
  statePlant(city, cx - 17.5, cz - 58);
  statePlant(city, cx + 17.5, cz - 48);
  stateLamp(city, cx + 17.5, cz - 66);
  stateSofa(city, cx - 10, cz - 46, 0, 3.4, "red");
  stateSofa(city, cx + 10, cz - 46, 0, 3.4, "red");
  statePlant(city, cx - 17, cz - 46);
  statePlant(city, cx + 17, cz - 46);
  stateRug(city, cx, cz - 70, 0, 6, 2, accent);
  for (const [px, pz] of [[cx - 17.5, cz - 58], [cx + 17.5, cz - 48]] as Array<[number, number]>) {
    pushBox(city, px, 7.4, pz, 0.1, 1.2, 0.1, "black");
    pushBox(city, px, 6.7, pz, 0.6, 0.3, 0.6, "warm");
  }

  // ---- Core hall (tower ground floor): rug, sofas, plants, lamp, directory. ----
  stateRug(city, cx, cz - 58, 0, 8, 6, accent);
  stateSofa(city, cx - 8, cz - 64, 0, 3.4, "red");
  stateSofa(city, cx + 8, cz - 64, 0, 3.4, "red");
  statePlant(city, cx - 13, cz - 66);
  statePlant(city, cx + 13, cz - 66);
  stateLamp(city, cx + 13, cz - 52);
  stateSignBoard(city, `dir-${state.id}-tower`, cx - 6, 3.35, cz - 67.25, 0, 4.6, 0.85, ["OFFICE DIRECTORY"], `${state.name} Tower`);
  stateSignBoard(city, `dir2-${state.id}-tower`, cx - 6, 2.45, cz - 67.25, 0, 4.6, 0.85, ["Floor 2", "Suites 2A – 2D"], "Standard offices");
  stateSignBoard(city, `dir3-${state.id}-tower`, cx - 6, 1.55, cz - 67.25, 0, 4.6, 0.85, ["Floor 3", "Suites 3A – 3D"], "Standard offices");
  stateSignBoard(city, `dir4-${state.id}-tower`, cx - 6, 0.65, cz - 67.25, 0, 4.6, 0.85, ["Floor 4", "Suites 4A – 4D"], "Premium suites");

  // ---- Tower voxel shell (replaces the solid upper-tower collider). ----
  const wall = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    pushBox(city, x, y, z, sx, sy, sz, "cream");
    pushCol(city, x, y, z, sx, sy, sz);
  };
  wall(cx, upH / 2, upZ0, 30, upH, 0.6); // north
  wall(cx - 8.5, upH / 2, upZ0 + 20, 13, upH, 0.6); // south, west of the door
  wall(cx + 8.5, upH / 2, upZ0 + 20, 13, upH, 0.6); // south, east of the door
  wall(cx, (3 + upH) / 2, upZ0 + 20, 4, upH - 3, 0.6); // south header above the door
  wall(upX0, upH / 2, cz - 58, 0.6, upH, 20); // west
  wall(cx + 15, upH / 2, cz - 61.5, 0.6, upH, 13); // east, north of the balcony slot
  wall(cx + 15, upH / 2, cz - 49.75, 0.6, upH, 3.5); // east, south of the balcony slot

  // ---- Suite floors (8/12/16) + balconies + door panels + floor-4 ceiling. ----
  const letters = ["a", "b", "c", "d"] as const;
  const floors = [8, 12, 16] as const;
  for (let fi = 0; fi < floors.length; fi++) {
    const floorY = floors[fi];
    const floor = (fi + 2) as 2 | 3 | 4;
    const premium = floor === 4;
    pushBox(city, cx, floorY, cz - 58, 29.2, 0.12, 19.2, "cream");
    pushCol(city, cx, floorY, cz - 58, 29.2, 0.12, 19.2);
    // Balcony under the lift landing anchor (cx+17, cz-54.6), 0.02 above
    // the floor slab so the overlap under the wall never z-fights.
    pushBox(city, cx + 17.05, floorY + 0.02, cz - 53.35, 4.9, 0.12, 4.7, "cream");
    pushCol(city, cx + 17.05, floorY + 0.02, cz - 53.35, 4.9, 0.12, 4.7);
    pushBox(city, cx + 19.4, floorY + 0.55, cz - 53.35, 0.2, 1.1, 4.7, accent);
    pushCol(city, cx + 19.4, floorY + 0.55, cz - 53.35, 0.2, 1.1, 4.7);
    pushBox(city, cx + 17.25, floorY + 0.55, cz - 51.1, 4.5, 1.1, 0.2, accent);
    pushCol(city, cx + 17.25, floorY + 0.55, cz - 51.1, 4.5, 1.1, 0.2);
    // Dark doorway panel on the tower's east face, in the balcony slot.
    pushBox(city, cx + 15.09, floorY + 1.5, cz - 53.25, 0.1, 3.4, 3.9, "gold");
    pushBox(city, cx + 15.14, floorY + 1.5, cz - 53.25, 0.12, 3.0, 3.5, "black");
    if (premium) {
      pushBox(city, cx, 19.4, cz - 58, 29.2, 0.12, 19.2, "cream");
      pushCol(city, cx, 19.4, cz - 58, 29.2, 0.12, 19.2);
      for (const off of [-5, 5]) pushBox(city, cx + off, 19.28, cz - 58, 0.5, 0.24, 17.5, "wood");
    }
    // Suite partitions: 4 bays in the north row, corridor along the south.
    for (const px of [cx - 7.5, cx, cx + 7.5]) {
      pushBox(city, px, floorY + 1.6, cz - 62.65, 0.3, 3.2, 10.1, "cream");
      pushCol(city, px, floorY + 1.6, cz - 62.65, 0.3, 3.2, 10.1);
    }
    for (let k = 0; k < 4; k++) {
      const bayCx = cx - 11.25 + 7.5 * k;
      const letter = letters[k];
      pushBox(city, bayCx, floorY + 0.45, cz - 65.4, 2.0, 0.75, 1.0, "wood");
      pushCol(city, bayCx, floorY + 0.45, cz - 65.4, 2.0, 0.75, 1.0);
      pushBox(city, bayCx, floorY + 0.3, cz - 63.6, 0.7, 0.6, 0.7, premium ? "gold" : "black");
      pushCol(city, bayCx, floorY + 0.3, cz - 63.6, 0.7, 0.6, 0.7);
      pushBox(city, bayCx + 2.2, floorY + 0.3, cz - 63.6, 0.7, 0.6, 0.7, "black");
      pushCol(city, bayCx + 2.2, floorY + 0.3, cz - 63.6, 0.7, 0.6, 0.7);
      stateRug(city, bayCx, cz - 64.5, floorY, 3.2, 2.6, premium ? "gold" : accent);
      statePlant(city, bayCx + 2.6, cz - 66.3, floorY);
      city.art.push({
        id: `suite-office-${state.id}-f${floor}-${letter}`,
        x: bayCx, y: floorY + 2.6, z: cz - 67.25, rotY: 0, w: 4.6, h: 0.9,
        lines: [`Suite ${floor}${letter.toUpperCase()}`],
        sub: premium ? "Premium suite" : "Standard office",
      });
    }
    // Tower wallpaper for this floor (voxel walls, inner face 0.3).
    // (Ground floor y0=0 is painted after the loop — its south wall splits
    // around the door gap.)
    stateWallpaperWall(city, true, upZ0 + 0.4, upZ0 + 0.47, upX0 + 1.25, upX0 + 28.75, floorY, "white", accent);
    stateWallpaperWall(city, true, upZ0 + 19.6, upZ0 + 19.53, upX0 + 1.25, upX0 + 28.75, floorY, "white", accent);
    stateWallpaperWall(city, false, upX0 + 0.4, upX0 + 0.47, upZ0 + 1.25, upZ0 + 18.75, floorY, "white", accent);
    stateWallpaperWall(city, false, upX0 + 29.6, upX0 + 29.53, upZ0 + 1.25, cz - 55, floorY, "white", accent);
    stateWallpaperWall(city, false, upX0 + 29.6, upX0 + 29.53, cz - 51.5, upZ0 + 18.75, floorY, "white", accent);
  }
  // Ground-floor (hall) wallpaper on the tower walls, y0 = 0.
  stateWallpaperWall(city, true, upZ0 + 0.4, upZ0 + 0.47, upX0 + 1.25, upX0 + 28.75, 0, "white", accent);
  stateWallpaperWall(city, true, upZ0 + 19.6, upZ0 + 19.53, upX0 + 1.25, cx - 2, 0, "white", accent);
  stateWallpaperWall(city, true, upZ0 + 19.6, upZ0 + 19.53, cx + 2, upX0 + 28.75, 0, "white", accent);
  stateWallpaperWall(city, false, upX0 + 0.4, upX0 + 0.47, upZ0 + 1.25, upZ0 + 18.75, 0, "white", accent);
  stateWallpaperWall(city, false, upX0 + 29.6, upX0 + 29.53, upZ0 + 1.25, cz - 55, 0, "white", accent);
  stateWallpaperWall(city, false, upX0 + 29.6, upX0 + 29.53, cz - 51.5, upZ0 + 18.75, 0, "white", accent);
}

/**
 * The state's office tower, north of the plaza (local 0,-58): a glass lobby
 * you can walk into, furnished suite floors 2-4 with a working lift, and a
 * roof crown. The finish — height, accent, style — comes from the state theme.
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
    glass: "curtain",
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
  // Upper tower: hollow enterable facade (pretty renders the south door
  // gap) + voxel shell, floor slabs and furnished suites from
  // furnishStateTower — NOT a solid block (audit 2026-11-11: the solid
  // collider made the lift's Floors 2-4 and the 12 catalogued suites
  // unreachable, and embedded the lobby's front desk).
  // Closed doors (2026-11-12): the upper mass has NO street door — the
  // lobby door below is the only entrance, reached by the lift inside.
  // Its old door:"s" drew a ground-floor gap into the lobby's back wall.
  const upW = 30;
  const upD = 20;
  const upH = t.officeH;
  // The upper tower's visible shell is its cream voxel wall (furnishStateTower),
  // 0.3 proud of the pretty shell — so it gets proud curtain bands on the
  // voxel plane and no wall holes. The east band splits around the lift
  // balcony slot (face-centre offsets +2.5..+7, the slot at cz-55..cz-51.5).
  city.facades.push({
    id: `${state.id}-tower-upper`, x: cx - upW / 2, z: lz0 + 4, w: upW, d: upD, h: upH,
    style: (t.style + 1) % 6, door: "", enterable: true, hero: false,
    face: "s", roof: "stepped", roofMat: t.roofMat, cornice: t.cornice,
    glass: "curtain", glassProud: 0.36, glassSkip: { face: "e", from: 2.5, to: 7 },
  });
  pushBox(city, cx, upH + 0.8, lz0 + 4 + upD / 2, 4, 1.6, 4, t.officeAccent);
  furnishStateTower(city, state);
  // Lift shaft on the tower's east side, floors 0/8/12/16 (HQ pattern:
  // 4-unit spacing so every floor fits every state's tower — the old
  // [0,8,16,24] put Floor 4 above FL's 22-high tower and left LA's 26-high
  // tower with 2 units of headroom). Shaft + per-floor door blockers tagged
  // lift-door:<id>:<floor>, as the HQ lift.
  const liftId = `${state.id}-lift`;
  const liftX = cx + lobbyW / 2 - 3;
  const liftZ = cz - 58;
  const floors = [0, 8, 12, 16];
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
  // District bridges + the ground under them: the region used to sit on
  // nothing (only the home city had a ground slab), so every district
  // crossing was a walk across floating road strips. The ground slab makes
  // the whole region solid; the bridges give each district pair a proper
  // walkable + drivable crossing. Anchored to the region axes only — never
  // to a building — so the spacing pass cannot break them.
  buildRegionGround(city, state);
  buildDistrictBridgesForState(city, state);
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
  // Deep water between the states (water.ts): fills the void between the
  // home slab and each region with a real strait — surface at y=-1 over a
  // seabed at y=-6. Runs after the region ground slabs so the shorelines
  // abut the slab edges exactly.
  buildStraitWater(city);
}

// ---------------------------------------------------------------------------
// Region ground — the fix for "no ground jus floating"
// ---------------------------------------------------------------------------
// The home city has one ground slab (city.ts addRoads: 760x760 grass, top
// y=0). The states NEVER had one: roads, plaza, buildings and sidewalks
// were thin boxes floating over the void, and the home slab's edge at
// +/-380 "cut" the terrain on the way to every district crossing. The
// physics ground is y=0 everywhere (engine.ts clamps it), so the player
// never fell — they just walked on nothing.
//
// This lays the same grass slab under each region (380x380, top y=0) plus a
// ground strip under the state-side bridge deck, which sticks 60 units out
// of the region toward home. The strait between the home slab and the region
// stays open water by design — the real bridge deck spans it (BRIDGES).
// ---------------------------------------------------------------------------

/** Region rect (world coords) for one state. */
export function regionRect(stateId: StateId): { x0: number; x1: number; z0: number; z1: number } {
  const { x: cx, z: cz } = REGION_CENTERS[stateId];
  return { x0: cx - REGION_HALF, x1: cx + REGION_HALF, z0: cz - REGION_HALF, z1: cz + REGION_HALF };
}

export function buildRegionGround(city: City, state: StateDef): void {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  // The region slab: same shape as the home-city slab (city.ts addRoads),
  // top at y=0, so every road, block, plaza and district crossing sits on
  // solid grass.
  pushBox(city, cx, -0.55, cz, REGION_HALF * 2, 1.1, REGION_HALF * 2, "grass");
  // Ground under the state-side bridge deck: the deck sticks out of
  // the region toward home, so extend the slab to the deck's outer end
  // (2 units of margin). The slab abuts the region slab exactly at the
  // region edge — never overlapping it, so no coplanar top faces.
  const bridge = BRIDGES.find((b) => b.to === state.id);
  if (!bridge) return;
  const d = bridge.decks[1] as { x0: number; z0: number; x1: number; z1: number };
  const r = regionRect(state.id);
  let ax0 = d.x0 - 2;
  let ax1 = d.x1 + 2;
  let az0 = d.z0 - 2;
  let az1 = d.z1 + 2;
  if (d.x0 >= r.x1) ax0 = r.x1; // deck east of the region
  if (d.x1 <= r.x0) ax1 = r.x0; // deck west of the region
  if (d.z0 >= r.z1) az0 = r.z1; // deck south of the region
  if (d.z1 <= r.z0) az1 = r.z0; // deck north of the region
  if (ax1 - ax0 <= 0 || az1 - az0 <= 0) return;
  pushBox(city, (ax0 + ax1) / 2, -0.55, (az0 + az1) / 2, ax1 - ax0, 1.1, az1 - az0, "grass");
}

// ---------------------------------------------------------------------------
// District bridges — PHYSICAL decks between adjacent districts
// ---------------------------------------------------------------------------
// The inter-state bridges span the straits between the home city and a
// state (real drivable decks — see BRIDGES). District bridges are the same
// idea on a smaller scale: a short deck over the grass between two
// neighbouring districts INSIDE one region. You walk or drive across it
// normally — there is no portal, no gate, no hop.
//
// Placement: each deck sits ON the road that crosses the district boundary,
// centred on the boundary line, so its ends land on district ground on both
// sides. The road axes are the only anchors — the spacing pass moves
// buildings, not roads, so a bridge can never be orphaned by a moved
// building. Width 10 = a 6-wide driving lane + 2+2 sidewalks, inside the
// 14-wide road corridor (10 asphalt + 2+2 sidewalks), so the deck cannot
// touch a flanking building at all (seed 1: the closest facade face clears
// the deck edge, and the rails clear every wall by half a unit) — and the
// spacing pass can only push buildings further away.
// ---------------------------------------------------------------------------

export interface DistrictBridgeDef {
  id: string;
  name: string;
  /** Deck centre (world coords). */
  x: number;
  z: number;
  /** true = the deck runs east-west (long axis X), false = north-south. */
  alongX: boolean;
  /** Deck length along its long axis. */
  len: number;
  /** Deck width (across the long axis). */
  width: number;
  /** Sign lines, e.g. ["HARLEM — MIDTOWN", "DISTRICT BRIDGE"]. */
  sign: [string, string];
}

/** Deck asphalt sits 0.015 above the road asphalt so no two top faces are
 * coplanar (the deck crosses roads at the same height as the inter-state bridge decks). */
export const DISTRICT_BRIDGE_DECK_Y = 0.075;

/**
 * One physical district bridge: asphalt deck, sidewalks, gold rails with
 * real colliders (you cannot drive or walk off the sides), lamps down the
 * middle, and a sign board naming both districts. No portal, no gate.
 */
export function buildDistrictBridge(city: City, def: DistrictBridgeDef): void {
  const { x: cx, z: cz, alongX, len, width } = def;
  const railOff = width / 2 - 0.6;
  // Deck + sidewalks. Sidewalk boxes sit 2 wide, 1 unit in from each edge.
  pushBox(city, cx, DISTRICT_BRIDGE_DECK_Y, cz, alongX ? len : width, 0.12, alongX ? width : len, "asphalt");
  if (alongX) {
    pushBox(city, cx, 0.115, cz - width / 2 + 1, len, 0.12, 2, "sidewalk");
    pushBox(city, cx, 0.115, cz + width / 2 - 1, len, 0.12, 2, "sidewalk");
  } else {
    pushBox(city, cx - width / 2 + 1, 0.115, cz, 2, 0.12, len, "sidewalk");
    pushBox(city, cx + width / 2 - 1, 0.115, cz, 2, 0.12, len, "sidewalk");
  }
  // Gold rails along both long edges (real colliders — no falling off).
  for (const s of [-1, 1]) {
    const rx = alongX ? cx : cx + s * railOff;
    const rz = alongX ? cz + s * railOff : cz;
    pushBox(city, rx, 0.7, rz, alongX ? len : 0.4, 0.5, alongX ? 0.4 : len, "gold");
    pushCol(city, rx, 0.7, rz, alongX ? len : 0.4, 1.2, alongX ? 0.4 : len);
  }
  // Lamps down the middle, every 12 units.
  const steps = Math.max(1, Math.floor(len / 12));
  for (let i = 0; i < steps; i++) {
    const o = (i - (steps - 1) / 2) * 12;
    const lx = alongX ? cx + o : cx;
    const lz = alongX ? cz : cz + o;
    pushBox(city, lx, 1.5, lz, 0.3, 3, 0.3, "black");
    pushBox(city, lx, 3.1, lz, 0.9, 0.5, 0.9, "gold");
  }
  // Sign board at the deck's west / north end, facing the approach.
  const signX = alongX ? cx - len / 2 + 2 : cx;
  const signZ = alongX ? cz : cz - len / 2 + 2;
  city.art.push({
    id: `${def.id}-sign`,
    x: signX,
    y: 4.2,
    z: signZ,
    rotY: alongX ? Math.PI / 2 : 0,
    w: 14,
    h: 3,
    lines: [def.sign[0], def.sign[1]],
    sub: "Walk or drive across",
  });
}

/**
 * The four district bridges for one state. Adjacent quadrant pairs share a
 * boundary road, and the crossing sits on it: NW-NE and SW-SE cross the
 * central north-south avenue on the +/-108 east-west roads; NW-SW and
 * NE-SE cross the central east-west avenue on the +/-108 north-south roads.
 * +/-108 is the first crossing road clear of the plaza, the office
 * superblock and the emergency-services plots.
 */
export function districtBridgesForState(state: StateDef): DistrictBridgeDef[] {
  const { x: cx, z: cz } = REGION_CENTERS[state.id];
  const byQuadrant = (q: DistrictQuadrant): DistrictDef =>
    state.districts.find((d) => d.quadrant === q) as DistrictDef;
  const pair = (a: DistrictQuadrant, b: DistrictQuadrant): [string, string] => [
    `${byQuadrant(a).name} — ${byQuadrant(b).name}`.toUpperCase(),
    "DISTRICT BRIDGE",
  ];
  const len = 36;
  const width = 10;
  return [
    { id: `${state.id}-d-n`, name: `${byQuadrant("nw").name} — ${byQuadrant("ne").name} Bridge`, x: cx, z: cz - 108, alongX: true, len, width, sign: pair("nw", "ne") },
    { id: `${state.id}-d-s`, name: `${byQuadrant("sw").name} — ${byQuadrant("se").name} Bridge`, x: cx, z: cz + 108, alongX: true, len, width, sign: pair("sw", "se") },
    { id: `${state.id}-d-w`, name: `${byQuadrant("nw").name} — ${byQuadrant("sw").name} Bridge`, x: cx - 108, z: cz, alongX: false, len, width, sign: pair("nw", "sw") },
    { id: `${state.id}-d-e`, name: `${byQuadrant("ne").name} — ${byQuadrant("se").name} Bridge`, x: cx + 108, z: cz, alongX: false, len, width, sign: pair("ne", "se") },
  ];
}

/** One state's four district bridges, in one call. */
export function buildDistrictBridgesForState(city: City, state: StateDef): void {
  for (const def of districtBridgesForState(state)) buildDistrictBridge(city, def);
}

/** All twelve state district bridges (4 per state), in one call. */
export function buildAllDistrictBridges(city: City): void {
  for (const s of STATES) buildDistrictBridgesForState(city, s);
}

// ---------------------------------------------------------------------------
// Real bridges — one continuous physical deck per strait, drivable + walkable
// ---------------------------------------------------------------------------
// 2026-11-12 (water-crossings batch): the old magic bridges were a short
// deck stub on each shore + a zone-triggered portal hop across the void.
// That is gone. Each crossing is now one continuous deck from the home-side
// road to the state-side road: the two 60-unit shore stubs (already built)
// plus a middle SPAN that closes the gap between them — 300 units west/east,
// 332 south — over the open water. No gate, no portal, no hop anywhere on
// the route: you drive or walk the whole way, and nothing re-places you
// (there is no bridgeGateFor any more; engine tick + car drive lost their
// hop blocks with it).
//
// Cross-section matches the shore stubs exactly (24 wide: asphalt deck at
// y 0.06, 3-wide sidewalks at ±10.5, gold rails with REAL colliders at
// ±11.4), so the span abuts the stubs edge-to-edge — no gap, no step, no
// coplanar overlap. Lamps run down the middle of the whole crossing.
// ---------------------------------------------------------------------------

export interface BridgeDef {
  id: string;
  name: string;
  /** The state this bridge reaches. */
  to: StateId;
  /** Deck rects: [home-side deck, state-side deck] as x0,z0,x1,z1. */
  decks: [{ x0: number; z0: number; x1: number; z1: number }, { x0: number; z0: number; x1: number; z1: number }];
  /** The middle span that closes the gap between the two shore decks,
   *  as x0,z0,x1,z1. It abuts each stub edge-to-edge (west span.x1 === home
   *  deck.x0, etc.) so the drive is continuous. */
  span: { x0: number; z0: number; x1: number; z1: number };
}

/**
 * The three crossings. Span lengths: west/east close -550..-250 / 250..550
 * (300 units over water + home grass); south closes 318..650 (332 units).
 * The home slab ends at ±380, so the water strait itself is 230 (west/east)
 * / 330 (south) — the span covers it plus the grass to the home-side stub.
 */
export const BRIDGES: BridgeDef[] = [
  {
    id: "bridge-west",
    name: "Empire Span",
    to: "ny",
    decks: [
      { x0: -250, z0: -12, x1: -190, z1: 12 },
      { x0: -610, z0: -12, x1: -550, z1: 12 },
    ],
    span: { x0: -550, z0: -12, x1: -250, z1: 12 },
  },
  {
    id: "bridge-east",
    name: "Sunset Span",
    to: "la",
    decks: [
      { x0: 190, z0: -12, x1: 250, z1: 12 },
      { x0: 550, z0: -12, x1: 610, z1: 12 },
    ],
    span: { x0: 250, z0: -12, x1: 550, z1: 12 },
  },
  {
    id: "bridge-south",
    name: "Palms Span",
    to: "fl",
    decks: [
      { x0: -12, z0: 258, x1: 12, z1: 318 },
      { x0: -12, z0: 650, x1: 12, z1: 710 },
    ],
    span: { x0: -12, z0: 318, x1: 12, z1: 650 },
  },
];

/** Builds one bridge's full crossing: the two shore decks, the middle span
 *  that joins them into one continuous deck, and the sign naming it.
 *  No gate, no portal — the bridge IS the crossing. */
export function buildBridge(city: City, bridge: BridgeDef): void {
  // One deck slab per rect (both shore stubs + the middle span), all with
  // the same cross-section so they abut edge-to-edge into a single deck:
  // asphalt at y 0.06 (same top as the roads), sidewalks at ±10.5, gold
  // rails with real colliders at ±11.4 — you cannot drive or walk off.
  const rects = [...bridge.decks, bridge.span];
  for (const deck of rects) {
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
    // One exception per crossing (bus-route fix): the bus detour joins
    // the deck through a 10-wide gap in the rail at the mouth — a proper
    // road junction, like an on-ramp. East: north rail, x 253..263 (the
    // span, x 250..550). West: south rail, x -271..-261 (span -550..-250,
    // gap centred on the west mouth at x=-266).
    const railOff = 11.4;
    for (const s of [-1, 1]) {
      const rx = alongX ? cx : cx + s * railOff;
      const rz = alongX ? cz + s * railOff : cz;
      // Rail segments along the deck (world coords) for this rect + side.
      let segs: Array<[number, number]> = [[alongX ? deck.x0 : deck.z0, alongX ? deck.x1 : deck.z1]];
      const isSpan = deck === bridge.span;
      if (isSpan && alongX && bridge.id === "bridge-east" && s === 1) segs = [[250, 253], [263, 550]];
      if (isSpan && alongX && bridge.id === "bridge-west" && s === -1) segs = [[-550, -271], [-261, -250]];
      for (const [a, b] of segs) {
        const mid = (a + b) / 2;
        const len = b - a;
        const sx = alongX ? mid : rx;
        const sz = alongX ? rz : mid;
        pushBox(city, sx, 0.7, sz, alongX ? len : 0.4, 0.5, alongX ? 0.4 : len, "gold");
        pushCol(city, sx, 0.7, sz, alongX ? len : 0.4, 1.2, alongX ? 0.4 : len);
      }
    }
  }
  // Home-side apron: a flat asphalt pad (deck height, no rails — the
  // cross road must stay open) joining the home-side stub to the road it
  // meets. The stub ends 5 units short of the home N/S road (west/east)
  // and 12 short of the pier end (south); without the pad the drive
  // crosses open grass to reach the deck.
  const apron =
    bridge.id === "bridge-west" ? { x0: -190, z0: -12, x1: -185, z1: 12 }
    : bridge.id === "bridge-east" ? { x0: 185, z0: -12, x1: 190, z1: 12 }
    : { x0: -12, z0: 246, x1: 12, z1: 258 };
  pushBox(city, (apron.x0 + apron.x1) / 2, 0.06, (apron.z0 + apron.z1) / 2, apron.x1 - apron.x0, 0.12, apron.z1 - apron.z0, "asphalt");
  // State-side apron (bus-route fix): the same flat pad where the deck
  // meets the state road — without it the bus merges from its offset
  // deck lane to the road centreline across 5 units of open grass.
  const apronFar =
    bridge.id === "bridge-west" ? { x0: -615, z0: -12, x1: -610, z1: 12 }
    : bridge.id === "bridge-east" ? { x0: 610, z0: -12, x1: 615, z1: 12 }
    : { x0: -12, z0: 710, x1: 12, z1: 715 };
  pushBox(city, (apronFar.x0 + apronFar.x1) / 2, 0.06, (apronFar.z0 + apronFar.z1) / 2, apronFar.x1 - apronFar.x0, 0.12, apronFar.z1 - apronFar.z0, "asphalt");
  // Lamps down the middle, one run along the WHOLE crossing (stubs + span),
  // every 20 units — a single run, so no lamp is ever duplicated at a joint
  // and none spills off the deck ends.
  const allX0 = Math.min(bridge.decks[0].x0, bridge.decks[1].x0, bridge.span.x0);
  const allX1 = Math.max(bridge.decks[0].x1, bridge.decks[1].x1, bridge.span.x1);
  const allZ0 = Math.min(bridge.decks[0].z0, bridge.decks[1].z0, bridge.span.z0);
  const allZ1 = Math.max(bridge.decks[0].z1, bridge.decks[1].z1, bridge.span.z1);
  const alongX = allX1 - allX0 > allZ1 - allZ0;
  const len = alongX ? allX1 - allX0 : allZ1 - allZ0;
  const mcx = (allX0 + allX1) / 2;
  const mcz = (allZ0 + allZ1) / 2;
  const lampSteps = Math.floor((len / 2 - 10) / 20);
  for (let i = -lampSteps; i <= lampSteps; i++) {
    const o = i * 20;
    const lx = alongX ? mcx + o : mcx;
    const lz = alongX ? mcz : mcz + o;
    pushBox(city, lx, 1.5, lz, 0.3, 3, 0.3, "black");
    pushBox(city, lx, 3.1, lz, 0.9, 0.5, 0.9, "gold");
  }
  // A sign board at the home-side end of the span (where a driver enters
  // the crossing), naming the bridge and where it leads.
  const signX = alongX ? (bridge.id === "bridge-west" ? bridge.span.x1 - 2 : bridge.span.x0 + 2) : 0;
  const signZ = alongX ? 0 : bridge.span.z0 + 2;
  city.art.push({
    id: `${bridge.id}-sign`,
    x: signX,
    y: 4.2,
    z: signZ,
    rotY: bridge.id === "bridge-south" ? 0 : Math.PI / 2,
    w: 14,
    h: 3,
    lines: [bridge.name.toUpperCase(), `TO ${stateById(bridge.to).name.toUpperCase()}`],
    sub: "Walk or drive across",
  });
}

/** All three bridges, in one call. */
export function buildAllBridges(city: City): void {
  for (const b of BRIDGES) buildBridge(city, b);
}

// ---------------------------------------------------------------------------
// Ferry docks — one free boat at every strait shore (water.ts contract).
// ---------------------------------------------------------------------------
// Each dock is a wooden pier walking out from the shore into the strait,
// with a free Orbit Ferry moored alongside it. The pier runs parallel to
// the sailing lane, never across it: the boat lane sits 3.5 units off the
// pier centre (z = 20.5 west/east, x = 20.5 south), clear of the magic
// bridge decks, their ground strips (z/x ±14) and their gold rails
// (±11.4) — the boat sails straight down its lane from shore to shore.
// The boat faces the crossing (yaw -PI/2 west, +PI/2 east, PI south, 0
// north) so boarding and holding W just goes. Boarding is free: enterCar
// never checks ownership, and the docked boats respawn with the city.
// A bought Orbit Ferry moors at the home south dock (runtime.ts).
// ---------------------------------------------------------------------------

export interface DockDef {
  id: string;
  strait: "west" | "east" | "south";
  side: "home" | "ny" | "la" | "fl";
  /** Pier deck rect (world XZ) — walkway from the shore into the water. */
  pier: { x0: number; x1: number; z0: number; z1: number };
  /** Docked boat spot: centre + facing yaw. */
  boat: { x: number; z: number; yaw: number };
  /** Sign text destination ("NY" / "LA" / "FL" / "HOME"). */
  dest: string;
  /** Ferry sign position + facing (DoubleSide, either face reads). */
  sign: { x: number; z: number; rotY: number };
}

export const DOCKS: DockDef[] = [
  {
    id: "west-home", strait: "west", side: "home",
    pier: { x0: -396, x1: -380, z0: 15.5, z1: 18.5 },
    boat: { x: -391, z: 20.5, yaw: -Math.PI / 2 },
    dest: "NY",
    sign: { x: -376, z: 24, rotY: Math.PI / 2 },
  },
  {
    id: "west-ny", strait: "west", side: "ny",
    pier: { x0: -610, x1: -594, z0: 15.5, z1: 18.5 },
    boat: { x: -599, z: 20.5, yaw: Math.PI / 2 },
    dest: "HOME",
    sign: { x: -614, z: 24, rotY: -Math.PI / 2 },
  },
  {
    id: "east-home", strait: "east", side: "home",
    pier: { x0: 380, x1: 396, z0: 15.5, z1: 18.5 },
    boat: { x: 391, z: 20.5, yaw: Math.PI / 2 },
    dest: "LA",
    sign: { x: 376, z: 24, rotY: -Math.PI / 2 },
  },
  {
    id: "east-la", strait: "east", side: "la",
    pier: { x0: 594, x1: 610, z0: 15.5, z1: 18.5 },
    boat: { x: 599, z: 20.5, yaw: -Math.PI / 2 },
    dest: "HOME",
    sign: { x: 614, z: 24, rotY: Math.PI / 2 },
  },
  {
    id: "south-home", strait: "south", side: "home",
    pier: { x0: 15.5, x1: 18.5, z0: 380, z1: 396 },
    boat: { x: 20.5, z: 391, yaw: Math.PI },
    dest: "FL",
    sign: { x: 24, z: 376, rotY: Math.PI },
  },
  {
    id: "south-fl", strait: "south", side: "fl",
    pier: { x0: 15.5, x1: 18.5, z0: 694, z1: 710 },
    boat: { x: 20.5, z: 699, yaw: 0 },
    dest: "HOME",
    sign: { x: 24, z: 714, rotY: 0 },
  },
];

/** Builds every ferry dock's pier + sign into the city. */
export function buildDocks(city: City): void {
  for (const dock of DOCKS) {
    const p = dock.pier;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    const lenX = p.x1 - p.x0;
    const lenZ = p.z1 - p.z0;
    // Wooden deck, top at y=0.2 — a 0.2 step up from the shore, same as
    // the harbor pier (city.ts addHarbor). No collider: the player walks
    // it at y=0, and the boat's pier check in runtime.ts uses the rect.
    pushBox(city, cx, 0.1, cz, lenX, 0.2, lenZ, "wood");
    // Support posts down to the seabed (WATER_FLOOR_Y = -6), at the pier
    // corners, inset 1 unit.
    for (const px of [p.x0 + 1, p.x1 - 1]) {
      for (const pz of [p.z0 + 0.6, p.z1 - 0.6]) {
        pushBox(city, px, -2.9, pz, 0.3, 6, 0.3, "black");
      }
    }
    // Lamp at the pier's outer (water) tip corner, on the pier's north /
    // west edge (with a real collider, like the harbor pier lamps, so the
    // player cannot walk through the post).
    const lampX =
      dock.strait === "west"
        ? dock.side === "home" ? p.x0 + 0.7 : p.x1 - 0.7
        : dock.strait === "east"
          ? dock.side === "home" ? p.x1 - 0.7 : p.x0 + 0.7
          : p.x0 + 0.7;
    const lampZ =
      dock.strait === "south"
        ? dock.side === "home" ? p.z1 - 0.7 : p.z0 + 0.7
        : p.z0 + 0.7;
    pushBox(city, lampX, 1.3, lampZ, 0.25, 2.4, 0.25, "black");
    pushBox(city, lampX, 2.6, lampZ, 0.7, 0.3, 0.7, "gold");
    pushCol(city, lampX, 1.3, lampZ, 0.25, 2.4, 0.25);
    // Ferry sign at the pier root, so the dock is findable from the road.
    city.art.push({
      id: `${dock.id}-sign`,
      x: dock.sign.x,
      y: 4.2,
      z: dock.sign.z,
      rotY: dock.sign.rotY,
      w: 12,
      h: 2.5,
      lines: ["FERRY DOCK", `FREE BOATS — SAIL TO ${dock.dest}`],
      sub: "Press E to sail",
    });
  }
}
