import { MeshStandardMaterial } from "three";
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
  asphalt: styledMaterial({ color: 0x171a22 }),
  sidewalk: styledMaterial({ color: 0xc5c9d1, grid: 0.35 }),
  plaza: styledMaterial({ color: 0xe4e7ee, grid: 0.45 }),
  grass: styledMaterial({ color: 0x3c9a3a, grid: 0.4 }),
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

export const GOLD = MATERIALS.gold;
