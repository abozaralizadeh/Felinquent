import { describe, expect, it } from "vitest";
import { buildPlatforms, segmentsOf } from "../src/core/platforms";
import { makeWindows, makeWorld } from "../src/core/world";

describe("buildPlatforms", () => {
  it("makes a platform from the top edge of a visible window and always has the dock", () => {
    const p = buildPlatforms(makeWorld());
    expect(p.find((x) => x.id === "dock")).toMatchObject({ y: 860, x1: 0, x2: 1440 });
    expect(p.find((x) => x.id === "w1")).toMatchObject({ y: 120, x1: 100, x2: 900 });
  });

  it("only counts the visible part of an edge (a window in front hides part of it)", () => {
    const segs = segmentsOf(buildPlatforms(makeWorld()), "w2");
    // w1 (in front) covers x 100..900 at the height of w2's top edge, so only 900..1340 is left.
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ x1: 900, x2: 1340 });
  });

  it("gives no platform to a window that is fully covered at its top edge", () => {
    expect(segmentsOf(buildPlatforms(makeWorld()), "w3")).toHaveLength(0);
  });

  it("splits an edge in two when a window in front covers the middle", () => {
    const windows = makeWindows();
    windows[0] = { ...windows[0]!, bounds: { x: 500, y: 100, w: 200, h: 400 }, z: 0 };
    windows[1] = { ...windows[1]!, bounds: { x: 100, y: 300, w: 1000, h: 300 }, z: 1 };
    const segs = segmentsOf(buildPlatforms(makeWorld({ windows })), "w2");
    expect(segs.map((s) => [s.x1, s.x2])).toEqual(expect.arrayContaining([[100, 500], [700, 1100]]));
    expect(segs).toHaveLength(2);
  });

  it("ignores narrow windows and the menu bar", () => {
    const windows = makeWindows();
    windows[0] = { ...windows[0]!, bounds: { x: 100, y: 200, w: 100, h: 300 } };
    windows[1] = { ...windows[1]!, bounds: { x: 700, y: 5, w: 640, h: 520 } };
    const p = buildPlatforms(makeWorld({ windows }));
    expect(p.find((x) => x.windowId === "w1")).toBeUndefined();
    expect(p.find((x) => x.windowId === "w2")).toBeUndefined();
  });
});
