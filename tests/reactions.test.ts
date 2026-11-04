import { describe, expect, it } from "vitest";
import type { Beat } from "../src/core/executor";
import { characterById } from "../src/core/characters";
import { pokeReaction } from "../src/core/reactions";
import { seeded } from "../src/core/rng";
import type { Kind } from "../src/core/species";
import { makeWorld } from "../src/core/world";
import { T0, at, newCat } from "./helpers";

const ID_BY_KIND: Record<Kind, string> = { cat: "tabby", dog: "biscuit", fox: "mochi", raccoon: "bandit" };
const anims = (script: Beat[]) => script.flatMap((b) => ("do" in b ? [b.do] : "anim" in b && b.anim ? [b.anim] : []));
const ANGRY = ["angry", "hiss", "puffed"];

function pokes(kind: Kind, n: number, seed = 1): { name: string; anims: string[]; effect: string }[] {
  const { cat, world } = newCat({ rng: seeded(seed), personality: characterById(ID_BY_KIND[kind]).personality });
  const out: { name: string; anims: string[]; effect: string }[] = [];
  for (let i = 0; i < n; i++) {
    const ev = cat.react("poke", at(world, T0 + i * 800)).find((e) => e.type === "intent");
    if (!ev || ev.type !== "intent") throw new Error("no reaction");
    expect(ev.intent.intent).toBe("react");
    const script = ev.intent.script ?? [];
    out.push({ name: "", anims: anims(script), effect: "" });
  }
  return out;
}

describe("a click gets a reaction, and it escalates", () => {
  it("every poke starts a scripted reaction", () => {
    for (const kind of ["cat", "dog", "fox", "raccoon"] as const) expect(pokes(kind, 1)[0]!.anims.length).toBeGreaterThan(1);
  });

  it("a cat that is poked again and again ends up hissing and storming off", () => {
    const seen = pokes("cat", 6).map((p) => p.anims);
    expect(seen.slice(0, 1).flat().some((a) => ANGRY.includes(a)), "the first poke is not cross").toBe(false);
    expect(seen.slice(3).flat().some((a) => ANGRY.includes(a)), "later pokes are cross").toBe(true);
  });

  it("a dog never gets angry, however many times it is poked", () => {
    for (const seed of [1, 2, 3, 4]) {
      const all = pokes("dog", 14, seed).flatMap((p) => p.anims);
      expect(all.filter((a) => ANGRY.includes(a))).toEqual([]);
    }
  });

  it("a dog plays: it bounces, bows and runs about", () => {
    const all = new Set(Array.from({ length: 12 }, (_, s) => pokes("dog", 5, s + 1)).flat().flatMap((p) => p.anims));
    expect([...all].some((a) => ["play_bow", "bounce", "happy", "bark", "beg"].includes(a))).toBe(true);
  });

  it("the same animal does not react the same way twice in a row", () => {
    for (const kind of ["cat", "dog", "fox", "raccoon"] as const) {
      let same = 0;
      for (let s = 1; s <= 30; s++) {
        const [a, b] = pokes(kind, 2, s);
        if (JSON.stringify(a!.anims) === JSON.stringify(b!.anims)) same += 1;
      }
      expect(same, kind).toBeLessThan(6);
    }
  });

  it("there is real variety across first pokes", () => {
    for (const kind of ["cat", "dog", "fox", "raccoon"] as const) {
      const variety = new Set(Array.from({ length: 40 }, (_, s) => JSON.stringify(pokes(kind, 1, s + 1)[0]!.anims)));
      expect(variety.size, kind).toBeGreaterThanOrEqual(3);
    }
  });

  it("an annoyed animal stays put out for a while", async () => {
    const { cat, world } = newCat({ rng: seeded(3), personality: characterById("tabby").personality });
    for (let i = 0; i < 6; i++) cat.react("poke", at(world, T0 + i * 700));
    await cat.step(at(world, T0 + 5000), 1);
    expect(cat.mind.needs.mood).toBe("sulky");
    await cat.step(at(world, T0 + 5000 + 5 * 60_000), 1);
    expect(cat.mind.needs.mood).not.toBe("sulky");
  });

  it("a poke while it is away (meeting) does nothing", () => {
    const { cat, world } = newCat({});
    const meeting = at(world, T0, { inMeeting: true });
    expect(cat.react("poke", meeting).filter((e) => e.type === "intent")).toEqual([]);
  });

  it("a poke wakes a sleeper in a mood that fits the animal", () => {
    const run = (kind: Kind) => {
      const { cat, world } = newCat({ rng: seeded(2), personality: characterById(ID_BY_KIND[kind]).personality });
      cat.mind.sleeping = true;
      const ev = cat.react("poke", at(world, T0)).find((e) => e.type === "intent");
      return ev && ev.type === "intent" ? ev.intent : null;
    };
    expect(run("cat")?.mood).toBe("grumpy");
    expect(run("dog")?.mood).toBe("playful");
    expect(cat_sleeping()).toBe(false);
    function cat_sleeping(): boolean {
      const { cat, world } = newCat({});
      cat.mind.sleeping = true;
      cat.react("poke", at(world, T0));
      return cat.mind.sleeping;
    }
  });
});

describe("the reaction plays out in the executor", () => {
  async function play(kind: Kind, seed: number, n: number) {
    const base = makeWorld({ nowMs: T0 });
    const { cat } = newCat({ rng: seeded(seed), personality: characterById(ID_BY_KIND[kind]).personality }, base);
    const seen = new Set<string>();
    let world = at(base, T0, { cursor: { x: cat.executor.body.x + 120, y: cat.executor.body.y - 30 } });
    for (let i = 0; i < n; i++) cat.react("poke", at(world, T0 + i * 600));
    let ms = T0 + n * 600;
    for (let step = 0; step < 60 * 40 && (cat.executor.phase !== "idle" || step < 3); step++) {
      ms += 16;
      world = at(world, ms);
      await cat.step(world, 1 / 60);
      seen.add(cat.executor.body.anim);
      const b = cat.executor.body;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(world.screen.w + 1);
    }
    return { cat, seen };
  }

  it("each animal runs its reaction to the end, staying on the screen", async () => {
    for (const kind of ["cat", "dog", "fox", "raccoon"] as const) {
      for (const n of [1, 2, 4, 8]) {
        const { cat, seen } = await play(kind, n + 3, n);
        expect(cat.executor.phase, `${kind} x${n}`).toBe("idle");
        expect(seen.size, `${kind} x${n} showed more than one pose`).toBeGreaterThan(1);
      }
    }
  });

  it("pokes during a leap or a run do not get the cat stuck", async () => {
    const { cat } = await play("dog", 5, 3);
    expect(cat.executor.airborne).toBe(false);
  });
});

describe("pokeReaction", () => {
  it("falls back to a first-level reaction when nothing fits", () => {
    const r = pokeReaction({ kind: "cat", level: 9, trust: 0, energy: 0, pokes: 1, asleep: false, rng: seeded(1) });
    expect(r.script.length).toBeGreaterThan(0);
  });
});
