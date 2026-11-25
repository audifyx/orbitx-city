// ---------------------------------------------------------------------------
// OrbitX City — GTA / FiveM expansion: HOMES (150, ownable, City Sol only)
// ---------------------------------------------------------------------------
// DEAD CODE until wired (see WIRING.md). This module ONLY ADDS homes to a
// City object and defines the ownership shape — it never edits api/city.js
// or the home city's buildCity() itself.
//
// DESIGN RULE (user): "clone each to look similar but different."
//   ONE home-layout generator (buildHome) + ONE furnishing template
//   (furnishStateHome) build all 150 homes. The variation lives in style
//   tables: per-state ARCHETYPES (brownstone / ranch / beach house …),
//   per-district STREET_NAMES, per-district price tiers, per-archetype
//   palettes and extras. Same bones, different house — never 150 hand-written
//   box lists, never three copies of one layout.
//
// CATALOG: 150 homes, 50 per state (districts get 13 / 13 / 12 / 12).
//   Every home: id, state, district, world position, style, name, price.
//   Positions come from the region plot grid (outer-ring blocks, one home
//   per block, seeded shuffle) — deterministic per seed, so the client
//   catalog and the server price map can never drift (see WIRING.md §4).
//
// OWNERSHIP — PER (PLAYER, SERVER), not per player (user correction):
//   The player picks a server (1-5) on the menu; each server is the same
//   world with DIFFERENT save progress. A home bought on Server 1 lives on
//   Server 1 only. The same home can be owned by different players on
//   different servers — that is the point, no cross-server conflicts.
//   The server where a player made their home is their HOME server: that is
//   where their progress lives, and buying a home on a server makes that
//   server their home server. The catalog below is identical on every
//   server — only the ownership rows are per-server. A separate multiverse
//   builder owns the save keying; this file only defines the shape + the
//   pure validation mirror (buyHomeLocal) the server op must match.
//
// ECONOMY: City Sol only. No real money, no SOL, no ORBITX, no burn.
//   Prices are opening prices (see HOME_PRICE_BASE). A new player starts at
//   60,000 City Sol and jobs pay 40-90, so a home is a real goal, not day one.
// ---------------------------------------------------------------------------

import type { City, Face, Facade, Mat, Zone } from "./city";
import { makeRng } from "./seed";
import {
  BLOCK_CENTERS,
  REGION_CENTERS,
  STATES,
  districtForLocal,
  doorAnchorFor,
  doorFaceTowardCenter,
  isOuterRingPlot,
  pushBox,
  pushCol,
  pushWallColliders,
  type DistrictDef,
  type StateId,
} from "./states";

// ---------------------------------------------------------------------------
// Home archetypes — one row per look; the generator does the rest
// ---------------------------------------------------------------------------

export type HomeExtra = "fireplace" | "patio" | "deck" | "none";

export interface HomeArchetype {
  key: string;
  label: string;
  w: number;
  d: number;
  h: number;
  roof: "flat" | "gable" | "hip" | "stepped";
  roofMat: number;
  porch: boolean;
  chimney: boolean;
  awning: boolean;
  /** Facade paint style (pretty.ts paints, 0-5). */
  style: number;
  /** Interior sofa / rug mats — the fastest read of "whose house is this". */
  sofa: Mat;
  rug: Mat;
  extra: HomeExtra;
}

export const HOME_ARCHETYPES: Record<StateId, [HomeArchetype, HomeArchetype, HomeArchetype]> = {
  // NY: tall, narrow, dark — brownstone stoops and lofts.
  ny: [
    { key: "brownstone", label: "Brownstone", w: 18, d: 16, h: 9, roof: "stepped", roofMat: 1, porch: false, chimney: true, awning: false, style: 1, sofa: "red", rug: "gold", extra: "fireplace" },
    { key: "townhouse", label: "Townhouse", w: 20, d: 16, h: 8, roof: "gable", roofMat: 0, porch: true, chimney: true, awning: false, style: 1, sofa: "black", rug: "red", extra: "none" },
    { key: "loft", label: "Loft", w: 22, d: 18, h: 7, roof: "flat", roofMat: 0, porch: false, chimney: false, awning: false, style: 2, sofa: "gray", rug: "cyan", extra: "none" },
  ],
  // LA: low, wide, warm — ranch slabs, bungalow porches, glass moderns.
  la: [
    { key: "ranch", label: "Ranch", w: 22, d: 16, h: 6, roof: "hip", roofMat: 1, porch: true, chimney: false, awning: false, style: 2, sofa: "warm", rug: "cream", extra: "patio" },
    { key: "bungalow", label: "Bungalow", w: 18, d: 16, h: 7, roof: "gable", roofMat: 1, porch: true, chimney: true, awning: false, style: 3, sofa: "cream", rug: "warm", extra: "patio" },
    { key: "modern", label: "Modern", w: 20, d: 18, h: 8, roof: "flat", roofMat: 0, porch: false, chimney: false, awning: false, style: 2, sofa: "white", rug: "cyan", extra: "none" },
  ],
  // FL: pastel resort — cottages, villas, beach houses with decks.
  fl: [
    { key: "cottage", label: "Cottage", w: 16, d: 16, h: 6, roof: "gable", roofMat: 2, porch: true, chimney: false, awning: true, style: 3, sofa: "cream", rug: "cyan", extra: "deck" },
    { key: "villa", label: "Villa", w: 22, d: 18, h: 7, roof: "hip", roofMat: 3, porch: false, chimney: false, awning: true, style: 3, sofa: "white", rug: "gold", extra: "deck" },
    { key: "beach-house", label: "Beach House", w: 20, d: 16, h: 8, roof: "flat", roofMat: 2, porch: false, chimney: false, awning: true, style: 0, sofa: "cyan", rug: "white", extra: "deck" },
  ],
};

/** Street names per district — the home name is "The <street> <archetype>". */
export const DISTRICT_STREETS: Record<string, [string, string, string, string, string]> = {
  "ny-harlem": ["Lenox", "Malcolm X", "Adam Clayton", "Frederick Douglass", "St Nicholas"],
  "ny-midtown": ["Lexington", "Madison", "Park", "Fifth", "Broadway"],
  "ny-brooklyn": ["Bedford", "Flatbush", "Atlantic", "Smith", "Grand"],
  "ny-queens": ["Astoria", "Ditmars", "Steinway", "Queens", "Jackson"],
  "la-hollywood": ["Sunset", "Hollywood", "Vine", "Cahuenga", "Melrose"],
  "la-downtown": ["Grand", "Hope", "Spring", "Main", "Olive"],
  "la-venice": ["Abbot Kinney", "Windward", "Pacific", "Ocean", "Rose"],
  "la-beverly": ["Rodeo", "Canon", "Beverly", "Wilshire", "Crescent"],
  "fl-orlando": ["Orange", "Colonial", "Church", "Magnolia", "Princeton"],
  "fl-tampa": ["Bayshore", "Kennedy", "Dale Mabry", "Howard", "Swann"],
  "fl-keywest": ["Duval", "Whitehead", "Simonton", "Fleming", "Truman"],
  "fl-miami": ["Ocean", "Collins", "Washington", "Lincoln", "Alton"],
};

/** Base price before district tier / archetype / size. City Sol. */
export const HOME_PRICE_BASE = 2200;

export interface HomeDef {
  id: string;
  /** Global index 0-149 (zone/anchor slot). */
  index: number;
  state: StateId;
  district: string;
  name: string;
  archetype: string;
  /** World rect (top-left corner + size). */
  x0: number;
  z0: number;
  w: number;
  d: number;
  h: number;
  door: Face;
  /** Price in City Sol. */
  price: number;
}

/** Homes per district, in district order: 13 + 13 + 12 + 12 = 50 per state. */
export const HOMES_PER_DISTRICT = [13, 13, 12, 12] as const;

/**
 * The 150-home catalog. Deterministic for a given seed: plot picks come from
 * a seeded shuffle of the district's outer-ring blocks, archetypes cycle by
 * (pick + district), and (street, archetype) pairs are unique inside a
 * district because lcm(5 streets, 3 archetypes) = 15 > 13 picks.
 */
export function buildHomeCatalog(seed = 1): HomeDef[] {
  const homes: HomeDef[] = [];
  const usedNames = new Set<string>();
  let index = 0;
  for (let si = 0; si < STATES.length; si++) {
    const state = STATES[si];
    if (!state) continue;
    const { x: cx, z: cz } = REGION_CENTERS[state.id];
    for (let di = 0; di < state.districts.length; di++) {
      const district = state.districts[di] as DistrictDef;
      const count = HOMES_PER_DISTRICT[di] ?? 12;
      // Outer-ring plots in this district's quadrant, seeded shuffle.
      const plots: Array<{ lx: number; lz: number }> = [];
      for (const lx of BLOCK_CENTERS) {
        for (const lz of BLOCK_CENTERS) {
          if (!isOuterRingPlot(lx, lz)) continue;
          if (districtForLocal(state, lx, lz).id !== district.id) continue;
          plots.push({ lx, lz });
        }
      }
      const rng = makeRng((seed || 1) * 7 + si * 101 + di * 13);
      for (let i = plots.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = plots[i] as { lx: number; lz: number };
        plots[i] = plots[j] as { lx: number; lz: number };
        plots[j] = tmp;
      }
      const streets = DISTRICT_STREETS[district.id] ?? ["Main", "Oak", "Pine", "Elm", "Cedar"];
      const archetypes = HOME_ARCHETYPES[state.id];
      for (let i = 0; i < count; i++) {
        const plot = plots[i] as { lx: number; lz: number };
        const arch = archetypes[(i + di) % archetypes.length] as HomeArchetype;
        const street = streets[i % streets.length] as string;
        let name = `The ${street} ${arch.label}`;
        // Name-uniqueness guard (never triggers with the 5x3 cycle, but the
        // catalog must be distinct even if the tables change).
        for (let n = 2; usedNames.has(name); n++) name = `The ${street} ${arch.label} No. ${n}`;
        usedNames.add(name);
        const wx = cx + plot.lx;
        const wz = cz + plot.lz;
        const door = doorFaceTowardCenter(plot.lx, plot.lz, 0, 0);
        // Price: base x district tier x archetype weight x size, ±10% jitter.
        const archMult = arch.key === "brownstone" || arch.key === "modern" ? 1.2
          : arch.key === "villa" || arch.key === "beach-house" ? 1.35
          : arch.key === "loft" ? 1.1
          : arch.key === "ranch" || arch.key === "cottage" ? 0.85
          : 1.0;
        const sizeF = (arch.w * arch.d) / 288;
        const jitter = 0.9 + (Math.floor(rng() * 20) / 100);
        const price = Math.round((HOME_PRICE_BASE * district.priceTier * archMult * sizeF * jitter) / 10) * 10;
        homes.push({
          id: `home-${state.id}-${String(index - si * 50 + 1).padStart(2, "0")}`,
          index,
          state: state.id,
          district: district.id,
          name,
          archetype: arch.key,
          x0: wx - arch.w / 2,
          z0: wz - arch.d / 2,
          w: arch.w,
          d: arch.d,
          h: arch.h,
          door,
          price,
        });
        index++;
      }
    }
  }
  return homes;
}

/** Canonical catalog (seed 1). The server price map must be built from this. */
export const HOMES: HomeDef[] = buildHomeCatalog(1);

export const HOMES_BY_STATE: Record<StateId, HomeDef[]> = {
  ny: HOMES.filter((h) => h.state === "ny"),
  la: HOMES.filter((h) => h.state === "la"),
  fl: HOMES.filter((h) => h.state === "fl"),
};

export function homeById(id: string): HomeDef | null {
  return HOMES.find((h) => h.id === id) ?? null;
}

export function homePrice(id: string): number | null {
  return homeById(id)?.price ?? null;
}

// ---------------------------------------------------------------------------
// Building — one generator for all 150 homes
// ---------------------------------------------------------------------------

/** Back-wall point + sign rotation, same convention as city.ts furnishHome.
 * Exported for the CRAZY theater (screen + seats reuse the same anchor). */
export function backPoint(door: Face, x0: number, z0: number, w: number, d: number, inset = 2.4) {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "w") return { x: x0 + w - inset, z: cz, rot: -Math.PI / 2 };
  if (door === "e") return { x: x0 + inset, z: cz, rot: Math.PI / 2 };
  if (door === "n") return { x: cx, z: z0 + d - inset, rot: Math.PI };
  return { x: cx, z: z0 + inset, rot: 0 };
}

/**
 * Wallpaper + paint for a state home. The pretty.ts shell's inner wall face
 * sits at inset 0.45, so the paint layer lives at 0.51-0.59 (proud of the
 * wall, behind the TV/paintings at 1.25+) and the bands at 0.58-0.66.
 * Striped paint segments (wall with a narrow accent stripe every 3.4) plus
 * wainscot, chair rail, top stripe and baseboard. Door wall skipped.
 */
function stateHomeWallpaper(city: City, home: HomeDef, wall: Mat, accent: Mat): void {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const PI = 0.55;
  const BI = 0.62;
  const runX = (z: number) => {
    const len = w - 2.5;
    let u = -len / 2;
    while (u < len / 2 - 0.05) {
      const wallEnd = Math.min(u + 3.05, len / 2);
      pushBox(city, cx + (u + wallEnd) / 2, 1.85, z, wallEnd - u, 3.15, 0.08, wall);
      const accEnd = Math.min(u + 3.4, len / 2);
      if (accEnd - wallEnd > 0.05) {
        pushBox(city, cx + (wallEnd + accEnd) / 2, 1.85, z, accEnd - wallEnd, 3.15, 0.08, accent);
      }
      u += 3.4;
    }
  };
  const runZ = (x: number) => {
    const len = d - 2.5;
    let u = -len / 2;
    while (u < len / 2 - 0.05) {
      const wallEnd = Math.min(u + 3.05, len / 2);
      pushBox(city, x, 1.85, cz + (u + wallEnd) / 2, 0.08, 3.15, wallEnd - u, wall);
      const accEnd = Math.min(u + 3.4, len / 2);
      if (accEnd - wallEnd > 0.05) {
        pushBox(city, x, 1.85, cz + (wallEnd + accEnd) / 2, 0.08, 3.15, accEnd - wallEnd, accent);
      }
      u += 3.4;
    }
  };
  if (door !== "n") runX(z0 + PI);
  if (door !== "s") runX(z0 + d - PI);
  if (door !== "w") runZ(x0 + PI);
  if (door !== "e") runZ(x0 + w - PI);
  const bandX = (z: number, y: number, h: number, mat: Mat) => pushBox(city, cx, y, z, w - 2.5, h, 0.08, mat);
  const bandZ = (x: number, y: number, h: number, mat: Mat) => pushBox(city, x, y, cz, 0.08, h, d - 2.5, mat);
  const bands = (alongX: boolean, at: number) => {
    const b = alongX ? bandX : bandZ;
    b(at, 0.55, 1.0, accent);
    b(at, 1.18, 0.12, accent);
    b(at, 3.25, 0.18, accent);
    b(at, 0.12, 0.18, "black");
  };
  if (door !== "n") bands(true, z0 + BI);
  if (door !== "s") bands(true, z0 + d - BI);
  if (door !== "w") bands(false, x0 + BI);
  if (door !== "e") bands(false, x0 + w - BI);
}

/** Ceiling slab + pendant lights + two wood beams, same as city.ts addCeiling. */
function stateHomeCeiling(city: City, home: HomeDef): void {
  const { x0, z0, w, d } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  pushBox(city, cx, 3.62, cz, w - 2.15, 0.14, d - 2.15, "ceil");
  pushCol(city, cx, 3.62, cz, w - 2, 0.25, d - 2);
  for (const [dx, dz] of [[-4.2, -3.2], [4.2, -3.2], [-4.2, 3.2], [4.2, 3.2], [0, 0]] as Array<[number, number]>) {
    // Rod runs into the ceiling slab (bottom 3.55) — the old 0.55 rod
    // stopped 0.075 short and floated.
    pushBox(city, cx + dx, 3.25, cz + dz, 0.12, 0.7, 0.12, "gray");
    pushBox(city, cx + dx, 2.85, cz + dz, 0.55, 0.16, 0.55, "warm");
  }
  if (w >= d) {
    // Beams run into the ceiling slab too (old 3.42 centre left a 0.01 gap).
    for (const off of [-w / 6, w / 6]) pushBox(city, cx + off, 3.45, cz, 0.5, 0.28, d - 2.5, "wood");
  } else {
    for (const off of [-d / 6, d / 6]) pushBox(city, cx, 3.45, cz + off, w - 2.5, 0.28, 0.5, "wood");
  }
}

/** Distance from a plot centre to the nearest road edge (roads sit 18 out,
 * half-width 5). Anything a house sticks out past this line is in the
 * driving lane. */
export const HOME_ROAD_EDGE = 13;

/** Backyard depth that fits the plot: the back wall is `fd` from the plot
 * centre (fd = half the house depth along the door axis), the road edge
 * is 13 out, and the yard keeps 0.6 clear of it. The old fixed 5.5
 * overflowed the road on every plot (the yard is only 1.4–4.4 deep once
 * the house is 16–22 deep). */
export function homeYardDepth(home: HomeDef): number {
  const fd = home.door === "n" || home.door === "s" ? home.d / 2 : home.w / 2;
  return Math.max(0.6, Math.min(5.5, HOME_ROAD_EDGE - fd - 0.6));
}

/** A small yard tree: trunk + two leaf layers (pushBox/pushCol only). */
function stateHomeTree(city: City, x: number, z: number, small = false): void {
  if (small) {
    pushBox(city, x, 1.5, z, 0.6, 3, 0.6, "trunk");
    pushCol(city, x, 1.5, z, 0.6, 3, 0.6);
    for (const [y, r, mat] of [[3.2, 1, "leavesDark"], [4.0, 1, "leaves"]] as Array<[number, number, Mat]>) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
          pushBox(city, x + dx, y, z + dz, 0.94, 0.94, 0.94, mat);
        }
      }
    }
    return;
  }
  pushBox(city, x, 2.1, z, 0.85, 4.2, 0.85, "trunk");
  pushCol(city, x, 2.1, z, 0.85, 4.2, 0.85);
  for (const [y, r, mat] of [[4.3, 2, "leavesDark"], [5.35, 2, "leaves"], [6.4, 1, "leaves"]] as Array<[number, number, Mat]>) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
        pushBox(city, x + dx, y, z + dz, 0.94, 0.94, 0.94, mat);
      }
    }
  }
}

/** A backyard behind the house (opposite the door): grass, hedge fence
 * (open toward the house), stone path, bench, tree, grill, flowers.
 * The yard is clamped to the plot (see homeYardDepth) — the old fixed
 * 5.5-deep yard ran its far hedge + collider into the back road on
 * every home. The yard's lateral size is the house depth for w/e doors
 * (the lateral axis is d there, not w). */
function stateHomeBackyard(city: City, home: HomeDef): void {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const depth = homeYardDepth(home);
  // Lateral extent of the yard: the house dimension across the door axis.
  const lat = door === "w" || door === "e" ? d - 2 : w - 2;
  if (door === "w" || door === "e") {
    const yxx0 = door === "w" ? x0 + w + 0.6 : x0 - 0.6 - depth;
    const yxx1 = door === "w" ? x0 + w + 0.6 + depth : x0 - 0.6;
    const farX = door === "w" ? yxx1 : yxx0;
    const dirX = door === "w" ? 1 : -1;
    pushBox(city, (yxx0 + yxx1) / 2, 0.06, cz, depth, 0.1, lat, "grass");
    pushBox(city, farX, 0.3, cz, 0.5, 0.6, lat, "hedge");
    pushCol(city, farX, 0.3, cz, 0.5, 0.6, lat);
    for (const side of [-1, 1]) {
      const fz = cz + side * lat / 2;
      pushBox(city, (yxx0 + yxx1) / 2, 0.3, fz, depth, 0.6, 0.5, "hedge");
      pushCol(city, (yxx0 + yxx1) / 2, 0.3, fz, depth, 0.6, 0.5);
    }
    pushBox(city, (yxx0 + yxx1) / 2, 0.14, cz, depth, 0.05, 1.6, "stone");
    const gx = farX - dirX * 1.2;
    pushBox(city, gx, 0.45, cz - 2.2, 1.1, 0.8, 0.8, "black");
    pushBox(city, gx, 0.9, cz - 2.2, 1.2, 0.12, 0.9, "gold");
    pushCol(city, gx, 0.45, cz - 2.2, 1.1, 0.8, 0.8);
    pushBox(city, (yxx0 + yxx1) / 2, 0.48, cz + 2.2, 0.5, 0.16, 1.7, "gray");
    pushBox(city, (yxx0 + yxx1) / 2, 0.78, cz + 2.2, 0.16, 0.5, 1.7, "black");
    pushCol(city, (yxx0 + yxx1) / 2, 0.55, cz + 2.2, 0.5, 0.7, 1.7);
    // Tree at the yard centre (the old centre-minus-1 put the canopy
    // through the back wall). Full tree only fits a 4.5+ yard; a small
    // tree fits 2.5+; the shallowest yards get none.
    if (depth >= 4.5) stateHomeTree(city, (yxx0 + yxx1) / 2, cz - lat / 2 + 1.6);
    else if (depth >= 2.5) stateHomeTree(city, (yxx0 + yxx1) / 2, cz - lat / 2 + 1.6, true);
    for (const side of [-1, 1]) {
      pushBox(city, gx, 0.25, cz + side * 3.4, 0.5, 0.4, 0.5, side < 0 ? "red" : "gold");
    }
    return;
  }
  const yz0 = door === "n" ? z0 + d + 0.6 : z0 - 0.6 - depth;
  const yz1 = door === "n" ? z0 + d + 0.6 + depth : z0 - 0.6;
  const farZ = door === "n" ? yz1 : yz0;
  const dirZ = door === "n" ? 1 : -1;
  pushBox(city, cx, 0.06, (yz0 + yz1) / 2, lat, 0.1, depth, "grass");
  pushBox(city, cx, 0.3, farZ, lat, 0.6, 0.5, "hedge");
  pushCol(city, cx, 0.3, farZ, lat, 0.6, 0.5);
  for (const side of [-1, 1]) {
    const fx = cx + side * lat / 2;
    pushBox(city, fx, 0.3, (yz0 + yz1) / 2, 0.5, 0.6, depth, "hedge");
    pushCol(city, fx, 0.3, (yz0 + yz1) / 2, 0.5, 0.6, depth);
  }
  pushBox(city, cx, 0.14, (yz0 + yz1) / 2, 1.6, 0.05, depth, "stone");
  const gz = farZ - dirZ * 1.2;
  pushBox(city, cx - 2.2, 0.45, gz, 1.1, 0.8, 0.8, "black");
  pushBox(city, cx - 2.2, 0.9, gz, 1.2, 0.12, 0.9, "gold");
  pushCol(city, cx - 2.2, 0.45, gz, 1.1, 0.8, 0.8);
  pushBox(city, cx + 2.2, 0.48, (yz0 + yz1) / 2, 1.7, 0.16, 0.5, "gray");
  pushBox(city, cx + 2.2, 0.78, (yz0 + yz1) / 2, 1.7, 0.5, 0.16, "black");
  pushCol(city, cx + 2.2, 0.55, (yz0 + yz1) / 2, 1.7, 0.7, 0.5);
  // Tree at the yard centre (see the w/e branch for why it is tiered).
  if (depth >= 4.5) stateHomeTree(city, cx - lat / 2 + 1.6, (yz0 + yz1) / 2);
  else if (depth >= 2.5) stateHomeTree(city, cx - lat / 2 + 1.6, (yz0 + yz1) / 2, true);
  for (const side of [-1, 1]) {
    pushBox(city, cx + side * 3.4, 0.25, gz, 0.5, 0.4, 0.5, side < 0 ? "red" : "gold");
  }
}

/**
 * Furnishing template — the city.ts furnishHome pattern (sofa/rug/TV,
 * kitchenette, bed, paintings, plant), parameterized by the archetype's
 * palette and extras. Same bones in every home; the colours and the extra
 * (fireplace / patio / deck) are what change.
 */
function furnishStateHome(city: City, home: HomeDef, arch: HomeArchetype): void {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const alongX = door === "n" || door === "s";
  // Wood floor (same as furnishHome).
  pushBox(city, cx, 0.08, cz, w - 2.4, 0.08, d - 2.4, "wood");
  // Finish: ceiling + beams, painted striped wallpaper + wainscot +
  // baseboards. Wall colour by state, accent = the archetype rug.
  stateHomeCeiling(city, home);
  const wallMat: Mat = home.state === "ny" ? "gray" : home.state === "la" ? "warm" : "white";
  stateHomeWallpaper(city, home, wallMat, arch.rug);
  // TV on the far wall + rug + sofa facing it. The cyan screen sits
  // 0.08 proud of the black body toward the room — centred exactly
  // inside it, it was fully embedded and invisible.
  const tvPos = backPoint(door, x0, z0, w, d, 0.88);
  const back = backPoint(door, x0, z0, w, d, 1.38);
  pushBox(city, tvPos.x, 1.5, tvPos.z, alongX ? 3.6 : 0.2, 2, alongX ? 0.2 : 3.6, "black");
  const roomDx = door === "w" ? 1 : door === "e" ? -1 : 0;
  const roomDz = door === "n" ? 1 : door === "s" ? -1 : 0;
  pushBox(city, tvPos.x + roomDx * 0.08, 1.5, tvPos.z + roomDz * 0.08, alongX ? 3.2 : 0.1, 1.6, alongX ? 0.1 : 3.2, "cyan");
  pushBox(city, cx, 0.12, cz, alongX ? 5 : 3.6, 0.05, alongX ? 3.6 : 5, arch.rug);
  const s = door === "s" || door === "e" ? 1 : -1;
  if (alongX) {
    pushBox(city, cx, 0.38, cz + s * 1.5, 3.4, 0.45, 1.1, arch.sofa);
    pushCol(city, cx, 0.38, cz + s * 1.5, 3.4, 0.45, 1.1);
    pushBox(city, cx, 0.85, cz + s * 2.05, 3.4, 0.7, 0.2, arch.sofa);
    pushBox(city, cx, 0.4, cz - s * 0.3, 1.6, 0.35, 0.9, "wood");
    pushCol(city, cx, 0.4, cz - s * 0.3, 1.6, 0.35, 0.9);
  } else {
    pushBox(city, cx + s * 1.5, 0.38, cz, 1.1, 0.45, 3.4, arch.sofa);
    pushCol(city, cx + s * 1.5, 0.38, cz, 1.1, 0.45, 3.4);
    pushBox(city, cx + s * 2.05, 0.85, cz, 0.2, 0.7, 3.4, arch.sofa);
    pushBox(city, cx - s * 0.3, 0.4, cz, 0.9, 0.35, 1.6, "wood");
    pushCol(city, cx - s * 0.3, 0.4, cz, 0.9, 0.35, 1.6);
  }
  // Kitchenette along the back wall: counter + cabinets + fridge. The
  // fridge offset is clamped to the house's half-dimension minus 1 —
  // the old fixed 7.8 poked the 0.9-wide fridge 0.25 through the
  // outside wall on every 16-deep home (66 of 150). The counter
  // shrinks to match so the fridge never swallows its end.
  const kx = alongX ? cx + 5 : back.x;
  const kz = alongX ? back.z : cz + 5;
  const fridgeOff = Math.min(7.8, (alongX ? w : d) / 2 - 1.0);
  const counterW = Math.min(4.6, 2 * (fridgeOff - 5.5));
  const fridgeX = alongX ? cx + fridgeOff : kx;
  const fridgeZ = alongX ? kz : cz + fridgeOff;
  pushBox(city, kx, 0.55, kz, alongX ? counterW : 1.1, 1.05, alongX ? 1.1 : counterW, "stone");
  pushCol(city, kx, 0.55, kz, alongX ? counterW : 1.1, 1.05, alongX ? 1.1 : counterW);
  pushBox(city, kx, 1.2, kz, alongX ? counterW + 0.2 : 1.2, 0.14, alongX ? 1.2 : counterW + 0.2, "wood");
  pushBox(city, fridgeX, 1.0, fridgeZ, 0.9, 2, 0.9, "white");
  pushCol(city, fridgeX, 1.0, fridgeZ, 0.9, 2, 0.9);
  // Bedroom nook: bed + nightstand. The bed lives south-east — except
  // when the kitchen is on the south-east side too (doors "n" and "w"),
  // where the counter and the fridge would swallow it; then it moves
  // south-west instead.
  const bedSE = door === "s" || door === "e";
  const bedX = bedSE ? x0 + w - 3.4 : x0 + 3.4;
  const bedZ = z0 + d - 3.4;
  pushBox(city, bedX, 0.35, bedZ, 2.4, 0.55, 3.4, "wood");
  pushCol(city, bedX, 0.35, bedZ, 2.4, 0.55, 3.4);
  pushBox(city, bedX, 0.7, bedZ, 2.2, 0.22, 3.2, "white");
  pushBox(city, bedX, 0.85, bedZ - 1.4, 1.6, 0.3, 0.5, arch.rug);
  pushBox(city, bedX + 1.6, 0.4, bedZ + 1.6, 0.6, 0.7, 0.6, "black");
  // Closet (style theme): a wardrobe in the bedroom nook, against the
  // same side wall as the bed, north of it (clear of the rug, the
  // nightstand and the sofa). The home way to change clothes — the Home
  // panel's "Open closet" button opens the wardrobe from here.
  const closetX = bedSE ? x0 + w - 1.25 : x0 + 1.25;
  const closetZ = bedZ - 3.4;
  pushBox(city, closetX, 1.1, closetZ, 0.9, 2.2, 1.6, "wood");
  pushCol(city, closetX, 1.1, closetZ, 0.9, 2.2, 1.6);
  // Two gold door handles on the room-facing side.
  const handleX = bedSE ? closetX - 0.5 : closetX + 0.5;
  pushBox(city, handleX, 1.1, closetZ - 0.4, 0.08, 0.3, 0.08, "gold");
  pushBox(city, handleX, 1.1, closetZ + 0.4, 0.08, 0.3, 0.08, "gold");
  // Rug beside the bed, on the room side of it.
  pushBox(city, bedX + (bedSE ? -2.2 : 2.2), 0.145, bedZ, 2.5, 0.05, 3, arch.rug);
  // Paintings flush on the side walls (never on the door wall) + a plant by the door.
  // The wall's inner face is 0.45 in from the facade edge, so a 0.15-thick
  // painting centres at 0.53 — the old 0.84 floated 0.315 off the wall.
  if (alongX) {
    pushBox(city, x0 + 0.53, 1.9, cz - 3.6, 0.15, 1.5, 2.2, arch.rug);
    pushBox(city, x0 + w - 0.53, 1.9, cz - 3.6, 0.15, 1.5, 2.2, "gold");
  } else {
    pushBox(city, cx + 4.5, 1.9, z0 + 0.53, 2.2, 1.5, 0.15, arch.rug);
    pushBox(city, cx - 3.5, 1.9, z0 + d - 0.53, 2.2, 1.5, 0.15, "gold");
  }
  const plant = backPoint(door === "n" ? "s" : door === "s" ? "n" : door === "w" ? "e" : "w", x0, z0, w, d);
  pushBox(city, plant.x, 0.5, plant.z, 0.7, 0.9, 0.7, "leavesDark");
  pushCol(city, plant.x, 0.5, plant.z, 0.7, 0.9, 0.7);
  // Dining set in the north-west corner + a floor lamp + a book shelf flush on a
  // wall that never holds the TV, the kitchen, a painting or a window.
  pushBox(city, x0 + 3.5, 0.45, z0 + 3.5, 1.8, 0.08, 1.0, "wood");
  pushBox(city, x0 + 3.5, 0.22, z0 + 3.5, 0.3, 0.4, 0.3, "black");
  pushCol(city, x0 + 3.5, 0.45, z0 + 3.5, 1.8, 0.8, 1.0);
  pushBox(city, x0 + 2.4, 0.3, z0 + 3.5, 0.5, 0.5, 0.5, "red");
  pushCol(city, x0 + 2.4, 0.3, z0 + 3.5, 0.5, 0.5, 0.5);
  pushBox(city, x0 + 4.6, 0.3, z0 + 3.5, 0.5, 0.5, 0.5, "red");
  pushCol(city, x0 + 4.6, 0.3, z0 + 3.5, 0.5, 0.5, 0.5);
  const lampX = door === "s" ? x0 + 2.6 : x0 + w - 2.6;
  pushBox(city, lampX, 0.9, z0 + 2.6, 0.15, 1.8, 0.15, "gray");
  pushBox(city, lampX, 1.85, z0 + 2.6, 0.5, 0.3, 0.5, "warm");
  pushCol(city, lampX, 0.9, z0 + 2.6, 0.3, 1.8, 0.3);
  const shelfX = cx - 5.2;
  // Shelf depth 0.45 against the wall inner face (0.45) centres at 0.68 —
  // the old 0.98 floated 0.3 off the wall.
  const shelfZ = door === "n" ? z0 + d - 0.68 : z0 + 0.68;
  pushBox(city, shelfX, 1.8, shelfZ, 3, 0.12, 0.45, "wood");
  const shelfMats: Mat[] = ["red", "cyan", "gold", "white"];
  for (let i = 0; i < 4; i++) {
    pushBox(city, shelfX - 1 + i * 0.66, 2.1, shelfZ, 0.4, 0.5, 0.35, shelfMats[i % shelfMats.length]);
  }
  // Backyard behind the house.
  stateHomeBackyard(city, home);
  // Per-archetype extra — the one thing that makes this house unlike its neighbours.
  if (arch.extra === "fireplace") {
    const fx = alongX ? x0 + 1.22 : cx;
    const fz = alongX ? cz : z0 + 1.22;
    pushBox(city, fx, 1.0, fz, alongX ? 1.0 : 4, 2, alongX ? 4 : 1.0, "black");
    pushCol(city, fx, 1.0, fz, alongX ? 1.0 : 4, 2, alongX ? 4 : 1.0);
    pushBox(city, fx, 2.1, fz, alongX ? 1.2 : 4.2, 0.25, alongX ? 4.2 : 1.2, "gold");
  } else if (arch.extra === "patio" || arch.extra === "deck") {
    // Outdoor slab past the door, clamped to the plot: the old 6-deep
    // slab ran 1–4 into the front road on 84 homes. The palm / umbrella
    // moves to the backyard's far corner — the front yard is too shallow
    // for it once the garage bay sits there, and the backyard corner
    // clears the roof overhang (outward >= 2.1 from the back wall).
    const dx = door === "e" ? 1 : door === "w" ? -1 : 0;
    const dz = door === "s" ? 1 : door === "n" ? -1 : 0;
    const fd = alongX ? d / 2 : w / 2;
    const slabD = Math.min(6, HOME_ROAD_EDGE - fd - 0.5);
    const px = cx + dx * (w / 2 + slabD / 2);
    const pz = cz + dz * (d / 2 + slabD / 2);
    pushBox(city, px, 0.06, pz, alongX ? 6 : slabD, 0.1, alongX ? slabD : 6, arch.extra === "deck" ? "wood" : "stone");
    const yardDepth = homeYardDepth(home);
    const yardLat = alongX ? w - 2 : d - 2;
    const backOut = Math.max(2.1, 0.6 + yardDepth - 1);
    const bdx = -dx;
    const bdz = -dz;
    const halfBack = alongX ? d / 2 : w / 2;
    const ox = cx + bdx * halfBack + bdx * backOut + (alongX ? yardLat / 2 - 1 : 0);
    const oz = cz + bdz * halfBack + bdz * backOut + (alongX ? 0 : yardLat / 2 - 1);
    if (arch.extra === "patio") {
      pushBox(city, ox, 2, oz, 0.6, 4, 0.6, "trunk");
      pushBox(city, ox, 4.6, oz, 3.4, 1.1, 3.4, "leaves");
    } else {
      pushBox(city, ox, 1.2, oz, 0.3, 2.4, 0.3, "trunk");
      pushBox(city, ox, 2.6, oz, 3.2, 0.25, 3.2, "white");
    }
  }
}

/** Builds one catalog home into the city: facade + walls + interior + zone + anchor. */
export function buildHome(city: City, home: HomeDef): void {
  const arch = HOME_ARCHETYPES[home.state].find((a) => a.key === home.archetype)
    ?? HOME_ARCHETYPES[home.state][0] as HomeArchetype;
  const { x0, z0, w, d, h, door } = home;
  // Facade: pretty.ts renders the hollow shell (door gap), roof kit, porch
  // and chimney from this — the same path the existing 8 homes take.
  const facade: Facade = {
    id: home.id, x: x0, z: z0, w, d, h,
    style: arch.style, door, enterable: true, hero: false,
    face: door, roof: arch.roof, roofDir: door, roofMat: arch.roofMat,
    porch: arch.porch, chimney: arch.chimney, awning: arch.awning,
    // Round-2: flat-roof modern homes get a gold trim band at the wall
    // top so the roofline isn't a bare slab edge.
    cornice: arch.roof === "flat",
    // Glazing: real see-through windows flanking the door on the street
    // face. Glass-modern archetypes get a wide glass wall instead.
    glass: "home",
    glassWall: arch.key === "modern" || arch.key === "beach-house" || arch.key === "loft",
  };
  city.facades.push(facade);
  // Solid walls = colliders only (pretty draws the visuals, so no wall boxes
  // here — otherwise the two shells z-fight).
  pushWallColliders(city, x0, z0, w, d, h, door);
  furnishStateHome(city, home, arch);
  // Zone + anchor mirror the existing homes exactly: kind "hall", id
  // "home-…", so runtime.ts already greets you ("Welcome home") and opens
  // the home panel on entry. Slot = the global home index.
  const back = backPoint(door, x0, z0, w, d, 1.38);
  const signPos = backPoint(door, x0, z0, w, d, 0.82);
  // Service point: 4.1 inside from the back wall (furnishHome convention).
  const service = backPoint(door, x0, z0, w, d, 4.1);
  // FOOD: the kitchen stand point — same formula as furnishHome in
  // city.ts (counter = alongX ? cx+5 : back.x / back.z : cz+5), 1.7 units
  // toward the middle of the room. E here opens the kitchen panel (only
  // in a home the player owns; the server enforces ownership on cook).
  const homeCx = x0 + w / 2;
  const homeCz = z0 + d / 2;
  const homeAlongX = door === "n" || door === "s";
  const kkx = homeAlongX ? homeCx + 5 : back.x;
  const kkz = homeAlongX ? back.z : homeCz + 5;
  const kkdx = homeCx - kkx;
  const kkdz = homeCz - kkz;
  const kklen = Math.hypot(kkdx, kkdz) || 1;
  const kitchen = { x: kkx + (kkdx / kklen) * 1.7, z: kkz + (kkdz / kklen) * 1.7 };
  const zone: Zone = {
    id: home.id, name: home.name, kind: "hall", slot: home.index,
    minX: x0 + 1.15, maxX: x0 + w - 1.15, minZ: z0 + 1.15, maxZ: z0 + d - 1.15,
    serviceX: service.x, serviceZ: service.z,
    signX: signPos.x,
    signY: 2.35,
    signZ: signPos.z,
    signRot: signPos.rot,
    kitchen,
  };
  city.zones.push(zone);
  city.anchors.push(doorAnchorFor(home.id, home.name, "hall", x0, z0, w, d, door, home.index));
}

/** Builds one state's 50 homes into the city. Returns the count built. */
export function buildHomes(state: StateId, city: City, seed = 1): number {
  const homes = buildHomeCatalog(seed).filter((h) => h.state === state);
  for (const home of homes) buildHome(city, home);
  return homes.length;
}

/** All 150 homes, in one call. Returns the count built. */
export function buildAllHomes(city: City, seed = 1): number {
  const catalog = buildHomeCatalog(seed);
  for (const home of catalog) buildHome(city, home);
  return catalog.length;
}

// ---------------------------------------------------------------------------
// Ownership — per (player, server). City Sol only.
// ---------------------------------------------------------------------------

/** Server ids picked on the menu (1-5). 0 = "no home server yet". */
export type ServerId = 1 | 2 | 3 | 4 | 5;
export type HomeServerId = ServerId | 0;

export interface OwnedHome {
  /** Catalog id, e.g. "home-ny-01". The same home can be owned on other servers. */
  homeId: string;
  /** The server this ownership lives on. */
  server: ServerId;
  ownerId: string;
  ownerName: string;
  /** Price paid, in City Sol. */
  price: number;
  boughtAt: number;
  /** Crib tier (apartment → house → mansion → penthouse), when the crib
   * builder ships it. The CRAZY rooftop is penthouse-gated on this. */
  tier?: string;
  /** CRAZY extras (pool / theater / rooftop / plants / season decor) —
   * see crazy.ts. Stored on the owned record in the `homes` JSON. */
  crazy?: import("./crazy").CrazyHomeExtras;
}

/**
 * The `player.homes` field (see WIRING.md §4 for the server-side shape).
 * `homes` is the player's owned homes ACROSS servers; `homeServer` is the
 * server where they made their home — where their progress lives. Buying a
 * home on a server makes that server their home server.
 */
export interface PlayerHomesSave {
  homeServer: HomeServerId;
  homes: OwnedHome[];
  /** CRAZY season override: "auto" (date-driven) or a season id. */
  season?: string;
}

export function freshHomesSave(): PlayerHomesSave {
  return { homeServer: 0, homes: [] };
}

/** Homes this player owns on one server. */
export function homesOwnedOn(save: PlayerHomesSave, server: ServerId): OwnedHome[] {
  return (save.homes || []).filter((h) => h.server === server);
}

export function isHomeOwnedOn(save: PlayerHomesSave, homeId: string, server: ServerId): boolean {
  return (save.homes || []).some((h) => h.homeId === homeId && h.server === server);
}

// ---------------------------------------------------------------------------
// Garage — park your own cars at home (City Sol only, no new server data)
// ---------------------------------------------------------------------------
// The garage is a carport in front of the home, centred on the door,
// with the cars parallel-parked along the front wall. Nose-in parking
// could never fit: the front yard is only 2–5 deep (the road edge is
// 13 from the plot centre) while a nose-in car needs 8.6, so every bay
// ran into the street and the cars stood in the driving lane. A
// parallel car is 2 wide, so a 3.4-deep bay (0.6 wall gap + car +
// 0.8 margin) fits the yard and the cars clear the road. The cars in
// it are the player's OWNED ground vehicles from the per-server save
// (save.vehicles) — no new data, no new column. Flyers (planes,
// helicopters, the blimp, flying cars) park in the sky, not the bay:
// the carport roof clears 3.31, so a tall flyer would clip it. The
// runtime filters them out before it counts slots (see
// garageParkedVehicles); the panel still lists them all, and selecting
// one still drives it out. Every owned ground car parks here; the only
// one that hides is the car that drove out of a garage
// (activeCarHomeId in runtime.ts) — it waits out front until another
// car is picked or it is respawned at the shop.

/** Max cars shown parked in one home garage (the panel lists them all). */
export const GARAGE_MAX_SLOTS = 4;
/** Centre-to-centre slot pitch — a parallel car is 6.4 long + 0.6 gap. */
export const GARAGE_SLOT_PITCH = 7;
/** Bay depth outward from the home's front wall (parallel car 2 wide + margins). */
export const GARAGE_BAY_DEPTH = 3.4;

export interface GarageSlot {
  x: number;
  z: number;
  /** Same heading convention as the driven cars: forward = (sin yaw, -cos yaw). */
  yaw: number;
}

export interface GarageLayout {
  homeId: string;
  /** Bay rect centre + size, in world coords. f = outward from the door wall, s = along it. */
  bay: { cx: number; cz: number; w: number; d: number; fx: number; fz: number; sx: number; sz: number };
  /** Parked-car spots, parallel to the front wall. */
  slots: GarageSlot[];
  /** White divider stripes between slots, as lateral offsets from the bay centre. */
  dividers: number[];
  /** Where a selected car spawns to drive, one per slot, just past the bay. */
  driveOut: GarageSlot[];
  /** E-prompt / walk-up point: the middle of the bay. */
  service: { x: number; z: number };
  /** GARAGE sign on the home's front wall, above the bay. */
  sign: { x: number; y: number; z: number; rot: number };
}

export function garageLayoutFor(home: HomeDef, carCount: number): GarageLayout {
  // Outward from the door wall (f) and along it (s).
  const fx = home.door === "w" ? -1 : home.door === "e" ? 1 : 0;
  const fz = home.door === "n" ? -1 : home.door === "s" ? 1 : 0;
  const sx = home.door === "n" || home.door === "s" ? 1 : 0;
  const sz = home.door === "w" || home.door === "e" ? 1 : 0;
  const cx = home.x0 + home.w / 2;
  const cz = home.z0 + home.d / 2;
  const fd = home.door === "n" || home.door === "s" ? home.d / 2 : home.w / 2;
  // Even an empty garage gets one slot so the bay (and its sign) shows.
  const slotsN = Math.max(1, Math.min(Math.max(0, carCount), GARAGE_MAX_SLOTS));
  const bayW = slotsN * GARAGE_SLOT_PITCH + 1.6;
  const bayD = GARAGE_BAY_DEPTH;
  // The bay is centred on the door and the cars parallel-park along the
  // wall. Slot offsets are side-preference first (the side alternates
  // by home) so the first car always lands on the bay's preferred side;
  // the nearest slot is ±6, whose inner edge (6 − 3.2 = 2.8) clears the
  // porch posts (±2.35) by 0.45. At 4 slots the bay spans 29.6
  // laterally — inside the 36-wide plot, and centred, so neighbouring
  // bays sit 6.4 apart and can never overlap. Outward the bay runs
  // fd+0.6 to fd+4.0: clear of the road (edge 13) except on the
  // deepest (fd=11) homes, where the outer 2.0 sits on the road's near
  // edge — the slab there is 0.04 below the asphalt, so it reads as a
  // kerb strip, and 8.0 of road stays clear.
  const side = home.index % 2 === 0 ? 1 : -1;
  const pref = side === 1 ? [6, 13, -6, -13] : [-6, -13, 6, 13];
  const slotLats = pref.slice(0, slotsN);
  const bayLat = 0;
  const bayOut = fd + 0.6 + bayD / 2;
  // Parallel to the wall: forward along s, not out of the wall.
  const yaw = Math.atan2(sx, -sz);
  const at = (lat: number, out: number): GarageSlot => ({
    x: cx + fx * out + sx * lat,
    z: cz + fz * out + sz * lat,
    yaw,
  });
  const slots = slotLats.map((lat) => at(lat, bayOut));
  const sorted = [...slotLats].sort((a, b) => a - b);
  const dividers = sorted.slice(1).map((lat, i) => (sorted[i] + lat) / 2);
  const driveOut = slotLats.map((lat) => at(lat, fd + 0.6 + bayD + 3.2));
  return {
    homeId: home.id,
    bay: { cx: cx + fx * bayOut + sx * bayLat, cz: cz + fz * bayOut + sz * bayLat, w: bayW, d: bayD, fx, fz, sx, sz },
    slots,
    dividers,
    driveOut,
    service: { x: cx + fx * bayOut + sx * bayLat, z: cz + fz * bayOut + sz * bayLat },
    sign: { x: cx + fx * (fd + 0.18) + sx * side * 5.5, y: 4.2, z: cz + fz * (fd + 0.18) + sz * side * 5.5, rot: Math.atan2(fx, fz) },
  };
}

/** True when (x, z) is inside the bay (1 unit of walk-up margin). */
export function garagePointIn(layout: GarageLayout, x: number, z: number): boolean {
  const dx = x - layout.bay.cx;
  const dz = z - layout.bay.cz;
  const along = dx * layout.bay.fx + dz * layout.bay.fz;
  const across = dx * layout.bay.sx + dz * layout.bay.sz;
  return Math.abs(along) < layout.bay.d / 2 + 1 && Math.abs(across) < layout.bay.w / 2 + 1;
}

/**
 * Pure validation mirror of the server `buy-home` op (WIRING.md §4).
 * Same order of checks, same failure strings — the client and the server
 * must agree, and the server is the authority. Returns the updated save
 * (with `homeServer` set to the server of purchase) or an error.
 */
export function buyHomeLocal(
  save: PlayerHomesSave,
  playerId: string,
  playerName: string,
  homeId: string,
  server: ServerId,
  balance: number,
  now: number = Date.now(),
): { ok: true; save: PlayerHomesSave; price: number } | { ok: false; message: string } {
  const home = homeById(homeId);
  if (!home) return { ok: false, message: "Unknown home." };
  if (!Number.isInteger(server) || server < 1 || server > 5) {
    return { ok: false, message: "Pick a server (1-5) first." };
  }
  if (isHomeOwnedOn(save, homeId, server)) {
    return { ok: false, message: "You already own this home on this server." };
  }
  if (balance < home.price) {
    return { ok: false, message: `Not enough City Sol — this home is ${home.price}.` };
  }
  return {
    ok: true,
    price: home.price,
    save: {
      homeServer: server,
      homes: [
        ...(save.homes || []),
        { homeId, server, ownerId: playerId, ownerName: playerName, price: home.price, boughtAt: now },
      ],
    },
  };
}
