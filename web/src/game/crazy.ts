// ---------------------------------------------------------------------------
// OrbitX City — CRAZY STUFF: pool / hot tub, home theater, penthouse
// rooftop / balcony, plants, seasons. City Sol only, no real money.
// ---------------------------------------------------------------------------
// Data lives on the owned home record in the `homes` JSON (server
// api/city.js CRAZY section): `crazy: { pool, theater, rooftop, plants,
// decor }`, plus the season override on the save's `homes.season`.
//
// Rendering: the city is built once at boot (engine buildMeshes), so the
// extras render as a dynamic group the runtime rebuilds whenever the
// owned-home data changes (rebuildCrazy in runtime.ts) — one InstancedMesh
// per material, the same pattern as buildMeshes, so 150 season-touched
// homes cost a handful of draw calls, not hundreds of meshes.
// ---------------------------------------------------------------------------

import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import type { Collider, Mat } from "./city";
import { HOME_ARCHETYPES, backPoint, type HomeDef } from "./homes";
import { MATERIALS } from "./materials";

export type CrazySeason = "winter" | "halloween" | "spring" | "summer";
export type SeasonOverride = "auto" | CrazySeason;
export type CrazyPlantKind = "sunflower" | "rose" | "palm";

export interface CrazyPlantView {
  id: string;
  kind: string;
  /** 0 seedling, 1 small, 2 grown — server-computed at fetch time. */
  stage: number;
  watered: boolean;
  plantedAt: number;
  /** Raw growth inputs (server sends them) so the client can recompute
   * the live stage between polls — growth is derived, never stored. */
  wateredMs?: number;
  wateringSince?: number;
}

export interface CrazyDecor {
  lights: boolean;
  pumpkins: boolean;
  flowers: boolean;
  lanterns: boolean;
}

export interface CrazyHomeExtras {
  pool: "pool" | "hottub" | null;
  theater: boolean;
  rooftop: boolean;
  plants: CrazyPlantView[];
  decor: CrazyDecor;
}

export function freshCrazy(): CrazyHomeExtras {
  return { pool: null, theater: false, rooftop: false, plants: [], decor: { lights: false, pumpkins: false, flowers: false, lanterns: false } };
}

export function crazyOf(owned: { crazy?: CrazyHomeExtras | null } | null | undefined): CrazyHomeExtras {
  const raw = owned?.crazy;
  if (!raw) return freshCrazy();
  return {
    pool: raw.pool === "pool" || raw.pool === "hottub" ? raw.pool : null,
    theater: !!raw.theater,
    rooftop: !!raw.rooftop,
    plants: Array.isArray(raw.plants) ? raw.plants : [],
    decor: {
      lights: !!raw.decor?.lights,
      pumpkins: !!raw.decor?.pumpkins,
      flowers: !!raw.decor?.flowers,
      lanterns: !!raw.decor?.lanterns,
    },
  };
}

// Prices mirror the server (api/city.js CRAZY section) — the server is
// the authority; these only render the panel.
export const CRAZY_PRICES = {
  pool: 900,
  hottub: 450,
  theater: 1200,
  rooftop: 1500,
  plants: { sunflower: 40, rose: 60, palm: 150 } as Record<string, number>,
  decor: { lights: 250, pumpkins: 200, flowers: 150, lanterns: 180 } as Record<string, number>,
};

export const CRAZY_PLANT_INFO: Record<string, { name: string; harvest: number; color: Mat; flower: Mat }> = {
  sunflower: { name: "Sunflower", harvest: 80, color: "gold", flower: "gold" },
  rose: { name: "Rose", harvest: 120, color: "red", flower: "red" },
  palm: { name: "Palm", harvest: 300, color: "leavesDark", flower: "leaves" },
};

export const CRAZY_DECOR_INFO: Record<string, { name: string; season: CrazySeason; blurb: string }> = {
  lights: { name: "Christmas lights", season: "winter", blurb: "Warm lights along the roofline" },
  pumpkins: { name: "Halloween pumpkins", season: "halloween", blurb: "Lit pumpkins by the door" },
  flowers: { name: "Spring flowers", season: "spring", blurb: "Flower boxes through the yard" },
  lanterns: { name: "Summer lanterns", season: "summer", blurb: "Gold lanterns around the yard" },
};

export const CRAZY_SEASON_LABELS: Record<CrazySeason, string> = {
  winter: "Winter",
  halloween: "Halloween",
  spring: "Spring",
  summer: "Summer",
};

/** Date-driven season: October is Halloween, Dec–Feb Winter, Mar–May Spring, Jun–Sep Summer. */
export function seasonForDate(when: number = Date.now()): CrazySeason {
  const month = new Date(when).getMonth();
  if (month === 9) return "halloween";
  if (month === 11 || month === 0 || month === 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  return "summer";
}

export function effectiveSeason(override?: string | null, when: number = Date.now()): CrazySeason {
  if (override === "winter" || override === "halloween" || override === "spring" || override === "summer") return override;
  return seasonForDate(when);
}

// Growth mirrors the server: a watering keeps a plant wet for 10 minutes
// of growth; 1 wet minute makes it small, 5 make it grown.
export const CRAZY_WATER_WINDOW_MS = 10 * 60 * 1000;
export const CRAZY_GROW_SMALL_MS = 60 * 1000;
export const CRAZY_GROW_GROWN_MS = 5 * 60 * 1000;

export function plantGrowthMsLive(plant: CrazyPlantView, now: number = Date.now()): number {
  const banked = Number(plant.wateredMs || 0);
  const since = Number(plant.wateringSince || 0);
  if (!since || now <= since) return banked;
  return banked + Math.min(now - since, CRAZY_WATER_WINDOW_MS);
}

export function plantStageLive(plant: CrazyPlantView, now: number = Date.now()): number {
  const growth = plantGrowthMsLive(plant, now);
  if (growth >= CRAZY_GROW_GROWN_MS) return 2;
  if (growth >= CRAZY_GROW_SMALL_MS) return 1;
  return 0;
}

export const CRAZY_PLANT_STAGE_NAMES = ["Seedling", "Small", "Grown"] as const;

// ---------------------------------------------------------------------------
// Geometry — pure, from the catalog HomeDef. Mirrors the yard math in
// homes.ts stateHomeBackyard (5.5-deep yard behind the house, opposite
// the door) so the pool, the plant slots and the decor never drift from
// the yard the builder already made.
// ---------------------------------------------------------------------------

export interface YardRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  /** The far (hedge) edge, on the axis the yard extends along. */
  far: number;
  /** The direction the yard extends from the house: "n" | "s" | "e" | "w". */
  dir: "n" | "s" | "e" | "w";
}

export function yardRectFor(home: HomeDef): YardRect {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const depth = 5.5;
  if (door === "w") return { minX: x0 + w + 0.6, maxX: x0 + w + 0.6 + depth, minZ: cz - (w - 2) / 2, maxZ: cz + (w - 2) / 2, cx: x0 + w + 0.6 + depth / 2, cz, far: x0 + w + 0.6 + depth, dir: "e" };
  if (door === "e") return { minX: x0 - 0.6 - depth, maxX: x0 - 0.6, minZ: cz - (w - 2) / 2, maxZ: cz + (w - 2) / 2, cx: x0 - 0.6 - depth / 2, cz, far: x0 - 0.6 - depth, dir: "w" };
  if (door === "n") return { minX: cx - (w - 2) / 2, maxX: cx + (w - 2) / 2, minZ: z0 + d + 0.6, maxZ: z0 + d + 0.6 + depth, cx, cz: z0 + d + 0.6 + depth / 2, far: z0 + d + 0.6 + depth, dir: "s" };
  return { minX: cx - (w - 2) / 2, maxX: cx + (w - 2) / 2, minZ: z0 - 0.6 - depth, maxZ: z0 - 0.6, cx, cz: z0 - 0.6 - depth / 2, far: z0 - 0.6 - depth, dir: "n" };
}

export interface PoolRect {
  homeId: string;
  kind: "pool" | "hottub";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The waterline the swimmer floats at. */
  waterY: number;
}

/** The pool / hot tub water footprint, centred in the yard. The yard is
 * 5.5 deep and (w-2) wide, so the pool's long side runs along the yard's
 * wide axis — otherwise the water (and its deck) would poke through the
 * hedges on every east/west-door home. */
export function poolRectFor(home: HomeDef, kind: "pool" | "hottub"): PoolRect {
  const yard = yardRectFor(home);
  const wideX = yard.dir === "n" || yard.dir === "s";
  const pw = kind === "pool" ? (wideX ? 6 : 4) : 3;
  const pd = kind === "pool" ? (wideX ? 4 : 6) : 3;
  return {
    homeId: home.id,
    kind,
    minX: yard.cx - pw / 2,
    maxX: yard.cx + pw / 2,
    minZ: yard.cz - pd / 2,
    maxZ: yard.cz + pd / 2,
    waterY: kind === "pool" ? 0.35 : 0.3,
  };
}

/** Plant slot i (0-5) along the yard's far hedge. */
export function plantSlotFor(home: HomeDef, index: number): { x: number; z: number } {
  const yard = yardRectFor(home);
  const along = [-5, -3, -1, 1, 3, 5][index % 6] ?? 0;
  if (yard.dir === "n" || yard.dir === "s") {
    return { x: yard.cx + along, z: yard.far + (yard.dir === "s" ? -0.9 : 0.9) };
  }
  return { x: yard.far + (yard.dir === "e" ? -0.9 : 0.9), z: yard.cz + along };
}

/** The door-side point on the facade (pumpkins / lanterns / wreath). */
export function doorPointFor(home: HomeDef): { x: number; z: number; nx: number; nz: number } {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  if (door === "s") return { x: cx, z: z0 + d, nx: 0, nz: 1 };
  if (door === "n") return { x: cx, z: z0, nx: 0, nz: -1 };
  if (door === "e") return { x: x0 + w, z: cz, nx: 1, nz: 0 };
  return { x: x0, z: cz, nx: -1, nz: 0 };
}

/** Roof rise above the wall top, mirroring pretty.ts (gable / hip / flat). */
export function roofRiseFor(home: HomeDef): number {
  const arch = HOME_ARCHETYPES[home.state].find((a) => a.key === home.archetype) ?? HOME_ARCHETYPES[home.state][0];
  if (!arch) return 0.4;
  if (arch.roof === "gable") {
    const alongX = home.door === "n" || home.door === "s";
    const span = (alongX ? home.d : home.w) + 0.8;
    return Math.min(span * 0.32, 3.2);
  }
  if (arch.roof === "hip") return Math.min(Math.min(home.w, home.d) * 0.28, 3);
  return 0.4;
}

/** The rooftop deck floor (feet level) — above the roof peak. */
export function rooftopDeckYFor(home: HomeDef): number {
  return home.h + roofRiseFor(home) + 0.35;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface CrazyBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  mat: Mat;
  ry?: number;
}

export interface TheaterScreen {
  homeId: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  mesh: Mesh;
}

/** The render pass result the runtime keeps (group + physics + swim). */
export interface CrazyRender {
  group: Group;
  colliders: Collider[];
  pools: PoolRect[];
  screens: Map<string, TheaterScreen>;
  /** Theater seat spots (for NPCs to gather at while watching). */
  seats: Map<string, Array<{ x: number; z: number }>>;
  /** Rooftop decks, for the go-to-rooftop / go-downstairs teleports. */
  rooftops: Map<string, { deckY: number; x: number; z: number; home: HomeDef }>;
}

const unitBox = new BoxGeometry(1, 1, 1);
const unitPlane = new PlaneGeometry(1, 1);

function instancedFromBoxes(boxes: CrazyBox[]): Group {
  const group = new Group();
  const buckets = new Map<Mat, CrazyBox[]>();
  for (const box of boxes) {
    let list = buckets.get(box.mat);
    if (!list) {
      list = [];
      buckets.set(box.mat, list);
    }
    list.push(box);
  }
  const m = new Matrix4();
  for (const [mat, list] of buckets) {
    if (!list.length) continue;
    const mesh = new InstancedMesh(unitBox, MATERIALS[mat], list.length);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (mat === "water") mesh.renderOrder = 2;
    for (let i = 0; i < list.length; i++) {
      const b = list[i] as CrazyBox;
      m.makeRotationY(b.ry ?? 0);
      m.scale(new Vector3(b.sx, b.sy, b.sz));
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

function col(x: number, y: number, z: number, sx: number, sy: number, sz: number, tag = "crazy"): Collider {
  return { minX: x - sx / 2, maxX: x + sx / 2, minY: y - sy / 2, maxY: y + sy / 2, minZ: z - sz / 2, maxZ: z + sz / 2, tag };
}

function pushPoolBoxes(boxes: CrazyBox[], home: HomeDef, kind: "pool" | "hottub"): void {
  const rect = poolRectFor(home, kind);
  const pw = rect.maxX - rect.minX;
  const pd = rect.maxZ - rect.minZ;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const waterTop = kind === "pool" ? 0.75 : 0.6;
  // Deck slab around the water (walkable, 0.12 high) — 0.5 of deck on
  // every side, inside the 5.5-deep yard on every home.
  boxes.push({ x: cx, y: 0.06, z: cz, sx: pw + 1, sy: 0.12, sz: pd + 1, mat: "stone" });
  // Water.
  boxes.push({ x: cx, y: waterTop / 2, z: cz, sx: pw, sy: waterTop, sz: pd, mat: "water" });
  // Rim: four low stone lips hugging the water's edge, on the deck.
  boxes.push({ x: cx, y: 0.22, z: rect.minZ - 0.15, sx: pw, sy: 0.32, sz: 0.3, mat: "stone" });
  boxes.push({ x: cx, y: 0.22, z: rect.maxZ + 0.15, sx: pw, sy: 0.32, sz: 0.3, mat: "stone" });
  boxes.push({ x: rect.minX - 0.15, y: 0.22, z: cz, sx: 0.3, sy: 0.32, sz: pd, mat: "stone" });
  boxes.push({ x: rect.maxX + 0.15, y: 0.22, z: cz, sx: 0.3, sy: 0.32, sz: pd, mat: "stone" });
  // Ladder rails on the near edge (on the deck, just outside the water).
  boxes.push({ x: cx - 0.4, y: 0.6, z: rect.minZ - 0.35, sx: 0.12, sy: 1, sz: 0.12, mat: "gold" });
  boxes.push({ x: cx + 0.4, y: 0.6, z: rect.minZ - 0.35, sx: 0.12, sy: 1, sz: 0.12, mat: "gold" });
  if (kind === "pool") {
    // Umbrella over the deck's far end, on the yard's wide axis (room to
    // spare there; the 5.5-deep axis has none).
    const yard = yardRectFor(home);
    const wideX = yard.dir === "n" || yard.dir === "s";
    const ux = wideX ? cx + pw / 2 + 0.3 : cx;
    const uz = wideX ? cz : cz + pd / 2 + 0.3;
    boxes.push({ x: ux, y: 1.1, z: uz, sx: 0.16, sy: 2.2, sz: 0.16, mat: "trunk" });
    boxes.push({ x: ux, y: 2.3, z: uz, sx: 2.4, sy: 0.18, sz: 2.4, mat: "white" });
  } else {
    // Hot tub: gold trim + a steam wisp of white boxes above the water.
    boxes.push({ x: cx, y: 0.78, z: rect.minZ - 0.15, sx: pw + 0.4, sy: 0.1, sz: 0.3, mat: "gold" });
    boxes.push({ x: cx, y: 0.78, z: rect.maxZ + 0.15, sx: pw + 0.4, sy: 0.1, sz: 0.3, mat: "gold" });
    boxes.push({ x: cx - 0.5, y: 1.2, z: cz, sx: 0.7, sy: 0.7, sz: 0.7, mat: "white" });
    boxes.push({ x: cx + 0.5, y: 1.7, z: cz + 0.4, sx: 0.5, sy: 0.5, sz: 0.5, mat: "white" });
  }
}

function pushPlantBoxes(boxes: CrazyBox[], home: HomeDef, plant: CrazyPlantView, index: number, now: number): void {
  const slot = plantSlotFor(home, index);
  const stage = plantStageLive(plant, now);
  const info = CRAZY_PLANT_INFO[plant.kind] ?? CRAZY_PLANT_INFO.sunflower;
  // Stone pot.
  boxes.push({ x: slot.x, y: 0.3, z: slot.z, sx: 0.9, sy: 0.6, sz: 0.9, mat: "stone" });
  if (stage === 0) {
    // Seedling: a tiny sprout.
    boxes.push({ x: slot.x, y: 0.75, z: slot.z, sx: 0.3, sy: 0.35, sz: 0.3, mat: "leaves" });
  } else if (stage === 1) {
    boxes.push({ x: slot.x, y: 1, z: slot.z, sx: 0.24, sy: 0.85, sz: 0.24, mat: "trunk" });
    boxes.push({ x: slot.x, y: 1.6, z: slot.z, sx: 1.1, sy: 0.9, sz: 1.1, mat: "leaves" });
  } else if (plant.kind === "palm") {
    // Grown palm: tall trunk + wide canopy.
    boxes.push({ x: slot.x, y: 1.6, z: slot.z, sx: 0.35, sy: 2.6, sz: 0.35, mat: "trunk" });
    boxes.push({ x: slot.x, y: 3.1, z: slot.z, sx: 3, sy: 0.6, sz: 3, mat: "leavesDark" });
    boxes.push({ x: slot.x, y: 3.5, z: slot.z, sx: 2, sy: 0.6, sz: 2, mat: "leaves" });
  } else {
    // Grown flower: bushy plant + a bright bloom on top.
    boxes.push({ x: slot.x, y: 1.05, z: slot.z, sx: 0.3, sy: 0.9, sz: 0.3, mat: "trunk" });
    boxes.push({ x: slot.x, y: 1.7, z: slot.z, sx: 1.5, sy: 1, sz: 1.5, mat: "leaves" });
    boxes.push({ x: slot.x, y: 2.35, z: slot.z, sx: 0.7, sy: 0.5, sz: 0.7, mat: (info?.flower ?? "gold") as Mat });
  }
  // Freshly watered: a small blue droplet marker above the plant.
  if (plant.watered) {
    boxes.push({ x: slot.x, y: stage === 2 ? 3.1 : stage === 1 ? 2.3 : 1.2, z: slot.z, sx: 0.35, sy: 0.35, sz: 0.35, mat: "cyanhot" });
  }
}

function pushTheaterBoxes(boxes: CrazyBox[], home: HomeDef): Array<{ x: number; z: number }> {
  const { x0, z0, w, d, door } = home;
  const alongX = door === "n" || door === "s";
  const screen = backPoint(door, x0, z0, w, d, 2.65);
  // Gold frame around the screen (the screen plane itself is a separate
  // canvas-textured mesh, mounted over the old TV).
  const frameW = alongX ? 7 : 0.3;
  const frameD = alongX ? 0.3 : 7;
  boxes.push({ x: screen.x, y: 2.3, z: screen.z, sx: frameW, sy: 3, sz: frameD, mat: "gold" });
  // Two rows of three seats facing the screen.
  const seats: Array<{ x: number; z: number }> = [];
  // Direction from a seat toward the screen (the back wall).
  const faceX = alongX ? 0 : door === "w" ? 1 : -1;
  const faceZ = alongX ? (door === "s" ? -1 : 1) : 0;
  for (const inset of [5.4, 7.6]) {
    const row = backPoint(door, x0, z0, w, d, inset);
    for (const off of [-2.4, 0, 2.4]) {
      const sx = alongX ? row.x + off : row.x;
      const sz = alongX ? row.z : row.z + off;
      seats.push({ x: sx, z: sz });
      boxes.push({ x: sx, y: 0.35, z: sz, sx: alongX ? 1.9 : 1.1, sy: 0.5, sz: alongX ? 1.1 : 1.9, mat: "red" });
      // Seat back: on the far side from the screen.
      boxes.push({
        x: sx - faceX * 0.55,
        y: 0.85,
        z: sz - faceZ * 0.55,
        sx: alongX ? 1.9 : 0.25,
        sy: 0.8,
        sz: alongX ? 0.25 : 1.9,
        mat: "black",
      });
    }
  }
  // A snack table at the side + a floor lamp by the screen.
  const table = backPoint(door, x0, z0, w, d, 4.4);
  boxes.push({ x: alongX ? table.x + 5 : table.x, y: 0.4, z: alongX ? table.z : table.z + 5, sx: 1.4, sy: 0.75, sz: 1.4, mat: "wood" });
  return seats;
}

function pushRooftopBoxes(boxes: CrazyBox[], colliders: Collider[], home: HomeDef): void {
  const { x0, z0, w, d } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const deckY = rooftopDeckYFor(home);
  // Deck slab (walkable) + its floor collider.
  boxes.push({ x: cx, y: deckY - 0.15, z: cz, sx: w - 1, sy: 0.3, sz: d - 1, mat: "wood" });
  colliders.push(col(cx, deckY - 0.15, cz, w - 1, 0.3, d - 1));
  // Corner posts from the roof up to the deck (the deck reads as a raised
  // roof pavilion, not a floating slab).
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    const x = cx + (px * (w - 2)) / 2;
    const z = cz + (pz * (d - 2)) / 2;
    const baseY = home.h + 0.4;
    boxes.push({ x, y: (baseY + deckY) / 2, z, sx: 0.4, sy: deckY - baseY, sz: 0.4, mat: "trunk" });
  }
  // Railing on all four sides + colliders so nobody walks off the edge.
  const rail = 1.1;
  const rw = w - 1;
  const rd = d - 1;
  boxes.push({ x: cx, y: deckY + rail / 2, z: cz - rd / 2, sx: rw, sy: rail, sz: 0.18, mat: "gold" });
  boxes.push({ x: cx, y: deckY + rail / 2, z: cz + rd / 2, sx: rw, sy: rail, sz: 0.18, mat: "gold" });
  boxes.push({ x: cx - rw / 2, y: deckY + rail / 2, z: cz, sx: 0.18, sy: rail, sz: rd, mat: "gold" });
  boxes.push({ x: cx + rw / 2, y: deckY + rail / 2, z: cz, sx: 0.18, sy: rail, sz: rd, mat: "gold" });
  colliders.push(col(cx, deckY + rail / 2, cz - rd / 2, rw, rail, 0.18));
  colliders.push(col(cx, deckY + rail / 2, cz + rd / 2, rw, rail, 0.18));
  colliders.push(col(cx - rw / 2, deckY + rail / 2, cz, 0.18, rail, rd));
  colliders.push(col(cx + rw / 2, deckY + rail / 2, cz, 0.18, rail, rd));
  // Stair bulkhead in one corner (the way "down" — visual; the trip down
  // is the Go downstairs button) + two benches, a table, planters.
  boxes.push({ x: cx - rw / 2 + 1.6, y: deckY + 1.1, z: cz - rd / 2 + 1.6, sx: 3, sy: 2.2, sz: 2.4, mat: "white" });
  boxes.push({ x: cx - rw / 2 + 1.6, y: deckY + 0.9, z: cz - rd / 2 + 2.9, sx: 1, sy: 1.8, sz: 0.2, mat: "gold" });
  colliders.push(col(cx - rw / 2 + 1.6, deckY + 1.1, cz - rd / 2 + 1.6, 3, 2.2, 2.4));
  boxes.push({ x: cx + 2, y: deckY + 0.35, z: cz + 1, sx: 2.6, sy: 0.5, sz: 1, mat: "red" });
  colliders.push(col(cx + 2, deckY + 0.35, cz + 1, 2.6, 0.5, 1));
  boxes.push({ x: cx + 2, y: deckY + 0.85, z: cz + 1.6, sx: 2.6, sy: 0.7, sz: 0.2, mat: "red" });
  boxes.push({ x: cx - 2, y: deckY + 0.35, z: cz - 1, sx: 2.6, sy: 0.5, sz: 1, mat: "red" });
  colliders.push(col(cx - 2, deckY + 0.35, cz - 1, 2.6, 0.5, 1));
  boxes.push({ x: cx - 2, y: deckY + 0.85, z: cz - 1.6, sx: 2.6, sy: 0.7, sz: 0.2, mat: "red" });
  boxes.push({ x: cx, y: deckY + 0.4, z: cz, sx: 1.6, sy: 0.7, sz: 1, mat: "wood" });
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as Array<[number, number]>) {
    const x = cx + (px * (rw - 2.4)) / 2;
    const z = cz + (pz * (rd - 2.4)) / 2;
    boxes.push({ x, y: deckY + 0.35, z, sx: 0.9, sy: 0.7, sz: 0.9, mat: "stone" });
    boxes.push({ x, y: deckY + 1, z, sx: 0.9, sy: 0.7, sz: 0.9, mat: "leaves" });
  }
  // String lights along the railing.
  for (let i = -2; i <= 2; i++) {
    boxes.push({ x: cx + (i * rw) / 5, y: deckY + 1.25, z: cz - rd / 2, sx: 0.3, sy: 0.3, sz: 0.3, mat: "warm" });
    boxes.push({ x: cx + (i * rw) / 5, y: deckY + 1.25, z: cz + rd / 2, sx: 0.3, sy: 0.3, sz: 0.3, mat: "warm" });
  }
}

function pushOwnedDecorBoxes(boxes: CrazyBox[], home: HomeDef, decor: CrazyDecor): void {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const alongX = door === "n" || door === "s";
  const yard = yardRectFor(home);
  const doorPt = doorPointFor(home);
  if (decor.lights) {
    // Warm bulbs along the front roofline + down both sides.
    for (let i = -3; i <= 3; i++) {
      const t = (i / 3.5) * (w / 2 - 1);
      boxes.push({
        x: alongX ? cx + t : doorPt.x + doorPt.nx * 0.4,
        y: home.h - 0.6,
        z: alongX ? doorPt.z + doorPt.nz * 0.4 : cz + t,
        sx: 0.35, sy: 0.35, sz: 0.35, mat: "warm",
      });
    }
    for (const side of [-1, 1]) {
      boxes.push({ x: alongX ? cx + side * (w / 2 - 0.6) : doorPt.x, y: home.h - 0.6, z: alongX ? doorPt.z : cz + side * (d / 2 - 0.6), sx: 0.35, sy: 0.35, sz: 0.35, mat: "warm" });
    }
  }
  if (decor.pumpkins) {
    // Three big lit pumpkins by the door.
    for (const [off, s] of [[-1.8, 1], [0, 1.3], [1.8, 1]] as Array<[number, number]>) {
      const px = doorPt.x + doorPt.nx * 1.7 + (alongX ? off : 0);
      const pz = doorPt.z + doorPt.nz * 1.7 + (alongX ? 0 : off);
      boxes.push({ x: px, y: 0.5 * s, z: pz, sx: 1 * s, sy: 1 * s, sz: 1 * s, mat: "gold" });
      boxes.push({ x: px, y: 1.05 * s, z: pz, sx: 0.3, sy: 0.3, sz: 0.3, mat: "leavesDark" });
    }
  }
  if (decor.flowers) {
    const mats: Mat[] = ["red", "cyan", "gold", "white"];
    for (let i = 0; i < 6; i++) {
      const slot = plantSlotFor(home, i);
      boxes.push({ x: slot.x, y: 0.25, z: slot.z, sx: 1, sy: 0.5, sz: 0.5, mat: "wood" });
      boxes.push({ x: slot.x, y: 0.6, z: slot.z, sx: 0.8, sy: 0.35, sz: 0.4, mat: mats[i % mats.length] as Mat });
    }
  }
  if (decor.lanterns) {
    for (const [lx, lz] of [
      [yard.minX + 1, yard.minZ + 1],
      [yard.maxX - 1, yard.minZ + 1],
      [yard.minX + 1, yard.maxZ - 1],
      [yard.maxX - 1, yard.maxZ - 1],
    ] as Array<[number, number]>) {
      boxes.push({ x: lx, y: 0.9, z: lz, sx: 0.16, sy: 1.8, sz: 0.16, mat: "trunk" });
      boxes.push({ x: lx, y: 1.9, z: lz, sx: 0.6, sy: 0.6, sz: 0.6, mat: "gold" });
    }
  }
}

// Block-wide season touches: every catalog home gets the season's look.
// (Player-owned decor above is the denser personal version.)
function pushSeasonBoxes(boxes: CrazyBox[], homes: HomeDef[], season: CrazySeason): void {
  for (const home of homes) {
    const { x0, z0, w, d, door } = home;
    const cx = x0 + w / 2;
    const cz = z0 + d / 2;
    const alongX = door === "n" || door === "s";
    const doorPt = doorPointFor(home);
    if (season === "winter") {
      for (let i = -2; i <= 2; i++) {
        const t = (i / 2.5) * (w / 2 - 1);
        boxes.push({
          x: alongX ? cx + t : doorPt.x + doorPt.nx * 0.4,
          y: home.h - 0.6,
          z: alongX ? doorPt.z + doorPt.nz * 0.4 : cz + t,
          sx: 0.3, sy: 0.3, sz: 0.3, mat: "warm",
        });
      }
      // A wreath on the door.
      boxes.push({ x: doorPt.x + doorPt.nx * 0.5, y: 2.2, z: doorPt.z + doorPt.nz * 0.5, sx: alongX ? 0.9 : 0.25, sy: 0.9, sz: alongX ? 0.25 : 0.9, mat: "leavesDark" });
    } else if (season === "halloween") {
      for (const off of [-1.4, 1.4]) {
        const px = doorPt.x + doorPt.nx * 1.5 + (alongX ? off : 0);
        const pz = doorPt.z + doorPt.nz * 1.5 + (alongX ? 0 : off);
        boxes.push({ x: px, y: 0.4, z: pz, sx: 0.8, sy: 0.8, sz: 0.8, mat: "gold" });
      }
      for (let i = -1; i <= 1; i++) {
        const t = i * (w / 4);
        boxes.push({
          x: alongX ? cx + t : doorPt.x + doorPt.nx * 0.4,
          y: home.h - 0.6,
          z: alongX ? doorPt.z + doorPt.nz * 0.4 : cz + t,
          sx: 0.3, sy: 0.3, sz: 0.3, mat: "red",
        });
      }
    } else if (season === "spring") {
      const mats: Mat[] = ["red", "cyan", "gold"];
      for (let i = 0; i < 3; i++) {
        const slot = plantSlotFor(home, i * 2);
        boxes.push({ x: slot.x, y: 0.3, z: slot.z, sx: 0.9, sy: 0.45, sz: 0.45, mat: "wood" });
        boxes.push({ x: slot.x, y: 0.6, z: slot.z, sx: 0.7, sy: 0.3, sz: 0.35, mat: mats[i % mats.length] as Mat });
      }
    } else {
      // Summer: gold lanterns by the door.
      for (const off of [-1.4, 1.4]) {
        const px = doorPt.x + doorPt.nx * 1.5 + (alongX ? off : 0);
        const pz = doorPt.z + doorPt.nz * 1.5 + (alongX ? 0 : off);
        boxes.push({ x: px, y: 0.9, z: pz, sx: 0.16, sy: 1.2, sz: 0.16, mat: "trunk" });
        boxes.push({ x: px, y: 1.65, z: pz, sx: 0.55, sy: 0.55, sz: 0.55, mat: "gold" });
      }
    }
  }
  if (season === "winter") {
    // The plaza Christmas tree, by the fountain (0, 12).
    const tx = 5;
    const tz = 18;
    boxes.push({ x: tx, y: 1, z: tz, sx: 0.9, sy: 2, sz: 0.9, mat: "trunk" });
    boxes.push({ x: tx, y: 2.8, z: tz, sx: 3.4, sy: 1.6, sz: 3.4, mat: "leavesDark" });
    boxes.push({ x: tx, y: 4.1, z: tz, sx: 2.4, sy: 1.4, sz: 2.4, mat: "leaves" });
    boxes.push({ x: tx, y: 5.2, z: tz, sx: 1.4, sy: 1.2, sz: 1.4, mat: "leavesDark" });
    boxes.push({ x: tx, y: 6.1, z: tz, sx: 0.5, sy: 0.5, sz: 0.5, mat: "gold" });
    for (const [dx, dz] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]] as Array<[number, number]>) {
      boxes.push({ x: tx + dx, y: 3, z: tz + dz, sx: 0.35, sy: 0.35, sz: 0.35, mat: "warm" });
    }
  }
}

function makeScreen(home: HomeDef): TheaterScreen {
  const { x0, z0, w, d, door } = home;
  const spot = backPoint(door, x0, z0, w, d, 2.78);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 224;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    unitPlane,
    new MeshBasicMaterial({ map: texture, side: DoubleSide }),
  );
  // Scale is local (the plane's width is local X); rotation.y orients it,
  // exactly like the zone signs in runtime.ts mountSign.
  mesh.scale.set(6.4, 2.5, 1);
  mesh.position.set(spot.x, 2.3, spot.z);
  mesh.rotation.y = spot.rot;
  drawTheaterFrame(canvas, ctx, 0, "", false);
  return { homeId: home.id, canvas, ctx, texture, mesh };
}

/** One animated frame of the theater screen. `playing` = the show is on. */
export function drawTheaterFrame(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  frame: number,
  label: string,
  playing: boolean,
): void {
  const W = canvas.width;
  const H = canvas.height;
  if (!playing) {
    ctx.fillStyle = "#0b0e14";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f5c542";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ORBITX THEATER", W / 2, H / 2 - 8);
    ctx.fillStyle = "#8a93a6";
    ctx.font = "20px sans-serif";
    ctx.fillText("Press Watch to start the show", W / 2, H / 2 + 28);
    return;
  }
  // A living sky: the sun rides across, the palette warms and cools.
  const t = (frame % 120) / 120;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `hsl(${205 + Math.sin(t * Math.PI * 2) * 25}, 70%, ${42 + Math.sin(t * Math.PI * 2) * 10}%)`);
  grad.addColorStop(1, `hsl(${28 + Math.sin(t * Math.PI * 2) * 14}, 85%, 55%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const sunX = 40 + t * (W - 80);
  const sunY = 60 + Math.sin(t * Math.PI) * 50;
  ctx.fillStyle = "#ffd94d";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#101820";
  ctx.fillRect(0, H - 46, W, 46);
  // A tiny skyline walks past.
  ctx.fillStyle = "#0a0f16";
  for (let i = 0; i < 8; i++) {
    const bx = ((i * 70 + frame * 2) % (W + 70)) - 35;
    const bh = 24 + ((i * 37) % 40);
    ctx.fillRect(bx, H - 46 - bh, 44, bh);
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ORBITX CINEMA", W / 2, 44);
  if (label) {
    ctx.font = "20px sans-serif";
    ctx.fillStyle = "#ffd94d";
    ctx.fillText(`Now playing: ${label}`, W / 2, H - 14);
  }
}

// ---------------------------------------------------------------------------
// Build the whole CRAZY render for the current owned homes + season.
// ---------------------------------------------------------------------------

export function buildCrazyRender(
  owned: Array<{ home: HomeDef; extras: CrazyHomeExtras }>,
  allHomes: HomeDef[],
  season: CrazySeason,
  now: number = Date.now(),
): CrazyRender {
  const boxes: CrazyBox[] = [];
  const colliders: Collider[] = [];
  const pools: PoolRect[] = [];
  const screens = new Map<string, TheaterScreen>();
  const seats = new Map<string, Array<{ x: number; z: number }>>();
  const rooftops = new Map<string, { deckY: number; x: number; z: number; home: HomeDef }>();

  for (const { home, extras } of owned) {
    if (extras.pool) {
      pushPoolBoxes(boxes, home, extras.pool);
      pools.push(poolRectFor(home, extras.pool));
    }
    extras.plants.forEach((plant, index) => pushPlantBoxes(boxes, home, plant, index, now));
    if (extras.theater) {
      const seatSpots = pushTheaterBoxes(boxes, home);
      seats.set(home.id, seatSpots);
      // Seat colliders (players walk around the rows, not through them).
      for (const seat of seatSpots) colliders.push(col(seat.x, 0.5, seat.z, 2, 1, 1.2));
    }
    if (extras.rooftop) {
      pushRooftopBoxes(boxes, colliders, home);
      rooftops.set(home.id, { deckY: rooftopDeckYFor(home), x: home.x0 + home.w / 2, z: home.z0 + home.d / 2, home });
    }
    pushOwnedDecorBoxes(boxes, home, extras.decor);
  }

  pushSeasonBoxes(boxes, allHomes, season);

  const group = instancedFromBoxes(boxes);
  // Theater screens are individual canvas-textured planes, not instanced.
  for (const { home, extras } of owned) {
    if (!extras.theater) continue;
    const screen = makeScreen(home);
    screens.set(home.id, screen);
    group.add(screen.mesh);
  }
  return { group, colliders, pools, screens, seats, rooftops };
}
