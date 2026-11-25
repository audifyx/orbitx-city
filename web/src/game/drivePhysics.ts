/**
 * OrbitX City — drivePhysics: the pure, testable half of car collision.
 *
 * The stuck-car bug (2026-11-24, round 3): a driver could crash into a
 * wall or a parked car and never get out. Three separate mechanisms
 * stacked up:
 *
 * 1. STATIONARY STEERING LOCKOUT — drive() set steerTarget to 0 at a
 *    standstill for enclosed cars, so a wedged car could not turn its
 *    nose at all. Forward blocked, reverse blocked, steering dead:
 *    permanently stuck. The fix (in drive()) lets a stopped car yaw
 *    slowly while the throttle is held — a parking shuffle.
 * 2. SPEED CRUSH WHILE BLOCKED — a dead stop multiplied speed by 0.2
 *    EVERY frame, and a wall slide by 0.6, so a car grinding along a
 *    wall bled all momentum in a few frames and could never push out
 *    of a marginal block. Slides now keep 0.95, dead stops 0.5.
 * 3. NO RECOVERY — nothing ever moved a stuck car. Now a stuck tracker
 *    (throttle held, ~no distance covered for 2 s) auto-nudges the car
 *    back along its entry path, and the player can always hit R / the
 *    Unstuck button to get back on the nearest road.
 *
 * This module holds the pure pieces so the game suite can drive a car
 * into a wall in a test and prove it gets out again — see
 * tests/drive-physics.test.mjs. It imports nothing: no three, no
 * runtime, no DOM. drive() in runtime.ts wires these into the frame.
 */

/** A point-in-world predicate: true when the car's centre may NOT be here. */
export type BlockedAt = (x: number, z: number) => boolean;

export interface MoveResult {
  x: number;
  z: number;
  /** Speed multiplier applied by the resolution (1 = clean move). */
  speedFactor: number;
  /** True when no axis could move at all — the car is fully blocked. */
  blocked: boolean;
  /** True when the car slid along one axis instead of moving diagonally. */
  slid: boolean;
}

/** Speed kept while sliding along a wall (was 0.6 — bled to a stop). */
export const SLIDE_SPEED_FACTOR = 0.95;
/** Speed kept on a dead stop (was 0.2 — an instant kill every frame). */
export const DEAD_STOP_SPEED_FACTOR = 0.5;

/**
 * Resolve one frame of car motion against the world. Full move first;
 * then each axis alone (slide along the wall); then a dead stop.
 * Diagonal into a corner where BOTH axes are free on their own slides
 * along the dominant axis of travel instead of dead-stopping — the old
 * code only slid when exactly one axis was free, so a diagonal corner
 * approach stopped the car dead even though a slide was possible.
 */
export function resolveCarMove(
  blockedAt: BlockedAt,
  x: number,
  z: number,
  nx: number,
  nz: number,
): MoveResult {
  if (!blockedAt(nx, nz)) {
    return { x: nx, z: nz, speedFactor: 1, blocked: false, slid: false };
  }
  const canX = !blockedAt(nx, z);
  const canZ = !blockedAt(x, nz);
  if (canX && canZ) {
    if (Math.abs(nx - x) >= Math.abs(nz - z)) {
      return { x: nx, z, speedFactor: SLIDE_SPEED_FACTOR, blocked: false, slid: true };
    }
    return { x, z: nz, speedFactor: SLIDE_SPEED_FACTOR, blocked: false, slid: true };
  }
  if (canX) {
    return { x: nx, z, speedFactor: SLIDE_SPEED_FACTOR, blocked: false, slid: true };
  }
  if (canZ) {
    return { x, z: nz, speedFactor: SLIDE_SPEED_FACTOR, blocked: false, slid: true };
  }
  return { x, z, speedFactor: DEAD_STOP_SPEED_FACTOR, blocked: true, slid: false };
}

export interface NudgeSpot {
  x: number;
  z: number;
}

/**
 * Find a free spot to nudge a stuck car to. Steps BACKWARD along the
 * heading (the way the car came in — that path was drivable a moment
 * ago) and takes the first spot where the car AND one more step back
 * are both free, so it lands somewhere it can actually drive from, not
 * on another boundary. If backward is walled too, tries forward.
 * Returns null when the car is fully surrounded — the manual Unstuck
 * (nearest road) is the escape hatch then.
 */
export function findNudgeSpot(
  blockedAt: BlockedAt,
  x: number,
  z: number,
  yaw: number,
  maxDist = 3,
  step = 0.25,
): NudgeSpot | null {
  // Forward is (sin yaw, -cos yaw); backward is the opposite.
  const dirs = [
    { dx: -Math.sin(yaw), dz: Math.cos(yaw) },
    { dx: Math.sin(yaw), dz: -Math.cos(yaw) },
  ];
  for (const d of dirs) {
    for (let dist = step; dist <= maxDist + 1e-9; dist += step) {
      const px = x + d.dx * dist;
      const pz = z + d.dz * dist;
      if (
        !blockedAt(px, pz) &&
        !blockedAt(px + d.dx * step, pz + d.dz * step)
      ) {
        return { x: px, z: pz };
      }
    }
  }
  return null;
}

export interface StuckTracker {
  /**
   * Feed one frame: whether the throttle is held and how far the car
   * actually moved. Returns true on the frame a stuck window closes
   * (throttle held for the whole window, barely any distance covered).
   * The window re-arms after every verdict, so a car that stays stuck
   * reports again ~2 s later.
   */
  update(throttle: boolean, moved: number, dt: number): boolean;
  reset(): void;
}

/**
 * @param thresholdSeconds how long the throttle must be held with no
 *   real progress before the car counts as stuck (2 s).
 * @param minDistance      distance covered in the window that still
 *   counts as progress (0.5 u — a slow crawl in traffic is not stuck;
 *   pushing against a wall at 0 u/s is).
 */
export function createStuckTracker(
  thresholdSeconds = 2,
  minDistance = 0.5,
): StuckTracker {
  let time = 0;
  let dist = 0;
  return {
    update(throttle: boolean, moved: number, dt: number): boolean {
      if (!throttle) {
        time = 0;
        dist = 0;
        return false;
      }
      time += dt;
      dist += moved;
      if (time >= thresholdSeconds) {
        const stuck = dist < minDistance;
        time = 0;
        dist = 0;
        return stuck;
      }
      return false;
    },
    reset(): void {
      time = 0;
      dist = 0;
    },
  };
}
