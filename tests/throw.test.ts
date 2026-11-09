import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { characterById } from "../src/core/characters";
import { LlmBrain, NUM_CTX } from "../src/core/brain";
import { Mess, type MessEvent } from "../src/core/mess";
import { thingReaction } from "../src/core/mind";
import { seeded } from "../src/core/rng";
import { MAX_SEEN, approxTokens, thingWords } from "../src/core/summary";
import type { SeenThing, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

// ADR-061: whatever you pick up and throw, the animal sees it and the model hears about it.

const DT = 1 / 60;

/** An awake animal on the Dock at x 400, a mug on the Code window (w1) above it. */
async function setup(id = "tabby", extra: Partial<ConstructorParameters<typeof Cat>[0]> = {}, over: Partial<WorldSnapshot> = {}) {
  const base = makeWorld({ nowMs: T0, ...over });
  const cat = new Cat({ rng: seeded(21), settings: { chaos: "normal" }, personality: characterById(id).personality, ...extra });
  cat.place(base, 400);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.95, attention: 0.6 });
  // Washing on the Dock when the mug comes (not halfway up a jump to a window).
  cat.executor.start({ intent: "groom", target: "here", approach: "walk", stay_sec: 30, mood: "content" });
  let t = 0;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor: { x: 1200, y: 300 }, ...over });
  const intents: string[] = [];
  const run = async (sec: number, each?: () => void): Promise<void> => {
    for (let i = 0; i < sec * 60; i++) {
      t += DT;
      await cat.step(world(), DT);
      each?.();
      const now = cat.executor.intent?.intent;
      if (now && intents[intents.length - 1] !== now) intents.push(now);
    }
  };
  /** Picks up the thing under (x, y) and flings it: moves the hand by (dx, dy) in each of 4 frames, then lets go. */
  const fling = (x: number, y: number, dx: number, dy: number): void => {
    let ms = world().nowMs;
    const press = (px: number, py: number, down: boolean): void => {
      ms += 16;
      cat.pointer({ t: ms, x: px, y: py, down }, world());
    };
    press(x, y, false);
    press(x, y, true);
    for (let i = 1; i <= 4; i++) press(x + dx * i, y + dy * i, true);
    press(x + dx * 4, y + dy * 4, false);
  };
  return { cat, base, world, run, fling, intents };
}

function mugCentre(cat: Cat): { x: number; y: number } {
  const mug = cat.mess.props.find((p) => p.kind === "mug");
  if (!mug) throw new Error("no mug");
  const b = cat.mess.toyBox(mug);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

describe("a thing you pick up and throw", () => {
  it("the mess says so: picked up from its window, thrown, and where it came down", () => {
    const mess = new Mess(seeded(3));
    const world = makeWorld({ nowMs: T0 });
    mess.step(0.016, world, "normal", null);
    const mug = mess.place("mug", "w1", 500, T0);
    expect(mug).not.toBeNull();
    const id = mug?.id as string;
    mess.grab(id, 500, 110);
    const events: MessEvent[] = [...mess.step(0.016, world, "normal", null)];
    expect(events).toContainEqual(expect.objectContaining({ type: "thing_grabbed", kind: "mug", windowId: "w1" }));
    mess.holdAt(470, 90, 0.016);
    mess.holdAt(440, 70, 0.016);
    mess.letGo();
    for (let i = 0; i < 180; i++) events.push(...mess.step(1 / 60, at(world, T0 + i * 16), "normal", null));
    expect(events.some((e) => e.type === "thing_thrown" && e.kind === "mug" && Math.abs(e.vx) > 400)).toBe(true);
    const landed = events.find((e) => e.type === "thing_landed");
    expect(landed).toBeDefined();
    // A drop of 750 px onto the Dock breaks a mug, and the break says it was thrown (so it's told once).
    expect(landed).toMatchObject({ kind: "mug", broke: true });
    expect(events.find((e) => e.type === "broke")).toMatchObject({ thrown: true });
    expect(mess.seen()).toContainEqual(expect.objectContaining({ what: "pieces of a broken mug", byHuman: true }));
    expect(thingWords(world, { x: 900, y: 860 }, mess.seen()).join(" ")).toMatch(/pieces of a broken mug lying on the Dock, .*\(my human broke it\)/);
  });

  it("put down gently on a window it stands there, and the mess knows you put it there", () => {
    const mess = new Mess(seeded(3));
    const world = makeWorld({ nowMs: T0 });
    mess.step(0.016, world, "normal", null);
    const mug = mess.place("mug", "w1", 300, T0);
    mess.grab(mug?.id as string, 300, 110);
    mess.holdAt(500, 108, 0);
    mess.letGo();
    const events: MessEvent[] = [];
    for (let i = 0; i < 120; i++) events.push(...mess.step(1 / 60, at(world, T0 + i * 16), "normal", null));
    expect(events.find((e) => e.type === "thing_landed")).toMatchObject({ kind: "mug", broke: false, windowId: "w1" });
    expect(mess.seen()).toContainEqual(expect.objectContaining({ what: "mug", state: "standing", windowId: "w1", byHuman: true }));
  });

  it("its eyes follow it through the air, and it reacts the moment it lands (model off)", async () => {
    const s = await setup("tabby");
    s.cat.mess.place("mug", "w1", 560, s.world().nowMs);
    await s.run(1.5);
    const c = mugCentre(s.cat);
    s.fling(c.x, c.y, -25, -10);
    // In the air: the eyes are on the mug, not on the pointer far off to the right.
    await s.run(0.15);
    const flying = s.cat.mess.props.find((p) => p.kind === "mug" && p.state === "fall");
    if (flying) expect(s.cat.lookAt({ x: 1200, y: 300 }).x).toBeCloseTo(flying.x, 0);
    await s.run(2);
    expect(s.intents).toContain("react");
    const lines = s.cat.mind.happenedLines(s.world().nowMs).join(" | ");
    expect(lines).toMatch(/the human threw the mug off their Code window\. it (smashed|landed) on the Dock/);
    expect(lines).toMatch(/my reaction: (startle|bolt|sniff|watch|ignore)/);
    // Told once: no second "fell and broke" line for the same mug.
    expect(lines).not.toMatch(/the mug fell and broke/);
  });

  it("the model is asked right after, with what happened and everything on the screen", async () => {
    const asked: { system: string; user: string; schema: unknown }[] = [];
    const client = {
      name: "spy",
      generate: async (req: { system: string; user: string; schema: unknown }) => {
        asked.push(req);
        return "{}";
      },
    };
    const s = await setup("biscuit", { brain: new LlmBrain(client as never, 8000), settings: { chaos: "normal", brain: "llm" } });
    s.cat.mess.place("mug", "w1", 560, s.world().nowMs);
    s.cat.mess.place("plant", "w2", 1000, s.world().nowMs);
    await s.run(1.5);
    const before = asked.length;
    const c = mugCentre(s.cat);
    s.fling(c.x, c.y, -25, -10);
    await s.run(14);
    const after = asked.slice(before).map((r) => ({ r, user: JSON.parse(r.user) as Record<string, unknown> }));
    const hit = after.find((a) => JSON.stringify(a.user.happened ?? []).includes("threw the mug"));
    expect(hit).toBeDefined();
    const user = hit?.user as { thought_about: string; happened: string[]; screen: { things?: string[] } };
    expect(user.happened[0]).toMatch(/^just now: the human threw the mug/);
    expect(user.thought_about).toMatch(/mug/);
    const things = (user.screen.things ?? []).join(" | ");
    expect(things).toMatch(/(pieces of a broken mug|mug) lying on the Dock/);
    expect(things).toMatch(/potted plant standing on the Safari window/);
    const req = hit?.r as { system: string; user: string; schema: unknown };
    expect(req.system).toMatch(/"things"/);
    // It all fits the model's window with room for the answer.
    const total = approxTokens(req.system) + approxTokens(req.user) + approxTokens(JSON.stringify(req.schema));
    expect(total).toBeLessThan(NUM_CTX - 600);
  });

  it("in a meeting it only notes it: no jumping about on the screen", async () => {
    const s = await setup("tabby", {}, { inMeeting: true });
    s.cat.mess.place("mug", "w1", 560, s.world().nowMs);
    await s.run(1.5);
    const c = mugCentre(s.cat);
    s.fling(c.x, c.y, -25, -10);
    await s.run(2);
    expect(s.intents).not.toContain("react");
    expect(s.cat.mind.happenedLines(s.world().nowMs).join(" ")).toMatch(/threw the mug/);
  });

  it("every animal has a reaction that plays to the end, with the model off", async () => {
    for (const id of ["tabby", "biscuit", "chili", "clover", "hazel", "mochi", "bandit"]) {
      const s = await setup(id);
      s.cat.mess.place("mug", "w1", 520, s.world().nowMs);
      await s.run(1.5);
      const c = mugCentre(s.cat);
      s.fling(c.x, c.y, -25, -10);
      await s.run(2);
      expect(s.intents, id).toContain("react");
      // It finishes and goes on with its life.
      await s.run(12);
      expect(s.cat.executor.intent?.intent ?? "none", id).not.toBe("react");
    }
  });
});

describe("how it reacts", () => {
  const pick = (over: Partial<Parameters<typeof thingReaction>[0]>, n = 400) => {
    const rng = seeded(5);
    const names = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const r = thingReaction({ dir: 1, dist: 300, d: 300, shock: false, broke: false, kind: "cat", curiosity: 0.5, aloofness: 0.5, rng, ...over });
      names.set(r.name, (names.get(r.name) ?? 0) + 1);
    }
    return names;
  };

  it("a crash right next to it makes it jump; a rabbit mostly bolts", () => {
    const cat = pick({ shock: true, broke: true, d: 120, dist: 120 });
    expect(cat.get("startle") ?? 0).toBeGreaterThan(150);
    const rabbit = pick({ shock: true, broke: true, d: 120, dist: 120, kind: "rabbit" });
    expect(rabbit.get("bolt") ?? 0).toBeGreaterThan(rabbit.get("startle") ?? 0);
  });

  it("further off a dog goes to sniff it more than a cat does, and an aloof cat pretends it saw nothing", () => {
    const dog = pick({ kind: "dog", curiosity: 0.6 });
    const cat = pick({ kind: "cat", curiosity: 0.6 });
    expect(dog.get("sniff") ?? 0).toBeGreaterThan(cat.get("sniff") ?? 0);
    expect(pick({ kind: "cat", aloofness: 0.9 }).get("ignore") ?? 0).toBeGreaterThan(60);
    expect(pick({}).get("startle") ?? 0).toBe(0);
  });
});

describe("the screen in words", () => {
  const world = makeWorld({ nowMs: T0 });
  const me = { x: 400, y: 860 };

  it("says what each thing is doing and where, nearest first", () => {
    const scene: SeenThing[] = [
      { what: "vase", state: "standing", x: 1000, y: 200, windowId: "w2" },
      { what: "mug", state: "flying", x: 450, y: 600, windowId: null, byHuman: true },
      { what: "pieces of a broken glass of water", state: "lying", x: 520, y: 860, windowId: null },
      { what: "my puddle", state: "lying", x: 300, y: 860, windowId: null },
      { what: "a crack", state: "mark", x: 400, y: 300, windowId: "w1" },
      { what: "potted plant", state: "in_hand", x: 1200, y: 300, windowId: null, byHuman: true },
      { what: "a fly", state: "buzzing", x: 380, y: 700, windowId: null },
    ];
    const words = thingWords(world, me, scene);
    expect(words[0]).toMatch(/^my puddle lying on the Dock, right next to me|^my puddle lying on the Dock/);
    expect(words).toContain("mug flying through the air, close by above me (my human threw it)");
    expect(words.some((w) => /^vase standing on the Safari window, a little way off to my right above me/.test(w))).toBe(true);
    expect(words).toContain("potted plant in my human's hand");
    expect(words.some((w) => w.startsWith("a crack on the Code window"))).toBe(true);
    expect(words.some((w) => w.startsWith("a fly buzzing about"))).toBe(true);
    // Nearest first.
    expect(words.indexOf("potted plant in my human's hand")).toBe(words.length - 1);
  });

  it("lists at most a handful, so it always fits", () => {
    const scene: SeenThing[] = Array.from({ length: 40 }, (_, i) => ({ what: "mug", state: "lying" as const, x: 100 + i * 30, y: 860, windowId: null }));
    expect(thingWords(world, me, scene)).toHaveLength(MAX_SEEN);
  });
});
