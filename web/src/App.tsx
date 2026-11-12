import { useEffect, useMemo, useRef, useState } from "react";
import { createGame, type Game, type PlayMode } from "./game/engine";
import type { AdOrder, PanelName, RadioTrack, Runtime, Snap } from "./game/runtime";
import { PHOTO_LANDMARKS } from "./game/runtime";
import { loadLooks } from "./game/avatar";
import { adUsdPrice } from "./game/content";
import { parseSeed } from "./game/seed";
import { cityMapModel } from "./game/city";
import { CharacterSelect } from "./Roster";
import { MenuHome } from "./MenuHome";
import { accountToken, signOutAccount, type Account } from "./auth";
import { DecorBar, EmoteWheel, FeaturePanel, PhoneExtra, RaceBanner, SpectateBar, featureTitle } from "./Features";
import { EMPTY_LEADERS, EMPTY_RACE } from "./game/life";
import { CAR_SHOP, FLY_CONTROLS, VEHICLE_COLORS, getVehicle } from "./game/vehicles";
import {
  ALL_UNIVERSES_FULL_MESSAGE,
  UNIVERSE_IDS,
  UNIVERSE_META,
  isFull,
  joinButtonLabel,
  listUniverses,
  universeDisplayName,
  type Universe,
} from "./game/multiverse";
import {
  DISTRICTS,
  JOB_LIST_ADDITION,
  JOB_LIST_DESC_UPDATES,
  JOBS_20,
  type DistrictId,
  type DistrictOfficeDirectoryRow,
} from "./game/emergency";
import { homeById, homePrice } from "./game/homes";
import { triggerHaptic } from "./game/haptics";

const HELP =
  "WASD move · click or drag to look · arrows or Q/R turn · Space jump · F fly · E use or drive · C camera · hold Z emotes · O spectator · T chat · V talk";

// Tower office directory, served live by /api/city — never invented.
// "offices" joins PanelName in runtime.ts once the tower-interiors wiring
// lands; until then App.tsx carries it locally so this file compiles.
type AppPanel = PanelName | "" | "offices";

interface OfficeClaimState {
  suite: string;
  project: string;
  logo: string;
  site: string;
  owner_id: string;
  owner_name: string;
  term_days: number;
  start: string;
  until: string;
  price: number;
  claimed_at: string;
}

interface OfficeSuiteState {
  id: string;
  floor: number;
  name: string;
  tier: "standard" | "premium" | "founder";
  claimable: boolean;
  prices: { 1: number; 7: number; 30: number };
  claim: OfficeClaimState | null;
}

// Same bearer pattern as the game world's own API calls: account token
// first, guest player token (localStorage "orbitx-token") second.
async function callCity(op: string, extra: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = accountToken() || localStorage.getItem("orbitx-token") || "";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch("/api/city", {
    method: "POST",
    headers,
    body: JSON.stringify({ op, ...extra }),
  });
  return (await response.json()) as Record<string, unknown>;
}

const EMPTY: Snap = {
  playing: false,
  touch: false,
  driving: false,
  flying: false,
  indoors: "",
  prompt: "",
  balance: 0,
  burned: 0,
  owned: [],
  color: "white",
  hat: "none",
  car: "black",
  jobTitle: "",
  objective: "",
  notice: "",
  chat: [],
  others: 0,
  netMode: "",
  name: "",
  projects: [],
  billboards: [],
  events: [],
  shop: [],
  eventLabel: "",
  panel: "",
  lift: null,
  people: [],
  friends: [],
  requests: [],
  party: [],
  lobbies: [],
  lobby: "",
  muted: false,
  deafened: false,
  pushToTalk: false,
  voiceProvider: "",
  voiceError: "",
  quality: "high",
  time: "sunset",
  me: { x: 0, z: 0, yaw: 0 },
  profile: null,
  server: "",
  chatScope: "global",
  lookId: "tjr",
  lookName: "TJR",
  cam: "shoulder",
  camLabel: "Over the shoulder",
  lookHint: "",
  mission: 0,
  board: [],
  districts: [],
  lots: [],
  leaders: EMPTY_LEADERS,
  daily: null,
  race: EMPTY_RACE,
  notes: [],
  market: null,
  mintSet: false,
  walletKey: "",
  walletNote: "",
  holder: false,
  account: false,
  email: "",
  avatar: "",
  chainAddress: "",
  chainSol: null,
  chainOrbitx: null,
  chainNetwork: "",
  chainHistory: [],
  chainQr: "",
  meId: "",
  jobStreak: 0,
  business: null,
  spectator: false,
  hideHud: false,
  hideNames: false,
  hideChat: false,
  orbit: false,
  clean: false,
  wheel: false,
  wheelIndex: 0,
  decorate: false,
  decorKind: "couch",
  hqIndex: 0,
  banner: "",
  talk: null,
  photos: { taken: 0, spots: [] },
  wishes: 0,
  missions: [],
  missionMsg: "",
  missionsLoaded: false,
  buskReadyAt: 0,
  photosToday: [],
  photoMsg: "",
  trail: "none",
  vehicles: [],
  activeVehicle: null,
  universe: null,
  haptics: false,
  emergency: null,
  districtOffice: "harbor",
};

function shotMode(): PlayMode | null {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get("shot");
  if (shot === "air") return "air";
  if (
    shot === "spawn" ||
    shot === "drive" ||
    shot === "shop" ||
    shot === "district" ||
    shot === "billboard" ||
    shot === "players" ||
    shot === "meet" ||
    shot === "inside" ||
    shot === "cafe" ||
    shot === "hall" ||
    shot === "sign-back" ||
    shot === "courier" ||
    shot === "car" ||
    shot === "property" ||
    shot === "sale" ||
    shot === "decorate" ||
    shot === "hq" ||
    shot === "hq-edit" ||
    shot === "board" ||
    shot === "board-s" ||
    shot === "road" ||
    shot === "garage" ||
    shot === "leaders" ||
    shot === "race" ||
    shot === "race-run" ||
    shot === "hover" ||
    shot === "arcade" ||
    shot === "daily" ||
    shot === "wallet" ||
    shot === "emote" ||
    shot === "yard" ||
    shot === "home" ||
    shot === "mall" ||
    shot === "mall2" ||
    shot === "mallk" ||
    shot === "malln" ||
    shot === "office" ||
    shot === "office2" ||
    shot === "roof" ||
    shot === "lift" ||
    shot === "liftcall" ||
    shot === "spectate" ||
    shot === "spectate-ui" ||
    shot === "street" ||
    shot === "stores" ||
    shot === "malldoor" ||
    shot === "officedoor" ||
    shot === "homedoor" ||
    shot === "homefront" ||
    shot === "streetup" ||
    shot === "homediag" ||
    params.has("autostart")
  ) {
    return "play";
  }
  return null;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [menu, setMenu] = useState(() => shotMode() === null);
  // Title flow: "home" is the new landing screen, "roster" the character select.
  const [menuStep, setMenuStep] = useState<"home" | "roster">("home");
  const [busy, setBusy] = useState(false);
  const [seedText, setSeedText] = useState(() => new URLSearchParams(window.location.search).get("seed") ?? "");
  const [seed, setSeed] = useState(() => parseSeed(new URLSearchParams(window.location.search).get("seed") ?? "1"));
  const [status, setStatus] = useState("");
  const [webglMissing, setWebglMissing] = useState(false);
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [panel, setPanel] = useState<AppPanel>("");
  const [adText, setAdText] = useState("ORBITX LIVE");
  const [adId, setAdId] = useState("plaza-east");
  const [adDays, setAdDays] = useState<1 | 7 | 30>(7);
  const [adQuoteData, setAdQuoteData] = useState<{ priceUsd: number; priceSol: number; estOrbitxUi: string; usd: string; endsAt: string } | null>(null);
  const [adOrder, setAdOrder] = useState<AdOrder | null>(null);
  const [adOrders, setAdOrders] = useState<AdOrder[]>([]);
  const [adBusy, setAdBusy] = useState(false);
  const [adMsg, setAdMsg] = useState("");
  // In-game radio: the playlist is shared, the sound is personal — a plain
  // audio element on this device, never broadcast to other players.
  const [radioTracks, setRadioTracks] = useState<RadioTrack[]>([]);
  const [radioFile, setRadioFile] = useState<File | null>(null);
  const [radioMsg, setRadioMsg] = useState("");
  const [radioBusy, setRadioBusy] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  const radioInputRef = useRef<HTMLInputElement | null>(null);
  const [offices, setOffices] = useState<OfficeSuiteState[]>([]);
  const [officeMsg, setOfficeMsg] = useState("");
  const [officeBusy, setOfficeBusy] = useState(false);
  const [officeSuite, setOfficeSuite] = useState("");
  // Multiverse picker (menu + panel): live list when the server answers,
  // static roster when offline — the picker still records the choice.
  const [universes, setUniverses] = useState<Universe[] | null>(null);
  const [universeSel, setUniverseSel] = useState<number>(() => {
    const saved = Number(localStorage.getItem("orbitx-universe") || "");
    return saved >= 1 && saved <= 5 ? saved : 1;
  });
  const [universeMsg, setUniverseMsg] = useState("");
  // Garage panel.
  const [garageColors, setGarageColors] = useState<Record<string, string>>({});
  const [garageMsg, setGarageMsg] = useState("");
  const [garageBusy, setGarageBusy] = useState(false);
  // District-offices panel (cloned from the HQ offices panel, per server).
  const [districtSel, setDistrictSel] = useState<DistrictId>("harbor");
  const [districtOffices, setDistrictOffices] = useState<DistrictOfficeDirectoryRow[]>([]);
  const [districtMsg, setDistrictMsg] = useState("");
  const [districtBusy, setDistrictBusy] = useState(false);
  const [districtSuite, setDistrictSuite] = useState("");
  const [districtTerm, setDistrictTerm] = useState<1 | 7 | 30>(7);
  const [districtProject, setDistrictProject] = useState("");
  const [districtLogo, setDistrictLogo] = useState("");
  const [districtSite, setDistrictSite] = useState("");
  // State homes (Home panel, current universe only).
  const [homeMine, setHomeMine] = useState<{ homeId: string; server: number; price: number }[]>([]);
  const [homeServer, setHomeServer] = useState(0);
  const [homeMsg, setHomeMsg] = useState("");
  const [officeTerm, setOfficeTerm] = useState<1 | 7 | 30>(7);
  const [officeProject, setOfficeProject] = useState("");
  const [officeLogo, setOfficeLogo] = useState("");
  const [officeSite, setOfficeSite] = useState("");
  const [chatText, setChatText] = useState("");
  const [gate, setGate] = useState<"login" | "city">("login");
  const [who, setWho] = useState<Account | null>(null);

  // Keep my ad orders fresh while the Ads panel is open.
  useEffect(() => {
    if (panel !== "ads") return;
    const rt = gameRef.current?.runtime;
    if (!rt) return;
    void rt.adOrders().then((res) => {
      if (res.ok) setAdOrders(((res as { orders?: AdOrder[] }).orders || []) as AdOrder[]);
    });
  }, [panel]);

  // Keep the radio playlist fresh while the Radio panel is open.
  useEffect(() => {
    if (panel !== "radio") return;
    const rt = gameRef.current?.runtime;
    if (!rt) return;
    setRadioMsg("");
    void rt.radioList().then((res) => {
      if (res.ok) setRadioTracks(((res as { tracks?: RadioTrack[] }).tracks || []) as RadioTrack[]);
      else setRadioMsg(String((res as { message?: string }).message || "Could not load the radio."));
    });
  }, [panel]);

  // Stop the radio when the player leaves the game (back to the menu).
  useEffect(() => {
    if (menu) stopRadio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  // Stop the radio when this screen goes away.
  useEffect(() => {
    return () => {
      const audio = radioAudioRef.current;
      if (audio) audio.pause();
    };
  }, []);

  // Keep the mission chain fresh while the Missions panel is open — the
  // list, progress and rewards all come from the server, never local.
  useEffect(() => {
    if (panel !== "missions") return;
    gameRef.current?.runtime.loadMissions();
  }, [panel]);

  // Config-fetch failure guard (menu): if /config/characters.json fails,
  // avatar.ts silently falls back to a one-character roster (TJR). Show
  // that visibly on the menu instead of letting the player wonder where
  // the twelve characters went.
  const [looksFailed, setLooksFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void loadLooks().then((list) => {
      if (live && list.length <= 1) setLooksFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  // Keep the office directory live while the Offices panel is open — the
  // list, prices and claim state all come from the server, never local.
  useEffect(() => {
    if (panel !== "offices") return;
    setOfficeMsg("");
    void callCity("office-claims").then((res) => {
      if (res.ok && Array.isArray(res.offices)) setOffices(res.offices as OfficeSuiteState[]);
      else setOfficeMsg(String(res.message || "Could not load the office directory."));
    });
  }, [panel]);

  // Multiverse picker on the menu: counts + home badge when signed in,
  // static roster when offline. Default: home universe if they have one
  // and no universe was picked before, else Universe 1.
  useEffect(() => {
    if (!menu) return;
    let live = true;
    void listUniverses()
      .then((list) => {
        if (!live) return;
        setUniverses(list.universes);
        if (!localStorage.getItem("orbitx-universe") && list.homeServerId) setUniverseSel(list.homeServerId);
      })
      .catch(() => {
        if (!live) return;
        setUniverses(fallbackUniverses());
      });
    return () => {
      live = false;
    };
  }, [menu]);

  // Multiverse panel: fresh counts on open.
  useEffect(() => {
    if (panel !== "multiverse") return;
    setUniverseMsg("");
    void listUniverses()
      .then((list) => setUniverses(list.universes))
      .catch((err) => setUniverseMsg(err instanceof Error ? err.message : "Could not load universes."));
  }, [panel]);

  // District-offices panel: the directory for the picked district on the
  // CURRENT universe — the panel always shows which universe it is for.
  useEffect(() => {
    if (panel !== "district-offices") return;
    setDistrictMsg("");
    const rt = gameRef.current?.runtime;
    if (!rt) return;
    void rt.loadDistrictOffices(districtSel).then((res) => {
      if (res.ok) setDistrictOffices(res.offices as DistrictOfficeDirectoryRow[]);
      else setDistrictMsg(String(res.message || "Could not load the directory."));
    });
  }, [panel, districtSel]);

  // Home panel: home-status poll for the current universe.
  useEffect(() => {
    if (panel !== "home") return;
    setHomeMsg("");
    const rt = gameRef.current?.runtime;
    if (!rt) return;
    void rt.homeStatus().then((res) => {
      if (res.ok) {
        setHomeMine(res.mine);
        setHomeServer(res.homeServer);
      } else setHomeMsg(String(res.message || ""));
    });
  }, [panel]);

  // Poll an in-flight booking until it lands (live / failed / burn-pending).
  useEffect(() => {
    if (!adOrder || !["swapping", "burning", "processing"].includes(adOrder.status)) return;
    const timer = window.setInterval(async () => {
      const rt = gameRef.current?.runtime;
      if (!rt) return;
      const res = await rt.adStatus(adOrder.id);
      if (res.ok && (res as { order?: AdOrder }).order) setAdOrder((res as { order: AdOrder }).order);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [adOrder?.id, adOrder?.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    let game: Game;
    try {
      game = createGame(canvas, setStatus, params.has("shot"));
    } catch {
      setWebglMissing(true);
      return;
    }
    gameRef.current = game;
    const off = game.runtime.subscribe((next) => {
      setSnap(next);
      if (next.panel) {
        setPanel(next.panel);
        const lock = next.panel !== "chat";
        game.runtime.setPaused(lock);
        if (lock) document.exitPointerLock();
      }
    });
    const mode = shotMode();
    const startSeed = parseSeed(params.get("seed") ?? "1");
    setSeed(startSeed);
    if (mode) {
      game.start(startSeed, mode);
      setMenu(false);
    } else {
      game.start(startSeed, "orbit");
    }
    return () => {
      off();
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("touch", snap.touch);
    document.body.classList.toggle("playing", !menu);
  }, [snap.touch, menu]);

  useEffect(() => {
    if (panel !== "shop") return;
    if (new URLSearchParams(window.location.search).get("shot") !== "shop") return;
    const node = document.querySelector(".panel");
    if (node) node.scrollTop = node.scrollHeight;
  }, [panel]);

  const open = (name: PanelName | "offices") => {
    triggerHaptic("tap");
    setPanel(name);
    const lock = name !== "chat";
    gameRef.current?.runtime.setPaused(lock);
    if (lock) document.exitPointerLock();
  };

  const close = () => {
    triggerHaptic("tap");
    setPanel("");
    gameRef.current?.runtime.setPaused(false);
    gameRef.current?.runtime.setTyping(false);
  };

  const stopRadio = () => {
    const audio = radioAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPlayingId(null);
  };

  const playRadio = (track: RadioTrack) => {
    const audio = (radioAudioRef.current ??= new Audio());
    if (playingId === track.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.onended = () => setPlayingId(null);
    audio.src = track.url;
    audio.play().then(() => setPlayingId(track.id)).catch(() => {
      setRadioMsg("Could not play that track.");
      setPlayingId(null);
    });
  };

  const uploadRadio = async () => {
    const file = radioFile;
    if (!file) return;
    const rt = gameRef.current?.runtime;
    if (!rt) return;
    setRadioBusy(true);
    setRadioMsg("Uploading…");
    const started = await rt.radioUploadUrl(file.name, file.size);
    const signedUrl = (started as { signedUrl?: string }).signedUrl;
    const path = (started as { path?: string }).path;
    if (!started.ok || !signedUrl || !path) {
      setRadioMsg(String((started as { message?: string }).message || "Could not start the upload."));
      setRadioBusy(false);
      return;
    }
    let put: Response;
    try {
      put = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
    } catch {
      setRadioMsg("The upload did not go through. Check your connection and try again.");
      setRadioBusy(false);
      return;
    }
    if (!put.ok) {
      setRadioMsg("The upload did not go through. Try again.");
      setRadioBusy(false);
      return;
    }
    const registered = await rt.radioRegister(file.name, path);
    if (!registered.ok) {
      setRadioMsg(String((registered as { message?: string }).message || "Could not add the track."));
      setRadioBusy(false);
      return;
    }
    setRadioMsg(String((registered as { message?: string }).message || "Added to the radio."));
    if (Array.isArray((registered as { tracks?: RadioTrack[] }).tracks)) {
      setRadioTracks(((registered as { tracks: RadioTrack[] }).tracks || []) as RadioTrack[]);
    }
    setRadioFile(null);
    if (radioInputRef.current) radioInputRef.current.value = "";
    setRadioBusy(false);
  };

  const play = () => {
    const game = gameRef.current;
    const canvas = canvasRef.current;
    if (!game || !canvas || busy) return;
    setBusy(true);
    const startSeed = parseSeed(seedText);
    setSeed(startSeed);
    // The menu universe pick rides into the world: begin() joins that
    // universe once the session is live and spawns that universe's car.
    gameRef.current?.runtime.setUniverse(universeSel);
    game.start(startSeed, "play");
    setBusy(false);
    setMenu(false);
    if (!snap.touch) {
      try {
        canvas.requestPointerLock();
      } catch {
        // Drag look still works if the browser blocks the lock.
      }
    }
  };

  return (
    <>
      <canvas ref={canvasRef} className="view" id="view" />
      {/*
        Debug-only status (WALKING + raw coordinates + seed) — kept in the DOM
        for diagnostics but never shown to players.
      */}
      <p className="status" id="status" hidden>
        {menu ? "" : status}
      </p>
      <div className="crosshair" id="crosshair" hidden={menu || snap.hideHud || snap.cam !== "first" || !!panel || snap.spectator} />
      {!menu && snap.lookHint && !snap.hideHud ? <p className="look-hint">{snap.lookHint}</p> : null}
      {!menu && snap.banner ? <RaceBanner text={snap.banner} /> : null}
      {!menu && snap.wheel ? <EmoteWheel index={snap.wheelIndex} /> : null}
      {!menu && snap.decorate ? <DecorBar kind={snap.decorKind} rt={gameRef.current?.runtime ?? null} /> : null}
      {!menu && snap.spectator ? <SpectateBar snap={snap} rt={gameRef.current?.runtime ?? null} /> : null}
      {!menu && !snap.hideHud && (
        <div className="hud" id="hud">
          <div className="who">
            {snap.avatar ? <img alt="" src={snap.avatar} /> : <i>{(snap.name || "G").slice(0, 1).toUpperCase()}</i>}
            <b>{snap.name || "Guest"}</b>
            <span>{snap.account ? "Account" : "Guest"}</span>
          </div>
          <strong>CITY SOL {snap.balance}</strong>
          {snap.flying ? <span className="flying-chip">FLYING</span> : null}
          {snap.holder ? <span>HOLDER</span> : null}
          <span>Burned {snap.burned}</span>
          <span>{snap.jobTitle ? `${snap.jobTitle} — ${snap.objective}` : snap.objective}</span>
          {snap.eventLabel ? <span>{snap.eventLabel}</span> : null}
          {snap.notice ? <em>{snap.notice}</em> : null}
          <span className="quiet">
            {snap.others + 1} in the city · {snap.camLabel} · {snap.lookName}
            {snap.universe ? ` · ${snap.universe.name} · ${snap.universe.isHome ? "Home" : "Visitor"}` : ""}
          </span>
        </div>
      )}
      {!menu && snap.prompt && !snap.hideHud ? <p className="prompt">{snap.prompt}</p> : null}
      {!menu && !snap.hideHud && (
        <div className="actions">
          <button type="button" onClick={() => open("shop")}>Shop</button>
          <button type="button" onClick={() => open("jobs")}>Jobs</button>
          <button type="button" onClick={() => open("missions")}>Missions</button>
          <button type="button" onClick={() => open("ads")}>Ads</button>
          <button type="button" onClick={() => open("radio")}>Radio</button>
          <button type="button" onClick={() => open("offices")}>Offices</button>
          <button type="button" onClick={() => open("multiverse")}>Multiverse</button>
          <button type="button" onClick={() => open("events")}>Events</button>
          <button type="button" onClick={() => open("chat")}>Chat</button>
          <button type="button" onClick={() => open("phone")}>Phone</button>
          <button type="button" onClick={() => open("menu")}>Menu</button>
        </div>
      )}
      {!menu && snap.touch && !panel && !snap.hideHud ? (
        <div className="touch-ui">
          <LookPad
            onLook={(dx, dy) => gameRef.current?.runtime.addLook(dx, dy)}
          />
          <Stick onChange={(x, y) => gameRef.current?.runtime.setStick(x, y)} />
          <div className="pad-buttons">
            <Hold label="Jump" onDown={() => gameRef.current?.runtime.hold("jump", true)} onUp={() => gameRef.current?.runtime.hold("jump", false)} />
            <button type="button" className={snap.flying ? "on" : undefined} aria-pressed={snap.flying} onClick={() => { triggerHaptic("tap"); gameRef.current?.runtime.toggleFly(); }}>Fly</button>
            <Hold label="Down" onDown={() => gameRef.current?.runtime.hold("down", true)} onUp={() => gameRef.current?.runtime.hold("down", false)} />
            <button type="button" onClick={() => { triggerHaptic("tap"); gameRef.current?.runtime.interact(); }}>Use</button>
            <button type="button" onClick={() => { triggerHaptic("tap"); gameRef.current?.runtime.cycleCamera(); }}>Camera</button>
            <button type="button" onClick={() => { triggerHaptic("tap"); open("chat"); }}>Chat</button>
            <button type="button" onClick={() => { triggerHaptic("tap"); open("shop"); }}>Shop</button>
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.dataset.x = String(event.clientX);
                event.currentTarget.dataset.y = String(event.clientY);
                gameRef.current?.runtime.setWheel(true);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const x = Number(event.currentTarget.dataset.x || event.clientX);
                const y = Number(event.currentTarget.dataset.y || event.clientY);
                gameRef.current?.runtime.aimWheel(event.clientX - x, event.clientY - y);
              }}
              onPointerUp={() => gameRef.current?.runtime.commitWheel()}
              onPointerCancel={() => gameRef.current?.runtime.commitWheel()}
            >
              Emote
            </button>
            <button type="button" onClick={() => { triggerHaptic("tap"); gameRef.current?.runtime.toggleSpectator(); }}>Clip</button>
          </div>
          {/* Driving controls (touch, while driving only): Gas and Brake
              as big hold buttons above the pad grid, so the right thumb
              holds the throttle while the left thumb steers with the
              stick — the stick alone had to do gas AND steer, and its
              circular clamp capped a diagonal push at 0.707 on each. */}
          {snap.driving ? (
            <div className="drive-buttons">
              <Hold label="Brake" onDown={() => gameRef.current?.runtime.hold("brake", true)} onUp={() => gameRef.current?.runtime.hold("brake", false)} />
              <Hold label="Gas" onDown={() => { triggerHaptic("tap"); gameRef.current?.runtime.hold("gas", true); }} onUp={() => gameRef.current?.runtime.hold("gas", false)} />
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Minimap lives outside the HUD so it can be dragged anywhere and
          does not bloat the HUD block. Same visibility as the HUD. It is
          rendered after the touch controls so that, at the same z-index,
          it paints above the stick / pad-buttons and stays draggable. */}
      {!menu && !snap.hideHud && (
        <Minimap me={snap.me} people={snap.people} seed={seed} />
      )}
      {panel ? (
        <section className="panel-wrap" id="panel">
          <div className="panel" role="dialog">
            <header>
              <strong>
                {panel === "shop" && "OrbitX shop"}
                {panel === "jobs" && "Jobs"}
                {panel === "missions" && "Missions"}
                {panel === "ads" && "Book a billboard"}
                {panel === "radio" && "Radio"}
                {panel === "offices" && "OrbitX Tower offices"}
                {panel === "garage" && "Hover Garage"}
                {panel === "multiverse" && "Multiverse"}
                {panel === "emergency" && "Emergency services"}
                {panel === "district-offices" && "District offices"}
                {panel === "events" && "Events"}
                {panel === "chat" && "Chat"}
                {panel === "phone" && "Phone"}
                {panel === "menu" && "Menu"}
                {panel === "lift" && (snap.lift?.name ?? "Lift")}
                {featureTitle(panel as PanelName | "")}
              </strong>
              <button type="button" onClick={close}>Close</button>
            </header>
            {panel !== "radio" && <p className="demo">Shop, jobs, property, and the arcade use City Sol only. They are not the in-app Solana wallet and cannot be cashed out.</p>}
            {panel === "shop" && (
              <div className="list">
                <p>Balance {snap.balance} · Burned total {snap.burned}</p>
                {snap.shop.map((item) => {
                  const part = gameRef.current?.runtime.quote(item.price) ?? Math.round(item.price * 0.25);
                  const owned = snap.owned.includes(item.id);
                  return (
                    <article key={item.id}>
                      <div>
                        <b>{item.name}</b>
                        <span>{item.price} City Sol · burns {part}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => gameRef.current?.runtime.buy(item.id)}
                      >
                        {owned ? "Equip" : "Buy"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
            {panel === "missions" && (
              <div className="list">
                <p className="muted">
                  Six missions, in order — each one pays City Sol into this universe&apos;s save. 800 in total. Steps are confirmed by the city server: visit a place, say hello in chat, take a car for a drive, work a job, claim your daily, or buy from the shop.
                </p>
                {snap.missionMsg ? <p>{snap.missionMsg}</p> : null}
                {!snap.missionsLoaded && !snap.missionMsg ? <p>Loading missions…</p> : null}
                {snap.missions.map((mission, index) => {
                  const prev = snap.missions[index - 1];
                  return (
                    <article key={mission.id}>
                      <div>
                        <b>{mission.name} — {mission.reward} City Sol</b>
                        <span>{mission.desc}</span>
                        <span>
                          {mission.steps.map((step, i) => (
                            <span key={step}>
                              {i < mission.step || mission.done ? "✓ " : i === mission.step ? "→ " : "· "}
                              {step}
                              {i < mission.steps.length - 1 ? " · " : ""}
                            </span>
                          ))}
                        </span>
                        <span>
                          {mission.done
                            ? "Done."
                            : !mission.unlocked
                              ? `Locked — finish ${prev?.name ?? "the previous mission"} first.`
                              : `Step ${mission.step + 1} of ${mission.steps.length}`}
                        </span>
                      </div>
                      {mission.unlocked && !mission.done ? (
                        <button type="button" onClick={() => gameRef.current?.runtime.attemptMission(mission.id)}>
                          Check step
                        </button>
                      ) : null}
                    </article>
                  );
                })}
                <h3>Busk</h3>
                <p className="muted">Play the plaza corner — 20 City Sol per set, once a minute per universe. Stand at the corner and the set starts; press E right on each beat.</p>
                <article>
                  <div>
                    <b>Busk at the plaza</b>
                    <span>
                      {snap.buskReadyAt > Date.now()
                        ? `Cooldown — ready in ${Math.ceil((snap.buskReadyAt - Date.now()) / 1000)}s.`
                        : "Ready — stand at the plaza corner and play."}
                    </span>
                  </div>
                  <button type="button" onClick={() => gameRef.current?.runtime.buskNow()}>
                    Busk
                  </button>
                </article>
                <h3>Photo Safari</h3>
                <p className="muted">15 City Sol per landmark, once per landmark per day. {snap.photosToday.length}/8 done today — max 120 a day.</p>
                {PHOTO_LANDMARKS.map((spot) => {
                  const done = snap.photosToday.includes(spot.id);
                  return (
                    <article key={spot.id}>
                      <div>
                        <b>{done ? "✓ " : ""}{spot.name}</b>
                        <span>{done ? "Photographed today." : "15 City Sol — stand at the landmark and snap it."}</span>
                      </div>
                      <button
                        type="button"
                        disabled={done}
                        onClick={() => gameRef.current?.runtime.takeSafariPhoto(spot.id)}
                      >
                        {done ? "Done" : "Take photo"}
                      </button>
                    </article>
                  );
                })}
                {snap.photoMsg ? <p>{snap.photoMsg}</p> : null}
              </div>
            )}
            {panel === "jobs" && (
              <div className="list">
                <p className="muted">
                  Every job pays in City Sol — the game&apos;s own money, never real SOL. Job streak {snap.jobStreak}: +5% pay per job in a row, up to +50%.
                </p>
                {JOBS_20.map((job) => {
                  const pay = Math.round(job.base * (1 + 0.05 * Math.min(snap.jobStreak, 10)));
                  return (
                    <article key={job.id}>
                      <div>
                        <b>{job.name}</b>
                        <span>{job.duty} Pays {pay} City Sol.</span>
                      </div>
                      <button type="button" onClick={() => { gameRef.current?.runtime.startJob(job.id); close(); }}>Start</button>
                    </article>
                  );
                })}
                <h3>Also playable</h3>
                {JOB_LIST.filter((job) => !JOBS_20.some((roster) => roster.id === job.id)).map((job) => {
                  const pay = Math.round(job.base * (1 + 0.05 * Math.min(snap.jobStreak, 10)));
                  return (
                    <article key={job.id}>
                      <div>
                        <b>{job.name}</b>
                        <span>{job.desc} Pays {pay} City Sol.</span>
                      </div>
                      <button type="button" onClick={() => { gameRef.current?.runtime.startJob(job.id); close(); }}>Start</button>
                    </article>
                  );
                })}
                <h3>Your business</h3>
                <p className="muted">Open a business and it earns City Sol while you play. Collect before it fills at 240 — it does not overflow. Opening one burns 25% of its setup cost.</p>
                {snap.business ? (
                  <article>
                    <div>
                      <b>{snap.business.kind === "stand" ? "Plaza coffee stand" : "Night Market stall"}</b>
                      <span>Earns about {snap.business.kind === "stand" ? 3 : 2} City Sol a minute. Last collected {new Date(snap.business.lastCollect).toLocaleTimeString()}.</span>
                    </div>
                    <button type="button" onClick={() => gameRef.current?.runtime.collectBusiness()}>Collect</button>
                  </article>
                ) : (
                  <>
                    <article>
                      <div>
                        <b>Night Market stall</b>
                        <span>2 City Sol a minute. Setup 150 City Sol.</span>
                      </div>
                      <button type="button" onClick={() => gameRef.current?.runtime.buyBusiness("stall")}>Open</button>
                    </article>
                    <article>
                      <div>
                        <b>Plaza coffee stand</b>
                        <span>3 City Sol a minute. Setup 300 City Sol.</span>
                      </div>
                      <button type="button" onClick={() => gameRef.current?.runtime.buyBusiness("stand")}>Open</button>
                    </article>
                  </>
                )}
              </div>
            )}
            {panel === "ads" && (
              <div className="list">
                {!snap.account ? (
                  <p>Create an account to book a real billboard. Guests keep City Sol only.</p>
                ) : (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (adBusy) return;
                      const rt = gameRef.current?.runtime;
                      if (!rt) return;
                      setAdBusy(true);
                      setAdMsg("");
                      if (!adQuoteData) {
                        const q = await rt.quoteAd(adId, adDays);
                        if (q.ok) {
                          setAdQuoteData({
                            priceUsd: Number((q as { priceUsd?: number }).priceUsd || 0),
                            priceSol: Number((q as { priceSol?: number }).priceSol || 0),
                            estOrbitxUi: String((q as { estOrbitxUi?: string }).estOrbitxUi || ""),
                            usd: String((q as { usd?: string }).usd || ""),
                            endsAt: String((q as { endsAt?: string }).endsAt || ""),
                          });
                        } else {
                          setAdMsg(String((q as { message?: string }).message || "The quote failed."));
                        }
                      } else {
                        const res = await rt.book(adId, adDays, adText);
                        if (res.ok && res.order) {
                          setAdOrder(res.order);
                          setAdMsg(String(res.message || ""));
                          const mine = await rt.adOrders();
                          if (mine.ok) setAdOrders(((mine as { orders?: AdOrder[] }).orders || []) as AdOrder[]);
                        } else {
                          setAdMsg(String(res.message || "Booking failed."));
                        }
                      }
                      setAdBusy(false);
                    }}
                  >
                    <label>
                      Billboard
                      <select value={adId} onChange={(event) => { setAdId(event.target.value); setAdQuoteData(null); }}>
                        {(snap.billboards.length ? snap.billboards : [{ id: "plaza-east", project: "OrbitX", text: "" }]).map((board) => (
                          <option key={board.id} value={board.id}>
                            {board.id} — {board.project}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Message
                      <input value={adText} maxLength={32} onChange={(event) => setAdText(event.target.value)} />
                    </label>
                    <div className="days">
                      {([1, 7, 30] as const).map((days) => (
                        <button key={days} type="button" className={adDays === days ? "on" : ""} onClick={() => { setAdDays(days); setAdQuoteData(null); }}>
                          {days} day{days === 1 ? "" : "s"} · ${adUsdPrice(adId, days).toFixed(2)}
                        </button>
                      ))}
                    </div>
                    {adQuoteData ? (
                      <p>
                        ${adQuoteData.priceUsd.toFixed(2)} buys ~{adQuoteData.estOrbitxUi} ORBITX ({adQuoteData.priceSol} SOL) and burns it all.
                        100% buy + burn. No fee, no cut. Live until {adQuoteData.endsAt}.
                      </p>
                    ) : (
                      <p>Real billboards: pay SOL from your in-app wallet, the city buys ORBITX and burns it all. No fee, no cut.</p>
                    )}
                    {adMsg ? <p>{adMsg}</p> : null}
                    <button type="submit" disabled={adBusy}>{adQuoteData ? "Confirm & pay from in-app wallet" : "Get price"}</button>
                    {adQuoteData ? <button type="button" onClick={() => setAdQuoteData(null)}>Change board or days</button> : null}
                  </form>
                )}
                {adOrder ? (
                  <article>
                    <div>
                      <b>{adOrder.board} — {adOrder.status}</b>
                      <span>{adOrder.project} · {adOrder.text}</span>
                      {adOrder.error ? <span>{adOrder.error}</span> : null}
                      {adOrder.swapUrl ? <span><a href={adOrder.swapUrl} target="_blank" rel="noreferrer">{adOrder.burnUrl && adOrder.burnUrl !== adOrder.swapUrl ? "Swap tx" : "Transaction"}</a></span> : null}
                      {adOrder.burnUrl && adOrder.burnUrl !== adOrder.swapUrl ? <span><a href={adOrder.burnUrl} target="_blank" rel="noreferrer">Burn tx</a></span> : null}
                    </div>
                    {adOrder.status === "burn-pending" ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const rt = gameRef.current?.runtime;
                          if (!rt) return;
                          const res = await rt.adRetryBurn(adOrder.id);
                          if (res.ok && (res as { order?: AdOrder }).order) setAdOrder((res as { order: AdOrder }).order);
                          else setAdMsg(String((res as { message?: string }).message || "Retry failed."));
                        }}
                      >
                        Retry burn
                      </button>
                    ) : null}
                  </article>
                ) : null}
                {adOrders.length ? (
                  <div>
                    <p>My ads</p>
                    {adOrders.map((item) => (
                      <article key={item.id}>
                        <div>
                          <b>{item.board} — {item.status}</b>
                          <span>{item.project} · {item.text} · until {String(item.expiresAt || "").slice(0, 10)}</span>
                          {item.burnUrl ? <span><a href={item.burnUrl} target="_blank" rel="noreferrer">Burn tx</a></span> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {panel === "radio" && (
              <div className="list">
                <p className="muted">Free. Upload a song from your phone and it joins the public radio. Only you hear what you play — the playlist is shared, the sound is yours.</p>
                {playingId ? (
                  <article>
                    <div>
                      <b>Now playing</b>
                      <span>{radioTracks.find((item) => item.id === playingId)?.name || ""}</span>
                    </div>
                    <button type="button" onClick={stopRadio}>Stop</button>
                  </article>
                ) : null}
                {radioTracks.length === 0 ? (
                  <p>No tracks yet — upload the first one.</p>
                ) : (
                  radioTracks.map((track) => (
                    <article key={track.id}>
                      <div>
                        <b>{track.name}</b>
                        <span>by {track.uploader}</span>
                      </div>
                      <button type="button" onClick={() => playRadio(track)}>
                        {playingId === track.id ? "Pause" : "Play"}
                      </button>
                    </article>
                  ))
                )}
                <h3>Add a track</h3>
                <label>
                  Audio file — mp3, m4a, wav, ogg, webm, aac or flac, at most 15 MB
                  <input
                    ref={radioInputRef}
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (!file) {
                        setRadioFile(null);
                        return;
                      }
                      if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|webm|aac|flac)$/i.test(file.name)) {
                        setRadioFile(null);
                        setRadioMsg("That is not an audio file (mp3, m4a, wav, ogg, webm, aac, flac).");
                        return;
                      }
                      if (file.size > 15 * 1024 * 1024) {
                        setRadioFile(null);
                        setRadioMsg("That file is over 15 MB.");
                        return;
                      }
                      setRadioFile(file);
                      setRadioMsg(`${file.name} — ${(file.size / 1024 / 1024).toFixed(1)} MB. Press Add to radio when ready.`);
                    }}
                  />
                </label>
                <button type="button" disabled={!radioFile || radioBusy} onClick={() => void uploadRadio()}>
                  {radioBusy ? "Uploading…" : "Add to radio"}
                </button>
                {radioMsg ? <p>{radioMsg}</p> : null}
              </div>
            )}
            {panel === "offices" && (
              <div className="list">
                <p className="muted">
                  Tower offices lease for City Sol — the game&apos;s own money. No real SOL, no ORBITX, nothing burned.
                  One active claim per suite. A lease runs to its end date; releasing early ends it with no refund.
                </p>
                <p>Your balance {snap.balance} City Sol</p>
                {officeMsg ? <p>{officeMsg}</p> : null}
                {offices.length === 0 && !officeMsg ? <p>Loading the directory…</p> : null}
                {([2, 3, 4] as const).map((floor) => (
                  <div key={floor}>
                    <h3>Floor {floor}{floor === 4 ? " — premium" : " — standard"}</h3>
                    {offices
                      .filter((suite) => suite.floor === floor)
                      .map((suite) => (
                        <article key={suite.id}>
                          <div>
                            <b>{suite.name}</b>
                            {suite.claimable ? (
                              <span>
                                Day {suite.prices[1]} · Week {suite.prices[7]} · Month {suite.prices[30]} City Sol
                              </span>
                            ) : (
                              <span>Founder&apos;s Office — OrbitX (not claimable)</span>
                            )}
                            {suite.claim ? (
                              <span>
                                {suite.claim.logo ? (
                                  <img alt="" src={suite.claim.logo} style={{ height: 24, verticalAlign: "middle", marginRight: 6 }} />
                                ) : null}
                                Claimed by {suite.claim.project} until {suite.claim.until}
                                {suite.claim.site ? (
                                  <>
                                    {" "}· <a href={suite.claim.site} target="_blank" rel="noreferrer">Visit site</a>
                                  </>
                                ) : null}
                              </span>
                            ) : suite.claimable ? (
                              <span>Available</span>
                            ) : null}
                          </div>
                          {suite.claimable && !suite.claim ? (
                            <button
                              type="button"
                              onClick={() => {
                                setOfficeSuite(suite.id);
                                setOfficeTerm(7);
                                setOfficeMsg("");
                              }}
                            >
                              Claim
                            </button>
                          ) : null}
                          {suite.claim && suite.claim.owner_id === snap.meId ? (
                            <button
                              type="button"
                              onClick={async () => {
                                if (officeBusy) return;
                                setOfficeBusy(true);
                                const res = await callCity("office-release", { suite: suite.id });
                                triggerHaptic(res.ok ? "success" : "error");
                                setOfficeMsg(String(res.message || ""));
                                if (res.ok && Array.isArray(res.offices)) setOffices(res.offices as OfficeSuiteState[]);
                                setOfficeBusy(false);
                              }}
                            >
                              Release
                            </button>
                          ) : null}
                        </article>
                      ))}
                  </div>
                ))}
                {(() => {
                  const selected = offices.find((suite) => suite.id === officeSuite) || null;
                  if (!selected || !selected.claimable || selected.claim) return null;
                  const price = selected.prices[officeTerm];
                  return (
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (officeBusy) return;
                        setOfficeBusy(true);
                        setOfficeMsg("");
                        const res = await callCity("office-claim", {
                          suite: selected.id,
                          term_days: officeTerm,
                          project: officeProject,
                          logo: officeLogo,
                          site: officeSite,
                        });
                        triggerHaptic(res.ok ? "success" : "error");
                        if (res.ok) {
                          setOfficeMsg(String(res.message || "Claimed."));
                          if (Array.isArray(res.offices)) setOffices(res.offices as OfficeSuiteState[]);
                          setOfficeSuite("");
                          setOfficeProject("");
                          setOfficeLogo("");
                          setOfficeSite("");
                          // The claim deducts City Sol server-side; pull the
                          // fresh balance or the panel keeps showing the
                          // pre-claim number (no timer refreshes it).
                          gameRef.current?.runtime.refreshMe();
                        } else {
                          setOfficeMsg(String(res.message || "Claim failed."));
                        }
                        setOfficeBusy(false);
                      }}
                    >
                      <h3>Claim {selected.name} — Floor {selected.floor}</h3>
                      <div className="days">
                        {([1, 7, 30] as const).map((days) => (
                          <button
                            key={days}
                            type="button"
                            className={officeTerm === days ? "on" : ""}
                            onClick={() => setOfficeTerm(days)}
                          >
                            {days === 1 ? "1 day" : days === 7 ? "7 days" : "30 days"} · {selected.prices[days]} City Sol
                          </button>
                        ))}
                      </div>
                      <label>
                        Project name
                        <input value={officeProject} maxLength={48} onChange={(event) => setOfficeProject(event.target.value)} />
                      </label>
                      <label>
                        Logo URL
                        <input
                          value={officeLogo}
                          maxLength={200}
                          placeholder="https://…"
                          onChange={(event) => setOfficeLogo(event.target.value)}
                        />
                      </label>
                      <label>
                        Site URL
                        <input
                          value={officeSite}
                          maxLength={200}
                          placeholder="https://…"
                          onChange={(event) => setOfficeSite(event.target.value)}
                        />
                      </label>
                      <p>
                        {price} City Sol for {officeTerm === 1 ? "1 day" : officeTerm === 7 ? "7 days" : "30 days"}.
                        Your balance {snap.balance} City Sol.
                        {snap.balance < price ? " Not enough City Sol — play jobs to earn more." : ""}
                      </p>
                      <button type="submit" disabled={officeBusy || snap.balance < price || !officeProject.trim()}>
                        {officeBusy ? "Claiming…" : `Confirm — pay ${price} City Sol`}
                      </button>
                      <button type="button" onClick={() => setOfficeSuite("")}>Cancel</button>
                    </form>
                  );
                })()}
              </div>
            )}
            {panel === "garage" && (
              <div className="list">
                <p className="muted">
                  {snap.universe
                    ? `Your cars live on ${snap.universe.name} — ${snap.universe.isHome ? "your home universe" : "you are visiting"}. Balance ${snap.balance} City Sol.`
                    : "Sign in and pick a universe on the menu to sync cars — until then purchases are saved on this device only."}
                </p>
                {garageMsg ? <p>{garageMsg}</p> : null}
                {CAR_SHOP.map((section) => (
                  <div key={section.title}>
                    <h3>{section.title}</h3>
                    <p className="muted">{section.blurb}</p>
                    {section.ids.map((id) => {
                      const v = getVehicle(id);
                      if (!v) return null;
                      const owned = snap.vehicles.some((car) => car.id === id);
                      const active = snap.activeVehicle === id;
                      const color = garageColors[id] ?? snap.vehicles.find((car) => car.id === id)?.color ?? "black";
                      const afford = snap.balance >= v.price;
                      return (
                        <article key={id}>
                          <div>
                            <b>{v.name}</b>
                            <span>{v.brand} — {v.blurb}</span>
                            <span>Speed {v.stats.speed}/10 · Accel {v.stats.accel}/10 · Handling {v.stats.handling}/10 · {v.stats.seats} seats · {v.price} City Sol</span>
                            {v.fly ? <span>{FLY_CONTROLS.note}</span> : null}
                            {v.kind === "skateboard" ? <span>Push W to go — no reverse.</span> : null}
                            <span className="days">
                              {Object.entries(VEHICLE_COLORS).map(([name, hex]) => (
                                <button
                                  key={name}
                                  type="button"
                                  className={color === name ? "on" : ""}
                                  style={{
                                    background: `#${hex.toString(16).padStart(6, "0")}`,
                                    color: ((hex >> 16) & 255) * 0.299 + ((hex >> 8) & 255) * 0.587 + (hex & 255) * 0.114 > 140 ? "#000" : "#fff",
                                  }}
                                  onClick={() => setGarageColors((prev) => ({ ...prev, [id]: name }))}
                                >
                                  {name}
                                </button>
                              ))}
                            </span>
                          </div>
                          {active ? (
                            <button type="button" disabled>Selected</button>
                          ) : owned ? (
                            <button
                              type="button"
                              disabled={garageBusy}
                              onClick={async () => {
                                const rt = gameRef.current?.runtime;
                                if (!rt || garageBusy) return;
                                setGarageBusy(true);
                                setGarageMsg(await rt.selectCar(id));
                                setGarageBusy(false);
                              }}
                            >
                              Select
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={garageBusy || !afford}
                              onClick={async () => {
                                const rt = gameRef.current?.runtime;
                                if (!rt || garageBusy) return;
                                setGarageBusy(true);
                                setGarageMsg(await rt.buyCar(id, color));
                                setGarageBusy(false);
                              }}
                            >
                              {afford ? `Buy — ${v.price} City Sol` : "Not enough City Sol"}
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {panel === "multiverse" && (
              <div className="list">
                <p className="muted">Your cars, homes, and offices live per universe — travel is free, nothing follows you unless you carry it.</p>
                {universeMsg ? <p>{universeMsg}</p> : null}
                {(universes ?? fallbackUniverses()).map((u) => {
                  const full = isFull(u);
                  const current = snap.universe?.id === u.id;
                  return (
                    <article key={u.id}>
                      <div>
                        <b>{u.displayName}</b>
                        <span>{u.tagline} · {u.playerCount}/{u.cap} players{u.isHome ? " · Home universe" : ""}{current ? " · You are here" : ""}{current && snap.universe && !snap.universe.isHome ? " · Visitor" : ""}</span>
                      </div>
                      <button
                        type="button"
                        disabled={full || current}
                        onClick={async () => {
                          const rt = gameRef.current?.runtime;
                          if (!rt) return;
                          try {
                            if (u.isHome) await rt.joinUniverse(u.id);
                            else await rt.travelUniverse(u.id);
                            close();
                          } catch (err) {
                            setUniverseMsg(err instanceof Error ? err.message : "Could not travel.");
                          }
                        }}
                      >
                        {joinButtonLabel(u)}
                      </button>
                    </article>
                  );
                })}
                {universes && universes.every(isFull) ? <p>{ALL_UNIVERSES_FULL_MESSAGE}</p> : null}
              </div>
            )}
            {panel === "emergency" && (
              <div className="list">
                {(() => {
                  const dept = snap.emergency;
                  if (!dept) return <p className="muted">Walk up to a department — Fire, Police, Hospital, or the Emergency Center — and press E.</p>;
                  const jobId = ({ fire: "fire", police: "cop", hospital: "doctor", emergency: "paramedic" } as Record<string, string>)[dept.kind] ?? "";
                  const roster = JOBS_20.find((job) => job.id === jobId);
                  if (!roster) return <p className="muted">No job listed for {dept.name}.</p>;
                  const pay = Math.round(roster.base * (1 + 0.05 * Math.min(snap.jobStreak, 10)));
                  return (
                    <article>
                      <div>
                        <b>{dept.name}</b>
                        <span>{roster.name} — {roster.duty} Pays {pay} City Sol.</span>
                      </div>
                      <button type="button" onClick={() => { gameRef.current?.runtime.startJob(roster.id); close(); }}>Take job</button>
                    </article>
                  );
                })()}
              </div>
            )}
            {panel === "district-offices" && (
              <div className="list">
                <p className="muted">
                  District offices — {snap.universe ? `${snap.universe.name} · Server ${snap.universe.id}` : "pick a universe on the menu first"}. Claims never cross universes.
                </p>
                <div className="days">
                  {DISTRICTS.map((d) => (
                    <button key={d.id} type="button" className={districtSel === d.id ? "on" : ""} onClick={() => setDistrictSel(d.id)}>
                      {d.name}
                    </button>
                  ))}
                  <button type="button" onClick={() => open("offices")}>HQ (OrbitX Tower)</button>
                </div>
                {districtMsg ? <p>{districtMsg}</p> : null}
                {[2, 3, 4].map((floor) => {
                  const floors = districtOffices.filter((s) => s.floor === floor);
                  if (!floors.length) return null;
                  return (
                    <div key={floor}>
                      <h3>Floor {floor}</h3>
                      {floors.map((suite) => (
                        <article key={suite.id}>
                          <div>
                            <b>{suite.name}</b>
                            <span>{suite.tier} · {suite.prices[1]} City Sol / day · {suite.prices[7]} / week · {suite.prices[30]} / month{suite.claim ? ` · Claimed by ${suite.claim.project} until ${suite.claim.until}` : ""}</span>
                          </div>
                          {suite.claimable && !suite.claim ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDistrictSuite(suite.id);
                                setDistrictTerm(7);
                                setDistrictMsg("");
                              }}
                            >
                              Claim
                            </button>
                          ) : null}
                          {suite.claim && suite.claim.owner_id === snap.meId ? (
                            <button
                              type="button"
                              disabled={districtBusy}
                              onClick={async () => {
                                const rt = gameRef.current?.runtime;
                                if (!rt || districtBusy) return;
                                setDistrictBusy(true);
                                const res = await rt.releaseDistrictOffice(suite.id);
                                triggerHaptic(res.ok ? "success" : "error");
                                setDistrictMsg(res.message);
                                if (res.ok) {
                                  const rows = await rt.loadDistrictOffices(districtSel);
                                  if (rows.ok) setDistrictOffices(rows.offices as DistrictOfficeDirectoryRow[]);
                                }
                                setDistrictBusy(false);
                              }}
                            >
                              Release
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  );
                })}
                {(() => {
                  const selected = districtOffices.find((suite) => suite.id === districtSuite) || null;
                  if (!selected || !selected.claimable || selected.claim) return null;
                  const price = selected.prices[districtTerm];
                  return (
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const rt = gameRef.current?.runtime;
                        if (!rt || districtBusy) return;
                        setDistrictBusy(true);
                        setDistrictMsg("");
                        const res = await rt.claimDistrictOffice(selected.id, districtTerm, districtProject, districtLogo, districtSite);
                        triggerHaptic(res.ok ? "success" : "error");
                        if (res.ok) {
                          setDistrictMsg(res.message);
                          if (Array.isArray(res.offices)) setDistrictOffices(res.offices as DistrictOfficeDirectoryRow[]);
                          setDistrictSuite("");
                          setDistrictProject("");
                          setDistrictLogo("");
                          setDistrictSite("");
                          rt.refreshMe();
                        } else {
                          setDistrictMsg(res.message);
                        }
                        setDistrictBusy(false);
                      }}
                    >
                      <h3>Claim {selected.name} — Floor {selected.floor}</h3>
                      <div className="days">
                        {([1, 7, 30] as const).map((days) => (
                          <button
                            key={days}
                            type="button"
                            className={districtTerm === days ? "on" : ""}
                            onClick={() => setDistrictTerm(days)}
                          >
                            {days === 1 ? "1 day" : days === 7 ? "7 days" : "30 days"} · {selected.prices[days]} City Sol
                          </button>
                        ))}
                      </div>
                      <label>
                        Project name
                        <input value={districtProject} maxLength={48} onChange={(event) => setDistrictProject(event.target.value)} />
                      </label>
                      <label>
                        Logo URL
                        <input value={districtLogo} maxLength={200} placeholder="https://…" onChange={(event) => setDistrictLogo(event.target.value)} />
                      </label>
                      <label>
                        Site URL
                        <input value={districtSite} maxLength={200} placeholder="https://…" onChange={(event) => setDistrictSite(event.target.value)} />
                      </label>
                      <p>
                        {price} City Sol for {districtTerm === 1 ? "1 day" : districtTerm === 7 ? "7 days" : "30 days"}.
                        Your balance {snap.balance} City Sol.
                      </p>
                      <button type="submit" disabled={districtBusy || snap.balance < price}>Claim — {price} City Sol</button>
                    </form>
                  );
                })()}
              </div>
            )}
            {panel === "events" && (
              <div className="list">
                {snap.events.map((item) => (
                  <article key={item.id}>
                    <div>
                      <b>{item.title}</b>
                      <span>{item.when} · {item.where}</span>
                      <span>{item.detail}</span>
                    </div>
                  </article>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    gameRef.current?.runtime.startEvent();
                    close();
                  }}
                >
                  Start fountain lights
                </button>
              </div>
            )}
            {panel === "chat" && (
              <form
                className="list"
                onSubmit={(event) => {
                  event.preventDefault();
                  gameRef.current?.runtime.sendChat(chatText, snap.chatScope);
                  setChatText("");
                }}
              >
                <div className="days">
                  <button type="button" className={snap.chatScope === "global" ? "on" : ""} onClick={() => gameRef.current?.runtime.setChatScope("global")}>
                    Everyone
                  </button>
                  <button type="button" className={snap.chatScope === "near" ? "on" : ""} onClick={() => gameRef.current?.runtime.setChatScope("near")}>
                    Nearby
                  </button>
                </div>
                <div className="chat-log">
                  {snap.chat.length === 0 ? <span>No messages yet. Open another tab to see someone else.</span> : null}
                  {snap.chat.map((line, index) => (
                    <p key={`${line.id}-${index}`}>
                      <b>{line.self ? "You" : line.name}</b> {line.text}
                    </p>
                  ))}
                </div>
                <input
                  value={chatText}
                  placeholder="Say something"
                  onChange={(event) => setChatText(event.target.value)}
                  onFocus={() => gameRef.current?.runtime.setTyping(true)}
                  onBlur={() => gameRef.current?.runtime.setTyping(false)}
                />
                <button type="submit">Send</button>
              </form>
            )}
            {panel === "phone" && <Phone snap={snap} rt={gameRef.current?.runtime ?? null} onLogout={() => {
              void signOutAccount().then(() => {
                close();
                setWho(null);
                setGate("login");
                setMenu(true);
                setMenuStep("home");
                gameRef.current?.start(parseSeed(seedText || "1"), "orbit");
              });
            }} />}
            <FeaturePanel snap={{ ...snap, panel: panel as PanelName | "" }} rt={gameRef.current?.runtime ?? null} />
            {panel === "home" && (() => {
              const zoneId = snap.indoors || "";
              const mineList = (
                <>
                  {homeMine.length ? <h3>Your homes on this universe{homeServer ? ` — Server ${homeServer}` : ""}</h3> : null}
                  {homeMine.map((h) => {
                    const def = homeById(h.homeId);
                    return (
                      <article key={`${h.homeId}:${h.server}`}>
                        <div>
                          <b>{def?.name ?? h.homeId}</b>
                          <span>{h.price} City Sol · Server {h.server}</span>
                        </div>
                      </article>
                    );
                  })}
                  {homeMsg ? <p>{homeMsg}</p> : null}
                </>
              );
              if (!zoneId.startsWith("home-")) {
                return (
                  <div className="list">
                    <p className="muted">Stand inside a state home to buy it — homes are priced per state, in City Sol.</p>
                    {mineList}
                  </div>
                );
              }
              const home = homeById(zoneId);
              if (!home) {
                return (
                  <div className="list">
                    <p className="muted">This home is not for sale.</p>
                    {mineList}
                  </div>
                );
              }
              const owned = homeMine.some((h) => h.homeId === zoneId);
              const price = homePrice(zoneId) ?? home.price;
              const afford = snap.balance >= price;
              return (
                <div className="list">
                  <article>
                    <div>
                      <b>{home.name}</b>
                      <span>{price} City Sol · {owned ? "Yours on this universe" : "Not owned yet"}</span>
                    </div>
                    <button
                      type="button"
                      disabled={owned || !afford}
                      onClick={async () => {
                        const rt = gameRef.current?.runtime;
                        if (!rt) return;
                        setHomeMsg(await rt.buyHome(zoneId));
                        const res = await rt.homeStatus();
                        if (res.ok) {
                          setHomeMine(res.mine);
                          setHomeServer(res.homeServer);
                        }
                      }}
                    >
                      {owned ? "Owned" : afford ? `Buy — ${price} City Sol` : "Not enough City Sol"}
                    </button>
                  </article>
                  {mineList}
                </div>
              );
            })()}
            {panel === "menu" && (
              <div className="list">
                <p>{HELP} · P phone · N day/night · V push to talk · 1-4 emotes</p>
                <p>Server: {snap.server || snap.netMode}. Quality {snap.quality}. Time {snap.time}.</p>
                <div className="days">
                  {(["low", "medium", "high"] as const).map((level) => (
                    <button key={level} type="button" className={snap.quality === level ? "on" : ""} onClick={() => gameRef.current?.runtime.setQuality(level)}>
                      {level}
                    </button>
                  ))}
                  <button type="button" onClick={() => gameRef.current?.runtime.cycleTime()}>Time: {snap.time}</button>
                </div>
                <button type="button" onClick={() => gameRef.current?.runtime.setHaptics(!snap.haptics)}>
                  Haptics: {snap.haptics ? "On" : "Off"}
                </button>
                <p>On a phone, use the stick to move, drag the right side to look, pinch to zoom, and the Camera button to change view.</p>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setMenu(true);
                    setMenuStep("home");
                    gameRef.current?.start(parseSeed(seedText || "1"), "orbit");
                  }}
                >
                  Back to title
                </button>
              </div>
            )}
            {panel === "lift" && snap.lift && (
              <div className="list">
                <p>You are in the lift. Pick a floor — the doors close and the cab rides.</p>
                {snap.lift.floors.map((floor, i) => (
                  <article key={i}>
                    <div>
                      <b>{snap.lift!.stops[i] ?? `Floor ${i + 1}`}</b>
                      <span>{i === snap.lift!.current ? "You are here" : `Level ${floor}`}</span>
                    </div>
                    <button
                      type="button"
                      disabled={i === snap.lift!.current}
                      onClick={() => {
                        gameRef.current?.runtime.rideLift(i);
                        close();
                      }}
                    >
                      {i === snap.lift!.current ? "Here" : "Go"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}
      {menu && (
        <section className={menuStep === "roster" ? "menu menu-roster" : "menu"} id="menu">
          {menu && looksFailed ? (
            <p
              className="menu-warning"
              style={{ background: "#f4f6fa", color: "#111318", padding: "10px 14px", borderRadius: 8, maxWidth: 560, margin: "12px auto", textAlign: "center" }}
            >
              Character list failed to load — only TJR is available right now. Check your connection and reload to see all twelve characters.
            </p>
          ) : null}
          {menuStep === "home" ? (
            <MenuHome
              gate={gate}
              who={who}
              onChoose={() => setMenuStep("roster")}
              onAccount={(account) => {
                setWho(account);
                setGate("city");
              }}
              onGuest={() => {
                setWho(null);
                setGate("city");
              }}
              onBackToLogin={() => {
                setGate("login");
                setWho(null);
              }}
            />
          ) : (
            <>
              <div className="card menu-wide">
                <h2>Pick your universe</h2>
                <p className="muted">Your cars, homes, and offices live per universe. Travel between them is free — nothing follows you unless you carry it. Pick one before you play; you can travel in-world later.</p>
                <div className="days">
                  {(universes ?? fallbackUniverses()).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={universeSel === u.id ? "on" : ""}
                      disabled={isFull(u)}
                      onClick={() => {
                        triggerHaptic("tap");
                        setUniverseSel(u.id);
                        gameRef.current?.runtime.setUniverse(u.id);
                      }}
                    >
                      {u.displayName} · {u.playerCount}/{u.cap}
                      {u.isHome ? " · Home" : ""}
                      {isFull(u) ? " · Full" : ""}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  Selected: {universeDisplayName(universeSel as 1 | 2 | 3 | 4 | 5)}
                  {(universes ?? []).find((u) => u.id === universeSel)?.isHome ? " — your home universe" : ""}
                </p>
              </div>
              <div className="card menu-wide">
              <CharacterSelect
                seedText={seedText}
                setSeedText={setSeedText}
                webglMissing={webglMissing}
                busy={busy}
                onPlay={play}
                onBack={() => setMenuStep("home")}
              />
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}

// Minimap block fill colors by facade style (glass, brick, concrete, cream, neon, OrbitX dark).
const MAP_BLOCK_COLORS: Record<number, string> = {
  0: "#1d3247",
  1: "#8a4a34",
  2: "#8b9096",
  3: "#cfc4a8",
  4: "#232a38",
  5: "#10141c",
};

const MAP_LABELS: Record<string, string> = {
  shop: "Shop",
  cafe: "Cafe",
  bank: "Bank",
  garage: "Garage",
  arcade: "Arcade",
  market: "Market",
  hall: "Hall",
  dock: "Dock",
  cinema: "Cinema",
  library: "Library",
  gym: "Gym",
  park: "Park",
  stadium: "Stadium",
  museum: "Museum",
  casino: "Casino",
  nightclub: "Club",
  hotel: "Hotel",
};

// Label priority: the plaza core gets its preferred spot first; the z=54
// row (Shop/Cafe/Arcade/Garage) is the crowded one, so the order matters.
const MAP_LABEL_PRIORITY = ["shop", "cafe", "hall", "dock", "bank", "market", "arcade", "garage", "cinema", "library", "gym", "park", "stadium", "museum", "casino", "nightclub", "hotel"];

// Job board — single source of truth for the base pay the server pays
// (api/city.js JOBS, plus the +5%-per-streak scaling in scaledPay).
const JOB_LIST_BASE: Array<{ id: string; name: string; desc: string; base: number }> = [
  { id: "courier", name: "Courier", desc: "Pick up a package at the fountain and drop it at the shop.", base: 45 },
  { id: "taxi", name: "Taxi driver", desc: "Three fares around the city — pick up, drop off, repeat.", base: 90 },
  { id: "guide", name: "City guide", desc: "Visit the shop, the hall, and OrbitX HQ.", base: 60 },
  { id: "barista", name: "Barista", desc: "Serve the shift at Cafe Nova.", base: 45 },
  { id: "vendor", name: "Market vendor", desc: "Open a stall at the Night Market.", base: 55 },
  { id: "security", name: "Security", desc: "Patrol the fountain, the hall, and OrbitX HQ.", base: 75 },
  { id: "mail", name: "Mail carrier", desc: "Collect the bag at the Jobs board, then deliver to two homes and a project office.", base: 70 },
  { id: "lifeguard", name: "Lifeguard", desc: "Walk the harbor pier and scan the water at all three posts.", base: 65 },
  { id: "cleaner", name: "Street cleaner", desc: "Sweep five litter spots around the plaza — stand still to sweep each one.", base: 55 },
  { id: "bus", name: "Bus driver", desc: "Run the city bus — four stops, pause at each to board riders.", base: 80 },
  { id: "fire", name: "Firefighter", desc: "Answer three smoke reports — stand at each fire to put it out.", base: 75 },
  { id: "doctor", name: "Doctor", desc: "Run the hall clinic — treat three patients, one at a time.", base: 70 },
  { id: "teacher", name: "Teacher", desc: "Take the class on a field trip — library, park, then the fountain.", base: 60 },
  { id: "mechanic", name: "Mechanic", desc: "Service the hover-car on the east road.", base: 55 },
  { id: "photographer", name: "Photographer", desc: "Shoot the fountain, then the ORBITX tower.", base: 40 },
  { id: "promoter", name: "Promoter", desc: "Visit the hall, then the plaza ad kiosk.", base: 50 },
  { id: "dock", name: "Dock hand", desc: "Clock in at the harbor office, down the pier.", base: 65 },
  { id: "dj", name: "DJ", desc: "Play a set inside the Community Hall.", base: 55 },
  { id: "banker", name: "Bank teller", desc: "Open the window at OrbitX Bank.", base: 50 },
];

// Cop + paramedic join the roster; fire/doctor get their extended duties
// from emergency.ts. Photographer stays playable — it is just not in the
// curated 20 (JOBS_20, rendered separately in the jobs panel).
const JOB_LIST = [
  ...JOB_LIST_BASE.map((job) =>
    JOB_LIST_DESC_UPDATES[job.id] ? { ...job, desc: JOB_LIST_DESC_UPDATES[job.id] } : job,
  ),
  ...JOB_LIST_ADDITION,
];

// Offline multiverse roster (no counts, no home badge) — the picker still
// records the choice so play() can join that universe once signed in.
function fallbackUniverses(): Universe[] {
  return UNIVERSE_IDS.map((id) => ({
    id,
    name: UNIVERSE_META[id].name,
    displayName: universeDisplayName(id),
    tagline: UNIVERSE_META[id].tagline,
    cap: 150,
    playerCount: 0,
    status: "open" as const,
    isHome: false,
    realtimeEndpoint: null,
  }));
}

// Minimap: 132px (was 168 — smaller, but still big enough to read the
// roads, the player dot, and the venue labels). Draggable — the player can
// put it anywhere on screen; the spot persists in localStorage.
const MINIMAP_SIZE = 132;
const MINIMAP_STORAGE_KEY = "orbitx-minimap-pos";

type MinimapPos = { x: number; y: number };

// The canvas is 132px plus a 1px border on each side, so the wrapper's
// outer box is 134px — clamp/dock against that, or the border pokes off
// the edge when the map sits at the far right / bottom.
const MINIMAP_OUTER = MINIMAP_SIZE + 2;

function clampMinimapPos(pos: MinimapPos): MinimapPos {
  return {
    x: Math.max(0, Math.min(pos.x, window.innerWidth - MINIMAP_OUTER)),
    y: Math.max(0, Math.min(pos.y, window.innerHeight - MINIMAP_OUTER)),
  };
}

// Same touch check the runtime uses — read directly, not from snap.touch:
// snap.touch starts false and flips to true after the world starts, so a
// prop would pick the desktop default on a phone at mount time.
function isTouchDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
}

function minimapDefaultPos(): MinimapPos {
  const x = Math.max(0, window.innerWidth - MINIMAP_OUTER - 10);
  // Touch: bottom-right, above the pad-buttons (~176px tall) AND above
  // the driving Gas/Brake buttons (they top out at ~244px while driving,
  // so the map's bottom sits at 256px — 12px clear of them, 80px clear
  // of the pad grid). Desktop: bottom-right corner, nothing else lives
  // there.
  const bottom = isTouchDevice() ? 256 : 12;
  return { x, y: Math.max(0, window.innerHeight - MINIMAP_OUTER - bottom) };
}

function loadMinimapPos(): MinimapPos {
  try {
    const raw = localStorage.getItem(MINIMAP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MinimapPos>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number" && isFinite(parsed.x) && isFinite(parsed.y)) {
        return clampMinimapPos({ x: parsed.x, y: parsed.y });
      }
    }
  } catch {
    // Corrupt or unavailable storage — fall through to the default spot.
  }
  return minimapDefaultPos();
}

function Minimap({ me, people, seed }: { me: Snap["me"]; people: Snap["people"]; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Offscreen static layer (blocks, roads, venue labels, north marker).
  // It used to be redrawn on every snap (5 Hz) together with the moving
  // dots — the label-placement search alone is ~17 labels x 8 candidates
  // x overlap checks, 5x/sec, for a picture that never changes. Now it is
  // drawn once per model and the live effect only blits it + the dots.
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const [pos, setPos] = useState<MinimapPos>(() => loadMinimapPos());
  const posRef = useRef(pos);
  const [dragging, setDragging] = useState(false);
  const model = useMemo(() => cityMapModel(seed), [seed]);

  // Keep the latest position in a ref so the drag-end save always has the
  // final spot, even if the pointer-up lands between renders.
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  // Keep a saved spot on screen after a resize / rotation.
  useEffect(() => {
    const onResize = () => setPos((p) => clampMinimapPos(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Static map layer: background, harbor, blocks, plaza, roads, venue
  // dots + labels, north marker. Drawn once per model into the offscreen
  // canvas. Labels only avoid each other here (not the live player dot —
  // the dot is drawn on top with its white ring, so it stays visible if
  // it ever sits on a label).
  useEffect(() => {
    let off = staticRef.current;
    if (!off) {
      off = document.createElement("canvas");
      off.width = MINIMAP_SIZE;
      off.height = MINIMAP_SIZE;
      staticRef.current = off;
    }
    const ctx = off.getContext("2d");
    if (!ctx) return;
    const size = off.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
    ctx.fillRect(0, 0, size, size);
    // Fit the full extent (harbor included) — no hardcoded scale.
    const spanX = model.maxX - model.minX;
    const spanZ = model.maxZ - model.minZ;
    const scale = (size - 12) / Math.max(spanX, spanZ);
    const offX = (size - spanX * scale) / 2;
    const offZ = (size - spanZ * scale) / 2;
    const plot = (x: number, z: number) =>
      [offX + (x - model.minX) * scale, offZ + (z - model.minZ) * scale] as const;
    // Harbor water.
    const [hx, hz] = plot(model.harbor.x, model.harbor.z);
    ctx.fillStyle = "#14568f";
    ctx.fillRect(hx, hz, model.harbor.w * scale, model.harbor.d * scale);
    // Building blocks, colored by facade style; the tower is gold.
    for (const block of model.blocks) {
      const [bx, bz] = plot(block.x, block.z);
      ctx.fillStyle = block.hero ? "#e0b33a" : MAP_BLOCK_COLORS[block.style] ?? "#232a38";
      ctx.fillRect(bx, bz, Math.max(1.5, block.w * scale), Math.max(1.5, block.d * scale));
    }
    // Plaza outline.
    const [px, pz] = plot(model.plaza.x, model.plaza.z);
    ctx.strokeStyle = "#e0b33a";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.5, pz + 0.5, model.plaza.w * scale, model.plaza.d * scale);
    // Road grid.
    ctx.strokeStyle = "rgba(126,246,255,0.28)";
    ctx.lineWidth = 1;
    for (const c of model.roads) {
      const [rx] = plot(c, model.minZ);
      ctx.beginPath();
      ctx.moveTo(rx, offZ);
      ctx.lineTo(rx, offZ + spanZ * scale);
      ctx.stroke();
      const [, rz] = plot(model.minX, c);
      ctx.beginPath();
      ctx.moveTo(offX, rz);
      ctx.lineTo(offX + spanX * scale, rz);
      ctx.stroke();
    }
    // Venue dots + labels. Every label tries 8 positions around its dot
    // (right/left/above/below + diagonals) and picks the one with the
    // least overlap against already-placed labels, with a thin leader
    // line back to its dot when it is not adjacent.
    ctx.font = "6px sans-serif";
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const byId = new Map(model.venues.map((venue) => [venue.id, venue]));
    const overlapArea = (r: { x0: number; y0: number; x1: number; y1: number }) =>
      placed.reduce((sum, other) => {
        const ox = Math.max(0, Math.min(r.x1, other.x1) - Math.max(r.x0, other.x0));
        const oy = Math.max(0, Math.min(r.y1, other.y1) - Math.max(r.y0, other.y0));
        return sum + ox * oy;
      }, 0);
    for (const id of MAP_LABEL_PRIORITY) {
      const venue = byId.get(id);
      const label = MAP_LABELS[id];
      if (!venue || !label) continue;
      const [vx, vz] = plot(venue.x, venue.z);
      ctx.fillStyle = "#e0b33a";
      ctx.beginPath();
      ctx.arc(vx, vz, 2, 0, Math.PI * 2);
      ctx.fill();
      const w = label.length * 3.6;
      const h = 6;
      const candidates = [
        { dx: 5, dy: -3 },
        { dx: -5 - w, dy: -3 },
        { dx: -w / 2, dy: -11 },
        { dx: -w / 2, dy: 5 },
        { dx: 5, dy: 5 },
        { dx: -5 - w, dy: 5 },
        { dx: 5, dy: -11 },
        { dx: -5 - w, dy: -11 },
      ];
      let best: { x0: number; y0: number; x1: number; y1: number } | null = null;
      let bestScore = Infinity;
      for (const cand of candidates) {
        const x0 = Math.max(2, Math.min(size - 2 - w, vx + cand.dx));
        const y0 = Math.max(13, Math.min(size - 8, vz + cand.dy));
        const rect = { x0, y0, x1: x0 + w, y1: y0 + h };
        const score = overlapArea(rect);
        if (score < bestScore) {
          bestScore = score;
          best = rect;
          if (score === 0) break;
        }
      }
      if (!best) continue;
      placed.push({ x0: best.x0 - 1, y0: best.y0 - 1, x1: best.x1 + 1, y1: best.y1 + 1 });
      // Leader line from the dot to the label edge (skip when adjacent).
      const cx = Math.max(best.x0, Math.min(vx, best.x1));
      const cy = Math.max(best.y0, Math.min(vz, best.y1));
      if (Math.hypot(cx - vx, cy - vz) > 6) {
        ctx.strokeStyle = "rgba(232,246,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vx, vz);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      ctx.fillStyle = "#e8f6ff";
      ctx.textAlign = "left";
      // Dark halo so the white label stays readable over the light blocks.
      ctx.strokeStyle = "rgba(4, 8, 14, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeText(label, best.x0, best.y0 + 6);
      ctx.fillText(label, best.x0, best.y0 + 6);
    }
    ctx.textAlign = "left";
    // North marker.
    ctx.fillStyle = "#7ef6ff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", size / 2, 10);
    ctx.textAlign = "left";
  }, [model]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    const off = staticRef.current;
    if (off) ctx.drawImage(off, 0, 0);
    // Fit the full extent (harbor included) — same scale as the static
    // layer, so the dots land on the right spots.
    const spanX = model.maxX - model.minX;
    const spanZ = model.maxZ - model.minZ;
    const scale = (size - 12) / Math.max(spanX, spanZ);
    const offX = (size - spanX * scale) / 2;
    const offZ = (size - spanZ * scale) / 2;
    const plot = (x: number, z: number) =>
      [offX + (x - model.minX) * scale, offZ + (z - model.minZ) * scale] as const;
    const [mx, mz] = plot(me.x, me.z);
    // Other players.
    for (const person of people) {
      const [ppx, ppz] = plot(person.x, person.z);
      ctx.fillStyle = person.speaking ? "#7ef6ff" : "#f4f6fa";
      ctx.beginPath();
      ctx.arc(ppx, ppz, person.speaking ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player: gold dot with a white ring.
    ctx.fillStyle = "#e0b33a";
    ctx.beginPath();
    ctx.arc(mx, mz, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, mz, 5.5, 0, Math.PI * 2);
    ctx.stroke();
  }, [me, people, model]);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can throw for synthetic pointers — the move handler still
      // tracks while the pointer stays over the map.
    }
    dragRef.current = { px: event.clientX, py: event.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPos(clampMinimapPos({ x: drag.ox + event.clientX - drag.px, y: drag.oy + event.clientY - drag.py }));
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      localStorage.setItem(MINIMAP_STORAGE_KEY, JSON.stringify(posRef.current));
    } catch {
      // Storage unavailable (private mode) — the spot just does not persist.
    }
  };
  return (
    <div
      className={`minimap-wrap${dragging ? " dragging" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="Minimap — drag to move it"
      title="Drag to move the minimap"
    >
      <span className="minimap-grip" aria-hidden="true">⋮⋮</span>
      <canvas ref={ref} className="minimap" width={MINIMAP_SIZE} height={MINIMAP_SIZE} />
    </div>
  );
}

function Phone({ snap, rt, onLogout }: { snap: Snap; rt: Runtime | null; onLogout: () => void }) {
  const rooms = snap.lobbies.length
    ? snap.lobbies
    : [
        { id: "plaza", name: "Plaza", members: [] },
        { id: "district", name: "Project District", members: [] },
        { id: "hall", name: "Community Hall", members: [] },
        { id: "cafe", name: "Cafe Nova", members: [] },
        { id: "shop", name: "OrbitX Shop", members: [] },
      ];
  return (
    <div className="list phone">
      <div className="who">
        {snap.avatar ? <img alt="" src={snap.avatar} /> : <i>{(snap.name || "G").slice(0, 1).toUpperCase()}</i>}
        <b>{snap.name || "Guest"}</b>
        <span>{snap.account ? snap.email || "Account" : "Guest"}</span>
      </div>
      <p>
        {snap.name} · {snap.server || "offline profile"} · voice {snap.voiceProvider || "not joined"}
      </p>
      <button id="logout" type="button" onClick={onLogout}>Log out</button>
      {snap.voiceError ? <p>{snap.voiceError}</p> : null}
      {snap.profile ? (
        <article>
          <div>
            <b>{snap.profile.name}</b>
            <span>
              {snap.profile.color} suit · {snap.profile.hat} · {snap.profile.speaking ? "speaking" : "quiet"}
            </span>
          </div>
          <button type="button" onClick={() => rt?.friendAsk(snap.profile?.id || "")}>Add friend</button>
          <button type="button" onClick={() => rt?.partyInvite(snap.profile?.id || "")}>Invite</button>
        </article>
      ) : null}
      <PhoneExtra snap={snap} rt={rt} />
      <h3>City tour</h3>
      <span>{snap.mission >= 6 ? "Tour complete." : `Stop ${snap.mission + 1} of 6 is marked on the objective.`}</span>
      <h3>Places</h3>
      {snap.districts.filter((place) => ["shop", "cafe", "hall", "bank", "garage", "arcade", "market", "dock", "project-0"].includes(place.id)).map((place) => (
        <article key={place.id}>
          <div><b>{place.name}</b></div>
          <button type="button" onClick={() => { rt?.travel(place.id); }}>Go</button>
        </article>
      ))}
      <h3>Burn board</h3>
      {snap.board.length === 0 ? <span>Burn some City Sol and your name can land here.</span> : null}
      {snap.board.map((row) => (
        <article key={row.name}>
          <div><b>{row.name}</b><span>{row.burned} burned</span></div>
        </article>
      ))}
      <h3>People here</h3>
      <article>
        <div>
          <b>You · {snap.name || "Guest"}</b>
          <span>{snap.lookName}</span>
        </div>
      </article>
      {snap.people.map((person) => (
        <article key={person.id}>
          <div>
            <b>{person.name} {person.speaking ? "●" : ""}</b>
            <span>{person.look ? `${person.look} · ` : ""}{person.lobby || "in the street"}</span>
          </div>
          <button type="button" onClick={() => rt?.inspect(person.id)}>Profile</button>
        </article>
      ))}
      <h3>Voice lobbies</h3>
      {rooms.map((room) => (
        <article key={room.id}>
          <div>
            <b>{room.name}</b>
            <span>
              {room.members.length ? room.members.map((member) => `${member.name}${member.speaking ? " ●" : ""}`).join(", ") : "empty"}
            </span>
          </div>
          <button type="button" onClick={() => rt?.joinLobby(room.id)}>{snap.lobby === room.id ? "In room" : "Join"}</button>
        </article>
      ))}
      <div className="days">
        <button type="button" onClick={() => rt?.leaveLobby()}>Leave voice</button>
        <button type="button" className={snap.muted ? "on" : ""} onClick={() => rt?.setMuted(!snap.muted)}>Mute</button>
        <button type="button" className={snap.deafened ? "on" : ""} onClick={() => rt?.setDeafened(!snap.deafened)}>Deafen</button>
        <button type="button" className={snap.pushToTalk ? "on" : ""} onClick={() => rt?.setPushToTalk(!snap.pushToTalk)}>Push to talk</button>
        <button type="button" onClick={() => rt?.emote("wave")}>Wave</button>
      </div>
      <h3>Friends</h3>
      {snap.requests.map((req) => (
        <article key={req.id}>
          <div><b>{req.name}</b><span>wants to be friends</span></div>
          <button type="button" onClick={() => rt?.friendAccept(req.id)}>Accept</button>
        </article>
      ))}
      {snap.friends.map((friend) => (
        <article key={friend.id}>
          <div><b>{friend.name}</b></div>
          <button type="button" onClick={() => rt?.partyInvite(friend.id)}>Party</button>
        </article>
      ))}
      <h3>Party</h3>
      <span>{snap.party.length ? snap.party.map((member) => member.name).join(", ") : "No party yet."}</span>
      <button type="button" onClick={() => rt?.partyInvite("")}>Start a party</button>
      {snap.people[0] ? (
        <label>
          Volume for {snap.people[0].name}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={1}
            onChange={(event) => rt?.setVolume(snap.people[0].id, Number(event.target.value))}
          />
        </label>
      ) : null}
    </div>
  );
}

function Stick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const move = (clientX: number, clientY: number) => {
    const rect = base.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let x = (clientX - cx) / (rect.width / 2);
    let y = (cy - clientY) / (rect.height / 2);
    const mag = Math.hypot(x, y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }
    setKnob({ x, y });
    onChange(x, y);
  };
  return (
    <div
      className="stick"
      ref={base}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.stopPropagation();
        move(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        move(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setKnob({ x: 0, y: 0 });
        onChange(0, 0);
      }}
    >
      <span className="knob" style={{ transform: `translate(${knob.x * 28}px, ${-knob.y * 28}px)` }} />
    </div>
  );
}

function LookPad({ onLook }: { onLook: (dx: number, dy: number) => void }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      className="look-pad"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button, .stick")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        last.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (!last.current) return;
        onLook((event.clientX - last.current.x) * 0.0045, (event.clientY - last.current.y) * 0.0045);
        last.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => {
        last.current = null;
      }}
    />
  );
}

function Hold({ label, onDown, onUp }: { label: string; onDown: () => void; onUp: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onDown();
      }}
      onPointerUp={() => onUp()}
      onPointerCancel={() => onUp()}
    >
      {label}
    </button>
  );
}
