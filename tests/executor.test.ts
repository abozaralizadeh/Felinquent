import { describe, expect, it } from "vitest";
import { Executor, type ExecEvent } from "../src/core/executor";
import { seeded } from "../src/core/rng";
import type { Intent } from "../src/core/types";
import { makeWindows, makeWorld } from "../src/core/world";

const mk = (name: Intent["intent"], target: string, over: Partial<Intent> = {}): Intent => ({
  intent: name, target, approach: "run", stay_sec: 3, mood: "content", ...over,
});

function setup(world = makeWorld()) {
  const ex = new Executor(seeded(3));
  ex.placeOnDock(world, 200);
  return { ex, world };
}

/** Runs the executor at 60 fps and collects events until the condition is true. */
function run(ex: Executor, until: () => boolean, maxSec = 60): ExecEvent[] {
  const events: ExecEvent[] = [];
  for (let i = 0; i < maxSec * 60 && !until(); i++) events.push(...ex.update(1 / 60));
  return events;
}

describe("Executor", () => {
  it("starts on the dock", () => {
    const { ex } = setup();
    expect(ex.body).toMatchObject({ platformId: "dock", y: 860 });
  });

  it("jumps up to a window top and sits there, blocking clicks only under its body", () => {
    const { ex } = setup();
    ex.start(mk("sit_on", "w1"));
    const events = run(ex, () => ex.phase === "doing");
    expect(ex.body.platformId).toBe("w1");
    expect(ex.body.y).toBe(120);
    expect(events.some((e) => e.type === "block_start")).toBe(true);
    const r = ex.blockingRect()!;
    expect(r.w).toBe(110);
    expect(r.y + r.h).toBe(120);
    const after = run(ex, () => ex.phase === "idle");
    expect(after.map((e) => e.type)).toEqual(expect.arrayContaining(["block_end", "done"]));
    expect(ex.blockingRect()).toBeNull();
  });

  it("a huff wears off: it turns back round, and later lies down", () => {
    const { ex } = setup();
    ex.start(mk("ignore", "here", { stay_sec: 1, script: [{ do: "turn_away", sec: 1.2 }] }));
    run(ex, () => ex.phase === "idle");
    expect(ex.body.anim).toBe("turn_away");
    run(ex, () => false, 13);
    expect(ex.body.anim).toBe("idle_sit");
    run(ex, () => false, 20);
    expect(ex.body.anim).toBe("loaf");
  });

  it("walks slower when it saunters than when it runs", () => {
    const a = setup();
    const b = setup();
    a.ex.start(mk("wander", "here", { approach: "run" }));
    b.ex.start(mk("wander", "here", { approach: "saunter" }));
    const dockTarget = (e: Executor) => e.start(mk("block_dock", "dock", { approach: e === a.ex ? "run" : "saunter", stay_sec: 1 }));
    dockTarget(a.ex);
    dockTarget(b.ex);
    for (let i = 0; i < 60; i++) {
      a.ex.update(1 / 60);
      b.ex.update(1 / 60);
    }
    expect(Math.abs(a.ex.body.x - 200)).toBeGreaterThan(Math.abs(b.ex.body.x - 200));
  });

  it("rides along when its window is dragged, and snaps to the new height", () => {
    const { ex, world } = setup();
    ex.start(mk("sit_on", "w1", { stay_sec: 600 }));
    run(ex, () => ex.phase === "doing");
    const x0 = ex.body.x;
    const moved = makeWindows();
    moved[0] = { ...moved[0]!, bounds: { x: 250, y: 160, w: 800, h: 620 } };
    ex.setWorld({ ...world, windows: moved });
    expect(ex.body.x).toBeCloseTo(x0 + 150, 5);
    expect(ex.body.y).toBe(160);
    expect(ex.body.platformId).toBe("w1");
    expect(ex.blocking).toBe(true);
  });

  it("falls and lands on the next platform when its window closes", () => {
    const { ex, world } = setup();
    ex.start(mk("sit_on", "w1", { stay_sec: 600 }));
    run(ex, () => ex.phase === "doing");
    ex.setWorld({ ...world, windows: makeWindows().slice(1) });
    expect(ex.airborne).toBe(true);
    const events = run(ex, () => !ex.airborne);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["block_end", "landed"]));
    expect(ex.body.platformId).not.toBeNull();
    expect(ex.body.y).toBeGreaterThan(120);
  });

  it("can be picked up, carried and dropped, then lands on its feet", () => {
    const { ex } = setup();
    ex.pickUp(500, 300);
    expect(ex.held).toBe(true);
    ex.dragTo(520, 310);
    expect(ex.body.x).toBe(520);
    ex.release(0, 0);
    const events = run(ex, () => !ex.airborne);
    expect(events.some((e) => e.type === "landed")).toBe(true);
    expect(ex.body.platformId).toBeTruthy();
  });

  it("a thrown cat stays on screen", () => {
    const { ex, world } = setup();
    ex.pickUp(700, 400);
    ex.release(5000, -800);
    run(ex, () => !ex.airborne);
    expect(ex.body.x).toBeLessThanOrEqual(world.screen.w);
    expect(ex.body.x).toBeGreaterThanOrEqual(0);
  });

  it("queues an intent given in mid-air and starts it after landing", () => {
    const { ex } = setup();
    ex.pickUp(500, 300);
    ex.release(0, 0);
    ex.start(mk("groom", "here", { stay_sec: 2 }));
    const events = run(ex, () => ex.phase === "idle" && !ex.airborne, 30);
    expect(events.some((e) => e.type === "done" && e.intent === "groom")).toBe(true);
  });

  it("leaves the screen for respect modes and comes back on the dock afterwards", () => {
    const { ex } = setup();
    ex.start(mk("leave", "corner"));
    const events = run(ex, () => ex.body.hidden);
    expect(events.some((e) => e.type === "hidden")).toBe(true);
    ex.start(mk("groom", "here", { stay_sec: 1 }));
    expect(ex.body.hidden).toBe(false);
    expect(ex.body.platformId).toBe("dock");
  });

  it("stops blocking as soon as it is interrupted", () => {
    const { ex } = setup();
    ex.start(mk("sit_on", "w1", { stay_sec: 600 }));
    run(ex, () => ex.phase === "doing");
    ex.start(mk("nap", "corner", { stay_sec: 60 }));
    expect(ex.blocking).toBe(false);
  });

  it("finishes an intent whose target window has no visible edge", () => {
    const { ex } = setup();
    ex.start(mk("sit_on", "w3", { stay_sec: 2 })); // w3's top edge is fully covered
    const events = run(ex, () => ex.phase === "idle");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("makes the cat's hit box follow its feet", () => {
    const { ex } = setup();
    expect(ex.hitRect()).toEqual({ x: 145, y: 770, w: 110, h: 90 });
  });
});

describe("Executor and the latest world", () => {
  it("heads for the corner farthest from where the cursor is NOW, not where it was", () => {
    const { ex, world } = setup(makeWorld({ cursor: { x: 100, y: 400 } }));
    ex.observe({ ...world, cursor: { x: 1300, y: 400 } });
    ex.start(mk("nap", "corner", { stay_sec: 5 }));
    run(ex, () => ex.phase === "doing");
    expect(ex.body.x).toBeLessThan(100); // left corner, away from the cursor on the right
  });

  it("walks to the cursor's current position", () => {
    const { ex, world } = setup();
    ex.observe({ ...world, cursor: { x: 900, y: 880 } });
    ex.start(mk("watch", "cursor", { stay_sec: 2 }));
    run(ex, () => ex.phase === "doing");
    expect(ex.body.x).toBeGreaterThan(850);
  });
});
