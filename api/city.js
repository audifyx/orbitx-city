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
};

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
  "board-long": 350
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
  "board-long": "sunset"
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
  "board-long": "Cruiser Longboard"
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
  return {
    homeId: String(home?.homeId || ""),
    server: Number(home?.server || 0),
    ownerId: String(home?.ownerId || ""),
    ownerName: String(home?.ownerName || ""),
    price: Number(home?.price || 0),
    boughtAt: Number(home?.boughtAt || 0),
  };
}

function sanitizeHomes(homes) {
  const list = Array.isArray(homes?.homes) ? homes.homes : [];
  return {
    homeServer: Number(homes?.homeServer || 0),
    homes: list.map(sanitizeOwnedHome),
    furniture: sanitizeFurnitureMap(homes?.furniture),
    furnitureOwned: sanitizeFurnitureOwned(homes?.furnitureOwned),
  };
}

function sanitizeVehicles(vehicles) {
  if (!Array.isArray(vehicles)) return [];
  return vehicles
    .filter((v) => v && typeof v.id === "string")
    .map((v) => ({ id: v.id, color: String(v.color || "") }));
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
    vehicles: sanitizeVehicles(player.vehicles),
    activeVehicle: player.activeVehicle || null,
    rental: sanitizeRental(player.rental),
    bestRace: player.bestRace || 0,
    bestHover: player.bestHover || 0,
    holder: !!player.holder,
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
  return Array.isArray(save?.owned) ? [...save.owned] : [];
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
  // Cosmetics are identity: equipping writes to the global row AND the
  // save, so the item shows up on every universe. City Sol is the
  // save's money: the check and the deduction use this universe's save.
  if (player.owned.includes(itemId)) {
    if (item.kind === "color") { player.color = item.value; save.color = item.value; }
    if (item.kind === "hat") { player.hat = item.value; save.hat = item.value; }
    if (item.kind === "car") { player.car = item.value; save.car = item.value; }
    if (item.kind === "trail") { player.trail = item.value; save.trail = item.value; }
    await savePlayer(player);
    await saveSave(save);
    return { ok: true, message: "Already yours. Equipped.", me: publicPlayer(save) };
  }
  if (save.balance < item.price) return { ok: false, message: "Not enough City Sol." };
  const burned = burnOf(item.price);
  save.balance -= item.price;
  save.burned += burned;
  player.burned += burned;
  player.owned.push(itemId);
  save.owned = [...(player.owned || [])];
  if (item.kind === "color") { player.color = item.value; save.color = item.value; }
  if (item.kind === "hat") { player.hat = item.value; save.hat = item.value; }
  if (item.kind === "car") { player.car = item.value; save.car = item.value; }
  if (item.kind === "trail") { player.trail = item.value; save.trail = item.value; }
  await savePlayer(player);
  await saveSave(save);
  await mirrorBalance(player, save);
  return {
    ok: true,
    message: `Spent ${item.price} City Sol. Burned ${burned}. Burned total ${player.burned}.`,
    me: publicPlayer(save),
  };
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
  });
  homes.homeServer = server; // buying here makes this server their home server
  save.homes = homes;
  await saveSave(save);
  if (player.homeServer !== server) player.homeServer = server;
  await savePlayer(player);
  return { ok: true, home: homeId, price, server, me: publicPlayer(save) };
}

// --- Home furniture ops (shop + Edit Home) ---

function furnitureListOp(save) {
  const homes = save.homes && Array.isArray(save.homes.homes) ? save.homes : { homeServer: 0, homes: [] };
  return {
    ok: true,
    catalog: furnitureCatalogPublic(),
    owned: sanitizeFurnitureOwned(homes.furnitureOwned),
    placed: sanitizeFurnitureMap(homes.furniture),
    me: publicPlayer(save),
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
    const owned = Array.isArray(player.owned) ? player.owned.length : 0;
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
    // currentServerId is client-side state (Vercel functions are
    // stateless) — the client tracks which universe it joined.
    return json({ ok: true, universes, homeServerId: player.homeServer ?? null, currentServerId: null });
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
    save.balance += pay;
    save.job = null;
    save.jobStreak = Number(save.jobStreak || 0) + 1;
    save.earned = Number(save.earned || 0) + pay;
    // Keep the legacy global job fields in step so old clients that read
    // them do not see a stale job. noteEarn also credits the global
    // `earned` total (the leaderboard reads it).
    player.job = null;
    player.jobStreak = save.jobStreak;
    const bonus = noteEarn(player, id, pay, save);
    await saveSave(save);
    await mirrorBalance(player, save);
    await savePlayer(player);
    const extra = bonus ? ` Quest paid ${bonus} City Sol.` : "";
    return json({ ok: true, message: `${id} paid ${pay} City Sol. Job streak ${save.jobStreak}.${extra}`, me: publicPlayer(save) });
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
  if (op === "buy-car" || op === "select-car" || op === "rent-car" || op === "rental-status" || op === "return-rental") {
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
    else result = await returnRental(save, body);
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
    return json({
      ok: true,
      homeServer: homes.homeServer || player.homeServer || 0,
      mine,
      me: save ? publicPlayer(save) : publicPlayer(player),
    });
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
    else result = await furnitureSellOp(player, save, body);
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
    return json({ ok: true, server, lots, offices: mine, homes: myHomes });
  }

  if (op === "profile") {
    const name = String(body.name || player.name).trim().slice(0, 18);
    if (name) player.name = name;
    const look = String(body.look || "");
    if (LOOKS.has(look)) player.look = look;
    await savePlayer(player);
    return json({ ok: true, me: publicPlayer(player) });
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
    player.inbox = player.inbox.filter((item) => item.id !== other.id);
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
      const other = await playerById(invite);
      if (!other) return json({ ok: false, message: "No player with that id." }, 404);
      if (!party.members.some((item) => item.id === other.id)) party.members.push({ id: other.id, name: other.name });
      other.party = partyId;
      await savePlayer(other);
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
