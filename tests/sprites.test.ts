import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/core/characters";
import { GAIT_STRIDE } from "../src/playground/gaits";
import { planFor, SPRITE_KEYS } from "../src/playground/sprites";
import type { Anim } from "../src/core/executor";

const DIR = join(__dirname, "..", "src", "playground", "public", "sprites");

describe("sprite art", () => {
  it("has every frame for every character (a missing one would fall back to the old art)", () => {
    const missing: string[] = [];
    for (const c of CHARACTERS) for (const k of SPRITE_KEYS) if (!existsSync(join(DIR, c.id, `${k}.webp`))) missing.push(`${c.id}/${k}`);
    expect(missing).toEqual([]);
  });

  it("every animation picks a frame that exists", () => {
    const anims: Anim[] = ["idle_sit", "loaf", "sleep", "walk", "run", "jump", "fall", "land", "perch", "groom", "stretch", "look", "meow", "purr", "swat", "pounce", "headbutt", "sulk", "dangle", "turn_away", "stare", "blink", "keyboard", "hairball", "box", "push_toy", "gift", "peek", "chase_tail", "knead", "chatter", "sneeze", "happy", "angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark", "shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled", "proud", "curious", "love", "yawn", "surprise", "dazed", "scratch", "bounce"];
    for (const a of anims) for (let t = 0; t < 60; t += 0.37) expect(SPRITE_KEYS, a).toContain(planFor(a, t, 0, (t / 3) % 1).key);
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

  it("walking and grooming are real cycles, not one frame", () => {
    const keys = (a: Anim) => new Set(Array.from({ length: 40 }, (_, i) => planFor(a, i * 0.1, 0, (i % 10) / 10).key));
    expect(keys("walk").size).toBeGreaterThanOrEqual(6);
    expect(keys("run").size).toBeGreaterThanOrEqual(5);
    expect(keys("groom").size).toBeGreaterThanOrEqual(6);
    expect(keys("chase_tail").size).toBeGreaterThanOrEqual(6);
  });
});
