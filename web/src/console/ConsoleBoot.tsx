import { useEffect, useRef, useState } from "react";
import "./console.css";

// OrbitX console boot (Round 7) — the PS5-style power-on sequence that
// runs when the site loads. It EXTENDS the round-5 static #boot splash
// in web/index.html (same dark bg, same splash art, same wordmark
// treatment) into a staged sequence — logo reveal, system lines,
// progress bar — instead of duplicating it. The static splash paints
// instantly; this component takes over the moment React mounts, so the
// boot reads as one continuous screen.
//
// FAST ON REPEAT VISITS: the first boot is the full ~3.2s sequence;
// once it has run (or been skipped), localStorage "orbitx-boot-seen"
// shortens every later boot to a ~1s logo flash. ?boot=full forces the
// full sequence (demo / testing). Any tap, click, or key skips it
// immediately — the player never sits through a boot they don't want.
export const BOOT_SEEN_KEY = "orbitx-boot-seen";

function seenBefore(): boolean {
  try {
    return localStorage.getItem(BOOT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function forceFullBoot(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("boot") === "full";
  } catch {
    return false;
  }
}

const FULL_LINES = ["LOADING PROFILE…", "CONNECTING TO ORBITX…", "STARTING THE CITY…"];

function bootTotalMs(full: boolean): number {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 500;
  } catch {
    // No matchMedia — fall through to the normal timing.
  }
  return full ? 3200 : 1000;
}

export function ConsoleBoot({ onDone }: { onDone: () => void }) {
  // Decided once, at first render — a repeat visit never replays full.
  const full = useRef(!seenBefore() || forceFullBoot()).current;
  const total = useRef(bootTotalMs(full)).current;
  const [stage, setStage] = useState(0); // 0 mark · 1 wordmark + lines · 2 ready
  const [line, setLine] = useState(0);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    // A skipped first boot still counts as seen — the player chose to
    // skip it, so the next load must not replay the full sequence.
    try {
      localStorage.setItem(BOOT_SEEN_KEY, "1");
    } catch {
      // Storage unavailable — the boot just replays full next time.
    }
    onDoneRef.current();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Timeline: full boot stages the wordmark in at 700ms and goes "ready"
  // at 2.4s, finishing at 3.2s; the quick boot jumps straight to ready.
  useEffect(() => {
    const timers: number[] = [];
    if (full && total > 1000) {
      timers.push(window.setTimeout(() => setStage(1), 700));
      timers.push(window.setTimeout(() => setStage(2), 2400));
      timers.push(window.setInterval(() => setLine((l) => (l + 1) % FULL_LINES.length), 700));
    } else {
      timers.push(window.setTimeout(() => setStage(2), Math.max(200, total - 300)));
    }
    timers.push(window.setTimeout(() => finishRef.current(), total));
    return () => {
      for (const t of timers) {
        window.clearTimeout(t);
        window.clearInterval(t);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skippable: any tap, click, or key ends the boot at once.
  useEffect(() => {
    const skip = () => finishRef.current();
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      className={`console-boot stage-${stage}`}
      aria-label="OrbitX starting up"
      onClick={() => finishRef.current()}
    >
      <div className="console-boot-inner">
        <img src="/logo/mark.svg" alt="" className="console-boot-mark" />
        <p className="console-boot-kicker">ORBITX</p>
        <p className="console-boot-title">
          ORBIT<span>X</span>
        </p>
        <hr className="console-boot-rule" />
        <p className="console-boot-sub">ORBITX CITY · CONSOLE</p>
        <div className="console-boot-bar" aria-hidden="true">
          <i style={{ animationDuration: `${total}ms` }} />
        </div>
        <p className="console-boot-line" aria-live="polite">
          {stage >= 2 ? "READY" : full ? FULL_LINES[line] : "WELCOME BACK"}
        </p>
        <p className="console-boot-skip">TAP OR PRESS ANY KEY TO SKIP</p>
      </div>
    </section>
  );
}
