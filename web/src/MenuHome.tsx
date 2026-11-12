import { useState } from "react";
import { AuthPanel } from "./AuthPanel";
import type { Account } from "./auth";

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

const HOW_TO = [
  ["Move", "WASD · click or drag to look · arrows or Q/R turn"],
  ["Jump & fly", "Space jump · F fly"],
  ["Use things", "E use or drive · C camera · O spectator"],
  ["Talk", "T chat · V push to talk · hold Z emotes"],
  ["Earn", "Jobs board by the fountain — mail, taxi, lifeguard, more. Paid in City Sol."],
  ["Own", "Buy a lot, build on it, rent it out. The shop sells colors, hats and cars."],
];

const SKYLINE = [46, 68, 38, 82, 56, 74, 34, 90, 60, 44, 76, 52, 86, 40, 64, 48, 72, 58, 80, 36];

interface MenuHomeProps {
  gate: "login" | "city";
  who: Account | null;
  onChoose: () => void;
  onAccount: (account: Account) => void;
  onGuest: () => void;
  onBackToLogin: () => void;
}

export function MenuHome({ gate, who, onChoose, onAccount, onGuest, onBackToLogin }: MenuHomeProps) {
  const [showHow, setShowHow] = useState(false);

  return (
    <div className="menu-home">
      <div className="menu-hero">
        <p className="menu-kicker">ORBITX · LAUNCHES DEC 5, 2026</p>
        <h1 className="menu-title">ORBITX CITY</h1>
        <p className="menu-sub">A voxel city you can own. Twelve characters. Twenty jobs. One economy — City Sol.</p>
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
          <span><b>12</b> characters</span>
          <span><b>20</b> jobs</span>
          <span><b>17</b> venues</span>
          <span><b>0</b> fees</span>
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
        <div className="menu-skyline" aria-hidden="true">
          {SKYLINE.map((height, i) => (
            <div key={i} className="sky-b" style={{ height: `${height}%` }} />
          ))}
        </div>
        <p className="menu-foot">Demo credits only. No real tokens. · orbitx.world</p>
      </div>
    </div>
  );
}
