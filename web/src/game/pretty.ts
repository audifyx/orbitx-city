import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Facade, Face } from "./city";
import { porchPosts, porchSlab } from "./city";

export type QualityName = "low" | "medium" | "high";

const box = new BoxGeometry(1, 1, 1);
const column = new CylinderGeometry(0.35, 0.42, 1, 10);

// Per-facade materials whose emissive (window glow) is driven by setPrettyNight.
const nightMats: Array<{ mat: MeshStandardMaterial; day: number; night: number }> = [];
export function setPrettyNight(f: number) {
  const t = Math.max(0, Math.min(1, f));
  for (const entry of nightMats) {
    entry.mat.emissiveIntensity = entry.day + (entry.night - entry.day) * t;
  }
}

function glowRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function storefront(ctx: CanvasRenderingContext2D, base: string, glass: string) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 442, 256, 70);
  // Gold signage band.
  ctx.fillStyle = "#e0b33a";
  ctx.fillRect(0, 442, 256, 12);
  ctx.fillStyle = "#10141c";
  ctx.fillRect(20, 445, 216, 6);
  // Striped awning.
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e0b33a" : "#f4f7fb";
    ctx.fillRect(i * 32, 454, 32, 12);
  }
  // Big glass panes + a door with gold handles (second pane).
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 62;
    ctx.fillStyle = "#0b1c26";
    ctx.fillRect(x - 2, 468, 52, 38);
    const paneGrad = ctx.createLinearGradient(0, 470, 0, 506);
    paneGrad.addColorStop(0, glass);
    paneGrad.addColorStop(1, "#ffca7a");
    ctx.fillStyle = paneGrad;
    ctx.fillRect(x, 470, 48, 34);
    ctx.fillStyle = "rgba(126,246,255,0.5)";
    ctx.fillRect(x + 4, 474, 40, 5);
    if (i === 1) {
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(x + 18, 482, 3, 18);
      ctx.fillRect(x + 28, 482, 3, 18);
    }
    glowRect(ctx, x, 470, 48, 34, "#ffca7a", 0.65);
  }
}

function paintFacade(style: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { map: new CanvasTexture(canvas), glow: new CanvasTexture(canvas) };
  // Per-style base + window drawing. One canvas = a 10m x 14m module.
  const s = style % 6;
  if (s === 0) {
    // Glass curtain wall: dark blue glass bands + thin mullions.
    ctx.fillStyle = "#0d1b26";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 7; row++) {
      const y = 28 + row * 54;
      ctx.fillStyle = "#16324a";
      ctx.fillRect(8, y, 240, 36);
      ctx.fillStyle = "rgba(126,246,255,0.55)";
      ctx.fillRect(12, y + 4, 232, 4);
      ctx.fillStyle = "#0a141d";
      for (let col = 0; col <= 7; col++) ctx.fillRect(8 + col * 32, y, 2, 36);
    }
    storefront(ctx, "#0a141d", "#16324a");
  } else if (s === 1) {
    // Warm brick residential: terracotta courses, small warm-lit windows.
    ctx.fillStyle = "#8a4a34";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#6e3a28";
    for (let y = 12; y < 442; y += 12) ctx.fillRect(0, y, 256, 1);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 22 + col * 74;
        const y = 30 + row * 54;
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x - 3, y - 3, 34, 38);
        ctx.fillStyle = row % 2 === 0 ? "#ffd9a0" : "#c98d4e";
        ctx.fillRect(x, y, 28, 32);
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x + 13, y, 2, 32);
      }
    }
    storefront(ctx, "#6e3a28", "#ffd9a0");
  } else if (s === 2) {
    // Concrete ribbon windows: light slabs, full-width dark bands.
    ctx.fillStyle = "#b8bcc0";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#9aa0a6";
    for (let y = 0; y < 442; y += 54) ctx.fillRect(0, y + 50, 256, 4);
    for (let row = 0; row < 7; row++) {
      const y = 30 + row * 54;
      ctx.fillStyle = "#232a30";
      ctx.fillRect(10, y, 236, 30);
      ctx.fillStyle = "#3d4a55";
      ctx.fillRect(14, y + 4, 228, 6);
      ctx.fillStyle = "#d7dde8";
      ctx.fillRect(10, y + 30, 236, 3);
    }
    storefront(ctx, "#8b9096", "#9fc4d6");
  } else if (s === 3) {
    // Cream stone modern: light base, pilasters, dark windows.
    ctx.fillStyle = "#e8e0cc";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#d8cfb8";
    for (let col = 0; col <= 4; col++) ctx.fillRect(col * 64 - 6, 0, 12, 442);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 20 + col * 60;
        const y = 28 + row * 54;
        ctx.fillStyle = "#1d2733";
        ctx.fillRect(x, y, 36, 40);
        ctx.fillStyle = "#8a97a8";
        ctx.fillRect(x + 3, y + 3, 30, 5);
        ctx.fillStyle = "#e8e0cc";
        ctx.fillRect(x, y + 40, 36, 3);
      }
    }
    storefront(ctx, "#cfc4a8", "#2a3540");
  } else if (s === 4) {
    // Neon commercial: dark base, big glowing panes, gold signage band.
    ctx.fillStyle = "#0c0f16";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#e0b33a";
    ctx.fillRect(0, 8, 256, 32);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(24, 18, 208, 12);
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 16 + col * 80;
        const y = 56 + row * 58;
        ctx.fillStyle = "#12303f";
        ctx.fillRect(x, y, 56, 44);
        ctx.fillStyle = row % 2 === 0 ? "#7ef6ff" : "#2fa8cc";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 4, y + 4, 48, 30);
        ctx.globalAlpha = 1;
      }
    }
    storefront(ctx, "#0a0d13", "#12303f");
  } else {
    // Dark OrbitX identity: cyan windows, gold floor lines.
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 18 + col * 60;
        const y = 28 + row * 54;
        ctx.fillStyle = "#12343f";
        ctx.fillRect(x, y, 44, 36);
        ctx.fillStyle = row % 2 === 0 ? "#7ef6ff" : "#49c8e8";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 4, y + 4, 36, 22);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#f4f7fb";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 44, 36);
      }
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(0, 24 + row * 54, 256, 2);
    }
    ctx.fillStyle = "#9befff";
    ctx.fillRect(0, 418, 256, 8);
    storefront(ctx, "#0a0d13", "#12303f");
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.anisotropy = 4;
  // Emissive map: the windows glow (warm for brick/cream, cyan for the rest).
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 512;
  const g = glowCanvas.getContext("2d");
  const glow = new CanvasTexture(glowCanvas);
  if (g) {
    g.clearRect(0, 0, 256, 512);
    g.fillStyle = s === 1 || s === 3 ? "#ffc27a" : s === 2 ? "#bfe6ff" : "#7ef6ff";
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        g.globalAlpha = row % 2 === 0 ? 1 : 0.45;
        g.fillRect(22 + col * 60, 32 + row * 54, 36, 22);
      }
    }
    g.globalAlpha = 0.65;
    g.fillRect(10, 470, 236, 34);
    g.globalAlpha = 1;
    glow.colorSpace = SRGBColorSpace;
    glow.wrapS = RepeatWrapping;
    glow.wrapT = RepeatWrapping;
  }
  return { map, glow };
}

const paints = [0, 1, 2, 3, 4, 5].map((style) => paintFacade(style));

const STYLE_EMISSIVE = [0x9af6ff, 0xffc27a, 0xbfe6ff, 0xffc27a, 0x9af6ff, 0x9af6ff];

// Shared roof / trim materials (one instance per colour, not per facade).
const ROOF_MATS = [0x232830, 0x8a4a34, 0x3a4a5c, 0xe0b33a].map(
  (color) => new MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.15 }),
);
// ---- glazing pass: real glass for the office towers + homes. ----
// Warm-lit home windows + cool curtain glass for the towers. Both register
// in nightMats so the lit interior reads after dark (same day/night drive
// as the facade glow). Transparent + framed: the pane sits in a real hole
// in the wall on the street face, so you can see the lit interior from
// outside and see out from inside; the frame is merged geometry, one mesh
// per window.
const WINDOW_GLASS_MAT = new MeshStandardMaterial({
  color: 0xffd9a0,
  emissive: 0xffc27a,
  emissiveIntensity: 0.3,
  roughness: 0.1,
  metalness: 0.25,
  transparent: true,
  opacity: 0.5,
});
const CURTAIN_GLASS_MAT = new MeshStandardMaterial({
  color: 0x9befff,
  emissive: 0x1ad8ff,
  emissiveIntensity: 0.35,
  roughness: 0.08,
  metalness: 0.45,
  transparent: true,
  opacity: 0.55,
});
const FRAME_MAT = new MeshStandardMaterial({ color: 0x1a2028, roughness: 0.5, metalness: 0.4 });
nightMats.push({ mat: WINDOW_GLASS_MAT, day: 0.3, night: 1.9 });
nightMats.push({ mat: CURTAIN_GLASS_MAT, day: 0.35, night: 1.5 });

/** Glazing coverage, filled by mountPretty so the game page can report it. */
export const glassStats = { homes: 0, offices: 0, windows: 0, panes: 0 };
function resetGlassStats() {
  glassStats.homes = 0;
  glassStats.offices = 0;
  glassStats.windows = 0;
  glassStats.panes = 0;
}

// One merged frame geometry per window size (top/bottom rails, side
// stiles, a centre mullion, a protruding sill), shared by every window of
// that size. Local space: the window is centred on the origin, facing +z.
const frameCache = new Map<string, BufferGeometry>();
function windowFrameGeo(w: number, h: number, band = false): BufferGeometry {
  const key = `${band ? "band" : "win"}:${w.toFixed(2)}x${h.toFixed(2)}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  const bar = 0.16;
  const parts: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number }> = [
    { x: 0, y: h / 2 + bar / 2, z: 0, sx: w + bar * 2, sy: bar, sz: 0.14 },
    { x: 0, y: -h / 2 - bar / 2, z: 0, sx: w + bar * 2, sy: bar, sz: 0.14 },
    { x: -w / 2 - bar / 2, y: 0, z: 0, sx: bar, sy: h + bar * 2, sz: 0.14 },
    { x: w / 2 + bar / 2, y: 0, z: 0, sx: bar, sy: h + bar * 2, sz: 0.14 },
  ];
  if (!band) {
    // Centre mullion + a sill that protrudes 0.14 out from the wall.
    parts.push({ x: 0, y: 0, z: 0, sx: 0.1, sy: h, sz: 0.12 });
    parts.push({ x: 0, y: -h / 2 - bar - 0.05, z: 0.08, sx: w + bar * 2 + 0.24, sy: 0.12, sz: 0.34 });
  }
  const geos = parts.map((p) => {
    const g = new BoxGeometry(p.sx, p.sy, p.sz);
    g.translate(p.x, p.y, p.z);
    return g;
  });
  const merged = mergeGeometries(geos) ?? geos[0] as BufferGeometry;
  for (const g of geos) if (g !== merged) g.dispose();
  frameCache.set(key, merged);
  return merged;
}

function glassPane(
  group: Group,
  mat: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
) {
  const m = new Mesh(box, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = false;
  m.receiveShadow = false;
  group.add(m);
}

function frameMesh(
  group: Group,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  band = false,
) {
  const m = new Mesh(windowFrameGeo(w, h, band), FRAME_MAT);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = false;
  m.receiveShadow = false;
  group.add(m);
}

/** Outward rotation for a face: the frame geometry faces +z locally. */
function faceRotY(face: Face): number {
  if (face === "n") return Math.PI;
  if (face === "e") return Math.PI / 2;
  if (face === "w") return -Math.PI / 2;
  return 0;
}
const GOLD_MAT = new MeshStandardMaterial({
  color: 0xe0b33a,
  roughness: 0.35,
  metalness: 0.7,
  emissive: 0x6a5208,
  emissiveIntensity: 0.4,
});
const WHITE_MAT = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.45, metalness: 0.1 });
const WOOD_MAT = new MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8, metalness: 0.05 });
const DARK_MAT = new MeshStandardMaterial({ color: 0x141820, roughness: 0.7, metalness: 0.2 });

// Shop-interior goods (world-quality upgrade 2026-11-13): bright, slightly
// emissive so they read through the tinted storefront glass.
const GOODS_MATS = [
  new MeshStandardMaterial({ color: 0xe0392f, roughness: 0.5, metalness: 0.1, emissive: 0x5a0f0a, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0x1ad8ff, roughness: 0.5, metalness: 0.1, emissive: 0x0a4a5a, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0x37b24a, roughness: 0.5, metalness: 0.1, emissive: 0x0f3a16, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.5, metalness: 0.1, emissive: 0x6a5208, emissiveIntensity: 0.5 }),
];

function facadeMaterial(style: number, w: number, h: number) {
  const src = paints[style % paints.length];
  const map = src.map.clone();
  const glow = src.glow.clone();
  map.repeat.set(Math.max(1, w / 10), Math.max(1, h / 14));
  glow.repeat.set(map.repeat.x, map.repeat.y);
  map.needsUpdate = true;
  glow.needsUpdate = true;
  const mat = new MeshStandardMaterial({
    map,
    emissiveMap: glow,
    emissive: STYLE_EMISSIVE[style % STYLE_EMISSIVE.length],
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0.28,
  });
  nightMats.push({ mat, day: 0.35, night: 1.7 });
  return mat;
}

function addWall(
  group: Group,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  material: MeshStandardMaterial,
) {
  const mesh = new Mesh(box, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ---- glazing pass on the hollow shell ----
// The walls are built as solid runs around openings (the door gap + real
// window holes on the ground floor). A window opening is a real hole: the
// glass pane sits centred in the wall thickness, so from the street you
// see the lit interior through it, and from inside you see out — while the
// colliders (pushWallColliders, untouched) still block walking through.
// Upper floors of office towers get proud glass curtain bands instead of
// holes: one wide pane + rails per face per row.
// `glaze` is true for facades that opted into the pass (facade.glass).

interface WallOpening {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  door?: boolean;
}

function hollow(facade: Facade, material: MeshStandardMaterial, glaze: boolean) {
  const group = new Group();
  const { x, z, w, d, h, door, passThrough } = facade;
  const t = 0.45;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const midY = h / 2;
  // Closed real doors (2026-11-12): the door face is a FULL solid wall,
  // and a wood door slab + white frame + gold handle sits in it. Entry is
  // E at the door anchor — the old 4-wide open gap is gone.
  // The ONE exception is the pass-through face (a building astride a
  // road/bridge line): it keeps the 4-wide gap so a car can drive through.
  const gap = 4;
  const doorMat = new MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.65, metalness: 0.1 });
  const frameMat = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4, metalness: 0.15 });
  const handleMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.3, metalness: 0.7, emissive: 0x6a5208, emissiveIntensity: 0.4 });
  const addDoor = (alongX: boolean) => {
    const px = alongX ? cx : door === "w" ? x + t / 2 : x + w - t / 2;
    const pz = alongX ? (door === "n" ? z + t / 2 : z + d - t / 2) : cz;
    const slab = new Mesh(box, doorMat);
    slab.position.set(px, 1.45, pz);
    slab.scale.set(alongX ? 3.4 : 0.5, 2.9, alongX ? 0.5 : 3.4);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    for (const off of [-1.85, 1.85]) {
      const post = new Mesh(box, frameMat);
      post.position.set(alongX ? cx + off : px, 1.55, alongX ? pz : cz + off);
      post.scale.set(alongX ? 0.35 : 0.5, 3.1, alongX ? 0.5 : 0.35);
      post.castShadow = true;
      group.add(post);
    }
    const lintel = new Mesh(box, frameMat);
    lintel.position.set(alongX ? cx : px, 3.12, alongX ? pz : cz);
    lintel.scale.set(alongX ? 4.3 : 0.5, 0.26, alongX ? 0.5 : 4.3);
    group.add(lintel);
    for (const side of [-0.26, 0.26]) {
      const handle = new Mesh(box, handleMat);
      if (alongX) handle.position.set(cx + 1.2, 1.15, pz + side);
      else handle.position.set(px + side, 1.15, cz + 1.2);
      handle.scale.set(0.16, 0.16, 0.16);
      group.add(handle);
    }
  };
  // (gapOn/place are gone: the pass-through gap is now a buildWall
  // opening below, so the wall is built around it with windows kept
  // clear — same 4-wide car lane, no separate wall code.)
  const glass = glaze ? facade.glass : undefined;
  const glassWall = !!facade.glassWall;
  // Visible exterior plane, outward from the facade rect edge. 0 for the
  // pretty shell itself; voxel-shell towers (district office uppers) stick
  // their cream voxel wall 0.3 proud, so their curtain bands sit 0.36 out
  // and they get no wall holes (the voxel wall would hide them).
  const proud = facade.glassProud ?? 0;

  const winW = glass === "curtain" ? 2.6 : glassWall ? 3.4 : 2.2;
  const winY0 = glassWall ? 0.8 : 1.0;
  const winY1 = glassWall ? 2.8 : 2.6;

  // Ranges on one face the windows must not overlap: the door gap, and
  // the storefront glass zone on the storefront face.
  const blockedFor = (face: Face, span: number, origin: number): Array<[number, number]> => {
    const blocked: Array<[number, number]> = [];
    if (door === face) {
      const c = origin + span / 2;
      blocked.push([c - gap / 2, c + gap / 2]);
    }
    if (passThrough === face) {
      // Car lane through a tower astride a road/bridge line: same 4-wide
      // gap as the door, so no window may overlap it.
      const c = origin + span / 2;
      blocked.push([c - gap / 2, c + gap / 2]);
    }
    if (facade.storefront && facade.face === face) {
      const c = origin + span / 2;
      const paneW = Math.min(span * 0.72, 12);
      blocked.push([c - paneW / 2 - 0.6, c + paneW / 2 + 0.6]);
    }
    return blocked;
  };

  // Ground-floor window openings for one face.
  // "home": two windows flanking the door, street face only.
  // "curtain": windows spaced ~6.5 apart on every face.
  const windowsFor = (face: Face, span: number, origin: number): WallOpening[] => {
    if (!glass || proud > 0) return [];
    const blocked = blockedFor(face, span, origin);
    const overlaps = (a0: number, a1: number) =>
      blocked.some(([b0, b1]) => a0 < b1 - 0.2 && a1 > b0 + 0.2);
    if (glass === "home") {
      if (face !== door) return [];
      const out: WallOpening[] = [];
      const c = origin + span / 2;
      const gap0 = c - gap / 2;
      const gap1 = c + gap / 2;
      for (const [s0, s1] of [
        [origin, gap0],
        [gap1, origin + span],
      ] as const) {
        if (s1 - s0 < winW + 1.2) continue;
        const wc = (s0 + s1) / 2;
        out.push({ a0: wc - winW / 2, a1: wc + winW / 2, y0: winY0, y1: winY1 });
      }
      return out;
    }
    const n = Math.max(1, Math.floor((span - 1) / 6.5));
    const slot = span / n;
    const out: WallOpening[] = [];
    for (let i = 0; i < n; i++) {
      const wc = origin + slot * (i + 0.5);
      const a0 = wc - winW / 2;
      const a1 = wc + winW / 2;
      if (a0 < origin + 0.6 || a1 > origin + span - 0.6) continue;
      if (overlaps(a0, a1)) continue;
      out.push({ a0, a1, y0: 1.0, y1: 2.6 });
    }
    return out;
  };

  // One wall, built as solid runs around its openings, with glass + frame
  // in each window opening. `fixed` is the rect-edge coordinate of the
  // face (z for n/s, x for e/w).
  const buildWall = (face: Face, alongX: boolean, fixed: number) => {
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    const openings: WallOpening[] = [];
    if (door === face) {
      const c = origin + span / 2;
      openings.push({ a0: c - gap / 2, a1: c + gap / 2, y0: 0, y1: 3, door: true });
    } else if (passThrough === face) {
      // Car lane through a tower astride a road/bridge line (water batch):
      // same 4-wide open gap as the door. door: true only means "no glass
      // in this opening" — no door slab is added for it (addDoor runs only
      // on the door face, below).
      const c = origin + span / 2;
      openings.push({ a0: c - gap / 2, a1: c + gap / 2, y0: 0, y1: 3, door: true });
    }
    // Storefront display windows (world-quality upgrade 2026-11-13): the
    // AI demo's shop is see-through glass with shelves inside; the old
    // wall was solid here with a decorative pane on top. Real glass
    // openings flank the door (or one full pane when the door is on
    // another face), so the interior shows through. The glass + frame
    // land via the openings loop below, like any window.
    if (facade.storefront && facade.face === face) {
      const c = origin + span / 2;
      const paneW = Math.min(span * 0.72, 12);
      const p0 = c - paneW / 2;
      const p1 = c + paneW / 2;
      const keep: Array<[number, number]> = [];
      if (door === face || passThrough === face) keep.push([c - gap / 2, c + gap / 2]);
      let cur = p0;
      for (const [k0, k1] of [...keep].sort((a, b) => a[0] - b[0])) {
        if (k0 > cur + 0.3) openings.push({ a0: cur, a1: k0, y0: 0.15, y1: 3.35 });
        cur = Math.max(cur, k1);
      }
      if (p1 > cur + 0.3) openings.push({ a0: cur, a1: p1, y0: 0.15, y1: 3.35 });
    }
    for (const op of windowsFor(face, span, origin)) openings.push(op);
    openings.sort((a, b) => a.a0 - b.a0);
    // Wall centre plane (inward from the rect edge) and outer face plane.
    const wallC =
      face === "n" ? fixed + t / 2 : face === "s" ? fixed - t / 2 : face === "w" ? fixed + t / 2 : fixed - t / 2;
    const outer =
      face === "n" ? fixed - 0.07 : face === "s" ? fixed + 0.07 : face === "w" ? fixed - 0.07 : fixed + 0.07;
    const solid = (a0: number, a1: number) => {
      if (a1 - a0 < 0.05) return;
      const mid = (a0 + a1) / 2;
      const len = a1 - a0;
      if (alongX) addWall(group, mid, midY, wallC, len, h, t, material);
      else addWall(group, wallC, midY, mid, t, h, len, material);
    };
    const around = (op: WallOpening) => {
      const mid = (op.a0 + op.a1) / 2;
      const len = op.a1 - op.a0;
      if (op.y0 > 0.05) {
        if (alongX) addWall(group, mid, op.y0 / 2, wallC, len, op.y0, t, material);
        else addWall(group, wallC, op.y0 / 2, mid, t, op.y0, len, material);
      }
      if (op.y1 < h - 0.05) {
        const hy = (op.y1 + h) / 2;
        if (alongX) addWall(group, mid, hy, wallC, len, h - op.y1, t, material);
        else addWall(group, wallC, hy, mid, t, h - op.y1, len, material);
      }
    };
    let cursor = origin;
    for (const op of openings) {
      solid(cursor, op.a0);
      around(op);
      cursor = op.a1;
    }
    solid(cursor, origin + span);
    // Glass + frame in each window opening (never the door).
    for (const op of openings) {
      if (op.door) continue;
      const mid = (op.a0 + op.a1) / 2;
      const cy = (op.y0 + op.y1) / 2;
      const gw = op.a1 - op.a0;
      const gh = op.y1 - op.y0;
      const mat = glass === "curtain" ? CURTAIN_GLASS_MAT : WINDOW_GLASS_MAT;
      if (alongX) {
        glassPane(group, mat, mid, cy, wallC, gw - 0.08, gh - 0.08, 0.08);
        frameMesh(group, gw, gh, mid, cy, outer, faceRotY(face));
      } else {
        glassPane(group, mat, wallC, cy, mid, 0.08, gh - 0.08, gw - 0.08);
        frameMesh(group, gw, gh, outer, cy, mid, faceRotY(face));
      }
      glassStats.windows++;
    }
  };

  buildWall("n", true, z);
  buildWall("s", true, z + d);
  buildWall("w", false, x);
  buildWall("e", false, x + w);

  // Closed real door (life-sim): the door face's gap gets the wood slab +
  // white frame + gold handle, so the door stays shut. Entry is E at the
  // door anchor. The pass-through face keeps its open 4-wide gap (the
  // buildWall opening has door: true so no glass lands in it).
  if (door === "n" || door === "s") addDoor(true);
  else addDoor(false);

  // ---- glass curtain bands on the upper floors (office towers only) ----
  if (glass === "curtain") {
    // Voxel-shell towers start above the lobby roof (y 9.8); hollow-shell
    // towers get a clerestory band first (y 5.8). A row every 4 units.
    const startY = proud > 0 ? 9.8 : 5.8;
    const bandMat = CURTAIN_GLASS_MAT;
    for (let y = startY; y + 0.9 < h - 0.4; y += 4) {
      for (const face of ["n", "s", "w", "e"] as const) {
        const alongX = face === "n" || face === "s";
        const span = alongX ? w : d;
        const origin = alongX ? x : z;
        const centre = origin + span / 2;
        // Segments along the face; the lift balcony slot on the upper
        // tower's east face splits its band in two.
        let segments: Array<[number, number]> = [[origin + 0.5, origin + span - 0.5]];
        if (facade.glassSkip && facade.glassSkip.face === face) {
          const s0 = centre + facade.glassSkip.from;
          const s1 = centre + facade.glassSkip.to;
          segments = [
            [origin + 0.5, s0],
            [s1, origin + span - 0.5],
          ].filter(([a0, a1]) => a1 - a0 > 1) as Array<[number, number]>;
        }
        for (const [a0, a1] of segments) {
          const mid = (a0 + a1) / 2;
          const len = a1 - a0;
          const off = proud + 0.06;
          if (face === "n") {
            glassPane(group, bandMat, mid, y, z - off, len, 1.8, 0.1);
            frameMesh(group, len, 1.8, mid, y, z - off - 0.02, faceRotY(face), true);
          } else if (face === "s") {
            glassPane(group, bandMat, mid, y, z + d + off, len, 1.8, 0.1);
            frameMesh(group, len, 1.8, mid, y, z + d + off + 0.02, faceRotY(face), true);
          } else if (face === "w") {
            glassPane(group, bandMat, x - off, y, mid, 0.1, 1.8, len);
            frameMesh(group, len, 1.8, x - off - 0.02, y, mid, faceRotY(face), true);
          } else {
            glassPane(group, bandMat, x + w + off, y, mid, 0.1, 1.8, len);
            frameMesh(group, len, 1.8, x + w + off + 0.02, y, mid, faceRotY(face), true);
          }
          glassStats.panes++;
        }
      }
    }
  }

  const roofMat = new MeshStandardMaterial({ color: 0x141820, roughness: 0.7, metalness: 0.2 });
  addWall(group, cx, h + 0.2, cz, w, 0.4, d, roofMat);

  // ---- shop interior (world-quality upgrade 2026-11-13) ----
  // The AI demo's shop shows colourful shelves through the glass; the old
  // shell was empty behind a decorative pane. Two low display counters
  // flank the centre door lane (never in it — the door stays clear),
  // goods on top, and a tall back shelf against the rear wall. Inside the
  // hollow shell: no collider, no door-zone impact, and it renders at
  // every quality so the user's phone sees it too.
  if (facade.storefront) {
    const sFace = facade.face;
    const sAlongX = sFace === "n" || sFace === "s";
    const sSpan = sAlongX ? w : d;
    const sPaneW = Math.min(sSpan * 0.72, 12);
    const sInX = sFace === "e" ? -1 : sFace === "w" ? 1 : 0;
    const sInZ = sFace === "s" ? -1 : sFace === "n" ? 1 : 0;
    let gi = 0;
    const goods = (px: number, py: number, pz: number) => {
      const g = new Mesh(box, GOODS_MATS[gi++ % GOODS_MATS.length]);
      g.position.set(px, py, pz);
      g.scale.set(0.42, 0.42, 0.42);
      group.add(g);
    };
    const counterW = Math.min(2.6, sPaneW / 2 - 2.0 - 0.4);
    if (counterW > 0.8) {
      for (const s of [-1, 1]) {
        const cc = s * (2.0 + counterW / 2 + 0.3);
        const ccx = sAlongX ? cx + cc : cx + sInX * 1.7;
        const ccz = sAlongX ? cz + sInZ * 1.7 : cz + cc;
        const counter = new Mesh(box, WOOD_MAT);
        counter.position.set(ccx, 0.5, ccz);
        counter.scale.set(sAlongX ? counterW : 1.2, 1.0, sAlongX ? 1.2 : counterW);
        counter.castShadow = true;
        counter.receiveShadow = true;
        group.add(counter);
        const gOff = counterW / 2 - 0.5;
        for (const gs of [-1, 1]) {
          goods(sAlongX ? ccx + gs * gOff : ccx, 1.22, sAlongX ? ccz : ccz + gs * gOff);
        }
      }
    }
    // Tall back shelf against the rear wall — skipped when the door is on
    // that face, so nothing ever sits behind a door.
    const rearFace = sFace === "n" ? "s" : sFace === "s" ? "n" : sFace === "w" ? "e" : "w";
    if (door !== rearFace) {
      const bsx = sAlongX ? 4 : 0.8;
      const bsz = sAlongX ? 0.8 : 4;
      const bxc = sAlongX ? cx : sFace === "e" ? x + 0.7 : x + w - 0.7;
      const bzc = sAlongX ? (sFace === "n" ? z + d - 0.7 : z + 0.7) : cz;
      const back = new Mesh(box, WOOD_MAT);
      back.position.set(bxc, 1.2, bzc);
      back.scale.set(bsx, 2.4, bsz);
      back.castShadow = true;
      back.receiveShadow = true;
      group.add(back);
      for (const off of [-1.2, 0, 1.2]) {
        goods(sAlongX ? bxc + off : bxc, 2.61, sAlongX ? bzc : bzc + off);
      }
    }
  }

  return group;
}

function orbitWord() {
  const glyphs: Record<string, string[]> = {
    O: ["01110", "10001", "10001", "10001", "01110"],
    R: ["11110", "10001", "11110", "10100", "10010"],
    B: ["11110", "10001", "11110", "10001", "11110"],
    I: ["11111", "00100", "00100", "00100", "11111"],
    T: ["11111", "00100", "00100", "00100", "00100"],
    X: ["10001", "01010", "00100", "01010", "10001"],
  };
  const word = "ORBITX";
  const group = new Group();
  const ps = 0.24;
  const gap = 0.14;
  const glyphW = 5 * ps;
  const total = word.length * glyphW + (word.length - 1) * gap;
  const plate = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x071018, roughness: 0.45, metalness: 0.2, emissive: 0x062833, emissiveIntensity: 0.35 }),
  );
  plate.scale.set(total + 0.36, 5 * ps + 0.36, 0.08);
  plate.position.set(0, 2 * ps, -0.1);
  group.add(plate);
  const lit = new MeshStandardMaterial({ color: 0xf7fdff, emissive: 0x8af6ff, emissiveIntensity: 1.55, roughness: 0.22 });
  let cursor = -total / 2;
  for (const ch of word) {
    const rows = glyphs[ch];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== "1") continue;
        const cell = new Mesh(box, lit);
        cell.position.set(cursor + (c + 0.5) * ps, (rows.length - 1 - r) * ps, 0);
        cell.scale.set(ps * 0.84, ps * 0.84, 0.2);
        group.add(cell);
      }
    }
    cursor += glyphW + gap;
  }
  return group;
}

// Rooftop kit replacing the old floating cap box: parapet rim, AC units,
// antenna with a cyan beacon.
function addRoofKit(group: Group, x: number, z: number, w: number, d: number, h: number) {
  const rimMat = new MeshStandardMaterial({ color: 0x141820, roughness: 0.7, metalness: 0.2 });
  const acMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 });
  const rim = 0.25;
  const mk = (px: number, pz: number, sx: number, sz: number, mat: MeshStandardMaterial) => {
    const m = new Mesh(box, mat);
    m.position.set(px, h + rim / 2, pz);
    m.scale.set(sx, rim, sz);
    group.add(m);
  };
  mk(x + w / 2, z + rim / 2, w, rim, rimMat);
  mk(x + w / 2, z + d - rim / 2, w, rim, rimMat);
  mk(x + rim / 2, z + d / 2, rim, d, rimMat);
  mk(x + w - rim / 2, z + d / 2, rim, d, rimMat);
  for (const [ax, az] of [
    [x + w * 0.22, z + d * 0.24],
    [x + w * 0.72, z + d * 0.7],
  ] as const) {
    const ac = new Mesh(box, acMat);
    ac.position.set(ax, h + 0.4, az);
    ac.scale.set(1.4, 0.8, 1.2);
    ac.castShadow = true;
    group.add(ac);
  }
  const antenna = new Mesh(box, new MeshStandardMaterial({ color: 0x232a38, roughness: 0.5, metalness: 0.6 }));
  antenna.position.set(x + w * 0.85, h + 1.4, z + d * 0.2);
  antenna.scale.set(0.14, 2.8, 0.14);
  group.add(antenna);
  const beacon = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x1ad8ff, emissiveIntensity: 2.2, roughness: 0.2 }),
  );
  beacon.position.set(x + w * 0.85, h + 2.9, z + d * 0.2);
  beacon.scale.set(0.35, 0.35, 0.35);
  group.add(beacon);
}

// ---- real-architecture kit: pitched roofs, porches, chimneys, storefronts,
// stepped towers, side wings. One prism/mesh per feature, shared materials.

// A gable roof: a triangular prism (extruded triangle) on the walls, with a
// small overhang. Ridge runs along X when dir is n/s, along Z when e/w.
// Returns the ridge height.
function addGableRoof(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  dir: Face,
  matIdx: number,
): number {
  const alongX = dir === "n" || dir === "s";
  const span = (alongX ? d : w) + 0.8;
  const ridgeLen = (alongX ? w : d) + 0.8;
  const rise = Math.min(span * 0.32, 3.2);
  const tri = new Shape();
  tri.moveTo(-span / 2, 0);
  tri.lineTo(span / 2, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  const geo = new ExtrudeGeometry(tri, { depth: ridgeLen, bevelEnabled: false });
  const mesh = new Mesh(geo, ROOF_MATS[matIdx % ROOF_MATS.length]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const cx = x + w / 2;
  const cz = z + d / 2;
  if (alongX) {
    // Extrusion (local Z) becomes world X after the 90-degree turn.
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(cx - ridgeLen / 2, h - 0.05, cz);
  } else {
    // No rotation: the triangle is already symmetric about local x = 0,
    // so the mesh origin sits on the building centre. (The old code put
    // cx - span / 2 here, shifting the whole roof half a span west and
    // leaving the east half of the building roofless.)
    mesh.position.set(cx, h - 0.05, cz - ridgeLen / 2);
  }
  group.add(mesh);
  return rise;
}

// A hip roof: a four-sided pyramid whose base matches the walls.
function addHipRoof(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  matIdx: number,
): number {
  const rise = Math.min(Math.min(w, d) * 0.28, 3);
  const mesh = new Mesh(new ConeGeometry(1, 1, 4), ROOF_MATS[matIdx % ROOF_MATS.length]);
  mesh.rotation.y = Math.PI / 4;
  mesh.scale.set((w + 0.8) / Math.SQRT2, rise, (d + 0.8) / Math.SQRT2);
  mesh.position.set(x + w / 2, h + rise / 2 - 0.05, z + d / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return rise;
}

// A front porch: slab, canopy, and two posts over the door.
function addPorch(group: Group, f: Facade) {
  const slab = porchSlab(f);
  const slabMesh = new Mesh(box, WOOD_MAT);
  slabMesh.position.set(slab.x, 0.09, slab.z);
  slabMesh.scale.set(slab.w, 0.18, slab.d);
  slabMesh.receiveShadow = true;
  group.add(slabMesh);
  const canopy = new Mesh(box, ROOF_MATS[(f.roofMat ?? 0) % ROOF_MATS.length]);
  canopy.position.set(slab.x, 3.05, slab.z);
  canopy.scale.set(slab.w + 0.4, 0.14, slab.d + 0.4);
  canopy.castShadow = true;
  group.add(canopy);
  for (const p of porchPosts(f)) {
    const post = new Mesh(box, WHITE_MAT);
    post.position.set(p.x, 1.6, p.z);
    post.scale.set(0.24, 2.9, 0.24);
    post.castShadow = true;
    group.add(post);
  }
}

// A chimney riding the ridge (gable) or the apex (hip), proud of the roof.
function addChimney(group: Group, f: Facade, rise: number) {
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const mesh = new Mesh(box, ROOF_MATS[0]);
  mesh.castShadow = true;
  if (f.roof === "hip") {
    mesh.position.set(cx, f.h + rise - 0.4, cz);
  } else if (f.roofDir === "n" || f.roofDir === "s") {
    mesh.position.set(f.x + f.w * 0.25, f.h + rise - 0.3, cz);
  } else {
    mesh.position.set(cx, f.h + rise - 0.3, f.z + f.d * 0.25);
  }
  mesh.scale.set(0.9, 2.4, 0.9);
  group.add(mesh);
  const cap = new Mesh(box, GOLD_MAT);
  cap.position.set(mesh.position.x, mesh.position.y + 1.3, mesh.position.z);
  cap.scale.set(1.15, 0.22, 1.15);
  group.add(cap);
}

// A real shop front: glass panes + a gold sign band + a sloped awning.
function addStorefront(group: Group, f: Facade) {
  const face = f.face;
  const alongX = face === "n" || face === "s";
  const span = alongX ? f.w : f.d;
  const paneW = Math.min(span * 0.72, 12);
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  // The glass is the REAL opening in the wall now (hollow() cuts display
  // windows into the storefront face) — the old proud pane on top of a
  // solid wall hid the interior. Only the gold sign band + awning stay.
  const band = new Mesh(box, GOLD_MAT);
  if (face === "n") {
    band.position.set(cx, 3.65, f.z - 0.16);
    band.scale.set(paneW, 0.9, 0.24);
  } else if (face === "s") {
    band.position.set(cx, 3.65, f.z + f.d + 0.16);
    band.scale.set(paneW, 0.9, 0.24);
  } else if (face === "w") {
    band.position.set(f.x - 0.16, 3.65, cz);
    band.scale.set(0.24, 0.9, paneW);
  } else {
    band.position.set(f.x + f.w + 0.16, 3.65, cz);
    band.scale.set(0.24, 0.9, paneW);
  }
  group.add(band);
  if (f.awning) {
    const awn = new Mesh(box, GOLD_MAT);
    const depth = 1.5;
    if (face === "n") {
      awn.position.set(cx, 4.15, f.z - depth / 2 - 0.1);
      awn.scale.set(paneW + 1, 0.1, depth);
      awn.rotation.x = -0.42;
    } else if (face === "s") {
      awn.position.set(cx, 4.15, f.z + f.d + depth / 2 + 0.1);
      awn.scale.set(paneW + 1, 0.1, depth);
      awn.rotation.x = 0.42;
    } else if (face === "w") {
      awn.position.set(f.x - depth / 2 - 0.1, 4.15, cz);
      awn.scale.set(depth, 0.1, paneW + 1);
      awn.rotation.z = 0.42;
    } else {
      awn.position.set(f.x + f.w + depth / 2 + 0.1, 4.15, cz);
      awn.scale.set(depth, 0.1, paneW + 1);
      awn.rotation.z = -0.42;
    }
    awn.castShadow = true;
    group.add(awn);
  }
}

// Gold trim band at the top of the walls.
function addCornice(group: Group, f: Facade) {
  const trim = new Mesh(box, GOLD_MAT);
  trim.position.set(f.x + f.w / 2, f.h - 0.15, f.z + f.d / 2);
  trim.scale.set(f.w + 0.3, 0.35, f.d + 0.3);
  group.add(trim);
}

// A smaller box crowning the roof (the HQ's stepped top).
function addCrownBox(group: Group, f: Facade, material: MeshStandardMaterial) {
  const crown = f.crown;
  if (!crown) return;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const mesh = new Mesh(box, material);
  mesh.position.set(cx, f.h + crown.h / 2, cz);
  mesh.scale.set(crown.w, crown.h, crown.d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const trim = new Mesh(box, GOLD_MAT);
  trim.position.set(cx, f.h + 0.15, cz);
  trim.scale.set(crown.w + 0.3, 0.3, crown.d + 0.3);
  group.add(trim);
}

// Stepped tower tiers (stacked from the ground, centered on the rect).
function addTiers(group: Group, f: Facade, material: MeshStandardMaterial) {
  const tiers = f.tiers;
  if (!tiers) return;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  let y = 0;
  tiers.forEach((tier, index) => {
    const mesh = new Mesh(box, material);
    mesh.position.set(cx, y + tier.h / 2, cz);
    mesh.scale.set(tier.w, tier.h, tier.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (index > 0) {
      const trim = new Mesh(box, GOLD_MAT);
      trim.position.set(cx, y, cz);
      trim.scale.set(tier.w + 0.3, 0.35, tier.d + 0.3);
      group.add(trim);
    }
    y += tier.h;
  });
}

// A side annex (L-shaped footprint) with its own small roof.
function addWing(group: Group, f: Facade, material: MeshStandardMaterial) {
  const wing = f.wing;
  if (!wing) return;
  const wx = f.x + wing.dx;
  const wz = f.z + wing.dz;
  const mesh = new Mesh(box, material);
  mesh.position.set(wx + wing.w / 2, wing.h / 2, wz + wing.d / 2);
  mesh.scale.set(wing.w, wing.h, wing.d);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (wing.roof === "gable") {
    addGableRoof(group, wx, wz, wing.w, wing.d, wing.h, wing.w >= wing.d ? "n" : "e", f.roofMat ?? 0);
  } else if (wing.roof === "hip") {
    addHipRoof(group, wx, wz, wing.w, wing.d, wing.h, f.roofMat ?? 0);
  } else {
    const cap = new Mesh(box, DARK_MAT);
    cap.position.set(wx + wing.w / 2, wing.h + 0.1, wz + wing.d / 2);
    cap.scale.set(wing.w + 0.2, 0.2, wing.d + 0.2);
    group.add(cap);
  }
}

// The roof for one facade: pitched, or the flat parapet kit. Returns the
// ridge height (0 for a flat roof) for the chimney.
function addRoof(group: Group, f: Facade): number {
  if (f.roof === "gable")
    return addGableRoof(group, f.x, f.z, f.w, f.d, f.h, f.roofDir ?? f.face, f.roofMat ?? 0);
  if (f.roof === "hip") return addHipRoof(group, f.x, f.z, f.w, f.d, f.h, f.roofMat ?? 0);
  if (!f.crown) addRoofKit(group, f.x, f.z, f.w, f.d, f.h);
  return 0;
}

function solidTower(facade: Facade) {
  const group = new Group();
  const tiers = [
    { w: 28, d: 26, h: 14 },
    { w: 22, d: 20, h: 12 },
    { w: 17, d: 15, h: 12 },
    { w: 13, d: 11, h: 10 },
    { w: 10, d: 8, h: 8 },
  ];
  const goldTrimMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.35, metalness: 0.7, emissive: 0x6a5208, emissiveIntensity: 0.4 });
  let y = 0;
  tiers.forEach((tier, index) => {
    // Alternate the OrbitX dark identity style with the glass curtain wall.
    const material = facadeMaterial(index % 2 === 0 ? 5 : 0, tier.w, tier.h);
    const mesh = new Mesh(box, material);
    mesh.position.set(0, y + tier.h / 2, -3 - tier.d / 2);
    mesh.scale.set(tier.w, tier.h, tier.d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (index > 0) {
      const trim = new Mesh(box, goldTrimMat);
      trim.position.set(0, y, -3 - tier.d / 2);
      trim.scale.set(tier.w + 0.3, 0.35, tier.d + 0.3);
      group.add(trim);
    }
    y += tier.h;
  });
  // Real glass atrium, proud of the tier-1 front face (the old hidden
  // cylinder inside the solid tiers was invisible from every angle).
  const atrium = new Mesh(
    box,
    new MeshStandardMaterial({
      color: 0x9af6ff,
      emissive: 0x1ad8ff,
      emissiveIntensity: 0.8,
      roughness: 0.12,
      metalness: 0.45,
      transparent: true,
      opacity: 0.72,
    }),
  );
  atrium.position.set(0, 5, -3 + 0.75);
  atrium.scale.set(8, 10, 1.5);
  group.add(atrium);
  // Closed real door in front of the glass atrium (2026-11-12): a wood
  // slab + white frame + gold handles, centred on the porch face. Entry
  // is E at the tower door anchor — the lobby behind it is furnished.
  const towerDoorMat = new MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.65, metalness: 0.1 });
  const towerFrameMat = new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4, metalness: 0.15 });
  const towerHandleMat = new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.3, metalness: 0.7, emissive: 0x6a5208, emissiveIntensity: 0.4 });
  const towerSlab = new Mesh(box, towerDoorMat);
  towerSlab.position.set(0, 1.45, -1.4);
  towerSlab.scale.set(3.4, 2.9, 0.16);
  towerSlab.castShadow = true;
  group.add(towerSlab);
  for (const off of [-1.85, 1.85]) {
    const post = new Mesh(box, towerFrameMat);
    post.position.set(off, 1.55, -1.4);
    post.scale.set(0.35, 3.1, 0.2);
    group.add(post);
  }
  const towerLintel = new Mesh(box, towerFrameMat);
  towerLintel.position.set(0, 3.12, -1.4);
  towerLintel.scale.set(4.3, 0.26, 0.2);
  group.add(towerLintel);
  for (const side of [-0.18, 0.18]) {
    const handle = new Mesh(box, towerHandleMat);
    handle.position.set(1.2, 1.15, -1.4 + side);
    handle.scale.set(0.16, 0.16, 0.16);
    group.add(handle);
  }
  const top = tiers[tiers.length - 1];
  const roofY = y + 1.35;
  const front = orbitWord();
  front.position.set(0, roofY, -2.55);
  group.add(front);
  const back = orbitWord();
  back.position.set(0, roofY, -3 - top.d - 0.4);
  back.rotation.y = Math.PI;
  group.add(back);
  for (const x of [-8, -4, 4, 8]) {
    const col = new Mesh(column, new MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.4, metalness: 0.15 }));
    col.scale.set(1, 6.2, 1);
    col.position.set(x, 3.1, -1.2);
    col.castShadow = true;
    group.add(col);
  }
  const canopy = new Mesh(box, new MeshStandardMaterial({ color: 0x141820, roughness: 0.5, metalness: 0.3 }));
  canopy.scale.set(18, 0.35, 4);
  canopy.position.set(0, 6.2, -1.4);
  group.add(canopy);
  const lip = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0xe9fbff, emissive: 0x5ef3ff, emissiveIntensity: 1.1, roughness: 0.2 }),
  );
  lip.scale.set(18.4, 0.12, 0.25);
  lip.position.set(0, 6.45, 0.4);
  group.add(lip);
  // Beacon pole + cyan beacon on top.
  const pole = new Mesh(box, new MeshStandardMaterial({ color: 0x232a38, roughness: 0.5, metalness: 0.6 }));
  pole.position.set(0, y + 1.6, -3 - top.d / 2);
  pole.scale.set(0.2, 3.2, 0.2);
  group.add(pole);
  const beacon = new Mesh(
    box,
    new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x1ad8ff, emissiveIntensity: 2.4, roughness: 0.2 }),
  );
  beacon.position.set(0, y + 3.4, -3 - top.d / 2);
  beacon.scale.set(0.5, 0.5, 0.5);
  group.add(beacon);
  group.name = facade.id;
  group.userData.hero = true;
  return group;
}

export function mountPretty(facades: Facade[], quality: QualityName) {
  const root = new Group();
  root.name = "pretty-city";
  resetGlassStats();
  const plain = new MeshStandardMaterial({ color: 0x1c2430, roughness: 0.7, metalness: 0.2, emissive: 0x12343f, emissiveIntensity: 0.25 });
  for (const facade of facades) {
    if (facade.glass) {
      if (facade.id.startsWith("home-")) glassStats.homes++;
      else glassStats.offices++;
    }
    // The central tower is the only facade that renders as the stepped
    // solid tower. The mall and HQ are hero too but have their own
    // enterable exteriors — previously all three rendered the same tower
    // mesh three times, stacked on the same spot.
    if (facade.hero && facade.id === "tower") {
      root.add(solidTower(facade));
      continue;
    }
    const material = quality === "low" ? plain : facadeMaterial(facade.style, facade.w, facade.h);
    if (quality !== "low" && facade.tiers) {
      // Stepped tower: the tiers ARE the building; no single flat box.
      addTiers(root, facade, material);
      const top = facade.tiers[facade.tiers.length - 1];
      addRoofKit(
        root,
        facade.x + (facade.w - top.w) / 2,
        facade.z + (facade.d - top.d) / 2,
        top.w,
        top.d,
        facade.h,
      );
      if (facade.wing) addWing(root, facade, material);
      continue;
    }
    if (facade.enterable && facade.door) {
      // Glazing is visual only: the colliders are untouched, so the walls
      // still block walking through except at the door. It runs at every
      // quality — touch defaults to low, and the glass is the point of the
      // pass, so it must show on the user's phone too.
      root.add(hollow(facade, material, !!facade.glass));
    } else {
      const mesh = new Mesh(box, material);
      mesh.position.set(facade.x + facade.w / 2, facade.h / 2, facade.z + facade.d / 2);
      // A hair proud of the voxel shell plane so the overlay never z-fights it.
      mesh.scale.set(facade.w + 0.08, facade.h, facade.d + 0.08);
      mesh.castShadow = quality !== "low";
      mesh.receiveShadow = quality !== "low";
      root.add(mesh);
    }
    if (quality === "low") continue;
    const rise = addRoof(root, facade);
    if (facade.porch) addPorch(root, facade);
    if (facade.chimney) addChimney(root, facade, rise);
    if (facade.storefront) addStorefront(root, facade);
    if (facade.cornice) addCornice(root, facade);
    if (facade.crown) addCrownBox(root, facade, material);
    if (facade.wing) addWing(root, facade, material);
  }
  if (typeof window !== "undefined") {
    (window as unknown as { __ORBITX_GLASS: typeof glassStats }).__ORBITX_GLASS = { ...glassStats };
  }
  return root;
}
