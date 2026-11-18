// Mini-Games Hub (Neon Arcade) — 2-player PvP pot games in real ORBITX.
// Coin Flip + Dice Roll, $1/$2/$5/$10 entries from the on-device wallet.
// Winner takes the FULL pot (both entries), no house cut. The entry is
// device-signed (the server composes, the PIN wallet signs); the server
// flips/rolls and pays the winner automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Runtime, Snap } from "./game/runtime";

type ArcadeGameKind = "coinflip" | "diceroll";

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

function resultLabel(game: ArcadeGameRow) {
  if (game.game === "diceroll") {
    const roll = Number(game.result || 0);
    return roll ? `Rolled a ${roll} (${roll >= 4 ? "high" : "low"})` : "";
  }
  return game.result ? `Landed ${game.result}` : "";
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

  // While I'm in a live game, poll the lobby every 2s: an opponent
  // joining resolves the game, and the timeout refunds it.
  const myGame = lobby?.mine.find((g) => ["composed", "open", "join-composed"].includes(g.status)) || null;
  const waiting = !!myGame;
  useEffect(() => {
    if (!waiting || !rt) return;
    pollRef.current = window.setInterval(() => {
      void loadLobby();
    }, 2000);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [waiting, rt, loadLobby]);

  // A live game that just resolved/refunded becomes the result screen.
  useEffect(() => {
    if (!lobby) return;
    const done = lobby.mine.find((g) => ["resolved", "refunded"].includes(g.status));
    if (done && done.id !== lastResult?.id) setLastResult(done);
  }, [lobby, lastResult]);

  const tierInfo = lobby?.tiers.find((t) => t.usd === tier) || null;
  const myOrbitx = lobby?.orbitx ?? snap.localOrbitx ?? null;
  const walletReady = snap.localAddress !== "" && snap.localUnlocked;

  async function create() {
    if (!rt || busy) return;
    setBusy(true);
    setError("");
    try {
      const done = (await rt.arcadeCreate(game, tier, pick)) as unknown as { ok?: boolean; message?: string; game?: ArcadeGameRow };
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
      const done = (await rt.arcadeJoin(row.id, row.game as ArcadeGameKind, row.tierUsd, oppositePick(row.game, row.creatorPick))) as unknown as { ok?: boolean; message?: string; game?: ArcadeGameRow };
      if (done?.game) {
        setLastResult(done.game);
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

  const picks = game === "coinflip" ? ["heads", "tails"] : ["high", "low"];
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

      {waiting && myGame ? (
        <article>
          <div>
            <b>Waiting for an opponent…</b>
            <span>
              {myGame.gameName} · ${myGame.tierUsd} · you picked {myGame.creatorPick} · pot {fmt(myGame.potUi)} ORBITX
              {myGame.expiresAt ? ` · auto-refund ${new Date(myGame.expiresAt).toLocaleTimeString()}` : ""}
            </span>
          </div>
          <button type="button" onClick={() => void cancel()} disabled={busy}>
            Cancel + refund
          </button>
        </article>
      ) : null}

      <div className="days">
        <button type="button" className={tab === "play" ? "on" : undefined} onClick={() => setTab("play")}>Play</button>
        <button type="button" className={tab === "open" ? "on" : undefined} onClick={() => setTab("open")}>Open games ({lobby?.open.length ?? 0})</button>
        <button type="button" className={tab === "history" ? "on" : undefined} onClick={() => void openHistory()}>History</button>
        <button type="button" className={tab === "leaders" ? "on" : undefined} onClick={() => void openLeaders()}>Leaders</button>
      </div>

      {tab === "play" && !waiting ? (
        <div>
          <h3>Pick a game</h3>
          <div className="days">
            <button type="button" className={game === "coinflip" ? "on" : undefined} onClick={() => { setGame("coinflip"); setPick("heads"); }}>Coin Flip</button>
            <button type="button" className={game === "diceroll" ? "on" : undefined} onClick={() => { setGame("diceroll"); setPick("high"); }}>Dice Roll</button>
          </div>
          <p className="muted">{game === "coinflip" ? "Heads or tails — the server flips, 50/50." : "High (4–6) or low (1–3) — the server rolls, 50/50."}</p>
          <h3>Entry — winner takes the pot</h3>
          <div className="days">
            {(lobby?.tiers || []).map((t) => (
              <button key={t.usd} type="button" className={tier === t.usd ? "on" : undefined} onClick={() => setTier(t.usd)}>
                ${t.usd} · {fmt(t.entryUi)} ORBITX
              </button>
            ))}
          </div>
          <h3>Your side</h3>
          <div className="days">
            {picks.map((p) => (
              <button key={p} type="button" className={pick === p ? "on" : undefined} onClick={() => setPick(p)}>
                {p}
              </button>
            ))}
          </div>
          <p>
            Entry {tierInfo ? fmt(tierInfo.entryUi) : "…"} ORBITX · Pot {tierInfo ? fmt(tierInfo.potUi) : "…"} ORBITX to the winner.
          </p>
          <button type="button" onClick={() => void create()} disabled={busy || !walletReady}>
            {busy ? "Signing…" : `Create game — $${tier}`}
          </button>
          <p className="muted">
            Your entry goes to the arcade escrow until someone joins. No opponent in 2 minutes and it comes straight back.
          </p>
        </div>
      ) : null}

      {tab === "open" ? (
        <div>
          <h3>Open games — take the other side</h3>
          {(lobby?.open.length ?? 0) === 0 ? (
            <p>No open games right now. Create one and someone will join you.</p>
          ) : (
            lobby?.open.map((row) => (
              <article key={row.id}>
                <div>
                  <b>{row.creator.name} · {row.gameName} · ${row.tierUsd}</b>
                  <span>
                    They picked {row.creatorPick} — you take {oppositePick(row.game, row.creatorPick)} · pot {fmt(row.potUi)} ORBITX
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
