import { useEffect, useState } from "react";
import { requestExportCode } from "./auth";
import type { Runtime, Snap } from "./game/runtime";
import { FURNITURE_CATALOG } from "./game/runtime";
import { EMOTES, FURNITURE } from "./game/life";

export function FeaturePanel({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  if (snap.panel === "daily") return <Daily snap={snap} rt={rt} />;
  if (snap.panel === "wallet") return <Wallet snap={snap} rt={rt} />;
  if (snap.panel === "leaders") return <Leaders snap={snap} />;
  if (snap.panel === "arcade") return <Arcade rt={rt} />;
  if (snap.panel === "hq") return <Hq snap={snap} rt={rt} />;
  if (snap.panel === "race") return <Race snap={snap} rt={rt} />;
  if (snap.panel === "home") return <Home snap={snap} rt={rt} />;
  if (snap.panel === "talk") return <Talk snap={snap} rt={rt} />;
  return null;
}

export function featureTitle(panel: Snap["panel"]) {
  if (panel === "daily") return "Daily rewards";
  if (panel === "wallet") return "In-app wallet";
  if (panel === "leaders") return "Leaderboards";
  if (panel === "arcade") return "Neon Arcade";
  if (panel === "hq") return "Project HQ";
  if (panel === "race") return "Ring race";
  if (panel === "home") return "Property";
  if (panel === "talk") return "Chat";
  return "";
}

function Daily({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const daily = snap.daily;
  if (!daily) return <p>The city server has not sent today's quests yet.</p>;
  return (
    <div className="list" data-feature="daily">
      <p>
        Day {daily.day}. Streak {daily.streak}. {daily.claimed ? "Claimed today." : `Claim ${daily.reward} City Sol.`}
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
      <p className="quiet">Three quests rotate by the date. Rewards are City Sol.</p>
    </div>
  );
}

function Talk({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const talk = snap.talk;
  // PEOPLE: this NPC's relationship — chatting builds it (Stranger →
  // Acquaintance → Friend → Close Friend → Best Friend). Friends can be
  // invited over to your place; Close Friends come to house parties.
  const [rel, setRel] = useState<{ label: string; talks: number; level: number; canVisit: boolean; canParty: boolean } | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const talkName = talk?.name ?? "";
  useEffect(() => {
    if (!talkName) return;
    let live = true;
    setRel(null);
    setChatMsg("");
    void rt
      ?.peopleStatus()
      .then((res) => {
        if (!live || !res.ok) return;
        const found = res.relationships.find((item) => item.npc === talkName);
        if (found) setRel(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talkName]);
  if (!talk) return <p>Chat over — close the panel and keep playing.</p>;
  return (
    <div className="list" data-feature="talk">
      <p>
        <b>{talk.name}</b> · {talk.role}
      </p>
      <p>&ldquo;{talk.line}&rdquo;</p>
      <p className="quiet">
        Line {talk.index + 1} of {talk.total}
        {snap.photos.spots.length ? ` · Photos ${snap.photos.spots.length}/3` : ""}
      </p>
      <button type="button" onClick={() => rt?.talkNext()}>
        Next line
      </button>
      {talk.offerLabel && (
        <button type="button" onClick={() => rt?.npcOffer()}>
          {talk.offerLabel}
        </button>
      )}
      {talk.jobId && (
        <button
          type="button"
          onClick={() => {
            rt?.startJob(talk.jobId);
            rt?.closeTalk();
          }}
        >
          Start {talk.jobName} job
        </button>
      )}
      {talk.jobId && (
        <button type="button" onClick={() => rt?.request("jobs")}>
          Browse all jobs
        </button>
      )}
      <h3>Relationship</h3>
      <p>
        {rel ? `${rel.label} · ${rel.talks} chat${rel.talks === 1 ? "" : "s"}` : "…"}
      </p>
      <p className="quiet">
        {rel && rel.level < 2
          ? `Chat ${3 - rel.talks} more time${3 - rel.talks === 1 ? "" : "s"} to become Friends — Friends come over to your place.`
          : rel && rel.level === 2
            ? "Friends come over — invite them from your home panel. 8 chats for Close Friend."
            : rel
              ? "Close Friend — they will come to your house parties."
              : "Chatting builds a relationship — 3 chats to become Friends."}
      </p>
      <button
        type="button"
        disabled={chatBusy}
        onClick={async () => {
          if (!rt) return;
          setChatBusy(true);
          try {
            const res = await rt.npcTalk(talk.name);
            if (res.ok && res.relationship) setRel(res.relationship);
            setChatMsg(res.message || "");
          } catch (err) {
            setChatMsg(err instanceof Error ? err.message : "Could not chat.");
          } finally {
            setChatBusy(false);
          }
        }}
      >
        Chat
      </button>
      {chatMsg ? <p>{chatMsg}</p> : null}
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
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [quote, setQuote] = useState<{ amount?: string; fee?: string; destination?: string; network?: string; message?: string } | null>(null);
  const [step, setStep] = useState<"closed" | "warn" | "auth" | "show">("closed");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [secret, setSecret] = useState<{ secretBase58: string; phantom: number[] } | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    rt?.refreshWallet();
  }, [rt]);
  useEffect(() => {
    if (!quote) return;
    document.getElementById("send-sheet")?.scrollIntoView({ block: "nearest" });
  }, [quote]);
  const sol = snap.chainSol == null ? "not read" : `${snap.chainSol} SOL`;
  const token = snap.chainOrbitx == null ? "not read" : `${snap.chainOrbitx} $ORBITX`;
  return (
    <div className="list" data-feature="wallet">
      <p className="play-money">Demo credits in the HUD are play money. This panel is the in-app Solana wallet. The shop does not spend it.</p>
      <p>
        <b>{snap.name || "Guest"}</b>
        {snap.account ? " · account" : " · guest"}
        {snap.holder ? " · HOLDER" : ""}
      </p>
      {snap.account ? (
        <>
          <p className="addr">{snap.chainAddress || "Creating the wallet…"}</p>
          <p>{snap.chainNetwork || "devnet"} · {sol} · {token}</p>
          {snap.chainQr.startsWith("<svg") ? <div className="qr" dangerouslySetInnerHTML={{ __html: snap.chainQr }} /> : null}
          <p>{snap.walletNote}</p>
          <h3>Send SOL</h3>
          <label>
            Destination
            <input id="send-dest" value={dest} onChange={(event) => setDest(event.target.value)} />
          </label>
          <label>
            Amount
            <input id="send-amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <button id="send-review" type="button" onClick={() => {
            void rt?.quoteSend(dest, amount)?.then((data) => {
              const row = data as { ok?: boolean; message?: string; amount?: string; fee?: string; destination?: string; network?: string };
              if (row.ok === false) setNote(String(row.message || "Check the amount."));
              else setQuote(row);
            }).catch((err) => setNote(err instanceof Error ? err.message : "Could not review."));
          }}>Review send</button>
          {quote ? (
            <div className="sheet" id="send-sheet">
              <h3>Confirm</h3>
              <p>{quote.amount} SOL</p>
              <p>Network fee about {quote.fee} SOL</p>
              <p>To {quote.destination}</p>
              <p>Network {quote.network}</p>
              <button type="button" id="send-confirm" onClick={() => {
                const key = crypto.randomUUID();
                void rt?.confirmSend(String(quote.destination || ""), String(quote.amount || ""), key)?.then(() => {
                  setQuote(null);
                  rt.refreshWallet();
                }).catch((err) => setNote(err instanceof Error ? err.message : "Send failed."));
              }}>Confirm</button>
              <button type="button" onClick={() => setQuote(null)}>Back</button>
            </div>
          ) : null}
          <h3>Recent</h3>
          {snap.chainHistory.length === 0 ? <span>No on-chain sends yet.</span> : null}
          {snap.chainHistory.map((row) => (
            <article key={row.id}>
              <div><b>{row.amount} SOL · {row.status}</b><span>{row.destination.slice(0, 6)}… {row.signature ? row.signature.slice(0, 8) : ""}</span></div>
            </article>
          ))}
          <h3>Export key</h3>
          {step === "closed" ? <button id="export-open" type="button" onClick={() => setStep("warn")}>Export private key</button> : null}
          {step === "warn" ? (
            <div className="sheet" id="export-warn">
              <p>This shows the private key. Anyone who copies it can move the funds. The city cannot undo that.</p>
              <button id="export-understand" type="button" onClick={() => setStep("auth")}>I understand</button>
              <button type="button" onClick={() => setStep("closed")}>Cancel</button>
            </div>
          ) : null}
          {step === "auth" ? (
            <div className="sheet" id="export-auth">
              <label>Password<input id="export-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label>Or a fresh email code<input value={otp} onChange={(event) => setOtp(event.target.value)} /></label>
              <button id="export-reveal" type="button" onClick={() => {
                setNote("");
                void rt?.exportKey({ password, otp })?.then((data) => {
                  const row = data as { ok?: boolean; secretBase58?: string; phantom?: number[]; message?: string };
                  if (!row.secretBase58 || !row.phantom) {
                    setNote(String(row.message || "Export refused."));
                    return;
                  }
                  setSecret({ secretBase58: row.secretBase58, phantom: row.phantom });
                  setStep("show");
                }).catch((err) => setNote(err instanceof Error ? err.message : "Export refused."));
              }}>Reveal key</button>
              <button type="button" onClick={() => {
                void requestExportCode(snap.email).then((result) => setNote(result.devCode ? `Dev code ${result.devCode}` : result.message || "Check your email.")).catch((err) => setNote(err instanceof Error ? err.message : "Could not send a code."));
              }}>Email a code</button>
            </div>
          ) : null}
          {step === "show" && secret ? (
            <div className="sheet" id="export-key">
              <p className="addr">{secret.secretBase58}</p>
              <button type="button" onClick={() => download("orbitx-secret.txt", secret.secretBase58)}>Download base58</button>
              <button type="button" onClick={() => download("orbitx-phantom.json", JSON.stringify(secret.phantom))}>Download Phantom JSON</button>
              <button type="button" onClick={() => { setSecret(null); setStep("closed"); }}>Hide</button>
            </div>
          ) : null}
        </>
      ) : (
        <p>Play as a guest keeps City Sol on this device. Sign in to open the in-app wallet.</p>
      )}
      {note ? <p id="wallet-note">{note}</p> : null}
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Arcade({ rt }: { rt: Runtime | null }) {
  const [card, setCard] = useState<number | null>(null);
  const [token, setToken] = useState("");
  const [light, setLight] = useState<"idle" | "wait" | "go">("idle");
  const [reflexToken, setReflexToken] = useState("");
  return (
    <div className="list" data-feature="arcade">
      <p className="play-money">PLAY MONEY. These games spend City Sol only. No cash, no crypto, no payout you can withdraw.</p>
      <h3>High / low</h3>
      <p>Stake 10 City Sol. A win returns 18. The burn line shows on the notice.</p>
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
      <p>Stake 10. Hit the light after it turns gold. Fast hits pay more City Sol.</p>
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
      <h3>City games</h3>
      <p>Free to play, pay City Sol on a win. Finish any running job first — one gig at a time.</p>
      <h3>Coin hunt</h3>
      <p>6 gold coins hidden around the plaza. Find them all in 90 seconds — pays 40 City Sol. The beacon points at the nearest coin.</p>
      <button type="button" onClick={() => rt?.startCoinHunt()}>Start coin hunt</button>
      <h3>Fishing</h3>
      <p>Stand on the harbor pier and press E to cast. 3 catches pays 45 City Sol. Press E too soon, or miss a bite, and the fish count it — 3 misses and the haul is gone.</p>
      <button type="button" onClick={() => rt?.startFishing()}>Cast a line</button>
      <h3>Basketball shootout</h3>
      <p>Five shots from the free-throw line at the Sunset Park court. Time the meter and press E in the green. 3 makes pays 50 City Sol.</p>
      <button type="button" onClick={() => rt?.startShootout()}>Shoot hoops</button>
      <h3>Treasure hunt</h3>
      <p>Five chests buried around the city — pier, park, library, cinema, tower. Find them all in 2 minutes — pays 45 City Sol. The beacon points at the nearest chest; each find drops a clue to the next.</p>
      <button type="button" onClick={() => rt?.startTreasureHunt()}>Start treasure hunt</button>
    </div>
  );
}

function Hq({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("HQ meetup");
  const [when, setWhen] = useState("Tonight");
  const [bName, setBName] = useState("");
  const [bLine, setBLine] = useState("");
  const [bSite, setBSite] = useState("");
  const project = snap.projects[snap.hqIndex] || snap.projects[0];
  const note = snap.notes.find((item) => item.project === `hq-${snap.hqIndex}`);
  const mine = snap.lots.find((lot) => lot.id === `hq-${snap.hqIndex}`);
  const owner = mine?.ownerId && mine.ownerId === snap.meId;
  // Self-serve branding: once a project owns an HQ, its own name/line/site
  // replace the default project card on this dashboard. The in-world office
  // sign is baked into the city build, so it still shows the original name.
  const brand = mine?.brand;
  const displayName = brand?.name || project?.name || "Project HQ";
  const displayLine = brand?.line || project?.line;
  const displaySite = brand?.site || project?.site;
  const hosted = snap.events.filter((item) => item.where === displayName || item.where === mine?.name);
  const rentSoon = !!mine?.rentDue && mine.rentDue - Date.now() < 86400000;
  return (
    <div className="list" data-feature="hq">
      <p>
        <b>{displayName}</b>
        {brand?.name ? " · your brand" : ""}
      </p>
      <p>{displayLine}</p>
      {displaySite ? (
        <p>
          <a href={displaySite} target="_blank" rel="noreferrer">{displaySite}</a>
        </p>
      ) : null}
      <p>Price {snap.market?.price || project?.price || "placeholder until ORBITX_MINT is set"}</p>
      <p>Holders {snap.market?.holders || project?.holders || "placeholder"}</p>
      {owner ? (
        <p>
          You own this office. Rent {mine?.rentBill ?? "—"} City Sol a week
          {mine?.rentDue ? ` · next bill ${new Date(mine.rentDue).toLocaleDateString()}${rentSoon ? " — due soon" : ""}` : ""}.
          {mine?.arrears ? ` Unpaid ${mine.arrears} City Sol — pay it from Property.` : ""}
        </p>
      ) : null}
      <h3>Announcement</h3>
      <p>{note?.text || "No note yet."}{note?.author ? ` — ${note.author}` : ""}</p>
      {owner ? (
        <>
          <h3>Brand this office</h3>
          <p className="quiet">Name it, give it a line and a link. The dashboard shows your brand the moment you save. The office sign inside the world still shows the original name — that part is baked into the city and updates on the next build.</p>
          <label>
            Name
            <input value={bName} maxLength={40} placeholder={brand?.name || project?.name || "Project HQ"} onChange={(event) => setBName(event.target.value)} />
          </label>
          <label>
            Tagline
            <input value={bLine} maxLength={80} placeholder={brand?.line || project?.line || ""} onChange={(event) => setBLine(event.target.value)} />
          </label>
          <label>
            Link
            <input value={bSite} maxLength={80} placeholder={brand?.site || project?.site || "https://"} onChange={(event) => setBSite(event.target.value)} />
          </label>
          <button type="button" onClick={() => rt?.setBrand(snap.hqIndex, bName, bLine, bSite)}>Save brand</button>
          <label>
            Board text
            <input value={text} maxLength={180} onChange={(event) => setText(event.target.value)} />
          </label>
          <button type="button" onClick={() => rt?.setAnnouncement(snap.hqIndex, text)}>Save announcement</button>
          <h3>Events you host here</h3>
          {hosted.length === 0 ? (
            <p>No events at this office yet. Post one below.</p>
          ) : (
            hosted.map((item) => (
              <article key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <span>{item.when} · {item.where}</span>
                </div>
              </article>
            ))
          )}
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
        <p>{mine?.ownerId ? `Owned by ${mine.ownerName}.` : `For sale · ${mine?.price ?? 90} City Sol.`}</p>
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
  // Rent + utilities are City Sol, once a week, 10% of the price plus
  // utilities. The bill date is shown here before it ever lands, and a lot
  // never charges twice for the same week. Unpaid rent blocks new purchases
  // until it is cleared.
  const totalArrears = snap.lots.reduce((sum, lot) => sum + (lot.arrears || 0), 0);
  return (
    <div className="list" data-feature="property">
      <p>Apartments and shops sell for City Sol. The burn is in the notice. Door signs show the owner.</p>
      <p className="quiet">Every place you own bills weekly rent + utilities in City Sol — the first bill lands 7 days after you buy. Unpaid rent blocks new purchases until you clear it.</p>
      {totalArrears > 0 ? (
        <article>
          <div>
            <b>Unpaid rent {totalArrears} City Sol</b>
            <span>Across your places. Clear it to buy again.</span>
          </div>
          <button type="button" onClick={() => rt?.payRent("all")}>Pay all</button>
        </article>
      ) : null}
      {snap.lots.map((lot) => {
        const mine = lot.ownerId === snap.meId;
        const dueIn = lot.rentDue ? Math.max(0, lot.rentDue - Date.now()) : 0;
        const dueText = lot.rentDue
          ? dueIn < 86400000
            ? `due in ${Math.max(1, Math.ceil(dueIn / 3600000))}h — soon`
            : `due in ${Math.ceil(dueIn / 86400000)}d`
          : "";
        return (
          <article key={lot.id}>
            <div>
              <b>{lot.brand?.name || lot.name}</b>
              <span>
                {lot.kind} · {lot.ownerId ? `Owned by ${lot.ownerName}` : `For sale · ${lot.price}`}
                {mine ? " · yours" : ""}
              </span>
              {mine && lot.arrears ? <span>Unpaid rent {lot.arrears} City Sol</span> : null}
              {mine && !lot.arrears && lot.rentDue ? (
                <span>Next bill {lot.rentBill} City Sol · {dueText}</span>
              ) : null}
              {mine && !lot.arrears && !lot.rentDue ? <span>First rent bill lands 7 days after purchase.</span> : null}
            </div>
            {!lot.ownerId ? (
              <button type="button" onClick={() => rt?.buyLot(lot.id)}>Buy</button>
            ) : mine ? (
              <div className="days">
                {lot.arrears ? <button type="button" onClick={() => rt?.payRent(lot.id)}>Pay {lot.arrears}</button> : null}
                <button type="button" onClick={() => rt?.travel(lot.anchor)}>Enter</button>
              </div>
            ) : (
              <button type="button" onClick={() => rt?.travel(lot.anchor)}>Visit</button>
            )}
          </article>
        );
      })}
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
          <b>{snap.holder ? "HOLDER" : snap.account ? "In-app wallet" : "Sign in for a wallet"}</b>
          <span>{snap.chainNetwork || (snap.mintSet ? "Mint configured" : "Devnet")}</span>
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

export function DecorBar({ kind, rt, mode, owned }: { kind: string; rt: Runtime | null; mode?: string; owned?: string[] }) {
  const home = mode === "home";
  const ownedCounts = new Map<string, number>();
  for (const id of owned || []) ownedCounts.set(id, (ownedCounts.get(id) || 0) + 1);
  const homeChoices = FURNITURE_CATALOG.filter((item) => (ownedCounts.get(item.id) || 0) > 0);
  return (
    <div className="decor-bar" data-feature="decorate">
      {home ? (
        homeChoices.length ? (
          homeChoices.map((item) => (
            <button key={item.id} type="button" className={kind === item.id ? "on" : ""} onClick={() => rt?.pickFurniture(item.id)}>
              {item.name} ×{ownedCounts.get(item.id)}
            </button>
          ))
        ) : (
          <span className="muted">No furniture yet — buy some in the shop first.</span>
        )
      ) : (
        FURNITURE.map((name) => (
          <button key={name} type="button" className={kind === name ? "on" : ""} onClick={() => rt?.pickFurniture(name)}>
            {name}
          </button>
        ))
      )}
      <button type="button" onClick={() => rt?.placeFurniture()}>Place</button>
      <button type="button" onClick={() => rt?.spinDecor(1)}>Rotate</button>
      {home ? <button type="button" onClick={() => rt?.moveFurniture()}>Move</button> : null}
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
