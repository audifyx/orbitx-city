import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Facade, Face } from "./city";
import { porchPosts, porchSlab } from "./city";
import { applyNightGlow, textureFor } from "./materials";
import { makeNeonSign } from "./signs";

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
  // Also drive the shared neon/lamp/water registry in materials.ts.
  applyNightGlow(t);
}

// Deterministic per-cell variation for the facade canvases (no rng
// needed — the 6 canvases are painted once at load and shared by every
// building of the style).
function cellHash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 974634211) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967296;
}

function paintFacade(style: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { map: new CanvasTexture(canvas), glow: new CanvasTexture(canvas) };
  // One canvas = a 10m x 14m module, 8 window rows. The real storefront is
  // 3D (gold band + awning + real glass openings in hollow()/addStorefront),
  // so the canvas carries the upper facade + a string-course band at its foot.
  const s = style % 6;
  const wins: Array<{ x: number; y: number; w: number; h: number; lit: number }> = [];
  const ROWS = 8;
  const rowY = (r: number) => 12 + r * 64;
  if (s === 0) {
    // Glass curtain wall: dark blue glass bands + thin mullions, per-pane
    // tint variation, interior blind/ceiling detail + floor slab lines.
    ctx.fillStyle = "#0d1b26";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < ROWS; row++) {
      const y = rowY(row);
      for (let col = 0; col < 8; col++) {
        const px = 8 + col * 30;
        const v = cellHash(row, col, 0);
        ctx.fillStyle = v < 0.25 ? "#1d4258" : v < 0.6 ? "#16324a" : "#12293d";
        ctx.fillRect(px, y, 28, 42);
        // Interior office ceiling strip + blind slats on lit panes
        if (v < 0.68) {
          ctx.fillStyle = "rgba(180,248,255,0.42)";
          ctx.fillRect(px + 3, y + 3, 22, 3);
          if (v > 0.32) {
            ctx.fillStyle = "rgba(12,26,38,0.35)";
            for (let by = y + 8; by < y + 28; by += 4) ctx.fillRect(px + 2, by, 24, 1.5);
          }
        }
        ctx.fillStyle = "rgba(126,246,255,0.58)";
        ctx.fillRect(px + 2, y + 4, 24, 3);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(px + 3, y + 8, 6, 28);
        ctx.fillStyle = "#0a141d";
        ctx.fillRect(px + 28, y, 2, 42);
        ctx.fillStyle = "#2b3d4f";
        ctx.fillRect(px, y + 21, 28, 1.5);
        wins.push({ x: px, y, w: 28, h: 42, lit: v < 0.7 ? 1 : 0.4 });
      }
      ctx.fillStyle = "#0a141d";
      ctx.fillRect(0, y + 50, 256, 3);
      ctx.fillStyle = "#24384a";
      ctx.fillRect(0, y + 48, 256, 2);
    }
  } else if (s === 1) {
    // Warm brick residential: REAL brick courses (8px courses, 16px
    // bricks, staggered, each brick a varied terracotta/tan) + warm-lit
    // sash windows with stone keystones, sills, lintels and corner quoins.
    const BRICK = ["#8a4a34", "#9a5540", "#7a3f2c", "#a05a3a", "#b07a52", "#6e3a28", "#96502f", "#c07a4a"];
    ctx.fillStyle = "#5e3222";
    ctx.fillRect(0, 0, 256, 512);
    const courseH = 8;
    const brickW = 16;
    for (let r = 0; r * courseH < 512; r++) {
      const y = r * courseH;
      const off = r % 2 === 0 ? 0 : brickW / 2;
      for (let c = -1; c <= 256 / brickW; c++) {
        const x = off + c * brickW;
        ctx.fillStyle = BRICK[Math.floor(cellHash(r, c, 1) * BRICK.length)];
        ctx.fillRect(x + 1, y + 1, brickW - 2, courseH - 2);
        ctx.fillStyle = "rgba(255,255,255,0.11)";
        ctx.fillRect(x + 1, y + 1, brickW - 2, 2);
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        ctx.fillRect(x + 1, y + courseH - 3, brickW - 2, 2);
      }
      // Corner ashlar quoin blocks on alternating double-courses
      if (Math.floor(r / 2) % 2 === 0) {
        ctx.fillStyle = "#d8cfb8";
        ctx.fillRect(0, y, 10, courseH - 1);
        ctx.fillRect(246, y, 10, courseH - 1);
      }
    }
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 22 + col * 74;
        const y = rowY(row);
        const lit = cellHash(row, col, 11);
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x - 3, y - 3, 34, 42);
        ctx.fillStyle = lit < 0.55 ? "#ffd9a0" : lit < 0.8 ? "#c98d4e" : "#3a2a1a";
        ctx.fillRect(x, y, 28, 36);
        if (lit < 0.55) {
          ctx.fillStyle = "rgba(120,70,40,0.48)";
          ctx.fillRect(x + 2, y + 2, 9, 32);
          ctx.fillRect(x + 19, y + 2, 7, 16);
        }
        // Double-hung sash muntin crossbars
        ctx.fillStyle = "#2a1a12";
        ctx.fillRect(x + 13, y, 2, 36);
        ctx.fillRect(x, y + 17, 28, 2);
        ctx.fillStyle = "rgba(244,247,251,0.55)";
        ctx.fillRect(x + 1, y + 17, 26, 1);
        // Stone sill + lintel with raised central keystone
        ctx.fillStyle = "#d8cfb8";
        ctx.fillRect(x - 5, y + 36, 38, 4);
        ctx.fillRect(x - 3, y - 8, 34, 5);
        ctx.fillStyle = "#ece4d0";
        ctx.fillRect(x + 10, y - 10, 8, 7);
        wins.push({ x, y, w: 28, h: 36, lit: lit < 0.55 ? 1 : lit < 0.8 ? 0.6 : 0.15 });
      }
    }
  } else if (s === 2) {
    // Concrete ribbon windows: architectural precast panels with tie-rod
    // dimples, full-width dark bands, sub-mullions, sill + floor slab lines.
    ctx.fillStyle = "#b8bcc0";
    ctx.fillRect(0, 0, 256, 512);
    for (let p = 0; p < 4; p++) {
      const v = cellHash(0, p, 2);
      ctx.fillStyle = v < 0.5 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(p * 64, 0, 64, 512);
      ctx.fillStyle = "#9aa0a6";
      ctx.fillRect(p * 64, 0, 2, 512);
      // Precast tie-rod holes
      ctx.fillStyle = "rgba(60,66,74,0.45)";
      for (let row = 0; row < ROWS; row++) {
        const py = rowY(row) + 42;
        ctx.fillRect(p * 64 + 10, py, 3, 3);
        ctx.fillRect(p * 64 + 50, py, 3, 3);
      }
    }
    for (let row = 0; row < ROWS; row++) {
      const y = rowY(row);
      ctx.fillStyle = "#232a30";
      ctx.fillRect(10, y, 236, 32);
      ctx.fillStyle = "#3d4a55";
      ctx.fillRect(14, y + 4, 228, 5);
      ctx.fillStyle = "rgba(215,221,232,0.55)";
      ctx.fillRect(14, y + 14, 228, 2);
      for (let m = 0; m < 8; m++) {
        const mv = cellHash(row, m, 22);
        if (mv < 0.65) {
          ctx.fillStyle = "rgba(191,230,255,0.32)";
          ctx.fillRect(12 + m * 29, y + 6, 24, 20);
        }
      }
      ctx.fillStyle = "#181d22";
      for (let m = 1; m < 8; m++) ctx.fillRect(10 + m * 30, y, 2.5, 32);
      ctx.fillStyle = "#d7dde8";
      ctx.fillRect(8, y + 32, 240, 4);
      ctx.fillStyle = "#9aa0a6";
      ctx.fillRect(0, y + 50, 256, 3);
      wins.push({ x: 10, y, w: 236, h: 32, lit: 0.72 });
    }
  } else if (s === 3) {
    // Cream stone modern: limestone coursing + fluted pilasters with capitals,
    // dentil cornice, casement windows with transoms and sills.
    ctx.fillStyle = "#e8e0cc";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#d8cfb8";
    for (let y = 16; y < 512; y += 16) ctx.fillRect(0, y, 256, 1);
    for (let r = 0; r < 32; r++) {
      const y = r * 16;
      const off = r % 2 === 0 ? 0 : 32;
      for (let x = off; x < 256; x += 64) ctx.fillRect(x, y, 1, 16);
    }
    for (let col = 0; col <= 4; col++) {
      ctx.fillStyle = "#d8cfb8";
      ctx.fillRect(col * 64 - 6, 0, 12, 512);
    }
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < 4; col++) {
        const x = 20 + col * 60;
        const y = rowY(row);
        const lit = cellHash(row, col, 3);
        ctx.fillStyle = "#1d2733";
        ctx.fillRect(x - 2, y - 2, 40, 44);
        ctx.fillStyle = lit < 0.5 ? "#ffdba8" : "#5a6a7a";
        ctx.fillRect(x, y, 36, 40);
        ctx.fillStyle = "rgba(232,224,204,0.75)";
        ctx.fillRect(x + 3, y + 3, 30, 5);
        // French casement vertical + transom bars
        ctx.fillStyle = "#1d2733";
        ctx.fillRect(x + 17, y, 2, 40);
        ctx.fillRect(x, y + 12, 36, 2);
        // Molded stone header + sill
        ctx.fillStyle = "#cfc4a8";
        ctx.fillRect(x - 4, y - 6, 44, 4);
        ctx.fillStyle = "#f2ece0";
        ctx.fillRect(x - 3, y + 40, 42, 4);
        wins.push({ x, y, w: 36, h: 40, lit: lit < 0.5 ? 0.85 : 0.4 });
      }
    }
  } else if (s === 4) {
    // Neon commercial: dark base, glowing panes, spandrel grilles + gold/cyan floor lines.
    ctx.fillStyle = "#0c0f16";
    ctx.fillRect(0, 0, 256, 512);
    for (let row = 0; row < ROWS; row++) {
      const y = rowY(row);
      for (let col = 0; col < 3; col++) {
        const x = 16 + col * 80;
        const lit = cellHash(row, col, 4);
        ctx.fillStyle = "#12303f";
        ctx.fillRect(x, y, 56, 42);
        ctx.fillStyle = lit < 0.5 ? "#7ef6ff" : lit < 0.8 ? "#2fa8cc" : "#1a5a70";
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 4, y + 4, 48, 32);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#0c0f16";
        ctx.fillRect(x + 27, y + 4, 2, 32);
        ctx.fillStyle = "rgba(255,255,255,0.68)";
        ctx.fillRect(x + 8, y + 10, 40, 3);
        wins.push({ x: x + 4, y: y + 4, w: 48, h: 32, lit: lit < 0.5 ? 1 : 0.6 });
      }
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(0, y + 50, 256, 2);
    }
  } else {
    // Dark OrbitX identity: cyan windows with white frames, brushed panel
    // seams, gold floor lines.
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = "#1a202c";
    for (let px = 64; px < 256; px += 64) ctx.fillRect(px - 1, 0, 2, 512);
    for (let row = 0; row < ROWS; row++) {
      const y = rowY(row);
      for (let col = 0; col < 4; col++) {
        const x = 18 + col * 60;
        const lit = cellHash(row, col, 5);
        ctx.fillStyle = "#12343f";
        ctx.fillRect(x, y, 44, 38);
        if (lit < 0.7) {
          ctx.fillStyle = lit < 0.35 ? "#7ef6ff" : "#49c8e8";
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x + 4, y + 4, 36, 26);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.fillRect(x + 6, y + 7, 32, 2);
        }
        ctx.fillStyle = "#10141c";
        ctx.fillRect(x + 21, y + 4, 2, 26);
        ctx.strokeStyle = "#f4f7fb";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 44, 38);
        wins.push({ x: x + 4, y: y + 4, w: 36, h: 26, lit: lit < 0.35 ? 1 : lit < 0.7 ? 0.7 : 0.1 });
      }
      ctx.fillStyle = "#e0b33a";
      ctx.fillRect(0, y + 50, 256, 2);
    }
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.anisotropy = 8;
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 256;
  glowCanvas.height = 512;
  const g = glowCanvas.getContext("2d");
  const glow = new CanvasTexture(glowCanvas);
  if (g) {
    g.clearRect(0, 0, 256, 512);
    g.fillStyle = s === 1 || s === 3 ? "#ffc27a" : s === 2 ? "#bfe6ff" : "#7ef6ff";
    for (const w of wins) {
      g.globalAlpha = w.lit;
      g.fillRect(w.x, w.y, w.w, w.h);
    }
    g.globalAlpha = 1;
    glow.colorSpace = SRGBColorSpace;
    glow.wrapS = RepeatWrapping;
    glow.wrapT = RepeatWrapping;
    glow.anisotropy = 4;
  }
  return { map, glow };
}

const paints = [0, 1, 2, 3, 4, 5].map((style) => paintFacade(style));

const STYLE_EMISSIVE = [0x9af6ff, 0xffc27a, 0xbfe6ff, 0xffc27a, 0x9af6ff, 0x9af6ff];

// Procedural tileable roof textures: slate shingles, terracotta clay barrel
// tiles, standing-seam architectural steel, and gold standing-seam crown.
function paintRoofTex(kind: number): CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  if (kind === 0) {
    // Dark architectural slate shingles
    const SLATE = ["#1e232b", "#232830", "#282e38", "#1a1f26", "#2c333e"];
    ctx.fillStyle = "#161a20";
    ctx.fillRect(0, 0, 256, 256);
    const ch = 16;
    const sw = 32;
    for (let r = 0; r < 16; r++) {
      const y = r * ch;
      const off = r % 2 === 0 ? 0 : sw / 2;
      for (let c = -1; c <= 8; c++) {
        const x = off + c * sw;
        ctx.fillStyle = SLATE[Math.floor(cellHash(r, c, 31) * SLATE.length)];
        ctx.fillRect(x + 1, y + 1, sw - 2, ch - 2);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(x + 1, y + 1, sw - 2, 2);
        ctx.fillStyle = "rgba(0,0,0,0.32)";
        ctx.fillRect(x + 1, y + ch - 3, sw - 2, 2);
      }
    }
  } else if (kind === 1) {
    // Terracotta clay barrel tiles
    const CLAY = ["#8a4a34", "#9e563d", "#7c3f2b", "#ac5e42", "#924f38"];
    ctx.fillStyle = "#5c2d1e";
    ctx.fillRect(0, 0, 256, 256);
    const ch = 22;
    const bw = 20;
    for (let r = 0; r <= 12; r++) {
      const y = r * ch;
      for (let c = 0; c <= 13; c++) {
        const x = c * bw;
        ctx.fillStyle = CLAY[Math.floor(cellHash(r, c, 32) * CLAY.length)];
        ctx.fillRect(x + 1, y + 1, bw - 2, ch - 2);
        ctx.fillStyle = "rgba(255,220,190,0.18)";
        ctx.fillRect(x + 5, y + 1, 6, ch - 3);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(x + bw - 4, y + 1, 3, ch - 2);
        ctx.fillRect(x + 1, y + ch - 3, bw - 2, 2);
      }
    }
  } else if (kind === 2) {
    // Standing-seam architectural steel roof
    ctx.fillStyle = "#3a4a5c";
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = x % 32 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
      ctx.fillRect(x, 0, 16, 256);
      ctx.fillStyle = "#24303d";
      ctx.fillRect(x, 0, 2, 256);
      ctx.fillStyle = "rgba(220,235,255,0.18)";
      ctx.fillRect(x + 2, 0, 1.5, 256);
    }
    ctx.fillStyle = "rgba(20,28,36,0.28)";
    for (let y = 0; y < 256; y += 64) ctx.fillRect(0, y, 256, 2);
  } else {
    // Gold anodized standing-seam crown roof
    ctx.fillStyle = "#e0b33a";
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = "#9e7818";
      ctx.fillRect(x, 0, 2, 256);
      ctx.fillStyle = "rgba(255,248,210,0.32)";
      ctx.fillRect(x + 2, 0, 2, 256);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 8;
  return tex;
}

// Shared roof / trim materials (one instance per colour, with procedural tile/seam maps).
const ROOF_MATS = [0x232830, 0x8a4a34, 0x3a4a5c, 0xe0b33a].map((color, idx) => {
  const tex = paintRoofTex(idx);
  return new MeshStandardMaterial({
    color: tex ? 0xffffff : color,
    map: tex,
    roughness: idx >= 2 ? 0.45 : 0.62,
    metalness: idx === 3 ? 0.55 : idx === 2 ? 0.38 : 0.15,
  });
});
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
/** Round 4: cool unlit office glass (upper window bands) + gold /
 * magenta accent curtain glass — per-cell window variation so towers
 * don't share one flat glass read. Palette stays restrained: cyan,
 * warm, gold, magenta — the video frames' neon, no rainbow. */
const COOL_GLASS_MAT = new MeshStandardMaterial({
  color: 0x1a2f44,
  emissive: 0x0a2a44,
  emissiveIntensity: 0.15,
  roughness: 0.08,
  metalness: 0.5,
  transparent: true,
  opacity: 0.6,
});
const GOLD_GLASS_MAT = new MeshStandardMaterial({
  color: 0xffd98a,
  emissive: 0xffb347,
  emissiveIntensity: 0.35,
  roughness: 0.08,
  metalness: 0.45,
  transparent: true,
  opacity: 0.55,
});
const MAGENTA_GLASS_MAT = new MeshStandardMaterial({
  color: 0xff9ed2,
  emissive: 0xff2ea6,
  emissiveIntensity: 0.35,
  roughness: 0.08,
  metalness: 0.45,
  transparent: true,
  opacity: 0.55,
});
const FRAME_MAT = new MeshStandardMaterial({ color: 0x1a2028, roughness: 0.5, metalness: 0.4 });
nightMats.push({ mat: WINDOW_GLASS_MAT, day: 0.3, night: 1.9 });
nightMats.push({ mat: CURTAIN_GLASS_MAT, day: 0.35, night: 1.5 });
nightMats.push({ mat: COOL_GLASS_MAT, day: 0.15, night: 0.5 });
nightMats.push({ mat: GOLD_GLASS_MAT, day: 0.35, night: 1.6 });
nightMats.push({ mat: MAGENTA_GLASS_MAT, day: 0.35, night: 1.6 });

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
const STONE_TRIM_MAT = new MeshStandardMaterial({ color: 0xd5dae2, roughness: 0.62, metalness: 0.1 });
const FOLIAGE_MAT = new MeshStandardMaterial({ color: 0x37b24a, roughness: 0.75, metalness: 0.05 });
{
  const stucco = textureFor("stucco");
  if (stucco) {
    WHITE_MAT.color.set(0xffffff);
    WHITE_MAT.map = stucco;
  }
  const wood = textureFor("wood");
  if (wood) {
    WOOD_MAT.color.set(0xffffff);
    WOOD_MAT.map = wood;
  }
  const stone = textureFor("stone");
  if (stone) {
    STONE_TRIM_MAT.color.set(0xffffff);
    STONE_TRIM_MAT.map = stone;
  }
  const foliage = textureFor("foliage");
  if (foliage) {
    FOLIAGE_MAT.color.set(0xffffff);
    FOLIAGE_MAT.map = foliage;
  }
}
const DARK_MAT = new MeshStandardMaterial({ color: 0x141820, roughness: 0.65, metalness: 0.25 });
const METAL_MAT = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.55, metalness: 0.45 });
const POLE_MAT = new MeshStandardMaterial({ color: 0x232a38, roughness: 0.5, metalness: 0.6 });
const DOOR_SLAB_MAT = new MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.62, metalness: 0.12 });
const LANTERN_MAT = new MeshStandardMaterial({
  color: 0xffe4b0,
  emissive: 0xffb347,
  emissiveIntensity: 1.35,
  roughness: 0.2,
  metalness: 0.1,
});
const CYAN_BEACON_MAT = new MeshStandardMaterial({
  color: 0x9af6ff,
  emissive: 0x1ad8ff,
  emissiveIntensity: 2.2,
  roughness: 0.2,
});
nightMats.push({ mat: LANTERN_MAT, day: 0.85, night: 2.3 });
nightMats.push({ mat: CYAN_BEACON_MAT, day: 1.2, night: 2.6 });

// Round 3: neon spill — additive glow pools faking the wet-asphalt
// reflection of shop signage (no real reflections in WebGL on a phone).
// Cyan / magenta alternate by shop, matching the frame palette.
const SPILL_MATS = [
  new MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.13, blending: AdditiveBlending, depthWrite: false }),
  new MeshBasicMaterial({ color: 0xff2ea6, transparent: true, opacity: 0.13, blending: AdditiveBlending, depthWrite: false }),
];

const SHUTTER_MATS = [
  new MeshStandardMaterial({ color: 0x1d3248, roughness: 0.6, metalness: 0.15 }),
  new MeshStandardMaterial({ color: 0x1f4232, roughness: 0.6, metalness: 0.15 }),
  new MeshStandardMaterial({ color: 0x522620, roughness: 0.6, metalness: 0.15 }),
];

// Shop-interior goods (world-quality upgrade 2026-11-13): bright, slightly
// emissive so they read through the tinted storefront glass.
const GOODS_MATS = [
  new MeshStandardMaterial({ color: 0xe0392f, roughness: 0.5, metalness: 0.1, emissive: 0x5a0f0a, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0x1ad8ff, roughness: 0.5, metalness: 0.1, emissive: 0x0a4a5a, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0x37b24a, roughness: 0.5, metalness: 0.1, emissive: 0x0f3a16, emissiveIntensity: 0.5 }),
  new MeshStandardMaterial({ color: 0xe0b33a, roughness: 0.5, metalness: 0.1, emissive: 0x6a5208, emissiveIntensity: 0.5 }),
];

type BoxTuple = [number, number, number, number, number, number];
function addMergedBoxes(group: Group, boxes: BoxTuple[], mat: MeshStandardMaterial, castShadow = false) {
  if (boxes.length === 0) return;
  const geos = boxes.map(([px, py, pz, sx, sy, sz]) => {
    const g = new BoxGeometry(sx, sy, sz);
    g.translate(px, py, pz);
    return g;
  });
  const merged = mergeGeometries(geos) ?? geos[0];
  const mesh = new Mesh(merged, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  for (const g of geos) if (g !== merged) g.dispose();
}

type UvBoxTuple = [
  number,
  number,
  number,
  number,
  number,
  number,
  number?,
  number?,
  number?,
];

function worldUvBox(
  px: number,
  py: number,
  pz: number,
  sx: number,
  sy: number,
  sz: number,
  tileU = 10,
  tileV = 14,
  originX = px - sx / 2,
  originY = py - sy / 2,
  originZ = pz - sz / 2,
): BufferGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  g.translate(px, py, pz);
  const pos = g.attributes.position;
  const norm = g.attributes.normal;
  const uv = g.attributes.uv;
  if (pos && norm && uv) {
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const nx = Math.abs(norm.getX(i));
      const ny = Math.abs(norm.getY(i));
      if (nx > 0.5) {
        uv.setXY(i, (vz - originZ) / tileU, (vy - originY) / tileV);
      } else if (ny > 0.5) {
        uv.setXY(i, (vx - originX) / tileU, (vz - originZ) / tileU);
      } else {
        uv.setXY(i, (vx - originX) / tileU, (vy - originY) / tileV);
      }
    }
    uv.needsUpdate = true;
  }
  return g;
}

function addWorldUvBoxes(
  group: Group,
  boxes: UvBoxTuple[],
  mat: MeshStandardMaterial,
  tileU: number,
  tileV: number,
  castShadow = true,
) {
  if (boxes.length === 0) return;
  const geos = boxes.map(([px, py, pz, sx, sy, sz, ox, oy, oz]) =>
    worldUvBox(px, py, pz, sx, sy, sz, tileU, tileV, ox, oy, oz),
  );
  const merged = mergeGeometries(geos) ?? geos[0];
  const mesh = new Mesh(merged, mat);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  for (const g of geos) if (g !== merged) g.dispose();
}

// Shared upper-facade materials (one per style, registered once in nightMats,
// tiled via world-space UVs so zero CanvasTextures are cloned per building).
const FACADE_MATS: MeshStandardMaterial[] = paints.map((src, idx) => {
  const mat = new MeshStandardMaterial({
    map: src.map,
    emissiveMap: src.glow,
    emissive: STYLE_EMISSIVE[idx % STYLE_EMISSIVE.length],
    emissiveIntensity: 0.55,
    roughness: 0.42,
    metalness: 0.28,
  });
  nightMats.push({ mat, day: 0.35, night: 1.7 });
  return mat;
});

// Shared ground-floor / residential masonry & cladding materials (no baked 2D
// window grid, so 3D windows, shutters, and doors sit on clean architecture).
const BASE_WALL_MATS: MeshStandardMaterial[] = [
  new MeshStandardMaterial({
    color: 0x223244,
    map: textureFor("darkSurface"),
    roughness: 0.44,
    metalness: 0.38,
  }),
  new MeshStandardMaterial({
    color: 0xffffff,
    map: textureFor("brick"),
    roughness: 0.72,
    metalness: 0.08,
  }),
  new MeshStandardMaterial({
    color: 0xd8e0ea,
    map: textureFor("concrete"),
    roughness: 0.52,
    metalness: 0.24,
  }),
  new MeshStandardMaterial({
    color: 0xffffff,
    map: textureFor("stone"),
    roughness: 0.62,
    metalness: 0.1,
  }),
  new MeshStandardMaterial({
    color: 0x263246,
    map: textureFor("darkSurface"),
    roughness: 0.48,
    metalness: 0.32,
  }),
  new MeshStandardMaterial({
    color: 0x1c2636,
    map: textureFor("darkSurface"),
    roughness: 0.4,
    metalness: 0.42,
  }),
];

function facadeMaterial(style: number, _w?: number, _h?: number) {
  return FACADE_MATS[style % FACADE_MATS.length];
}

function baseWallMaterial(facade: Facade): MeshStandardMaterial {
  if (facade.glass === "home" || facade.porch) {
    // Homes alternate warm brick, ashlar limestone, and painted stucco/clapboard
    const idx = Math.abs(Math.round(facade.x + facade.z) + facade.style) % 3;
    if (idx === 0) return BASE_WALL_MATS[1];
    if (idx === 1) return BASE_WALL_MATS[3];
    return WHITE_MAT;
  }
  return BASE_WALL_MATS[facade.style % BASE_WALL_MATS.length];
}

// ---- glazing pass on the hollow shell ----
interface WallOpening {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  door?: boolean;
}

// ---- round-2 de-boxing: tapered frustum shells + stepped hollow shells ----

/** A square frustum shell (tapered tower top): 4 trapezoid planes from the
 * base rect to a smaller top rect, canvas texture tiled in world units
 * like worldUvBox, plus a thin cap slab that seals the open top under
 * the roof kit. Open at the bottom — it sits on the step below. */
function addFrustum(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  y0: number,
  h: number,
  topScale: number,
  mat: MeshStandardMaterial,
) {
  const cx = x + w / 2;
  const cz = z + d / 2;
  const geo = new CylinderGeometry(topScale, 1, 1, 4, 1, true);
  geo.rotateY(Math.PI / 4);
  geo.scale(w / Math.SQRT2, h, d / Math.SQRT2);
  geo.translate(cx, y0 + h / 2, cz);
  geo.computeVertexNormals();
  // Re-tile the canvas texture in world units (same rule as worldUvBox).
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (pos && norm && uv) {
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const nx = Math.abs(norm.getX(i));
      if (nx > 0.5) uv.setXY(i, (vz - z) / 10, (vy - y0) / 14);
      else uv.setXY(i, (vx - x) / 10, (vy - y0) / 14);
    }
    uv.needsUpdate = true;
  }
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const cap = new Mesh(
    worldUvBox(cx, y0 + h + 0.15, cz, w * topScale + 0.2, 0.3, d * topScale + 0.2, 10, 14),
    DARK_MAT,
  );
  cap.castShadow = true;
  cap.receiveShadow = true;
  group.add(cap);
}

/** Round 4: split a window band into per-window cells between the
 * mullions (mullions every 2.9u from origin+1.8, matching the frame
 * boxes below). Returns [start, end] pairs along the band. */
function windowCells(origin: number, span: number): Array<[number, number]> {
  const mullions: number[] = [];
  for (let a = origin + 1.8; a < origin + span - 1.5; a += 2.9) mullions.push(a);
  const edges = [origin + 0.5, ...mullions.flatMap((m) => [m - 0.07, m + 0.07]), origin + span - 0.5];
  const cells: Array<[number, number]> = [];
  for (let i = 0; i + 1 < edges.length; i += 2) {
    const c0 = edges[i]!;
    const c1 = edges[i + 1]!;
    if (c1 - c0 >= 0.5) cells.push([c0, c1]);
  }
  return cells;
}

/** Round 4: which glass a curtain cell gets — cool curtain by default,
 * warm-lit on ~2 of 5 cells, gold on style-5 (OrbitX identity) accent
 * cells, magenta on style-4 (neon commercial) accent cells. */
function curtainCellMat(style: number, cellIdx: number, seed: number): MeshStandardMaterial {
  const roll = (cellIdx * 7 + seed) % 5;
  if (roll < 2) return WINDOW_GLASS_MAT;
  if (style === 5 && roll === 2) return GOLD_GLASS_MAT;
  if (style === 4 && roll === 2) return MAGENTA_GLASS_MAT;
  return CURTAIN_GLASS_MAT;
}

/** Glass curtain bands on one step's upper walls (office towers only) —
 * the same bands hollow() paints on the ground shell, factored out so
 * stepped upper steps get them too. yStart/yEnd are absolute. */
function addCurtainBands(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  yStart: number,
  yEnd: number,
  style = 0,
) {
  // Round 4: the band is no longer one continuous glass strip — each
  // window is its own cell (warm-lit / cool / gold / magenta by style),
  // divided by real mullions. Glass is merged per material (4 meshes
  // per call, whatever the cell count), so draw calls stay flat.
  const warmBoxes: BoxTuple[] = [];
  const coolBoxes: BoxTuple[] = [];
  const goldBoxes: BoxTuple[] = [];
  const magentaBoxes: BoxTuple[] = [];
  const mullionBoxes: BoxTuple[] = [];
  const seed = Math.abs(Math.round(x * 3 + z * 7));
  for (let y = yStart; y + 0.9 < yEnd - 0.4; y += 4) {
    const floorIdx = Math.round((y - yStart) / 4);
    for (const face of ["n", "s", "w", "e"] as const) {
      const alongX = face === "n" || face === "s";
      const span = alongX ? w : d;
      const origin = alongX ? x : z;
      const mid = origin + span / 2;
      const len = span - 1;
      const off = 0.06;
      const plane = face === "n" ? z - off : face === "s" ? z + d + off : face === "w" ? x - off : x + w + off;
      const framePlane = plane + (face === "n" || face === "w" ? -0.02 : 0.02);
      const cells = windowCells(origin, span);
      cells.forEach(([c0, c1], cellIdx) => {
        const cm = (c0 + c1) / 2;
        const cw = c1 - c0;
        const mat = curtainCellMat(style, cellIdx + floorIdx * 3, seed);
        const arr = mat === WINDOW_GLASS_MAT ? warmBoxes : mat === GOLD_GLASS_MAT ? goldBoxes : mat === MAGENTA_GLASS_MAT ? magentaBoxes : coolBoxes;
        if (alongX) arr.push([cm, y, plane, cw, 1.8, 0.1]);
        else arr.push([plane, y, cm, 0.1, 1.8, cw]);
      });
      // Mullions between the cells, proud of the glass.
      for (let a = origin + 1.8; a < origin + span - 1.5; a += 2.9) {
        if (alongX) mullionBoxes.push([a, y, plane - (face === "n" ? 0.02 : -0.02), 0.14, 1.8, 0.12]);
        else mullionBoxes.push([plane - (face === "w" ? 0.02 : -0.02), y, a, 0.12, 1.8, 0.14]);
      }
      // Rails + side stiles (the cached band frame, one mesh per band).
      if (face === "n") frameMesh(group, len, 1.8, mid, y, framePlane, faceRotY(face), true);
      else if (face === "s") frameMesh(group, len, 1.8, mid, y, framePlane, faceRotY(face), true);
      else if (face === "w") frameMesh(group, len, 1.8, framePlane, y, mid, faceRotY(face), true);
      else frameMesh(group, len, 1.8, framePlane, y, mid, faceRotY(face), true);
      glassStats.panes++;
    }
  }
  addMergedBoxes(group, warmBoxes, WINDOW_GLASS_MAT, false);
  addMergedBoxes(group, coolBoxes, CURTAIN_GLASS_MAT, false);
  addMergedBoxes(group, goldBoxes, GOLD_GLASS_MAT, false);
  addMergedBoxes(group, magentaBoxes, MAGENTA_GLASS_MAT, false);
  addMergedBoxes(group, mullionBoxes, FRAME_MAT, false);
}

/**
 * Recessed 3D window bands on upper floors (round 3) — for towers whose
 * upper walls are otherwise one flat textured box. The facade canvas is
 * a 10u x 14u module with 8 painted window rows (row centres at
 * y0 + 0.9 + r*1.75), and wall UVs are world-aligned, so these bands sit
 * exactly on every other painted row: the dark backing hides the painted
 * window behind it, the glass sits proud of the backing, and the frame
 * rails + mullions + sill stand prouder still — a real recess with
 * depth, not a texture. Curtain-glass towers already get
 * addCurtainBands; tapered frustums carry their own glass canvas.
 * Merged: 3 meshes per shell segment, whatever the floor count.
 * `faces` skips faces with a proud feature in front (the hero tower's
 * atrium). The bands are mounted proud of the wall, never cut through
 * it, so interior liners are never exposed.
 */
function addUpperWindowBands(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
  faces: Face[] = ["n", "s", "w", "e"],
) {
  if (y1 - y0 < 3.5) return;
  const frameBoxes: BoxTuple[] = [];
  const warmGlassBoxes: BoxTuple[] = [];
  const coolGlassBoxes: BoxTuple[] = [];
  const backBoxes: BoxTuple[] = [];
  let bands = 0;
  for (let cy = y0 + 2.65; cy + 0.65 < y1 - 0.3; cy += 3.5) {
    for (const face of faces) {
      const alongX = face === "n" || face === "s";
      const span = alongX ? w : d;
      if (span < 4) continue;
      const origin = alongX ? x : z;
      const outSign = face === "n" || face === "w" ? -1 : 1;
      const plane = face === "n" ? z : face === "s" ? z + d : face === "w" ? x : x + w;
      const len = span - 1.0;
      const mid = origin + span / 2;
      // One box at (a, y), `off` out from the wall plane, `sa` along
      // the wall, `so` out from it.
      const boxAt = (arr: BoxTuple[], a: number, y: number, off: number, sa: number, sy: number, so: number) => {
        if (alongX) arr.push([a, y, plane + outSign * off, sa, sy, so]);
        else arr.push([plane + outSign * off, y, a, so, sy, sa]);
      };
      // Layers, outward from the wall: dark backing (front +0.03),
      // glass (+0.055), frame front (+0.11) — the glass reads recessed
      // 0.05 behind the frame.
      boxAt(backBoxes, mid, cy, 0.01, len, 1.3, 0.04);
      // Round 4: the glass is no longer one continuous strip — each
      // window is its own pane, ~40% warm-lit, the rest cool unlit
      // office glass, so the band reads as individual windows.
      const seed = Math.abs(Math.round(x * 3 + z * 7 + cy * 2));
      windowCells(origin, span).forEach(([c0, c1], cellIdx) => {
        const lit = ((cellIdx * 7 + seed) % 5) < 2;
        boxAt(lit ? warmGlassBoxes : coolGlassBoxes, (c0 + c1) / 2, cy, 0.035, c1 - c0, 1.14, 0.04);
      });
      boxAt(frameBoxes, mid, cy + 0.65, 0.05, len, 0.14, 0.12);
      boxAt(frameBoxes, mid, cy - 0.65, 0.05, len, 0.14, 0.12);
      boxAt(frameBoxes, mid, cy - 0.72, 0.08, len + 0.2, 0.12, 0.3);
      for (let a = origin + 1.8; a < origin + span - 1.5; a += 2.9) {
        boxAt(frameBoxes, a, cy, 0.05, 0.14, 1.3, 0.12);
      }
      bands++;
    }
  }
  if (bands === 0) return;
  addMergedBoxes(group, backBoxes, DARK_MAT, false);
  addMergedBoxes(group, warmGlassBoxes, WINDOW_GLASS_MAT, false);
  addMergedBoxes(group, coolGlassBoxes, COOL_GLASS_MAT, false);
  addMergedBoxes(group, frameBoxes, FRAME_MAT, false);
  glassStats.panes += bands;
}

/** Corner pilasters for one step — the stepped shell's replacement for
 * addArchitecturalDetails, whose full-height pilasters + belt courses
 * would float past the setbacks. */
function stepTrim(
  group: Group,
  x: number,
  z: number,
  w: number,
  d: number,
  y0: number,
  h: number,
  mat: MeshStandardMaterial,
) {
  const trimBoxes: BoxTuple[] = [];
  for (const px of [x + 0.04, x + w - 0.04]) {
    for (const pz of [z + 0.04, z + d - 0.04]) {
      trimBoxes.push([px, y0 + h / 2, pz, 0.34, h, 0.34]);
      trimBoxes.push([px, y0 + 0.32, pz, 0.46, 0.64, 0.46]);
      trimBoxes.push([px, y0 + h - 0.22, pz, 0.48, 0.44, 0.48]);
    }
  }
  addMergedBoxes(group, trimBoxes, mat, false);
}

/** Rounded glass corner columns: vertical glass cylinders at a step's
 * corners, so the base reads curved, not square. */
function addCornerColumns(group: Group, f: Facade, y0: number, y1: number) {
  const h = y1 - y0;
  if (h <= 0.5) return;
  const geo = new CylinderGeometry(0.5, 0.5, 1, 12);
  for (const px of [f.x, f.x + f.w]) {
    for (const pz of [f.z, f.z + f.d]) {
      const m = new Mesh(geo, CURTAIN_GLASS_MAT);
      m.position.set(px, y0 + h / 2, pz);
      m.scale.set(1, h, 1);
      group.add(m);
    }
  }
}

/** A stepped enterable tower: one hollow segment per recorded step.
 * Ground step = the full hollow() shell (door gap, windows, storefront
 * interior, roof cap as the setback ledge). Upper steps are sealed
 * hollow walls with curtain bands, corner pilasters, and a gold-edged
 * ledge slab at each setback; the top step tapers when facade.taper is
 * set. */
function steppedHollow(facade: Facade, material: MeshStandardMaterial, glaze: boolean) {
  const steps = facade.steps!;
  const group = new Group();
  const ground = steps[0]!;
  const groundTop = ground.y0 + ground.h;
  // Ground step: full hollow shell, cut down to the first step's height.
  // Taper + rounded corners are stripped here — taper belongs to the top
  // step only, and the corner columns are added below at full ground
  // height (hollow() would only run them to baseH).
  const groundFacade: Facade = { ...facade, h: groundTop, steps: undefined, taper: undefined, roundedCorners: undefined };
  group.add(hollow(groundFacade, material, glaze));
  const trimMat = facade.style === 1 || facade.style === 3 ? STONE_TRIM_MAT : DARK_MAT;
  const ledgeGold: BoxTuple[] = [
    [facade.x + facade.w / 2, groundTop + 0.06, facade.z + facade.d / 2, facade.w + 0.45, 0.12, facade.d + 0.45],
  ];
  if (!facade.roundedCorners) {
    stepTrim(group, facade.x, facade.z, facade.w, facade.d, 0, ground.h, trimMat);
  } else {
    addCornerColumns(group, facade, 0, groundTop);
  }
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i]!;
    const top = s.y0 + s.h;
    const isTop = i === steps.length - 1;
    const taper = isTop ? facade.taper : undefined;
    if (taper) {
      addFrustum(group, s.x, s.z, s.w, s.d, s.y0, s.h, taper, material);
    } else {
      // Sealed hollow walls — no door gap above the ground floor.
      const t = 0.45;
      const wallBoxes: UvBoxTuple[] = [
        [s.x + s.w / 2, s.y0 + s.h / 2, s.z + t / 2, s.w, s.h, t, s.x, s.y0, s.z],
        [s.x + s.w / 2, s.y0 + s.h / 2, s.z + s.d - t / 2, s.w, s.h, t, s.x, s.y0, s.z],
        [s.x + t / 2, s.y0 + s.h / 2, s.z + s.d / 2, t, s.h, s.d, s.x, s.y0, s.z],
        [s.x + s.w - t / 2, s.y0 + s.h / 2, s.z + s.d / 2, t, s.h, s.d, s.x, s.y0, s.z],
      ];
      addWorldUvBoxes(group, wallBoxes, material, 10, 14, true);
    }
    if (facade.glass === "curtain" && !taper) {
      addCurtainBands(group, s.x, s.z, s.w, s.d, s.y0 + 2.0, top, facade.style);
    }
    // Round 3: recessed window bands on non-curtain upper steps.
    if (facade.glass !== "curtain" && !taper) {
      addUpperWindowBands(group, s.x, s.z, s.w, s.d, s.y0, top);
    }
    // No pilasters on a tapered top step — a vertical pilaster at the
    // base corner would float past the sloping wall.
    if (!taper) stepTrim(group, s.x, s.z, s.w, s.d, s.y0, s.h, trimMat);
    if (!isTop) {
      // Gold-edged ledge slab at this step's top — the next step sits on
      // it, its smaller footprint leaving a terrace ring.
      ledgeGold.push([s.x + s.w / 2, top + 0.06, s.z + s.d / 2, s.w + 0.45, 0.12, s.d + 0.45]);
      const ledgeDark: BoxTuple[] = [[s.x + s.w / 2, top + 0.15, s.z + s.d / 2, s.w + 0.3, 0.3, s.d + 0.3]];
      addMergedBoxes(group, ledgeDark, DARK_MAT, false);
    } else if (!taper) {
      // Cap slab sealing the top step (the roof kit only adds a rim —
      // without this the hollow top step would read open from above).
      const capSlab: BoxTuple[] = [[s.x + s.w / 2, top + 0.15, s.z + s.d / 2, s.w + 0.3, 0.3, s.d + 0.3]];
      addMergedBoxes(group, capSlab, DARK_MAT, false);
    }
  }
  addMergedBoxes(group, ledgeGold, GOLD_MAT, false);
  return group;
}

function hollow(facade: Facade, material: MeshStandardMaterial, glaze: boolean) {
  const group = new Group();
  const { x, z, w, d, h, door, passThrough } = facade;
  const t = 0.45;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const gap = 4;
  const isHome = facade.glass === "home" || !!facade.porch || h <= 6.2;
  const baseH = isHome ? h : Math.min(h, 3.6);
  const baseMat = baseWallMaterial(facade);
  const baseWallBoxes: UvBoxTuple[] = [];
  const upperWallBoxes: UvBoxTuple[] = [];

  const addDoor = (alongX: boolean) => {
    const px = alongX ? cx : door === "w" ? x + t / 2 : x + w - t / 2;
    const pz = alongX ? (door === "n" ? z + t / 2 : z + d - t / 2) : cz;
    const outSign = door === "n" || door === "w" ? -1 : 1;
    const outPlane = alongX
      ? (door === "n" ? z : z + d) + outSign * 0.08
      : (door === "w" ? x : x + w) + outSign * 0.08;

    // Open doorway (2026-11-18): NO solid slab — the 4-wide door gap is
    // a real walk-through, and the slab used to plug it visually while
    // the wall colliders plugged it physically. The frame below (jambs,
    // lintel, threshold, transom, lanterns) dresses the open gap.

    // Door frame jambs, lintel, threshold + transom frame merged in WHITE_MAT
    const hasTransom = h >= 4.2 && !(facade.storefront && facade.face === door);
    const frameBoxes: BoxTuple[] = [
      [alongX ? cx - 1.85 : px, 1.55, alongX ? pz : cz - 1.85, alongX ? 0.35 : 0.52, 3.1, alongX ? 0.52 : 0.35],
      [alongX ? cx + 1.85 : px, 1.55, alongX ? pz : cz + 1.85, alongX ? 0.35 : 0.52, 3.1, alongX ? 0.52 : 0.35],
      [alongX ? cx : px, 3.12, alongX ? pz : cz, alongX ? 4.3 : 0.54, 0.26, alongX ? 0.54 : 4.3],
      [alongX ? cx : outPlane, 0.06, alongX ? outPlane : cz, alongX ? 4.1 : 0.32, 0.12, alongX ? 0.32 : 4.1],
    ];
    if (hasTransom) {
      frameBoxes.push([
        alongX ? cx : outPlane,
        3.68,
        alongX ? outPlane : cz,
        alongX ? 3.8 : 0.22,
        0.16,
        alongX ? 0.22 : 3.8,
      ]);
      // Illuminated transom glass above the door lintel
      glassPane(
        group,
        WINDOW_GLASS_MAT,
        alongX ? cx : outPlane,
        3.42,
        alongX ? outPlane : cz,
        alongX ? 3.4 : 0.12,
        0.4,
        alongX ? 0.12 : 3.4,
      );
    }
    addMergedBoxes(group, frameBoxes, WHITE_MAT, true);

    // Brass threshold strip across the open doorway (visual only — the
    // player walks over it). No gold handles: they hung on the old slab.
    const goldBoxes: BoxTuple[] = [
      [alongX ? cx : outPlane, 0.18, alongX ? outPlane : cz, alongX ? 3.2 : 0.08, 0.22, alongX ? 0.08 : 3.2],
    ];
    addMergedBoxes(group, goldBoxes, GOLD_MAT, false);

    // Warm wall lanterns flanking the entrance door (outside the 4-wide door gap)
    const lanternBoxes: BoxTuple[] = [];
    const bracketBoxes: BoxTuple[] = [];
    for (const lOff of [-2.28, 2.28]) {
      const lx = alongX ? cx + lOff : outPlane + outSign * 0.05;
      const lz = alongX ? outPlane + outSign * 0.05 : cz + lOff;
      lanternBoxes.push([lx, 2.25, lz, 0.24, 0.34, 0.24]);
      bracketBoxes.push([lx, 2.46, lz, 0.3, 0.08, 0.3]);
      bracketBoxes.push([lx, 2.04, lz, 0.2, 0.08, 0.2]);
    }
    addMergedBoxes(group, lanternBoxes, LANTERN_MAT, false);
    addMergedBoxes(group, bracketBoxes, DARK_MAT, false);
  };

  const glass = glaze ? facade.glass : undefined;
  const glassWall = !!facade.glassWall;
  const proud = facade.glassProud ?? 0;

  const winW = glass === "curtain" ? 2.6 : glassWall ? 3.4 : 2.2;
  const winY0 = glassWall ? 0.8 : 1.0;
  const winY1 = glassWall ? 2.8 : 2.6;

  const blockedFor = (face: Face, span: number, origin: number): Array<[number, number]> => {
    const blocked: Array<[number, number]> = [];
    if (door === face) {
      const c = origin + span / 2;
      blocked.push([c - gap / 2, c + gap / 2]);
    }
    if (passThrough === face) {
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

  // Ground-floor windows for one face:
  // - Homes get front windows flanking the door AND side/rear windows on non-door faces.
  // - Curtain-wall towers get windows spaced ~6.5u on every face.
  // - Other enterable buildings get ground-floor windows on non-storefront faces.
  const windowsFor = (face: Face, span: number, origin: number): WallOpening[] => {
    if (proud > 0) return [];
    const blocked = blockedFor(face, span, origin);
    const overlaps = (a0: number, a1: number) =>
      blocked.some(([b0, b1]) => a0 < b1 - 0.2 && a1 > b0 + 0.2);
    if (glass === "home") {
      const out: WallOpening[] = [];
      if (face === door) {
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
      } else {
        // Side and rear home windows so all 4 walls of every home have real windows
        const sideW = 1.9;
        const count = span >= 11 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const wc = origin + (span * (i + 1)) / (count + 1);
          const a0 = wc - sideW / 2;
          const a1 = wc + sideW / 2;
          if (a0 < origin + 0.8 || a1 > origin + span - 0.8) continue;
          if (overlaps(a0, a1)) continue;
          out.push({ a0, a1, y0: 1.1, y1: 2.5 });
        }
      }
      return out;
    }
    if (!glass && facade.storefront && facade.face === face) return [];
    const spacing = glass === "curtain" ? 6.5 : 7.5;
    const n = Math.max(1, Math.floor((span - 1) / spacing));
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

  const buildWall = (face: Face, alongX: boolean, fixed: number) => {
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    // Only cut see-through window holes on faces without interior cladWalls/wallpaper liners
    // (door and passThrough faces); on lined faces, keep the wall solid and mount 3D windows proud.
    const canCutThrough = face === door || face === passThrough;
    const openings: WallOpening[] = [];
    if (door === face) {
      const c = origin + span / 2;
      openings.push({ a0: c - gap / 2, a1: c + gap / 2, y0: 0, y1: 3, door: true });
    } else if (passThrough === face) {
      const c = origin + span / 2;
      openings.push({ a0: c - gap / 2, a1: c + gap / 2, y0: 0, y1: 3, door: true });
    }
    if (facade.storefront && facade.face === face && canCutThrough) {
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
    const faceWindows = windowsFor(face, span, origin);
    if (canCutThrough) {
      for (const op of faceWindows) openings.push(op);
    }
    openings.sort((a, b) => a.a0 - b.a0);
    const wallC =
      face === "n" ? fixed + t / 2 : face === "s" ? fixed - t / 2 : face === "w" ? fixed + t / 2 : fixed - t / 2;
    const outer =
      face === "n" ? fixed - 0.07 : face === "s" ? fixed + 0.07 : face === "w" ? fixed - 0.07 : fixed + 0.07;
    const pushBase = (px: number, py: number, pz: number, sx: number, sy: number, sz: number) => {
      baseWallBoxes.push([px, py, pz, sx, sy, sz, x, 0, z]);
    };
    const solidBase = (a0: number, a1: number) => {
      if (a1 - a0 < 0.05) return;
      const mid = (a0 + a1) / 2;
      const len = a1 - a0;
      if (alongX) pushBase(mid, baseH / 2, wallC, len, baseH, t);
      else pushBase(wallC, baseH / 2, mid, t, baseH, len);
    };
    const aroundBase = (op: WallOpening) => {
      const mid = (op.a0 + op.a1) / 2;
      const len = op.a1 - op.a0;
      if (op.y0 > 0.05) {
        if (alongX) pushBase(mid, op.y0 / 2, wallC, len, op.y0, t);
        else pushBase(wallC, op.y0 / 2, mid, t, op.y0, len);
      }
      if (op.y1 < baseH - 0.05) {
        const hy = (op.y1 + baseH) / 2;
        if (alongX) pushBase(mid, hy, wallC, len, baseH - op.y1, t);
        else pushBase(wallC, hy, mid, t, baseH - op.y1, len);
      }
    };
    let cursor = origin;
    for (const op of openings) {
      solidBase(cursor, op.a0);
      aroundBase(op);
      cursor = op.a1;
    }
    solidBase(cursor, origin + span);

    // Upper stories (baseH..h): single full-width unbroken facade wall per face.
    // Tapered towers skip these — the frustum below replaces them.
    if (h > baseH + 0.05 && !facade.taper) {
      const upH = h - baseH;
      const upY = baseH + upH / 2;
      const mid = origin + span / 2;
      if (alongX) upperWallBoxes.push([mid, upY, wallC, span, upH, t, x, baseH, z]);
      else upperWallBoxes.push([wallC, upY, mid, t, upH, span, x, baseH, z]);
    }

    // Glaze cut-through openings (storefront panes & front/passThrough windows)
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

    // Glaze non-door faces with proud exterior 3D window panes + frames (never exposing interior liners)
    if (!canCutThrough) {
      const outSign = face === "n" || face === "w" ? -1 : 1;
      const panePlane = fixed + outSign * 0.05;
      const framePlane = fixed + outSign * 0.08;
      const mat = glass === "curtain" ? CURTAIN_GLASS_MAT : WINDOW_GLASS_MAT;
      for (const op of faceWindows) {
        const mid = (op.a0 + op.a1) / 2;
        const cy = (op.y0 + op.y1) / 2;
        const gw = op.a1 - op.a0;
        const gh = op.y1 - op.y0;
        if (alongX) {
          glassPane(group, mat, mid, cy, panePlane, gw - 0.08, gh - 0.08, 0.08);
          frameMesh(group, gw, gh, mid, cy, framePlane, faceRotY(face));
        } else {
          glassPane(group, mat, panePlane, cy, mid, 0.08, gh - 0.08, gw - 0.08);
          frameMesh(group, gw, gh, framePlane, cy, mid, faceRotY(face));
        }
        glassStats.windows++;
      }
    }
  };

  if (proud === 0) {
    buildWall("n", true, z);
    buildWall("s", true, z + d);
    buildWall("w", false, x);
    buildWall("e", false, x + w);

    addWorldUvBoxes(group, baseWallBoxes, baseMat, 8, 8, true);
    addWorldUvBoxes(group, upperWallBoxes, material, 10, 14, true);
  }

  // Round 3: recessed 3D window bands on the upper floors — the upper
  // walls used to be one flat textured box. Homes never reach here
  // (baseH === h), curtain towers have their own bands, tapered
  // frustums carry their own glass canvas.
  if (proud === 0 && !facade.taper && facade.glass !== "curtain") {
    addUpperWindowBands(group, x, z, w, d, baseH, h);
  }

  // Tapered tower: the upper shell is a square frustum (full footprint
  // at the ground-floor top, `taper` × at the roof) instead of a straight
  // box. Ground-level trim here — addArchitecturalDetails is skipped for
  // tapered facades, since its full-height pilasters would float past
  // the slope. Rounded glass corners run to the taper break.
  if (facade.taper && h > baseH + 0.05) {
    addFrustum(group, x, z, w, d, baseH, h - baseH, facade.taper, material);
    const trimBoxes: BoxTuple[] = [];
    for (const px of [x + 0.04, x + w - 0.04]) {
      for (const pz of [z + 0.04, z + d - 0.04]) {
        trimBoxes.push([px, baseH / 2, pz, 0.34, baseH, 0.34]);
      }
    }
    trimBoxes.push([cx, baseH + 0.1, z - 0.06, w + 0.22, 0.2, 0.14]);
    trimBoxes.push([cx, baseH + 0.1, z + d + 0.06, w + 0.22, 0.2, 0.14]);
    trimBoxes.push([x - 0.06, baseH + 0.1, cz, 0.14, 0.2, d + 0.22]);
    trimBoxes.push([x + w + 0.06, baseH + 0.1, cz, 0.14, 0.2, d + 0.22]);
    addMergedBoxes(group, trimBoxes, GOLD_MAT, false);
  }
  if (facade.roundedCorners) addCornerColumns(group, facade, 0, baseH);

  if (door === "n" || door === "s") addDoor(true);
  else if (door === "w" || door === "e") addDoor(false);

  // ---- glass curtain bands on the upper floors (office towers only) ----
  // Skipped on tapered shells — the bands sit on the full-width plane
  // and would float off the sloping frustum; the frustum's glass canvas
  // carries the look instead.
  if (glass === "curtain" && !facade.taper) {
    const startY = proud > 0 ? 9.8 : 5.8;
    // Round 4: per-cell glass (warm-lit / cool / gold / magenta by
    // style) + real mullions, merged per material like addCurtainBands
    // — the ground shell's bands were the last continuous strips.
    const warmBoxes: BoxTuple[] = [];
    const coolBoxes: BoxTuple[] = [];
    const goldBoxes: BoxTuple[] = [];
    const magentaBoxes: BoxTuple[] = [];
    const mullionBoxes: BoxTuple[] = [];
    const seed = Math.abs(Math.round(facade.x * 3 + facade.z * 7));
    for (let y = startY; y + 0.9 < h - 0.4; y += 4) {
      const floorIdx = Math.round((y - startY) / 4);
      for (const face of ["n", "s", "w", "e"] as const) {
        const alongX = face === "n" || face === "s";
        const span = alongX ? w : d;
        const origin = alongX ? x : z;
        const centre = origin + span / 2;
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
          const plane = face === "n" ? z - off : face === "s" ? z + d + off : face === "w" ? x - off : x + w + off;
          const framePlane = plane + (face === "n" || face === "w" ? -0.02 : 0.02);
          windowCells(a0, len).forEach(([c0, c1], cellIdx) => {
            const cm = (c0 + c1) / 2;
            const cw = c1 - c0;
            const mat = curtainCellMat(facade.style, cellIdx + floorIdx * 3, seed);
            const arr = mat === WINDOW_GLASS_MAT ? warmBoxes : mat === GOLD_GLASS_MAT ? goldBoxes : mat === MAGENTA_GLASS_MAT ? magentaBoxes : coolBoxes;
            if (alongX) arr.push([cm, y, plane, cw, 1.8, 0.1]);
            else arr.push([plane, y, cm, 0.1, 1.8, cw]);
          });
          for (let a = a0 + 1.8; a < a1 - 1.5; a += 2.9) {
            if (alongX) mullionBoxes.push([a, y, plane - (face === "n" ? 0.02 : -0.02), 0.14, 1.8, 0.12]);
            else mullionBoxes.push([plane - (face === "w" ? 0.02 : -0.02), y, a, 0.12, 1.8, 0.14]);
          }
          if (face === "n") frameMesh(group, len, 1.8, mid, y, framePlane, faceRotY(face), true);
          else if (face === "s") frameMesh(group, len, 1.8, mid, y, framePlane, faceRotY(face), true);
          else if (face === "w") frameMesh(group, len, 1.8, framePlane, y, mid, faceRotY(face), true);
          else frameMesh(group, len, 1.8, framePlane, y, mid, faceRotY(face), true);
          glassStats.panes++;
        }
      }
    }
    addMergedBoxes(group, warmBoxes, WINDOW_GLASS_MAT, false);
    addMergedBoxes(group, coolBoxes, CURTAIN_GLASS_MAT, false);
    addMergedBoxes(group, goldBoxes, GOLD_GLASS_MAT, false);
    addMergedBoxes(group, magentaBoxes, MAGENTA_GLASS_MAT, false);
    addMergedBoxes(group, mullionBoxes, FRAME_MAT, false);
  }

  const capPad = proud > 0 ? 0.6 : 0;
  const topScale = facade.taper ?? 1;
  const roofCap = new Mesh(box, DARK_MAT);
  roofCap.position.set(cx, h + 0.2, cz);
  roofCap.scale.set(w * topScale + capPad, 0.4, d * topScale + capPad);
  roofCap.castShadow = true;
  roofCap.receiveShadow = true;
  group.add(roofCap);

  // ---- shop interior (world-quality upgrade 2026-11-13) ----
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
        // Round 3: a shaped counter, not a plain box — inset kick base,
        // body, and an overhanging top slab the goods sit on.
        const kick = new Mesh(box, DARK_MAT);
        kick.position.set(ccx, 0.08, ccz);
        kick.scale.set(sAlongX ? counterW - 0.3 : 0.9, 0.16, sAlongX ? 0.9 : counterW - 0.3);
        group.add(kick);
        const counter = new Mesh(box, WOOD_MAT);
        counter.position.set(ccx, 0.55, ccz);
        counter.scale.set(sAlongX ? counterW : 1.2, 0.95, sAlongX ? 1.2 : counterW);
        counter.castShadow = true;
        counter.receiveShadow = true;
        group.add(counter);
        const top = new Mesh(box, WOOD_MAT);
        top.position.set(ccx, 1.07, ccz);
        top.scale.set(sAlongX ? counterW + 0.3 : 1.5, 0.1, sAlongX ? 1.5 : counterW + 0.3);
        top.castShadow = true;
        top.receiveShadow = true;
        group.add(top);
        const gOff = counterW / 2 - 0.5;
        for (const gs of [-1, 1]) {
          goods(sAlongX ? ccx + gs * gOff : ccx, 1.33, sAlongX ? ccz : ccz + gs * gOff);
        }
      }
    }
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
      // Round 3: cap slab + two shelf ledges proud of the shelf front
      // (which faces back toward the shopfront), so the back unit reads
      // as shelving, not a solid block.
      const cap = new Mesh(box, WOOD_MAT);
      cap.position.set(bxc, 2.46, bzc);
      cap.scale.set(sAlongX ? bsx + 0.2 : 1.0, 0.12, sAlongX ? 1.0 : bsz + 0.2);
      group.add(cap);
      for (const sy of [0.9, 1.7]) {
        const ledge = new Mesh(box, WOOD_MAT);
        if (sAlongX) {
          ledge.position.set(bxc, sy, bzc - sInZ * 0.5);
          ledge.scale.set(bsx, 0.08, 0.3);
        } else {
          ledge.position.set(bxc - sInX * 0.5, sy, bzc);
          ledge.scale.set(0.3, 0.08, bsz);
        }
        group.add(ledge);
      }
      for (const off of [-1.2, 0, 1.2]) {
        goods(sAlongX ? bxc + off : bxc, 2.73, sAlongX ? bzc : bzc + off);
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

// Rooftop kit: parapet rim + coping stones, detailed HVAC units with fan
// cowls & ductwork, rooftop stairwell penthouse or skylight/water tower,
// and communication mast with cyan aviation beacon.
function addRoofKit(group: Group, x: number, z: number, w: number, d: number, h: number, style = 0) {
  const rim = 0.28;
  const rimRuns: BoxTuple[] = [
    [x + w / 2, h + rim / 2, z + rim / 2, w + 0.12, rim, rim],
    [x + w / 2, h + rim / 2, z + d - rim / 2, w + 0.12, rim, rim],
    [x + rim / 2, h + rim / 2, z + d / 2, rim, rim, d + 0.12],
    [x + w - rim / 2, h + rim / 2, z + d / 2, rim, rim, d + 0.12],
    // HVAC dark fan cowls
    [x + w * 0.22, h + 0.86, z + d * 0.24, 0.75, 0.14, 0.75],
    [x + w * 0.72, h + 0.86, z + d * 0.7, 0.75, 0.14, 0.75],
  ];
  addMergedBoxes(group, rimRuns, DARK_MAT, false);

  const acRuns: BoxTuple[] = [
    [x + w * 0.22, h + 0.4, z + d * 0.24, 1.45, 0.8, 1.25],
    [x + w * 0.72, h + 0.4, z + d * 0.7, 1.45, 0.8, 1.25],
    // Connecting ventilation duct run
    [x + w * 0.47, h + 0.26, z + d * 0.24, Math.max(1.2, w * 0.42), 0.34, 0.42],
  ];
  if (w >= 13 && d >= 13) {
    // Rooftop access stairwell bulkhead / elevator overrun
    acRuns.push([x + w * 0.68, h + 1.05, z + d * 0.32, 2.2, 2.1, 2.4]);
  }
  addMergedBoxes(group, acRuns, METAL_MAT, true);

  // Classic rooftop timber water tower on taller brick/stone buildings, or
  // solar skylight array on larger modern roofs
  if ((style === 1 || style === 3) && w >= 14 && d >= 14 && h >= 12) {
    const wx = x + w * 0.28;
    const wz = z + d * 0.68;
    const legs: BoxTuple[] = [
      [wx - 0.65, h + 0.9, wz - 0.65, 0.16, 1.8, 0.16],
      [wx + 0.65, h + 0.9, wz - 0.65, 0.16, 1.8, 0.16],
      [wx - 0.65, h + 0.9, wz + 0.65, 0.16, 1.8, 0.16],
      [wx + 0.65, h + 0.9, wz + 0.65, 0.16, 1.8, 0.16],
      [wx, h + 1.75, wz, 1.7, 0.14, 1.7],
    ];
    addMergedBoxes(group, legs, DARK_MAT, false);
    const tank = new Mesh(column, WOOD_MAT);
    tank.position.set(wx, h + 2.8, wz);
    tank.scale.set(2.2, 2.0, 2.2);
    tank.castShadow = true;
    group.add(tank);
    const roof = new Mesh(new ConeGeometry(1.05, 0.9, 8), ROOF_MATS[0]);
    roof.position.set(wx, h + 4.25, wz);
    group.add(roof);
  } else if (w >= 14 && d >= 14) {
    glassPane(group, CURTAIN_GLASS_MAT, x + w * 0.35, h + 0.32, z + d * 0.68, 2.8, 0.18, 2.2);
  }

  const antenna = new Mesh(box, POLE_MAT);
  antenna.position.set(x + w * 0.85, h + 1.4, z + d * 0.2);
  antenna.scale.set(0.14, 2.8, 0.14);
  group.add(antenna);
  const beacon = new Mesh(box, CYAN_BEACON_MAT);
  beacon.position.set(x + w * 0.85, h + 2.9, z + d * 0.2);
  beacon.scale.set(0.35, 0.35, 0.35);
  group.add(beacon);

  // Round 3: tall roofs get a second mast + a tilted satellite dish, so
  // the skyline's tallest rooflines stop carrying one identical antenna
  // each. The dish is a squashed hemisphere shell, tilted skyward.
  if (h >= 16 && w >= 13 && d >= 13) {
    const mast2 = new Mesh(box, POLE_MAT);
    mast2.position.set(x + w * 0.2, h + 1.8, z + d * 0.75);
    mast2.scale.set(0.14, 3.6, 0.14);
    group.add(mast2);
    const beacon2 = new Mesh(box, CYAN_BEACON_MAT);
    beacon2.position.set(x + w * 0.2, h + 3.7, z + d * 0.75);
    beacon2.scale.set(0.3, 0.3, 0.3);
    group.add(beacon2);
    const dish = new Mesh(new SphereGeometry(0.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), METAL_MAT);
    dish.position.set(x + w * 0.5, h + 0.9, z + d * 0.3);
    dish.scale.set(1, 0.6, 1);
    dish.rotation.x = -0.7;
    dish.rotation.z = 0.5;
    group.add(dish);
    const dishPole = new Mesh(box, POLE_MAT);
    dishPole.position.set(x + w * 0.5, h + 0.45, z + d * 0.3);
    dishPole.scale.set(0.12, 0.9, 0.12);
    group.add(dishPole);
  }

  // Edge lighting (round-2): a thin emissive cyan strip along the
  // parapet rim top so the roofline glows at dusk like the frames.
  const edgeBoxes: BoxTuple[] = [
    [x + w / 2, h + rim + 0.03, z + 0.1, w + 0.12, 0.07, 0.1],
    [x + w / 2, h + rim + 0.03, z + d - 0.1, w + 0.12, 0.07, 0.1],
    [x + 0.1, h + rim + 0.03, z + d / 2, 0.1, 0.07, d + 0.12],
    [x + w - 0.1, h + rim + 0.03, z + d / 2, 0.1, 0.07, d + 0.12],
  ];
  addMergedBoxes(group, edgeBoxes, CYAN_BEACON_MAT, false);
}

// ---- real-architecture kit: pitched roofs, porches, chimneys, storefronts,
// stepped towers, side wings, and 3D facade relief.

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
  const uv = geo.attributes.uv;
  if (uv) {
    const scaleU = 1 / Math.max(6, span);
    const scaleV = 1 / Math.max(6, ridgeLen);
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * scaleU, uv.getY(i) * scaleV);
    }
    uv.needsUpdate = true;
  }
  const mesh = new Mesh(geo, ROOF_MATS[matIdx % ROOF_MATS.length]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const cx = x + w / 2;
  const cz = z + d / 2;
  if (alongX) {
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(cx - ridgeLen / 2, h - 0.05, cz);
  } else {
    mesh.position.set(cx, h - 0.05, cz - ridgeLen / 2);
  }
  group.add(mesh);

  // 3D ridge beam cap, eave fascia boards & gable-end attic vents
  const trimBoxes: BoxTuple[] = [
    // Ridge beam cap
    alongX
      ? [cx, h + rise - 0.04, cz, ridgeLen + 0.16, 0.22, 0.26]
      : [cx, h + rise - 0.04, cz, 0.26, 0.22, ridgeLen + 0.16],
    // Eave fascia boards along both sides
    alongX
      ? [cx, h + 0.04, cz - span / 2, ridgeLen, 0.2, 0.14]
      : [cx - span / 2, h + 0.04, cz, 0.14, 0.2, ridgeLen],
    alongX
      ? [cx, h + 0.04, cz + span / 2, ridgeLen, 0.2, 0.14]
      : [cx + span / 2, h + 0.04, cz, 0.14, 0.2, ridgeLen],
  ];
  if (rise >= 1.4) {
    const ventY = h + rise * 0.52;
    for (const side of [-1, 1]) {
      if (alongX) {
        trimBoxes.push([cx + side * (ridgeLen / 2 - 0.02), ventY, cz, 0.14, 0.62, 0.62]);
      } else {
        trimBoxes.push([cx, ventY, cz + side * (ridgeLen / 2 - 0.02), 0.62, 0.62, 0.14]);
      }
    }
  }
  addMergedBoxes(group, trimBoxes, WHITE_MAT, false);
  return rise;
}

// A hip roof: a four-sided pyramid whose base matches the walls, plus eave fascia & apex finial.
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
  const cx = x + w / 2;
  const cz = z + d / 2;
  mesh.position.set(cx, h + rise / 2 - 0.05, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const trimBoxes: BoxTuple[] = [
    [cx, h + 0.04, z - 0.36, w + 0.8, 0.18, 0.12],
    [cx, h + 0.04, z + d + 0.36, w + 0.8, 0.18, 0.12],
    [x - 0.36, h + 0.04, cz, 0.12, 0.18, d + 0.8],
    [x + w + 0.36, h + 0.04, cz, 0.12, 0.18, d + 0.8],
    [cx, h + rise + 0.12, cz, 0.32, 0.36, 0.32],
  ];
  addMergedBoxes(group, trimBoxes, WHITE_MAT, false);
  return rise;
}

// A front porch: deck slab + front step, sloped canopy, Classical posts with
// plinths/capitals, side balustrades (keeping the front approach 100% open),
// and a warm porch ceiling lantern.
function addPorch(group: Group, f: Facade) {
  const slab = porchSlab(f);
  const alongX = f.face === "n" || f.face === "s";
  const outSign = f.face === "n" || f.face === "w" ? -1 : 1;

  const woodBoxes: BoxTuple[] = [
    [slab.x, 0.09, slab.z, slab.w, 0.18, slab.d],
    // Welcoming front porch step strip on the outward edge
    alongX
      ? [slab.x, 0.045, slab.z + outSign * (slab.d / 2 + 0.18), slab.w * 0.75, 0.09, 0.36]
      : [slab.x + outSign * (slab.w / 2 + 0.18), 0.045, slab.z, 0.36, 0.09, slab.d * 0.75],
  ];
  addMergedBoxes(group, woodBoxes, WOOD_MAT, false);

  const canopy = new Mesh(box, ROOF_MATS[(f.roofMat ?? 0) % ROOF_MATS.length]);
  canopy.position.set(slab.x, 3.05, slab.z);
  canopy.scale.set(slab.w + 0.45, 0.16, slab.d + 0.45);
  canopy.castShadow = true;
  group.add(canopy);

  const whiteBoxes: BoxTuple[] = [
    // Canopy fascia trim
    [slab.x, 2.94, slab.z, slab.w + 0.5, 0.1, slab.d + 0.5],
  ];
  for (const p of porchPosts(f)) {
    whiteBoxes.push([p.x, 1.6, p.z, 0.24, 2.9, 0.24]);
    whiteBoxes.push([p.x, 0.28, p.z, 0.36, 0.26, 0.36]);
    whiteBoxes.push([p.x, 2.84, p.z, 0.36, 0.18, 0.36]);
  }
  // Side porch railings on the left/right edges of the porch slab (never across the front)
  for (const side of [-1, 1]) {
    if (alongX) {
      const rx = slab.x + side * (slab.w / 2 - 0.12);
      whiteBoxes.push([rx, 0.82, slab.z, 0.12, 0.08, slab.d - 0.24]);
      whiteBoxes.push([rx, 0.24, slab.z, 0.12, 0.06, slab.d - 0.24]);
      for (const bz of [-slab.d * 0.22, 0, slab.d * 0.22]) {
        whiteBoxes.push([rx, 0.53, slab.z + bz, 0.08, 0.54, 0.08]);
      }
    } else {
      const rz = slab.z + side * (slab.d / 2 - 0.12);
      whiteBoxes.push([slab.x, 0.82, rz, slab.w - 0.24, 0.08, 0.12]);
      whiteBoxes.push([slab.x, 0.24, rz, slab.w - 0.24, 0.06, 0.12]);
      for (const bx of [-slab.w * 0.22, 0, slab.w * 0.22]) {
        whiteBoxes.push([slab.x + bx, 0.53, rz, 0.08, 0.54, 0.08]);
      }
    }
  }
  addMergedBoxes(group, whiteBoxes, WHITE_MAT, true);

  // Warm porch ceiling lantern
  const lantern = new Mesh(box, LANTERN_MAT);
  lantern.position.set(slab.x, 2.82, slab.z);
  lantern.scale.set(0.28, 0.22, 0.28);
  group.add(lantern);
}

// A chimney riding the ridge (gable) or the apex (hip), proud of the roof, with flue pots.
function addChimney(group: Group, f: Facade, rise: number) {
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  let chX = cx;
  const chY = f.h + rise - (f.roof === "hip" ? 0.4 : 0.3);
  let chZ = cz;
  if (f.roof !== "hip") {
    if (f.roofDir === "n" || f.roofDir === "s") chX = f.x + f.w * 0.25;
    else chZ = f.z + f.d * 0.25;
  }
  const mesh = new Mesh(box, ROOF_MATS[1]);
  mesh.castShadow = true;
  mesh.position.set(chX, chY, chZ);
  mesh.scale.set(0.95, 2.4, 0.95);
  group.add(mesh);

  const capBoxes: BoxTuple[] = [
    [chX, chY + 1.28, chZ, 1.18, 0.2, 1.18],
    [chX - 0.22, chY + 1.52, chZ, 0.24, 0.32, 0.24],
    [chX + 0.22, chY + 1.52, chZ, 0.24, 0.32, 0.24],
  ];
  addMergedBoxes(group, capBoxes, GOLD_MAT, false);
}

// A real shop front: glass panes + a gold sign band with dark recessed plaque + sloped awning with valance & tie rods.
function addStorefront(group: Group, f: Facade) {
  const face = f.face;
  const alongX = face === "n" || face === "s";
  const span = alongX ? f.w : f.d;
  const paneW = Math.min(span * 0.72, 12);
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const outSign = face === "n" || face === "w" ? -1 : 1;
  const wallPlane = face === "n" ? f.z : face === "s" ? f.z + f.d : face === "w" ? f.x : f.x + f.w;

  const band = new Mesh(box, GOLD_MAT);
  if (alongX) {
    band.position.set(cx, 3.65, wallPlane + outSign * 0.16);
    band.scale.set(paneW + 0.2, 0.92, 0.24);
  } else {
    band.position.set(wallPlane + outSign * 0.16, 3.65, cz);
    band.scale.set(0.24, 0.92, paneW + 0.2);
  }
  group.add(band);

  // Recessed dark sign backing + vertical display window mullions
  const darkBoxes: BoxTuple[] = [
    alongX
      ? [cx, 3.65, wallPlane + outSign * 0.25, paneW - 0.5, 0.56, 0.1]
      : [wallPlane + outSign * 0.25, 3.65, cz, 0.1, 0.56, paneW - 0.5],
    // Storefront window bulkhead kickplate at sidewalk level
    alongX
      ? [cx - paneW * 0.34, 0.18, wallPlane + outSign * 0.08, paneW * 0.28, 0.34, 0.16]
      : [wallPlane + outSign * 0.08, 0.18, cz - paneW * 0.34, 0.16, 0.34, paneW * 0.28],
    alongX
      ? [cx + paneW * 0.34, 0.18, wallPlane + outSign * 0.08, paneW * 0.28, 0.34, 0.16]
      : [wallPlane + outSign * 0.08, 0.18, cz + paneW * 0.34, 0.16, 0.34, paneW * 0.28],
  ];
  if (f.awning) {
    const depth = 1.55;
    const awn = new Mesh(box, GOLD_MAT);
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

    // Front awning valance drop strip + side steel tie-rod brackets
    const valPos = wallPlane + outSign * (depth + 0.04);
    const valBoxes: BoxTuple[] = [
      alongX
        ? [cx, 3.78, valPos, paneW + 1, 0.22, 0.08]
        : [valPos, 3.78, cz, 0.08, 0.22, paneW + 1],
    ];
    addMergedBoxes(group, valBoxes, WHITE_MAT, false);
    // Round 4: scalloped valance — a row of half-round fabric bumps
    // along the valance's front edge instead of a straight drop strip.
    // One merged mesh per awning.
    const scallopGeos: BufferGeometry[] = [];
    const nScallops = Math.max(2, Math.floor((paneW + 1) / 1.15));
    for (let i = 0; i < nScallops; i++) {
      const t = nScallops === 1 ? 0 : i / (nScallops - 1);
      const along = -((paneW + 1) / 2 - 0.55) + t * (paneW + 1 - 1.1);
      const sg = new SphereGeometry(0.16, 8, 6);
      sg.scale(1, 0.75, 1);
      if (alongX) sg.translate(cx + along, 3.68, valPos);
      else sg.translate(valPos, 3.68, cz + along);
      scallopGeos.push(sg);
    }
    const scallopMerged = mergeGeometries(scallopGeos) ?? scallopGeos[0]!;
    const scallops = new Mesh(scallopMerged, WHITE_MAT);
    group.add(scallops);
    for (const g of scallopGeos) if (g !== scallopMerged) g.dispose();
    for (const s of [-1, 1]) {
      const off = s * (paneW * 0.44);
      darkBoxes.push(
        alongX
          ? [cx + off, 4.35, wallPlane + outSign * 0.65, 0.08, 0.08, 1.2]
          : [wallPlane + outSign * 0.65, 4.35, cz + off, 1.2, 0.08, 0.08],
      );
    }
  }
  addMergedBoxes(group, darkBoxes, DARK_MAT, false);

  // Display-window mullions: thin vertical bars across the storefront
  // panes + a transom bar, so the glass reads as framed panes, not one
  // flat sheet. They sit in the window opening, straddling the glass
  // plane (wallPlane - outSign*0.22 — the glass sits 0.225 inside the
  // wall face), not on the outer wall. Skips the door gap when the door
  // shares this face.
  const glassPlane = wallPlane - outSign * 0.22;
  const doorGap = f.door === face ? 2.3 : 0;
  const mullionBoxes: BoxTuple[] = [];
  const sC = alongX ? cx : cz;
  for (let o = 2.0; o < paneW - 0.5; o += 2.0) {
    const p = sC - paneW / 2 + o;
    if (Math.abs(p - sC) < doorGap) continue;
    if (alongX) mullionBoxes.push([p, 1.75, glassPlane, 0.09, 3.2, 0.1]);
    else mullionBoxes.push([glassPlane, 1.75, p, 0.1, 3.2, 0.09]);
  }
  const transomSeg = paneW / 2 - doorGap;
  if (transomSeg > 0.5) {
    for (const side of [-1, 1]) {
      const segC = sC + side * (doorGap + transomSeg / 2);
      if (alongX) mullionBoxes.push([segC, 2.6, glassPlane, transomSeg, 0.1, 0.1]);
      else mullionBoxes.push([glassPlane, 2.6, segC, 0.1, 0.1, transomSeg]);
    }
  }
  addMergedBoxes(group, mullionBoxes, DARK_MAT, false);

  // Round 4: window display with depth — a shelf just inside the glass
  // with goods at varied depths, so the shopfront reads as a real
  // display, not a flat lit plane. Skips the door gap. One merged mesh
  // per shop (shelf + goods share the shop's accent goods material).
  const dispPlane = wallPlane - outSign * 0.9;
  const dC = alongX ? cx : cz;
  const dispSegs: Array<[number, number]> = [];
  if (doorGap > 0) {
    dispSegs.push([dC - paneW / 2 + 0.4, dC - doorGap - 0.2], [dC + doorGap + 0.2, dC + paneW / 2 - 0.4]);
  } else {
    dispSegs.push([dC - paneW / 2 + 0.4, dC + paneW / 2 - 0.4]);
  }
  const dispShelfBoxes: BoxTuple[] = [];
  const dispGoodsBoxes: BoxTuple[] = [];
  for (const [s0, s1] of dispSegs) {
    if (s1 - s0 < 1.2) continue;
    const sm = (s0 + s1) / 2;
    const sw = s1 - s0;
    if (alongX) dispShelfBoxes.push([sm, 1.0, dispPlane, sw, 0.1, 0.5]);
    else dispShelfBoxes.push([dispPlane, 1.0, sm, 0.5, 0.1, sw]);
    for (let gi = 0; gi < 3; gi++) {
      const gx = s0 + 0.55 + gi * ((sw - 1.1) / 2);
      const off = (gi === 1 ? 0.1 : -0.08) * outSign;
      if (alongX) dispGoodsBoxes.push([gx, 1.28, dispPlane + off, 0.42, 0.42, 0.42]);
      else dispGoodsBoxes.push([dispPlane + off, 1.28, gx, 0.42, 0.42, 0.42]);
    }
  }
  addMergedBoxes(group, dispShelfBoxes, WOOD_MAT, false);
  addMergedBoxes(group, dispGoodsBoxes, GOODS_MATS[Math.abs(f.id.length) % GOODS_MATS.length], false);

  // Round 4: hanging blade sign — a perpendicular neon "OPEN" blade on
  // a drop rod at the storefront edge, so the shop reads from down the
  // street, not just head-on. Cyan / pink alternate by shop.
  const blade = makeNeonSign("OPEN", {
    width: 1.5,
    color: Math.abs(f.id.length) % 2 === 0 ? "cyan" : "pink",
    doubleSide: true,
  });
  if (blade) {
    const bladeOff = paneW / 2 - 0.8;
    const bx = alongX ? cx + bladeOff : wallPlane + outSign * 0.75;
    const bz = alongX ? wallPlane + outSign * 0.75 : cz + bladeOff;
    blade.position.set(bx, 2.95, bz);
    blade.rotation.y = alongX ? Math.PI / 2 : 0;
    group.add(blade);
    // Drop rod from the sign band down to the blade's inner edge.
    const rodBoxes: BoxTuple[] = [
      alongX
        ? [bx, 3.3, wallPlane + outSign * 0.05, 0.08, 0.7, 0.08]
        : [wallPlane + outSign * 0.05, 3.3, bz, 0.08, 0.7, 0.08],
    ];
    addMergedBoxes(group, rodBoxes, DARK_MAT, false);
  }

  // Round 3: neon spill — a soft additive glow pool on the sidewalk in
  // front of the shopfront, faking the wet-asphalt reflection of the
  // sign above (no real reflections in WebGL on a phone). Cyan / magenta
  // alternate deterministically by shop.
  const spill = new Mesh(
    new PlaneGeometry(alongX ? paneW + 1.5 : 2.2, alongX ? 2.2 : paneW + 1.5),
    SPILL_MATS[Math.abs(f.id.length) % 2],
  );
  spill.rotation.x = -Math.PI / 2;
  if (alongX) spill.position.set(cx, 0.12, wallPlane + outSign * 1.5);
  else spill.position.set(wallPlane + outSign * 1.5, 0.12, cz);
  group.add(spill);

  // Recessed-entry portal: two splayed side returns angled out from the
  // wall at the door edges, so the doorway reads as a vestibule instead
  // of a flat hole. (The door leaf itself stays on the wall plane — the
  // collider gap is there — only the reveal splays outward.)
  if (f.door === face) {
    for (const s of [-1, 1]) {
      const off = s * 2.35;
      const jamb = new Mesh(box, STONE_TRIM_MAT);
      const jx = alongX ? cx + off : wallPlane + outSign * 0.55;
      const jz = alongX ? wallPlane + outSign * 0.55 : cz + off;
      jamb.position.set(jx, 1.65, jz);
      jamb.scale.set(alongX ? 0.14 : 1.1, 3.3, alongX ? 1.1 : 0.14);
      jamb.rotation.y = alongX ? s * 0.5 : -s * 0.5;
      jamb.castShadow = true;
      group.add(jamb);
    }
    // Projecting entry canopy over the portal (skipped when the shop
    // awning already covers the entry — the two would stack).
    if (!f.awning) {
      const canopy = new Mesh(box, DARK_MAT);
      if (alongX) {
        canopy.position.set(cx, 3.55, wallPlane + outSign * 0.9);
        canopy.scale.set(5.6, 0.18, 1.9);
      } else {
        canopy.position.set(wallPlane + outSign * 0.9, 3.55, cz);
        canopy.scale.set(1.9, 0.18, 5.6);
      }
      canopy.castShadow = true;
      group.add(canopy);
      const lip = new Mesh(box, CYAN_BEACON_MAT);
      if (alongX) {
        lip.position.set(cx, 3.5, wallPlane + outSign * 1.85);
        lip.scale.set(5.6, 0.08, 0.08);
      } else {
        lip.position.set(wallPlane + outSign * 1.85, 3.5, cz);
        lip.scale.set(0.08, 0.08, 5.6);
      }
      group.add(lip);
    }
  }
}

// Full 3D architectural relief for every building:
// 1. Stone/dark water-table foundation plinth around all 4 walls (split around doors).
// 2. 3D corner pilasters / quoins with base & capital blocks.
// 3. Horizontal floor belt courses wrapping the facade.
// 4. Residential home window shutters, under-window flower planter boxes, and upper-floor windows.
// 5. Mid/high-rise protruding window sills & wrought-iron Juliet balconies.
function addArchitecturalDetails(group: Group, f: Facade) {
  // Stepped + tapered shells carry their own per-step trim (stepTrim /
  // the taper break band) — full-height pilasters and belt courses would
  // float past the setbacks and the slope.
  if (f.tiers || f.glassProud || f.steps || f.taper) return;
  const { x, z, w, d, h, door, passThrough } = f;
  const cx = x + w / 2;
  const cz = z + d / 2;
  const gap = 4.2;
  const isClassic = f.style === 1 || f.style === 3 || f.glass === "home" || !!f.porch;
  const trimMat = isClassic ? STONE_TRIM_MAT : DARK_MAT;

  const trimBoxes: BoxTuple[] = [];
  const darkBoxes: BoxTuple[] = [];
  const woodBoxes: BoxTuple[] = [];
  const foliageBoxes: BoxTuple[] = [];

  // 1. Foundation water-table plinth (y = 0..0.38) around all 4 walls, keeping door & passThrough gaps flush
  const plinthH = 0.38;
  const plinthT = 0.16;
  const addPlinthRun = (face: Face, alongX: boolean, fixed: number) => {
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    const hasGap = door === face || passThrough === face;
    const runs: Array<[number, number]> = hasGap
      ? [
          [origin, origin + span / 2 - gap / 2],
          [origin + span / 2 + gap / 2, origin + span],
        ]
      : [[origin, origin + span]];
    for (const [a0, a1] of runs) {
      if (a1 - a0 < 0.2) continue;
      const mid = (a0 + a1) / 2;
      const len = a1 - a0;
      if (alongX) {
        trimBoxes.push([mid, plinthH / 2, fixed, len, plinthH, plinthT]);
      } else {
        trimBoxes.push([fixed, plinthH / 2, mid, plinthT, plinthH, len]);
      }
    }
  };
  addPlinthRun("n", true, z - 0.06);
  addPlinthRun("s", true, z + d + 0.06);
  addPlinthRun("w", false, x - 0.06);
  addPlinthRun("e", false, x + w + 0.06);

  // 2. 4 Corner pilasters / quoins running full height (skipped when the
  // facade has rounded glass corners — the columns own the corners).
  const pilW = 0.34;
  if (!f.roundedCorners) {
    for (const px of [x + 0.04, x + w - 0.04]) {
      for (const pz of [z + 0.04, z + d - 0.04]) {
        trimBoxes.push([px, h / 2, pz, pilW, h, pilW]);
        trimBoxes.push([px, 0.32, pz, pilW + 0.12, 0.64, pilW + 0.12]);
        trimBoxes.push([px, h - 0.22, pz, pilW + 0.14, 0.44, pilW + 0.14]);
      }
    }
  }

  // 3. Horizontal belt courses wrapping all 4 faces
  const beltStart = f.storefront || f.porch ? 4.55 : 3.95;
  for (let by = beltStart; by < h - 1.4; by += 7.0) {
    trimBoxes.push([cx, by, z - 0.06, w + 0.22, 0.2, 0.14]);
    trimBoxes.push([cx, by, z + d + 0.06, w + 0.22, 0.2, 0.14]);
    trimBoxes.push([x - 0.06, by, cz, 0.14, 0.2, d + 0.22]);
    trimBoxes.push([x + w + 0.06, by, cz, 0.14, 0.2, d + 0.22]);
  }

  // 4. Residential home details: louvered shutters, flower planter boxes & upper-storey windows
  if (f.glass === "home" || f.porch) {
    const hFace: Face = door || f.face;
    const alongX = hFace === "n" || hFace === "s";
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    const outSign = hFace === "n" || hFace === "w" ? -1 : 1;
    const wallPlane = hFace === "n" ? z : hFace === "s" ? z + d : hFace === "w" ? x : x + w;
    const outPlane = wallPlane + outSign * 0.09;
    const c = origin + span / 2;
    const winW = 2.2;
    const shutterBoxes: BoxTuple[] = [];
    const shutterMat = SHUTTER_MATS[Math.abs(Math.round(x + z)) % SHUTTER_MATS.length];

    for (const [s0, s1] of [
      [origin, c - 2.0],
      [c + 2.0, origin + span],
    ] as const) {
      if (s1 - s0 < winW + 1.2) continue;
      const wc = (s0 + s1) / 2;
      // Pair of louvered shutters flanking each front window
      for (const side of [-1, 1]) {
        const sc = wc + side * (winW / 2 + 0.26);
        shutterBoxes.push(
          alongX
            ? [sc, 1.8, outPlane, 0.34, 1.65, 0.08]
            : [outPlane, 1.8, sc, 0.08, 1.65, 0.34],
        );
      }
      // Under-window wood planter trough + lush green foliage box
      const boxPlane = wallPlane + outSign * 0.2;
      woodBoxes.push(
        alongX
          ? [wc, 0.72, boxPlane, winW + 0.3, 0.26, 0.32]
          : [boxPlane, 0.72, wc, 0.32, 0.26, winW + 0.3],
      );
      foliageBoxes.push(
        alongX
          ? [wc, 0.92, boxPlane, winW + 0.2, 0.22, 0.26]
          : [boxPlane, 0.92, wc, 0.26, 0.22, winW + 0.2],
      );
    }

    // Upper-storey bedroom windows on 2-storey homes (h >= 6.2)
    if (h >= 6.2) {
      const uy = 4.65;
      const uCount = span >= 10 ? 3 : 2;
      for (let i = 0; i < uCount; i++) {
        const uwc = origin + (span * (i + 1)) / (uCount + 1);
        if (alongX) {
          glassPane(group, WINDOW_GLASS_MAT, uwc, uy, outPlane, 1.7, 1.35, 0.08);
          frameMesh(group, 1.8, 1.45, uwc, uy, outPlane + outSign * 0.02, faceRotY(hFace));
          for (const side of [-1, 1]) {
            shutterBoxes.push([uwc + side * 1.12, uy, outPlane, 0.3, 1.45, 0.08]);
          }
        } else {
          glassPane(group, WINDOW_GLASS_MAT, outPlane, uy, uwc, 0.08, 1.35, 1.7);
          frameMesh(group, 1.8, 1.45, outPlane + outSign * 0.02, uy, uwc, faceRotY(hFace));
          for (const side of [-1, 1]) {
            shutterBoxes.push([outPlane, uy, uwc + side * 1.12, 0.08, 1.45, 0.3]);
          }
        }
      }
    }
    addMergedBoxes(group, shutterBoxes, shutterMat, false);
  }

  // 5. Mid/high-rise 3D Juliet balconies & window lintels on street-facing walls (h >= 9.5)
  if (h >= 9.5 && f.glass !== "curtain") {
    const bFace = f.face;
    const alongX = bFace === "n" || bFace === "s";
    const span = alongX ? w : d;
    const origin = alongX ? x : z;
    const outSign = bFace === "n" || bFace === "w" ? -1 : 1;
    const wallPlane = bFace === "n" ? z : bFace === "s" ? z + d : bFace === "w" ? x : x + w;
    const cols = Math.max(2, Math.min(4, Math.floor(span / 5.5)));
    for (let by = 6.2; by < h - 2.2; by += 7.0) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const bc = origin + (span * (cIdx + 1)) / (cols + 1);
        const slabP = wallPlane + outSign * 0.24;
        const railP = wallPlane + outSign * 0.42;
        if (alongX) {
          trimBoxes.push([bc, by, slabP, 2.3, 0.16, 0.48]);
          darkBoxes.push([bc, by + 0.48, railP, 2.2, 0.08, 0.08]);
          darkBoxes.push([bc - 1.05, by + 0.28, slabP, 0.08, 0.44, 0.42]);
          darkBoxes.push([bc + 1.05, by + 0.28, slabP, 0.08, 0.44, 0.42]);
          darkBoxes.push([bc, by + 0.28, railP, 0.08, 0.44, 0.08]);
        } else {
          trimBoxes.push([slabP, by, bc, 0.48, 0.16, 2.3]);
          darkBoxes.push([railP, by + 0.48, bc, 0.08, 0.08, 2.2]);
          darkBoxes.push([slabP, by + 0.28, bc - 1.05, 0.42, 0.44, 0.08]);
          darkBoxes.push([slabP, by + 0.28, bc + 1.05, 0.42, 0.44, 0.08]);
          darkBoxes.push([railP, by + 0.28, bc, 0.08, 0.44, 0.08]);
        }
      }
    }
  }

  addMergedBoxes(group, trimBoxes, trimMat, false);
  addMergedBoxes(group, darkBoxes, DARK_MAT, false);
  addMergedBoxes(group, woodBoxes, WOOD_MAT, false);
  addMergedBoxes(group, foliageBoxes, FOLIAGE_MAT, false);
}

// Gold trim band at the top of the walls.
function addCornice(group: Group, f: Facade) {
  const pad = f.glassProud ? 0.6 : 0;
  const trim = new Mesh(box, GOLD_MAT);
  trim.position.set(f.x + f.w / 2, f.h - 0.15, f.z + f.d / 2);
  trim.scale.set(f.w + 0.3 + pad, 0.35, f.d + 0.3 + pad);
  group.add(trim);
}

// A smaller box crowning the roof (the HQ's stepped top).
function addCrownBox(group: Group, f: Facade, material: MeshStandardMaterial) {
  const crown = f.crown;
  if (!crown) return;
  const cx = f.x + f.w / 2;
  const cz = f.z + f.d / 2;
  const mesh = new Mesh(worldUvBox(cx, f.h + crown.h / 2, cz, crown.w, crown.h, crown.d, 10, 14), material);
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
  const tierBoxes: UvBoxTuple[] = [];
  const finBoxes: BoxTuple[] = [];
  tiers.forEach((tier, index) => {
    tierBoxes.push([cx, y + tier.h / 2, cz, tier.w, tier.h, tier.d]);
    if (index > 0) {
      finBoxes.push([cx, y, cz, tier.w + 0.35, 0.35, tier.d + 0.35]);
    }
    // Corner pilasters on each stepped tier
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        finBoxes.push([
          cx + sx * (tier.w / 2 + 0.04),
          y + tier.h / 2,
          cz + sz * (tier.d / 2 + 0.04),
          0.28,
          tier.h,
          0.28,
        ]);
      }
    }
    // Round 3: real window depth on the tier walls — curtain towers get
    // their glass bands, everything else gets recessed window bands.
    // (Tiered towers had no upper glass at all before this.)
    if (f.glass === "curtain") {
      addCurtainBands(group, cx - tier.w / 2, cz - tier.d / 2, tier.w, tier.d, y + 2.0, y + tier.h, f.style);
    } else {
      addUpperWindowBands(group, cx - tier.w / 2, cz - tier.d / 2, tier.w, tier.d, y, y + tier.h);
    }
    y += tier.h;
  });
  addWorldUvBoxes(group, tierBoxes, material, 10, 14, true);
  addMergedBoxes(group, finBoxes, GOLD_MAT, false);
}

// A side annex (L-shaped footprint) with its own small roof.
function addWing(group: Group, f: Facade, material: MeshStandardMaterial) {
  const wing = f.wing;
  if (!wing) return;
  const wx = f.x + wing.dx;
  const wz = f.z + wing.dz;
  const isHomeWing = f.glass === "home" || !!f.porch || wing.h <= 6.2;
  const wingMat = isHomeWing ? baseWallMaterial(f) : material;
  const mesh = new Mesh(
    worldUvBox(
      wx + wing.w / 2,
      wing.h / 2,
      wz + wing.d / 2,
      wing.w,
      wing.h,
      wing.d,
      isHomeWing ? 8 : 10,
      isHomeWing ? 8 : 14,
    ),
    wingMat,
  );
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
  if (!f.crown) addRoofKit(group, f.x, f.z, f.w, f.d, f.h, f.style);
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
  let y = 0;
  const goldFinBoxes: BoxTuple[] = [];
  const cyanFinBoxes: BoxTuple[] = [];
  // Rounded glass corner columns (round-2): one vertical glass cylinder
  // per tier corner, so the tower's edges read curved, not square. The
  // old gold fin boxes at the corners are gone; the cyan nodes become
  // glowing caps on the column tops.
  const cornerGeo = new CylinderGeometry(0.5, 0.5, 1, 12);
  const cornerCols: Array<{ x: number; y: number; z: number; h: number }> = [];
  tiers.forEach((tier, index) => {
    const material = facadeMaterial(index % 2 === 0 ? 5 : 0);
    const cz = -3 - tier.d / 2;
    const mesh = new Mesh(worldUvBox(0, y + tier.h / 2, cz, tier.w, tier.h, tier.d, 10, 14), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (index > 0) {
      goldFinBoxes.push([0, y, cz, tier.w + 0.4, 0.38, tier.d + 0.4]);
    }
    // Round 3: recessed window bands on every tier — the hero tower's
    // walls were pure texture above the atrium. Tier 1's south face is
    // skipped: the glass atrium stands in front of it.
    addUpperWindowBands(
      group,
      -tier.w / 2,
      cz - tier.d / 2,
      tier.w,
      tier.d,
      y,
      y + tier.h,
      index === 0 ? ["n", "e", "w"] : ["n", "s", "w", "e"],
    );
    // Illuminated corner columns + setback beacon caps on every tier
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const fx = sx * (tier.w / 2);
        const fz = cz + sz * (tier.d / 2);
        cornerCols.push({ x: fx, y: y + tier.h / 2, z: fz, h: tier.h });
        cyanFinBoxes.push([fx, y + tier.h - 0.12, fz, 0.5, 0.24, 0.5]);
      }
    }
    y += tier.h;
  });
  for (const c of cornerCols) {
    const colMesh = new Mesh(cornerGeo, CURTAIN_GLASS_MAT);
    colMesh.position.set(c.x, c.y, c.z);
    colMesh.scale.set(1, c.h, 1);
    group.add(colMesh);
  }
  addMergedBoxes(group, goldFinBoxes, GOLD_MAT, false);
  addMergedBoxes(group, cyanFinBoxes, CYAN_BEACON_MAT, false);

  // Real glass atrium, proud of the tier-1 front face
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

  // Closed real door in front of the glass atrium
  const towerSlab = new Mesh(box, DOOR_SLAB_MAT);
  towerSlab.position.set(0, 1.45, -1.4);
  towerSlab.scale.set(3.4, 2.9, 0.16);
  towerSlab.castShadow = true;
  group.add(towerSlab);
  for (const off of [-1.85, 1.85]) {
    const post = new Mesh(box, WHITE_MAT);
    post.position.set(off, 1.55, -1.4);
    post.scale.set(0.35, 3.1, 0.2);
    group.add(post);
  }
  const towerLintel = new Mesh(box, WHITE_MAT);
  towerLintel.position.set(0, 3.12, -1.4);
  towerLintel.scale.set(4.3, 0.26, 0.2);
  group.add(towerLintel);
  for (const side of [-0.18, 0.18]) {
    const handle = new Mesh(box, GOLD_MAT);
    handle.position.set(1.2, 1.15, -1.4 + side);
    handle.scale.set(0.16, 0.16, 0.16);
    group.add(handle);
  }

  const top = tiers[tiers.length - 1];
  const roofY = y + 1.35;
  // Helipad on the tallest tower (round-2): a dark disc with a gold rim
  // ring, an emissive H, and cyan edge lights on the top tier, clear of
  // the ORBITX signs at the front edge. The mast + beacon move to the
  // top tier's rear corner so the pad stays clear.
  const padY = y + 0.15;
  const padCZ = -3 - top.d / 2;
  const pad = new Mesh(new CylinderGeometry(3.6, 3.6, 0.3, 24), DARK_MAT);
  pad.position.set(0, padY, padCZ);
  pad.castShadow = true;
  pad.receiveShadow = true;
  group.add(pad);
  const padRim = new Mesh(new TorusGeometry(3.6, 0.08, 8, 32), GOLD_MAT);
  padRim.rotation.x = Math.PI / 2;
  padRim.position.set(0, padY + 0.16, padCZ);
  group.add(padRim);
  const hMat = new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x1ad8ff, emissiveIntensity: 1.6, roughness: 0.3 });
  for (const off of [-1.1, 1.1]) {
    const bar = new Mesh(box, hMat);
    bar.position.set(off, padY + 0.18, padCZ);
    bar.scale.set(0.28, 0.06, 3.2);
    group.add(bar);
  }
  const hCross = new Mesh(box, hMat);
  hCross.position.set(0, padY + 0.18, padCZ);
  hCross.scale.set(2.5, 0.06, 0.28);
  group.add(hCross);
  const front = orbitWord();
  front.position.set(0, roofY, -2.55);
  group.add(front);
  const back = orbitWord();
  back.position.set(0, roofY, -3 - top.d - 0.4);
  back.rotation.y = Math.PI;
  group.add(back);

  const colTrimBoxes: BoxTuple[] = [];
  for (const x of [-8, -4, 4, 8]) {
    const col = new Mesh(column, WHITE_MAT);
    col.scale.set(1, 6.2, 1);
    col.position.set(x, 3.1, -1.2);
    col.castShadow = true;
    group.add(col);
    colTrimBoxes.push([x, 0.22, -1.2, 1.05, 0.44, 1.05]);
    colTrimBoxes.push([x, 5.95, -1.2, 1.05, 0.36, 1.05]);
  }
  addMergedBoxes(group, colTrimBoxes, GOLD_MAT, false);

  const canopy = new Mesh(box, DARK_MAT);
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

  const pole = new Mesh(box, POLE_MAT);
  pole.position.set(-top.w / 2 + 0.8, y + 1.6, -3 - top.d + 0.8);
  pole.scale.set(0.2, 3.2, 0.2);
  group.add(pole);
  const beacon = new Mesh(box, CYAN_BEACON_MAT);
  beacon.position.set(-top.w / 2 + 0.8, y + 3.4, -3 - top.d + 0.8);
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
  for (const facade of facades) {
    if (facade.glass) {
      if (facade.id.startsWith("home-")) glassStats.homes++;
      else glassStats.offices++;
    }
    if (facade.hero && facade.id === "tower") {
      root.add(solidTower(facade));
      continue;
    }
    const material = facadeMaterial(facade.style);
    if (facade.tiers) {
      addTiers(root, facade, material);
      const top = facade.tiers[facade.tiers.length - 1];
      addRoofKit(
        root,
        facade.x + (facade.w - top.w) / 2,
        facade.z + (facade.d - top.d) / 2,
        top.w,
        top.d,
        facade.h,
        facade.style,
      );
      if (facade.wing) addWing(root, facade, material);
      continue;
    }
    // Stepped enterable tower (round-2): one hollow segment per recorded
    // shell-loop step, door gap only on the ground step. The roof kit
    // sits on the top step (tapered rect when the tower tapers); the
    // cornice is skipped — the gold setback ledges are the trim.
    if (facade.steps && facade.steps.length > 1 && facade.enterable) {
      root.add(steppedHollow(facade, material, !!facade.glass));
      const top = facade.steps[facade.steps.length - 1]!;
      const ts = facade.taper ?? 1;
      const topF: Facade = {
        ...facade,
        x: top.x + (top.w * (1 - ts)) / 2,
        z: top.z + (top.d * (1 - ts)) / 2,
        w: top.w * ts,
        d: top.d * ts,
      };
      const stepRise = addRoof(root, topF);
      if (facade.chimney) addChimney(root, topF, stepRise);
      if (facade.storefront) addStorefront(root, facade);
      if (facade.crown) addCrownBox(root, topF, material);
      if (facade.wing) addWing(root, facade, material);
      continue;
    }
    if (facade.enterable) {
      root.add(hollow(facade, material, !!facade.glass));
    } else {
      const mesh = new Mesh(
        worldUvBox(
          facade.x + facade.w / 2,
          facade.h / 2,
          facade.z + facade.d / 2,
          facade.w + 0.08,
          facade.h,
          facade.d + 0.08,
          10,
          14,
        ),
        material,
      );
      mesh.castShadow = quality !== "low";
      mesh.receiveShadow = quality !== "low";
      root.add(mesh);
    }
    addArchitecturalDetails(root, facade);
    // Tapered shells: the roof kit / cornice / chimney / crown sit on
    // the tapered top rect, not the full base footprint.
    const roofF = facade.taper
      ? {
          ...facade,
          x: facade.x + (facade.w * (1 - facade.taper)) / 2,
          z: facade.z + (facade.d * (1 - facade.taper)) / 2,
          w: facade.w * facade.taper,
          d: facade.d * facade.taper,
        }
      : facade;
    const rise = addRoof(root, roofF);
    if (facade.porch) addPorch(root, facade);
    if (facade.chimney) addChimney(root, roofF, rise);
    if (facade.storefront) addStorefront(root, facade);
    if (facade.cornice) addCornice(root, roofF);
    if (facade.crown) addCrownBox(root, roofF, material);
    if (facade.wing) addWing(root, facade, material);
  }
  if (typeof window !== "undefined") {
    (window as unknown as { __ORBITX_GLASS: typeof glassStats }).__ORBITX_GLASS = { ...glassStats };
  }
  return root;
}
