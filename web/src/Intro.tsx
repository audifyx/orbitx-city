import { useEffect, useRef, useState } from "react";
import { CITY_FACTS, FEATURE_HIGHLIGHTS } from "./game/cityFacts";

// Intro scene (home rebrand): a full ~30s animated opening over the real
// 3D city — the engine flies the orbit camera through the scripted path
// while these title cards play over it, one beat at a time. Auto-advances
// to the menu at 30s; SKIP is always on screen. The overlay is pure
// HTML/CSS, so if WebGL is down the cards still play and still advance —
// the intro can never block entry.
//
// GTA VI trailer feel, phone-first: huge condensed title cards with a
// gold rule, a cinematic vignette over the flyover, and a rotating
// feature strip (one highlight every 3s) so the intro always shows what
// is actually in the city right now.
//
// The beats are NOT a hardcoded feature list: the numbers and the state
// names come from CITY_FACTS (game/cityFacts.ts), which derives them from
// the real catalogs — add a vehicle, a job, a home, or a district and the
// intro updates itself. Same for the feature strip: it reads
// FEATURE_HIGHLIGHTS from the same registry. Never hardcode a count here.
export const INTRO_LEN = 30;

interface IntroBeat {
  at: number;
  chapter: string;
  kicker: string;
  cam: string;
  title: string;
  sub: string;
  pills: string[];
}

const BEATS: IntroBeat[] = [
  {
    at: 0,
    chapter: "01 PLAZA",
    kicker: "WELCOME TO",
    cam: "CAM 01 // ORBITX PLAZA & TOWER",
    title: "ORBITX CITY",
    sub: "A living voxel metropolis you can walk, drive, fly, and own.",
    pills: [
      `${CITY_FACTS.universes} Universes`,
      `${CITY_FACTS.characters} Characters`,
      "Real-Time 3D World",
    ],
  },
  {
    at: 6,
    chapter: "02 STATES",
    kicker: "COAST TO COAST",
    cam: "CAM 02 // EMPIRE SPAN · NY · LA · FL",
    title: "THREE STATES. ONE CITY.",
    sub: `${CITY_FACTS.stateNames} — connected by suspension bridges, highways, and ocean straits.`,
    pills: [
      `${CITY_FACTS.states} States`,
      `${CITY_FACTS.districts} Districts`,
      "3 Suspension Bridges",
    ],
  },
  {
    at: 12,
    chapter: "03 LIFE",
    kicker: "LIVING ECONOMY",
    cam: "CAM 03 // DOWNTOWN AVENUE & HOMES",
    title: `${CITY_FACTS.homes} HOMES · ${CITY_FACTS.jobs} JOBS`,
    sub: `${CITY_FACTS.vehicles} vehicles · ${CITY_FACTS.districts} districts · one economy — City Sol.`,
    pills: [
      `${CITY_FACTS.homes} Furnished Homes`,
      `${CITY_FACTS.jobs} Active Jobs`,
      `${CITY_FACTS.vehicles} Vehicles`,
    ],
  },
  {
    at: 18,
    chapter: "04 OWN IT",
    kicker: "YOUR EMPIRE",
    cam: "CAM 04 // LOOP TRAIN & NEON SKYLINE",
    title: "OWN IT ALL",
    sub: "Homes, cars, offices, billboards, and businesses — yours in City Sol.",
    pills: [
      "Custom Home Editor",
      "Live Proximity Voice",
      "Shared City Radio",
    ],
  },
  {
    at: 24,
    chapter: "05 LAUNCH",
    kicker: "WORLD PREMIERE",
    cam: "CAM 05 // ORBITX METROPOLIS SKYLINE",
    title: "WE ARE LIVE",
    sub: "Free forever. No fees. No pay-to-win.",
    pills: [
      "60,000 Starter Sol",
      "Free Multiverse Travel",
      "Instant Browser Play",
    ],
  },
];

function beatFor(elapsed: number): number {
  let beat = 0;
  for (let i = 0; i < BEATS.length; i++) {
    if (elapsed >= BEATS[i].at) beat = i;
  }
  return beat;
}

function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.min(INTRO_LEN, Math.floor(sec)));
  return `00:${String(s).padStart(2, "0")}`;
}

export function IntroScene({ onDone }: { onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(0);
  const pausedRef = useRef(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const syncEngine = (t: number, nextPaused: boolean) => {
    const seek = (window as unknown as { __ORBITX_INTRO_SEEK?: (sec: number, p?: boolean) => void }).__ORBITX_INTRO_SEEK;
    if (seek) seek(t, nextPaused);
  };

  useEffect(() => {
    let lastTick = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - lastTick) / 1000));
      lastTick = now;
      if (pausedRef.current) return;
      const next = Math.min(INTRO_LEN, elapsedRef.current + dt);
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= INTRO_LEN && !doneRef.current) {
        doneRef.current = true;
        window.clearInterval(timer);
        onDoneRef.current();
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, []);

  const jumpToBeat = (index: number) => {
    const target = BEATS[index]?.at ?? 0;
    elapsedRef.current = target;
    setElapsed(target);
    syncEngine(target, pausedRef.current);
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    syncEngine(elapsedRef.current, next);
  };

  const beat = beatFor(elapsed);
  const card = BEATS[beat];
  const progress = Math.max(0, Math.min(1, elapsed / INTRO_LEN));
  const featureIdx = Math.floor(elapsed / 3) % FEATURE_HIGHLIGHTS.length;
  const feature = FEATURE_HIGHLIGHTS[featureIdx];

  return (
    <section className="intro" aria-label="Introducing OrbitX City">
      <div className="intro-top">
        <div className="intro-brand-group">
          <span className="intro-word">
            <img src="/logo/mark.svg" alt="" className="intro-logo" />
            ORBITX CITY
          </span>
          <span className="intro-cam-badge" aria-live="polite">
            <i className="intro-live-dot" aria-hidden="true" />
            {card.cam}
          </span>
        </div>
        <div className="intro-top-actions">
          <span className="intro-timecode" aria-hidden="true">
            {formatTimecode(elapsed)} / 00:{INTRO_LEN}
          </span>
          <button
            type="button"
            className="intro-pause"
            onClick={togglePause}
            aria-label={paused ? "Resume flyover" : "Pause flyover"}
          >
            {paused ? "RESUME ▶" : "PAUSE ❚❚"}
          </button>
          <button type="button" className="intro-skip" onClick={() => onDoneRef.current()}>
            SKIP →
          </button>
        </div>
      </div>

      <div className="intro-card" key={beat}>
        <p className="intro-kicker">{card.kicker}</p>
        <h1 className="intro-title">{card.title}</h1>
        <p className="intro-sub">{card.sub}</p>
        <div className="intro-pills" role="list">
          {card.pills.map((pill) => (
            <span key={pill} className="intro-pill" role="listitem">
              {pill}
            </span>
          ))}
        </div>
        <div className="intro-cta-row">
          <button type="button" className="intro-enter" onClick={() => onDoneRef.current()}>
            ENTER THE CITY →
          </button>
        </div>
      </div>

      <div className="intro-bottom">
        <div className="intro-chapters" role="tablist" aria-label="Flyover chapters">
          {BEATS.map((b, idx) => {
            const nextAt = BEATS[idx + 1]?.at ?? INTRO_LEN;
            const segFill =
              elapsed <= b.at ? 0 : elapsed >= nextAt ? 100 : ((elapsed - b.at) / Math.max(1, nextAt - b.at)) * 100;
            return (
              <button
                key={b.chapter}
                type="button"
                role="tab"
                aria-selected={beat === idx}
                className={`intro-chapter${beat === idx ? " active" : ""}${elapsed >= nextAt ? " done" : ""}`}
                onClick={() => jumpToBeat(idx)}
              >
                <span className="intro-chapter-label">{b.chapter}</span>
                <span className="intro-chapter-bar" aria-hidden="true">
                  <i style={{ width: `${segFill}%` }} />
                </span>
              </button>
            );
          })}
        </div>
        <p className="intro-feature" key={feature.id} aria-label={`In the city: ${feature.name}`}>
          <span className="intro-feature-idx">
            {String(featureIdx + 1).padStart(2, "0")}/{String(FEATURE_HIGHLIGHTS.length).padStart(2, "0")}
          </span>
          <b>{feature.name}</b> — {feature.blurb}
        </p>
        <div className="intro-progress" aria-hidden="true">
          <div className="intro-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="intro-hint">Live 3D engine flyover · tap any chapter to jump or SKIP any time</p>
      </div>
    </section>
  );
}
