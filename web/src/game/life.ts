export const EMOTES = ["wave", "dance", "laugh", "cheer", "point", "flex", "sit", "facepalm"] as const;
export type EmoteName = (typeof EMOTES)[number];

/** Wheel labels (the keys stay lowercase for the wire / pose code). */
export const EMOTE_LABELS: Record<string, string> = {
  wave: "Wave",
  dance: "Dance",
  laugh: "Laugh",
  cheer: "Cheer",
  point: "Point",
  flex: "Flex",
  sit: "Sit",
  facepalm: "Facepalm",
};

/**
 * How long a picked emote plays, in ms. One-shots run 1.8–2.5s and
 * return to idle on their own; dance is the looper (0 = plays until
 * the player moves, drives, opens a panel, or picks another emote —
 * the runtime enforces the cancel, this table just says "no timer").
 */
export const EMOTE_DURATIONS: Record<string, number> = {
  wave: 2200,
  dance: 0,
  laugh: 2200,
  cheer: 2000,
  point: 1800,
  flex: 2200,
  sit: 2500,
  facepalm: 2400,
};

export const FURNITURE = ["couch", "table", "plant", "lamp", "screen", "rug"] as const;
export type FurnitureKind = (typeof FURNITURE)[number];

export const GATES = [
  { x: 36, z: 0 },
  { x: 36, z: 36 },
  { x: 0, z: 36 },
  { x: -36, z: 36 },
  { x: -36, z: 0 },
  { x: 36, z: 0 },
];

export interface FurniturePiece {
  id: string;
  kind: string;
  x: number;
  z: number;
  rot: number;
}

export interface LotCard {
  id: string;
  zone: string;
  anchor: string;
  name: string;
  kind: string;
  price: number;
  ownerId: string;
  ownerName: string;
  furniture: FurniturePiece[];
  // Self-serve HQ branding, set by the owner (empty until claimed + branded).
  brand?: { name?: string; line?: string; site?: string };
  // Rent + utilities, for lots this player owns (null when not owned).
  rentDue?: number | null;
  rentBill?: number | null;
  arrears?: number;
}

export interface LeaderRow {
  name: string;
  value: string;
}

export interface Leaders {
  rich: LeaderRow[];
  earners: LeaderRow[];
  burned: LeaderRow[];
  race: LeaderRow[];
}

export interface QuestCard {
  id: string;
  label: string;
  need: number;
  have: number;
  done: boolean;
}

export interface DailyCard {
  day: string;
  streak: number;
  claimed: boolean;
  reward: number;
  quests: QuestCard[];
}

export interface RaceCard {
  phase: string;
  names: string[];
  startedAt: number;
  results: { name: string; timeMs: number; kind: string }[];
  next: number;
  kind: string;
  done: boolean;
  timeMs: number;
}

export interface NoteCard {
  project: string;
  text: string;
  author: string;
}

export interface MarketCard {
  configured: boolean;
  price: string;
  holders: string;
}

export const EMPTY_LEADERS: Leaders = { rich: [], earners: [], burned: [], race: [] };

export const EMPTY_RACE: RaceCard = {
  phase: "open",
  names: [],
  startedAt: 0,
  results: [],
  next: -1,
  kind: "",
  done: false,
  timeMs: 0,
};

export function emoteIndex(dx: number, dy: number) {
  if (dx * dx + dy * dy < 36) return 0;
  const angle = Math.atan2(dy, dx);
  const slice = (angle + Math.PI) / (Math.PI * 2);
  return Math.floor(((slice % 1) + 1) % 1 * EMOTES.length) % EMOTES.length;
}
