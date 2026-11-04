import type { Rect, WorldSnapshot } from "./types";

export interface Platform {
  id: string;
  x1: number;
  x2: number;
  /** Where the cat's feet go. */
  y: number;
  kind: "window_top" | "dock_top" | "floor";
  windowId?: string;
}

export interface PlatformOptions {
  minWindowWidth?: number;
  minSegment?: number;
  /** Top edges closer than this to the top of the screen are the menu bar, not a ledge. */
  menuBarHeight?: number;
}

type Interval = [number, number];

function subtract(base: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of base) {
    if (cut[1] <= a || cut[0] >= b) {
      out.push([a, b]);
      continue;
    }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/**
 * Turns window rectangles into walkable segments. Only the visible part of each top edge counts:
 * a window in front hides the part of the edge it covers.
 */
export function buildPlatforms(world: WorldSnapshot, opts: PlatformOptions = {}): Platform[] {
  const minW = opts.minWindowWidth ?? 120;
  const minSeg = opts.minSegment ?? 40;
  const menu = opts.menuBarHeight ?? 30;
  const displays: Rect[] = [world.screen, ...(world.displays ?? [])];
  const floorOf = (i: number): number => (i === 0 ? world.dockTop : (displays[i] as Rect).y + (displays[i] as Rect).h);
  const sorted = [...world.windows].sort((a, b) => a.z - b.z);
  const out: Platform[] = [];

  for (const w of sorted) {
    const b = w.bounds;
    if (b.w < minW) continue;
    // The display this window's top edge is on (by its centre).
    const cx = b.x + b.w / 2;
    const di = displays.findIndex((d) => cx >= d.x && cx < d.x + d.w && b.y >= d.y - 1 && b.y <= d.y + d.h);
    if (di < 0) continue;
    const screen = displays[di] as Rect;
    if (b.y < screen.y + menu) continue;
    if (b.y > floorOf(di)) continue;
    let visible: Interval[] = [[Math.max(b.x, screen.x), Math.min(b.x + b.w, screen.x + screen.w)]];
    for (const f of sorted) {
      if (f.z >= w.z) break;
      const fb = f.bounds;
      if (fb.y <= b.y && b.y <= fb.y + fb.h) visible = subtract(visible, [fb.x, fb.x + fb.w]);
    }
    visible
      .filter(([a, c]) => c - a >= minSeg)
      .forEach(([a, c], i) => {
        out.push({ id: i === 0 ? w.id : `${w.id}#${i}`, x1: a, x2: c, y: b.y, kind: "window_top", windowId: w.id });
      });
  }
  out.push({ id: "dock", x1: world.screen.x, x2: world.screen.x + world.screen.w, y: world.dockTop, kind: "dock_top" });
  displays.forEach((d, i) => {
    if (i > 0) out.push({ id: `floor${i}`, x1: d.x, x2: d.x + d.w, y: floorOf(i), kind: "floor" });
  });
  return out;
}

/** Visible segments of one window, widest first. */
export function segmentsOf(platforms: Platform[], windowId: string): Platform[] {
  return platforms.filter((p) => p.windowId === windowId).sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1));
}
