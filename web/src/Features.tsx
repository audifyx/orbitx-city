import { useState } from "react";
import type { Runtime, Snap } from "./game/runtime";
import { EMOTES, FURNITURE } from "./game/life";

export function FeaturePanel({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  if (snap.panel === "daily") return <Daily snap={snap} rt={rt} />;
  if (snap.panel === "wallet") return <Wallet snap={snap} rt={rt} />;
  if (snap.panel === "leaders") return <Leaders snap={snap} />;
  if (snap.panel === "arcade") return <Arcade rt={rt} />;
  if (snap.panel === "hq") return <Hq snap={snap} rt={rt} />;
  if (snap.panel === "race") return <Race snap={snap} rt={rt} />;
  if (snap.panel === "home") return <Home snap={snap} rt={rt} />;
  return null;
}

export function featureTitle(panel: Snap["panel"]) {
  if (panel === "daily") return "Daily rewards";
  if (panel === "wallet") return "Wallet (read-only)";
  if (panel === "leaders") return "Leaderboards";
  if (panel === "arcade") return "Neon Arcade";
  if (panel === "hq") return "Project HQ";
  if (panel === "race") return "Ring race";
  if (panel === "home") return "Property";
  return "";
}

function Daily({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const daily = snap.daily;
  if (!daily) return <p>The city server has not sent today's quests yet.</p>;
  return (
    <div className="list" data-feature="daily">
      <p>
        Day {daily.day}. Streak {daily.streak}. {daily.claimed ? "Claimed today." : `Claim ${daily.reward} demo ORBITX.`}
      </p>
      <button type="button" disabled={daily.claimed} onClick={() => rt?.claimDaily()}>
        {daily.claimed ? "Claimed" : "Claim login reward"}
      </button>
      <h3>Today's quests</h3>
      {daily.quests.map((quest) => (
        <article key={quest.id}>
          <div>
            <b>{quest.label}</b>
            <span>
              {quest.have}/{quest.need}
              {quest.done ? " · done" : ""}
            </span>
          </div>
        </article>
      ))}
      <p className="quiet">Three quests rotate by the date. Rewards are demo credits.</p>
    </div>
  );
}

function Leaders({ snap }: { snap: Snap }) {
  const blocks = [
    ["Richest", snap.leaders.rich],
    ["Top earners", snap.leaders.earners],
    ["Most burned", snap.leaders.burned],
    ["Race times", snap.leaders.race],
  ] as const;
  return (
    <div className="list" data-feature="leaders">
      <p>The same lists are on the plaza screen. Demo credits only.</p>
      {blocks.map(([title, rows]) => (
        <div key={title}>
          <h3>{title}</h3>
          {rows.length === 0 ? <span>No scores yet.</span> : null}
          {rows.map((row) => (
            <article key={`${title}-${row.name}-${row.value}`}>
              <div>
                <b>{row.name}</b>
                <span>{row.value}</span>
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}

function Wallet({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  return (
    <div className="list" data-feature="wallet">
      <p className="play-money">Read-only. Connect checks a public balance. It does not send, sign, or spend a transaction.</p>
      <p>
        {snap.walletKey ? `Linked ${snap.walletKey.slice(0, 4)}…${snap.walletKey.slice(-4)}` : "No wallet linked."}
        {snap.holder ? " · HOLDER" : ""}
      </p>
      <p>{snap.mintSet ? "ORBITX_MINT is set. A verified balance can unlock the holder lounge." : "ORBITX_MINT is not set. The holder lounge stays open and no balance is shown."}</p>
      <p>{snap.walletNote || "Phantom and other standard Solana wallets work in the browser. This preview has none."}</p>
      <button type="button" onClick={() => rt?.connectWallet()}>Connect wallet</button>
    </div>
  );
}

function Arcade({ rt }: { rt: Runtime | null }) {
  const [card, setCard] = useState<number | null>(null);
  const [token, setToken] = useState("");
  const [light, setLight] = useState<"idle" | "wait" | "go">("idle");
  const [reflexToken, setReflexToken] = useState("");
  return (
    <div className="list" data-feature="arcade">
      <p className="play-money">PLAY MONEY. These games spend demo credits only. No cash, no crypto, no payout you can withdraw.</p>
      <h3>High / low</h3>
      <p>Stake 10 demo ORBITX. A win returns 18. The burn line shows on the notice.</p>
      <button
        type="button"
        onClick={() => {
          void rt?.arcadeDeal().then((hand) => {
            if (!hand) return;
            setCard(hand.shown);
            setToken(hand.token);
          });
        }}
      >
        Deal a card
      </button>
      {card != null ? <p>Card {card}</p> : null}
      <div className="days">
        <button type="button" onClick={() => rt?.arcadeGuess("high", token)}>Higher</button>
        <button type="button" onClick={() => rt?.arcadeGuess("low", token)}>Lower</button>
      </div>
      <h3>Reflex light</h3>
      <p>Stake 10. Hit the light after it turns gold. Fast hits pay more demo credits.</p>
      <button
        type="button"
        className={light === "go" ? "on" : ""}
        onClick={() => {
          if (light === "go") {
            rt?.arcadeHit(reflexToken);
            setLight("idle");
            return;
          }
          void rt?.arcadeArm().then((armed) => {
            if (!armed) return;
            setReflexToken(armed.token);
            setLight("wait");
            const wait = Math.max(0, armed.goAt - Date.now());
            window.setTimeout(() => setLight("go"), wait);
          });
        }}
      >
        {light === "go" ? "GO — tap" : light === "wait" ? "Wait…" : "Arm the light"}
      </button>
    </div>
  );
}

function Hq({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("HQ meetup");
  const [when, setWhen] = useState("Tonight");
  const project = snap.projects[snap.hqIndex] || snap.projects[0];
  const note = snap.notes.find((item) => item.project === `hq-${snap.hqIndex}`);
  const mine = snap.lots.find((lot) => lot.id === `hq-${snap.hqIndex}`);
  const owner = mine?.ownerId && mine.ownerId === snap.meId;
  return (
    <div className="list" data-feature="hq">
      <p>
        <b>{project?.name || "Project HQ"}</b>
      </p>
      <p>{project?.line}</p>
      {project?.site ? (
        <p>
          <a href={project.site} target="_blank" rel="noreferrer">{project.site}</a>
        </p>
      ) : null}
      <p>Price {snap.market?.price || project?.price || "placeholder until ORBITX_MINT is set"}</p>
      <p>Holders {snap.market?.holders || project?.holders || "placeholder"}</p>
      <h3>Announcement</h3>
      <p>{note?.text || "No note yet."}{note?.author ? ` — ${note.author}` : ""}</p>
      {owner ? (
        <>
          <label>
            Board text
            <input value={text} maxLength={180} onChange={(event) => setText(event.target.value)} />
          </label>
          <button type="button" onClick={() => rt?.setAnnouncement(snap.hqIndex, text)}>Save announcement</button>
          <h3>Host an event</h3>
          <label>
            Title
            <input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            When
            <input value={when} maxLength={40} onChange={(event) => setWhen(event.target.value)} />
          </label>
          <button type="button" onClick={() => rt?.hostEvent(snap.hqIndex, title, when, "Meet inside this HQ.")}>Post to the events board</button>
        </>
      ) : (
        <p>{mine?.ownerId ? `Owned by ${mine.ownerName}.` : `For sale · ${mine?.price ?? 90} demo ORBITX.`}</p>
      )}
      {!mine?.ownerId ? <button type="button" onClick={() => rt?.buyLot(`hq-${snap.hqIndex}`)}>Buy this HQ</button> : null}
      <p className="quiet">The big screen on the back wall shows the same info. Holder lounge is the gold room at the back of OrbitX HQ.</p>
    </div>
  );
}

function Race({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  return (
    <div className="list" data-feature="race">
      <p>Ring road, cyan arch on the east avenue. Checkpoints, a 5 second countdown, and a shared lobby.</p>
      <p>
        {snap.race.phase === "live" ? "Race is live." : snap.race.phase === "done" ? "Last race finished." : "Lobby is open."}
        {snap.race.names.length ? ` In it: ${snap.race.names.join(", ")}` : " Nobody is waiting."}
      </p>
      <div className="days">
        <button type="button" onClick={() => rt?.startRace("street")}>Street race</button>
        <button type="button" onClick={() => rt?.startRace("hover")}>Hover time trial</button>
        <button type="button" onClick={() => rt?.leaveRace()}>Leave</button>
      </div>
      <h3>Results</h3>
      {snap.race.results.length === 0 ? <span>No finish yet.</span> : null}
      {snap.race.results.map((row, index) => (
        <article key={`${row.name}-${index}`}>
          <div>
            <b>{row.name}</b>
            <span>
              {row.kind} {(row.timeMs / 1000).toFixed(2)}s
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Home({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  return (
    <div className="list" data-feature="property">
      <p>Apartments and shops sell for demo credits. The burn is in the notice. Door signs show the owner.</p>
      {snap.lots.map((lot) => (
        <article key={lot.id}>
          <div>
            <b>{lot.name}</b>
            <span>
              {lot.kind} · {lot.ownerId ? `Owned by ${lot.ownerName}` : `For sale · ${lot.price}`}
              {lot.ownerId === snap.meId ? " · yours" : ""}
            </span>
          </div>
          {!lot.ownerId ? (
            <button type="button" onClick={() => rt?.buyLot(lot.id)}>Buy</button>
          ) : lot.ownerId === snap.meId ? (
            <button type="button" onClick={() => rt?.travel(lot.anchor)}>Enter</button>
          ) : (
            <button type="button" onClick={() => rt?.travel(lot.anchor)}>Visit</button>
          )}
        </article>
      ))}
      <p className="quiet">Inside a place you own, press X or Decorate. Place, rotate, and remove furniture. It saves on the server.</p>
    </div>
  );
}

export function PhoneExtra({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  return (
    <>
      <h3>Daily</h3>
      <article>
        <div>
          <b>{snap.daily ? (snap.daily.claimed ? `Streak ${snap.daily.streak}` : `Claim ${snap.daily.reward}`) : "Waiting for the server"}</b>
          <span>{snap.daily ? `${snap.daily.quests.filter((quest) => quest.done).length}/${snap.daily.quests.length} quests` : ""}</span>
        </div>
        <button type="button" onClick={() => rt?.request("daily")}>Open</button>
      </article>
      <h3>Leaderboards</h3>
      <article>
        <div>
          <b>Plaza screen</b>
          <span>Richest, earners, burned, races</span>
        </div>
        <button type="button" onClick={() => rt?.request("leaders")}>Open</button>
      </article>
      <h3>Race</h3>
      <article>
        <div>
          <b>Ring road</b>
          <span>{snap.race.names.length ? snap.race.names.join(", ") : "No lobby"}</span>
        </div>
        <button type="button" onClick={() => rt?.request("race")}>Open</button>
      </article>
      <h3>Wallet</h3>
      <article>
        <div>
          <b>{snap.holder ? "HOLDER" : snap.walletKey ? "Linked" : "Not linked"}</b>
          <span>{snap.mintSet ? "Mint configured" : "Mint not set"}</span>
        </div>
        <button type="button" onClick={() => rt?.request("wallet")}>Open</button>
      </article>
    </>
  );
}

export function EmoteWheel({ index }: { index: number }) {
  return (
    <div className="wheel" data-feature="emote">
      {EMOTES.map((name, i) => {
        const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button
            key={name}
            type="button"
            className={i === index ? "on" : ""}
            style={{ transform: `translate(${Math.cos(angle) * 92}px, ${Math.sin(angle) * 92}px)` }}
          >
            {name}
          </button>
        );
      })}
      <span>Hold Z</span>
    </div>
  );
}

export function DecorBar({ kind, rt }: { kind: string; rt: Runtime | null }) {
  return (
    <div className="decor-bar" data-feature="decorate">
      {FURNITURE.map((name) => (
        <button key={name} type="button" className={kind === name ? "on" : ""} onClick={() => rt?.pickFurniture(name)}>
          {name}
        </button>
      ))}
      <button type="button" onClick={() => rt?.placeFurniture()}>Place</button>
      <button type="button" onClick={() => rt?.spinDecor(1)}>Rotate</button>
      <button type="button" onClick={() => rt?.removeFurniture()}>Remove</button>
      <button type="button" onClick={() => rt?.toggleDecor()}>Done</button>
    </div>
  );
}

export function SpectateBar({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  if (snap.clean) return null;
  return (
    <div className="spectate-bar" data-feature="spectate">
      <button type="button" className={snap.orbit ? "on" : ""} onClick={() => rt?.toggleOrbit()}>Slow orbit</button>
      <button type="button" className={snap.hideHud ? "on" : ""} onClick={() => rt?.toggleHud()}>Hide HUD</button>
      <button type="button" className={snap.hideNames ? "on" : ""} onClick={() => rt?.toggleNames()}>Hide names and chat</button>
      <button type="button" onClick={() => rt?.toggleSpectator()}>Exit</button>
    </div>
  );
}

export function RaceBanner({ text }: { text: string }) {
  return <p className="race-banner" data-feature="countdown">{text}</p>;
}
