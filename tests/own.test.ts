import { describe, expect, it } from "vitest";
import type { Brain } from "../src/core/brain";
import { Cat } from "../src/core/cat";
import { characterById } from "../src/core/characters";
import type { Anim } from "../src/core/executor";
import { TRASH_KINDS } from "../src/core/mess";
import { pokeReaction } from "../src/core/reactions";
import { seeded } from "../src/core/rng";
import { instinctFor, OWN_INTENTS } from "../src/core/species";
import type { IntentName, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/**
 * Each animal's own moves (ADR-067), played by the real Cat with the model off: the executor's steps,
 * the effects in the mess (fur, earth, water, crumbs, the blanket, the snack box, bite marks) and
 * the poses the drawings get.
 */
async function play(id: string, intent: IntentName, sec = 60, target = "here") {
  const base = makeWorld({ nowMs: T0 });
  let asked = 0;
  const never = {
    name: "never",
    decide: async () => (asked++, null),
    plan: async () => (asked++, null),
  } as unknown as Brain;
  const cat = new Cat({ rng: seeded(5), brain: never, settings: { chaos: "normal", brain: "rules" }, personality: characterById(id).personality });
  cat.place(base, 500);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.8 });
  let t = 0;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor: { x: 1100, y: 300 } });
  // Let any first move (a hop) end, then start the one under test.
  for (let i = 0; i < 180 && (cat.executor as unknown as { mode: string }).mode !== "ground"; i++) (t += DT), await cat.step(world(), DT);
  if (target !== "here") cat.mess.step(DT, world(), "normal", null);
  cat.executor.start({ intent, target, approach: "walk", stay_sec: 20, mood: "content" });
  const anims: Anim[] = [];
  const puffs = new Set<string>();
  const spots = new Set<string>();
  const own = new Set<string>();
  const decals = new Set<string>();
  const modes = new Set<string>();
  let carried: string | null = null;
  let hiddenWhileBurrowed = false;
  // How far below the animal's feet a drop or a crumb got (they land on the ground it stands on).
  let sank = 0;
  for (let i = 0; i < sec * 60 && cat.executor.intent?.intent === intent; i++) {
    t += DT;
    await cat.step(world(), DT);
    const a = cat.executor.body.anim;
    if (anims[anims.length - 1] !== a) anims.push(a);
    modes.add((cat.executor as unknown as { mode: string }).mode);
    for (const f of cat.mess.puffs) {
      if (f.bornMs <= world().nowMs) puffs.add(f.kind);
      if ((f.kind === "drop" || f.kind === "crumb") && cat.executor.body.platformId === "dock") sank = Math.max(sank, f.y - cat.executor.body.y);
    }
    for (const s of cat.mess.spots) spots.add(s.kind);
    for (const d of cat.mess.decals) decals.add(d.kind);
    for (const p of cat.mess.props) {
      if (p.own) own.add(p.kind);
      if (p.own && p.state === "carried") carried = p.kind;
      if (p.own && p.kind === "blanket" && a === "burrow" && p.alpha < 0.5) hiddenWhileBurrowed = true;
    }
  }
  return { cat, anims, puffs, spots, own, decals, modes, carried, hiddenWhileBurrowed, sank, asked: () => asked };
}

describe("each animal's own moves (ADR-067), with the model off", () => {
  it("every animal has moves of its own, and only those animals do", () => {
    const owners: Record<string, string[]> = {};
    for (const id of ["tabby", "inky", "pearl", "mochi", "bandit", "biscuit", "chili", "clover", "hazel"]) {
      for (const i of instinctFor(characterById(id).personality.species).own ?? []) (owners[i] ??= []).push(id);
    }
    expect(Object.keys(owners).sort()).toEqual([...OWN_INTENTS].sort());
    // The cats already had the most; every other animal now has at least two of its own.
    for (const id of ["mochi", "bandit", "biscuit", "chili", "clover", "hazel"]) expect((instinctFor(characterById(id).personality.species).own ?? []).length, id).toBeGreaterThanOrEqual(2);
  });

  it("the dog shakes head to tail and fur flies off", async () => {
    for (const id of ["biscuit", "chili"]) {
      const r = await play(id, "shake_off");
      expect(r.anims, id).toContain("shake_off");
      expect([...r.puffs], id).toContain("fur");
      expect([...r.puffs], id).toContain("dust");
      expect(r.asked()).toBe(0);
    }
  });

  it("the dog lies down with its toy and chews it, then wags", async () => {
    const r = await play("biscuit", "chew");
    expect(r.anims).toContain("chew");
    expect(r.anims).toContain("wag");
    expect(r.cat.mess.toy?.state).not.toBe("carried");
  });

  it("the chihuahua pulls its blanket over itself, peeks out, dozes, and comes out with a shake", async () => {
    const r = await play("chili", "burrow", 90);
    expect(r.own).toContain("blanket");
    expect(r.anims).toContain("burrow");
    expect(r.hiddenWhileBurrowed).toBe(true);
    expect(r.anims.indexOf("shake_off")).toBeGreaterThan(r.anims.indexOf("burrow"));
  });

  it("the chihuahua shivers with a paw up", async () => {
    const r = await play("chili", "shiver");
    expect(r.anims).toContain("shiver");
    expect(r.anims).toContain("paw_up");
    expect([...r.puffs]).toContain("tremble");
  });

  it("the fox listens, leaps high and dives head first into the ground, and comes out with earth on its nose", async () => {
    const r = await play("mochi", "mouse");
    const seq = ["listen", "mouse_leap", "mouse_in", "mouse_out"].map((a) => r.anims.indexOf(a as Anim));
    expect(seq.every((i) => i >= 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    expect(r.spots).toContain("mound");
    expect([...r.puffs]).toContain("dust");
  });

  it("the fox and the squirrel cache their toy: a hole, and the earth pushed back with a nose or patted down", async () => {
    for (const [id, anim] of [["mochi", "nose_push"], ["hazel", "pat"]] as const) {
      const r = await play(id, "cache", 90);
      expect(r.anims, id).toContain(anim);
      expect(r.spots, id).toContain("mound");
    }
  });

  it("the raccoon washes its hands in a little pool, then looks at them", async () => {
    const r = await play("bandit", "wash");
    expect(r.anims).toContain("wash_hands");
    expect(r.anims).toContain("inspect");
    expect(r.spots).toContain("pool");
    expect([...r.puffs]).toContain("drop");
    // The drops land on the ground it sits on, not through it.
    expect(r.sank).toBeLessThanOrEqual(1);
  });

  it("the raccoon goes through a snack box: rubbish over its shoulder, then a find held up and nibbled", async () => {
    const r = await play("bandit", "raid", 90, "dock");
    expect(r.own).toContain("snack_box");
    expect([...r.own].some((k) => (TRASH_KINDS as readonly string[]).includes(k))).toBe(true);
    for (const a of ["rummage", "toss", "hold"] as const) expect(r.anims).toContain(a);
    expect(r.carried).toBe("grapes");
    expect([...r.puffs]).toContain("crumb");
    expect(r.sank).toBeLessThanOrEqual(1);
    // Eaten up by the end: nothing is left in its hands.
    expect(r.cat.mess.props.some((p) => p.own && p.state === "carried")).toBe(false);
  });

  it("the rabbit binkies (a twist in the air), thumps (a thud you can see), flops over and nibbles a window", async () => {
    expect((await play("clover", "binky")).anims).toContain("binky_air");
    const thump = await play("clover", "thump");
    expect(thump.anims).toContain("thump");
    expect([...thump.puffs]).toContain("impact");
    expect((await play("clover", "flop")).anims).toContain("flop");
    const w = makeWorld({ nowMs: T0 }).windows[0]!.id;
    const nib = await play("clover", "nibble", 60, w);
    expect(nib.anims).toContain("nibble");
    expect(nib.decals).toContain("bite");
  });

  it("the squirrel digs up a nut, eats it sitting up, stuffs its cheeks and leaves the shells", async () => {
    const r = await play("hazel", "nut");
    expect(r.carried).toBe("acorn");
    expect(r.anims.indexOf("cheeks")).toBeGreaterThan(r.anims.indexOf("nut"));
    expect(r.spots).toContain("shells");
    expect(r.cat.mess.props.some((p) => p.own && p.state === "carried")).toBe(false);
  });

  it("the squirrel goes down the side of a window head first, holds on, and climbs back up", async () => {
    const tall = makeWorld({ nowMs: T0 }).windows.find((x) => x.bounds.h > 300)!;
    const r = await play("hazel", "cling", 60, tall.id);
    expect(r.modes).toContain("cling");
    expect(r.anims).toContain("cling");
    expect(r.anims).toContain("cling_down");
  });

  it("a click gets reactions only that animal has", () => {
    const seen: Record<string, Set<string>> = {};
    for (const animal of ["dog", "fox", "raccoon", "rabbit", "squirrel", "chihuahua"]) {
      const s = (seen[animal] = new Set<string>());
      const kind = animal === "chihuahua" ? "dog" : animal;
      for (let lv = 0; lv <= 3; lv++)
        for (let k = 0; k < 200; k++) {
          const r = pokeReaction({ kind: kind as never, animal: animal === "chihuahua" ? "chihuahua" : undefined, level: lv, trust: 70, energy: 0.8, pokes: 1, asleep: false, rng: seeded(k * 7 + lv) });
          for (const b of r.script) if ("do" in b) s.add(b.do);
        }
    }
    expect(seen.dog).toContain("wag");
    expect(seen.dog).toContain("shake_off");
    expect(seen.chihuahua).toContain("paw_up");
    expect(seen.chihuahua).toContain("shiver");
    expect(seen.fox).toContain("listen");
    expect(seen.raccoon).toContain("wash_hands");
    expect(seen.raccoon).toContain("inspect");
    expect(seen.rabbit).toContain("thump");
    expect(seen.rabbit).toContain("flop");
    expect(seen.squirrel).toContain("flick");
  });
});
