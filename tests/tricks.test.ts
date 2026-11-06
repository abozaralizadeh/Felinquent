import { describe, expect, it } from "vitest";
import type { Beat } from "../src/core/executor";
import { Habits } from "../src/core/habits";
import { InMemoryMemory } from "../src/core/memory";
import { initialNeeds } from "../src/core/needs";
import { ARCHETYPES } from "../src/core/personality";
import { seeded } from "../src/core/rng";
import { candidates } from "../src/core/rules";
import { BREED_GAP_MS, MAX_TRICKS, TRICK_POSES, TrickBook, checkTrick, distance, kindOf, mutate, type Trick } from "../src/core/tricks";
import { makeWorld } from "../src/core/world";
import { mean, simulate } from "../tools/month-sim";
import { at, newCat, T0 } from "./helpers";

const filled = (n: number, seed = 3): TrickBook => {
  const book = new TrickBook();
  const rng = seeded(seed);
  for (let i = 0; i < n; i++) book.breed(rng, T0 + i * 60_000, undefined, true);
  return book;
};

const trick = (id: string, beats: Beat[]): Trick => ({ id, name: `the ${id}`, beats, kind: kindOf(beats), born: { atMs: T0, from: [] }, shown: 3, lastMs: 0 });

describe("making up tricks", () => {
  it("every change it makes keeps to the poses it is allowed and to sane numbers", () => {
    const rng = seeded(8);
    let beats: Beat[] = [{ do: "look", sec: 1 }, { do: "pounce", sec: 0.8 }, { do: "groom", sec: 2 }];
    const poses = new Set<string>(TRICK_POSES);
    for (let i = 0; i < 300; i++) {
      beats = mutate(beats, rng, [{ go: "cursor", by: 100, speed: "run" }, { do: "swat", sec: 1 }]);
      if (beats.length < 2) beats = [{ do: "look", sec: 1 }, { do: "happy", sec: 1 }];
      expect(beats.length).toBeLessThanOrEqual(8);
      for (const b of beats) {
        if ("do" in b) {
          expect(poses.has(b.do)).toBe(true);
          expect(b.sec).toBeGreaterThanOrEqual(0.3);
          expect(b.sec).toBeLessThanOrEqual(6);
        } else expect(b.by).toBeLessThanOrEqual(400);
      }
      // Never the same pose twice in a row.
      for (let k = 1; k < beats.length; k++) {
        const p = beats[k - 1] as Beat;
        const q = beats[k] as Beat;
        if ("do" in p && "do" in q) expect(p.do).not.toBe(q.do);
      }
    }
  });

  it("the checker plays a trick for real and throws out ones that get stuck or go on forever", () => {
    expect(checkTrick([{ do: "look", sec: 1, face: "cursor" }, { go: "cursor", by: 150, speed: "walk" }, { do: "headbutt", sec: 2 }, { do: "purr", sec: 2 }]).ok).toBe(true);
    expect(checkTrick([{ do: "look", sec: 1 }]).ok).toBe(false);
    expect(checkTrick(Array.from({ length: 8 }, (_, i): Beat => ({ do: i % 2 ? "groom" : "loaf", sec: 6 }))).ok).toBe(false);
    // One pose held a while is nothing to see.
    expect(checkTrick([{ do: "loaf", sec: 2 }, { do: "loaf", sec: 2 }]).ok).toBe(false);
  });

  it("breeds different tricks with names, across the grid, and never near copies", () => {
    const book = filled(80);
    const all = book.all;
    expect(all.length).toBeGreaterThan(15);
    expect(all.length).toBeLessThanOrEqual(MAX_TRICKS);
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.kind)).size).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(distance((all[i] as Trick).beats, (all[j] as Trick).beats)).toBeGreaterThanOrEqual(0.25);
    for (const t of all) {
      expect(t.name).toMatch(/^the [a-z -]+(, part \d+)?$/);
      expect(checkTrick(t.beats).ok).toBe(true);
    }
  });

  it("makes at most one every few hours, unless told to", () => {
    const book = new TrickBook();
    const rng = seeded(4);
    let made = 0;
    for (let i = 0; i < 20 && !made; i++) if (book.breed(rng, T0 + i, undefined, true)) made++;
    expect(made).toBe(1);
    expect(book.breed(rng, T0 + 60 * 60_000)).toBeNull();
    let later = 0;
    for (let i = 0; i < 20 && !later; i++) if (book.breed(rng, T0 + BREED_GAP_MS + 60_000 + i * BREED_GAP_MS)) later++;
    expect(later).toBe(1);
  });
});

describe("the grid keeps what you like", () => {
  it("a full cell lets a new trick push out the one you shooed, not the one you love", () => {
    const book = new TrickBook();
    const h = new Habits();
    const a = trick("loved", [{ do: "yawn", sec: 1 }, { do: "stretch", sec: 2 }, { do: "blink", sec: 1 }]);
    const b = trick("hated", [{ do: "blink", sec: 1 }, { do: "stretch", sec: 2 }, { do: "yawn", sec: 1 }, { do: "loaf", sec: 2 }]);
    const c = trick("new", [{ do: "loaf", sec: 1 }, { do: "yawn", sec: 2 }, { do: "stretch", sec: 1 }]);
    expect(book.insert(a, h).added).toBe(true);
    expect(book.insert(b, h).added).toBe(true);
    for (let i = 0; i < 5; i++) h.reward("trick:loved", T0);
    for (let i = 0; i < 5; i++) h.punish("trick:hated", T0);
    const r = book.insert({ ...c, shown: 0 }, h, T0);
    expect(r.added).toBe(true);
    expect(r.evicted?.id).toBe("hated");
    expect(book.get("loved")).toBeDefined();
  });
});

describe("saving tricks", () => {
  it("round-trips with the memory and forgetting wipes them", () => {
    const m = new InMemoryMemory();
    const rng = seeded(2);
    for (let i = 0; i < 10; i++) m.tricks.breed(rng, T0 + i, undefined, true);
    const n = m.tricks.all.length;
    expect(n).toBeGreaterThan(2);
    const m2 = new InMemoryMemory();
    m2.loadJson(m.exportJson());
    expect(m2.tricks.all.map((t) => t.name)).toEqual(m.tricks.all.map((t) => t.name));
    m2.forgetAll();
    expect(m2.tricks.all.length).toBe(0);
  });

  it("a hand-edited file can't sneak anything in: bad poses drop the trick, numbers are clamped", () => {
    const book = new TrickBook();
    book.load({
      tricks: [
        { id: "a", name: "the typer", beats: [{ do: "keyboard", sec: 5 }, { do: "look", sec: 1 }] },
        { id: "b", name: "the long one<script>", beats: [{ do: "look", sec: 999 }, { go: "cursor", by: 99999, speed: "teleport" }, { do: "happy", sec: -4 }] },
        { id: "c", name: "the code", beats: "rm -rf" },
      ],
    });
    expect(book.all.map((t) => t.id)).toEqual(["b"]);
    const t = book.get("b") as Trick;
    expect(t.name).toBe("the long onescript");
    expect(t.beats[0]).toEqual({ do: "look", sec: 6 });
    expect(t.beats[1]).toEqual({ go: "cursor", by: 400, speed: "walk" });
    expect(t.beats[2]).toEqual({ do: "happy", sec: 0.3 });
  });
});

describe("tricks in its life", () => {
  it("shows a new trick with its name in the bubble, then learns from your pet", async () => {
    const { cat, world } = newCat({ settings: { chaos: "gremlin" }, minDecisionGapMs: 0 });
    for (let i = 0; i < 40; i++) cat.mind.dream(T0 + i, true);
    expect(cat.memory.tricks!.all.length).toBeGreaterThan(5);
    cat.mind.forceNeeds({ energy: 0.9 });
    let shown: { id: string; thought?: string; atMs: number } | null = null;
    for (let i = 0; i < 60 * 60 * 2 && !shown; i++) {
      const now = T0 + i * 500;
      const res = await cat.step(at(world, now), 0.5);
      for (const e of res.mind) if (e.type === "intent" && e.intent.intent === "trick") shown = { id: e.intent.trick as string, thought: e.intent.thought, atMs: now };
    }
    expect(shown).not.toBeNull();
    expect(shown!.thought).toMatch(/^new trick: the /);
    expect(cat.executor.intent?.script?.length ?? 0).toBeGreaterThan(1);
    cat.react("pet", at(world, shown!.atMs + 5000));
    expect(cat.memory.habits!.estimate(`trick:${shown!.id}`)).toBeGreaterThan(0.5);
  }, 30_000);

  it("rude tricks stay off the menu at chill, and there is one trick per kind at most", () => {
    const book = filled(60);
    const base = { world: makeWorld({ nowMs: T0 }), needs: { ...initialNeeds(), energy: 0.9 }, personality: ARCHETYPES.gremlin!, smartTargeting: false, catPos: { x: 200, y: 800 }, justWoke: false, recent: [] as never[], tricks: book };
    const chill = candidates({ ...base, chaos: "chill", rng: seeded(1) }).filter((o) => o.intent === "trick");
    expect(chill.length).toBeGreaterThan(0);
    expect(chill.some((o) => o.kind === "mischief")).toBe(false);
    const gremlin = candidates({ ...base, chaos: "gremlin", rng: seeded(1) }).filter((o) => o.intent === "trick");
    expect(new Set(gremlin.map((o) => o.kind)).size).toBe(gremlin.length);
  });

  it("over a few days it keeps doing things it hadn't done lately", async () => {
    const r = await simulate({ days: 5, seed: 6, step: 3 });
    expect(r.cat.memory.tricks!.all.length).toBeGreaterThan(3);
    expect(mean(r.days.slice(1), "surprise")).toBeGreaterThan(0);
  }, 60_000);
});
