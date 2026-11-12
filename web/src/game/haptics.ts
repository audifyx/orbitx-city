/**
 * OrbitX City — haptics: real touch feedback through the Vibration API.
 *
 * DEAD CODE until wired — see WIRING.md at the repo root for the exact
 * call sites (runtime.ts earn()/drive()/zone-enter, engine.ts tick()).
 *
 * No permissions needed, no dependencies, no DOM. Every call is a safe
 * no-op when the device cannot vibrate.
 *
 * Platform truth: Android Chrome/Edge/Firefox support navigator.vibrate.
 * iOS Safari does NOT support the Vibration API at all (as of iOS 18) —
 * on an iPhone triggerHaptic() silently does nothing. That is an Apple
 * limit, not a bug: do not "fix" it with a WebAudio buzz workaround,
 * it would just be noise.
 *
 * Battery cost: effectively zero. A vibration motor pulse of 10–60 ms
 * draws far less than one rendered frame.
 */

export type HapticKind =
  | "tap" // HUD button press
  | "bump" // walked into a wall / blocked step
  | "collision" // hard stop against a building or car
  | "carHit" // hover-car hit something (bounce in runtime.drive)
  | "pickup" // taxi rider picked up, item collected
  | "jobPay" // a job / activity paid out (City Sol)
  | "door" // entered a building / zone, lift door opened
  | "success" // purchase / claim confirmed
  | "error"; // action refused (holders-only zone, not enough funds)

/**
 * Patterns in milliseconds. Single number = one pulse, array =
 * vibrate/pause/vibrate... Keep every pattern under ~300 ms total:
 * haptics should confirm an action, not narrate it.
 */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 12,
  bump: 20,
  collision: [30, 40, 30],
  carHit: [45, 30, 65],
  pickup: [15, 40, 15],
  jobPay: [30, 50, 30, 50, 70],
  door: 25,
  success: [20, 40, 40],
  error: [70, 40, 70],
};

const STORAGE_KEY = "orbitx-haptics";
/** Minimum gap between two pulses of the same kind (ms). Stops a
 *  per-frame collision check from buzzing the motor non-stop. */
const MIN_GAP_MS = 70;

let cachedEnabled: boolean | null = null;
const lastFired = new Map<HapticKind, number>();

export function hapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

/**
 * Is haptics on? Default ON for phones (coarse pointer / touch), ON
 * for desktop too — harmless there, since desktops have no motor and
 * the call is a no-op. The flag only matters on devices with a motor.
 */
export function isHapticsEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "off") cachedEnabled = false;
    else if (saved === "on") cachedEnabled = true;
    else {
      cachedEnabled =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(pointer: coarse)").matches ||
          "ontouchstart" in window);
    }
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

/** Persist the player's haptics preference ("Haptics" toggle in settings). */
export function setHapticsEnabled(on: boolean): void {
  cachedEnabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode / storage blocked: the in-memory flag still applies.
  }
}

/** Fire one haptic pattern. Safe to call every frame — throttled per kind. */
export function triggerHaptic(kind: HapticKind): void {
  if (!isHapticsEnabled() || !hapticsSupported()) return;
  const now = Date.now();
  const last = lastFired.get(kind) ?? 0;
  if (now - last < MIN_GAP_MS) return;
  lastFired.set(kind, now);
  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    // Some browsers throw on patterns they dislike; never break the game.
  }
}

/** Stop any vibration in progress (pause menu, tab hidden). */
export function stopHaptics(): void {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // Ignore — stopping vibration must never throw.
  }
}
