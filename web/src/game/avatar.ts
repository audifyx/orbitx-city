import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";

export interface Look {
  id: string;
  displayName: string;
  tagline: string;
  /** Signature look line, from the research sheet (web/public/config/character-looks.md). */
  look?: string;
  colors: { outfit: string; accent: string; skin: string; hair: string; eyes?: string };
  accessories: { hair: string; hat: string; extra: string; beard?: boolean };
}

const FALLBACK: Look[] = [
  {
    id: "tjr",
    displayName: "TJR",
    tagline: "Charts loud, jacket louder.",
    look: "Short black curls · maroon shirt",
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
    },
  };
}

const SHOP_COLORS: Record<string, string> = {
  white: "#f4f6fa",
  gold: "#e0b33a",
  cyan: "#7eefff",
  sunset: "#ff7a3c",
  black: "#16181f",
};

const box = new BoxGeometry(1, 1, 1);

function mat(color: string, roughness = 0.55) {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.08 });
}

function add(group: Group, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotZ = 0) {
  const mesh = new Mesh(box, mat(color));
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.z = rotZ;
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

export function dressPerson(
  group: Group,
  look: Look,
  shop: { color: string; hat: string; owned: string[]; trustOwned: boolean },
) {
  for (const child of [...group.children]) {
    if (child.name === "ring" || child.name === "tag") continue;
    group.remove(child);
  }
  const bought = shop.trustOwned ? shop.owned.includes(`color-${shop.color}`) : shop.color !== "white" && !!SHOP_COLORS[shop.color];
  const outfit = bought && SHOP_COLORS[shop.color] ? SHOP_COLORS[shop.color] : look.colors.outfit;
  const accent = look.colors.accent;
  const skin = look.colors.skin;
  const hair = look.colors.hair;
  add(group, "#1a1c22", 0, 0.28, 0, 0.5, 0.42, 0.34);
  add(group, outfit, 0, 0.9, 0, 0.66, 0.78, 0.4);
  add(group, accent, 0, 1.05, 0.16, 0.28, 0.42, 0.08);
  add(group, skin, 0, 1.58, 0, 0.4, 0.4, 0.4);
  const eyes = look.colors.eyes ?? "#1a1a1a";
  add(group, eyes, -0.08, 1.64, 0.2, 0.07, 0.06, 0.04);
  add(group, eyes, 0.08, 1.64, 0.2, 0.07, 0.06, 0.04);
  if (look.accessories.beard) {
    add(group, hair, 0, 1.42, 0.2, 0.26, 0.14, 0.08);
    add(group, hair, 0, 1.5, 0.2, 0.2, 0.05, 0.05);
  }
  const style = look.accessories.hair;
  if (style === "spiky") {
    add(group, hair, 0, 1.9, 0, 0.12, 0.28, 0.12);
    add(group, hair, -0.14, 1.84, 0, 0.1, 0.22, 0.1, 0.4);
    add(group, hair, 0.14, 1.84, 0, 0.1, 0.22, 0.1, -0.4);
  } else if (style === "long") {
    add(group, hair, 0, 1.78, -0.18, 0.44, 0.2, 0.22);
    add(group, hair, -0.18, 1.35, -0.06, 0.12, 0.55, 0.14);
    add(group, hair, 0.18, 1.35, -0.06, 0.12, 0.55, 0.14);
  } else if (style === "mohawk") {
    add(group, hair, 0, 1.95, 0, 0.1, 0.42, 0.36);
  } else if (style === "curly") {
    add(group, hair, 0, 1.82, 0, 0.5, 0.22, 0.46);
    add(group, hair, -0.18, 1.7, 0.08, 0.16, 0.16, 0.16);
    add(group, hair, 0.18, 1.7, 0.08, 0.16, 0.16, 0.16);
  } else if (style === "side") {
    // Short hair swept to one side (Hsaka).
    add(group, hair, 0.04, 1.84, 0, 0.4, 0.12, 0.42);
    add(group, hair, -0.16, 1.76, 0.1, 0.16, 0.1, 0.2);
  } else if (style === "buzz") {
    add(group, hair, 0, 1.8, 0, 0.42, 0.1, 0.42);
  }
  const hat = shop.hat && shop.hat !== "none" ? shop.hat : look.accessories.hat;
  if (hat === "cap") {
    add(group, "#16181f", 0, 1.86, 0, 0.46, 0.14, 0.46);
    add(group, "#16181f", 0, 1.8, 0.24, 0.36, 0.06, 0.18);
  } else if (hat === "beanie") {
    add(group, accent, 0, 1.86, 0, 0.44, 0.22, 0.44);
  } else if (hat === "hood") {
    add(group, outfit, 0, 1.72, -0.08, 0.52, 0.46, 0.36);
    add(group, outfit, 0, 1.96, 0, 0.5, 0.16, 0.48);
  } else if (hat === "horns") {
    add(group, accent, -0.16, 1.92, 0, 0.08, 0.28, 0.08, 0.35);
    add(group, accent, 0.16, 1.92, 0, 0.08, 0.28, 0.08, -0.35);
    add(group, skin, -0.22, 1.62, 0, 0.1, 0.12, 0.06);
    add(group, skin, 0.22, 1.62, 0, 0.1, 0.12, 0.06);
  } else if (hat === "antenna") {
    add(group, "#9aa3ad", 0, 2.05, 0, 0.06, 0.46, 0.06);
    add(group, "#7ef6ff", 0, 2.32, 0, 0.14, 0.14, 0.14);
  } else if (hat === "crown") {
    add(group, "#e0b33a", 0, 1.9, 0, 0.48, 0.16, 0.48);
    add(group, "#e0b33a", -0.16, 2.08, 0, 0.1, 0.18, 0.1);
    add(group, "#e0b33a", 0, 2.12, 0, 0.1, 0.22, 0.1);
    add(group, "#e0b33a", 0.16, 2.08, 0, 0.1, 0.18, 0.1);
  } else if (hat === "bullcap") {
    // Poor Goat: red cap + big curved grey horns.
    add(group, accent, 0, 1.86, 0, 0.46, 0.14, 0.46);
    add(group, accent, 0, 1.8, 0.24, 0.36, 0.06, 0.18);
    add(group, "#9aa3ad", -0.18, 1.98, 0, 0.08, 0.3, 0.08, 0.35);
    add(group, "#9aa3ad", 0.18, 1.98, 0, 0.08, 0.3, 0.08, -0.35);
  } else if (hat === "chips") {
    // Gainzy: a stack of poker chips balanced on top.
    add(group, "#f4f6fa", 0, 1.83, 0, 0.34, 0.1, 0.34);
    add(group, "#16181f", 0, 1.9, 0, 0.34, 0.07, 0.34);
    add(group, "#c1272d", 0, 1.97, 0, 0.34, 0.07, 0.34);
    add(group, "#f4f6fa", 0, 2.04, 0, 0.3, 0.06, 0.3);
  } else if (hat === "plume") {
    // Kaleo: Roman helmet with a crest.
    add(group, "#d8a04a", 0, 1.86, 0, 0.46, 0.18, 0.46);
    add(group, outfit, 0, 2.02, 0, 0.1, 0.24, 0.42);
    add(group, "#d8a04a", 0, 1.78, 0.24, 0.4, 0.06, 0.06);
  }
  const extra = look.accessories.extra;
  if (extra === "glasses") {
    add(group, "#dbe7ef", -0.1, 1.6, 0.18, 0.12, 0.08, 0.04);
    add(group, "#dbe7ef", 0.1, 1.6, 0.18, 0.12, 0.08, 0.04);
    add(group, "#dbe7ef", 0, 1.6, 0.18, 0.06, 0.03, 0.03);
  } else if (extra === "shades") {
    add(group, "#12141a", 0, 1.6, 0.2, 0.34, 0.1, 0.06);
  } else if (extra === "chain") {
    add(group, "#e0b33a", 0, 1.22, 0.18, 0.36, 0.08, 0.08);
  } else if (extra === "headset") {
    add(group, accent, 0, 1.7, 0, 0.5, 0.06, 0.12);
    add(group, "#22262e", -0.22, 1.58, 0, 0.1, 0.16, 0.12);
    add(group, "#22262e", 0.22, 1.58, 0, 0.1, 0.16, 0.12);
  } else if (extra === "cup") {
    add(group, "#fff6fb", 0.28, 1.05, 0.16, 0.12, 0.16, 0.12);
    add(group, accent, 0.28, 1.16, 0.16, 0.14, 0.04, 0.14);
  } else if (extra === "mic") {
    add(group, "#222", 0.12, 1.35, 0.28, 0.04, 0.28, 0.04);
    add(group, "#111", 0.12, 1.5, 0.36, 0.1, 0.1, 0.1);
  } else if (extra === "mask") {
    add(group, "#101216", 0, 1.52, 0.18, 0.28, 0.16, 0.06);
  } else if (extra === "visor") {
    // Threadguy: rainbow visor shades, from his pixel-ape avatar.
    const stripes = ["#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#af52de"];
    stripes.forEach((color, i) => {
      add(group, color, -0.16 + i * 0.08, 1.6, 0.2, 0.08, 0.1, 0.06);
    });
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
];
