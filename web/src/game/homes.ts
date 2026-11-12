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

/** Back-wall point + sign rotation, same convention as city.ts furnishHome. */
function backPoint(door: Face, x0: number, z0: number, w: number, d: number, inset = 2.4) {
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "w") return { x: x0 + w - inset, z: cz, rot: -Math.PI / 2 };
  if (door === "e") return { x: x0 + inset, z: cz, rot: Math.PI / 2 };
  if (door === "n") return { x: cx, z: z0 + d - inset, rot: Math.PI };
  return { x: cx, z: z0 + inset, rot: 0 };
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
  // TV on the far wall + rug + sofa facing it.
  const back = backPoint(door, x0, z0, w, d);
  pushBox(city, back.x, 1.5, back.z, alongX ? 3.6 : 0.2, 2, alongX ? 0.2 : 3.6, "black");
  pushBox(city, back.x, 1.5, back.z, alongX ? 3.2 : 0.1, 1.6, alongX ? 0.1 : 3.2, "cyan");
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
  // Kitchenette along the back wall: counter + cabinets + fridge.
  const kx = alongX ? cx + 5 : back.x;
  const kz = alongX ? back.z : cz + 5;
  pushBox(city, kx, 0.55, kz, alongX ? 4.6 : 1.1, 1.05, alongX ? 1.1 : 4.6, "stone");
  pushCol(city, kx, 0.55, kz, alongX ? 4.6 : 1.1, 1.05, alongX ? 1.1 : 4.6);
  pushBox(city, kx, 1.2, kz, alongX ? 4.8 : 1.2, 0.14, alongX ? 1.2 : 4.8, "wood");
  pushBox(city, alongX ? kx + 2.8 : kx, 1.0, alongX ? kz : kz + 2.8, 0.9, 2, 0.9, "white");
  pushCol(city, alongX ? kx + 2.8 : kx, 1.0, alongX ? kz : kz + 2.8, 0.9, 2, 0.9);
  // Bedroom nook: bed + nightstand.
  const bedX = x0 + w - 3.4;
  const bedZ = z0 + d - 3.4;
  pushBox(city, bedX, 0.35, bedZ, 2.4, 0.55, 3.4, "wood");
  pushCol(city, bedX, 0.35, bedZ, 2.4, 0.55, 3.4);
  pushBox(city, bedX, 0.7, bedZ, 2.2, 0.22, 3.2, "white");
  pushBox(city, bedX, 0.85, bedZ - 1.4, 1.6, 0.3, 0.5, arch.rug);
  pushBox(city, bedX + 1.6, 0.4, bedZ + 1.6, 0.6, 0.7, 0.6, "black");
  // Paintings on the side walls (thin accent boxes) + a plant by the door.
  pushBox(city, alongX ? cx + 6 : x0 + 1.3, 1.9, alongX ? z0 + 1.3 : cz + 6, alongX ? 2.2 : 0.15, 1.5, alongX ? 0.15 : 2.2, arch.rug);
  pushBox(city, alongX ? cx - 6 : x0 + w - 1.3, 1.9, alongX ? z0 + d - 1.3 : cz - 6, alongX ? 2.2 : 0.15, 1.5, alongX ? 0.15 : 2.2, "gold");
  const plant = backPoint(door === "n" ? "s" : door === "s" ? "n" : door === "w" ? "e" : "w", x0, z0, w, d);
  pushBox(city, plant.x, 0.5, plant.z, 0.7, 0.9, 0.7, "leavesDark");
  pushCol(city, plant.x, 0.5, plant.z, 0.7, 0.9, 0.7);
  // Per-archetype extra — the one thing that makes this house unlike its neighbours.
  if (arch.extra === "fireplace") {
    const fx = alongX ? x0 + 1.4 : cx;
    const fz = alongX ? cz : z0 + 1.4;
    pushBox(city, fx, 1.0, fz, alongX ? 1.2 : 4, 2, alongX ? 4 : 1.2, "black");
    pushCol(city, fx, 1.0, fz, alongX ? 1.2 : 4, 2, alongX ? 4 : 1.2);
    pushBox(city, fx, 2.1, fz, alongX ? 1.4 : 4.2, 0.25, alongX ? 4.2 : 1.4, "gold");
  } else if (arch.extra === "patio" || arch.extra === "deck") {
    // Outdoor slab past the door + one palm (LA) or umbrella (FL).
    const dx = door === "e" ? 1 : door === "w" ? -1 : 0;
    const dz = door === "s" ? 1 : door === "n" ? -1 : 0;
    const px = cx + dx * (w / 2 + 3);
    const pz = cz + dz * (d / 2 + 3);
    pushBox(city, px, 0.06, pz, 6, 0.1, 6, arch.extra === "deck" ? "wood" : "stone");
    if (arch.extra === "patio") {
      pushBox(city, px + 2, 2, pz, 0.6, 4, 0.6, "trunk");
      pushBox(city, px + 2, 4.6, pz, 3.4, 1.1, 3.4, "leaves");
    } else {
      pushBox(city, px - 2, 1.2, pz, 0.3, 2.4, 0.3, "trunk");
      pushBox(city, px - 2, 2.6, pz, 3.2, 0.25, 3.2, "white");
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
  };
  city.facades.push(facade);
  // Solid walls = colliders only (pretty draws the visuals, so no wall boxes
  // here — otherwise the two shells z-fight).
  pushWallColliders(city, x0, z0, w, d, h, door);
  furnishStateHome(city, home, arch);
  // Zone + anchor mirror the existing homes exactly: kind "hall", id
  // "home-…", so runtime.ts already greets you ("Welcome home") and opens
  // the home panel on entry. Slot = the global home index.
  const back = backPoint(door, x0, z0, w, d);
  // Service point: 4.1 inside from the back wall (furnishHome convention).
  const service = backPoint(door, x0, z0, w, d, 4.1);
  const zone: Zone = {
    id: home.id, name: home.name, kind: "hall", slot: home.index,
    minX: x0 + 1.15, maxX: x0 + w - 1.15, minZ: z0 + 1.15, maxZ: z0 + d - 1.15,
    serviceX: service.x, serviceZ: service.z,
    signX: back.x + (door === "w" ? -0.55 : door === "e" ? 0.55 : 0),
    signY: 2.35,
    signZ: back.z + (door === "n" ? -0.55 : door === "s" ? 0.55 : 0),
    signRot: back.rot,
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
