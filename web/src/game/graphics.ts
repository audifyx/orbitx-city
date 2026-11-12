/**
 * OrbitX City — graphics: rendering quality upgrades that fit this engine
 * and stay cheap on phones.
 *
 * DEAD CODE until wired — see WIRING.md at the repo root for the exact
 * call sites (engine.ts createGame() + the day/night block).
 *
 * What this module deliberately does NOT do:
 * - No new post-processing passes. The bloom pass already exists and the
 *   composer only runs on "high"; a second pass would cost a full extra
 *   fullscreen draw on phones. Bloom tuning is a one-line edit in
 *   createGame() — see WIRING.md, it cannot be reached from here because
 *   the composer is a local, not on the scene.
 * - No textures, no normal/roughness maps. The city is flat-colour
 *   MeshStandardMaterial buckets; roughness/metalness variation is the
 *   whole material upgrade, and it costs zero per frame (uniforms).
 * - No per-frame work. Everything here runs once at preset apply (or
 *   once per day/night change through applyDayNightLighting).
 *
 * Phone-cost table (per quality, vs the current build):
 *   low    — shadows off, pixel ratio <= 1. Same cost as today.
 *   medium — shadows on, 1024 map, pixel ratio <= 1.25. +1 shadow pass.
 *   high   — 2048 map, tighter shadow camera, pixel ratio <= 1.5,
 *            optional one-time PMREM environment. Same as today's high
 *            plus ~5-15 ms once for the env map.
 *   ultra  — pixel ratio <= 2, 4096 shadow map, +-110 shadow camera.
 *            The 4096 map is ~4x the shadow fill of high: desktop /
 *            flagship phones only. Never default ultra on a phone.
 *
 * Metalness warning: without an environment map, high metalness looks
 * near-black (nothing to reflect). That is why upgradeMaterials() keeps
 * gold at 0.55 with its emissive intact, and why applyEnvironment()
 * (one-time RoomEnvironment PMREM) is the companion step on high/ultra.
 */

import {
  ACESFilmicToneMapping,
  Fog,
  PCFSoftShadowMap,
  PMREMGenerator,
  type AmbientLight,
  type DirectionalLight,
  type HemisphereLight,
  type Scene,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MATERIALS } from "./materials";

/** The three tiers the engine already knows, plus one above high. */
export type GraphicsQuality = "low" | "medium" | "high" | "ultra";

/**
 * The four lights createGame() builds (engine.ts ~line 137-150). They
 * are locals there, so the wiring agent passes them in; every field is
 * optional and the preset still applies without them.
 */
export interface CityLights {
  sun?: DirectionalLight;
  hemi?: HemisphereLight;
  fill?: DirectionalLight;
  ambient?: AmbientLight;
}

const PIXEL_RATIO_CAP: Record<GraphicsQuality, number> = {
  low: 1,
  medium: 1.25,
  high: 1.5,
  ultra: 2,
};

const SHADOW_MAP_SIZE: Record<GraphicsQuality, number> = {
  low: 1024,
  medium: 1024,
  high: 2048,
  ultra: 4096,
};

/** Half-extent of the sun shadow camera. Tighter = crisper shadows:
 *  the same texels cover less ground. The city core is ~+-110. */
const SHADOW_EXTENT: Record<GraphicsQuality, number> = {
  low: 150,
  medium: 150,
  high: 120,
  ultra: 110,
};

const TONE_EXPOSURE: Record<GraphicsQuality, number> = {
  low: 1.06,
  medium: 1.08,
  high: 1.1,
  ultra: 1.12,
};

/** Fog near/far per tier. Fog is a uniform, not geometry — free. */
const FOG_RANGE: Record<GraphicsQuality, [number, number]> = {
  low: [100, 420],
  medium: [140, 520],
  high: [170, 620],
  ultra: [200, 720],
};

/**
 * Apply a rendering preset. Call once at the end of createGame() (after
 * the renderer, lights, fog and sky exist) and again whenever the
 * player changes quality. Safe to call repeatedly.
 *
 * Returns a small report for logging / the debug HUD.
 */
export function applyGraphicsPreset(
  renderer: WebGLRenderer,
  scene: Scene,
  quality: GraphicsQuality,
  lights: CityLights = {},
): {
  quality: GraphicsQuality;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowExtent: number;
} {
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    PIXEL_RATIO_CAP[quality],
  );
  renderer.setPixelRatio(pixelRatio);
  // outputColorSpace stays SRGB (set in createGame); tone mapping here.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = TONE_EXPOSURE[quality];

  const shadows = quality !== "low";
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const size = SHADOW_MAP_SIZE[quality];
  const extent = SHADOW_EXTENT[quality];
  const sun = lights.sun;
  if (sun) {
    sun.castShadow = shadows;
    sun.shadow.mapSize.set(size, size);
    // Bias pair tuned for axis-aligned boxes: kills acne without
    // lifting shadows off the ground (peter-panning).
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = quality === "ultra" ? 0.8 : 0.5;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 420;
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.updateProjectionMatrix();
    // Changing mapSize after first render needs a fresh shadow map;
    // disposing forces three.js to re-allocate at the new size.
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  if (scene.fog instanceof Fog) {
    const [near, far] = FOG_RANGE[quality];
    scene.fog.near = near;
    scene.fog.far = far;
  }

  return { quality, pixelRatio, shadows, shadowMapSize: size, shadowExtent: extent };
}

/**
 * Material upgrades: roughness/metalness variation on the shared
 * MATERIALS record (materials.ts). Mutating the shared materials
 * upgrades the whole city at once — zero per-frame cost, no shader
 * recompile (roughness/metalness are uniforms, not defines).
 *
 * Called by the wiring agent right after applyGraphicsPreset().
 * "low" leaves materials untouched. Returns the keys that changed.
 */
export function upgradeMaterials(quality: GraphicsQuality): string[] {
  if (quality === "low") return [];
  const changed: string[] = [];
  const set = (
    key: keyof typeof MATERIALS,
    roughness: number,
    metalness: number,
    emissiveIntensity?: number,
  ) => {
    const mat = MATERIALS[key];
    if (!mat) return;
    mat.roughness = roughness;
    mat.metalness = metalness;
    if (emissiveIntensity !== undefined) mat.emissiveIntensity = emissiveIntensity;
    changed.push(key);
  };

  // Roads: slightly less chalky, a hint of sheen so headlights/bloom
  // read at night. Never glossy — wet-look would need a roughness map.
  set("asphalt", 0.88, 0.05);
  // Gold trim / OrbitX accents: real metal feel, emissive kept so the
  // gold still glows with no environment map (see module header).
  set("gold", 0.38, 0.55, 0.5);
  // Water: near-mirror smooth, stays transparent.
  set("water", 0.12, 0.05);
  // Pavement: matte, stops the plaza blowing out in daylight.
  set("white", 0.85, 0.0);
  set("plaza", 0.85, 0.0);
  set("sidewalk", 0.85, 0.0);

  if (quality === "ultra") {
    set("stone", 0.9, 0.0);
    set("wood", 0.75, 0.0);
    set("track", 0.5, 0.35);
    set("gray", 0.7, 0.1);
  }
  return changed;
}

/**
 * Richer sun + hemisphere lighting, per time of day.
 *
 * WARNING — read before wiring: engine.ts re-sets sun/hemi/ambient
 * intensities EVERY FRAME in the day/night block (~line 730-748), so
 * any intensity set by applyGraphicsPreset() would be stomped on the
 * next frame. The wiring agent must call THIS function inside that
 * block, replacing the literal intensities there (see WIRING.md).
 * Same lights, slightly richer numbers, zero extra cost.
 */
export function applyDayNightLighting(
  lights: CityLights,
  clockName: string,
  quality: GraphicsQuality = "high",
): void {
  const ultra = quality === "ultra" ? 0.05 : 0;
  if (clockName === "night") {
    if (lights.sun) lights.sun.intensity = 0.4;
    if (lights.hemi) lights.hemi.intensity = 0.3;
    if (lights.ambient) lights.ambient.intensity = 0.1;
    if (lights.fill) lights.fill.intensity = 0.12;
  } else if (clockName === "day") {
    if (lights.sun) lights.sun.intensity = 1.7;
    if (lights.hemi) lights.hemi.intensity = 0.95 + ultra;
    if (lights.ambient) lights.ambient.intensity = 0.22;
    if (lights.fill) lights.fill.intensity = 0.38;
  } else {
    // Sunset (the default look): today's values, kept exactly.
    if (lights.sun) lights.sun.intensity = 1.9;
    if (lights.hemi) lights.hemi.intensity = 0.78 + ultra;
    if (lights.ambient) lights.ambient.intensity = 0.16;
    if (lights.fill) lights.fill.intensity = 0.32;
  }
}

/**
 * One-time environment map so metalness has something to reflect.
 * A 256-px PMREM from RoomEnvironment: ~5-15 ms once on load, one
 * small cubemap in GPU memory, zero per-frame cost after that.
 * Without this, gold at metalness 0.55 would render darker than it
 * does today — this is the step that makes the metalness real.
 *
 * Only runs on high/ultra; on low/medium it clears any environment
 * instead (a phone that dropped to low should not keep paying for it).
 * Safe to call repeatedly — it no-ops when an environment is set.
 */
export function applyEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  quality: GraphicsQuality,
): "applied" | "already-set" | "cleared" | "skipped" {
  if (quality === "low" || quality === "medium") {
    if (scene.environment) {
      scene.environment = null;
      return "cleared";
    }
    return "skipped";
  }
  if (scene.environment) return "already-set";
  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  // Low intensity: the sunset look comes from the lights, the env map
  // only feeds reflections. 0.35 (high) / 0.5 (ultra).
  scene.environmentIntensity = quality === "ultra" ? 0.5 : 0.35;
  return "applied";
}

/** Human-readable preset summary, for the settings screen / debug HUD. */
export function describeGraphicsQuality(quality: GraphicsQuality): {
  label: string;
  pixelRatioCap: number;
  shadowMap: number;
  shadows: boolean;
  phoneCost: string;
} {
  const labels: Record<GraphicsQuality, string> = {
    low: "Low — fastest",
    medium: "Medium — balanced",
    high: "High — pretty",
    ultra: "Ultra — desktop / flagship only",
  };
  const costs: Record<GraphicsQuality, string> = {
    low: "No shadow pass. Cheapest; the phone default.",
    medium: "One 1024 shadow pass. Small cost.",
    high: "One 2048 shadow pass + one-time env map. Fine on modern phones.",
    ultra: "4096 shadow map + pixel ratio up to 2. Noticeable battery and heat on phones; do not default to this on mobile.",
  };
  return {
    label: labels[quality],
    pixelRatioCap: PIXEL_RATIO_CAP[quality],
    shadowMap: SHADOW_MAP_SIZE[quality],
    shadows: quality !== "low",
    phoneCost: costs[quality],
  };
}
