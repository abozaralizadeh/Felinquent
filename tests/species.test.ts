import { describe, expect, it } from "vitest";
import { CHARACTERS, characterById } from "../src/core/characters";
import { kindOf } from "../src/core/species";
import { seeded } from "../src/core/rng";
import { makeWorld } from "../src/core/world";
import { T0, at, newCat } from "./helpers";
import { simulate } from "./sim";

describe("every animal acts like itself", () => {
  it("maps each character to its kind", () => {
    const kinds = Object.fromEntries(CHARACTERS.map((c) => [c.id, kindOf(c.personality.species)]));
    expect(kinds).toEqual({ tabby: "cat", inky: "cat", pearl: "cat", mochi: "fox", bandit: "raccoon", biscuit: "dog", chili: "dog", clover: "rabbit", hazel: "squirrel" });
  });

  async function calls(id: string, n: number): Promise<number> {
    let came = 0;
    for (let i = 0; i < n; i++) {
      const { cat, world } = newCat({ rng: seeded(100 + i), personality: characterById(id).personality });
      const events = cat.mind.onReflex("call", at(world, T0));
      if (events.some((e) => e.type === "intent" && e.intent.intent === "follow")) came += 1;
    }
    return came / n;
  }

  it("a dog nearly always comes when called, a cat mostly does not", async () => {
    expect(await calls("biscuit", 200)).toBeGreaterThan(0.8);
    expect(await calls("tabby", 200)).toBeLessThan(0.45);
    expect(await calls("pearl", 200)).toBeLessThan(0.3);
  });

  it("a dog is far more active than a cat, and sleeps less", async () => {
    const run = async (id: string) => simulate({ hours: 3, seed: 3, personality: characterById(id).personality, minDecisionGapMs: undefined });
    const dog = await run("biscuit");
    const cat = await run("tabby");
    const moves = (l: typeof dog) => l.intents.filter((i) => i.source === "rules" || i.source === "llm").length;
    expect(moves(dog)).toBeGreaterThan(moves(cat) * 1.25);
    expect(dog.asleepSec / dog.totalSec).toBeLessThan(0.4);
    expect(dog.asleepSec / dog.totalSec).toBeLessThan(cat.asleepSec / cat.totalSec);
  }, 120_000);

  it("a gremlin acts more often than a chill cat", async () => {
    const run = async (chaos: "chill" | "gremlin") => simulate({ hours: 3, seed: 4, settings: { chaos } });
    const chill = await run("chill");
    const gremlin = await run("gremlin");
    const moves = (l: typeof chill) => l.intents.filter((i) => i.source === "rules" || i.source === "llm").length;
    expect(moves(gremlin)).toBeGreaterThan(moves(chill) * 2.5);
    expect(gremlin.asleepSec / gremlin.totalSec).toBeLessThan(chill.asleepSec / chill.totalSec);
  }, 120_000);

  it("a cat sometimes swats the hand that pets it, a dog never does", () => {
    const swats = (id: string) => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const { cat, world } = newCat({ rng: seeded(500 + i), personality: characterById(id).personality });
        const ev = cat.mind.onReflex("pet", makeWorld({ nowMs: world.nowMs }));
        if (ev.some((e) => e.type === "intent" && e.intent.intent === "swat")) n += 1;
      }
      return n;
    };
    expect(swats("tabby")).toBeGreaterThan(10);
    expect(swats("biscuit")).toBe(0);
  });
});
