import { AuthPanel } from "../AuthPanel";
import type { Account } from "../auth";
import type { HomePage } from "../HomePages";
import { HOW_TO } from "../MenuHome";
import { CITY_FACTS, FEATURE_HIGHLIGHTS } from "../game/cityFacts";
import type { ConsoleGameId } from "./ConsoleHome";
import "./console.css";

// OrbitX console game page (Round 7) — the PS5-style game page a tile
// opens: art hero, title, description, what you can do, live numbers,
// and Play. Every number comes from the real catalogs (CITY_FACTS /
// FEATURE_HIGHLIGHTS) or the live universe list — nothing invented.
//
// OrbitX City: Play keeps the existing entry points — the AuthPanel
// (sign-in, sign-up, X, guest) when signed out, the big PLAY button
// once signed in or guest, and the classic menu one tap away. Play
// hands off to the existing enterCity door (roster, or the early-access
// gate for a locked account).
// OrbitX: Play is an external link to https://orbitx.world in a new
// tab — the platform is not the city, and the city stays put.
interface GamePageProps {
  game: ConsoleGameId;
  who: Account | null;
  gate: "login" | "city";
  online: number | null;
  onBack: () => void;
  onPlayCity: () => void;
  onAccount: (account: Account) => void;
  onGuest: () => void;
  onBackToLogin: () => void;
  onOpenPage: (page: HomePage) => void;
  onClassicMenu: () => void;
}

// The platform's feature set, as shipped: a Solana super-app — DEX,
// launchpad, social hub, AI/MCP trading. No counts here; the platform
// does not publish player counts to this page, so none are shown.
const PLATFORM_FEATURES: Array<{ name: string; blurb: string }> = [
  { name: "Token scanner", blurb: "Scan any token — free forever, no fees." },
  { name: "DEX trading", blurb: "Trade on Solana, straight from the platform." },
  { name: "Launchpad", blurb: "Launch a token with locked, burned liquidity." },
  { name: "Social hub", blurb: "Posts, communities, and the OrbitX feed." },
  { name: "AI + MCP tools", blurb: "Agent tools for trading, scanning, and research." },
];

export function GamePage({
  game,
  who,
  gate,
  online,
  onBack,
  onPlayCity,
  onAccount,
  onGuest,
  onBackToLogin,
  onOpenPage,
  onClassicMenu,
}: GamePageProps) {
  if (game === "platform") {
    return (
      <section className="console-game" aria-label="OrbitX game page">
        <div className="console-game-hero">
          <img src="/orbitx-banner.jpg" alt="OrbitX — the platform" className="console-game-hero-art" />
          <button type="button" className="console-back" onClick={onBack}>
            ← ALL GAMES
          </button>
        </div>
        <div className="console-game-body">
          <p className="console-kicker">THE PLATFORM</p>
          <h1 className="console-game-title">ORBITX</h1>
          <p className="console-game-desc">
            OrbitX is the home base — scan tokens, trade on the DEX, launch, and hang out with the community.
            Free forever. No fees to scan, ever.
          </p>
          <div className="console-meta-row" role="list">
            <span className="console-badge" role="listitem">● LIVE</span>
            <span className="console-badge" role="listitem">orbitx.world</span>
            <span className="console-badge" role="listitem">Free forever</span>
          </div>
          <h2>WHAT YOU CAN DO</h2>
          <ul className="console-features">
            {PLATFORM_FEATURES.map((feature) => (
              <li key={feature.name}>
                <b>{feature.name}</b>
                <span>{feature.blurb}</span>
              </li>
            ))}
          </ul>
          <a className="console-play" href="https://orbitx.world" target="_blank" rel="noreferrer">
            OPEN ORBITX ↗
          </a>
          <p className="console-note">Opens orbitx.world in a new tab — your city progress stays right here.</p>
        </div>
      </section>
    );
  }

  const onlineLine =
    online === null
      ? "Checking who's online…"
      : online === 1
        ? "1 player online right now"
        : `${online.toLocaleString()} players online right now`;

  return (
    <section className="console-game" aria-label="OrbitX City game page">
      <div className="console-game-hero">
        <img src="/splash-hero.jpg" alt="OrbitX City — the gate at dusk" className="console-game-hero-art" />
        <button type="button" className="console-back" onClick={onBack}>
          ← ALL GAMES
        </button>
      </div>
      <div className="console-game-body">
        <p className="console-kicker">ORBITX · WE ARE LIVE</p>
        <h1 className="console-game-title">ORBITX CITY</h1>
        <p className="console-game-desc">
          A realistic city you can own — a GTA-style open world that runs in your browser, on your phone or your
          PC. {CITY_FACTS.states} states, one city: {CITY_FACTS.stateNames}, joined by real bridges you can walk
          and drive across. Get a job, buy a home, drive cars, race, box, and build an empire — all in City Sol.
        </p>
        <div className="console-meta-row" role="list">
          <span className="console-badge" role="listitem">● LIVE</span>
          <span className="console-badge" role="listitem">Launched Nov 21, 2026</span>
          <span className="console-badge" role="listitem">Free forever</span>
        </div>

        <div className="console-stats" aria-label="City numbers">
          <span>
            <b>{CITY_FACTS.characters}</b>characters
          </span>
          <span>
            <b>{CITY_FACTS.jobs}</b>jobs
          </span>
          <span>
            <b>{CITY_FACTS.homes}</b>homes
          </span>
          <span>
            <b>{CITY_FACTS.vehicles}</b>vehicles
          </span>
          <span>
            <b>{CITY_FACTS.universes}</b>universes
          </span>
          <span>
            <b>{online === null ? "…" : online.toLocaleString()}</b>online now
          </span>
        </div>
        <p className="console-online">{onlineLine}</p>

        <h2>WHAT YOU CAN DO</h2>
        <ul className="console-features">
          {FEATURE_HIGHLIGHTS.slice(0, 6).map((feature) => (
            <li key={feature.id}>
              <b>{feature.name}</b>
              <span>{feature.blurb}</span>
            </li>
          ))}
        </ul>

        <h2>HOW TO PLAY</h2>
        <ul className="console-howto">
          {HOW_TO.map(([title, text]) => (
            <li key={title}>
              <b>{title}</b> — {text}
            </li>
          ))}
        </ul>

        {gate === "login" ? (
          <div className="console-auth">
            <h2>SIGN IN TO PLAY</h2>
            <AuthPanel onAccount={onAccount} onGuest={onGuest} />
          </div>
        ) : (
          <div className="console-play-block">
            <button type="button" className="console-play" onClick={onPlayCity}>
              ▶ PLAY — ENTER THE CITY
            </button>
            <p className="console-note">
              {who ? `Signed in as ${who.name}` : "Playing as a guest. Sign up later and this city comes with you."}{" "}
              <button type="button" className="console-link" onClick={onBackToLogin}>
                Switch account
              </button>
            </p>
          </div>
        )}

        <div className="console-game-links">
          <button type="button" onClick={onClassicMenu}>
            Classic menu →
          </button>
          <button type="button" onClick={() => onOpenPage("about")}>
            About
          </button>
          <button type="button" onClick={() => onOpenPage("settings")}>
            Settings
          </button>
        </div>
      </div>
    </section>
  );
}
