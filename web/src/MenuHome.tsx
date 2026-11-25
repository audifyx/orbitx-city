import { useState } from "react";
import { AuthPanel } from "./AuthPanel";
import type { Account } from "./auth";
import { CITY_URL, GITHUB_URL, MenuFooter, MenuHeader, TELEGRAM_URL, X_URL, type HomePage } from "./HomePages";
import { CITY_FACTS, FEATURE_HIGHLIGHTS } from "./game/cityFacts";
import { universeDisplayName } from "./game/multiverse";
import "./site-pages.css";

const TIPS = [
  "E at a door opens it",
  "The fountain is the meeting point",
  "Jobs pay City Sol — check the Jobs board",
  "Press C to change camera",
  "Hold Z for emotes",
  "Your shop color and hat are yours to keep",
  "Rent is due weekly — 10% of your lot",
  "The mall lift rides every floor",
  "Fishing at the dock pays",
  "Street races start at the gate by the mall",
];

export const HOW_TO = [
  ["Move", "WASD · click or drag to look · arrows or Q/R turn"],
  ["Jump & fly", "Space jump · F fly"],
  ["Use things", "E use or drive · C camera · O spectator"],
  ["Talk", "T chat · V push to talk · hold Z emotes"],
  ["Earn", "Jobs board by the fountain — mail, taxi, lifeguard, more. Paid in City Sol."],
  ["Own", "Buy a lot, build on it, rent it out. The shop sells colors, hats and cars."],
];

// Round 5: the landing tour — real frames from the style videos, not
// placeholder art. Dusk gate, morning plaza, neon night: the three looks
// the player actually lands in.
const TOUR = [
  { src: "/splash-hero.jpg", alt: "The OrbitX City gate at dusk, fountains lit pink and blue", name: "THE GATE", blurb: "Dusk at the plaza — fountains, crowds, flying cars." },
  { src: "/intro-plaza.jpg", alt: "Downtown plaza in bright morning light, crowds and market stalls", name: "DOWNTOWN", blurb: "Morning crowds, market stalls, Route 12." },
  { src: "/world-night.jpg", alt: "The neon nightlife district in the rain", name: "NEON DISTRICT", blurb: "Rain, clubs, wet streets that glow." },
];
interface MenuHomeProps {
  gate: "login" | "city";
  who: Account | null;
  onChoose: () => void;
  onAccount: (account: Account) => void;
  onGuest: () => void;
  onBackToLogin: () => void;
  // Social (home rebrand): live counts from the menu's universe list.
  // `online` is null while the server has not answered — the section says
  // so instead of inventing a number. `socialLive` is false when the
  // counts come from the offline fallback roster (whose 0s are not real).
  online: number | null;
  friendsOnline: Array<{ id: string; name: string; server: number | null }>;
  socialLive: boolean;
  onOpenPage: (page: HomePage) => void;
  // Console home way back (Round 7): the classic landing stays
  // reachable from the console, and the console from here.
  onConsoleHome?: () => void;
}

export function MenuHome({ gate, who, onChoose, onAccount, onGuest, onBackToLogin, online, friendsOnline, socialLive, onOpenPage, onConsoleHome }: MenuHomeProps) {
  const [showHow, setShowHow] = useState(false);
  const [copied, setCopied] = useState(false);

  const share = () => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(CITY_URL).then(done).catch(() => setCopied(false));
    }
  };

  return (
    <div className="menu-home">
      <MenuHeader
        who={who}
        onNavigate={onOpenPage}
        onHome={() => document.querySelector(".menu-home")?.scrollTo({ top: 0 })}
        onPlay={onChoose}
      />
      <div className="menu-hero">
        <p className="menu-kicker">ORBITX · WE ARE LIVE</p>
        <h1 className="menu-title"><img src="/logo/logo-lockup.svg" alt="ORBITX CITY" className="menu-logo" /></h1>
        <p className="menu-sub">A realistic city you can own. {CITY_FACTS.characters} characters. {CITY_FACTS.jobs} jobs. One economy — City Sol.</p>
        {gate === "login" ? (
          <div className="menu-auth">
            <AuthPanel
              onAccount={(account) => {
                onAccount(account);
              }}
              onGuest={() => {
                onGuest();
              }}
            />
          </div>
        ) : (
          <>
            <div className="menu-actions">
              <button type="button" className="menu-cta" onClick={onChoose}>
                CHOOSE YOUR CHARACTER →
              </button>
              <button type="button" className="menu-ghost" onClick={() => setShowHow((value) => !value)}>
                {showHow ? "CLOSE HOW TO PLAY" : "HOW TO PLAY"}
              </button>
              {onConsoleHome ? (
                <button type="button" className="menu-ghost" onClick={onConsoleHome}>
                  ← CONSOLE HOME
                </button>
              ) : null}
            </div>
            {showHow && (
              <div className="menu-howto">
                {HOW_TO.map(([title, text]) => (
                  <p key={title}>
                    <b>{title}</b> — {text}
                  </p>
                ))}
              </div>
            )}
            <p className="menu-who">
              {who ? `Signed in as ${who.name}` : "Playing as a guest. Sign up later and this city comes with you."}{" "}
              <button type="button" className="menu-link" onClick={onBackToLogin}>
                Switch account
              </button>
            </p>
          </>
        )}
        <div className="menu-stats" aria-label="City numbers">
          <span><b>{CITY_FACTS.characters}</b> characters</span>
          <span><b>{CITY_FACTS.jobs}</b> jobs</span>
          <span><b>{CITY_FACTS.homes}</b> homes</span>
          <span><b>{CITY_FACTS.vehicles}</b> vehicles</span>
          <span><b>0</b> fees</span>
        </div>
        {/* See the city — the style-video frames as a swipeable tour, so
            the landing shows the look before a word of copy does. */}
        <div className="menu-tour" aria-label="See the city">
          <h2>SEE THE CITY</h2>
          <div className="menu-tour-strip">
            {TOUR.map((shot) => (
              <figure key={shot.name} className="menu-tour-shot">
                <img src={shot.src} alt={shot.alt} loading="lazy" />
                <figcaption>
                  <b>{shot.name}</b>
                  <span>{shot.blurb}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
        {/* What's in the city — reads FEATURE_HIGHLIGHTS from the same
            registry as the intro (game/cityFacts.ts). Add a feature to
            the registry and it appears here (and in the intro) with no
            menu edit; remove or rename one and it follows. */}
        <div className="menu-features" aria-label="What's in the city">
          <h2>WHAT'S IN THE CITY</h2>
          <div className="menu-feature-grid">
            {FEATURE_HIGHLIGHTS.map((feature) => (
              <article key={feature.id} className="menu-feature">
                <b>{feature.name}</b>
                <span>{feature.blurb}</span>
              </article>
            ))}
          </div>
        </div>
        <div className="menu-social" aria-label="Community">
          <h2>IN THE CITY NOW</h2>
          <p className="menu-online">
            {online === null
              ? "Checking who's online…"
              : online === 1
                ? "1 player online right now"
                : `${online.toLocaleString()} players online right now`}
          </p>
          {!socialLive ? (
            <p className="menu-friends">Friend activity loads when the server answers.</p>
          ) : friendsOnline.length > 0 ? (
            <p className="menu-friends">
              Friends online:{" "}
              {friendsOnline.map((f) => `${f.name}${f.server ? ` · ${universeDisplayName(f.server as 1 | 2 | 3 | 4 | 5)}` : ""}`).join(" · ")}
            </p>
          ) : (
            <p className="menu-friends">No friends online right now — invite one in and meet at the fountain.</p>
          )}
          <div className="menu-community-links">
            <a href={X_URL} target="_blank" rel="noreferrer">
              X @orbitx_wrld
            </a>
            <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
              Telegram @orbitxwrld
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <button type="button" onClick={share}>
              {copied ? "Link copied ✓" : "Share the city ↗"}
            </button>
          </div>
          <p className="menu-leaders">LEADERBOARDS — richest, top couriers, most burned — coming soon.</p>
        </div>
      </div>
      <div className="menu-bottom">
        <div className="menu-ticker" aria-hidden="true">
          <div className="menu-ticker-track">
            {[...TIPS, ...TIPS].map((tip, i) => (
              <span key={i}>{tip}</span>
            ))}
          </div>
        </div>
        {/* Neon horizon: a dusk skyline silhouette with lit windows and
            a cyan horizon line (site-pages.css) — replaces the old
            blocky CSS-bar skyline. */}
        <div className="menu-neon-horizon" aria-hidden="true" />
        <MenuFooter onNavigate={onOpenPage} />
      </div>
    </div>
  );
}
