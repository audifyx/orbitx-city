import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { Mat } from "./city";

/**
 * REAL textures (2026-11-17, textures upgrade). The old look was a 128px
 * near-white speckle/brick "grain" that only multiplied the flat material
 * colour — at phone size it reads as flat colour + pixel noise, and the
 * huge ground slabs (grass 760u, sidewalk 400u) got NO map at all, just
 * flat colour. The user called it pixelated and asked for real sky, grass,
 * cement and building textures.
 *
 * This module generates real 512px procedural textures at load (seeded, so
 * the world looks identical every boot) and assigns them to the materials:
 *
 * - The texture itself carries the REAL colour (grass greens, cement greys,
 *   brick reds/tans, asphalt aggregate). The material colour is white when
 *   a map is present, so the texture shows un-tinted. When there is no
 *   document (node — api tests, door-blockers check) there is no map and
 *   the material falls back to its flat colour, so node behaviour is
 *   unchanged.
 * - Every texture is TILEABLE: elements are drawn at all 9 wrapped
 *   offsets (or aligned to the tile grid), so repeating it shows no seam.
 * - Repeat is PER MATERIAL, tuned to the size of the boxes that use it.
 *   A CanvasTexture maps 0-1 across ONE box face, and the world renders
 *   as one InstancedMesh per material on a shared unit BoxGeometry, so one
 *   repeat value cannot fit both a 760u slab and a 1u voxel. The big slabs
 *   therefore get their OWN materials (grassField / sidewalkField /
 *   plazaField) with high repeats (tile ~= 8 world units); small boxes keep
 *   the base material with repeat 1-2. city.ts / states.ts route the big
 *   slabs to the field materials.
 * - Phone budget: 512px maps, ~13 distinct canvases (~13MB GPU), reused
 *   across every mesh of that material. No 4K maps, no per-mesh textures.
 */

function styledMaterial(opts: {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  roughness?: number;
  metalness?: number;
}) {
  return new MeshStandardMaterial({
    color: opts.color,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    roughness: opts.roughness ?? (opts.emissive ? 0.28 : 0.78),
    metalness: opts.metalness ?? (opts.emissive ? 0.22 : 0.04),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffsetFactor ?? (opts.polygonOffset ? -2 : 0),
    polygonOffsetUnits: opts.polygonOffsetUnits ?? (opts.polygonOffset ? -4 : 0),
  });
}

/* ------------------------------------------------------------------ */
/* Seeded RNG + tileable drawing helpers                              */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const SIZE = 512;

function makeCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  return canvas.getContext("2d");
}

/** Run `draw(ox, oy)` at the tile and its 8 wrapped neighbours, so any
 *  element near an edge continues seamlessly across the seam. */
function tiled(
  ctx: CanvasRenderingContext2D,
  draw: (ox: number, oy: number) => void,
) {
  for (const ox of [-SIZE, 0, SIZE]) {
    for (const oy of [-SIZE, 0, SIZE]) {
      ctx.save();
      ctx.translate(ox, oy);
      draw(0, 0);
      ctx.restore();
    }
  }
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function softBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, colorWithAlpha(color, alpha));
  g.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function colorWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

/** Dense fine speckle — the aggregate / grain that makes a surface read
 *  as a real material instead of flat colour. */
function speckle(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  count: number,
  colors: readonly string[],
  alphaMin: number,
  alphaMax: number,
  sizeMin: number,
  sizeMax: number,
) {
  for (let i = 0; i < count; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const s = sizeMin + rng() * (sizeMax - sizeMin);
    const a = alphaMin + rng() * (alphaMax - alphaMin);
    ctx.fillStyle = colorWithAlpha(pick(rng, colors), a);
    ctx.fillRect(x, y, s, s);
    // Wrap the dot across the seam when it sits near an edge.
    if (x < sizeMax) ctx.fillRect(x + SIZE, y, s, s);
    if (x > SIZE - sizeMax) ctx.fillRect(x - SIZE, y, s, s);
    if (y < sizeMax) ctx.fillRect(x, y + SIZE, s, s);
    if (y > SIZE - sizeMax) ctx.fillRect(x, y - SIZE, s, s);
  }
}

/** Large soft tonal patches — the lawn / pavement / plaster variation
 *  that stops a big surface reading as one flat colour. */
function mottling(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  count: number,
  colors: readonly string[],
  alphaMin: number,
  alphaMax: number,
  rMin: number,
  rMax: number,
) {
  for (let i = 0; i < count; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const r = rMin + rng() * (rMax - rMin);
    const a = alphaMin + rng() * (alphaMax - alphaMin);
    tiled(ctx, () => softBlob(ctx, x, y, r, pick(rng, colors), a));
  }
}

/* ------------------------------------------------------------------ */
/* Texture painters — one per surface. Each paints a full 512 tile.   */
/* ------------------------------------------------------------------ */

const GRASS_GREENS = ["#2e7d32", "#3f9a3d", "#55a83f", "#6db34a", "#2a6e2b", "#7ec850", "#a8d94a", "#1f6e28"];
function paintGrass(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#3f9a3d";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Broad lawn variation: big soft patches of lighter / darker green.
  mottling(ctx, rng, 42, ["#2e7d32", "#55a83f", "#6db34a", "#2a6e2b", "#4da344"], 0.16, 0.3, 40, 120);
  // Grass blades: thousands of short vertical strokes in varied greens.
  // On the field (repeat 95, tile 8u) these read as tufts; on a 1u voxel
  // (repeat 1) they read as fine turf grain.
  for (let i = 0; i < 5200; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const h = 3 + rng() * 7;
    const a = 0.3 + rng() * 0.4;
    ctx.fillStyle = colorWithAlpha(pick(rng, GRASS_GREENS), a);
    ctx.fillRect(x, y, 1.4, h);
    if (x > SIZE - 2) ctx.fillRect(x - SIZE, y, 1.4, h);
    if (y > SIZE - 8) ctx.fillRect(x, y - SIZE, 1.4, h);
  }
  // A little bare earth showing through.
  speckle(ctx, rng, 260, ["#5a4028", "#6b4a2e", "#3a2a18"], 0.12, 0.3, 1, 3);
}

const CEMENT_GREYS = ["#a8adb5", "#d8dbe0", "#9aa0a8", "#c2c6cc", "#8a8f97"];
function paintCement(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#c9ccd2";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 30, ["#bfc3ca", "#d3d6db", "#b4b8bf", "#dcdfe3"], 0.14, 0.26, 40, 130);
  // Fine aggregate — the sand / stone grit that makes concrete read.
  speckle(ctx, rng, 7500, CEMENT_GREYS, 0.25, 0.6, 1, 2.4);
  // A few hairline cracks, very subtle.
  ctx.strokeStyle = "rgba(90,95,105,0.20)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = rng() * SIZE;
    let y = rng() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rng() - 0.5) * 70;
      y += (rng() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** The big-city ground: cement + a 2x2 expansion-joint grid. The joints
 *  sit on the tile grid (0 / 256), so they align across the seam and read
 *  as a real pavement of 4u slabs on the field (repeat 50, tile 8u). */
function paintPavement(ctx: CanvasRenderingContext2D, rng: Rng) {
  paintCement(ctx, rng);
  ctx.fillStyle = "rgba(110,115,124,0.55)";
  for (const p of [0, 256]) {
    ctx.fillRect(p - 1.5, 0, 3, SIZE);
    ctx.fillRect(0, p - 1.5, SIZE, 3);
  }
  // Slight per-slab tone shift so the four slabs don't read identical.
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "rgba(0,0,0,0.04)";
  ctx.fillRect(256, 256, 256, 256);
}

const ASPHALT_GREYS = ["#353a42", "#22262d", "#434952", "#2c3139", "#525862", "#252930"];
function paintAsphalt(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#292d34";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Isotropic fine stone aggregate only (no large blotches that streak on
  // long road strips).
  speckle(ctx, rng, 16000, ASPHALT_GREYS, 0.32, 0.68, 1, 2.0);
  speckle(ctx, rng, 900, ["#686e78", "#767c86", "#4e545d"], 0.28, 0.5, 1.2, 2.4);
}

/** Stone pavers, 4x4 per tile. On the plaza field (repeat 7, tile 8.3u)
 *  each paver is ~2u; on a small floor (repeat 2) ~0.5u. */
function paintPavers(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#9a9da3";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const cell = SIZE / 4;
  const tones = ["#d5d7db", "#e2e3e6", "#cfd1d5", "#dcdde0", "#c6c8cc"];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * cell;
      const y = row * cell;
      ctx.fillStyle = pick(rng, tones);
      ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      // Per-paver mottling so no two pavers match.
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x + 2, y + 2, cell - 4, (cell - 4) / 2);
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(x + 2, y + (cell - 4) / 2 + 2, cell - 4, (cell - 4) / 2);
    }
  }
  speckle(ctx, rng, 2600, ["#a8adb5", "#e8eaec", "#8f939a"], 0.2, 0.45, 1, 2);
}

const BRICK_COLORS = ["#9a4a34", "#b85a40", "#c07a3e", "#a86a30", "#d9b06a", "#c49a5a", "#7a3a28", "#b06a48", "#8a5a30", "#c98a5a"];
function paintBrick(ctx: CanvasRenderingContext2D, rng: Rng) {
  // Mortar first, then bricks. 4 courses x 2 bricks per tile: on a 1u
  // voxel face each brick is 0.5u x 0.25u — real brick proportions.
  // The mortar is dark and the per-brick colours are strongly varied, so
  // the courses read at street distance (a faint brick reads as flat
  // beige — the user asked for REAL building texture, not a hint of it).
  ctx.fillStyle = "#8a7a64";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const courseH = SIZE / 4;
  const brickW = SIZE / 2;
  for (let row = 0; row < 4; row++) {
    const y = row * courseH;
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 3; col++) {
      const x = offset + col * brickW;
      const color = pick(rng, BRICK_COLORS);
      ctx.fillStyle = color;
      ctx.fillRect(x + 5, y + 5, brickW - 10, courseH - 10);
      // Per-brick mottling + a top highlight / bottom shadow for depth.
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(x + 5, y + 5, brickW - 10, 12);
      ctx.fillStyle = "rgba(0,0,0,0.20)";
      ctx.fillRect(x + 5, y + courseH - 17, brickW - 10, 12);
      speckle(ctx, rng, 14, ["#000000", "#ffffff"], 0.08, 0.16, 2, 5);
      // Wrap the brick rect across the seam when it straddles an edge.
      if (x < 0) {
        ctx.fillStyle = color;
        ctx.fillRect(x + SIZE + 4, y + 4, brickW - 8, courseH - 8);
      }
      if (x + brickW > SIZE) {
        ctx.fillStyle = color;
        ctx.fillRect(x - SIZE + 4, y + 4, brickW - 8, courseH - 8);
      }
    }
  }
}

function paintStone(ctx: CanvasRenderingContext2D, rng: Rng) {
  // Ashlar blocks, 3 courses x 2 blocks, staggered. Base courses read as
  // a stone foundation on the facades that use it.
  ctx.fillStyle = "#8f959c";
  ctx.fillRect(0, 0, SIZE, SIZE);
  const courseH = SIZE / 3;
  const blockW = SIZE / 2;
  const tones = ["#b9bec4", "#a8adb4", "#c6cbd0", "#9aa0a7", "#b0b5bc"];
  for (let row = 0; row < 3; row++) {
    const y = row * courseH;
    const offset = row % 2 === 0 ? 0 : blockW / 2;
    for (let col = -1; col < 3; col++) {
      const x = offset + col * blockW;
      ctx.fillStyle = pick(rng, tones);
      ctx.fillRect(x + 3, y + 3, blockW - 6, courseH - 6);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x + 3, y + 3, blockW - 6, 8);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x + 3, y + courseH - 11, blockW - 6, 8);
      if (x < 0) {
        ctx.fillStyle = pick(rng, tones);
        ctx.fillRect(x + SIZE + 3, y + 3, blockW - 6, courseH - 6);
      }
      if (x + blockW > SIZE) {
        ctx.fillStyle = pick(rng, tones);
        ctx.fillRect(x - SIZE + 3, y + 3, blockW - 6, courseH - 6);
      }
    }
  }
  speckle(ctx, rng, 2200, ["#7a8087", "#d5d9de", "#9aa0a7"], 0.2, 0.45, 1, 2);
}

/** Painted stucco / plaster — deliberately subtle; white walls stay bright. */
function paintStucco(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#f2f4f7";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 26, ["#e8ebef", "#f7f9fb", "#e2e5e9"], 0.12, 0.22, 40, 120);
  speckle(ctx, rng, 3200, ["#d5d9de", "#ffffff", "#e0e3e7"], 0.18, 0.4, 1, 2);
}

/** Dark window glass: near-black with a soft diagonal reflection band
 *  and faint mullions, so facade windows read as glass, not flat black. */
function paintGlass(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#14181f";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Diagonal reflection band (soft, wrapped so it tiles).
  tiled(ctx, () => {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, "rgba(120,150,190,0)");
    g.addColorStop(0.42, "rgba(120,150,190,0)");
    g.addColorStop(0.5, "rgba(120,150,190,0.28)");
    g.addColorStop(0.58, "rgba(120,150,190,0)");
    g.addColorStop(1, "rgba(120,150,190,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  });
  // Faint vertical mullions on the tile grid (align across the seam).
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (const p of [0, 256]) ctx.fillRect(p - 1, 0, 2, SIZE);
  speckle(ctx, rng, 500, ["#2a3140", "#0c0f14", "#3a4356"], 0.2, 0.4, 1, 2);
}

/** Cast concrete panels, 2x2 per tile, with aggregate. */
function paintConcrete(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#4a5058";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 24, ["#42484f", "#545a62", "#3c4148"], 0.15, 0.28, 40, 120);
  ctx.fillStyle = "rgba(20,22,26,0.5)";
  for (const p of [0, 256]) {
    ctx.fillRect(p - 1.5, 0, 3, SIZE);
    ctx.fillRect(0, p - 1.5, SIZE, 3);
  }
  speckle(ctx, rng, 5000, ["#5a6068", "#33383f", "#6a7078"], 0.25, 0.55, 1, 2.2);
}

function paintWood(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 20, ["#6b4526", "#8a5f38", "#5a3a20"], 0.15, 0.3, 30, 100);
  // Vertical grain streaks, full height so they wrap in y; wrapped in x.
  for (let i = 0; i < 130; i++) {
    const x = rng() * SIZE;
    const w = 1 + rng() * 4;
    const light = rng() > 0.5;
    ctx.fillStyle = light
      ? `rgba(154,106,64,${(0.2 + rng() * 0.25).toFixed(3)})`
      : `rgba(70,45,22,${(0.25 + rng() * 0.3).toFixed(3)})`;
    ctx.fillRect(x, 0, w, SIZE);
    if (x < 5) ctx.fillRect(x + SIZE, 0, w, SIZE);
    if (x > SIZE - 5) ctx.fillRect(x - SIZE, 0, w, SIZE);
  }
  // A few knots.
  for (let i = 0; i < 6; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    tiled(ctx, () => {
      ctx.strokeStyle = "rgba(60,38,18,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 5 + rng() * 4, 8 + rng() * 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
}

const LEAF_GREENS = ["#2a7a2e", "#3f9a3d", "#55b34a", "#1f6e28", "#7ec850", "#2f8a35", "#4da344"];
function paintFoliage(ctx: CanvasRenderingContext2D, rng: Rng, dark: boolean) {
  ctx.fillStyle = dark ? "#1d5e26" : "#2a7a2e";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 30, dark ? ["#174d1f", "#256b2c", "#123f18"] : ["#2f8a35", "#3f9a3d", "#256b2c"], 0.2, 0.35, 30, 90);
  // Leaf clumps: hundreds of small ellipses in varied greens.
  for (let i = 0; i < 700; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const rx = 6 + rng() * 16;
    const ry = 5 + rng() * 12;
    const a = 0.3 + rng() * 0.45;
    const color = pick(rng, LEAF_GREENS);
    tiled(ctx, () => {
      ctx.fillStyle = colorWithAlpha(color, a);
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Deep shadow pockets between clumps.
  for (let i = 0; i < 60; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    tiled(ctx, () => softBlob(ctx, x, y, 8 + rng() * 18, "#0f3d16", 0.25 + rng() * 0.25));
  }
}

function paintDirt(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#6a3b2c";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 36, ["#5a3024", "#7a4a38", "#4a2618", "#8a5a40"], 0.18, 0.32, 30, 110);
  // Rock flecks + a little dry grass.
  speckle(ctx, rng, 1400, ["#8a8074", "#9a9082", "#5a5148", "#a89a88"], 0.3, 0.6, 1, 3);
  speckle(ctx, rng, 500, ["#7a8a3a", "#5a6e2a", "#8a9a4a"], 0.2, 0.4, 1, 2.5);
}

function paintDarkSurface(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#141820";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 18, ["#10141b", "#1a202b", "#151a23"], 0.14, 0.26, 36, 96);
  speckle(ctx, rng, 4200, ["#222938", "#0c0f14", "#1b212e"], 0.18, 0.38, 1, 2);
}

function paintCreamPlaster(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 24, ["#ede6d8", "#f8f4eb", "#e6dfd0"], 0.12, 0.22, 40, 110);
  speckle(ctx, rng, 3400, ["#dfd7c6", "#ffffff", "#eae3d4"], 0.16, 0.34, 1, 2);
}

function paintCrimson(ctx: CanvasRenderingContext2D, rng: Rng) {
  ctx.fillStyle = "#d92b3c";
  ctx.fillRect(0, 0, SIZE, SIZE);
  mottling(ctx, rng, 22, ["#c22030", "#e8384a", "#b51c2b"], 0.15, 0.28, 32, 96);
  speckle(ctx, rng, 3800, ["#f25262", "#9e1624", "#e03244"], 0.2, 0.42, 1, 2.2);
}

/* ------------------------------------------------------------------ */
/* Build the textures (browser only) and the material record.         */
/* ------------------------------------------------------------------ */

type TexSpec = { paint: (ctx: CanvasRenderingContext2D, rng: Rng) => void; repeat: number; seed: number };

function buildTexture(spec: TexSpec): CanvasTexture | undefined {
  const ctx = makeCtx();
  if (!ctx) return undefined;
  spec.paint(ctx, mulberry32(spec.seed));
  const canvas = ctx.canvas;
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.repeat.set(spec.repeat, spec.repeat);
  tex.anisotropy = 4;
  return tex;
}

/** One texture per surface; the field materials reuse the same painter
 *  with a different repeat (tile ~= 8 world units on the big slabs). */
const TEX: Partial<Record<string, TexSpec>> = {
  grass: { paint: paintGrass, repeat: 1, seed: 11 },
  grassField: { paint: paintGrass, repeat: 95, seed: 11 },
  cement: { paint: paintCement, repeat: 1, seed: 22 },
  pavement: { paint: paintPavement, repeat: 50, seed: 22 },
  asphalt: { paint: paintAsphalt, repeat: 6, seed: 33 },
  pavers: { paint: paintPavers, repeat: 2, seed: 44 },
  paversField: { paint: paintPavers, repeat: 7, seed: 44 },
  brick: { paint: paintBrick, repeat: 1, seed: 55 },
  stone: { paint: paintStone, repeat: 1, seed: 66 },
  stucco: { paint: paintStucco, repeat: 1, seed: 77 },
  creamPlaster: { paint: paintCreamPlaster, repeat: 2, seed: 78 },
  glass: { paint: paintGlass, repeat: 1, seed: 88 },
  darkSurface: { paint: paintDarkSurface, repeat: 1, seed: 89 },
  crimson: { paint: paintCrimson, repeat: 2, seed: 56 },
  concrete: { paint: paintConcrete, repeat: 1, seed: 99 },
  wood: { paint: paintWood, repeat: 1, seed: 111 },
  foliage: { paint: (c, r) => paintFoliage(c, r, false), repeat: 1, seed: 122 },
  foliageDark: { paint: (c, r) => paintFoliage(c, r, true), repeat: 1, seed: 123 },
  dirt: { paint: paintDirt, repeat: 2, seed: 133 },
};

const texCache = new Map<string, CanvasTexture>();
/** Shared texture getter (also used by pretty.ts for the visible facade
 *  panels — the voxel-box MATERIALS are not the only building surface).
 *  Returns undefined in node (no document), so callers must guard. */
export function textureFor(name: string): CanvasTexture | undefined {
  const hit = texCache.get(name);
  if (hit) return hit;
  const spec = TEX[name];
  if (!spec) return undefined;
  const tex = buildTexture(spec);
  if (tex) texCache.set(name, tex);
  return tex;
}

interface MatSpec {
  /** Flat colour used in node (no document) and as the base under the map. */
  color: number;
  tex?: string;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
  roughness?: number;
  metalness?: number;
}

const SPECS: Record<Mat, MatSpec> = {
  asphalt: { color: 0x2a2f3a, tex: "asphalt" },
  sidewalk: { color: 0xcfd3da, tex: "cement" },
  sidewalkField: { color: 0xcfd3da, tex: "pavement", polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 },
  plaza: { color: 0xe4e7ee, tex: "pavers" },
  plazaField: { color: 0xe4e7ee, tex: "paversField", polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 },
  grass: { color: 0x46a844, tex: "grass" },
  grassField: { color: 0x46a844, tex: "grassField", polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 },
  hedge: { color: 0x1d6e32, tex: "foliageDark" },
  leaves: { color: 0x37b24a, tex: "foliage" },
  leavesDark: { color: 0x1f8a34, tex: "foliageDark" },
  trunk: { color: 0x6b4a2e, tex: "wood" },
  black: { color: 0x12151c, tex: "darkSurface", roughness: 0.42, metalness: 0.35 },
  white: { color: 0xf4f6fa, tex: "stucco" },
  gray: { color: 0x3a404c, tex: "concrete" },
  cyan: {
    color: 0x7eefff,
    emissive: 0x19d8ff,
    emissiveIntensity: 0.95,
  },
  cyanhot: {
    color: 0xe9fbff,
    emissive: 0x5ef3ff,
    emissiveIntensity: 1.15,
  },
  water: {
    color: 0x1a74ff,
    emissive: 0x0a3ec8,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.82,
  },
  stone: { color: 0xd5dae2, tex: "stone" },
  lane: { color: 0xf7f7f2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 },
  hill: { color: 0x6a3b2c, tex: "dirt" },
  track: { color: 0x1c212b },
  wood: { color: 0x8a5a32, tex: "wood" },
  warm: {
    color: 0xffc27a,
    emissive: 0xff7a1a,
    emissiveIntensity: 0.85,
  },
  cream: { color: 0xf4f0e6, tex: "creamPlaster" },
  red: {
    color: 0xff4b5c,
    emissive: 0x8a1428,
    emissiveIntensity: 0.45,
    tex: "crimson",
  },
  gold: {
    color: 0xe0b33a,
    emissive: 0x8a5a10,
    emissiveIntensity: 0.35,
  },
  ceil: {
    color: 0xd5cfc3,
    emissive: 0x8a8074,
    emissiveIntensity: 0.72,
  },
};

export const MATERIALS: Record<Mat, MeshStandardMaterial> = {} as Record<Mat, MeshStandardMaterial>;
for (const [key, spec] of Object.entries(SPECS) as Array<[Mat, MatSpec]>) {
  const mat = styledMaterial(spec);
  const tex = spec.tex ? textureFor(spec.tex) : undefined;
  if (tex) {
    // The texture carries the real colour — the material must not tint it.
    mat.color.set(0xffffff);
    mat.map = tex;
  }
  MATERIALS[key] = mat;
}
MATERIALS.water.depthWrite = false;

export const GOLD = MATERIALS.gold;
