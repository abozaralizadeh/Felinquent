import { describe, expect, it } from "vitest";
import { Executor } from "../src/core/executor";
import { buildPlatforms } from "../src/core/platforms";
import { seeded } from "../src/core/rng";
import type { Intent, WindowInfo } from "../src/core/types";
import { makeWindows, makeWorld } from "../src/core/world";

// A second display sitting above the main one, like a real desk: y from -1080 to 0.
const ABOVE = { x: 0, y: -1080, w: 1920, h: 1080 };
const win2: WindowInfo = { id: "t1", app: "Terminal", bounds: { x: 300, y: -700, w: 900, h: 600 }, focused: false, cpu: "low", z: 3 };

const mk = (name: Intent["intent"], target: string): Intent => ({ intent: name, target, approach: "run", stay_sec: 3, mood: "content" });

describe("two displays", () => {
  it("gives the second display a floor and puts its windows on that display", () => {
    const world = makeWorld({ displays: [ABOVE], windows: [...makeWindows(), win2] });
    const p = buildPlatforms(world);
    expect(p.find((x) => x.id === "floor1")).toMatchObject({ y: 0, x1: 0, x2: 1920, kind: "floor" });
    expect(p.find((x) => x.id === "t1")).toMatchObject({ y: -700, x1: 300, x2: 1200 });
    expect(p.find((x) => x.id === "dock")).toMatchObject({ y: 860 });
  });

  it("does not change anything when there is only one display", () => {
    const a = buildPlatforms(makeWorld());
    const b = buildPlatforms(makeWorld({ displays: [] }));
    expect(b).toEqual(a);
  });

  it("drops a window that is on no display", () => {
    const stray: WindowInfo = { ...win2, id: "lost", bounds: { x: 5000, y: 100, w: 400, h: 300 } };
    const p = buildPlatforms(makeWorld({ displays: [ABOVE], windows: [stray] }));
    expect(p.find((x) => x.id === "lost")).toBeUndefined();
  });

  it("the cat walks from the main display to a window on the second one", () => {
    const world = makeWorld({ displays: [ABOVE], windows: [...makeWindows(), win2] });
    const ex = new Executor(seeded(3));
    ex.placeOnDock(world, 200);
    ex.start(mk("sit_on", "t1"));
    for (let i = 0; i < 90 * 60 && ex.phase !== "doing"; i++) ex.update(1 / 60);
    expect(ex.body.platformId).toBe("t1");
    expect(ex.body.y).toBe(-700);
  });

  it("the cat can stand on the second display's floor", () => {
    const world = makeWorld({ displays: [ABOVE] });
    const ex = new Executor(seeded(3));
    ex.placeOnDock(world, 200);
    ex.start(mk("sit_on", "w1"));
    for (let i = 0; i < 60 * 60 && ex.phase !== "doing"; i++) ex.update(1 / 60);
    expect(ex.body.platformId).toBe("w1");
    // Thrown up: falls and must land on a floor, never fall forever.
    ex.pickUp(500, -500);
    ex.release(0, 0);
    for (let i = 0; i < 20 * 60 && ex.airborne; i++) ex.update(1 / 60);
    expect(ex.airborne).toBe(false);
    expect(["floor1", "dock", "t1"]).toContain(ex.body.platformId);
  });
});
