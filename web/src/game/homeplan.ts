// ---------------------------------------------------------------------------
// OrbitX City — HOME PLAN: the 2D top-down geometry of a home.
// ---------------------------------------------------------------------------
// The Home Workshop edits a home on a 2D floor plan and the same data
// shows up in the 3D world — one source of truth (the placed-furniture
// list + crib decor/style saved through the existing server ops), so 2D
// and 3D can never drift apart. This module is pure geometry: no React,
// no three.js, no network. It answers three questions:
//   - Where is each room? (four quadrants of the interior, labelled by
//     the built-in anchor each contains — bed, fridge, dining table.)
//   - How big is each furniture piece on the plan? (footprints match the
//     3D pieceMesh extents in lifeview.ts, so a rect on the plan is the
//     piece you see in the world.)
//   - What is already built into the home? (the static furnishStateHome
//     layout — TV, sofa, kitchen, bed, dining, closet — drawn greyed on
//     the plan so the player never drags a piece into the bed.)
//
// Coordinates are WORLD coords throughout (the placed-furniture list
// stores world x/z). The plan maps world -> canvas by subtracting the
// home origin; the component owns the pixels.
// ---------------------------------------------------------------------------

import { bedSpot, fridgeSpot, tvSpot } from "./crib";
import type { HomeDef } from "./homes";

export type RoomId = "living" | "bedroom" | "kitchen" | "dining";

export const HOME_ROOM_IDS: RoomId[] = ["living", "bedroom", "kitchen", "dining"];

export const HOME_ROOM_LABELS: Record<RoomId, string> = {
  living: "Living room",
  bedroom: "Bedroom",
  kitchen: "Kitchen",
  dining: "Dining",
};

export interface RoomRect {
  id: RoomId;
  label: string;
  /** World coords of the room's near (min-x, min-z) corner. */
  x0: number;
  z0: number;
  w: number;
  d: number;
}

/** The interior inset — the plan (and the 3D floor) sit inside the shell. */
export const HOME_PLAN_INSET = 1.2;

/** Drag snap step, in world units. */
export const HOME_PLAN_SNAP = 0.5;

export function snapToGrid(v: number, step = HOME_PLAN_SNAP): number {
  return Math.round(v / step) * step;
}

/**
 * The four rooms of a home: the interior split into quadrants at the
 * centre lines. Each quadrant takes the label of the built-in anchor it
 * contains — the bed, the fridge, the dining table — and the remaining
 * quadrant is the living room. Deterministic per (w, d, door), so the
 * 2D plan and the 3D per-room rendering always agree.
 */
export function homeRoomLayout(home: HomeDef): RoomRect[] {
  const { x0, z0, w, d } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const ix0 = x0 + HOME_PLAN_INSET;
  const iz0 = z0 + HOME_PLAN_INSET;
  const iw = w - HOME_PLAN_INSET * 2;
  const id = d - HOME_PLAN_INSET * 2;
  const midX = ix0 + iw / 2;
  const midZ = iz0 + id / 2;
  // Quadrants of the interior: NW / NE / SW / SE.
  const quads = [
    { key: "nw", x0: ix0, z0: iz0, w: iw / 2, d: id / 2 },
    { key: "ne", x0: midX, z0: iz0, w: iw / 2, d: id / 2 },
    { key: "sw", x0: ix0, z0: midZ, w: iw / 2, d: id / 2 },
    { key: "se", x0: midX, z0: midZ, w: iw / 2, d: id / 2 },
  ];
  const quadFor = (x: number, z: number) => (x < cx ? (z < cz ? "nw" : "sw") : z < cz ? "ne" : "se");
  const bed = bedSpot(home);
  const fridge = fridgeSpot(home);
  const dining = { x: x0 + 3.5, z: z0 + 3.5 };
  // Priority order: bedroom, kitchen, dining, living. Each label takes
  // the quadrant its anchor sits in; if that quadrant is already taken
  // (small homes can crowd anchors together), it takes any free one.
  const anchors: { id: RoomId; x: number; z: number }[] = [
    { id: "bedroom", x: bed.x, z: bed.z },
    { id: "kitchen", x: fridge.x, z: fridge.z },
    { id: "dining", x: dining.x, z: dining.z },
    { id: "living", x: cx, z: cz },
  ];
  const taken = new Set<string>();
  const assigned = new Map<RoomId, (typeof quads)[number]>();
  for (const anchor of anchors) {
    const want = quadFor(anchor.x, anchor.z);
    let quad = !taken.has(want) ? quads.find((q) => q.key === want) : undefined;
    if (!quad) quad = quads.find((q) => !taken.has(q.key));
    if (!quad) break;
    taken.add(quad.key);
    assigned.set(anchor.id, quad);
  }
  return HOME_ROOM_IDS.map((id) => {
    const quad = assigned.get(id) ?? quads[0];
    return { id, label: HOME_ROOM_LABELS[id], x0: quad.x0, z0: quad.z0, w: quad.w, d: quad.d };
  });
}

/** Which room contains a world point (the room's rect, or null outside). */
export function roomAt(home: HomeDef, x: number, z: number): RoomId | null {
  for (const room of homeRoomLayout(home)) {
    if (x >= room.x0 && x < room.x0 + room.w && z >= room.z0 && z < room.z0 + room.d) return room.id;
  }
  return null;
}

/** The interior rectangle (world coords) a piece must stay inside. */
export function homeInteriorRect(home: HomeDef): { x0: number; z0: number; x1: number; z1: number } {
  return {
    x0: home.x0 + HOME_PLAN_INSET,
    z0: home.z0 + HOME_PLAN_INSET,
    x1: home.x0 + home.w - HOME_PLAN_INSET,
    z1: home.z0 + home.d - HOME_PLAN_INSET,
  };
}

// ---------------------------------------------------------------------------
// Furniture footprints — w x d in world units, matching the 3D pieceMesh
// extents in lifeview.ts (plus a small margin so pieces never touch on
// the plan). The 2D colour is the plan fill for the piece.
// ---------------------------------------------------------------------------

export interface FurnitureFootprint {
  w: number;
  d: number;
  color: string;
}

export const FURNITURE_FOOTPRINT: Record<string, FurnitureFootprint> = {
  tv: { w: 1.8, d: 0.6, color: "#7ef6ff" },
  couch: { w: 1.6, d: 0.9, color: "#c4493a" },
  bed: { w: 1.8, d: 2.4, color: "#f2f0e6" },
  "dining-table": { w: 2.0, d: 1.1, color: "#c9a36a" },
  chair: { w: 0.6, d: 0.6, color: "#c4493a" },
  lamp: { w: 0.5, d: 0.5, color: "#e0b33a" },
  rug: { w: 2.2, d: 1.4, color: "#8d4b2a" },
  shelf: { w: 1.3, d: 0.5, color: "#6b4a2a" },
  plant: { w: 0.7, d: 0.7, color: "#3c9a4a" },
  kitchen: { w: 2.4, d: 1.0, color: "#222222" },
  desk: { w: 1.7, d: 0.9, color: "#c9a36a" },
  armchair: { w: 1.0, d: 0.9, color: "#2a4b6b" },
  "coffee-table": { w: 1.3, d: 0.7, color: "#c9a36a" },
  "tv-stand": { w: 1.8, d: 0.6, color: "#6b4a2a" },
  bookshelf: { w: 1.3, d: 0.5, color: "#8a5a2e" },
  wardrobe: { w: 1.4, d: 0.7, color: "#6b4a2a" },
  nightstand: { w: 0.7, d: 0.7, color: "#2e2a26" },
  fireplace: { w: 1.7, d: 0.7, color: "#ff7a3c" },
  "pool-table": { w: 2.6, d: 1.5, color: "#1f6b3a" },
  "wall-art": { w: 1.7, d: 0.4, color: "#e0b33a" },
  "kitchen-island": { w: 2.2, d: 1.0, color: "#e8e4d8" },
  "floor-cushion": { w: 0.9, d: 0.9, color: "#ff5ad0" },
  "bar-stool": { w: 0.6, d: 0.6, color: "#16181f" },
  "console-table": { w: 1.6, d: 0.5, color: "#c9a36a" },
};

export function furnitureFootprint(item: string): FurnitureFootprint {
  return FURNITURE_FOOTPRINT[item] ?? { w: 1.2, d: 0.7, color: "#c9a36a" };
}

// ---------------------------------------------------------------------------
// Built-ins — the static furnishStateHome layout, for the plan background.
// Same anchors as homes.ts furnishStateHome, so the grey shapes on the
// plan sit exactly where the 3D furniture sits in the world. Not
// draggable, not saved — they are the house, not the decor.
// ---------------------------------------------------------------------------

export interface BuiltinPiece {
  kind: string;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export function homeBuiltins(home: HomeDef): BuiltinPiece[] {
  const { x0, z0, w, d, door } = home;
  const cx = x0 + w / 2;
  const cz = z0 + d / 2;
  const alongX = door === "n" || door === "s";
  const s = door === "s" || door === "e" ? 1 : -1;
  const tv = tvSpot(home);
  const bed = bedSpot(home);
  const fridge = fridgeSpot(home);
  const bedSE = door === "s" || door === "e";
  const backZ = door === "n" ? z0 + d - 1.38 : z0 + 1.38;
  const backX = door === "w" ? x0 + w - 1.38 : x0 + 1.38;
  const kx = alongX ? cx + 5 : backX;
  const kz = alongX ? backZ : cz + 5;
  const out: BuiltinPiece[] = [
    { kind: "tv", label: "TV", x: tv.x, z: tv.z, w: alongX ? 3.6 : 0.2, d: alongX ? 0.2 : 3.6 },
    {
      kind: "sofa",
      label: "Sofa",
      x: alongX ? cx : cx + s * 1.5,
      z: alongX ? cz + s * 1.5 : cz,
      w: alongX ? 3.4 : 1.1,
      d: alongX ? 1.1 : 3.4,
    },
    { kind: "rug", label: "Rug", x: cx, z: cz, w: alongX ? 5 : 3.6, d: alongX ? 3.6 : 5 },
    { kind: "kitchen", label: "Kitchen", x: kx, z: kz, w: alongX ? 4.6 : 1.1, d: alongX ? 1.1 : 4.6 },
    { kind: "fridge", label: "Fridge", x: alongX ? kx + 2.8 : kx, z: alongX ? kz : kz + 2.8, w: 0.9, d: 0.9 },
    { kind: "bed", label: "Bed", x: bed.x, z: bed.z, w: 2.4, d: 3.4 },
    { kind: "dining", label: "Dining", x: x0 + 3.5, z: z0 + 3.5, w: 1.8, d: 1.0 },
    {
      kind: "closet",
      label: "Closet",
      x: bedSE ? x0 + w - 1.25 : x0 + 1.25,
      z: bed.z - 3.4,
      w: 0.9,
      d: 1.6,
    },
  ];
  return out;
}
