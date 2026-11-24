/**
 * OrbitX City — movement: a real walk cycle + smoother movement feel.
 *
 * DEAD CODE until wired — see WIRING.md at the repo root for the exact
 * call sites (engine.ts tick(), runtime.ts after()/placeCamera()).
 *
 * Why this file exists: the player model is a realistic humanoid with
 * ONE fused legs part (dressPerson in avatar.ts, makePerson in
 * runtime.ts) and no limb animation anywhere, so the character slides
 * instead of walking. This module retrofits a two-leg + two-arm walker
 * onto any group built by dressPerson/makePerson, without editing those
 * builders and without changing any character look. Limbs are capsules
 * (realistic overhaul, 2026-11-24) — no box limbs anywhere.
 *
 * Survival rule: dressPerson() removes every child except "ring"/"tag"
 * when the look changes, so walker pivots get wiped on a re-dress.
 * That is why `ensureWalker()` exists — the wiring agent calls it every
 * frame (cheap no-op when the pivots are already attached) and it
 * re-attaches them after a re-dress. Never cache a handle across a
 * look/color/hat change without going through ensureWalker().
 *
 * Ordering rule: `animateWalk()` MUST run AFTER runtime sets the group
 * position/rotation for the frame (runtime.after() does
 * localBody.position.set(...) + applyEmote(...)). The bob is an additive
 * offset on top of the runtime-set position and the lean is additive on
 * top of applyEmote's rotation — both are recomputed every frame, so
 * calling animateWalk before after() would be overwritten and invisible.
 *
 * Phone cost: 4 extra meshes + 2 extra groups per walker, shared unit
 * geometries, no new materials in the common path (colours are sampled
 * from the meshes dressPerson/makePerson already built). The per-frame
 * work is a handful of sin() calls and rotation writes. No allocations
 * in the hot path (animateWalk allocates nothing).
 */

import {
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Clothes, Look } from "./avatar";
import { SHOES_COLORS } from "./avatar";
import { SHOE_COLORS, WATCH_COLORS, type WardrobeSlots } from "./wardrobe";

/** Handle returned by makeWalker/ensureWalker. Keep one per person. */
export interface WalkerHandle {
  group: Group;
  legL: Group;
  legR: Group;
  armL: Group;
  armR: Group;
  /** Walk-cycle phase in radians. */
  phase: number;
  /** Current swing amplitude (0 = standing still). Eased, never snapped. */
  amp: number;
}

/** Shared unit geometries for every walker limb — never disposed.
 * Capsule (height 2, diameter 1): scale.y is halved in makeLimb so a
 * limb's scale reads as its size. Sphere for round shoes, rounded box
 * for flat plates (tattoos, watch face). */
const UNIT_CAPSULE = new CapsuleGeometry(0.5, 1, 4, 12);
const UNIT_SPHERE = new SphereGeometry(0.5, 12, 10);
const UNIT_ROUNDED = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);

/** Fallback material, created once, only used when a group has no
 *  dressable meshes to sample colours from (should not happen in game). */
let fallbackDark: Material | null = null;

function darkMaterialFallback(): Material {
  if (!fallbackDark) {
    // Cheap standard material in the same family as materials.ts.
    // This fallback only fires for a bare, never-dressed group.
    fallbackDark = new MeshStandardMaterial({ color: 0x1a1c22 });
  }
  return fallbackDark;
}

const handles = new WeakMap<Group, WalkerHandle>();
const outfitMaterials = new Map<string, Material>();

function outfitMaterial(color: string): Material {
  let mat = outfitMaterials.get(color);
  if (!mat) {
    mat = new MeshStandardMaterial({ color });
    outfitMaterials.set(color, mat);
  }
  return mat;
}

function isMesh(child: unknown): child is Mesh {
  return child instanceof Mesh;
}

/**
 * The fused single legs part dressPerson/makePerson build:
 * makePerson  -> pos (0, 0.28, 0), scale (0.58, 0.45, 0.36), name "legs"
 * dressPerson -> pos (0, 0.30, 0), scale (0.50, 0.46, 0.34), name "legs"
 * Name-first (realistic overhaul): the builders name the part; the
 * position+scale ranges stay as the fallback for legacy/unnamed groups.
 * Nothing else in a person group sits at that height with that bulk.
 */
function findFusedLegs(group: Group): Mesh | null {
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    if (child.name === "legs") return child;
  }
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    const p = child.position;
    const s = child.scale;
    if (
      p.y > 0.2 && p.y < 0.36 &&
      s.x > 0.45 && s.x < 0.65 &&
      s.y > 0.35 && s.y < 0.5
    ) {
      return child;
    }
  }
  return null;
}

/** Torso mesh: the widest part at chest height. Its material is the outfit. */
function findTorso(group: Group): Mesh | null {
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    if (child.name === "torso") return child;
  }
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    const p = child.position;
    const s = child.scale;
    if (p.y > 0.78 && p.y < 1.0 && s.x > 0.55 && s.x < 0.72 && s.y > 0.7 && s.y < 1.0) {
      return child;
    }
  }
  return null;
}

/** Head mesh: the 0.4 sphere at face height. Its material is the skin. */
function findHead(group: Group): Mesh | null {
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    if (child.name === "head") return child;
  }
  for (const child of group.children) {
    if (!isMesh(child)) continue;
    const p = child.position;
    const s = child.scale;
    if (p.y > 1.5 && p.y < 1.66 && s.x > 0.35 && s.x < 0.45 && s.y > 0.35 && s.y < 0.45) {
      return child;
    }
  }
  return null;
}

/** A capsule limb of size (sx, sy, sz) hanging from y (pivot space).
 * The unit capsule is 2 tall, so scale.y is halved to keep the size. */
function makeLimb(material: Material, sx: number, sy: number, sz: number, y: number): Mesh {
  const mesh = new Mesh(UNIT_CAPSULE, material);
  mesh.scale.set(sx, sy / 2, sz);
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Retrofit a two-leg + two-arm walker onto a person group built by
 * dressPerson() or makePerson(). Idempotent per group: calling it again
 * returns the same handle (rebuilt only if dressPerson wiped the pivots).
 *
 * @param group the person Group (localBody, a remote person, an NPC)
 * @param look  optional character look — when given, arm cloth uses
 *              look.colors.outfit; when omitted, colours are sampled
 *              from the meshes already in the group (preferred for the
 *              local player, whose look lives inside runtime).
 */
export function makeWalker(group: Group, look?: Look): WalkerHandle {
  const existing = handles.get(group);
  if (
    existing &&
    existing.legL.parent === group &&
    existing.legR.parent === group &&
    existing.armL.parent === group &&
    existing.armR.parent === group
  ) {
    return existing;
  }

  // Remove the fused legs box (its material becomes the leg colour).
  const fused = findFusedLegs(group);
  const legMaterial: Material = fused
    ? (fused.material as Material)
    : darkMaterialFallback();
  if (fused) group.remove(fused);

  const torso = findTorso(group);
  const armMaterial: Material = look
    ? outfitMaterial(look.colors.outfit)
    : torso
      ? (torso.material as Material)
      : outfitMaterial("#3a404c");

  // Legs: pivots at hip height (top of the old fused box, y ~= 0.5).
  // Each leg box hangs 0.5 below its pivot so rotation.x swings the foot.
  const legL = new Group();
  legL.name = "walkLegL";
  legL.position.set(-0.13, 0.5, 0);
  legL.add(makeLimb(legMaterial, 0.24, 0.5, 0.32, -0.25));
  const legR = new Group();
  legR.name = "walkLegR";
  legR.position.set(0.13, 0.5, 0);
  legR.add(makeLimb(legMaterial, 0.24, 0.5, 0.32, -0.25));

  // Shoes: a round shoe on the bottom of each leg pivot so the shoe
  // swings with the foot instead of floating static under the body.
  // dressPerson stores the worn clothes AND the wardrobe on
  // group.userData. Two sources, one pair of feet:
  //   - shop shoes (clothes.shoes) win — they are the worn item;
  //   - else wardrobe shoes (wardrobe.shoes).
  // dressPerson ALSO adds static wardrobe-shoe boxes at the feet — those
  // must come off here, or the feet render twice: one swinging pair on
  // the legs and one frozen pair on the ground (the "blocky glitch" on
  // the feet). The Roster preview never gets a walker, so its static
  // shoes stay — this removal only runs when a walker is attached.
  const userData = group.userData as { clothes?: Clothes; wardrobe?: WardrobeSlots } | undefined;
  const clothes = userData?.clothes;
  const wardrobe = userData?.wardrobe;
  for (const child of [...group.children]) {
    if (!isMesh(child)) continue;
    const p = child.position;
    const s = child.scale;
    if (
      Math.abs(p.y - 0.05) < 0.01 &&
      Math.abs(Math.abs(p.x) - 0.13) < 0.01 &&
      Math.abs(p.z - 0.03) < 0.01 &&
      Math.abs(s.x - 0.22) < 0.01 &&
      Math.abs(s.y - 0.1) < 0.01 &&
      Math.abs(s.z - 0.32) < 0.01
    ) {
      group.remove(child);
    }
  }
  const shoeColor = clothes?.shoes
    ? SHOES_COLORS[clothes.shoes]
    : wardrobe?.shoes
      ? SHOE_COLORS[wardrobe.shoes]
      : undefined;
  if (shoeColor) {
    const shoeMat = outfitMaterial(shoeColor);
    for (const leg of [legL, legR]) {
      // Round shoe (realistic overhaul): a sphere, not a box.
      const shoe = new Mesh(UNIT_SPHERE, shoeMat);
      shoe.scale.set(0.26, 0.12, 0.42);
      shoe.position.set(0, -0.47, 0.04);
      shoe.castShadow = true;
      leg.add(shoe);
    }
  }

  // Arms: the avatar has none — add them. Pivots at shoulder height,
  // boxes hang 0.6 below so the swing reads from across the plaza.
  // Two-tone like the AI demo's people: an outfit-coloured sleeve on
  // top, a skin forearm + hand below (same 0.6 total reach as before).
  const skinMaterial: Material = look
    ? outfitMaterial(look.colors.skin)
    : (findHead(group)?.material as Material) ?? outfitMaterial("#f0c2a0");
  const armL = new Group();
  armL.name = "walkArmL";
  armL.position.set(-0.38, 1.24, 0);
  armL.rotation.z = 0.08;
  armL.add(makeLimb(armMaterial, 0.16, 0.36, 0.18, -0.15));
  armL.add(makeLimb(skinMaterial, 0.14, 0.24, 0.16, -0.45));
  const armR = new Group();
  armR.name = "walkArmR";
  armR.position.set(0.38, 1.24, 0);
  armR.rotation.z = -0.08;
  armR.add(makeLimb(armMaterial, 0.16, 0.36, 0.18, -0.15));
  armR.add(makeLimb(skinMaterial, 0.14, 0.24, 0.16, -0.45));

  group.add(legL, legR, armL, armR);

  // Wardrobe watch: dressPerson adds it as a static box at the rest
  // pose (-0.38, 0.72) — once the arm swings, the watch floats in the
  // air where the wrist used to be. Take the static band + face off
  // here and hang the watch on the left arm pivot instead, so it rides
  // the wrist. (The static face's front was also exactly coplanar with
  // the static band's front — a z-fight on the watch face; the arm
  // version sits 0.01 proud.)
  for (const child of [...group.children]) {
    if (!isMesh(child)) continue;
    const p = child.position;
    const s = child.scale;
    const isBand =
      Math.abs(p.x + 0.38) < 0.01 && Math.abs(p.y - 0.72) < 0.01 && Math.abs(p.z) < 0.01 &&
      Math.abs(s.x - 0.22) < 0.01 && Math.abs(s.y - 0.09) < 0.01 && Math.abs(s.z - 0.22) < 0.01;
    const isFace =
      Math.abs(p.x + 0.38) < 0.01 && Math.abs(p.y - 0.72) < 0.01 && Math.abs(p.z - 0.1) < 0.01 &&
      Math.abs(s.x - 0.1) < 0.01 && Math.abs(s.y - 0.05) < 0.01 && Math.abs(s.z - 0.02) < 0.01;
    if (isBand || isFace) group.remove(child);
  }
  const wardrobeWatch = wardrobe?.watch ? WATCH_COLORS[wardrobe.watch] : undefined;
  if (wardrobeWatch) {
    // Torus band around the wrist (realistic overhaul) + a rounded
    // face on top — the old version was a static box band.
    const band = new Mesh(new TorusGeometry(0.11, 0.035, 8, 16), outfitMaterial(wardrobeWatch));
    band.rotation.x = Math.PI / 2;
    band.position.set(0, -0.52, 0);
    band.castShadow = true;
    armL.add(band);
    const face = new Mesh(UNIT_ROUNDED, outfitMaterial("#f4f6fa"));
    face.scale.set(0.1, 0.05, 0.02);
    face.position.set(0, -0.52, 0.11);
    face.castShadow = true;
    armL.add(face);
  }

  // Character-specific arm details. dressPerson stores the character id
  // on the group (userData.lookId), so these ride on the arm pivots and
  // swing with the walk cycle instead of floating at the rest pose.
  const lookId = (group.userData as { lookId?: string } | undefined)?.lookId;
  if (lookId === "tjr" && !wardrobeWatch) {
    // TJR: watch + bracelet on the left wrist (from his verified photo).
    // Skipped when the player wears a bought wardrobe watch — one watch
    // per wrist, the bought one wins.
    armL.add(makeLimb(outfitMaterial("#e0b33a"), 0.18, 0.07, 0.2, -0.5));
  } else if (lookId === "gainzy") {
    // Gainzy: dragon tattoos on both arms (from his public avatar).
    // Flat rounded plates on the arm surface, not capsules.
    const tattoo = outfitMaterial("#7a1f2a");
    const tatL = new Mesh(UNIT_ROUNDED, tattoo);
    tatL.scale.set(0.03, 0.4, 0.14);
    tatL.position.set(-0.09, -0.27, 0);
    tatL.castShadow = true;
    armL.add(tatL);
    const tatR = new Mesh(UNIT_ROUNDED, tattoo);
    tatR.scale.set(0.03, 0.4, 0.14);
    tatR.position.set(0.09, -0.27, 0);
    tatR.castShadow = true;
    armR.add(tatR);
  }

  const handle: WalkerHandle = {
    group,
    legL,
    legR,
    armL,
    armR,
    phase: existing ? existing.phase : 0,
    amp: existing ? existing.amp : 0,
  };
  handles.set(group, handle);
  return handle;
}

/**
 * Per-frame re-attach guard. Call once per frame per visible person,
 * right after paintPerson()/dressPerson() may have run. Returns the
 * handle, or null if the group has never been dressed (nothing to
 * retrofit yet — e.g. localBody before first paintPerson).
 */
export function ensureWalker(group: Group, look?: Look): WalkerHandle | null {
  const existing = handles.get(group);
  if (
    existing &&
    existing.legL.parent === group &&
    existing.legR.parent === group
  ) {
    return existing;
  }
  // No fused legs and no torso means the group was never dressed; the
  // walker has nothing to hang onto. The next frame will retry.
  if (!findFusedLegs(group) && !findTorso(group) && !existing) return null;
  return makeWalker(group, look);
}

/**
 * Drive one frame of the walk cycle. Call AFTER runtime.after() has set
 * the group position/rotation for this frame (see ordering rule above).
 *
 * @param handle  from makeWalker()/ensureWalker()
 * @param speed   current horizontal speed in world units/sec (0 when idle).
 *                At walk 5.2, run 8.5, slow 1.6 (engine.ts tick()).
 * @param dt      frame delta in seconds (clamped by caller to ~0.05)
 * @param moving  false when the player has no move input / is standing
 * @param flying  true while flying — legs hang straight, no bob
 */
export function animateWalk(
  handle: WalkerHandle,
  speed: number,
  dt: number,
  moving: boolean,
  flying = false,
): void {
  const step = Math.min(dt, 0.05);
  // Cadence (walk-fix 2026-11-17): the old phase rate (speed * 1.35)
  // gave 2.2 steps/s at walk speed while the body covered 2.33u per
  // step and the feet only 0.52u — the feet slid at 22% of body speed,
  // which reads as moonwalking, not walking. At speed * 2.3 the cadence
  // is ~3.8 steps/s and the feet cover ~42% of body travel per step:
  // the 0.5-long box legs can never fully plant at 5.2 u/s, but the
  // faster pump + bigger swing reads as a walk instead of a slide.
  const speedFactor = Math.min(Math.max(speed / 5.2, 0.2), 1.6);
  const targetAmp = moving && !flying ? Math.min(0.62 * speedFactor, 0.75) : 0;
  // Ease the amplitude so starts/stops don't snap the legs.
  handle.amp += (targetAmp - handle.amp) * Math.min(1, step * 10);
  if (handle.amp < 0.005) handle.amp = 0;

  if (moving && !flying) {
    // Advance the phase on the real frame time (clamped to 0.1 s, not
    // 0.05): on a hitchy phone frame the body still moves its full
    // distance, so starving the phase would leave the legs behind and
    // the feet sliding for a frame.
    handle.phase += Math.min(dt, 0.1) * speed * 2.3;
  }

  const swing = Math.sin(handle.phase) * handle.amp;
  handle.legL.rotation.x = swing;
  handle.legR.rotation.x = -swing;
  // Arms swing opposite to the same-side leg, at 70% amplitude.
  handle.armL.rotation.x = -swing * 0.7;
  handle.armR.rotation.x = swing * 0.7;
  // Arms flare a touch outward as they swing forward and tuck as they
  // swing back (base ±0.08 from makeWalker) — the arms used to hang
  // rigidly parallel; now they breathe with the stride.
  handle.armL.rotation.z = 0.08 + swing * 0.035;
  handle.armR.rotation.z = -(0.08 - swing * 0.035);

  // Bob: two bounces per cycle, strongest at mid-stride. Additive on top
  // of the position runtime.after() already set this frame.
  const bob = Math.abs(Math.cos(handle.phase)) * 0.045 * (handle.amp / 0.62);
  handle.group.position.y += bob;

  // Forward lean while moving, additive on top of applyEmote's rotation.
  handle.group.rotation.x += 0.05 * (handle.amp / 0.62);
  // Torso sway: a gentle side-to-side lean that peaks at mid-stride,
  // so the whole body rolls with the walk instead of staying bolt
  // upright. Subtle (max ~1.4°) — it reads as a walk, not a tilt.
  handle.group.rotation.z += Math.sin(handle.phase) * 0.025 * (handle.amp / 0.62);
}

/** Snap a walker back to a neutral standing pose (teleports, emotes). */
export function resetWalkPose(handle: WalkerHandle): void {
  handle.phase = 0;
  handle.amp = 0;
  handle.legL.rotation.x = 0;
  handle.legR.rotation.x = 0;
  handle.armL.rotation.x = 0;
  handle.armR.rotation.x = 0;
  // animateWalk drives rotation.z on the arms (flare) and the group
  // (sway) — reset those too, or a reset character keeps a mid-stride
  // lean until the next walk frame.
  handle.armL.rotation.z = 0.08;
  handle.armR.rotation.z = -0.08;
  handle.group.rotation.z = 0;
}

/**
 * Acceleration / deceleration curves for on-foot movement.
 * The engine today applies full speed the frame input starts and zero
 * the frame it stops (engine.ts tick(): speed * dt straight from
 * moveAxes). Feed moveAxes() through this first and the character
 * eases in over ~0.25 s and eases out over ~0.15 s instead.
 *
 * Works in input space so it slots into tick() unchanged:
 *   const axes = smoother.update(raw.f, raw.s, dt);
 *   ...existing speed/yaw math uses axes.f / axes.s...
 */
export interface MoveSmoother {
  update(f: number, s: number, dt: number): { f: number; s: number };
  reset(): void;
  /** Current smoothed input magnitude (0..~1.4 diagonal). */
  readonly magnitude: number;
}

export function createMoveSmoother(): MoveSmoother {
  let cf = 0;
  let cs = 0;
  return {
    update(f: number, s: number, dt: number) {
      const step = Math.min(dt, 0.05);
      const targetMag = Math.hypot(f, s);
      const currentMag = Math.hypot(cf, cs);
      // Accelerate slower than we brake: starting feels weighty,
      // stopping feels responsive.
      const lambda = targetMag > currentMag ? 9 : 16;
      const k = 1 - Math.exp(-lambda * step);
      cf += (f - cf) * k;
      cs += (s - cs) * k;
      if (Math.hypot(cf, cs) < 0.001) {
        cf = 0;
        cs = 0;
      }
      return { f: cf, s: cs };
    },
    reset() {
      cf = 0;
      cs = 0;
    },
    get magnitude() {
      return Math.hypot(cf, cs);
    },
  };
}

/**
 * Camera follow smoothing. placeCamera() today hard-snaps the camera to
 * the pulled position every frame (runtime.ts placeCamera). Feed the
 * desired position through this and the camera glides instead — most
 * noticeable when turning fast or landing from a jump.
 *
 * Snap rule: a desired position more than 14 units away (teleport,
 * camera-shot change, respawn) snaps instantly instead of flying
 * across the city.
 */
export interface CameraSmoother {
  /** Returns the smoothed position the camera should use this frame. */
  update(desired: Vector3, dt: number): Vector3;
  /** Force the next update() to snap (call on teleports / shot changes). */
  snapTo(desired: Vector3): void;
}

export function makeCameraSmoother(): CameraSmoother {
  let current: Vector3 | null = null;
  const out = new Vector3();
  return {
    update(desired: Vector3, dt: number): Vector3 {
      const step = Math.min(dt, 0.05);
      if (!current || current.distanceTo(desired) > 14) {
        current = desired.clone();
      } else {
        // ~63% of the way there in 0.14 s: smooth, never laggy.
        const k = 1 - Math.exp(-7 * step);
        current.lerp(desired, k);
      }
      out.copy(current);
      return out;
    },
    snapTo(desired: Vector3): void {
      current = desired.clone();
    },
  };
}

