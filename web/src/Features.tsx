import { useEffect, useState } from "react";
import { requestExportCode } from "./auth";
import type { Runtime, Snap } from "./game/runtime";
import { FURNITURE_CATALOG } from "./game/runtime";
import { EMOTES, EMOTE_LABELS, FURNITURE } from "./game/life";
import { CUSTOM_PAINT_HEX, CUSTOM_PAINT_NAMES, CUSTOM_PAINT_PRICE, VEHICLE_COLORS } from "./game/vehicles";

export function FeaturePanel({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  if (snap.panel === "daily") return <Daily snap={snap} rt={rt} />;
  if (snap.panel === "wallet") return <Wallet snap={snap} rt={rt} />;
  if (snap.panel === "leaders") return <Leaders snap={snap} />;
  if (snap.panel === "arcade") return <Arcade rt={rt} />;
  if (snap.panel === "hq") return <Hq snap={snap} rt={rt} />;
  if (snap.panel === "race") return <Race snap={snap} rt={rt} />;
  if (snap.panel === "home") return <Home snap={snap} rt={rt} />;
  if (snap.panel === "talk") return <Talk snap={snap} rt={rt} />;
  if (snap.panel === "paint") return <PaintShop snap={snap} rt={rt} />;
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
  if (panel === "homeedit") return "Edit Home";
  if (panel === "talk") return "Chat";
  if (panel === "paint") return "Jax's Paint Shop";
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
  // invited over to your place and come to house parties.
  const [rel, setRel] = useState<{ label: string; talks: number; level: number; canVisit: boolean; canParty: boolean } | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  // VOICES: NPCs speak their lines aloud. Stop the voice when the
  // talk panel closes; the toggle mutes voices city-wide.
  const [voiceOn, setVoiceOn] = useState<boolean>(() => rt?.npcVoiceOn() ?? true);
  useEffect(() => () => rt?.stopTalkVoice(), [rt]);
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
      <button
        type="button"
        onClick={() => {
          const next = !voiceOn;
          setVoiceOn(next);
          rt?.setNpcVoice(next);
          if (!next) rt?.stopTalkVoice();
        }}
      >
        {voiceOn ? "Voice: on — tap to mute" : "Voice: off — tap to unmute"}
      </button>
      {talk.offerLabel && (
        <button type="button" onClick={() => rt?.npcOffer()}>
          {talk.offerLabel}
        </button>
      )}
      {talk.favorLabel && (
        <button type="button" disabled={!talk.favorAction} onClick={() => rt?.favorAction(talk.name)}>
          {talk.favorLabel}
        </button>
      )}
      {talk.canPaint && (
        <button type="button" onClick={() => rt?.openPaintShop()}>
          Paint shop — respray my car
        </button>
      )}
      {talk.canRob && (
        <button type="button" className="danger" onClick={() => rt?.robNpc()}>
          {talk.robLabel} — hold-up (wanted stars)
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
            ? "Friend — invite them over from your home panel, and they will come to your house parties. 8 chats for Close Friend."
            : rel
              ? "Close Friend — first in line at your house parties."
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
  // On-device wallet (PIN-encrypted, key never leaves this device).
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [localNote, setLocalNote] = useState("");
  const [localForget, setLocalForget] = useState(false);
  const [localDest, setLocalDest] = useState("");
  const [localAmount, setLocalAmount] = useState("0.01");
  const [localReview, setLocalReview] = useState<{ destination: string; amount: string } | null>(null);
  useEffect(() => {
    rt?.refreshWallet();
    rt?.refreshLocalWallet();
  }, [rt]);
  useEffect(() => {
    if (!quote) return;
    document.getElementById("send-sheet")?.scrollIntoView({ block: "nearest" });
  }, [quote]);
  const sol = snap.chainSol == null ? "not read" : `${snap.chainSol} SOL`;
  const token = snap.chainOrbitx == null ? "not read" : `${snap.chainOrbitx} $ORBITX`;
  const localSol = snap.localSol == null ? "not read" : `${snap.localSol} SOL`;
  const localToken = snap.localOrbitx == null ? "not read" : `${snap.localOrbitx} $ORBITX`;
  return (
    <div className="list" data-feature="wallet">
      <p className="play-money">Demo credits in the HUD are play money. This panel is the in-app Solana wallet. The shop does not spend it.</p>
      <h3>On-device wallet</h3>
      <p className="play-money">Made on this device and locked with your PIN. The key never leaves this phone — the server never sees it, and there is no export. Forget the PIN and the wallet is gone.</p>
      {!snap.localAddress ? (
        <>
          <label>
            Choose a PIN (4–8 digits)
            <input id="local-pin-new" type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
          <label>
            Confirm PIN
            <input id="local-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" value={pinConfirm} onChange={(event) => setPinConfirm(event.target.value)} />
          </label>
          <button
            id="local-create"
            type="button"
            onClick={() => {
              setLocalNote("");
              if (pin !== pinConfirm) {
                setLocalNote("The two PINs do not match.");
                return;
              }
              void rt?.createLocalWallet(pin)?.then((res) => {
                const row = res as { ok?: boolean; message?: string; address?: string };
                if (row.ok === false) setLocalNote(String(row.message || "Could not create the wallet."));
                else {
                  setPin("");
                  setPinConfirm("");
                  setLocalNote("Wallet created on this device. Keep your PIN safe — there is no recovery.");
                }
              }).catch((err) => setLocalNote(err instanceof Error ? err.message : "Could not create the wallet."));
            }}
          >Create wallet on this device</button>
        </>
      ) : snap.localUnlocked ? (
        <>
          <p className="addr">{snap.localAddress}</p>
          <p>{localSol} · {localToken}</p>
          <p>Unlocked on this device. Billboards pay from this wallet — lock it when you step away.</p>
          <button id="local-lock" type="button" onClick={() => { void rt?.lockLocalWallet(); }}>Lock wallet</button>
          <h3>Send SOL</h3>
          <label>
            Destination
            <input id="local-send-dest" value={localDest} onChange={(event) => setLocalDest(event.target.value)} />
          </label>
          <label>
            Amount
            <input id="local-send-amount" value={localAmount} onChange={(event) => setLocalAmount(event.target.value)} />
          </label>
          <button id="local-send-review" type="button" onClick={() => setLocalReview({ destination: localDest, amount: localAmount })}>Review send</button>
          {localReview ? (
            <div className="sheet" id="local-send-sheet">
              <h3>Confirm</h3>
              <p>{localReview.amount} SOL</p>
              <p>To {localReview.destination}</p>
              <p>From your on-device wallet. The server only broadcasts what this device signed.</p>
              <button type="button" id="local-send-confirm" onClick={() => {
                void rt?.sendLocalSol(localReview.destination, localReview.amount)?.then((res) => {
                  const row = res as { ok?: boolean; message?: string };
                  if (row.ok === false) setLocalNote(String(row.message || "Send failed."));
                  else {
                    setLocalReview(null);
                    setLocalNote("Sent.");
                  }
                }).catch((err) => setLocalNote(err instanceof Error ? err.message : "Send failed."));
              }}>Confirm</button>
              <button type="button" onClick={() => setLocalReview(null)}>Back</button>
            </div>
          ) : null}
          {localForget ? (
            <div className="sheet" id="local-forget-confirm">
              <p>Forgetting deletes the wallet from this device. The key is gone for good — there is no recovery.</p>
              <button id="local-forget-yes" type="button" onClick={() => { void rt?.forgetLocalWallet(); setLocalForget(false); setLocalNote("Wallet forgotten on this device."); }}>Forget it</button>
              <button type="button" onClick={() => setLocalForget(false)}>Keep it</button>
            </div>
          ) : (
            <button id="local-forget" type="button" onClick={() => setLocalForget(true)}>Forget wallet</button>
          )}
        </>
      ) : (
        <>
          <p className="addr">{snap.localAddress}</p>
          <p>Locked — enter your PIN to unlock.</p>
          <label>
            PIN
            <input id="local-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
          <button
            id="local-unlock"
            type="button"
            onClick={() => {
              setLocalNote("");
              void rt?.unlockLocalWallet(pin)?.then((res) => {
                const row = res as { ok?: boolean; message?: string };
                if (row.ok === false) setLocalNote(String(row.message || "Wrong PIN."));
                else setPin("");
              }).catch((err) => setLocalNote(err instanceof Error ? err.message : "Could not unlock."));
            }}
          >Unlock</button>
          {localForget ? (
            <div className="sheet" id="local-forget-confirm">
              <p>Forgetting deletes the wallet from this device. The key is gone for good — there is no recovery.</p>
              <button id="local-forget-yes" type="button" onClick={() => { void rt?.forgetLocalWallet(); setLocalForget(false); setLocalNote("Wallet forgotten on this device."); }}>Forget it</button>
              <button type="button" onClick={() => setLocalForget(false)}>Keep it</button>
            </div>
          ) : (
            <button id="local-forget" type="button" onClick={() => setLocalForget(true)}>Forget wallet</button>
          )}
        </>
      )}
      {localNote ? <p id="local-wallet-note">{localNote}</p> : null}
      <h3>Server wallet</h3>
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
      <h3>Checkpoint time trials</h3>
      <p>
        Solo runs against the clock — drive to the gold start pillar, chase the lit checkpoints, medals pay City Sol.
        Best times live on this device.
      </p>
      {snap.raceRoutes.map((route) => (
        <article key={route.id}>
          <div>
            <b>{route.name}</b>
            <span>{route.blurb}</span>
            <span>
              {route.checkpoints} checkpoints · Gold {route.gold}s · Silver {route.silver}s · Bronze {route.bronze}s
              {route.best !== null ? ` · Your best ${(route.best / 1000).toFixed(1)}s` : " · No finish yet"}
            </span>
          </div>
          {snap.trial?.routeId === route.id ? (
            <button type="button" onClick={() => rt?.abandonTrial()}>Abandon</button>
          ) : (
            <button type="button" disabled={!!snap.trial} onClick={() => rt?.startTrial(route.id)}>
              {snap.trial ? "Race running" : "Start"}
            </button>
          )}
        </article>
      ))}
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

/** Readable text colour on a paint swatch (black on light paint). */
function swatchText(hex: number): string {
  const lum = ((hex >> 16) & 255) * 0.299 + ((hex >> 8) & 255) * 0.587 + (hex & 255) * 0.114;
  return lum > 140 ? "#000" : "#fff";
}

function colorLabel(key: string): string {
  return CUSTOM_PAINT_NAMES[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

function PaintShop({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const paint = snap.paint;
  const [msg, setMsg] = useState("");
  if (!paint) return <p>Paint shop closed — tap Close and keep playing.</p>;
  const selectedPremium = paint.selected in CUSTOM_PAINT_HEX;
  const price = paint.applied ? 0 : selectedPremium ? CUSTOM_PAINT_PRICE : 0;
  const cantAfford = selectedPremium && !paint.applied && snap.balance < CUSTOM_PAINT_PRICE;
  const swatch = (key: string, hex: number, premium: boolean) => (
    <button
      key={key}
      type="button"
      className={paint.selected === key ? "on" : ""}
      style={{ background: `#${hex.toString(16).padStart(6, "0")}`, color: swatchText(hex) }}
      disabled={paint.busy || !!paint.applied}
      onClick={() => {
        setMsg("");
        rt?.paintPreview(key);
      }}
    >
      {colorLabel(key)}
      <small>{premium ? `${CUSTOM_PAINT_PRICE} Sol` : "Free"}</small>
    </button>
  );
  return (
    <div className="list" data-feature="paint">
      <p>
        <b>{paint.vehicleName}</b> · in the bay at OrbitX Motors
      </p>
      <p className="quiet">
        Swatches repaint the car live — nothing is charged until you apply. Balance {snap.balance} City Sol.
      </p>
      <h3>Premium sprays — {CUSTOM_PAINT_PRICE} City Sol</h3>
      <div className="paint-swatches">
        {Object.entries(CUSTOM_PAINT_HEX).map(([key, hex]) => swatch(key, hex, true))}
      </div>
      <h3>Factory colours — free respray</h3>
      <div className="paint-swatches">
        {paint.factory.map((key) => swatch(key, VEHICLE_COLORS[key] ?? 0x16181f, false))}
      </div>
      {msg ? <p>{msg}</p> : null}
      {paint.applied ? (
        <p>
          Sprayed <b>{colorLabel(paint.applied)}</b> — it stays on the car. Tap Close when you're done.
        </p>
      ) : (
        <>
          <button
            type="button"
            disabled={paint.busy || cantAfford}
            onClick={async () => {
              const result = await rt?.applyPaintShop();
              if (result) setMsg(result);
            }}
          >
            {paint.busy
              ? "Spraying…"
              : paint.selected === paint.saved
                ? `Keep ${colorLabel(paint.selected)} — no charge`
                : price > 0
                  ? `Apply ${colorLabel(paint.selected)} — ${price} City Sol`
                  : `Apply ${colorLabel(paint.selected)} — free`}
          </button>
          {cantAfford ? <p className="quiet">Not enough City Sol for a premium spray — factory colours are free.</p> : null}
          <button type="button" disabled={paint.busy} onClick={() => rt?.cancelPaintShop()}>
            Cancel — keep {colorLabel(paint.saved)}
          </button>
        </>
      )}
    </div>
  );
}

export function EmoteWheel({ index, rt }: { index: number; rt: Runtime | null }) {
  // Tap-to-pick (v41): tapping a slice plays that emote and closes
  // the wheel; the centre ✕ (or Esc, or the HUD Emote button) closes
  // it without playing. Hovering a slice aims the highlight, which
  // is also what a canvas click commits on desktop pointer-lock.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") rt?.setWheel(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rt]);
  // Slices are centred on their radial points: the inline transform
  // must repeat the CSS translate(-50%,-50%) or the buttons pile up
  // from their top-left corners. The radius shrinks on phone widths
  // so all eight slices stay on screen.
  const radius = typeof window !== "undefined" && window.innerWidth < 480 ? 104 : 96;
  return (
    <div className="wheel" data-feature="emote">
      {EMOTES.map((name, i) => {
        const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button
            key={name}
            type="button"
            className={i === index ? "on" : ""}
            style={{ transform: `translate(-50%, -50%) translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius}px)` }}
            onMouseEnter={() => rt?.aimWheelIndex(i)}
            onClick={() => rt?.pickEmote(i)}
          >
            {EMOTE_LABELS[name] ?? name}
          </button>
        );
      })}
      <button type="button" className="wheel-close" aria-label="Close emotes" onClick={() => rt?.setWheel(false)}>
        ✕
      </button>
    </div>
  );
}

export function DecorBar({ kind, rt, mode, owned }: { kind: string; rt: Runtime | null; mode?: string; owned?: string[] }) {
  const home = mode === "home";
  const ownedCounts = new Map<string, number>();
  for (const id of owned || []) ownedCounts.set(id, (ownedCounts.get(id) || 0) + 1);
  return (
    <div className="decor-bar" data-feature="decorate">
      {home ? (
        FURNITURE_CATALOG.map((item) => {
          const count = ownedCounts.get(item.id) || 0;
          return (
            <button key={item.id} type="button" className={kind === item.id ? "on" : ""} onClick={() => rt?.pickFurniture(item.id)}>
              {count > 0 ? `${item.name} ×${count}` : `${item.name} (${item.price} Sol)`}
            </button>
          );
        })
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
