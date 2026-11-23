export interface ProjectInfo {
  id: string;
  name: string;
  line: string;
  site?: string;
  holders?: string;
  price?: string;
}

export interface BillboardInfo {
  id: string;
  project: string;
  text: string;
  image: string;
  start: string;
  end: string;
  /** Ads-panel availability, filled in by the runtime snap. */
  zone?: string;
  taken?: boolean;
  takenEnd?: string;
  takenBy?: string;
  mine?: boolean;
}

export interface EventInfo {
  id: string;
  title: string;
  where: string;
  when: string;
  detail: string;
}

export interface ShopItem {
  id: string;
  kind: "color" | "car" | "hat";
  name: string;
  value: string;
  price: number;
}

export const BURN_RATE = 0.25;

export const SHOP: ShopItem[] = [
  { id: "color-white", kind: "color", name: "Cloud suit", value: "white", price: 20 },
  { id: "color-gold", kind: "color", name: "Gold suit", value: "gold", price: 40 },
  { id: "color-cyan", kind: "color", name: "Cyan suit", value: "cyan", price: 30 },
  { id: "color-sunset", kind: "color", name: "Sunset suit", value: "sunset", price: 35 },
  { id: "car-black", kind: "car", name: "Night hover", value: "black", price: 50 },
  { id: "car-white", kind: "car", name: "Pearl hover", value: "white", price: 50 },
  { id: "car-gold", kind: "car", name: "Gold hover", value: "gold", price: 80 },
  { id: "car-cyan", kind: "car", name: "Cyan hover", value: "cyan", price: 60 },
  { id: "hat-cap", kind: "hat", name: "Cap", value: "cap", price: 15 },
  { id: "hat-antenna", kind: "hat", name: "Antenna", value: "antenna", price: 25 },
  { id: "hat-crown", kind: "hat", name: "Crown", value: "crown", price: 100 },
  { id: "hat-visor", kind: "hat", name: "Visor", value: "cap", price: 20 },
  { id: "color-black", kind: "color", name: "Night suit", value: "black", price: 25 },
];

export const AD_DAYS = [1, 7, 30] as const;
// Real billboard pricing, in USD — the user set it: 10 cents a day, for
// now. Week and month scale 5x/15x; plaza boards pay double. The buyer
// pays SOL; Jupiter swaps it to ORBITX and ALL of the received ORBITX is
// burned (100% buy + burn, no fee, no cut). The server is the authority —
// these numbers are only the client's preview; the quote comes from the
// API (the SOL amount is computed from the live SOL price at quote time).
export const AD_USD_PRICE: Record<number, number> = { 1: 0.1, 7: 0.5, 30: 1.5 };
export const AD_PLAZA_BOARDS = new Set(["plaza-east", "plaza-west"]);
export const AD_PLAZA_MULT = 2;
export function adUsdPrice(board: string, days: number): number {
  const base = AD_USD_PRICE[days] ?? 0;
  return AD_PLAZA_BOARDS.has(board) ? base * AD_PLAZA_MULT : base;
}

// ORBITX billboards (2026-11-18, user-set): a flat $1 for 7 days, paid
// in ORBITX straight from the buyer's in-app ORBITX balance — no SOL, no
// swap, no plaza premium. 100% of the ORBITX paid is burned on-chain.
// Same $1 on every one of the 25 boards.
export const BILLBOARD_ORBITX_USD = 1;
export const BILLBOARD_ORBITX_DAYS = 7;
// Human zone label per board, for the Ads panel list. Keys must match the
// board ids in DEFAULT_BILLBOARDS and AD_BOARDS (api/ads.js).
export const BILLBOARD_ZONE: Record<string, string> = {
  "plaza-east": "Plaza Central · East",
  "plaza-west": "Plaza Central · West",
  "hall-front": "Community Hall",
  "district-row": "Project District · South",
  "plaza-south-east": "Plaza South · East",
  "plaza-south-west": "Plaza South · West",
  "station-row": "Central Station",
  "market-road": "Night Market Road",
  "arcade-row": "Neon Arcade",
  "garage-row": "Hover Garage",
  "bank-row": "OrbitX Bank",
  "harbor-row": "Harbor · Ferry Dock",
  "north-east": "North Gate · East",
  "north-west": "North Gate · West",
  "district-north": "Project District · North",
  "district-far-south": "Project District · Far South",
  "ny-plaza-east": "New York · Plaza East",
  "ny-plaza-west": "New York · Plaza West",
  "ny-tower": "New York · Office Tower",
  "la-plaza-east": "Los Angeles · Plaza East",
  "la-plaza-west": "Los Angeles · Plaza West",
  "la-tower": "Los Angeles · Office Tower",
  "fl-plaza-east": "Florida · Plaza East",
  "fl-plaza-west": "Florida · Plaza West",
  "fl-tower": "Florida · Office Tower",
};

// Real-SOL office lease prices (USD, display only — the server quote is
// authoritative at purchase). Mirrors OFFICE_SOL_USD_PRICE in api/ads.js:
// every term stays under $5 by design.
export const OFFICE_SOL_USD_PRICE: Record<string, Record<number, number>> = {
  standard: { 1: 0.99, 7: 2.99, 30: 4.49 },
  premium: { 1: 1.49, 7: 3.99, 30: 4.99 },
};
export function officeSolUsdPrice(tier: string, days: number): number {
  return OFFICE_SOL_USD_PRICE[tier]?.[days] ?? 0;
}
// Play-money prices for the offline (this-device-only) demo booking.
// Online bookings always go through the real SOL flow above.
export const DEMO_AD_PRICE: Record<number, number> = { 1: 25, 7: 80, 30: 200 };

export const DEFAULT_PROJECTS: ProjectInfo[] = [
  { id: "orbitx-hq", name: "OrbitX HQ", line: "Community headquarters", site: "https://github.com/audifyx/orbitx-city", holders: "—", price: "Set ORBITX_MINT for a live price" },
  { id: "your-project", name: "Your Project Here", line: "Holders and friends meet here", site: "", holders: "—", price: "Placeholder" },
  { id: "north-star", name: "North Star", line: "Project office", site: "", holders: "—", price: "Placeholder" },
  { id: "lumen", name: "Lumen Labs", line: "Build nights and hangouts", site: "", holders: "—", price: "Placeholder" },
];

// OrbitX HQ tower suites (floors 2–4) — the real claimable offices. A suite
// costs City Sol (in-game currency) to claim/lease; the directory panel owns
// the prices and the claim flow, so no price lives here. There is no real
// buy-and-burn for offices (buy+burn is ads/banners only). The Founder's
// Office is the user's own OrbitX office and is never claimable.
export interface OfficeSuite {
  id: string;
  name: string;
  floor: 2 | 3 | 4;
  tier: "standard" | "premium" | "founder";
  claimable: boolean;
}

export const OFFICE_SUITES: OfficeSuite[] = [
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
  // State office towers (states.ts stateOfficeSuites) — one 12-suite tower
  // per state, floors 2–4, floor 4 premium, same City Sol lease prices as
  // the HQ. These are ADDITIONAL to the 25-suite district towers (different
  // suite ids, no conflict) — do not merge or drop either catalog.
  { id: "office-ny-f2-a", name: "Suite 2A", floor: 2, tier: "standard", claimable: true },
  { id: "office-ny-f2-b", name: "Suite 2B", floor: 2, tier: "standard", claimable: true },
  { id: "office-ny-f2-c", name: "Suite 2C", floor: 2, tier: "standard", claimable: true },
  { id: "office-ny-f2-d", name: "Suite 2D", floor: 2, tier: "standard", claimable: true },
  { id: "office-ny-f3-a", name: "Suite 3A", floor: 3, tier: "standard", claimable: true },
  { id: "office-ny-f3-b", name: "Suite 3B", floor: 3, tier: "standard", claimable: true },
  { id: "office-ny-f3-c", name: "Suite 3C", floor: 3, tier: "standard", claimable: true },
  { id: "office-ny-f3-d", name: "Suite 3D", floor: 3, tier: "standard", claimable: true },
  { id: "office-ny-f4-a", name: "Suite 4A", floor: 4, tier: "premium", claimable: true },
  { id: "office-ny-f4-b", name: "Suite 4B", floor: 4, tier: "premium", claimable: true },
  { id: "office-ny-f4-c", name: "Suite 4C", floor: 4, tier: "premium", claimable: true },
  { id: "office-ny-f4-d", name: "Suite 4D", floor: 4, tier: "premium", claimable: true },
  { id: "office-la-f2-a", name: "Suite 2A", floor: 2, tier: "standard", claimable: true },
  { id: "office-la-f2-b", name: "Suite 2B", floor: 2, tier: "standard", claimable: true },
  { id: "office-la-f2-c", name: "Suite 2C", floor: 2, tier: "standard", claimable: true },
  { id: "office-la-f2-d", name: "Suite 2D", floor: 2, tier: "standard", claimable: true },
  { id: "office-la-f3-a", name: "Suite 3A", floor: 3, tier: "standard", claimable: true },
  { id: "office-la-f3-b", name: "Suite 3B", floor: 3, tier: "standard", claimable: true },
  { id: "office-la-f3-c", name: "Suite 3C", floor: 3, tier: "standard", claimable: true },
  { id: "office-la-f3-d", name: "Suite 3D", floor: 3, tier: "standard", claimable: true },
  { id: "office-la-f4-a", name: "Suite 4A", floor: 4, tier: "premium", claimable: true },
  { id: "office-la-f4-b", name: "Suite 4B", floor: 4, tier: "premium", claimable: true },
  { id: "office-la-f4-c", name: "Suite 4C", floor: 4, tier: "premium", claimable: true },
  { id: "office-la-f4-d", name: "Suite 4D", floor: 4, tier: "premium", claimable: true },
  { id: "office-fl-f2-a", name: "Suite 2A", floor: 2, tier: "standard", claimable: true },
  { id: "office-fl-f2-b", name: "Suite 2B", floor: 2, tier: "standard", claimable: true },
  { id: "office-fl-f2-c", name: "Suite 2C", floor: 2, tier: "standard", claimable: true },
  { id: "office-fl-f2-d", name: "Suite 2D", floor: 2, tier: "standard", claimable: true },
  { id: "office-fl-f3-a", name: "Suite 3A", floor: 3, tier: "standard", claimable: true },
  { id: "office-fl-f3-b", name: "Suite 3B", floor: 3, tier: "standard", claimable: true },
  { id: "office-fl-f3-c", name: "Suite 3C", floor: 3, tier: "standard", claimable: true },
  { id: "office-fl-f3-d", name: "Suite 3D", floor: 3, tier: "standard", claimable: true },
  { id: "office-fl-f4-a", name: "Suite 4A", floor: 4, tier: "premium", claimable: true },
  { id: "office-fl-f4-b", name: "Suite 4B", floor: 4, tier: "premium", claimable: true },
  { id: "office-fl-f4-c", name: "Suite 4C", floor: 4, tier: "premium", claimable: true },
  { id: "office-fl-f4-d", name: "Suite 4D", floor: 4, tier: "premium", claimable: true },
];

export const DEFAULT_BILLBOARDS: BillboardInfo[] = [
  {
    id: "plaza-east",
    project: "OrbitX City",
    text: "FREE FOREVER · NO DOWNLOAD",
    image: "/house-ads/launch.png",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "plaza-west",
    project: "OrbitX City",
    text: "FREE FOREVER · NO DOWNLOAD",
    image: "/house-ads/launch.png",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "hall-front",
    project: "OrbitX Ads",
    text: "BOOK AT THE BILLBOARD DESK",
    image: "/house-ads/your-ad-here.png",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "district-row",
    project: "OrbitX",
    text: "TRADE EVERYTHING. OWN THE FUTURE.",
    image: "/orbitx-banner.jpg",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  // 21 more boards (2026-11-18): every empty board shows the house
  // "Advertise here" face until someone buys the week for $1 in ORBITX.
  { id: "plaza-south-east", project: "OrbitX City", text: "FREE FOREVER · NO DOWNLOAD", image: "/house-ads/launch.png", start: "2026-01-01", end: "2026-12-31" },
  { id: "plaza-south-west", project: "OrbitX City", text: "FREE FOREVER · NO DOWNLOAD", image: "/house-ads/launch.png", start: "2026-01-01", end: "2026-12-31" },
  { id: "station-row", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "market-road", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "arcade-row", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "garage-row", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "bank-row", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "harbor-row", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "north-east", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "north-west", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "district-north", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "district-far-south", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "ny-plaza-east", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "ny-plaza-west", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "ny-tower", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "la-plaza-east", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "la-plaza-west", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "la-tower", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "fl-plaza-east", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "fl-plaza-west", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
  { id: "fl-tower", project: "OrbitX", text: "ADVERTISE HERE · $1/WEEK", image: "", start: "2026-01-01", end: "2026-12-31" },
];

export const DEFAULT_EVENTS: EventInfo[] = [
  {
    id: "sunset-meetup",
    title: "Sunset meetup",
    where: "Fountain plaza",
    when: "Tonight, 7:00",
    detail: "Meet by the fountain. Bring a project story.",
  },
  {
    id: "fountain-lights",
    title: "Fountain lights",
    where: "Fountain plaza",
    when: "Demo — start it anytime",
    detail: "A short countdown, then lights and fireworks over the fountain.",
  },
  {
    id: "district-open",
    title: "District open house",
    where: "Project District",
    when: "Saturday, 2:00",
    detail: "Walk the offices. Empty floors are waiting for real projects.",
  },
  {
    id: "harbor-shift",
    title: "Harbor shift",
    where: "Harbor pier",
    when: "Any time",
    detail: "Walk the pier and clock in at the harbor office.",
  },
  {
    id: "night-market",
    title: "Night market",
    where: "Night Market",
    when: "After sunset",
    detail: "Stalls south of the plaza. Press N if you want the sky to go dark.",
  },
  {
    id: "hall-concert",
    title: "Plaza concert",
    where: "Community Hall stage",
    when: "Friday, 8:00",
    detail: "Live set on the hall stage — the dance floor opens after. Juno's on the decks.",
  },
  {
    id: "street-festival",
    title: "Street festival",
    where: "Market street",
    when: "Saturday, all day",
    detail: "Stalls along Market street, busking at the plaza corner, and the night market stays open late.",
  },
];

// ---- NPCs: names, roles, dialogue, patrol loops ----
// Keyed by the citizen name in city.ts. `patrol` is a loop of small offsets
// from the citizen's home spot — the NPC walks between them and pauses at
// each one. `jobId` makes the NPC a job giver: the talk panel offers that
// job for real (startJob), never a dead button. `offer` makes the NPC a
// trader: the talk panel shows one extra button that runs a real City Sol
// exchange (npcOffer) — a draw (pay in, random pay back), a tip (pay in,
// a useful line out), a quest (one-time, gated on something the player
// already did, pays a fixed reward), or work (pay a small cost up front,
// fixed pay for the task).
export interface NpcOffer {
  label: string;
  cost: number;
  kind: "draw" | "tip" | "quest" | "work";
  reward?: number;
  needPhoto?: string;
  drawRewards?: number[];
  done: string;
  tips?: string[];
}

export interface NpcInfo {
  role: string;
  jobId?: string;
  offer?: NpcOffer;
  lines: string[];
  patrol: Array<[number, number]>;
}

export const NPC_LINES: Record<string, NpcInfo> = {
  Rio: {
    role: "Plaza regular",
    lines: [
      "Fountain's been running since the city opened. Toss a coin in — sometimes it tosses one back.",
      "The fountain lights event starts at sunset. Check the Events board by the kiosks if you want in.",
      "You ever drive the street race? Gate one is east of here. Beat my time and I'll buy you a coffee.",
    ],
    patrol: [
      [0, 0],
      [2, 1],
      [2.5, -0.5],
      [-2, 1],
    ],
  },
  Mina: {
    role: "Barista, Cafe Nova",
    jobId: "barista",
    lines: [
      "Welcome to Cafe Nova. The espresso machine is older than the city and twice as loud.",
      "We're short a barista for the shift. Serve the counter and I'll pay you in City Sol — say the word.",
      "The regulars sit by the windows. If you take the shift, start at the counter and don't rush the pour.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 0],
      [0, 1.2],
    ],
  },
  Sol: {
    role: "Shopkeeper, OrbitX Shop",
    jobId: "courier",
    lines: [
      "OrbitX Shop — suits, hover-cars, hats. Everything's City Sol, nothing real leaves your wallet.",
      "Got a package that needs legs. Pick it up at the fountain, bring it here — courier pay, on the spot.",
      "Gold suit's our best seller. Forty City Sol and a quarter of it burns. The city likes that.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 0],
      [0, -1.5],
    ],
  },
  Nox: {
    role: "Mall regular",
    lines: [
      "Mall's got everything the plaza doesn't: food court upstairs, arcade on the east side.",
      "The arcade cabinet is free to play. One cabinet, one high score — that's the whole deal.",
      "I come here when the plaza gets loud. The mezzanine has the best view of the whole city.",
    ],
    patrol: [
      [0, 0],
      [2.5, 0],
      [-2.5, 0],
      [0, 2],
    ],
  },
  Pia: {
    role: "Vendor, Night Market",
    jobId: "vendor",
    lines: [
      "Night Market stalls open at sunset. Mine's the one with the warm lights — come see.",
      "Need a vendor for the night shift? Open a stall, work the crowd, keep the City Sol.",
      "The harbor crowd comes up the pier after dark. Best customers in the city, worst hagglers.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
    ],
  },
  Kai: {
    role: "Dock hand, Harbor",
    jobId: "dock",
    lines: [
      "Harbor Office — ships, shifts, and salt air. Clock in here and the pier pays.",
      "Dock hand shift's open. Clock in at the office, work the pier, get paid in City Sol.",
      "The ships run day and night. If the pier looks empty, the next one's already on the horizon.",
    ],
    patrol: [
      [0, 0],
      [0, 2.5],
      [2, 0],
      [-2, 1],
    ],
  },
  Juno: {
    role: "Hall host & DJ",
    jobId: "dj",
    lines: [
      "Community Hall — stage's open, floor's yours. We dance here most nights.",
      "I run the decks on set nights. Want to play one? Take the DJ slot and own the floor.",
      "The dance floor is right there — step on it and hit the beats. Eight beats, real pay.",
    ],
    patrol: [
      [0, 0],
      [1.5, 1],
      [-1.5, -1],
      [0, 2],
    ],
  },
  Theo: {
    role: "Photographer",
    lines: [
      "Light's best at the tower base, then the fountain. Bring me a photo and I'll tell you if it's art.",
      "Three spots make the set: the fountain, the tower, and the end of the pier. Snap all three.",
      "I shot the first photo ever taken in this city. It was the fountain, obviously.",
    ],
    patrol: [
      [0, 0],
      [2, 1],
      [-2, 0],
      [0, -1.5],
    ],
  },
  Vera: {
    role: "Usher, OrbitX Cinema",
    offer: {
      label: "Buy a premiere ticket — 10 City Sol",
      cost: 10,
      kind: "draw",
      drawRewards: [0, 10, 20, 30],
      done: "Ticket in hand — find a seat and enjoy the show.",
    },
    lines: [
      "OrbitX Cinema — tonight's premiere is a heist film about a stolen billboard. Front row's the loudest.",
      "A ticket's ten City Sol, and the lucky seat pays back. Some nights the house loses money. Most nights.",
      "The screen's the biggest in the city. Sit anywhere — the projector forgives all seats except the back row.",
    ],
    patrol: [
      [0, 0],
      [1.5, 1],
      [-1.5, 0],
      [0, -1.5],
    ],
  },
  Otis: {
    role: "Librarian, OrbitX Library",
    offer: {
      label: "Ask the librarian — 5 City Sol",
      cost: 5,
      kind: "tip",
      tips: [
        "Best pay in town right now is the taxi — three fares, ninety City Sol before the streak bonus.",
        "The coin hunt pays forty if you find all six in ninety seconds. The beacon points at the nearest coin.",
        "Fishing pays forty-five for three catches. Wait for the bite — press E too soon and the fish count it.",
        "Busk at the plaza corner — six beats, three City Sol a hit, five just for showing up.",
        "The parcel run pays twenty: pick the parcel up by the bank steps, drop it at the Library door.",
      ],
      done: "A tip for a tip — that's the trade.",
    },
    lines: [
      "OrbitX Library — quietest room in the city. The shelves hold every launch story since the fountain went in.",
      "Five City Sol and I'll tell you something worth knowing. Librarians hear everything — the good jobs, the bad bets, the race times.",
      "The reading tables are free. Bring a book, or just bring the gossip — both read the same here.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 1],
      [0, -1.5],
    ],
  },
  Remy: {
    role: "Trainer, Harbor Gym",
    offer: {
      label: "Show the fountain photo — earn 20 City Sol",
      cost: 0,
      kind: "quest",
      needPhoto: "fountain",
      reward: 20,
      done: "That's the fountain, alright — crisp light, good framing. Here's your {reward} City Sol.",
    },
    lines: [
      "Harbor Gym — treadmills, bags, and a mirror that never lies. Form first, always.",
      "Snap the fountain — good light, good framing — and bring the shot back here. Twenty City Sol for proof you were out in the city.",
      "The pier's my morning run. Lifeguard pays for the same legs, if you'd rather earn while you run.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 1],
      [0, -1.5],
    ],
  },
  Wren: {
    role: "Gardener, Sunset Park",
    offer: {
      label: "Plant a flower — 5 seed, 12 pay",
      cost: 5,
      kind: "work",
      reward: 12,
      done: "Planted — the bed's brighter already. The park pays {reward} City Sol for the bloom.",
    },
    lines: [
      "Sunset Park — I keep the beds gold and the pond clear. The pigeons supervise, badly.",
      "Five City Sol for a seed, and the park pays twelve when it blooms. Plant one — the city likes color.",
      "The flower beds run the whole north path. Gold in the middle, red on the sides — that's the recipe.",
    ],
    patrol: [
      [0, 0],
      [2, 1],
      [-2, 0],
      [0, 2],
    ],
  },
  Nadia: {
    role: "Teller, OrbitX Bank",
    jobId: "banker",
    lines: [
      "OrbitX Bank — City Sol in, City Sol out, and the books always balance. Ask me about the vault sometime.",
      "The banker's window is open — clock in here and the window pays. Fifty a shift, before the streak.",
      "The Library's expecting a parcel — pick it up by the steps out front and drop it at the Library door. Twenty for the walk.",
    ],
    patrol: [
      [0, 0],
      [1.5, 1],
      [-1.5, 0],
      [0, 1.5],
    ],
  },
  Felix: {
    role: "Arcade champion",
    lines: [
      "Neon Arcade — high/low, reflex light, and the coin hunt beacon. I hold the high score on all three. For now.",
      "High/low: stake ten, win eighteen. The card doesn't care how confident you are — I learned that the expensive way.",
      "Reflex light: wait for gold, then hit it fast. Fast hands pay more. My best was under a tenth of a second.",
    ],
    patrol: [
      [0, 0],
      [1.5, -1],
      [-1.5, 1],
      [0, 2],
    ],
  },
  // WORKING WORLD: citizens with real posts — they stand their station
  // all day (tiny patrols behind counters), work the room, and talk.
  Ada: {
    role: "Bank teller, OrbitX Bank",
    lines: [
      "Welcome to OrbitX Bank. Deposits, savings, City Sol — window's open.",
      "Everything here's a demo ledger, so your real wallet never moves. City Sol only.",
      "Between you and me, the vault's the safest spot in the city. Nobody's ever robbed us. Yet.",
    ],
    patrol: [
      [0, 0],
      [1.2, 0],
      [-1.2, 0],
      [0, 0.8],
    ],
  },
  Milo: {
    role: "Cashier, OrbitX Grocery",
    lines: [
      "Grocery's stocked — fruit, snacks, the good stuff's by the checkout.",
      "I scan, you pay City Sol, everybody eats. Simple shift, honest work.",
      "Night crowd cleans out the snack shelf by nine. Every single night.",
    ],
    patrol: [
      [0, 0],
      [1.5, 0],
      [-1.5, 0],
    ],
  },
  Jax: {
    role: "Mechanic, OrbitX Motors",
    lines: [
      "Motors is open. If it rolls, hovers or flies, I can keep it running.",
      "Fuel tanks and charge ports — check yours before a long run to the states.",
      "That hover rig in the back? Custom build. Don't touch the paint.",
    ],
    patrol: [
      [0, 0],
      [0, 2],
      [0, -2],
    ],
  },
  Sal: {
    role: "Dock worker, Harbor Office",
    lines: [
      "Harbor Office — ferry schedules, dock work, best view in the city.",
      "Ferry's free and runs all day. States are twenty minutes across the water.",
      "Crates come in at dawn. I know every boat by its horn.",
    ],
    patrol: [
      [0, 0],
      [2.5, 0],
      [-2.5, 0],
    ],
  },
  Zed: {
    role: "Vendor, Night Market",
    lines: [
      "Night Market — my stall's the warm one. Everything's City Sol.",
      "I set up at sunset and the harbor crowd finds me by the lights.",
      "Haggle if you want. Pia taught me, so good luck.",
    ],
    patrol: [
      [0, 0],
      [1.8, 0],
      [-1.8, 0],
      [0, -1.5],
    ],
  },
  Lux: {
    role: "Arcade attendant, Neon Arcade",
    lines: [
      "Neon Arcade — cabinets are free, high scores are forever.",
      "Felix holds every record in here. Somebody please humble him.",
      "Reflex light pays fast hands. Watch for gold, then strike.",
    ],
    patrol: [
      [0, 0],
      [0, 1.8],
      [0, -1.8],
    ],
  },
  Comet: {
    role: "Commuter",
    lines: [
      "South end to the plaza, every day. The walk keeps me honest.",
      "You see the whole city on this route — harbor behind you, towers ahead.",
      "One day I'll buy a hover car. Today's not that day.",
    ],
    patrol: [
      [0, 0],
      [0, -140],
      [2, -140],
      [2, 0],
    ],
  },
  Bex: {
    role: "Commuter",
    lines: [
      "East side, best side. I walk this stretch every morning.",
      "The states changed everything — half my street works across the water now.",
      "Mind the traffic out here. Drivers treat the ring like a racetrack.",
    ],
    patrol: [
      [0, 0],
      [60, 0],
      [60, 4],
      [0, 4],
    ],
  },
  Gus: {
    role: "Mail carrier",
    lines: [
      "Mail route: shop row, bank row, and every door between. Rain or shine.",
      "Parcels pay good City Sol if you're looking for work — ask Sol at the shop.",
      "I know every address in this city. Every single one.",
    ],
    patrol: [
      [0, 0],
      [48, 0],
      [48, -108],
      [0, -108],
    ],
  },
  Park: {
    role: "Police officer, Plaza beat",
    lines: [
      "Officer Park. Plaza beat's mine — keep it friendly and we get along.",
      "We pull over speeders and joyriders. The ticket book's real, the fines are City Sol.",
      "Thinking about the badge? The department takes good drivers. Ask at the station.",
    ],
    patrol: [
      [0, 0],
      [14, 0],
      [14, 37],
      [-8, 37],
      [-8, 0],
    ],
  },
  Pip: {
    role: "Gas station attendant, OrbitX Fuel",
    lines: [
      "OrbitX Fuel — pumps are live, prices are City Sol. Pull under the canopy.",
      "Electric? Chargers are over at the plaza, east edge. I just do gas here.",
      "Run it dry and she'll crawl in limp mode. Ask me how I know.",
    ],
    patrol: [
      [0, 0],
      [2, -2],
      [-1, -3.5],
      [0, 0],
    ],
  },
};

// Fallback lines for any citizen without an entry above.
export const NPC_DEFAULT_LINES: string[] = [
  "Good to see you out in the city.",
  "Plaza's busy today. The fountain never sleeps.",
  "If you're looking for work, the Jobs board by the kiosks lists it all.",
];
export const NPC_DEFAULT_PATROL: Array<[number, number]> = [
  [0, 0],
  [2, 1],
  [-2, 1],
  [0, -2],
];

// ---- Activities (City Sol only, real state changes) ----
export const WISH_SPOT = { x: 0, z: 12, radius: 8.5, cost: 5 };

export interface PhotoSpot {
  id: string;
  name: string;
  x: number;
  z: number;
  y?: number;
}
export const PHOTO_SPOTS: PhotoSpot[] = [
  { id: "fountain", name: "Fountain plaza", x: 14, z: 12 },
  // Tower spot: moved off the spawn walk (it used to sit at 0, 2, so the
  // first prompt a new player saw was "Take photo") to the plaza in front
  // of the tower door, clear of the door anchor — the door now says
  // "Enter office" instead. Fountain and pier spots untouched.
  { id: "tower", name: "ORBITX tower", x: -30, z: 8 },
  { id: "pier", name: "Harbor pier", x: 0, z: 232 },
  { id: "hq-roof", name: "OrbitX HQ rooftop", x: -54, z: 10, y: 24 },
];
export const PHOTO_REWARD = 10;

export const DANCE_SPOT = { x: 48, z: 90 };
export const DANCE_BEATS = 8;
export const DANCE_BEAT_MS = 850;

// Batch 2 venues — fixed locations, same as city.ts (furnishMuseum /
// addStadium / furnishNightclub). Keep the two files in sync if a venue
// ever moves.
// Museum: stand points 2 units in front of each exhibit pedestal. First
// view of each pays MUSEUM_REWARD; viewing all four pays MUSEUM_BONUS.
// SPACING (2026-11-11): these track the museum's origin (-172,152) —
// pedestals sit at [x0+2.2, z0+4] / [x0+w-2.2, z0+d-4] in furnishMuseum
// (city.ts), stand points 2 units toward the room centre from each one.
// The old values pointed at the (-99,176) museum and were never moved
// when it shifted to (-98,185), so the stands sat outside the building.
export interface MuseumExhibit {
  id: string;
  name: string;
  x: number;
  z: number;
}
export const MUSEUM_EXHIBITS: MuseumExhibit[] = [
  { id: "genesis", name: "Genesis Block", x: -167.8, z: 156 },
  { id: "coin", name: "First ORBITX Coin", x: -167.8, z: 168 },
  { id: "relic", name: "Pump.fun Relic", x: -156.2, z: 156 },
  { id: "chart", name: "The $100K Chart", x: -156.2, z: 168 },
];
export const MUSEUM_REWARD = 10;
export const MUSEUM_BONUS = 20;
// Nightclub: the dance floor is the checkerboard at the room center.
export const CLUB_DANCE_SPOT = { x: 182, z: 198 };
// Casino: one lever pull costs CASINO_COST City Sol; the payout table
// mirrors the fountain wish (0 / 5 / 10 / 25). CASINO_TABLE is the
// roulette table at the room center, where the lever burst plays.
export const CASINO_COST = 5;
export const CASINO_TABLE = { x: -19.5, z: -180 };
// Hotel: a night costs HOTEL_COST City Sol and rests the player for
// HOTEL_REST_MIN minutes — job pay +10% while rested.
export const HOTEL_COST = 20;
export const HOTEL_REST_MIN = 10;
// Stadium: the sprint runs west→east on the track (z = 217) from the
// white start line to the gold finish line. Payout scales with speed:
// STADIUM_BASE minus STADIUM_PER_SEC per second, floored at STADIUM_MIN.
export const STADIUM_START = { x: 151, z: 217 };
export const STADIUM_FINISH_X = 191;
export const STADIUM_BASE = 45;
export const STADIUM_PER_SEC = 2;
export const STADIUM_MIN = 5;
// Boxing: a real ring on the apron south of the stadium (city.ts
// addBoxingRing builds it at the same coords — keep the two in sync).
// Three opponents, escalating: entry is charged on fight start through
// spend(), a win pays winPay through earn(), a loss loses the entry, a
// decision draw refunds half. Fights are 3 rounds x 60s with short
// breaks; win by KO or by HP% at the final bell.
export const BOXING_RING = { x: 170, z: 238, top: 0.45, half: 3.6 };
export const BOXING_TRAINER = { name: "Coach Dom", color: "silver", x: 163.2, z: 231.8 };
export const BOXING_ROUNDS = 3;
export const BOXING_ROUND_SECS = 60;
export const BOXING_BREAK_SECS = 8;
export interface BoxingOpponent {
  id: string;
  name: string;
  title: string;
  /** makePerson colour key — matches the citizen of the same name. */
  color: string;
  hat: string;
  entry: number;
  winPay: number;
  hp: number;
  /** Approach speed in units/sec (the player walks 5.2, fights at ~3.2). */
  speed: number;
  jabDmg: [number, number];
  heavyDmg: [number, number];
  /** 0..1 — how often an in-range think turns into an attack. */
  aggression: number;
  /** 0..1 — chance a think answers a player attack with a block. */
  blockChance: number;
  /** 0..1 — chance a think answers a player heavy with a dodge. */
  dodgeChance: number;
  /** Seconds between AI decisions — lower reads the player better. */
  reaction: number;
}
export const BOXING_OPPONENTS: BoxingOpponent[] = [
  { id: "sal", name: "Sal", title: "Harbor Brawler", color: "white", hat: "cap", entry: 25, winPay: 60, hp: 80, speed: 2.5, jabDmg: [3, 5], heavyDmg: [8, 12], aggression: 0.45, blockChance: 0.12, dodgeChance: 0.04, reaction: 0.42 },
  { id: "jax", name: "Jax", title: "The Wrench", color: "red", hat: "none", entry: 75, winPay: 190, hp: 100, speed: 2.9, jabDmg: [4, 6], heavyDmg: [10, 14], aggression: 0.6, blockChance: 0.22, dodgeChance: 0.1, reaction: 0.32 },
  { id: "bruno", name: "Bruno", title: "City Champion", color: "gold", hat: "none", entry: 200, winPay: 500, hp: 125, speed: 3.3, jabDmg: [5, 7], heavyDmg: [12, 17], aggression: 0.75, blockChance: 0.34, dodgeChance: 0.18, reaction: 0.24 },
];
// OrbitX Motors car shop — fixed location, same as city.ts (furnishCarShop
// + buildCarShopLot + the buildCity hook in addFixedPlaces). Keep the two
// files in sync if the shop ever moves. This is THE place to buy a car:
// the garage panel opens at the shop door and at the sales counter, in
// City Sol only (the 27-vehicle catalog in vehicles.ts is untouched). The
// stray parked cars are gone — the only cars outside a real place are the
// player's own car (north plaza) and the bought car on the shop forecourt.
export const CAR_SHOP_PLACE = {
  id: "carshop",
  name: "OrbitX Motors",
  // Showroom building: x0, z0, w, d + door face.
  x: 210,
  z: -80,
  w: 26,
  d: 22,
  door: "w",
  // Door anchor (E opens the buy panel) and the sales-counter service point.
  anchor: { x: 208.6, z: -69 },
  service: { x: 231.9, z: -69 },
  // Forecourt lot out front (display cars + bought-car bay).
  forecourt: { x0: 184, z0: -78, x1: 210, z1: -58 },
  // Bought/active car spawn on the forecourt (runtime "shop-row").
  spawn: { x: 202, z: -69 },
} as const;
// ---- Busking, parcel run, car wash (City Sol only, real state changes) ----
// Busking: a rhythm set at the plaza corner — 6 beats, E on the beat,
// 5 City Sol for showing up plus 3 per hit. Mirrors the dance floor.
export const BUSK_SPOT = { x: 14, z: 26 };
export const BUSK_BEATS = 6;
export const BUSK_BEAT_MS = 800;
export const BUSK_BASE = 5;
export const BUSK_PER_HIT = 3;
// Parcel run: pick up at the bank steps, deliver at the Library door.
// Both spots sit clear of the door anchors so E answers the parcel,
// not the door.
export const PARCEL_PICKUP = { x: 70, z: -54 };
export const PARCEL_DELIVER = { x: -70, z: 163 };
export const PARCEL_REWARD = 20;
// Car wash: hold still at the garage corner for 4 seconds, 12 City Sol.
// 45s hose cooldown between washes; walking off cancels the wash.
export const WASH_SPOT = { x: 74, z: 58 };
export const WASH_MS = 4000;
export const WASH_PAY = 12;
export const WASH_COOLDOWN_MS = 45000;

// ---- FUEL: real tanks, gas stations, EV charging ----------------------
// Every car carries a tank (or battery) that drains as it drives; an
// empty one drops the car to limp mode until it is filled. Fill prices
// are City Sol per missing percent. The network is data-driven: the
// world meshes (city.ts), the floating labels and the fill interaction
// (runtime.ts) all read these two lists, and the interaction always
// works at the NEAREST suitable point — gas cars at any gas station,
// EVs at any charge point.
//
// Placement (verified against the built city — colliders, facades and
// the road grid; roads run on the ±36/72/108/144/180 avenues, 10 wide):
// every forecourt sits on open ground BESIDE an avenue, never mid-block,
// never inside a building. `axis` is the forecourt's long axis: "ew" =
// pumps/posts side by side along x (station beside a north-south
// avenue), "ns" = along z (beside an east-west avenue).
export interface FuelPoint {
  name: string;
  x: number;
  z: number;
  axis: "ew" | "ns";
}
export const GAS_STATIONS: FuelPoint[] = [
  // The original: OrbitX Motors lot, east avenues (attendant Pip on post).
  { name: "OrbitX Fuel", x: 196, z: -58, axis: "ew" },
  // North edge, beside the z=-180 avenue — the Mega Mall side of the map.
  { name: "OrbitX Fuel North", x: 126, z: -196, axis: "ns" },
  // West avenues, mirror of the Motors forecourt across the map.
  { name: "OrbitX Fuel West", x: -196, z: -58, axis: "ew" },
  // South-east, beside the x=180 avenue — serves the waterfront/beach run.
  { name: "OrbitX Fuel Beach", x: 196, z: 162, axis: "ew" },
];
export const CHARGE_POINTS: FuelPoint[] = [
  // The original: two posts on the plaza's east edge.
  { name: "EV Charging", x: 22, z: 26, axis: "ew" },
  // The mall block's front lawn, across the z=-36 avenue from the plaza.
  { name: "EV Charging · Mega Mall", x: 10, z: -44, axis: "ew" },
  // Against OrbitX HQ's east wall, on the x=-36 avenue sidewalk.
  { name: "EV Charging · HQ", x: -42, z: 18, axis: "ns" },
  // West avenues, in front of the west tower grounds.
  { name: "EV Charging · West", x: -196, z: 18, axis: "ew" },
  // The stadium promenade strip, just off the z=180 avenue.
  { name: "EV Charging · Stadium", x: 126, z: 186, axis: "ew" },
];
export const FUEL_SPOT = { x: GAS_STATIONS[0].x, z: GAS_STATIONS[0].z };
export const EV_SPOT = { x: CHARGE_POINTS[0].x, z: CHARGE_POINTS[0].z };
export const FUEL_FILL_MS = 3000;
export const FUEL_PRICE_PER_PCT = 0.5;
export const EV_PRICE_PER_PCT = 0.35;

// ---- STORY MODE: a chapter chain through the living city --------------
// Shown under Missions in the Jobs panel. Steps complete from real play
// (talking, driving, working, filling, ticketing, robbing, escaping,
// hijacking); finishing a chapter pays its reward in City Sol.
export interface StoryStep {
  kind: "talk" | "visit" | "drive" | "job" | "fuel" | "ticket" | "rob" | "escape" | "hijack" | "race" | "photo" | "fight" | "heat";
  label: string;
  npc?: string;
  x?: number;
  z?: number;
  radius?: number;
  seconds?: number;
}
export interface StoryChapter {
  title: string;
  intro: string;
  reward: number;
  steps: StoryStep[];
}
export const STORY_CHAPTERS: StoryChapter[] = [
  {
    title: "First Day in OrbitX",
    intro: "Every legend starts with a walk around the block. Meet the faces, take a drive, pick up a shift.",
    reward: 150,
    steps: [
      { kind: "talk", npc: "Rio", label: "Meet Rio at the fountain" },
      { kind: "talk", npc: "Mina", label: "Say hello to Mina at Cafe Nova" },
      { kind: "drive", seconds: 20, label: "Take any car for a drive (20 seconds)" },
      { kind: "job", label: "Clock into any job" },
    ],
  },
  {
    title: "The Working City",
    intro: "The city runs on people who show up. Bankers, attendants, officers — learn how the place actually works.",
    reward: 200,
    steps: [
      { kind: "talk", npc: "Ada", label: "Meet Ada at OrbitX Bank" },
      { kind: "talk", npc: "Pip", label: "Meet Pip at OrbitX Fuel" },
      { kind: "fuel", label: "Fill a tank or charge a battery" },
      { kind: "ticket", label: "Pull a driver over and write a ticket (H key, then E at their window)" },
    ],
  },
  {
    title: "The Wild Side",
    intro: "You know the city's rules now. Time to break a few — and live to tell it.",
    reward: 350,
    steps: [
      { kind: "talk", npc: "Park", label: "Meet Officer Park on the plaza" },
      { kind: "rob", label: "Rob a bank, shop or grocery (Talk, then Rob)" },
      { kind: "escape", label: "Lose the heat — wanted level back to zero" },
      { kind: "hijack", label: "Hijack the bus or the train (J key when close)" },
    ],
  },
  // ACT II — one connected arc: the name you made in Act I starts
  // opening doors — and collecting debts. Lux and Zed test your street
  // cred, Ada's bank trouble pulls Park back in, and Jax puts real
  // money behind you for a shot at Bruno's belt.
  {
    title: "Street Cred",
    intro: "Word travels. Lux has been watching since your first day — Felix still holds every record in her arcade, and she's tired of it. Prove you're more than a tourist.",
    reward: 300,
    steps: [
      { kind: "talk", npc: "Lux", label: "Hear Lux out at the Neon Arcade" },
      { kind: "race", label: "Finish any checkpoint trial (Jobs → Checkpoint races)" },
      { kind: "visit", x: -18, z: 76, radius: 9, label: "Pick up Zed's package at the Night Market" },
      { kind: "visit", x: 44.5, z: 54, radius: 9, label: "Bring the package back to Lux at the Neon Arcade" },
      { kind: "photo", label: "Snap the moment — take a photo in Photo Mode (phone Camera)" },
    ],
  },
  {
    title: "Heat",
    intro: "Ada's vault ledger doesn't balance — pages went missing in the Wild Side chaos, and if the auditors find out before she does, the bank is done. She needs the backup ledger moved quietly, and the heat pointed anywhere but at her door.",
    reward: 300,
    steps: [
      { kind: "talk", npc: "Ada", label: "Ada's rattled — hear her out at OrbitX Bank" },
      { kind: "visit", x: -18, z: 76, radius: 9, label: "Drop Ada's backup ledger with Zed at the Night Market" },
      { kind: "heat", label: "Draw the heat — gain a wanted star, then clear it (pay the fine, take the bust, or outrun them)" },
      { kind: "talk", npc: "Park", label: "Square it with Officer Park on the plaza" },
    ],
  },
  {
    title: "Champion's Circuit",
    intro: "Jax has been quietly telling the whole Motors lot you're the real thing. Now he's putting his name — and his money — behind it: a shot at Bruno and the OrbitX City Championship. The whole cast is watching this one.",
    reward: 400,
    steps: [
      { kind: "talk", npc: "Jax", label: "Jax at OrbitX Motors wants to sponsor a fighter — you" },
      { kind: "visit", x: 170, z: 238, radius: 11, label: "Step into the ring south of the stadium" },
      { kind: "fight", npc: "Bruno", label: "Beat Bruno — take the Champion Belt (Coach Dom's card, ringside)" },
      { kind: "visit", x: 0, z: 12, radius: 10, label: "Victory lap — take it in at the plaza fountain, where it all started" },
    ],
  },
];
// CAMPAIGN: finishing the final chapter pays a one-time completion
// bonus on top of the chapter reward (runtime.ts advanceStory).
export const CAMPAIGN_BONUS = 500;

// ---- CHECKPOINT RACES: solo time trials on the avenue grid ------------
// Three routes, every point an avenue intersection on the real road grid
// (city.ts CENTERS: -180..180 in 36-steps, roads 10 wide). Points sit ON
// ring avenues (±36 / ±144 / ±180) — the same lines the traffic loops
// drive — never inside the plaza box (±31) and never on a mid-block
// stretch, so a car can always reach the next pillar at speed. Pars are
// set from route length against real car pace: a mid car averages
// ~55-65% of its top speed over a run (corners, traffic), the fastest
// catalog cars roughly double a sedan — gold is a clean run in a decent
// car, silver a mid car driven well, bronze a finish with mistakes.
// Rewards pay in City Sol by medal; finishing outside bronze still pays
// the completion amount. Solo + local: bests live in localStorage
// (orbitx-city-race-bests-v1), the server street race is untouched.
export interface RaceRoute {
  id: string;
  name: string;
  blurb: string;
  /** true = the finish line is the start point again. */
  loop: boolean;
  /** points[0] is the start; the rest are checkpoints in order. */
  points: { x: number; z: number }[];
  /** Par times in seconds: [gold, silver, bronze]. */
  pars: [number, number, number];
  /** City Sol by medal: [gold, silver, bronze, completion]. */
  rewards: [number, number, number, number];
}
export const RACE_ROUTES: RaceRoute[] = [
  {
    id: "plaza-sprint",
    name: "Plaza Sprint",
    blurb: "One tight lap of the plaza ring — eight corners, no straights to hide in.",
    loop: true,
    points: [
      { x: 36, z: 36 },
      { x: 36, z: 0 },
      { x: 36, z: -36 },
      { x: 0, z: -36 },
      { x: -36, z: -36 },
      { x: -36, z: 0 },
      { x: -36, z: 36 },
      { x: 0, z: 36 },
    ],
    pars: [40, 52, 68],
    rewards: [120, 80, 50, 20],
  },
  {
    id: "beach-run",
    name: "Beach Run",
    blurb: "East along the waterfront avenue, then north up the far side. Point to point — no second lap.",
    loop: false,
    points: [
      { x: -144, z: 180 },
      { x: -72, z: 180 },
      { x: 0, z: 180 },
      { x: 72, z: 180 },
      { x: 144, z: 180 },
      { x: 180, z: 180 },
      { x: 180, z: 108 },
      { x: 180, z: 36 },
      { x: 180, z: -36 },
    ],
    pars: [58, 72, 90],
    rewards: [180, 120, 75, 30],
  },
  {
    id: "avenue-gp",
    name: "Avenue GP",
    blurb: "The full outer ring — over a kilometre of avenue. Bring the fastest car you own.",
    loop: true,
    points: [
      { x: 144, z: 144 },
      { x: 36, z: 144 },
      { x: -72, z: 144 },
      { x: -144, z: 144 },
      { x: -144, z: 36 },
      { x: -144, z: -72 },
      { x: -144, z: -144 },
      { x: -36, z: -144 },
      { x: 72, z: -144 },
      { x: 144, z: -144 },
      { x: 144, z: -36 },
    ],
    pars: [100, 125, 155],
    rewards: [300, 200, 120, 40],
  },
];

// ---- FOOD: cooking, restaurants, gym, hunger (City Sol only) ----------
// Shared contract with the server (api/city.js FOOD section — the server
// is the price authority; this file is the client's display copy).
// The grocery store (Piece 2) sells GROCERY_FOODS and tops up the
// pantry; cooking eats the pantry, restaurants and the gym are below.
// Lots were verified CLEAR against buildCity(1): no zone, no tall
// collider, no road strip (see lot-verify-food.ts — the museum's old
// slot and the casino forecourt stay empty on purpose, never build there).
export interface GroceryFood {
  id: string;
  name: string;
  /** Hunger restored eating it raw, straight from the bag. */
  snack: number;
}
export const GROCERY_FOODS: GroceryFood[] = [
  { id: "bread", name: "Bread", snack: 10 },
  { id: "patty", name: "Beef Patty", snack: 10 },
  { id: "dough", name: "Pizza Dough", snack: 8 },
  { id: "cheese", name: "Cheese", snack: 12 },
  { id: "greens", name: "Salad Greens", snack: 10 },
  { id: "dressing", name: "Dressing", snack: 6 },
  { id: "potato", name: "Potato", snack: 10 },
  { id: "tomato", name: "Tomato", snack: 10 },
  { id: "egg", name: "Egg", snack: 12 },
  { id: "milk", name: "Milk", snack: 8 },
];
export const GROCERY_FOOD_BY_ID: Record<string, GroceryFood> = Object.fromEntries(
  GROCERY_FOODS.map((food) => [food.id, food]),
);

export interface Recipe {
  id: string;
  name: string;
  needs: Array<[string, number]>;
  /** Hunger restored eating the cooked meal. */
  hunger: number;
  /** Extra stamina (salads and omelettes are good for you). */
  stamina: number;
  blurb: string;
}
export const RECIPES: Recipe[] = [
  { id: "city-burger", name: "City Burger", needs: [["bread", 1], ["patty", 1]], hunger: 40, stamina: 0, blurb: "Bread + patty. The plaza classic." },
  { id: "plaza-pizza", name: "Plaza Pizza", needs: [["dough", 1], ["cheese", 1]], hunger: 45, stamina: 0, blurb: "Dough + cheese. Half the city runs on it." },
  { id: "sunset-salad", name: "Sunset Salad", needs: [["greens", 1], ["dressing", 1]], hunger: 35, stamina: 1, blurb: "Greens + dressing. Light, and +1 stamina." },
  { id: "fries", name: "Harbor Fries", needs: [["potato", 1]], hunger: 20, stamina: 0, blurb: "One potato. The quick snack that still counts as cooking." },
  { id: "omelette", name: "Sunrise Omelette", needs: [["egg", 1], ["cheese", 1]], hunger: 30, stamina: 1, blurb: "Egg + cheese. Breakfast for a long shift." },
];

export interface RestaurantPlace {
  id: string;
  name: string;
  vibe: string;
  x: number;
  z: number;
  w: number;
  d: number;
  door: "n" | "s" | "e" | "w";
  wall: string;
  accent: string;
}
export const RESTAURANT_PLACES: RestaurantPlace[] = [
  {
    id: "diner", name: "Sunset Diner", vibe: "Cheap chrome diner by the garage — burgers, fries, shakes.",
    x: 115, z: 43, w: 20, d: 20, door: "w", wall: "warm", accent: "red",
  },
  {
    id: "pizza", name: "Pizza Nova", vibe: "Wood-fired pizza house on the east side — cozy, loud, cheesy.",
    x: 187, z: 48, w: 20, d: 18, door: "w", wall: "cream", accent: "leavesDark",
  },
  {
    id: "fork", name: "The Gold Fork", vibe: "White tablecloths and gold trim by the park — the fancy night out.",
    x: 78, z: 230, w: 20, d: 20, door: "n", wall: "white", accent: "gold",
  },
];
export interface RestaurantMenuItem {
  id: string;
  name: string;
  price: number;
  hunger: number;
  desc: string;
}
export const RESTAURANT_MENUS: Record<string, RestaurantMenuItem[]> = {
  diner: [
    { id: "diner-burger", name: "Diner Burger", price: 12, hunger: 35, desc: "Double patty, chrome-plate service." },
    { id: "diner-fries", name: "Diner Fries", price: 6, hunger: 18, desc: "Salted twice. Worth the six." },
    { id: "diner-shake", name: "Milkshake", price: 8, hunger: 15, desc: "Thick enough to need the wide straw." },
    { id: "diner-coffee", name: "Diner Coffee", price: 4, hunger: 8, desc: "Bottomless attitude, one cup." },
  ],
  pizza: [
    { id: "pizza-margherita", name: "Margherita", price: 18, hunger: 40, desc: "Tomato, cheese, basil. No notes." },
    { id: "pizza-pepperoni", name: "Pepperoni Slice", price: 24, hunger: 45, desc: "The slice that ends arguments." },
    { id: "pizza-garlic", name: "Garlic Bread", price: 10, hunger: 20, desc: "Butter, garlic, gone in seconds." },
  ],
  fork: [
    { id: "fork-steak", name: "Gold Steak", price: 60, hunger: 55, desc: "Seared gold, served slow." },
    { id: "fork-pasta", name: "Truffle Pasta", price: 45, hunger: 50, desc: "Truffle, cream, white tablecloth." },
    { id: "fork-dessert", name: "Sunset Dessert", price: 25, hunger: 30, desc: "Gold leaf on top. Obviously." },
  ],
};
export const RESTAURANT_BY_ID: Record<string, RestaurantPlace> = Object.fromEntries(
  RESTAURANT_PLACES.map((place) => [place.id, place]),
);

// Harbor Gym workouts — 5 City Sol a set, +2 stamina, 30s between sets.
export interface GymWorkout {
  id: string;
  name: string;
  cost: number;
  gain: number;
  desc: string;
}
export const GYM_WORKOUTS: GymWorkout[] = [
  { id: "treadmill", name: "Treadmill Run", cost: 5, gain: 2, desc: "Run the belt. Legs first." },
  { id: "weights", name: "Bench Press", cost: 5, gain: 2, desc: "Press the bar. Chest and arms." },
  { id: "bag", name: "Heavy Bag", cost: 5, gain: 2, desc: "Work the bag. Shoulders and spite." },
];
export const GYM_SPOT = { x: 73, z: 217 };
// OrbitX HQ interactable spots (runtime checks them zone-gated, the
// GYM_SPOT pattern): the Burn Counter board + Floor Guide post in the
// lobby, the terminal-desk stools on Floors 2–3, the Founder's desk,
// the Event Hall podium (host mode) and the City Radio booth.
export const HQ_BURN_SPOT = { x: -97.6, z: 2 };
export const HQ_GUIDE_SPOT = { x: -58.5, z: 6 };
export const HQ_TERMINAL_SPOTS: Array<{ zone: string; x: number; z: number }> = [
  { zone: "hq-2", x: -84, z: -26.3 },
  { zone: "hq-2", x: -76, z: -26.3 },
  { zone: "hq-2", x: -68, z: -26.3 },
  { zone: "hq-3", x: -84, z: -26.3 },
  { zone: "hq-3", x: -76, z: -26.3 },
  { zone: "hq-3", x: -68, z: -26.3 },
];
export const HQ_FOUNDER_SPOT = { x: -88, z: -7.4 };
export const HQ_PODIUM_SPOT = { x: -91, z: 0 };
export const HQ_RADIO_SPOT = { x: -94, z: 15 };
export interface SeatSpot {
  x: number;
  /** Seat-top height — the body y while seated. */
  y: number;
  z: number;
  /** Facing (body yaw) while seated. */
  yaw: number;
}
// SEATS (runtime sit interaction): benches, chairs and sofas the player
// can actually sit on — E snaps onto the seat with a held sit emote.
// Facings follow the geometry in city.ts buildCity: Event Hall benches
// face the stage (-x), lobby pieces face their room/table, the
// Founder's armchairs face the windows (-x), roof pieces face in.
export const SEATS: SeatSpot[] = [
  // Event Hall bench rows: 6 rows x 2 blocks, 3 seats per bench.
  ...[-84, -80.5, -77, -73.5, -70, -66.5].flatMap((rx) =>
    [-7.5, 7.5].flatMap((bz) => [-3.5, 0, 3.5].map((off) => ({ x: rx, y: 20.58, z: bz + off, yaw: -Math.PI / 2 }))),
  ),
  // HQ lobby wall benches (face into the lobby).
  { x: -52, y: 0.6, z: -20.85, yaw: -Math.PI / 2 },
  { x: -52, y: 0.6, z: -19.15, yaw: -Math.PI / 2 },
  { x: -97.5, y: 0.6, z: -12.85, yaw: Math.PI / 2 },
  { x: -97.5, y: 0.6, z: -11.15, yaw: Math.PI / 2 },
  // HQ lobby centrepiece benches (face the coffee table).
  { x: -72.85, y: 0.6, z: -13.2, yaw: Math.PI },
  { x: -71.15, y: 0.6, z: -13.2, yaw: Math.PI },
  { x: -72.85, y: 0.6, z: -2.8, yaw: 0 },
  { x: -71.15, y: 0.6, z: -2.8, yaw: 0 },
  { x: -77.5, y: 0.6, z: -8.85, yaw: Math.PI / 2 },
  { x: -77.5, y: 0.6, z: -7.15, yaw: Math.PI / 2 },
  { x: -66.5, y: 0.6, z: -8.85, yaw: -Math.PI / 2 },
  { x: -66.5, y: 0.6, z: -7.15, yaw: -Math.PI / 2 },
  // Glass meeting room chairs (meeting table 6x4 at (-75.5, -22.5)).
  ...[-77.5, -75.5, -73.5].map((cx) => ({ x: cx, y: 0.55, z: -25.4, yaw: Math.PI })),
  ...[-77.5, -75.5, -73.5].map((cx) => ({ x: cx, y: 0.55, z: -19.6, yaw: 0 })),
  // Founder's Office window armchairs (face the city view, -x).
  { x: -97.5, y: 16.58, z: -4.5, yaw: -Math.PI / 2 },
  { x: -97.5, y: 16.58, z: 0.8, yaw: -Math.PI / 2 },
  // Founder's meeting table chairs (table 8x5 at (-88, -17.2)).
  ...[-91, -88.33, -85.67].map((cx) => ({ x: cx, y: 16.55, z: -20.6, yaw: Math.PI })),
  ...[-91, -88.33, -85.67].map((cx) => ({ x: cx, y: 16.55, z: -13.8, yaw: 0 })),
  // Roof terrace benches (face into the terrace).
  { x: -89, y: 24.6, z: 17.15, yaw: Math.PI / 2 },
  { x: -89, y: 24.6, z: 18.85, yaw: Math.PI / 2 },
  { x: -49, y: 24.6, z: 17.15, yaw: -Math.PI / 2 },
  { x: -49, y: 24.6, z: 18.85, yaw: -Math.PI / 2 },
  { x: -89, y: 24.6, z: -18.85, yaw: Math.PI / 2 },
  { x: -89, y: 24.6, z: -17.15, yaw: Math.PI / 2 },
  { x: -49, y: 24.6, z: -18.85, yaw: -Math.PI / 2 },
  { x: -49, y: 24.6, z: -17.15, yaw: -Math.PI / 2 },
  // Roof lounge sofas (face each other across the table).
  { x: -60.85, y: 24.6, z: -17, yaw: Math.PI },
  { x: -59.15, y: 24.6, z: -17, yaw: Math.PI },
  { x: -60.85, y: 24.6, z: -11, yaw: 0 },
  { x: -59.15, y: 24.6, z: -11, yaw: 0 },
];
export const WORKOUT_COOLDOWN_MS = 30000;
export const FED_MIN = 10;

// Hunger that matters — same formula as api/city.js foodSpeedMult.
// Keep the two in sync: well fed (>=70) x1.10, peckish x0.85, starving
// (0) x0.70; stamina adds up to +10% on top.
export function foodSpeedMult(hunger: number, stamina: number): number {
  const h = Number(hunger || 0);
  const hungerMult = h >= 70 ? 1.1 : h >= 30 ? 1.0 : h > 0 ? 0.85 : 0.7;
  const staminaMult = 1 + Math.min(100, Math.max(0, Number(stamina || 0))) * 0.001;
  return Math.round(hungerMult * staminaMult * 1000) / 1000;
}
export function hungerLabel(hunger: number): string {
  if (hunger >= 70) return "Well fed";
  if (hunger >= 30) return "Hungry";
  if (hunger > 0) return "Very hungry";
  return "Starving";
}

export interface CityContent {
  projects: ProjectInfo[];
  billboards: BillboardInfo[];
  events: EventInfo[];
}

async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const url = new URL(`config/${file}`, document.baseURI);
    const res = await fetch(url.href);
    if (!res.ok) return fallback;
    const data = (await res.json()) as T;
    return data ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadContent(): Promise<CityContent> {
  const [projects, billboards, events] = await Promise.all([
    loadJson("projects.json", DEFAULT_PROJECTS),
    loadJson("billboards.json", DEFAULT_BILLBOARDS),
    loadJson("events.json", DEFAULT_EVENTS),
  ]);
  return {
    projects: projects.length ? projects : DEFAULT_PROJECTS,
    billboards: billboards.length ? billboards : DEFAULT_BILLBOARDS,
    events: events.length ? events : DEFAULT_EVENTS,
  };
}
