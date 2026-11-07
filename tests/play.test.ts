import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { CHARACTERS, characterById } from "../src/core/characters";
import { Executor, type ExecEvent } from "../src/core/executor";
import { Mess, TOY_KINDS, type MessEvent } from "../src/core/mess";
import type { Personality } from "../src/core/personality";
import { PROP_ASPECT } from "../src/core/prop-aspect";
import { WindowMotion } from "../src/core/motion";
import { seeded } from "../src/core/rng";
import type { WindowInfo, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/** A cat sitting on w1 with a mug next to it, and a way to move w1 frame by frame. */
function onWindow() {
  let world = makeWorld({ nowMs: T0 });
  const ex = new Executor(seeded(3));
  const mess = new Mess(seeded(5));
  const motion = new WindowMotion();
  ex.placeOnDock(world, 300);
  mess.step(DT, world, "normal", null);
  ex.start({ intent: "sit_on", target: "w1", approach: "walk", stay_sec: 600, mood: "smug" });
  for (let i = 0; i < 60 * 30 && !(ex.windowId === "w1" && ex.phase === "doing"); i++) ex.update(DT);
  const mug = mess.place("mug", "w1", ex.body.x + 160, T0);
  const events: (ExecEvent | MessEvent)[] = [];
  let t = 0;
  const frame = (dx: number, dy: number): void => {
    t += DT;
    const windows: WindowInfo[] = world.windows.map((w) => (w.id === "w1" ? { ...w, bounds: { ...w.bounds, x: w.bounds.x + dx, y: w.bounds.y + dy } } : w));
    world = { ...world, nowMs: T0 + Math.round(t * 1000), windows };
    motion.update(windows, DT);
    ex.ride(motion.of(ex.windowId), DT);
    ex.setWorld(world);
    events.push(...ex.update(DT));
    events.push(...mess.step(DT, world, "normal", null, (id) => motion.of(id)));
  };
  const still = (sec: number): void => {
    for (let i = 0; i < sec * 60; i++) frame(0, 0);
  };
  return { ex, mess, mug, events, frame, still, get world() { return world; } };
}

describe("riding a window that moves", () => {
  it("a window that only twitches a pixel back and forth doesn't keep it crouched", () => {
    const s = onWindow();
    s.still(0.5);
    const anims = new Set<string>();
    for (let i = 0; i < 6 * 60; i++) {
      s.frame(i % 2 === 0 ? 1 : -1, 0);
      if (i > 60) anims.add(s.ex.body.anim);
    }
    expect(anims.has("land")).toBe(false);
    expect(s.ex.windowId).toBe("w1");
  });

  it("a gentle drag carries the animal and the mug along, nothing falls", () => {
    const s = onWindow();
    expect(s.mug).not.toBeNull();
    s.still(0.5);
    const x0 = s.ex.body.x;
    const m0 = s.mug?.x ?? 0;
    // 300 px over 1.5 s, easing in and out (peak about 300 px/s).
    const n = 90;
    for (let i = 0; i < n; i++) s.frame((300 / n) * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / n)), 0);
    s.still(1);
    expect(s.ex.windowId).toBe("w1");
    expect(s.ex.airborne).toBe(false);
    expect(s.ex.body.x - x0).toBeGreaterThan(280);
    expect(s.mug?.state).toBe("rest");
    expect((s.mug?.x ?? 0) - m0).toBeGreaterThan(280);
    expect(s.events.some((e) => e.type === "flung")).toBe(false);
  });

  it("a fast fling and a dead stop sends the mug flying off the end", () => {
    const s = onWindow();
    s.still(0.5);
    // Up to 1800 px/s over a quarter of a second, a moment at that speed, then you let go: a dead stop.
    for (let i = 0; i < 15; i++) s.frame((1800 * (i + 1)) / 15 / 60, 0);
    for (let i = 0; i < 4; i++) s.frame(1800 / 60, 0);
    s.still(1.5);
    expect(s.events.filter((e) => e.type === "flung").length).toBeGreaterThanOrEqual(1);
    expect(s.mug?.state === "fall" || s.mug?.state === "settled" || (s.mug?.alpha ?? 0) === 0 || !s.mess.props.includes(s.mug as never)).toBe(true);
    // The animal digs its claws in and stays, cross about it.
    expect(s.ex.windowId).toBe("w1");
  });

  it("thrown off a window, it lands with a fright and gives you a look", () => {
    const s = onWindow();
    s.still(0.5);
    for (let i = 0; i < 8; i++) s.frame(0, 55);
    const anims: string[] = [];
    for (let i = 0; i < 60 * 5; i++) {
      s.frame(0, 0);
      anims.push(s.ex.body.anim);
    }
    expect(s.events.some((e) => e.type === "flung")).toBe(true);
    expect(s.ex.airborne).toBe(false);
    expect(anims).toContain("startled");
    expect(anims).toContain("annoyed");
  });

  it("a window yanked down leaves things floating for a moment", () => {
    const s = onWindow();
    s.still(0.5);
    const y0 = s.ex.body.y;
    for (let i = 0; i < 8; i++) s.frame(0, 55);
    expect(s.ex.airborne).toBe(true);
    expect(s.ex.body.y).toBeLessThan(y0 + 8 * 55);
    expect(s.mug?.state).toBe("fall");
  });

  it("a fast but steady drag makes it crouch and hold on, then it's annoyed", () => {
    const s = onWindow();
    s.still(0.5);
    const anims: string[] = [];
    // Over and back, up to 1000 px/s each way.
    for (const dir of [1, -1]) {
      for (let i = 0; i < 36; i++) {
        s.frame((dir * 1000 * Math.sin((Math.PI * (i + 0.5)) / 36)) / 60, 0);
        anims.push(s.ex.body.anim);
      }
    }
    for (let i = 0; i < 60 * 3; i++) {
      s.frame(0, 0);
      anims.push(s.ex.body.anim);
    }
    expect(s.ex.windowId).toBe("w1");
    expect(anims).toContain("land");
    expect(anims).toContain("annoyed");
    expect(s.events.some((e) => e.type === "held_on")).toBe(true);
  });

  it("a move seen only after a long gap is a jump, not a fling", () => {
    const motion = new WindowMotion();
    const w = makeWorld().windows;
    motion.update(w, 0.25);
    const moved = w.map((x) => ({ ...x, bounds: { ...x.bounds, x: x.bounds.x + 600 } }));
    motion.update(moved, 0.25);
    expect(motion.of("w1").vx).toBe(0);
  });
});

/** A gremlin cat told to do one thing, with the cursor where the test says. */
async function run(intent: "knock_toy" | "follow" | "play_cursor", cursorAt: (t: number) => { x: number; y: number }, seconds: number, personality?: Personality) {
  const base = makeWorld({ nowMs: T0 });
  const cat = new Cat({ rng: seeded(9), settings: { chaos: "gremlin" }, minDecisionGapMs: 600_000, personality });
  cat.place(base, 300);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.95 });
  cat.executor.start({ intent, target: intent === "knock_toy" ? "here" : "cursor", approach: "walk", stay_sec: 30, mood: "playful" });
  const anims: string[] = [];
  const toyX: number[] = [];
  let done = false;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * DT;
    const world = at(base, T0 + Math.round(t * 1000), { cursor: cursorAt(t), cursorSpeed: 200 });
    await cat.step(world, DT);
    anims.push(cat.executor.body.anim);
    const toy = cat.mess.toy;
    if (toy) toyX.push(toy.x);
    if (cat.executor.intent === null) done = true;
  }
  return { cat, anims, toyX, done };
}

describe("its toy ball", () => {
  it("brings out a real ball, bats it about and chases it, then has a wash", async () => {
    const r = await run("knock_toy", () => ({ x: 1300, y: 200 }), 60);
    expect(r.toyX.length).toBeGreaterThan(0);
    expect(Math.max(...r.toyX) - Math.min(...r.toyX)).toBeGreaterThan(150);
    expect(r.anims).toContain("swat");
    expect(r.anims).toContain("pounce");
    // The old pose with a ball painted in never shows.
    expect(r.anims).not.toContain("push_toy");
    expect(r.done).toBe(true);
  });

  it("every animal has a toy of its own, drawn", () => {
    const toys = CHARACTERS.map((c) => c.personality.toy);
    expect(new Set(toys).size).toBe(CHARACTERS.length);
    for (const t of toys) {
      expect(TOY_KINDS).toContain(t);
      expect(existsSync(new URL(`../src/playground/public/props/${t}.webp`, import.meta.url))).toBe(true);
      expect(PROP_ASPECT[t as string]).toBeGreaterThan(0);
    }
  });

  it("brings out its own toy, and another animal's toy goes when you switch", async () => {
    const r = await run("knock_toy", () => ({ x: 1300, y: 200 }), 20, characterById("clover").personality);
    expect(r.cat.mess.toy?.kind).toBe("carrot");
    r.cat.setPersonality(characterById("biscuit").personality);
    expect(r.cat.mess.toy).toBeUndefined();
    expect(r.cat.mess.toyKind).toBe("tennis");
  });

  it("a long toy skids to a stop lying flat; a ball rolls on further", async () => {
    const slide = async (kind: "carrot" | "tennis"): Promise<{ dist: number; rot: number }> => {
      const m = new Mess(seeded(3));
      m.toyKind = kind;
      const world = at(makeWorld(), T0);
      m.step(0.01, world, "chill", null);
      const t = m.bringToy(700, T0) as NonNullable<ReturnType<Mess["bringToy"]>>;
      for (let i = 0; i < 60; i++) m.step(1 / 60, world, "chill", null);
      const x0 = t.x;
      m.bat(t.id, 1);
      for (let i = 0; i < 60 * 8; i++) m.step(1 / 60, world, "chill", null);
      return { dist: Math.abs(t.x - x0), rot: t.rot };
    };
    const carrot = await slide("carrot");
    const ball = await slide("tennis");
    expect(carrot.dist).toBeLessThan(ball.dist);
    expect(Math.abs(Math.sin(carrot.rot))).toBeLessThan(0.05);
  });

  it("the ball stays around and doesn't fade like the mess does", async () => {
    const r = await run("knock_toy", () => ({ x: 1300, y: 200 }), 30);
    const world = at(makeWorld(), T0 + 400_000);
    for (let i = 0; i < 60 * 10; i++) r.cat.mess.step(1, world, "chill", null);
    expect(r.cat.mess.toy?.alpha ?? 0).toBeGreaterThan(0.9);
  });
});

describe("the cursor", () => {
  it("following you: it goes where the cursor is and stays near it", async () => {
    const r = await run("follow", () => ({ x: 1250, y: 800 }), 25);
    expect(Math.abs(r.cat.executor.body.x - 1250)).toBeLessThan(160);
    expect(r.anims).toContain("watch");
  });

  it("playing with it: crouches, then jumps or swipes at it", async () => {
    const r = await run("play_cursor", (t) => ({ x: 380 + Math.sin(t * 3) * 60, y: 700 + Math.cos(t * 4) * 30 }), 20);
    expect(r.anims).toContain("pounce");
    expect(r.anims.some((a) => a === "leap" || a === "swat")).toBe(true);
  });

  it("a cursor that comes close makes a sitting animal look at it and turn to it", () => {
    let world = makeWorld({ nowMs: T0, cursor: { x: 900, y: 300 } });
    const ex = new Executor(seeded(2));
    ex.glanceChance = 1;
    ex.placeOnDock(world, 400);
    ex.body.facing = 1;
    for (let i = 0; i < 30; i++) ex.update(DT);
    const anims: string[] = [];
    // The cursor wiggles just behind it, low down.
    for (let i = 0; i < 120; i++) {
      world = { ...world, cursor: { x: 300 + Math.sin(i / 5) * 20, y: 790 } };
      ex.observe(world);
      ex.update(DT);
      anims.push(ex.body.anim);
    }
    expect(anims).toContain("watch");
    expect(ex.body.facing).toBe(-1);
  });
});

describe("desktops", () => {
  const spaceA = { id: "a", index: 0, spans: true };
  const spaceB = { id: "b", index: 1, spans: true };
  const other: WindowInfo[] = [{ id: "x1", app: "Mail", bounds: { x: 500, y: 300, w: 600, h: 400 }, focused: true, cpu: "low", z: 0 }];

  async function setup() {
    const base = makeWorld({ nowMs: T0, space: spaceA });
    const cat = new Cat({ rng: seeded(12), minDecisionGapMs: 600_000 });
    cat.place(base, 300);
    let t = 0;
    const step = async (over: Partial<WorldSnapshot>, sec: number, until?: () => boolean): Promise<number[]> => {
      const xs: number[] = [];
      for (let i = 0; i < sec * 60 && !until?.(); i++) {
        t += DT;
        await cat.step(at(base, T0 + Math.round(t * 1000), over), DT);
        xs.push(cat.executor.body.x);
      }
      return xs;
    };
    /** Time passing in bigger steps, until something happens (at most `sec`). */
    const wait = async (over: Partial<WorldSnapshot>, sec: number, until: () => boolean): Promise<number> => {
      const from = t;
      while (t - from < sec && !until()) {
        t += 0.25;
        await cat.step(at(base, T0 + Math.round(t * 1000), over), 0.25);
      }
      return t - from;
    };
    return { cat, step, wait, base };
  }

  it("stays on its own desktop, and is there when you come back", async () => {
    const { cat, step } = await setup();
    await step({}, 1);
    const x = cat.executor.body.x;
    await step({ space: spaceB, windows: other }, 1);
    expect(cat.away).toBe(true);
    await step({}, 0.5);
    expect(cat.away).toBe(false);
    expect(Math.abs(cat.executor.body.x - x)).toBeLessThan(200);
  });

  it("comes over a while later from the side its desktop is on", async () => {
    const { cat, step, wait } = await setup();
    await step({}, 1);
    // You went right, so its desktop is to the left: it walks in from the left edge.
    await step({ space: spaceB, windows: other }, 0.5);
    expect(cat.away).toBe(true);
    const took = await wait({ space: spaceB, windows: other }, 400, () => !cat.away);
    expect(cat.away).toBe(false);
    expect(took).toBeGreaterThan(2);
    const xs = [cat.executor.body.x, ...(await step({ space: spaceB, windows: other }, 4))];
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(cat.executor.body.x).toBeGreaterThan(0);
  });

  it("mid-swipe, the next desktop's windows show up under the old desktop's name: it stays on its window and keeps its own desktop", async () => {
    const { cat, step } = await setup();
    // After the mind's first pick, so it doesn't replace this one.
    await step({}, 0.5);
    cat.executor.start({ intent: "sit_on", target: "w1", approach: "walk", stay_sec: 600, mood: "smug" });
    await step({}, 30, () => cat.executor.windowId === "w1" && cat.executor.phase === "doing");
    expect(cat.executor.windowId).toBe("w1");
    // A few reads where macOS lists the next desktop's windows but still names this one.
    await step({ windows: other }, 0.3);
    expect(cat.executor.windowId).toBe("w1");
    await step({ space: spaceB, windows: other }, 1);
    expect(cat.away).toBe(true);
    // Away, it lives among its own desktop's windows, not the ones from half way through the swipe.
    expect(cat.executor.platforms.some((p) => p.id.startsWith("w1"))).toBe(true);
    expect(cat.executor.platforms.some((p) => p.id.startsWith("x1"))).toBe(false);
    // Back, mid-swipe again: still on its window.
    await step({ windows: other }, 0.3);
    await step({}, 1);
    expect(cat.away).toBe(false);
    expect(cat.executor.windowId).toBe("w1");
  });

  it("a real change that only looks like a swipe is believed after a second", async () => {
    const { cat, step } = await setup();
    // After the mind's first pick, so it doesn't replace this one.
    await step({}, 0.5);
    cat.executor.start({ intent: "sit_on", target: "w1", approach: "walk", stay_sec: 600, mood: "smug" });
    await step({}, 30, () => cat.executor.windowId === "w1" && cat.executor.phase === "doing");
    // Every window closes and no desktop change follows: after the hold it falls like it should.
    await step({ windows: [] }, 3);
    expect(cat.executor.windowId).toBeNull();
  });

  it("asleep when you leave, it naps on a little, then wakes and comes over", async () => {
    const { cat, step, wait } = await setup();
    await step({}, 1);
    cat.mind.forceNeeds({ energy: 0.02 });
    cat.mind.sleeping = true;
    await step({ space: spaceB, windows: other }, 0.5);
    expect(cat.away).toBe(true);
    const took = await wait({ space: spaceB, windows: other }, 600, () => !cat.away);
    expect(cat.away).toBe(false);
    // About a minute past its time, not the half hour a nap can last.
    expect(took).toBeLessThan(200);
  });

  it("a treat from the menu calls it over at once", async () => {
    const { cat, step, base } = await setup();
    await step({}, 1);
    await step({ space: spaceB, windows: other }, 0.5);
    expect(cat.away).toBe(true);
    cat.treat(at(base, base.nowMs + 2000, { space: spaceB, windows: other }));
    expect(cat.away).toBe(false);
    await step({ space: spaceB, windows: other }, 3);
    expect(cat.executor.body.x).toBeGreaterThan(0);
  });

  it("never moves onto a Space where it can't be seen (a full-screen app, overlay on every desktop), and comes once you're on a desktop again", async () => {
    const { cat, step, wait, base } = await setup();
    const fullScreen = { id: "f", index: 2, spans: true, app: true, hidden: true };
    const big: WindowInfo[] = [{ id: "f1", app: "Safari", bounds: { x: 0, y: 0, w: 1440, h: 900 }, focused: true, cpu: "low", z: 0 }];
    await step({}, 1);
    await step({ space: fullScreen, windows: big }, 0.5);
    expect(cat.away).toBe(true);
    // Ten minutes there, and a treat: it stays on its own desktop.
    await wait({ space: fullScreen, windows: big }, 600, () => !cat.away);
    cat.treat(at(base, base.nowMs + 700_000, { space: fullScreen, windows: big }));
    expect(cat.away).toBe(true);
    // Back on its own desktop: there it is.
    await step({}, 0.5);
    expect(cat.away).toBe(false);
    // Out to the full-screen app and on to another desktop: it comes over to that one as usual.
    await step({ space: fullScreen, windows: big }, 0.5);
    await step({ space: spaceB, windows: other }, 0.5);
    expect(cat.away).toBe(true);
    const took = await wait({ space: spaceB, windows: other }, 400, () => !cat.away);
    expect(cat.away).toBe(false);
    expect(took).toBeLessThan(400);
  });

  it("comes over to a full-screen app it can be seen on, like to any desktop", async () => {
    const { cat, step, wait } = await setup();
    const fullScreen = { id: "f", index: 2, spans: true, app: true };
    const big: WindowInfo[] = [{ id: "f1", app: "Safari", bounds: { x: 0, y: 0, w: 1440, h: 900 }, focused: true, cpu: "low", z: 0 }];
    await step({}, 1);
    await step({ space: fullScreen, windows: big }, 0.5);
    expect(cat.away).toBe(true);
    const took = await wait({ space: fullScreen, windows: big }, 400, () => !cat.away);
    expect(cat.away).toBe(false);
    expect(took).toBeLessThan(400);
  });

  it("each desktop keeps its own mess", async () => {
    const { cat, step, base } = await setup();
    await step({}, 0.2);
    cat.mess.place("mug", "w1", 400, base.nowMs);
    await step({ space: spaceB, windows: other }, 0.2);
    expect(cat.mess.props.some((p) => p.kind === "mug")).toBe(false);
    await step({}, 0.2);
    expect(cat.mess.props.some((p) => p.kind === "mug")).toBe(true);
  });
});
