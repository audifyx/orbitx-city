// ---------------------------------------------------------------------------
// OrbitX City — PHONE STORE: the in-game phone's on-device data.
// ---------------------------------------------------------------------------
// Everything the OrbitX OS phone keeps lives here, in localStorage on
// the player's device — message threads, the photo gallery, and phone
// preferences. The game runtime knows nothing about it: App subscribes
// to runtime phone events and files them here via appendPhoneMessage,
// and PhoneOS reads + subscribes for live updates. No server, no fake
// sync — like a real phone, the texts live on the device.
// ---------------------------------------------------------------------------

import { NPC_LINES } from "./game/content";

export interface PhoneMessage {
  id: string;
  from: string;
  text: string;
  at: number;
}

export interface PhoneThread {
  /** Thread key — the sender's name ("Pip", "OrbitX City", …). */
  id: string;
  name: string;
  role: string;
  messages: PhoneMessage[];
  unread: number;
}

const MSGS_KEY = "orbitx-city-phone-msgs-v1";
const GALLERY_KEY = "orbitx-city-phone-gallery-v1";
const PREFS_KEY = "orbitx-city-phone-prefs-v1";

const listeners = new Set<() => void>();
function emit() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* a bad listener never breaks the store */
    }
  }
}
export function subscribePhoneStore(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the phone just forgets */
  }
}

let msgSeq = 0;
function nextId(prefix: string): string {
  msgSeq += 1;
  return `${prefix}${Date.now().toString(36)}${msgSeq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// --- Messages ---------------------------------------------------------------

const SEED_THREADS: Array<{ name: string; text: string }> = [
  { name: "Pip", text: "OrbitX Fuel's open all day. Tank drops, you come see me — running dry is the only real crime in this city." },
  { name: "Ada", text: "Welcome to OrbitX Bank. Your City Sol sits right here in the ledger — safe, simple, and nobody's ever robbed us. Yet." },
  { name: "Jax", text: "Motors garage. Car gives you trouble, you call me — I fix, I deliver, I don't ask questions." },
];

function roleFor(name: string): string {
  if (name === "OrbitX City") return "City alerts";
  return NPC_LINES[name]?.role ?? "";
}

function seedThreads(): PhoneThread[] {
  const now = Date.now();
  return SEED_THREADS.map((seed, i) => ({
    id: seed.name,
    name: seed.name,
    role: roleFor(seed.name),
    messages: [{ id: nextId("m"), from: seed.name, text: seed.text, at: now - (SEED_THREADS.length - i) * 60000 }],
    unread: 1,
  }));
}

export function loadThreads(): PhoneThread[] {
  const stored = read<{ threads: PhoneThread[] }>(MSGS_KEY);
  if (stored && Array.isArray(stored.threads)) return stored.threads;
  const seeded = seedThreads();
  write(MSGS_KEY, { threads: seeded });
  return seeded;
}

function saveThreads(threads: PhoneThread[]) {
  write(MSGS_KEY, { threads });
}

/** File a new incoming text. Creates the thread on first contact. */
export function appendPhoneMessage(from: string, text: string) {
  const threads = loadThreads();
  let thread = threads.find((t) => t.id === from);
  if (!thread) {
    thread = { id: from, name: from, role: roleFor(from), messages: [], unread: 0 };
    threads.push(thread);
  }
  thread.messages.push({ id: nextId("m"), from, text, at: Date.now() });
  thread.unread += 1;
  saveThreads(threads);
  emit();
}

export function markThreadRead(id: string) {
  const threads = loadThreads();
  const thread = threads.find((t) => t.id === id);
  if (!thread || thread.unread === 0) return;
  thread.unread = 0;
  saveThreads(threads);
  emit();
}

export function totalUnread(threads: PhoneThread[]): number {
  return threads.reduce((sum, t) => sum + t.unread, 0);
}

// --- Gallery ----------------------------------------------------------------

export interface GalleryShot {
  id: string;
  at: number;
  /** Downscaled (~480px) JPEG data URL — small enough for localStorage. */
  thumb: string;
}

export const GALLERY_CAP = 12;

export function loadGallery(): GalleryShot[] {
  const stored = read<{ shots: GalleryShot[] }>(GALLERY_KEY);
  return stored && Array.isArray(stored.shots) ? stored.shots : [];
}

export function addGalleryShot(thumb: string): GalleryShot {
  const shot: GalleryShot = { id: nextId("s"), at: Date.now(), thumb };
  const shots = [shot, ...loadGallery()].slice(0, GALLERY_CAP);
  write(GALLERY_KEY, { shots });
  emit();
  return shot;
}

export function removeGalleryShot(id: string) {
  const shots = loadGallery().filter((s) => s.id !== id);
  write(GALLERY_KEY, { shots });
  emit();
}

// --- Preferences --------------------------------------------------------------

export type PhoneAccent = "gold" | "blue" | "white";

export interface PhonePrefs {
  /** Built-in wallpaper id, or "shot" to use wallpaperData. */
  wallpaper: string;
  /** Data URL of the gallery shot used as wallpaper ("" when built-in). */
  wallpaperData: string;
  accent: PhoneAccent;
}

export const DEFAULT_PHONE_PREFS: PhonePrefs = { wallpaper: "gold", wallpaperData: "", accent: "gold" };

export function loadPhonePrefs(): PhonePrefs {
  const stored = read<Partial<PhonePrefs>>(PREFS_KEY);
  if (!stored) return { ...DEFAULT_PHONE_PREFS };
  return {
    wallpaper: typeof stored.wallpaper === "string" ? stored.wallpaper : DEFAULT_PHONE_PREFS.wallpaper,
    wallpaperData: typeof stored.wallpaperData === "string" ? stored.wallpaperData : "",
    accent: stored.accent === "blue" || stored.accent === "white" ? stored.accent : "gold",
  };
}

export function savePhonePrefs(prefs: PhonePrefs) {
  write(PREFS_KEY, prefs);
  emit();
}
