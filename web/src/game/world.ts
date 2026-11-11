import { accountToken, readAccount } from "../auth";
import { connectLive } from "./live";
import {
  EMPTY_LEADERS,
  EMPTY_RACE,
  type DailyCard,
  type Leaders,
  type LotCard,
  type MarketCard,
  type NoteCard,
  type RaceCard,
} from "./life";

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
  earned?: number;
  bestRace?: number;
  bestHover?: number;
  holder?: boolean;
  wallet?: string;
  daily?: DailyCard | null;
  email?: string;
  avatar?: string;
  provider?: string;
  account?: boolean;
  address?: string;
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
  lots: LotCard[] = [];
  leaders: Leaders = EMPTY_LEADERS;
  daily: DailyCard | null = null;
  raceInfo: RaceCard = { ...EMPTY_RACE };
  notes: NoteCard[] = [];
  market: MarketCard | null = null;
  mintSet = false;
  walletNote = "";
  chain: {
    address: string;
    sol: number | null;
    orbitx: number | null;
    network: string;
    history: { id: string; status: string; amount: string; unit: string; destination: string; signature: string; at: string }[];
    qr: string;
    note: string;
  } | null = null;
  private latest: Record<string, unknown> | null = null;
  private digestTimer = 0;
  private timer = 0;
  private signals: { from: string; to: string; room: string; data: unknown }[] = [];

  async start(name: string) {
    const account = readAccount();
    const saved = localStorage.getItem(SESSION_KEY) || "";
    const savedToken = localStorage.getItem(TOKEN_KEY) || "";
    try {
      const data = account
        ? await this.call("session", { guestToken: savedToken, name: account.name || name }, "account")
        : await this.call("session", { id: saved, token: savedToken, name }, false);
      this.token = account ? account.token : String(data.token || "");
      this.me = data.me as CityMe;
      this.id = this.me.id;
      this.server = String(data.storage || "City server");
      if (data.chain && typeof data.chain === "object") this.chain = data.chain as CityWorld["chain"];
      if (data.upgraded) {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(TOKEN_KEY);
      } else if (!account) {
        localStorage.setItem(SESSION_KEY, this.id);
        localStorage.setItem(TOKEN_KEY, this.token);
      }
      this.mission = Number((this.me as CityMe & { mission?: number }).mission || 0);
      const live = data.realtime as { url?: string; anon?: string } | null;
      if (live?.url && live.anon) void connectLive(String(live.url), String(live.anon));
      this.online = true;
      void this.refresh();
      this.digestTimer = window.setInterval(() => void this.refresh(), 1000);
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

  // Re-send the last pose with the current lobby. Called when the lobby
  // changes so room membership propagates on the next 250ms flush instead
  // of waiting for the next animation frame (frames stall on slow or
  // backgrounded tabs, which would hide the player from voice).
  pushLobby() {
    if (this.latest) this.push(this.latest);
  }

  stop() {
    if (this.timer) window.clearInterval(this.timer);
    if (this.digestTimer) window.clearInterval(this.digestTimer);
    this.timer = 0;
    this.digestTimer = 0;
  }

  private applyDigest(data: Record<string, unknown>) {
    if (data.me) this.me = data.me as CityMe;
    if (Array.isArray(data.lots)) this.lots = data.lots as LotCard[];
    if (data.leaders) this.leaders = data.leaders as Leaders;
    if (data.daily) this.daily = data.daily as DailyCard;
    if (data.race) this.raceInfo = { ...EMPTY_RACE, ...(data.race as RaceCard) };
    if (Array.isArray(data.notes)) this.notes = data.notes as NoteCard[];
    if (data.market && typeof data.market === "object") this.market = data.market as MarketCard;
    if ("mintSet" in data) this.mintSet = Boolean(data.mintSet);
  }

  async refresh() {
    if (!this.online) return;
    try {
      const data = await this.call("digest", {});
      this.applyDigest(data);
    } catch {
      // The next tick tries again.
    }
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
    const data = await this.call("spend", { item });
    if (data.me) this.me = data.me as CityMe;
    return data;
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

  async buyLot(id: string) {
    const data = await this.call("property-buy", { id });
    this.applyDigest(data);
    return data;
  }

  async saveFurniture(id: string, furniture: LotCard["furniture"]) {
    const data = await this.call("property-save", { id, furniture });
    this.applyDigest(data);
    return data;
  }

  async setAnnouncement(project: string, text: string) {
    const data = await this.call("hq-note", { project, text });
    this.applyDigest(data);
    return data;
  }

  async hostEvent(project: string, title: string, when: string, detail: string) {
    return this.call("event-host", { title, where: project, when, detail, project });
  }

  async raceGo(kind: "street" | "hover") {
    const data = await this.call("race-go", { kind });
    this.applyDigest(data);
    return data;
  }

  async raceHit(x: number, z: number, car: boolean) {
    const data = await this.call("race-hit", { x, z, car });
    this.applyDigest(data);
    return data;
  }

  async raceLeave() {
    const data = await this.call("race-leave", {});
    this.applyDigest(data);
    return data;
  }

  async claimDaily() {
    const data = await this.call("daily-claim", {});
    this.applyDigest(data);
    return data;
  }

  async questPing(id: string) {
    const data = await this.call("quest-ping", { id });
    this.applyDigest(data);
    return data;
  }

  async arcadePlay(extra: Record<string, unknown> = {}) {
    const data = await this.call("arcade-play", extra);
    this.applyDigest(data);
    return data;
  }

  async arcadeArm() {
    const data = await this.call("arcade-arm", {});
    this.applyDigest(data);
    return data;
  }

  async arcadeHit(token: string) {
    const data = await this.call("arcade-hit", { token });
    this.applyDigest(data);
    return data;
  }

  async walletView() {
    const data = await this.call("wallet-view", {});
    if (data.me) this.me = data.me as CityMe;
    this.chain = data as CityWorld["chain"];
    this.walletNote = String(data.note || "");
    return data;
  }

  async walletQuote(destination: string, amount: string) {
    return this.call("wallet-quote", { destination, amount });
  }

  async walletConfirm(destination: string, amount: string, idempotencyKey: string) {
    const data = await this.call("wallet-confirm", { destination, amount, idempotencyKey });
    if (Array.isArray(data.history) && this.chain) this.chain = { ...this.chain, history: data.history as NonNullable<CityWorld["chain"]>["history"] };
    return data;
  }

  async walletExport(proof: { password?: string; otp?: string }) {
    return this.call("wallet-export", { confirm: "EXPORT", ...proof });
  }

  private async call(op: string, extra: Record<string, unknown>, auth: boolean | "account" = true) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const access = accountToken();
    if (access) headers.authorization = `Bearer ${access}`;
    else if (auth === true && this.token) headers.authorization = `Bearer ${this.token}`;
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
