// ---------------------------------------------------------------------------
// OrbitX City — HOME WORKSHOP: the dedicated 2D home-editing workspace.
// ---------------------------------------------------------------------------
// A full-screen workspace (not a small panel) where the player edits their
// home on a top-down 2D floor plan — drag furniture, rotate it, pick room
// finishes, restyle the outside, apply a theme — and the same data shows
// up in the 3D world when they save. One source of truth: the draft
// writes through the existing server ops (furniture-save, crib-decor,
// home-style, home-theme), so 2D and 3D can never drift apart.
//
// Phone-first: big touch targets, touch drag with snap-to-grid, the
// palette is a bottom sheet. The world is paused while the workshop is
// open (the runtime sets paused on open, clears it on close).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CRIB_FLOORS,
  CRIB_LIGHTS,
  CRIB_WALLS,
  HOME_EXTERIORS,
  HOME_ROOFS,
  HOME_THEMES,
  HOME_YARDS,
  type CribHomeState,
} from "./game/crib";
import type { HomeDef } from "./game/homes";
import {
  HOME_ROOM_IDS,
  HOME_ROOM_LABELS,
  findFreeSpot,
  furnitureFootprint,
  homeBuiltins,
  homeInteriorRect,
  homeRoomLayout,
  pieceCollides,
  roomAt,
  snapToGrid,
  type RoomId,
} from "./game/homeplan";
import { FURNITURE_CATALOG, furnitureName, type HomeFurniturePiece } from "./game/runtime";

export interface WorkshopDraft {
  furniture: HomeFurniturePiece[];
  decor: { wall: string; floor: string; light: string; rooms?: Record<string, { wall?: string; floor?: string }> };
  style: { exterior: string; roof: string; yard: string };
}

export interface WorkshopProps {
  home: HomeDef;
  crib: CribHomeState;
  furniture: HomeFurniturePiece[];
  furnitureOwned: string[];
  balance: number;
  onSave: (draft: WorkshopDraft) => Promise<{ ok: boolean; message: string; cost: number }>;
  onBuy: (itemId: string) => Promise<string>;
  onClose: () => void;
  /** Preview the CURRENT draft (saved or not) in the 3D world. */
  onView3D: (draft: WorkshopDraft) => void;
  triggerHaptic: (kind: "tap" | "success" | "error") => void;
}

/** Per-room finish price — mirrors api/city.js roomFinishPrice. */
export function workshopRoomPrice(wholePrice: number): number {
  return Math.max(25, Math.round(wholePrice / 2 / 5) * 5);
}

function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** Luminance-based text colour for a filled swatch (black or white). */
function textOn(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 > 0.6 ? "#101418" : "#ffffff";
}

/** Lighten (positive amt) or darken (negative) a #rrggbb colour. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const f = (c: number) => Math.round(c + (t - c) * p);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Rounded-rect path centred drawing helper (does not fill/stroke). */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Kinds drawn round — the caller skips the rect outline/shadow for them. */
const ROUND_KINDS = new Set(["lamp", "plant", "bar-stool"]);

/**
 * Draw one furniture piece top-down, centred on (0, 0) in a W x D pixel
 * box, already rotated by the caller. Simple readable shapes per kind —
 * a bed reads as a bed (pillows + blanket), a kitchen shows its hobs —
 * instead of the old flat colour rect. `color` is the footprint colour.
 */
function drawPlanPiece(ctx: CanvasRenderingContext2D, item: string, color: string, W: number, D: number) {
  const dark = shade(color, -0.28);
  const darker = shade(color, -0.48);
  const light = shade(color, 0.3);
  const x0 = -W / 2;
  const y0 = -D / 2;
  const base = () => {
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, W, D);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, style: string, lw = 1.5) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (item) {
    case "bed": {
      base();
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(x0, y0, W, Math.max(3, D * 0.07));
      ctx.fillStyle = "#5b7fa6";
      ctx.fillRect(x0, y0 + D * 0.34, W, D * 0.66);
      ctx.fillStyle = shade("#5b7fa6", -0.25);
      ctx.fillRect(x0, y0 + D * 0.34, W, Math.max(2, D * 0.05));
      ctx.fillStyle = "#ffffff";
      const pw = W * 0.38;
      const ph = D * 0.19;
      rr(ctx, x0 + W * 0.07, y0 + D * 0.11, pw, ph, 3);
      ctx.fill();
      rr(ctx, x0 + W * 0.55, y0 + D * 0.11, pw, ph, 3);
      ctx.fill();
      break;
    }
    case "couch":
    case "armchair": {
      base();
      ctx.fillStyle = dark;
      ctx.fillRect(x0, y0, W, D * 0.26);
      ctx.fillStyle = darker;
      ctx.fillRect(x0, y0, W * 0.13, D);
      ctx.fillRect(x0 + W * 0.87, y0, W * 0.13, D);
      line(x0 + W * 0.13, y0 + D * 0.26, x0 + W * 0.87, y0 + D * 0.26, darker);
      if (item === "couch") line(0, y0 + D * 0.26, 0, y0 + D, darker);
      break;
    }
    case "chair": {
      base();
      ctx.fillStyle = dark;
      ctx.fillRect(x0, y0, W, D * 0.3);
      break;
    }
    case "dining-table": {
      ctx.fillStyle = "#c4493a";
      const nw = W * 0.17;
      const nh = D * 0.24;
      for (const sx of [-0.25, 0.25]) {
        ctx.fillRect(sx * W - nw / 2, y0 - nh / 2, nw, nh);
        ctx.fillRect(sx * W - nw / 2, y0 + D - nh / 2, nw, nh);
      }
      base();
      ctx.strokeStyle = light;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + W * 0.14, y0 + D * 0.16, W * 0.72, D * 0.68);
      break;
    }
    case "coffee-table": {
      base();
      ctx.fillStyle = "rgba(190,227,239,0.75)";
      ctx.fillRect(x0 + W * 0.16, y0 + D * 0.18, W * 0.68, D * 0.64);
      break;
    }
    case "desk": {
      base();
      ctx.fillStyle = dark;
      ctx.fillRect(x0 + W * 0.66, y0, W * 0.34, D);
      line(x0 + W * 0.72, 0, x0 + W * 0.94, 0, darker, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x0 + W * 0.1, y0 + D * 0.22, W * 0.32, D * 0.42);
      break;
    }
    case "tv": {
      ctx.fillStyle = "#14161c";
      ctx.fillRect(x0, y0, W, D);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + W * 0.07, y0 + D * 0.14, W * 0.86, D * 0.62);
      ctx.fillStyle = shade(color, 0.45);
      ctx.fillRect(x0 + W * 0.12, y0 + D * 0.2, W * 0.3, D * 0.2);
      ctx.fillStyle = "#3a3f46";
      ctx.fillRect(x0 + W * 0.4, y0 + D * 0.84, W * 0.2, Math.max(2, D * 0.1));
      break;
    }
    case "tv-stand": {
      base();
      line(x0 + W / 3, y0, x0 + W / 3, y0 + D, darker);
      line(x0 + (2 * W) / 3, y0, x0 + (2 * W) / 3, y0 + D, darker);
      ctx.fillStyle = darker;
      for (const fx of [1 / 6, 1 / 2, 5 / 6]) {
        ctx.beginPath();
        ctx.arc(x0 + W * fx, 0, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "bookshelf":
    case "shelf": {
      base();
      const rows = item === "bookshelf" ? 3 : 2;
      for (let i = 1; i < rows; i++) line(x0, y0 + (D * i) / rows, x0 + W, y0 + (D * i) / rows, darker, 2);
      const bookColors = ["#c4493a", "#2a4b6b", "#e0b33a", "#3c9a4a", "#8d4b2a"];
      const rowH = D / rows;
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = bookColors[i % bookColors.length];
        const bw = W * 0.09;
        ctx.fillRect(x0 + W * 0.08 + i * W * 0.15, y0 + rowH * 0.18, bw, rowH * 0.64);
      }
      break;
    }
    case "kitchen":
    case "kitchen-island": {
      base();
      ctx.strokeStyle = darker;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 2, y0 + 2, W - 4, D - 4);
      const hr = Math.min(W, D) * 0.13;
      for (const [hx, hy] of [
        [x0 + W * 0.18, y0 + D * 0.3],
        [x0 + W * 0.4, y0 + D * 0.3],
        [x0 + W * 0.18, y0 + D * 0.72],
        [x0 + W * 0.4, y0 + D * 0.72],
      ] as const) {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.arc(hx, hy, hr * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#8fa8bd";
      ctx.fillRect(x0 + W * 0.6, y0 + D * 0.18, W * 0.32, D * 0.64);
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + W * 0.6, y0 + D * 0.18, W * 0.32, D * 0.64);
      break;
    }
    case "wardrobe": {
      base();
      line(0, y0, 0, y0 + D, darker, 2);
      line(-W * 0.07, -D * 0.14, -W * 0.07, D * 0.14, darker, 2.5);
      line(W * 0.07, -D * 0.14, W * 0.07, D * 0.14, darker, 2.5);
      break;
    }
    case "nightstand": {
      base();
      line(x0, y0 + D * 0.32, x0 + W, y0 + D * 0.32, darker, 2);
      ctx.fillStyle = darker;
      ctx.beginPath();
      ctx.arc(0, y0 + D * 0.16, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "fireplace": {
      base();
      ctx.fillStyle = "#b8b0a4";
      ctx.fillRect(x0, y0 + D * 0.68, W, D * 0.32);
      ctx.fillStyle = "#241a14";
      ctx.fillRect(x0 + W * 0.24, y0 + D * 0.2, W * 0.52, D * 0.52);
      ctx.fillStyle = "#ffb347";
      ctx.beginPath();
      ctx.moveTo(0, y0 + D * 0.3);
      ctx.lineTo(x0 + W * 0.58, y0 + D * 0.66);
      ctx.lineTo(x0 + W * 0.42, y0 + D * 0.66);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "pool-table": {
      ctx.fillStyle = "#6b4a2a";
      ctx.fillRect(x0, y0, W, D);
      ctx.fillStyle = color;
      ctx.fillRect(x0 + W * 0.06, y0 + D * 0.09, W * 0.88, D * 0.82);
      ctx.fillStyle = "#0c0e12";
      const pr = Math.max(2.5, W * 0.032);
      for (const [px, py] of [
        [x0 + W * 0.07, y0 + D * 0.1],
        [x0 + W * 0.93, y0 + D * 0.1],
        [x0 + W * 0.07, y0 + D * 0.9],
        [x0 + W * 0.93, y0 + D * 0.9],
        [0, y0 + D * 0.06],
        [0, y0 + D * 0.94],
      ] as const) {
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "bar-stool": {
      const r = Math.min(W, D) / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "floor-cushion": {
      rr(ctx, x0, y0, W, D, 7);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      rr(ctx, x0 + W * 0.16, y0 + D * 0.16, W * 0.68, D * 0.68, 5);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "lamp": {
      const R = Math.max(W, D) * 0.95;
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, R);
      grad.addColorStop(0, "rgba(255,214,100,0.5)");
      grad.addColorStop(1, "rgba(255,214,100,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(W, D) * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, Math.min(W, D) * 0.26, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "plant": {
      const R = Math.min(W, D);
      const leaf = (lx: number, ly: number, lr: number, c: string) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fill();
      };
      leaf(-R * 0.22, -R * 0.16, R * 0.3, color);
      leaf(R * 0.24, -R * 0.14, R * 0.27, light);
      leaf(-R * 0.18, R * 0.22, R * 0.26, light);
      leaf(R * 0.2, R * 0.2, R * 0.3, color);
      leaf(0, 0, R * 0.24, shade(color, 0.12));
      ctx.fillStyle = "#b56545";
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "wall-art": {
      base();
      ctx.fillStyle = "#bfe3ef";
      ctx.fillRect(x0 + W * 0.1, y0 + D * 0.16, W * 0.8, D * 0.68);
      ctx.fillStyle = "#e0b33a";
      ctx.beginPath();
      ctx.arc(x0 + W * 0.68, y0 + D * 0.38, Math.min(W, D) * 0.13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#3c7a4a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0 + W * 0.1, y0 + D * 0.84);
      ctx.lineTo(x0 + W * 0.42, y0 + D * 0.5);
      ctx.lineTo(x0 + W * 0.62, y0 + D * 0.72);
      ctx.lineTo(x0 + W * 0.9, y0 + D * 0.84);
      ctx.stroke();
      break;
    }
    case "console-table": {
      base();
      line(x0, 0, x0 + W, 0, dark, 2);
      line(x0 + W * 0.06, y0, x0 + W * 0.06, y0 + D, darker, 2.5);
      line(x0 + W * 0.94, y0, x0 + W * 0.94, y0 + D, darker, 2.5);
      break;
    }
    case "rug": {
      base();
      ctx.strokeStyle = light;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 4, y0 + 4, W - 8, D - 8);
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 9, y0 + 9, W - 18, D - 18);
      ctx.strokeStyle = light;
      ctx.strokeRect(-W * 0.16, -D * 0.18, W * 0.32, D * 0.36);
      break;
    }
    default: {
      base();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + W * 0.12, y0 + D * 0.14, W * 0.76, D * 0.72);
      break;
    }
  }
}

export interface WorkshopSavePlan {
  furnitureChanged: boolean;
  /** Set when the whole draft equals a one-tap theme (cheaper than parts). */
  themeKey: string | null;
  decorPatch: { wall?: string; floor?: string; light?: string; rooms?: Record<string, { wall?: string; floor?: string }> };
  stylePatch: { exterior?: string; roof?: string; yard?: string };
  cost: number;
}

function draftMatchesTheme(draft: WorkshopDraft, themeKey: string): boolean {
  const theme = HOME_THEMES[themeKey];
  if (!theme) return false;
  if (draft.decor.rooms && Object.keys(draft.decor.rooms).length) return false;
  return (
    draft.decor.wall === theme.wall &&
    draft.decor.floor === theme.floor &&
    draft.decor.light === theme.light &&
    draft.style.exterior === theme.exterior &&
    draft.style.roof === theme.roof &&
    draft.style.yard === theme.yard
  );
}

/**
 * What saving a draft costs and which ops it needs, from the CURRENT
 * saved state. The App save handler executes this plan; the component
 * uses it for the live "Save — X City Sol" preview. One function, so
 * the preview and the real charge can never disagree.
 */
export function workshopSavePlan(
  current: { decor: CribHomeState["decor"]; style: CribHomeState["style"]; furniture: HomeFurniturePiece[] },
  draft: WorkshopDraft,
): WorkshopSavePlan {
  const furnitureChanged = JSON.stringify(current.furniture) !== JSON.stringify(draft.furniture);
  const themeKey = Object.keys(HOME_THEMES).find((key) => draftMatchesTheme(draft, key)) ?? null;
  const currentTheme = themeKey && draftMatchesTheme(
    { furniture: current.furniture, decor: current.decor, style: current.style },
    themeKey,
  );
  const decorPatch: WorkshopSavePlan["decorPatch"] = {};
  const stylePatch: WorkshopSavePlan["stylePatch"] = {};
  let cost = 0;
  if (themeKey && !currentTheme) {
    cost += HOME_THEMES[themeKey].price;
  } else {
    if (draft.decor.wall !== current.decor.wall) {
      decorPatch.wall = draft.decor.wall;
      cost += CRIB_WALLS[draft.decor.wall]?.price ?? 0;
    }
    if (draft.decor.floor !== current.decor.floor) {
      decorPatch.floor = draft.decor.floor;
      cost += CRIB_FLOORS[draft.decor.floor]?.price ?? 0;
    }
    if (draft.decor.light !== current.decor.light) {
      decorPatch.light = draft.decor.light;
      cost += CRIB_LIGHTS[draft.decor.light]?.price ?? 0;
    }
    // Rooms: every room in either the draft or the saved state. A room
    // the draft drops is reset to the draft's whole-home finish.
    const roomIds = new Set([...Object.keys(draft.decor.rooms ?? {}), ...Object.keys(current.decor.rooms ?? {})]);
    const roomsPatch: Record<string, { wall?: string; floor?: string }> = {};
    for (const roomId of roomIds) {
      const draftRoom = draft.decor.rooms?.[roomId];
      const currentRoom = current.decor.rooms?.[roomId];
      const draftWall = draftRoom?.wall ?? draft.decor.wall;
      const draftFloor = draftRoom?.floor ?? draft.decor.floor;
      const currentWall = currentRoom?.wall ?? current.decor.wall;
      const currentFloor = currentRoom?.floor ?? current.decor.floor;
      if (draftWall !== currentWall) {
        roomsPatch[roomId] = { ...(roomsPatch[roomId] ?? {}), wall: draftWall };
        cost += workshopRoomPrice(CRIB_WALLS[draftWall]?.price ?? 0);
      }
      if (draftFloor !== currentFloor) {
        roomsPatch[roomId] = { ...(roomsPatch[roomId] ?? {}), floor: draftFloor };
        cost += workshopRoomPrice(CRIB_FLOORS[draftFloor]?.price ?? 0);
      }
    }
    if (Object.keys(roomsPatch).length) decorPatch.rooms = roomsPatch;
    if (draft.style.exterior !== current.style.exterior) {
      stylePatch.exterior = draft.style.exterior;
      cost += HOME_EXTERIORS[draft.style.exterior]?.price ?? 0;
    }
    if (draft.style.roof !== current.style.roof) {
      stylePatch.roof = draft.style.roof;
      cost += HOME_ROOFS[draft.style.roof]?.price ?? 0;
    }
    if (draft.style.yard !== current.style.yard) {
      stylePatch.yard = draft.style.yard;
      cost += HOME_YARDS[draft.style.yard]?.price ?? 0;
    }
  }
  return { furnitureChanged, themeKey: themeKey && !currentTheme ? themeKey : null, decorPatch, stylePatch, cost };
}

type PaletteTab = "furniture" | "rooms" | "outside" | "themes";

export default function HomeWorkshop(props: WorkshopProps) {
  const { home, crib, furnitureOwned, balance } = props;
  const [draft, setDraft] = useState<WorkshopDraft>(() => ({
    furniture: props.furniture.map((p) => ({ ...p })),
    decor: {
      wall: crib.decor.wall,
      floor: crib.decor.floor,
      light: crib.decor.light,
      ...(crib.decor.rooms ? { rooms: JSON.parse(JSON.stringify(crib.decor.rooms)) } : {}),
    },
    style: { ...crib.style },
  }));
  // The last saved state — the baseline for dirty + cost. Starts at the
  // props; after a successful save it becomes the saved draft.
  const [saved, setSaved] = useState(() => ({
    decor: {
      wall: crib.decor.wall,
      floor: crib.decor.floor,
      light: crib.decor.light,
      ...(crib.decor.rooms ? { rooms: JSON.parse(JSON.stringify(crib.decor.rooms)) } : {}),
    },
    style: { ...crib.style },
    furniture: props.furniture.map((p) => ({ ...p })),
  }));
  const [tab, setTab] = useState<PaletteTab>("furniture");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<RoomId>("living");
  const [zoom, setZoom] = useState(1);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Active piece drag: where it started (for collision revert + undo)
  // and whether the driving pointer is a finger (finger-lift drawing).
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    offX: number;
    offZ: number;
    startX: number;
    startZ: number;
    startFurniture: HomeFurniturePiece[];
    touch: boolean;
  } | null>(null);
  // What the draw effect needs to know about the live drag: which piece,
  // whether its current spot collides (validity glow), touch or mouse.
  const [dragging, setDragging] = useState<{ id: string; bad: boolean; touch: boolean } | null>(null);
  const dragBadRef = useRef(false);
  // Plan pan (pixels) — drag empty space to pan, pinch to zoom around
  // the pinch midpoint. Applied by BOTH the draw effect and toWorld.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ worldX: number; worldZ: number; dist: number; zoom: number } | null>(null);
  const panDragRef = useRef<{ pointerId: number; sx: number; sy: number; panX: number; panY: number; moved: boolean } | null>(null);
  const lastTapRef = useRef<{ id: string; t: number } | null>(null);
  // Undo: snapshots of the furniture list BEFORE each change (cap 50).
  // Furniture only — decor/style changes are not undoable here.
  const historyRef = useRef<HomeFurniturePiece[][]>([]);
  const [historyLen, setHistoryLen] = useState(0);
  const [size, setSize] = useState({ w: 360, h: 360 });

  const plan = useMemo(() => workshopSavePlan(saved, draft), [saved, draft]);
  const dirty = plan.furnitureChanged || plan.cost > 0 || Object.keys(plan.decorPatch).length > 0 || Object.keys(plan.stylePatch).length > 0 || !!plan.themeKey;
  const rooms = useMemo(() => homeRoomLayout(home), [home]);
  const builtins = useMemo(() => homeBuiltins(home), [home]);
  const placedAll = draft.furniture;
  const ownedCount = (item: string) => furnitureOwned.filter((id) => id === item).length;
  const placedCount = (item: string) => placedAll.filter((p) => p.item === item).length;
  const selected = selectedId ? draft.furniture.find((p) => p.id === selectedId) ?? null : null;

  // --- 2D plan drawing -------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = size.w;
    const ch = size.h;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const scale = Math.min((cw - 40) / home.w, (ch - 40) / home.d) * zoom;
    const ox = (cw - home.w * scale) / 2 + pan.x;
    const oy = (ch - home.d * scale) / 2 + pan.y;
    const X = (wx: number) => ox + (wx - home.x0) * scale;
    const Z = (wz: number) => oy + (wz - home.z0) * scale;

    // Floor base.
    ctx.fillStyle = cssColor(CRIB_FLOORS[draft.decor.floor]?.color ?? 0x8a5a2e);
    ctx.fillRect(X(home.x0), Z(home.z0), home.w * scale, home.d * scale);
    // Room fills + labels (room floor overrides the whole-home floor).
    for (const room of rooms) {
      const finish = draft.decor.rooms?.[room.id];
      const floorKey = finish?.floor ?? draft.decor.floor;
      const fill = cssColor(CRIB_FLOORS[floorKey]?.color ?? 0x8a5a2e);
      ctx.fillStyle = fill;
      ctx.fillRect(X(room.x0), Z(room.z0), room.w * scale, room.d * scale);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(X(room.x0) + 0.5, Z(room.z0) + 0.5, room.w * scale - 1, room.d * scale - 1);
      const label = HOME_ROOM_LABELS[room.id];
      ctx.font = `700 ${Math.max(11, Math.min(15, scale * 0.9))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = textOn(fill);
      ctx.globalAlpha = 0.85;
      ctx.fillText(label, X(room.x0 + room.w / 2), Z(room.z0) + 18);
      ctx.globalAlpha = 1;
      if (selectedRoom === room.id && tab === "rooms") {
        ctx.strokeStyle = "#e0b33a";
        ctx.lineWidth = 3;
        ctx.strokeRect(X(room.x0) + 1.5, Z(room.z0) + 1.5, room.w * scale - 3, room.d * scale - 3);
      }
    }
    // Grid, 1 unit.
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx < home.w; gx++) {
      ctx.moveTo(X(home.x0 + gx), Z(home.z0));
      ctx.lineTo(X(home.x0 + gx), Z(home.z0 + home.d));
    }
    for (let gz = 1; gz < home.d; gz++) {
      ctx.moveTo(X(home.x0), Z(home.z0 + gz));
      ctx.lineTo(X(home.x0 + home.w), Z(home.z0 + gz));
    }
    ctx.stroke();
    // Built-ins (greyed — the house, not the decor).
    for (const b of builtins) {
      ctx.fillStyle = "rgba(120,120,130,0.55)";
      ctx.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * scale, b.d * scale);
      ctx.strokeStyle = "rgba(60,60,70,0.8)";
      ctx.lineWidth = 1;
      ctx.strokeRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * scale, b.d * scale);
      if (b.w * scale > 34) {
        ctx.font = `600 ${Math.max(9, Math.min(11, scale * 0.7))}px system-ui, sans-serif`;
        ctx.fillStyle = "#3a3f46";
        ctx.textAlign = "center";
        ctx.fillText(b.label, X(b.x), Z(b.z) + 3);
      }
    }
    // Placed furniture — rugs first (under everything, no shadow),
    // then the rest in placement order, each drawn as itself.
    const ordered = [
      ...draft.furniture.filter((p) => p.item === "rug"),
      ...draft.furniture.filter((p) => p.item !== "rug"),
    ];
    for (const piece of ordered) {
      const fp = furnitureFootprint(piece.item);
      const px = X(piece.x);
      const pz = Z(piece.z);
      const W = fp.w * scale;
      const D = fp.d * scale;
      const isDrag = dragging?.id === piece.id;
      // Finger-lift: a touch-dragged piece is drawn ~26px above its
      // true spot so the player's finger never hides it; a shadow +
      // target dot mark the true position.
      const lifted = !!isDrag && dragging.touch;
      if (lifted && dragging) {
        const mark = dragging.bad ? "#ff4747" : "#2fe07a";
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(px, pz, W / 2, D / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = mark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, pz, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = mark;
        ctx.beginPath();
        ctx.arc(px, pz, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(px, lifted ? pz - 26 : pz);
      ctx.rotate(-piece.rot);
      // Soft drop shadow (rugs lie flat; a lifted piece's shadow is the
      // ellipse at its true position, drawn above).
      if (piece.item !== "rug" && !lifted) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        if (ROUND_KINDS.has(piece.item)) {
          ctx.beginPath();
          ctx.ellipse(3, 4, W / 2, D / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-W / 2 + 3, -D / 2 + 4, W, D);
        }
      }
      drawPlanPiece(ctx, piece.item, fp.color, W, D);
      if (!ROUND_KINDS.has(piece.item)) {
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(-W / 2, -D / 2, W, D);
      }
      // State outlines: drag validity wins, then selection.
      if (isDrag && dragging) {
        if (dragging.bad) {
          ctx.fillStyle = "rgba(255,60,60,0.35)";
          if (ROUND_KINDS.has(piece.item)) {
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(W, D) / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-W / 2, -D / 2, W, D);
          }
          ctx.strokeStyle = "#ff4747";
        } else {
          ctx.strokeStyle = "#2fe07a";
        }
        ctx.lineWidth = 3;
        if (ROUND_KINDS.has(piece.item)) {
          ctx.beginPath();
          ctx.arc(0, 0, Math.min(W, D) / 2, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(-W / 2, -D / 2, W, D);
        }
      } else if (piece.id === selectedId) {
        ctx.strokeStyle = "#e0b33a";
        ctx.lineWidth = 3;
        if (ROUND_KINDS.has(piece.item)) {
          ctx.beginPath();
          ctx.arc(0, 0, Math.min(W, D) / 2, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(-W / 2, -D / 2, W, D);
          ctx.fillStyle = "#e0b33a";
          for (const [cx, cy] of [
            [-W / 2, -D / 2],
            [W / 2, -D / 2],
            [-W / 2, D / 2],
            [W / 2, D / 2],
          ] as const) {
            ctx.beginPath();
            ctx.arc(cx, cy, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      const name = furnitureName(piece.item);
      if (W >= 28) {
        ctx.font = `700 ${Math.max(9, Math.min(12, scale * 0.75))}px system-ui, sans-serif`;
        ctx.fillStyle = textOn(fp.color);
        ctx.textAlign = "center";
        ctx.fillText(name.length > 12 ? name.slice(0, 11) + "…" : name, 0, 3);
      }
      ctx.restore();
    }
    // Walls (thick) with a door gap on the door wall.
    const doorGap = 2.6;
    const doorC = home.door === "n" || home.door === "s" ? home.x0 + home.w / 2 : home.z0 + home.d / 2;
    ctx.strokeStyle = "#101418";
    ctx.lineWidth = Math.max(4, scale * 0.35);
    ctx.lineCap = "square";
    const wall = (x1: number, z1: number, x2: number, z2: number) => {
      ctx.beginPath();
      ctx.moveTo(X(x1), Z(z1));
      ctx.lineTo(X(x2), Z(z2));
      ctx.stroke();
    };
    if (home.door === "n") {
      wall(home.x0, home.z0, doorC - doorGap / 2, home.z0);
      wall(doorC + doorGap / 2, home.z0, home.x0 + home.w, home.z0);
    } else wall(home.x0, home.z0, home.x0 + home.w, home.z0);
    if (home.door === "s") {
      wall(home.x0, home.z0 + home.d, doorC - doorGap / 2, home.z0 + home.d);
      wall(doorC + doorGap / 2, home.z0 + home.d, home.x0 + home.w, home.z0 + home.d);
    } else wall(home.x0, home.z0 + home.d, home.x0 + home.w, home.z0 + home.d);
    if (home.door === "w") {
      wall(home.x0, home.z0, home.x0, doorC - doorGap / 2);
      wall(home.x0, doorC + doorGap / 2, home.x0, home.z0 + home.d);
    } else wall(home.x0, home.z0, home.x0, home.z0 + home.d);
    if (home.door === "e") {
      wall(home.x0 + home.w, home.z0, home.x0 + home.w, doorC - doorGap / 2);
      wall(home.x0 + home.w, doorC + doorGap / 2, home.x0 + home.w, home.z0 + home.d);
    } else wall(home.x0 + home.w, home.z0, home.x0 + home.w, home.z0 + home.d);
    // Door label.
    ctx.font = `700 ${Math.max(10, Math.min(13, scale * 0.8))}px system-ui, sans-serif`;
    ctx.fillStyle = "#101418";
    ctx.textAlign = "center";
    const doorLabel = "DOOR";
    if (home.door === "n") ctx.fillText(doorLabel, X(doorC), Z(home.z0) + 16);
    else if (home.door === "s") ctx.fillText(doorLabel, X(doorC), Z(home.z0 + home.d) - 8);
    else if (home.door === "w") ctx.fillText(doorLabel, X(home.x0) + 24, Z(doorC));
    else ctx.fillText(doorLabel, X(home.x0 + home.w) - 24, Z(doorC));
  }, [draft, rooms, builtins, home, selectedId, selectedRoom, tab, zoom, size, pan, dragging]);

  // --- Pointer input: drag pieces, pan the plan, pinch to zoom --------
  const planScale = (cw: number, ch: number) => Math.min((cw - 40) / home.w, (ch - 40) / home.d) * zoom;

  const toWorldCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = planScale(rect.width, rect.height);
    const ox = (rect.width - home.w * scale) / 2 + pan.x;
    const oy = (rect.height - home.d * scale) / 2 + pan.y;
    return { x: home.x0 + (clientX - rect.left - ox) / scale, z: home.z0 + (clientY - rect.top - oy) / scale };
  };

  const toWorld = (e: React.PointerEvent) => toWorldCoords(e.clientX, e.clientY);

  /** Keep at least ~60px of the plan on screen — it can never be lost. */
  const clampPan = (p: { x: number; y: number }, scale: number) => {
    const ox = (size.w - home.w * scale) / 2;
    const oy = (size.h - home.d * scale) / 2;
    const keep = 60;
    return {
      x: Math.min(size.w - keep - ox, Math.max(keep - ox - home.w * scale, p.x)),
      y: Math.min(size.h - keep - oy, Math.max(keep - oy - home.d * scale, p.y)),
    };
  };

  const pushHistory = (furniture: HomeFurniturePiece[]) => {
    historyRef.current = [...historyRef.current.slice(-49), furniture.map((p) => ({ ...p }))];
    setHistoryLen(historyRef.current.length);
  };

  const clearHistory = () => {
    historyRef.current = [];
    setHistoryLen(0);
  };

  const setDragBad = (bad: boolean) => {
    if (dragBadRef.current === bad) return;
    dragBadRef.current = bad;
    setDragging((d) => (d ? { ...d, bad } : d));
  };

  /**
   * Settle the active piece drag: a colliding drop returns the piece to
   * where the drag started (with the message + error haptic); a clean
   * drop that moved the piece pushes the pre-drag list onto the undo
   * stack.
   */
  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(null);
    const piece = draft.furniture.find((p) => p.id === drag.id);
    if (piece && dragBadRef.current) {
      setDraft((prev) => ({
        ...prev,
        furniture: prev.furniture.map((p) => (p.id === drag.id ? { ...p, x: drag.startX, z: drag.startZ } : p)),
      }));
      setMsg("That spot is taken — find a clear space.");
      props.triggerHaptic("error");
    } else if (piece && (piece.x !== drag.startX || piece.z !== drag.startZ)) {
      pushHistory(drag.startFurniture);
      props.triggerHaptic("tap");
    }
    dragBadRef.current = false;
  };

  const hitPiece = (wx: number, wz: number) => {
    for (let i = draft.furniture.length - 1; i >= 0; i--) {
      const piece = draft.furniture[i];
      const fp = furnitureFootprint(piece.item);
      const dx = wx - piece.x;
      const dz = wz - piece.z;
      const cos = Math.cos(piece.rot);
      const sin = Math.sin(piece.rot);
      // Inverse of the canvas draw rotation: local = R(+rot) * (d).
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) <= fp.w / 2 + 0.25 && Math.abs(lz) <= fp.d / 2 + 0.25) return piece;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      // Second finger down — pinch takes over. Settle any piece drag
      // first, and anchor the pinch on the world point under the
      // midpoint so the plan zooms around the player's fingers.
      finishDrag();
      panDragRef.current = null;
      const pts = [...pointersRef.current.values()];
      const mid = toWorldCoords((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      if (mid) {
        pinchRef.current = {
          worldX: mid.x,
          worldZ: mid.z,
          dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          zoom,
        };
      }
      return;
    }
    if (pointersRef.current.size > 2) return;
    const w = toWorld(e);
    if (!w) return;
    const piece = hitPiece(w.x, w.z);
    if (piece) {
      e.preventDefault();
      // Double-tap on a piece rotates it (collision-checked).
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && last.id === piece.id && now - last.t < 300) {
        lastTapRef.current = null;
        rotatePieceById(piece.id);
      } else {
        lastTapRef.current = { id: piece.id, t: now };
      }
      dragRef.current = {
        id: piece.id,
        pointerId: e.pointerId,
        offX: w.x - piece.x,
        offZ: w.z - piece.z,
        startX: piece.x,
        startZ: piece.z,
        startFurniture: draft.furniture.map((p) => ({ ...p })),
        touch: e.pointerType === "touch",
      };
      dragBadRef.current = false;
      setDragging({ id: piece.id, bad: false, touch: e.pointerType === "touch" });
      setSelectedId(piece.id);
      props.triggerHaptic("tap");
      return;
    }
    // Empty space: a drag pans the plan; a short tap (<6px) keeps the
    // old behaviour — select the room / clear the selection (on up).
    panDragRef.current = {
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const pinch = pinchRef.current;
    if (pinch && pointersRef.current.size >= 2) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const pts = [...pointersRef.current.values()];
      const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const nextZoom = Math.min(3, Math.max(0.6, pinch.zoom * (dist / pinch.dist)));
      const scale = Math.min((rect.width - 40) / home.w, (rect.height - 40) / home.d) * nextZoom;
      const ox = (rect.width - home.w * scale) / 2;
      const oy = (rect.height - home.d * scale) / 2;
      setZoom(nextZoom);
      setPan(
        clampPan(
          {
            x: midX - rect.left - ox - (pinch.worldX - home.x0) * scale,
            y: midY - rect.top - oy - (pinch.worldZ - home.z0) * scale,
          },
          scale,
        ),
      );
      return;
    }
    const drag = dragRef.current;
    if (drag && e.pointerId === drag.pointerId) {
      const w = toWorld(e);
      if (!w) return;
      const piece = draft.furniture.find((p) => p.id === drag.id);
      if (!piece) return;
      const fp = furnitureFootprint(piece.item);
      const cos = Math.abs(Math.cos(piece.rot));
      const sin = Math.abs(Math.sin(piece.rot));
      const hw = (cos * fp.w + sin * fp.d) / 2;
      const hd = (sin * fp.w + cos * fp.d) / 2;
      const interior = homeInteriorRect(home);
      const nx = Math.min(interior.x1 - hw, Math.max(interior.x0 + hw, snapToGrid(w.x - drag.offX)));
      const nz = Math.min(interior.z1 - hd, Math.max(interior.z0 + hd, snapToGrid(w.z - drag.offZ)));
      // Live validity: green outline while the spot is free, red when
      // it collides (dropping there reverts — see finishDrag).
      setDragBad(
        pieceCollides(home, { ...piece, x: nx, z: nz }, draft.furniture.filter((p) => p.id !== drag.id)),
      );
      if (nx === piece.x && nz === piece.z) return;
      setDraft((prev) => ({
        ...prev,
        furniture: prev.furniture.map((p) => (p.id === drag.id ? { ...p, x: nx, z: nz } : p)),
      }));
      return;
    }
    const panDrag = panDragRef.current;
    if (panDrag && e.pointerId === panDrag.pointerId) {
      const dx = e.clientX - panDrag.sx;
      const dy = e.clientY - panDrag.sy;
      if (!panDrag.moved && Math.hypot(dx, dy) > 6) panDrag.moved = true;
      if (panDrag.moved) {
        setPan(clampPan({ x: panDrag.panX + dx, y: panDrag.panY + dy }, planScale(size.w, size.h)));
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) pinchRef.current = null;
      return;
    }
    const drag = dragRef.current;
    if (drag && e.pointerId === drag.pointerId) {
      finishDrag();
      return;
    }
    const panDrag = panDragRef.current;
    if (panDrag && e.pointerId === panDrag.pointerId) {
      panDragRef.current = null;
      if (!panDrag.moved) {
        // Short tap on empty space — the pre-pan behaviour.
        const w = toWorld(e);
        if (!w) return;
        const roomId = roomAt(home, w.x, w.z);
        if (roomId) {
          setSelectedRoom(roomId);
          setSelectedId(null);
          setTab("rooms");
        } else {
          setSelectedId(null);
        }
      }
    }
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (dragRef.current && e.pointerId === dragRef.current.pointerId) finishDrag();
    if (panDragRef.current && e.pointerId === panDragRef.current.pointerId) panDragRef.current = null;
  };

  // --- Draft actions -----------------------------------------------------
  const newPieceId = () => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

  const placeItem = (itemId: string) => {
    if (placedCount(itemId) >= ownedCount(itemId)) return;
    const interior = homeInteriorRect(home);
    // Smart spawn: the first clear spot, scanning outward from the
    // centre — never on top of the bed or another piece. A packed home
    // falls back to the old centre spawn.
    const spot = findFreeSpot(home, itemId, draft.furniture) ?? {
      x: snapToGrid((interior.x0 + interior.x1) / 2),
      z: snapToGrid((interior.z0 + interior.z1) / 2),
    };
    const id = newPieceId();
    const piece: HomeFurniturePiece = { id, item: itemId, x: spot.x, z: spot.z, rot: 0 };
    pushHistory(draft.furniture);
    setDraft((prev) => ({ ...prev, furniture: [...prev.furniture, piece] }));
    setSelectedId(id);
    props.triggerHaptic("tap");
  };

  /** Rotate one piece 45°, refused (error haptic) if it would collide. */
  const rotatePieceById = (id: string) => {
    const piece = draft.furniture.find((p) => p.id === id);
    if (!piece) return;
    const candidate = { ...piece, rot: (piece.rot + Math.PI / 4) % (Math.PI * 2) };
    if (pieceCollides(home, candidate, draft.furniture.filter((p) => p.id !== id))) {
      setMsg("No room to rotate it there — move it first.");
      props.triggerHaptic("error");
      return;
    }
    pushHistory(draft.furniture);
    setDraft((prev) => ({
      ...prev,
      furniture: prev.furniture.map((p) => (p.id === id ? candidate : p)),
    }));
    props.triggerHaptic("tap");
  };

  const rotateSelected = () => {
    if (selected) rotatePieceById(selected.id);
  };

  const removeSelected = () => {
    if (!selected) return;
    pushHistory(draft.furniture);
    setDraft((prev) => ({ ...prev, furniture: prev.furniture.filter((p) => p.id !== selected.id) }));
    setSelectedId(null);
    props.triggerHaptic("tap");
  };

  /** Nudge the selected piece one snap step; a colliding nudge is refused. */
  const nudgeSelected = (dx: number, dz: number) => {
    if (!selected) return;
    const candidate = { ...selected, x: snapToGrid(selected.x + dx), z: snapToGrid(selected.z + dz) };
    if (pieceCollides(home, candidate, draft.furniture.filter((p) => p.id !== selected.id))) {
      props.triggerHaptic("error");
      return;
    }
    pushHistory(draft.furniture);
    setDraft((prev) => ({
      ...prev,
      furniture: prev.furniture.map((p) => (p.id === selected.id ? candidate : p)),
    }));
    props.triggerHaptic("tap");
  };

  /**
   * Duplicate the selected piece onto the first free spot near the
   * original. Only when another owned copy is still unplaced.
   */
  const duplicateSelected = () => {
    if (!selected) return;
    if (placedCount(selected.item) >= ownedCount(selected.item)) return;
    const spot = findFreeSpot(home, selected.item, draft.furniture, { x: selected.x, z: selected.z });
    if (!spot) {
      setMsg("No clear space for a copy.");
      props.triggerHaptic("error");
      return;
    }
    const id = newPieceId();
    let piece: HomeFurniturePiece = { id, item: selected.item, x: spot.x, z: spot.z, rot: selected.rot };
    // The scan proves the spot at rot 0; if the original's rotation
    // does not fit there, the copy lands unrotated instead.
    if (selected.rot !== 0 && pieceCollides(home, piece, draft.furniture)) piece = { ...piece, rot: 0 };
    pushHistory(draft.furniture);
    setDraft((prev) => ({ ...prev, furniture: [...prev.furniture, piece] }));
    setSelectedId(id);
    props.triggerHaptic("tap");
  };

  /** Undo the last furniture change (place / remove / rotate / nudge / duplicate / drag). */
  const undo = () => {
    const prevList = historyRef.current[historyRef.current.length - 1];
    if (!prevList) return;
    historyRef.current = historyRef.current.slice(0, -1);
    setHistoryLen(historyRef.current.length);
    setDraft((p) => ({ ...p, furniture: prevList.map((q) => ({ ...q })) }));
    if (selectedId && !prevList.some((q) => q.id === selectedId)) setSelectedId(null);
    props.triggerHaptic("tap");
  };

  const setRoomFinish = (key: "wall" | "floor", value: string) => {
    const currentRoom = draft.decor.rooms?.[selectedRoom];
    const effective = {
      wall: currentRoom?.wall ?? draft.decor.wall,
      floor: currentRoom?.floor ?? draft.decor.floor,
    };
    const next = { ...effective, [key]: value };
    setDraft((prev) => ({
      ...prev,
      decor: { ...prev.decor, rooms: { ...(prev.decor.rooms ?? {}), [selectedRoom]: next } },
    }));
    props.triggerHaptic("tap");
  };

  const resetRoom = () => {
    setDraft((prev) => {
      const rooms = { ...(prev.decor.rooms ?? {}) };
      delete rooms[selectedRoom];
      return { ...prev, decor: { ...prev.decor, rooms: Object.keys(rooms).length ? rooms : undefined } };
    });
    props.triggerHaptic("tap");
  };

  const applyTheme = (themeKey: string) => {
    const theme = HOME_THEMES[themeKey];
    if (!theme) return;
    setDraft((prev) => ({
      ...prev,
      decor: { wall: theme.wall, floor: theme.floor, light: theme.light },
      style: { exterior: theme.exterior, roof: theme.roof, yard: theme.yard },
    }));
    props.triggerHaptic("tap");
  };

  const save = async () => {
    if (!dirty || saving || plan.cost > balance) return;
    setSaving(true);
    setMsg("");
    try {
      const result = await props.onSave(draft);
      setMsg(result.message);
      if (result.ok) {
        setSaved({
          decor: JSON.parse(JSON.stringify(draft.decor)),
          style: { ...draft.style },
          furniture: draft.furniture.map((p) => ({ ...p })),
        });
        clearHistory();
        props.triggerHaptic("success");
      } else {
        props.triggerHaptic("error");
      }
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft({
      furniture: saved.furniture.map((p) => ({ ...p })),
      decor: JSON.parse(JSON.stringify(saved.decor)),
      style: { ...saved.style },
    });
    setSelectedId(null);
    clearHistory();
    setMsg("Discarded — back to what is saved.");
    props.triggerHaptic("tap");
  };

  const roomFinish = (roomId: RoomId) => {
    const room = draft.decor.rooms?.[roomId];
    return { wall: room?.wall ?? draft.decor.wall, floor: room?.floor ?? draft.decor.floor };
  };

  const swatch = (label: string, colorHex: string, price: number, active: boolean, disabled: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      className={active ? "ws-swatch on" : "ws-swatch"}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="ws-dot" style={{ background: colorHex }} />
      {active ? `✓ ${label}` : `${label} — ${price}`}
    </button>
  );

  return (
    <div className="ws-overlay">
      <header className="ws-header">
        <div>
          <b>Home Workshop</b>
          <span>
            {home.name} · {home.district} · {balance.toLocaleString()} City Sol
          </span>
        </div>
        <div className="ws-header-btns">
          <button type="button" onClick={props.onClose} aria-label="Close workshop">
            ✕
          </button>
        </div>
      </header>
      <div className="ws-planwrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="ws-plan"
          style={{ width: "100%", height: "100%" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        <div className="ws-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.2).toFixed(1)))} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            aria-label="Reset zoom"
          >
            Fit
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} aria-label="Zoom in">
            +
          </button>
        </div>
        <p className="ws-hint">Drag pieces to move them · drag the plan to pan · pinch to zoom · double-tap a piece to rotate it</p>
      </div>
      {selected ? (
        <div className="ws-selected">
          <b>{furnitureName(selected.item)}</b>
          <span>
            {selected.x.toFixed(1)}, {selected.z.toFixed(1)} · {Math.round(((selected.rot * 180) / Math.PI) % 360)}°
          </span>
          <div className="ws-nudge" role="group" aria-label="Nudge piece">
            <button type="button" onClick={() => nudgeSelected(0, -0.5)} aria-label="Nudge up">
              ▲
            </button>
            <button type="button" onClick={() => nudgeSelected(-0.5, 0)} aria-label="Nudge left">
              ◀
            </button>
            <button type="button" onClick={() => nudgeSelected(0, 0.5)} aria-label="Nudge down">
              ▼
            </button>
            <button type="button" onClick={() => nudgeSelected(0.5, 0)} aria-label="Nudge right">
              ▶
            </button>
          </div>
          <button type="button" onClick={rotateSelected}>
            Rotate 45°
          </button>
          <button
            type="button"
            disabled={placedCount(selected.item) >= ownedCount(selected.item)}
            onClick={duplicateSelected}
          >
            Duplicate
          </button>
          <button type="button" onClick={removeSelected}>
            Remove
          </button>
        </div>
      ) : null}
      <div className="ws-actions">
        <button type="button" disabled={!dirty || saving || plan.cost > balance} onClick={save}>
          {saving ? "Saving…" : plan.cost > 0 ? `Save — ${plan.cost} City Sol` : "Save"}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={discard}>
          Discard
        </button>
        <button type="button" onClick={() => props.onView3D(draft)}>
          View in 3D
        </button>
        <button type="button" disabled={historyLen === 0 || saving} onClick={undo}>
          Undo
        </button>
      </div>
      {msg ? <p className="ws-msg">{msg}</p> : null}
      {plan.cost > balance ? <p className="ws-msg">Not enough City Sol for these changes — {plan.cost - balance} short.</p> : null}
      <div className="ws-tabs" role="tablist">
        {(["furniture", "rooms", "outside", "themes"] as PaletteTab[]).map((t) => (
          <button key={t} type="button" role="tab" className={tab === t ? "on" : ""} onClick={() => { setTab(t); props.triggerHaptic("tap"); }}>
            {t === "furniture" ? "Furniture" : t === "rooms" ? "Rooms" : t === "outside" ? "Outside" : "Themes"}
          </button>
        ))}
      </div>
      <div className="ws-palette">
        {tab === "furniture" && (
          <div className="ws-grid">
            {FURNITURE_CATALOG.map((item) => {
              const owned = ownedCount(item.id);
              const placed = placedCount(item.id);
              const unplaced = owned - placed;
              const fp = furnitureFootprint(item.id);
              return (
                <div key={item.id} className="ws-item">
                  <span className="ws-chip" style={{ background: fp.color }} />
                  <div>
                    <b>{item.name}</b>
                    <span>
                      {owned ? `Own ${owned} · placed ${placed}` : "Not owned"}
                    </span>
                  </div>
                  {unplaced > 0 ? (
                    <button type="button" onClick={() => placeItem(item.id)}>
                      Place
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={balance < item.price || buying === item.id}
                      onClick={async () => {
                        setBuying(item.id);
                        try {
                          setMsg(await props.onBuy(item.id));
                        } finally {
                          setBuying("");
                        }
                      }}
                    >
                      {buying === item.id ? "Buying…" : `Buy — ${item.price}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab === "rooms" && (
          <div className="ws-rooms">
            <div className="ws-room-pick">
              {HOME_ROOM_IDS.map((roomId) => {
                const finish = roomFinish(roomId);
                return (
                  <button key={roomId} type="button" className={selectedRoom === roomId ? "on" : ""} onClick={() => { setSelectedRoom(roomId); props.triggerHaptic("tap"); }}>
                    {HOME_ROOM_LABELS[roomId]}
                    <span>
                      {CRIB_WALLS[finish.wall]?.name ?? finish.wall} · {CRIB_FLOORS[finish.floor]?.name ?? finish.floor}
                    </span>
                  </button>
                );
              })}
            </div>
            <h4>
              {HOME_ROOM_LABELS[selectedRoom]} — walls
              <button type="button" className="ws-reset" onClick={resetRoom}>
                Reset room
              </button>
            </h4>
            <div className="ws-swatches">
              {Object.entries(CRIB_WALLS).map(([key, opt]) =>
                swatch(
                  opt.name,
                  cssColor(opt.color),
                  workshopRoomPrice(opt.price),
                  roomFinish(selectedRoom).wall === key,
                  false,
                  () => setRoomFinish("wall", key),
                ),
              )}
            </div>
            <h4>{HOME_ROOM_LABELS[selectedRoom]} — floor</h4>
            <div className="ws-swatches">
              {Object.entries(CRIB_FLOORS).map(([key, opt]) =>
                swatch(
                  opt.name,
                  cssColor(opt.color),
                  workshopRoomPrice(opt.price),
                  roomFinish(selectedRoom).floor === key,
                  false,
                  () => setRoomFinish("floor", key),
                ),
              )}
            </div>
            <h4>Whole home — walls, floor, lights</h4>
            <div className="ws-swatches">
              {Object.entries(CRIB_WALLS).map(([key, opt]) =>
                swatch(
                  opt.name,
                  cssColor(opt.color),
                  opt.price,
                  draft.decor.wall === key,
                  false,
                  () => { setDraft((p) => ({ ...p, decor: { ...p.decor, wall: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <div className="ws-swatches">
              {Object.entries(CRIB_FLOORS).map(([key, opt]) =>
                swatch(
                  opt.name,
                  cssColor(opt.color),
                  opt.price,
                  draft.decor.floor === key,
                  false,
                  () => { setDraft((p) => ({ ...p, decor: { ...p.decor, floor: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <div className="ws-swatches">
              {Object.entries(CRIB_LIGHTS).map(([key, opt]) =>
                swatch(
                  opt.name,
                  cssColor(opt.color),
                  opt.price,
                  draft.decor.light === key,
                  false,
                  () => { setDraft((p) => ({ ...p, decor: { ...p.decor, light: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <p className="ws-note">Room finishes cost half the whole-home price. A room left alone follows the whole-home finish.</p>
          </div>
        )}
        {tab === "outside" && (
          <div className="ws-rooms">
            <h4>Exterior trim</h4>
            <div className="ws-swatches">
              {Object.entries(HOME_EXTERIORS).map(([key, opt]) =>
                swatch(
                  opt.label,
                  cssColor(opt.trim),
                  opt.price,
                  draft.style.exterior === key,
                  false,
                  () => { setDraft((p) => ({ ...p, style: { ...p.style, exterior: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <h4>Roof edge</h4>
            <div className="ws-swatches">
              {Object.entries(HOME_ROOFS).map(([key, opt]) =>
                swatch(
                  opt.label,
                  cssColor(opt.roof),
                  opt.price,
                  draft.style.roof === key,
                  false,
                  () => { setDraft((p) => ({ ...p, style: { ...p.style, roof: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <h4>Yard</h4>
            <div className="ws-swatches">
              {Object.entries(HOME_YARDS).map(([key, opt]) =>
                swatch(
                  opt.label,
                  cssColor(opt.yard),
                  opt.price,
                  draft.style.yard === key,
                  false,
                  () => { setDraft((p) => ({ ...p, style: { ...p.style, yard: key } })); props.triggerHaptic("tap"); },
                ),
              )}
            </div>
            <p className="ws-note">Trim, roof edge and yard show on the street — the whole neighbourhood sees them.</p>
          </div>
        )}
        {tab === "themes" && (
          <div className="ws-grid">
            {Object.entries(HOME_THEMES).map(([key, theme]) => {
              const active = draftMatchesTheme(draft, key);
              return (
                <div key={key} className="ws-item">
                  <span className="ws-chip" style={{ background: cssColor(CRIB_WALLS[theme.wall]?.color ?? 0xe8dcc8) }} />
                  <div>
                    <b>{theme.label}</b>
                    <span>
                      {CRIB_WALLS[theme.wall]?.name} · {CRIB_FLOORS[theme.floor]?.name} · {HOME_EXTERIORS[theme.exterior]?.label}
                    </span>
                  </div>
                  <button type="button" disabled={active || balance < theme.price} onClick={() => applyTheme(key)}>
                    {active ? "✓ Applied" : `Apply — ${theme.price}`}
                  </button>
                </div>
              );
            })}
            <p className="ws-note">A theme sets the whole home — inside and outside — in one tap. It replaces any per-room finishes.</p>
          </div>
        )}
      </div>
    </div>
  );
}
