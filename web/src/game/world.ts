import { connectLive } from "./live";

export interface CityPerson {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: string;
  hat: string;
  car: boolean;
  skin: string;
  speaking: boolean;
  emote: string;
  lobby: string;
  look?: string;
}

export interface CityMe {
  id: string;
  name: string;
  balance: number;
  burned: number;
  owned: string[];
  color: string;
  hat: string;
  car: string;
  friends: { id: string; name: string }[];
  inbox: { id: string; name: string }[];
  party: string;
  look?: string;
}

export interface VoiceRoom {
  id: string;
  name: string;
  members: { id: string; name: string; speaking: boolean }[];
}

export interface WorldChat {
  id: string;
  name: string;
  text: string;
  scope: "global" | "near";
  x: number;
  z: number;
}

const SESSION_KEY = "orbitx-session";
const TOKEN_KEY = "orbitx-token";

class CityWorld {
  online = false;
  id = "";
  token = "";
  server = "This device";
  me: CityMe | null = null;
  people: CityPerson[] = [];
  chat: WorldChat[] = [];
  bookings: { id: string; project: string; text: string; start: string; end: string }[] = [];
  events: { id: string; title: string; where: string; when: string; detail: string }[] = [];
  board: { name: string; burned: number }[] = [];
  mission = 0;
  realtime = false;
  lobbies: VoiceRoom[] = [];
  party: { id: string; members: { id: string; name: string }[] } | null = null;
  lobby = "";
  speaking = false;
  emote = "";
  emoteUntil = 0;
  muted = false;
  deafened = false;
  pushToTalk = false;
  talking = false;
  volumes: Record<string, number> = {};
  provider = "";
  voiceError = "";
  private latest: Record<string, unknown> | null = null;
  private timer = 0;
  private signals: { from: string; to: string; room: string; data: unknown }[] = [];

  async start(name: string) {
    const saved = localStorage.getItem(SESSION_KEY) || "";
    const savedToken = localStorage.getItem(TOKEN_KEY) || "";
    try {
      const data = await this.call("session", { id: saved, token: savedToken, name }, false);
      this.token = String(data.token || "");
      this.me = data.me as CityMe;
      this.id = this.me.id;
      this.server = String(data.storage || "City server");
      localStorage.setItem(SESSION_KEY, this.id);
      localStorage.setItem(TOKEN_KEY, this.token);
      this.mission = Number((this.me as CityMe & { mission?: number }).mission || 0);
      const live = data.realtime as { url?: string; anon?: string } | null;
      if (live?.url && live.anon) void connectLive(String(live.url), String(live.anon));
      this.online = true;
      if (new URLSearchParams(location.search).has("ghost")) this.latest = { ghost: true };
    } catch {
      this.online = false;
      this.server = "This device";
    }
  }

  push(state: Record<string, unknown>) {
    this.latest = {
      ...state,
      speaking: this.speaking && !this.muted && (!this.pushToTalk || this.talking),
      emote: Date.now() < this.emoteUntil ? this.emote : "",
      lobby: this.lobby,
      ghost: new URLSearchParams(location.search).has("ghost") || undefined,
    };
    if (!this.timer && this.online) {
      this.timer = window.setInterval(() => void this.flush(), 250);
      void this.flush();
    }
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private busy = false;

  private async flush() {
    if (this.busy || !this.online || !this.latest) return;
    this.busy = true;
    try {
      const data = await this.call("sync", { state: this.latest });
      this.me = (data.me as CityMe) || this.me;
      this.mission = Number((this.me as CityMe & { mission?: number }).mission || this.mission);
      this.people = (data.people as CityPerson[]) || [];
      this.chat = (data.chat as WorldChat[]) || [];
      this.bookings = (data.bookings as CityWorld["bookings"]) || [];
      this.events = (data.events as CityWorld["events"]) || [];
      this.lobbies = (data.lobbies as VoiceRoom[]) || [];
      this.party = (data.party as CityWorld["party"]) || null;
      this.server = String(data.server || this.server);
      const incoming = (data.signals as CityWorld["signals"]) || [];
      if (incoming.length) this.signals.push(...incoming);
    } catch {
      // One missed heartbeat should not drop the session or the player list.
    } finally {
      this.busy = false;
    }
  }

  takeSignals() {
    const list = this.signals;
    this.signals = [];
    return list;
  }

  async spend(item: string) {
    return this.call("spend", { item });
  }

  async jobStart(job: string) {
    if (!this.online) return { ok: true };
    return this.call("job-start", { job });
  }

  async earn(job: string) {
    const data = await this.call("earn", { job });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async book(id: string, days: number, project: string, text: string) {
    return this.call("book", { id, days, project, text });
  }

  async rename(name: string, look = "") {
    const data = await this.call("profile", { name, look });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async friendAsk(id: string) {
    return this.call("friend-ask", { id });
  }

  async friendAccept(id: string) {
    const data = await this.call("friend-accept", { id });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async partyInvite(id = "") {
    const data = await this.call("party", { invite: id });
    if (data.me) this.me = data.me as CityMe;
    this.party = (data.party as CityWorld["party"]) || this.party;
    return data;
  }

  async say(text: string, scope: "global" | "near", x: number, z: number) {
    if (!this.online) return { ok: false };
    return this.call("chat", { text, scope, x, z });
  }

  async voiceToken(room: string) {
    return this.call("voice-token", { room });
  }

  async voiceSignal(to: string, room: string, data: unknown) {
    return this.call("voice-signal", { to, room, data });
  }

  async loadBoard() {
    if (!this.online) return [];
    const data = await this.call("board", {});
    this.board = (data.board as CityWorld["board"]) || [];
    return this.board;
  }

  async advanceMission(step: number) {
    const data = await this.call("mission", { step });
    if (data.me) {
      this.me = data.me as CityMe;
      this.mission = Number((this.me as CityMe & { mission?: number }).mission || this.mission);
    }
    return data;
  }

  async addEvent(title: string, where: string, when: string, detail: string) {
    return this.call("event-add", { title, where, when, detail });
  }

  private async call(op: string, extra: Record<string, unknown>, auth = true) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch("/api/city", {
      method: "POST",
      headers,
      body: JSON.stringify({ op, ...extra }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.ok === false) throw new Error(String(data.message || "City server said no."));
    return data;
  }
}

export const world = new CityWorld();
