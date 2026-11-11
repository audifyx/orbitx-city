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
// Play-money prices for the offline (this-device-only) demo booking.
// Online bookings always go through the real SOL flow above.
export const DEMO_AD_PRICE: Record<number, number> = { 1: 25, 7: 80, 30: 200 };

export const DEFAULT_PROJECTS: ProjectInfo[] = [
  { id: "orbitx-hq", name: "OrbitX HQ", line: "Community headquarters", site: "https://github.com/audifyx/orbitx-city", holders: "—", price: "Set ORBITX_MINT for a live price" },
  { id: "your-project", name: "Your Project Here", line: "Holders and friends meet here", site: "", holders: "—", price: "Placeholder" },
  { id: "north-star", name: "North Star", line: "Project office", site: "", holders: "—", price: "Placeholder" },
  { id: "lumen", name: "Lumen Labs", line: "Build nights and hangouts", site: "", holders: "—", price: "Placeholder" },
];

export const DEFAULT_BILLBOARDS: BillboardInfo[] = [
  {
    id: "plaza-east",
    project: "OrbitX",
    text: "WELCOME TO THE CITY",
    image: "",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "plaza-west",
    project: "Cafe Nova",
    text: "SUNSET COFFEE",
    image: "",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "hall-front",
    project: "Community Hall",
    text: "EVENTS TONIGHT",
    image: "",
    start: "2026-01-01",
    end: "2026-12-31",
  },
  {
    id: "district-row",
    project: "Project District",
    text: "YOUR OFFICE HERE",
    image: "",
    start: "2026-01-01",
    end: "2026-12-31",
  },
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
];

// ---- NPCs: names, roles, dialogue, patrol loops ----
// Keyed by the citizen name in city.ts. `patrol` is a loop of small offsets
// from the citizen's home spot — the NPC walks between them and pauses at
// each one. `jobId` makes the NPC a job giver: the talk panel offers that
// job for real (startJob), never a dead button.
export interface NpcInfo {
  role: string;
  jobId?: string;
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
}
export const PHOTO_SPOTS: PhotoSpot[] = [
  { id: "fountain", name: "Fountain plaza", x: 14, z: 12 },
  { id: "tower", name: "ORBITX tower", x: 0, z: 2 },
  { id: "pier", name: "Harbor pier", x: 0, z: 232 },
];
export const PHOTO_REWARD = 10;

export const DANCE_SPOT = { x: 48, z: 90 };
export const DANCE_BEATS = 8;
export const DANCE_BEAT_MS = 850;

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
