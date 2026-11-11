import { useEffect, useMemo, useRef, useState } from "react";
import { createGame, type Game, type PlayMode } from "./game/engine";
import type { PanelName, Runtime, Snap } from "./game/runtime";
import { AD_PRICE } from "./game/content";
import { parseSeed } from "./game/seed";
import { cityMapModel } from "./game/city";
import { Roster } from "./Roster";
import { AuthPanel } from "./AuthPanel";
import { signOutAccount, type Account } from "./auth";
import { DecorBar, EmoteWheel, FeaturePanel, PhoneExtra, RaceBanner, SpectateBar, featureTitle } from "./Features";
import { EMPTY_LEADERS, EMPTY_RACE } from "./game/life";

const HELP =
  "WASD move · click or drag to look · arrows or Q/R turn · Space jump · F fly · E use or drive · C camera · hold Z emotes · O spectator · T chat · V talk";

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
    shot === "leaders" ||
    shot === "race" ||
    shot === "race-run" ||
    shot === "hover" ||
    shot === "arcade" ||
    shot === "daily" ||
    shot === "wallet" ||
    shot === "emote" ||
    shot === "spectate" ||
    shot === "spectate-ui" ||
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
  const [busy, setBusy] = useState(false);
  const [seedText, setSeedText] = useState(() => new URLSearchParams(window.location.search).get("seed") ?? "");
  const [seed, setSeed] = useState(() => parseSeed(new URLSearchParams(window.location.search).get("seed") ?? "1"));
  const [status, setStatus] = useState("");
  const [webglMissing, setWebglMissing] = useState(false);
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [panel, setPanel] = useState<PanelName | "">("");
  const [adText, setAdText] = useState("ORBITX LIVE");
  const [adId, setAdId] = useState("plaza-east");
  const [adDays, setAdDays] = useState<1 | 7 | 30>(7);
  const [chatText, setChatText] = useState("");
  const [gate, setGate] = useState<"login" | "city">("login");
  const [who, setWho] = useState<Account | null>(null);

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

  const open = (name: PanelName) => {
    setPanel(name);
    const lock = name !== "chat";
    gameRef.current?.runtime.setPaused(lock);
    if (lock) document.exitPointerLock();
  };

  const close = () => {
    setPanel("");
    gameRef.current?.runtime.setPaused(false);
    gameRef.current?.runtime.setTyping(false);
  };

  const play = () => {
    const game = gameRef.current;
    const canvas = canvasRef.current;
    if (!game || !canvas || busy) return;
    setBusy(true);
    const startSeed = parseSeed(seedText);
    setSeed(startSeed);
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

  const price = AD_PRICE[adDays];
  const burn = gameRef.current?.runtime.quote(price) ?? Math.max(1, Math.round(price * 0.25));

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
          <strong>DEMO ORBITX {snap.balance}</strong>
          {snap.holder ? <span>HOLDER</span> : null}
          <span>Burned {snap.burned}</span>
          <span>{snap.jobTitle ? `${snap.jobTitle} — ${snap.objective}` : snap.objective}</span>
          {snap.eventLabel ? <span>{snap.eventLabel}</span> : null}
          {snap.notice ? <em>{snap.notice}</em> : null}
          <span className="quiet">
            {snap.others + 1} in the city · {snap.camLabel} · {snap.lookName}
          </span>
          <Minimap me={snap.me} people={snap.people} seed={seed} />
        </div>
      )}
      {!menu && snap.prompt && !snap.hideHud ? <p className="prompt">{snap.prompt}</p> : null}
      {!menu && !snap.hideHud && (
        <div className="actions">
          <button type="button" onClick={() => open("shop")}>Shop</button>
          <button type="button" onClick={() => open("jobs")}>Jobs</button>
          <button type="button" onClick={() => open("ads")}>Ads</button>
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
            <button type="button" onClick={() => gameRef.current?.runtime.toggleFly()}>Fly</button>
            <Hold label="Down" onDown={() => gameRef.current?.runtime.hold("down", true)} onUp={() => gameRef.current?.runtime.hold("down", false)} />
            <button type="button" onClick={() => gameRef.current?.runtime.interact()}>Use</button>
            <button type="button" onClick={() => gameRef.current?.runtime.cycleCamera()}>Camera</button>
            <button type="button" onClick={() => open("chat")}>Chat</button>
            <button type="button" onClick={() => open("shop")}>Shop</button>
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
            <button type="button" onClick={() => gameRef.current?.runtime.toggleSpectator()}>Clip</button>
          </div>
        </div>
      ) : null}
      {panel ? (
        <section className="panel-wrap" id="panel">
          <div className="panel" role="dialog">
            <header>
              <strong>
                {panel === "shop" && "OrbitX shop"}
                {panel === "jobs" && "Jobs"}
                {panel === "ads" && "Book a billboard"}
                {panel === "events" && "Events"}
                {panel === "chat" && "Chat"}
                {panel === "phone" && "Phone"}
                {panel === "menu" && "Menu"}
                {featureTitle(panel)}
              </strong>
              <button type="button" onClick={close}>Close</button>
            </header>
            <p className="demo">Shop, jobs, property, and the arcade use demo credits only. They are not the in-app Solana wallet and cannot be cashed out.</p>
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
                        <span>{item.price} demo ORBITX · burns {part}</span>
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
            {panel === "jobs" && (
              <div className="list">
                <article>
                  <div>
                    <b>Courier</b>
                    <span>Pick up a package at the fountain and drop it at the shop. Pays 45.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("courier"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Taxi driver</b>
                    <span>Drive a hover-car, pick up a rider, drop them at the cafe. Pays 70.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("taxi"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>City guide</b>
                    <span>Visit the shop, the hall, and OrbitX HQ. Pays 60.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("guide"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Mechanic</b>
                    <span>Service the hover-car on the east road. Pays 55.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("mechanic"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Photographer</b>
                    <span>Shoot the fountain, then the ORBITX tower. Pays 40.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("photographer"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Promoter</b>
                    <span>Visit the hall, then the plaza ad kiosk. Pays 50.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("promoter"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Dock hand</b>
                    <span>Clock in at the harbor office, down the pier. Pays 65.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("dock"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>DJ</b>
                    <span>Play a set inside the Community Hall. Pays 55.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("dj"); close(); }}>Start</button>
                </article>
                <article>
                  <div>
                    <b>Bank teller</b>
                    <span>Open the window at OrbitX Bank. Pays 50.</span>
                  </div>
                  <button type="button" onClick={() => { gameRef.current?.runtime.startJob("banker"); close(); }}>Start</button>
                </article>
              </div>
            )}
            {panel === "ads" && (
              <form
                className="list"
                onSubmit={(event) => {
                  event.preventDefault();
                  gameRef.current?.runtime.book(adId, adDays, adText);
                }}
              >
                <label>
                  Billboard
                  <select value={adId} onChange={(event) => setAdId(event.target.value)}>
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
                    <button key={days} type="button" className={adDays === days ? "on" : ""} onClick={() => setAdDays(days)}>
                      {days} day{days === 1 ? "" : "s"} · {AD_PRICE[days]}
                    </button>
                  ))}
                </div>
                <p>
                  Price {price} demo ORBITX. Burned on this purchase: {burn}. Running burned total: {snap.burned}.
                </p>
                <button type="submit">Book it</button>
              </form>
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
                gameRef.current?.start(parseSeed(seedText || "1"), "orbit");
              });
            }} />}
            <FeaturePanel snap={{ ...snap, panel }} rt={gameRef.current?.runtime ?? null} />
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
                <p>On a phone, use the stick to move, drag the right side to look, pinch to zoom, and the Camera button to change view.</p>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setMenu(true);
                    gameRef.current?.start(parseSeed(seedText || "1"), "orbit");
                  }}
                >
                  Back to title
                </button>
              </div>
            )}
          </div>
        </section>
      ) : null}
      {menu && (
        <section className="menu" id="menu">
          <div className="card wide">
            <h1>ORBITX CITY</h1>
            {gate === "login" ? (
              <AuthPanel
                onAccount={(account) => {
                  setWho(account);
                  setGate("city");
                }}
                onGuest={() => {
                  setWho(null);
                  setGate("city");
                }}
              />
            ) : (
              <>
            <p className="tag">{who ? `Signed in as ${who.name}` : "Playing as a guest. Sign up later and this city comes with you."}</p>
            <Roster />
            <label>
              Seed
              <input
                id="seed"
                value={seedText}
                placeholder="random"
                inputMode="text"
                disabled={webglMissing}
                onChange={(event) => setSeedText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") play();
                }}
              />
            </label>
            <button id="play" type="button" disabled={webglMissing || busy} onClick={play}>
              {busy ? "BUILDING" : "PLAY"}
            </button>
            <p className="help">{HELP}</p>
            <p className="help">Demo credits only. No real tokens.</p>
            <button type="button" onClick={() => { setGate("login"); setWho(null); }}>Back to sign in</button>
              </>
            )}
          </div>
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
};

function Minimap({ me, people, seed }: { me: Snap["me"]; people: Snap["people"]; seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const model = useMemo(() => cityMapModel(seed), [seed]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = canvas.width;
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
    // Venue dots + tiny labels (Cafe labels left — it sits next to the Shop).
    // Labels shift down when they would collide: several venues share a row
    // (Shop/Arcade/Garage on z=54, Hall/Bank on z=18) and their 7px labels
    // are wider than the dots are apart, so unshifted they pile up unreadably.
    ctx.font = "6px sans-serif";
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const venue of model.venues) {
      const label = MAP_LABELS[venue.id];
      if (!label) continue;
      const [vx, vz] = plot(venue.x, venue.z);
      ctx.fillStyle = "#e0b33a";
      ctx.beginPath();
      ctx.arc(vx, vz, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8f6ff";
      const w = label.length * 3.6;
      const x0 = venue.id === "cafe" ? vx - 4 - w : vx + 4;
      let y0 = vz - 4.5;
      // Stack the label down until its rect clears every placed label.
      for (let shift = 0; shift < 4; shift++) {
        const clash = placed.some(
          (r) => x0 < r.x1 && x0 + w > r.x0 && y0 < r.y1 && y0 + 6 > r.y0,
        );
        if (!clash) break;
        y0 += 8;
      }
      placed.push({ x0, y0, x1: x0 + w, y1: y0 + 6 });
      ctx.textAlign = "left";
      // Dark halo so the white label stays readable over the light blocks.
      ctx.strokeStyle = "rgba(4, 8, 14, 0.9)";
      ctx.lineWidth = 2;
      ctx.strokeText(label, x0, y0 + 6);
      ctx.fillText(label, x0, y0 + 6);
    }
    ctx.textAlign = "left";
    // North marker.
    ctx.fillStyle = "#7ef6ff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N", size / 2, 10);
    ctx.textAlign = "left";
    // Other players.
    for (const person of people) {
      const [ppx, ppz] = plot(person.x, person.z);
      ctx.fillStyle = person.speaking ? "#7ef6ff" : "#f4f6fa";
      ctx.beginPath();
      ctx.arc(ppx, ppz, person.speaking ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player: gold dot with a white ring.
    const [mx, mz] = plot(me.x, me.z);
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
  return <canvas ref={ref} className="minimap" width={148} height={148} />;
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
      {snap.board.length === 0 ? <span>Burn some demo credits and your name can land here.</span> : null}
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
