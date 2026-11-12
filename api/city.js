import { createHmac, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { ensureDaily, handleLive, noteEarn } from "./live.js";
import { adBuy, adOrdersFor, adQuote, adRemove, adRetryBurn, adStatus } from "./ads.js";
import { authMode, checkReauth, handleAuthOp, looksLikeAccountToken, supabasePublic, verifyAccessToken } from "./auth.js";
import { chainShopEnabled, confirmSend, ensureWallet, exportWallet, networkName, quoteSend, walletView } from "./wallet.js";

const START_BALANCE = 250;
const BURN_RATE = 0.25;
const PRESENCE_MS = 25000;
const JOB_MS = 4000;

const CATALOG = {
  "color-white": { price: 20, kind: "color", value: "white" },
  "color-gold": { price: 40, kind: "color", value: "gold" },
  "color-cyan": { price: 30, kind: "color", value: "cyan" },
  "color-sunset": { price: 35, kind: "color", value: "sunset" },
  "car-black": { price: 50, kind: "car", value: "black" },
  "car-white": { price: 50, kind: "car", value: "white" },
  "car-gold": { price: 80, kind: "car", value: "gold" },
  "car-cyan": { price: 60, kind: "car", value: "cyan" },
  "hat-cap": { price: 15, kind: "hat", value: "cap" },
  "hat-antenna": { price: 25, kind: "hat", value: "antenna" },
  "hat-crown": { price: 100, kind: "hat", value: "crown" },
  "hat-visor": { price: 20, kind: "hat", value: "cap" },
  "color-black": { price: 25, kind: "color", value: "black" },
};

const LOOKS = new Set([
  "tjr",
  "ansem",
  "poor-goat",
  "cupsy",
  "cobie",
  "hsaka",
  "gainzy",
  "zachxbt",
  "threadguy",
  "murad",
  "frank",
  "kaleo",
]);

const JOBS = {
  courier: 45,
  taxi: 90,
  guide: 60,
  mechanic: 55,
  photographer: 40,
  promoter: 50,
  dock: 65,
  dj: 55,
  banker: 50,
  barista: 45,
  vendor: 55,
  security: 75,
  mail: 70,
  lifeguard: 65,
  cleaner: 55,
  bus: 80,
  fire: 75,
  doctor: 70,
  teacher: 60,
  // Mini-games pay through the same earn op (job-start then earn, same
  // JOB_MS floor): the client only ever starts one of these while no job
  // is active, so they never clobber a job in progress.
  coinhunt: 40,
  fishing: 45,
  shootout: 50,
  treasure: 45,
};

// Payouts scale with the player's job streak: +5% per completed job, up
// to +50% (streak 10). The client shows the scaled pay in the Jobs panel.
function scaledPay(id, streak) {
  const base = JOBS[id];
  if (!base) return 0;
  const mult = 1 + 0.05 * Math.min(Math.max(0, Number(streak || 0)), 10);
  return Math.round(base * mult);
}

// OrbitX Tower offices (floors 2-4). 25 suites: 24 claimable + the
// Founder's Office, which belongs to OrbitX and is never for sale.
// Leases are paid in City Sol only — the game's own money. There is no
// real-money price, no SOL, no ORBITX and no burn for offices; buy+burn
// is ads/banners only. Prices are opening prices: standard (floors 2-3)
// 100/day, 500/week, 1500/month; premium (floor 4) 250/day, 1200/week,
// 3500/month. A new player starts at 250 City Sol and jobs pay 40-90,
// so a standard day is affordable on day one and a standard week takes
// a few days of playing.
const OFFICES = [
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
];

const OFFICE_PRICES = {
  standard: { 1: 100, 7: 500, 30: 1500 },
  premium: { 1: 250, 7: 1200, 30: 3500 },
};

function officeSuite(id) {
  return OFFICES.find((suite) => suite.id === id) || null;
}

function officePrice(suite, termDays) {
  const table = OFFICE_PRICES[suite.tier];
  if (!table) return 0;
  return table[termDays] || 0;
}

function officeTermLabel(termDays) {
  return termDays === 1 ? "1 day" : termDays === 7 ? "7 days" : "30 days";
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function officeEndISO(start, termDays) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + termDays);
  return date.toISOString().slice(0, 10);
}

const MISSIONS = [
  { id: "plaza", pay: 15 },
  { id: "shop", pay: 20 },
  { id: "cafe", pay: 20 },
  { id: "hall", pay: 25 },
  { id: "tower", pay: 30 },
  { id: "dock", pay: 80 },
];

const LOBBIES = [
  { id: "plaza", name: "Plaza" },
  { id: "district", name: "Project District" },
  { id: "hq-0", name: "OrbitX HQ" },
  { id: "hq-1", name: "Your Project" },
  { id: "hq-2", name: "North Star" },
  { id: "hq-3", name: "Lumen Labs" },
  { id: "hall", name: "Community Hall" },
  { id: "cafe", name: "Cafe Nova" },
    { id: "shop", name: "OrbitX Shop" },
    { id: "bank", name: "OrbitX Bank" },
    { id: "garage", name: "Hover Garage" },
    { id: "arcade", name: "Neon Arcade" },
    { id: "market", name: "Night Market" },
    { id: "dock", name: "Harbor" },
];

function memory() {
  const slot = globalThis;
  if (!slot.__orbitx) {
    slot.__orbitx = {
      players: new Map(),
      tokens: new Map(),
      world: new Map(),
      chat: [],
      bookings: new Map(),
      officeClaims: new Map(),
      events: [],
      signals: [],
      parties: new Map(),
      ready: false,
    };
  }
  return slot.__orbitx;
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function redisEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return url && token ? { url, token } : null;
}

function db() {
  const url = databaseUrl();
  if (!url) return null;
  const slot = globalThis;
  if (!slot.__orbitxSql) slot.__orbitxSql = neon(url);
  return slot.__orbitxSql;
}

function supabaseEnv() {
  // Vercel's Supabase Marketplace integration injects the same values under
  // STORAGE_* names; the SUPABASE_* names are the documented ones. Read both.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.STORAGE_SUPABASE_URL || process.env.NEXT_PUBLIC_STORAGE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY || process.env.STORAGE_SUPABASE_SECRET_KEY || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.STORAGE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_STORAGE_SUPABASE_ANON_KEY || "";
  return url && key ? { url, key, anon } : null;
}

function sb() {
  const env = supabaseEnv();
  if (!env) return null;
  const slot = globalThis;
  if (!slot.__orbitxSb) {
    slot.__orbitxSb = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  slot.__orbitxSbClient = slot.__orbitxSb;
  return slot.__orbitxSb;
}

function publicRealtime() {
  const env = supabaseEnv();
  if (!env?.anon) return null;
  return { url: env.url, anon: env.anon };
}

function redis() {
  const env = redisEnv();
  if (!env) return null;
  const slot = globalThis;
  if (!slot.__orbitxRedis) slot.__orbitxRedis = new Redis(env);
  return slot.__orbitxRedis;
}

async function ensureSchema() {
  const sql = db();
  const store = memory();
  if (!sql || store.ready) return;
  await sql`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    balance INTEGER NOT NULL,
    burned INTEGER NOT NULL,
    owned TEXT NOT NULL,
    color TEXT NOT NULL,
    hat TEXT NOT NULL,
    car TEXT NOT NULL,
    friends TEXT NOT NULL,
    inbox TEXT NOT NULL,
    job TEXT NOT NULL,
    party TEXT NOT NULL,
    look TEXT NOT NULL DEFAULT 'tjr'
  )`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS look TEXT NOT NULL DEFAULT 'tjr'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS job_streak INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS business TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS rent TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS earned INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_race INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS best_hover INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS daily TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS wallet TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS holder BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS auth_user TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE players ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE TABLE IF NOT EXISTS properties (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    furniture TEXT NOT NULL
  )`;
  await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '{}'`;
  await sql`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    author TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    text TEXT NOT NULL,
    start TEXT NOT NULL,
    until TEXT NOT NULL,
    burned INTEGER NOT NULL
  )`;
  // Tower office leases, paid in City Sol only. One row per suite (the
  // suite id is the key), so a suite can hold exactly one active claim.
  // No SOL, no ORBITX, no burn anywhere in this table — buy+burn is
  // ads/banners only.
  await sql`CREATE TABLE IF NOT EXISTS office_claims (
    suite TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    project TEXT NOT NULL,
    logo TEXT NOT NULL,
    site TEXT NOT NULL,
    term_days INTEGER NOT NULL,
    start TEXT NOT NULL,
    until TEXT NOT NULL,
    price INTEGER NOT NULL,
    claimed_at TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    where_at TEXT NOT NULL,
    when_at TEXT NOT NULL,
    detail TEXT NOT NULL
  )`;
  store.ready = true;
}

function freshPlayer(id, name) {
  return {
    id,
    token: randomBytes(24).toString("hex"),
    name: String(name || `Guest ${100 + Math.floor(Math.random() * 900)}`).slice(0, 18),
    balance: START_BALANCE,
    burned: 0,
    owned: [],
    color: "white",
    hat: "none",
    car: "black",
    friends: [],
    inbox: [],
    job: null,
    jobStreak: 0,
    business: null,
    rent: {},
    party: "",
    mission: 0,
    missionAt: 0,
    look: "tjr",
    earned: 0,
    bestRace: 0,
    bestHover: 0,
    daily: null,
    wallet: "",
    holder: false,
    email: "",
    avatar: "",
    provider: "",
    authUser: "",
    address: "",
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    balance: player.balance,
    burned: player.burned,
    owned: player.owned,
    color: player.color,
    hat: player.hat,
    car: player.car,
    friends: player.friends,
    inbox: player.inbox,
    party: player.party,
    mission: player.mission || 0,
    look: player.look || "tjr",
    earned: player.earned || 0,
    jobStreak: Number(player.jobStreak || 0),
    business: player.business || null,
    rent: player.rent || {},
    bestRace: player.bestRace || 0,
    bestHover: player.bestHover || 0,
    holder: !!player.holder,
    wallet: player.wallet || "",
    daily: ensureDaily(player),
    email: player.email || "",
    avatar: player.avatar || "",
    provider: player.provider || "",
    account: Boolean(player.authUser),
    address: player.address || "",
  };
}

async function savePlayer(player) {
  const client = sb();
  if (client) {
    let { error } = await client.from("players").upsert(rowFromPlayer(player));
    if (error && /look|earned|best_race|best_hover|daily|wallet|holder|email|avatar|provider|auth_user|address|job_streak|business|rent/i.test(error.message || "")) {
      const row = rowFromPlayer(player);
      delete row.look;
      delete row.earned;
      delete row.best_race;
      delete row.best_hover;
      delete row.daily;
      delete row.wallet;
      delete row.holder;
      delete row.email;
      delete row.avatar;
      delete row.provider;
      delete row.auth_user;
      delete row.address;
      delete row.job_streak;
      delete row.business;
      delete row.rent;
      const retry = await client.from("players").upsert(row);
      error = retry.error;
    }
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const owned = JSON.stringify(player.owned);
    const friends = JSON.stringify(player.friends);
    const inbox = JSON.stringify(player.inbox);
    const job = JSON.stringify(player.job);
    const daily = JSON.stringify(player.daily || {});
    const business = JSON.stringify(player.business || null);
    const rent = JSON.stringify(player.rent || {});
    await sql`INSERT INTO players (id, token, name, balance, burned, owned, color, hat, car, friends, inbox, job, job_streak, business, rent, party, look, earned, best_race, best_hover, daily, wallet, holder, email, avatar, provider, auth_user, address)
      VALUES (${player.id}, ${player.token}, ${player.name}, ${player.balance}, ${player.burned}, ${owned}, ${player.color}, ${player.hat}, ${player.car}, ${friends}, ${inbox}, ${job}, ${Number(player.jobStreak || 0)}, ${business}, ${rent}, ${player.party}, ${player.look || "tjr"}, ${player.earned || 0}, ${player.bestRace || 0}, ${player.bestHover || 0}, ${daily}, ${player.wallet || ""}, ${!!player.holder}, ${player.email || ""}, ${player.avatar || ""}, ${player.provider || ""}, ${player.authUser || ""}, ${player.address || ""})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        balance = EXCLUDED.balance,
        burned = EXCLUDED.burned,
        owned = EXCLUDED.owned,
        color = EXCLUDED.color,
        hat = EXCLUDED.hat,
        car = EXCLUDED.car,
        friends = EXCLUDED.friends,
        inbox = EXCLUDED.inbox,
        job = EXCLUDED.job,
        job_streak = EXCLUDED.job_streak,
        business = EXCLUDED.business,
        rent = EXCLUDED.rent,
        party = EXCLUDED.party,
        look = EXCLUDED.look,
        earned = EXCLUDED.earned,
        best_race = EXCLUDED.best_race,
        best_hover = EXCLUDED.best_hover,
        daily = EXCLUDED.daily,
        wallet = EXCLUDED.wallet,
        holder = EXCLUDED.holder,
        email = EXCLUDED.email,
        avatar = EXCLUDED.avatar,
        provider = EXCLUDED.provider,
        auth_user = EXCLUDED.auth_user,
        address = EXCLUDED.address`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.set(`orbitx:player:${player.id}`, JSON.stringify(player));
    await cache.set(`orbitx:token:${player.token}`, player.id);
    return;
  }
  const store = memory();
  store.players.set(player.id, player);
  store.tokens.set(player.token, player.id);
}

function parsePlayer(row) {
  return {
    ...row,
    balance: Number(row.balance),
    burned: Number(row.burned),
    owned: typeof row.owned === "string" ? JSON.parse(row.owned || "[]") : row.owned || [],
    friends: typeof row.friends === "string" ? JSON.parse(row.friends || "[]") : row.friends || [],
    inbox: typeof row.inbox === "string" ? JSON.parse(row.inbox || "[]") : row.inbox || [],
    job: typeof row.job === "string" ? JSON.parse(row.job || "null") : row.job,
    jobStreak: Number(row.job_streak ?? row.jobStreak ?? 0),
    business: typeof row.business === "string" ? JSON.parse(row.business || "null") : row.business || null,
    rent: typeof row.rent === "string" ? JSON.parse(row.rent || "{}") : row.rent || {},
    party: row.party || "",
    mission: Number(row.mission || 0),
    missionAt: Number(row.mission_at || row.missionAt || 0),
    look: row.look || "tjr",
    earned: Number(row.earned || 0),
    bestRace: Number(row.best_race || row.bestRace || 0),
    bestHover: Number(row.best_hover || row.bestHover || 0),
    daily: typeof row.daily === "string" ? JSON.parse(row.daily || "null") : row.daily || null,
    wallet: row.wallet || "",
    holder: row.holder === true || row.holder === "true" || row.holder === "t",
    email: row.email || "",
    avatar: row.avatar || "",
    provider: row.provider || "",
    authUser: row.auth_user || row.authUser || "",
    address: row.address || "",
  };
}

function rowFromPlayer(player) {
  return {
    id: player.id,
    token: player.token,
    name: player.name,
    balance: player.balance,
    burned: player.burned,
    owned: player.owned,
    color: player.color,
    hat: player.hat,
    car: player.car,
    friends: player.friends,
    inbox: player.inbox,
    job: player.job,
    job_streak: Number(player.jobStreak || 0),
    business: player.business || null,
    rent: player.rent || {},
    party: player.party || "",
    mission: player.mission || 0,
    mission_at: player.missionAt || 0,
    look: player.look || "tjr",
    earned: player.earned || 0,
    best_race: player.bestRace || 0,
    best_hover: player.bestHover || 0,
    daily: player.daily || {},
    wallet: player.wallet || "",
    holder: !!player.holder,
    email: player.email || "",
    avatar: player.avatar || "",
    provider: player.provider || "",
    auth_user: player.authUser || "",
    address: player.address || "",
  };
}

function noteSupabase(message) {
  globalThis.__orbitxSbError = String(message || "Supabase query failed");
}

async function playerByToken(token) {
  if (!token) return null;
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("*").eq("token", token).maybeSingle();
    if (!error && data) return parsePlayer(data);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM players WHERE token = ${token} LIMIT 1`;
    return rows[0] ? parsePlayer(rows[0]) : null;
  }
  const cache = redis();
  if (cache) {
    const id = await cache.get(`orbitx:token:${token}`);
    if (!id) return null;
    const raw = await cache.get(`orbitx:player:${id}`);
    if (!raw) return null;
    return parsePlayer(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  const store = memory();
  const id = store.tokens.get(token);
  return id ? store.players.get(id) ?? null : null;
}

async function playerById(id) {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("*").eq("id", id).maybeSingle();
    if (!error && data) return parsePlayer(data);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM players WHERE id = ${id} LIMIT 1`;
    return rows[0] ? parsePlayer(rows[0]) : null;
  }
  const cache = redis();
  if (cache) {
    const raw = await cache.get(`orbitx:player:${id}`);
    if (!raw) return null;
    return parsePlayer(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  return memory().players.get(id) ?? null;
}

function bearer(request) {
  const header = request.headers.get("authorization") || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function readWorld() {
  const client = sb();
  if (client) {
    const since = new Date(Date.now() - PRESENCE_MS).toISOString();
    // Prune rows nobody will ever read again (players who closed the tab).
    // Best-effort and probabilistic — one prune per ~20 reads keeps the
    // table clean without doubling every sync's Supabase traffic.
    if (Math.random() < 0.05) await client.from("presence").delete().lt("seen", since);
    const { data, error } = await client.from("presence").select("state, seen").gt("seen", since);
    if (!error && data) return data.map((row) => (typeof row.state === "string" ? JSON.parse(row.state) : row.state));
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  const now = Date.now();
  if (cache) {
    const all = (await cache.hgetall("orbitx:world")) || {};
    const people = [];
    for (const [id, raw] of Object.entries(all)) {
      const state = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!state || now - Number(state.seen || 0) > PRESENCE_MS) {
        await cache.hdel("orbitx:world", id);
        continue;
      }
      people.push(state);
    }
    return people;
  }
  const people = [];
  for (const [id, state] of memory().world) {
    if (now - state.seen > PRESENCE_MS) memory().world.delete(id);
    else people.push(state);
  }
  return people;
}

async function writePresence(state) {
  const client = sb();
  if (client) {
    const { error } = await client.from("presence").upsert({ id: state.id, state, seen: new Date().toISOString() });
    if (!error) return;
    noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:world", { [state.id]: JSON.stringify(state) });
    return;
  }
  memory().world.set(state.id, state);
}

async function pushChat(line) {
  const client = sb();
  if (client) {
    const { error } = await client.from("chat").insert({
      player_id: line.id,
      name: line.name,
      text: line.text,
      scope: line.scope,
      x: line.x,
      z: line.z,
    });
    if (!error) return;
    noteSupabase(error.message);
  }
  const cache = redis();
  const item = JSON.stringify(line);
  if (cache) {
    await cache.lpush("orbitx:chat", item);
    await cache.ltrim("orbitx:chat", 0, 79);
    return;
  }
  memory().chat.unshift(line);
  memory().chat.length = Math.min(memory().chat.length, 80);
}

async function readChat() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("chat").select("player_id, name, text, scope, x, z").order("id", { ascending: false }).limit(40);
    if (!error && data) {
      return data.reverse().map((row) => ({ id: row.player_id, name: row.name, text: row.text, scope: row.scope, x: row.x, z: row.z }));
    }
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    const rows = (await cache.lrange("orbitx:chat", 0, 79)) || [];
    return rows.map((row) => (typeof row === "string" ? JSON.parse(row) : row)).reverse();
  }
  return [...memory().chat].reverse();
}

async function saveBooking(info) {
  const client = sb();
  if (client) {
    const { error } = await client.from("bookings").upsert(info);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO bookings (id, project, text, start, until, burned)
      VALUES (${info.id}, ${info.project}, ${info.text}, ${info.start}, ${info.end}, ${info.burned})
      ON CONFLICT (id) DO UPDATE SET project = EXCLUDED.project, text = EXCLUDED.text, start = EXCLUDED.start, until = EXCLUDED.until, burned = EXCLUDED.burned`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:bookings", { [info.id]: JSON.stringify(info) });
    return;
  }
  memory().bookings.set(info.id, info);
}

function liveBookings(rows) {
  const today = new Date().toISOString().slice(0, 10);
  return (rows || []).filter((row) => !row.end || row.end >= today);
}

async function readBookings() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("bookings").select("id, project, text, start, end, burned, owner_id").gte("end", new Date().toISOString().slice(0, 10));
    if (!error && data) return data;
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT id, project, text, start, until AS end, burned, owner_id FROM bookings WHERE until >= ${new Date().toISOString().slice(0, 10)}`;
    return rows;
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:bookings")) || {};
    return liveBookings(Object.values(all).map((row) => (typeof row === "string" ? JSON.parse(row) : row)));
  }
  return liveBookings([...memory().bookings.values()]);
}

function publicOfficeClaim(row) {
  return {
    suite: row.suite,
    owner_id: row.owner_id,
    owner_name: row.owner_name || "",
    project: row.project,
    logo: row.logo || "",
    site: row.site || "",
    term_days: Number(row.term_days),
    start: row.start,
    until: row.until || row.end || "",
    price: Number(row.price),
    claimed_at: row.claimed_at || "",
  };
}

function officeClaimRow(row) {
  return {
    suite: row.suite,
    owner_id: row.owner_id,
    owner_name: row.owner_name || "",
    project: row.project,
    logo: row.logo || "",
    site: row.site || "",
    term_days: Number(row.term_days),
    start: row.start,
    until: row.until || row.end || "",
    price: Number(row.price),
    claimed_at: row.claimed_at || "",
  };
}

async function saveOfficeClaim(claim) {
  const client = sb();
  if (client) {
    const { error } = await client.from("office_claims").upsert(claim);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO office_claims (suite, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at)
      VALUES (${claim.suite}, ${claim.owner_id}, ${claim.owner_name}, ${claim.project}, ${claim.logo}, ${claim.site}, ${Number(claim.term_days)}, ${claim.start}, ${claim.until}, ${Number(claim.price)}, ${claim.claimed_at})
      ON CONFLICT (suite) DO UPDATE SET owner_id = EXCLUDED.owner_id, owner_name = EXCLUDED.owner_name, project = EXCLUDED.project, logo = EXCLUDED.logo, site = EXCLUDED.site, term_days = EXCLUDED.term_days, start = EXCLUDED.start, until = EXCLUDED.until, price = EXCLUDED.price, claimed_at = EXCLUDED.claimed_at`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:office-claims", { [claim.suite]: JSON.stringify(claim) });
    return;
  }
  memory().officeClaims.set(claim.suite, claim);
}

async function deleteOfficeClaim(suiteId) {
  const client = sb();
  if (client) {
    const { error } = await client.from("office_claims").delete().eq("suite", suiteId);
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`DELETE FROM office_claims WHERE suite = ${suiteId}`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hdel("orbitx:office-claims", suiteId);
    return;
  }
  memory().officeClaims.delete(suiteId);
}

async function readOfficeClaims() {
  const client = sb();
  if (client) {
    const { data, error } = await client
      .from("office_claims")
      .select("suite, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at");
    if (!error && data) return data.map(officeClaimRow);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT suite, owner_id, owner_name, project, logo, site, term_days, start, until, price, claimed_at FROM office_claims`;
    return rows.map(officeClaimRow);
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:office-claims")) || {};
    return Object.values(all).map((row) => officeClaimRow(typeof row === "string" ? JSON.parse(row) : row));
  }
  return [...memory().officeClaims.values()].map(officeClaimRow);
}

function activeOfficeClaim(claims, suiteId) {
  const today = todayISO();
  return claims.find((row) => row.suite === suiteId && row.until >= today) || null;
}

async function officeDirectory() {
  const claims = await readOfficeClaims();
  return OFFICES.map((suite) => {
    const claim = suite.claimable ? activeOfficeClaim(claims, suite.id) : null;
    return {
      id: suite.id,
      floor: suite.floor,
      name: suite.name,
      tier: suite.tier,
      claimable: suite.claimable,
      prices: suite.claimable
        ? { 1: officePrice(suite, 1), 7: officePrice(suite, 7), 30: officePrice(suite, 30) }
        : { 1: 0, 7: 0, 30: 0 },
      claim: claim ? publicOfficeClaim(claim) : null,
    };
  });
}

async function claimOffice(player, body) {
  const suite = officeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  if (!suite.claimable) {
    return { ok: false, message: "The Founder's Office belongs to OrbitX. It is never for sale.", status: 400 };
  }
  const termDays = Number(body.term_days);
  if (![1, 7, 30].includes(termDays)) {
    return { ok: false, message: "Pick a 1-day, 7-day, or 30-day lease.", status: 400 };
  }
  const project = String(body.project || "").trim().slice(0, 48);
  if (!project) return { ok: false, message: "Name the project claiming this office.", status: 400 };
  const logo = String(body.logo || "").trim().slice(0, 200);
  const site = String(body.site || "").trim().slice(0, 200);
  for (const url of [logo, site]) {
    if (url && !/^https?:\/\//i.test(url)) {
      return { ok: false, message: "Logo and site links must start with http:// or https://.", status: 400 };
    }
  }
  const price = officePrice(suite, termDays);
  if (!price) return { ok: false, message: "That lease term is not priced.", status: 400 };
  const claims = await readOfficeClaims();
  const taken = activeOfficeClaim(claims, suite.id);
  if (taken) {
    return { ok: false, message: `${suite.name} is already claimed by ${taken.project} until ${taken.until}.`, status: 400 };
  }
  if (player.balance < price) {
    return { ok: false, message: `Not enough City Sol — ${suite.name} for ${officeTermLabel(termDays)} costs ${price} City Sol.`, status: 400 };
  }
  // City Sol only: deduct from the stored balance and persist it, exactly
  // like the shop spend op. The in-game "burned" counter is untouched —
  // offices do not burn anything, and there is no SOL/ORBITX involved.
  const start = todayISO();
  const claim = {
    suite: suite.id,
    owner_id: player.id,
    owner_name: player.name,
    project,
    logo,
    site,
    term_days: termDays,
    start,
    until: officeEndISO(start, termDays),
    price,
    claimed_at: new Date().toISOString(),
  };
  player.balance -= price;
  await savePlayer(player);
  try {
    await saveOfficeClaim(claim);
  } catch {
    // The claim did not land — refund the City Sol rather than leave the
    // player poorer with no office.
    player.balance += price;
    await savePlayer(player);
    return { ok: false, message: "The claim did not save. Your City Sol was refunded — try again.", status: 500 };
  }
  return {
    ok: true,
    message: `${suite.name} is yours for ${officeTermLabel(termDays)} — ${price} City Sol. It is yours until ${claim.until}.`,
    claim: publicOfficeClaim(claim),
    offices: await officeDirectory(),
  };
}

async function releaseOffice(player, body) {
  const suite = officeSuite(String(body.suite || ""));
  if (!suite) return { ok: false, message: "Unknown suite.", status: 400 };
  const claims = await readOfficeClaims();
  const claim = activeOfficeClaim(claims, suite.id);
  if (!claim) return { ok: false, message: `${suite.name} is not claimed.`, status: 400 };
  if (claim.owner_id !== player.id) {
    return { ok: false, message: `Only ${claim.project} can release ${suite.name}.`, status: 400 };
  }
  await deleteOfficeClaim(suite.id);
  return {
    ok: true,
    message: `${suite.name} released. The lease ends now — no refund for the days left.`,
    offices: await officeDirectory(),
  };
}

async function addEvent(info) {
  const client = sb();
  if (client) {
    const { error } = await client.from("events").upsert({
      id: info.id,
      title: info.title,
      place: info.where,
      when_at: info.when,
      detail: info.detail,
    });
    if (!error) return;
    noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO events (id, title, where_at, when_at, detail)
      VALUES (${info.id}, ${info.title}, ${info.where}, ${info.when}, ${info.detail})
      ON CONFLICT (id) DO NOTHING`;
    return;
  }
  const cache = redis();
  if (cache) {
    await cache.hset("orbitx:events", { [info.id]: JSON.stringify(info) });
    return;
  }
  if (!memory().events.some((item) => item.id === info.id)) memory().events.push(info);
}

async function readEvents() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("events").select("id, title, place, when_at, detail");
    if (!error && data) {
      return data.map((row) => ({ id: row.id, title: row.title, where: row.place, when: row.when_at, detail: row.detail }));
    }
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT id, title, where_at AS "where", when_at AS "when", detail FROM events`;
    return rows;
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:events")) || {};
    return Object.values(all).map((row) => (typeof row === "string" ? JSON.parse(row) : row));
  }
  return memory().events;
}

function burnOf(price) {
  return Math.max(1, Math.round(price * BURN_RATE));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function livekitToken(identity, room) {
  const key = process.env.LIVEKIT_API_KEY || "";
  const secret = process.env.LIVEKIT_API_SECRET || "";
  if (!key || !secret || !process.env.LIVEKIT_URL) return null;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: key,
      sub: identity,
      nbf: now - 5,
      exp: now + 60 * 60,
      name: identity,
      video: { roomJoin: true, room, canPublish: true, canSubscribe: true },
    }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function lobbiesFor(people) {
  const rooms = LOBBIES.map((room) => ({ ...room, members: [] }));
  const known = new Map(rooms.map((room) => [room.id, room]));
  for (const person of people) {
    if (!person.lobby) continue;
    let room = known.get(person.lobby);
    if (!room) {
      room = { id: person.lobby, name: person.lobby, members: [] };
      known.set(person.lobby, room);
      rooms.push(room);
    }
    room.members.push({ id: person.id, name: person.name, speaking: !!person.speaking });
  }
  return rooms;
}

async function spendItem(player, itemId) {
  const item = CATALOG[itemId];
  if (!item) return { ok: false, message: "That item is not for sale." };
  if (player.owned.includes(itemId)) {
    if (item.kind === "color") player.color = item.value;
    if (item.kind === "hat") player.hat = item.value;
    if (item.kind === "car") player.car = item.value;
    await savePlayer(player);
    return { ok: true, message: "Already yours. Equipped.", me: publicPlayer(player) };
  }
  if (player.balance < item.price) return { ok: false, message: "Not enough City Sol." };
  const burned = burnOf(item.price);
  player.balance -= item.price;
  player.burned += burned;
  player.owned.push(itemId);
  if (item.kind === "color") player.color = item.value;
  if (item.kind === "hat") player.hat = item.value;
  if (item.kind === "car") player.car = item.value;
  await savePlayer(player);
  return {
    ok: true,
    message: `Spent ${item.price} City Sol. Burned ${burned}. Burned total ${player.burned}.`,
    me: publicPlayer(player),
  };
}

export async function GET() {
  return json({
    ok: true,
    name: "OrbitX City",
    demo: true,
    database: Boolean(databaseUrl()),
    redis: Boolean(redisEnv()),
    livekit: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    note: "Demo credits are separate from the in-app Solana wallet. The shop does not spend on-chain tokens.",
    mint: Boolean(process.env.ORBITX_MINT),
    auth: publicAuth(),
    network: networkName(),
    shopOnChain: chainShopEnabled(),
    supabase: Boolean(supabaseEnv()),
    supabaseError: globalThis.__orbitxSbError || "",
    realtime: publicRealtime(),
  });
}

function publicAuth() {
  const pub = supabasePublic();
  if (pub?.anon) return { mode: "supabase", url: pub.url, anon: pub.anon };
  return { mode: "mock", url: "", anon: "" };
}

function isFresh(player) {
  return player.balance === START_BALANCE
    && !player.burned
    && (!player.owned || player.owned.length === 0)
    && !player.earned
    && !player.mission;
}

async function deletePlayer(id) {
  const store = memory();
  const player = store.players.get(id);
  if (player) store.tokens.delete(player.token);
  store.players.delete(id);
  const client = sb();
  if (client) {
    const { error } = await client.from("players").delete().eq("id", id);
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    try {
      await sql`DELETE FROM players WHERE id = ${id}`;
    } catch {
      // The guest row is already gone from memory.
    }
  }
}

async function adoptGuest(account, guest) {
  account.balance = guest.balance;
  account.burned = guest.burned;
  account.owned = guest.owned || [];
  account.color = guest.color;
  account.hat = guest.hat;
  account.car = guest.car;
  account.friends = guest.friends || [];
  account.inbox = guest.inbox || [];
  account.job = guest.job;
  account.jobStreak = guest.jobStreak || 0;
  account.business = guest.business || null;
  account.rent = guest.rent || {};
  account.party = guest.party || "";
  account.mission = guest.mission || 0;
  account.missionAt = guest.missionAt || 0;
  account.look = guest.look || account.look;
  account.earned = guest.earned || 0;
  account.bestRace = guest.bestRace || 0;
  account.bestHover = guest.bestHover || 0;
  account.daily = guest.daily;
  account.name = guest.name || account.name;
  const store = memory();
  if (store.lots) {
    for (const lot of store.lots.values()) {
      if (lot.ownerId === guest.id) {
        lot.ownerId = account.id;
        lot.ownerName = account.name;
      }
    }
  }
  const client = sb();
  if (client) {
    const moved = await client.from("properties").update({ owner_id: account.id, owner_name: account.name }).eq("owner_id", guest.id);
    if (moved.error) noteSupabase(moved.error.message);
    const books = await client.from("bookings").update({ owner_id: account.id }).eq("owner_id", guest.id);
    if (books.error && !/owner_id/i.test(books.error.message || "")) noteSupabase(books.error.message);
    // Office leases move the same way — the claim stays with the person,
    // just under their account id now.
    const offices = await client.from("office_claims").update({ owner_id: account.id }).eq("owner_id", guest.id);
    if (offices.error && !/office_claims/i.test(offices.error.message || "")) noteSupabase(offices.error.message);
  }
  await deletePlayer(guest.id);
}

async function openAccount(account, body) {
  let player = await playerById(account.id);
  let upgraded = false;
  if (!player) {
    player = freshPlayer(account.id, account.name || "Player");
    player.authUser = account.id;
  }
  player.email = account.email || player.email;
  player.avatar = account.avatar || player.avatar;
  player.provider = account.provider || player.provider;
  player.authUser = account.id;
  const guestToken = String(body.guestToken || "");
  if (guestToken && isFresh(player)) {
    const guest = await playerByToken(guestToken);
    if (guest && guest.id !== player.id && !guest.authUser) {
      await adoptGuest(player, guest);
      upgraded = true;
    }
  }
  const chain = await ensureWallet(player.authUser);
  if (chain?.publicKey) player.address = chain.publicKey;
  const view = chain ? await walletView(player.authUser) : null;
  if (view) player.holder = !!view.holder;
  await savePlayer(player);
  return { player, upgraded, chain: view };
}

// In-game radio: a public playlist anyone can add to, played personally.
// Uploads go straight from the browser to Supabase Storage on a
// server-issued signed URL — the file never passes through this function
// (Vercel caps request bodies at ~4.5 MB and tracks can be up to 15 MB).
// Free: no money, no burn, no City Sol.
const RADIO_BUCKET = "radio";
const RADIO_MAX_BYTES = 15 * 1024 * 1024;
const RADIO_EXTS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".webm", ".aac", ".flac"]);

function radioExt(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

async function radioList() {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const { data, error } = await client
    .from("radio_tracks")
    .select("id, name, uploader_id, uploader_name, storage_path, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    noteSupabase(error.message);
    return { ok: false, message: "Could not load the radio.", status: 500 };
  }
  const tracks = (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    uploader: row.uploader_name || "Guest",
    uploaderId: row.uploader_id || "",
    path: row.storage_path,
    url: client.storage.from(RADIO_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    createdAt: row.created_at,
  }));
  return { ok: true, tracks };
}

async function radioUploadUrl(player, body) {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const name = String(body.name || body.filename || "").trim().slice(0, 80);
  const size = Number(body.size || 0);
  const ext = radioExt(body.name || body.filename || "");
  if (!name) return { ok: false, message: "Name the track.", status: 400 };
  if (!RADIO_EXTS.has(ext)) {
    return { ok: false, message: "That is not a supported audio file (mp3, m4a, wav, ogg, webm, aac, flac).", status: 400 };
  }
  if (!Number.isFinite(size) || size <= 0 || size > RADIO_MAX_BYTES) {
    return { ok: false, message: "Tracks are at most 15 MB.", status: 400 };
  }
  const path = `tracks/${player.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const { data, error } = await client.storage.from(RADIO_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    noteSupabase(error?.message || "signed upload failed");
    return { ok: false, message: "Could not start the upload. Try again.", status: 500 };
  }
  return { ok: true, signedUrl: data.signedUrl, path, maxBytes: RADIO_MAX_BYTES };
}

async function radioRegister(player, body) {
  const client = sb();
  if (!client) return { ok: false, message: "The city server is offline.", status: 503 };
  const name = String(body.name || "").trim().slice(0, 80);
  const path = String(body.path || "");
  if (!name) return { ok: false, message: "Name the track.", status: 400 };
  // Only the player who was issued the upload URL can register that path.
  if (!path.startsWith(`tracks/${player.id}/`)) {
    return { ok: false, message: "That upload is not yours.", status: 400 };
  }
  if (!RADIO_EXTS.has(radioExt(path))) {
    return { ok: false, message: "That is not a supported audio file.", status: 400 };
  }
  // Confirm the file actually landed in storage before listing it.
  const folder = path.slice(0, path.lastIndexOf("/"));
  const file = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await client.storage.from(RADIO_BUCKET).list(folder, { limit: 10, search: file });
  if (error) {
    noteSupabase(error.message);
    return { ok: false, message: "Could not confirm the upload. Try again.", status: 500 };
  }
  if (!Array.isArray(data) || !data.some((item) => item.name === file)) {
    return { ok: false, message: "The upload did not land. Try uploading again.", status: 400 };
  }
  const { data: inserted, error: insertErr } = await client
    .from("radio_tracks")
    .insert({ name, uploader_id: player.id, uploader_name: player.name || "Guest", storage_path: path })
    .select("id, name, uploader_id, uploader_name, storage_path, created_at")
    .single();
  if (insertErr || !inserted) {
    noteSupabase(insertErr?.message || "radio insert failed");
    return { ok: false, message: "Could not add the track to the radio.", status: 500 };
  }
  const listed = await radioList();
  return {
    ok: true,
    message: `"${inserted.name}" is on the radio.`,
    track: {
      id: inserted.id,
      name: inserted.name,
      uploader: inserted.uploader_name,
      uploaderId: inserted.uploader_id,
      path: inserted.storage_path,
      url: client.storage.from(RADIO_BUCKET).getPublicUrl(inserted.storage_path).data.publicUrl,
      createdAt: inserted.created_at,
    },
    tracks: listed.tracks || [],
  };
}

const HEARTBEAT = new Set(["sync", "digest", "me", "board"]);

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Send JSON." }, 400);
  }
  const op = String(body.op || "");
  if (op.startsWith("auth-")) {
    const result = await handleAuthOp(op, body);
    if (!result) return json({ ok: false, message: "Unknown auth request." }, 400);
    const status = result.status || 200;
    const payload = { ...result };
    delete payload.status;
    return json(payload, status);
  }
  const token = bearer(request);
  const account = looksLikeAccountToken(token) ? await verifyAccessToken(token, !HEARTBEAT.has(op)) : null;
  if (op === "session") {
    if (looksLikeAccountToken(token)) {
      if (!account) return json({ ok: false, message: "That login expired. Sign in again." }, 401);
      const opened = await openAccount(account, body);
      return json({
        ok: true,
        token: opened.player.token,
        me: publicPlayer(opened.player),
        storage: storageName(),
        upgraded: opened.upgraded,
        chain: opened.chain,
        auth: authMode(),
      });
    }
    const wanted = String(body.id || "").slice(0, 64);
    const known = String(body.token || "");
    let player = wanted ? await playerById(wanted) : null;
    if (player && (player.token !== known || player.authUser)) player = null;
    if (!player) {
      player = freshPlayer(wanted || randomBytes(12).toString("hex"), body.name);
      await savePlayer(player);
    } else if (body.name) {
      player.name = String(body.name).slice(0, 18);
      await savePlayer(player);
    }
    return json({ ok: true, token: player.token, me: publicPlayer(player), storage: storageName(), auth: authMode() });
  }

  let player = null;
  if (looksLikeAccountToken(token)) {
    if (!account) return json({ ok: false, message: "That login expired. Sign in again." }, 401);
    player = await playerById(account.id);
  } else {
    player = await playerByToken(token);
    if (player?.authUser) return json({ ok: false, message: "Sign in with your account." }, 401);
  }
  if (!player) return json({ ok: false, message: "Sign in first." }, 401);

  if (op === "wallet-view") {
    if (!player.authUser) return json({ ok: false, message: "Create an account to open the in-app wallet. Guests keep City Sol only." }, 400);
    const view = await walletView(player.authUser);
    player.holder = !!view.holder;
    if (view.address) player.address = view.address;
    await savePlayer(player);
    return json({ ...view, me: publicPlayer(player) });
  }
  if (op === "wallet-quote") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before sending from the in-app wallet." }, 400);
    const quote = quoteSend(body);
    return json(quote, quote.status || 200);
  }
  if (op === "wallet-confirm") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before sending from the in-app wallet." }, 400);
    const sent = await confirmSend(player.authUser, body);
    return json(sent, sent.status || 200);
  }
  if (op === "wallet-export") {
    if (!player.authUser) return json({ ok: false, message: "Create an account before exporting a key." }, 400);
    if (String(body.confirm || "") !== "EXPORT") return json({ ok: false, message: "Export needs the warning confirmed." }, 400);
    const allowed = await checkReauth(account, body);
    const exported = await exportWallet(player.authUser, allowed);
    return json(exported, exported.status || 200);
  }
  if (op === "wallet-link") {
    return json({ ok: false, message: "External wallet connect is not used. Each account has an in-app wallet." }, 410);
  }

  if (op === "me") return json({ ok: true, me: publicPlayer(player) });

  if (op === "spend") {
    const result = await spendItem(player, String(body.item || ""));
    return json(result, result.ok ? 200 : 400);
  }

  if (op === "job-start") {
    const id = String(body.job || "");
    if (!JOBS[id]) return json({ ok: false, message: "Unknown job." }, 400);
    player.job = { id, started: Date.now() };
    await savePlayer(player);
    return json({ ok: true, me: publicPlayer(player) });
  }

  if (op === "earn") {
    const id = String(body.job || "");
    const pay = scaledPay(id, player.jobStreak);
    if (!pay) return json({ ok: false, message: "Unknown job." }, 400);
    if (!player.job || player.job.id !== id) return json({ ok: false, message: "Start that job first." }, 400);
    if (Date.now() - Number(player.job.started) < JOB_MS) {
      return json({ ok: false, message: "Finish the route. The city checks the clock." }, 400);
    }
    player.balance += pay;
    player.job = null;
    player.jobStreak = Number(player.jobStreak || 0) + 1;
    const bonus = noteEarn(player, id, pay);
    await savePlayer(player);
    const extra = bonus ? ` Quest paid ${bonus} City Sol.` : "";
    return json({ ok: true, message: `${id} paid ${pay} City Sol. Job streak ${player.jobStreak}.${extra}`, me: publicPlayer(player) });
  }

  // Real billboards: pay SOL from the in-app wallet, Jupiter swaps
  // SOL -> ORBITX, and the received ORBITX is burned. 100% buy + burn.
  const adCtx = { sb, note: noteSupabase, readBookings, saveBooking, savePlayer };
  const adReply = async (result) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(player);
    return json(payload, status || 200);
  };
  if (op === "ad-quote") return adReply(await adQuote(adCtx, player, body));
  if (op === "ad-status") return adReply(await adStatus(adCtx, player, body));
  if (op === "ad-retry-burn") return adReply(await adRetryBurn(adCtx, player, body));
  if (op === "ad-remove") return adReply(await adRemove(adCtx, player, body));
  if (op === "ad-orders") return adReply(await adOrdersFor(adCtx, player));
  if (op === "book") return adReply(await adBuy(adCtx, player, body));

  const radioReply = async (result) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(player);
    return json(payload, status || 200);
  };
  // Tower office leases — City Sol only. No SOL, no ORBITX, no burn:
  // the claim functions above deduct from the stored City Sol balance.
  const officeReply = async (result) => {
    const { status, ...payload } = result;
    if (result.ok) payload.me = publicPlayer(player);
    return json(payload, status || 200);
  };
  if (op === "radio-list") return radioReply(await radioList());
  if (op === "radio-upload-url") return radioReply(await radioUploadUrl(player, body));
  if (op === "radio-register") return radioReply(await radioRegister(player, body));
  if (op === "office-claim") return officeReply(await claimOffice(player, body));
  if (op === "office-claims") return officeReply({ ok: true, offices: await officeDirectory() });
  if (op === "office-release") return officeReply(await releaseOffice(player, body));
  if (op === "office-status") {
    const claims = await readOfficeClaims();
    const mine = claims
      .filter((row) => row.owner_id === player.id && row.until >= todayISO())
      .map(publicOfficeClaim);
    return officeReply({ ok: true, mine, offices: await officeDirectory() });
  }

  if (op === "profile") {
    const name = String(body.name || player.name).trim().slice(0, 18);
    if (name) player.name = name;
    const look = String(body.look || "");
    if (LOOKS.has(look)) player.look = look;
    await savePlayer(player);
    return json({ ok: true, me: publicPlayer(player) });
  }

  if (op === "friend-ask") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "No player with that id." }, 404);
    if (!other.inbox.some((item) => item.id === player.id)) other.inbox.push({ id: player.id, name: player.name });
    await savePlayer(other);
    return json({ ok: true, message: `Asked ${other.name}.` });
  }

  if (op === "friend-accept") {
    const other = await playerById(String(body.id || ""));
    if (!other) return json({ ok: false, message: "That request is gone." }, 404);
    player.inbox = player.inbox.filter((item) => item.id !== other.id);
    if (!player.friends.some((item) => item.id === other.id)) player.friends.push({ id: other.id, name: other.name });
    if (!other.friends.some((item) => item.id === player.id)) other.friends.push({ id: player.id, name: player.name });
    await savePlayer(player);
    await savePlayer(other);
    return json({ ok: true, me: publicPlayer(player), message: `${other.name} is a friend.` });
  }

  if (op === "party") {
    const store = memory();
    const partyId = player.party || `party-${player.id.slice(0, 6)}`;
    let party = store.parties.get(partyId) || { id: partyId, members: [{ id: player.id, name: player.name }] };
    const invite = String(body.invite || "");
    if (invite) {
      const other = await playerById(invite);
      if (!other) return json({ ok: false, message: "No player with that id." }, 404);
      if (!party.members.some((item) => item.id === other.id)) party.members.push({ id: other.id, name: other.name });
      other.party = partyId;
      await savePlayer(other);
    }
    player.party = partyId;
    if (!party.members.some((item) => item.id === player.id)) party.members.push({ id: player.id, name: player.name });
    store.parties.set(partyId, party);
    const client = sb();
    if (client) {
      const { error } = await client.from("parties").upsert({ id: partyId, members: party.members });
      if (error) noteSupabase(error.message);
    }
    await savePlayer(player);
    return json({ ok: true, party, me: publicPlayer(player) });
  }

  if (op === "event-add") {
    const info = {
      id: `event-${Date.now()}`,
      title: String(body.title || "Community night").slice(0, 48),
      where: String(body.where || "Fountain plaza").slice(0, 48),
      when: String(body.when || "Tonight").slice(0, 48),
      detail: String(body.detail || "Meet in the city.").slice(0, 140),
    };
    await addEvent(info);
    return json({ ok: true, event: info });
  }

  if (op === "chat") {
    const text = String(body.text || "").trim().slice(0, 180);
    if (!text) return json({ ok: false, message: "Empty message." }, 400);
    const scope = body.scope === "near" ? "near" : "global";
    await pushChat({
      id: player.id,
      name: player.name,
      text,
      scope,
      x: Number(body.x) || 0,
      z: Number(body.z) || 0,
      at: Date.now(),
    });
    return json({ ok: true });
  }

  if (op === "voice-token") {
    const room = String(body.room || "plaza").slice(0, 40);
    const token = livekitToken(player.id, room);
    if (token) {
      return json({ ok: true, provider: "livekit", url: process.env.LIVEKIT_URL, token, room });
    }
    return json({ ok: true, provider: "mesh", room, ice: [{ urls: "stun:stun.l.google.com:19302" }] });
  }

  if (op === "voice-signal") {
    const signal = {
      from: player.id,
      to: String(body.to || ""),
      room: String(body.room || ""),
      data: body.data || null,
      at: Date.now(),
    };
    await pushSignal(signal);
    const mine = await takeSignals(player.id);
    return json({ ok: true, signals: mine });
  }

  if (op === "sync") {
    const state = sanitizeState(player, body.state || {});
    if (body.ghost || body.state?.ghost) ensureGhost();
    await writePresence(state);
    const people = await readWorld();
    const here = people.find((item) => item.id === player.id);
    const chat = (await readChat()).filter((line) => {
      if (line.scope !== "near" || !here) return true;
      return Math.hypot((line.x || 0) - here.x, (line.z || 0) - here.z) < 22 || line.id === player.id;
    });
    const signals = await takeSignals(player.id);
    let party = player.party ? memory().parties.get(player.party) || null : null;
    if (player.party && sb()) {
      const { data, error } = await sb().from("parties").select("id, members").eq("id", player.party).maybeSingle();
      if (data) party = data;
      if (error) noteSupabase(error.message);
    }
    return json({
      ok: true,
      me: publicPlayer(player),
      people,
      chat: chat.slice(-40),
      bookings: await readBookings(),
      events: await readEvents(),
      lobbies: lobbiesFor(people),
      signals,
      party,
      server: storageName(),
      realtime: publicRealtime(),
      supabaseError: globalThis.__orbitxSbError || "",
    });
  }

  if (op === "board") {
    const board = await leaderboard();
    return json({ ok: true, board });
  }

  if (op === "mission") {
    const step = Number(body.step);
    if (step !== player.mission) return json({ ok: false, message: "That stop is out of order." }, 400);
    if (!MISSIONS[step]) return json({ ok: true, message: "City tour complete.", me: publicPlayer(player) });
    if (player.missionAt && Date.now() - Number(player.missionAt) < 3000) {
      return json({ ok: false, message: "Stay at the stop a moment." }, 400);
    }
    const reward = MISSIONS[step].pay;
    player.mission += 1;
    player.missionAt = Date.now();
    player.balance += reward;
    await savePlayer(player);
    return json({
      ok: true,
      message: `Tour stop ${step + 1} paid ${reward} City Sol.`,
      me: publicPlayer(player),
    });
  }

  const live = await handleLive(
    {
      memory,
      sb,
      sql: db(),
      note: noteSupabase,
      savePlayer,
      addEvent,
      burnOf,
    },
    player,
    op,
    body,
  );
  if (live) {
    const status = live.status || 200;
    const payload = { ...live };
    delete payload.status;
    if (payload.includeMe) {
      payload.me = publicPlayer(player);
      delete payload.includeMe;
    }
    return json(payload, status);
  }

  return json({ ok: false, message: "Unknown request." }, 400);
}

async function leaderboard() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("players").select("name, burned").order("burned", { ascending: false }).limit(8);
    if (!error && data) return data;
    if (error) noteSupabase(error.message);
  }
  return [...memory().players.values()]
    .sort((a, b) => b.burned - a.burned)
    .slice(0, 8)
    .map((player) => ({ name: player.name, burned: player.burned }));
}

function storageName() {
  if (supabaseEnv() && !globalThis.__orbitxSbError) return "Supabase";
  if (databaseUrl() && redisEnv()) return "Neon + Upstash";
  if (databaseUrl()) return "Neon";
  if (redisEnv()) return "Upstash";
  return "This server memory";
}

function sanitizeState(player, raw) {
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(-400, Math.min(400, n)) : fallback;
  };
  return {
    id: player.id,
    name: player.name,
    x: num(raw.x),
    y: num(raw.y),
    z: num(raw.z),
    yaw: num(raw.yaw),
    color: player.color,
    hat: player.hat,
    car: Boolean(raw.car),
    skin: player.car,
    speaking: Boolean(raw.speaking),
    emote: String(raw.emote || "").slice(0, 16),
    holder: !!player.holder,
    lobby: String(raw.lobby || "").slice(0, 40),
    seen: Date.now(),
  };
}

function ensureGhost() {
  const store = memory();
  store.world.set("ghost-nova", {
    id: "ghost-nova",
    name: "Nova",
    x: 2,
    y: 0,
    z: 18,
    yaw: Math.PI,
    color: "cyan",
    hat: "cap",
    car: false,
    skin: "cyan",
    speaking: true,
    emote: "wave",
    lobby: "plaza",
    seen: Date.now(),
  });
}

async function pushSignal(signal) {
  // Signals must survive across Vercel serverless instances, so Supabase
  // is the store. Redis stays as the fallback when it is configured;
  // per-instance memory is only the local-dev last resort.
  const client = sb();
  if (client) {
    const { error } = await client.from("voice_signals").insert({
      from_id: signal.from,
      to_id: signal.to,
      room: signal.room,
      data: signal.data,
    });
    if (!error) {
      await client
        .from("voice_signals")
        .delete()
        .lt("created_at", new Date(Date.now() - 15000).toISOString());
      return;
    }
    noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    await cache.lpush("orbitx:signals", JSON.stringify(signal));
    return;
  }
  memory().signals.push(signal);
}

async function takeSignals(id) {
  const client = sb();
  if (client) {
    const since = new Date(Date.now() - 15000).toISOString();
    const { data, error } = await client
      .from("voice_signals")
      .select("id, from_id, to_id, room, data, created_at")
      .eq("to_id", id)
      .gt("created_at", since)
      .order("created_at", { ascending: true });
    if (!error && data) {
      if (data.length) {
        const ids = data.map((row) => row.id);
        await client.from("voice_signals").delete().in("id", ids);
      }
      return data.map((row) => ({
        from: row.from_id,
        to: row.to_id,
        room: row.room,
        data: row.data,
        at: new Date(row.created_at).getTime(),
      }));
    }
    if (error) noteSupabase(error.message);
  }
  const cache = redis();
  if (cache) {
    const rows = (await cache.lrange("orbitx:signals", 0, 200)) || [];
    const keep = [];
    const mine = [];
    for (const row of rows) {
      const signal = typeof row === "string" ? JSON.parse(row) : row;
      if (signal.to === id && Date.now() - signal.at < 15000) mine.push(signal);
      else if (Date.now() - signal.at < 15000) keep.push(JSON.stringify(signal));
    }
    await cache.del("orbitx:signals");
    if (keep.length) await cache.rpush("orbitx:signals", ...keep);
    return mine;
  }
  const store = memory();
  const mine = store.signals.filter((signal) => signal.to === id);
  store.signals = store.signals.filter((signal) => signal.to !== id && Date.now() - signal.at < 15000);
  return mine;
}
