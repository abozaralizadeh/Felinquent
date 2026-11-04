import { describe, expect, it } from "vitest";
import { Habits } from "../src/core/habits";
import { InMemoryMemory } from "../src/core/memory";
import { candidates } from "../src/core/rules";
import { initialNeeds } from "../src/core/needs";
import { ARCHETYPES } from "../src/core/personality";
import { seeded } from "../src/core/rng";
import { Executor } from "../src/core/executor";
import { makeWorld } from "../src/core/world";
import { newCat, at, T0 } from "./helpers";

describe("Habits", () => {
  it("starts neutral, likes what got rewarded, avoids what got punished, and stays bounded", () => {
    const h = new Habits();
    expect(h.multiplier("nap")).toBe(1);
    h.reward("sit_on");
    h.reward("sit_on");
    h.punish("meow");
    expect(h.multiplier("sit_on")).toBeGreaterThan(1);
    expect(h.multiplier("meow")).toBeLessThan(1);
    for (let i = 0; i < 100; i++) (h.reward("zoomies"), h.punish("swat"));
    expect(h.multiplier("zoomies")).toBeLessThanOrEqual(1.6);
    expect(h.multiplier("swat")).toBeGreaterThanOrEqual(0.5);
  });

  it("saves and loads with the memory, and forgetting clears it", () => {
    const m = new InMemoryMemory();
    m.habits.reward("knead");
    m.habits.reward("knead");
    const json = m.exportJson();
    const m2 = new InMemoryMemory();
    m2.loadJson(json);
    expect(m2.habits.multiplier("knead")).toBeGreaterThan(1);
    m2.forgetAll();
    expect(m2.habits.multiplier("knead")).toBe(1);
    m2.loadJson("not json");
    expect(m2.events()).toEqual([]);
  });

  it("changes what the rules like: a rewarded choice scores higher than a punished one", () => {
    const world = makeWorld({ nowMs: T0 });
    const base = { world, needs: { ...initialNeeds(), energy: 0.9 }, personality: ARCHETYPES.gremlin!, smartTargeting: false, catPos: { x: 200, y: 800 }, justWoke: false, recent: [] as never[] };
    const h = new Habits();
    for (let i = 0; i < 8; i++) h.reward("tour");
    for (let i = 0; i < 8; i++) h.punish("peek");
    const score = (name: string, habits?: Habits) => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) total += candidates({ ...base, rng: seeded(seed), habits }).find((o) => o.intent === name)?.score ?? 0;
      return total;
    };
    expect(score("tour", h)).toBeGreaterThan(score("tour"));
    expect(score("peek", h)).toBeLessThan(score("peek"));
  });

  it("a pet soon after a choice teaches the cat, a shoo punishes it, and an old choice teaches nothing", async () => {
    const { cat, world } = newCat({ minDecisionGapMs: 0 });
    cat.mind.forceNeeds({ energy: 0.9 });
    let w = at(world, T0);
    const events = await cat.step(w, 1);
    const chosen = events.mind.find((e) => e.type === "intent");
    if (!chosen || chosen.type !== "intent") throw new Error("the cat chose nothing");
    const name = chosen.intent.intent;
    cat.react("pet", at(world, T0 + 5000));
    expect(cat.memory.habits!.multiplier(name)).toBeGreaterThan(1);
    // A second pet right away teaches nothing more (the choice was already credited).
    const before = cat.memory.habits!.multiplier(name);
    cat.react("pet", at(world, T0 + 6000));
    expect(cat.memory.habits!.multiplier(name)).toBe(before);
    w = at(world, T0 + 10 * 60_000);
    cat.react("shoo", w);
    expect(cat.memory.habits!.multiplier(name)).toBe(before);
  });
});

describe("combos", () => {
  const run = (intent: "stalk" | "tour" | "cozy", target: string) => {
    const world = makeWorld({ nowMs: T0 });
    const ex = new Executor(seeded(4));
    ex.placeOnDock(world, 200);
    ex.start({ intent, target, approach: "run", stay_sec: 14, mood: "content" });
    const anims = new Set<string>();
    let done = false;
    for (let i = 0; i < 120 * 60 && !done; i++) {
      done = ex.update(1 / 60).some((e) => e.type === "done");
      anims.add(ex.body.anim);
    }
    return { done, anims };
  };

  it("stalk goes to the cursor, stares, pounces, swats and grooms", () => {
    const { done, anims } = run("stalk", "cursor");
    expect(done).toBe(true);
    for (const a of ["stare", "pounce", "swat", "groom"]) expect(anims.has(a), a).toBe(true);
  });

  it("tour walks the window top, looks, blinks, stretches and loafs", () => {
    const { done, anims } = run("tour", "w1");
    expect(done).toBe(true);
    for (const a of ["look", "blink", "stretch", "loaf"]) expect(anims.has(a), a).toBe(true);
  });

  it("cozy kneads and then sleeps", () => {
    const { done, anims } = run("cozy", "here");
    expect(done).toBe(true);
    expect(anims.has("knead") && anims.has("sleep")).toBe(true);
  });
});
