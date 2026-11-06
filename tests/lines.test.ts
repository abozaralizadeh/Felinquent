import { describe, expect, it } from "vitest";
import { parsePlan, shortThought, thoughtFits } from "../src/core/brain";
import { lineFor } from "../src/core/lines";
import { seeded } from "../src/core/rng";
import { thoughtTopic } from "../src/core/summary";
import type { Option } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0 } from "./helpers";

const opt = (intent: string): Option => ({ intent, targets: ["here"], score: 1 }) as Option;

describe("thoughts", () => {
  it("every topic the mind can pick has a written line, with the blanks filled", () => {
    const world = makeWorld({ nowMs: T0 });
    const rng = seeded(2);
    const happened = [
      "just now: the human poked me (3 times in a row), my reaction: hiss",
      "just now: i knocked the vase off. it broke.",
      "just now: a new Mail window opened",
      "just now: the human came back after 42 min away",
      "just now: the human shooed me off their Safari window",
      "just now: a fly got away from me",
      "just now: i landed so hard a window cracked",
    ];
    for (const h of happened) {
      const topic = thoughtTopic({ world, happened: [h], things: [], bout: "rest", busyForMin: 0 });
      const line = lineFor(topic, rng);
      expect(line, h).toBeTruthy();
      expect(line, h).not.toMatch(/\{|\}/);
    }
    expect(lineFor("a new Mail window opened", rng)).toMatch(/mail|window/i);
    expect(lineFor("your human has been busy in Code for 80 minutes and ignored you", seeded(1))).toMatch(/code|80/i);
    // With nothing fresh, the time of day or how long the human has been busy.
    for (let m = 0; m < 6; m++) {
      const quiet = { ...world, nowMs: T0 + m * 60_000 };
      expect(lineFor(thoughtTopic({ world: quiet, happened: [], things: ["mug on w1"], bout: "mischief", busyForMin: 50 }), rng)).toBeTruthy();
    }
  });

  it("doesn't say the same line twice in a row", () => {
    const rng = seeded(3);
    const said: string[] = [];
    for (let i = 0; i < 3; i++) said.push(lineFor("i knocked the mug off. it broke.", rng, said) as string);
    expect(new Set(said).size).toBe(3);
  });

  it("keeps a model's thought only when it is about the moment", () => {
    expect(thoughtFits("the mug was a threat. i will reclaim it later.", "i knocked the mug off. it broke.")).toBe(true);
    expect(thoughtFits("the dust motes dance in the light.", "i knocked the mug off. it broke.")).toBe(false);
    expect(thoughtFits("the human is a warm comfort.", "a fly got away from me")).toBe(false);
    expect(thoughtFits("a fly. always a nuisance.", "a fly got away from me")).toBe(true);
  });

  it("cuts a rambling thought to a line", () => {
    const long = "the world is a warm, soft place. a little sun is nice. maybe a nap is good. the human's hand is moving, so i need to watch it.";
    const t = shortThought(long);
    expect(t.length).toBeLessThanOrEqual(90);
    expect(t.startsWith("the world is a warm, soft place.")).toBe(true);
  });

  it("a plan has no repeated steps, and its bout follows its steps", () => {
    const bouts = [
      { kind: "rest" as const, weight: 1, options: [opt("nap"), opt("groom")] },
      { kind: "explore" as const, weight: 0.5, options: [opt("wander"), opt("peek")] },
    ];
    const p = parsePlan(JSON.stringify({ bout: "rest", steps: [{ intent: "nap", target: "here" }, { intent: "nap", target: "here" }, { intent: "groom", target: "here" }], mood: "sleepy", thought: "Zzz" }), bouts);
    expect(p?.steps.map((s) => s.intent)).toEqual(["nap", "groom"]);
    expect(p?.thought).toBe("zzz");
    const q = parsePlan(JSON.stringify({ bout: "rest", steps: [{ intent: "wander", target: "here" }, { intent: "peek", target: "here" }], mood: "curious" }), bouts);
    expect(q?.bout).toBe("explore");
    expect(q?.steps.map((s) => s.intent)).toEqual(["wander", "peek"]);
    const r = parsePlan(JSON.stringify({ bout: "rest", steps: [{ intent: "groom", target: "here" }, { intent: "nap", target: "here" }, { intent: "groom", target: "here" }], mood: "sleepy" }), bouts);
    expect(r?.steps.map((s) => s.intent)).toEqual(["groom", "nap"]);
  });
});

describe("a brain that wants the same thing again", () => {
  it("never gets the same action twice in a row", async () => {
    const { Cat } = await import("../src/core/cat");
    const { intentFromOption } = await import("../src/core/rules");
    // A stubborn model: always the first option of the bout it is handed, hunt if it can.
    const stubborn = {
      name: "stubborn",
      async decide() {
        return null;
      },
      async plan(ctx: import("../src/core/brain").PlanContext) {
        const b = ctx.bouts[0];
        if (!b) return null;
        const o = b.options.find((x) => x.intent === "hunt") ?? b.options[0];
        if (!o) return null;
        return { bout: b.kind, steps: [intentFromOption(o, ctx.rules, ctx.settings.chaos, false)] };
      },
    };
    const base = makeWorld({ nowMs: T0 });
    const cat = new Cat({ rng: seeded(11), brain: stubborn as never, settings: { chaos: "gremlin", brain: "llm" } });
    cat.place(base, 400);
    cat.mind.forceNeeds({ energy: 0.95, curiosity: 0.9 });
    const intents: string[] = [];
    for (let s = 0; s < 1800; s++) {
      const res = await cat.step({ ...base, nowMs: T0 + s * 1000 }, 1);
      for (const e of res.mind) if (e.type === "intent") intents.push(e.intent.intent);
    }
    expect(intents.length).toBeGreaterThan(10);
    for (let i = 1; i < intents.length; i++) expect(intents[i], `${intents.slice(Math.max(0, i - 3), i + 1).join(", ")}`).not.toBe(intents[i - 1]);
  }, 60_000);
});
