import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { characterById } from "../src/core/characters";
import type { Brain } from "../src/core/brain";
import { Executor, type Anim } from "../src/core/executor";
import { Mess } from "../src/core/mess";
import { seeded } from "../src/core/rng";
import { instinctFor } from "../src/core/species";
import type { ChaosLevel, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { simulate } from "../tools/month-sim";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/** An animal on the Dock, awake, with a brain that fails the test if it is ever asked (the model is off). */
async function setup(id: string, chaos: ChaosLevel = "normal", over: Partial<WorldSnapshot> = {}) {
  const base = makeWorld({ nowMs: T0 });
  let asked = 0;
  const never: Brain = {
    name: "never",
    decide: async () => {
      asked++;
      return null;
    },
    plan: async () => {
      asked++;
      return null;
    },
  } as unknown as Brain;
  const cat = new Cat({ rng: seeded(31), brain: never, settings: { chaos, brain: "rules" }, personality: characterById(id).personality });
  cat.place(base, 500);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.9, attention: 0.4 });
  let t = 0;
  let cursor = { x: 1300, y: 300 };
  let speed = 0;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor, cursorSpeed: speed, ...over });
  const intents: string[] = [];
  const anims: Anim[] = [];
  const facings: number[] = [];
  const run = async (sec: number, each?: (t: number) => void): Promise<void> => {
    for (let i = 0; i < sec * 60; i++) {
      t += DT;
      each?.(t);
      await cat.step(world(), DT);
      const now = cat.executor.intent?.intent;
      if (now && intents[intents.length - 1] !== now) intents.push(now);
      const a = cat.executor.body.anim;
      if (anims[anims.length - 1] !== a) {
        anims.push(a);
        facings.push(cat.executor.body.facing);
      }
    }
  };
  return {
    cat,
    intents,
    anims,
    facings,
    run,
    world,
    asked: () => asked,
    set cursor(c: { x: number; y: number }) {
      cursor = c;
    },
    set speed(v: number) {
      speed = v;
    },
  };
}

describe("it has to go, now and then", () => {
  it("is rare: a few times a day at normal, more at gremlin, never at chill", async () => {
    const count = (r: Awaited<ReturnType<typeof simulate>>): number => (r.counts.get("pee") ?? 0) + (r.counts.get("poop") ?? 0);
    const normal = count(await simulate({ days: 2, seed: 4, step: 3, chaos: "normal" }));
    const gremlin = count(await simulate({ days: 2, seed: 4, step: 3, chaos: "gremlin" }));
    const chill = count(await simulate({ days: 2, seed: 4, step: 3, chaos: "chill" }));
    expect(normal).toBeGreaterThanOrEqual(2);
    expect(normal).toBeLessThanOrEqual(16);
    expect(gremlin).toBeGreaterThan(normal);
    expect(chill).toBe(0);
  }, 60_000);

  it("the puddle shows up under its rear, and the need starts again", async () => {
    const s = await setup("tabby");
    s.cat.mind.forcePotty("pee");
    await s.run(90);
    expect(s.intents).toContain("pee");
    const puddle = s.cat.mess.spots.find((x) => x.kind === "puddle");
    expect(puddle).toBeDefined();
    // Behind its middle, not under its head, and close to it.
    expect(Math.abs((puddle?.x ?? 0) - s.cat.executor.body.x)).toBeLessThan(s.cat.executor.size.w);
    expect(s.cat.mind.potty.pee).toBeLessThan(0.1);
    expect(s.cat.mind.happenedLines(s.world().nowMs).join(" ")).toMatch(/peed/);
  });

  it("a dog leaves its swirl, a rabbit pellets, a cat covers it up facing the spot, a dog kicks back without turning", async () => {
    const cat = await setup("tabby");
    cat.cat.mind.forcePotty("poop");
    await cat.run(90);
    expect(cat.cat.mess.spots.map((x) => x.kind)).toContain("poop_log");
    const ci = cat.anims.indexOf("cover");
    expect(ci).toBeGreaterThan(-1);
    // It turned round to face what it did before raking.
    expect(cat.facings[ci]).toBe(-(cat.facings[cat.anims.indexOf("poop")] as number));

    const dog = await setup("biscuit");
    dog.cat.mind.forcePotty("poop");
    await dog.run(90);
    expect(dog.cat.mess.spots.map((x) => x.kind)).toContain("poop");
    const di = dog.anims.indexOf("cover");
    if (di > -1) expect(dog.facings[di]).toBe(dog.facings[dog.anims.indexOf("poop")]);

    const rabbit = await setup("clover");
    rabbit.cat.mind.forcePotty("poop");
    await rabbit.run(90);
    expect(rabbit.cat.mess.spots.map((x) => x.kind)).toContain("pellets");
    expect(rabbit.anims).not.toContain("cover");
  });

  it("after a poop it sometimes gets the zoomies", () => {
    const world = makeWorld({ nowMs: T0 });
    let zoomed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ex = new Executor(seeded(seed));
      ex.setInstinct(instinctFor("cat"));
      ex.placeOnDock(world, 400);
      ex.start({ intent: "poop", target: "here", approach: "walk", stay_sec: 20, mood: "content" });
      const anims: string[] = [];
      for (let i = 0; i < 60 * 60; i++) {
        const done = ex.update(DT).some((e) => e.type === "done");
        if (anims[anims.length - 1] !== ex.body.anim) anims.push(ex.body.anim);
        if (done) break;
      }
      expect(anims).toContain("poop");
      expect(anims).toContain("potty_look");
      if (anims.slice(anims.indexOf("poop")).includes("run")) zoomed++;
    }
    expect(zoomed).toBeGreaterThan(2);
    expect(zoomed).toBeLessThan(18);
  });

  it("never in a meeting: it holds on", async () => {
    const s = await setup("tabby", "normal", { inMeeting: true });
    s.cat.mind.forcePotty("pee", 1.6);
    await s.run(60);
    expect(s.intents).not.toContain("pee");
    expect(s.cat.mess.spots).toEqual([]);
  });

  it("a click on it cleans it up (and the animal notices); a click on the animal is still a poke", async () => {
    const s = await setup("tabby");
    s.cat.mind.forcePotty("poop");
    await s.run(90);
    const spot = s.cat.mess.spots[0];
    expect(spot).toBeDefined();
    // Walk the animal well away first, so the click can't land on it (the corner away from the cursor).
    s.cursor = { x: spot!.x, y: 300 };
    await s.run(0.1);
    s.cat.executor.start({ intent: "wander", target: "corner", approach: "run", stay_sec: 5, mood: "content" });
    await s.run(8);
    const box = s.cat.mess.spotBox(spot!);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(s.cat.spotRects.length).toBe(1);
    expect(s.cat.pointer({ t: 1, x: cx, y: cy, down: false }, s.world())).toEqual([]);
    expect(s.cat.pointer({ t: 20, x: cx, y: cy, down: true }, s.world())).toEqual([]);
    expect(s.cat.pointer({ t: 40, x: cx, y: cy, down: false }, s.world())).toEqual([]);
    expect(s.cat.spotRects.length).toBe(0);
    await s.run(1);
    expect(s.cat.mess.spots).toEqual([]);
    expect(s.cat.mind.happenedLines(s.world().nowMs).join(" ")).toMatch(/cleaned up after me/);
  });
});

describe("spots on windows", () => {
  const win = (x: number) => ({ id: "w1", app: "Notes", bounds: { x, y: 300, w: 600, h: 400 }, focused: true, cpu: "low" as const, z: 0 });

  it("ride along with the window, and go when it closes", () => {
    const mess = new Mess(seeded(3));
    const w0 = makeWorld({ nowMs: T0, windows: [win(200)] });
    mess.step(DT, w0, "normal", null);
    const s = mess.relieve("poop_log", "w1", 400, T0);
    expect(s?.y).toBe(300);
    mess.step(DT, { ...w0, nowMs: T0 + 1000, windows: [win(350)] }, "normal", null);
    expect(mess.spots[0]?.x).toBe(550);
    mess.step(DT, { ...w0, nowMs: T0 + 2000, windows: [] }, "normal", null);
    expect(mess.spots).toEqual([]);
  });

  it("a puddle dries up after a few minutes and a poop fades later", () => {
    const mess = new Mess(seeded(5));
    const w0 = makeWorld({ nowMs: T0, windows: [win(200)] });
    mess.step(DT, w0, "normal", null);
    mess.relieve("puddle", "w1", 400, T0, 5);
    mess.relieve("poop", "w1", 500, T0);
    mess.step(DT, { ...w0, nowMs: T0 + 10 * 60_000 }, "normal", null);
    expect(mess.spots.map((x) => x.kind)).toEqual(["poop"]);
    mess.step(DT, { ...w0, nowMs: T0 + 21 * 60_000 }, "normal", null);
    expect(mess.spots).toEqual([]);
  });

  it("a puddle spreads while it pees and runs down the window front", () => {
    const mess = new Mess(seeded(9));
    const w0 = makeWorld({ nowMs: T0, windows: [win(200)] });
    mess.step(DT, w0, "normal", null);
    mess.relieve("puddle", "w1", 400, T0, 6);
    mess.step(DT, { ...w0, nowMs: T0 + 1000 }, "normal", null);
    const early = mess.snapshot().spots[0]!;
    mess.step(DT, { ...w0, nowMs: T0 + 8000 }, "normal", null);
    const later = mess.snapshot().spots[0]!;
    expect(early.grow).toBeLessThan(later.grow);
    expect(later.grow).toBe(1);
    expect(later.drips).toBeGreaterThan(0);
  });
});

describe("with the model off, every move still happens (the rules do it all)", () => {
  it("the toy, the chase and the potty need the model for nothing", async () => {
    const s = await setup("biscuit", "gremlin");
    // The toy: thrown, and it reacts.
    s.cursor = { x: 900, y: 400 };
    s.cat.throwToy(s.world());
    await s.run(25);
    expect(s.intents.some((i) => ["fetch", "carry_toy", "stash_toy", "nose_toy", "knock_toy"].includes(i))).toBe(true);
    // A cursor racing past.
    const b = s.cat.executor.body;
    s.speed = 900;
    await s.run(25, (t) => {
      s.cursor = { x: b.x + 160 + Math.sin(t * 3) * 120, y: b.y - 40 };
    });
    s.speed = 0;
    expect(s.intents).toContain("chase_cursor");
    // It has to go.
    s.cat.mind.forcePotty("pee");
    await s.run(90);
    expect(s.intents).toContain("pee");
    expect(s.asked()).toBe(0);
  }, 30_000);

  it("over a day the rules alone pick the newer moves too (a play bow, a yawn, a look around)", async () => {
    const r = await simulate({ days: 2, seed: 8, step: 3, chaos: "gremlin", personality: characterById("biscuit").personality });
    for (const k of ["invite_play", "yawn", "look_around"]) expect(r.counts.get(k) ?? 0, k).toBeGreaterThan(0);
  }, 60_000);
});
