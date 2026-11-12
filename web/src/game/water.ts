// ---------------------------------------------------------------------------
// OrbitX City — DEEP WATER between the states (Water + Crossings batch)
// ---------------------------------------------------------------------------
// The middle between the home slab and the three state regions used to be
// void by design (states.ts: "the regions stays void by design — the magic
// bridge hops it"): the physics ground is y=0 everywhere (engine.ts clamps
// it), so you walked on invisible nothing. This module fills each strait
// with a REAL body of deep water: a water surface 1 unit below shore
// ground, over a dark seabed 5 units deeper, so flying across shows water
// below the whole way and there is no hole down to the skybox / void.
//
// SHARED WATER CONTRACT — every Water + Crossings piece uses these exact
// values. Do not change them without updating the swim / boat / bridge
// pieces too:
//   WATER_SURFACE_Y = -1   water surface, 1 unit below shore ground (y=0)
//   WATER_FLOOR_Y   = -6   seabed — deep
//   WATER_REGIONS   = the three strait rects (home <-> NY / LA / FL)
//   isWater(x, z)   = true inside any strait rect
//
// SHORELINE: every surface / seabed box abuts the home + region slab edges
// exactly in XZ (same convention as buildRegionGround: abut, never
// overlap), so there is no visible gap and no coplanar top face. The slab
// sides run y -1.1..0, so the water surface at y=-1 meets a 1-unit grass
// bank at every shore. The surface box is 0.08 thick (top -1.0, bottom
// -1.08) — clear of the slab bottom (-1.1), so no coplanar faces anywhere.
//
// NOTE: this piece is the water ONLY. It does not move the player, change
// the physics ground clamp, or touch the magic-bridge decks / gates —
// swimming, boats and bridges are sibling pieces. A player walking into
// the water still walks on the invisible y=0 ground until the swim piece
// lands; that is expected for this piece alone.
//
// ECONOMY: City Sol only. No real money, no SOL, no ORBITX, no burn.
// ---------------------------------------------------------------------------

import type { Box, City, Mat } from "./city";

/** Water surface height — 1 unit below shore ground (y=0). */
export const WATER_SURFACE_Y = -1;

/** Seabed height — deep (5 units below the surface). */
export const WATER_FLOOR_Y = -6;

/**
 * The three straits between the home slab (±380) and the state regions.
 *   west  — home <-> NY (NY slab x -990..-610)
 *   east  — home <-> LA (LA slab x 610..990)
 *   south — home <-> FL (FL slab z 710..1090)
 */
export const WATER_REGIONS: ReadonlyArray<{
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}> = [
  { x0: -610, x1: -380, z0: -380, z1: 380 },
  { x0: 380, x1: 610, z0: -380, z1: 380 },
  { x0: -380, x1: 380, z0: 380, z1: 710 },
];

/** True if the (x, z) point is over strait water. */
export function isWater(x: number, z: number): boolean {
  return WATER_REGIONS.some(
    (r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1,
  );
}

function pushWaterBox(
  city: City,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  mat: Mat,
): Box {
  const b: Box = { x, y, z, sx, sy, sz, mat, ry: 0 };
  city.boxes.push(b);
  return b;
}

/**
 * Render the deep water: one surface + one seabed per strait rect.
 * Called from buildAllRegions (states.ts) after the region ground slabs,
 * so the water abuts the slab edges exactly.
 */
export function buildStraitWater(city: City): void {
  for (const r of WATER_REGIONS) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    // Surface: thin "water" slab (same material as the harbor water),
    // top face exactly at WATER_SURFACE_Y, spanning the FULL rect so
    // there is no void anywhere in the middle.
    pushWaterBox(city, cx, WATER_SURFACE_Y - 0.04, cz, w, 0.08, d, "water");
    // Seabed: dark sand/rock slab ("hill"), top face exactly at
    // WATER_FLOOR_Y, so the water reads as DEEP and you cannot see
    // through the world to the skybox / void below.
    pushWaterBox(city, cx, WATER_FLOOR_Y - 0.55, cz, w, 1.1, d, "hill");
  }
}
