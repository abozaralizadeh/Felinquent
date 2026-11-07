import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { characterById } from "../src/core/characters";
import type { Brain, PlanContext } from "../src/core/brain";
import { seeded } from "../src/core/rng";
import type { WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/** An animal on the Dock, awake and keen, with the cursor where the test says. */
async function setup(id: string, chaos: "chill" | "normal" | "gremlin" = "normal", extra: Partial<ConstructorParameters<typeof Cat>[0]> = {}) {
  const base = makeWorld({ nowMs: T0 });
  const cat = new Cat({ rng: seeded(21), settings: { chaos }, personality: characterById(id).personality, ...extra });
  cat.place(base, 400);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.95, attention: 0.6 });
  let t = 0;
  let cursor = { x: 1100, y: 300 };
  let speed = 0;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor, cursorSpeed: speed });
  const intents: string[] = [];
  const states: string[] = [];
  /** Where it was each time it left the animal's mouth. */
  const drops: { x: number; y: number; how: string }[] = [];
  const run = async (sec: number, each?: (t: number) => void): Promise<void> => {
    for (let i = 0; i < sec * 60; i++) {
      t += DT;
      each?.(t);
      await cat.step(world(), DT);
      const now = cat.executor.intent?.intent;
      if (now && intents[intents.length - 1] !== now) intents.push(now);
      const v = cat.toyView();
      const s = v?.state;
      if (s && states[states.length - 1] !== s) {
        if (states[states.length - 1] === "carried" && v) drops.push({ x: v.x, y: v.y, how: s });
        states.push(s);
      }
    }
  };
  return {
    cat,
    intents,
    states,
    drops,
    run,
    world,
    set cursor(c: { x: number; y: number }) {
      cursor = c;
    },
    set speed(v: number) {
      speed = v;
    },
  };
}

describe("its toy, thrown by you", () => {
  it("a puppy brings the ball back to you and drops it at your feet", async () => {
    const s = await setup("biscuit");
    // You're over on the left; the ball lands to the right of the puppy.
    s.cursor = { x: 1300, y: 500 };
    s.cat.throwToy(s.world());
    s.cursor = { x: 150, y: 500 };
    expect(s.cat.toyView()?.state).toBe("rolling");
    await s.run(2);
    s.cat.executor.start({ intent: "fetch", target: "toy", approach: "run", stay_sec: 20, mood: "playful" });
    await s.run(20);
    expect(s.states).toContain("carried");
    // Dropped close to where you are, then it waits for you to throw it again.
    expect(s.drops.length).toBeGreaterThan(0);
    expect(Math.abs((s.drops[0]?.x ?? 0) - 150)).toBeLessThan(220);
    expect(s.cat.executor.carrying).toBeNull();
  });

  it("landing tells the brain, and the animal reacts to it on its own", async () => {
    const s = await setup("biscuit");
    s.cursor = { x: 900, y: 400 };
    s.cat.throwToy(s.world());
    await s.run(25);
    const reactions = ["fetch", "carry_toy", "stash_toy", "nose_toy", "knock_toy"];
    expect(s.intents.some((i) => reactions.includes(i))).toBe(true);
  });

  it("reacts the moment you throw it, even while a slow model is busy thinking", async () => {
    // A model that never answers: whatever happens has to come from the rules, at once.
    const never = { name: "slow", decide: () => new Promise(() => {}), plan: () => new Promise(() => {}) };
    const s = await setup("biscuit", "normal", { brain: never as never, settings: { chaos: "normal", brain: "llm" }, asyncMind: true });
    await s.run(3);
    s.cursor = { x: 900, y: 400 };
    s.cat.throwToy(s.world());
    await s.run(0.2);
    const reactions = ["fetch", "carry_toy", "stash_toy", "nose_toy", "knock_toy", "groom"];
    expect(reactions).toContain(s.cat.executor.intent?.intent);
  });

  it("a squirrel may bury it, and then it is gone until it comes out again", async () => {
    const s = await setup("hazel");
    s.cursor = { x: 900, y: 500 };
    s.cat.throwToy(s.world());
    await s.run(2);
    s.cat.executor.start({ intent: "stash_toy", target: "toy", approach: "walk", stay_sec: 20, mood: "smug" });
    await s.run(40);
    expect(s.states).toContain("carried");
    expect(s.cat.toyView()?.state).toBe("buried");
    expect(s.cat.toyRect).toBeNull();
    // Thrown again from the menu, it comes out of hiding.
    s.cat.throwToy(s.world());
    expect(s.cat.toyView()?.state).toBe("rolling");
  });

  it("you can pick it up, carry it about and throw it, and the animal sees where it lands", async () => {
    const s = await setup("tabby", "chill");
    s.cursor = { x: 1000, y: 500 };
    s.cat.throwToy(s.world());
    await s.run(4);
    const toy = s.cat.toyRect;
    expect(toy).not.toBeNull();
    const at0 = { x: (toy?.x ?? 0) + (toy?.w ?? 0) / 2, y: (toy?.y ?? 0) + (toy?.h ?? 0) / 2 };
    let t = 0;
    const press = (x: number, y: number, down: boolean): void => {
      t += 16;
      s.cat.pointer({ t, x, y, down }, s.world());
    };
    press(at0.x, at0.y, false);
    press(at0.x, at0.y, true);
    expect(s.cat.mess.holding).toBe(true);
    expect(s.cat.toyView()?.state).toBe("held");
    // Carried up and flicked to the left.
    for (let i = 1; i <= 20; i++) press(at0.x - i * 12, at0.y - i * 10, true);
    press(at0.x - 252, at0.y - 210, false);
    expect(s.cat.mess.holding).toBe(false);
    expect(s.cat.toyView()?.state).toBe("rolling");
    await s.run(4);
    expect(s.cat.toyView()?.state).not.toBe("held");
    expect(s.cat.toyView()?.thrownSecAgo).toBeLessThan(10);
  });

  it("a click on the toy is for the toy: the animal doesn't count it as a poke", async () => {
    const s = await setup("tabby", "chill");
    s.cat.throwToy(s.world());
    await s.run(4);
    const r = s.cat.toyRect as NonNullable<typeof s.cat.toyRect>;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    expect(s.cat.pointer({ t: 1, x: cx, y: cy, down: false }, s.world())).toEqual([]);
    expect(s.cat.pointer({ t: 20, x: cx, y: cy, down: true }, s.world())).toEqual([]);
    expect(s.cat.pointer({ t: 40, x: cx, y: cy, down: false }, s.world())).toEqual([]);
  });
});

describe("chasing the cursor", () => {
  it("at gremlin, a fast cursor close by sets it off at once, no model needed", async () => {
    const s = await setup("tabby", "gremlin");
    const b = s.cat.executor.body;
    s.speed = 900;
    await s.run(15, (t) => {
      s.cursor = { x: b.x + 160 + Math.sin(t * 3) * 120, y: b.y - 40 };
    });
    expect(s.intents).toContain("chase_cursor");
  });

  it("at chill it never runs after the cursor", async () => {
    const s = await setup("tabby", "chill");
    const b = s.cat.executor.body;
    s.speed = 900;
    await s.run(30, (t) => {
      s.cursor = { x: b.x + 160 + Math.sin(t * 3) * 120, y: b.y - 40 };
    });
    expect(s.intents).not.toContain("chase_cursor");
  });
});

describe("a slow brain", () => {
  it("doesn't stop the animal: frames go on while the model thinks", async () => {
    let release: () => void = () => {};
    let asked = 0;
    const slow: Brain = {
      name: "slow",
      decide: async () => null,
      plan: (ctx: PlanContext) => {
        asked++;
        return new Promise((resolve) => {
          release = () => resolve({ bout: ctx.fixedBout ?? ctx.bouts[0]?.kind ?? "rest", steps: [{ intent: ctx.options[0]?.intent ?? "idle", target: "here", approach: "walk", stay_sec: 5, mood: "content" }] } as never);
        });
      },
    } as unknown as Brain;
    const s = await setup("tabby", "normal", { brain: slow, settings: { chaos: "normal", brain: "llm" }, asyncMind: true });
    s.cat.mind.forceNeeds({ energy: 0.95 });
    const t0 = performance.now();
    await s.run(20);
    // Twenty seconds of frames ran even though the model never answered.
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(asked).toBeGreaterThan(0);
    expect(s.cat.pondering).toBe(true);
    release();
    await s.run(1);
    expect(s.cat.pondering).toBe(false);
  });
});

describe("what the model sees", () => {
  it("the screen in words: the pointer, the toy and the windows near it, and it all fits the model's window", async () => {
    const { LlmBrain } = await import("../src/core/brain");
    const { approxTokens } = await import("../src/core/summary");
    let seen: { system: string; user: string; schema: unknown } | null = null;
    const client = {
      name: "spy",
      generate: async (req: { system: string; user: string; schema: unknown }) => {
        // The first plan asked after the throw (the reaction itself is the rules', at once).
        if (!seen && req.user.includes("tennis ball")) seen = req;
        return "{}";
      },
    };
    const s = await setup("biscuit", "gremlin", { brain: new LlmBrain(client as never, 8000), settings: { chaos: "gremlin", brain: "llm" } });
    const b = s.cat.executor.body;
    s.cursor = { x: b.x + 500, y: 300 };
    s.cat.throwToy(s.world());
    s.cursor = { x: b.x - 300, y: b.y - 200 };
    s.speed = 600;
    await s.run(45);
    expect(seen).not.toBeNull();
    const req = seen as unknown as { system: string; user: string; schema: unknown };
    const user = JSON.parse(req.user) as { screen?: Record<string, unknown>; bouts: Record<string, { options: unknown }> };
    expect(user.screen).toBeDefined();
    const screen = user.screen as { pointer: string; pointer_on: string; toy?: string; me: string; size: string };
    expect(screen.toy).toMatch(/tennis ball/);
    expect(screen.pointer).toMatch(/to my (left|right)|above me|below me|on me/);
    expect(screen.me).toMatch(/Dock|window|mid-air/);
    expect(screen.size).toMatch(/^\d+x\d+/);
    // The bout it is planning gets the meaning of each move.
    expect(Object.values(user.bouts).some((v) => !Array.isArray(v.options))).toBe(true);
    // gemma3:1b runs with num_ctx 2048 and up to 260 tokens of answer.
    const total = approxTokens(req.system) + approxTokens(req.user) + approxTokens(JSON.stringify(req.schema));
    expect(total).toBeLessThan(1700);
  });
});
