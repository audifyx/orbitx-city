// Phone-controller host for OrbitX City.
//
// Connects this game (on the PC) to the controller relay on the City API
// and feeds a paired phone's input into the exact runtime calls the
// on-screen touch pad uses — setStick / addLook / hold / interact /
// toggleFly / cycleCamera / driveLoopTrain — so a phone becomes a full
// wireless gamepad for the PC screen.
//
// Pairing: the relay issues a 4-digit room code (shown in the Pad card);
// the phone opens /controller, types the code, and streams input at up
// to ~60 Hz. The camera stick sends a look RATE (deflection), which this
// host integrates per animation frame — so camera motion stays smooth
// even when relay messages arrive unevenly. Older pads that send look
// deltas instead are still honored. If the pad disconnects, every held
// input is released so the player never runs on without a driver.
import type { Runtime } from "./runtime";

export type PadStatus =
  | { phase: "connecting" }
  | { phase: "waiting"; code: string }
  | { phase: "paired"; code: string }
  | { phase: "closed"; message: string };

const DEFAULT_RELAY = "wss://orbitx-city-api.onrender.com/relay";

export function relayUrl(): string {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("relay");
    if (fromQuery) return fromQuery;
    const saved = window.localStorage.getItem("orbitx-relay-url");
    if (saved) return saved;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return DEFAULT_RELAY;
}

type HoldKey = "jump" | "down" | "gas" | "brake";
const HOLD_KEYS: HoldKey[] = ["jump", "down", "gas", "brake"];

function clampAxis(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(-1, Math.min(1, n));
}
function clampLook(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.max(-80, Math.min(80, n));
}

/**
 * Camera tuning. addLook() takes RADIANS (mouse look multiplies pixels
 * by 0.0022 before calling it; keyboard look runs at 1.7 rad/s yaw).
 * The stick gets a slightly hotter yaw than the keys and a gentler
 * pitch, an expo response curve for fine control near the center, a
 * small deadzone, and velocity smoothing so turns ramp in and glide
 * out instead of snapping on and off.
 */
const LOOK_MAX_YAW_PER_SEC = 2.5;
const LOOK_MAX_PITCH_PER_SEC = 1.55;
const LOOK_DEADZONE = 0.09;
const LOOK_ATTACK_PER_SEC = 26;
const LOOK_RELEASE_PER_SEC = 20;
/** If no input arrives for this long, the stream is treated as dead
 * and every input is zeroed — a frozen phone can never leave the
 * character walking or the camera turning on its own. */
const INPUT_STALE_MS = 350;

function shapeLook(d: number): number {
  const a = Math.abs(d);
  if (a <= LOOK_DEADZONE) return 0;
  const t = (a - LOOK_DEADZONE) / (1 - LOOK_DEADZONE);
  return Math.sign(d) * Math.pow(t, 1.6);
}

export class PadHost {
  private ws: WebSocket | null = null;
  private holds: Record<HoldKey, boolean> = { jump: false, down: false, gas: false, brake: false };
  private lookTarget: [number, number] = [0, 0];
  private lookVel: [number, number] = [0, 0];
  private stickNow: [number, number] = [0, 0];
  private lastInputAt = 0;
  private rafId = 0;
  private lastFrameAt = 0;
  private lastStateKey = "";
  private stopped = false;

  constructor(
    private runtime: Runtime,
    private onStatus: (status: PadStatus) => void,
  ) {}

  start(): void {
    this.stopped = false;
    this.onStatus({ phase: "connecting" });
    this.lastFrameAt = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.tick);
    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl());
    } catch {
      this.onStatus({ phase: "closed", message: "Could not reach the controller relay." });
      return;
    }
    this.ws = ws;
    let code = "";
    ws.onopen = () => {
      try {
        ws.send(JSON.stringify({ t: "host" }));
      } catch {
        /* the close handler reports it */
      }
    };
    ws.onmessage = (event) => {
      let msg: { t?: unknown; code?: unknown; message?: unknown; stick?: unknown; look?: unknown; lookRate?: unknown; hold?: unknown; press?: unknown };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;
      if (msg.t === "code") {
        code = String(msg.code ?? "");
        this.onStatus({ phase: "waiting", code });
      } else if (msg.t === "paired") {
        this.onStatus({ phase: "paired", code });
      } else if (msg.t === "pad-gone") {
        this.releaseAll();
        if (code) this.onStatus({ phase: "waiting", code });
      } else if (msg.t === "input") {
        this.applyInput(msg);
      } else if (msg.t === "error") {
        this.onStatus({ phase: "closed", message: String(msg.message ?? "Relay error.") });
      }
    };
    ws.onclose = () => {
      this.releaseAll();
      if (!this.stopped) this.onStatus({ phase: "closed", message: "The relay connection closed." });
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  /**
   * Per-frame camera integration. The pad streams deflections
   * continuously; the camera velocity chases the target with light
   * exponential smoothing (fast attack, fast release, hard cutoff at
   * rest) and is applied in frame-sized slices, so the turn rate is
   * steady even when messages arrive unevenly — without the lag and
   * after-drift that heavy smoothing caused. The move stick is NOT
   * smoothed: it applies on arrival, the way it felt best. A watchdog
   * zeroes everything if the stream goes silent, so a frozen phone
   * can never leave the player moving on its own.
   */
  private tick = (now: number): void => {
    if (this.stopped) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    if (dt > 0) {
      if (this.lastInputAt > 0 && now - this.lastInputAt > INPUT_STALE_MS) {
        if (this.lookTarget[0] !== 0 || this.lookTarget[1] !== 0) this.lookTarget = [0, 0];
        if (this.stickNow[0] !== 0 || this.stickNow[1] !== 0) {
          this.stickNow = [0, 0];
          try {
            this.runtime.setStick(0, 0);
          } catch {
            /* runtime gone */
          }
        }
      }
      for (let i = 0; i < 2; i++) {
        const rate = Math.abs(this.lookTarget[i]) > Math.abs(this.lookVel[i]) ? LOOK_ATTACK_PER_SEC : LOOK_RELEASE_PER_SEC;
        this.lookVel[i] += (this.lookTarget[i] - this.lookVel[i]) * (1 - Math.exp(-rate * dt));
        if (this.lookTarget[i] === 0 && Math.abs(this.lookVel[i]) < 0.03) this.lookVel[i] = 0;
      }
      const [vx, vy] = this.lookVel;
      if (vx !== 0 || vy !== 0) {
        try {
          this.runtime.addLook(vx * LOOK_MAX_YAW_PER_SEC * dt, vy * LOOK_MAX_PITCH_PER_SEC * dt);
        } catch {
          /* runtime gone */
        }
      }
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private applyInput(msg: { stick?: unknown; look?: unknown; lookRate?: unknown; hold?: unknown; press?: unknown }): void {
    const rt = this.runtime;
    this.lastInputAt = performance.now();
    if (Array.isArray(msg.stick)) {
      // Applied immediately on arrival — no smoothing lag on movement.
      this.stickNow = [clampAxis(msg.stick[0]), clampAxis(msg.stick[1])];
      rt.setStick(this.stickNow[0], this.stickNow[1]);
    }
    if (Array.isArray(msg.lookRate)) {
      // Rate protocol: shape the deflection (deadzone + expo curve) and
      // store it as the velocity target; the tick loop does the rest.
      // Any legacy deltas in the same message are ignored on purpose —
      // applying both would turn the camera twice.
      this.lookTarget = [shapeLook(clampAxis(msg.lookRate[0])), shapeLook(clampAxis(msg.lookRate[1]))];
    } else if (Array.isArray(msg.look)) {
      const dx = clampLook(msg.look[0]);
      const dy = clampLook(msg.look[1]);
      if (dx !== 0 || dy !== 0) rt.addLook(dx, dy);
    }
    if (msg.hold && typeof msg.hold === "object") {
      const hold = msg.hold as Record<string, unknown>;
      for (const key of HOLD_KEYS) {
        const value = !!hold[key];
        if (value !== this.holds[key]) {
          this.holds[key] = value;
          rt.hold(key, value);
        }
      }
    }
    if (typeof msg.press === "string") {
      if (msg.press === "use") rt.interact();
      else if (msg.press === "fly") rt.toggleFly();
      else if (msg.press === "camera") rt.cycleCamera();
      else if (msg.press === "drive") rt.driveLoopTrain();
    }
  }

  /** Forward the on-screen prompt + train-drive availability to the pad. */
  sendState(prompt: string, canDrive: boolean): void {
    const key = `${prompt}|${canDrive ? "1" : "0"}`;
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ t: "state", prompt, canDrive }));
      } catch {
        /* the close handler reports it */
      }
    }
  }

  private releaseAll(): void {
    this.lookTarget = [0, 0];
    this.lookVel = [0, 0];
    this.stickNow = [0, 0];
    try {
      this.runtime.setStick(0, 0);
    } catch {
      /* runtime gone */
    }
    for (const key of HOLD_KEYS) {
      if (this.holds[key]) {
        this.holds[key] = false;
        try {
          this.runtime.hold(key, false);
        } catch {
          /* runtime gone */
        }
      }
    }
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
    this.releaseAll();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
      this.ws = null;
    }
  }
}
