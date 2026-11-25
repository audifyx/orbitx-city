import {
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CHAIN_COLORS, OUTFIT_DEFS, SHOE_COLORS, WATCH_COLORS, type WardrobeSlots } from "./wardrobe";

export interface Look {
  id: string;
  displayName: string;
  tagline: string;
  /** Signature look line, from the research sheet (web/public/config/character-looks.md). */
  look?: string;
  /** Roster group: "kol" (existing KOLs) or a hero set ("walking-dead" / "fear" / "flash" / "arrow"). */
  group?: string;
  colors: { outfit: string; accent: string; skin: string; hair: string; eyes?: string };
  accessories: { hair: string; hat: string; extra: string; beard?: boolean; gear?: string };
}

const FALLBACK: Look[] = [
  {
    id: "tjr",
    displayName: "TJR",
    tagline: "Charts loud, jacket louder.",
    look: "Short black curls · maroon shirt",
    group: "kol",
    colors: { outfit: "#ff3355", accent: "#141414", skin: "#f0c2a0", hair: "#1a1a1a" },
    accessories: { hair: "spiky", hat: "none", extra: "headset" },
  },
];

let roster: Look[] = [];
let ready = false;

export function looksReady() {
  return ready;
}

export async function loadLooks() {
  if (ready && roster.length) return roster;
  try {
    const response = await fetch("/config/characters.json");
    const data = (await response.json()) as unknown;
    if (Array.isArray(data)) {
      const parsed = data.map(asLook).filter((item): item is Look => !!item);
      if (parsed.length) roster = parsed;
    }
  } catch {
    roster = FALLBACK;
  }
  if (!roster.length) roster = FALLBACK;
  ready = true;
  return roster;
}

export function allLooks() {
  return roster.length ? roster : FALLBACK;
}

export function lookById(id: string) {
  return allLooks().find((item) => item.id === id) ?? allLooks()[0];
}

export function lookName(id: string | undefined) {
  if (!id) return "";
  return allLooks().find((item) => item.id === id)?.displayName ?? "";
}

function asLook(raw: unknown): Look | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.displayName !== "string") return null;
  const colors = (row.colors && typeof row.colors === "object" ? row.colors : {}) as Record<string, unknown>;
  const accessories = (row.accessories && typeof row.accessories === "object" ? row.accessories : {}) as Record<string, unknown>;
  return {
    id: row.id,
    displayName: String(row.displayName),
    tagline: typeof row.tagline === "string" ? row.tagline : "",
    look: typeof row.look === "string" ? row.look : "",
    group: typeof row.group === "string" ? row.group : "kol",
    colors: {
      outfit: typeof colors.outfit === "string" ? colors.outfit : "#f4f6fa",
      accent: typeof colors.accent === "string" ? colors.accent : "#111111",
      skin: typeof colors.skin === "string" ? colors.skin : "#f0c2a0",
      hair: typeof colors.hair === "string" ? colors.hair : "#1a1a1a",
      eyes: typeof colors.eyes === "string" ? colors.eyes : undefined,
    },
    accessories: {
      hair: typeof accessories.hair === "string" ? accessories.hair : "buzz",
      hat: typeof accessories.hat === "string" ? accessories.hat : "none",
      extra: typeof accessories.extra === "string" ? accessories.extra : "none",
      beard: accessories.beard === true,
      gear: typeof accessories.gear === "string" ? accessories.gear : undefined,
    },
  };
}

// --- Clothes shop ------------------------------------------------------
// What the character is wearing, derived from the `owned` markers the
// server keeps (`worn:<slot>:<value>`, one per slot — see api/city.js).
// Slots: shirt / pants / shoes / outfit / glasses. An outfit overrides
// shirt + pants while worn. Values are the look keys the server sells.
export interface Clothes {
  shirt?: string;
  pants?: string;
  shoes?: string;
  outfit?: string;
  glasses?: string;
}

const CLOTHES_SLOTS = ["shirt", "pants", "shoes", "outfit", "glasses"] as const;

export function clothesFromOwned(owned: string[]): Clothes {
  const worn: Clothes = {};
  for (const entry of owned || []) {
    if (typeof entry !== "string" || !entry.startsWith("worn:")) continue;
    const [, slot, value] = entry.split(":");
    if (slot && value && (CLOTHES_SLOTS as readonly string[]).includes(slot)) {
      (worn as Record<string, string>)[slot] = value;
    }
  }
  return worn;
}

const SHIRT_STYLES: Record<string, { color: string; layer?: "hood" | "jacket"; inner?: string }> = {
  // Plain tees: just a torso colour. One tee in every avatar colour
  // (2026-11-17, shop-items) so every colour has an item.
  "tee-red": { color: "#e0392f" },
  "tee-gold": { color: "#e0b33a" },
  "tee-white": { color: "#f4f6fa" },
  "tee-cyan": { color: "#7eefff" },
  "tee-sunset": { color: "#ff7a3c" },
  "tee-black": { color: "#16181f" },
  "tee-silver": { color: "#c9ced6" },
  // Hoodie: torso colour + a hood behind the head. One in every colour.
  "hoodie-black": { color: "#16181f", layer: "hood" },
  "hoodie-white": { color: "#f4f6fa", layer: "hood" },
  "hoodie-gold": { color: "#e0b33a", layer: "hood" },
  "hoodie-cyan": { color: "#7eefff", layer: "hood" },
  "hoodie-sunset": { color: "#ff7a3c", layer: "hood" },
  "hoodie-red": { color: "#e0392f", layer: "hood" },
  "hoodie-silver": { color: "#c9ced6", layer: "hood" },
  // Jackets: torso colour + an open front showing the inner shirt as
  // the chest stripe (replaces the look's accent stripe).
  "jacket-denim": { color: "#3a5f8a", layer: "jacket", inner: "#f4f6fa" },
  "jacket-leather": { color: "#4a2f23", layer: "jacket", inner: "#1a1a1a" },
};

const PANTS_COLORS: Record<string, string> = {
  "jeans-blue": "#3a5f8a",
  "pants-black": "#16181f",
  "shorts-white": "#f4f6fa",
  // Pants in every avatar colour (2026-11-17, shop-items).
  "pants-red": "#d43a2e",
  "pants-gold": "#e0b33a",
  "pants-cyan": "#7eefff",
  "pants-sunset": "#ff7a3c",
  "pants-silver": "#c9ced6",
};

/** Shoe colour by look key — the walker (movement.ts) hangs these on the
 * leg pivots so they swing with the walk cycle. */
export const SHOES_COLORS: Record<string, string> = {
  "sneakers-white": "#f4f6fa",
  "boots-brown": "#6b4423",
  // Sneakers in every avatar colour (2026-11-17, shop-items).
  "sneakers-red": "#d43a2e",
  "sneakers-gold": "#e0b33a",
  "sneakers-cyan": "#7eefff",
  "sneakers-sunset": "#ff7a3c",
  "sneakers-black": "#16181f",
  "sneakers-silver": "#c9ced6",
};

const OUTFIT_STYLES: Record<string, { torso: string; legs: string; skirt?: boolean; tie?: string }> = {
  // Suit: black top + bottom, gold tie as the chest stripe.
  "suit-black": { torso: "#16181f", legs: "#16181f", tie: "#e0b33a" },
  // Gold suit: gold top + bottom, black tie.
  "suit-gold": { torso: "#e0b33a", legs: "#e0b33a", tie: "#16181f" },
  // Dress: red top + skirt, bare (skin) legs under it.
  "dress-red": { torso: "#c1272d", legs: "skin", skirt: true },
  "dress-gold": { torso: "#e0b33a", legs: "skin", skirt: true },
  "dress-white": { torso: "#f4f6fa", legs: "skin", skirt: true },
  // Tracksuit: gold top + bottom.
  "tracksuit-gold": { torso: "#e0b33a", legs: "#e0b33a" },
  // Tracksuits in every other colour (2026-11-17, shop-items).
  "tracksuit-red": { torso: "#d43a2e", legs: "#d43a2e" },
  "tracksuit-cyan": { torso: "#7eefff", legs: "#7eefff" },
  "tracksuit-white": { torso: "#f4f6fa", legs: "#f4f6fa" },
  "tracksuit-black": { torso: "#16181f", legs: "#16181f" },
};

const SHOP_COLORS: Record<string, string> = {
  white: "#f4f6fa",
  gold: "#e0b33a",
  cyan: "#7eefff",
  sunset: "#ff7a3c",
  black: "#16181f",
  // Red + silver suits were sold but never recoloured the outfit —
  // SHOP_COLORS had no entry for them (2026-11-17, shop-items).
  red: "#d43a2e",
  silver: "#c9ced6",
};

// --- Shaped parts (realistic overhaul, 2026-11-24) --------------------
// No BoxGeometry people anywhere: every part is a sphere, capsule,
// disc (cylinder) or rounded box, all unit-extent so a mesh's scale IS
// its size — except capsules, whose unit height is 2, so add() halves
// the Y scale for them. movement.ts's finders match the legs/torso/
// head by name first, then by the position+scale ranges below, so the
// named body meshes keep their exact positions and scales.
//
// Round 4 proportions (2026-11-24): realistic ~1:6 head/body, not the
// old ~1:4.5 cartoon. Total height ~1.76 so camera/door/collision
// math still works. Head dia 0.32 at HEAD_Y, torso narrower (0.56),
// legs longer (hip at HIP_Y 0.62). movement.ts pivots match these.
const HEAD_Y = 1.6;
const HEAD_D = 0.32;
const HIP_Y = 0.62;
const TORSO_Y = 0.98;
const UNIT_SPHERE = new SphereGeometry(0.5, 14, 10);
const UNIT_CAPSULE = new CapsuleGeometry(0.5, 1, 4, 12); // height 2, diameter 1
const UNIT_CAPSULE_X = UNIT_CAPSULE.clone().rotateZ(Math.PI / 2);
const UNIT_CAPSULE_Z = UNIT_CAPSULE.clone().rotateX(Math.PI / 2);
const UNIT_DISC = new CylinderGeometry(0.5, 0.5, 1, 16);
const UNIT_ROUNDED = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);

const matCache = new Map<string, MeshStandardMaterial>();
function mat(color: string, roughness = 0.55) {
  const key = `${color}|${roughness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
    matCache.set(key, m);
  }
  return m;
}

/** Add a shaped part of size (sx, sy, sz) at (x, y, z). Picks the
 * geometry by proportion: flat/tall round parts become discs (brims,
 * chips, cups, tophats, bats), near-cubes become spheres (heads, hair
 * puffs, buns), tall thin parts become capsules (locks, gear, horns),
 * everything else a rounded box (torsos, stripes, belts). */
function add(group: Group, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotZ = 0) {
  const m = Math.max(sx, sy, sz);
  const n = Math.min(sx, sy, sz);
  const sxz = Math.abs(sx - sz) / Math.max(sx, sz) < 0.2;
  const yRatio = sy / Math.max(sx, sz);
  let geo: BufferGeometry;
  let scale: [number, number, number] = [sx, sy, sz];
  if (sxz && (yRatio < 0.45 || yRatio > 1.25)) {
    geo = UNIT_DISC; // round in plan, flat or tall: brim, chip, cup, bat, staff
  } else if (m / n < 2.0) {
    geo = UNIT_SPHERE; // near-cube: head, hair puff, bun, knob
  } else if (sy === m && sy > sx * 1.4 && sy > sz * 1.4) {
    geo = UNIT_CAPSULE; // tall: hair lock, gear, horn
    scale = [sx, sy / 2, sz];
  } else if (sx === m && sx > sy * 1.4 && sx > sz * 1.4) {
    geo = UNIT_CAPSULE_X; // long in X: crossbow limb, belt, mouth
    scale = [sx / 2, sy, sz];
  } else if (sz === m && sz > sx * 1.4 && sz > sy * 1.4) {
    geo = UNIT_CAPSULE_Z; // long in Z: plume crest
    scale = [sx, sy, sz / 2];
  } else {
    geo = UNIT_ROUNDED; // the rest: torso slabs, stripes, collars
  }
  const mesh = new Mesh(geo, mat(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.rotation.z = rotZ;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

/** Add a part whose scale must stay EXACTLY (sx, sy, sz) — the
 * finder-sensitive meshes (legs/torso/head, static shoes, watch).
 * movement.ts matches those by position+scale, so no capsule /2 here. */
function addExact(
  group: Group,
  geo: BufferGeometry,
  color: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  name?: string,
) {
  const mesh = new Mesh(geo, mat(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  if (name) mesh.name = name;
  group.add(mesh);
  return mesh;
}

// Darken a hex colour by a factor (0-1) — used for the nose, a shade
// darker than the character's own skin, so it reads on every skin tone
// (light #f0c2a0 through dark brown #6b4429) instead of a fixed brown
// that would vanish on one end and clash on the other.
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function dressPerson(
  group: Group,
  look: Look,
  shop: { color: string; hat: string; owned: string[]; trustOwned: boolean; clothes?: Clothes; wardrobe?: WardrobeSlots },
) {
  // Remember which character this group is dressed as, so the walker
  // (movement.ts) can hang character-specific arm details on the pivots.
  group.userData.lookId = look.id;
  // ...and what they are wearing, so the walker can hang shoe boxes on
  // the leg pivots (shoes must swing with the legs, not float static).
  const clothes: Clothes = shop.clothes ?? {};
  group.userData.clothes = clothes;
  // ...and the wardrobe slots, so the walker can hang wardrobe shoes
  // and the bought watch on the swinging limbs too (walk-fix 2026-11-17).
  group.userData.wardrobe = shop.wardrobe;
  for (const child of [...group.children]) {
    if (child.name === "ring" || child.name === "tag") continue;
    group.remove(child);
  }
  const bought = shop.trustOwned ? shop.owned.includes(`color-${shop.color}`) : shop.color !== "white" && !!SHOP_COLORS[shop.color];
  // Wardrobe outfit wins over the shop colour suit, which wins over the
  // character's own outfit. A wardrobe outfit also carries a silhouette
  // (hoodie / leather zip / suit tie) rendered below the torso.
  const outfitDef = shop.wardrobe?.outfit ? OUTFIT_DEFS[shop.wardrobe.outfit] : undefined;
  const outfit = outfitDef ? outfitDef.color : bought && SHOP_COLORS[shop.color] ? SHOP_COLORS[shop.color] : look.colors.outfit;
  const accent = look.colors.accent;
  const skin = look.colors.skin;
  const hair = look.colors.hair;
  // Clothes override the base look: an outfit wins over shirt + pants;
  // otherwise the shirt recolours the torso and the pants the legs.
  // (The walker takes the legs-box material as the leg colour, so pants
  // flow into the swinging legs for free.) A wardrobe outfit wins over
  // the clothes outfit outright — it already set `outfit` above — so
  // the clothes layers only apply when no wardrobe outfit is worn.
  const outfitStyle = !outfitDef && clothes.outfit ? OUTFIT_STYLES[clothes.outfit] : undefined;
  const shirtStyle = !outfitDef && !outfitStyle && clothes.shirt ? SHIRT_STYLES[clothes.shirt] : undefined;
  const torsoColor = outfitStyle?.torso ?? shirtStyle?.color ?? outfit;
  const legsColor = outfitStyle
    ? outfitStyle.legs === "skin"
      ? skin
      : outfitStyle.legs
    : clothes.pants
      ? PANTS_COLORS[clothes.pants] ?? "#1a1c22"
      : "#1a1c22";
  // Chest stripe: a suit's tie, a jacket's open-front inner shirt, else
  // the look's accent. Pushed 0.015 proud of the torso front (z 0.175,
  // front 0.215 vs torso 0.20) — at 0.16 the stripe's front face was
  // exactly coplanar with the torso's and flickered (walk-fix 2026-11-17).
  const chestStripe = outfitStyle?.tie ?? (shirtStyle?.layer === "jacket" ? shirtStyle.inner ?? accent : accent);
  // Realistic body (round 4, 2026-11-24): longer legs (hip 0.62),
  // narrower torso (0.56 wide), smaller head (0.32 dia at 1.60).
  // Named "legs"/"torso"/"head" so movement.ts finds them by name;
  // the walker replaces the legs with two capsule limbs pivoting at
  // HIP_Y and hangs arms from shoulder height (TORSO_Y + 0.32).
  addExact(group, UNIT_ROUNDED, legsColor, 0, HIP_Y / 2, 0, 0.44, 0.62, 0.3, "legs");
  // Wardrobe shoes: two ROUND shoes at the feet (spheres, not boxes) —
  // built exact so the walker's static-shoe removal still matches.
  if (shop.wardrobe?.shoes && SHOE_COLORS[shop.wardrobe.shoes]) {
    const shoeColor = SHOE_COLORS[shop.wardrobe.shoes];
    addExact(group, UNIT_SPHERE, shoeColor, -0.11, 0.05, 0.03, 0.2, 0.09, 0.3);
    addExact(group, UNIT_SPHERE, shoeColor, 0.11, 0.05, 0.03, 0.2, 0.09, 0.3);
  }
  addExact(group, UNIT_ROUNDED, torsoColor, 0, TORSO_Y, 0, 0.56, 0.66, 0.34, "torso");
  add(group, chestStripe, 0, 1.02, 0.16, 0.24, 0.36, 0.06);
  // Belt at the waist (dark, gold buckle) + a collar band at the neck
  // (accent colour) — the outfit read as one flat slab before; now it
  // has a waist and a neckline. Skipped for dresses (the skirt covers
  // the waist) and for the suit (the tie bar is already the chest
  // detail).
  if (!outfitStyle?.skirt && outfitDef?.style !== "suit") {
    add(group, "#1a1c22", 0, 0.68, 0, 0.58, 0.06, 0.36);
    add(group, "#e0b33a", 0, 0.68, 0.185, 0.07, 0.045, 0.02);
    add(group, accent, 0, 1.28, 0, 0.34, 0.06, 0.36);
  }
  // Hoodie hood, behind the head (same shape as the "hood" hat branch).
  if (shirtStyle?.layer === "hood") {
    add(group, shirtStyle.color, 0, 1.62, -0.1, 0.46, 0.36, 0.28);
    add(group, shirtStyle.color, 0, 1.86, 0, 0.44, 0.13, 0.42);
  }
  // Dress skirt, over the top of the legs: a flared cone, not a slab.
  if (outfitStyle?.skirt) {
    const skirt = new Mesh(new CylinderGeometry(0.24, 0.34, 0.36, 12), mat(outfitStyle.torso));
    skirt.position.set(0, 0.55, 0);
    skirt.scale.set(0.9, 1, 0.58);
    skirt.castShadow = true;
    group.add(skirt);
  }
  // Outfit silhouette extras — only a wardrobe outfit has one.
  if (outfitDef?.style === "hoodie") {
    // Hood bunched behind the neck + a hood rim over the shoulders.
    add(group, outfit, 0, 1.62, -0.1, 0.46, 0.36, 0.28);
    add(group, outfit, 0, 1.86, 0, 0.44, 0.13, 0.42);
  } else if (outfitDef?.style === "leather") {
    // Gold zipper down the chest front.
    add(group, "#e0b33a", 0, 0.98, 0.18, 0.05, 0.55, 0.02);
    // OrbitX patches on the jacket (home-frame hero look: the leather
    // jacket is covered in patches) — clear of the chest stripe.
    add(group, "#ff2ea6", -0.16, 1.1, 0.18, 0.1, 0.09, 0.02);
    add(group, "#00e5ff", 0.16, 1.1, 0.18, 0.1, 0.09, 0.02);
    add(group, "#e0b33a", -0.16, 0.84, 0.18, 0.1, 0.09, 0.02);
  } else if (outfitDef?.style === "suit") {
    // Gold tie bar down the chest front.
    add(group, "#e0b33a", 0, 1.0, 0.18, 0.09, 0.44, 0.02);
  }
  // Sphere head, round 4 size (0.32 dia at HEAD_Y 1.60) — the old
  // 0.40 ball at 1.58 was ~1:4.5 cartoon; this is ~1:6.
  addExact(group, UNIT_SPHERE, skin, 0, HEAD_Y, 0, HEAD_D, HEAD_D, HEAD_D, "head");
  // Cupsy has NO face (user decision 2026-11-11 — faceless by design).
  // No eyes, no mouth, no face features at all. Do not match a real
  // face, do not invent one.
  if (look.id !== "cupsy") {
    // Real face (round 4): a slightly narrower jaw sphere under the
    // head sphere tapers the lower face so it reads as a jaw/chin,
    // not a ball; eye whites + coloured iris + dark pupil (not dots);
    // angled capsule brows; a nose with a bridge + tip; two-tone
    // lips; ears. All positions are relative to HEAD_Y and the 0.16
    // head radius, so they sit on the sphere surface, not floating.
    const eyes = look.colors.eyes ?? "#3a2a1a";
    const lipDark = "#8a4438";
    const lipLight = "#c07a68";
    // Jaw/chin: narrower than the head sphere, overlapping its lower
    // half — the taper that makes a face instead of a ball.
    addExact(group, UNIT_SPHERE, skin, 0, HEAD_Y - 0.08, 0.01, 0.24, 0.17, 0.24);
    // Ears, flush with the sides of the head.
    addExact(group, UNIT_SPHERE, skin, -0.15, HEAD_Y, 0, 0.035, 0.065, 0.03);
    addExact(group, UNIT_SPHERE, skin, 0.15, HEAD_Y, 0, 0.035, 0.065, 0.03);
    for (const side of [-1, 1]) {
      const ex = side * 0.062;
      const eyeTag = side < 0 ? "L" : "R";
      // Angled brow (capsule via add), sloping down toward the nose.
      add(group, hair, ex, HEAD_Y + 0.105, 0.13, 0.085, 0.022, 0.03, -side * 0.12);
      // Eye white, then the coloured iris, then the dark pupil —
      // three depths (z 0.125 / 0.143 / 0.15) so nothing z-fights and
      // the pupil reads proud of the white. Named (round 6) so the
      // walker (movement.ts) can blink them — scale.y squash, no new
      // meshes. Cupsy never reaches this block: still faceless.
      addExact(group, UNIT_SPHERE, "#f4f6fa", ex, HEAD_Y + 0.035, 0.125, 0.07, 0.05, 0.035, `eye${eyeTag}-white`);
      addExact(group, UNIT_SPHERE, eyes, ex, HEAD_Y + 0.035, 0.143, 0.045, 0.045, 0.02, `eye${eyeTag}-iris`);
      addExact(group, UNIT_SPHERE, "#14100c", ex, HEAD_Y + 0.035, 0.15, 0.026, 0.026, 0.02, `eye${eyeTag}-pupil`);
    }
    // Nose: a vertical capsule bridge + a round tip, a shade darker
    // than the skin so it reads on every skin tone.
    add(group, shade(skin, 0.85), 0, HEAD_Y - 0.01, 0.14, 0.04, 0.08, 0.03);
    addExact(group, UNIT_SPHERE, shade(skin, 0.82), 0, HEAD_Y - 0.055, 0.145, 0.05, 0.04, 0.04);
    // Lips: darker upper lip, fuller lighter lower lip. The lower lip
    // is named (round 6) so the walker can move it while talking.
    add(group, lipDark, 0, HEAD_Y - 0.095, 0.135, 0.085, 0.018, 0.025);
    const lipLower = add(group, lipLight, 0, HEAD_Y - 0.115, 0.13, 0.065, 0.022, 0.025);
    lipLower.name = "lipLower";
  }
  if (look.accessories.beard) {
    add(group, hair, 0, 1.46, 0.11, 0.22, 0.1, 0.07);
    add(group, hair, 0, 1.52, 0.13, 0.17, 0.04, 0.04);
  }
  // A bought hairstyle overrides the character's own hair. New wardrobe
  // styles (afro / dreads / bun / fade) get their own branches; the rest
  // reuse the character-hair branches below.
  const style = shop.wardrobe?.hair || look.accessories.hair;
  // Hair sits on the round 4 head (top 1.76, radius 0.16) — every
  // branch below is anchored to that, not the old 0.40 ball.
  if (style === "afro") {
    add(group, hair, 0, 1.8, 0, 0.46, 0.26, 0.44);
    add(group, hair, -0.2, 1.72, 0, 0.16, 0.18, 0.18);
    add(group, hair, 0.2, 1.72, 0, 0.16, 0.18, 0.18);
  } else if (style === "dreads") {
    add(group, hair, 0, 1.78, 0, 0.38, 0.14, 0.38);
    add(group, hair, -0.17, 1.38, -0.04, 0.09, 0.45, 0.11);
    add(group, hair, 0.17, 1.38, -0.04, 0.09, 0.45, 0.11);
    add(group, hair, 0, 1.38, -0.17, 0.11, 0.45, 0.09);
    // Front locks sit proud of the face (z 0.14, front 0.185 vs head
    // 0.16) — at the old 0.2 they would float in front of the smaller
    // head (walk-fix 2026-11-17, re-anchored round 4).
    add(group, hair, -0.09, 1.44, 0.14, 0.08, 0.36, 0.08);
    add(group, hair, 0.09, 1.44, 0.14, 0.08, 0.36, 0.08);
  } else if (style === "bun") {
    add(group, hair, 0, 1.76, 0, 0.36, 0.09, 0.36);
    add(group, hair, 0, 1.92, 0, 0.14, 0.16, 0.14);
  } else if (style === "fade") {
    // Skin fade: close on the sides, a crisp flat top.
    add(group, hair, 0, 1.76, 0, 0.36, 0.09, 0.36);
    add(group, hair, 0, 1.83, 0, 0.26, 0.07, 0.26);
  } else if (style === "spiky") {
    add(group, hair, 0, 1.84, 0, 0.1, 0.24, 0.1);
    add(group, hair, -0.12, 1.79, 0, 0.09, 0.2, 0.09, 0.4);
    add(group, hair, 0.12, 1.79, 0, 0.09, 0.2, 0.09, -0.4);
  } else if (style === "long") {
    // Back panel lowered onto the sphere head (was y 1.78, the very top
    // of the old cube — on a sphere that point has zero width).
    add(group, hair, 0, 1.62, -0.12, 0.38, 0.18, 0.2);
    add(group, hair, -0.15, 1.33, -0.05, 0.11, 0.5, 0.13);
    add(group, hair, 0.15, 1.33, -0.05, 0.11, 0.5, 0.13);
  } else if (style === "mohawk") {
    add(group, hair, 0, 1.88, 0, 0.09, 0.36, 0.3);
  } else if (style === "curly") {
    add(group, hair, 0, 1.77, 0, 0.42, 0.2, 0.4);
    add(group, hair, -0.15, 1.66, 0.07, 0.14, 0.14, 0.14);
    add(group, hair, 0.15, 1.66, 0.07, 0.14, 0.14, 0.14);
  } else if (style === "side") {
    // Short hair swept to one side (Hsaka). Pushed 0.03 proud of the
    // head front (z 0.11, front 0.21 vs head 0.16) — at 0.1 the front
    // face was exactly coplanar with the head's and flickered.
    add(group, hair, 0.03, 1.79, 0, 0.34, 0.11, 0.36);
    add(group, hair, -0.13, 1.72, 0.11, 0.14, 0.09, 0.18);
  } else if (style === "buzz") {
    add(group, hair, 0, 1.76, 0, 0.36, 0.09, 0.36);
  }
  const hat = shop.hat && shop.hat !== "none" ? shop.hat : look.accessories.hat;
  // Hats sit on the round 4 head (top 1.76) — re-anchored from the old
  // 0.40 ball (top 1.78, radius 0.20).
  if (hat === "cap") {
    add(group, "#16181f", 0, 1.8, 0, 0.4, 0.13, 0.4);
    add(group, "#16181f", 0, 1.75, 0.2, 0.32, 0.05, 0.16);
  } else if (hat === "sheriff") {
    // Sheriff's hat: wide tan brim + tall crown + dark band, and a gold
    // star badge on the chest (Cole Maddox).
    add(group, "#8a7a56", 0, 1.82, 0, 0.54, 0.05, 0.54);
    add(group, "#8a7a56", 0, 1.93, 0, 0.34, 0.18, 0.34);
    add(group, "#6b5a3e", 0, 1.88, 0, 0.36, 0.04, 0.36);
    add(group, "#e0b33a", -0.12, 1.1, 0.18, 0.09, 0.09, 0.03);
  } else if (hat === "beanie") {
    add(group, accent, 0, 1.8, 0, 0.38, 0.2, 0.38);
  } else if (hat === "hood") {
    add(group, outfit, 0, 1.62, -0.1, 0.46, 0.36, 0.28);
    add(group, outfit, 0, 1.86, 0, 0.44, 0.13, 0.42);
  } else if (hat === "horns") {
    add(group, accent, -0.14, 1.86, 0, 0.07, 0.26, 0.07, 0.35);
    add(group, accent, 0.14, 1.86, 0, 0.07, 0.26, 0.07, -0.35);
    add(group, skin, -0.19, 1.58, 0, 0.09, 0.11, 0.05);
    add(group, skin, 0.19, 1.58, 0, 0.09, 0.11, 0.05);
  } else if (hat === "antenna") {
    add(group, "#9aa3ad", 0, 1.98, 0, 0.05, 0.4, 0.05);
    add(group, "#7ef6ff", 0, 2.22, 0, 0.12, 0.12, 0.12);
  } else if (hat === "crown") {
    add(group, "#e0b33a", 0, 1.84, 0, 0.42, 0.14, 0.42);
    add(group, "#e0b33a", -0.14, 2.0, 0, 0.09, 0.16, 0.09);
    add(group, "#e0b33a", 0, 2.04, 0, 0.09, 0.2, 0.09);
    add(group, "#e0b33a", 0.14, 2.0, 0, 0.09, 0.16, 0.09);
  } else if (hat === "bullcap") {
    // Poor Goat: red cap + big curved grey horns, mustache, tongue out.
    add(group, accent, 0, 1.8, 0, 0.4, 0.13, 0.4);
    add(group, accent, 0, 1.75, 0.2, 0.32, 0.05, 0.16);
    add(group, "#9aa3ad", -0.16, 1.92, 0, 0.07, 0.28, 0.07, 0.35);
    add(group, "#9aa3ad", 0.16, 1.92, 0, 0.07, 0.28, 0.07, -0.35);
    // Mustache + tongue out (from his black-bull public avatar).
    add(group, "#3a3d45", 0, 1.5, 0.16, 0.21, 0.05, 0.04);
    add(group, "#e87a8a", 0, 1.43, 0.17, 0.09, 0.11, 0.03);
  } else if (hat === "chips") {
    // Gainzy: a stack of poker chips balanced on top.
    add(group, "#f4f6fa", 0, 1.78, 0, 0.3, 0.09, 0.3);
    add(group, "#16181f", 0, 1.84, 0, 0.3, 0.06, 0.3);
    add(group, "#c1272d", 0, 1.9, 0, 0.3, 0.06, 0.3);
    add(group, "#f4f6fa", 0, 1.96, 0, 0.27, 0.05, 0.27);
  } else if (hat === "plume") {
    // Kaleo: Roman helmet with a crest.
    add(group, "#d8a04a", 0, 1.8, 0, 0.4, 0.16, 0.4);
    add(group, outfit, 0, 1.95, 0, 0.09, 0.22, 0.36);
    add(group, "#d8a04a", 0, 1.73, 0.2, 0.34, 0.05, 0.05);
  } else if (hat === "tophat") {
    // Top Hat: tall black cylinder + wide brim. (Sold but invisible
    // before — no branch existed, 2026-11-17 shop-items.)
    add(group, "#16181f", 0, 1.8, 0, 0.44, 0.05, 0.44);
    add(group, "#16181f", 0, 2.0, 0, 0.26, 0.36, 0.26);
    add(group, "#e0b33a", 0, 1.87, 0, 0.28, 0.05, 0.28);
  } else if (hat === "headphones") {
    // Headphones: band over the head + a cup on each ear. (Sold but
    // invisible before, 2026-11-17 shop-items.)
    add(group, "#16181f", 0, 1.9, 0, 0.44, 0.07, 0.36);
    add(group, "#c1272d", -0.22, 1.66, 0, 0.09, 0.2, 0.18);
    add(group, "#c1272d", 0.22, 1.66, 0, 0.09, 0.2, 0.18);
  } else if (hat === "visor") {
    // Sun visor: a wide brim with no crown, gold band. (Sold but
    // invisible before, 2026-11-17 shop-items.)
    add(group, "#16181f", 0, 1.75, 0.2, 0.36, 0.04, 0.18);
    add(group, "#e0b33a", 0, 1.8, 0.08, 0.38, 0.04, 0.05);
  }
  const extra = look.accessories.extra;
  // Wardrobe glasses replace the character's own glasses/shades/visor;
  // the wardrobe chain (rendered in its own block below) replaces the
  // character's own chain. Other extras (headset/cup/mic/mask) are
  // untouched by the wardrobe.
  const wGlasses = shop.wardrobe?.glasses || "";
  const wChain = shop.wardrobe?.chain || "";
  if (wGlasses === "shades") {
    add(group, "#12141a", 0, 1.635, 0.14, 0.3, 0.09, 0.05);
  } else if (wGlasses === "readers") {
    add(group, "#22262e", -0.09, 1.635, 0.145, 0.09, 0.055, 0.03);
    add(group, "#22262e", 0.09, 1.635, 0.145, 0.09, 0.055, 0.03);
    add(group, "#22262e", 0, 1.635, 0.145, 0.05, 0.02, 0.02);
    add(group, "#22262e", 0, 1.685, 0.145, 0.24, 0.02, 0.02);
    add(group, "#22262e", -0.15, 1.635, 0.145, 0.02, 0.07, 0.02);
    add(group, "#22262e", 0.15, 1.635, 0.145, 0.02, 0.07, 0.02);
  } else if (wGlasses === "round") {
    // Gold-rim rounds with light lenses.
    add(group, "#e0b33a", -0.09, 1.635, 0.145, 0.12, 0.09, 0.03);
    add(group, "#e0b33a", 0.09, 1.635, 0.145, 0.12, 0.09, 0.03);
    add(group, "#dbe7ef", -0.09, 1.635, 0.15, 0.08, 0.06, 0.02);
    add(group, "#dbe7ef", 0.09, 1.635, 0.15, 0.08, 0.06, 0.02);
    add(group, "#e0b33a", 0, 1.635, 0.145, 0.05, 0.02, 0.02);
  } else if (wGlasses === "visor") {
    const stripes = ["#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#af52de"];
    stripes.forEach((color, i) => {
      add(group, color, -0.14 + i * 0.07, 1.635, 0.14, 0.07, 0.09, 0.05);
    });
  } else if (extra === "glasses") {
    if (look.id === "cobie") {
      // Cobie: dark Bitcoin shades from his avatar art (not light lenses).
      add(group, "#12141a", -0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#12141a", 0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#12141a", 0, 1.635, 0.145, 0.06, 0.03, 0.03);
      add(group, "#e0b33a", 0.09, 1.635, 0.165, 0.05, 0.05, 0.02);
    } else if (look.id === "hsaka") {
      // Hsaka: black frames + purple-tinted lenses.
      add(group, "#8a5cf6", -0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#8a5cf6", 0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#111111", 0, 1.635, 0.145, 0.06, 0.03, 0.03);
      add(group, "#111111", 0, 1.68, 0.145, 0.28, 0.03, 0.03);
      add(group, "#111111", -0.15, 1.635, 0.145, 0.03, 0.09, 0.03);
      add(group, "#111111", 0.15, 1.635, 0.145, 0.03, 0.09, 0.03);
    } else if (look.id === "murad") {
      // Murad: black-framed glasses, smoke lenses.
      add(group, "#3a3f4a", -0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#3a3f4a", 0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#111111", 0, 1.635, 0.145, 0.06, 0.03, 0.03);
      add(group, "#111111", 0, 1.68, 0.145, 0.28, 0.03, 0.03);
      add(group, "#111111", -0.15, 1.635, 0.145, 0.03, 0.09, 0.03);
      add(group, "#111111", 0.15, 1.635, 0.145, 0.03, 0.09, 0.03);
    } else {
      add(group, "#dbe7ef", -0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#dbe7ef", 0.09, 1.635, 0.145, 0.11, 0.07, 0.04);
      add(group, "#dbe7ef", 0, 1.635, 0.145, 0.06, 0.03, 0.03);
    }
  } else if (extra === "shades") {
    add(group, "#12141a", 0, 1.635, 0.14, 0.3, 0.09, 0.05);
  } else if (extra === "headset") {
    add(group, accent, 0, 1.68, 0, 0.44, 0.06, 0.1);
    add(group, "#22262e", -0.2, 1.56, 0, 0.09, 0.15, 0.11);
    add(group, "#22262e", 0.2, 1.56, 0, 0.09, 0.15, 0.11);
  } else if (extra === "cup") {
    add(group, "#fff6fb", 0.28, 1.05, 0.16, 0.12, 0.16, 0.12);
    add(group, accent, 0.28, 1.16, 0.16, 0.14, 0.04, 0.14);
  } else if (extra === "mic") {
    add(group, "#222", 0.11, 1.33, 0.24, 0.04, 0.26, 0.04);
    add(group, "#111", 0.11, 1.47, 0.3, 0.09, 0.09, 0.09);
  } else if (extra === "mask") {
    add(group, "#101216", 0, 1.52, 0.13, 0.24, 0.13, 0.05);
  } else if (extra === "visor") {
    // Threadguy: rainbow visor shades, from his pixel-ape avatar.
    const stripes = ["#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#af52de"];
    stripes.forEach((color, i) => {
      add(group, color, -0.14 + i * 0.07, 1.635, 0.14, 0.07, 0.09, 0.05);
    });
  } else if (extra === "bolt") {
    // Gold lightning bolt zigzag on the chest (Dash Vance, the Blur).
    // Pushed proud of the chest stripe (z 0.21, front 0.225 vs 0.215).
    add(group, "#e0b33a", 0.06, 1.14, 0.18, 0.08, 0.16, 0.03, 0.35);
    add(group, "#e0b33a", -0.02, 1.0, 0.18, 0.08, 0.16, 0.03, -0.35);
    add(group, "#e0b33a", 0.05, 0.86, 0.18, 0.08, 0.14, 0.03, 0.35);
  }
  // Sunglasses from the clothes shop: dark shades across the eyes.
  // Skipped when the look already wears glasses/shades of its own.
  if (clothes.glasses === "sunglasses" && !shop.wardrobe?.glasses && extra !== "glasses" && extra !== "shades") {
    add(group, "#12141a", 0, 1.635, 0.14, 0.3, 0.09, 0.05);
  }
  // Wardrobe chain (neck) — its own slot, so it renders alongside
  // glasses/headset/etc. It replaces the character's own chain; Frank's
  // beaded necklaces stay when no wardrobe chain is worn.
  if (wChain) {
    if (wChain === "beads") {
      add(group, "#7ec8e3", 0, 1.24, 0.16, 0.34, 0.06, 0.08);
      add(group, "#c1272d", 0, 1.18, 0.16, 0.34, 0.06, 0.08);
    } else {
      add(group, CHAIN_COLORS[wChain] ?? "#e0b33a", 0, 1.24, 0.16, 0.34, 0.08, 0.08);
      if (wChain === "diamond") {
        // Diamond pendant hanging on the chest.
        add(group, "#ffffff", 0, 1.14, 0.17, 0.1, 0.12, 0.05);
      }
    }
  } else if (extra === "chain") {
    if (look.id === "frank") {
      // Frank: beaded necklaces, light blue + red (his public avatar).
      // Ansem's gold chain stays gold — this is a Frank-specific branch,
      // not a recolor of the chain.
      add(group, "#7ec8e3", 0, 1.24, 0.16, 0.34, 0.06, 0.08);
      add(group, "#c1272d", 0, 1.18, 0.16, 0.34, 0.06, 0.08);
    } else {
      add(group, "#e0b33a", 0, 1.24, 0.16, 0.34, 0.08, 0.08);
    }
  }
  // Wardrobe watch — a band on the left wrist. The walker's left arm
  // pivot sits at (-0.32, 1.30) and the limb hangs to ~0.72, so the
  // wrist rests at 0.72. The band is group-space, not arm-attached:
  // it sits at the rest position and is visible in every camera.
  if (shop.wardrobe?.watch && WATCH_COLORS[shop.wardrobe.watch]) {
    // Built exact so the walker's watch re-hang still matches.
    addExact(group, UNIT_ROUNDED, WATCH_COLORS[shop.wardrobe.watch], -0.32, 0.72, 0, 0.22, 0.09, 0.22);
    addExact(group, UNIT_ROUNDED, "#f4f6fa", -0.32, 0.72, 0.1, 0.1, 0.05, 0.02);
  }
  // Threadguy: the mic is his job (Spaces host) — his extra is the
  // rainbow visor, so the mic branch above never fires for him.
  if (look.id === "threadguy") {
    add(group, "#222", 0.11, 1.33, 0.24, 0.04, 0.26, 0.04);
    add(group, "#111", 0.11, 1.47, 0.3, 0.09, 0.09, 0.09);
  }
  // Hero gear: signature weapon carried diagonally on the back (heroes
  // pack, wave 1). All pieces share one diagonal (rotZ 0.6) across the
  // back (z -0.26, behind the torso back face at -0.20); `along` measures
  // distance from the centre along the weapon, so handles/guards land on
  // its ends. Back-mounted, never hand-held — the walker's swinging arms
  // would leave a hand-held weapon floating.
  const gear = look.accessories.gear;
  if (gear) {
    const gx = (along: number) => -Math.sin(0.6) * along;
    const gy = (along: number) => 1.0 + Math.cos(0.6) * along;
    if (gear === "crossbow") {
      add(group, "#3a2f23", gx(0), gy(0), -0.26, 0.1, 0.9, 0.08, 0.6);
      add(group, "#22262e", gx(0.35), gy(0.35), -0.26, 0.7, 0.08, 0.06, 0.6 + Math.PI / 2);
      add(group, "#9aa3ad", gx(-0.4), gy(-0.4), -0.26, 0.12, 0.2, 0.09, 0.6);
    } else if (gear === "katana") {
      add(group, "#c9ced6", gx(0.1), gy(0.1), -0.26, 0.07, 1.1, 0.05, 0.6);
      add(group, "#1a1a1a", gx(-0.55), gy(-0.55), -0.26, 0.09, 0.3, 0.07, 0.6);
      add(group, "#e0b33a", gx(-0.38), gy(-0.38), -0.26, 0.16, 0.05, 0.06, 0.6);
    } else if (gear === "bat") {
      // Bessie: wooden bat with two grey bands (barbed-wire hint).
      add(group, "#8a6d4b", gx(0), gy(0), -0.26, 0.12, 1.2, 0.12, 0.6);
      add(group, "#9aa3ad", gx(0.25), gy(0.25), -0.26, 0.14, 0.08, 0.14, 0.6);
      add(group, "#9aa3ad", gx(-0.05), gy(-0.05), -0.26, 0.14, 0.08, 0.14, 0.6);
    } else if (gear === "bow") {
      // Bow: three angled limbs forming a shallow arc + a quiver.
      add(group, "#2a4a22", gx(0.25), gy(0.25), -0.26, 0.09, 0.55, 0.07, 0.35);
      add(group, "#2a4a22", gx(0), gy(0), -0.26, 0.09, 0.5, 0.07, 0.6);
      add(group, "#2a4a22", gx(-0.25), gy(-0.25), -0.26, 0.09, 0.55, 0.07, 0.85);
      add(group, "#6b4423", 0.24, 0.95, -0.26, 0.16, 0.5, 0.12, 0.15);
    } else if (gear === "staff") {
      add(group, "#6b4423", gx(0), gy(0), -0.26, 0.09, 1.6, 0.09, 0.6);
      add(group, "#8a6d4b", gx(0.72), gy(0.72), -0.26, 0.11, 0.14, 0.11, 0.6);
      add(group, "#8a6d4b", gx(-0.72), gy(-0.72), -0.26, 0.11, 0.14, 0.11, 0.6);
    } else if (gear === "baton") {
      add(group, "#16181f", gx(0), gy(0), -0.26, 0.08, 0.8, 0.08, 0.6);
      add(group, "#3a3f4a", gx(0.32), gy(0.32), -0.26, 0.1, 0.16, 0.1, 0.6);
    } else if (gear === "rifle") {
      add(group, "#22262e", gx(0.1), gy(0.1), -0.26, 0.09, 1.2, 0.09, 0.6);
      add(group, "#6b4423", gx(-0.45), gy(-0.45), -0.26, 0.12, 0.35, 0.1, 0.6);
      add(group, "#9aa3ad", gx(0.62), gy(0.62), -0.26, 0.06, 0.18, 0.06, 0.6);
    }
  }
}

export const LOOK_IDS = [
  "tjr",
  "ansem",
  "poor-goat",
  "cupsy",
  "cobie",
  "hsaka",
  "gainzy",
  "zachxbt",
  "threadguy",
  "murad",
  "frank",
  "kaleo",
  "cole-maddox",
  "ryder-cross",
  "mika-reyes",
  "carolyn-marsh",
  "nolan-graves",
  "maggie-hart",
  "mara-clarke",
  "alyssa-clarke",
  "victor-vale",
  "morgan-pierce",
  "dash-vance",
  "owen-quinn",
  "glen-park",
  "carl-maddox",
  "abe-foster",
  "rosie-vega",
  "gene-watts",
  "zeke-sutton",
  "gabe-stone",
  "aaron-hale",
  "sasha-wells",
  "nicky-clarke",
  "travis-mann",
  "danny-salas",
  "ofelia-salas",
  "lucy-galvez",
  "dwayne-riggs",
  "johnny-dore",
  "june-calloway",
  "alia-stone",
  "charlie-nash",
  "sarah-wicks",
  "iris-vance",
  "kate-frost",
  "sisko-ray",
  "joe-wells",
  "harrison-voss",
  "wally-vance",
  "jessie-swift",
  "jay-garrett",
  "ralph-dugan",
  "leo-coldwell",
  "mick-rourke",
  "celia-horton",
  "chester-rook",
  "nora-vance",
  "felicity-sloan",
  "john-diggs",
  "laura-lance",
  "sara-lane",
  "thea-quinn",
  "roy-harp",
  "marcus-merlin",
  "slade-willis",
  "adrian-crane",
  "emiko-quinn",
  "rene-ramos",
  "dina-drake",
  "curtis-hoyt",
  "nyssa-ghul",
];
