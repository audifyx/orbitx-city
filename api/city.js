import { createHmac, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { ensureDaily, handleLive, noteEarn } from "./live.js";
import { adBuy, adOrdersFor, adQuote, adRemove, adRetryBurn, adStatus } from "./ads.js";
import { authMode, checkReauth, handleAuthOp, looksLikeAccountToken, supabasePublic, verifyAccessToken } from "./auth.js";
import { chainShopEnabled, confirmSend, ensureWallet, exportWallet, networkName, quoteSend, walletView } from "./wallet.js";

const START_BALANCE = 60000;
const BURN_RATE = 0.25;
const PRESENCE_MS = 25000;
const JOB_MS = 4000;

const CATALOG = {
  "color-white": { price: 20, kind: "color", value: "white" },
  "color-gold": { price: 40, kind: "color", value: "gold" },
  "color-cyan": { price: 30, kind: "color", value: "cyan" },
  "color-sunset": { price: 35, kind: "color", value: "sunset" },
  "color-black": { price: 25, kind: "color", value: "black" },
  // Values must be keys of the client's COLORS map (white/gold/cyan/
  // sunset/black/red/silver) or the avatar falls back to white.
  "color-red": { price: 25, kind: "color", value: "red" },
  "color-silver": { price: 30, kind: "color", value: "silver" },
  "car-black": { price: 50, kind: "car", value: "black" },
  "car-white": { price: 50, kind: "car", value: "white" },
  "car-gold": { price: 80, kind: "car", value: "gold" },
  "car-cyan": { price: 60, kind: "car", value: "cyan" },
  "car-red": { price: 55, kind: "car", value: "red" },
  "car-silver": { price: 55, kind: "car", value: "silver" },
  "hat-cap": { price: 15, kind: "hat", value: "cap" },
  "hat-antenna": { price: 25, kind: "hat", value: "antenna" },
  "hat-crown": { price: 100, kind: "hat", value: "crown" },
  // Was value "cap" — a second item granting the same hat as hat-cap.
  // "visor" is its own value; the client renders it as a visor brim
  // (any unknown hat value renders as a crown until it has a branch).
  "hat-visor": { price: 20, kind: "hat", value: "visor" },
  // New hats: each value is distinct and equips as its own hat. The
  // client must add render branches for tophat / beanie / headphones
  // in addHat (today they fall through to the crown mesh).
  "hat-tophat": { price: 60, kind: "hat", value: "tophat" },
  "hat-beanie": { price: 30, kind: "hat", value: "beanie" },
  "hat-headphones": { price: 45, kind: "hat", value: "headphones" },
  // Trails: a glowing ring under the avatar while walking. The grant
  // sets player.trail ("none" by default); the client renders the ring
  // in the bought colour. No other trail values exist.
  "trail-neon": { price: 50, kind: "trail", value: "neon" },
  "trail-gold": { price: 75, kind: "trail", value: "gold" },
  // Clothes (clothes branch): City Sol only, same spend/equip pattern as
  // hats. `slot` is one of shirt / pants / shoes / outfit / glasses and
  // `value` is the look key the client renders in avatar.ts
  // (SHIRT_STYLES / PANTS_COLORS / SHOES_COLORS / OUTFIT_STYLES).
  // Ownership is the item id in `owned`; what is WORN is a marker in the
  // same `owned` array — `worn:<slot>:<value>` — so no new DB column is
  // needed (see equippedClothes / setWorn below). An outfit overrides
  // shirt + pants while worn; unequip clears the marker.
  "clothes-tee-red": { price: 30, kind: "clothes", slot: "shirt", value: "tee-red" },
  "clothes-tee-gold": { price: 35, kind: "clothes", slot: "shirt", value: "tee-gold" },
  "clothes-hoodie-black": { price: 80, kind: "clothes", slot: "shirt", value: "hoodie-black" },
  "clothes-jacket-denim": { price: 120, kind: "clothes", slot: "shirt", value: "jacket-denim" },
  "clothes-jacket-leather": { price: 140, kind: "clothes", slot: "shirt", value: "jacket-leather" },
  "clothes-jeans-blue": { price: 60, kind: "clothes", slot: "pants", value: "jeans-blue" },
  "clothes-pants-black": { price: 55, kind: "clothes", slot: "pants", value: "pants-black" },
  "clothes-shorts-white": { price: 40, kind: "clothes", slot: "pants", value: "shorts-white" },
  "clothes-sneakers-white": { price: 70, kind: "clothes", slot: "shoes", value: "sneakers-white" },
  "clothes-boots-brown": { price: 90, kind: "clothes", slot: "shoes", value: "boots-brown" },
  "clothes-suit-black": { price: 200, kind: "clothes", slot: "outfit", value: "suit-black" },
  "clothes-dress-red": { price: 150, kind: "clothes", slot: "outfit", value: "dress-red" },
  "clothes-tracksuit-gold": { price: 100, kind: "clothes", slot: "outfit", value: "tracksuit-gold" },
  "clothes-sunglasses": { price: 50, kind: "clothes", slot: "glasses", value: "sunglasses" },
  // --- Wardrobe (style theme, 2026-11-12) ---------------------------------
  // Full wardrobe: outfits, shoes, chains, watches, glasses, hairstyles
  // sold across three stores — Thrift ("Second Orbit", 10-60), Streetwear
  // ("ORBITX Supply", 60-200), Designer ("AURUM Boutique", 200-800).
  // City Sol only, NO burn: a wardrobe piece is a purchase, not a burn
  // event (same rule as garage buyCar) — noBurn skips burnOf entirely.
  // Equipping sets an `eq:<kind>:<value>` entry in the player's owned
  // array (see wardrobeFromOwned below); ownership is the CATALOG id
  // itself. No new DB column: everything lives in the existing `owned`
  // TEXT column (JSON array) on the players row + per-server save.
  // Outfits.
  "outfit-tee": { price: 15, kind: "outfit", value: "tee", noBurn: true },
  "outfit-flannel": { price: 25, kind: "outfit", value: "flannel", noBurn: true },
  "outfit-denim": { price: 45, kind: "outfit", value: "denim", noBurn: true },
  "outfit-graphic": { price: 80, kind: "outfit", value: "graphic", noBurn: true },
  "outfit-hoodie": { price: 120, kind: "outfit", value: "hoodie", noBurn: true },
  "outfit-track": { price: 150, kind: "outfit", value: "track", noBurn: true },
  "outfit-silk": { price: 300, kind: "outfit", value: "silk", noBurn: true },
  "outfit-leather": { price: 450, kind: "outfit", value: "leather", noBurn: true },
  "outfit-suit": { price: 650, kind: "outfit", value: "suit", noBurn: true },
  // Shoes.
  "shoes-trainers": { price: 20, kind: "shoes", value: "trainers", noBurn: true },
  "shoes-boots": { price: 35, kind: "shoes", value: "boots", noBurn: true },
  "shoes-sneakers": { price: 90, kind: "shoes", value: "sneakers", noBurn: true },
  "shoes-high": { price: 110, kind: "shoes", value: "high", noBurn: true },
  "shoes-loafers": { price: 250, kind: "shoes", value: "loafers", noBurn: true },
  "shoes-gold": { price: 500, kind: "shoes", value: "gold", noBurn: true },
  // Chains.
  "chain-beads": { price: 15, kind: "chain", value: "beads", noBurn: true },
  "chain-silver": { price: 100, kind: "chain", value: "silver", noBurn: true },
  "chain-gold": { price: 180, kind: "chain", value: "gold", noBurn: true },
  "chain-diamond": { price: 800, kind: "chain", value: "diamond", noBurn: true },
  // Watches.
  "watch-digital": { price: 70, kind: "watch", value: "digital", noBurn: true },
  "watch-chrono": { price: 400, kind: "watch", value: "chrono", noBurn: true },
  "watch-gold": { price: 600, kind: "watch", value: "gold", noBurn: true },
  // Glasses.
  "glasses-readers": { price: 20, kind: "glasses", value: "readers", noBurn: true },
  "glasses-shades": { price: 90, kind: "glasses", value: "shades", noBurn: true },
  "glasses-round": { price: 220, kind: "glasses", value: "round", noBurn: true },
  "glasses-visor": { price: 280, kind: "glasses", value: "visor", noBurn: true },
  // Hairstyles.
  "hair-buzz": { price: 10, kind: "hair", value: "buzz", noBurn: true },
  "hair-side": { price: 20, kind: "hair", value: "side", noBurn: true },
  "hair-afro": { price: 30, kind: "hair", value: "afro", noBurn: true },
  "hair-bun": { price: 35, kind: "hair", value: "bun", noBurn: true },
  "hair-dreads": { price: 85, kind: "hair", value: "dreads", noBurn: true },
  "hair-mohawk": { price: 60, kind: "hair", value: "mohawk", noBurn: true },
  "hair-fade": { price: 250, kind: "hair", value: "fade", noBurn: true },};

// --- Grocery (OrbitX Grocery) -------------------------------------------
// Food catalog: City Sol only, no burn. The server is the price + hunger
// authority; the client mirrors this list for display only.
// Storage: the per-server save's `daily` JSON column — daily.food is the
// inventory ({ itemId: count }) and daily.hunger is 0..100. No new column
// (no DDL): api/live.js ensureDaily() carries both keys across the day
// rollover, so a new day never wipes food or hunger. A missing hunger
// reads as 100 (a full stomach). The client drains hunger (1 point per
// 150s of active play, runtime.ts) and reports it via food-hunger; the
// server never drains on its own, so a paused/away player never starves.
const FOOD_CATALOG = [
  { id: "water", name: "Water", price: 5, hunger: 5, kind: "drink" },
  { id: "chips", name: "Chips", price: 10, hunger: 10, kind: "snack" },
  { id: "soda", name: "Soda", price: 12, hunger: 8, kind: "drink" },
  { id: "donut", name: "Donut", price: 12, hunger: 12, kind: "snack" },
  { id: "fruit", name: "Fruit", price: 15, hunger: 12, kind: "snack" },
  { id: "coffee", name: "Coffee", price: 15, hunger: 8, kind: "drink" },
  { id: "energy-drink", name: "Energy Drink", price: 20, hunger: 10, kind: "drink" },
  { id: "sandwich", name: "Sandwich", price: 30, hunger: 25, kind: "meal" },
  { id: "salad", name: "Salad", price: 35, hunger: 25, kind: "meal" },
  { id: "burger", name: "Burger", price: 40, hunger: 35, kind: "meal" },
  { id: "groceries-bag", name: "Groceries Bag", price: 50, hunger: 30, kind: "meal" },
  { id: "pizza", name: "Pizza", price: 60, hunger: 45, kind: "meal" },
  // Cooking ingredients — sold at OrbitX Grocery, eaten as snacks or
  // cooked into meals (recipes below). hunger = the snack value.
  { id: "bread", name: "Bread", price: 8, hunger: 10, kind: "snack" },
  { id: "patty", name: "Beef Patty", price: 10, hunger: 10, kind: "snack" },
  { id: "dough", name: "Pizza Dough", price: 8, hunger: 8, kind: "snack" },
  { id: "cheese", name: "Cheese", price: 12, hunger: 12, kind: "snack" },
  { id: "greens", name: "Salad Greens", price: 10, hunger: 10, kind: "snack" },
  { id: "dressing", name: "Dressing", price: 6, hunger: 6, kind: "snack" },
  { id: "potato", name: "Potato", price: 8, hunger: 10, kind: "snack" },
  { id: "tomato", name: "Tomato", price: 8, hunger: 10, kind: "snack" },
  { id: "egg", name: "Egg", price: 10, hunger: 12, kind: "snack" },
  { id: "milk", name: "Milk", price: 8, hunger: 8, kind: "snack" },
];
const FOOD_BY_ID = Object.fromEntries(FOOD_CATALOG.map((item) => [item.id, item]));
const HUNGER_MAX = 100;

// Food inventory + hunger on a save's daily blob: unknown item ids and
// non-positive counts are dropped, hunger is clamped 0..100 and defaults
// to full. Mutates save.daily in place (via ensureDaily), so the caller
// just needs saveSave() to persist.
function foodState(save) {
  const daily = ensureDaily(save);
  const raw = daily.food && typeof daily.food === "object" ? daily.food : {};
  const food = {};
  for (const [id, count] of Object.entries(raw)) {
    if (FOOD_BY_ID[id] && Number.isFinite(Number(count)) && Number(count) > 0) food[id] = Math.floor(Number(count));
  }
  daily.food = food;
  daily.hunger = Number.isFinite(Number(daily.hunger))
    ? Math.max(0, Math.min(HUNGER_MAX, Math.round(Number(daily.hunger))))
    : HUNGER_MAX;
  return { food, hunger: daily.hunger };
}

async function foodListOp(save) {
  return { ok: true, catalog: FOOD_CATALOG, food: foodPublic(save), me: publicPlayer(save) };
}

async function foodBuyOp(save, body) {
  const item = FOOD_BY_ID[String(body.id || "")];
  if (!item) return { ok: false, message: "That food is not on the shelf.", status: 400 };
  const qty = Math.floor(Number(body.qty ?? 1));
  if (!Number.isFinite(qty) || qty < 1 || qty > 99) return { ok: false, message: "Buy 1–99 at a time.", status: 400 };
  const cost = item.price * qty;
  if (save.balance < cost) return { ok: false, message: "Not enough City Sol.", status: 400 };
  const { food } = foodState(save);
  // City Sol only: no burn, no burned increment — food is a purchase,
  // not a burn event.
  save.balance -= cost;
  food[item.id] = (food[item.id] || 0) + qty;
  await saveSave(save);
  return {
    ok: true,
    message: qty > 1 ? `Bought ${qty} × ${item.name} for ${cost} City Sol.` : `Bought ${item.name} for ${cost} City Sol.`,
    catalog: FOOD_CATALOG,
    food: foodPublic(save),
    me: publicPlayer(save),
  };
}

async function foodHungerOp(save, body) {
  // Client drain report: the game loop (runtime.ts) is the drain
  // authority — 1 point per 150s of active play. The server only clamps
  // and stores, never drains on its own, so a paused/away player never
  // loses hunger. A report higher than stored (a second tab that just
  // ate, or a stale client) is ignored — hunger only falls through
  // this op; eating goes through food-eat.
  const { hunger } = foodState(save);
  const reported = Math.floor(Number(body.hunger));
  if (!Number.isFinite(reported)) return { ok: false, message: "Bad hunger value.", status: 400 };
  const next = Math.max(0, Math.min(HUNGER_MAX, reported));
  if (next >= hunger) return { ok: true, catalog: FOOD_CATALOG, food: foodPublic(save), me: publicPlayer(save) };
  save.daily.hunger = next;
  await saveSave(save);
  return { ok: true, catalog: FOOD_CATALOG, food: foodPublic(save), me: publicPlayer(save) };
}

// --- Clothes: what the character is wearing ---------------------------
// Storage (no new DB column): ownership is the item id in the `owned`
// string array (players + player_saves, already a JSON/TEXT column);
// what is currently WORN is a marker in the SAME array,
// `worn:<slot>:<value>` (one per slot, e.g. `worn:shirt:tee-red`).
// The client (avatar.ts clothesFromOwned) and publicPlayer /
// sanitizeState all derive the worn outfit from these markers, so the
// equipped clothes survive reload and show on other players too.
const CLOTHES_SLOTS = new Set(["shirt", "pants", "shoes", "outfit", "glasses"]);

function wornMarker(slot, value) {
  return `worn:${slot}:${value}`;
}

function equippedClothes(owned) {
  const list = Array.isArray(owned) ? owned : [];
  const worn = {};
  for (const entry of list) {
    if (typeof entry !== "string" || !entry.startsWith("worn:")) continue;
    const [, slot, value] = entry.split(":");
    if (slot && value && CLOTHES_SLOTS.has(slot)) worn[slot] = value;
  }
  return worn;
}

function setWorn(owned, slot, value) {
  const list = Array.isArray(owned) ? owned : [];
  const kept = list.filter((entry) => !(typeof entry === "string" && entry.startsWith(`worn:${slot}:`)));
  if (value) kept.push(wornMarker(slot, value));
  return kept;
}



const WARDROBE_KINDS = ["outfit", "shoes", "chain", "watch", "glasses", "hair"];

// --- Wardrobe storage (style theme, 2026-11-12) ---------------------------
// NO new DB column: everything lives in the existing `owned` string array
// (TEXT column, JSON array) on the players row, mirrored onto each
// per-server save by syncSaveIdentity (save.owned = player.owned).
//   Owned piece:   the CATALOG id itself, e.g. "outfit-leather".
//   Equipped slot: "eq:<kind>:<value>", e.g. "eq:shoes:sneakers" — one
//     per kind; equipping replaces the old entry for that kind.
//   Saved fit:     "fit:<url-encoded name>|outfit=leather|shoes=...|..."
//     — only non-empty slots are written, so an old fit never forces a
//     slot the player has since sold/unequipped.
// wardrobeFromOwned is the single parser for all three; publicPlayer
// exposes its result as `me.wardrobe` so the client never parses `owned`.
function wardrobeFromOwned(owned) {
  const slots = { outfit: "", shoes: "", chain: "", watch: "", glasses: "", hair: "" };
  const fits = [];
  if (!Array.isArray(owned)) return { ...slots, fits };
  for (const entry of owned) {
    if (typeof entry !== "string") continue;
    if (entry.startsWith("eq:")) {
      const rest = entry.slice(3);
      const idx = rest.indexOf(":");
      if (idx <= 0) continue;
      const kind = rest.slice(0, idx);
      const value = rest.slice(idx + 1);
      if (WARDROBE_KINDS.includes(kind) && value) slots[kind] = value;
    } else if (entry.startsWith("fit:")) {
      const fit = parseFitEntry(entry);
      if (fit) fits.push(fit);
    }
  }
  return { ...slots, fits };
}

function parseFitEntry(entry) {
  // "fit:<url-encoded name>|outfit=v|shoes=v|chain=v|watch=v|glasses=v|hair=v"
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
  const fit = { name, outfit: "", shoes: "", chain: "", watch: "", glasses: "", hair: "" };
  if (bar !== -1) {
    for (const part of body.slice(bar + 1).split("|")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const kind = part.slice(0, eq);
      const value = part.slice(eq + 1);
      if (WARDROBE_KINDS.includes(kind) && value) fit[kind] = value;
    }
  }
  return fit;
}

function encodeFitEntry(name, slots) {
  const parts = [`fit:${encodeURIComponent(name)}`];
  for (const kind of WARDROBE_KINDS) {
    if (slots[kind]) parts.push(`${kind}=${slots[kind]}`);
  }
  return parts.join("|");
}

// Return a copy of `owned` with the equipped slot for `kind` set to
// `value` ("" clears it). Never mutates the input.
function setEquippedOwned(owned, kind, value) {
  const list = Array.isArray(owned) ? [...owned] : [];
  const kept = list.filter((entry) => typeof entry !== "string" || !entry.startsWith(`eq:${kind}:`));
  if (value) kept.push(`eq:${kind}:${value}`);
  return kept;
}

function removeFitOwned(owned, name) {
  const list = Array.isArray(owned) ? [...owned] : [];
  return list.filter((entry) => {
    if (typeof entry !== "string" || !entry.startsWith("fit:")) return true;
    const fit = parseFitEntry(entry);
    return !fit || fit.name !== name;
  });
}
const LOOKS = new Set([
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
]);

const JOBS = {
  courier: 45,
  taxi: 90,
  guide: 60,
  mechanic: 55,
  photographer: 40,
  promoter: 50,
  dock: 65,
  dj: 55,
  banker: 50,
  barista: 45,
  vendor: 55,
  security: 75,
  mail: 70,
  lifeguard: 65,
  cleaner: 55,
  bus: 80,
  fire: 75,
  doctor: 70,
  // Emergency-services jobs (emergency.ts EMERGENCY_JOBS): cop and
  // paramedic go through the existing job-start / earn ops, so the
  // JOB_MS floor and scaledPay streak scaling apply unchanged.
  cop: 85,
  paramedic: 80,
  teacher: 60,
  // Mini-games pay through the same earn op (job-start then earn, same
  // JOB_MS floor): the client only ever starts one of these while no job
  // is active, so they never clobber a job in progress.
  coinhunt: 40,
  fishing: 45,
  shootout: 50,
  treasure: 45,
};

// Payouts scale with the player's job streak: +5% per completed job, up
// to +50% (streak 10). The client shows the scaled pay in the Jobs panel.
function scaledPay(id, streak) {
  const base = JOBS[id];
  if (!base) return 0;
  const mult = 1 + 0.05 * Math.min(Math.max(0, Number(streak || 0)), 10);
  return Math.round(base * mult);
}

// OrbitX Tower offices (floors 2-4). 25 suites: 24 claimable + the
// Founder's Office, which belongs to OrbitX and is never for sale.
// Leases are paid in City Sol only — the game's own money. There is no
// real-money price, no SOL, no ORBITX and no burn for offices; buy+burn
// is ads/banners only. Prices are opening prices: standard (floors 2-3)
// 100/day, 500/week, 1500/month; premium (floor 4) 250/day, 1200/week,
// 3500/month. A new player starts at 60,000 City Sol and jobs pay 40-90,
// so a standard day is affordable on day one and a standard week takes
// a few days of playing.
const OFFICES = [
  { id: "office-f2-a", name: "Suite 2A", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-b", name: "Suite 2B", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-c", name: "Suite 2C", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-d", name: "Suite 2D", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-e", name: "Suite 2E", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-f", name: "Suite 2F", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-g", name: "Suite 2G", floor: 2, tier: "standard", claimable: true },
  { id: "office-f2-h", name: "Suite 2H", floor: 2, tier: "standard", claimable: true },
  { id: "office-f3-a", name: "Suite 3A", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-b", name: "Suite 3B", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-c", name: "Suite 3C", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-d", name: "Suite 3D", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-e", name: "Suite 3E", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-f", name: "Suite 3F", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-g", name: "Suite 3G", floor: 3, tier: "standard", claimable: true },
  { id: "office-f3-h", name: "Suite 3H", floor: 3, tier: "standard", claimable: true },
  { id: "office-f4-founder", name: "Founder's Office", floor: 4, tier: "founder", claimable: false },
  { id: "office-f4-a", name: "Suite 4A", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-b", name: "Suite 4B", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-c", name: "Suite 4C", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-d", name: "Suite 4D", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-e", name: "Suite 4E", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-f", name: "Suite 4F", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-g", name: "Suite 4G", floor: 4, tier: "premium", claimable: true },
  { id: "office-f4-h", name: "Suite 4H", floor: 4, tier: "premium", claimable: true },
];

const OFFICE_PRICES = {
  standard: { 1: 100, 7: 500, 30: 1500 },
  premium: { 1: 250, 7: 1200, 30: 3500 },
};

function officeSuite(id) {
  return OFFICES.find((suite) => suite.id === id) || null;
}

function officePrice(suite, termDays) {
  const table = OFFICE_PRICES[suite.tier];
  if (!table) return 0;
  return table[termDays] || 0;
}

function officeTermLabel(termDays) {
  return termDays === 1 ? "1 day" : termDays === 7 ? "7 days" : "30 days";
}

// --- Universes (multiverse) ----------------------------------------------
// Fixed list of 5 universes, same world in each. Progress lives per
// (player, universe) in player_saves — never shared across universes.
const SERVERS = [1, 2, 3, 4, 5];
const MULTIVERSE_CAP = 150;
const MULTIVERSE_HEARTBEAT_MS = 5 * 60 * 1000;

function isServerId(n) {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

function parseServerId(value) {
  const n = Number(value);
  return isServerId(n) ? n : null;
}

// --- State + district office catalogs ------------------------------------
// State towers (states.ts stateOfficeSuites): 12 suites per state,
// floors 2-4 x A-D, floor 4 premium. Same City Sol lease prices as the HQ,
// so they join the OFFICES table and the HQ office-claim / office-status
// ops read them too (Founder's Office rule stays: office-f4-founder is
// never for sale; state towers have no founder suite).
const STATE_IDS = ["ny", "la", "fl"];
const STATE_OFFICES = [];
for (const state of STATE_IDS) {
  for (const floor of [2, 3, 4]) {
    for (const letter of ["a", "b", "c", "d"]) {
      STATE_OFFICES.push({
        id: `office-${state}-f${floor}-${letter}`,
        name: `Suite ${floor}${letter.toUpperCase()}`,
        floor,
        tier: floor === 4 ? "premium" : "standard",
        claimable: true,
        state,
      });
    }
  }
}
OFFICES.push(...STATE_OFFICES);

// District towers (emergency.ts districtOfficeSuites): 25 suites per
// district — 24 claimable + the district Founder's Office, never for
// sale. These stay OUT of OFFICES: they go through the
// district-office-* ops and their own directory. Same City Sol prices.
const DISTRICT_IDS = ["harbor", "north", "east", "west"];
const DISTRICT_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const DISTRICT_OFFICES = [];
for (const district of DISTRICT_IDS) {
  for (const floor of [2, 3]) {
    for (const letter of DISTRICT_LETTERS) {
      DISTRICT_OFFICES.push({
        id: `office-${district}-f${floor}-${letter}`,
        name: `Suite ${floor}${letter.toUpperCase()}`,
        floor,
        tier: "standard",
        claimable: true,
        district,
      });
    }
  }
  DISTRICT_OFFICES.push({
    id: `office-${district}-f4-founder`,
    name: "Founder's Office",
    floor: 4,
    tier: "founder",
    claimable: false,
    district,
  });
  for (const letter of DISTRICT_LETTERS) {
    DISTRICT_OFFICES.push({
      id: `office-${district}-f4-${letter}`,
      name: `Suite 4${letter.toUpperCase()}`,
      floor: 4,
      tier: "premium",
      claimable: true,
      district,
    });
  }
}

// --- Vehicle catalog (vehicles.ts VEHICLES, mirrored) ---------------------
// api/city.js is plain JS and cannot import the TS catalog, so the price
// list is duplicated here deliberately — the server is the price
// authority; a client-sent price is never trusted. Regenerate from
// vehicles.ts whenever the catalog changes (prices must match VEHICLES).
const VEHICLE_PRICES = {
  "city-compact": 220,
  "city-sedan": 450,
  "city-suv": 900,
  "city-sports": 2800,
  "city-muscle": 2400,
  "city-truck": 1400,
  "city-van": 1100,
  "city-limo": 5200,
  "city-roadster": 1800,
  "tesla-model-3": 1600,
  "tesla-model-y": 1900,
  "tesla-model-s": 3600,
  "tesla-model-x": 4200,
  "tesla-cybertruck": 5200,
  "tesla-cybercab": 4800,
  "tesla-roadster": 20000,
  "fly-skyhopper": 6000,
  "fly-aero": 9500,
  "fly-starlifter": 12000,
  "fly-prop": 8000,
  "fly-jet": 25000,
  "fly-stunt": 12000,
  "fly-heli": 15000,
  "fly-rescue": 20000,
  "fly-blimp": 18000,
  "bike-street": 700,
  "bike-sport": 3200,
  "bike-cruiser": 1800,
  "bike-dirt": 1200,
  "atv-trail": 1500,
  "atv-quad": 2600,
  "board-street": 150,
  "board-long": 350,
  "boat-ferry": 2500
};

const VEHICLE_COLORS = {
  "city-compact": [
    "white",
    "black",
    "silver",
    "red",
    "blue",
    "cyan",
    "gold",
    "green",
    "pink"
  ],
  "city-sedan": [
    "white",
    "black",
    "silver",
    "red",
    "blue",
    "cyan",
    "gold"
  ],
  "city-suv": [
    "white",
    "black",
    "silver",
    "red",
    "blue",
    "cyan",
    "gold",
    "green",
    "orange"
  ],
  "city-sports": [
    "red",
    "black",
    "gold",
    "cyan",
    "purple",
    "white"
  ],
  "city-muscle": [
    "red",
    "black",
    "orange",
    "gold",
    "blue",
    "crimson"
  ],
  "city-truck": [
    "white",
    "black",
    "silver",
    "red",
    "blue",
    "cyan",
    "gold",
    "orange",
    "green"
  ],
  "city-van": [
    "white",
    "black",
    "cyan",
    "gold",
    "blue"
  ],
  "city-limo": [
    "black",
    "white",
    "gold",
    "silver"
  ],
  "city-roadster": [
    "sunset",
    "red",
    "gold",
    "cyan",
    "white",
    "black"
  ],
  "tesla-model-3": [
    "pearl",
    "midnight",
    "quicksilver",
    "stealth",
    "crimson",
    "red",
    "blue",
    "white",
    "black"
  ],
  "tesla-model-y": [
    "pearl",
    "midnight",
    "quicksilver",
    "stealth",
    "crimson",
    "red",
    "blue",
    "white",
    "black"
  ],
  "tesla-model-s": [
    "pearl",
    "midnight",
    "quicksilver",
    "stealth",
    "crimson",
    "red",
    "blue",
    "white",
    "black"
  ],
  "tesla-model-x": [
    "pearl",
    "midnight",
    "quicksilver",
    "stealth",
    "crimson",
    "red",
    "blue",
    "white",
    "black"
  ],
  "tesla-cybertruck": [
    "silver",
    "stealth",
    "black",
    "white"
  ],
  "tesla-cybercab": [
    "gold",
    "silver",
    "black",
    "white"
  ],
  "tesla-roadster": [
    "crimson",
    "black",
    "pearl",
    "silver",
    "red"
  ],
  "fly-skyhopper": [
    "cyan",
    "white",
    "silver",
    "gold",
    "blue"
  ],
  "fly-aero": [
    "silver",
    "black",
    "red",
    "cyan",
    "purple"
  ],
  "fly-starlifter": [
    "gold",
    "white",
    "black",
    "cyan"
  ],
  "fly-prop": [
    "white",
    "red",
    "blue",
    "gold"
  ],
  "fly-jet": [
    "white",
    "silver",
    "black",
    "midnight"
  ],
  "fly-stunt": [
    "red",
    "sunset",
    "lime",
    "white"
  ],
  "fly-heli": [
    "white",
    "red",
    "blue",
    "black"
  ],
  "fly-rescue": [
    "red",
    "white",
    "orange"
  ],
  "fly-blimp": [
    "white",
    "gold",
    "silver",
    "blue"
  ],
  "bike-street": [
    "red",
    "black",
    "cyan",
    "gold",
    "blue"
  ],
  "bike-sport": [
    "blue",
    "red",
    "black",
    "lime",
    "white"
  ],
  "bike-cruiser": [
    "black",
    "crimson",
    "silver",
    "gold"
  ],
  "bike-dirt": [
    "orange",
    "lime",
    "red",
    "blue",
    "white"
  ],
  "atv-trail": [
    "green",
    "red",
    "black",
    "orange",
    "cyan"
  ],
  "atv-quad": [
    "orange",
    "black",
    "red",
    "lime",
    "blue"
  ],
  "board-street": [
    "black",
    "red",
    "cyan",
    "gold",
    "purple"
  ],
  "board-long": [
    "sunset",
    "cyan",
    "lime",
    "black",
    "pink"
  ],
  "boat-ferry": [
    "white",
    "cyan",
    "blue",
    "gold",
    "red",
    "black"
  ]
};

const VEHICLE_DEFAULT_COLORS = {
  "city-compact": "cyan",
  "city-sedan": "black",
  "city-suv": "white",
  "city-sports": "red",
  "city-muscle": "crimson",
  "city-truck": "blue",
  "city-van": "white",
  "city-limo": "black",
  "city-roadster": "sunset",
  "tesla-model-3": "pearl",
  "tesla-model-y": "quicksilver",
  "tesla-model-s": "midnight",
  "tesla-model-x": "stealth",
  "tesla-cybertruck": "silver",
  "tesla-cybercab": "gold",
  "tesla-roadster": "crimson",
  "fly-skyhopper": "cyan",
  "fly-aero": "silver",
  "fly-starlifter": "gold",
  "fly-prop": "white",
  "fly-jet": "white",
  "fly-stunt": "red",
  "fly-heli": "white",
  "fly-rescue": "red",
  "fly-blimp": "white",
  "bike-street": "red",
  "bike-sport": "blue",
  "bike-cruiser": "black",
  "bike-dirt": "orange",
  "atv-trail": "green",
  "atv-quad": "orange",
  "board-street": "black",
  "board-long": "sunset",
  "boat-ferry": "white"
};

const VEHICLE_NAMES = {
  "city-compact": "Orbit Compact",
  "city-sedan": "Orbit Sedan",
  "city-suv": "Orbit Ridge SUV",
  "city-sports": "Orbit Falcon GT",
  "city-muscle": "Orbit Thunder V8",
  "city-truck": "Orbit Hauler",
  "city-van": "Orbit Metro Van",
  "city-limo": "Orbit Grand Limo",
  "city-roadster": "Orbit Sunset Roadster",
  "tesla-model-3": "Tesla Model 3",
  "tesla-model-y": "Tesla Model Y",
  "tesla-model-s": "Tesla Model S",
  "tesla-model-x": "Tesla Model X",
  "tesla-cybertruck": "Tesla Cybertruck",
  "tesla-cybercab": "Tesla Cybercab",
  "tesla-roadster": "Tesla Roadster (2026)",
  "fly-skyhopper": "Skyhopper",
  "fly-aero": "Aero Coupe",
  "fly-starlifter": "Orbit Starlifter",
  "fly-prop": "Orbit Prop Plane",
  "fly-jet": "Orbit Jet",
  "fly-stunt": "Orbit Stunt Plane",
  "fly-heli": "Orbit Heli",
  "fly-rescue": "Orbit Rescue Heli",
  "fly-blimp": "Orbit Blimp",
  "bike-street": "Street Comet 250",
  "bike-sport": "Apex R1 Sportbike",
  "bike-cruiser": "Highway King Cruiser",
  "bike-dirt": "Trailblazer Dirt Bike",
  "atv-trail": "Trail Boss ATV",
  "atv-quad": "Mud King 4x4",
  "board-street": "Orbit Deck",
  "board-long": "Cruiser Longboard",
  "boat-ferry": "Orbit Ferry"
};

// --- Home furniture (furniture shop + Edit Home) ------------------------
// City Sol only, no burn. Catalog mirrors web/src/game/runtime.ts
// FURNITURE_CATALOG — the server is the price authority. Placed pieces
// live inside the per-server save's homes JSON (no new column):
//   save.homes.furniture     = { [homeId]: [{ id, item, x, z, rot }] }
//   save.homes.furnitureOwned = [itemId, ...] (one entry per owned copy)
// A placed piece consumes one owned copy: furniture-save rejects a list
// that places more copies of an item than the player owns.
const FURNITURE_CATALOG = {
  tv: { name: "OrbitX TV", price: 450 },
  couch: { name: "Sofa", price: 600 },
  bed: { name: "Double Bed", price: 750 },
  "dining-table": { name: "Dining Table", price: 320 },
  chair: { name: "Chair", price: 120 },
  lamp: { name: "Floor Lamp", price: 90 },
  rug: { name: "Rug", price: 150 },
  shelf: { name: "Shelf", price: 260 },
  plant: { name: "Potted Plant", price: 80 },
  kitchen: { name: "Kitchen Set", price: 800 },
  desk: { name: "Desk", price: 340 },
  armchair: { name: "Armchair", price: 290 },
  "coffee-table": { name: "Coffee Table", price: 210 },
  "tv-stand": { name: "TV Stand", price: 180 },
};
const FURNITURE_MAX_PER_HOME = 40;

function furnitureCatalogPublic() {
  return Object.entries(FURNITURE_CATALOG).map(([id, item]) => ({ id, name: item.name, price: item.price }));
}

function sanitizeFurniturePlaced(list) {
  if (!Array.isArray(list)) return [];
  const clamp = (v) => Math.max(-400, Math.min(400, Number(v) || 0));
  return list
    .filter((p) => p && FURNITURE_CATALOG[p.item] && typeof p.id === "string" && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z)) && Number.isFinite(Number(p.rot)))
    .slice(0, FURNITURE_MAX_PER_HOME)
    .map((p) => ({ id: String(p.id).slice(0, 32), item: String(p.item), x: clamp(p.x), z: clamp(p.z), rot: Number(p.rot) || 0 }));
}

function sanitizeFurnitureOwned(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((id) => FURNITURE_CATALOG[id]).map((id) => String(id));
}

function sanitizeFurnitureMap(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const [homeId, list] of Object.entries(raw)) {
      out[String(homeId)] = sanitizeFurniturePlaced(list);
    }
  }
  return out;
}
// --- Car customization / wear / garage upgrades (vehicles.ts, mirrored) --
// Same rule as the vehicle catalog: duplicated from the TS source, the
// server is the price authority — a client-sent price is never trusted.
// Regenerate from vehicles.ts whenever the CARS prices change.
const CUSTOM_PAINT_PRICE = 150;
const CUSTOM_PAINTS = {
  "matte-black": 1, chrome: 1, "rose-gold": 1, "pearl-pink": 1,
  mint: 1, "midnight-purple": 1, lava: 1, ice: 1,
};
const RIM_PRICES = { stock: 0, sport: 200, chrome: 250, gold: 300, black: 150 };
const SPOILER_PRICES = { none: 0, lip: 180, gt: 320, drag: 450, delete: 0 };
const NEON_COLORS = ["cyan", "pink", "gold", "green", "purple", "red"];
const NEON_PRICE = 220;
const TINT_PRICES = [0, 80, 140, 200];
const ENGINE_PRICES = [0, 600, 1400, 2600];
const TIRE_PRICES = [0, 350, 800];
// Garage upgrades live INSIDE the per-server homes JSON (save.homes.garage
// = { slots, workshop, showroom }) — no new DB column: homes is already a
// TEXT JSON column on player_saves and parseSave/rowFromSave round-trip
// it. Per-home, per-server by construction.
const GARAGE_BASE_SLOTS = 3;
const GARAGE_SLOT_PRICES = [800, 1800, 3200];
const GARAGE_WORKSHOP_PRICE = 1500;
const GARAGE_SHOWROOM_PRICE = 2500;
// A home workshop does your own work: 25% off wash + repair, and it
// unlocks the advanced tuning (Stage 3 engine, Race tires).
const WORKSHOP_DISCOUNT = 0.25;

// --- Home catalog (homes.ts HOMES, mirrored) ------------------------------
// Same rule as vehicles: duplicated from the TS catalog, server is the
// authority. Regenerate from homes.ts whenever the catalog changes
// (seed 1 is canonical; prices must match HOMES).
const HOME_PRICES = {
  "home-ny-01": 2300,
  "home-ny-02": 2090,
  "home-ny-03": 2990,
  "home-ny-04": 2260,
  "home-ny-05": 2400,
  "home-ny-06": 2820,
  "home-ny-07": 2540,
  "home-ny-08": 2050,
  "home-ny-09": 2760,
  "home-ny-10": 2210,
  "home-ny-11": 2090,
  "home-ny-12": 2990,
  "home-ny-13": 2490,
  "home-ny-14": 3680,
  "home-ny-15": 5800,
  "home-ny-16": 4060,
  "home-ny-17": 3600,
  "home-ny-18": 5110,
  "home-ny-19": 3890,
  "home-ny-20": 3750,
  "home-ny-21": 5160,
  "home-ny-22": 4560,
  "home-ny-23": 4220,
  "home-ny-24": 5700,
  "home-ny-25": 4600,
  "home-ny-26": 3750,
  "home-ny-27": 3390,
  "home-ny-28": 2670,
  "home-ny-29": 2250,
  "home-ny-30": 3030,
  "home-ny-31": 2510,
  "home-ny-32": 2590,
  "home-ny-33": 3130,
  "home-ny-34": 2750,
  "home-ny-35": 2470,
  "home-ny-36": 3360,
  "home-ny-37": 2690,
  "home-ny-38": 2590,
  "home-ny-39": 2450,
  "home-ny-40": 2350,
  "home-ny-41": 2850,
  "home-ny-42": 2140,
  "home-ny-43": 2090,
  "home-ny-44": 2870,
  "home-ny-45": 2590,
  "home-ny-46": 2240,
  "home-ny-47": 2870,
  "home-ny-48": 2300,
  "home-ny-49": 2270,
  "home-ny-50": 2930,
  "home-la-01": 2910,
  "home-la-02": 2510,
  "home-la-03": 3840,
  "home-la-04": 2610,
  "home-la-05": 2720,
  "home-la-06": 4280,
  "home-la-07": 2960,
  "home-la-08": 2530,
  "home-la-09": 3600,
  "home-la-10": 2580,
  "home-la-11": 2590,
  "home-la-12": 4000,
  "home-la-13": 2770,
  "home-la-14": 2180,
  "home-la-15": 3270,
  "home-la-16": 2490,
  "home-la-17": 2050,
  "home-la-18": 3200,
  "home-la-19": 2150,
  "home-la-20": 2000,
  "home-la-21": 3270,
  "home-la-22": 2190,
  "home-la-23": 2270,
  "home-la-24": 3230,
  "home-la-25": 2290,
  "home-la-26": 2310,
  "home-la-27": 4460,
  "home-la-28": 3060,
  "home-la-29": 2950,
  "home-la-30": 4200,
  "home-la-31": 2850,
  "home-la-32": 2570,
  "home-la-33": 4630,
  "home-la-34": 3150,
  "home-la-35": 2890,
  "home-la-36": 4680,
  "home-la-37": 3150,
  "home-la-38": 3060,
  "home-la-39": 4160,
  "home-la-40": 3720,
  "home-la-41": 5350,
  "home-la-42": 4280,
  "home-la-43": 3560,
  "home-la-44": 6120,
  "home-la-45": 4240,
  "home-la-46": 4040,
  "home-la-47": 6060,
  "home-la-48": 4320,
  "home-la-49": 3600,
  "home-la-50": 5820,
  "home-fl-01": 1290,
  "home-fl-02": 3040,
  "home-fl-03": 2590,
  "home-fl-04": 1250,
  "home-fl-05": 3560,
  "home-fl-06": 2530,
  "home-fl-07": 1250,
  "home-fl-08": 2970,
  "home-fl-09": 2610,
  "home-fl-10": 1420,
  "home-fl-11": 3270,
  "home-fl-12": 2720,
  "home-fl-13": 1300,
  "home-fl-14": 3310,
  "home-fl-15": 3090,
  "home-fl-16": 1390,
  "home-fl-17": 3680,
  "home-fl-18": 3000,
  "home-fl-19": 1620,
  "home-fl-20": 3420,
  "home-fl-21": 2760,
  "home-fl-22": 1500,
  "home-fl-23": 3570,
  "home-fl-24": 2730,
  "home-fl-25": 1600,
  "home-fl-26": 3750,
  "home-fl-27": 3780,
  "home-fl-28": 1740,
  "home-fl-29": 4900,
  "home-fl-30": 3780,
  "home-fl-31": 1720,
  "home-fl-32": 4490,
  "home-fl-33": 3780,
  "home-fl-34": 1680,
  "home-fl-35": 4270,
  "home-fl-36": 3270,
  "home-fl-37": 1770,
  "home-fl-38": 4490,
  "home-fl-39": 2590,
  "home-fl-40": 6060,
  "home-fl-41": 5350,
  "home-fl-42": 2290,
  "home-fl-43": 6310,
  "home-fl-44": 4850,
  "home-fl-45": 2340,
  "home-fl-46": 6430,
  "home-fl-47": 4950,
  "home-fl-48": 2240,
  "home-fl-49": 5640,
  "home-fl-50": 4900
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function officeEndISO(start, termDays) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + termDays);
  return date.toISOString().slice(0, 10);
}

// City tour — CANONICAL pay schedule, per step, in order:
// plaza 15, shop 20, cafe 20, hall 25, tower 30, dock 80. The SERVER is
// the authority: the client/offline tour must pay this exact schedule,
// never a flat 20/step. Do not change these amounts to match the client.
const MISSIONS = [
  { id: "plaza", pay: 15 },
  { id: "shop", pay: 20 },
  { id: "cafe", pay: 20 },
  { id: "hall", pay: 25 },
  { id: "tower", pay: 30 },
  { id: "dock", pay: 80 },
];

// --- Mission chain (separate from the tour above) ------------------------
// Six missions, played in chain order: a mission unlocks only when the
// previous one is done. Every mission has real steps and a City Sol
// reward that pays through the server on the final step (op
// "mission-step"). Rewards are per-server: they land in the save for the
// player's current universe, never the global players row.
// Step kinds — how the server checks each one:
//   visit: client-attested, body.place must equal the step's place
//          (same trust model as the tour — the server enforces order,
//          a 3s step cooldown, and one-time completion).
//   job:   VERIFIED — player.jobStreak must have advanced since the
//          mission started (snapshot taken when progress is created).
//   daily: VERIFIED — the daily reward must be claimed
//          (ensureDaily(player).claimed).
//   buy:   VERIFIED — player.owned must have grown since the mission
//          started (snapshot taken when progress is created).
//   chat / drive: client-attested (no server-side position/chat log to
//          check cheaply); order + cooldown + one-time still enforced.
// Total chain payout: 50 + 100 + 80 + 120 + 150 + 300 = 800 City Sol.
const MISSION_CHAIN = [
  {
    id: "welcome",
    name: "New in Town",
    desc: "Find your feet in OrbitX City.",
    reward: 50,
    steps: [
      { kind: "visit", place: "plaza", label: "Visit the Plaza" },
      { kind: "visit", place: "shop", label: "Visit the OrbitX Shop" },
      { kind: "chat", label: "Say hello in chat" },
    ],
  },
  {
    id: "first-job",
    name: "First Shift",
    desc: "Work the city and get paid.",
    reward: 100,
    steps: [
      { kind: "job", label: "Complete a job" },
      { kind: "job", label: "Complete a second job" },
      { kind: "daily", label: "Claim your daily reward" },
    ],
  },
  {
    id: "fresh-fit",
    name: "Fresh Fit",
    desc: "Look the part, then show it off.",
    reward: 80,
    steps: [
      { kind: "visit", place: "shop", label: "Visit the OrbitX Shop" },
      { kind: "buy", label: "Buy any item from the shop" },
      { kind: "visit", place: "cafe", label: "Visit Cafe Nova" },
    ],
  },
  {
    id: "sunday-drive",
    name: "Sunday Drive",
    desc: "See the city from the driver's seat.",
    reward: 120,
    steps: [
      { kind: "drive", label: "Take a car for a drive" },
      { kind: "visit", place: "tower", label: "Visit the OrbitX Tower" },
      { kind: "visit", place: "dock", label: "Visit the Harbor" },
    ],
  },
  {
    id: "city-social",
    name: "City Social",
    desc: "Meet the city, then meet it again.",
    reward: 150,
    steps: [
      { kind: "chat", label: "Say hello in chat" },
      { kind: "visit", place: "hall", label: "Visit the Community Hall" },
      { kind: "visit", place: "market", label: "Visit the Night Market" },
    ],
  },
  {
    id: "city-mogul",
    name: "City Mogul",
    desc: "The full loop: buy, work, collect.",
    reward: 300,
    steps: [
      { kind: "buy", label: "Buy any item from the shop" },
      { kind: "job", label: "Complete a job" },
      { kind: "daily", label: "Claim your daily reward" },
    ],
  },
];

function missionById(id) {
  return MISSION_CHAIN.find((mission) => mission.id === id) || null;
}

// Progress for one mission, stored per (player, universe) on the save
// (save.missions[missionId]). Snapshots are taken when progress is first
// created so job/buy steps count only work done after the mission began.
function missionProgress(save, player, mission) {
  if (!save.missions || typeof save.missions !== "object") save.missions = {};
  let progress = save.missions[mission.id];
  if (!progress || typeof progress !== "object") {
    progress = {
      step: 0,
      done: false,
      at: 0,
      streak: Number(player.jobStreak || 0),
      owned: Array.isArray(player.owned) ? player.owned.length : 0,
    };
    save.missions[mission.id] = progress;
  }
  return progress;
}

function missionPublic(mission, progress, unlocked) {
  return {
    id: mission.id,
    name: mission.name,
    desc: mission.desc,
    reward: mission.reward,
    steps: mission.steps.map((step) => step.label),
    step: Number(progress?.step || 0),
    done: !!progress?.done,
    unlocked,
  };
}

const LOBBIES = [
  { id: "nearby", name: "Nearby (proximity)" },
  { id: "plaza", name: "Plaza" },
  { id: "district", name: "Project District" },
  { id: "hq-0", name: "OrbitX HQ" },
  { id: "hq-1", name: "Your Project" },
  { id: "hq-2", name: "North Star" },
  { id: "hq-3", name: "Lumen Labs" },
  { id: "hall", name: "Community Hall" },
  { id: "cafe", name: "Cafe Nova" },
    { id: "shop", name: "OrbitX Shop" },
    { id: "bank", name: "OrbitX Bank" },
    { id: "garage", name: "Hover Garage" },
    { id: "arcade", name: "Neon Arcade" },
    { id: "market", name: "Night Market" },
    { id: "dock", name: "Harbor" },
];

function memory() {
  const slot = globalThis;
  if (!slot.__orbitx) {
    slot.__orbitx = {
      players: new Map(),
      tokens: new Map(),
      world: new Map(),
      chat: [],
      bookings: new Map(),
      officeClaims: new Map(),
      saves: new Map(),
      events: [],
      signals: [],
      parties: new Map(),
      ready: false,
    };
  }
  return slot.__orbitx;
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function redisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return url && token ? { url, token } : null;
}

function db() {
  const url = databaseUrl();
  if (!url) return null;
  const slot = globalThis;
  if (!slot.__orbitxSql) slot.__orbitxSql = neon(url);
  return slot.__orbitxSql;
}

function supabaseEnv() {
  // Vercel's Supabase Marketplace integration injects the same values under
  // STORAGE_* names; the SUPABASE_* names are the documented ones. Read both.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.STORAGE_SUPABASE_URL || process.env.NEXT_PUBLIC_STORAGE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY || process.env.STORAGE_SUPABASE_SECRET_KEY || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.STORAGE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_STORAGE_SUPABASE_ANON_KEY || "";
  return url && key ? { url, key, anon } : null;
}

function sb() {
  const env = supabaseEnv();
  if (!env) return null;
  const slot = globalThis;
  if (!slot.__orbitxSb) {
    slot.__orbitxSb = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  slot.__orbitxSbClient = slot.__orbitxSb;
  return slot.__orbitxSb;
}

function publicRealtime() {
  const env = supabaseEnv();
  if (!env?.anon) return null;
  return { url: env.url, anon: env.anon };
}

function redis() {
  const env = redisEnv();
  if (!env) return null;
  const slot = globalThis;
  if (!slot.__orbitxRedis) slot.__orbitxRedis = new Redis(env);
  return slot.__orbitxRedis;
}

async function ensureSchema() {
  const sql = db();
  const store = memory();
  if (!sql || store.ready) return;
  await sql`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    balance INTEGER NOT NULL,
    burned INTEGER NOT NULL,
    owned TEXT NOT NULL,
    color TEXT NOT NULL,
    hat TEXT NOT NULL,
    car TEXT NOT NULL,
    friends TEXT NOT NULL,
    inbox TEXT NOT NULL,
    job TEXT NOT NULL,
    party TEXT NOT NULL,
    look TEXT NOT NULL DEFAULT 'tjr'
  )`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS look TEXT NOT NULL DEFAULT 'tjr'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS job_streak INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS business TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS rent TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS home_server INTEGER`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS trail TEXT NOT NULL DEFAULT 'none'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS earned INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_race INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_hover INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS wallet TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS holder BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS auth_user TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''`;
  // Lots are ownable once per universe: (id, server_id) is the key, so
  // the same lot can be owned on Universe 1 and Universe 2 independently.
  // Existing rows keep server_id = 1 (bought pre-multiverse).
  await sql`CREATE TABLE IF NOT EXISTS properties (
    id TEXT NOT NULL,
    server_id INTEGER NOT NULL DEFAULT 1,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    furniture TEXT NOT NULL,
    PRIMARY KEY (id, server_id)
  )`;
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS server_id INTEGER NOT NULL DEFAULT 1`;
  // Re-key a pre-multiverse properties table (PK was id alone). Best
  // effort: a Neon that never had the table, or one already keyed, must
  // not break boot. Supabase is re-keyed by the one-off migration.
  try {
    await sql`ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_pkey`;
    await sql`ALTER TABLE properties ADD PRIMARY KEY (id, server_id)`;
  } catch {
    // Already keyed, or the live table is owned by Supabase — the
    // in-memory lots still work for this process.
  }
  await sql`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    author TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    text TEXT NOT NULL,
    start TEXT NOT NULL,
    until TEXT NOT NULL,
    burned INTEGER NOT NULL
  )`;
  // Tower office leases, paid in City Sol only. One row per suite (the
  // suite id is the key), so a suite can hold exactly one active claim.
  // No SOL, no ORBITX, no burn anywhere in this table — buy+burn is
  // ads/banners only.
  // Office leases are claimable once per universe: (suite, server_id)
  // is the key. HQ suites and district suites share this one table,
  // distinguished by suite id prefix. Existing rows keep server_id = 1.
  await sql`CREATE TABLE IF NOT EXISTS office_claims (
    suite TEXT NOT NULL,
    server_id INTEGER NOT NULL DEFAULT 1,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    project TEXT NOT NULL,
    logo TEXT NOT NULL,
    site TEXT NOT NULL,
    term_days INTEGER NOT NULL,
    start TEXT NOT NULL,
    until TEXT NOT NULL,
    price INTEGER NOT NULL,
    claimed_at TEXT NOT NULL,
    PRIMARY KEY (suite, server_id)
  )`;
  await sql`ALTER TABLE office_claims ADD COLUMN IF NOT EXISTS server_id INTEGER NOT NULL DEFAULT 1`;
  // Re-key a pre-multiverse office_claims table (PK was suite alone).
  // Best effort, same as properties above.
  try {
    await sql`ALTER TABLE office_claims DROP CONSTRAINT IF EXISTS office_claims_pkey`;
    await sql`ALTER TABLE office_claims ADD PRIMARY KEY (suite, server_id)`;
  } catch {
    // Already keyed, or the live table is owned by Supabase.
  }
  // One save row per (player, universe). Same columns as the Supabase
  // player_saves table — progress lives here, keyed by player + server.
  // Identity (id, token, name, home_server) stays on players.
  await sql`CREATE TABLE IF NOT EXISTS player_saves (
    player_id TEXT NOT NULL,
    server_id INTEGER NOT NULL,
    balance INTEGER NOT NULL DEFAULT 60000,
    burned INTEGER NOT NULL DEFAULT 0,
    owned TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '',
    hat TEXT NOT NULL DEFAULT '',
    car TEXT NOT NULL DEFAULT '',
    look TEXT NOT NULL DEFAULT 'tjr',
    job TEXT NOT NULL DEFAULT '{}',
    job_streak INTEGER NOT NULL DEFAULT 0,
    business TEXT NOT NULL DEFAULT '{}',
    rent TEXT NOT NULL DEFAULT '{}',
    earned INTEGER NOT NULL DEFAULT 0,
    best_race INTEGER NOT NULL DEFAULT 0,
    best_hover INTEGER NOT NULL DEFAULT 0,
    daily TEXT NOT NULL DEFAULT '{}',
    mission INTEGER NOT NULL DEFAULT 0,
    mission_at INTEGER NOT NULL DEFAULT 0,
    missions TEXT NOT NULL DEFAULT '{}',
    trail TEXT NOT NULL DEFAULT 'none',
    homes TEXT NOT NULL DEFAULT '{"homeServer":0,"homes":[]}',
    vehicles TEXT NOT NULL DEFAULT '[]',
    active_vehicle TEXT NOT NULL DEFAULT '',
    rental TEXT NOT NULL DEFAULT 'null',
    last_seen BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, server_id)
  )`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS missions TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS trail TEXT NOT NULL DEFAULT 'none'`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS homes TEXT NOT NULL DEFAULT '{"homeServer":0,"homes":[]}'`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS vehicles TEXT NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS active_vehicle TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS rental TEXT NOT NULL DEFAULT 'null'`;
  await sql`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS last_seen BIGINT NOT NULL DEFAULT 0`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    where_at TEXT NOT NULL,
    when_at TEXT NOT NULL,
    detail TEXT NOT NULL
  )`;
  store.ready = true;
}

function freshPlayer(id, name) {
  return {
    id,
    token: randomBytes(24).toString("hex"),
    name: String(name || `Guest ${100 + Math.floor(Math.random() * 900)}`).slice(0, 18),
    balance: START_BALANCE,
    burned: 0,
    owned: [],
    color: "white",
    hat: "none",
    car: "black",
    trail: "none",
    friends: [],
    inbox: [],
    job: null,
    jobStreak: 0,
    business: null,
    rent: {},
    // Per-server progress lives on the save (player_saves), but the player
    // object carries the same shape so publicPlayer works for both the
    // identity row and a save. These are NOT persisted to the players
    // table — saves are the authority for them.
    homes: { homeServer: 0, homes: [] },
    vehicles: [],
    activeVehicle: null,
    // GTA garage rental — at most one live rental per save; null when
    // none. { id, color, days, expiresAt } — see sanitizeRental.
    rental: null,
    // Identity-level pointer: the universe where the player made their
    // home (players.home_server). Null = no home yet; latest home wins.
    homeServer: null,
    party: "",
    mission: 0,
    missionAt: 0,
    missions: {},
    look: "tjr",
    earned: 0,
    bestRace: 0,
    bestHover: 0,
    daily: null,
    wallet: "",
    holder: false,
    email: "",
    avatar: "",
    provider: "",
    authUser: "",
    address: "",
  };
}

function sanitizeOwnedHome(home) {
  // Only the fields the client needs to render an owned home — never
  // leak anything else from the stored record.
  const crazy = sanitizeCrazy(home?.crazy);
  return {
    homeId: String(home?.homeId || ""),
    server: Number(home?.server || 0),
    ownerId: String(home?.ownerId || ""),
    ownerName: String(home?.ownerName || ""),
    price: Number(home?.price || 0),
    boughtAt: Number(home?.boughtAt || 0),
    // Crib tiers (apartment → house → mansion → penthouse) live on the
    // owned record when the crib builder ships them; the rooftop op reads
    // this. Pass it through verbatim so the client can gate on it.
    tier: typeof home?.tier === "string" ? home.tier : "",
    // CRAZY extras (pool / theater / rooftop / plants / season decor) —
    // stored on the owned home inside the existing `homes` JSON column,
    // per (player, server). City Sol only, no new DB column.
    crazy,
  };
}

function sanitizeHomes(homes) {
  const list = Array.isArray(homes?.homes) ? homes.homes : [];
  // Season override for the CRAZY season system: "auto" (date-driven)
  // or one of winter / halloween / spring / summer, stored on the same
  // `homes` JSON object. The client reads it off `me.homes.season`.
  const season = typeof homes?.season === "string" && CRAZY_SEASONS.includes(homes.season) ? homes.season : "auto";
  return {
    homeServer: Number(homes?.homeServer || 0),
    homes: list.map(sanitizeOwnedHome),
    furniture: sanitizeFurnitureMap(homes?.furniture),
    furnitureOwned: sanitizeFurnitureOwned(homes?.furnitureOwned),
    garage: sanitizeGarage(homes?.garage),
    season,
  };
}

// --- CARS: per-vehicle mods / wear / garage upgrades ----------------------
// Mirrors of the vehicles.ts helpers — the server re-validates everything
// the client sends, so the rules live here too (prices above).
const DEFAULT_MODS = { rims: "stock", spoiler: "none", neon: null, tint: 0, engine: 0, tires: 0 };
const DEFAULT_GARAGE_UPGRADES = { slots: 0, workshop: false, showroom: false };

function normalizeMods(mods) {
  const m = mods && typeof mods === "object" ? mods : {};
  return {
    rims: m.rims in RIM_PRICES ? m.rims : "stock",
    spoiler: m.spoiler in SPOILER_PRICES ? m.spoiler : "none",
    neon: typeof m.neon === "string" && NEON_COLORS.includes(m.neon) ? m.neon : null,
    tint: Number.isFinite(m.tint) ? Math.max(0, Math.min(3, Math.floor(m.tint))) : 0,
    engine: Number.isFinite(m.engine) ? Math.max(0, Math.min(3, Math.floor(m.engine))) : 0,
    tires: Number.isFinite(m.tires) ? Math.max(0, Math.min(2, Math.floor(m.tires))) : 0,
  };
}

function normalizeWear(wear) {
  const clamp = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);
  return { dirt: clamp(wear?.dirt), damage: clamp(wear?.damage) };
}

function normalizeGarage(g) {
  const x = g && typeof g === "object" ? g : {};
  return {
    slots: Number.isFinite(x.slots) ? Math.max(0, Math.min(3, Math.floor(x.slots))) : 0,
    workshop: !!x.workshop,
    showroom: !!x.showroom,
  };
}

function sanitizeGarage(g) {
  return normalizeGarage(g);
}

/** The garage upgrades on a save — read from save.homes.garage. */
function garageOf(save) {
  const homes = save.homes && typeof save.homes === "object" ? save.homes : { homeServer: 0, homes: [] };
  return normalizeGarage(homes.garage);
}

function setGarage(save, garage) {
  const homes = save.homes && typeof save.homes === "object" ? save.homes : { homeServer: 0, homes: [] };
  save.homes = { ...homes, garage: normalizeGarage(garage) };
}

/** Owned-car cap for a garage level: 3 base + 2 per slots tier (max 9). */
function garageCap(garage) {
  return GARAGE_BASE_SLOTS + normalizeGarage(garage).slots * 2;
}

function garageUpgradePrice(upgrade, garage) {
  const g = normalizeGarage(garage);
  if (upgrade === "slots") return g.slots >= 3 ? null : GARAGE_SLOT_PRICES[g.slots];
  if (upgrade === "workshop") return g.workshop ? null : GARAGE_WORKSHOP_PRICE;
  if (upgrade === "showroom") return g.showroom ? null : GARAGE_SHOWROOM_PRICE;
  return null;
}

/** Price of one mod change, or null when the (mod, value) pair is invalid. */
function modPrice(mod, value) {
  if (mod === "paint") return typeof value === "string" && value in CUSTOM_PAINTS ? CUSTOM_PAINT_PRICE : null;
  if (mod === "rims") return typeof value === "string" && value in RIM_PRICES ? RIM_PRICES[value] : null;
  if (mod === "spoiler") return typeof value === "string" && value in SPOILER_PRICES ? SPOILER_PRICES[value] : null;
  if (mod === "neon") {
    if (value === null) return 0;
    return typeof value === "string" && NEON_COLORS.includes(value) ? NEON_PRICE : null;
  }
  if (mod === "tint") {
    const level = Math.floor(Number(value));
    return Number.isInteger(level) && level >= 0 && level <= 3 ? TINT_PRICES[level] : null;
  }
  if (mod === "engine") {
    const level = Math.floor(Number(value));
    return Number.isInteger(level) && level >= 0 && level <= 3 ? ENGINE_PRICES[level] : null;
  }
  if (mod === "tires") {
    const level = Math.floor(Number(value));
    return Number.isInteger(level) && level >= 0 && level <= 2 ? TIRE_PRICES[level] : null;
  }
  return null;
}

/** Wash: 30 + dirt (30-130). Repair: 50 + 2 per damage point (50-250). */
function washCost(dirt) {
  return 30 + Math.max(0, Math.min(100, Math.round(Number(dirt) || 0)));
}
function repairCost(damage) {
  return 50 + Math.max(0, Math.min(100, Math.round(Number(damage) || 0))) * 2;
}

/** Wear accumulation: ~1 dirt per 60 units driven, 4 damage per crash. */
function accumulateWear(wear, distance, crashes) {
  const d = Math.max(0, Math.min(100, wear.dirt + Math.floor(Math.max(0, distance) / 60)));
  const g = Math.max(0, Math.min(100, wear.damage + Math.max(0, Math.floor(crashes)) * 4));
  return { dirt: d, damage: g };}

function sanitizeVehicles(vehicles) {
  if (!Array.isArray(vehicles)) return [];
  return vehicles
    .filter((v) => v && typeof v.id === "string")
    .map((v) => {
      // Shape stays `{ id, color }` for a stock, clean car (older
      // clients + the rental test deep-compare that shape); mods/wear
      // ride along only when they differ from stock, so nothing is
      // lost and nothing breaks.
      const out = { id: v.id, color: String(v.color || "") };
      const mods = normalizeMods(v.mods);
      if (JSON.stringify(mods) !== JSON.stringify(DEFAULT_MODS)) out.mods = mods;
      const wear = normalizeWear(v);
      if (wear.dirt > 0) out.dirt = wear.dirt;
      if (wear.damage > 0) out.damage = wear.damage;
      return out;
    });
}

// --- Garage rentals (car rental, 0.5 City Sol/day) ----------------------
// City Sol only, no burn: a rental is a time-boxed loan, not a purchase
// and not a burn event. Balances are INTEGER in Supabase AND Neon
// (verified 2026-11-11), so a 0.5/day rate can only ever charge whole
// Sol — the total rounds DOWN, so the player never pays more than
// 0.5/day, and the minimum rental is 2 days (a 1-day rental would cost
// 0). The rate stays 0.5/day; only the total is integer.
const RENTAL_RATE_PER_DAY = 0.5;
const RENTAL_MIN_DAYS = 2;
const RENTAL_MAX_DAYS = 30;
const RENTAL_DAY_MS = 86400000;

function rentalCost(days) {
  return Math.floor(days * RENTAL_RATE_PER_DAY);
}

function sanitizeRental(rental) {
  if (!rental || typeof rental.id !== "string") return null;
  const expiresAt = Number(rental.expiresAt || 0);
  const daysLeft = expiresAt > Date.now() ? Math.max(1, Math.ceil((expiresAt - Date.now()) / RENTAL_DAY_MS)) : 0;
  return {
    id: rental.id,
    color: String(rental.color || ""),
    days: Number(rental.days || 0),
    daysLeft,
    expiresAt,
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    balance: player.balance,
    burned: player.burned,
    owned: player.owned,
    color: player.color,
    hat: player.hat,
    car: player.car,
    trail: player.trail || "none",
    // Clothes worn right now, derived from the `worn:<slot>:<value>`
    // markers in `owned` — the client renders them in avatar.ts.
    clothes: equippedClothes(player.owned),
    // Wardrobe (style theme): equipped slots + saved fits, parsed from the
    // `owned` array — no new column. See wardrobeFromOwned above.
    wardrobe: wardrobeFromOwned(player.owned),
    friends: player.friends,
    inbox: player.inbox,
    party: player.party,
    mission: player.mission || 0,
    look: player.look || "tjr",
    earned: player.earned || 0,
    jobStreak: Number(player.jobStreak || 0),
    business: player.business || null,
    rent: player.rent || {},
    homeServer: player.homeServer ?? null,
    homes: sanitizeHomes(player.homes),
    garage: sanitizeGarage(player.homes?.garage),
    crib: sanitizeCrib(player.homes),
    vehicles: sanitizeVehicles(player.vehicles),
    activeVehicle: player.activeVehicle || null,
    rental: sanitizeRental(player.rental),
    bestRace: player.bestRace || 0,
    bestHover: player.bestHover || 0,
    holder: !!player.holder,
    food: foodPublic(player),
    wallet: player.wallet || "",
    daily: ensureDaily(player),
    email: player.email || "",
    avatar: player.avatar || "",
    provider: player.provider || "",
    account: Boolean(player.authUser),
    address: player.address || "",
  };
}

async function savePlayer(player) {
  const client = sb();
  if (client) {
    let { error } = await client.from("players").upsert(rowFromPlayer(player));
    if (error && /look|earned|best_race|best_hover|daily|wallet|holder|email|avatar|provider|auth_user|address|job_streak|business|rent|home_server|trail/i.test(error.message || "")) {
      const row = rowFromPlayer(player);
      delete row.look;
      delete row.trail;
      delete row.earned;
      delete row.best_race;
      delete row.best_hover;
      delete row.daily;
      delete row.wallet;
      delete row.holder;
      delete row.email;
      delete row.avatar;
      delete row.provider;
      delete row.auth_user;
      delete row.address;
      delete row.job_streak;
      delete row.business;
      delete row.rent;
      delete row.home_server;
      const retry = await client.from("players").upsert(row);
      error = retry.error;
    }
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const owned = JSON.stringify(player.owned);
    const friends = JSON.stringify(player.friends);
    const inbox = JSON.stringify(player.inbox);
    const job = JSON.stringify(player.job);
    const daily = JSON.stringify(player.daily || {});
    const business = JSON.stringify(player.business || null);
    const rent = JSON.stringify(player.rent || {});
    await sql`INSERT INTO players (id, token, name, balance, burned, owned, color, hat, car, friends, inbox, job, job_streak, business, rent, party, look, earned, best_race, best_hover, daily, wallet, holder, email, avatar, provider, auth_user, address, home_server)
      VALUES (${player.id}, ${player.token}, ${player.name}, ${player.balance}, ${player.burned}, ${owned}, ${player.color}, ${player.hat}, ${player.car}, ${friends}, ${inbox}, ${job}, ${Number(player.jobStreak || 0)}, ${business}, ${rent}, ${player.party}, ${player.look || "tjr"}, ${player.earned || 0}, ${player.bestRace || 0}, ${player.bestHover || 0}, ${daily}, ${player.wallet || ""}, ${!!player.holder}, ${player.email || ""}, ${player.avatar || ""}, ${player.provider || ""}, ${player.authUser || ""}, ${player.address || ""}, ${player.homeServer ?? null})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        balance = EXCLUDED.balance,
        burned = EXCLUDED.burned,
        owned = EXCLUDED.owned,
        color = EXCLUDED.color,
        hat = EXCLUDED.hat,
        car = EXCLUDED.car,
        friends = EXCLUDED.friends,
        inbox = EXCLUDED.inbox,
        job = EXCLUDED.job,
        job_streak = EXCLUDED.job_streak,
        business = EXCLUDED.business,
        rent = EXCLUDED.rent,
        party = EXCLUDED.party,
        look = EXCLUDED.look,
        earned = EXCLUDED.earned,
        best_race = EXCLUDED.best_race,
        best_hover = EXCLUDED.best_hover,
        daily = EXCLUDED.daily,
        wallet = EXCLUDED.wallet,
        holder = EXCLUDED.holder,
        email = EXCLUDED.email,
        avatar = EXCLUDED.avatar,
        provider = EXCLUDED.provider,
        auth_user = EXCLUDED.auth_user,
        address = EXCLUDED.address,
        home_server = EXCLUDED.home_server`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.set(`orbitx:player:${player.id}`, JSON.stringify(player));
    await cache.set(`orbitx:token:${player.token}`, player.id);
    return;
  }
  const store = memory();
  store.players.set(player.id, player);
  store.tokens.set(player.token, player.id);
}


// ---------------------------------------------------------------------------
// Per-(player, universe) saves — the multiverse save model.
//
// Progress (balance, homes, cars, offices, jobs) lives ONE ROW PER
// (player, universe) in player_saves. Identity (id, token, name,
// home_server) stays on players. A save is a player-shaped object with
// serverId / lastSeen added; it is read from the DB on EVERY op — never
// served from a per-instance in-memory copy — or the HQ staleness bug
// comes back per-universe. Memory / Redis are only the last-resort
// tiers when neither Supabase nor Neon is configured, exactly like
// playerById / savePlayer.
// ---------------------------------------------------------------------------

function freshSave(player, serverId) {
  const save = freshPlayer(player.id, player.name);
  save.token = "";
  save.serverId = serverId;
  save.server = serverId;
  save.playerId = player.id;
  save.lastSeen = 0;
  return save;
}

function parseSave(row) {
  const id = row.player_id || row.playerId || row.id || "";
  const save = freshPlayer(id, "");
  save.token = "";
  save.serverId = Number(row.server_id ?? row.serverId ?? row.server ?? 0);
  save.server = save.serverId;
  save.playerId = row.player_id || row.playerId || id;
  save.balance = Number(row.balance ?? START_BALANCE);
  save.burned = Number(row.burned || 0);
  save.owned = typeof row.owned === "string" ? JSON.parse(row.owned || "[]") : row.owned || [];
  save.color = row.color || "";
  save.hat = row.hat || "";
  save.car = row.car || "";
  save.look = row.look || "tjr";
  save.job = typeof row.job === "string" ? JSON.parse(row.job || "null") : row.job || null;
  save.jobStreak = Number(row.job_streak ?? row.jobStreak ?? 0);
  save.business = typeof row.business === "string" ? JSON.parse(row.business || "null") : row.business || null;
  save.rent = typeof row.rent === "string" ? JSON.parse(row.rent || "{}") : row.rent || {};
  save.earned = Number(row.earned || 0);
  save.bestRace = Number(row.best_race ?? row.bestRace ?? 0);
  save.bestHover = Number(row.best_hover ?? row.bestHover ?? 0);
  save.daily = typeof row.daily === "string" ? JSON.parse(row.daily || "null") : row.daily || null;
  save.mission = Number(row.mission || 0);
  save.missionAt = Number(row.mission_at ?? row.missionAt ?? 0);
  save.missions = typeof row.missions === "string" ? JSON.parse(row.missions || "{}") : row.missions || {};
  save.trail = row.trail || "none";
  save.homes = typeof row.homes === "string" ? JSON.parse(row.homes || '{"homeServer":0,"homes":[]}') : row.homes || { homeServer: 0, homes: [] };
  save.vehicles = typeof row.vehicles === "string" ? JSON.parse(row.vehicles || "[]") : row.vehicles || [];
  save.activeVehicle = row.active_vehicle || row.activeVehicle || null;
  save.rental = typeof row.rental === "string" ? JSON.parse(row.rental || "null") : row.rental || null;
  save.lastSeen = Number(row.last_seen ?? row.lastSeen ?? 0);
  return save;
}

function rowFromSave(save) {
  // player_saves JSON-ish columns are TEXT in Supabase, so stringify —
  // the same values are stored as TEXT in the Neon fallback too.
  return {
    player_id: save.playerId || save.id,
    server_id: Number(save.serverId ?? save.server ?? 0),
    balance: Number(save.balance || 0),
    burned: Number(save.burned || 0),
    owned: JSON.stringify(save.owned || []),
    color: save.color || "",
    hat: save.hat || "",
    car: save.car || "",
    look: save.look || "tjr",
    job: JSON.stringify(save.job || null),
    job_streak: Number(save.jobStreak || 0),
    business: JSON.stringify(save.business || null),
    rent: JSON.stringify(save.rent || {}),
    earned: Number(save.earned || 0),
    best_race: Number(save.bestRace || 0),
    best_hover: Number(save.bestHover || 0),
    daily: JSON.stringify(save.daily || {}),
    mission: Number(save.mission || 0),
    mission_at: Number(save.missionAt || 0),
    missions: JSON.stringify(save.missions || {}),
    trail: save.trail || "none",
    homes: JSON.stringify(save.homes || { homeServer: 0, homes: [] }),
    vehicles: JSON.stringify(save.vehicles || []),
    active_vehicle: save.activeVehicle || "",
    rental: JSON.stringify(save.rental || null),
    last_seen: Number(save.lastSeen || 0),
    updated_at: new Date().toISOString(),
  };
}

async function saveKey(playerId, serverId) {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("player_saves").select("*").eq("player_id", playerId).eq("server_id", serverId).maybeSingle();
    if (!error && data) return parseSave(data);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM player_saves WHERE player_id = ${playerId} AND server_id = ${serverId} LIMIT 1`;
    return rows[0] ? parseSave(rows[0]) : null;
  }
  const cache = redis();
  if (cache) {
    const raw = await cache.hget("orbitx:saves", `${playerId}:${serverId}`);
    if (!raw) return null;
    return parseSave(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  return memory().saves.get(`${playerId}:${serverId}`) ?? null;
}

async function saveSave(save) {
  const client = sb();
  if (client) {
    let { error } = await client.from("player_saves").upsert(rowFromSave(save));
    if (error && /homes|vehicles|active_vehicle|rental|last_seen|missions|trail/i.test(error.message || "")) {
      // Same strip-unknown-columns retry as savePlayer: a missing column
      // surfaces as an error instead of silently dropping the field.
      const row = rowFromSave(save);
      delete row.homes;
      delete row.vehicles;
      delete row.active_vehicle;
      delete row.rental;
      delete row.last_seen;
      delete row.missions;
      delete row.trail;
      const retry = await client.from("player_saves").upsert(row);
      error = retry.error;
    }
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const row = rowFromSave(save);
    await sql`INSERT INTO player_saves (player_id, server_id, balance, burned, owned, color, hat, car, look, job, job_streak, business, rent, earned, best_race, best_hover, daily, mission, mission_at, missions, trail, homes, vehicles, active_vehicle, rental, last_seen, updated_at)
      VALUES (${row.player_id}, ${row.server_id}, ${row.balance}, ${row.burned}, ${row.owned}, ${row.color}, ${row.hat}, ${row.car}, ${row.look}, ${row.job}, ${row.job_streak}, ${row.business}, ${row.rent}, ${row.earned}, ${row.best_race}, ${row.best_hover}, ${row.daily}, ${row.mission}, ${row.mission_at}, ${row.missions}, ${row.trail}, ${row.homes}, ${row.vehicles}, ${row.active_vehicle}, ${row.rental}, ${row.last_seen}, ${row.updated_at})
      ON CONFLICT (player_id, server_id) DO UPDATE SET
        balance = EXCLUDED.balance, burned = EXCLUDED.burned, owned = EXCLUDED.owned,
        color = EXCLUDED.color, hat = EXCLUDED.hat, car = EXCLUDED.car, look = EXCLUDED.look,
        job = EXCLUDED.job, job_streak = EXCLUDED.job_streak, business = EXCLUDED.business,
        rent = EXCLUDED.rent, earned = EXCLUDED.earned, best_race = EXCLUDED.best_race,
        best_hover = EXCLUDED.best_hover, daily = EXCLUDED.daily, mission = EXCLUDED.mission,
        mission_at = EXCLUDED.mission_at, missions = EXCLUDED.missions, trail = EXCLUDED.trail,
        homes = EXCLUDED.homes, vehicles = EXCLUDED.vehicles,
        active_vehicle = EXCLUDED.active_vehicle, rental = EXCLUDED.rental, last_seen = EXCLUDED.last_seen,
        updated_at = EXCLUDED.updated_at`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:saves", { [`${save.playerId || save.id}:${save.serverId}`]: JSON.stringify(save) });
    return;
  }
  memory().saves.set(`${save.playerId || save.id}:${save.serverId}`, save);
}

// --- One balance, one ledger -------------------------------------------
// The per-(player, universe) save is the ONLY City Sol balance. The
// global players row is a back-compat mirror of the universe the player
// is currently in — the save is authoritative, and every op that moves
// City Sol moves it on the save and mirrors it to the global row, so
// the two can never disagree again.
//
// Before this fix the HUD read the global row (digest/sync `me`) while
// buy-car / buy-home / office-claim read the save, and a save minted at
// START_BALANCE never inherited the player's wealth — so a player with
// 9,810 City Sol was told "not enough" for a 90-Sol lot.

async function hasAnySave(playerId) {
  for (const serverId of SERVERS) {
    if (await saveKey(playerId, serverId)) return true;
  }
  return false;
}

// Load the save for (player, server), minting it if it does not exist —
// and reconciling the balance so a pre-fix save never strands the
// player's wealth in the global row. Pass { mint: false } for heartbeats
// (me/sync), which load and reconcile but never mint a save.
async function ensureSave(player, server, { mint = true } = {}) {
  let save = await saveKey(player.id, server);
  if (!save) {
    if (!mint) return null;
    save = freshSave(player, server);
    // First universe: the player's pre-multiverse wealth moves into it.
    // Any later universe starts at START_BALANCE — the same money is
    // never minted twice.
    if (!(await hasAnySave(player.id))) {
      save.balance = Number(player.balance || 0);
      player.homeServer = server;
    }
    syncSaveIdentity(save, player);
    await saveSave(save);
    await savePlayer(player);
    return save;
  }
  syncSaveIdentity(save, player);
  // Reconcile an existing save: if this is the player's home universe
  // (or they have no home universe yet) and the save holds less than the
  // global row, the wealth was stranded by the old mint — move it in.
  // Gated by homeServer so it can only ever happen on one universe.
  if ((player.homeServer == null || player.homeServer === server) && save.balance < player.balance) {
    save.balance = Number(player.balance || 0);
    if (player.homeServer == null) player.homeServer = server;
    await saveSave(save);
    await savePlayer(player);
  }
  return save;
}

// Mirror this universe's save balance onto the legacy global row.
async function mirrorBalance(player, save) {
  if (!save) return;
  const next = Number(save.balance || 0);
  if (Number(player.balance) !== next) {
    player.balance = next;
    await savePlayer(player);
  }
}

// The universe an op belongs to: an explicit server in the body, else
// the player's home universe, else Universe 1.
function currentServerFor(body, player) {
  const fromBody = body && body.server != null && body.server !== "" ? parseServerId(body.server) : null;
  if (fromBody) return fromBody;
  if (isServerId(player.homeServer)) return player.homeServer;
  return 1;
}

async function touchSave(save) {
  save.lastSeen = Date.now();
  await saveSave(save);
}

// Heartbeat: touch the player's save on one universe WITHOUT creating it.
// Used by the HEARTBEAT ops (sync/digest/me/board) so universe-list counts
// are real. A missing save stays missing — heartbeats never mint saves.
async function touchSaveIfExists(playerId, serverId) {
  if (!isServerId(serverId)) return;
  const save = await saveKey(playerId, serverId);
  if (save) await touchSave(save);
}

// The universe a heartbeat counts toward: the server the client sent, else
// the player's home universe. Null when neither is known.
function heartbeatServer(body, player) {
  return parseServerId(body.server) ?? (isServerId(player.homeServer) ? player.homeServer : null);
}

async function touchHeartbeat(player, body) {
  try {
    const server = heartbeatServer(body, player);
    if (server) await touchSaveIfExists(player.id, server);
  } catch {
    // Heartbeats never fail the op they ride on.
  }
}

// How many players are live on one universe right now: saves touched in
// the last 5 minutes. The universe-join cap reads this, never a stored
// counter, so a stale count can never over-fill a universe.
async function activeCount(serverId) {
  const since = Date.now() - MULTIVERSE_HEARTBEAT_MS;
  const client = sb();
  if (client) {
    const { count, error } = await client.from("player_saves").select("player_id", { count: "exact", head: true }).eq("server_id", serverId).gt("last_seen", since);
    if (!error && typeof count === "number") return count;
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT COUNT(*) AS n FROM player_saves WHERE server_id = ${serverId} AND last_seen > ${since}`;
    return Number(rows[0]?.n || 0);
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:saves")) || {};
    return Object.values(all).filter((raw) => {
      const save = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Number(save.serverId || save.server) === serverId && Number(save.lastSeen || 0) > since;
    }).length;
  }
  let count = 0;
  for (const save of memory().saves.values()) {
    if (save.serverId === serverId && Number(save.lastSeen || 0) > since) count += 1;
  }
  return count;
}

// Which universe a player is playing on RIGHT NOW: the universe whose
// save has the freshest heartbeat (lastSeen inside the 5-minute
// window). Null when they have no recent heartbeat anywhere — they are
// offline, or they have never joined a universe. This is how a join
// finds the other person: party-accept and the universe picker read it
// instead of guessing the inviter's home universe (which is where the
// "sometimes I join and I'm not with them" bug came from — the joiner
// kept landing on their OWN saved/home universe while the friend was
// on another one). Backend-agnostic: saveKey covers Supabase / Neon /
// Redis / memory, one read per universe, and a miss is just null.
async function currentUniverseFor(playerId) {
  if (!playerId) return null;
  try {
    const since = Date.now() - MULTIVERSE_HEARTBEAT_MS;
    let best = null;
    let bestSeen = 0;
    for (const serverId of SERVERS) {
      const save = await saveKey(playerId, serverId);
      const seen = Number(save?.lastSeen || 0);
      if (seen > since && seen > bestSeen) {
        best = serverId;
        bestSeen = seen;
      }
    }
    return best;
  } catch {
    return null;
  }
}

// Identity fields live on players, not on the save — copy them onto a
// loaded save before it is rendered as `me`, so the client sees one
// complete CityMe. Nothing here is persisted to player_saves:
// rowFromSave only writes progress columns.
function syncSaveIdentity(save, player) {
  save.name = player.name;
  save.email = player.email || "";
  save.avatar = player.avatar || "";
  save.provider = player.provider || "";
  save.authUser = player.authUser || "";
  save.address = player.address || "";
  save.holder = !!player.holder;
  save.wallet = player.wallet || "";
  save.friends = player.friends || [];
  save.inbox = player.inbox || [];
  save.party = player.party || "";
  // Cosmetics are identity, not per-server progress: a hat or colour
  // bought on the global shop shows up on every universe. Without this
  // the save keeps its own stale color/hat/car from when it was minted.
  save.owned = player.owned || [];
  save.color = player.color || "white";
  save.hat = player.hat || "none";
  save.car = player.car || "black";
  save.trail = player.trail || "none";
  return save;
}

function parsePlayer(row) {
  return {
    ...row,
    balance: Number(row.balance),
    burned: Number(row.burned),
    owned: typeof row.owned === "string" ? JSON.parse(row.owned || "[]") : row.owned || [],
    friends: typeof row.friends === "string" ? JSON.parse(row.friends || "[]") : row.friends || [],
    inbox: typeof row.inbox === "string" ? JSON.parse(row.inbox || "[]") : row.inbox || [],
    job: typeof row.job === "string" ? JSON.parse(row.job || "null") : row.job,
    jobStreak: Number(row.job_streak ?? row.jobStreak ?? 0),
    business: typeof row.business === "string" ? JSON.parse(row.business || "null") : row.business || null,
    rent: typeof row.rent === "string" ? JSON.parse(row.rent || "{}") : row.rent || {},
    party: row.party || "",
    mission: Number(row.mission || 0),
    missionAt: Number(row.mission_at || row.missionAt || 0),
    look: row.look || "tjr",
    trail: row.trail || "none",
    earned: Number(row.earned || 0),
    bestRace: Number(row.best_race || row.bestRace || 0),
    bestHover: Number(row.best_hover || row.bestHover || 0),
    daily: typeof row.daily === "string" ? JSON.parse(row.daily || "null") : row.daily || null,
    wallet: row.wallet || "",
    holder: row.holder === true || row.holder === "true" || row.holder === "t",
    email: row.email || "",
    avatar: row.avatar || "",
    provider: row.provider || "",
    authUser: row.auth_user || row.authUser || "",
    address: row.address || "",
    homeServer: row.home_server != null ? Number(row.home_server) : row.homeServer != null ? Number(row.homeServer) : null,
    homes: typeof row.homes === "string" ? JSON.parse(row.homes || '{"homeServer":0,"homes":[]}') : row.homes || { homeServer: 0, homes: [] },
    vehicles: typeof row.vehicles === "string" ? JSON.parse(row.vehicles || "[]") : row.vehicles || [],
    activeVehicle: row.active_vehicle || row.activeVehicle || null,
  };
}

function rowFromPlayer(player) {
  return {
    id: player.id,
    token: player.token,
    name: player.name,
    balance: player.balance,
    burned: player.burned,
    owned: player.owned,
    color: player.color,
    hat: player.hat,
    car: player.car,
    friends: player.friends,
    inbox: player.inbox,
    job: player.job,
    job_streak: Number(player.jobStreak || 0),
    business: player.business || null,
    rent: player.rent || {},
    party: player.party || "",
    mission: player.mission || 0,
    mission_at: player.missionAt || 0,
    look: player.look || "tjr",
    trail: player.trail || "none",
    earned: player.earned || 0,
    best_race: player.bestRace || 0,
    best_hover: player.bestHover || 0,
    daily: player.daily || {},
    wallet: player.wallet || "",
    holder: !!player.holder,
    email: player.email || "",
    avatar: player.avatar || "",
    provider: player.provider || "",
    auth_user: player.authUser || "",
    address: player.address || "",
    home_server: player.homeServer ?? null,
  };
}

function noteSupabase(message) {
  globalThis.__orbitxSbError = String(message || "Supabase query failed");
}

async function playerByToken(token) {
  if (!token) return null;
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("*").eq("token", token).maybeSingle();
    if (!error && data) return parsePlayer(data);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM players WHERE token = ${token} LIMIT 1`;
    return rows[0] ? parsePlayer(rows[0]) : null;
  }
  const cache = redis();
  if (cache) {
    const id = await cache.get(`orbitx:token:${token}`);
    if (!id) return null;
    const raw = await cache.get(`orbitx:player:${id}`);
    if (!raw) return null;
    return parsePlayer(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  const store = memory();
  const id = store.tokens.get(token);
  return id ? store.players.get(id) ?? null : null;
}

async function playerById(id) {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("*").eq("id", id).maybeSingle();
    if (!error && data) return parsePlayer(data);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM players WHERE id = ${id} LIMIT 1`;
    return rows[0] ? parsePlayer(rows[0]) : null;
  }
  const cache = redis();
  if (cache) {
    const raw = await cache.get(`orbitx:player:${id}`);
    if (!raw) return null;
    return parsePlayer(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  return memory().players.get(id) ?? null;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function readWorld() {
  const client = sb();
  if (client) {
    const since = new Date(Date.now() - PRESENCE_MS).toISOString();
    // Prune rows nobody will ever read again (players who closed the tab).
    // Best-effort and probabilistic — one prune per ~20 reads keeps the
    // table clean without doubling every sync's Supabase traffic.
    if (Math.random() < 0.05) await client.from("presence").delete().lt("seen", since);
    const { data, error } = await client.from("presence").select("state, seen").gt("seen", since);
    if (!error && data) return data.map((row) => (typeof row.state === "string" ? JSON.parse(row.state) : row.state));
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  const now = Date.now();
  if (cache) {
    const all = (await cache.hgetall("orbitx:world")) || {};
    const people = [];
    for (const [id, raw] of Object.entries(all)) {
      const state = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!state || now - Number(state.seen || 0) > PRESENCE_MS) {
        await cache.hdel("orbitx:world", id);
        continue;
      }
      people.push(state);
    }
    return people;
  }
  const people = [];
  for (const [id, state] of memory().world) {
    if (now - state.seen > PRESENCE_MS) memory().world.delete(id);
    else people.push(state);
  }
  return people;
}

async function writePresence(state) {
  const client = sb();
  if (client) {
    const { error } = await client.from("presence").upsert({ id: state.id, state, seen: new Date().toISOString() });
    if (!error) return;
    noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:world", { [state.id]: JSON.stringify(state) });
    return;
  }
  memory().world.set(state.id, state);
}

async function pushChat(line) {
  const client = sb();
  if (client) {
    const { error } = await client.from("chat").insert({
      player_id: line.id,
      name: line.name,
      text: line.text,
      scope: line.scope,
      x: line.x,
      z: line.z,
    });
    if (!error) return;
    noteSupabase(error.message);
  }
  const cache = redis();
  const item = JSON.stringify(line);
  if (cache) {
    await cache.lpush("orbitx:chat", item);
    await cache.ltrim("orbitx:chat", 0, 79);
    return;
  }
  memory().chat.unshift(line);
  memory().chat.length = Math.min(memory().chat.length, 80);
}

async function readChat() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("chat").select("player_id, name, text, scope, x, z").order("id", { ascending: false }).limit(40);
    if (!error && data) {
      return data.reverse().map((row) => ({ id: row.player_id, name: row.name, text: row.text, scope: row.scope, x: row.x, z: row.z }));
    }
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    const rows = (await cache.lrange("orbitx:chat", 0, 79)) || [];
    return rows.map((row) => (typeof row === "string" ? JSON.parse(row) : row)).reverse();
  }
  return [...memory().chat].reverse();
}

async function saveBooking(info) {
  const client = sb();
  if (client) {
    const { error } = await client.from("bookings").upsert(info);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO bookings (id, project, text, start, until, burned)
      VALUES (${info.id}, ${info.project}, ${info.text}, ${info.start}, ${info.end}, ${info.burned})
      ON CONFLICT (id) DO UPDATE SET project = EXCLUDED.project, text = EXCLUDED.text, start = EXCLUDED.start, until = EXCLUDED.until, burned = EXCLUDED.burned`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:bookings", { [info.id]: JSON.stringify(info) });
    return;
  }
  memory().bookings.set(info.id, info);
}

function liveBookings(rows) {
  const today = new Date().toISOString().slice(0, 10);
  return (rows || []).filter((row) => !row.end || row.end >= today);
}

async function readBookings() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("bookings").select("id, project, text, start, end, burned, owner_id").gte("end", new Date().toISOString().slice(0, 10));
    if (!error && data) return data;
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT id, project, text, start, until AS end, burned, owner_id FROM bookings WHERE until >= ${new Date().toISOString().slice(0, 10)}`;
    return rows;
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:bookings")) || {};
    return liveBookings(Object.values(all).map((row) => (typeof row === "string" ? JSON.parse(row) : row)));
  }
  return liveBookings([...memory().bookings.values()]);
}

function publicOfficeClaim(row) {
  return {
    suite: row.suite,
    server: Number(row.server_id ?? row.server ?? 1),
    owner_id: row.owner_id,
    owner_name: row.owner_name || "",
    project: row.project,
    logo: row.logo || "",
    site: row.site || "",
    term_days: Number(row.term_days),
    start: row.start,
    until: row.until || row.end || "",
    price: Number(row.price),
    claimed_at: row.claimed_at || "",
  };
}

function officeClaimRow(row) {
  return {
    suite: row.suite,
    server: Number(row.server_id ?? row.server ?? 1),
    owner_id: row.owner_id,
    owner_name: row.owner_name || "",
    project: row.project,
    logo: row.logo || "",
    site: row.site || "",
    term_days: Number(row.term_days),
    start: row.start,
    until: row.until || row.end || "",
    price: Number(row.price),
    claimed_at: row.claimed_at || "",
  };
}

async function saveOfficeClaim(claim) {
  // One table, one code path: the claim row carries its server, and the
  // key is (suite, server_id) — the same suite can be claimed on every
  // universe independently.
  const serverId = Number(claim.server_id ?? claim.server ?? 1);
  const row = { ...claim, server_id: serverId };
  delete row.server;
  const client = sb();
  if (client) {
    const { error } = await client.from("office_claims").upsert(row);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO office_claims (suite, server_id, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at)
      VALUES (${row.suite}, ${row.server_id}, ${row.owner_id}, ${row.owner_name}, ${row.project}, ${row.logo}, ${row.site}, ${Number(row.term_days)}, ${row.start}, ${row.until}, ${Number(row.price)}, ${row.claimed_at})
      ON CONFLICT (suite, server_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, owner_name = EXCLUDED.owner_name, project = EXCLUDED.project, logo = EXCLUDED.logo, site = EXCLUDED.site, term_days = EXCLUDED.term_days, start = EXCLUDED.start, until = EXCLUDED.until, price = EXCLUDED.price, claimed_at = EXCLUDED.claimed_at`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:office-claims", { [`${serverId}:${row.suite}`]: JSON.stringify(row) });
    return;
  }
  memory().officeClaims.set(`${serverId}:${row.suite}`, row);
}

async function deleteOfficeClaim(suiteId, serverId = 1) {
  const client = sb();
  if (client) {
    const { error } = await client.from("office_claims").delete().eq("suite", suiteId).eq("server_id", serverId);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`DELETE FROM office_claims WHERE suite = ${suiteId} AND server_id = ${serverId}`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hdel("orbitx:office-claims", `${serverId}:${suiteId}`);
    return;
  }
  memory().officeClaims.delete(`${serverId}:${suiteId}`);
}

async function readOfficeClaims(serverId) {
  const client = sb();
  if (client) {
    let query = client
      .from("office_claims")
      .select("suite, server_id, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at");
    if (isServerId(serverId)) query = query.eq("server_id", serverId);
    const { data, error } = await query;
    if (!error && data) return data.map(officeClaimRow);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = isServerId(serverId)
      ? await sql`SELECT suite, server_id, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at FROM office_claims WHERE server_id = ${serverId}`
      : await sql`SELECT suite, server_id, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at FROM office_claims`;
    return rows.map(officeClaimRow);
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:office-claims")) || {};
    const rows = Object.values(all).map((row) => officeClaimRow(typeof row === "string" ? JSON.parse(row) : row));
    return isServerId(serverId) ? rows.filter((row) => row.server === serverId) : rows;
  }
  const rows = [...memory().officeClaims.values()].map(officeClaimRow);
  return isServerId(serverId) ? rows.filter((row) => row.server === serverId) : rows;
}

function activeOfficeClaim(claims, suiteId, serverId) {
  const today = todayISO();
  return (
    claims.find(
      (row) =>
        row.suite === suiteId &&
        (serverId == null || Number(row.server ?? 1) === serverId) &&
        row.until >= today,
    ) || null
  );
}

// Every lot this player owns on this universe (the properties table is
// the only per-server record of lot ownership — live.js writes it on
// property-buy, keyed (id, server_id)). Supabase first, Neon second;
// with neither (local dev, memory tier) fall back to the per-server
// save's owned list, which syncSaveIdentity keeps in sync with the
// global player record.
async function ownedLots(playerId, serverId, save) {
  const client = sb();
  if (client) {
    const { data, error } = await client
      .from("properties")
      .select("id, owner_id")
      .eq("server_id", serverId);
    if (!error && data) return data.filter((row) => row.owner_id === playerId).map((row) => row.id);
    if (error) noteSupabase(error.message);
    // A read error falls through to the save check below.
  }
  const sql = db();
  if (sql) {
    try {
      const rows = await sql`SELECT id, owner_id FROM properties WHERE server_id = ${serverId}`;
      return rows.filter((row) => row.owner_id === playerId).map((row) => row.id);
    } catch {
      // A missing table on a fresh Neon falls through to the save check.
    }
  }
  // (Wardrobe entries — eq:<kind>:<value> and fit:... — are not lots.)
  return Array.isArray(save?.owned)
    ? [...save.owned].filter((entry) => typeof entry === "string" && !entry.startsWith("eq:") && !entry.startsWith("fit:"))
    : [];
}

async function officeDirectory(serverId = 1) {
  const claims = await readOfficeClaims(serverId);
  return OFFICES.map((suite) => {
    const claim = suite.claimable ? activeOfficeClaim(claims, suite.id, serverId) : null;
    return {
      id: suite.id,
      server: serverId,
      floor: suite.floor,
      name: suite.name,
      tier: suite.tier,
      claimable: suite.claimable,
      prices: suite.claimable
        ? { 1: officePrice(suite, 1), 7: officePrice(suite, 7), 30: officePrice(suite, 30) }
        : { 1: 0, 7: 0, 30: 0 },
      claim: claim ? publicOfficeClaim(claim) : null,
    };
  });
}

async function claimOffice(player, save, body) {
  // Which universe this claim lives on. Old clients send no server —
  // pre-multiverse claims are universe 1.
  const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5).", status: 400 };
  const suite = officeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  if (!suite.claimable) {
    return { ok: false, message: "The Founder's Office belongs to OrbitX. It is never for sale.", status: 400 };
  }
  const termDays = Number(body.term_days);
  if (![1, 7, 30].includes(termDays)) {
    return { ok: false, message: "Pick a 1-day, 7-day, or 30-day lease.", status: 400 };
  }
  const project = String(body.project || "").trim().slice(0, 48);
  if (!project) return { ok: false, message: "Name the project claiming this office.", status: 400 };
  const logo = String(body.logo || "").trim().slice(0, 200);
  const site = String(body.site || "").trim().slice(0, 200);
  for (const url of [logo, site]) {
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, message: "Logo and site links must start with http:// or https://.", status: 400 };
    }
  }
  const price = officePrice(suite, termDays);
  if (!price) return { ok: false, message: "That lease term is not priced.", status: 400 };
  const claims = await readOfficeClaims(server);
  const taken = activeOfficeClaim(claims, suite.id, server);
  if (taken) {
    return { ok: false, message: `${suite.name} is already claimed by ${taken.project} until ${taken.until}.`, status: 400 };
  }
  if (save.balance < price) {
    return { ok: false, message: `Not enough City Sol — ${suite.name} for ${officeTermLabel(termDays)} costs ${price} City Sol.`, status: 400 };
  }
  // City Sol only: the lease deducts from THIS universe's save — the
  // per-server balance is authoritative (same pattern as the district
  // office claims, buy-car and buy-home). The global players balance is
  // mirrored by the same amount for back-compat: old clients read it,
  // and the lease reply's `me` comes from the save. The in-game
  // "burned" counter is untouched — offices do not burn anything, and
  // there is no SOL/ORBITX involved.
  const start = todayISO();
  const claim = {
    suite: suite.id,
    server_id: server,
    owner_id: player.id,
    owner_name: player.name,
    project,
    logo,
    site,
    term_days: termDays,
    start,
    until: officeEndISO(start, termDays),
    price,
    claimed_at: new Date().toISOString(),
  };
  const prevHomeServer = player.homeServer ?? null;
  save.balance -= price;
  player.balance = save.balance;
  // Claiming an office makes this universe the player's home universe
  // (latest home wins) — players.home_server.
  player.homeServer = server;
  await saveSave(save);
  await savePlayer(player);
  try {
    await saveOfficeClaim(claim);
  } catch {
    // The claim did not land — refund the City Sol rather than leave the
    // player poorer with no office.
    save.balance += price;
    player.balance = save.balance;
    player.homeServer = prevHomeServer;
    await saveSave(save);
    await savePlayer(player);
    return { ok: false, message: "The claim did not save. Your City Sol was refunded — try again.", status: 500 };
  }
  return {
    ok: true,
    message: `${suite.name} is yours for ${officeTermLabel(termDays)} — ${price} City Sol. It is yours until ${claim.until}.`,
    claim: publicOfficeClaim(claim),
    offices: await officeDirectory(server),
  };
}

async function releaseOffice(player, body) {
  const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5).", status: 400 };
  const suite = officeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  const claims = await readOfficeClaims(server);
  const claim = activeOfficeClaim(claims, suite.id, server);
  if (!claim) return { ok: false, message: `${suite.name} is not claimed.`, status: 400 };
  if (claim.owner_id !== player.id) {
    return { ok: false, message: `Only ${claim.project} can release ${suite.name}.`, status: 400 };
  }
  await deleteOfficeClaim(suite.id, server);
  return {
    ok: true,
    message: `${suite.name} released. The lease ends now — no refund for the days left.`,
    offices: await officeDirectory(server),
  };
}

// --- District office suites (emergency.ts catalog, mirrored) -----------------
// Same City Sol leases as the HQ, scoped by (suite, server) in the one
// office_claims table. The pure validation in emergency.ts
// (validateDistrictOfficeClaim / validateDistrictOfficeRelease) cannot be
// imported from plain-JS api/city.js, so the checks below mirror it —
// same order, same messages — plus the server scope.

function districtOfficeSuite(id) {
  return DISTRICT_OFFICES.find((suite) => suite.id === id) || null;
}

async function districtOfficeDirectory(district, server, claims) {
  return DISTRICT_OFFICES.filter((suite) => suite.district === district).map((suite) => {
    const claim = suite.claimable ? activeOfficeClaim(claims, suite.id, server) : null;
    return {
      id: suite.id,
      district,
      server,
      floor: suite.floor,
      name: suite.name,
      tier: suite.tier,
      claimable: suite.claimable,
      prices: suite.claimable
        ? { 1: officePrice(suite, 1), 7: officePrice(suite, 7), 30: officePrice(suite, 30) }
        : { 1: 0, 7: 0, 30: 0 },
      claim: claim ? publicOfficeClaim(claim) : null,
    };
  });
}

async function claimDistrictOffice(player, save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5).", status: 400 };
  const suite = districtOfficeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  // The district is derived from the suite id — a mismatched district
  // param is refused, never trusted.
  if (body.district && String(body.district) !== suite.district) {
    return { ok: false, message: "That suite is not in that district.", status: 400 };
  }
  if (!suite.claimable) {
    return { ok: false, message: "The Founder's Office belongs to the district. It is never for sale.", status: 400 };
  }
  const termDays = Number(body.term_days);
  if (![1, 7, 30].includes(termDays)) {
    return { ok: false, message: "Pick a 1-day, 7-day, or 30-day lease.", status: 400 };
  }
  const project = String(body.project || "").trim().slice(0, 48);
  if (!project) return { ok: false, message: "Name the project claiming this office.", status: 400 };
  const logo = String(body.logo || "").trim().slice(0, 200);
  const site = String(body.site || "").trim().slice(0, 200);
  for (const url of [logo, site]) {
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, message: "Logo and site links must start with http:// or https://.", status: 400 };
    }
  }
  const price = officePrice(suite, termDays);
  if (!price) return { ok: false, message: "That lease term is not priced.", status: 400 };
  const claims = await readOfficeClaims(server);
  const taken = activeOfficeClaim(claims, suite.id, server);
  if (taken) {
    return { ok: false, message: `${suite.name} is already claimed by ${taken.project} on Server ${server} until ${taken.until}.`, status: 400 };
  }
  if (save.balance < price) {
    return { ok: false, message: `Not enough City Sol — ${suite.name} for ${officeTermLabel(termDays)} costs ${price} City Sol.`, status: 400 };
  }
  const start = todayISO();
  const claim = {
    suite: suite.id,
    server_id: server,
    owner_id: save.id,
    owner_name: save.name,
    project,
    logo,
    site,
    term_days: termDays,
    start,
    until: officeEndISO(start, termDays),
    price,
    claimed_at: new Date().toISOString(),
  };
  const prevHomeServer = player.homeServer ?? null;
  save.balance -= price;
  player.balance = save.balance;
  await saveSave(save);
  player.homeServer = server;
  await savePlayer(player);
  try {
    await saveOfficeClaim(claim);
  } catch {
    // The claim did not land — refund the City Sol rather than leave the
    // player poorer with no office.
    save.balance += price;
    player.balance = save.balance;
    await saveSave(save);
    player.homeServer = prevHomeServer;
    await savePlayer(player);
    return { ok: false, message: "The claim did not save. Your City Sol was refunded — try again.", status: 500 };
  }
  return {
    ok: true,
    message: `${suite.name} is yours for ${officeTermLabel(termDays)} — ${price} City Sol. It is yours until ${claim.until}.`,
    claim: publicOfficeClaim(claim),
    district: suite.district,
    server,
    offices: await districtOfficeDirectory(suite.district, server, await readOfficeClaims(server)),
  };
}

async function releaseDistrictOffice(player, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5).", status: 400 };
  const suite = districtOfficeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  const claims = await readOfficeClaims(server);
  const claim = activeOfficeClaim(claims, suite.id, server);
  if (!claim) return { ok: false, message: `${suite.name} is not claimed on Server ${server}.`, status: 400 };
  if (claim.owner_id !== player.id) {
    return { ok: false, message: `Only ${claim.project} can release ${suite.name}.`, status: 400 };
  }
  await deleteOfficeClaim(suite.id, server);
  return {
    ok: true,
    message: `${suite.name} released. The lease ends now — no refund for the days left.`,
    district: suite.district,
    server,
    offices: await districtOfficeDirectory(suite.district, server, await readOfficeClaims(server)),
  };
}

async function addEvent(info) {
  const client = sb();
  if (client) {
    const { error } = await client.from("events").upsert({
      id: info.id,
      title: info.title,
      place: info.where,
      when_at: info.when,
      detail: info.detail,
    });
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO events (id, title, where_at, when_at, detail)
      VALUES (${info.id}, ${info.title}, ${info.where}, ${info.when}, ${info.detail})
      ON CONFLICT (id) DO NOTHING`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:events", { [info.id]: JSON.stringify(info) });
    return;
  }
  if (!memory().events.some((item) => item.id === info.id)) memory().events.push(info);
}

async function readEvents() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("events").select("id, title, place, when_at, detail");
    if (!error && data) {
      return data.map((row) => ({ id: row.id, title: row.title, where: row.place, when: row.when_at, detail: row.detail }));
    }
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT id, title, where_at AS "where", when_at AS "when", detail FROM events`;
    return rows;
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:events")) || {};
    return Object.values(all).map((row) => (typeof row === "string" ? JSON.parse(row) : row));
  }
  return memory().events;
}

function burnOf(price) {
  return Math.max(1, Math.round(price * BURN_RATE));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function livekitToken(identity, room) {
  const key = process.env.LIVEKIT_API_KEY || "";
  const secret = process.env.LIVEKIT_API_SECRET || "";
  if (!key || !secret || !process.env.LIVEKIT_URL) return null;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: key,
      sub: identity,
      nbf: now - 5,
      exp: now + 60 * 60,
      name: identity,
      video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function lobbiesFor(people) {
  const rooms = LOBBIES.map((room) => ({ ...room, members: [] }));
  const known = new Map(rooms.map((room) => [room.id, room]));
  for (const person of people) {
    if (!person.lobby) continue;
    let room = known.get(person.lobby);
    if (!room) {
      room = { id: person.lobby, name: person.lobby, members: [] };
      known.set(person.lobby, room);
      rooms.push(room);
    }
    room.members.push({ id: person.id, name: person.name, speaking: !!person.speaking });
  }
  return rooms;
}

async function spendItem(player, save, itemId) {
  const item = CATALOG[itemId];
  if (!item) return { ok: false, message: "That item is not for sale." };
  const isWardrobe = WARDROBE_KINDS.includes(item.kind);
  // Wardrobe pieces equip through the owned array: one eq:<kind>:<value>
  // entry per slot, replaced on every equip. No new column.
  const equipWardrobe = () => {
    player.owned = setEquippedOwned(player.owned, item.kind, item.value);
    save.owned = [...(player.owned || [])];
  };
  // Cosmetics are identity: equipping writes to the global row AND the
  // save, so the item shows up on every universe. City Sol is the
  // save's money: the check and the deduction use this universe's save.
  if (player.owned.includes(itemId)) {
    if (item.kind === "color") { player.color = item.value; save.color = item.value; }
    if (item.kind === "hat") { player.hat = item.value; save.hat = item.value; }
    if (item.kind === "car") { player.car = item.value; save.car = item.value; }
    if (item.kind === "trail") { player.trail = item.value; save.trail = item.value; }
    if (item.kind === "clothes") {
      player.owned = setWorn(player.owned, item.slot, item.value);
      save.owned = [...(player.owned || [])];
    }
    if (isWardrobe) equipWardrobe();
    await savePlayer(player);
    await saveSave(save);
    return { ok: true, message: "Already yours. Equipped.", me: publicPlayer(save) };
  }
  if (save.balance < item.price) return { ok: false, message: "Not enough City Sol." };
  // Clothes + wardrobe are City Sol only — no burn, per the
  // clothes-shop brief (buy+burn is ads/banners only). Every other shop
  // kind keeps the existing quarter-price City Sol burn tally.
  const burned = item.kind === "clothes" || item.noBurn ? 0 : burnOf(item.price);
  save.balance -= item.price;
  save.burned += burned;
  player.burned += burned;
  player.owned.push(itemId);
  save.owned = [...(player.owned || [])];
  if (item.kind === "color") { player.color = item.value; save.color = item.value; }
  if (item.kind === "hat") { player.hat = item.value; save.hat = item.value; }
  if (item.kind === "car") { player.car = item.value; save.car = item.value; }
  if (item.kind === "trail") { player.trail = item.value; save.trail = item.value; }
  if (item.kind === "clothes") {
    player.owned = setWorn(player.owned, item.slot, item.value);
    save.owned = [...(player.owned || [])];
  }
  if (isWardrobe) equipWardrobe();
  await savePlayer(player);
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    message: item.kind === "clothes" || item.noBurn
      ? `Spent ${item.price} City Sol.`
      : `Spent ${item.price} City Sol. Burned ${burned}. Burned total ${player.burned}.`,
    me: publicPlayer(save),
  };
}

// --- Clothes equip / unequip --------------------------------------------
// Switch between owned clothes, or take a slot off (id "" = back to the
// default look). No money moves here — the buy already happened through
// spendItem. Writes the worn marker on the per-server save AND the
// global player row (the same pair spendItem keeps in step), so the
// outfit survives reload and other players see it via sanitizeState.
async function equipClothesOp(player, save, body) {
  const slot = String(body.slot || "");
  if (!CLOTHES_SLOTS.has(slot)) return { ok: false, message: "Unknown clothing slot.", status: 400 };
  const id = String(body.id || "");
  if (!id) {
    player.owned = setWorn(player.owned, slot, null);
    save.owned = [...(player.owned || [])];
    await savePlayer(player);
    await saveSave(save);
    return { ok: true, message: "Taken off.", me: publicPlayer(save) };
  }
  const item = CATALOG[id];
  if (!item || item.kind !== "clothes" || item.slot !== slot) {
    return { ok: false, message: "That is not a piece of clothing for that slot.", status: 400 };
  }
  if (!player.owned.includes(id) && !save.owned.includes(id)) {
    return { ok: false, message: "You don't own that yet.", status: 400 };
  }
  player.owned = setWorn(player.owned, slot, item.value);
  save.owned = [...(player.owned || [])];
  await savePlayer(player);
  await saveSave(save);
  return { ok: true, message: "Equipped.", me: publicPlayer(save) };
}

// --- Wardrobe fits (style theme) ------------------------------------------
// Save / wear / delete a named fit: the current eq:<kind>:<value> slots
// (or the fit's slots) stored as one "fit:..." entry in `owned` — no new
// column, per-server via the save's owned mirror. All City Sol-free:
// no purchase happens here, so no balance or burn is touched.
async function saveFitOp(player, save, body) {
  const name = String(body.name || "").trim().slice(0, 24);
  if (!name) return { ok: false, message: "Name your fit first." };
  if (/[\n\r|]/.test(name)) return { ok: false, message: "That name has a character a fit can't hold." };
  const wardrobe = wardrobeFromOwned(player.owned);
  if (!WARDROBE_KINDS.some((kind) => wardrobe[kind])) {
    return { ok: false, message: "Wear something first — a fit needs at least one wardrobe piece." };
  }
  const existing = wardrobe.fits.filter((fit) => fit.name !== name);
  if (existing.length >= 8 && !wardrobe.fits.some((fit) => fit.name === name)) {
    return { ok: false, message: "You already have 8 saved fits — delete one first." };
  }
  player.owned = removeFitOwned(player.owned, name);
  player.owned.push(encodeFitEntry(name, wardrobe));
  save.owned = [...(player.owned || [])];
  await savePlayer(player);
  await saveSave(save);
  return { ok: true, message: `Saved fit "${name}".`, me: publicPlayer(save) };
}

async function wearFitOp(player, save, body) {
  const name = String(body.name || "").trim().slice(0, 24);
  const wardrobe = wardrobeFromOwned(player.owned);
  const fit = wardrobe.fits.find((item) => item.name === name);
  if (!fit) return { ok: false, message: "No saved fit by that name." };
  // Only slots the player still owns get worn — a fit never grants an
  // item that isn't in `owned` (a fit is a shortcut, not a purchase).
  let worn = 0;
  let owned = Array.isArray(player.owned) ? [...player.owned] : [];
  for (const kind of WARDROBE_KINDS) {
    const value = fit[kind];
    if (!value) continue;
    if (!owned.includes(`${kind}-${value}`)) continue;
    owned = setEquippedOwned(owned, kind, value);
    worn += 1;
  }
  if (!worn) return { ok: false, message: "You don't own any piece of that fit anymore." };
  player.owned = owned;
  save.owned = [...owned];
  await savePlayer(player);
  await saveSave(save);
  return { ok: true, message: `Wearing "${name}".`, me: publicPlayer(save) };
}

async function deleteFitOp(player, save, body) {
  const name = String(body.name || "").trim().slice(0, 24);
  const wardrobe = wardrobeFromOwned(player.owned);
  if (!wardrobe.fits.some((fit) => fit.name === name)) {
    return { ok: false, message: "No saved fit by that name." };
  }
  player.owned = removeFitOwned(player.owned, name);
  save.owned = [...(player.owned || [])];
  await savePlayer(player);
  await saveSave(save);
  return { ok: true, message: `Deleted fit "${name}".`, me: publicPlayer(save) };
}

// --- Garage (vehicles.ts catalog, mirrored — the server is the price
// authority; never trust a client-sent price) ---

async function buyCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const price = VEHICLE_PRICES[id];
  if (price == null) return { ok: false, message: "That vehicle is not for sale.", status: 400 };
  const colors = VEHICLE_COLORS[id] || [];
  const color = body.color == null || body.color === "" ? VEHICLE_DEFAULT_COLORS[id] : String(body.color);
  if (!colors.includes(color)) {
    return { ok: false, message: "That color is not available for this vehicle.", status: 400 };
  }
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  const owned = vehicles.find((v) => v.id === id);
  if (owned) {
    // Already theirs: equip it instead (same pattern as spendItem).
    // A new color repaints the stored car.
    if (body.color != null && body.color !== "") owned.color = color;
    save.vehicles = vehicles;
    save.activeVehicle = id;
    await saveSave(save);
    return { ok: true, message: "Already yours. Equipped.", me: publicPlayer(save) };
  }
  if (save.balance < price) return { ok: false, message: "Not enough City Sol.", status: 400 };
  // Garage parking: 3 cars fit to start, +2 per slots tier (max 9).
  // Cars already owned are never taken away — an over-cap garage (bought
  // before the CARS expansion) just cannot buy another car until it is
  // expanded. Rentals do not count toward owned parking.
  const garage = garageOf(save);
  if (vehicles.length >= garageCap(garage)) {
    return { ok: false, message: `Your garage is full (${vehicles.length}/${garageCap(garage)} cars) — upgrade it for more parking.`, status: 400 };
  }
  // City Sol only: no burn, no burned increment — a vehicle is a
  // purchase, not a burn event.
  save.balance -= price;
  vehicles.push({ id, color });
  save.vehicles = vehicles;
  save.activeVehicle = id;
  await saveSave(save);
  return {
    ok: true,
    message: `Bought ${VEHICLE_NAMES[id] || id} for ${price} City Sol.`,
    me: publicPlayer(save),
  };
}

async function selectCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  if (!vehicles.some((v) => v.id === id)) {
    return { ok: false, message: "You don't own that car yet.", status: 400 };
  }
  save.activeVehicle = id;
  await saveSave(save);
  return { ok: true, me: publicPlayer(save) };
}

// --- CARS: customize / wash / repair / garage upgrades / wear sync -------
// All City Sol only, per-car, per-server. Mods + wear live on the owned
// vehicle entry inside save.vehicles (no new DB column); garage upgrades
// live on save.homes.garage (see the constants block above).
async function customizeCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  const entry = vehicles.find((v) => v.id === id);
  if (!entry) return { ok: false, message: "You don't own that car yet.", status: 400 };
  const mod = String(body.mod || "");
  const value = body.value === undefined ? null : body.value;
  // Paint first: a free shop colour is not a premium paint — repainting
  // to one of them goes through buy-car (already-owned = repaint). This
  // check must run before modPrice, which rejects non-premium paints.
  if (mod === "paint" && typeof value === "string" && (VEHICLE_COLORS[id] || []).includes(value)) {
    return { ok: false, message: "That paint is free in the shop — premium paints only here.", status: 400 };
  }
  const price = modPrice(mod, value);
  if (price == null) return { ok: false, message: "That mod is not available.", status: 400 };
  const mods = normalizeMods(entry.mods);
  const garage = garageOf(save);
  // Engine / tires are bought in order, one stage at a time; the top
  // stage needs the home workshop (advanced tuning).
  if (mod === "engine") {
    const level = Math.floor(Number(value));
    if (level !== mods.engine + 1) {
      return { ok: false, message: level <= mods.engine ? "That stage is already fitted." : "Buy the stages in order.", status: 400 };
    }
    if (level === 3 && !garage.workshop) {
      return { ok: false, message: "Stage 3 needs your home workshop — upgrade the garage first.", status: 400 };
    }
  }
  if (mod === "tires") {
    const level = Math.floor(Number(value));
    if (level !== mods.tires + 1) {
      return { ok: false, message: level <= mods.tires ? "Those tires are already fitted." : "Buy the tire levels in order.", status: 400 };
    }
    if (level === 2 && !garage.workshop) {
      return { ok: false, message: "Race tires need your home workshop — upgrade the garage first.", status: 400 };
    }
  }
  // Paint: premium paints only (the free-colour case is refused above,
  // before modPrice).
  if (mod === "paint") {
    if (entry.color === value) return { ok: false, message: "Already that colour.", status: 400 };
  }
  if (mod === "rims" && mods.rims === value) return { ok: false, message: "Those rims are already fitted.", status: 400 };
  if (mod === "spoiler" && mods.spoiler === value) return { ok: false, message: "That spoiler is already fitted.", status: 400 };
  if (mod === "neon" && mods.neon === value) return { ok: false, message: value === null ? "No underglow fitted." : "That underglow is already fitted.", status: 400 };
  if (mod === "tint" && mods.tint === Math.floor(Number(value))) return { ok: false, message: "That tint is already fitted.", status: 400 };
  if (save.balance < price) return { ok: false, message: "Not enough City Sol.", status: 400 };
  // City Sol only: no burn, no burned increment — a mod is a purchase.
  save.balance -= price;
  if (mod === "paint") entry.color = String(value);
  else if (mod === "rims") mods.rims = value;
  else if (mod === "spoiler") mods.spoiler = value;
  else if (mod === "neon") mods.neon = value;
  else if (mod === "tint") mods.tint = Math.floor(Number(value));
  else if (mod === "engine") mods.engine = Math.floor(Number(value));
  else if (mod === "tires") mods.tires = Math.floor(Number(value));
  entry.mods = mods;
  save.vehicles = vehicles;
  await saveSave(save);
  const label = mod === "paint" ? `Premium paint` : mod === "neon" ? (value === null ? "Underglow removed" : "Neon underglow") : mod;
  return { ok: true, message: price === 0 ? `${label} fitted — free.` : `${label} fitted for ${price} City Sol.`, me: publicPlayer(save) };
}

async function washCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  const entry = vehicles.find((v) => v.id === id);
  if (!entry) return { ok: false, message: "You don't own that car yet.", status: 400 };
  const wear = normalizeWear(entry);
  if (wear.dirt <= 0) return { ok: false, message: "Already clean.", status: 400 };
  const garage = garageOf(save);
  const cost = Math.round(washCost(wear.dirt) * (garage.workshop ? 1 - WORKSHOP_DISCOUNT : 1));
  if (save.balance < cost) return { ok: false, message: "Not enough City Sol.", status: 400 };
  save.balance -= cost;
  entry.dirt = 0;
  save.vehicles = vehicles;
  await saveSave(save);
  return { ok: true, message: `Washed clean for ${cost} City Sol.`, me: publicPlayer(save) };
}

async function repairCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  const entry = vehicles.find((v) => v.id === id);
  if (!entry) return { ok: false, message: "You don't own that car yet.", status: 400 };
  const wear = normalizeWear(entry);
  if (wear.damage <= 0) return { ok: false, message: "No damage to fix.", status: 400 };
  const garage = garageOf(save);
  const cost = Math.round(repairCost(wear.damage) * (garage.workshop ? 1 - WORKSHOP_DISCOUNT : 1));
  if (save.balance < cost) return { ok: false, message: "Not enough City Sol.", status: 400 };
  save.balance -= cost;
  entry.damage = 0;
  save.vehicles = vehicles;
  await saveSave(save);
  return { ok: true, message: `Repaired for ${cost} City Sol.`, me: publicPlayer(save) };
}

async function upgradeGarage(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const upgrade = String(body.upgrade || "");
  const garage = garageOf(save);
  const price = garageUpgradePrice(upgrade, garage);
  if (price == null) return { ok: false, message: "That upgrade is already owned — or maxed out.", status: 400 };
  if (save.balance < price) return { ok: false, message: "Not enough City Sol.", status: 400 };
  save.balance -= price;
  if (upgrade === "slots") garage.slots += 1;
  else if (upgrade === "workshop") garage.workshop = true;
  else if (upgrade === "showroom") garage.showroom = true;
  setGarage(save, garage);
  await saveSave(save);
  const label = upgrade === "slots" ? `Parking expanded — ${garageCap(garage)} cars now fit` : upgrade === "workshop" ? "Workshop installed" : "Showroom installed";
  return { ok: true, message: `${label} for ${price} City Sol.`, me: publicPlayer(save) };
}

// Client-attested wear: the client reports how far it drove and how many
// crashes since the last sync; the server applies the same accumulateWear
// rule and clamps the report, so a tampered client can only dirty its own
// car (wear only ever hurts the car — it cannot mint money).
async function syncVehicleWear(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  const entry = vehicles.find((v) => v.id === id);
  if (!entry) return { ok: false, message: "You don't own that car yet.", status: 400 };
  const distance = Math.max(0, Math.min(5000, Number(body.distance) || 0));
  const crashes = Math.max(0, Math.min(25, Math.floor(Number(body.crashes) || 0)));
  const wear = accumulateWear(normalizeWear(entry), distance, crashes);
  entry.dirt = wear.dirt;
  entry.damage = wear.damage;
  save.vehicles = vehicles;
  await saveSave(save);
  return { ok: true, vehicle: sanitizeVehicles([entry])[0], me: publicPlayer(save) };
}

// --- Garage rentals (0.5 City Sol/day, paid up front) ------------------
// One live rental per save; the rented car is NOT added to save.vehicles
// (the client spawns it from me.rental instead) and save.activeVehicle is
// untouched, so the owned car comes back on its own when the rental ends.

async function liveRental(save) {
  if (!save.rental || typeof save.rental.id !== "string") return null;
  if (Number(save.rental.expiresAt || 0) > Date.now()) return save.rental;
  save.rental = null;
  await saveSave(save);
  return null;
}

// Overlay the current universe's per-server garage data onto a `me`
// built from the global player row. The 250ms sync heartbeat overwrites
// world.me, and the client's applyMe() copies it into local state —
// without this, a live rental and the owned cars were wiped from the
// client seconds after renting/buying (the car entity stayed spawned and
// drivable, the rental line vanished, and the rental's client-side expiry
// never fired). Balance is NOT overlaid: the displayed balance stays the
// global one (pre-existing; the universe ledger's balance only shows
// right after a garage op).
async function overlaySaveGarage(player, body, me) {
  const server = heartbeatServer(body, player);
  if (!server) return me;
  const save = await saveKey(player.id, server);
  if (!save) return me;
  me.vehicles = sanitizeVehicles(save.vehicles);
  me.activeVehicle = save.activeVehicle || null;
  me.garage = sanitizeGarage(save.homes?.garage);
  me.rental = sanitizeRental(await liveRental(save));
  return me;
}

async function rentCar(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const id = String(body.id || "");
  if (VEHICLE_PRICES[id] == null) return { ok: false, message: "That vehicle is not for rent.", status: 400 };
  const colors = VEHICLE_COLORS[id] || [];
  const color = body.color == null || body.color === "" ? VEHICLE_DEFAULT_COLORS[id] : String(body.color);
  if (!colors.includes(color)) {
    return { ok: false, message: "That color is not available for this vehicle.", status: 400 };
  }
  const days = Math.floor(Number(body.days || 0));
  if (!Number.isFinite(days) || days < RENTAL_MIN_DAYS || days > RENTAL_MAX_DAYS) {
    return { ok: false, message: `Rent ${RENTAL_MIN_DAYS}–${RENTAL_MAX_DAYS} days at a time.`, status: 400 };
  }
  const vehicles = Array.isArray(save.vehicles) ? save.vehicles : [];
  if (vehicles.some((v) => v.id === id)) {
    return { ok: false, message: "You already own that car — select it instead.", status: 400 };
  }
  const existing = await liveRental(save);
  if (existing) {
    return { ok: false, message: `You already have ${VEHICLE_NAMES[existing.id] || existing.id} rented — return it first.`, status: 400 };
  }
  // City Sol only: no burn, no burned increment — a rental is a loan,
  // not a purchase or a burn event.
  const cost = rentalCost(days);
  if (save.balance < cost) return { ok: false, message: "Not enough City Sol.", status: 400 };
  save.balance -= cost;
  save.rental = { id, color, days, expiresAt: Date.now() + days * RENTAL_DAY_MS };
  await saveSave(save);
  return {
    ok: true,
    message: `Rented ${VEHICLE_NAMES[id] || id} for ${days} days — ${cost} City Sol (0.5/day).`,
    rental: sanitizeRental(save.rental),
    me: publicPlayer(save),
  };
}

async function rentalStatusOp(save) {
  const rental = await liveRental(save);
  return { ok: true, rental: sanitizeRental(rental), me: publicPlayer(save) };
}

async function returnRental(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Unknown server.", status: 400 };
  const rental = await liveRental(save);
  if (!rental) return { ok: false, message: "No active rental.", status: 400 };
  const name = VEHICLE_NAMES[rental.id] || rental.id;
  save.rental = null;
  await saveSave(save);
  return { ok: true, message: `Returned ${name}.`, rental: null, me: publicPlayer(save) };
}

// --- Homes (homes.ts catalog, mirrored) ---

async function buyHome(player, save, body) {
  const homeId = String(body.home || "");
  const price = HOME_PRICES[homeId];
  if (price == null) return { ok: false, message: "Unknown home.", status: 400 };
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  if ((homes.homes || []).some((h) => h.homeId === homeId && h.server === server)) {
    return { ok: false, message: "You already own this home on this server.", status: 400 };
  }
  if (save.balance < price) {
    return { ok: false, message: `Not enough City Sol — this home is ${price}.`, status: 400 };
  }
  save.balance -= price;
  player.balance = save.balance;
  homes.homes.push({
    homeId,
    server,
    ownerId: save.id,
    ownerName: save.name,
    price,
    boughtAt: Date.now(),
    // CRIB: first week's bills are due 7 days after purchase.
    crib: freshHomeCrib(price, Date.now()),
  });
  homes.homeServer = server; // buying here makes this server their home server
  save.homes = homes;
  await saveSave(save);
  if (player.homeServer !== server) player.homeServer = server;
  await savePlayer(player);
  return { ok: true, home: homeId, price, server, me: publicPlayer(save) };
}

// --- PEOPLE: roommates + guests, house parties, property empire, meet people
// City Sol only, no burn, no wallet. NO new DB column: every bit of PEOPLE
// state lives inside the EXISTING player_saves.homes JSON (the same TEXT
// column buyHome already writes), next to homeServer/homes:
//
//   save.homes.rentals: { [homeId]: { tenant, weeklyRent, nextRentAt, startedAt, collected } }
//   save.homes.people:  { [npcName]: { talks, lastTalkAt } }          // relationships
//   save.homes.party:   { homeId, startedAt, endsAt, cost, guests: [name] } | null
//   save.homes.guests:  { [name]: { kind: "npc"|"friend", homeId, until, party?: bool } }
//
// Relationships are per (player, server) — same scope as homes. `daily`
// was NOT used: ensureDaily() rebuilds it every new day, which would wipe
// friendships overnight. Rent is 5% of the home price per week, first
// payout 7 days after rent-out, at most 4 unpaid weeks accrue (same cap
// pattern as the lot-rent arrears in live.js). A party costs 50 City Sol
// and lasts 10 minutes; a guest visit lasts 10 minutes.
const PEOPLE_WEEK_MS = 7 * 86400000;
const PEOPLE_TALK_COOLDOWN_MS = 5000;
const PEOPLE_GUEST_MS = 10 * 60 * 1000;
const PEOPLE_PARTY_MS = 10 * 60 * 1000;
const PEOPLE_PARTY_COST = 50;
const PEOPLE_MAX_PARTY_GUESTS = 5;
const PEOPLE_MAX_UNPAID_WEEKS = 4;
// Tenants are fictional renters (not the 14 talkable NPCs — those keep
// their patrols). The tenant for a home is deterministic from its id.
const PEOPLE_TENANTS = ["Alex", "Sam", "Jordan", "Casey", "Morgan", "Riley", "Taylor", "Jamie", "Robin", "Avery"];
// Mirror of content.ts NPC_LINES (name -> role). The server is the
// authority for who can be talked to; the client renders the same list.
const PEOPLE_NPCS = {
  Rio: "Plaza regular",
  Mina: "Barista, Cafe Nova",
  Sol: "Shopkeeper, OrbitX Shop",
  Nox: "Mall regular",
  Pia: "Vendor, Night Market",
  Kai: "Dock hand, Harbor",
  Juno: "Hall host & DJ",
  Theo: "Photographer",
  Vera: "Usher, OrbitX Cinema",
  Otis: "Librarian, OrbitX Library",
  Remy: "Trainer, Harbor Gym",
  Wren: "Gardener, Sunset Park",
  Nadia: "Teller, OrbitX Bank",
  Felix: "Arcade champion",
};
const PEOPLE_REL_STEPS = [
  { min: 0, label: "Stranger" },
  { min: 1, label: "Acquaintance" },
  { min: 3, label: "Friend" },
  { min: 8, label: "Close Friend" },
  { min: 15, label: "Best Friend" },
];

function peopleRelLevel(talks) {
  let level = 0;
  for (let i = 0; i < PEOPLE_REL_STEPS.length; i++) {
    if (Number(talks || 0) >= PEOPLE_REL_STEPS[i].min) level = i;
  }
  return level;
}

function peopleRelLabel(level) {
  return PEOPLE_REL_STEPS[Math.min(level, PEOPLE_REL_STEPS.length - 1)].label;
}

/** Weekly rent for a home: 5% of its price, rounded to the nearest 10. */
function peopleWeeklyRent(price) {
  return Math.max(10, Math.round((Number(price || 0) * 0.05) / 10) * 10);
}

function peopleTenantFor(homeId) {
  let hash = 0;
  for (const ch of String(homeId || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PEOPLE_TENANTS[hash % PEOPLE_TENANTS.length];
}

/** Normalize the PEOPLE keys on a homes blob (tolerates old saves). */
function ensurePeople(homes) {
  if (!homes || !Array.isArray(homes.homes)) homes = { homeServer: 0, homes: [] };
  if (!homes.rentals || typeof homes.rentals !== "object" || Array.isArray(homes.rentals)) homes.rentals = {};
  if (!homes.people || typeof homes.people !== "object" || Array.isArray(homes.people)) homes.people = {};
  if (homes.party !== null && (typeof homes.party !== "object" || Array.isArray(homes.party))) homes.party = null;
  if (homes.party === undefined) homes.party = null;
  if (!homes.guests || typeof homes.guests !== "object" || Array.isArray(homes.guests)) homes.guests = {};
  return homes;
}

/** Drop expired guests and an ended party (party guests leave with it). */
function prunePeople(homes, now = Date.now()) {
  const party = homes.party;
  if (party && Number(party.endsAt || 0) <= now) {
    for (const name of Object.keys(homes.guests)) {
      if (homes.guests[name]?.party) delete homes.guests[name];
    }
    homes.party = null;
  }
  for (const name of Object.keys(homes.guests)) {
    if (Number(homes.guests[name]?.until || 0) <= now) delete homes.guests[name];
  }
  return homes;
}

function peopleRelationship(npc, rec) {
  const talks = Number(rec?.talks || 0);
  const level = peopleRelLevel(talks);
  return {
    npc,
    role: PEOPLE_NPCS[npc] || "Citizen",
    talks,
    level,
    label: peopleRelLabel(level),
    // Friends (level 2+) can be invited over AND come to house parties
    // (party-start invites level 2+, Close Friends first); level is also
    // what gates the auto-visit when Friend is reached.
    canVisit: level >= 2,
    canParty: level >= 2,
    lastTalkAt: Number(rec?.lastTalkAt || 0),
  };
}

/** Whole weeks of rent owed right now (0 when nothing is due yet). */
function peopleRentalDue(rental, now = Date.now()) {
  const next = Number(rental?.nextRentAt || 0);
  if (!next || now < next) return 0;
  return Math.min(PEOPLE_MAX_UNPAID_WEEKS, Math.floor((now - next) / PEOPLE_WEEK_MS) + 1);
}

function peopleRentalPublic(homeId, rental, now = Date.now()) {
  const weeksDue = peopleRentalDue(rental, now);
  return {
    homeId,
    tenant: String(rental?.tenant || ""),
    weeklyRent: Number(rental?.weeklyRent || 0),
    nextRentAt: Number(rental?.nextRentAt || 0),
    startedAt: Number(rental?.startedAt || 0),
    collected: Number(rental?.collected || 0),
    weeksDue,
    due: weeksDue * Number(rental?.weeklyRent || 0),
  };
}

function peoplePartyPublic(party, now = Date.now()) {
  if (!party) return null;
  return {
    homeId: String(party.homeId || ""),
    startedAt: Number(party.startedAt || 0),
    endsAt: Number(party.endsAt || 0),
    endsInMs: Math.max(0, Number(party.endsAt || 0) - now),
    cost: Number(party.cost || 0),
    guests: Array.isArray(party.guests) ? [...party.guests] : [],
  };
}

function peopleGuestsPublic(guests, now = Date.now()) {
  return Object.entries(guests || {})
    .filter(([, g]) => Number(g?.until || 0) > now)
    .map(([name, g]) => ({
      name,
      kind: g?.kind === "friend" ? "friend" : "npc",
      homeId: String(g?.homeId || ""),
      until: Number(g?.until || 0),
      endsInMs: Math.max(0, Number(g?.until || 0) - now),
    }));
}

/** The whole PEOPLE snapshot for one save: relationships + rentals + party + guests. */
function peopleStatusFor(save, now = Date.now()) {
  const homes = save ? ensurePeople(save.homes) : { homeServer: 0, homes: [], rentals: {}, people: {}, party: null, guests: {} };
  if (save) prunePeople(homes, now);
  return {
    relationships: Object.keys(PEOPLE_NPCS).map((npc) => peopleRelationship(npc, homes.people[npc] || {})),
    rentals: Object.entries(homes.rentals).map(([homeId, rental]) => peopleRentalPublic(homeId, rental, now)),
    party: peoplePartyPublic(homes.party, now),
    guests: peopleGuestsPublic(homes.guests, now),
  };
}

/** Homes this save owns on one server (server-scoped, like buyHome). */
function peopleOwnedHomes(save, server) {
  const homes = save?.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  return (homes.homes || []).filter((h) => h.server === server);
}

/** First owned home on this server, or the requested one if owned + not rented. */
function peoplePickHome(save, server, homeId) {
  const owned = peopleOwnedHomes(save, server);
  if (homeId) {
    const found = owned.find((h) => h.homeId === homeId);
    if (!found) return { ok: false, message: "You do not own that home on this server." };
    return { ok: true, home: found };
  }
  if (!owned.length) return { ok: false, message: "Buy a home on this server first." };
  return { ok: true, home: owned[0] };
}

async function peopleTalk(player, save, body) {
  const npc = String(body.npc || "");
  if (!PEOPLE_NPCS[npc]) return { ok: false, message: "That is not someone you can talk to here.", status: 400 };
  const now = Date.now();
  const homes = ensurePeople(save.homes);
  const rec = homes.people[npc] && typeof homes.people[npc] === "object" ? homes.people[npc] : { talks: 0, lastTalkAt: 0 };
  if (now - Number(rec.lastTalkAt || 0) < PEOPLE_TALK_COOLDOWN_MS) {
    return { ok: true, relationship: peopleRelationship(npc, rec), visited: false, message: `${npc} is still mid-sentence — give it a moment.`, me: publicPlayer(save) };
  }
  const beforeLevel = peopleRelLevel(rec.talks || 0);
  rec.talks = Number(rec.talks || 0) + 1;
  rec.lastTalkAt = now;
  homes.people[npc] = rec;
  const relationship = peopleRelationship(npc, rec);
  // Reaching Friend: they like you enough to come over — if you own a
  // home on this server, they visit it now (10 minutes, visible inside).
  let visited = false;
  let message = `You chatted with ${npc} — ${relationship.label} (${relationship.talks} chat${relationship.talks === 1 ? "" : "s"}).`;
  if (beforeLevel < 2 && relationship.level >= 2) {
    const server = Number(save.serverId ?? save.server ?? 0);
    const owned = peopleOwnedHomes(save, server);
    if (owned.length) {
      const home = owned[0];
      homes.guests[npc] = { kind: "npc", homeId: home.homeId, until: now + PEOPLE_GUEST_MS };
      visited = true;
      message = `${npc} is a Friend now — they are coming over to your place!`;
    } else {
      message = `${npc} is a Friend now — buy a home and they will come over.`;
    }
  }
  save.homes = homes;
  await saveSave(save);
  return { ok: true, relationship, visited, ...peopleStatusFor(save, now), message, me: publicPlayer(save) };
}

async function peopleInvite(player, save, body) {
  const now = Date.now();
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homes = ensurePeople(save.homes);
  prunePeople(homes, now);
  const pick = peoplePickHome(save, server, String(body.home || ""));
  if (!pick.ok) return { ok: false, message: pick.message, status: 400 };
  const home = pick.home;
  if (homes.rentals[home.homeId]) {
    return { ok: false, message: "That home is rented out — the tenant lives there now.", status: 400 };
  }
  const npc = String(body.npc || "");
  const friendId = String(body.player || "");
  let name = "";
  let kind = "npc";
  if (npc) {
    if (!PEOPLE_NPCS[npc]) return { ok: false, message: "That is not someone you can invite.", status: 400 };
    const relationship = peopleRelationship(npc, homes.people[npc] || {});
    if (!relationship.canVisit) {
      return { ok: false, message: `${npc} is ${relationship.label} — chat ${3 - relationship.talks} more time${3 - relationship.talks === 1 ? "" : "s"} to become Friends first.`, status: 400 };
    }
    name = npc;
  } else if (friendId) {
    const friend = (player.friends || []).find((f) => f.id === friendId);
    if (!friend) return { ok: false, message: "Invite a friend from your friends list first.", status: 400 };
    name = friend.name;
    kind = "friend";
  } else {
    return { ok: false, message: "Pick someone to invite — an NPC friend or a friend from your list.", status: 400 };
  }
  homes.guests[name] = { kind, homeId: home.homeId, until: now + PEOPLE_GUEST_MS };
  save.homes = homes;
  await saveSave(save);
  return { ok: true, ...peopleStatusFor(save, now), message: `${name} is on their way over — they will hang out at your place for 10 minutes.`, me: publicPlayer(save) };
}

async function peoplePartyStart(player, save, body) {
  const now = Date.now();
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homes = ensurePeople(save.homes);
  prunePeople(homes, now);
  if (homes.party) {
    return { ok: false, message: "A party is already going — it ends soon, then you can throw another.", status: 400 };
  }
  const pick = peoplePickHome(save, server, String(body.home || ""));
  if (!pick.ok) return { ok: false, message: pick.message, status: 400 };
  const home = pick.home;
  if (homes.rentals[home.homeId]) {
    return { ok: false, message: "That home is rented out — throw the party at a place you live in.", status: 400 };
  }
  if (save.balance < PEOPLE_PARTY_COST) {
    return { ok: false, message: `A party costs ${PEOPLE_PARTY_COST} City Sol for food and drinks.`, status: 400 };
  }
  // Who shows up: Close Friends first, then Friends, most-talked first.
  const ranked = Object.keys(PEOPLE_NPCS)
    .map((npc) => peopleRelationship(npc, homes.people[npc] || {}))
    .filter((rel) => rel.level >= 2)
    .sort((a, b) => b.level - a.level || b.talks - a.talks)
    .slice(0, PEOPLE_MAX_PARTY_GUESTS);
  save.balance -= PEOPLE_PARTY_COST;
  const party = {
    homeId: home.homeId,
    startedAt: now,
    endsAt: now + PEOPLE_PARTY_MS,
    cost: PEOPLE_PARTY_COST,
    guests: ranked.map((rel) => rel.npc),
  };
  homes.party = party;
  for (const rel of ranked) {
    homes.guests[rel.npc] = { kind: "npc", homeId: home.homeId, until: party.endsAt, party: true };
  }
  save.homes = homes;
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    ...peopleStatusFor(save, now),
    message: ranked.length
      ? `Party on! ${ranked.map((r) => r.npc).join(", ")} came over — music, food and drinks are out for 10 minutes.`
      : `Party on! Food and drinks are out for 10 minutes — make some Friends and they will show up next time.`,
    me: publicPlayer(save),
  };
}

// --- Home furniture ops (shop + Edit Home) ---

function furnitureListOp(save) {
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  return {
    ok: true,
    catalog: furnitureCatalogPublic(),
    owned: sanitizeFurnitureOwned(homes.furnitureOwned),
    placed: sanitizeFurnitureMap(homes.furniture),    me: publicPlayer(save),
  };
}

async function furnitureBuyOp(player, save, body) {
  const itemId = String(body.item || "");
  const item = FURNITURE_CATALOG[itemId];
  if (!item) return { ok: false, message: "That furniture is not for sale.", status: 400 };
  if (save.balance < item.price) return { ok: false, message: "Not enough City Sol.", status: 400 };
  // City Sol only: a furniture buy is a purchase, not a burn event.
  save.balance -= item.price;
  player.balance = save.balance;
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  homes.furnitureOwned = [...sanitizeFurnitureOwned(homes.furnitureOwned), itemId];
  save.homes = homes;
  await saveSave(save);
  return { ok: true, message: `Bought ${item.name} for ${item.price} City Sol — place it in Edit Home.`, item: itemId, owned: homes.furnitureOwned, me: publicPlayer(save) };
}

async function furnitureSaveOp(save, body) {
  const server = parseServerId(body.server);
  const homeId = String(body.home || "");
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  if (!(homes.homes || []).some((h) => h.homeId === homeId && h.server === server)) {
    return { ok: false, message: "You can only decorate a home you own on this server.", status: 400 };
  }
  const pieces = sanitizeFurniturePlaced(body.furniture);
  const owned = sanitizeFurnitureOwned(homes.furnitureOwned);
  const counts = {};
  for (const piece of pieces) counts[piece.item] = (counts[piece.item] || 0) + 1;
  for (const [itemId, n] of Object.entries(counts)) {
    const have = owned.filter((id) => id === itemId).length;
    if (n > have) {
      return { ok: false, message: `You only own ${have} ${FURNITURE_CATALOG[itemId]?.name || itemId} — buy another in the shop first.`, status: 400 };
    }
  }
  const furniture = sanitizeFurnitureMap(homes.furniture);
  furniture[homeId] = pieces;
  homes.furniture = furniture;
  save.homes = homes;
  await saveSave(save);
  return { ok: true, message: "Home saved.", placed: pieces, me: publicPlayer(save) };
}

async function furnitureSellOp(player, save, body) {
  const itemId = String(body.item || "");
  const item = FURNITURE_CATALOG[itemId];
  if (!item) return { ok: false, message: "That furniture is not for sale.", status: 400 };
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  const owned = sanitizeFurnitureOwned(homes.furnitureOwned);
  const idx = owned.indexOf(itemId);
  if (idx < 0) return { ok: false, message: `You don't own a ${item.name}.`, status: 400 };
  const furniture = sanitizeFurnitureMap(homes.furniture);
  const placedCount = Object.values(furniture).flat().filter((p) => p.item === itemId).length;
  if (owned.length - placedCount <= 0) {
    return { ok: false, message: `Your ${item.name} is placed in your home — remove it in Edit Home first.`, status: 400 };
  }
  owned.splice(idx, 1);
  homes.furnitureOwned = owned;
  save.homes = homes;
  const refund = Math.floor(item.price / 2);
  save.balance += refund;
  player.balance = save.balance;
  await saveSave(save);
  return { ok: true, message: `Sold ${item.name} for ${refund} City Sol.`, refund, owned, me: publicPlayer(save) };
}

async function peoplePartyEnd(player, save) {
  const homes = ensurePeople(save.homes);
  if (!homes.party) return { ok: false, message: "No party is going right now.", status: 400 };
  for (const name of Object.keys(homes.guests)) {
    if (homes.guests[name]?.party) delete homes.guests[name];
  }
  homes.party = null;
  save.homes = homes;
  await saveSave(save);
  return { ok: true, ...peopleStatusFor(save, Date.now()), message: "Party over — everyone headed home.", me: publicPlayer(save) };
}

async function peopleRentOut(player, save, body) {
  const now = Date.now();
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homeId = String(body.home || "");
  if (HOME_PRICES[homeId] == null) return { ok: false, message: "Unknown home.", status: 400 };
  const homes = ensurePeople(save.homes);
  prunePeople(homes, now);
  const owned = peopleOwnedHomes(save, server).find((h) => h.homeId === homeId);
  if (!owned) return { ok: false, message: "You do not own that home on this server.", status: 400 };
  if (homes.rentals[homeId]) return { ok: false, message: "That home is already rented out.", status: 400 };
  if (homes.party?.homeId === homeId) {
    return { ok: false, message: "A party is going at that home — rent it out after the party ends.", status: 400 };
  }
  const weeklyRent = peopleWeeklyRent(owned.price || HOME_PRICES[homeId]);
  homes.rentals[homeId] = {
    tenant: peopleTenantFor(homeId),
    weeklyRent,
    nextRentAt: now + PEOPLE_WEEK_MS,
    startedAt: now,
    collected: 0,
  };
  save.homes = homes;
  await saveSave(save);
  return {
    ok: true,
    ...peopleStatusFor(save, now),
    message: `Rented out to ${homes.rentals[homeId].tenant} — ${weeklyRent} City Sol a week, first payout in 7 days.`,
    me: publicPlayer(save),
  };
}

async function peopleEndRent(player, save, body) {
  const now = Date.now();
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const homeId = String(body.home || "");
  const homes = ensurePeople(save.homes);
  prunePeople(homes, now);
  const rental = homes.rentals[homeId];
  if (!rental) return { ok: false, message: "That home is not rented out.", status: 400 };
  // Ending a lease settles what the tenant owes first — the money is yours.
  // peopleRentalDue returns WEEKS owed, not money: multiply by the weekly
  // rent (the first draft added the week count itself to the balance).
  const weeks = peopleRentalDue(rental, now);
  const due = weeks * Number(rental.weeklyRent || 0);
  if (weeks > 0) {
    save.balance += due;
    rental.collected = Number(rental.collected || 0) + due;
  }
  const tenant = rental.tenant;
  delete homes.rentals[homeId];
  save.homes = homes;
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    ...peopleStatusFor(save, now),
    collected: due,
    message: due > 0
      ? `Lease ended — ${tenant} moved out and paid ${due} City Sol owed (${weeks} week${weeks === 1 ? "" : "s"}).`
      : `Lease ended — ${tenant} moved out. The home is yours again.`,
    me: publicPlayer(save),
  };
}

async function peopleCollectRent(player, save) {
  const now = Date.now();
  const homes = ensurePeople(save.homes);
  prunePeople(homes, now);
  let collected = 0;
  const paid = [];
  for (const [homeId, rental] of Object.entries(homes.rentals)) {
    const weeks = peopleRentalDue(rental, now);
    if (!weeks) continue;
    const due = weeks * Number(rental.weeklyRent || 0);
    rental.nextRentAt = Number(rental.nextRentAt || 0) + weeks * PEOPLE_WEEK_MS;
    rental.collected = Number(rental.collected || 0) + due;
    collected += due;
    paid.push({ homeId, tenant: rental.tenant, weeks, amount: due });
  }
  if (!collected) {
    const next = Object.values(homes.rentals).map((r) => Number(r.nextRentAt || 0)).filter(Boolean);
    const soonest = next.length ? Math.max(0, Math.min(...next) - now) : 0;
    const days = Math.ceil(soonest / 86400000);
    return {
      ok: true,
      ...peopleStatusFor(save, now),
      collected: 0,
      message: next.length ? `No rent due yet — next payout in ${days} day${days === 1 ? "" : "s"}.` : "Nothing rented out — rent out a home you own to earn weekly City Sol.",
      me: publicPlayer(save),
    };
  }
  save.balance += collected;
  save.earned = Number(save.earned || 0) + collected;
  save.homes = homes;
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    ...peopleStatusFor(save, now),
    collected,
    paid,
    message: `Collected ${collected} City Sol in rent.`,
    me: publicPlayer(save),
  };}

// --- CRAZY home extras: pool / hot tub, theater, rooftop, plants, seasons
// City Sol only, no real SOL, no burn, no wallet. All data lives inside
// the EXISTING `homes` JSON column of player_saves — no new DB column:
//   save.homes = {
//     homeServer, homes: [ { homeId, server, ownerId, ownerName, price,
//       boughtAt, tier?, crazy: { pool, theater, rooftop, plants[], decor } } ],
//     season: "auto" | "winter" | "halloween" | "spring" | "summer" }
// `pool` is "pool" | "hottub" | null; `theater` / `rooftop` booleans;
// `plants` is [{ id, kind, plantedAt, wateredMs, wateringSince }];
// `decor` is { lights?, pumpkins?, flowers?, lanterns? } (booleans).
// The season override is per-save (per server); "auto" means date-driven
// for everyone. Growth stages are DERIVED from the timestamps on read,
// never stored — a plant can only grow while watered, and watering keeps
// it wet for CRAZY_WATER_WINDOW_MS.
const CRAZY_SEASONS = ["winter", "halloween", "spring", "summer"];
const CRAZY_POOL_PRICE = 900;
const CRAZY_HOTTUB_PRICE = 450;
const CRAZY_THEATER_PRICE = 1200;
const CRAZY_ROOFTOP_PRICE = 1500;
const CRAZY_PLANT_PRICES = { sunflower: 40, rose: 60, palm: 150 };
const CRAZY_PLANT_HARVEST_MULT = 2;
const CRAZY_MAX_PLANTS = 6;
const CRAZY_DECOR_PRICES = { lights: 250, pumpkins: 200, flowers: 150, lanterns: 180 };
const CRAZY_WATER_WINDOW_MS = 10 * 60 * 1000;
const CRAZY_GROW_SMALL_MS = 60 * 1000;
const CRAZY_GROW_GROWN_MS = 5 * 60 * 1000;

function crazySeasonForDate(when = Date.now()) {
  const month = new Date(when).getMonth(); // 0 = January
  if (month === 9) return "halloween";
  if (month === 11 || month === 0 || month === 1) return "winter";
  if (month >= 2 && month <= 4) return "spring";
  return "summer";
}

function crazyEffectiveSeason(homes) {
  const override = homes && typeof homes.season === "string" ? homes.season : "auto";
  if (override === "auto" || !CRAZY_SEASONS.includes(override)) return crazySeasonForDate();
  return override;
}

function freshCrazy() {
  return { pool: null, theater: false, rooftop: false, plants: [], decor: {} };
}

function crazyFor(home) {
  const raw = home && typeof home.crazy === "object" && home.crazy !== null ? home.crazy : {};
  const crazy = freshCrazy();
  if (raw.pool === "pool" || raw.pool === "hottub") crazy.pool = raw.pool;
  crazy.theater = !!raw.theater;
  crazy.rooftop = !!raw.rooftop;
  crazy.plants = Array.isArray(raw.plants) ? raw.plants.filter((p) => p && typeof p.id === "string") : [];
  crazy.decor = raw.decor && typeof raw.decor === "object" ? raw.decor : {};
  return crazy;
}

// Watered growth credited so far, in ms: what was banked plus the
// still-wet window. Pure — it never mutates the plant, so reads are safe.
function crazyPlantGrowthMs(plant, now = Date.now()) {
  const banked = Number(plant?.wateredMs || 0);
  const since = Number(plant?.wateringSince || 0);
  if (!since || now <= since) return banked;
  return banked + Math.min(now - since, CRAZY_WATER_WINDOW_MS);
}

// 0 = seedling, 1 = small, 2 = grown (harvestable).
function crazyPlantStage(plant, now = Date.now()) {
  const growth = crazyPlantGrowthMs(plant, now);
  if (growth >= CRAZY_GROW_GROWN_MS) return 2;
  if (growth >= CRAZY_GROW_SMALL_MS) return 1;
  return 0;
}

// Bank the watered time earned so far (a re-water or a harvest banks
// the wet minutes already earned, capped at one window per watering),
// and start a fresh wet window. Called only by the water / harvest ops —
// reads compute growth purely, so they never mutate the plant.
function crazyBankPlant(plant, now = Date.now()) {
  const since = Number(plant?.wateringSince || 0);
  if (!since) return;
  plant.wateredMs = Number(plant.wateredMs || 0) + Math.min(Math.max(0, now - since), CRAZY_WATER_WINDOW_MS);
  plant.wateringSince = 0;
}

function sanitizeCrazyPlant(plant, now = Date.now()) {
  return {
    id: String(plant?.id || ""),
    kind: String(plant?.kind || ""),
    stage: crazyPlantStage(plant, now),
    watered: Number(plant?.wateringSince || 0) > 0 && now - Number(plant.wateringSince || 0) < CRAZY_WATER_WINDOW_MS,
    plantedAt: Number(plant?.plantedAt || 0),
    // Raw growth inputs so the client can recompute the live stage
    // between polls (growth is derived from these, never stored).
    wateredMs: Number(plant?.wateredMs || 0),
    wateringSince: Number(plant?.wateringSince || 0),
  };
}

function sanitizeCrazy(raw) {
  const crazy = crazyFor({ crazy: raw });
  const now = Date.now();
  return {
    pool: crazy.pool,
    theater: crazy.theater,
    rooftop: crazy.rooftop,
    plants: crazy.plants.map((p) => sanitizeCrazyPlant(p, now)),
    decor: {
      lights: !!crazy.decor.lights,
      pumpkins: !!crazy.decor.pumpkins,
      flowers: !!crazy.decor.flowers,
      lanterns: !!crazy.decor.lanterns,
    },
  };
}

// The owned home record for (homeId, server), or null. The caller owns
// the balance check + saveSave; this only resolves the record.
function crazyOwnedHome(save, homeId, server) {
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  const found = (homes.homes || []).find((h) => h.homeId === homeId && h.server === server);
  return found ? { homes, found } : { homes, found: null };
}

function crazyPay(save, player, amount) {
  if (save.balance < amount) return { ok: false, message: `Not enough City Sol — that is ${amount}.`, status: 400 };
  save.balance -= amount;
  player.balance = save.balance;
  return { ok: true };
}

async function crazyBuyPool(player, save, body) {
  const homeId = String(body.home || "");
  const kind = String(body.kind || "");
  if (kind !== "pool" && kind !== "hottub") return { ok: false, message: "Pool or hot tub?", status: 400 };
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "Buy the home first — the pool goes in your own yard.", status: 400 };
  const crazy = crazyFor(found);
  if (crazy.pool) return { ok: false, message: "This home already has a pool or hot tub.", status: 400 };
  const price = kind === "pool" ? CRAZY_POOL_PRICE : CRAZY_HOTTUB_PRICE;
  const paid = crazyPay(save, player, price);
  if (!paid.ok) return paid;
  crazy.pool = kind;
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, kind, price, me: publicPlayer(save) };
}

async function crazyBuyTheater(player, save, body) {
  const homeId = String(body.home || "");
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "Buy the home first — the theater goes in your own home.", status: 400 };
  const crazy = crazyFor(found);
  if (crazy.theater) return { ok: false, message: "This home already has a theater.", status: 400 };
  const paid = crazyPay(save, player, CRAZY_THEATER_PRICE);
  if (!paid.ok) return paid;
  crazy.theater = true;
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, price: CRAZY_THEATER_PRICE, me: publicPlayer(save) };
}

async function crazyBuyRooftop(player, save, body) {
  const homeId = String(body.home || "");
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "Buy the home first — the rooftop sits on your own penthouse.", status: 400 };
  // The rooftop belongs to the penthouse TIER (crib builder's work: the
  // tier lives on the owned record). Until that tier exists on the record,
  // there is no penthouse to put a rooftop on — say so plainly instead of
  // selling a rooftop for a house.
  if (found.tier !== "penthouse") {
    return { ok: false, message: "Rooftops are for penthouse homes — the penthouse tier is not on this home yet.", status: 400 };
  }
  const crazy = crazyFor(found);
  if (crazy.rooftop) return { ok: false, message: "This penthouse already has a rooftop.", status: 400 };
  const paid = crazyPay(save, player, CRAZY_ROOFTOP_PRICE);
  if (!paid.ok) return paid;
  crazy.rooftop = true;
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, price: CRAZY_ROOFTOP_PRICE, me: publicPlayer(save) };
}

async function crazyBuyPlant(player, save, body) {
  const homeId = String(body.home || "");
  const kind = String(body.kind || "");
  const price = CRAZY_PLANT_PRICES[kind];
  if (price == null) return { ok: false, message: "Unknown plant.", status: 400 };
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "Buy the home first — plants grow in your own yard.", status: 400 };
  const crazy = crazyFor(found);
  if (crazy.plants.length >= CRAZY_MAX_PLANTS) {
    return { ok: false, message: `This yard is full — ${CRAZY_MAX_PLANTS} plants max. Harvest one first.`, status: 400 };
  }
  const paid = crazyPay(save, player, price);
  if (!paid.ok) return paid;
  const plant = {
    id: `plant-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    kind,
    plantedAt: Date.now(),
    wateredMs: 0,
    wateringSince: 0,
  };
  crazy.plants.push(plant);
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, plant: sanitizeCrazyPlant(plant), price, me: publicPlayer(save) };
}

async function crazyWaterPlant(player, save, body) {
  const homeId = String(body.home || "");
  const plantId = String(body.plant || "");
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "That home is not yours on this server.", status: 400 };
  const crazy = crazyFor(found);
  const plant = crazy.plants.find((p) => p.id === plantId);
  if (!plant) return { ok: false, message: "No such plant.", status: 400 };
  const now = Date.now();
  if (crazyPlantStage(plant, now) >= 2) {
    return { ok: false, message: "That plant is fully grown — harvest it or let it be.", status: 400 };
  }
  // Bank the wet minutes already earned, then start a fresh 10-minute
  // wet window — re-watering never loses the growth already earned.
  crazyBankPlant(plant, now);
  plant.wateringSince = now;
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  return { ok: true, home: homeId, plant: sanitizeCrazyPlant(plant, now), me: publicPlayer(save) };
}

async function crazyHarvestPlant(player, save, body) {
  const homeId = String(body.home || "");
  const plantId = String(body.plant || "");
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "That home is not yours on this server.", status: 400 };
  const crazy = crazyFor(found);
  const index = crazy.plants.findIndex((p) => p.id === plantId);
  if (index < 0) return { ok: false, message: "No such plant.", status: 400 };
  const plant = crazy.plants[index];
  const now = Date.now();
  // Settle the wet window first: harvest judges the banked total.
  crazyBankPlant(plant, now);
  if (crazyPlantStage(plant, now) < 2) {
    // Persist the settle even on the error path, so the banked minutes
    // are never credited twice by a later harvest attempt.
    found.crazy = crazy;
    save.homes = homes;
    await saveSave(save);
    return { ok: false, message: "Not grown yet — water it and give it time.", status: 400 };
  }
  const pay = (CRAZY_PLANT_PRICES[plant.kind] || 0) * CRAZY_PLANT_HARVEST_MULT;
  crazy.plants.splice(index, 1);
  found.crazy = crazy;
  save.homes = homes;
  save.balance += pay;
  player.balance = save.balance;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, kind: plant.kind, paid: pay, me: publicPlayer(save) };
}

async function crazyBuyDecor(player, save, body) {
  const homeId = String(body.home || "");
  const kind = String(body.kind || "");
  const price = CRAZY_DECOR_PRICES[kind];
  if (price == null) return { ok: false, message: "Unknown decoration.", status: 400 };
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const { homes, found } = crazyOwnedHome(save, homeId, server);
  if (!found) return { ok: false, message: "Buy the home first — decorations go on your own home.", status: 400 };
  const crazy = crazyFor(found);
  if (crazy.decor[kind]) return { ok: false, message: "Your home already has that decoration.", status: 400 };
  const paid = crazyPay(save, player, price);
  if (!paid.ok) return paid;
  crazy.decor[kind] = true;
  found.crazy = crazy;
  save.homes = homes;
  await saveSave(save);
  await savePlayer(player);
  return { ok: true, home: homeId, kind, price, me: publicPlayer(save) };
}

async function crazySetSeason(player, save, body) {
  const season = String(body.season || "");
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  if (season !== "auto" && !CRAZY_SEASONS.includes(season)) {
    return { ok: false, message: "Season is auto, winter, halloween, spring or summer.", status: 400 };
  }
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  homes.season = season;
  save.homes = homes;
  await saveSave(save);
  return { ok: true, season: crazyEffectiveSeason(homes), override: season, me: publicPlayer(save) };
}
// --- CRIB (home life) --------------------------------------------------
// Bills, sleep/energy, pets, home upgrades, walls & floors, working
// stuff (TV / fridge / lights). City Sol only — no real money, no burn,
// no wallet. Per (player, server), like homes.
//
// STORAGE (no DDL): everything lives inside the EXISTING `player_saves`
// `homes` JSON column. The column JSON is
//   { homeServer, homes: [OwnedHome...], crib: CribPlayer }
// Per-home crib state rides ON the OwnedHome entry as `crib`:
//   homes[i].crib = { tier, decor: {wall, floor, light}, lightsOn, tvOn,
//                     bills: { dueAt, amount, paidUntil, lightsOff } }
// Player-level crib state rides on the same JSON as `crib`:
//   homes.crib = { energy, energyAt, pet: {kind, name, fedAt} | null,
//                  food: { pizza: n, burger: n, soda: n, petfood: n } }
// `sanitizeCrib` (below) is what publicPlayer returns as `me.crib`.
// Bills amount: rent (2% of home price, min 40) + lights (20), weekly.
// Energy: 0-100, drains while playing (client ticks it, syncs it), sleep
// in your own bed restores it to 100. Energy >= 70 = Rested (+15% walk/
// run speed, +10% job pay); energy 0 = Exhausted (x0.65 speed).
const CRIB_WEEK_MS = 7 * 86400000;
const CRIB_LIGHTS_FEE = 20;
const CRIB_TIERS = [
  { tier: 0, name: "Apartment", price: 0 },
  { tier: 1, name: "House", price: 1500 },
  { tier: 2, name: "Mansion", price: 5000 },
  { tier: 3, name: "Penthouse", price: 12000 },
];
const CRIB_PETS = {
  dog: { name: "Dog", price: 500 },
  cat: { name: "Cat", price: 400 },
};
const CRIB_FOODS = {
  pizza: { name: "Pizza slice", price: 12, energy: 12 },
  burger: { name: "Burger", price: 10, energy: 10 },
  soda: { name: "Soda", price: 5, energy: 4 },
  petfood: { name: "Pet food", price: 15, energy: 0 },
};
const CRIB_WALLS = {
  cream: { name: "Cream paint", price: 60 },
  gold: { name: "Gold paint", price: 80 },
  cyan: { name: "Aqua paint", price: 60 },
  red: { name: "Ember paint", price: 60 },
  black: { name: "Midnight paint", price: 60 },
  white: { name: "Cloud paint", price: 60 },
};
const CRIB_FLOORS = {
  wood: { name: "Wood floor", price: 80 },
  marble: { name: "Marble floor", price: 150 },
  gold: { name: "Gold floor", price: 120 },
  black: { name: "Onyx floor", price: 100 },
  grass: { name: "Grass floor", price: 90 },
};
const CRIB_LIGHTS = {
  warm: { name: "Warm lights", price: 50 },
  cool: { name: "Cool lights", price: 50 },
  gold: { name: "Gold lights", price: 70 },
  cyan: { name: "Aqua lights", price: 60 },
};
const CRIB_PET_HAPPY_MS = 6 * 3600000; // a fed pet stays happy 6h

function cribBillAmount(price) {
  return Math.max(40, Math.round(Number(price || 0) * 0.02)) + CRIB_LIGHTS_FEE;
}

function freshHomeCrib(price, now) {
  const amount = cribBillAmount(price);
  return {
    tier: 0,
    decor: { wall: "cream", floor: "wood", light: "warm" },
    lightsOn: true,
    tvOn: false,
    bills: { dueAt: now + CRIB_WEEK_MS, amount, paidUntil: now + CRIB_WEEK_MS, lightsOff: false },
  };
}

function ensureCribPlayer(save) {
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  if (!homes.crib || typeof homes.crib !== "object") {
    homes.crib = { energy: 100, energyAt: Date.now(), pet: null, food: {} };
  }
  const crib = homes.crib;
  if (typeof crib.energy !== "number" || !Number.isFinite(crib.energy)) crib.energy = 100;
  crib.energy = Math.max(0, Math.min(100, crib.energy));
  if (!crib.energyAt) crib.energyAt = Date.now();
  if (!crib.food || typeof crib.food !== "object") crib.food = {};
  save.homes = homes;
  return crib;
}

function ownedCribHome(save, homeId, server) {
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  const entry = (homes.homes || []).find((h) => h.homeId === homeId && h.server === server);
  if (!entry) return null;
  if (!entry.crib || typeof entry.crib !== "object") {
    entry.crib = freshHomeCrib(entry.price || HOME_PRICES[homeId] || 0, Number(entry.boughtAt || Date.now()));
  }
  return entry;
}

/** Refresh one home's bill state for "now": overdue => lights cut out. */
function refreshBill(entry, now) {
  const crib = entry.crib;
  if (!crib || !crib.bills) return null;
  const bills = crib.bills;
  const overdue = now > Number(bills.dueAt || 0);
  bills.lightsOff = overdue;
  return {
    homeId: entry.homeId,
    amount: Number(bills.amount || 0),
    dueAt: Number(bills.dueAt || 0),
    paidUntil: Number(bills.paidUntil || 0),
    overdue,
    lightsOff: bills.lightsOff,
  };
}

function sanitizeCribHome(entry, now) {
  const crib = entry.crib || freshHomeCrib(entry.price || 0, now);
  return {
    homeId: entry.homeId,
    tier: Number(crib.tier || 0),
    tierName: (CRIB_TIERS[Number(crib.tier || 0)] || CRIB_TIERS[0]).name,
    decor: {
      wall: String(crib.decor?.wall || "cream"),
      floor: String(crib.decor?.floor || "wood"),
      light: String(crib.decor?.light || "warm"),
    },
    lightsOn: crib.lightsOn !== false,
    tvOn: !!crib.tvOn,
    bills: refreshBill({ ...entry, crib }, now) || { homeId: entry.homeId, amount: 0, dueAt: 0, paidUntil: 0, overdue: false, lightsOff: false },
  };
}

function sanitizeCrib(homes) {
  const now = Date.now();
  const list = Array.isArray(homes?.homes) ? homes.homes : [];
  const crib = homes?.crib && typeof homes.crib === "object" ? homes.crib : null;
  const pet = crib?.pet && typeof crib.pet === "object" ? crib.pet : null;
  return {
    energy: Math.max(0, Math.min(100, Math.round(Number(crib?.energy ?? 100)))),
    pet: pet
      ? {
          kind: String(pet.kind || ""),
          name: String(pet.name || ""),
          happy: Number(pet.fedAt || 0) > 0 && now - Number(pet.fedAt || 0) < CRIB_PET_HAPPY_MS,
          fedAt: Number(pet.fedAt || 0),
        }
      : null,
    food: { ...(crib?.food && typeof crib.food === "object" ? crib.food : {}) },
    homes: list.map((entry) => sanitizeCribHome(entry, now)),
  };
}

/** Rested bonus: energy >= 70 pays +10% on a job. The client shows it. */
function cribEnergyBonus(save) {
  const crib = ensureCribPlayer(save);
  return Number(crib.energy || 0) >= 70;
}

async function cribStatusOp(save, server) {
  ensureCribPlayer(save);
  const now = Date.now();
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  const mine = (homes.homes || []).filter((h) => h.server === server);
  for (const entry of mine) {
    if (!entry.crib) entry.crib = freshHomeCrib(entry.price || HOME_PRICES[entry.homeId] || 0, Number(entry.boughtAt || now));
    refreshBill(entry, now);
  }
  await saveSave(save);
  return { ok: true, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribPayBill(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You don't own that home on this server.", status: 400 };
  const now = Date.now();
  const bill = refreshBill(entry, now);
  const amount = Number(bill.amount || 0);
  if (save.balance < amount) return { ok: false, message: `Not enough City Sol — this week's bills are ${amount}.`, status: 400 };
  save.balance -= amount;
  entry.crib.bills.dueAt = now + CRIB_WEEK_MS;
  entry.crib.bills.paidUntil = now + CRIB_WEEK_MS;
  entry.crib.bills.lightsOff = false;
  await saveSave(save);
  return { ok: true, message: `Bills paid — ${amount} City Sol. Lights are back on until next week.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribSleep(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You can only sleep in a bed in your own home.", status: 400 };
  const crib = ensureCribPlayer(save);
  crib.energy = 100;
  crib.energyAt = Date.now();
  await saveSave(save);
  return { ok: true, message: "You slept like a rock — energy 100, Rested. +15% speed, +10% job pay while rested.", crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribEnergySync(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const crib = ensureCribPlayer(save);
  const next = Math.max(0, Math.min(100, Math.round(Number(body.energy ?? crib.energy))));
  if (Number.isFinite(next)) {
    crib.energy = next;
    crib.energyAt = Date.now();
  }
  await saveSave(save);
  return { ok: true, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribBuyPet(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const kind = String(body.kind || "");
  const pet = CRIB_PETS[kind];
  if (!pet) return { ok: false, message: "Pick a dog or a cat.", status: 400 };
  const crib = ensureCribPlayer(save);
  if (crib.pet) return { ok: false, message: `You already have a ${CRIB_PETS[crib.pet.kind]?.name || "pet"} — one pet per home life.`, status: 400 };
  if (save.balance < pet.price) return { ok: false, message: `Not enough City Sol — a ${pet.name.toLowerCase()} is ${pet.price}.`, status: 400 };
  save.balance -= pet.price;
  crib.pet = { kind, name: String(body.name || pet.name), fedAt: Date.now() };
  await saveSave(save);
  return { ok: true, message: `You adopted a ${pet.name.toLowerCase()}! It follows you around your home. Feed it pet food to keep it happy.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribFeedPet(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const crib = ensureCribPlayer(save);
  if (!crib.pet) return { ok: false, message: "You don't have a pet yet.", status: 400 };
  const food = crib.food || {};
  // Pet food first; any other food works too (a pet eats what you have).
  const item = Number(food.petfood || 0) > 0 ? "petfood" : ["pizza", "burger", "soda"].find((f) => Number(food[f] || 0) > 0);
  if (!item) return { ok: false, message: "No food to feed it — buy pet food or groceries in the Shop.", status: 400 };
  food[item] = Number(food[item] || 0) - 1;
  crib.food = food;
  crib.pet.fedAt = Date.now();
  await saveSave(save);
  return { ok: true, message: `Your ${CRIB_PETS[crib.pet.kind]?.name.toLowerCase() || "pet"} is fed and happy.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribBuyFood(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const item = CRIB_FOODS[String(body.item || "")];
  if (!item) return { ok: false, message: "That food is not on the shelf.", status: 400 };
  const qty = Math.max(1, Math.min(10, Math.floor(Number(body.qty || 1))));
  const cost = item.price * qty;
  if (save.balance < cost) return { ok: false, message: "Not enough City Sol.", status: 400 };
  const crib = ensureCribPlayer(save);
  const food = crib.food || {};
  food[String(body.item)] = Number(food[String(body.item)] || 0) + qty;
  crib.food = food;
  save.balance -= cost;
  await saveSave(save);
  return { ok: true, message: `Bought ${qty}x ${item.name} for ${cost} City Sol — it's in your fridge.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribEat(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const key = String(body.item || "");
  const item = CRIB_FOODS[key];
  if (!item || key === "petfood") return { ok: false, message: "That's pet food — your pet eats that, not you.", status: 400 };
  const crib = ensureCribPlayer(save);
  const food = crib.food || {};
  if (Number(food[key] || 0) <= 0) return { ok: false, message: `No ${item.name} in your fridge.`, status: 400 };
  food[key] = Number(food[key] || 0) - 1;
  crib.food = food;
  crib.energy = Math.max(0, Math.min(100, Number(crib.energy || 0) + item.energy));
  crib.energyAt = Date.now();
  await saveSave(save);
  return { ok: true, message: `Ate ${item.name} — +${item.energy} energy.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribUpgrade(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You don't own that home on this server.", status: 400 };
  const tier = Number(entry.crib.tier || 0);
  const next = CRIB_TIERS[tier + 1];
  if (!next) return { ok: false, message: "Already a penthouse — the top tier.", status: 400 };
  if (save.balance < next.price) return { ok: false, message: `Not enough City Sol — ${next.name} is ${next.price}.`, status: 400 };
  save.balance -= next.price;
  entry.crib.tier = next.tier;
  await saveSave(save);
  return { ok: true, message: `Upgraded to a ${next.name}! More rooms, more space, more flex.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribDecor(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You don't own that home on this server.", status: 400 };
  const decor = entry.crib.decor || { wall: "cream", floor: "wood", light: "warm" };
  let total = 0;
  const changes = [];
  if (body.wall != null && String(body.wall) !== decor.wall) {
    const opt = CRIB_WALLS[String(body.wall)];
    if (!opt) return { ok: false, message: "Unknown wall colour.", status: 400 };
    total += opt.price;
    changes.push(["wall", String(body.wall), opt]);
  }
  if (body.floor != null && String(body.floor) !== decor.floor) {
    const opt = CRIB_FLOORS[String(body.floor)];
    if (!opt) return { ok: false, message: "Unknown flooring.", status: 400 };
    total += opt.price;
    changes.push(["floor", String(body.floor), opt]);
  }
  if (body.light != null && String(body.light) !== decor.light) {
    const opt = CRIB_LIGHTS[String(body.light)];
    if (!opt) return { ok: false, message: "Unknown lighting.", status: 400 };
    total += opt.price;
    changes.push(["light", String(body.light), opt]);
  }
  if (!changes.length) return { ok: false, message: "That is already how your home looks.", status: 400 };
  if (save.balance < total) return { ok: false, message: `Not enough City Sol — that redecoration is ${total}.`, status: 400 };
  save.balance -= total;
  for (const [key, value] of changes) decor[key] = value;
  entry.crib.decor = decor;
  await saveSave(save);
  return { ok: true, message: `Redecorated — ${changes.map(([, , opt]) => opt.name).join(", ")} for ${total} City Sol.`, crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribLights(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You don't own that home on this server.", status: 400 };
  const on = body.on !== false && body.on !== "false";
  const bill = refreshBill(entry, Date.now());
  if (on && bill.lightsOff) return { ok: false, message: "The lights are cut off — pay this week's bills first.", status: 400 };
  entry.crib.lightsOn = on;
  await saveSave(save);
  return { ok: true, message: on ? "Lights on." : "Lights off — it's dark in here now.", crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

async function cribTv(save, body) {
  const server = parseServerId(body.server);
  if (!server) return { ok: false, message: "Pick a server (1-5) first.", status: 400 };
  const entry = ownedCribHome(save, String(body.home || ""), server);
  if (!entry) return { ok: false, message: "You don't own that home on this server.", status: 400 };
  const on = body.on !== false && body.on !== "false";
  entry.crib.tvOn = on;
  await saveSave(save);
  return { ok: true, message: on ? "TV on — the radio is playing through it." : "TV off.", crib: sanitizeCrib(save.homes), me: publicPlayer(save) };
}

// --- Mission chain + new earning ops (fix-server) ------------------------
// All pay into the per-server save (City Sol only). See MISSION_CHAIN
// for the mission list and the per-step trust model.
const MISSION_STEP_COOLDOWN_MS = 3000;
const BUSK_PAY = 20;
const BUSK_COOLDOWN_MS = 60000;
const PHOTO_PAY = 15;
const PHOTO_PLACES = ["plaza", "tower", "dock", "hall", "cafe", "shop", "market", "museum"];

async function missionListOp(player, save) {
  const before = Object.keys(save.missions || {}).length;
  const missions = MISSION_CHAIN.map((mission, index) => {
    const prev = index === 0 ? null : MISSION_CHAIN[index - 1];
    const unlocked = !prev || !!missionProgress(save, player, prev).done;
    return missionPublic(mission, missionProgress(save, player, mission), unlocked);
  });
  if (Object.keys(save.missions || {}).length !== before) await saveSave(save);
  return { ok: true, missions, me: publicPlayer(save) };
}

async function advanceMission(player, save, body) {
  const mission = missionById(String(body.mission || ""));
  if (!mission) return { ok: false, message: "Unknown mission.", status: 400 };
  const index = MISSION_CHAIN.indexOf(mission);
  if (index > 0) {
    const prev = MISSION_CHAIN[index - 1];
    if (!missionProgress(save, player, prev).done) {
      return { ok: false, message: `Finish "${prev.name}" first.`, status: 400 };
    }
  }
  const progress = missionProgress(save, player, mission);
  if (progress.done) {
    return { ok: true, message: `"${mission.name}" is already complete.`, mission: missionPublic(mission, progress, true), paid: 0, done: true, me: publicPlayer(save) };
  }
  const stepIndex = Number(body.step);
  if (stepIndex !== Number(progress.step || 0)) {
    return { ok: false, message: `That step is out of order — next is step ${Number(progress.step || 0) + 1}.`, status: 400 };
  }
  const step = mission.steps[Number(progress.step || 0)];
  if (!step) return { ok: false, message: "That mission is already complete.", status: 400 };
  if (progress.at && Date.now() - Number(progress.at) < MISSION_STEP_COOLDOWN_MS) {
    return { ok: false, message: "Stay a moment before the next step.", status: 400 };
  }
  // Per-kind checks — see the MISSION_CHAIN header for the trust model.
  if (step.kind === "visit") {
    if (String(body.place || "") !== step.place) {
      return { ok: false, message: `Go to ${step.place} first.`, status: 400 };
    }
  } else if (step.kind === "job") {
    if (Number(player.jobStreak || 0) <= Number(progress.streak || 0)) {
      return { ok: false, message: "Complete a job first, then come back.", status: 400 };
    }
    progress.streak = Number(player.jobStreak || 0);
  } else if (step.kind === "daily") {
    if (!ensureDaily(player).claimed) {
      return { ok: false, message: "Claim your daily reward first.", status: 400 };
    }
  } else if (step.kind === "buy") {
    // Wardrobe entries (eq:<kind>:<value>, fit:...) are equip state, not
    // purchases — only real shop items count toward the buy step.
    const owned = Array.isArray(player.owned)
      ? player.owned.filter((entry) => typeof entry === "string" && !entry.startsWith("eq:") && !entry.startsWith("fit:")).length
      : 0;
    if (owned <= Number(progress.owned || 0)) {
      return { ok: false, message: "Buy something from the shop first.", status: 400 };
    }
    progress.owned = owned;
  }
  // chat / drive are client-attested; order + cooldown + one-time apply.
  progress.step += 1;
  progress.at = Date.now();
  let paid = 0;
  if (progress.step >= mission.steps.length) {
    progress.done = true;
    paid = mission.reward;
    save.balance += paid;
    save.earned = Number(save.earned || 0) + paid;
  }
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    message: paid
      ? `"${mission.name}" complete — paid ${paid} City Sol.`
      : `Step ${progress.step} of ${mission.steps.length} done: ${step.label}.`,
    mission: missionPublic(mission, progress, true),
    paid,
    done: progress.done,
    me: publicPlayer(save),
  };
}

// Busking: street performance, 20 City Sol, once a minute per universe.
// The cooldown lives on the save's daily blob (resets with the day).
async function buskOp(player, save) {
  const daily = ensureDaily(save);
  const last = Number(daily.buskAt || 0);
  if (last && Date.now() - last < BUSK_COOLDOWN_MS) {
    const wait = Math.ceil((BUSK_COOLDOWN_MS - (Date.now() - last)) / 1000);
    return { ok: false, message: `Take a breather — busk again in ${wait}s.`, status: 400 };
  }
  daily.buskAt = Date.now();
  save.balance += BUSK_PAY;
  save.earned = Number(save.earned || 0) + BUSK_PAY;
  await saveSave(save);
  await mirrorBalance(player, save);
  return { ok: true, message: `Busked for the crowd — paid ${BUSK_PAY} City Sol.`, paid: BUSK_PAY, me: publicPlayer(save) };
}

// Photo Safari: 15 City Sol per landmark, once per landmark per day.
// Landmarks are the named places every client already knows.
async function photoOp(player, save, body) {
  const place = String(body.place || "");
  if (!PHOTO_PLACES.includes(place)) {
    return { ok: false, message: "That is not a photo spot. Try the plaza, tower, harbor, hall, cafe, shop, market, or museum.", status: 400 };
  }
  const daily = ensureDaily(save);
  const today = todayISO();
  if (!daily.photos || typeof daily.photos !== "object") daily.photos = {};
  if (daily.photos[place] === today) {
    return { ok: false, message: `Already photographed ${place} today.`, status: 400 };
  }
  daily.photos[place] = today;
  save.balance += PHOTO_PAY;
  save.earned = Number(save.earned || 0) + PHOTO_PAY;
  await saveSave(save);
  await mirrorBalance(player, save);
  return { ok: true, message: `Photo of ${place} — paid ${PHOTO_PAY} City Sol.`, paid: PHOTO_PAY, place, me: publicPlayer(save) };
}

// --- FOOD: cooking, restaurants, gym, hunger (City Sol only) ------------
// Everything here is in-game currency. No real SOL, no burn, no wallet.
//
// STORAGE (no DDL): food state lives inside the existing `missions`
// JSON column under the reserved key "__food" — mission code only ever
// reads save.missions[mission.id] for known mission ids, so the key is
// inert there. Shape:
//   { hunger 0-100, stamina 0-100, lastTick ms, lastWorkout ms,
//     staminaAt ms, pantry {foodId: qty}, meals {recipeId: qty},
//     fedUntil ms }
//
// UNIFIED WITH THE GROCERY PIECE (Piece 2): one hunger, one inventory.
// Hunger lives on the per-server save's `daily` blob (daily.hunger,
// 0..100) and the pantry IS the grocery inventory (daily.food — the
// store sells the 12 ready foods AND the 10 cooking ingredients below,
// so the kitchen is stocked by shopping). This piece only ever READS
// hunger/pantry through foodState() and owns the `stamina` / `meals` /
// `fedUntil` values in __food. A cooked meal restores FAR more hunger
// than a raw snack (snack +6..12, cooked meal +20..45). Hunger drains
// only on the client (1 per 150s of active play, reported via
// food-hunger) — the server never drains it on its own, so a paused or
// away player never starves. Stamina drains 1 per 12h without a
// workout. New players start with a move-in pantry (STARTER_PANTRY,
// seeded into daily.food on first food-status) so the kitchen works
// before the first grocery run.
const FOOD_KEY = "__food";
// HUNGER_MAX lives with the grocery catalog above (one hunger, one const).
const STAMINA_MAX = 100;
const STAMINA_START = 20;
const STAMINA_DECAY_MS = 12 * 60 * 60 * 1000; // 1 stamina per 12h idle
const WORKOUT_COST = 5;
const WORKOUT_GAIN = 2;
const WORKOUT_COOLDOWN_MS = 30 * 1000;
const FED_MIN = 10; // restaurant meal: job pay +10% for 10 minutes
const STARTER_PANTRY = { bread: 2, patty: 2, dough: 1, cheese: 1, greens: 1, dressing: 1, potato: 2, egg: 1 };
const RECIPES = {
  "city-burger": { name: "City Burger", needs: { bread: 1, patty: 1 }, hunger: 40, stamina: 0 },
  "plaza-pizza": { name: "Plaza Pizza", needs: { dough: 1, cheese: 1 }, hunger: 45, stamina: 0 },
  "sunset-salad": { name: "Sunset Salad", needs: { greens: 1, dressing: 1 }, hunger: 35, stamina: 1 },
  fries: { name: "Harbor Fries", needs: { potato: 1 }, hunger: 20, stamina: 0 },
  omelette: { name: "Sunrise Omelette", needs: { egg: 1, cheese: 1 }, hunger: 30, stamina: 1 },
};
// The recipe ingredient ids — a grocery item is a cooking ingredient
// when it appears in some recipe's needs (eaten raw it is just a snack).
const INGREDIENT_IDS = new Set(Object.values(RECIPES).flatMap((r) => Object.keys(r.needs)));
const RESTAURANTS = {
  diner: {
    name: "Sunset Diner",
    vibe: "Cheap chrome diner by the garage — burgers, fries, shakes.",
    menu: [
      { id: "diner-burger", name: "Diner Burger", price: 12, hunger: 35 },
      { id: "diner-fries", name: "Diner Fries", price: 6, hunger: 18 },
      { id: "diner-shake", name: "Milkshake", price: 8, hunger: 15 },
      { id: "diner-coffee", name: "Diner Coffee", price: 4, hunger: 8 },
    ],
  },
  pizza: {
    name: "Pizza Nova",
    vibe: "Wood-fired pizza house on the east side — cozy, loud, cheesy.",
    menu: [
      { id: "pizza-margherita", name: "Margherita", price: 18, hunger: 40 },
      { id: "pizza-pepperoni", name: "Pepperoni Slice", price: 24, hunger: 45 },
      { id: "pizza-garlic", name: "Garlic Bread", price: 10, hunger: 20 },
    ],
  },
  fork: {
    name: "The Gold Fork",
    vibe: "White tablecloths and gold trim by the park — the fancy night out.",
    menu: [
      { id: "fork-steak", name: "Gold Steak", price: 60, hunger: 55 },
      { id: "fork-pasta", name: "Truffle Pasta", price: 45, hunger: 50 },
      { id: "fork-dessert", name: "Sunset Dessert", price: 25, hunger: 30 },
    ],
  },
};
const GYM_WORKOUTS = {
  treadmill: { name: "Treadmill Run", cost: WORKOUT_COST, gain: WORKOUT_GAIN },
  weights: { name: "Bench Press", cost: WORKOUT_COST, gain: WORKOUT_GAIN },
  bag: { name: "Heavy Bag", cost: WORKOUT_COST, gain: WORKOUT_GAIN },
};

// Hunger that matters: well fed you run fast, starving you crawl.
// Stamina (gym) adds up to +10% on top. Same formula lives in
// content.ts foodSpeedMult — keep the two in sync.
function foodSpeedMult(hunger, stamina) {
  const h = Number(hunger || 0);
  const hungerMult = h >= 70 ? 1.1 : h >= 30 ? 1.0 : h > 0 ? 0.85 : 0.7;
  const staminaMult = 1 + Math.min(100, Math.max(0, Number(stamina || 0))) * 0.001;
  return Math.round(hungerMult * staminaMult * 1000) / 1000;
}
function foodCarryCap(stamina) {
  return 5 + Math.floor(Math.min(100, Math.max(0, Number(stamina || 0))) / 20);
}
function foodDefaults() {
  return {
    stamina: STAMINA_START,
    lastWorkout: 0,
    staminaAt: Date.now(),
    meals: {},
    fedUntil: 0,
  };
}
function readFood(save) {
  if (!save || !save.missions || typeof save.missions !== "object") return null;
  const food = save.missions[FOOD_KEY];
  return food && typeof food === "object" ? food : null;
}
function cleanCounts(bag) {
  const out = {};
  if (bag && typeof bag === "object") {
    for (const [key, value] of Object.entries(bag)) {
      const n = Math.floor(Number(value || 0));
      if (n > 0) out[key] = n;
    }
  }
  return out;
}
function ensureFood(save) {
  if (!save.missions || typeof save.missions !== "object") save.missions = {};
  let food = save.missions[FOOD_KEY];
  if (!food || typeof food !== "object") {
    food = foodDefaults();
    save.missions[FOOD_KEY] = food;
    // Move-in pantry: first time the kitchen exists, stock the grocery
    // inventory (daily.food) with the starter ingredients — only once
    // (the __food key existing marks a save that already got it), and
    // only when the inventory is empty, so a stocked save is untouched.
    const state = foodState(save);
    if (Object.keys(state.food).length === 0) Object.assign(state.food, { ...STARTER_PANTRY });
    return food;
  }
  const now = Date.now();
  food.stamina = Math.min(STAMINA_MAX, Math.max(0, Number(food.stamina ?? STAMINA_START)));
  food.lastWorkout = Number(food.lastWorkout || 0);
  food.staminaAt = Number(food.staminaAt || now);
  food.meals = cleanCounts(food.meals);
  food.fedUntil = Number(food.fedUntil || 0);
  // Stamina drains with idle days (hunger never decays server-side —
  // the client reports the drain via food-hunger).
  if (food.lastWorkout > 0) {
    const idle = Math.floor((now - food.staminaAt) / STAMINA_DECAY_MS);
    if (idle > 0) {
      food.stamina = Math.max(0, food.stamina - idle);
      food.staminaAt += idle * STAMINA_DECAY_MS;
    }
  } else {
    food.staminaAt = now;
  }
  return food;
}
// The unified food blob every food op returns: hunger + pantry are
// read (never created) from the save's daily blob; stamina / meals /
// fed live in __food. Defensive — a global player without a save reads
// the fresh defaults and nothing is mutated.
function foodPublic(save) {
  const f = readFood(save) || {};
  const daily = save && save.daily && typeof save.daily === "object" ? save.daily : {};
  const pantry = {};
  if (daily.food && typeof daily.food === "object") {
    for (const [id, count] of Object.entries(daily.food)) {
      if (FOOD_BY_ID[id] && Number(count) > 0) pantry[id] = Math.floor(Number(count));
    }
  }
  const hunger = Math.min(HUNGER_MAX, Math.max(0, Number.isFinite(Number(daily.hunger)) ? Math.round(Number(daily.hunger)) : HUNGER_MAX));
  const stamina = Math.min(STAMINA_MAX, Math.max(0, Number(f.stamina ?? STAMINA_START)));
  return {
    hunger,
    stamina,
    pantry,
    meals: cleanCounts(f.meals),
    fedUntil: Number(f.fedUntil || 0),
    fed: Number(f.fedUntil || 0) > Date.now(),
    speedMult: foodSpeedMult(hunger, stamina),
    carryCap: foodCarryCap(stamina),
  };
}
function foodReply(save, message, extra = {}) {
  return { ok: true, message, food: foodPublic(save), catalog: FOOD_CATALOG, ...extra };
}
async function foodStatusOp(player, save) {
  ensureFood(save);
  await saveSave(save);
  return { ok: true, food: foodPublic(save), catalog: FOOD_CATALOG, me: publicPlayer(save) };
}
// ONE food-eat: a cooked meal id eats from __food.meals (recipe
// restore, far more than a snack); any other id eats from the grocery
// inventory (daily.food, catalog restore). Both bodies are accepted
// ({id} from the grocery panel, {item} from the kitchen panel).
async function foodEatOp(save, body) {
  const id = String(body.id || body.item || "");
  const food = ensureFood(save);
  const state = foodState(save);
  const recipe = RECIPES[id];
  if (recipe) {
    if (!food.meals[id]) return { ok: false, message: `No ${recipe.name} in your bag — cook one first.`, status: 400 };
    food.meals[id] -= 1;
    if (food.meals[id] <= 0) delete food.meals[id];
    const next = Math.min(HUNGER_MAX, state.hunger + recipe.hunger);
    save.daily.hunger = next;
    food.stamina = Math.min(STAMINA_MAX, food.stamina + (recipe.stamina || 0));
    await saveSave(save);
    return foodReply(save, next >= HUNGER_MAX ? `Ate a ${recipe.name}. Full.` : `Ate a ${recipe.name} — +${recipe.hunger} hunger${recipe.stamina ? `, +${recipe.stamina} stamina` : ""}.`, { me: publicPlayer(save) });
  }
  const item = FOOD_BY_ID[id];
  if (!item) return { ok: false, message: "That food is not on the shelf.", status: 400 };
  if (!state.food[id]) return { ok: false, message: `You have no ${item.name} — buy some at OrbitX Grocery.`, status: 400 };
  state.food[id] -= 1;
  if (state.food[id] <= 0) delete state.food[id];
  const next = Math.min(HUNGER_MAX, state.hunger + item.hunger);
  save.daily.hunger = next;
  await saveSave(save);
  return foodReply(save, next >= HUNGER_MAX ? `Ate ${item.name}. Full.` : `Ate ${item.name} (+${item.hunger}).${INGREDIENT_IDS.has(id) ? " Cook it into a meal for far more." : ""}`, { me: publicPlayer(save) });
}
async function foodCookOp(player, save, body) {
  const recipeId = String(body.recipe || "");
  const recipe = RECIPES[recipeId];
  if (!recipe) return { ok: false, message: "Unknown recipe.", status: 400 };
  const server = currentServerFor(body, player);
  const owned = (save.homes && Array.isArray(save.homes.homes) ? save.homes.homes : []).some((h) => h.server === server);
  if (!owned) return { ok: false, message: "You need a home on this server first — the kitchen is in your own home.", status: 400 };
  const food = ensureFood(save);
  const state = foodState(save);
  const missing = Object.entries(recipe.needs).filter(([id, qty]) => (state.food[id] || 0) < qty);
  if (missing.length) {
    const names = missing.map(([id]) => FOOD_BY_ID[id]?.name ?? id);
    return { ok: false, message: `Missing ${names.join(", ")} — grab it at the grocery store first.`, status: 400 };
  }
  const carried = Object.values(food.meals).reduce((sum, n) => sum + n, 0);
  if (carried >= foodCarryCap(food.stamina)) {
    return { ok: false, message: `Your arms are full (${carried}/${foodCarryCap(food.stamina)} meals) — eat something, or work out to carry more.`, status: 400 };
  }
  for (const [id, qty] of Object.entries(recipe.needs)) {
    state.food[id] -= qty;
    if (state.food[id] <= 0) delete state.food[id];
  }
  food.meals[recipeId] = (food.meals[recipeId] || 0) + 1;
  await saveSave(save);
  return foodReply(save, `Cooked a ${recipe.name} — +${recipe.hunger} hunger when you eat it.`, { me: publicPlayer(save) });
}
async function foodOrderOp(player, save, body) {
  const restaurantId = String(body.restaurant || "");
  const itemId = String(body.item || "");
  const restaurant = RESTAURANTS[restaurantId];
  if (!restaurant) return { ok: false, message: "Unknown restaurant.", status: 400 };
  const item = restaurant.menu.find((entry) => entry.id === itemId);
  if (!item) return { ok: false, message: "That is not on this menu.", status: 400 };
  if (save.balance < item.price) {
    return { ok: false, message: `Not enough City Sol — ${item.name} is ${item.price}.`, status: 400 };
  }
  const food = ensureFood(save);
  const state = foodState(save);
  save.balance -= item.price;
  save.daily.hunger = Math.min(HUNGER_MAX, state.hunger + item.hunger);
  food.fedUntil = Date.now() + FED_MIN * 60 * 1000;
  await saveSave(save);
  await mirrorBalance(player, save);
  return foodReply(save, `Ate ${item.name} at ${restaurant.name} — +${item.hunger} hunger. Satisfied: job pay +10% for ${FED_MIN} min.`, { me: publicPlayer(save) });
}
async function foodWorkoutOp(player, save, body) {
  const workoutId = String(body.workout || "");
  const workout = GYM_WORKOUTS[workoutId];
  if (!workout) return { ok: false, message: "Unknown workout.", status: 400 };
  const food = ensureFood(save);
  const wait = Math.ceil((WORKOUT_COOLDOWN_MS - (Date.now() - food.lastWorkout)) / 1000);
  if (food.lastWorkout && wait > 0) {
    return { ok: false, message: `Catch your breath — next set in ${wait}s.`, status: 400 };
  }
  if (save.balance < workout.cost) {
    return { ok: false, message: `Not enough City Sol — a workout is ${workout.cost}.`, status: 400 };
  }
  save.balance -= workout.cost;
  food.stamina = Math.min(STAMINA_MAX, food.stamina + workout.gain);
  food.lastWorkout = Date.now();
  food.staminaAt = Date.now();
  await saveSave(save);
  await mirrorBalance(player, save);
  return foodReply(save, `${workout.name} done — +${workout.gain} stamina (${food.stamina}/100). Run faster, carry more.`, { me: publicPlayer(save) });
}

export async function GET() {
  return json({
    ok: true,
    name: "OrbitX City",
    demo: true,
    database: Boolean(databaseUrl()),
    redis: Boolean(redisEnv()),
    livekit: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    note: "Demo credits are separate from the in-app Solana wallet. The shop does not spend on-chain tokens.",
    mint: Boolean(process.env.ORBITX_MINT),
    auth: publicAuth(),
    network: networkName(),
    shopOnChain: chainShopEnabled(),
    supabase: Boolean(supabaseEnv()),
    supabaseError: globalThis.__orbitxSbError || "",
    realtime: publicRealtime(),
  });
}

function publicAuth() {
  const pub = supabasePublic();
  if (pub?.anon) return { mode: "supabase", url: pub.url, anon: pub.anon };
  return { mode: "mock", url: "", anon: "" };
}

function isFresh(player) {
  return player.balance === START_BALANCE
    && !player.burned
    && (!player.owned || player.owned.length === 0)
    && !player.earned
    && !player.mission;
}

async function deletePlayer(id) {
  const store = memory();
  const player = store.players.get(id);
  if (player) store.tokens.delete(player.token);
  store.players.delete(id);
  const client = sb();
  if (client) {
    const { error } = await client.from("players").delete().eq("id", id);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    try {
      await sql`DELETE FROM players WHERE id = ${id}`;
    } catch {
      // The guest row is already gone from memory.
    }
  }
}

async function adoptGuest(account, guest) {
  account.balance = guest.balance;
  account.burned = guest.burned;
  account.owned = guest.owned || [];
  account.color = guest.color;
  account.hat = guest.hat;
  account.car = guest.car;
  account.friends = guest.friends || [];
  account.inbox = guest.inbox || [];
  account.job = guest.job;
  account.jobStreak = guest.jobStreak || 0;
  account.business = guest.business || null;
  account.rent = guest.rent || {};
  account.party = guest.party || "";
  account.mission = guest.mission || 0;
  account.missionAt = guest.missionAt || 0;
  account.look = guest.look || account.look;
  account.earned = guest.earned || 0;
  account.bestRace = guest.bestRace || 0;
  account.bestHover = guest.bestHover || 0;
  account.daily = guest.daily;
  account.name = guest.name || account.name;
  const store = memory();
  if (store.lots) {
    for (const lot of store.lots.values()) {
      if (lot.ownerId === guest.id) {
        lot.ownerId = account.id;
        lot.ownerName = account.name;
      }
    }
  }
  const client = sb();
  if (client) {
    const moved = await client.from("properties").update({ owner_id: account.id, owner_name: account.name }).eq("owner_id", guest.id);
    if (moved.error) noteSupabase(moved.error.message);
    const books = await client.from("bookings").update({ owner_id: account.id }).eq("owner_id", guest.id);
    if (books.error && !/owner_id/i.test(books.error.message || "")) noteSupabase(books.error.message);
    // Office leases move the same way — the claim stays with the person,
    // just under their account id now.
    const offices = await client.from("office_claims").update({ owner_id: account.id }).eq("owner_id", guest.id);
    if (offices.error && !/office_claims/i.test(offices.error.message || "")) noteSupabase(offices.error.message);
  }
  await deletePlayer(guest.id);
}

async function openAccount(account, body) {
  let player = await playerById(account.id);
  let upgraded = false;
  if (!player) {
    player = freshPlayer(account.id, account.name || "Player");
    player.authUser = account.id;
  }
  player.email = account.email || player.email;
  player.avatar = account.avatar || player.avatar;
  player.provider = account.provider || player.provider;
  player.authUser = account.id;
  const guestToken = String(body.guestToken || "");
  if (guestToken && isFresh(player)) {
    const guest = await playerByToken(guestToken);
    if (guest && guest.id !== player.id && !guest.authUser) {
      await adoptGuest(player, guest);
      upgraded = true;
    }
  }
  const chain = await ensureWallet(player.authUser);
  if (chain?.publicKey) player.address = chain.publicKey;
  const view = chain ? await walletView(player.authUser) : null;
  if (view) player.holder = !!view.holder;
  await savePlayer(player);
  return { player, upgraded, chain: view };
}

// In-game radio: a public playlist anyone can add to, played personally.
// Uploads go straight from the browser to Supabase Storage on a
// server-issued signed URL — the file never passes through this function
// (Vercel caps request bodies at ~4.5 MB and tracks can be up to 15 MB).
// Free: no money, no burn, no City Sol.
const RADIO_BUCKET = "radio";
const RADIO_MAX_BYTES = 15 * 1024 * 1024;
const RADIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".webm", ".aac", ".flac"]);

function radioExt(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

async function radioList() {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const { data, error } = await client
    .from("radio_tracks")
    .select("id, name, uploader_id, uploader_name, storage_path, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    noteSupabase(error.message);
    return { ok: false, message: "Could not load the radio.", status: 500 };
  }
  const tracks = (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    uploader: row.uploader_name || "Guest",
    uploaderId: row.uploader_id || "",
    path: row.storage_path,
    url: client.storage.from(RADIO_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    createdAt: row.created_at,
  }));
  return { ok: true, tracks };
}

async function radioUploadUrl(player, body) {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const name = String(body.name || body.filename || "").trim().slice(0, 80);
  const size = Number(body.size || 0);
  const ext = radioExt(body.name || body.filename || "");
  if (!name) return { ok: false, message: "Name the track.", status: 400 };
  if (!RADIO_EXTS.has(ext)) {
    return { ok: false, message: "That is not a supported audio file (mp3, m4a, wav, ogg, webm, aac, flac).", status: 400 };
  }
  if (!Number.isFinite(size) || size <= 0 || size > RADIO_MAX_BYTES) {
    return { ok: false, message: "Tracks are at most 15 MB.", status: 400 };
  }
  const path = `tracks/${player.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const { data, error } = await client.storage.from(RADIO_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    noteSupabase(error?.message || "signed upload failed");
    return { ok: false, message: "Could not start the upload. Try again.", status: 500 };
  }
  return { ok: true, signedUrl: data.signedUrl, path, maxBytes: RADIO_MAX_BYTES };
}

async function radioRegister(player, body) {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const name = String(body.name || "").trim().slice(0, 80);
  const path = String(body.path || "");
  if (!name) return { ok: false, message: "Name the track.", status: 400 };
  // Only the player who was issued the upload URL can register that path.
  if (!path.startsWith(`tracks/${player.id}/`)) {
    return { ok: false, message: "That upload is not yours.", status: 400 };
  }
  if (!RADIO_EXTS.has(radioExt(path))) {
    return { ok: false, message: "That is not a supported audio file.", status: 400 };
  }
  // Confirm the file actually landed in storage before listing it.
  const folder = path.slice(0, path.lastIndexOf("/"));
  const file = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await client.storage.from(RADIO_BUCKET).list(folder, { limit: 10, search: file });
  if (error) {
    noteSupabase(error.message);
    return { ok: false, message: "Could not confirm the upload. Try again.", status: 500 };
  }
  if (!Array.isArray(data) || !data.some((item) => item.name === file)) {
    return { ok: false, message: "The upload did not land. Try uploading again.", status: 400 };
  }
  const { data: inserted, error: insertErr } = await client
    .from("radio_tracks")
    .insert({ name, uploader_id: player.id, uploader_name: player.name || "Guest", storage_path: path })
    .select("id, name, uploader_id, uploader_name, storage_path, created_at")
    .single();
  if (insertErr || !inserted) {
    noteSupabase(insertErr?.message || "radio insert failed");
    return { ok: false, message: "Could not add the track to the radio.", status: 500 };
  }
  const listed = await radioList();
  return {
    ok: true,
    message: `"${inserted.name}" is on the radio.`,
    track: {
      id: inserted.id,
      name: inserted.name,
      uploader: inserted.uploader_name,
      uploaderId: inserted.uploader_id,
      path: inserted.storage_path,
      url: client.storage.from(RADIO_BUCKET).getPublicUrl(inserted.storage_path).data.publicUrl,
      createdAt: inserted.created_at,
    },
    tracks: listed.tracks || [],
  };
}

const HEARTBEAT = new Set(["sync", "digest", "me", "board"]);

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Send JSON." }, 400);
  }
  const op = String(body.op || "");
  if (op.startsWith("auth-")) {
    const result = await handleAuthOp(op, body);
    if (!result) return json({ ok: false, message: "Unknown auth request." }, 400);
    const status = result.status || 200;
    const payload = { ...result };
    delete payload.status;
    return json(payload, status);
  }
  const token = bearer(request);
  const account = looksLikeAccountToken(token) ? await verifyAccessToken(token, !HEARTBEAT.has(op)) : null;
  if (op === "session") {
    if (looksLikeAccountToken(token)) {
      if (!account) return json({ ok: false, message: "That login expired. Sign in again." }, 401);
      const opened = await openAccount(account, body);
      return json({
        ok: true,
        token: opened.player.token,
        me: publicPlayer(opened.player),
        storage: storageName(),
        upgraded: opened.upgraded,
        chain: opened.chain,
        auth: authMode(),
      });
    }
    const wanted = String(body.id || "").slice(0, 64);
    const known = String(body.token || "");
    let player = wanted ? await playerById(wanted) : null;
    if (player && (player.token !== known || player.authUser)) player = null;
    if (!player) {
      player = freshPlayer(wanted || randomBytes(12).toString("hex"), body.name);
      await savePlayer(player);
    } else if (body.name) {
      player.name = String(body.name).slice(0, 18);
      await savePlayer(player);
    }
    return json({ ok: true, token: player.token, me: publicPlayer(player), storage: storageName(), auth: authMode() });
  }

  let player = null;
  if (looksLikeAccountToken(token)) {
    if (!account) return json({ ok: false, message: "That login expired. Sign in again." }, 401);
    player = await playerById(account.id);
  } else {
    player = await playerByToken(token);
    if (player?.authUser) return json({ ok: false, message: "Sign in with your account." }, 401);
  }
  if (!player) return json({ ok: false, message: "Sign in first." }, 401);

  // Heartbeat: every sync/digest/me/board touches the player's save on
  // their universe so universe-list player counts are real (no heartbeat,
  // no count). Never mints a save, never fails the op.
  if (HEARTBEAT.has(op)) await touchHeartbeat(player, body);

  if (op === "wallet-view") {
    if (!player.authUser) return json({ ok: false, message: "Create an account to open the in-app wallet. Guests keep City Sol only." }, 400);
    const view = await walletView(player.authUser);
    player.holder = !!view.holder;
    if (view.address) player.address = view.address;
    await savePlayer(player);
    return json({ ...view, me: publicPlayer(player) });
  }
  if (op === "wallet-quote") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before sending from the in-app wallet." }, 400);
    const quote = quoteSend(body);
    return json(quote, quote.status || 200);
  }
  if (op === "wallet-confirm") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before sending from the in-app wallet." }, 400);
    const sent = await confirmSend(player.authUser, body);
    return json(sent, sent.status || 200);
  }
  if (op === "wallet-export") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before exporting a key." }, 400);
    if (String(body.confirm || "") !== "EXPORT") return json({ ok: false, message: "Export needs the warning confirmed." }, 400);
    const allowed = await checkReauth(account, body);
    const exported = await exportWallet(player.authUser, allowed);
    return json(exported, exported.status || 200);
  }
  if (op === "wallet-link") {
    return json({ ok: false, message: "External wallet connect is not used. Each account has an in-app wallet." }, 410);
  }

  // The HUD reads the save's balance: the save is the money authority.
  // A heartbeat loads and reconciles but never mints a save.
  if (op === "me") {
    const save = await ensureSave(player, currentServerFor(body, player), { mint: false });
    return json({ ok: true, me: publicPlayer(save || player) });
  }

  // Multiverse — one save per (player, universe). Joining and travelling
  // are FREE: no City Sol, no burn, no ORBITX anywhere in this.
  if (op === "universe-list") {
    const universes = [];
    for (const id of SERVERS) {
      universes.push({ id, playerCount: await activeCount(id), realtimeEndpoint: null });
    }
    // Where the player's friends are RIGHT NOW, so the menu picker can
    // tag the universe a friend is on ("TJR is here") and the player
    // joins the same room instead of their own saved universe. Null
    // when a friend has no recent heartbeat (offline / never joined).
    const friends = [];
    for (const friend of player.friends || []) {
      friends.push({ id: friend.id, name: friend.name, server: await currentUniverseFor(friend.id) });
    }
    // currentServerId is client-side state (Vercel functions are
    // stateless) — the client tracks which universe it joined.
    return json({ ok: true, universes, friends, homeServerId: player.homeServer ?? null, currentServerId: null });
  }

  if (op === "universe-join" || op === "universe-travel") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick Universe 1 to 5." }, 400);
    if (op === "universe-travel") {
      // The universe they came from is client-side state: the client
      // sends it when it knows, and guards same-universe travel itself.
      const from = parseServerId(body.from ?? body.currentServer ?? body.current);
      if (from != null) {
        if (from === server) return json({ ok: false, message: `You are already in Universe ${server}.` }, 400);
        // Save the universe they came from, then leave it alone.
        await touchSaveIfExists(player.id, from);
      }
    }
    if ((await activeCount(server)) >= MULTIVERSE_CAP) {
      return json({ ok: false, message: `Universe ${server} is full — 150/150 players. Pick another universe.` }, 409);
    }
    const hadSave = !!(await saveKey(player.id, server));
    const save = await ensureSave(player, server);
    const isNewSave = !hadSave;
    await touchSave(save);
    return json({
      ok: true,
      me: publicPlayer(save),
      serverId: server,
      isHome: player.homeServer === server,
      isNewSave,
      realtimeEndpoint: null,
      playerCount: await activeCount(server),
    });
  }

  if (op === "spend") {
    const save = await ensureSave(player, currentServerFor(body, player));
    const result = await spendItem(player, save, String(body.item || ""));
    return json(result, result.ok ? 200 : 400);
  }

  if (op === "clothes") {
    const save = await ensureSave(player, currentServerFor(body, player));
    const result = await equipClothesOp(player, save, body);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // Wardrobe fits — save / wear / delete a named fit. Per-server save,
  // same as spend: no balance changes, no burn, City Sol is untouched.
  if (op === "save-fit" || op === "wear-fit" || op === "delete-fit") {
    const save = await ensureSave(player, currentServerFor(body, player));
    const result =
      op === "save-fit"
        ? await saveFitOp(player, save, body)
        : op === "wear-fit"
          ? await wearFitOp(player, save, body)
          : await deleteFitOp(player, save, body);
    return json(result, result.ok ? 200 : 400);
  }

  if (op === "job-start") {
    const id = String(body.job || "");
    if (!JOBS[id]) return json({ ok: false, message: "Unknown job." }, 400);
    const save = await ensureSave(player, currentServerFor(body, player));
    save.job = { id, started: Date.now() };
    await saveSave(save);
    return json({ ok: true, me: publicPlayer(save) });
  }

  if (op === "earn") {
    const id = String(body.job || "");
    const save = await ensureSave(player, currentServerFor(body, player));
    const pay = scaledPay(id, save.jobStreak);
    if (!pay) return json({ ok: false, message: "Unknown job." }, 400);
    if (!save.job || save.job.id !== id) return json({ ok: false, message: "Start that job first." }, 400);
    if (Date.now() - Number(save.job.started) < JOB_MS) {
      return json({ ok: false, message: "Finish the route. The city checks the clock." }, 400);
    }
    // CRIB: rested players (energy >= 70) earn +10% — sleep in your own
    // bed to stay rested. The bonus is real pay, not a display trick.
    const rested = cribEnergyBonus(save);
    const finalPay = rested ? Math.round(pay * 1.1) : pay;
    save.balance += finalPay;
    save.job = null;
    save.jobStreak = Number(save.jobStreak || 0) + 1;
    save.earned = Number(save.earned || 0) + finalPay;
    // FOOD: a restaurant meal leaves you Satisfied — job pay +10% for
    // 10 minutes (food.fedUntil, set by food-order). The bonus lands on
    // the save like the base pay; the leaderboard keeps the base pay.
    const food = ensureFood(save);
    const fedBonus = food.fedUntil > Date.now() && pay > 0 ? Math.max(1, Math.round(pay * 0.1)) : 0;
    if (fedBonus > 0) save.balance += fedBonus;
    // Keep the legacy global job fields in step so old clients that read
    // them do not see a stale job. noteEarn also credits the global
    // `earned` total (the leaderboard reads it).
    player.job = null;
    player.jobStreak = save.jobStreak;
    const bonus = noteEarn(player, id, finalPay, save);
    await saveSave(save);
    await mirrorBalance(player, save);
    await savePlayer(player);
    const extra = bonus ? ` Quest paid ${bonus} City Sol.` : "";
    return json({ ok: true, message: `${id} paid ${finalPay} City Sol.${rested ? " Rested bonus +10%." : ""}${fedBonus > 0 ? ` Satisfied bonus +${fedBonus}.` : ""} Job streak ${save.jobStreak}.${extra}`, me: publicPlayer(save) });
  }

  // Real billboards: pay SOL from the in-app wallet, Jupiter swaps
  // SOL -> ORBITX, and the received ORBITX is burned. 100% buy + burn.
  const adCtx = { sb, note: noteSupabase, readBookings, saveBooking, savePlayer };
  const adReply = async (result) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(player);
    return json(payload, status || 200);
  };
  if (op === "ad-quote") return adReply(await adQuote(adCtx, player, body));
  if (op === "ad-status") return adReply(await adStatus(adCtx, player, body));
  if (op === "ad-retry-burn") return adReply(await adRetryBurn(adCtx, player, body));
  if (op === "ad-remove") return adReply(await adRemove(adCtx, player, body));
  if (op === "ad-orders") return adReply(await adOrdersFor(adCtx, player));
  if (op === "book") return adReply(await adBuy(adCtx, player, body));

  const radioReply = async (result) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(player);
    return json(payload, status || 200);
  };
  // Tower office leases — City Sol only. No SOL, no ORBITX, no burn:
  // the claim functions deduct from the stored City Sol balance.
  const officeReply = async (result, save) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(save || player);
    return json(payload, status || 200);
  };
  if (op === "radio-list") return radioReply(await radioList());
  if (op === "radio-upload-url") return radioReply(await radioUploadUrl(player, body));
  if (op === "radio-register") return radioReply(await radioRegister(player, body));
  if (op === "office-claim") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server);
    return officeReply(await claimOffice(player, save, body), save);
  }
  if (op === "office-claims") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    return officeReply({ ok: true, offices: await officeDirectory(server) });
  }
  if (op === "office-release") return officeReply(await releaseOffice(player, body));
  if (op === "office-status") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const claims = await readOfficeClaims(server);
    const mine = claims
      .filter((row) => row.owner_id === player.id && row.until >= todayISO())
      .map(publicOfficeClaim);
    return officeReply({ ok: true, mine, offices: await officeDirectory(server) });
  }

  // Garage — per-server cars (vehicles.ts). The save is this server's own.
  // Rentals live on the same save (save.rental, not save.vehicles).
  if (op === "buy-car" || op === "select-car" || op === "rent-car" || op === "rental-status" || op === "return-rental" || op === "customize-car" || op === "wash-car" || op === "repair-car" || op === "upgrade-garage" || op === "sync-vehicle-wear") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Unknown server." }, 400);
    // Rental-status is a read: never mint a save for it. The other garage
    // ops use ensureSave (Sol fix) so a first universe is seeded from the
    // player's global wealth and the save is reconciled; mirrorBalance
    // keeps the global row in step after every successful op.
    const save = await ensureSave(player, server, { mint: op !== "rental-status" });
    if (!save) {
      if (op === "rental-status") return json({ ok: true, rental: null, me: publicPlayer(player) });
      return json({ ok: false, message: "No rental on this server." }, 400);
    }
    let result;
    if (op === "buy-car") result = await buyCar(save, body);
    else if (op === "select-car") result = await selectCar(save, body);
    else if (op === "rent-car") result = await rentCar(save, body);
    else if (op === "rental-status") result = await rentalStatusOp(save);
    else if (op === "return-rental") result = await returnRental(save, body);
    else if (op === "customize-car") result = await customizeCar(save, body);
    else if (op === "wash-car") result = await washCar(save, body);
    else if (op === "repair-car") result = await repairCar(save, body);
    else if (op === "upgrade-garage") result = await upgradeGarage(save, body);
    else result = await syncVehicleWear(save, body);
    if (result.ok) await mirrorBalance(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // Grocery — per-server food + hunger (OrbitX Grocery). Same pattern as
  // the garage: the save is this server's own money + inventory ledger
  // (daily.food / daily.hunger on the save's daily JSON column — no new
  // DB column). Guests use their guest save, exactly like cars and homes:
  // their food and hunger live on that save, keyed by their guest token.
  // food-list is a read: never mint a save for it.
  if (op === "food-list" || op === "food-buy" || op === "food-eat" || op === "food-hunger") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Unknown server." }, 400);
    const save = await ensureSave(player, server, { mint: op !== "food-list" });
    if (!save) {
      if (op === "food-list") return json({ ok: true, catalog: FOOD_CATALOG, food: foodPublic(player), me: publicPlayer(player) });
      return json({ ok: false, message: "No save on this server yet." }, 400);
    }
    let result;
    if (op === "food-list") result = await foodListOp(save);
    else if (op === "food-buy") result = await foodBuyOp(save, body);
    else if (op === "food-eat") result = await foodEatOp(save, body);
    else result = await foodHungerOp(save, body);
    if (result.ok) await mirrorBalance(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // Homes — per-server houses (homes.ts). The save is this server's own,
  // not the global players row.
  if (op === "buy-home") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server);
    const result = await buyHome(player, save, body);
    return json(result, result.ok ? 200 : result.status || 400);
  }
  if (op === "home-status") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server, { mint: false });
    const homes = save?.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
    const mine = (homes.homes || []).filter((h) => h.server === server).map(sanitizeOwnedHome);
    // PEOPLE: rentals + party + guests ride along so the Home panel can
    // show rent-out, party and visitor state without a second round-trip.
    const people = save ? peopleStatusFor(save) : { relationships: [], rentals: [], party: null, guests: [] };
    return json({
      ok: true,
      homeServer: homes.homeServer || player.homeServer || 0,
      mine,
      rentals: people.rentals,
      party: people.party,
      guests: people.guests,
      relationships: people.relationships,      season: crazyEffectiveSeason(homes),
      seasonOverride: typeof homes.season === "string" ? homes.season : "auto",      me: save ? publicPlayer(save) : publicPlayer(player),
    });
  }

  // CRAZY home extras — pool / hot tub, theater, rooftop, plants,
  // season decor, season override. All City Sol, all per (player,
  // server), all stored in the existing `homes` JSON column. The
  // rooftop is penthouse-gated (the crib builder's tier).
  if (
    op === "crazy-buy-pool" || op === "crazy-buy-theater" || op === "crazy-rooftop" ||
    op === "crazy-buy-plant" || op === "crazy-water-plant" || op === "crazy-harvest-plant" ||
    op === "crazy-buy-decor" || op === "crazy-season" || op === "crazy-status"
  ) {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server, { mint: op !== "crazy-status" });
    if (!save) {
      return json({ ok: true, mine: [], season: crazySeasonForDate(), seasonOverride: "auto", me: publicPlayer(player) });
    }
    let result;
    if (op === "crazy-buy-pool") result = await crazyBuyPool(player, save, body);
    else if (op === "crazy-buy-theater") result = await crazyBuyTheater(player, save, body);
    else if (op === "crazy-rooftop") result = await crazyBuyRooftop(player, save, body);
    else if (op === "crazy-buy-plant") result = await crazyBuyPlant(player, save, body);
    else if (op === "crazy-water-plant") result = await crazyWaterPlant(player, save, body);
    else if (op === "crazy-harvest-plant") result = await crazyHarvestPlant(player, save, body);
    else if (op === "crazy-buy-decor") result = await crazyBuyDecor(player, save, body);
    else if (op === "crazy-season") result = await crazySetSeason(player, save, body);
    else {
      const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
      const mine = (homes.homes || []).filter((h) => h.server === server).map(sanitizeOwnedHome);
      result = { ok: true, mine, season: crazyEffectiveSeason(homes), seasonOverride: typeof homes.season === "string" ? homes.season : "auto", me: publicPlayer(save) };
    }
    if (result.ok) await mirrorBalance(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // Home furniture — shop + Edit Home, per-server homes (City Sol only).
  // furniture-list is a read: never mint a save for it — guests still get
  // the catalog, with an empty inventory.
  if (op === "furniture-list" || op === "furniture-buy" || op === "furniture-save" || op === "furniture-sell") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server, { mint: op !== "furniture-list" });
    if (!save) return json({ ok: true, catalog: furnitureCatalogPublic(), owned: [], placed: {} });
    let result;
    if (op === "furniture-list") result = furnitureListOp(save);
    else if (op === "furniture-buy") result = await furnitureBuyOp(player, save, body);
    else if (op === "furniture-save") result = await furnitureSaveOp(save, body);
    else result = await furnitureSellOp(player, save, body);    if (result.ok) await mirrorBalance(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // PEOPLE — roommates + guests, house parties, property empire, meet people.
  // All City Sol, all stored in the save's homes JSON (no new column).
  // Status is a read (never mints a save); the rest use ensureSave.
  if (op === "people-status") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server, { mint: false });
    return json({ ok: true, server, ...(save ? peopleStatusFor(save) : { relationships: Object.keys(PEOPLE_NPCS).map((npc) => peopleRelationship(npc, {})), rentals: [], party: null, guests: [] }), me: save ? publicPlayer(save) : publicPlayer(player) });
  }
  if (op === "npc-talk" || op === "people-invite" || op === "people-party-start" || op === "people-party-end" || op === "people-rent-out" || op === "people-end-rent" || op === "people-collect-rent") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server);
    let result;
    if (op === "npc-talk") result = await peopleTalk(player, save, body);
    else if (op === "people-invite") result = await peopleInvite(player, save, body);
    else if (op === "people-party-start") result = await peoplePartyStart(player, save, body);
    else if (op === "people-party-end") result = await peoplePartyEnd(player, save);
    else if (op === "people-rent-out") result = await peopleRentOut(player, save, body);
    else if (op === "people-end-rent") result = await peopleEndRent(player, save, body);
    else result = await peopleCollectRent(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }
  // CRIB (home life) — bills, sleep/energy, pets, upgrades, decor,
  // TV / fridge / lights. All City Sol, all per (player, server).
  if (op === "crib-status" || op === "crib-pay-bill" || op === "crib-sleep" || op === "crib-energy" || op === "crib-buy-pet" || op === "crib-feed-pet" || op === "crib-buy-food" || op === "crib-eat" || op === "crib-upgrade" || op === "crib-decor" || op === "crib-lights" || op === "crib-tv") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5) first." }, 400);
    const save = await ensureSave(player, server);
    let result;
    if (op === "crib-status") result = await cribStatusOp(save, server);
    else if (op === "crib-pay-bill") result = await cribPayBill(save, body);
    else if (op === "crib-sleep") result = await cribSleep(save, body);
    else if (op === "crib-energy") result = await cribEnergySync(save, body);
    else if (op === "crib-buy-pet") result = await cribBuyPet(save, body);
    else if (op === "crib-feed-pet") result = await cribFeedPet(save, body);
    else if (op === "crib-buy-food") result = await cribBuyFood(save, body);
    else if (op === "crib-eat") result = await cribEat(save, body);
    else if (op === "crib-upgrade") result = await cribUpgrade(save, body);
    else if (op === "crib-decor") result = await cribDecor(save, body);
    else if (op === "crib-lights") result = await cribLights(save, body);
    else result = await cribTv(save, body);
    if (result.ok) await mirrorBalance(player, save);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  // District office suites — same City Sol leases as the HQ, scoped by
  // (suite, server) in the one office_claims table. The attached `me`
  // is the server-scoped save, not the global player row.
  const districtReply = async (result, save) => {
    const { status, ...payload } = result;
    if (result.ok && save) payload.me = publicPlayer(save);
    return json(payload, status || 200);
  };
  if (op === "district-office-claim") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server);
    return districtReply(await claimDistrictOffice(player, save, body), save);
  }
  if (op === "district-office-claims") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const district = String(body.district || "");
    if (!DISTRICT_IDS.includes(district)) return json({ ok: false, message: "Unknown district." }, 400);
    const save = await ensureSave(player, server, { mint: false });
    const offices = await districtOfficeDirectory(district, server, await readOfficeClaims(server));
    return districtReply({ ok: true, district, server, offices }, save);
  }
  if (op === "district-office-release") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server, { mint: false });
    return districtReply(await releaseDistrictOffice(player, body), save);
  }
  if (op === "district-office-status") {
    const server = parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server, { mint: false });
    const claims = await readOfficeClaims(server);
    const mine = claims
      .filter((row) => row.owner_id === player.id && row.until >= todayISO())
      .map(publicOfficeClaim);
    return districtReply({ ok: true, server, mine }, save);
  }

  // My Properties — one snapshot of everything this player owns on one
  // universe: lots (HQ, apartments, shops), office leases, and homes.
  // The HUD's "My Props" button reads this so the player gets to a
  // property in two taps. Lots come from the properties table (the only
  // per-server record of lot ownership); offices from office_claims;
  // homes from the per-server save. Guests own nothing — the op still
  // answers, with empty lists.
  if (op === "my-properties") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await saveKey(player.id, server);
    if (save) syncSaveIdentity(save, player);
    const claims = await readOfficeClaims(server);
    const mine = claims
      .filter((row) => row.owner_id === player.id && row.until >= todayISO())
      .map(publicOfficeClaim);
    const homes = save?.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
    const myHomes = (homes.homes || []).filter((h) => h.server === server).map(sanitizeOwnedHome);
    const lots = await ownedLots(player.id, server, save);
    // PEOPLE: rentals + party + guests + relationships ride along so the
    // My Properties panel can show the property empire without a second
    // round-trip (same fields home-status already returns).
    const people = save ? peopleStatusFor(save) : { relationships: [], rentals: [], party: null, guests: [] };
    return json({ ok: true, server, lots, offices: mine, homes: myHomes, rentals: people.rentals, party: people.party, guests: people.guests, relationships: people.relationships });
  }

  if (op === "profile") {
    const name = String(body.name || player.name).trim().slice(0, 18);
    if (name) player.name = name;
    const look = String(body.look || "");
    if (LOOKS.has(look)) player.look = look;
    await savePlayer(player);
    return json({ ok: true, me: publicPlayer(player) });
  }

  // Public profile — what anyone in the city can see about a player:
  // name, look, home universe, homes, cars, friend count, tour
  // progress, total earned. Balance, inbox, email, wallet, and address
  // NEVER leave the server here. Homes + cars come from the target's
  // home-universe save (same source as my-properties), so the profile
  // shows real ownership, not a guess.
  if (op === "profile-view") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "No player with that id." }, 404);
    const pub = publicPlayer(other);
    const homeServer = Number(pub.homeServer || 0) || null;
    const save = homeServer ? await saveKey(other.id, homeServer) : null;
    const homes = save?.homes && Array.isArray(save.homes.homes) ? save.homes.homes : [];
    return json({
      ok: true,
      profile: {
        id: pub.id,
        name: pub.name,
        look: pub.look || "tjr",
        color: pub.color || "",
        hat: pub.hat || "",
        clothes: pub.clothes || null,
        homeServer,
        homes: homes
          .filter((h) => !homeServer || Number(h.server || 0) === homeServer)
          .map((h) => ({ homeId: String(h.homeId || ""), server: Number(h.server || 0), tier: typeof h.tier === "string" ? h.tier : "" })),
        vehicles: sanitizeVehicles(save?.vehicles ?? pub.vehicles ?? []),
        friendsCount: (pub.friends || []).length,
        inParty: !!pub.party,
        mission: pub.mission || 0,
        earned: pub.earned || 0,
      },
    });
  }

  if (op === "friend-ask") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "No player with that id." }, 404);
    if (!other.inbox.some((item) => item.id === player.id)) other.inbox.push({ id: player.id, name: player.name });
    await savePlayer(other);
    return json({ ok: true, message: `Asked ${other.name}.` });
  }

  if (op === "friend-accept") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "That request is gone." }, 404);
    // Accepting needs a pending friend request from this player — the
    // old code added the friendship unconditionally, so a stale
    // double-tap (or a call with no request) created friends out of thin
    // air and the client got no honest "gone" signal. party-accept and
    // decline-request already validate the same way.
    if (!player.inbox.some((item) => item.id === other.id && !item.kind)) {
      return json({ ok: false, message: "That request is gone." }, 404);
    }
    // Only drop the FRIEND request from this player — a party invite
    // from the same person (kind "party") stays until it is answered.
    player.inbox = player.inbox.filter((item) => item.id !== other.id || item.kind === "party");
    if (!player.friends.some((item) => item.id === other.id)) player.friends.push({ id: other.id, name: other.name });
    if (!other.friends.some((item) => item.id === player.id)) other.friends.push({ id: player.id, name: player.name });
    await savePlayer(player);
    await savePlayer(other);
    return json({ ok: true, me: publicPlayer(player), message: `${other.name} is a friend.` });
  }

  if (op === "party") {
    const store = memory();
    const partyId = player.party || `party-${player.id.slice(0, 6)}`;
    let party = store.parties.get(partyId) || { id: partyId, members: [{ id: player.id, name: player.name }] };
    const invite = String(body.invite || "");
    if (invite) {
      // An invite SENDS an invite — it never force-adds. The old code
      // pushed the other player straight into the party and set their
      // party id, with no inbox entry and no notification, so the
      // invitee never knew and the inviter saw nothing happen ("invite
      // button don't work"). The invitee answers with party-accept /
      // decline-request; the new "party-invite" op is the same flow.
      const other = await playerById(invite);
      if (!other) return json({ ok: false, message: "No player with that id." }, 404);
      if (!party.members.some((item) => item.id === player.id)) party.members.push({ id: player.id, name: player.name });
      player.party = partyId;
      store.parties.set(partyId, party);
      const client = sb();
      if (client) {
        const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
        if (error) noteSupabase(error.message);
      }
      await savePlayer(player);
      if (!other.inbox.some((item) => item.id === player.id && item.kind === "party" && item.party === partyId)) {
        other.inbox.push({ id: player.id, name: player.name, kind: "party", party: partyId });
      }
      await savePlayer(other);
      return json({ ok: true, party, me: publicPlayer(player), message: `Invite sent to ${other.name}.` });
    }
    player.party = partyId;
    if (!party.members.some((item) => item.id === player.id)) party.members.push({ id: player.id, name: player.name });
    store.parties.set(partyId, party);
    const client = sb();
    if (client) {
      const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
      if (error) noteSupabase(error.message);
    }
    await savePlayer(player);
    return json({ ok: true, party, me: publicPlayer(player) });
  }

  // Party invite with Accept/Decline: the invite lands in the other
  // player's inbox (kind "party") instead of adding them straight in —
  // the old "party" op still adds directly for the Start-a-party flow.
  // The invitee answers with "party-accept" / "decline-request".
  if (op === "party-invite") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "No player with that id." }, 404);
    const store = memory();
    const partyId = player.party || `party-${player.id.slice(0, 6)}`;
    let party = store.parties.get(partyId);
    if (!party) {
      party = { id: partyId, members: [{ id: player.id, name: player.name }] };
      store.parties.set(partyId, party);
    }
    if (!party.members.some((item) => item.id === player.id)) party.members.push({ id: player.id, name: player.name });
    player.party = partyId;
    await savePlayer(player);
    const client = sb();
    if (client) {
      const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
      if (error) noteSupabase(error.message);
    }
    if (!other.inbox.some((item) => item.id === player.id && item.kind === "party" && item.party === partyId)) {
      other.inbox.push({ id: player.id, name: player.name, kind: "party", party: partyId });
    }
    await savePlayer(other);
    return json({ ok: true, message: `Invite sent to ${other.name}.` });
  }

  if (op === "party-accept") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "That invite is gone." }, 404);
    const invite = player.inbox.find((item) => item.id === other.id && item.kind === "party");
    if (!invite) return json({ ok: false, message: "That invite is gone." }, 404);
    const partyId = String(invite.party || other.party || "");
    if (!partyId) return json({ ok: false, message: "That party is gone." }, 404);
    const store = memory();
    let party = store.parties.get(partyId) || null;
    const client = sb();
    if (!party && client) {
      const { data } = await client.from("parties").select("id, members").eq("id", partyId).maybeSingle();
      if (data) party = data;
    }
    if (!party) party = { id: partyId, members: [{ id: other.id, name: other.name }] };
    if (!party.members.some((item) => item.id === player.id)) party.members.push({ id: player.id, name: player.name });
    if (!party.members.some((item) => item.id === other.id)) party.members.push({ id: other.id, name: other.name });
    player.party = partyId;
    player.inbox = player.inbox.filter((item) => !(item.id === other.id && item.kind === "party"));
    store.parties.set(partyId, party);
    if (client) {
      const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
      if (error) noteSupabase(error.message);
    }
    await savePlayer(player);
    // Tell the accepter which universe the inviter is on RIGHT NOW, so
    // the client can travel there instead of leaving them on their own
    // universe while the party is on another one. Null when the inviter
    // has no recent heartbeat (offline / never joined) — the client
    // then just joins the party where it is.
    return json({ ok: true, party, me: publicPlayer(player), server: await currentUniverseFor(other.id), message: `You joined ${other.name}'s party.` });
  }

  if (op === "party-leave") {
    const partyId = player.party || "";
    if (!partyId) return json({ ok: true, party: null, me: publicPlayer(player), message: "You are not in a party." });
    const store = memory();
    let party = store.parties.get(partyId) || null;
    const client = sb();
    if (!party && client) {
      const { data } = await client.from("parties").select("id, members").eq("id", partyId).maybeSingle();
      if (data) party = data;
    }
    if (party) {
      party.members = party.members.filter((item) => item.id !== player.id);
      if (party.members.length === 0) {
        store.parties.delete(partyId);
        if (client) await client.from("parties").delete().eq("id", partyId);
      } else {
        store.parties.set(partyId, party);
        if (client) {
          const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
          if (error) noteSupabase(error.message);
        }
      }
    }
    player.party = "";
    await savePlayer(player);
    return json({ ok: true, party: null, me: publicPlayer(player), message: "You left the party." });
  }

  // Decline a friend request or a party invite: drops just that inbox
  // item. Friend requests carry no kind (back-compat), party invites
  // carry kind "party".
  if (op === "decline-request") {
    const id = String(body.id || "");
    const kind = String(body.kind || "");
    const before = player.inbox.length;
    player.inbox = player.inbox.filter((item) => {
      if (item.id !== id) return true;
      if (kind === "party") return item.kind !== "party";
      if (kind === "friend") return item.kind === "party";
      return false;
    });
    if (player.inbox.length === before) return json({ ok: false, message: "That request is gone." }, 404);
    await savePlayer(player);
    return json({ ok: true, me: publicPlayer(player), message: "Request declined." });
  }

  if (op === "event-add") {
    const info = {
      id: `event-${Date.now()}`,
      title: String(body.title || "Community night").slice(0, 48),
      where: String(body.where || "Fountain plaza").slice(0, 48),
      when: String(body.when || "Tonight").slice(0, 48),
      detail: String(body.detail || "Meet in the city.").slice(0, 140),
    };
    await addEvent(info);
    return json({ ok: true, event: info });
  }

  if (op === "chat") {
    const text = String(body.text || "").trim().slice(0, 180);
    if (!text) return json({ ok: false, message: "Empty message." }, 400);
    const scope = body.scope === "near" ? "near" : "global";
    await pushChat({
      id: player.id,
      name: player.name,
      text,
      scope,
      x: Number(body.x) || 0,
      z: Number(body.z) || 0,
      at: Date.now(),
    });
    return json({ ok: true });
  }

  if (op === "voice-token") {
    const room = String(body.room || "plaza").slice(0, 40);
    const token = livekitToken(player.id, room);
    if (token) {
      return json({ ok: true, provider: "livekit", url: process.env.LIVEKIT_URL, token, room });
    }
    return json({ ok: true, provider: "mesh", room, ice: [{ urls: "stun:stun.l.google.com:19302" }] });
  }

  if (op === "voice-signal") {
    const signal = {
      from: player.id,
      to: String(body.to || ""),
      room: String(body.room || ""),
      data: body.data || null,
      at: Date.now(),
    };
    await pushSignal(signal);
    const mine = await takeSignals(player.id);
    return json({ ok: true, signals: mine });
  }

  if (op === "sync") {
    // The HUD reads the save's balance. A heartbeat loads and reconciles
    // but never mints a save.
    const syncSave = await ensureSave(player, currentServerFor(body, player), { mint: false });
    const state = sanitizeState(player, body.state || {});
    // Presence carries the writer's universe, so the client can tell
    // which room a player is in — teleport and the Players panel read
    // it instead of assuming everyone is on this universe.
    state.server = currentServerFor(body, player);
    if (body.ghost || body.state?.ghost) ensureGhost();
    await writePresence(state);
    const people = await readWorld();
    const here = people.find((item) => item.id === player.id);
    const chat = (await readChat()).filter((line) => {
      if (line.scope !== "near" || !here) return true;
      return Math.hypot((line.x || 0) - here.x, (line.z || 0) - here.z) < 22 || line.id === player.id;
    });
    const signals = await takeSignals(player.id);
    let party = player.party ? memory().parties.get(player.party) || null : null;
    if (player.party && sb()) {
      const { data, error } = await sb().from("parties").select("id, members").eq("id", player.party).maybeSingle();
      if (data) party = data;
      if (error) noteSupabase(error.message);
    }
    const me = publicPlayer(player);
    await overlaySaveGarage(player, body, me);
    return json({
      ok: true,
      me: publicPlayer(syncSave || player),
      people,
      chat: chat.slice(-40),
      bookings: await readBookings(),
      events: await readEvents(),
      lobbies: lobbiesFor(people),
      signals,
      party,
      server: storageName(),
      realtime: publicRealtime(),
      supabaseError: globalThis.__orbitxSbError || "",
    });
  }

  if (op === "board") {
    const board = await leaderboard();
    return json({ ok: true, board });
  }

  if (op === "mission") {
    const save = await ensureSave(player, currentServerFor(body, player));
    const step = Number(body.step);
    if (step !== save.mission) return json({ ok: false, message: "That stop is out of order." }, 400);
    if (!MISSIONS[step]) return json({ ok: true, message: "City tour complete.", me: publicPlayer(save) });
    if (save.missionAt && Date.now() - Number(save.missionAt) < 3000) {
      return json({ ok: false, message: "Stay at the stop a moment." }, 400);
    }
    const reward = MISSIONS[step].pay;
    save.mission += 1;
    save.missionAt = Date.now();
    save.balance += reward;
    // Keep the legacy global tour step in step so old clients that read
    // it do not see a stale tour.
    player.mission = save.mission;
    player.missionAt = save.missionAt;
    await saveSave(save);
    await mirrorBalance(player, save);
    await savePlayer(player);
    return json({
      ok: true,
      message: `Tour stop ${step + 1} paid ${reward} City Sol.`,
      me: publicPlayer(save),
    });
  }

  // Mission chain + new earning ops — per-server saves (City Sol only).
  // The attached `me` is the server-scoped save, not the global row.
  // food-eat is NOT here — the unified eat (meal or grocery item) lives
  // in the grocery block above, so one op serves both panels.
  if (op === "food-status" || op === "food-cook" || op === "food-order" || op === "food-workout") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server);
    const result =
      op === "food-status"
        ? await foodStatusOp(player, save)
        : op === "food-cook"
          ? await foodCookOp(player, save, body)
          : op === "food-order"
            ? await foodOrderOp(player, save, body)
            : await foodWorkoutOp(player, save, body);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  if (op === "mission-list" || op === "mission-step" || op === "busk" || op === "photo") {
    const server = body.server == null || body.server === "" ? 1 : parseServerId(body.server);
    if (!server) return json({ ok: false, message: "Pick a server (1-5)." }, 400);
    const save = await ensureSave(player, server);
    if (op === "mission-list") return json(await missionListOp(player, save));
    const result =
      op === "mission-step"
        ? await advanceMission(player, save, body)
        : op === "busk"
          ? await buskOp(player, save)
          : await photoOp(player, save, body);
    return json(result, result.ok ? 200 : result.status || 400);
  }

  const live = await handleLive(
    {
      memory,
      sb,
      sql: db(),
      note: noteSupabase,
      savePlayer,
      addEvent,
      burnOf,
      // Per-server money: property buys and rent in live.js load the
      // save for the request's universe through these (same store the
      // city.js ops use). A ctx without them falls back to the global
      // player row, as before. newSave is ensureSave, so a save minted
      // from live.js is seeded and reconciled the same way.
      loadSave: saveKey,
      persistSave: saveSave,
      newSave: ensureSave,
      syncSave: syncSaveIdentity,
    },
    player,
    op,
    body,
  );
  if (live) {
    const status = live.status || 200;
    const payload = { ...live };
    delete payload.status;
    if (payload.includeMe) {
      // The HUD reads the save's balance. The digest already minted /
      // reconciled the save via moneySave, so load (never mint) here.
      const meSave = await ensureSave(player, currentServerFor(body, player), { mint: false });
      payload.me = publicPlayer(meSave || player);
      delete payload.includeMe;
    }
    return json(payload, status);
  }

  return json({ ok: false, message: "Unknown request." }, 400);
}

async function leaderboard() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("name, burned").order("burned", { ascending: false }).limit(8);
    if (!error && data) return data;
    if (error) noteSupabase(error.message);
  }
  return [...memory().players.values()]
    .sort((a, b) => b.burned - a.burned)
    .slice(0, 8)
    .map((player) => ({ name: player.name, burned: player.burned }));
}

function storageName() {
  if (supabaseEnv() && !globalThis.__orbitxSbError) return "Supabase";
  if (databaseUrl() && redisEnv()) return "Neon + Upstash";
  if (databaseUrl()) return "Neon";
  if (redisEnv()) return "Upstash";
  return "This server memory";
}

function sanitizeState(player, raw) {
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-400, Math.min(400, n)) : fallback;
  };
  return {
    id: player.id,
    name: player.name,
    x: num(raw.x),
    y: num(raw.y),
    z: num(raw.z),
    yaw: num(raw.yaw),
    color: player.color,
    hat: player.hat,
    car: Boolean(raw.car),
    skin: player.car,
    // Other players render our clothes from the same worn markers.
    clothes: equippedClothes(player.owned),
    speaking: Boolean(raw.speaking),
    emote: String(raw.emote || "").slice(0, 16),
    holder: !!player.holder,
    lobby: String(raw.lobby || "").slice(0, 40),
    seen: Date.now(),
  };
}

function ensureGhost() {
  const store = memory();
  store.world.set("ghost-nova", {
    id: "ghost-nova",
    name: "Nova",
    x: 2,
    y: 0,
    z: 18,
    yaw: Math.PI,
    color: "cyan",
    hat: "cap",
    car: false,
    skin: "cyan",
    speaking: true,
    emote: "wave",
    lobby: "plaza",
    seen: Date.now(),
  });
}

async function pushSignal(signal) {
  // Signals must survive across Vercel serverless instances, so Supabase
  // is the store. Redis stays as the fallback when it is configured;
  // per-instance memory is only the local-dev last resort.
  const client = sb();
  if (client) {
    const { error } = await client.from("voice_signals").insert({
      from_id: signal.from,
      to_id: signal.to,
      room: signal.room,
      data: signal.data,
    });
    if (!error) {
      await client
        .from("voice_signals")
        .delete()
        .lt("created_at", new Date(Date.now() - 15000).toISOString());
      return;
    }
    noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    await cache.lpush("orbitx:signals", JSON.stringify(signal));
    return;
  }
  memory().signals.push(signal);
}

async function takeSignals(id) {
  const client = sb();
  if (client) {
    const since = new Date(Date.now() - 15000).toISOString();
    const { data, error } = await client
      .from("voice_signals")
      .select("id, from_id, to_id, room, data, created_at")
      .eq("to_id", id)
      .gt("created_at", since)
      .order("created_at", { ascending: true });
    if (!error && data) {
      if (data.length) {
        const ids = data.map((row) => row.id);
        await client.from("voice_signals").delete().in("id", ids);
      }
      return data.map((row) => ({
        from: row.from_id,
        to: row.to_id,
        room: row.room,
        data: row.data,
        at: new Date(row.created_at).getTime(),
      }));
    }
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    const rows = (await cache.lrange("orbitx:signals", 0, 200)) || [];
    const keep = [];
    const mine = [];
    for (const row of rows) {
      const signal = typeof row === "string" ? JSON.parse(row) : row;
      if (signal.to === id && Date.now() - signal.at < 15000) mine.push(signal);
      else if (Date.now() - signal.at < 15000) keep.push(JSON.stringify(signal));
    }
    await cache.del("orbitx:signals");
    if (keep.length) await cache.rpush("orbitx:signals", ...keep);
    return mine;
  }
  const store = memory();
  const mine = store.signals.filter((signal) => signal.to === id);
  store.signals = store.signals.filter((signal) => signal.to !== id && Date.now() - signal.at < 15000);
  return mine;
}
