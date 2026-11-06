import type { WindowInfo } from "./types";

/**
 * How fast each window moves and how hard it is jerked, from the window lists as they come in.
 * Things standing on a window (the animal, a mug) ride along while it moves gently, slide when it
 * is jerked, and fly off when it is flung or yanked down (Abozar, 6 Nov 2026: "should be realtime,
 * and if we do it fast maybe they fell").
 *
 * A new list is a new sample (the lists are compared by identity, so a list that didn't change is
 * not a sample). Velocity only means something when the samples are close together: the Mac app
 * reads the windows every frame while a window is being dragged and four times a second otherwise.
 * A move seen after a longer gap (a window snapped somewhere by a shortcut) is a jump, not a fling.
 */
export interface WinMotion {
  /** Pixels a second, smoothed. */
  vx: number;
  vy: number;
  /** Pixels a second squared, smoothed. y grows downward, so ay > 0 is a pull down (or a stop on the way up). */
  ax: number;
  ay: number;
  /**
   * The window stopped dead just now (you let go of it, or stopped your hand) after moving this
   * fast. Only there for the frame it is noticed. What stands on it keeps going at that speed.
   */
  stop?: { vx: number; vy: number };
}

const STILL: WinMotion = { vx: 0, vy: 0, ax: 0, ay: 0 };
/** A window has to be going at least this fast (px/s) for a dead stop to count. */
const STOP_FROM = 450;
/** Samples further apart than this carry no velocity (seconds). */
const MAX_GAP = 0.1;
/** No sample for this long: the window is taken to be still (seconds). */
const STALE = 0.12;
/** Smoothing time constants (seconds). The readings jitter a little from frame to frame. */
const TAU_V = 0.045;
const TAU_A = 0.06;

interface Track extends WinMotion {
  x: number;
  y: number;
  /** Clock of the last sample of this window. */
  t: number;
  /** Samples in a row that barely moved after moving fast, and the speed it had before them. */
  still: number;
  before: { vx: number; vy: number } | null;
}

export class WindowMotion {
  private tracks = new Map<string, Track>();
  private lastList: readonly WindowInfo[] | null = null;
  private clock = 0;
  private lastSample = -Infinity;
  /** Clock of the last time any window moved, for "moved lately". */
  private lastMoveAt = -Infinity;

  /** Call every frame with the real time that passed (not the warped demo time). */
  update(windows: readonly WindowInfo[], dtSec: number): void {
    this.clock += dtSec;
    for (const t of this.tracks.values()) t.stop = undefined;
    if (windows === this.lastList) {
      // No new reading. After a while without one, nothing is moving any more.
      if (this.clock - this.lastSample > STALE) for (const t of this.tracks.values()) this.calm(t, dtSec);
      return;
    }
    this.lastList = windows;
    const gap = this.clock - this.lastSample;
    this.lastSample = this.clock;
    const seen = new Set<string>();
    for (const w of windows) {
      seen.add(w.id);
      const t = this.tracks.get(w.id);
      if (!t) {
        this.tracks.set(w.id, { x: w.bounds.x, y: w.bounds.y, t: this.clock, ...STILL, still: 0, before: null });
        continue;
      }
      const dt = this.clock - t.t;
      const dx = w.bounds.x - t.x;
      const dy = w.bounds.y - t.y;
      t.x = w.bounds.x;
      t.y = w.bounds.y;
      t.t = this.clock;
      if (dx !== 0 || dy !== 0) this.lastMoveAt = this.clock;
      if (gap > MAX_GAP || dt <= 0 || dt > MAX_GAP) {
        // A jump, or the first reading in a while: no speed to tell.
        Object.assign(t, STILL, { still: 0, before: null });
        continue;
      }
      // A dead stop: it was going fast and now barely moves, two readings in a row (one could be a
      // reading that came before the window had moved again). Reported with the speed from before.
      const speed = Math.hypot(t.vx, t.vy);
      if (Math.hypot(dx, dy) / dt < 0.15 * speed && (speed > STOP_FROM || t.still > 0)) {
        if (t.still === 0) t.before = { vx: t.vx, vy: t.vy };
        t.still++;
        if (t.still === 2 && t.before && Math.hypot(t.before.vx, t.before.vy) > STOP_FROM) t.stop = t.before;
      } else ((t.still = 0), (t.before = null));
      const kv = 1 - Math.exp(-dt / TAU_V);
      const ka = 1 - Math.exp(-dt / TAU_A);
      const vx = t.vx + (dx / dt - t.vx) * kv;
      const vy = t.vy + (dy / dt - t.vy) * kv;
      t.ax += ((vx - t.vx) / dt - t.ax) * ka;
      t.ay += ((vy - t.vy) / dt - t.ay) * ka;
      t.vx = vx;
      t.vy = vy;
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
  }

  private calm(t: Track, dt: number): void {
    // It stopped: the speed drops to nothing, and that drop is itself a jerk (a mug slides on).
    if (t.vx === 0 && t.vy === 0 && t.ax === 0 && t.ay === 0) return;
    const k = 1 - Math.exp(-dt / TAU_V);
    const vx = t.vx * (1 - k);
    const vy = t.vy * (1 - k);
    const ka = 1 - Math.exp(-dt / TAU_A);
    t.ax += ((vx - t.vx) / Math.max(dt, 1e-3) - t.ax) * ka;
    t.ay += ((vy - t.vy) / Math.max(dt, 1e-3) - t.ay) * ka;
    t.vx = Math.abs(vx) < 1 ? 0 : vx;
    t.vy = Math.abs(vy) < 1 ? 0 : vy;
    if (t.vx === 0 && t.vy === 0 && Math.abs(t.ax) < 5 && Math.abs(t.ay) < 5) Object.assign(t, STILL);
  }

  of(id: string | null | undefined): WinMotion {
    const t = id ? this.tracks.get(id) : undefined;
    return t ? { vx: t.vx, vy: t.vy, ax: t.ax, ay: t.ay, stop: t.stop } : STILL;
  }

  /** Some window moved within the last `sec` seconds (the Mac app then reads the windows every frame). */
  movedWithin(sec: number): boolean {
    return this.clock - this.lastMoveAt <= sec;
  }
}

/**
 * How hard things hold on to a moving window, in pixels a second squared (gravity is 2000).
 * hold: a sideways jerk above this breaks the grip and the thing starts to slide.
 * slide: while sliding, the window drags it along at most this hard (friction).
 * lift: a pull down (or a hard stop on the way up) above this and it leaves the window.
 * stop: a dead stop from faster than this (px/s) and it keeps going, sliding on (and maybe off).
 * The animal digs its claws in, so it holds on much better than a mug. Cartoon values, tuned so a
 * normal drag carries everything along and only a fast one throws things off.
 */
export const GRIP = {
  prop: { hold: 8000, slide: 1100, lift: 4600, stop: 450 },
  animal: { hold: 11000, slide: 6000, lift: 7000, stop: 1300 },
} as const;
/** The animal crouches and holds on while its window moves faster than this (px/s) or is jerked harder than BRACE_JERK. */
export const BRACE_SPEED = 450;
export const BRACE_JERK = 2600;
