import {
  CanvasTexture,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { Mat } from "./city";

function styledMaterial(opts: {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  grid?: number;
  polygonOffset?: boolean;
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
    polygonOffsetFactor: opts.polygonOffset ? -2 : 0,
    polygonOffsetUnits: opts.polygonOffset ? -4 : 0,
  });
}

export const MATERIALS: Record<Mat, MeshStandardMaterial> = {
  asphalt: styledMaterial({ color: 0x2a2f3a }),
  sidewalk: styledMaterial({ color: 0xcfd3da, grid: 0.35 }),
  plaza: styledMaterial({ color: 0xe4e7ee, grid: 0.45 }),
  grass: styledMaterial({ color: 0x46a844, grid: 0.4 }),
  hedge: styledMaterial({ color: 0x1d6e32, grid: 0.7 }),
  leaves: styledMaterial({ color: 0x37b24a, grid: 0.55 }),
  leavesDark: styledMaterial({ color: 0x1f8a34, grid: 0.55 }),
  trunk: styledMaterial({ color: 0x6b4a2e, grid: 0.4 }),
  black: styledMaterial({ color: 0x12151c, grid: 0.85 }),
  white: styledMaterial({ color: 0xf4f6fa, grid: 0.75 }),
  gray: styledMaterial({ color: 0x3a404c, grid: 0.7 }),
  cyan: styledMaterial({
    color: 0x7eefff,
    emissive: 0x19d8ff,
    emissiveIntensity: 0.95,
    grid: 0.25,
  }),
  cyanhot: styledMaterial({
    color: 0xe9fbff,
    emissive: 0x5ef3ff,
    emissiveIntensity: 1.15,
  }),
  water: styledMaterial({
    color: 0x1a74ff,
    emissive: 0x0a3ec8,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.82,
  }),
  stone: styledMaterial({ color: 0xd5dae2, grid: 0.65 }),
  lane: styledMaterial({ color: 0xf7f7f2, polygonOffset: true }),
  hill: styledMaterial({ color: 0x6a3b2c, grid: 0.25 }),
  track: styledMaterial({ color: 0x1c212b, grid: 0.2 }),
  wood: styledMaterial({ color: 0x8a5a32, grid: 0.55 }),
  warm: styledMaterial({
    color: 0xffc27a,
    emissive: 0xff7a1a,
    emissiveIntensity: 0.85,
  }),
  cream: styledMaterial({ color: 0xf4f0e6, grid: 0.3 }),
  red: styledMaterial({
    color: 0xff4b5c,
    emissive: 0xaa1830,
    emissiveIntensity: 0.7,
  }),
  gold: styledMaterial({
    color: 0xe0b33a,
    emissive: 0x8a5a10,
    emissiveIntensity: 0.35,
  }),
  ceil: styledMaterial({
    color: 0xd5cfc3,
    emissive: 0x8a8074,
    emissiveIntensity: 0.72,
    grid: 0.2,
  }),
};
MATERIALS.water.depthWrite = false;

/**
 * Procedural surface grain (2026-11-13, world-quality upgrade). The
 * `grid` option on styledMaterial was accepted but IGNORED — every
 * surface was a flat colour, which reads dead next to the AI demo's
 * textured bark / foliage / pavement. Grain is a near-white canvas
 * (so the material colour still dominates) with darker + lighter
 * flecks; it multiplies the colour, it never replaces it.
 *
 * Scale rule: a CanvasTexture maps 0-1 across ONE box face, so grain
 * only reads on small boxes (trunk, leaves, stone, wood). The huge
 * ground slabs (grass 760u, sidewalk 400u) would stretch one texture
 * over the whole slab, so they deliberately get NO map — their richness
 * comes from colour + roughness only.
 *
 * Lazy + guarded: document is unavailable in node (api tests,
 * door-blockers check), so a missing document just means no map.
 * Strengths match the `grid` values on the literal above.
 */
const grainCache = new Map<string, CanvasTexture>();
function grainTexture(kind: "speckle" | "streak", strength: number): CanvasTexture | undefined {
  const key = `${kind}:${strength.toFixed(2)}`;
  const hit = grainCache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 128);
  if (kind === "streak") {
    // Vertical bark / wood-grain streaks, full height of the face.
    for (let i = 0; i < 110; i++) {
      const x = Math.random() * 128;
      const w = 1 + Math.random() * 3;
      const light = Math.random() > 0.5;
      ctx.fillStyle = light
        ? `rgba(255,255,255,${(strength * 0.22).toFixed(3)})`
        : `rgba(0,0,0,${(strength * 0.32).toFixed(3)})`;
      ctx.fillRect(x, 0, w, 128);
    }
  } else {
    // Speckle: leaf / stone / pavement grain.
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const s = 1 + Math.random() * 2;
      const light = Math.random() > 0.5;
      ctx.fillStyle = light
        ? `rgba(255,255,255,${(strength * 0.28).toFixed(3)})`
        : `rgba(0,0,0,${(strength * 0.32).toFixed(3)})`;
      ctx.fillRect(x, y, s, s);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  grainCache.set(key, tex);
  return tex;
}

const GRAIN: Partial<Record<Mat, { kind: "speckle" | "streak"; strength: number }>> = {
  trunk: { kind: "streak", strength: 0.4 },
  wood: { kind: "streak", strength: 0.55 },
  leaves: { kind: "speckle", strength: 0.55 },
  leavesDark: { kind: "speckle", strength: 0.55 },
  hedge: { kind: "speckle", strength: 0.7 },
  stone: { kind: "speckle", strength: 0.65 },
  black: { kind: "speckle", strength: 0.85 },
  gray: { kind: "speckle", strength: 0.7 },
  white: { kind: "speckle", strength: 0.75 },
};
for (const [key, spec] of Object.entries(GRAIN) as Array<[Mat, { kind: "speckle" | "streak"; strength: number }]>) {
  const tex = grainTexture(spec.kind, spec.strength);
  if (tex) MATERIALS[key].map = tex;
}

export const GOLD = MATERIALS.gold;
