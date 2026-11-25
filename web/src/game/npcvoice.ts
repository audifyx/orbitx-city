// NPC voices — every citizen has a voice persona and SPEAKS their
// scripted lines out loud.
//
// Two engines, one persona table:
//  - Server: Google's Gemini TTS (the newest Google voice tech) via the
//    city API's `tts` op. Activates automatically when the API has a
//    Google AI key configured; audio is cached per line, so repeat
//    lines play instantly in the real Gemini voice.
//  - Local fallback: the device's speech synthesis — on Chrome and
//    Android those ARE Google's voices ("Google US English" etc.) —
//    with the persona's pitch/rate shaping each character.
// A line always speaks immediately through the local engine while the
// Gemini audio for it warms the cache in the background, so there is
// never a silent wait for a voice.

export interface VoicePersona {
  /** Gemini TTS voice name (server path). */
  gemini: string;
  /** Local engine shaping. */
  female: boolean;
  pitch: number;
  rate: number;
}

const PERSONAS: Record<string, VoicePersona> = {
  Rio: { gemini: "Puck", female: false, pitch: 1.0, rate: 1.02 },
  Mina: { gemini: "Aoede", female: true, pitch: 1.12, rate: 1.05 },
  Sol: { gemini: "Charon", female: false, pitch: 0.88, rate: 0.95 },
  Nox: { gemini: "Fenrir", female: false, pitch: 0.82, rate: 0.92 },
  Pia: { gemini: "Leda", female: true, pitch: 1.18, rate: 1.08 },
  Kai: { gemini: "Puck", female: false, pitch: 1.06, rate: 1.1 },
  Juno: { gemini: "Kore", female: true, pitch: 1.02, rate: 1.0 },
  Theo: { gemini: "Orus", female: false, pitch: 0.98, rate: 0.96 },
  Vera: { gemini: "Erinome", female: true, pitch: 0.94, rate: 0.92 },
  Otis: { gemini: "Charon", female: false, pitch: 0.78, rate: 0.9 },
  Remy: { gemini: "Algenib", female: false, pitch: 1.1, rate: 1.14 },
  Wren: { gemini: "Leda", female: true, pitch: 1.22, rate: 1.04 },
  Nadia: { gemini: "Aoede", female: true, pitch: 1.06, rate: 0.97 },
  Felix: { gemini: "Orus", female: false, pitch: 0.95, rate: 1.06 },
  Ada: { gemini: "Kore", female: true, pitch: 1.0, rate: 0.95 },
  Milo: { gemini: "Puck", female: false, pitch: 1.08, rate: 1.08 },
  Jax: { gemini: "Fenrir", female: false, pitch: 0.86, rate: 0.98 },
  Sal: { gemini: "Algenib", female: false, pitch: 0.92, rate: 0.95 },
  Zed: { gemini: "Algenib", female: false, pitch: 1.04, rate: 1.1 },
  Lux: { gemini: "Leda", female: true, pitch: 1.16, rate: 1.1 },
  Comet: { gemini: "Orus", female: false, pitch: 1.0, rate: 1.04 },
  Bex: { gemini: "Erinome", female: true, pitch: 1.04, rate: 1.02 },
  Gus: { gemini: "Charon", female: false, pitch: 0.9, rate: 1.0 },
  Park: { gemini: "Fenrir", female: false, pitch: 0.84, rate: 0.94 },
  Pip: { gemini: "Puck", female: false, pitch: 1.05, rate: 1.12 },
};

const ROLE_PERSONAS: Array<[RegExp, VoicePersona]> = [
  [/teller|bank/i, { gemini: "Kore", female: true, pitch: 1.0, rate: 0.95 }],
  [/barista|cafe|café/i, { gemini: "Aoede", female: true, pitch: 1.1, rate: 1.05 }],
  [/attendant|gas|fuel|charge/i, { gemini: "Orus", female: false, pitch: 0.95, rate: 1.0 }],
  [/officer|police|cop/i, { gemini: "Fenrir", female: false, pitch: 0.85, rate: 0.95 }],
  [/driver|operator|conductor/i, { gemini: "Charon", female: false, pitch: 0.9, rate: 1.0 }],
  [/shop|vendor|market|clerk|cashier/i, { gemini: "Puck", female: false, pitch: 1.02, rate: 1.05 }],
  [/dock|ferry/i, { gemini: "Algenib", female: false, pitch: 0.92, rate: 0.98 }],
];

export function personaFor(name: string, role: string): VoicePersona {
  const byName = PERSONAS[name];
  if (byName) return byName;
  for (const [pattern, persona] of ROLE_PERSONAS) {
    if (pattern.test(role) || pattern.test(name)) return persona;
  }
  // Stable hash so an unnamed citizen keeps the same voice every time.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const pool = Object.values(PERSONAS);
  return pool[Math.abs(hash) % pool.length];
}

// Ambient one-liners citizens call out as you pass — the city talking
// without a panel. Keyed by role keywords, generic set as fallback.
const BARKS: Array<[RegExp, string[]]> = [
  [/barista|cafe|café/i, ["Coffee's hot if you are.", "Cafe Nova — best seat's by the window.", "Espresso machine's singing today."]],
  [/teller|bank/i, ["Bank's open — window two is free.", "Savings, checking, we do it all.", "Keep your PIN close, friend."]],
  [/attendant|gas|fuel|charge/i, ["Tank low? Pull up to a pump.", "Full service — I got you.", "Electric? Chargers are round the side."]],
  [/officer|police|cop/i, ["Keep it moving, citizen.", "Slow down near the plaza.", "Everything quiet on this beat."]],
  [/driver|operator|conductor/i, ["Bus leaves on the minute — hop in.", "Mind the doors.", "Next stop, wherever you need."]],
  [/shop|vendor|market|clerk|cashier/i, ["New stock just landed.", "Everything's City Sol here.", "Gold suit's the best seller."]],
  [/dock|ferry/i, ["Ferry's free — just hop on.", "Tide's perfect today.", "States are a boat ride away."]],
];

const GENERIC_BARKS = [
  "Beautiful day in OrbitX City.",
  "Hey — good to see you out.",
  "The city is LIVE — can you feel it?",
  "This city's really coming alive.",
  "Watch the traffic — drivers here are wild.",
  "Fountain at sunset. Trust me.",
];

export function barkLineFor(name: string, role: string, seed: number, tod: TimeOfDayName = "day"): string {
  const working = WORKING_BARKS[name];
  if (working) {
    const lines = working[tod] ?? working.day;
    return lines[Math.abs(seed) % lines.length];
  }
  for (const [pattern, lines] of BARKS) {
    if (pattern.test(role) || pattern.test(name)) return lines[Math.abs(seed) % lines.length];
  }
  return GENERIC_BARKS[Math.abs(seed) % GENERIC_BARKS.length];
}

// ---- Working-NPC dialogue depth ---------------------------------------
// The ten citizens with real posts get their own ambient barks — two
// per time of day (the game's day / sunset / night), so the city
// sounds different as the light changes — plus a daily rumor each:
// seeded per NPC + date by the caller, hinting at real things to do.
export type TimeOfDayName = "day" | "sunset" | "night";

const WORKING_BARKS: Record<string, Record<TimeOfDayName, string[]>> = {
  Ada: {
    day: ["Window two's free — no line today.", "Books balanced by noon, that's the rule."],
    sunset: ["Last deposits before the light goes.", "Vault checks at sundown. Every sundown."],
    night: ["Night ledger's quieter. I like it.", "Bank never really sleeps, friend."],
  },
  Milo: {
    day: ["Fresh stock on aisle two.", "Morning rush cleaned out the fruit again."],
    sunset: ["Snack shelf's getting low — right on schedule.", "Dinner crowd's coming. I can feel it."],
    night: ["Night crowd cleans out the snacks by nine. Watch.", "Closing soon — grab what you need."],
  },
  Jax: {
    day: ["Motors is open — bring me something broken.", "Check your tank before the long runs."],
    sunset: ["Last spray of the day going on soon.", "Golden hour makes every paint look good."],
    night: ["Shop lights stay on for the night owls.", "Hover rig hums different at night."],
  },
  Sal: {
    day: ["Crates came in at dawn — all sorted.", "Ferry's running clean today."],
    sunset: ["Harbor at sunset. Best office in the city.", "Last boats coming in with the light."],
    night: ["Dock's quiet. Just the water and me.", "Night tide's a working tide."],
  },
  Zed: {
    day: ["Setting up early pays off later.", "Market wakes up slow, spends fast."],
    sunset: ["My stall's the warm one — follow the lights.", "Sunset crowd spends best. Pia taught me that."],
    night: ["Night Market's in full swing now.", "Last deals of the night — haggle me."],
  },
  Lux: {
    day: ["Cabinets are warm. Records are waiting.", "Felix was in early. Set the bar again."],
    sunset: ["Arcade glows better as it gets dark.", "Reflex light's calling your name."],
    night: ["Night scores count double. Not really. Still.", "High-score board never sleeps."],
  },
  Park: {
    day: ["Plaza beat's quiet. Keep it that way.", "Slow down near the plaza, friend."],
    sunset: ["Evening patrol — headlights on, speeds down.", "Sunset brings the joyriders out. I'm watching."],
    night: ["Night beat's mine. All quiet so far.", "Stars are out. The wrong kind gets you mine."],
  },
  Gus: {
    day: ["Route's half done by mid-morning.", "Parcels wait for nobody. Neither do I."],
    sunset: ["Last run of the day — bank row and back.", "Golden light, full bag. Good day."],
    night: ["Night mail's mostly mysteries.", "Every door in this city. I know them all."],
  },
  Pip: {
    day: ["Pumps are live — pull under the canopy.", "Full service, all day. I got you."],
    sunset: ["Road-trip hour. Top them off, people.", "Sunset at the pumps — prettiest shift."],
    night: ["Night drivers run it dry. Ask me how I know.", "Canopy lights on for the night crowd."],
  },
  Dom: {
    day: ["Ring's open. Sal's waiting when you are.", "Train hard or watch — both welcome."],
    sunset: ["Evening card's the real card.", "Bruno warms up at sundown. Scary sight."],
    night: ["Champions are made after dark.", "Belt doesn't sleep. Neither does Bruno."],
  },
};

// Daily rumors — one per NPC per day (caller seeds by name + date).
// Every line points at something real in the game.
const RUMORS: Record<string, string[]> = {
  Ada: [
    "Heard the vault crew talking — somebody's been eyeing my bank. The heist crews plan in the Jobs panel, they say.",
    "A teller's secret: the Modes board in Jobs pays better than half the shifts in this city.",
  ],
  Milo: [
    "Word is Zed pays top City Sol for a driver who can handle a marked car. Jobs panel — Hijack, they call it.",
    "Somebody's always short a delivery driver. The board in the Jobs panel never stops humming.",
  ],
  Jax: [
    "Bring me a hijack story sometime — those marked cars? I prep half of them. Don't tell Park.",
    "Fresh paint hides a lot of history. The paint shop's mine, if a car ever needs to look… different.",
  ],
  Sal: [
    "Dock talk: the harbor hideout's seen more heist loot than the vault ever held. Allegedly.",
    "Ferry's free, friend — but the real money runs on four wheels and a wanted level.",
  ],
  Zed: [
    "Between us? My buyer's always looking for a wheelman. Hijack Mode — Jobs panel. Tell them Zed sent you.",
    "Heist money spends the same as honest money at my stall. Better stories, though.",
  ],
  Lux: [
    "The checkpoint trials pay medals, but the street whispers say Hijack runs pay better per minute.",
    "Felix set a trial record again. The trials board's in Jobs — go humble him.",
  ],
  Park: [
    "Department memo says heist crews are casing the bank. If I catch one, the fine's the least of it.",
    "We've got a pool on who brings in the next hijack artist. Do not make it you.",
  ],
  Gus: [
    "I deliver to every door — including a certain hideout the heist crews use. Mum's the word.",
    "Parcels, packages… the taxi board's the same work with better tips, if you drive.",
  ],
  Pip: [
    "Hijack crews top off here before a run. Full tank, full stars, full payout — that's the recipe.",
    "Limp mode mid-escape is a sad way to meet Park. Keep the tank honest, friend.",
  ],
  Dom: [
    "Fighters talk — the Champion's Circuit made half the gym try Hijack runs for training money.",
    "You want real progression? Citizen Rank climbs fastest on story and modes. Ask anyone.",
  ],
};

const GENERIC_RUMORS = [
  "Heard the Trading Floor in the Mega Mall never closes. Real trades, in a game. Wild times.",
  "Somebody said the weekly quests pay the big City Sol. Jobs panel, top of the list.",
  "Photo Mode from the phone — people are making their own wallpapers now.",
];

export function rumorLineFor(name: string, seed: number): string {
  const lines = RUMORS[name] ?? GENERIC_RUMORS;
  return lines[Math.abs(seed) % lines.length];
}

// Reaction barks — fear when the heat is on, witnesses after a crime.
const SCARED_BARKS = [
  "Whoa — easy, easy! I'm not looking!",
  "Stars?! Nope — I saw nothing!",
  "Backing up — backing WAY up!",
  "Park! PARK! Over here!",
];

export function scaredBarkFor(name: string, seed: number): string {
  if (name === "Park") return "I see those stars, friend. Ditch the heat or pay the fine — your call.";
  return SCARED_BARKS[Math.abs(seed) % SCARED_BARKS.length];
}

const WITNESS_BANK_BARKS = [
  "Someone just hit the bank!",
  "The vault — they went for the vault!",
  "Call Park! The bank's been robbed!",
];

const WITNESS_BARKS = [
  "Hey! That till was just robbed!",
  "I saw that! Somebody call Park!",
  "Right in front of me — unbelievable!",
];

export function witnessBarkFor(kind: "bank" | "crime", seed: number): string {
  const lines = kind === "bank" ? WITNESS_BANK_BARKS : WITNESS_BARKS;
  return lines[Math.abs(seed) % lines.length];
}

// Talk greetings that replace a working NPC's first line: a warm one
// after you finished their favor today, otherwise a nod to your
// Citizen Rank once you've made a name (Hustler+), with a distinct
// line for a City Legend.
const WARM_GREETINGS: Record<string, string> = {
  Ada: "There's my favourite customer. That favour you ran? The books noticed. So did I.",
  Milo: "Hey — the shelf-stocker supreme returns. Seriously, you saved my shift today.",
  Jax: "Any friend of the bay's a friend of mine. You did me solid today — I don't forget.",
  Sal: "Harbour royalty, right here. That run you did for me? Dock crew's still talking.",
  Zed: "My favourite set of wheels. You move product like nobody in this market.",
  Lux: "The high-score heart returns. What you did for the arcade? Legendary behaviour.",
  Park: "Officer — citizen. What you did today? That's how a beat stays friendly. Appreciated.",
  Gus: "The only other person who knows this route like I do. Thanks for today.",
  Pip: "Top-off's on me next time. Not really — but the thanks is real. You came through.",
  Dom: "Champion's hands, champion's heart. The gym remembers who shows up.",
};

export function warmGreetingFor(name: string): string | null {
  return WARM_GREETINGS[name] ?? null;
}

const HUSTLER_GREETINGS = [
  "Morning, big shot — word travels in this city.",
  "There's the hustle himself. City's noticing you.",
  "Well, well — the rising name. What can I do for you?",
];

const LEGEND_GREETINGS = [
  "The City Legend, in my little corner of it. Honoured.",
  "Careful, everyone — royalty just walked up.",
  "They tell stories about you at closing time. Good ones.",
];

export function rankGreetingFor(rank: number, seed: number): string | null {
  if (rank >= 10) return LEGEND_GREETINGS[Math.abs(seed) % LEGEND_GREETINGS.length];
  if (rank >= 5) return HUSTLER_GREETINGS[Math.abs(seed) % HUSTLER_GREETINGS.length];
  return null;
}

// --- enable flag (persisted) ---
const ENABLED_KEY = "orbitx-city-npc-voice-v1";
let enabledCache: boolean | null = null;

export function npcVoiceEnabled(): boolean {
  if (enabledCache === null) {
    try {
      enabledCache = localStorage.getItem(ENABLED_KEY) !== "off";
    } catch {
      enabledCache = true;
    }
  }
  return enabledCache;
}

export function setNpcVoiceEnabled(on: boolean): void {
  enabledCache = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
  if (!on) stopNpcVoice();
}

// --- levels: NPC voices were full-blast (volume unset = 1.0 on both
// engines) with no distance falloff, so a citizen 30u away shouted as
// loud as one next to you. Dialogue (a conversation the player opened)
// stays louder than a passing bark; both fade with distance. ---
export const NPC_VOICE_TALK_BASE = 0.45;
export const NPC_VOICE_BARK_BASE = 0.3;
/** Full volume inside this range (units from the player). */
export const NPC_VOICE_FULL_RANGE = 6;
/** Falloff reaches 10% of base here. */
export const NPC_VOICE_FADE_END = 30;
/** Silent at and beyond this distance. */
export const NPC_VOICE_SILENT_RANGE = 40;
/** Minimum gap between NPC voice starts (barks only — talk always speaks). */
export const NPC_VOICE_MIN_GAP_MS = 1200;

/**
 * Distance falloff factor: 1.0 within NPC_VOICE_FULL_RANGE, linear down
 * to 0.1 at NPC_VOICE_FADE_END, then linear to 0 at
 * NPC_VOICE_SILENT_RANGE. Pure — safe to unit-test in node.
 */
export function npcVoiceFalloff(distance: number): number {
  const d = Math.max(0, distance);
  if (d <= NPC_VOICE_FULL_RANGE) return 1;
  if (d >= NPC_VOICE_SILENT_RANGE) return 0;
  if (d <= NPC_VOICE_FADE_END) {
    return 1 - 0.9 * ((d - NPC_VOICE_FULL_RANGE) / (NPC_VOICE_FADE_END - NPC_VOICE_FULL_RANGE));
  }
  return 0.1 * ((NPC_VOICE_SILENT_RANGE - d) / (NPC_VOICE_SILENT_RANGE - NPC_VOICE_FADE_END));
}

export type NpcVoiceKind = "talk" | "bark";

/** Effective volume for a line of this kind at this distance. */
export function npcVoiceVolume(kind: NpcVoiceKind, distance = 0): number {
  const base = kind === "bark" ? NPC_VOICE_BARK_BASE : NPC_VOICE_TALK_BASE;
  return base * npcVoiceFalloff(distance);
}

export interface SpeakNpcOptions {
  /** "talk" (dialogue, default — face-to-face) or "bark" (ambient / witness / scared). */
  kind?: NpcVoiceKind;
  /** Distance from the player in world units; default 0 (right next to you). */
  distance?: number;
}

// --- playback state ---
let currentAudio: HTMLAudioElement | null = null;
let serverState: "unknown" | "ready" | "off" = "unknown";
const audioCache = new Map<string, string>();
/** Bumps on every stopCurrent() so a deferred speak from a superseded
 * line can tell it lost the race and stay silent. */
let voiceToken = 0;
/** When the last NPC voice started (barks respect a minimum gap). */
let lastVoiceStartAt = 0;
/** Until when a talk/dialogue line is (estimated to be) still playing —
 * barks wait; dialogue wins. */
let dialogueUntilMs = 0;

function stopCurrent(): void {
  voiceToken++;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no synth */
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* already stopped */
    }
    currentAudio = null;
  }
}

export function stopNpcVoice(): void {
  stopCurrent();
}

function pickLocalVoice(persona: VoicePersona): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis?.getVoices() ?? [];
    if (!voices.length) return null;
    const google = voices.filter((v) => /google/i.test(v.name) && /^en[-_]/i.test(v.lang));
    const pool = google.length ? google : voices.filter((v) => /^en[-_]/i.test(v.lang));
    if (!pool.length) return null;
    const femaleHints = /female|zira|aria|samantha|jenny|aoede|kore/i;
    const maleHints = /male|david|guy|daniel|christopher/i;
    const hinted = pool.find((v) => (persona.female ? femaleHints : maleHints).test(v.name));
    return hinted ?? pool[0];
  } catch {
    return null;
  }
}

/**
 * Local speech. Deferred a tick after the cancel in stopCurrent():
 * speechSynthesis.cancel() is async in Chrome, and a speak() issued
 * in the same tick can be dropped — or the cancel can kill the new
 * utterance. The token guard keeps a superseded line from speaking
 * over the line that replaced it.
 */
function speakLocal(text: string, persona: VoicePersona, volume: number, token: number): void {
  window.setTimeout(() => {
    if (token !== voiceToken) return; // superseded — stay silent
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickLocalVoice(persona);
      if (voice) utterance.voice = voice;
      utterance.pitch = persona.pitch;
      utterance.rate = persona.rate;
      utterance.volume = volume;
      synth.speak(utterance);
    } catch {
      /* speech unavailable — the line is still on screen */
    }
  }, 50);
}

/** Rough spoken length for a line, so barks know how long dialogue holds the mic. */
function estimateDurationMs(text: string, rate: number): number {
  const charsPerSec = 14 * Math.max(0.5, rate);
  return Math.min(12000, Math.max(1500, (text.length / charsPerSec) * 1000));
}

async function fetchGeminiAudio(text: string, persona: VoicePersona): Promise<string | null> {
  const key = `${persona.gemini}:${text}`;
  const cached = audioCache.get(key);
  if (cached) return cached;
  if (serverState === "off") return null;
  try {
    const token = localStorage.getItem("orbitx-token") || "";
    const response = await fetch("/api/city", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ op: "tts", text, voice: persona.gemini }),
    });
    const data = (await response.json()) as { ok?: boolean; audio?: string };
    if (!response.ok || !data.ok || !data.audio) {
      serverState = "off";
      return null;
    }
    serverState = "ready";
    const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    audioCache.set(key, url);
    return url;
  } catch {
    serverState = "off";
    return null;
  }
}

/**
 * Speak one scripted line as this NPC. Plays from the Gemini cache when
 * the audio is already warm; otherwise speaks locally right away and
 * warms the Gemini audio for the next time the line is heard.
 *
 * Levels: talk lines play at NPC_VOICE_TALK_BASE (0.45), barks at
 * NPC_VOICE_BARK_BASE (0.3), both scaled by distance falloff (full
 * within 6u, 10% of base at 30u, silent beyond 40u). A line too far to
 * hear is skipped entirely — it never cuts off the voice playing now.
 *
 * Pacing: barks wait at least NPC_VOICE_MIN_GAP_MS (1.2s) after the
 * previous voice start, and never start while a talk/dialogue line is
 * (estimated to be) playing — dialogue wins, the bark is dropped (its
 * text still shows on screen). Talk lines always speak immediately
 * and cut off whatever was playing.
 */
export function speakNpc(name: string, role: string, text: string, opts: SpeakNpcOptions = {}): void {
  if (!npcVoiceEnabled() || !text.trim()) return;
  const kind: NpcVoiceKind = opts.kind ?? "talk";
  const distance = Math.max(0, opts.distance ?? 0);
  const volume = npcVoiceVolume(kind, distance);
  if (volume <= 0) return; // too far to hear — don't interrupt anything
  const now = Date.now();
  if (kind === "bark") {
    if (now < dialogueUntilMs) return; // dialogue wins; bark waits (dropped)
    if (now - lastVoiceStartAt < NPC_VOICE_MIN_GAP_MS) return;
  }
  const persona = personaFor(name, role);
  stopCurrent();
  const token = voiceToken;
  lastVoiceStartAt = now;
  if (kind === "talk") dialogueUntilMs = now + estimateDurationMs(text, persona.rate);
  const key = `${persona.gemini}:${text}`;
  const cached = audioCache.get(key);
  if (cached && serverState !== "off") {
    const audio = new Audio(cached);
    audio.volume = volume;
    currentAudio = audio;
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null;
    };
    // Guard the fallback with the token: if this line was superseded
    // while play() was pending, the local fallback must stay silent.
    void audio.play().catch(() => {
      if (token === voiceToken) speakLocal(text, persona, volume, token);
    });
    return;
  }
  speakLocal(text, persona, volume, token);
  if (serverState !== "off") void fetchGeminiAudio(text, persona);
}

/** Warm Gemini audio for a set of lines (e.g. when a talk opens). */
export function prefetchNpcLines(name: string, role: string, lines: string[]): void {
  if (!npcVoiceEnabled() || serverState === "off") return;
  const persona = personaFor(name, role);
  for (const line of lines.slice(0, 4)) void fetchGeminiAudio(line, persona);
}
