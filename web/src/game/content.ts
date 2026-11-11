export interface ProjectInfo {
  id: string;
  name: string;
  line: string;
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
];

export const AD_DAYS = [1, 7, 30] as const;
export const AD_PRICE: Record<number, number> = { 1: 25, 7: 80, 30: 200 };

export const DEFAULT_PROJECTS: ProjectInfo[] = [
  { id: "orbitx-hq", name: "OrbitX HQ", line: "Community headquarters" },
  { id: "your-project", name: "Your Project Here", line: "Holders and friends meet here" },
  { id: "north-star", name: "North Star", line: "Project office" },
  { id: "lumen", name: "Lumen Labs", line: "Build nights and hangouts" },
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
];

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
