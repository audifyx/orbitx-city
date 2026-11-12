// Wardrobe (style theme, 2026-11-12) — the full wardrobe: outfits, shoes,
// chains, watches, glasses, hairstyles, sold across three stores with
// different price tiers and vibes. City Sol only, no burn, no wallet.
//
// STORAGE (no new DB column — mirrors api/city.js, keep the two in sync):
//   Owned piece:   the CATALOG id itself, e.g. "outfit-leather".
//   Equipped slot: "eq:<kind>:<value>" in the `owned` array, one per kind.
//   Saved fit:     "fit:<url-encoded name>|outfit=v|shoes=v|..." in `owned`.
// The server exposes the parsed result as me.wardrobe; offline the client
// parses wallet.owned with the same helpers below.

export type WardrobeKind = "outfit" | "shoes" | "chain" | "watch" | "glasses" | "hair";

export const WARDROBE_KINDS: WardrobeKind[] = ["outfit", "shoes", "chain", "watch", "glasses", "hair"];

export type WardrobeSlots = Record<WardrobeKind, string>;

export interface SavedFit extends WardrobeSlots {
  name: string;
}

export interface WardrobeState extends WardrobeSlots {
  fits: SavedFit[];
}

export type StoreId = "thrift" | "street" | "designer";

export interface WardrobeItem {
  id: string;
  kind: WardrobeKind;
  name: string;
  value: string;
  price: number;
  store: StoreId;
  blurb: string;
}

export const STORES: { id: StoreId; name: string; tagline: string; range: string }[] = [
  { id: "thrift", name: "Second Orbit", tagline: "Thrift — pre-loved, dirt cheap, real character.", range: "10–45 City Sol" },
  { id: "street", name: "ORBITX Supply", tagline: "Streetwear — fresh drops, mid prices, loud fits.", range: "60–180 City Sol" },
  { id: "designer", name: "AURUM Boutique", tagline: "Designer — gold-standard pieces, serious prices.", range: "220–800 City Sol" },
];

export function storeName(id: StoreId): string {
  return STORES.find((store) => store.id === id)?.name ?? id;
}

// Client mirror of api/city.js CATALOG wardrobe entries — the server is
// the price authority; this list only drives the shop UI and rendering.
// (The clothes-shop piece — Piece 4, separate branch — owns its own
// items; these ids are distinct and do not collide with it.)
export const WARDROBE_CATALOG: WardrobeItem[] = [
  // Thrift — Second Orbit (10-45).
  { id: "outfit-tee", kind: "outfit", name: "Thrift Tee", value: "tee", price: 15, store: "thrift", blurb: "Plain white tee. Clean, honest." },
  { id: "outfit-flannel", kind: "outfit", name: "Flannel Shirt", value: "flannel", price: 25, store: "thrift", blurb: "Red flannel, worn-in soft." },
  { id: "outfit-denim", kind: "outfit", name: "Denim Jacket", value: "denim", price: 45, store: "thrift", blurb: "Blue denim, one careful owner." },
  { id: "shoes-trainers", kind: "shoes", name: "Old Trainers", value: "trainers", price: 20, store: "thrift", blurb: "Grey trainers, plenty of miles left." },
  { id: "shoes-boots", kind: "shoes", name: "Work Boots", value: "boots", price: 35, store: "thrift", blurb: "Brown boots, built to last." },
  { id: "chain-beads", kind: "chain", name: "Bead Necklace", value: "beads", price: 15, store: "thrift", blurb: "Teal + red beads, market-stall classic." },
  { id: "glasses-readers", kind: "glasses", name: "Reading Glasses", value: "readers", price: 20, store: "thrift", blurb: "Thin frames, sharp eyes." },
  { id: "hair-buzz", kind: "hair", name: "Buzz Cut", value: "buzz", price: 10, store: "thrift", blurb: "No fuss, no mercy." },
  { id: "hair-side", kind: "hair", name: "Side Sweep", value: "side", price: 20, store: "thrift", blurb: "Swept to one side, neat." },
  { id: "hair-afro", kind: "hair", name: "Afro", value: "afro", price: 30, store: "thrift", blurb: "Big, bold, beautiful." },
  { id: "hair-bun", kind: "hair", name: "Top Knot", value: "bun", price: 35, store: "thrift", blurb: "Tied up top, out of the way." },
  // Streetwear — ORBITX Supply (60-180).
  { id: "outfit-graphic", kind: "outfit", name: "Graphic Tee", value: "graphic", price: 80, store: "street", blurb: "Cyan graphic tee, plaza-ready." },
  { id: "outfit-hoodie", kind: "outfit", name: "Orbit Hoodie", value: "hoodie", price: 120, store: "street", blurb: "Black hoodie, hood up, world off." },
  { id: "outfit-track", kind: "outfit", name: "Gold Tracksuit", value: "track", price: 150, store: "street", blurb: "Full gold tracksuit. Loud on purpose." },
  { id: "shoes-sneakers", kind: "shoes", name: "Fresh Sneakers", value: "sneakers", price: 90, store: "street", blurb: "White + red sneakers, box-fresh." },
  { id: "shoes-high", kind: "shoes", name: "High-Tops", value: "high", price: 110, store: "street", blurb: "Red high-tops, ankle game strong." },
  { id: "chain-silver", kind: "chain", name: "Silver Chain", value: "silver", price: 100, store: "street", blurb: "Silver chain, catches the light." },
  { id: "chain-gold", kind: "chain", name: "Gold Chain", value: "gold", price: 180, store: "street", blurb: "Gold chain, the OrbitX signature." },
  { id: "watch-digital", kind: "watch", name: "Digital Watch", value: "digital", price: 70, store: "street", blurb: "Chunky digital, always on time." },
  { id: "glasses-shades", kind: "glasses", name: "Shades", value: "shades", price: 90, store: "street", blurb: "Black shades, future so bright." },
  { id: "hair-dreads", kind: "hair", name: "Dreads", value: "dreads", price: 85, store: "street", blurb: "Shoulder dreads, free-flowing." },
  { id: "hair-mohawk", kind: "hair", name: "Mohawk", value: "mohawk", price: 60, store: "street", blurb: "A mohawk that means business." },
  // Designer — AURUM Boutique (220-800).
  { id: "outfit-silk", kind: "outfit", name: "Silk Shirt", value: "silk", price: 300, store: "designer", blurb: "Gold silk, slips like water." },
  { id: "outfit-leather", kind: "outfit", name: "Leather Jacket", value: "leather", price: 450, store: "designer", blurb: "Black leather, gold zip. The one." },
  { id: "outfit-suit", kind: "outfit", name: "Tailored Suit", value: "suit", price: 650, store: "designer", blurb: "Charcoal suit, gold tie. Boardroom energy." },
  { id: "shoes-loafers", kind: "shoes", name: "Leather Loafers", value: "loafers", price: 250, store: "designer", blurb: "Black leather loafers, silent steps." },
  { id: "shoes-gold", kind: "shoes", name: "Gold Kicks", value: "gold", price: 500, store: "designer", blurb: "Solid gold kicks. Yes, really." },
  { id: "chain-diamond", kind: "chain", name: "Diamond Chain", value: "diamond", price: 800, store: "designer", blurb: "Diamond chain + pendant. The grail." },
  { id: "watch-chrono", kind: "watch", name: "Chronograph", value: "chrono", price: 400, store: "designer", blurb: "Silver chrono, Swiss-precise." },
  { id: "watch-gold", kind: "watch", name: "Gold Watch", value: "gold", price: 600, store: "designer", blurb: "Gold watch, heavy in the best way." },
  { id: "glasses-round", kind: "glasses", name: "Designer Rounds", value: "round", price: 220, store: "designer", blurb: "Gold-rim rounds, old money." },
  { id: "glasses-visor", kind: "glasses", name: "Rainbow Visor", value: "visor", price: 280, store: "designer", blurb: "Rainbow visor shades, full spectrum." },
  { id: "hair-fade", kind: "hair", name: "Skin Fade", value: "fade", price: 250, store: "designer", blurb: "Celebrity-stylist skin fade." },
];

export function wardrobeItem(id: string): WardrobeItem | undefined {
  return WARDROBE_CATALOG.find((item) => item.id === id);
}

export function emptySlots(): WardrobeSlots {
  return { outfit: "", shoes: "", chain: "", watch: "", glasses: "", hair: "" };
}

/** Parse an `owned` array into equipped slots + saved fits. */
export function wardrobeFromOwned(owned: string[] | undefined): WardrobeState {
  const slots = emptySlots();
  const fits: SavedFit[] = [];
  if (!Array.isArray(owned)) return { ...slots, fits };
  for (const entry of owned) {
    if (typeof entry !== "string") continue;
    if (entry.startsWith("eq:")) {
      const rest = entry.slice(3);
      const idx = rest.indexOf(":");
      if (idx <= 0) continue;
      const kind = rest.slice(0, idx) as WardrobeKind;
      const value = rest.slice(idx + 1);
      if (WARDROBE_KINDS.includes(kind) && value) slots[kind] = value;
    } else if (entry.startsWith("fit:")) {
      const fit = parseFitEntry(entry);
      if (fit) fits.push(fit);
    }
  }
  return { ...slots, fits };
}

export function parseFitEntry(entry: string): SavedFit | null {
  const body = entry.slice(4);
  const bar = body.indexOf("|");
  const rawName = bar === -1 ? body : body.slice(0, bar);
  let name = "";
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return null;
  }
  if (!name || name.length > 24) return null;
  const fit: SavedFit = { name, ...emptySlots() };
  if (bar !== -1) {
    for (const part of body.slice(bar + 1).split("|")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const kind = part.slice(0, eq) as WardrobeKind;
      const value = part.slice(eq + 1);
      if (WARDROBE_KINDS.includes(kind) && value) fit[kind] = value;
    }
  }
  return fit;
}

export function encodeFitEntry(name: string, slots: WardrobeSlots): string {
  const parts = [`fit:${encodeURIComponent(name)}`];
  for (const kind of WARDROBE_KINDS) {
    if (slots[kind]) parts.push(`${kind}=${slots[kind]}`);
  }
  return parts.join("|");
}

/** Copy of `owned` with slot `kind` set to `value` ("" clears it). */
export function setEquippedOwned(owned: string[], kind: WardrobeKind, value: string): string[] {
  const kept = owned.filter((entry) => typeof entry === "string" && !entry.startsWith(`eq:${kind}:`));
  if (value) kept.push(`eq:${kind}:${value}`);
  return kept;
}

export function removeFitOwned(owned: string[], name: string): string[] {
  return owned.filter((entry) => {
    if (typeof entry !== "string" || !entry.startsWith("fit:")) return true;
    const fit = parseFitEntry(entry);
    return !fit || fit.name !== name;
  });
}

export function fitSummary(fit: SavedFit): string {
  const parts: string[] = [];
  for (const kind of WARDROBE_KINDS) {
    if (!fit[kind]) continue;
    const item = wardrobeItem(`${kind}-${fit[kind]}`);
    parts.push(item ? item.name : fit[kind]);
  }
  return parts.join(" · ") || "Nothing worn";
}

// --- Rendering data (avatar.ts reads these) -------------------------------
// Outfit value -> torso colour + silhouette extra. Colours are hex;
// style adds a visible piece on top of the colour.
export const OUTFIT_DEFS: Record<string, { color: string; style: "plain" | "hoodie" | "leather" | "suit" }> = {
  tee: { color: "#f4f6fa", style: "plain" },
  flannel: { color: "#b03a2e", style: "plain" },
  denim: { color: "#3a6ea5", style: "plain" },
  graphic: { color: "#19c2e6", style: "plain" },
  hoodie: { color: "#16181f", style: "hoodie" },
  track: { color: "#e0b33a", style: "plain" },
  silk: { color: "#e8c85a", style: "plain" },
  leather: { color: "#1b1b1f", style: "leather" },
  suit: { color: "#2c2f36", style: "suit" },
};

export const SHOE_COLORS: Record<string, string> = {
  trainers: "#9aa3ad",
  boots: "#7a5230",
  sneakers: "#f4f6fa",
  high: "#c1272d",
  loafers: "#16181f",
  gold: "#e0b33a",
};

export const CHAIN_COLORS: Record<string, string> = {
  beads: "#7ec8e3",
  silver: "#c0c8d0",
  gold: "#e0b33a",
  diamond: "#f4f6fa",
};

export const WATCH_COLORS: Record<string, string> = {
  digital: "#22262e",
  chrono: "#c0c8d0",
  gold: "#e0b33a",
};

export function kindLabel(kind: WardrobeKind): string {
  return kind === "outfit" ? "Outfit" : kind === "shoes" ? "Shoes" : kind === "chain" ? "Chain" : kind === "watch" ? "Watch" : kind === "glasses" ? "Glasses" : "Hairstyle";
}
