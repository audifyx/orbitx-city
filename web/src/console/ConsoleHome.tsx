import { useEffect, useRef, useState } from "react";
import type { Account } from "../auth";
import type { HomePage } from "../HomePages";
import "./console.css";

// OrbitX console home (Round 7) — the PS5-style home page after boot:
// a top bar (wordmark, live clock, account chip), a featured hero, and
// a row of game tiles. Phone first: two tiles side by side, big tap
// targets, art-first. Tiles are real buttons, so keyboard and screen
// readers get them free; left/right arrows move focus between tiles,
// the console way.
export type ConsoleGameId = "city" | "platform";

interface ConsoleHomeProps {
  who: Account | null;
  online: number | null;
  onOpenGame: (id: ConsoleGameId) => void;
  onOpenPage: (page: HomePage) => void;
  onClassicMenu: () => void;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20000);
    return () => window.clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConsoleHome({ who, online, onOpenGame, onOpenPage, onClassicMenu }: ConsoleHomeProps) {
  const clock = useClock();
  const rowRef = useRef<HTMLDivElement>(null);

  // Console-style tile navigation: ← → moves focus across the row.
  const onRowKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tiles = Array.from(rowRef.current?.querySelectorAll("button") ?? []);
    const idx = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    const next = event.key === "ArrowRight" ? Math.min(tiles.length - 1, idx + 1) : Math.max(0, idx - 1);
    tiles[next]?.focus();
    event.preventDefault();
  };

  const onlineLine =
    online === null
      ? "Checking who's online…"
      : online === 1
        ? "1 player online right now"
        : `${online.toLocaleString()} players online right now`;

  return (
    <section className="console-home" aria-label="OrbitX console home">
      <header className="console-topbar">
        <span className="console-wordmark">
          <img src="/logo/mark.svg" alt="" className="console-word-mark" />
          ORBIT<span>X</span>
        </span>
        <span className="console-top-right">
          <span className="console-clock" aria-label={`Current time ${clock}`}>
            {clock}
          </span>
          <span className="console-chip">{who ? who.name : "Guest"}</span>
        </span>
      </header>

      <div className="console-hero">
        <img src="/splash-hero.jpg" alt="" className="console-hero-art" />
        <div className="console-hero-body">
          <p className="console-kicker">ORBITX · WE ARE LIVE</p>
          <h1 className="console-hero-title">ORBITX CITY</h1>
          <p className="console-hero-sub">A realistic city you can own.</p>
          <p className="console-hero-meta">{onlineLine}</p>
          <div className="console-hero-actions">
            <button type="button" className="console-btn-gold" onClick={() => onOpenGame("city")}>
              ▶ PLAY
            </button>
            <button type="button" className="console-btn-ghost" onClick={() => onOpenGame("city")}>
              DETAILS
            </button>
          </div>
        </div>
      </div>

      <div className="console-section">
        <h2>YOUR GAMES</h2>
        <div className="console-tiles" ref={rowRef} onKeyDown={onRowKey}>
          <button type="button" className="console-tile" onClick={() => onOpenGame("city")}>
            <img src="/splash-hero.jpg" alt="OrbitX City — the gate at dusk" className="console-tile-art" />
            <span className="console-tile-body">
              <b>OrbitX City</b>
              <span>Realistic city life-sim · Free</span>
              <span className="console-tile-foot">
                <i>▶ PLAY</i>
                <em>{online === null ? "" : `${online.toLocaleString()} online`}</em>
              </span>
            </span>
          </button>
          <button type="button" className="console-tile" onClick={() => onOpenGame("platform")}>
            <img src="/orbitx-banner.jpg" alt="OrbitX — the platform" className="console-tile-art" />
            <span className="console-tile-body">
              <b>OrbitX</b>
              <span>Trade · Scan · Launch on Solana</span>
              <span className="console-tile-foot">
                <i>↗ OPEN</i>
                <em>Free forever</em>
              </span>
            </span>
          </button>
        </div>

        <div className="console-quick" aria-label="Quick actions">
          <button type="button" onClick={() => onOpenGame("city")}>
            Sign in
          </button>
          <button type="button" onClick={() => onOpenPage("about")}>
            About
          </button>
          <button type="button" onClick={() => onOpenPage("settings")}>
            Settings
          </button>
          <button type="button" onClick={onClassicMenu}>
            Classic menu
          </button>
        </div>

        <p className="console-foot">Free forever · No fees · orbitx.world</p>
      </div>
    </section>
  );
}
