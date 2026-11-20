// ---------------------------------------------------------------------------
// OrbitX City — ORBITX OS: the in-game phone.
// ---------------------------------------------------------------------------
// A GTA-style virtual phone. Game-life apps (Messages, Contacts, Map,
// Bank, Jobs, Music, Camera, Burner, Settings, People) are native and
// read REAL game state — the snapshot, the radio, the NPC cast, the
// fuel network. The OrbitX platform apps (OrbitX, DEX, Hub DEX,
// Scanner, Social, Wallet) embed the live orbitx.world full-bleed
// inside the phone frame — no browser chrome, the phone IS the chrome.
// Platform auth is a different Supabase from the game, so the player
// signs into OrbitX inside the phone once, like a real app.
//
// The phone is a panel ("phone") like any other: opening it pauses the
// game (App's open()), so the player never drives or walks with it out.
// It stays mounted after the first open so platform iframes keep their
// session and in-app place across opens.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { PanelName, RadioTrack, Runtime, ShopTab, Snap } from "./game/runtime";
import { CHARGE_POINTS, GAS_STATIONS, NPC_LINES } from "./game/content";
import { PROXIMITY_RANGE, VOICE_FILTERS } from "./game/voice";
import { speakNpc } from "./game/npcvoice";
import {
  loadGallery,
  loadPhonePrefs,
  loadThreads,
  markThreadRead,
  appendPhoneMessage,
  removeGalleryShot,
  savePhonePrefs,
  subscribePhoneStore,
  totalUnread,
  type GalleryShot,
  type PhonePrefs,
  type PhoneThread,
} from "./phoneStore";

export interface PhoneRadio {
  tracks: RadioTrack[];
  playingId: string | null;
  msg: string;
  onPlay: (track: RadioTrack) => void;
  onStop: () => void;
  onLoad: () => void;
}

export interface PhoneOSProps {
  open: boolean;
  snap: Snap;
  rt: Runtime | null;
  onClose: () => void;
  onOpenPanel: (name: PanelName | "offices") => void;
  onOpenShop: (tab: ShopTab) => void;
  socialNode: ReactNode;
  radio: PhoneRadio;
  onPhotoMode: () => void;
  triggerHaptic: (kind: "tap" | "success" | "error") => void;
}

type AppId =
  | "home"
  | "messages"
  | "contacts"
  | "map"
  | "bank"
  | "jobs"
  | "music"
  | "camera"
  | "voice"
  | "burner"
  | "settings"
  | "people"
  | "shop"
  | "grocery"
  | "arcade"
  | "leaders"
  | "ads"
  | "players"
  | "profile"
  | "alerts"
  | "offices"
  | "myprops"
  | "transport"
  | "multiverse"
  | "events"
  | "orbitx"
  | "dex"
  | "hubdex"
  | "scanner"
  | "social"
  | "wallet";

// Platform apps: the real orbitx.world, embedded live. Social and
// Wallet open the platform OS itself (its home carries both).
const WEB_APPS: Partial<Record<AppId, { name: string; url: string }>> = {
  orbitx: { name: "OrbitX", url: "https://orbitx.world/app?embed=phone" },
  dex: { name: "DEX", url: "https://orbitx.world/ORBITX_DEX/?embed=phone" },
  hubdex: { name: "Hub DEX", url: "https://orbitx.world/hub-dex/?embed=phone" },
  scanner: { name: "Scanner", url: "https://orbitx.world/scanner?embed=phone" },
  social: { name: "Social", url: "https://orbitx.world/app?embed=phone" },
  wallet: { name: "Wallet", url: "https://orbitx.world/app?embed=phone" },
};

// Messages: the game's real global chat lives in the phone as a pinned
// "City Chat" thread (same snapshot lines + sendChat path as the Chat
// panel) — it is not a phone-store thread, so it carries this fixed id.
const CITY_CHAT_ID = "citychat";

const CONTACT_NAMES = ["Ada", "Milo", "Jax", "Sal", "Zed", "Lux", "Park", "Gus", "Comet", "Bex", "Pip"];
// The Places the old Phone panel listed — same ids, now the Map app.
const PLACE_IDS = ["shop", "cafe", "hall", "bank", "garage", "carshop", "trading", "arcade", "market", "dock", "project-0"];
// Mirrors ROB_TARGETS in runtime.ts (display flavor for the Burner).
const ROB_FLAVOR = [
  { name: "Ada", label: "Rob the bank", stars: 2, min: 150, max: 300 },
  { name: "Sol", label: "Rob the shop", stars: 1, min: 60, max: 120 },
  { name: "Milo", label: "Rob the grocery", stars: 1, min: 50, max: 100 },
];

const WALLPAPERS: Record<string, { name: string; css: string }> = {
  gold: { name: "Gold dusk", css: "linear-gradient(160deg, #241a05 0%, #0b0b0f 55%, #171106 100%)" },
  night: { name: "Night city", css: "linear-gradient(160deg, #0d1830 0%, #05070d 60%, #0a1224 100%)" },
  sunset: { name: "Sunset strip", css: "linear-gradient(160deg, #3a1c07 0%, #120a06 55%, #2b1408 100%)" },
  carbon: { name: "Carbon", css: "linear-gradient(160deg, #17181d 0%, #0a0a0c 60%, #101116 100%)" },
};

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtWhen(at: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function fmtMs(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 100) / 10);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// Status-bar glyphs (signal / wifi / battery), iOS-style inline SVG.
function StatusGlyphs() {
  return (
    <span className="ph-glyphs" aria-hidden="true">
      <svg viewBox="0 0 18 12" width="17" height="11" fill="currentColor">
        <rect x="0" y="7.5" width="3" height="4.5" rx="0.9" />
        <rect x="4.6" y="5.2" width="3" height="6.8" rx="0.9" />
        <rect x="9.2" y="2.8" width="3" height="9.2" rx="0.9" />
        <rect x="13.8" y="0.4" width="3" height="11.6" rx="0.9" opacity="0.35" />
      </svg>
      <svg viewBox="0 0 16 12" width="16" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M1.8 4.4a10.5 10.5 0 0 1 12.4 0" />
        <path d="M4.3 7.1a6.6 6.6 0 0 1 7.4 0" />
        <circle cx="8" cy="9.9" r="1.15" fill="currentColor" stroke="none" />
      </svg>
      <svg viewBox="0 0 27 12" width="25" height="11">
        <rect x="1" y="1.4" width="21" height="9.2" rx="2.8" fill="none" stroke="currentColor" opacity="0.45" />
        <rect x="3" y="3.2" width="13.5" height="5.6" rx="1.4" fill="currentColor" />
        <path d="M24.6 4.2v3.6a2.1 2.1 0 0 0 0-3.6z" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}

// --- Icons (inline SVG, stroke currentColor — no emoji) ----------------------

function I({ d, extra }: { d: string; extra?: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra}
    </svg>
  );
}
const ICONS: Record<string, ReactNode> = {
  messages: <I d="M4 5h16v10.5H10l-4.5 3.5V15H4z" />,
  chat: <I d="M9 4.5h10.5V13H13l-3.5 3V13H9z" extra={<path d="M4.5 8.5v7L8 12.7" />} />,
  contacts: <I d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M4.5 20a7.5 7.5 0 0 1 15 0" />,
  map: <I d="M12 21s-6.5-5.6-6.5-10.4A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.6C18.5 15.4 12 21 12 21z" extra={<circle cx="12" cy="10.5" r="2.2" />} />,
  bank: <I d="M3.5 9.5 12 4l8.5 5.5 M5 10v8 M9.7 10v8 M14.3 10v8 M19 10v8 M3.5 20.5h17" />,
  jobs: <I d="M4 8.5h16V20H4z M9 8.5V6a3 3 0 0 1 3-3 3 3 0 0 1 3 3v2.5 M4 13h16" />,
  music: <I d="M9 18.5V6l10-2v11.5" extra={<><circle cx="6.5" cy="18.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></>} />,
  camera: <I d="M4 8h3l2-2.5h6L17 8h3v11H4z" extra={<circle cx="12" cy="13" r="3.2" />} />,
  voice: <I d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21" />,
  burner: <I d="M12 3.5c.8 3-1.8 4.6-2.9 6.2C8 11.4 7.5 12.8 7.5 14.5a4.5 4.5 0 0 0 9 0c0-1-.4-1.9-.9-2.8-.9 1-1.5 1.4-1.5 1.4.3-2.7-.6-5.7-2.1-7.6z" />,
  settings: <I d="M5 7h6 M15 7h4 M5 12h2 M11 12h8 M5 17h10 M19 17h0" extra={<><circle cx="13" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>} />,
  people: <I d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11z M2.8 19.5a6.2 6.2 0 0 1 12.4 0 M16 5.2a3.2 3.2 0 0 1 0 6 M17.5 13.6a6.2 6.2 0 0 1 3.7 5.9" />,
  shop: <I d="M5 8h14l-1.1 11.2a2 2 0 0 1-2 1.8H8.1a2 2 0 0 1-2-1.8L5 8z M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7" />,
  grocery: <I d="M3 4h2.3l2.2 11.1a1.9 1.9 0 0 0 1.9 1.5h7.7a1.9 1.9 0 0 0 1.9-1.5L20.5 8H6.1" extra={<><circle cx="10" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></>} />,
  arcade: <I d="M7.5 8h9A4.8 4.8 0 0 1 21.3 12.8v3A2.9 2.9 0 0 1 16.6 18l-1.9-2h-5.4l-1.9 2a2.9 2.9 0 0 1-4.7-2.2v-3A4.8 4.8 0 0 1 7.5 8z" extra={<><path d="M8 11v3 M6.5 12.5h3" /><circle cx="15.8" cy="11.8" r="0.7" fill="currentColor" stroke="none" /><circle cx="17.8" cy="13.8" r="0.7" fill="currentColor" stroke="none" /></>} />,
  leaders: <I d="M7.5 4h9v4.8a4.5 4.5 0 0 1-9 0z M7.5 5.8H4.6a3 3 0 0 0 2.9 3.2 M16.5 5.8h2.9a3 3 0 0 1-2.9 3.2 M12 13.3V16 M8.8 20h6.4 M12 16c-1.5 0-2.3 1.4-2.6 4h5.2c-.3-2.6-1.1-4-2.6-4z" />,
  ads: <I d="M4 4.5h16V14H4z M12 14v6.5 M8 20.5h8" extra={<path d="M7 8h6.5 M7 11h4" />} />,
  players: <I d="M9 6.5h10.5 M9 12h10.5 M9 17.5h10.5" extra={<><circle cx="5" cy="6.5" r="1.6" /><circle cx="5" cy="12" r="1.6" /><circle cx="5" cy="17.5" r="1.6" /></>} />,
  profile: <I d="M4 5.5h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" extra={<><circle cx="8.6" cy="10.8" r="1.9" /><path d="M5.8 16.6a2.9 2.9 0 0 1 5.6 0 M14.5 9.5h4 M14.5 13h4" /></>} />,
  alerts: <I d="M6 16.5v-5.3a6 6 0 0 1 12 0v5.3l1.1 2.7H4.9z M10.1 21a2.1 2.1 0 0 0 3.8 0" />,
  offices: <I d="M5.5 20.5v-15A1.5 1.5 0 0 1 7 4h6a1.5 1.5 0 0 1 1.5 1.5v15 M14.5 9.5H18A1.5 1.5 0 0 1 19.5 11v9.5 M3 20.5h18" extra={<path d="M8.2 8h3.6 M8.2 11.5h3.6 M8.2 15h3.6" />} />,
  myprops: <I d="M4 11.2 12 4l8 7.2 M6.2 9.3V20h11.6V9.3 M10.3 20v-4.8h3.4V20" />,
  transport: <I d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15.5V6A1.5 1.5 0 0 1 5 4.5z M3.5 11h17 M7.5 20v-3 M16.5 20v-3" extra={<><circle cx="7.5" cy="14" r="0.7" fill="currentColor" stroke="none" /><circle cx="16.5" cy="14" r="0.7" fill="currentColor" stroke="none" /></>} />,
  multiverse: <I d="M3.5 12h17" extra={<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5c2.5 2.4 3.8 5.2 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.2-3.8-8.5S9.5 5.9 12 3.5z" /></>} />,
  events: <I d="M5 6.5h14V20H5z M5 10.5h14 M8.5 4v4 M15.5 4v4" extra={<path d="m12 13.2.9 1.9 2.1.3-1.5 1.5.3 2.1-1.8-1-1.8 1 .3-2.1-1.5-1.5 2.1-.3z" />} />,
  orbitx: <I d="" extra={<><circle cx="12" cy="12" r="3.4" /><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(-18 12 12)" /></>} />,
  dex: <I d="M7 4 3.5 7.5 7 11 M3.5 7.5H17 M17 13l3.5 3.5L17 20 M20.5 16.5H7" />,
  hubdex: <I d="M4 19.5h16 M6 16v-5 M10.5 16V8 M15 16v-3.5 M19.5 16V6.5" />,
  scanner: <I d="M12 3v3 M12 18v3 M3 12h3 M18 12h3" extra={<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" strokeDasharray="4 5" /></>} />,
  social: <I d="M8 5h8a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z" extra={<path d="M8.5 10h7 M8.5 13.5h4.5" />} />,
  wallet: <I d="M3.5 7A2.5 2.5 0 0 1 6 4.5h12 M3.5 7v10A2.5 2.5 0 0 0 6 19.5h14.5v-11H6A2.5 2.5 0 0 1 3.5 7z" extra={<circle cx="16.8" cy="14" r="1.3" />} />,
};

// --- The phone -----------------------------------------------------------------

// Launcher apps: the old top-strip panels, one tap deeper. The app is a
// phone-styled front door — tap Open and the phone steps aside while the
// REAL panel opens, fully functional, exactly as it did from the strip
// (the v39 Jobs pattern). Shop/Grocery open the unified Shop on their
// tab; Profile goes through the runtime's own viewOwnProfile().
const LAUNCHERS: Partial<Record<AppId, { blurb: string; cta: string }>> = {
  shop: { blurb: "Clothes, cars, homes and more — the full OrbitX shop, paid in City Sol.", cta: "Open Shop" },
  grocery: { blurb: "Food and drink for hunger and stamina — the shop's grocery shelves.", cta: "Open Grocery" },
  arcade: { blurb: "The mini-games hub — coin flip, dice and the arcade floor.", cta: "Open Arcade" },
  leaders: { blurb: "Richest, top earners, biggest burners and the fastest racers.", cta: "Open Leaderboards" },
  ads: { blurb: "Book a billboard — your art on the city boards, paid in ORBITX and burned.", cta: "Open Ads" },
  players: { blurb: "Everyone in the city right now — profiles, parties and invites.", cta: "Open Players" },
  profile: { blurb: "Your city profile — homes, cars, missions and stats.", cta: "Open Profile" },
  alerts: { blurb: "Notifications and invites — friend requests land here.", cta: "Open Alerts" },
  offices: { blurb: "OrbitX Tower office suites — lease an office, paid in City Sol.", cta: "Open Offices" },
  myprops: { blurb: "Your properties — the homes and lots you own across the city.", cta: "Open My Props" },
  transport: { blurb: "Bus, train, ferry and rides — every way around the city.", cta: "Open Transport" },
  multiverse: { blurb: "Travel between universes — same city, different crowds.", cta: "Open Multiverse" },
  events: { blurb: "City events — what's on at the plaza and around town.", cta: "Open Events" },
};

export default function PhoneOS(props: PhoneOSProps) {
  const { open, snap, rt, onClose, onOpenPanel, onOpenShop, socialNode, radio, onPhotoMode, triggerHaptic } = props;
  const [locked, setLocked] = useState(true);
  const [app, setApp] = useState<AppId>("home");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<PhoneThread[]>(() => loadThreads());
  const [gallery, setGallery] = useState<GalleryShot[]>(() => loadGallery());
  const [prefs, setPrefs] = useState<PhonePrefs>(() => loadPhonePrefs());
  const [viewingShot, setViewingShot] = useState<GalleryShot | null>(null);
  const [toast, setToast] = useState("");
  const [burnerMsg, setBurnerMsg] = useState("");
  const [chatText, setChatText] = useState("");
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const [mountedUrls, setMountedUrls] = useState<string[]>([]);
  const [webLoaded, setWebLoaded] = useState<Record<string, boolean>>({});
  const [webError, setWebError] = useState<Record<string, boolean>>({});
  const [webKeys, setWebKeys] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => new Date());
  const webTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const wasOpen = useRef(false);
  const musicLoaded = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unread = totalUnread(threads);
  const activeWeb = WEB_APPS[app];

  const showToast = (text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  };

  // Lock on every open; refresh the device data.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setLocked(true);
      setThreads(loadThreads());
      setGallery(loadGallery());
    }
    wasOpen.current = open;
  }, [open ]);

  // Live store updates (event texts landing while the phone is away,
  // photos captured in Photo Mode).
  useEffect(() => {
    return subscribePhoneStore(() => {
      setThreads(loadThreads());
      setGallery(loadGallery());
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  // Escape puts the phone away.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Opening a thread reads it. (City Chat is not a store thread — the
  // game chat has no unread tracking, so there is nothing to mark.)
  useEffect(() => {
    if (app === "messages" && threadId && threadId !== CITY_CHAT_ID) markThreadRead(threadId);
  }, [app, threadId]);

  // City Chat: keep the log pinned to the newest line while it's open.
  const cityChatOpen = app === "messages" && threadId === CITY_CHAT_ID;
  useEffect(() => {
    if (!cityChatOpen) return;
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cityChatOpen, snap.chat]);

  const sendCityChat = (event: FormEvent) => {
    event.preventDefault();
    if (!rt || !chatText.trim()) return;
    rt.sendChat(chatText, snap.chatScope);
    setChatText("");
  };

  // Music app loads the playlist once per phone session.
  useEffect(() => {
    if (app === "music" && !musicLoaded.current) {
      musicLoaded.current = true;
      radio.onLoad();
    }
  }, [app, radio]);

  const goHome = () => {
    setApp("home");
    setThreadId(null);
    setViewingShot(null);
    triggerHaptic("tap");
  };

  const openApp = (id: AppId) => {
    triggerHaptic("tap");
    setApp(id);
    const web = WEB_APPS[id];
    if (web && !mountedUrls.includes(web.url)) {
      setMountedUrls((urls) => [...urls, web.url]);
      startWebTimer(web.url);
    }
  };

  const startWebTimer = (url: string) => {
    if (webTimers.current[url]) clearTimeout(webTimers.current[url]);
    webTimers.current[url] = setTimeout(() => {
      setWebLoaded((loaded) => {
        if (!loaded[url]) setWebError((err) => ({ ...err, [url]: true }));
        return loaded;
      });
    }, 15000);
  };

  const retryWeb = (url: string) => {
    setWebError((err) => ({ ...err, [url]: false }));
    setWebLoaded((loaded) => ({ ...loaded, [url]: false }));
    setWebKeys((keys) => ({ ...keys, [url]: (keys[url] ?? 0) + 1 }));
    startWebTimer(url);
  };

  const updatePrefs = (next: PhonePrefs) => {
    setPrefs(next);
    savePhonePrefs(next);
  };

  const callNpc = (name: string) => {
    const info = NPC_LINES[name];
    if (!info) return;
    triggerHaptic("tap");
    speakNpc(name, info.role, info.lines[0]);
    appendPhoneMessage(name, info.lines[0]);
    showToast(`${name}: “${info.lines[0]}”`);
  };

  const deliverCar = () => {
    if (!rt) return;
    triggerHaptic("tap");
    const result = rt.deliverCar();
    showToast(result);
    if (result.startsWith("Jax is bringing")) {
      appendPhoneMessage("Jax", "On my way with your car — check the street.");
    }
  };

  const rideTo = (go: () => void) => {
    triggerHaptic("tap");
    go();
    onClose();
  };

  // Launcher apps: hand off to the real panel. Switching App's panel
  // (or the runtime's, for Profile) hides the phone on its own — the
  // phone stays mounted, so coming back is instant.
  const openLauncher = (id: AppId) => {
    triggerHaptic("tap");
    switch (id) {
      case "shop": onOpenShop("clothes"); break;
      case "grocery": onOpenShop("grocery"); break;
      case "profile": rt?.viewOwnProfile(); break;
      case "arcade": onOpenPanel("minigames"); break;
      case "leaders": onOpenPanel("leaders"); break;
      case "ads": onOpenPanel("ads"); break;
      case "players": onOpenPanel("players"); break;
      case "alerts": onOpenPanel("alerts"); break;
      case "offices": onOpenPanel("offices"); break;
      case "myprops": onOpenPanel("myprops"); break;
      case "transport": onOpenPanel("transport"); break;
      case "multiverse": onOpenPanel("multiverse"); break;
      case "events": onOpenPanel("events"); break;
      default: break;
    }
  };

  const launcherDetail = (id: AppId): string => {
    switch (id) {
      case "players": return `${snap.others + 1} in the city right now`;
      case "alerts": return snap.unreadAlerts > 0 ? `${snap.unreadAlerts} unread` : "All caught up";
      case "profile": return `${snap.name || "Guest"} · ${snap.balance.toLocaleString()} City Sol`;
      default: return "";
    }
  };

  const wallpaperCss = prefs.wallpaper === "shot" && prefs.wallpaperData
    ? undefined
    : (WALLPAPERS[prefs.wallpaper]?.css ?? WALLPAPERS.gold.css);
  const wallpaperImg = prefs.wallpaper === "shot" && prefs.wallpaperData ? prefs.wallpaperData : "";

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      const la = a.messages[a.messages.length - 1]?.at ?? 0;
      const lb = b.messages[b.messages.length - 1]?.at ?? 0;
      return lb - la;
    });
  }, [threads]);

  const activeThread = threadId ? threads.find((t) => t.id === threadId) ?? null : null;
  const lastChat = snap.chat[snap.chat.length - 1] ?? null;
  const playingTrack = radio.tracks.find((t) => t.id === radio.playingId) ?? null;
  const fine = snap.wanted > 0 ? Math.min(snap.balance, snap.wanted * 60) : 0;
  // Dynamic Island content: live context, most urgent first.
  const islandText = snap.wanted > 0
    ? "★".repeat(snap.wanted)
    : playingTrack
      ? playingTrack.name
      : snap.trial
        ? `${snap.trial.routeName} · ${fmtMs(snap.trial.timeMs)}`
        : "OrbitX OS";
  // Home widget's second line: the next daily quest, else a race best.
  const nextQuest = snap.dailies.find((d) => !d.done);
  const bestRoute = snap.raceRoutes.find((r) => r.best != null);
  const widgetLine = nextQuest
    ? `Daily · ${nextQuest.label} — ${nextQuest.have}/${nextQuest.need}`
    : bestRoute
      ? `${bestRoute.name} best · ${fmtMs(bestRoute.best ?? 0)}`
      : `${snap.name || "Guest"} · ${snap.server || "OrbitX City"}`;

  const APP_TITLES: Record<string, string> = {
    home: "OrbitX OS",
    messages: "Messages",
    contacts: "Contacts",
    map: "Map",
    bank: "Bank",
    jobs: "Jobs",
    music: "Music",
    camera: "Camera",
    voice: "Voice",
    burner: "Burner",
    settings: "Settings",
    people: "People",
    shop: "Shop",
    grocery: "Grocery",
    arcade: "Arcade",
    leaders: "Leaders",
    ads: "Ads",
    players: "Players",
    profile: "Profile",
    alerts: "Alerts",
    offices: "Offices",
    myprops: "My Props",
    transport: "Transport",
    multiverse: "Multiverse",
    events: "Events",
  };
  const appTitle = (id: AppId): string => {
    if (id === "messages" && threadId === CITY_CHAT_ID) return "City Chat";
    if (id === "messages" && activeThread) return activeThread.name;
    const web = WEB_APPS[id];
    if (web) return web.name;
    return APP_TITLES[id] ?? "OrbitX OS";
  };

  const tile = (id: AppId, label: string, badge = 0) => (
    <button key={id} type="button" className="ph-tile" onClick={() => openApp(id)}>
      <span className={`ph-icon ph-icon-${id}`}>{ICONS[id]}</span>
      <span className="ph-tile-label">{label}</span>
      {badge > 0 ? <span className="ph-badge">{badge}</span> : null}
    </button>
  );

  return (
    <div
      className="ph-overlay"
      style={open ? undefined : { display: "none" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ph-frame" data-accent={prefs.accent}>
        <div className="ph-screen">
          <div
            className="ph-wallpaper"
            style={wallpaperImg ? { backgroundImage: `url(${wallpaperImg})` } : { background: wallpaperCss }}
          />
          {/* Status bar */}
          <div className="ph-status">
            <span className="ph-clock">{fmtClock(now)}</span>
            <span className="ph-island"><span className="ph-island-text">{islandText}</span></span>
            <span className="ph-status-right">
              <StatusGlyphs />
            </span>
          </div>

          {/* Body: webviews stay mounted; native views swap above them. */}
          <div className="ph-body">
            {mountedUrls.map((url) => {
              const isActive = !locked && activeWeb?.url === url;
              return (
                <div key={url} className="ph-web" style={{ display: isActive ? "block" : "none" }}>
                  {!webLoaded[url] && !webError[url] ? (
                    <div className="ph-web-status">
                      <span className="ph-spinner" aria-hidden="true" />
                      <p>Loading {WEB_APPS[app]?.url === url ? appTitle(app) : "OrbitX"}…</p>
                    </div>
                  ) : null}
                  {webError[url] ? (
                    <div className="ph-web-status">
                      <p>Couldn&apos;t load. The city&apos;s signal dropped.</p>
                      <button type="button" onClick={() => retryWeb(url)}>Retry</button>
                    </div>
                  ) : null}
                  <iframe
                    key={`${url}#${webKeys[url] ?? 0}`}
                    title={url}
                    src={url}
                    onLoad={() => {
                      setWebLoaded((loaded) => ({ ...loaded, [url]: true }));
                      setWebError((err) => ({ ...err, [url]: false }));
                      if (webTimers.current[url]) clearTimeout(webTimers.current[url]);
                    }}
                  />
                </div>
              );
            })}

            {!locked && !activeWeb && app !== "home" ? (
              <div className="ph-appview" key={app}>
                <header className="ph-apphead">
                  <button type="button" className="ph-back" onClick={goHome} aria-label="Back to home screen">‹</button>
                  <b>{appTitle(app)}</b>
                </header>
                <div className={cityChatOpen ? "ph-appscroll ph-appscroll-lock" : "ph-appscroll"}>
                  {!(app === "messages" && threadId) ? <h2 className="ph-largetitle">{appTitle(app)}</h2> : null}
                  {app === "messages" ? (
                    threadId === CITY_CHAT_ID ? (
                      <div className="ph-thread ph-chat">
                        <button type="button" className="ph-thread-back" onClick={() => { setThreadId(null); rt?.setTyping(false); }}>‹ All messages</button>
                        <div className="ph-seg" role="group" aria-label="Chat scope">
                          <button type="button" className={snap.chatScope === "global" ? "on" : ""} onClick={() => rt?.setChatScope("global")}>Everyone</button>
                          <button type="button" className={snap.chatScope === "near" ? "on" : ""} onClick={() => rt?.setChatScope("near")}>Nearby</button>
                        </div>
                        <div className="ph-chat-log" ref={chatLogRef}>
                          {snap.chat.length === 0 ? <p className="ph-empty">No messages yet — say the first word.</p> : null}
                          {snap.chat.map((line, index) => (
                            <div key={`${line.id}-${index}`} className={line.self ? "ph-bubble ph-bubble-self" : "ph-bubble"}>
                              {line.self ? null : <span className="ph-bubble-name">{line.name}</span>}
                              <p>{line.text}</p>
                            </div>
                          ))}
                        </div>
                        <form className="ph-chat-compose" onSubmit={sendCityChat}>
                          <input
                            value={chatText}
                            placeholder={snap.chatScope === "near" ? "Message nearby players" : "Message the city"}
                            onChange={(event) => setChatText(event.target.value)}
                            onFocus={() => rt?.setTyping(true)}
                            onBlur={() => rt?.setTyping(false)}
                          />
                          <button type="submit" className="ph-send" aria-label="Send message">
                            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5 M5.5 11.5 12 5l6.5 6.5" /></svg>
                          </button>
                        </form>
                      </div>
                    ) : activeThread ? (
                      <div className="ph-thread">
                        <button type="button" className="ph-thread-back" onClick={() => setThreadId(null)}>‹ All messages</button>
                        {activeThread.messages.map((m) => (
                          <div key={m.id} className="ph-bubble">
                            <p>{m.text}</p>
                            <span>{fmtWhen(m.at)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ph-list">
                        <div className="ph-group">
                          <button type="button" className="ph-row ph-row-btn" onClick={() => { setThreadId(CITY_CHAT_ID); triggerHaptic("tap"); }}>
                            <span className="ph-avatar ph-avatar-chat">{ICONS.chat}</span>
                            <span className="ph-row-main">
                              <b>City Chat</b>
                              <span>{lastChat ? `${lastChat.self ? "You" : lastChat.name}: ${lastChat.text}` : "The whole city, live"}</span>
                            </span>
                            <span className="ph-row-side"><span>Pinned</span></span>
                          </button>
                        </div>
                        <div className="ph-group">
                        {sortedThreads.map((t) => {
                          const last = t.messages[t.messages.length - 1];
                          return (
                            <button key={t.id} type="button" className="ph-row ph-row-btn" onClick={() => { setThreadId(t.id); triggerHaptic("tap"); }}>
                              <span className="ph-avatar">{t.name.slice(0, 1)}</span>
                              <span className="ph-row-main">
                                <b>{t.name}</b>
                                <span>{last ? last.text : t.role}</span>
                              </span>
                              <span className="ph-row-side">
                                {last ? <span>{fmtWhen(last.at)}</span> : null}
                                {t.unread > 0 ? <span className="ph-badge-inline">{t.unread}</span> : null}
                              </span>
                            </button>
                          );
                        })}
                        </div>
                        {sortedThreads.length === 0 ? <p className="ph-empty">No messages yet.</p> : null}
                      </div>
                    )
                  ) : null}

                  {app === "contacts" ? (
                    <div className="ph-list">
                      <div className="ph-group">
                      {CONTACT_NAMES.map((name) => {
                        const info = NPC_LINES[name];
                        if (!info) return null;
                        return (
                          <div key={name} className="ph-row">
                            <span className="ph-avatar">{name.slice(0, 1)}</span>
                            <span className="ph-row-main">
                              <b>{name}</b>
                              <span>{info.role}</span>
                            </span>
                            <span className="ph-row-actions">
                              {name === "Jax" ? (
                                <button type="button" className="ph-mini" onClick={deliverCar}>Bring my car</button>
                              ) : null}
                              <button type="button" className="ph-mini ph-mini-on" onClick={() => callNpc(name)}>Call</button>
                            </span>
                          </div>
                        );
                      })}
                      </div>
                    </div>
                  ) : null}

                  {app === "map" ? (
                    <div className="ph-list">
                      <h4>Places</h4>
                      <div className="ph-group">
                      {snap.districts.filter((p) => PLACE_IDS.includes(p.id)).map((place) => (
                        <div key={place.id} className="ph-row">
                          <span className="ph-row-main"><b>{place.name}</b></span>
                          <button type="button" className="ph-mini ph-mini-on" onClick={() => rideTo(() => rt?.travel(place.id))}>Ride</button>
                        </div>
                      ))}
                      </div>
                      <h4>Gas stations</h4>
                      <div className="ph-group">
                      {GAS_STATIONS.map((s) => (
                        <div key={s.name} className="ph-row">
                          <span className="ph-row-main"><b>{s.name}</b><span>Fuel · City Sol</span></span>
                          <button type="button" className="ph-mini ph-mini-on" onClick={() => rideTo(() => rt?.travelToPoint(s.x, s.z, s.name))}>Ride</button>
                        </div>
                      ))}
                      </div>
                      <h4>Charge points</h4>
                      <div className="ph-group">
                      {CHARGE_POINTS.map((s) => (
                        <div key={s.name} className="ph-row">
                          <span className="ph-row-main"><b>{s.name}</b><span>EV charging · City Sol</span></span>
                          <button type="button" className="ph-mini ph-mini-on" onClick={() => rideTo(() => rt?.travelToPoint(s.x, s.z, s.name))}>Ride</button>
                        </div>
                      ))}
                      </div>
                    </div>
                  ) : null}

                  {app === "bank" ? (
                    <div className="ph-list">
                      <div className="ph-bank-hero">
                        <span>Balance</span>
                        <b>{snap.balance.toLocaleString()} City Sol</b>
                        <span>{snap.server || "OrbitX City"}</span>
                      </div>
                      <div className="ph-group">
                      <div className="ph-row"><span className="ph-row-main"><b>Total earned</b></span><span>{snap.earned.toLocaleString()}</span></div>
                      <div className="ph-row"><span className="ph-row-main"><b>Total burned</b></span><span>{snap.burned.toLocaleString()}</span></div>
                      <div className="ph-row">
                        <span className="ph-row-main"><b>Job</b><span>{snap.jobShift ? `${snap.jobShift.title} — ${snap.jobShift.tasksDone}/${snap.jobShift.tasksTotal} tasks · ${snap.jobShift.taskPaid} paid` : snap.jobTitle || "Not clocked in"}</span></span>
                      </div>
                      <div className="ph-row"><span className="ph-row-main"><b>Current car</b></span><span>{snap.car}</span></div>
                      <div className="ph-row"><span className="ph-row-main"><b>Items owned</b></span><span>{snap.owned.length}</span></div>
                      </div>
                      <p className="ph-note">City Sol lives in the city — earning, spending and burning all happen here, never in your real wallet.</p>
                    </div>
                  ) : null}

                  {app === "jobs" ? (
                    <div className="ph-list">
                      <p className="ph-note">Clock in, work the task list, get paid in City Sol. Story chapters live in Missions, same panel.</p>
                      <button type="button" className="ph-big" onClick={() => { triggerHaptic("tap"); onOpenPanel("jobs"); }}>Open Jobs &amp; Missions</button>
                      <h4>More boards</h4>
                      <div className="ph-group">
                      <div className="ph-row"><span className="ph-row-main"><b>Daily</b><span>Quests + streak reward</span></span><button type="button" className="ph-mini" onClick={() => rt?.request("daily")}>Open</button></div>
                      <div className="ph-row"><span className="ph-row-main"><b>Leaderboards</b><span>Richest, earners, burned, races</span></span><button type="button" className="ph-mini" onClick={() => rt?.request("leaders")}>Open</button></div>
                      <div className="ph-row"><span className="ph-row-main"><b>Ring road race</b><span>{snap.race.names.length ? snap.race.names.join(", ") : "No lobby yet"}</span></span><button type="button" className="ph-mini" onClick={() => rt?.request("race")}>Open</button></div>
                      </div>
                    </div>
                  ) : null}

                  {app === "music" ? (
                    <div className="ph-list">
                      {playingTrack ? (
                        <div className="ph-bank-hero">
                          <span>Now playing</span>
                          <b>{playingTrack.name}</b>
                          <span>by {playingTrack.uploader}</span>
                          <button type="button" className="ph-mini ph-mini-on" onClick={radio.onStop}>Stop</button>
                        </div>
                      ) : null}
                      {radio.msg ? <p className="ph-note">{radio.msg}</p> : null}
                      {radio.tracks.length === 0 ? <p className="ph-empty">Loading the station…</p> : null}
                      <div className="ph-group">
                      {radio.tracks.map((track) => (
                        <button key={track.id} type="button" className="ph-row ph-row-btn" onClick={() => radio.onPlay(track)}>
                          <span className="ph-row-main">
                            <b>{track.name}</b>
                            <span>{track.uploader}</span>
                          </span>
                          <span>{radio.playingId === track.id ? "Playing" : "Play"}</span>
                        </button>
                      ))}
                      </div>
                      <p className="ph-note">The playlist is shared, the sound is yours — only you hear your radio.</p>
                    </div>
                  ) : null}

                  {app === "camera" ? (
                    <div className="ph-list">
                      <button type="button" className="ph-big" onClick={() => { triggerHaptic("tap"); onPhotoMode(); }}>Open Photo Mode</button>
                      <p className="ph-note">Fly the camera anywhere, frame the shot, snap it. Photos save to this phone and to your downloads.</p>
                      <h4>Gallery</h4>
                      {gallery.length === 0 ? <p className="ph-empty">No shots yet.</p> : null}
                      <div className="ph-gallery">
                        {gallery.map((shot) => (
                          <button key={shot.id} type="button" className="ph-shot" onClick={() => setViewingShot(shot)}>
                            <img alt="" src={shot.thumb} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {app === "voice" ? (() => {
                    // A second view on the SAME voice state the Voice
                    // panel reads (snap.voice* / snap.lobbies) and the
                    // same runtime handlers — never a second connection.
                    const online = snap.server !== "This device";
                    const inRoom = !!snap.lobby;
                    const currentFilter = VOICE_FILTERS.find((item) => item.id === snap.voiceFilter) ?? VOICE_FILTERS[0];
                    const roomName = snap.lobbies.find((room) => room.id === snap.lobby)?.name ?? snap.lobby;
                    return (
                      <div className="ph-list">
                        <div className="ph-bank-hero">
                          <span>{snap.voiceProximity ? "Proximity voice" : inRoom ? "Channel" : "Voice"}</span>
                          <b>{snap.voiceProximity ? "On" : inRoom ? roomName : "Off"}</b>
                          <span>
                            {snap.voiceProximity
                              ? `You can hear players within ${PROXIMITY_RANGE} units — walk away and they fade out.`
                              : inRoom
                                ? `Connected via ${snap.voiceProvider || "LiveKit"}.`
                                : "Join proximity voice to talk to players standing near you, or join a channel below."}
                          </span>
                        </div>
                        {snap.voiceError ? <p className="ph-note">{snap.voiceError}</p> : null}
                        {!online ? <p className="ph-note">Voice needs the online city.</p> : null}
                        <div className="ph-group">
                          <div className="ph-row">
                            <span className="ph-row-main"><b>{inRoom ? "Voice room" : "Proximity voice"}</b><span>{inRoom ? "You are connected" : "Talk to players standing near you"}</span></span>
                            {inRoom ? (
                              <button type="button" className="ph-mini" onClick={() => rt?.leaveLobby()}>Leave</button>
                            ) : (
                              <button type="button" className="ph-mini ph-mini-on" onClick={() => rt?.joinProximity()}>Join</button>
                            )}
                          </div>
                          <div className="ph-row">
                            <span className="ph-row-main"><b>Microphone</b><span>{snap.muted ? "Muted" : snap.pushToTalk ? "Push to talk" : snap.speaking ? "Live — speaking" : "Live"}</span></span>
                            <button type="button" className="ph-mini" onClick={() => rt?.setMuted(!snap.muted)}>{snap.muted ? "Unmute" : "Mute"}</button>
                          </div>
                          <div className="ph-row">
                            <span className="ph-row-main"><b>Speakers</b><span>{snap.deafened ? "Off — you hear no one" : "On"}</span></span>
                            <button type="button" className="ph-mini" onClick={() => rt?.setDeafened(!snap.deafened)}>{snap.deafened ? "Turn on" : "Turn off"}</button>
                          </div>
                          <div className="ph-row">
                            <span className="ph-row-main"><b>Push to talk</b><span>{snap.pushToTalk ? "Hold the button below to talk" : "Mic is always live"}</span></span>
                            <button type="button" className="ph-mini" onClick={() => rt?.setPushToTalk(!snap.pushToTalk)}>{snap.pushToTalk ? "On" : "Off"}</button>
                          </div>
                        </div>
                        <div className="ph-micmeter"><i style={{ width: `${Math.round(snap.micLevel * 100)}%` }} /></div>
                        {snap.pushToTalk ? (
                          <button
                            type="button"
                            className="ph-big"
                            onPointerDown={(event) => { event.preventDefault(); rt?.setTalking(true); }}
                            onPointerUp={() => rt?.setTalking(false)}
                            onPointerLeave={() => rt?.setTalking(false)}
                            onPointerCancel={() => rt?.setTalking(false)}
                            onContextMenu={(event) => event.preventDefault()}
                          >
                            Hold to talk
                          </button>
                        ) : null}
                        <h4>In this room</h4>
                        <div className="ph-group">
                          {!inRoom ? <div className="ph-row"><span className="ph-row-main"><span>Not in a voice room yet — join to see who is here.</span></span></div> : null}
                          {inRoom && snap.voicePeers.length === 0 ? <div className="ph-row"><span className="ph-row-main"><span>Connecting…</span></span></div> : null}
                          {snap.voicePeers.map((peer) => {
                            const volume = snap.volumes[peer.id] ?? 1;
                            return (
                              <div key={peer.id} className="ph-row">
                                <span className={peer.speaking ? "ph-speakdot on" : "ph-speakdot"} aria-hidden="true" />
                                <span className="ph-row-main">
                                  <b>{peer.name}{peer.isLocal ? " (you)" : ""}</b>
                                  <span>{peer.isLocal ? `Filter: ${currentFilter.label}` : volume === 0 ? "Muted by you" : `Volume ${Math.round(volume * 100)}%`}</span>
                                </span>
                                {peer.isLocal ? null : (
                                  <input type="range" min={0} max={1} step={0.05} value={volume} aria-label={`Volume for ${peer.name}`} onChange={(event) => rt?.setVolume(peer.id, Number(event.target.value))} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <h4>Voice filters</h4>
                        <div className="ph-chipwrap">
                          {VOICE_FILTERS.map((filter) => (
                            <button key={filter.id} type="button" className={snap.voiceFilter === filter.id ? "ph-mini ph-mini-on" : "ph-mini"} onClick={() => rt?.setVoiceFilter(filter.id)}>{filter.label}</button>
                          ))}
                        </div>
                        <p className="ph-note">{currentFilter.blurb} Filters change how you sound to everyone in the room.</p>
                        <h4>Effects</h4>
                        <div className="ph-group">
                          <div className="ph-row">
                            <span className="ph-row-main"><b>Reverb</b><span>{snap.voiceReverb === 0 ? "Off" : `${Math.round(snap.voiceReverb * 100)}%`}</span></span>
                            <input type="range" min={0} max={1} step={0.05} value={snap.voiceReverb} aria-label="Reverb" onChange={(event) => rt?.setVoiceReverb(Number(event.target.value))} />
                          </div>
                          <div className="ph-row">
                            <span className="ph-row-main"><b>Echo</b><span>{snap.voiceEcho === 0 ? "Off" : `${Math.round(snap.voiceEcho * 100)}%`}</span></span>
                            <input type="range" min={0} max={1} step={0.05} value={snap.voiceEcho} aria-label="Echo" onChange={(event) => rt?.setVoiceEcho(Number(event.target.value))} />
                          </div>
                        </div>
                        <h4>Channels</h4>
                        <div className="ph-group">
                          {snap.lobbies.length === 0 ? <div className="ph-row"><span className="ph-row-main"><span>No channels right now — join proximity voice to talk.</span></span></div> : null}
                          {snap.lobbies.map((room) => (
                            <div key={room.id} className="ph-row">
                              <span className="ph-row-main">
                                <b>{room.name}{snap.lobby === room.id ? " · you are here" : ""}</b>
                                <span>{room.members.length ? room.members.map((member) => `${member.name}${member.speaking ? " ●" : ""}`).join(", ") : "Empty"}</span>
                              </span>
                              {snap.lobby === room.id ? (
                                <button type="button" className="ph-mini" onClick={() => rt?.leaveLobby()}>Leave</button>
                              ) : (
                                <button type="button" className="ph-mini ph-mini-on" onClick={() => rt?.joinLobby(room.id)}>Join</button>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="ph-note">Free — voice is a core social feature, not a purchase. Audio runs through LiveKit&apos;s servers; nothing is recorded or stored.</p>
                      </div>
                    );
                  })() : null}

                  {app === "burner" ? (
                    <div className="ph-list">
                      <div className="ph-bank-hero">
                        <span>Wanted level</span>
                        <b>{snap.wanted > 0 ? "★".repeat(snap.wanted) + "☆".repeat(5 - snap.wanted) : "Clean"}</b>
                        <span>{snap.wanted > 0 ? `Settle up for ${fine.toLocaleString()} City Sol` : "No heat on you right now."}</span>
                      </div>
                      {burnerMsg ? <p className="ph-note">{burnerMsg}</p> : null}
                      <button
                        type="button"
                        className="ph-big"
                        disabled={snap.wanted <= 0}
                        onClick={() => {
                          if (!rt) return;
                          const res = rt.payFine();
                          setBurnerMsg(res.message);
                          triggerHaptic(res.ok ? "success" : "error");
                        }}
                      >
                        Pay fine{fine > 0 ? ` — ${fine.toLocaleString()} City Sol` : ""}
                      </button>
                      <p className="ph-note">Too close to a cop car and the payment won&apos;t go through — lose them first.</p>
                      <h4>Known scores</h4>
                      <div className="ph-group">
                      {ROB_FLAVOR.map((t) => (
                        <div key={t.name} className="ph-row">
                          <span className="ph-row-main"><b>{t.label}</b><span>{t.name} · {"★".repeat(t.stars)} · {t.min}–{t.max} City Sol</span></span>
                        </div>
                      ))}
                      </div>
                    </div>
                  ) : null}

                  {app === "settings" ? (
                    <div className="ph-list">
                      <h4>Wallpaper</h4>
                      <div className="ph-wps">
                        {Object.entries(WALLPAPERS).map(([id, wp]) => (
                          <button
                            key={id}
                            type="button"
                            className={`ph-wp${prefs.wallpaper === id ? " on" : ""}`}
                            style={{ background: wp.css }}
                            onClick={() => updatePrefs({ ...prefs, wallpaper: id, wallpaperData: "" })}
                          >
                            <span>{wp.name}</span>
                          </button>
                        ))}
                        {gallery.map((shot) => (
                          <button
                            key={shot.id}
                            type="button"
                            className={`ph-wp${prefs.wallpaper === "shot" && prefs.wallpaperData === shot.thumb ? " on" : ""}`}
                            style={{ backgroundImage: `url(${shot.thumb})` }}
                            onClick={() => updatePrefs({ ...prefs, wallpaper: "shot", wallpaperData: shot.thumb })}
                          >
                            <span>Photo</span>
                          </button>
                        ))}
                      </div>
                      <h4>Accent</h4>
                      <div className="ph-group">
                      {(["gold", "blue", "white"] as const).map((accent) => (
                        <button
                          key={accent}
                          type="button"
                          className="ph-row ph-row-btn"
                          onClick={() => updatePrefs({ ...prefs, accent })}
                        >
                          <span className="ph-row-main"><b style={{ textTransform: "capitalize" }}>{accent}</b></span>
                          <span>{prefs.accent === accent ? "On" : ""}</span>
                        </button>
                      ))}
                      </div>
                      <p className="ph-note">Wallpaper and accent live on this phone only.</p>
                    </div>
                  ) : null}

                  {app === "people" ? <div className="ph-people">{socialNode}</div> : null}

                  {LAUNCHERS[app] ? (
                    <div className="ph-list">
                      <div className="ph-bank-hero ph-launch-hero">
                        <span className={`ph-icon ph-icon-${app}`}>{ICONS[app]}</span>
                        <b>{appTitle(app)}</b>
                        <span>{LAUNCHERS[app]!.blurb}</span>
                        {launcherDetail(app) ? <span>{launcherDetail(app)}</span> : null}
                      </div>
                      <button type="button" className="ph-big" onClick={() => openLauncher(app)}>{LAUNCHERS[app]!.cta}</button>
                      <p className="ph-note">Opens the full {appTitle(app)} screen — the phone steps aside and it works exactly as before.</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!locked && app === "home" ? (
              <div className="ph-home">
                <div className="ph-home-scroll">
                <div className="ph-widget">
                  <span>City Sol balance</span>
                  <b>{snap.balance.toLocaleString()}<small> CS</small></b>
                  <span>{widgetLine}</span>
                </div>
                <div className="ph-grid">
                  {tile("messages", "Messages", unread)}
                  {tile("contacts", "Contacts")}
                  {tile("map", "Map")}
                  {tile("bank", "Bank")}
                  {tile("jobs", "Jobs")}
                  {tile("music", "Music")}
                  {tile("camera", "Camera")}
                  {tile("voice", "Voice")}
                  {tile("burner", "Burner")}
                  {tile("people", "People")}
                  {tile("settings", "Settings")}
                </div>
                <p className="ph-section">CITY</p>
                <div className="ph-grid">
                  {tile("shop", "Shop")}
                  {tile("grocery", "Grocery")}
                  {tile("arcade", "Arcade")}
                  {tile("leaders", "Leaders")}
                  {tile("ads", "Ads")}
                  {tile("players", "Players")}
                  {tile("profile", "Profile")}
                  {tile("alerts", "Alerts", snap.unreadAlerts)}
                  {tile("offices", "Offices")}
                  {tile("myprops", "My Props")}
                  {tile("transport", "Transport")}
                  {tile("multiverse", "Multiverse")}
                  {tile("events", "Events")}
                </div>
                <p className="ph-section">ORBITX</p>
                <div className="ph-grid">
                  {tile("orbitx", "OrbitX")}
                  {tile("dex", "DEX")}
                  {tile("hubdex", "Hub DEX")}
                  {tile("scanner", "Scanner")}
                  {tile("social", "Social")}
                  {tile("wallet", "Wallet")}
                </div>
                </div>
                <div className="ph-dock">
                  {tile("messages", "Messages", unread)}
                  {tile("map", "Map")}
                  {tile("camera", "Camera")}
                  {tile("dex", "DEX")}
                </div>
              </div>
            ) : null}

            {viewingShot ? (
              <div className="ph-shotview">
                <span className="ph-grab" aria-hidden="true" />
                <img alt="" src={viewingShot.thumb} />
                <div className="ph-shot-actions">
                  <button
                    type="button"
                    onClick={() => {
                      updatePrefs({ ...prefs, wallpaper: "shot", wallpaperData: viewingShot.thumb });
                      showToast("Wallpaper set.");
                    }}
                  >
                    Set as wallpaper
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeGalleryShot(viewingShot.id);
                      setViewingShot(null);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setViewingShot(null)}>Back</button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Lock screen */}
          {locked ? (
            <div
              className="ph-lock"
              role="button"
              tabIndex={0}
              aria-label="Unlock phone"
              onClick={() => {
                setLocked(false);
                setApp("home");
                triggerHaptic("tap");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setLocked(false);
                  setApp("home");
                  triggerHaptic("tap");
                }
              }}
            >
              <span className="ph-lock-date">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
              <span className="ph-lock-time">{fmtClock(now)}</span>
              <div className="ph-notifs">
                {unread > 0 ? (
                  <span className="ph-notif">
                    <span className="ph-notif-icon ph-notif-messages">{ICONS.messages}</span>
                    <span className="ph-notif-main">
                      <b>Messages</b>
                      <span>{unread} unread message{unread === 1 ? "" : "s"}</span>
                    </span>
                    <span className="ph-notif-time">now</span>
                  </span>
                ) : null}
                {snap.wanted > 0 ? (
                  <span className="ph-notif">
                    <span className="ph-notif-icon ph-notif-burner">{ICONS.burner}</span>
                    <span className="ph-notif-main">
                      <b>Burner</b>
                      <span>Wanted {"★".repeat(snap.wanted)} — settle for {fine.toLocaleString()} City Sol</span>
                    </span>
                    <span className="ph-notif-time">now</span>
                  </span>
                ) : null}
                <span className="ph-notif">
                  <span className="ph-notif-icon ph-notif-orbitx">{ICONS.orbitx}</span>
                  <span className="ph-notif-main">
                    <b>OrbitX City</b>
                    <span>Balance {snap.balance.toLocaleString()} City Sol</span>
                  </span>
                  <span className="ph-notif-time">now</span>
                </span>
              </div>
              <div className="ph-lock-bottom">
                <div className="ph-quickrow">
                  <button
                    type="button"
                    className="ph-quick"
                    aria-label="Open Camera"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocked(false);
                      triggerHaptic("tap");
                      onPhotoMode();
                    }}
                  >
                    {ICONS.camera}
                  </button>
                  <button
                    type="button"
                    className="ph-quick"
                    aria-label="Open Messages"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocked(false);
                      openApp("messages");
                    }}
                  >
                    {ICONS.messages}
                    {unread > 0 ? <span className="ph-badge">{unread}</span> : null}
                  </button>
                </div>
                <span className="ph-lock-pill">Tap to open</span>
              </div>
            </div>
          ) : null}

          {toast ? <div className="ph-toast">{toast}</div> : null}

          {/* Home bar */}
          <div className="ph-homebar">
            <button type="button" className="ph-pill" onClick={goHome} aria-label="Home" />
            <button type="button" className="ph-away" onClick={onClose} aria-label="Put phone away">✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}
