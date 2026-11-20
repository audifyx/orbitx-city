// Mini-Games Hub (Neon Arcade) — 2-player PvP pot games in real ORBITX.
// Coin Flip + Dice Roll (instant, server flips/rolls) and the live match
// games — Rock Paper Scissors, High Card, Quick Draw — played in rounds
// over arcade-act with the server as referee. $1/$2/$5/$10 entries from
// the on-device wallet. Winner takes the FULL pot (both entries), no
// house cut. Entries are device-signed (the server composes, the PIN
// wallet signs); payouts come from the arcade escrow automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Runtime, Snap } from "./game/runtime";

type ArcadeGameKind = "coinflip" | "diceroll" | "rps" | "highcard" | "quickdraw";

const INTERACTIVE_KINDS: string[] = ["rps", "highcard", "quickdraw"];
function isInteractive(game: string) {
  return INTERACTIVE_KINDS.includes(game);
}

interface ArcadeCard {
  r: number;
  s: string;
}

interface ArcadeMatch {
  kind: string;
  phase: string;
  round: number;
  score: { creator: number; joiner: number };
  history: Array<Record<string, unknown>>;
  deadlineAt: string;
  over: boolean;
  myPick?: string;
  oppPicked?: boolean;
  redraws?: number;
  myRevealed?: boolean;
  oppRevealed?: boolean;
  myCard?: ArcadeCard | null;
  oppCard?: ArcadeCard | null;
  myReady?: boolean;
  oppReady?: boolean;
  fired?: boolean;
}

interface ArcadeGameRow {
  id: string;
  game: string;
  gameName: string;
  tierUsd: number;
  entryUi: number;
  potUi: number;
  status: string;
  creator: { id: string; name: string };
  creatorPick: string;
  joiner: { id: string; name: string } | null;
  joinerPick: string;
  result: string;
  winnerId: string;
  winnerName: string;
  payoutSignature: string;
  refundSignature: string;
  entrySignature: string;
  joinerEntrySignature: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string;
  error: string;
  match?: ArcadeMatch | null;
}

interface ArcadeTier {
  usd: number;
  entryRaw: string;
  entryUi: number;
  potUi: number;
}

interface ArcadeLobby {
  ok: boolean;
  you: string;
  tiers: ArcadeTier[];
  joinTimeoutMs: number;
  escrowNote: string;
  orbitx: number | null;
  open: ArcadeGameRow[];
  mine: ArcadeGameRow[];
  message?: string;
}

interface LeaderRow {
  id: string;
  name: string;
  wins: number;
  biggest: number;
  games: number;
}

const GAME_DEFS: Array<{ kind: ArcadeGameKind; name: string; blurb: string; picks: string[] }> = [
  { kind: "coinflip", name: "Coin Flip", blurb: "Heads or tails — the server flips, 50/50.", picks: ["heads", "tails"] },
  { kind: "diceroll", name: "Dice Roll", blurb: "High (4–6) or low (1–3) — the server rolls, 50/50.", picks: ["high", "low"] },
  { kind: "rps", name: "Rock Paper Scissors", blurb: "Best of 3 rounds. Picks lock in secret and reveal together — ties replay the round.", picks: [] },
  { kind: "highcard", name: "High Card", blurb: "The server deals both cards face-down. Reveal together — high card takes the pot. Ties redraw (3 max), then the pot splits.", picks: [] },
  { kind: "quickdraw", name: "Quick Draw", blurb: "Ready up, wait for DRAW, tap first. Best of 3, timed by the server — tap before the signal and you lose the round.", picks: [] },
];

// Local W/L record per game (display only — settlement is server truth,
// same pattern as the boxing record).
const PVP_RECORD_KEY = "orbitx-city-pvp-v1";
const PVP_COUNTED_KEY = "orbitx-city-pvp-counted-v1";
type PvpRecord = Record<string, { w: number; l: number }>;

function loadPvpRecord(): PvpRecord {
  try {
    return JSON.parse(localStorage.getItem(PVP_RECORD_KEY) || "{}") as PvpRecord;
  } catch {
    return {};
  }
}

function loadCounted(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PVP_COUNTED_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

function shortSig(sig: string) {
  if (!sig) return "";
  return sig.length > 16 ? `${sig.slice(0, 8)}…${sig.slice(-6)}` : sig;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

function oppositePick(game: string, pick: string) {
  if (game === "coinflip") return pick === "heads" ? "tails" : "heads";
  return pick === "high" ? "low" : "high";
}

const RANK_LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_LABEL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
function cardText(card: ArcadeCard | null | undefined) {
  if (!card) return "face down";
  return `${RANK_LABEL[card.r] || card.r}${SUIT_LABEL[card.s] || ""}`;
}

function resultLabel(game: ArcadeGameRow) {
  if (game.game === "diceroll") {
    const roll = Number(game.result || 0);
    return roll ? `Rolled a ${roll} (${roll >= 4 ? "high" : "low"})` : "";
  }
  if (game.game === "coinflip") {
    return game.result ? `Landed ${game.result}` : "";
  }
  if (game.result === "forfeit") return "Decided by forfeit — a player stalled out";
  if (game.result === "split") return "Dead even — pot split, entries returned";
  if (game.result === "abandoned") return "No contest — entries returned";
  if (game.game === "highcard") {
    return game.result ? `Final card: ${game.result}` : "";
  }
  if (game.match) return `Final score ${game.match.score.creator}–${game.match.score.joiner}`;
  return game.result || "";
}

export function MinigamesPanel({ snap, rt }: { snap: Snap; rt: Runtime | null }) {
  const [tab, setTab] = useState<"play" | "open" | "history" | "leaders">("play");
  const [lobby, setLobby] = useState<ArcadeLobby | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [game, setGame] = useState<ArcadeGameKind>("coinflip");
  const [tier, setTier] = useState(1);
  const [pick, setPick] = useState("heads");
  const [history, setHistory] = useState<ArcadeGameRow[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [myLeader, setMyLeader] = useState<LeaderRow | null>(null);
  const [lastResult, setLastResult] = useState<ArcadeGameRow | null>(null);
  const [you, setYou] = useState("");
  const [record, setRecord] = useState<PvpRecord>(loadPvpRecord);
  const pollRef = useRef<number | null>(null);

  const loadLobby = useCallback(async () => {
    if (!rt) return;
    try {
      const data = (await rt.arcadeLobby()) as unknown as ArcadeLobby;
      if (data && data.ok !== false) {
        setLobby(data);
        if (data.you) setYou(data.you);
        setError("");
      } else {
        setError(String((data as { message?: string })?.message || "Could not load the arcade."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the arcade.");
    } finally {
      setLoading(false);
    }
  }, [rt]);

  useEffect(() => {
    void loadLobby();
  }, [loadLobby]);

  // Poll while I have a live game: 2s waiting for an opponent, 1s inside
  // a match, 400ms in a Quick Draw (the signal waits for nobody).
  const myGame =
    lobby?.mine.find((g) => ["composed", "open", "join-composed", "playing", "settling"].includes(g.status)) || null;
  const inMatch = myGame?.status === "playing" || myGame?.status === "settling";
  const pollMs = inMatch ? (myGame?.game === "quickdraw" ? 400 : 1000) : myGame ? 2000 : 0;
  useEffect(() => {
    if (!pollMs || !rt) return;
    pollRef.current = window.setInterval(() => {
      void loadLobby();
    }, pollMs);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [pollMs, rt, loadLobby]);

  // A live game that just resolved/refunded becomes the result screen,
  // and lands in the local W/L record exactly once.
  useEffect(() => {
    if (!lobby) return;
    const done = lobby.mine.find((g) => ["resolved", "refunded"].includes(g.status));
    if (!done || done.id === lastResult?.id) return;
    setLastResult(done);
    if (done.status === "resolved" && you) {
      const counted = loadCounted();
      if (!counted.includes(done.id)) {
        counted.push(done.id);
        try {
          localStorage.setItem(PVP_COUNTED_KEY, JSON.stringify(counted.slice(-100)));
        } catch {
          // Record is a nicety — never break the hub over it.
        }
        setRecord((prev) => {
          const next = { ...prev, [done.game]: { ...(prev[done.game] || { w: 0, l: 0 }) } };
          if (done.winnerId === you) next[done.game].w += 1;
          else next[done.game].l += 1;
          try {
            localStorage.setItem(PVP_RECORD_KEY, JSON.stringify(next));
          } catch {
            // Same as above.
          }
          return next;
        });
      }
    }
  }, [lobby, lastResult, you]);

  const tierInfo = lobby?.tiers.find((t) => t.usd === tier) || null;
  const myOrbitx = lobby?.orbitx ?? snap.localOrbitx ?? null;
  const walletReady = snap.localAddress !== "" && snap.localUnlocked;
  const gameDef = GAME_DEFS.find((d) => d.kind === game) || GAME_DEFS[0];
  const myRecord = record[game];

  async function create() {
    if (!rt || busy) return;
    setBusy(true);
    setError("");
    try {
      const done = (await rt.arcadeCreate(game, tier, isInteractive(game) ? "" : pick)) as unknown as { ok?: boolean; message?: string; game?: ArcadeGameRow };
      if (done?.game) {
        setLastResult(null);
        await loadLobby();
      } else if (!done?.ok) {
        setError(String(done?.message || "The city refused the game."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function join(row: ArcadeGameRow) {
    if (!rt || busy) return;
    setBusy(true);
    setError("");
    try {
      const joinPick = isInteractive(row.game) ? "" : oppositePick(row.game, row.creatorPick);
      const done = (await rt.arcadeJoin(row.id, row.game as ArcadeGameKind, row.tierUsd, joinPick)) as unknown as { ok?: boolean; message?: string; game?: ArcadeGameRow };
      if (done?.game) {
        if (done.game.status === "resolved" || done.game.status === "refunded") setLastResult(done.game);
        await loadLobby();
      } else if (!done?.ok) {
        setError(String(done?.message || "The city refused the join."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!rt || !myGame || busy) return;
    setBusy(true);
    try {
      await rt.arcadeCancel(myGame.id);
      await loadLobby();
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, value = "") {
    if (!rt || !myGame) return;
    // A Quick Draw tap must leave NOW — no busy gate on the shot itself.
    const light = action === "tap";
    if (!light && busy) return;
    if (!light) setBusy(true);
    setError("");
    try {
      const done = (await rt.arcadeAct(myGame.id, action, value)) as unknown as { ok?: boolean; message?: string };
      if (done && done.ok === false) setError(String(done.message || "That move did not land."));
      await loadLobby();
    } finally {
      if (!light) setBusy(false);
    }
  }

  async function openHistory() {
    setTab("history");
    if (!rt) return;
    try {
      const data = (await rt.arcadeHistory()) as unknown as { games?: ArcadeGameRow[] };
      setHistory(data?.games || []);
    } catch {
      setHistory([]);
    }
  }

  async function openLeaders() {
    setTab("leaders");
    if (!rt) return;
    try {
      const data = (await rt.arcadeLeaders()) as unknown as { leaders?: LeaderRow[]; mine?: LeaderRow | null };
      setLeaders(data?.leaders || []);
      setMyLeader(data?.mine || null);
    } catch {
      setLeaders([]);
    }
  }

  const myId = you;
  const iWonLast = lastResult && lastResult.winnerId === myId;

  return (
    <div className="list">
      <p className="muted">
        2-player pot games in real ORBITX. Winner takes the whole pot — both entries, no house cut.
        {myOrbitx !== null ? ` Your on-device wallet: ${fmt(myOrbitx)} ORBITX.` : ""}
      </p>
      {!walletReady ? (
        <p>
          Create and unlock your on-device wallet in the Wallet panel first — entries come from it, winnings go back to it.
        </p>
      ) : null}
      {error ? <p>{error}</p> : null}
      {loading ? <p>Loading the arcade…</p> : null}

      {lastResult && ["resolved", "refunded"].includes(lastResult.status) ? (
        <article>
          <div>
            <b>{lastResult.status === "resolved" ? (iWonLast ? `You won ${fmt(lastResult.potUi)} ORBITX!` : `${lastResult.winnerName || "Your opponent"} won the pot`) : "Entry refunded"}</b>
            <span>
              {lastResult.gameName} · ${lastResult.tierUsd} · {resultLabel(lastResult)}
              {lastResult.payoutSignature ? ` · payout ${shortSig(lastResult.payoutSignature)}` : ""}
              {lastResult.refundSignature ? ` · refund ${shortSig(lastResult.refundSignature)}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLastResult(null);
              setTab("play");
            }}
          >
            Play again
          </button>
        </article>
      ) : null}

      {inMatch && myGame ? (
        <MatchCard game={myGame} you={myId} busy={busy} onAct={(a, v) => void act(a, v)} />
      ) : myGame ? (
        <article>
          <div>
            <b>Waiting for an opponent…</b>
            <span>
              {myGame.gameName} · ${myGame.tierUsd}
              {isInteractive(myGame.game)
                ? ` · live match, first to take it · pot ${fmt(myGame.potUi)} ORBITX`
                : ` · you picked ${myGame.creatorPick} · pot ${fmt(myGame.potUi)} ORBITX`}
              {myGame.expiresAt ? ` · auto-refund ${new Date(myGame.expiresAt).toLocaleTimeString()}` : ""}
            </span>
          </div>
          {["composed", "open"].includes(myGame.status) ? (
            <button type="button" onClick={() => void cancel()} disabled={busy}>
              Cancel + refund
            </button>
          ) : null}
        </article>
      ) : null}

      <div className="days">
        <button type="button" className={tab === "play" ? "on" : undefined} onClick={() => setTab("play")}>Play</button>
        <button type="button" className={tab === "open" ? "on" : undefined} onClick={() => setTab("open")}>Open games ({lobby?.open.length ?? 0})</button>
        <button type="button" className={tab === "history" ? "on" : undefined} onClick={() => void openHistory()}>History</button>
        <button type="button" className={tab === "leaders" ? "on" : undefined} onClick={() => void openLeaders()}>Leaders</button>
      </div>

      {tab === "play" && !myGame ? (
        <div>
          <h3>Pick a game</h3>
          <div className="days">
            {GAME_DEFS.map((d) => (
              <button
                key={d.kind}
                type="button"
                className={game === d.kind ? "on" : undefined}
                onClick={() => {
                  setGame(d.kind);
                  if (d.picks.length) setPick(d.picks[0]);
                }}
              >
                {d.name}
              </button>
            ))}
          </div>
          <p className="muted">{gameDef.blurb}</p>
          {myRecord && myRecord.w + myRecord.l > 0 ? (
            <p className="muted">
              Your {gameDef.name} record: {myRecord.w} {myRecord.w === 1 ? "win" : "wins"} · {myRecord.l} {myRecord.l === 1 ? "loss" : "losses"}.
            </p>
          ) : null}
          <h3>Entry — winner takes the pot</h3>
          <div className="days">
            {(lobby?.tiers || []).map((t) => (
              <button key={t.usd} type="button" className={tier === t.usd ? "on" : undefined} onClick={() => setTier(t.usd)}>
                ${t.usd} · {fmt(t.entryUi)} ORBITX
              </button>
            ))}
          </div>
          {gameDef.picks.length ? (
            <>
              <h3>Your side</h3>
              <div className="days">
                {gameDef.picks.map((p) => (
                  <button key={p} type="button" className={pick === p ? "on" : undefined} onClick={() => setPick(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <p>
            Entry {tierInfo ? fmt(tierInfo.entryUi) : "…"} ORBITX · Pot {tierInfo ? fmt(tierInfo.potUi) : "…"} ORBITX to the winner.
          </p>
          <button type="button" onClick={() => void create()} disabled={busy || !walletReady}>
            {busy ? "Signing…" : `Create game — $${tier}`}
          </button>
          <p className="muted">
            {isInteractive(game)
              ? "Your entry goes to the arcade escrow. When a second player joins, the match starts here — rounds are refereed by the server."
              : "Your entry goes to the arcade escrow until someone joins. No opponent in 2 minutes and it comes straight back."}
          </p>
        </div>
      ) : null}

      {tab === "open" ? (
        <div>
          <h3>Open games</h3>
          {(lobby?.open.length ?? 0) === 0 ? (
            <p>No open games right now. Create one and someone will join you.</p>
          ) : (
            lobby?.open.map((row) => (
              <article key={row.id}>
                <div>
                  <b>{row.creator.name} · {row.gameName} · ${row.tierUsd}</b>
                  <span>
                    {isInteractive(row.game)
                      ? `Live match — rounds played in the hub · pot ${fmt(row.potUi)} ORBITX`
                      : `They picked ${row.creatorPick} — you take ${oppositePick(row.game, row.creatorPick)} · pot ${fmt(row.potUi)} ORBITX`}
                  </span>
                </div>
                <button type="button" onClick={() => void join(row)} disabled={busy || !walletReady}>
                  Join — ${row.tierUsd}
                </button>
              </article>
            ))
          )}
          <button type="button" onClick={() => void loadLobby()}>
            Refresh
          </button>
        </div>
      ) : null}

      {tab === "history" ? (
        <div>
          <h3>Your games</h3>
          {history.length === 0 ? (
            <p>No games yet.</p>
          ) : (
            history.map((row) => (
              <article key={row.id}>
                <div>
                  <b>
                    {row.gameName} · ${row.tierUsd} · {row.status}
                  </b>
                  <span>
                    {resultLabel(row)}
                    {row.status === "resolved" ? (row.winnerId === myId ? ` · you won ${fmt(row.potUi)} ORBITX` : ` · ${row.winnerName || "opponent"} won`) : ""}
                    {row.payoutSignature ? ` · ${shortSig(row.payoutSignature)}` : ""}
                    {row.refundSignature ? ` · refund ${shortSig(row.refundSignature)}` : ""}
                  </span>
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}

      {tab === "leaders" ? (
        <div>
          <h3>Top winners</h3>
          {leaders.length === 0 ? (
            <p>No winners yet. Be the first.</p>
          ) : (
            leaders.map((row, i) => (
              <article key={row.id}>
                <div>
                  <b>
                    {i + 1}. {row.name}
                  </b>
                  <span>
                    {row.wins} {row.wins === 1 ? "win" : "wins"} · biggest pot {fmt(row.biggest)} ORBITX · {row.games} games
                  </span>
                </div>
              </article>
            ))
          )}
          {myLeader && myLeader.games > 0 ? (
            <p className="muted">
              You: {myLeader.wins} {myLeader.wins === 1 ? "win" : "wins"} · biggest pot {fmt(myLeader.biggest)} ORBITX · {myLeader.games} games.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The live match card: score, phase, and the one control the current
// phase wants. Everything shown comes from the server's sanitized match
// view — the opponent's pick/card is simply never in it until the round
// resolves into history.
function MatchCard({
  game,
  you,
  busy,
  onAct,
}: {
  game: ArcadeGameRow;
  you: string;
  busy: boolean;
  onAct: (action: string, value?: string) => void;
}) {
  const m = game.match;
  if (!m) return null;
  const iAmCreator = game.creator.id === you;
  const oppName = (iAmCreator ? game.joiner?.name : game.creator.name) || "Opponent";
  const myScore = iAmCreator ? m.score.creator : m.score.joiner;
  const oppScore = iAmCreator ? m.score.joiner : m.score.creator;
  const mySide = iAmCreator ? "creator" : "joiner";
  const roundWinnerText = (winner: string) => (winner === "tie" ? "tie" : winner === mySide ? "you took it" : `${oppName} took it`);

  return (
    <article>
      <div>
        <b>
          {game.gameName} · ${game.tierUsd} · pot {fmt(game.potUi)} ORBITX
        </b>
        <span>
          You {myScore} — {oppScore} {oppName} · round {m.round}
          {game.status === "settling" ? " · settling the pot…" : ""}
          {m.deadlineAt && game.status === "playing" ? ` · stall clock to ${new Date(m.deadlineAt).toLocaleTimeString()}` : ""}
        </span>
      </div>

      {game.game === "rps" ? (
        <div>
          {m.phase === "pick" ? (
            m.myPick ? (
              <p>
                Locked in: <b>{m.myPick}</b>. {m.oppPicked ? `${oppName} has locked too — revealing…` : `Waiting for ${oppName} to pick…`}
              </p>
            ) : (
              <>
                <p>Pick your throw — it locks the moment you tap, and stays secret until both are in.</p>
                <div className="days">
                  {["rock", "paper", "scissors"].map((p) => (
                    <button key={p} type="button" onClick={() => onAct("pick", p)} disabled={busy}>
                      {p}
                    </button>
                  ))}
                </div>
              </>
            )
          ) : null}
          {m.history.length ? (
            <p className="muted">
              {m.history.map((h, i) => {
                const mine = iAmCreator ? h.creatorPick : h.joinerPick;
                const theirs = iAmCreator ? h.joinerPick : h.creatorPick;
                return (
                  <span key={i}>
                    R{String(h.round)}: your {String(mine)} vs {String(theirs)} — {roundWinnerText(String(h.winner))}.{" "}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {game.game === "highcard" ? (
        <div>
          <p>
            Your card: <b>face down</b> · {oppName}: <b>face down</b>
            {m.redraws ? ` · ${m.redraws} redraw${m.redraws === 1 ? "" : "s"} used` : ""}
          </p>
          {m.phase === "reveal" ? (
            m.myRevealed ? (
              <p>
                You're revealed. {m.oppRevealed ? "Flipping…" : `Waiting for ${oppName} to reveal…`}
              </p>
            ) : (
              <button type="button" onClick={() => onAct("reveal")} disabled={busy}>
                Reveal my card
              </button>
            )
          ) : null}
          {m.history.length ? (
            <p className="muted">
              {m.history.map((h, i) => {
                const mine = (iAmCreator ? h.creatorCard : h.joinerCard) as ArcadeCard;
                const theirs = (iAmCreator ? h.joinerCard : h.creatorCard) as ArcadeCard;
                return (
                  <span key={i}>
                    Deal {String(h.round)}: your {cardText(mine)} vs {cardText(theirs)} — {roundWinnerText(String(h.winner))}.{" "}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {game.game === "quickdraw" ? (
        <div>
          {m.phase === "ready" ? (
            m.myReady ? (
              <p>
                You're ready. {m.oppReady ? "Arming the draw…" : `Waiting for ${oppName} to ready up…`}
              </p>
            ) : (
              <>
                <p>When both players are ready, the server fires DRAW after a short random pause. Tap first — but never early.</p>
                <button type="button" onClick={() => onAct("ready")} disabled={busy}>
                  Ready
                </button>
              </>
            )
          ) : null}
          {m.phase === "wait" ? (
            <>
              <p>
                <b>{m.fired ? "DRAW!" : "Wait for it…"}</b> {m.fired ? "Tap NOW." : "Hand steady — an early tap loses the round."}
              </p>
              <button type="button" style={{ width: "100%", padding: "22px 0", fontSize: 20 }} onClick={() => onAct("tap")}>
                TAP
              </button>
              <p className="muted">Reaction times are measured by the server when your tap lands.</p>
            </>
          ) : null}
          {m.history.length ? (
            <p className="muted">
              {m.history.map((h, i) => {
                if (h.reason === "void") return <span key={i}>R{String(h.round)}: nobody drew — round replayed. </span>;
                if (h.reason === "false-start")
                  return (
                    <span key={i}>
                      R{String(h.round)}: {h.loser === mySide ? "you" : oppName} jumped the gun — {roundWinnerText(String(h.winner))}.{" "}
                    </span>
                  );
                return (
                  <span key={i}>
                    R{String(h.round)}: {h.winner === mySide ? "you drew" : `${oppName} drew`} in {String(h.reactionMs)}ms (server-timed) — {roundWinnerText(String(h.winner))}.{" "}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
