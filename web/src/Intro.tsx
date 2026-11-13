import { useEffect, useRef, useState } from "react";

// Intro scene (home rebrand): a full ~30s animated opening over the real
// 3D city — the engine flies the orbit camera through the scripted path
// while these title cards play over it, one beat at a time. Auto-advances
// to the menu at 30s; SKIP is always on screen. The overlay is pure
// HTML/CSS, so if WebGL is down the cards still play and still advance —
// the intro can never block entry.
export const INTRO_LEN = 30;

const BEATS = [
  { at: 0, title: "ORBITX CITY", sub: "A voxel city you can own." },
  { at: 6, title: "THREE STATES. ONE CITY.", sub: "New York · Los Angeles · Florida" },
  { at: 12, title: "150 HOMES · 20 JOBS", sub: "34 vehicles · 12 districts · one economy — City Sol." },
  { at: 18, title: "OWN IT ALL", sub: "Homes, cars, offices — yours in City Sol." },
  { at: 24, title: "LAUNCHES DEC 5, 2026", sub: "Free forever. No fees. No pay-to-win." },
];

function beatFor(elapsed: number): number {
  let beat = 0;
  for (let i = 0; i < BEATS.length; i++) {
    if (elapsed >= BEATS[i].at) beat = i;
  }
  return beat;
}

export function IntroScene({ onDone }: { onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      const next = (performance.now() - started) / 1000;
      setElapsed(next);
      if (next >= INTRO_LEN && !doneRef.current) {
        doneRef.current = true;
        window.clearInterval(timer);
        onDoneRef.current();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const beat = beatFor(elapsed);
  const card = BEATS[beat];
  const progress = Math.max(0, Math.min(1, elapsed / INTRO_LEN));

  return (
    <section className="intro" aria-label="Introducing OrbitX City">
      <div className="intro-top">
        <span className="intro-word">ORBITX CITY</span>
        <button type="button" className="intro-skip" onClick={() => onDoneRef.current()}>
          SKIP →
        </button>
      </div>
      <div className="intro-card" key={beat}>
        <p className="intro-kicker">WELCOME TO</p>
        <h1 className="intro-title">{card.title}</h1>
        <p className="intro-sub">{card.sub}</p>
        {beat === BEATS.length - 1 ? (
          <button type="button" className="intro-enter" onClick={() => onDoneRef.current()}>
            ENTER THE CITY →
          </button>
        ) : null}
      </div>
      <div className="intro-bottom">
        <div className="intro-progress" aria-hidden="true">
          <div className="intro-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="intro-hint">A 30-second flyover of your city · tap SKIP any time</p>
      </div>
    </section>
  );
}
