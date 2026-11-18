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
  furnitureFootprint,
  homeBuiltins,
  homeInteriorRect,
  homeRoomLayout,
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
  onView3D: () => void;
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
  const dragRef = useRef<{ id: string; offX: number; offZ: number } | null>(null);
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
    const ox = (cw - home.w * scale) / 2;
    const oy = (ch - home.d * scale) / 2;
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
    // Placed furniture.
    for (const piece of draft.furniture) {
      const fp = furnitureFootprint(piece.item);
      const px = X(piece.x);
      const pz = Z(piece.z);
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-piece.rot);
      ctx.fillStyle = fp.color;
      ctx.fillRect((-fp.w * scale) / 2, (-fp.d * scale) / 2, fp.w * scale, fp.d * scale);
      ctx.strokeStyle = piece.id === selectedId ? "#e0b33a" : "rgba(0,0,0,0.6)";
      ctx.lineWidth = piece.id === selectedId ? 3 : 1;
      ctx.strokeRect((-fp.w * scale) / 2, (-fp.d * scale) / 2, fp.w * scale, fp.d * scale);
      const name = furnitureName(piece.item);
      if (fp.w * scale > 30) {
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
  }, [draft, rooms, builtins, home, selectedId, selectedRoom, tab, zoom, size]);

  // --- Pointer drag ------------------------------------------------------
  const toWorld = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const scale = Math.min((cw - 40) / home.w, (ch - 40) / home.d) * zoom;
    const ox = (cw - home.w * scale) / 2;
    const oy = (ch - home.d * scale) / 2;
    return { x: home.x0 + (e.clientX - rect.left - ox) / scale, z: home.z0 + (e.clientY - rect.top - oy) / scale };
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

  const onPointerDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    if (!w) return;
    const piece = hitPiece(w.x, w.z);
    if (piece) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = { id: piece.id, offX: w.x - piece.x, offZ: w.z - piece.z };
      setSelectedId(piece.id);
      props.triggerHaptic("tap");
      return;
    }
    const roomId = roomAt(home, w.x, w.z);
    if (roomId) {
      setSelectedRoom(roomId);
      setSelectedId(null);
      setTab("rooms");
    } else {
      setSelectedId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
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
    if (nx === piece.x && nz === piece.z) return;
    setDraft((prev) => ({
      ...prev,
      furniture: prev.furniture.map((p) => (p.id === drag.id ? { ...p, x: nx, z: nz } : p)),
    }));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // --- Draft actions -----------------------------------------------------
  const placeItem = (itemId: string) => {
    if (placedCount(itemId) >= ownedCount(itemId)) return;
    const interior = homeInteriorRect(home);
    const id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const piece: HomeFurniturePiece = {
      id,
      item: itemId,
      x: snapToGrid((interior.x0 + interior.x1) / 2),
      z: snapToGrid((interior.z0 + interior.z1) / 2),
      rot: 0,
    };
    setDraft((prev) => ({ ...prev, furniture: [...prev.furniture, piece] }));
    setSelectedId(id);
    props.triggerHaptic("tap");
  };

  const rotateSelected = () => {
    if (!selected) return;
    setDraft((prev) => ({
      ...prev,
      furniture: prev.furniture.map((p) => (p.id === selected.id ? { ...p, rot: (p.rot + Math.PI / 4) % (Math.PI * 2) } : p)),
    }));
    props.triggerHaptic("tap");
  };

  const removeSelected = () => {
    if (!selected) return;
    setDraft((prev) => ({ ...prev, furniture: prev.furniture.filter((p) => p.id !== selected.id) }));
    setSelectedId(null);
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
          onPointerCancel={onPointerUp}
        />
        <div className="ws-zoom">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.7, +(z - 0.2).toFixed(1)))} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom">
            Fit
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))} aria-label="Zoom in">
            +
          </button>
        </div>
        <p className="ws-hint">Drag furniture to move it · tap a room to paint it · tap a piece to rotate or remove it</p>
      </div>
      {selected ? (
        <div className="ws-selected">
          <b>{furnitureName(selected.item)}</b>
          <span>
            {selected.x.toFixed(1)}, {selected.z.toFixed(1)} · {Math.round(((selected.rot * 180) / Math.PI) % 360)}°
          </span>
          <button type="button" onClick={rotateSelected}>
            Rotate 45°
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
        <button
          type="button"
          onClick={() => {
            if (dirty) {
              setMsg("Unsaved changes — save or discard first, then view it in 3D.");
              return;
            }
            props.onView3D();
          }}
        >
          View in 3D
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
