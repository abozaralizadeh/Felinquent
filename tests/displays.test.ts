import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { Executor } from "../src/core/executor";
import { buildPlatforms } from "../src/core/platforms";
import { seeded } from "../src/core/rng";
import type { Intent, WindowInfo, WorldSnapshot } from "../src/core/types";
import { makeWindows, makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

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

// Abozar's desk on 13 Nov 2026: the laptop at 0,0 and a monitor above it, a little to the right.
const LAPTOP = { x: 0, y: 0, w: 1440, h: 900 };
const MONITOR = { x: 715, y: -1080, w: 1920, h: 1080 };

describe("a monitor above a laptop", () => {
  it("with no window to climb, it leaps from the Dock up onto the monitor's floor", () => {
    const world = makeWorld({ screen: LAPTOP, dockTop: 849, windows: [], displays: [MONITOR], cursor: { x: 1500, y: -300 } });
    const ex = new Executor(seeded(3));
    ex.placeOnDock(world, 300);
    ex.start(mk("wander", "cursor"));
    for (let i = 0; i < 60 * 60 && ex.body.platformId !== "floor1"; i++) ex.update(1 / 60);
    expect(ex.body.platformId).toBe("floor1");
    expect(ex.body.y).toBe(0);
  });
});

describe("a display plugged in or out while it runs", () => {
  async function life(world: WorldSnapshot) {
    const cat = new Cat({ rng: seeded(7), settings: { chaos: "chill" } });
    cat.place(world, 700);
    let now = T0;
    const box = { world };
    const run = async (sec: number, until?: () => boolean): Promise<void> => {
      for (let i = 0; i < sec * 60 && !until?.(); i++) {
        now += 1000 / 60;
        await cat.step(at(box.world, now), 1 / 60);
      }
    };
    return { cat, box, run };
  }

  it("dropped on a monitor plugged in after it started, it lands on that monitor's floor", async () => {
    const { cat, box, run } = await life(makeWorld({ screen: LAPTOP, dockTop: 849, windows: [] }));
    await run(1);
    box.world = { ...box.world, displays: [MONITOR] };
    await run(0.5);
    // Where Abozar let go of it (the overlay log): over the monitor, half way up.
    cat.executor.pickUp(1451, -475);
    cat.executor.release(0, 0);
    await run(5, () => !cat.executor.airborne);
    expect(cat.executor.body.platformId).toBe("floor1");
    expect(cat.executor.body.y).toBe(0);
    expect(cat.executor.body.x).toBeGreaterThan(MONITOR.x);
  });

  it("the monitor unplugged while it stands there: it comes down on the laptop's Dock, never lost", async () => {
    const { cat, box, run } = await life(makeWorld({ screen: LAPTOP, dockTop: 849, windows: [], displays: [MONITOR] }));
    await run(0.5);
    cat.executor.pickUp(2400, -300);
    cat.executor.release(0, 0);
    await run(5, () => !cat.executor.airborne);
    expect(cat.executor.body.platformId).toBe("floor1");
    box.world = { ...box.world, displays: [] };
    await run(5, () => cat.executor.body.platformId === "dock");
    const b = cat.executor.body;
    expect(b.platformId).toBe("dock");
    expect(b.y).toBe(849);
    expect(b.x).toBeGreaterThanOrEqual(LAPTOP.x);
    expect(b.x).toBeLessThanOrEqual(LAPTOP.x + LAPTOP.w);
  });
});
