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
    project: "OrbitX",
    text: "TRADE EVERYTHING. OWN THE FUTURE.",
    image: "/orbitx-banner.jpg",
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

// Batch 2 venues — fixed locations, same as city.ts (furnishMuseum /
// addStadium / furnishNightclub). Keep the two files in sync if a venue
// ever moves.
// Museum: stand points 2 units in front of each exhibit pedestal. First
// view of each pays MUSEUM_REWARD; viewing all four pays MUSEUM_BONUS.
export interface MuseumExhibit {
  id: string;
  name: string;
  x: number;
  z: number;
}
export const MUSEUM_EXHIBITS: MuseumExhibit[] = [
  { id: "genesis", name: "Genesis Block", x: -94.8, z: 180 },
  { id: "coin", name: "First ORBITX Coin", x: -94.8, z: 192 },
  { id: "relic", name: "Pump.fun Relic", x: -83.2, z: 180 },
  { id: "chart", name: "The $100K Chart", x: -83.2, z: 192 },
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
