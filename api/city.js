import { createHmac, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";

const START_BALANCE = 250;
const BURN_RATE = 0.25;
const PRESENCE_MS = 8000;
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

const JOBS = {
  courier: 45,
  taxi: 70,
  guide: 60,
  mechanic: 55,
  photographer: 40,
  promoter: 50,
  dock: 65,
  dj: 55,
  banker: 50,
};

const MISSIONS = [
  { id: "plaza", pay: 15 },
  { id: "shop", pay: 20 },
  { id: "cafe", pay: 20 },
  { id: "hall", pay: 25 },
  { id: "tower", pay: 30 },
  { id: "dock", pay: 80 },
];

const AD_PRICE = { 1: 25, 7: 80, 30: 200 };

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
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return url && key ? { url, key, anon } : null;
}

function sb() {
  const env = supabaseEnv();
  if (!env) return null;
  const slot = globalThis;
  if (!slot.__orbitxSb) {
    slot.__orbitxSb = createClient(env.url, env.key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
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
    party TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    text TEXT NOT NULL,
    start TEXT NOT NULL,
    until TEXT NOT NULL,
    burned INTEGER NOT NULL
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
    party: "",
    mission: 0,
    missionAt: 0,
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
  };
}

async function savePlayer(player) {
  const client = sb();
  if (client) {
    const { error } = await client.from("players").upsert(rowFromPlayer(player));
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
    await sql`INSERT INTO players (id, token, name, balance, burned, owned, color, hat, car, friends, inbox, job, party)
      VALUES (${player.id}, ${player.token}, ${player.name}, ${player.balance}, ${player.burned}, ${owned}, ${player.color}, ${player.hat}, ${player.car}, ${friends}, ${inbox}, ${job}, ${player.party})
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
        party = EXCLUDED.party`;
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
    party: row.party || "",
    mission: Number(row.mission || 0),
    missionAt: Number(row.mission_at || row.missionAt || 0),
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
    party: player.party || "",
    mission: player.mission || 0,
    mission_at: player.missionAt || 0,
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

async function readBookings() {
  const client = sb();
  if (client) {
    const { data, error } = await client.from("bookings").select("id, project, text, start, end, burned");
    if (!error && data) return data;
    if (error) noteSupabase(error.message);
  }
  const sql = db();
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT id, project, text, start, until AS end, burned FROM bookings`;
    return rows;
  }
  const cache = redis();
  if (cache) {
    const all = (await cache.hgetall("orbitx:bookings")) || {};
    return Object.values(all).map((row) => (typeof row === "string" ? JSON.parse(row) : row));
  }
  return [...memory().bookings.values()];
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
  if (player.balance < item.price) return { ok: false, message: "Not enough demo ORBITX." };
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
    message: `Spent ${item.price} demo ORBITX. Burned ${burned}. Burned total ${player.burned}.`,
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
    note: "Demo credits only. No real tokens or wallets.",
    supabase: Boolean(supabaseEnv()),
    supabaseError: globalThis.__orbitxSbError || "",
    realtime: publicRealtime(),
  });
}

export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Send JSON." }, 400);
  }
  const op = String(body.op || "");
  if (op === "session") {
    const wanted = String(body.id || "").slice(0, 64);
    const known = String(body.token || "");
    let player = wanted ? await playerById(wanted) : null;
    if (player && player.token !== known) player = null;
    if (!player) {
      player = freshPlayer(wanted || randomBytes(12).toString("hex"), body.name);
      await savePlayer(player);
    } else if (body.name) {
      player.name = String(body.name).slice(0, 18);
      await savePlayer(player);
    }
    return json({ ok: true, token: player.token, me: publicPlayer(player), storage: storageName() });
  }

  const player = await playerByToken(bearer(request));
  if (!player) return json({ ok: false, message: "Sign in first." }, 401);

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
    const pay = JOBS[id];
    if (!pay) return json({ ok: false, message: "Unknown job." }, 400);
    if (!player.job || player.job.id !== id) return json({ ok: false, message: "Start that job first." }, 400);
    if (Date.now() - Number(player.job.started) < JOB_MS) {
      return json({ ok: false, message: "Finish the route. The city checks the clock." }, 400);
    }
    player.balance += pay;
    player.job = null;
    await savePlayer(player);
    return json({ ok: true, message: `${id} paid ${pay} demo ORBITX.`, me: publicPlayer(player) });
  }

  if (op === "book") {
    const days = Number(body.days);
    const price = AD_PRICE[days];
    const id = String(body.id || "").slice(0, 40);
    if (!price || !id) return json({ ok: false, message: "Pick a billboard and 1, 7, or 30 days." }, 400);
    if (player.balance < price) return json({ ok: false, message: "Not enough demo ORBITX." }, 400);
    const burned = burnOf(price);
    player.balance -= price;
    player.burned += burned;
    await savePlayer(player);
    const start = new Date();
    const end = new Date(start.getTime() + days * 86400000);
    const info = {
      id,
      project: String(body.project || player.name).slice(0, 32),
      text: String(body.text || "NEW CAMPAIGN").slice(0, 32),
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      burned,
    };
    await saveBooking(info);
    return json({
      ok: true,
      message: `Spent ${price} demo ORBITX. Burned ${burned}. Billboard ${id} is up.`,
      me: publicPlayer(player),
      booking: info,
    });
  }

  if (op === "profile") {
    const name = String(body.name || player.name).trim().slice(0, 18);
    if (name) player.name = name;
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
    const cache = redis();
    if (cache) await cache.lpush("orbitx:signals", JSON.stringify(signal));
    else memory().signals.push(signal);
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
      message: `Tour stop ${step + 1} paid ${reward} demo ORBITX.`,
      me: publicPlayer(player),
    });
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

async function takeSignals(id) {
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
