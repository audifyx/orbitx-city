import { accountToken, ensureFreshAccountToken, readAccount, refreshAccountToken } from "../auth";
import { connectLive } from "./live";
import type { OwnedVehicle, GarageUpgrades } from "./vehicles";
import type { OwnedHome } from "./homes";
import type { CribState } from "./crib";
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
import type { WardrobeState } from "./wardrobe";

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
  // Which universe this player is on right now, stamped by the server
  // on their presence row (sync op). Absent for old rows / offline
  // peers — the client treats that as "unknown", never as "here".
  server?: number;
  // Clothes worn right now, per slot (shirt / pants / shoes / outfit /
  // glasses) — derived server-side from the `worn:` markers in owned.
  clothes?: Record<string, string>;
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
  // Clothes worn right now, per slot — the client renders them from
  // this (authoritative) or from the `worn:` markers in `owned`.
  clothes?: Record<string, string>;  // Wardrobe (style theme): equipped slots + saved fits, parsed by the
  // server from the owned array (mirrors wardrobeFromOwned).
  wardrobe?: WardrobeState;  // GTA expansion — per-(player, universe) save fields (server agent owns
  // the ops; the client only mirrors what the server returns).
  vehicles?: OwnedVehicle[];
  activeVehicle?: string | null;
  // CARS expansion — garage upgrades on this universe's save
  // (save.homes.garage): { slots, workshop, showroom }.
  garage?: GarageUpgrades;
  // GTA garage rental — the live rental on this universe's save, or null.
  rental?: { id: string; color: string; days: number; daysLeft: number; expiresAt: number } | null;
  homes?: {
    homeServer: number;
    homes: OwnedHome[];
    // Edit Home: placed pieces per home + owned inventory (one entry per
    // copy). The server mirrors these from save.homes JSON.
    furniture?: Record<string, { id: string; item: string; x: number; z: number; rot: number }[]>;
    furnitureOwned?: string[];
    // CARS expansion — garage upgrades on this universe's save.
    garage?: GarageUpgrades;
  };
  // CRIB (home life) — per (player, server); the server is the authority.
  crib?: CribState;
  friends: { id: string; name: string }[];
  // Inbox: friend requests carry no kind (back-compat); party invites
  // carry kind "party" + the party id they invite you to.
  inbox: { id: string; name: string; kind?: string; party?: string }[];
  party: string;
  look?: string;
  earned?: number;
  // PROFILE: total City Sol spent on this save (real counter — see
  // noteSpent in api/city.js) + missions completed + player-written
  // bio and showcase picks (one owned home, one owned car).
  spent?: number;
  missionsDone?: number;
  bio?: string;
  showcase?: { home: string; car: string } | null;
  jobStreak?: number;
  business?: { kind: string; started: number; lastCollect: number } | null;
  rent?: Record<string, { nextDue: number; arrears: number }>;
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
  // The universe the player is currently in (1-5), set by the runtime on
  // join/travel. The 250ms sync heartbeat sends it so the server can
  // resolve the player's per-universe save — the heartbeat otherwise falls
  // back to homeServer, which guests never have, so the save was never
  // touched mid-play and the sync's `me` carried no garage data.
  currentServer: number | null = null;
  me: CityMe | null = null;
  people: CityPerson[] = [];
  chat: WorldChat[] = [];
  bookings: { id: string; project: string; text: string; image?: string; start: string; end: string; owner_id?: string }[] = [];
  events: { id: string; title: string; where: string; when: string; detail: string }[] = [];
  board: { name: string; burned: number }[] = [];
  mission = 0;
  realtime = false;
  lobbies: VoiceRoom[] = [];
  party: { id: string; members: { id: string; name: string }[] } | null = null;
  lobby = "";
  /** True while proximity voice is on (the lobby is the "nearby" room). */
  proximity = false;
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
  /** LiveKit room participants (you first), refreshed from the room. */
  voicePeers: { id: string; name: string; speaking: boolean; isLocal: boolean }[] = [];
  /** Voice filter preset id (see VOICE_FILTERS in voice.ts). */
  voiceFilter = "normal";
  /** Reverb amount 0..1 (0 = off). */
  voiceReverb = 0;
  /** Echo amount 0..1 (0 = off). */
  voiceEcho = 0;
  /** Mic input level 0..1 from the speaking analyser (post-effects). */
  micLevel = 0;
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
    if (data.me) this.me = this.mergeGarageMe(data.me as CityMe);
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
      const data = await this.call("digest", { server: this.currentServer ?? undefined });
      this.applyDigest(data);
    } catch {
      // The next tick tries again.
    }
  }

  private busy = false;

  // A `me` from a global-row op (quest-ping, wallet, an old sync …)
  // carries no per-server garage data — never let it wipe the current
  // universe's rental/vehicles out from under the player. The garage ops
  // and the (overlayed) sync return a save `me` that carries the data,
  // so the merge is a no-op for them. A real return/expiry clears the
  // CURRENT me first (the op itself, or the sync's overlay), so a rental
  // that is actually gone is never resurrected by this.
  private mergeGarageMe(incoming: CityMe): CityMe {
    const cur = this.me;
    if (!cur) return incoming;
    let next = incoming;
    if (
      !incoming.rental &&
      !incoming.vehicles?.length &&
      !incoming.activeVehicle &&
      !incoming.garage &&
      (cur.rental || cur.vehicles?.length || cur.activeVehicle || cur.garage)
    ) {
      next = { ...next, rental: cur.rental, vehicles: cur.vehicles, activeVehicle: cur.activeVehicle, garage: cur.garage };
    }
    const incHomes = incoming.homes;
    const curHomes = cur.homes;
    const incHasHomes = Boolean(
      incHomes &&
        (incHomes.homes?.length ||
          incHomes.furnitureOwned?.length ||
          Object.keys(incHomes.furniture || {}).length),
    );
    const curHasHomes = Boolean(
      curHomes &&
        (curHomes.homes?.length ||
          curHomes.furnitureOwned?.length ||
          Object.keys(curHomes.furniture || {}).length),
    );
    if (!incHasHomes && curHasHomes) {
      next = { ...next, homes: cur.homes, crib: cur.crib ?? next.crib };
    }
    return next;
  }

  private async flush() {
    if (this.busy || !this.online || !this.latest) return;
    this.busy = true;
    try {
      const data = await this.call("sync", { state: this.latest, server: this.currentServer ?? undefined });
      const incomingMe = data.me as CityMe | null;
      this.me = incomingMe ? this.mergeGarageMe(incomingMe) : this.me;
      this.mission = Number((this.me as CityMe & { mission?: number }).mission || this.mission);
      this.people = (data.people as CityPerson[]) || [];
      this.chat = (data.chat as WorldChat[]) || [];
      this.bookings = (data.bookings as CityWorld["bookings"]) || [];
      this.events = (data.events as CityWorld["events"]) || [];
      this.lobbies = (data.lobbies as VoiceRoom[]) || [];
      this.party = (data.party as CityWorld["party"]) || null;
      this.server = String(data.server || this.server);
    } catch {
      // One missed heartbeat should not drop the session or the player list.
    } finally {
      this.busy = false;
    }
  }

  async spend(item: string) {
    const data = await this.call("spend", { item });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // Home furniture — shop + Edit Home (per-server homes, City Sol only).
  async furnitureList(server: number) {
    return this.call("furniture-list", { server });
  }

  async furnitureBuy(item: string, server: number) {
    const data = await this.call("furniture-buy", { item, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // Wardrobe fits — mirror spend(): the server owns the ops, the client
  // only mirrors the returned me.
  async saveFit(name: string) {
    const data = await this.call("save-fit", { name });    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async furnitureSave(home: string, furniture: { id: string; item: string; x: number; z: number; rot: number }[], server: number) {
    const data = await this.call("furniture-save", { home, furniture, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async wearFit(name: string) {
    const data = await this.call("wear-fit", { name });    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async furnitureSell(item: string, server: number) {
    const data = await this.call("furniture-sell", { item, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // Clothes: equip an owned piece (id "" = take the slot off). The
  // server validates ownership and returns the updated `me`.
  async clothes(slot: string, id: string) {
    const data = await this.call("clothes", { slot, id });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async deleteFit(name: string) {
    const data = await this.call("delete-fit", { name });    if (data.me) this.me = data.me as CityMe;
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

  // Jobs: per-task pay + clocking out. jobTask credits one finished
  // task's pay (sequential — the server enforces order); jobClockout
  // ends the shift and settles it (task pay already earned stays).
  async jobTask(job: string, task: number) {
    const data = await this.call("job-task", { job, task });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async jobClockout() {
    const data = await this.call("job-clockout", {});
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async book(id: string, days: number, project: string, text: string, idempotencyKey = "") {
    return this.call("book", { id, days, project, text, idempotencyKey });
  }

  async adQuote(board: string, days: number) {
    return this.call("ad-quote", { board, days });
  }

  async adStatus(orderId: string) {
    return this.call("ad-status", { orderId });
  }

  async adRetryBurn(orderId: string) {
    return this.call("ad-retry-burn", { orderId });
  }

  async adRemove(board: string) {
    return this.call("ad-remove", { board });
  }

  async adOrders() {
    return this.call("ad-orders", {});
  }

  // ORBITX billboards (2026-11-18): flat $1 for 7 days, paid in ORBITX
  // from the in-app wallet, 100% burned on-chain. No SOL, no swap.
  async billboardOrbitxQuote(board: string, project: string, text: string, image: string) {
    return this.call("billboard-orbitx-quote", { board, project, text, image });
  }

  async billboardOrbitxBuy(board: string, project: string, text: string, image: string, idempotencyKey = "") {
    return this.call("billboard-orbitx-buy", { board, project, text, image, idempotencyKey });
  }

  async billboardOrbitxStatus(orderId: string) {
    return this.call("billboard-orbitx-status", { orderId });
  }

  async billboardOrbitxOrders() {
    return this.call("billboard-orbitx-orders", {});
  }

  async billboardImageUrl(name: string, size: number) {
    return this.call("billboard-image-url", { name, size });
  }

  async radioList() {
    return this.call("radio-list", {});
  }

  // CRIB (home life) — City Sol only, per (player, server). Every op
  // returns the fresh `me` (with `me.crib`) on success, same as buy-home.
  async cribStatus(server: number) {
    return this.call("crib-status", { server });
  }

  async cribPayBill(home: string, server: number) {
    const data = await this.call("crib-pay-bill", { home, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribSleep(home: string, server: number) {
    const data = await this.call("crib-sleep", { home, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribEnergy(energy: number, server: number) {
    const data = await this.call("crib-energy", { energy, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribBuyPet(kind: string, server: number) {
    const data = await this.call("crib-buy-pet", { kind, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribFeedPet(server: number) {
    const data = await this.call("crib-feed-pet", { server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribBuyFood(item: string, qty: number, server: number) {
    const data = await this.call("crib-buy-food", { item, qty, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribEat(item: string, server: number) {
    const data = await this.call("crib-eat", { item, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribUpgrade(home: string, server: number) {
    const data = await this.call("crib-upgrade", { home, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribDecor(home: string, server: number, patch: { wall?: string; floor?: string; light?: string; rooms?: Record<string, { wall?: string; floor?: string }> }) {
    const data = await this.call("crib-decor", { home, server, ...patch });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async homeStyle(home: string, server: number, patch: { exterior?: string; roof?: string; yard?: string }) {
    const data = await this.call("home-style", { home, server, ...patch });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async homeTheme(home: string, server: number, theme: string) {
    const data = await this.call("home-theme", { home, server, theme });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribLights(home: string, server: number, on: boolean) {
    const data = await this.call("crib-lights", { home, server, on });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async cribTv(home: string, server: number, on: boolean) {
    const data = await this.call("crib-tv", { home, server, on });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async radioUploadUrl(name: string, size: number) {
    return this.call("radio-upload-url", { name, size });
  }

  async radioRegister(name: string, path: string) {
    return this.call("radio-register", { name, path });
  }

  async rename(name: string, look = "") {
    const data = await this.call("profile", { name, look });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // PROFILE: save the player-written bio and/or showcase picks (one
  // owned home, one owned car — "" clears a slot). The server validates
  // showcase ownership; a 400 leaves `me` untouched.
  async updateProfile(patch: { bio?: string; showcaseHome?: string; showcaseCar?: string }) {
    const data = await this.call("profile", patch);
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

  // Party invite: an empty id starts a party (the old "party" op);
  // with an id it sends an invite the other player accepts or declines
  // (new "party-invite" op — the invite lands in their inbox).
  async partyInvite(id = "") {
    if (!id) {
      const data = await this.call("party", { invite: "" });
      if (data.me) this.me = data.me as CityMe;
      this.party = (data.party as CityWorld["party"]) || this.party;
      return data;
    }
    return this.call("party-invite", { id });
  }

  async partyAccept(id: string) {
    const data = await this.call("party-accept", { id });
    if (data.me) this.me = data.me as CityMe;
    this.party = (data.party as CityWorld["party"]) || this.party;
    return data;
  }

  async partyLeave() {
    const data = await this.call("party-leave", {});
    if (data.me) this.me = data.me as CityMe;
    this.party = (data.party as CityWorld["party"]) || null;
    return data;
  }

  async declineRequest(id: string, kind: string) {
    const data = await this.call("decline-request", { id, kind });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async say(text: string, scope: "global" | "near", x: number, z: number) {
    if (!this.online) return { ok: false };
    return this.call("chat", { text, scope, x, z });
  }

  async voiceToken(room: string) {
    // Send the universe the player is actually on: the server mints one
    // proximity room per universe, and without this it falls back to the
    // player's home universe — a visitor on another universe would join
    // the wrong room and hear the wrong people.
    return this.call("voice-token", { room, server: this.currentServer ?? undefined });
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
    const data = await this.call("property-buy", { id, server: this.currentServer ?? undefined });
    this.applyDigest(data);
    return data;
  }

  // GTA vehicles — mirror spend()/buyLot() via the private call(). The
  // server id comes from the menu's universe selection (servers 1-5);
  // callers must not call before a universe is picked.
  async buyCar(id: string, color: string, server: number) {
    const data = await this.call("buy-car", { id, color, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async selectCar(id: string, server: number) {
    const data = await this.call("select-car", { id, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // GTA garage rentals — 0.5 City Sol/day, paid up front, per-server.
  async rentCar(id: string, color: string, days: number, server: number) {
    const data = await this.call("rent-car", { id, color, days, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async rentalStatus(server: number) {
    const data = await this.call("rental-status", { server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async returnRental(server: number) {
    const data = await this.call("return-rental", { server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // CARS expansion — customize / wash / repair / garage upgrades / wear.
  // Same shape as buyCar: the server is the price authority, `me` comes
  // back on every answer and replaces this.me (mergeGarageMe in the sync
  // path keeps it from being wiped by a stale global-row `me`).
  async customizeCar(id: string, mod: string, value: unknown, server: number) {
    const data = await this.call("customize-car", { id, mod, value, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async washCar(id: string, server: number) {
    const data = await this.call("wash-car", { id, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async repairCar(id: string, server: number) {
    const data = await this.call("repair-car", { id, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async upgradeGarage(upgrade: string, server: number) {
    const data = await this.call("upgrade-garage", { upgrade, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async syncVehicleWear(id: string, distance: number, crashes: number, server: number) {
    const data = await this.call("sync-vehicle-wear", { id, distance, crashes, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  // GTA homes — per (player, server), City Sol only.
  async buyHome(homeId: string, server: number) {
    const data = await this.call("buy-home", { home: homeId, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async homeStatus(server: number) {
    return this.call("home-status", { server });
  }

  // My Properties — one snapshot of everything the player owns on one
  // universe (HQ lot, office leases, homes), for the HUD's "My Props"
  // button. Mirrors homeStatus()/districtOfficeStatus().
  async myProperties(server: number) {
    return this.call("my-properties", { server });
  }

  // Player profile — public view of another player (name, look, homes,
  // cars, friend count). Never returns balance, inbox, email, or wallet.
  async profileView(id: string) {
    return this.call("profile-view", { id });
  }

  // GTA district offices — mirror the HQ office-claim call pattern, with
  // the server id on every call so a Server 1 claim never leaks to Server 2.
  async districtOfficeClaim(suite: string, server: number, term_days: number, project: string, logo: string, site: string) {
    const data = await this.call("district-office-claim", { suite, server, term_days, project, logo, site });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async districtOfficeClaims(district: string, server: number) {
    return this.call("district-office-claims", { district, server });
  }

  async districtOfficeRelease(suite: string, server: number) {
    const data = await this.call("district-office-release", { suite, server });
    if (data.me) this.me = data.me as CityMe;
    return data;
  }

  async districtOfficeStatus(server: number) {
    return this.call("district-office-status", { server });
  }

  async buyBusiness(kind: string) {
    const data = await this.call("business-buy", { kind });
    this.applyDigest(data);
    return data;
  }

  async collectBusiness() {
    const data = await this.call("business-collect", {});
    this.applyDigest(data);
    return data;
  }

  async payRent(lot: string) {
    const data = await this.call("rent-pay", { lot, server: this.currentServer ?? undefined });
    this.applyDigest(data);
    return data;
  }

  async setBrand(lot: string, name: string, line: string, site: string) {
    const data = await this.call("hq-brand", { lot, name, line, site, server: this.currentServer ?? undefined });
    this.applyDigest(data);
    return data;
  }

  async saveFurniture(id: string, furniture: LotCard["furniture"]) {
    const data = await this.call("property-save", { id, furniture, server: this.currentServer ?? undefined });
    this.applyDigest(data);
    return data;
  }

  async setAnnouncement(project: string, text: string) {
    const data = await this.call("hq-note", { project, text, server: this.currentServer ?? undefined });
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

  // Fresh "me" from the server (City Sol balance, owned, etc.) — the 1s
  // digest op has no server handler, so this is the way a panel that just
  // spent City Sol (e.g. an office claim) refreshes the displayed balance.
  async meNow() {
    // Send the current universe, like the 250ms sync heartbeat does —
    // without it the server falls back to homeServer (which guests
    // never have), resolves the WRONG save, and the rental/vehicles
    // the player just rented on this universe vanish until the next
    // sync corrects it (<250ms flicker). Run the result through
    // mergeGarageMe too, so a `me` that carries no garage data can
    // never wipe the current universe's rental/vehicles.
    const data = await this.call("me", { server: this.currentServer ?? undefined });
    if (data.me) this.me = this.mergeGarageMe(data.me as CityMe);
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

  // On-device wallet (PIN-encrypted, key never leaves this device):
  // balance reads, the blockhash, and the broadcast relay take the
  // public address only. ad-compose/ad-submit are the device-signed
  // billboard flow — the server composes, the device signs.
  async walletBalance(address: string) {
    return this.call("wallet-balance", { address });
  }

  async walletBlockhash() {
    return this.call("wallet-blockhash", {});
  }

  async walletSubmit(signedTx: string, address: string) {
    return this.call("wallet-submit", { signedTx, address });
  }

  async adCompose(board: string, days: number, project: string, text: string, address: string, idempotencyKey = "") {
    return this.call("ad-compose", { board, days, project, text, address, idempotencyKey });
  }

  async adSubmit(orderId: string, signedTx: string) {
    return this.call("ad-submit", { orderId, signedTx });
  }

  // Mini-Games Hub — 2-player PvP pot games in real ORBITX (Neon Arcade).
  async arcadeLobby(address = "") {
    return this.call("arcade-lobby", { address });
  }

  async arcadeCompose(game: string, tier: number, pick: string, address: string, idempotencyKey = "", joinId = "") {
    return this.call("arcade-compose", { game, tier, pick, address, idempotencyKey, joinId });
  }

  async arcadeSubmit(gameId: string, signedTx: string) {
    return this.call("arcade-submit", { gameId, signedTx });
  }

  async arcadeCancel(gameId: string) {
    return this.call("arcade-cancel", { gameId });
  }

  async arcadeAct(gameId: string, action: string, value = "") {
    return this.call("arcade-act", { gameId, action, value });
  }

  async arcadeHistory() {
    return this.call("arcade-history", {});
  }

  async arcadeLeaders() {
    return this.call("arcade-leaders", {});
  }

  // Trading Floor — real Solana swaps (SOL <-> any token) via Jupiter.
  // Compose/submit is the on-device PIN wallet path: the server quotes
  // + composes, the device signs once, the server verifies + broadcasts.
  async tradeQuote(inputMint: string, outputMint: string, amount: string, slippageBps = 100) {
    return this.call("trade-quote", { inputMint, outputMint, amount, slippageBps });
  }

  async tradeCompose(inputMint: string, outputMint: string, amount: string, address: string, idempotencyKey = "", slippageBps = 100) {
    return this.call("trade-compose", { inputMint, outputMint, amount, address, idempotencyKey, slippageBps });
  }

  async tradeSubmit(tradeId: string, signedTx: string) {
    return this.call("trade-submit", { tradeId, signedTx });
  }

  async tradeStatus(tradeId: string) {
    return this.call("trade-status", { tradeId });
  }

  async tradeHoldings(address: string) {
    return this.call("trade-holdings", { address });
  }

  // Office leases in real SOL: rent a suite in SOL, the payment buys
  // ORBITX and burns it all — same single-transaction buy+burn as
  // billboards. Compose/submit is the on-device PIN wallet path; buy is
  // the server-held in-app wallet path.
  async officeSolQuote(suite: string, server: number, days: number, project: string, logo: string, site: string, extend = false) {
    return this.call("office-sol-quote", { suite, server, days, project, logo, site, extend });
  }

  async officeSolBuy(suite: string, server: number, days: number, project: string, logo: string, site: string, idempotencyKey = "", extend = false) {
    return this.call("office-sol-buy", { suite, server, days, project, logo, site, idempotencyKey, extend });
  }

  async officeSolCompose(suite: string, server: number, days: number, project: string, logo: string, site: string, address: string, idempotencyKey = "", extend = false) {
    return this.call("office-sol-compose", { suite, server, days, project, logo, site, address, idempotencyKey, extend });
  }

  async officeSolSubmit(orderId: string, signedTx: string) {
    return this.call("office-sol-submit", { orderId, signedTx });
  }

  async officeSolStatus(orderId: string) {
    return this.call("office-sol-status", { orderId });
  }

  async officeSolLeases() {
    return this.call("office-sol-leases", {});
  }

  private async call(op: string, extra: Record<string, unknown>, auth: boolean | "account" = true) {
    // Fail closed on the server id: live.js 400s EVERY live op (including the
    // 1s digest) on an invalid explicit `server`. Only 1-5 may ever be sent;
    // ops that omit the field entirely (digest, sync, session, me) are
    // untouched. This guard can never trip today — every caller validates
    // first — it exists so a future caller cannot 400 the poll loop.
    if (extra.server !== undefined) {
      const server = Number(extra.server);
      if (!Number.isInteger(server) || server < 1 || server > 5) {
        throw new Error(`Refusing to send invalid server ${String(extra.server)} on ${op}.`);
      }
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    // Session fix: the stored access token is a ~1h JWT. Refresh it
    // BEFORE it dies (cheap `exp` check when fresh, no network) so the
    // 250ms sync / 1s digest never start sending an expired token.
    await ensureFreshAccountToken();
    const access = accountToken();
    if (access) headers.authorization = `Bearer ${access}`;
    else if (auth === true && this.token) headers.authorization = `Bearer ${this.token}`;
    const send = async (override?: string) => {
      const attemptHeaders = { ...headers };
      if (override) attemptHeaders.authorization = `Bearer ${override}`;
      const response = await fetch("/api/city", {
        method: "POST",
        headers: attemptHeaders,
        body: JSON.stringify({ op, ...extra }),
      });
      return { response, data: (await response.json()) as Record<string, unknown> };
    };
    let { response, data } = await send();
    if (!response.ok && response.status === 401 && access) {
      // The token expired between the check and the call, or the tab was
      // backgrounded past expiry: one forced refresh + one retry, then
      // the original error stands (a dead refresh token genuinely
      // needs a re-login — the server decides that, not the client).
      const fresh = await refreshAccountToken();
      if (fresh && fresh !== access) ({ response, data } = await send(fresh));
    }
    if (!response.ok || data.ok === false) throw new Error(String(data.message || "City server said no."));
    return data;
  }
}

export const world = new CityWorld();
