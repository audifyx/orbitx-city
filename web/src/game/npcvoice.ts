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
  "Dec 5th can't come soon enough.",
  "This city's really coming alive.",
  "Watch the traffic — drivers here are wild.",
  "Fountain at sunset. Trust me.",
];

export function barkLineFor(name: string, role: string, seed: number): string {
  for (const [pattern, lines] of BARKS) {
    if (pattern.test(role) || pattern.test(name)) return lines[Math.abs(seed) % lines.length];
  }
  return GENERIC_BARKS[Math.abs(seed) % GENERIC_BARKS.length];
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

// --- playback state ---
let currentAudio: HTMLAudioElement | null = null;
let serverState: "unknown" | "ready" | "off" = "unknown";
const audioCache = new Map<string, string>();

function stopCurrent(): void {
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

function speakLocal(text: string, persona: VoicePersona): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickLocalVoice(persona);
    if (voice) utterance.voice = voice;
    utterance.pitch = persona.pitch;
    utterance.rate = persona.rate;
    synth.speak(utterance);
  } catch {
    /* speech unavailable — the line is still on screen */
  }
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
 */
export function speakNpc(name: string, role: string, text: string): void {
  if (!npcVoiceEnabled() || !text.trim()) return;
  const persona = personaFor(name, role);
  stopCurrent();
  const key = `${persona.gemini}:${text}`;
  const cached = audioCache.get(key);
  if (cached && serverState !== "off") {
    const audio = new Audio(cached);
    currentAudio = audio;
    void audio.play().catch(() => speakLocal(text, persona));
    return;
  }
  speakLocal(text, persona);
  if (serverState !== "off") void fetchGeminiAudio(text, persona);
}

/** Warm Gemini audio for a set of lines (e.g. when a talk opens). */
export function prefetchNpcLines(name: string, role: string, lines: string[]): void {
  if (!npcVoiceEnabled() || serverState === "off") return;
  const persona = personaFor(name, role);
  for (const line of lines.slice(0, 4)) void fetchGeminiAudio(line, persona);
}
