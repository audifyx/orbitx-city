// ---------------------------------------------------------------------------
// OrbitX City — PETS (round 7): adoptable companions that follow the player
// around the CITY (not the home — the crib pet in crib.ts/cribview.ts stays
// inside the player's own home; these pets trail the player outdoors,
// through streets, plazas, shops and homes alike).
//
// All pet logic lives here. runtime.ts owns exactly one hook —
// petSim.update(dt, body, ctx) inside after() — plus thin adopt/command
// wrappers that deduct City Sol from the wallet. App.tsx owns the Pet
// Shop panel. Nothing here touches the API, auth or Supabase.
//
// Persistence: localStorage `orbitx-demo-pets-v1`, the same client-side
// pattern as owned cars / homes / garage in runtime.ts (no server
// change, so pets live on this device/browser only — a different device
// does not see them). Adoption is City Sol only, no burn (buy+burn is
// ads/banners only, same as clothes).
//
// Phone cost: one shared geometry set + one shared material per coat
// colour for ALL pets (a new pet adds meshes, never new geometries or
// materials); animation is a few sin() calls and rotation writes per
// pet, no per-frame allocation. Max 3 pets. On low quality the
// secondary animation (tail wag, ear bounce) is skipped.
// ---------------------------------------------------------------------------

import {
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type Material,
  type Scene,
} from "three";

/** Client-side save key — same trust model as the vehicles/homes keys. */
export const PETS_SAVE_KEY = "orbitx-demo-pets-v1";

/** Hard cap: three companions max, so the frame cost stays trivial. */
export const PET_MAX = 3;

/** Follow: trail this far behind the player. Run to catch up past this. */
export const PET_FOLLOW_DIST = 1.7;
/** Past this distance from the player the pet runs instead of walking. */
export const PET_CATCH_UP_DIST = 14;
/** Past this distance the pet simply catches up beside the player
 * (covers teleports, driving away and coming back on foot). */
export const PET_TELEPORT_DIST = 60;
/** The pet never closes nearer than this to the player — it trails, it
 * never stands inside the player or blocks a door the player is using. */
export const PET_MIN_DIST = 0.9;

export type PetSpecies = "dog" | "cat";
export type PetMode = "follow" | "stay";

export interface PetCoat {
  id: string;
  name: string;
  /** Hex colour for the coat material. */
  hex: number;
}

export interface PetCatalogEntry {
  species: PetSpecies;
  name: string;
  price: number;
  blurb: string;
  /** Walk / run speed (u/s). */
  walkSpeed: number;
  runSpeed: number;
  /** Model scale (cats are smaller than dogs). */
  scale: number;
  coats: PetCoat[];
}

export const PET_CATALOG: Record<PetSpecies, PetCatalogEntry> = {
  dog: {
    species: "dog",
    name: "Dog",
    price: 500,
    blurb: "A loyal dog — trots behind you everywhere in the city.",
    walkSpeed: 5.4,
    runSpeed: 9.5,
    scale: 1,
    coats: [
      { id: "golden", name: "Golden", hex: 0xc98a3d },
      { id: "midnight", name: "Midnight", hex: 0x2b2b30 },
      { id: "snow", name: "Snow", hex: 0xf2ede4 },
    ],
  },
  cat: {
    species: "cat",
    name: "Cat",
    price: 400,
    blurb: "A cool cat — pads along behind you, unbothered.",
    walkSpeed: 4.8,
    runSpeed: 8.5,
    scale: 0.8,
    coats: [
      { id: "grey", name: "Grey", hex: 0x9aa0a8 },
      { id: "ginger", name: "Ginger", hex: 0xd97b2f },
      { id: "midnight", name: "Midnight", hex: 0x232326 },
    ],
  },
};

const DEFAULT_NAMES: Record<PetSpecies, string[]> = {
  dog: ["Buddy", "Rocky", "Luna", "Max", "Bella", "Charlie"],
  cat: ["Milo", "Luna", "Oliver", "Simba", "Nala", "Felix"],
};

export function defaultPetName(species: PetSpecies): string {
  const names = DEFAULT_NAMES[species] ?? ["Buddy"];
  return names[Math.floor(Math.random() * names.length)];
}

/** What is stored (localStorage) per pet — no live position in the save. */
export interface SavedPet {
  id: string;
  species: PetSpecies;
  coat: string;
  name: string;
  mode: PetMode;
  /** 0-100. Petting raises it; a happy pet trots, a sad one lags. */
  happiness: number;
  adoptedAt: number;
}

/** What the UI (Snap) reads per pet. */
export interface PetSnap {
  id: string;
  species: PetSpecies;
  coat: string;
  coatName: string;
  name: string;
  mode: PetMode;
  happiness: number;
  mood: string;
  /** Metres from the player right now (0 while the panel is closed). */
  dist: number;
}

export function petMood(happiness: number): string {
  if (happiness >= 70) return "Happy";
  if (happiness >= 40) return "Content";
  return "Sad";
}

export function coatOf(species: PetSpecies, coatId: string): PetCoat {
  const entry = PET_CATALOG[species];
  return entry.coats.find((c) => c.id === coatId) ?? entry.coats[0];
}

/** Validate + clamp a raw save payload. Never throws, never trusts input. */
export function normalizePets(raw: unknown): SavedPet[] {
  const list = (raw as { pets?: unknown } | null)?.pets;
  if (!Array.isArray(list)) return [];
  const out: SavedPet[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const p = item as Partial<SavedPet>;
    if (p.species !== "dog" && p.species !== "cat") continue;
    const coat = typeof p.coat === "string" ? p.coat : "";
    const entry = PET_CATALOG[p.species];
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, 16) : defaultPetName(p.species);
    out.push({
      id: typeof p.id === "string" && p.id ? p.id : `pet-${out.length}-${Date.now().toString(36)}`,
      species: p.species,
      coat: entry.coats.some((c) => c.id === coat) ? coat : entry.coats[0].id,
      name,
      mode: p.mode === "stay" ? "stay" : "follow",
      happiness: typeof p.happiness === "number" ? Math.max(0, Math.min(100, Math.round(p.happiness))) : 80,
      adoptedAt: typeof p.adoptedAt === "number" ? p.adoptedAt : Date.now(),
    });
    if (out.length >= PET_MAX) break;
  }
  return out;
}

export function loadSavedPets(): SavedPet[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return normalizePets(JSON.parse(localStorage.getItem(PETS_SAVE_KEY) || "null"));
  } catch {
    return [];
  }
}

export function saveSavedPets(pets: SavedPet[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PETS_SAVE_KEY, JSON.stringify({ pets }));
  } catch {
    // The pets still work for this session.
  }
}

// --- Pure follow math (no three, no DOM — the game suite drives these) ---

/** Shortest signed turn from `from` to `to` (radians, wrapped to ±PI). */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/**
 * Where a pet should trail: behind the player (player forward is
 * (sin yaw, -cos yaw), the same convention as drivePhysics), fanned out
 * by slot so two or three pets never stack on one spot.
 */
export function followTargetFor(
  player: { x: number; z: number; yaw: number },
  slot: number,
): { x: number; z: number } {
  const fx = Math.sin(player.yaw);
  const fz = -Math.cos(player.yaw);
  // Right vector (perp of forward).
  const rx = -fz;
  const rz = fx;
  const behind = PET_FOLLOW_DIST + Math.floor(slot / 2) * 0.6;
  const side = slot === 0 ? 0 : slot % 2 === 1 ? 0.8 : -0.8;
  return { x: player.x - fx * behind + rx * side, z: player.z - fz * behind + rz * side };
}

/**
 * One follow step toward a target point. Pure: returns the new position,
 * facing and whether the pet is moving. Never overshoots into the target
 * (stops `stopDist` short) and never moves faster than `speed * dt`.
 */
export function planPetStep(
  pet: { x: number; z: number; yaw: number },
  target: { x: number; z: number },
  dt: number,
  opts: { speed: number; stopDist?: number; turnRate?: number },
): { x: number; z: number; yaw: number; moving: boolean } {
  const stopDist = opts.stopDist ?? 0.35;
  const dx = target.x - pet.x;
  const dz = target.z - pet.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= stopDist || dt <= 0) return { x: pet.x, z: pet.z, yaw: pet.yaw, moving: false };
  const step = Math.min(opts.speed * dt, dist - stopDist);
  const nx = pet.x + (dx / dist) * step;
  const nz = pet.z + (dz / dist) * step;
  const wantYaw = Math.atan2(dx, dz);
  const yaw = turnToward(pet.yaw, wantYaw, (opts.turnRate ?? 7) * dt);
  return { x: nx, z: nz, yaw, moving: true };
}

/** Speed for the current gap: walk near, run when far behind. */
export function petSpeedFor(species: PetSpecies, distToPlayer: number): number {
  const entry = PET_CATALOG[species];
  return distToPlayer > PET_CATCH_UP_DIST ? entry.runSpeed : entry.walkSpeed;
}

// --- Shared geometry / materials (one set for every pet, ever) ---

let shared: {
  bodyGeo: CapsuleGeometry;
  headGeo: SphereGeometry;
  muzzleGeo: SphereGeometry;
  earGeo: CapsuleGeometry;
  catEarGeo: ConeGeometry;
  legGeo: CapsuleGeometry;
  tailGeo: CapsuleGeometry;
  eyeGeo: SphereGeometry;
  noseGeo: SphereGeometry;
  darkMat: Material;
} | null = null;

function sharedGeo() {
  if (shared) return shared;
  shared = {
    bodyGeo: new CapsuleGeometry(0.24, 0.5, 4, 10),
    headGeo: new SphereGeometry(0.26, 14, 12),
    muzzleGeo: new SphereGeometry(0.13, 10, 8),
    earGeo: new CapsuleGeometry(0.07, 0.16, 4, 8),
    catEarGeo: new ConeGeometry(0.11, 0.22, 8),
    legGeo: new CapsuleGeometry(0.07, 0.2, 4, 8),
    tailGeo: new CapsuleGeometry(0.05, 0.3, 4, 8),
    eyeGeo: new SphereGeometry(0.035, 8, 6),
    noseGeo: new SphereGeometry(0.05, 8, 6),
    darkMat: new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }),
  };
  return shared;
}

const coatMats = new Map<number, Material>();
function coatMat(hex: number): Material {
  let mat = coatMats.get(hex);
  if (!mat) {
    mat = new MeshStandardMaterial({ color: hex, roughness: 0.85 });
    coatMats.set(hex, mat);
  }
  return mat;
}

interface PetRig {
  group: Group;
  body: Group;
  head: Group;
  tail: Group;
  earL: Mesh;
  earR: Mesh;
  legs: Group[];
}

/**
 * A shaped (round 1-4 character style) pet: capsule body, sphere head +
 * muzzle, ears, capsule legs on hip pivots, wagging tail. Faces +Z, so
 * group.rotation.y = atan2(dx, dz) faces the direction of travel.
 * No boxes anywhere.
 */
function buildPetMesh(species: PetSpecies, coatHex: number): PetRig {
  const g = sharedGeo();
  const mat = coatMat(coatHex);
  const group = new Group();
  const body = new Group();
  group.add(body);

  const torso = new Mesh(g.bodyGeo, mat);
  // Capsule is Y-long; lay it flat along Z.
  torso.rotation.x = Math.PI / 2;
  torso.position.set(0, 0.42, 0);
  torso.scale.set(1, 1, 1);
  body.add(torso);
  if (species === "dog") {
    const chest = new Mesh(g.headGeo, mat);
    chest.position.set(0, 0.45, 0.28);
    chest.scale.set(0.85, 0.8, 0.85);
    body.add(chest);
  }

  const head = new Group();
  head.position.set(0, 0.62, 0.48);
  body.add(head);
  const skull = new Mesh(g.headGeo, mat);
  head.add(skull);
  const muzzle = new Mesh(g.muzzleGeo, mat);
  muzzle.position.set(0, -0.06, 0.2);
  muzzle.scale.set(1.1, 0.8, 1.2);
  head.add(muzzle);
  const nose = new Mesh(g.noseGeo, g.darkMat);
  nose.position.set(0, -0.02, 0.32);
  head.add(nose);
  const eyeL = new Mesh(g.eyeGeo, g.darkMat);
  eyeL.position.set(-0.1, 0.06, 0.21);
  head.add(eyeL);
  const eyeR = new Mesh(g.eyeGeo, g.darkMat);
  eyeR.position.set(0.1, 0.06, 0.21);
  head.add(eyeR);

  let earL: Mesh;
  let earR: Mesh;
  if (species === "cat") {
    earL = new Mesh(g.catEarGeo, mat);
    earL.position.set(-0.13, 0.26, 0);
    earR = new Mesh(g.catEarGeo, mat);
    earR.position.set(0.13, 0.26, 0);
  } else {
    // Floppy ears: flattened capsules hanging beside the head.
    earL = new Mesh(g.earGeo, mat);
    earL.position.set(-0.22, -0.02, 0.02);
    earL.rotation.z = 0.35;
    earL.scale.set(1.4, 1, 0.6);
    earR = new Mesh(g.earGeo, mat);
    earR.position.set(0.22, -0.02, 0.02);
    earR.rotation.z = -0.35;
    earR.scale.set(1.4, 1, 0.6);
  }
  head.add(earL, earR);

  const legs: Group[] = [];
  for (const [lx, lz] of [
    [0.14, 0.26],
    [-0.14, 0.26],
    [0.14, -0.26],
    [-0.14, -0.26],
  ] as Array<[number, number]>) {
    const pivot = new Group();
    pivot.position.set(lx, 0.32, lz);
    const leg = new Mesh(g.legGeo, mat);
    leg.position.set(0, -0.14, 0);
    pivot.add(leg);
    body.add(pivot);
    legs.push(pivot);
  }

  const tail = new Group();
  tail.position.set(0, 0.55, -0.48);
  const tailMesh = new Mesh(g.tailGeo, mat);
  tailMesh.position.set(0, 0.16, -0.06);
  tailMesh.rotation.x = -0.7;
  tail.add(tailMesh);
  body.add(tail);

  const scale = PET_CATALOG[species].scale;
  group.scale.setScalar(scale);
  return { group, body, head, tail, earL, earR, legs };
}

// --- The live sim (one instance, owned by runtime.ts) ---

interface LivePet {
  saved: SavedPet;
  rig: PetRig;
  x: number;
  z: number;
  yaw: number;
  placed: boolean;
  /** Where "stay" keeps the pet (or where it waits while you drive). */
  stayX: number;
  stayZ: number;
  walkPhase: number;
  moving: boolean;
  /** Sim-time seconds until the petting reaction ends. */
  petUntil: number;
  /** Sim-time seconds until the next idle wander pick (stay mode). */
  wanderAt: number;
  wanderX: number;
  wanderZ: number;
  dist: number;
}

export interface PetUpdateContext {
  /** True while walking on foot — false while driving, flying, riding. */
  onFoot: boolean;
  /** True on the low graphics tier: skip tail/ear secondary animation. */
  lowQuality: boolean;
}

export interface PetSim {
  list(): PetSnap[];
  count(): number;
  adopt(species: PetSpecies, coat: string, name: string, spawn: { x: number; z: number }): { ok: boolean; message: string; pet?: SavedPet };
  setMode(id: string, mode: PetMode): string;
  pet(id: string): string;
  rename(id: string, name: string): string;
  release(id: string): string;
  update(dt: number, player: { x: number; z: number; yaw: number }, ctx: PetUpdateContext): void;
}

export function createPetSim(scene: Scene): PetSim {
  const root = new Group();
  root.name = "pets";
  scene.add(root);
  const live = new Map<string, LivePet>();
  let time = 0;

  function spawnLive(saved: SavedPet, spawn: { x: number; z: number }): LivePet {
    const rig = buildPetMesh(saved.species, coatOf(saved.species, saved.coat).hex);
    rig.group.position.set(spawn.x, 0, spawn.z);
    root.add(rig.group);
    const pet: LivePet = {
      saved,
      rig,
      x: spawn.x,
      z: spawn.z,
      yaw: 0,
      placed: false,
      stayX: spawn.x,
      stayZ: spawn.z,
      walkPhase: Math.random() * Math.PI * 2,
      moving: false,
      petUntil: 0,
      wanderAt: 0,
      wanderX: spawn.x,
      wanderZ: spawn.z,
      dist: 0,
    };
    live.set(saved.id, pet);
    return pet;
  }

  function persist() {
    saveSavedPets([...live.values()].map((p) => p.saved));
  }

  // Restore saved pets (meshes spawn at the origin until the first
  // update() places them trailing the player).
  for (const saved of loadSavedPets()) spawnLive(saved, { x: 0, z: 0 });

  function find(id: string): LivePet | undefined {
    return live.get(id);
  }

  return {
    list(): PetSnap[] {
      return [...live.values()].map((p) => ({
        id: p.saved.id,
        species: p.saved.species,
        coat: p.saved.coat,
        coatName: coatOf(p.saved.species, p.saved.coat).name,
        name: p.saved.name,
        mode: p.saved.mode,
        happiness: p.saved.happiness,
        mood: petMood(p.saved.happiness),
        dist: Math.round(p.dist * 10) / 10,
      }));
    },

    count(): number {
      return live.size;
    },

    adopt(species, coat, name, spawn) {
      const entry = PET_CATALOG[species];
      if (!entry) return { ok: false, message: "No such pet." };
      if (live.size >= PET_MAX) return { ok: false, message: `You already have ${PET_MAX} pets — release one first.` };
      const cleanName = (name || "").trim().slice(0, 16) || defaultPetName(species);
      const saved: SavedPet = {
        id: `pet-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
        species,
        coat: entry.coats.some((c) => c.id === coat) ? coat : entry.coats[0].id,
        name: cleanName,
        mode: "follow",
        happiness: 80,
        adoptedAt: Date.now(),
      };
      const pet = spawnLive(saved, spawn);
      pet.placed = true;
      pet.stayX = spawn.x;
      pet.stayZ = spawn.z;
      persist();
      return { ok: true, message: `${cleanName} the ${entry.name.toLowerCase()} is yours — trailing behind you now.`, pet: saved };
    },

    setMode(id, mode) {
      const pet = find(id);
      if (!pet) return "No such pet.";
      pet.saved.mode = mode;
      if (mode === "stay") {
        pet.stayX = pet.x;
        pet.stayZ = pet.z;
        pet.wanderX = pet.x;
        pet.wanderZ = pet.z;
      }
      persist();
      return mode === "stay"
        ? `${pet.saved.name} will stay here.`
        : `${pet.saved.name} is following you again.`;
    },

    pet(id) {
      const pet = find(id);
      if (!pet) return "No such pet.";
      pet.saved.happiness = Math.min(100, pet.saved.happiness + 6);
      pet.petUntil = time + 2.5;
      persist();
      return `${pet.saved.name} wags happily. (${petMood(pet.saved.happiness)})`;
    },

    rename(id, name) {
      const pet = find(id);
      if (!pet) return "No such pet.";
      const clean = (name || "").trim().slice(0, 16);
      if (!clean) return "Give your pet a name first.";
      pet.saved.name = clean;
      persist();
      return `Your pet is now called ${clean}.`;
    },

    release(id) {
      const pet = find(id);
      if (!pet) return "No such pet.";
      root.remove(pet.rig.group);
      live.delete(id);
      persist();
      return `${pet.saved.name} found a new home.`;
    },

    update(dt, player, ctx) {
      if (dt <= 0) return;
      time += dt;
      const slotOf = new Map<string, number>();
      let slot = 0;
      for (const pet of live.values()) slotOf.set(pet.saved.id, slot++);

      for (const pet of live.values()) {
        const entry = PET_CATALOG[pet.saved.species];
        const distToPlayer = Math.hypot(player.x - pet.x, player.z - pet.z);
        const beingPetted = time < pet.petUntil;
        let target: { x: number; z: number } | null = null;
        let speed = entry.walkSpeed;

        if (!pet.placed) {
          // First frame: appear trailing the player, never at the origin.
          const t = followTargetFor(player, slotOf.get(pet.saved.id) ?? 0);
          pet.x = t.x;
          pet.z = t.z;
          pet.stayX = t.x;
          pet.stayZ = t.z;
          pet.placed = true;
        } else if (pet.saved.mode === "stay" || !ctx.onFoot) {
          // Stay, or waiting while the player drives / flies / rides:
          // idle near the stay anchor, with a small wander so the pet
          // looks alive instead of frozen.
          if (time >= pet.wanderAt) {
            pet.wanderAt = time + 3 + Math.random() * 3;
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.2;
            pet.wanderX = pet.stayX + Math.cos(a) * r;
            pet.wanderZ = pet.stayZ + Math.sin(a) * r;
          }
          target = { x: pet.wanderX, z: pet.wanderZ };
          speed = entry.walkSpeed * 0.5;
        } else if (distToPlayer > PET_TELEPORT_DIST) {
          // Teleported / drove far away and came back on foot: catch up
          // beside the player instead of running across the whole city.
          const t = followTargetFor(player, slotOf.get(pet.saved.id) ?? 0);
          pet.x = t.x;
          pet.z = t.z;
          pet.yaw = player.yaw;
          pet.moving = false;
        } else {
          target = followTargetFor(player, slotOf.get(pet.saved.id) ?? 0);
          speed = petSpeedFor(pet.saved.species, distToPlayer);
          // A sad pet lags: it still follows, just slower.
          if (pet.saved.happiness < 40) speed *= 0.7;
        }

        if (target) {
          const step = planPetStep(pet, target, dt, { speed, stopDist: 0.35 });
          pet.x = step.x;
          pet.z = step.z;
          pet.yaw = step.yaw;
          pet.moving = step.moving;
          // Never close inside the player: the trail target is already
          // behind, and this is the backstop if the player walks into
          // the pet.
          const d = Math.hypot(player.x - pet.x, player.z - pet.z);
          if (ctx.onFoot && d < PET_MIN_DIST && d > 0.001) {
            const px = pet.x - player.x;
            const pz = pet.z - player.z;
            const len = Math.hypot(px, pz) || 1;
            pet.x = player.x + (px / len) * PET_MIN_DIST;
            pet.z = player.z + (pz / len) * PET_MIN_DIST;
          }
        }

        // --- Animation: legs, bob, tail, ears, petting hop. Cheap. ---
        const rig = pet.rig;
        const running = pet.moving && speed > entry.walkSpeed + 0.5;
        if (pet.moving) pet.walkPhase += dt * (running ? 13 : 9);
        const swing = pet.moving ? (running ? 0.85 : 0.6) : 0;
        const s = Math.sin(pet.walkPhase);
        rig.legs[0].rotation.x = s * swing;
        rig.legs[3].rotation.x = s * swing;
        rig.legs[1].rotation.x = -s * swing;
        rig.legs[2].rotation.x = -s * swing;
        const bob = pet.moving ? Math.abs(Math.sin(pet.walkPhase)) * 0.05 : Math.sin(time * 2 + pet.walkPhase) * 0.012;
        let hop = 0;
        if (beingPetted) {
          hop = Math.abs(Math.sin(time * 9)) * 0.22;
          rig.head.rotation.z = Math.sin(time * 9) * 0.12;
        } else {
          rig.head.rotation.z *= 0.9;
        }
        rig.body.position.y = bob + hop;
        if (!ctx.lowQuality) {
          const wagSpeed = beingPetted ? 14 : pet.saved.happiness >= 70 ? 7 : 3.5;
          rig.tail.rotation.y = Math.sin(time * wagSpeed + pet.walkPhase) * (beingPetted ? 0.7 : 0.45);
          const earBounce = pet.moving ? Math.sin(pet.walkPhase * 2) * 0.08 : 0;
          rig.earL.rotation.x = earBounce;
          rig.earR.rotation.x = earBounce;
        }
        // Sitting while staying: body dips, legs fold under.
        if (pet.saved.mode === "stay" && !pet.moving) {
          rig.body.position.y = -0.08;
          rig.body.rotation.x = -0.12;
        } else {
          rig.body.rotation.x *= 0.9;
        }
        rig.group.position.set(pet.x, 0, pet.z);
        rig.group.rotation.y = pet.yaw;
        // Distance after this frame's move, so the UI never shows the
        // pre-teleport gap for a frame after a catch-up.
        pet.dist = Math.hypot(player.x - pet.x, player.z - pet.z);
      }
    },
  };
}
