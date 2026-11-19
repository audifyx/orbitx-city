// Phone-controller host for OrbitX City.
//
// Connects this game (on the PC) to the controller relay on the City API
// and feeds a paired phone's input into the exact runtime calls the
// on-screen touch pad uses — setStick / addLook / hold / interact /
// toggleFly / cycleCamera / driveLoopTrain — so a phone becomes a full
// wireless gamepad for the PC screen.
//
// Pairing: the relay issues a 4-digit room code (shown in the Pad card);
// the phone opens /controller, types the code, and streams input at
// ~20 Hz. If the pad disconnects, every held input is released so the
// player never runs on without a driver.
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

export class PadHost {
  private ws: WebSocket | null = null;
  private holds: Record<HoldKey, boolean> = { jump: false, down: false, gas: false, brake: false };
  private lastStateKey = "";
  private stopped = false;

  constructor(
    private runtime: Runtime,
    private onStatus: (status: PadStatus) => void,
  ) {}

  start(): void {
    this.stopped = false;
    this.onStatus({ phase: "connecting" });
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
      let msg: { t?: unknown; code?: unknown; message?: unknown; stick?: unknown; look?: unknown; hold?: unknown; press?: unknown };
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

  private applyInput(msg: { stick?: unknown; look?: unknown; hold?: unknown; press?: unknown }): void {
    const rt = this.runtime;
    if (Array.isArray(msg.stick)) rt.setStick(clampAxis(msg.stick[0]), clampAxis(msg.stick[1]));
    if (Array.isArray(msg.look)) {
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
