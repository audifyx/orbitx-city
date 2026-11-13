import type { Account } from "./auth";
import type { Snap } from "./game/runtime";

// Home rebrand — the shared header, footer, and info pages for the OrbitX
// City home. Everything here is honest copy: real counts, real links, no
// invented numbers. Contrast rule: white bg = black text, black bg =
// white text; black/white/gold only.

export type HomePage = "about" | "settings" | "privacy" | "terms";

export const X_URL = "https://x.com/orbitx_wrld";
export const TELEGRAM_URL = "https://t.me/orbitxwrld";
export const GITHUB_URL = "https://github.com/audifyx/og-scan";
export const CONTACT_EMAIL = "development@orbitx.world";
export const CITY_URL = "https://orbitx-city.vercel.app";

export function MenuHeader({
  who,
  onNavigate,
  onHome,
  onPlay,
}: {
  who: Account | null;
  onNavigate: (page: HomePage) => void;
  onHome: () => void;
  onPlay: () => void;
}) {
  return (
    <header className="menu-header">
      <button type="button" className="menu-word" onClick={onHome} aria-label="OrbitX City — home">
        ORBITX <span>CITY</span>
      </button>
      <nav className="menu-nav" aria-label="Home navigation">
        <button type="button" onClick={onPlay}>
          Play
        </button>
        <button type="button" onClick={() => onNavigate("about")}>
          About
        </button>
        <button type="button" onClick={() => onNavigate("settings")}>
          Settings
        </button>
      </nav>
      <span className="menu-chip">{who ? who.name : "Guest"}</span>
    </header>
  );
}

export function MenuFooter({ onNavigate }: { onNavigate: (page: HomePage) => void }) {
  return (
    <footer className="menu-footer">
      <div className="menu-footer-links">
        <button type="button" onClick={() => onNavigate("about")}>
          About
        </button>
        <button type="button" onClick={() => onNavigate("privacy")}>
          Privacy Policy
        </button>
        <button type="button" onClick={() => onNavigate("terms")}>
          Terms of Service
        </button>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        <a href={X_URL} target="_blank" rel="noreferrer">
          X
        </a>
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
          Telegram
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
      <p className="menu-footer-line">Launches Dec 5, 2026 · Free forever</p>
      <p className="menu-footer-line">City Sol is in-game only — no real money. · orbitx.world</p>
    </footer>
  );
}

function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card menu-wide menu-page-card">
      <h2>{title}</h2>
      <div className="legal">{children}</div>
    </div>
  );
}

export function AboutPage() {
  return (
    <PageShell title="About OrbitX City">
      <p>
        <b>OrbitX City</b> is a voxel city you can own — a GTA-style open world that runs in your browser, on your
        phone or your PC. Three states, one city: New York, Los Angeles, and Florida, joined by real bridges you can
        walk and drive across.
      </p>
      <h3>The world</h3>
      <p>
        12 districts, 150 homes, 20 jobs, 34 vehicles — cars, bikes, skateboards, flying cars, planes, helicopters,
        and the Orbit Ferry. Ride the OrbitX Line train, catch the bus across the states, or drive the loop monorail
        yourself.
      </p>
      <h3>The multiverse</h3>
      <p>
        Five universes, same world, different progress in each. Your home universe is where your homes, cars, and
        money live. You can travel between universes for free, and join friends in whatever universe they are on.
      </p>
      <h3>The economy</h3>
      <p>
        Everything in the city costs <b>City Sol</b> — the in-game currency you earn from jobs, missions, and rent.
        City Sol has no cash value and can never be bought, sold, or traded for real money. The game is free forever:
        no fees, no pay-to-win.
      </p>
      <h3>Launch</h3>
      <p>
        OrbitX City launches <b>Saturday, Dec 5, 2026</b>. Until then the city is in open playtesting — what you see
        is what is live, and your feedback shapes what gets built next.
      </p>
      <p>
        Built by audifyx, Los Angeles, CA. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> ·{" "}
        <a href={X_URL} target="_blank" rel="noreferrer">
          X @orbitx_wrld
        </a>{" "}
        ·{" "}
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
          Telegram @orbitxwrld
        </a>
      </p>
    </PageShell>
  );
}

export function SettingsPage({
  snap,
  introOn,
  onQuality,
  onHaptics,
  onCycleTime,
  onIntroToggle,
  onReplayIntro,
}: {
  snap: Snap;
  introOn: boolean;
  onQuality: (level: "low" | "medium" | "high") => void;
  onHaptics: (on: boolean) => void;
  onCycleTime: () => void;
  onIntroToggle: (on: boolean) => void;
  onReplayIntro: () => void;
}) {
  return (
    <PageShell title="Settings">
      <h3>Graphics quality</h3>
      <p>Lower quality runs smoother on older phones. Saved on this device.</p>
      <div className="days">
        {(["low", "medium", "high"] as const).map((level) => (
          <button key={level} type="button" className={snap.quality === level ? "on" : ""} onClick={() => onQuality(level)}>
            {level}
          </button>
        ))}
      </div>
      <h3>Haptics</h3>
      <p>Phone vibration on taps and actions. Android only — iOS Safari has no vibration API.</p>
      <div className="days">
        <button type="button" className={snap.haptics ? "on" : ""} onClick={() => onHaptics(!snap.haptics)}>
          Haptics: {snap.haptics ? "On" : "Off"}
        </button>
      </div>
      <h3>Time of day</h3>
      <p>Day, sunset, and night cycle in the city. Currently: {snap.time}.</p>
      <div className="days">
        <button type="button" onClick={onCycleTime}>
          Time: {snap.time}
        </button>
      </div>
      <h3>Intro scene</h3>
      <p>The 30-second flyover that plays when you open the city.</p>
      <div className="days">
        <button type="button" className={introOn ? "on" : ""} onClick={() => onIntroToggle(!introOn)}>
          Play intro on launch: {introOn ? "On" : "Off"}
        </button>
        <button type="button" onClick={onReplayIntro}>
          Replay intro now
        </button>
      </div>
    </PageShell>
  );
}

export function PrivacyPage() {
  return (
    <PageShell title="Privacy Policy">
      <p>Last updated: Dec 5, 2026 launch. Plain version — no legalese.</p>
      <h3>Who runs this</h3>
      <p>
        OrbitX City is built by audifyx, Los Angeles, CA. Contact:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
      <h3>What we collect</h3>
      <p>
        If you create an account: your email address and a password (stored hashed, never in plain text). Your
        gameplay saves: homes, cars, City Sol balance, friends, and progress — stored per universe so the game can
        load your city. Device preferences saved on your own device (quality, haptics, character, minimap position).
      </p>
      <h3>What we never collect</h3>
      <p>
        No wallet private keys — in-app wallets are device-local and PIN-encrypted, and the server never sees the key.
        No payment card details inside the game. No real-money transactions. Guest play needs no email at all.
      </p>
      <h3>City Sol</h3>
      <p>
        City Sol is a fake in-game currency. It has no cash value, cannot be withdrawn, and cannot be exchanged for
        real money or crypto.
      </p>
      <h3>Your data</h3>
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to ask what data we hold for your account, or
        to ask for it to be deleted. If you are under 18, ask a parent or guardian before creating an account.
      </p>
    </PageShell>
  );
}

export function TermsPage() {
  return (
    <PageShell title="Terms of Service">
      <p>Last updated: Dec 5, 2026 launch. Plain version — no legalese.</p>
      <h3>The game is free</h3>
      <p>
        OrbitX City is free forever. There are no fees to play, and nothing in the game is pay-to-win. City Sol is
        earned in-game only.
      </p>
      <h3>City Sol has no value</h3>
      <p>
        City Sol is a fake in-game currency. It has no cash value, cannot be bought, sold, transferred, or exchanged
        for real money or cryptocurrency, and it is worth nothing outside the game.
      </p>
      <h3>Your account</h3>
      <p>
        Your account is your responsibility — keep your password private. One account per player; do not share it. We
        may reset or remove accounts that cheat, exploit bugs, harass other players, or break the game for others.
      </p>
      <h3>Your uploads</h3>
      <p>
        Anything you upload (for example radio tracks) must be yours to share, or free to share. We may remove
        uploads that break that rule.
      </p>
      <h3>The service</h3>
      <p>
        The city is in active development toward its Dec 5, 2026 launch. Features may change, saves may be adjusted
        during playtesting, and the service may go down for maintenance. We are not liable for lost in-game progress
        beyond restoring what we reasonably can.
      </p>
      <h3>Contact</h3>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </PageShell>
  );
}
