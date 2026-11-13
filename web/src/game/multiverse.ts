/**
 * MULTIVERSE — OrbitX City universes (FiveM / GTA Online style sharding).
 *
 * Player-facing language is ALWAYS "multiverse" / "universes" — never
 * "servers" / "shards". Under the hood a universe IS a server: a fixed set
 * of 5 identical worlds, each holding up to 150 players at once.
 *
 * THE SAVE MODEL (corrected 2026-11-11 — per-server saves, NOT shared):
 *
 *   - Every universe is the SAME exact world (same map, same NY / LA /
 *     Florida). The magic bridge between NY / LA / Florida is IN-WORLD
 *     travel inside one universe — it is NOT crossing universes.
 *   - Progress is stored PER (player, universe), keyed by player + server.
 *     Your home, job, City Sol, cars, houses and offices live on the
 *     universe where you earned them — they do NOT follow you to another
 *     universe.
 *   - Your HOME universe is the universe where you made your home. Buying
 *     or claiming a home on a universe makes it your home universe. On any
 *     other universe you are a visitor: you play that universe's own save
 *     for you, and if you have never played there you start fresh there.
 *   - To be home, do your job and make money, go back to your home
 *     universe. Travelling between universes is FREE — no City Sol, no
 *     real money, no burn, no ORBITX anywhere in this.
 *
 * This module is the client side only: the universe model, the picker
 * data, the 150-player cap rule, and the join / travel calls (typed
 * `world.call` wrappers, same POST /api/city envelope as the rest of
 * world.ts). The server ops (`universe-list`, `universe-join`,
 * `universe-travel`) and the `player_saves` table are specified in
 * WIRING.md — this file is dead code until they are wired in.
 *
 * REAL-TIME: the live movement sync of 150 players needs a dedicated
 * persistent game server (WebSocket). Vercel functions are stateless and
 * short-lived and CANNOT do that. This module carries the plug for one
 * (`realtimeEndpoint` on the Universe type + `connectUniverseRealtime`),
 * and WIRING.md writes the game server up as the next infrastructure
 * step. Until it exists, `realtimeEndpoint` is null and presence falls
 * back to the existing tab / Supabase path (net.ts / live.ts).
 */

import { accountToken } from "../auth";
import type { ChatLine, NetState } from "./net";
import { world, type CityMe } from "./world";

/** One universe holds at most this many players at once. */
export const MULTIVERSE_CAP = 150;

/** The multiverse is a FIXED list — no auto-spinning new universes. */
export const UNIVERSE_IDS = [1, 2, 3, 4, 5] as const;
export type UniverseId = (typeof UNIVERSE_IDS)[number];

/** Total players the multiverse holds at once: 5 universes x 150. */
export const MULTIVERSE_TOTAL_CAPACITY = UNIVERSE_IDS.length * MULTIVERSE_CAP;

/**
 * The fixed universe roster. Same world in every one — only the players
 * and the saves differ. Names are for the picker; the id is what the
 * server stores.
 */
export const UNIVERSE_META: Readonly<Record<UniverseId, { name: string; tagline: string }>> = {
  1: { name: "Aurora", tagline: "The first universe" },
  2: { name: "Nova", tagline: "Bright lights, fresh streets" },
  3: { name: "Zenith", tagline: "The high life" },
  4: { name: "Halo", tagline: "Angels and hustlers" },
  5: { name: "Orbit", tagline: "Where it all comes around" },
};

export type UniverseStatus = "open" | "full";

/** One universe, as the picker shows it. */
export interface Universe {
  /** 1-5. What the server stores. */
  id: UniverseId;
  /** e.g. "Aurora". */
  name: string;
  /** e.g. "Universe 1 — Aurora". */
  displayName: string;
  /** Picker subtitle, e.g. "The first universe". */
  tagline: string;
  /** Always 150. */
  cap: number;
  /** Players in this universe right now. */
  playerCount: number;
  status: UniverseStatus;
  /** True when this is the player's home universe. */
  isHome: boolean;
  /**
   * WebSocket URL of this universe's game server (live movement sync).
   * Null until the game server exists — see WIRING.md. Presence then
   * falls back to the existing tab / Supabase path.
   */
  realtimeEndpoint: string | null;
}

/** Raw row shape the `universe-list` op returns (one row per universe). */
export interface UniverseListRow {
  id: number;
  playerCount: number;
  realtimeEndpoint: string | null;
}

export interface UniverseList {
  universes: Universe[];
  /** The player's home universe id, or null if they have no home yet. */
  homeServerId: UniverseId | null;
  /** The universe the player is in right now, or null if not joined. */
  currentServerId: UniverseId | null;
  /** Where the player's friends are right now — server is null when a
   * friend has no recent heartbeat (offline / never joined). The menu
   * picker tags the matching universe ("TJR is here") so the player
   * joins the same room as their friend instead of their own saved
   * universe. */
  friendsHere: { id: string; name: string; server: UniverseId | null }[];
  totalCapacity: number;
}

/**
 * One player's save ON ONE universe. Keyed (player_id, server_id) in
 * the `player_saves` table — see WIRING.md. Identity (name, email,
 * account) stays on `players`; everything below is per-universe
 * progress. Friends / inbox stay global on `players` — the social graph
 * is not progress.
 */
export type UniverseSave = Pick<
  CityMe,
  | "balance"
  | "burned"
  | "owned"
  | "color"
  | "hat"
  | "car"
  | "look"
  | "earned"
  | "jobStreak"
  | "business"
  | "rent"
  | "bestRace"
  | "bestHover"
> & {
  serverId: UniverseId;
  /** True when this save's universe is the player's home universe. */
  home: boolean;
  /** Unix ms of the last op on this save (drives the player count). */
  lastSeen: number;
};

/** What `universe-join` / `universe-travel` return. */
export interface UniverseEnterResult {
  ok: true;
  /** The player's save ON the universe they just entered. */
  me: CityMe;
  universe: Universe;
  /** True when the universe entered is the player's home universe. */
  isHome: boolean;
  /**
   * True when the player had no save on this universe yet — they start
   * fresh here as a visitor. Their home-universe progress is untouched.
   */
  isNewSave: boolean;
}

// ---------------------------------------------------------------------------
// Picker shaping (pure — no network)
// ---------------------------------------------------------------------------

export function isUniverseId(value: number): value is UniverseId {
  return (UNIVERSE_IDS as readonly number[]).includes(value);
}

export function universeDisplayName(id: UniverseId): string {
  return `Universe ${id} — ${UNIVERSE_META[id].name}`;
}

export function isFull(universe: Universe): boolean {
  return universe.status === "full" || universe.playerCount >= universe.cap;
}

export function canJoin(universe: Universe): boolean {
  return !isFull(universe);
}

/** True when every one of the 5 universes is full (750 players online). */
export function allUniversesFull(list: UniverseList): boolean {
  return list.universes.every(isFull);
}

/** The player's home universe from a shaped list, or undefined. */
export function homeUniverse(list: UniverseList): Universe | undefined {
  return list.universes.find((universe) => universe.isHome);
}

/**
 * Shape raw `universe-list` rows into picker data: sorted by id, full
 * flag computed from the 150 cap, home flag from the player's home
 * universe. Unknown / out-of-range rows are dropped.
 */
export function shapeUniverseList(
  rows: UniverseListRow[],
  homeServerId: number | null,
  currentServerId: number | null,
): UniverseList {
  const universes: Universe[] = UNIVERSE_IDS.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    const playerCount = Math.max(0, Number(row?.playerCount) || 0);
    return {
      id,
      name: UNIVERSE_META[id].name,
      displayName: universeDisplayName(id),
      tagline: UNIVERSE_META[id].tagline,
      cap: MULTIVERSE_CAP,
      playerCount,
      status: playerCount >= MULTIVERSE_CAP ? "full" : "open",
      isHome: homeServerId === id,
      realtimeEndpoint: row?.realtimeEndpoint ?? null,
    };
  });
  return {
    universes,
    homeServerId: isUniverseId(Number(homeServerId)) ? (homeServerId as UniverseId) : null,
    currentServerId: isUniverseId(Number(currentServerId)) ? (currentServerId as UniverseId) : null,
    // The pure shaper knows no friends — parseUniverseList overlays the
    // real list from the server response.
    friendsHere: [],
    totalCapacity: MULTIVERSE_TOTAL_CAPACITY,
  };
}

/**
 * Throw before a join call when the picker already knows the universe
 * is full. The server enforces the cap authoritatively — this is only
 * so the picker can disable the button without a wasted round trip.
 */
export function assertCanJoin(list: UniverseList, id: UniverseId): Universe {
  const universe = list.universes.find((candidate) => candidate.id === id);
  if (!universe) throw new Error(`Universe ${id} does not exist.`);
  if (isFull(universe)) {
    throw new Error(`${universe.displayName} is full — ${MULTIVERSE_CAP}/${MULTIVERSE_CAP} players. Pick another universe.`);
  }
  return universe;
}

/** Picker button label. Black text on white, white text on black. */
export function joinButtonLabel(universe: Universe): string {
  if (isFull(universe)) return `Full — ${universe.playerCount}/${universe.cap} players`;
  if (universe.isHome) return `Go home — ${universe.displayName}`;
  return `Enter ${universe.displayName}`;
}

/** Line shown when all 5 universes are full. */
export const ALL_UNIVERSES_FULL_MESSAGE =
  "All 5 universes are full right now — 750 players online. Wait a few minutes and try again.";

// ---------------------------------------------------------------------------
// Client calls — typed `world.call` wrappers, same /api/city envelope
// ---------------------------------------------------------------------------

/** The universe the client is currently in (module state, not persisted). */
let currentUniverseId: UniverseId | null = null;

export function getCurrentUniverseId(): UniverseId | null {
  return currentUniverseId;
}

/** Same envelope as `world.call` (world.ts): bearer token, { op, ... }. */
async function callUniverseOp(
  op: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const access = accountToken();
  if (access) headers.authorization = `Bearer ${access}`;
  else if (world.token) headers.authorization = `Bearer ${world.token}`;
  const response = await fetch("/api/city", {
    method: "POST",
    headers,
    body: JSON.stringify({ op, ...extra }),
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.ok === false) {
    throw new Error(String(data.message || "City server said no."));
  }
  return data;
}

function parseUniverseList(data: Record<string, unknown>): UniverseList {
  const rows = (Array.isArray(data.universes) ? data.universes : []) as UniverseListRow[];
  const friendsHere = (Array.isArray(data.friends) ? data.friends : [])
    .map((friend) => {
      const row = friend as { id?: unknown; name?: unknown; server?: unknown };
      const server = Number(row.server);
      return {
        id: String(row.id || ""),
        name: String(row.name || "Friend"),
        server: isUniverseId(server) ? (server as UniverseId) : null,
      };
    })
    .filter((friend) => friend.id !== "");
  return { ...shapeUniverseList(rows, Number(data.homeServerId) || null, Number(data.currentServerId) || null), friendsHere };
}

function applyEnterResult(data: Record<string, unknown>): UniverseEnterResult {
  const me = data.me as CityMe;
  if (me) world.me = me;
  const serverId = Number(data.serverId);
  const id: UniverseId = isUniverseId(serverId) ? serverId : 1;
  const playerCount = Math.max(0, Number(data.playerCount) || 0);
  const entered: Universe = {
    id,
    name: UNIVERSE_META[id].name,
    displayName: universeDisplayName(id),
    tagline: UNIVERSE_META[id].tagline,
    cap: MULTIVERSE_CAP,
    playerCount,
    status: playerCount >= MULTIVERSE_CAP ? "full" : "open",
    isHome: Boolean(data.isHome),
    realtimeEndpoint: (data.realtimeEndpoint as string | null) ?? null,
  };
  currentUniverseId = entered.id;
  return {
    ok: true,
    me,
    universe: entered,
    isHome: Boolean(data.isHome),
    isNewSave: Boolean(data.isNewSave),
  };
}

/**
 * List the 5 universes: how full each one is, and which one is the
 * player's home universe. Call this for the Multiverse picker on the
 * menu. Free.
 */
export async function listUniverses(): Promise<UniverseList> {
  const data = await callUniverseOp("universe-list", {});
  return parseUniverseList(data);
}

/**
 * Join a universe from the menu picker. Loads that universe's own save
 * for the player — a fresh save if they have never played there. The
 * server refuses the join when the universe is at the 150 cap.
 * Free. After a join, the client re-syncs (fresh world digest).
 */
export async function universeJoin(id: UniverseId): Promise<UniverseEnterResult> {
  if (!isUniverseId(id)) throw new Error(`Universe ${id} does not exist. Pick Universe 1 to 5.`);
  const data = await callUniverseOp("universe-join", { server: id });
  const result = applyEnterResult(data);
  await world.refresh();
  return result;
}

/**
 * Hop to another universe from inside the game (travel / portal
 * screen). Same as joining, but from in-world: the save that loads is
 * the destination universe's own save for the player — NOT the save
 * from the universe they came from. A visitor with no save there
 * starts fresh there. Home progress stays on the home universe.
 * Free — no City Sol, no cost of any kind. After travel the client
 * re-syncs (fresh world digest for the new universe).
 */
export async function universeTravel(id: UniverseId): Promise<UniverseEnterResult> {
  if (!isUniverseId(id)) throw new Error(`Universe ${id} does not exist. Pick Universe 1 to 5.`);
  if (currentUniverseId !== null && currentUniverseId === id) {
    throw new Error(`You are already in ${universeDisplayName(id)}.`);
  }
  const data = await callUniverseOp("universe-travel", { server: id });
  const result = applyEnterResult(data);
  await world.refresh();
  return result;
}

// ---------------------------------------------------------------------------
// Real-time plug — presence on one universe's game server
// ---------------------------------------------------------------------------

export interface UniversePresenceHandlers {
  onState: (state: NetState) => void;
  onChat: (line: ChatLine) => void;
  onBye: (id: string) => void;
}

export interface UniverseRealtime {
  readonly universeId: UniverseId;
  readonly endpoint: string;
  sendState(state: NetState): void;
  sendChat(name: string, text: string): void;
  close(): void;
}

type PresenceEnvelope =
  | { t: "state"; state: NetState }
  | { t: "chat"; id: string; name: string; text: string }
  | { t: "bye"; id: string };

/**
 * Connect this client to one universe's game server for live movement
 * sync. Speaks the SAME envelopes as net.ts (`state` / `chat` / `bye`),
 * so the game server, the relay and the tab channel all stay one
 * protocol.
 *
 * Returns null when the universe has no game server yet
 * (`realtimeEndpoint` is null) — the caller then stays on the existing
 * presence path (net.ts / live.ts) and the game still works, just
 * without live movement sync. When the game server lands (WIRING.md),
 * the wiring step sets `realtimeEndpoint` per universe and this starts
 * returning a live connection.
 */
export function connectUniverseRealtime(
  universe: Universe,
  selfId: string,
  handlers: UniversePresenceHandlers,
): UniverseRealtime | null {
  if (!universe.realtimeEndpoint) return null;
  const url = universe.realtimeEndpoint;
  let socket: WebSocket | null = null;
  const queue: PresenceEnvelope[] = [];
  const send = (message: PresenceEnvelope) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else queue.push(message);
  };
  try {
    socket = new WebSocket(url);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as PresenceEnvelope;
        if (!message || typeof message !== "object") return;
        if (message.t === "state") {
          if (message.state?.id && message.state.id !== selfId) handlers.onState(message.state);
        } else if (message.t === "chat") {
          if (message.text && message.id !== selfId) {
            handlers.onChat({ id: message.id, name: message.name || "Guest", text: message.text.slice(0, 180), self: false });
          }
        } else if (message.t === "bye" && message.id !== selfId) {
          handlers.onBye(message.id);
        }
      } catch {
        /* ignore malformed presence traffic */
      }
    };
    socket.onopen = () => {
      for (const message of queue) socket?.send(JSON.stringify(message));
      queue.length = 0;
    };
  } catch {
    socket = null;
  }
  return {
    universeId: universe.id,
    endpoint: url,
    sendState(state) {
      send({ t: "state", state });
    },
    sendChat(name, text) {
      send({ t: "chat", id: selfId, name, text });
    },
    close() {
      send({ t: "bye", id: selfId });
      socket?.close();
    },
  };
}
