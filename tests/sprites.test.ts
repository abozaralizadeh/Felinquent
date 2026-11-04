import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/core/characters";
import { GAIT_STRIDE } from "../src/playground/gaits";
import { groomShot, LICK_HZ, lengthOf, planFor, SCRATCH_HZ, scratchProgram, scratchShot, SPRITE_KEYS, turnShot, type Shot } from "../src/playground/sprites";
import { TURN_SEC, type Anim } from "../src/core/executor";
import { SCRATCH_SEC } from "../src/core/scenes";

const DIR = join(__dirname, "..", "src", "playground", "public", "sprites");

describe("sprite art", () => {
  it("has every frame for every character (a missing one would fall back to the old art)", () => {
    const missing: string[] = [];
    for (const c of CHARACTERS) for (const k of SPRITE_KEYS) if (!existsSync(join(DIR, c.id, `${k}.webp`))) missing.push(`${c.id}/${k}`);
    expect(missing).toEqual([]);
  });

  it("every animation picks a frame that exists", () => {
    const anims: Anim[] = ["idle_sit", "loaf", "sleep", "walk", "run", "jump", "fall", "land", "perch", "groom", "stretch", "look", "meow", "purr", "swat", "pounce", "headbutt", "sulk", "dangle", "turn_away", "stare", "blink", "keyboard", "hairball", "box", "push_toy", "gift", "peek", "chase_tail", "knead", "chatter", "sneeze", "happy", "angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark", "shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled", "proud", "curious", "love", "yawn", "surprise", "dazed", "scratch", "bounce"];
    for (const a of anims)
      for (let t = 0; t < 200; t += 0.37) {
        const p = planFor(a, t, 0, (t / 3) % 1);
        expect(SPRITE_KEYS, a).toContain(p.key);
        if (p.next) expect(SPRITE_KEYS, a).toContain(p.next);
      }
  });

  it("the programs (washing, the ear scratch, turning round) only use frames that exist", () => {
    const seen = (s: Shot): void => {
      expect(SPRITE_KEYS).toContain(s.key);
      if (s.next) expect(SPRITE_KEYS).toContain(s.next);
    };
    for (const c of CHARACTERS) for (let e = 0; e < 120; e += 0.05) seen(groomShot(c.id, e, 0.37));
    for (let e = 0; e < SCRATCH_SEC + 1; e += 0.02) seen(scratchShot(e, 0.61));
    for (let u = 0; u <= 1; u += 0.01) (seen(turnShot("stand", u)), seen(turnShot("sit", u)));
  });

  it("walking, trotting and running are rigged gaits with a full set of frames", () => {
    const keys = (a: Anim, trot = false) => new Set(Array.from({ length: 400 }, (_, i) => planFor(a, 0, 0, i / 400, trot).key));
    const walk = keys("walk");
    const trot = keys("walk", true);
    const run = keys("run");
    expect(walk.size).toBe(32);
    expect(trot.size).toBe(24);
    expect(run.size).toBe(20);
    expect([...walk].every((k) => /^gw\d\d$/.test(k))).toBe(true);
    expect([...trot].every((k) => /^gt\d\d$/.test(k))).toBe(true);
    expect([...run].every((k) => /^gr\d\d$/.test(k))).toBe(true);
  });

  it("every character has a stride for each gait, so the feet do not slide", () => {
    for (const c of CHARACTERS) {
      const s = GAIT_STRIDE[c.id];
      expect(s, c.id).toBeDefined();
      // A planted foot moves further per cycle the faster the gait.
      expect(s!.walk).toBeGreaterThan(40);
      expect(s!.trot).toBeGreaterThan(s!.walk);
      expect(s!.run).toBeGreaterThan(s!.trot);
    }
  });

  it("walking and spinning are real cycles, not one frame", () => {
    const keys = (a: Anim) => new Set(Array.from({ length: 40 }, (_, i) => planFor(a, i * 0.1, 0, (i % 10) / 10).key));
    expect(keys("walk").size).toBeGreaterThanOrEqual(6);
    expect(keys("run").size).toBeGreaterThanOrEqual(5);
    expect(keys("chase_tail").size).toBeGreaterThanOrEqual(6);
  });
});

/** The body region a groom frame shows (1 to 9: the drawing it was made from), or 0. */
const region = (k: string): number => Number(/^groom(\d)/.exec(k)?.[1] ?? 0);

/** The regions a wash goes through, in order, each with how long it stayed there. */
function regions(id: string, seed: number, sec: number): { r: number; sec: number }[] {
  const out: { r: number; sec: number }[] = [];
  const dt = 0.02;
  for (let e = 0; e < sec; e += dt) {
    const r = region(groomShot(id, e, seed).key);
    const last = out[out.length - 1];
    if (last && last.r === r) last.sec += dt;
    else out.push({ r, sec: dt });
  }
  return out;
}

describe("washing", () => {
  const seeds = [0.11, 0.37, 0.52, 0.8, 0.93];

  it("goes head first and down the body, a part at a time, never back and forth", () => {
    for (const c of CHARACTERS)
      for (const seed of seeds) {
        const order = regions(c.id, seed, 60).map((x) => x.r).join(" ");
        // A bout: paw to mouth, paw licks, wipes over the ear and down the cheek (back to the paw
        // between them), the nose, the chest, a hind leg, a content blink. Then the next bout.
        const bout = "1 2( 3 4 5( 2)?)* 6 7 8 9";
        expect(order, `${c.id} ${seed}: ${order}`).toMatch(new RegExp(`^${bout}( 1 2( 3 4 5( 2)?)* 6 7 8 9)*( 1( 2( 3( 4( 5( 2)?)?)?)?)?)*`));
      }
  });

  it("stays on the paw, the chest and the leg for a few licks each", () => {
    for (const c of CHARACTERS)
      for (const seed of seeds) {
        const parts = regions(c.id, seed, 40);
        const firstOf = (r: number): number => parts.find((x) => x.r === r)?.sec ?? 0;
        expect(firstOf(2), `${c.id} paw`).toBeGreaterThan(1.8);
        expect(firstOf(8), `${c.id} leg`).toBeGreaterThan(1.8);
      }
  });

  it("licks at about the rate cats do", () => {
    // Count the deepest point of each nod while licking the paw, over the first ten seconds.
    for (const seed of seeds) {
      let licks = 0;
      let lickSec = 0;
      let was = "";
      for (let e = 0; e < 10; e += 0.01) {
        const s = groomShot("tabby", e, seed);
        if (/^groom[2678]n/.test(s.key) || /^groom[2678]n/.test(s.next ?? "")) lickSec += 0.01;
        const deep = s.key === "groom2n3" || s.key === "groom7n3" || s.key === "groom8n3" || s.key === "groom6n3";
        if (deep && was !== s.key) licks++;
        was = s.key;
      }
      const rate = licks / lickSec;
      expect(rate).toBeGreaterThan(LICK_HZ * 0.7);
      expect(rate).toBeLessThan(LICK_HZ * 2.2);
    }
  });

  it("the puppy licks its paw but never wipes its face with it", () => {
    for (const seed of seeds) {
      const seen = new Set(regions("biscuit", seed, 60).map((x) => x.r));
      for (const r of [3, 4, 5]) expect(seen.has(r)).toBe(false);
      expect(seen.has(2) && seen.has(8)).toBe(true);
    }
  });
});

describe("the ear scratch", () => {
  it("fits in the time the executor holds it", () => {
    for (let i = 0; i < 40; i++) {
      const len = lengthOf(scratchProgram(i / 40));
      expect(len).toBeLessThanOrEqual(SCRATCH_SEC);
      expect(len).toBeGreaterThan(SCRATCH_SEC - 0.6);
    }
  });

  it("strokes at 4 to 8 a second, about a dozen of them, like the scratch reflex", () => {
    expect(SCRATCH_HZ).toBeGreaterThan(4);
    for (let i = 0; i < 20; i++) {
      const seed = i / 20;
      let strokes = 0;
      let first = -1;
      let last = -1;
      let was = "";
      for (let e = 0; e < SCRATCH_SEC; e += 0.005) {
        const k = scratchShot(e, seed).key;
        // The paw at its lowest is scratch5: each stroke passes it once.
        if (k === "scratch5" && was !== "scratch5") {
          strokes++;
          if (first < 0) first = e;
          last = e;
        }
        was = k;
      }
      const hz = (strokes - 1) / (last - first);
      expect(hz, `seed ${seed}`).toBeGreaterThan(4);
      expect(hz, `seed ${seed}`).toBeLessThan(8);
      expect(strokes).toBeGreaterThanOrEqual(9);
      expect(strokes).toBeLessThanOrEqual(16);
    }
  });

  it("begins with the head tilting and ends sitting content", () => {
    expect(scratchShot(0, 0.5).key).toBe("scratch1");
    expect(scratchShot(SCRATCH_SEC, 0.5).key).toBe("scratch9");
  });
});

describe("turning round", () => {
  it("takes about half a second, like a real cat, the same in the executor and the drawing", () => {
    expect(TURN_SEC).toBeGreaterThanOrEqual(0.4);
    expect(TURN_SEC).toBeLessThanOrEqual(0.8);
  });

  it("goes from the side view through the front to the mirrored side, which is the same drawing facing the other way", () => {
    for (const kind of ["stand", "sit"] as const) {
      const t = kind === "stand" ? "turn_s" : "turn_t";
      expect(turnShot(kind, 0).key).toBe(kind);
      expect(turnShot(kind, 1).key).toBe(`${t}5`);
      // Stepped, never two drawings over each other: a blend of the front and the far side looks see-through.
      const shots = Array.from({ length: 101 }, (_, i) => turnShot(kind, i / 100));
      for (const s of shots) expect(s.next).toBeNull();
      const order = shots.map((s) => s.key).filter((k, i, all) => k !== all[i - 1]);
      for (const k of [`${t}1`, `${t}2`, `${t}3`, `${t}4`]) expect(order).toContain(k);
      expect(order.indexOf(`${t}3`)).toBeGreaterThan(order.indexOf(`${t}1`));
      expect(new Set(order).size).toBe(order.length);
      expect(order.length).toBeGreaterThanOrEqual(8);
    }
  });
});
