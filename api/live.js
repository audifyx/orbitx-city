// Server rules for property, races, dailies, and arcade play-money.
// Demo credits only. In-app Solana keys live in wallet.js, not here.

export const LOTS = [
  { id: "loft", zone: "hall", anchor: "hall", name: "Sunset Loft", kind: "apartment", price: 120 },
  { id: "harbor", zone: "dock", anchor: "dock", name: "Harbor Apartment", kind: "apartment", price: 160 },
  { id: "market", zone: "market", anchor: "market", name: "Market Shop", kind: "shop", price: 180 },
  { id: "hq-0", zone: "project-0", anchor: "project-0", name: "OrbitX HQ", kind: "hq", price: 90 },
  { id: "hq-1", zone: "project-1", anchor: "project-1", name: "Your Project HQ", kind: "hq", price: 90 },
  { id: "hq-2", zone: "project-2", anchor: "project-2", name: "North Star HQ", kind: "hq", price: 90 },
  { id: "hq-3", zone: "project-3", anchor: "project-3", name: "Lumen Labs HQ", kind: "hq", price: 90 },
];

export const FURNITURE = ["couch", "table", "plant", "lamp", "screen", "rug"];

export const GATES = [
  { x: 36, z: 0 },
  { x: 36, z: 36 },
  { x: 0, z: 36 },
  { x: -36, z: 36 },
  { x: -36, z: 0 },
  { x: 36, z: 0 },
];

const QUEST_POOL = [
  { id: "courier", label: "Complete 2 courier jobs", need: 2 },
  { id: "visit", label: "Visit a project HQ", need: 1 },
  { id: "race", label: "Finish a street race or time trial", need: 1 },
  { id: "arcade", label: "Play one arcade game", need: 1 },
  { id: "drive", label: "Drive a hover-car", need: 1 },
];

const CLIENT_QUESTS = new Set(["visit", "drive"]);
const STAKE = 10;
const GATE_RADIUS = 10;
const GATE_GAP_MS = 700;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function ensureStore(ctx) {
  const store = ctx.memory();
  if (!store.lots) store.lots = new Map();
  if (!store.notes) store.notes = new Map();
  if (!store.volatile) store.volatile = new Map();
  if (!store.raceLobby) {
    store.raceLobby = { phase: "open", players: [], startedAt: 0, results: [] };
  }
  return store;
}

function dayKey(time = Date.now()) {
  return new Date(time).toISOString().slice(0, 10);
}

function questsFor(day) {
  const n = Number(day.slice(8, 10)) || 1;
  const start = (n - 1) % QUEST_POOL.length;
  return [0, 1, 2].map((offset) => ({ ...QUEST_POOL[(start + offset) % QUEST_POOL.length] }));
}

export function ensureDaily(player) {
  const day = dayKey();
  const prev = player.daily && typeof player.daily === "object" ? player.daily : {};
  if (prev.day === day && Array.isArray(prev.quests)) return prev;
  const yesterday = dayKey(Date.now() - 86400000);
  player.daily = {
    day,
    streak: prev.day === yesterday ? Number(prev.streak || 0) : 0,
    claimed: false,
    progress: {},
    paid: {},
    quests: questsFor(day),
  };
  return player.daily;
}

export function touchQuest(player, id, amount = 1) {
  const daily = ensureDaily(player);
  const quest = daily.quests.find((item) => item.id === id);
  if (!quest) return 0;
  const have = Math.min(quest.need, Number(daily.progress[id] || 0) + amount);
  daily.progress[id] = have;
  if (have >= quest.need && !daily.paid[id]) {
    daily.paid[id] = true;
    player.balance += 12;
    return 12;
  }
  return 0;
}

export function noteEarn(player, jobId, pay) {
  player.earned = Number(player.earned || 0) + pay;
  if (jobId === "courier") return touchQuest(player, "courier", 1);
  return 0;
}

function viewDaily(player) {
  const daily = ensureDaily(player);
  const reward = 15 + Math.min(Number(daily.streak) || 0, 6) * 5;
  return {
    day: daily.day,
    streak: Number(daily.streak) || 0,
    claimed: !!daily.claimed,
    reward,
    quests: daily.quests.map((quest) => ({
      id: quest.id,
      label: quest.label,
      need: quest.need,
      have: Number(daily.progress[quest.id] || 0),
      done: Number(daily.progress[quest.id] || 0) >= quest.need,
    })),
  };
}

function hydrate(player, store) {
  const extra = store.volatile.get(player.id);
  if (extra) {
    player.race = extra.race;
    player.arcade = extra.arcade;
  }
}

function remember(player, store) {
  store.volatile.set(player.id, { race: player.race || null, arcade: player.arcade || null });
}

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-400, Math.min(400, n));
}

function cleanFurniture(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map((item, index) => ({
    id: String(item?.id || `p${index}`).slice(0, 16),
    kind: FURNITURE.includes(item?.kind) ? item.kind : "table",
    x: clamp(item?.x),
    z: clamp(item?.z),
    rot: clamp(item?.rot),
  }));
}

async function loadWorld(ctx) {
  const store = ensureStore(ctx);
  if (store.lotsLoaded) return store;
  store.lotsLoaded = true;
  const client = ctx.sb();
  if (client) {
    const props = await client.from("properties").select("id, owner_id, owner_name, furniture");
    if (!props.error && props.data) {
      for (const row of props.data) {
        store.lots.set(row.id, {
          id: row.id,
          ownerId: row.owner_id || "",
          ownerName: row.owner_name || "",
          furniture: Array.isArray(row.furniture) ? row.furniture : [],
        });
      }
    }
    const notes = await client.from("announcements").select("id, text, author");
    if (!notes.error && notes.data) {
      for (const row of notes.data) store.notes.set(row.id, { text: row.text || "", author: row.author || "" });
    }
  }
  if (ctx.sql) {
    try {
      const rows = await ctx.sql`SELECT id, owner_id, owner_name, furniture FROM properties`;
      for (const row of rows) {
        if (store.lots.has(row.id)) continue;
        const furniture = typeof row.furniture === "string" ? JSON.parse(row.furniture || "[]") : row.furniture || [];
        store.lots.set(row.id, {
          id: row.id,
          ownerId: row.owner_id || "",
          ownerName: row.owner_name || "",
          furniture,
        });
      }
    } catch {
      // The table is optional until schema.sql has been run again.
    }
    try {
      const rows = await ctx.sql`SELECT id, text, author FROM announcements`;
      for (const row of rows) {
        if (!store.notes.has(row.id)) store.notes.set(row.id, { text: row.text || "", author: row.author || "" });
      }
    } catch {
      // Same as properties: memory still works for this process.
    }
  }
  return store;
}

async function persistLot(ctx, lot) {
  const store = ensureStore(ctx);
  store.lots.set(lot.id, lot);
  const client = ctx.sb();
  if (client) {
    await client.from("properties").upsert({
      id: lot.id,
      owner_id: lot.ownerId,
      owner_name: lot.ownerName,
      furniture: lot.furniture,
    });
  }
  if (ctx.sql) {
    try {
      const furniture = JSON.stringify(lot.furniture || []);
      await ctx.sql`INSERT INTO properties (id, owner_id, owner_name, furniture)
        VALUES (${lot.id}, ${lot.ownerId}, ${lot.ownerName}, ${furniture})
        ON CONFLICT (id) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          owner_name = EXCLUDED.owner_name,
          furniture = EXCLUDED.furniture`;
    } catch {
      // Memory already has the lot.
    }
  }
}

async function persistNote(ctx, id, note) {
  const store = ensureStore(ctx);
  store.notes.set(id, note);
  const client = ctx.sb();
  if (client) await client.from("announcements").upsert({ id, text: note.text, author: note.author });
  if (ctx.sql) {
    try {
      await ctx.sql`INSERT INTO announcements (id, text, author)
        VALUES (${id}, ${note.text}, ${note.author})
        ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, author = EXCLUDED.author`;
    } catch {
      // Memory already has the note.
    }
  }
}

function catalog(store, player) {
  return LOTS.map((lot) => {
    const saved = store.lots.get(lot.id);
    let ownerName = saved?.ownerName || "";
    if (saved?.ownerId && saved.ownerId === player?.id && player.name) ownerName = player.name;
    return {
      id: lot.id,
      zone: lot.zone,
      anchor: lot.anchor,
      name: lot.name,
      kind: lot.kind,
      price: lot.price,
      ownerId: saved?.ownerId || "",
      ownerName,
      furniture: saved?.furniture || [],
    };
  });
}

function lotById(id) {
  return LOTS.find((lot) => lot.id === id) || null;
}

function ownedLot(store, player, id) {
  const lot = lotById(id);
  if (!lot) return null;
  const saved = store.lots.get(lot.id);
  if (!saved || saved.ownerId !== player.id) return null;
  return { lot, saved };
}

function freshLobby(store) {
  store.raceLobby = { phase: "open", players: [], startedAt: 0, results: [] };
  return store.raceLobby;
}

function lobbyNow(store) {
  const lobby = store.raceLobby;
  if (lobby.phase === "live" && lobby.startedAt && Date.now() - lobby.startedAt > 120000) return freshLobby(store);
  return lobby;
}

function top(rows, score, text) {
  return rows
    .map((row) => ({ name: row.name || "Guest", score: score(row) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((row) => ({ name: row.name, value: text(row.score) }));
}

function leadersFrom(players) {
  const rows = [...players];
  const times = [];
  for (const row of rows) {
    if (Number(row.bestRace) > 0) times.push({ name: row.name || "Guest", ms: Number(row.bestRace), kind: "street" });
    if (Number(row.bestHover) > 0) times.push({ name: row.name || "Guest", ms: Number(row.bestHover), kind: "hover" });
  }
  return {
    rich: top(rows, (row) => Number(row.balance) || 0, (n) => `${n} City Sol`),
    earners: top(rows, (row) => Number(row.earned) || 0, (n) => `${n} earned`),
    burned: top(rows, (row) => Number(row.burned) || 0, (n) => `${n} burned`),
    race: times
      .sort((a, b) => a.ms - b.ms)
      .slice(0, 6)
      .map((row) => ({ name: row.name, value: `${row.kind} ${(row.ms / 1000).toFixed(2)}s` })),
  };
}

async function leaderRows(ctx, store) {
  const mine = [...store.players.values()];
  const client = ctx.sb();
  if (client) {
    const full = await client.from("players").select("name, balance, burned, earned, best_race, best_hover").limit(40);
    if (!full.error && full.data) {
      return full.data.map((row) => ({
        name: row.name,
        balance: Number(row.balance) || 0,
        burned: Number(row.burned) || 0,
        earned: Number(row.earned) || 0,
        bestRace: Number(row.best_race) || 0,
        bestHover: Number(row.best_hover) || 0,
      }));
    }
  }
  if (ctx.sql) {
    try {
      const rows = await ctx.sql`SELECT name, balance, burned, earned, best_race, best_hover FROM players LIMIT 40`;
      if (rows?.length) {
        return rows.map((row) => ({
          name: row.name,
          balance: Number(row.balance) || 0,
          burned: Number(row.burned) || 0,
          earned: Number(row.earned) || 0,
          bestRace: Number(row.best_race) || 0,
          bestHover: Number(row.best_hover) || 0,
        }));
      }
    } catch {
      // Columns are added by schema.sql. Memory players still rank.
    }
  }
  return mine;
}

function raceView(store, player) {
  const lobby = store.raceLobby;
  const race = player.race;
  return {
    phase: lobby.phase,
    names: lobby.players.map((item) => item.name),
    startedAt: race?.startedAt || lobby.startedAt || 0,
    results: lobby.results.slice(-8),
    next: race && !race.done ? race.next : -1,
    kind: race?.kind || "",
    done: !!race?.done,
    timeMs: race?.timeMs || 0,
  };
}

function notesView(store) {
  return [...store.notes.entries()].map(([project, note]) => ({
    project,
    text: note.text,
    author: note.author,
  }));
}

async function marketLine(store) {
  const mint = process.env.ORBITX_MINT || "";
  if (!mint) return { configured: false, price: "", holders: "" };
  if (store.market && Date.now() - store.market.at < 60000) return store.market.line;
  const line = { configured: true, price: "", holders: "Holders update from the public RPC when a wallet connects." };
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json();
      const pair = data.pairs?.[0];
      if (pair?.priceUsd) line.price = `$${pair.priceUsd}`;
    }
  } catch {
    line.price = "";
  }
  store.market = { at: Date.now(), line };
  return line;
}

async function digest(ctx, player, store) {
  if (player.wallet && player.name) {
    for (const lot of store.lots.values()) {
      if (lot.ownerId === player.id) lot.ownerName = player.name;
    }
  }
  const leaders = leadersFrom(await leaderRows(ctx, store));
  return {
    ok: true,
    lots: catalog(store, player),
    leaders,
    daily: viewDaily(player),
    race: raceView(store, player),
    notes: notesView(store),
    market: await marketLine(store),
    mintSet: Boolean(process.env.ORBITX_MINT),
    includeMe: true,
  };
}

function fail(message, status = 400) {
  return { ok: false, status, message };
}

async function buyLot(ctx, player, store, id) {
  const lot = lotById(id);
  if (!lot) return fail("That place is not for sale.");
  const saved = store.lots.get(lot.id);
  if (saved?.ownerId) {
    return fail(saved.ownerId === player.id ? "You already own this." : `${saved.ownerName || "Someone"} already owns this.`);
  }
  if (player.balance < lot.price) return fail("Not enough City Sol.");
  const burned = ctx.burnOf(lot.price);
  player.balance -= lot.price;
  player.burned += burned;
  const next = { id: lot.id, ownerId: player.id, ownerName: player.name, furniture: [] };
  await persistLot(ctx, next);
  await ctx.savePlayer(player);
  return {
    ok: true,
    message: `Bought ${lot.name} for ${lot.price} City Sol. Burned ${burned}.`,
    burned,
    includeMe: true,
    lots: catalog(store, player),
  };
}

async function saveFurniture(ctx, player, store, body) {
  const hit = ownedLot(store, player, String(body.id || ""));
  if (!hit) return fail("You can only decorate a place you own.");
  hit.saved.furniture = cleanFurniture(body.furniture);
  hit.saved.ownerName = player.name;
  await persistLot(ctx, hit.saved);
  return { ok: true, message: "Furniture saved.", lots: catalog(store, player) };
}

async function setNote(ctx, player, store, body) {
  const id = String(body.project || "");
  const hit = ownedLot(store, player, id.startsWith("hq-") ? id : `hq-${id}`);
  if (!hit || hit.lot.kind !== "hq") return fail("Only the HQ owner can edit that board.");
  const text = String(body.text || "").slice(0, 180);
  await persistNote(ctx, hit.lot.id, { text, author: player.name });
  return { ok: true, message: "Announcement updated.", notes: notesView(store) };
}

async function hostEvent(ctx, player, store, body) {
  const id = String(body.project || "");
  const hit = ownedLot(store, player, id.startsWith("hq-") ? id : `hq-${id}`);
  if (!hit || hit.lot.kind !== "hq") return fail("Only the HQ owner can host an event there.");
  const title = String(body.title || "").trim().slice(0, 60);
  if (!title) return fail("Give the event a name.");
  const info = {
    id: `hq-${hit.lot.id}-${Date.now().toString(36)}`,
    title,
    where: hit.lot.name,
    when: String(body.when || "Today").slice(0, 40),
    detail: String(body.detail || "Hosted inside the HQ.").slice(0, 180),
  };
  await ctx.addEvent(info);
  return { ok: true, message: `Event posted at ${hit.lot.name}.`, event: info };
}

function armRace(store, player, kind) {
  const lobby = lobbyNow(store);
  if (lobby.phase === "done") freshLobby(store);
  const current = store.raceLobby;
  if (current.phase === "live") return fail("A race is already on the ring. Wait for the finish.");
  if (!current.players.some((item) => item.id === player.id)) {
    current.players.push({ id: player.id, name: player.name, kind });
  } else {
    const mine = current.players.find((item) => item.id === player.id);
    mine.kind = kind;
    mine.name = player.name;
  }
  player.race = { kind, next: -1, startedAt: 0, at: 0, done: false, timeMs: 0 };
  remember(player, store);
  return null;
}

function startLobby(store, player) {
  const lobby = store.raceLobby;
  if (!lobby.players.some((item) => item.id === player.id)) return fail("Join the race first.");
  if (lobby.phase === "live") return fail("The race already started.");
  const startedAt = Date.now() + 5000;
  lobby.phase = "live";
  lobby.startedAt = startedAt;
  lobby.results = [];
  for (const item of lobby.players) {
    const bag = store.volatile.get(item.id) || { race: null, arcade: null };
    bag.race = { kind: item.kind || "street", next: 0, startedAt, at: startedAt, done: false, timeMs: 0 };
    store.volatile.set(item.id, bag);
    if (item.id === player.id) player.race = bag.race;
  }
  return {
    ok: true,
    message: "Race starts in 5. Get to the cyan arch on the east ring.",
    race: raceView(store, player),
    includeMe: true,
  };
}

async function hitGate(ctx, player, store, body) {
  const race = player.race;
  if (!race || race.done || race.next < 0) return fail("You are not in a live race.");
  if (Date.now() < Number(race.startedAt || 0)) return fail("Wait for the countdown.");
  if (race.kind === "hover" && !body.car) return fail("The hover trial counts only while you are in a car.");
  const gate = GATES[race.next];
  if (!gate) return fail("That race is already over.");
  if (Date.now() - Number(race.at || 0) < GATE_GAP_MS) return fail("That gate came too fast.");
  const x = Number(body.x);
  const z = Number(body.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fail("Stand on the gate.");
  if (Math.hypot(x - gate.x, z - gate.z) > GATE_RADIUS) return fail("That is not the next gate.");
  race.next += 1;
  race.at = Date.now();
  if (race.next < GATES.length) {
    remember(player, store);
    return { ok: true, message: `Gate ${race.next} of ${GATES.length - 1}.`, race: raceView(store, player) };
  }
  const timeMs = Date.now() - Number(race.startedAt);
  race.done = true;
  race.timeMs = timeMs;
  race.next = -1;
  if (race.kind === "hover") {
    if (!player.bestHover || timeMs < player.bestHover) player.bestHover = timeMs;
  } else if (!player.bestRace || timeMs < player.bestRace) player.bestRace = timeMs;
  const bonus = touchQuest(player, "race", 1);
  store.raceLobby.results.push({ id: player.id, name: player.name, timeMs, kind: race.kind });
  const still = store.raceLobby.players.some((item) => {
    const bag = store.volatile.get(item.id);
    return bag?.race && !bag.race.done;
  });
  if (!still) store.raceLobby.phase = "done";
  remember(player, store);
  await ctx.savePlayer(player);
  const seconds = (timeMs / 1000).toFixed(2);
  return {
    ok: true,
    message: `Finished in ${seconds}s.${bonus ? ` Quest paid ${bonus} City Sol.` : ""} Play money only.`,
    race: raceView(store, player),
    includeMe: true,
  };
}

function stake(player) {
  if (player.balance < STAKE) return "Not enough City Sol. The arcade stake is 10 City Sol.";
  const burned = Math.max(1, Math.round(STAKE * 0.25));
  player.balance -= STAKE;
  player.burned += burned;
  return burned;
}

async function playHighLow(ctx, player, store, body) {
  const pending = player.arcade?.kind === "highlow" ? player.arcade : null;
  if (!pending) {
    const burned = stake(player);
    if (typeof burned === "string") return fail(burned);
    const shown = 1 + Math.floor(Math.random() * 10);
    let next = 1 + Math.floor(Math.random() * 10);
    if (next === shown) next = shown === 10 ? 9 : shown + 1;
    player.arcade = { kind: "highlow", shown, next, token: `${Date.now().toString(36)}` };
    touchQuest(player, "arcade", 1);
    remember(player, store);
    await ctx.savePlayer(player);
    return {
      ok: true,
      message: `Play money. Staked ${STAKE} City Sol. Burned ${burned}. The card is ${shown}. Higher or lower?`,
      shown,
      token: player.arcade.token,
      includeMe: true,
    };
  }
  if (String(body.token || "") !== pending.token) return fail("That hand is not yours.");
  const guess = body.guess === "low" ? "low" : body.guess === "high" ? "high" : "";
  if (!guess) return fail("Pick higher or lower.");
  const win = guess === "high" ? pending.next > pending.shown : pending.next < pending.shown;
  const payout = win ? 18 : 0;
  player.balance += payout;
  player.arcade = null;
  remember(player, store);
  await ctx.savePlayer(player);
  return {
    ok: true,
    message: win
      ? `Play money. Next card ${pending.next}. You win ${payout} City Sol.`
      : `Play money. Next card ${pending.next}. No payout.`,
    shown: pending.shown,
    next: pending.next,
    payout,
    includeMe: true,
  };
}

async function armReflex(ctx, player, store) {
  if (player.arcade?.kind === "reflex") return fail("Hit the light you already armed.");
  const burned = stake(player);
  if (typeof burned === "string") return fail(burned);
  const goAt = Date.now() + 700 + Math.floor(Math.random() * 1400);
  player.arcade = { kind: "reflex", goAt, token: `${Date.now().toString(36)}` };
  touchQuest(player, "arcade", 1);
  remember(player, store);
  await ctx.savePlayer(player);
  return {
    ok: true,
    message: `Play money. Staked ${STAKE} City Sol. Burned ${burned}. Wait for the light.`,
    goAt,
    token: player.arcade.token,
    includeMe: true,
  };
}

async function hitReflex(ctx, player, store, body) {
  const pending = player.arcade?.kind === "reflex" ? player.arcade : null;
  if (!pending) return fail("Arm the light first.");
  if (String(body.token || "") !== pending.token) return fail("That light is not yours.");
  const dt = Date.now() - Number(pending.goAt);
  player.arcade = null;
  let payout = 0;
  let message = "Play money. Too early. No payout.";
  if (dt >= 0 && dt < 280) {
    payout = 30;
    message = `Play money. ${dt} ms. Payout ${payout} City Sol.`;
  } else if (dt >= 280 && dt < 480) {
    payout = 16;
    message = `Play money. ${dt} ms. Payout ${payout} City Sol.`;
  } else if (dt >= 0) {
    message = `Play money. ${dt} ms. Too slow. No payout.`;
  }
  player.balance += payout;
  remember(player, store);
  await ctx.savePlayer(player);
  return { ok: true, message, payout, ms: dt, includeMe: true };
}

export function b58decode(text) {
  if (typeof text !== "string" || !text) return null;
  let zeros = 0;
  while (text[zeros] === "1") zeros += 1;
  let n = 0n;
  for (let i = zeros; i < text.length; i++) {
    const value = B58.indexOf(text[i]);
    if (value < 0) return null;
    n = n * 58n + BigInt(value);
  }
  if (n === 0n) return Buffer.alloc(zeros);
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, "hex")]);
}

export function b58encode(bytes) {
  const buf = Buffer.from(bytes);
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros += 1;
  let n = BigInt(`0x${buf.toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + (out || (zeros ? "" : ""));
}

export async function handleLive(ctx, player, op, body) {
  const store = await loadWorld(ctx);
  hydrate(player, store);
  const beforeDay = player.daily?.day || "";

  if (op === "digest") {
    const view = await digest(ctx, player, store);
    if ((player.daily?.day || "") !== beforeDay) await ctx.savePlayer(player);
    return view;
  }
  if (op === "property-buy") return buyLot(ctx, player, store, String(body.id || ""));
  if (op === "property-save") return saveFurniture(ctx, player, store, body);
  if (op === "hq-note") return setNote(ctx, player, store, body);
  if (op === "event-host") return hostEvent(ctx, player, store, body);
  if (op === "race-join" || op === "race-go") {
    const kind = body.kind === "hover" ? "hover" : "street";
    const joined = armRace(store, player, kind);
    if (joined) return joined;
    if (op === "race-join") {
      return { ok: true, message: "You are in the race lobby.", race: raceView(store, player) };
    }
    return startLobby(store, player);
  }
  if (op === "race-start") return startLobby(store, player);
  if (op === "race-hit") return hitGate(ctx, player, store, body);
  if (op === "race-leave") {
    store.raceLobby.players = store.raceLobby.players.filter((item) => item.id !== player.id);
    player.race = null;
    remember(player, store);
    if (store.raceLobby.players.length === 0) freshLobby(store);
    return { ok: true, message: "Left the race.", race: raceView(store, player) };
  }
  if (op === "daily-claim") {
    const daily = ensureDaily(player);
    if (daily.claimed) return fail("Already claimed today.");
    const reward = 15 + Math.min(Number(daily.streak) || 0, 6) * 5;
    daily.streak = Number(daily.streak || 0) + 1;
    daily.claimed = true;
    player.balance += reward;
    await ctx.savePlayer(player);
    return {
      ok: true,
      message: `Login streak ${daily.streak}. Claimed ${reward} City Sol.`,
      daily: viewDaily(player),
      includeMe: true,
    };
  }
  if (op === "quest-ping") {
    const id = String(body.id || "");
    if (!CLIENT_QUESTS.has(id)) return fail("That quest is counted by the server.");
    const bonus = touchQuest(player, id, 1);
    await ctx.savePlayer(player);
    return {
      ok: true,
      message: bonus ? `Quest paid ${bonus} City Sol.` : "Quest noted.",
      daily: viewDaily(player),
      includeMe: true,
    };
  }
  if (op === "arcade-play") return playHighLow(ctx, player, store, body);
  if (op === "arcade-arm") return armReflex(ctx, player, store);
  if (op === "arcade-hit") return hitReflex(ctx, player, store, body);
  return null;
}
