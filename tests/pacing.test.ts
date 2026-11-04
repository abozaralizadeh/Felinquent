import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { CHARACTERS } from "../src/core/characters";
import { Executor, type Beat } from "../src/core/executor";
import { characterById } from "../src/core/characters";
import { pokeReaction } from "../src/core/reactions";
import { seeded } from "../src/core/rng";
import { sceneFor } from "../src/core/scenes";
import type { Kind } from "../src/core/species";
import type { IntentName } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { LOOKS, planFor } from "../src/playground/sprites";
import { T0, at, newCat } from "./helpers";

const FLINCH = ["surprise", "startled", "puffed", "swat"];
const CALM_END = ["turn_away", "sulk", "sprawl", "groom", "blink", "idle_sit", "yawn", "loaf", "sleep"];
const SCENES: IntentName[] = ["roll", "bounce", "sniff", "dig", "howl", "scratch", "beg", "spook", "sprawl", "tumble", "shy"];

function checkPace(script: Beat[], label: string): void {
  for (const b of script) {
    if (!("do" in b)) continue;
    expect(b.sec, `${label}: ${b.do} is held long enough to read`).toBeGreaterThanOrEqual(FLINCH.includes(b.do) ? 0.6 : 1.1);
  }
  const last = script[script.length - 1];
  expect(last && "do" in last && CALM_END.includes(last.do), `${label} ends calm`).toBe(true);
}

describe("pace: one thing at a time, at an animal's speed", () => {
  it("every scene holds its poses and ends calm", () => {
    for (const intent of SCENES) for (let s = 1; s <= 10; s++) checkPace(sceneFor(intent, 20, seeded(s)) ?? [], intent);
  });

  it("every reaction to a poke holds its poses and ends calm", () => {
    for (const kind of ["cat", "dog", "fox", "raccoon"] as Kind[]) {
      for (let level = 0; level <= 3; level++) {
        for (let s = 1; s <= 12; s++) {
          const r = pokeReaction({ kind, level, trust: s * 8, energy: (s % 4) / 3, pokes: level + 1, asleep: s === 1, rng: seeded(s) });
          checkPace(r.script, `${kind} ${level} ${r.name}`);
        }
      }
    }
  });

  /** Gaps in ms between an action ending and the next one being chosen (naps left out: waking up acts at once). */
  async function restGaps(id: string, seed: number, want: number): Promise<number[]> {
    const base = makeWorld({ nowMs: T0 });
    const { cat } = newCat({ rng: seeded(seed), personality: characterById(id).personality, minDecisionGapMs: undefined }, base);
    const gaps: number[] = [];
    let ms = T0;
    let last: IntentName | null = null;
    let doneAt: number | null = null;
    for (let i = 0; i < 2 * 60 * 60 * 10 && gaps.length < want; i++) {
      ms += 100;
      cat.mind.needs.energy = 1;
      const res = await cat.step(at(base, ms), 0.1);
      const picked = res.mind.find((e) => e.type === "intent");
      if (picked && picked.type === "intent") {
        if (doneAt !== null) gaps.push(ms - doneAt);
        doneAt = null;
        last = picked.intent.intent;
      }
      const cur = cat.mind.current;
      if (cur === null && last !== null && !["nap", "nap_warm", "cozy"].includes(last) && doneAt === null) doneAt = ms;
      if (cur === null) last = null;
    }
    return gaps;
  }

  it("after an action ends the animal rests a while before it chooses the next one", async () => {
    const gaps = await restGaps("tabby", 4, 5);
    expect(gaps.length).toBe(5);
    // A cat at the default chaos level rests at least 8 s (times its species gap and laziness).
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(8_000);
  });

  it("a dog rests less than a cat", async () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(mean(await restGaps("biscuit", 9, 8))).toBeLessThan(mean(await restGaps("tabby", 9, 8)));
  });

  it("a one-off move is done once, then it sits for the rest of its stay", () => {
    const ex = new Executor(seeded(3));
    ex.placeOnDock(makeWorld(), 200);
    ex.start({ intent: "stretch", target: "here", approach: "walk", stay_sec: 30, mood: "content" });
    let stretching = 0;
    for (let i = 0; i < 60 * 40 && ex.phase !== "idle"; i++) {
      ex.update(1 / 60);
      if (ex.body.anim === "stretch") stretching += 1 / 60;
    }
    expect(stretching).toBeGreaterThan(2.5);
    expect(stretching).toBeLessThan(3.6);
  });

  it("no shuffles: every walk lasts long enough to be a walk", async () => {
    for (const id of ["tabby", "biscuit", "mochi"]) {
      const c = CHARACTERS.find((x) => x.id === id)!;
      const world = makeWorld({ nowMs: T0 });
      const cat = new Cat({ rng: seeded(5), personality: c.personality, settings: { chaos: "normal" } });
      cat.place(world, 600);
      let anim = "";
      let since = 0;
      const walks: number[] = [];
      for (let i = 0; i < 15 * 60 * 10; i++) {
        await cat.step(at(world, T0 + i * 100), 0.1);
        const a = cat.executor.body.anim;
        if (a !== anim) {
          if (anim === "walk" || anim === "run") walks.push((i - since) / 10);
          anim = a;
          since = i;
        }
      }
      expect(walks.length, id).toBeGreaterThan(1);
      expect(Math.min(...walks), `${id}: shortest walk`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("a sitting cat is calm: about four blinks a minute and a look about every 45 s, held for 3 s", () => {
    let blinks = 0;
    let looks = 0;
    let prev = "sit";
    let lookStart = 0;
    const holds: number[] = [];
    const minutes = 60;
    for (let i = 0; i < minutes * 60 * 50; i++) {
      const t = i / 50;
      const k = planFor("idle_sit", t).key;
      // Only blinks and the held looks count here (a slow blink at you turns through other frames).
      if (k !== prev && (k === "blink" || k === "sit" || LOOKS.has(k))) {
        if (k === "blink") blinks++;
        if (LOOKS.has(k)) (looks++, (lookStart = t));
        if (LOOKS.has(prev as never)) holds.push(t - lookStart);
        prev = k;
      }
    }
    expect(blinks / minutes).toBeGreaterThan(2.5);
    expect(blinks / minutes).toBeLessThan(7);
    expect(looks / minutes).toBeGreaterThan(0.6);
    expect(looks / minutes).toBeLessThan(2);
    expect(Math.min(...holds)).toBeGreaterThan(2.9);
  });
});
