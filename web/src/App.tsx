import { useEffect, useRef, useState } from "react";
import { createGame, type Game, type PlayMode } from "./game/engine";
import type { PanelName, Runtime, Snap } from "./game/runtime";
import { AD_PRICE } from "./game/content";
import { parseSeed } from "./game/seed";
import { Roster } from "./Roster";
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
  const [status, setStatus] = useState("");
  const [webglMissing, setWebglMissing] = useState(false);
  const [snap, setSnap] = useState<Snap>(EMPTY);
  const [panel, setPanel] = useState<PanelName | "">("");
  const [adText, setAdText] = useState("ORBITX LIVE");
  const [adId, setAdId] = useState("plaza-east");
  const [adDays, setAdDays] = useState<1 | 7 | 30>(7);
  const [chatText, setChatText] = useState("");

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
    if (mode) {
      game.start(parseSeed(params.get("seed") ?? "1"), mode);
      setMenu(false);
    } else {
      game.start(parseSeed(params.get("seed") ?? "1"), "orbit");
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
    game.start(parseSeed(seedText), "play");
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
      <p className="status" id="status" hidden={snap.hideHud}>
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
          <strong>DEMO ORBITX {snap.balance}</strong>
          {snap.holder ? <span>HOLDER</span> : null}
          <span>Burned {snap.burned}</span>
          <span>{snap.jobTitle ? `${snap.jobTitle} — ${snap.objective}` : snap.objective}</span>
          {snap.eventLabel ? <span>{snap.eventLabel}</span> : null}
          {snap.notice ? <em>{snap.notice}</em> : null}
          <span className="quiet">
            {snap.others + 1} in the city · {snap.camLabel} · {snap.lookName}
          </span>
          <Minimap me={snap.me} people={snap.people} />
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
            <p className="demo">Shop, jobs, property, and the arcade use demo credits only. They are not real ORBITX and cannot be cashed out. Wallet connect is optional and read-only.</p>
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
            {panel === "phone" && <Phone snap={snap} rt={gameRef.current?.runtime ?? null} />}
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
            <p className="tag">{webglMissing ? "This browser has no WebGL." : "Pick a character, then walk the downtown"}</p>
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
          </div>
        </section>
      )}
    </>
  );
}

function Minimap({ me, people }: { me: Snap["me"]; people: Snap["people"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(8, 12, 18, 0.72)";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#7ef6ff";
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    const plot = (x: number, z: number) => [size / 2 + x * 0.55, size / 2 + z * 0.55] as const;
    ctx.fillStyle = "#e0b33a";
    const [mx, mz] = plot(me.x, me.z);
    ctx.beginPath();
    ctx.arc(mx, mz, 4, 0, Math.PI * 2);
    ctx.fill();
    for (const person of people) {
      const [px, pz] = plot(person.x, person.z);
      ctx.fillStyle = person.speaking ? "#7ef6ff" : "#f4f6fa";
      ctx.beginPath();
      ctx.arc(px, pz, person.speaking ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [me, people]);
  return <canvas ref={ref} className="minimap" width={148} height={148} />;
}

function Phone({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
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
      <p>
        {snap.name} · {snap.server || "offline profile"} · voice {snap.voiceProvider || "not joined"}
      </p>
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
