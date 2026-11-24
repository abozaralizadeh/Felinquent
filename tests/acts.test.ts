import { describe, expect, it } from "vitest";
import { actFit, actScript, parseActs, parsePoses } from "../src/core/acts";
import { BY_INTENT } from "../src/core/behaviors";
import { parsePlan, type Brain } from "../src/core/brain";
import { Cat } from "../src/core/cat";
import { BUILTIN_CATEGORY, CHARACTERS, categoryOf } from "../src/core/characters";
import { Governor } from "../src/core/governor";
import { InMemoryMemory } from "../src/core/memory";
import { initialNeeds } from "../src/core/needs";
import { parsePackage } from "../src/core/package";
import { seeded } from "../src/core/rng";
import { candidates, type RulesContext } from "../src/core/rules";
import { buildPlanPrompt, buildPlanSchema, buildPlanSummary, pickYourMove } from "../src/core/summary";
import { DEFAULT_SETTINGS, type WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

/**
 * A character's own moves as data (ADR-078): a package says in character.json how its own drawings
 * play (poses) and what it can choose to do with them (moves). The rules score them, the model sees
 * them by their own names, the mind turns one into a scene, and the drawings play it. No code in the
 * package. Every run here has the model off unless it says otherwise.
 */

const PKG = {
  format: 1,
  id: "testy",
  name: "Testy",
  category: "Test lab",
  version: 3,
  kind: "dog",
  potty: false,
  fur: "none",
  persona: "You are Testy, a cartoon test pilot.",
  poses: {
    salute: { play: [["move", ["stand", "salute1"], 0.4]], loop: [["hold", "salute1", 1.2], ["shake", "salute1", 0.4]] },
    jump: { play: [["hold", "crouch1", 0.3], ["hop", "air1", 0.6, 80]], loop: [["hold", "stand", 1]] },
    read: { play: [["move", ["sit", "read1"], 0.5]], loop: [["steps", ["read1", "read2"], 0.8]], base: "sit" },
  },
  moves: {
    salute: {
      means: "salute your human smartly",
      bout: "social",
      weight: 2,
      when: { near: "cursor" },
      beats: [{ go: "cursor", by: 200, speed: "walk" }, { do: "salute", sec: 3, face: "cursor", fx: "spark", fx_at: 0.5 }],
      say: ["at your service."],
      rest_min: 10,
    },
    sky_jump: { means: "a big jump for joy", bout: "play", weight: 1.5, when: { energy: "high" }, beats: [{ do: "jump", sec: 2 }, { do: "happy", sec: 1 }], rest_min: 5 },
    morning_read: { means: "read the morning paper", bout: "rest", weight: 1, when: { hours: [6, 11], human: ["typing", "reading"] }, beats: [{ do: "read", sec: 6 }], rest_min: 5 },
  },
};

const pkg = () => parsePackage(JSON.parse(JSON.stringify(PKG)));

const never = (): { brain: Brain; asked: () => number } => {
  let n = 0;
  const brain = { name: "never", decide: async () => (n++, null), plan: async () => (n++, null) } as unknown as Brain;
  return { brain, asked: () => n };
};

function ctxFor(world: WorldSnapshot, over: Partial<RulesContext> = {}): RulesContext {
  const { character } = pkg();
  return {
    world,
    needs: { ...initialNeeds(), energy: 0.8 },
    personality: character.personality,
    smartTargeting: false,
    catPos: { x: world.cursor.x + 100, y: world.dockTop },
    justWoke: false,
    recent: [],
    rng: seeded(4),
    chaos: "normal",
    ...over,
  };
}

describe("own moves as data (ADR-078)", () => {
  it("reads poses, moves, the category and the version from character.json", () => {
    const { character, art } = pkg();
    expect(character.category).toBe("Test lab");
    expect(character.version).toBe(3);
    expect(character.personality.acts?.map((a) => a.id)).toEqual(["salute", "sky_jump", "morning_read"]);
    expect(Object.keys(character.personality.poses ?? {})).toEqual(["salute", "jump", "read"]);
    expect(art.poses?.read?.base).toBe("sit");
    const salute = character.personality.acts?.[0];
    expect(salute).toMatchObject({ bout: "social", weight: 2, restMin: 10, say: ["at your service."] });
    expect(salute?.beats[1]).toMatchObject({ do: "salute", fx: "spark", fxAt: 0.5 });
  });

  it("says what is wrong with a bad move or pose", () => {
    const bad = (patch: Record<string, unknown>) => () => parsePackage({ ...JSON.parse(JSON.stringify(PKG)), ...patch });
    expect(bad({ moves: { nap: PKG.moves.salute } })).toThrow(/built-in move/);
    expect(bad({ moves: { x1: { ...PKG.moves.salute, beats: [{ do: "nope", sec: 1 }] } } })).toThrow(/do must be one of its poses/);
    expect(bad({ moves: { x1: { ...PKG.moves.salute, bout: "party" } } })).toThrow(/bout must be/);
    expect(bad({ moves: { x1: { ...PKG.moves.salute, beats: [{ go: "cursor", by: 100 }] } } })).toThrow(/at least one beat/);
    expect(bad({ poses: { p1: { play: [["spin", "a", 1]] } } })).toThrow(/hold, move, steps, hop or shake/);
    expect(bad({ poses: { p1: { play: [["hold", "Bad Name", 1]] } } })).toThrow(/frame name/);
    expect(bad({ poses: { p1: {} } })).toThrow(/no steps/);
    expect(bad({ version: 0 })).toThrow(/version/);
    // A shared pose is fine without a pose of its own.
    expect(parseActs({ wave: { means: "wave", bout: "social", beats: [{ do: "happy", sec: 1 }] } }, parsePoses(undefined), new Set())).toHaveLength(1);
  });

  it("every built-in animal is in a group, and a package goes in its own or in Yours", () => {
    for (const c of CHARACTERS) expect(BUILTIN_CATEGORY[c.id]).toBeTruthy();
    expect(categoryOf(pkg().character)).toBe("Test lab");
    expect(categoryOf({ id: "zzz", pack: true })).toBe("Yours");
  });

  it("a move scores higher when the moment fits it", () => {
    const world = makeWorld({ nowMs: T0 });
    const { character } = pkg();
    const read = character.personality.acts?.find((a) => a.id === "morning_read");
    if (!read) throw new Error("no read");
    const morning = { ...world, hour: 8, activity: "typing" as const };
    const night = { ...world, hour: 23, activity: "idle" as const };
    const a = actFit(read, morning, { ...initialNeeds(), energy: 0.8 }, 100);
    const b = actFit(read, night, { ...initialNeeds(), energy: 0.8 }, 100);
    expect(a.fits).toBe(true);
    expect(b.fits).toBe(false);
    expect(a.mult).toBeGreaterThan(b.mult * 5);
  });

  it("puts its moves on the rules' menu, by bout, and rests from one it just did", () => {
    const world = at(makeWorld({ nowMs: T0 }), T0, { hour: 8, activity: "typing" });
    const opts = candidates(ctxFor(world));
    const acts = opts.filter((o) => o.intent === "act");
    expect(acts.map((o) => o.act).sort()).toEqual(["morning_read", "salute", "sky_jump"]);
    expect(acts.find((o) => o.act === "salute")).toMatchObject({ kind: "social", targets: ["cursor"], fits: true });
    expect(acts.find((o) => o.act === "morning_read")).toMatchObject({ kind: "rest", targets: ["here"] });
    const resting = candidates(ctxFor(world, { actsDone: { salute: T0 - 60_000 } }));
    expect(resting.some((o) => o.act === "salute")).toBe(false);
    const rested = candidates(ctxFor(world, { actsDone: { salute: T0 - 11 * 60_000 } }));
    expect(rested.some((o) => o.act === "salute")).toBe(true);
  });

  it("turns a move into a scene: the walk over, its own pose, what it gives off", () => {
    const { character } = pkg();
    const salute = character.personality.acts?.[0];
    if (!salute) throw new Error("no salute");
    const { beats, seconds } = actScript(salute, character.personality.poses ?? {});
    expect(beats[0]).toEqual({ go: "cursor", by: 200, speed: "walk" });
    expect(beats[1]).toEqual({ do: "pose:salute", sec: 3, face: "cursor", fx: { fx: "act", kind: "spark" }, fxAt: 0.5 });
    expect(seconds).toBeGreaterThan(3);
  });

  it("the governor allows a move only while it is on offer", () => {
    const world = makeWorld({ nowMs: T0 });
    const gov = new Governor(DEFAULT_SETTINGS);
    const opts = [{ intent: "act" as const, act: "salute", targets: ["here"], score: 1 }];
    const needs = initialNeeds();
    expect(gov.validate({ intent: "act", act: "salute", target: "here", approach: "walk", stay_sec: 10, mood: "content" }, opts, world, needs)?.act).toBe("salute");
    expect(gov.validate({ intent: "act", act: "sky_jump", target: "here", approach: "walk", stay_sec: 10, mood: "content" }, opts, world, needs)).toBeNull();
    expect(BY_INTENT.get("act")).toBeTruthy();
  });

  it("the model sees its own moves by name, with what they mean and whether they fit now", () => {
    const world = at(makeWorld({ nowMs: T0 }), T0, { hour: 8, activity: "typing" });
    const ctx = ctxFor(world);
    const opts = candidates(ctx);
    const rest = opts.filter((o) => o.kind === "rest" || o.intent === "groom");
    const bouts = [{ kind: "rest" as const, weight: 1, options: rest }];
    const summary = buildPlanSummary({
      world,
      needs: ctx.needs,
      settings: DEFAULT_SETTINGS,
      bouts,
      acts: ctx.personality.acts,
      memory: [],
      happened: [],
      catWhere: "on the dock",
      catDoing: "sitting",
      lastBout: null,
      recent: [],
      busyForMin: 10,
    });
    const options = summary.bouts.rest?.options as Record<string, string>;
    expect(options.morning_read).toBe("read the morning paper (your own move, fits now)");
    expect(options.groom).toBeTruthy();
    // Its own moves come first, and the one that fits now is named outright for a small model.
    expect(Object.keys(options)[0]).toBe("morning_read");
    expect(summary.your_move).toBe("morning_read");
    expect(pickYourMove(rest, ctx.personality.acts ?? [], ["groom", "morning_read"])).not.toBe("morning_read");
    expect(buildPlanPrompt(ctx.personality, 50)).toContain('"your_move"');
    const schema = buildPlanSchema(bouts) as unknown as { properties: { steps: { items: { properties: { intent: { enum: string[] } } } } } };
    expect(schema.properties.steps.items.properties.intent.enum).toContain("morning_read");
    expect(schema.properties.steps.items.properties.intent.enum).not.toContain("act");
    expect(buildPlanPrompt(ctx.personality, 50)).toContain("your own move");
    // Its answer by the move's own name comes back as that move.
    const plan = parsePlan(JSON.stringify({ bout: "rest", steps: [{ intent: "morning_read", target: "here" }, { intent: "groom", target: "here" }], mood: "content", thought: "news." }), bouts);
    expect(plan?.steps[0]).toMatchObject({ intent: "act", act: "morning_read" });
    expect(plan?.steps[1]?.intent).toBe("groom");
  });

  it("with the model off it does every one of its moves in a few hours, each played to the end", async () => {
    const base = makeWorld({ nowMs: T0 });
    const { brain, asked } = never();
    const cat = new Cat({ rng: seeded(7), brain, memory: new InMemoryMemory(), settings: { chaos: "normal", brain: "rules" }, personality: pkg().character.personality });
    cat.place(base, 500);
    const started = new Map<string, number>();
    const anims = new Set<string>();
    let prev: string | undefined;
    const dt = 0.25;
    for (let i = 0; i < Math.round((4 * 3600) / dt); i++) {
      const s = i * dt;
      const hour = 6 + Math.floor(s / 1800) % 6;
      const cursor = { x: 300 + ((s * 40) % 900), y: 300 };
      const w = at(base, T0 + Math.round(s * 1000), { hour, cursor, cursorSpeed: s % 60 < 15 ? 200 : 0, activity: s % 600 < 400 ? "typing" : "idle", idleSec: s % 600 < 400 ? 1 : 120 });
      if (i % 2400 === 0) cat.mind.forceNeeds({ energy: 0.9, attention: 0.8 });
      await cat.step(w, dt);
      const it = cat.executor.intent;
      const name = it?.act;
      if (name && name !== prev) started.set(name, (started.get(name) ?? 0) + 1);
      prev = name;
      const anim = cat.executor.body.anim;
      if (anim.startsWith("pose:")) anims.add(anim);
    }
    expect([...started.keys()].sort()).toEqual(["morning_read", "salute", "sky_jump"]);
    expect([...anims].sort()).toEqual(["pose:jump", "pose:read", "pose:salute"]);
    // Rests between them: never the same move back to back, and not many more than its rest allows.
    expect(started.get("salute") ?? 0).toBeLessThanOrEqual(4 * 6 + 1);
    expect(asked()).toBe(0);
  }, 60_000);
});
