import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CHARACTERS, characterById, DEFAULT_CHARACTER_ID } from "../src/core/characters";
import { Cat } from "../src/core/cat";
import { seeded } from "../src/core/rng";
import { makeWorld } from "../src/core/world";
import { buildSystemPrompt } from "../src/core/summary";

describe("characters", () => {
  it("has unique ids, a default, and falls back to the default for an unknown id", () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_CHARACTER_ID);
    expect(characterById("nope").id).toBe(DEFAULT_CHARACTER_ID);
    expect(characterById(undefined).id).toBe(DEFAULT_CHARACTER_ID);
  });

  it("has at least four species and valid traits and colors", () => {
    expect(new Set(CHARACTERS.map((c) => c.species)).size).toBeGreaterThanOrEqual(4);
    for (const c of CHARACTERS) {
      for (const k of ["laziness", "neediness", "chaos", "aloofness", "curiosity"] as const) {
        expect(c.personality[k], `${c.id} ${k}`).toBeGreaterThanOrEqual(0);
        expect(c.personality[k], `${c.id} ${k}`).toBeLessThanOrEqual(1);
      }
      for (const [k, v] of Object.entries(c.palette)) expect(v, `${c.id} ${k}`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.size).toBeGreaterThan(0.8);
      expect(c.size).toBeLessThan(1.3);
      // Voice lines obey the same limits as model thoughts: short, no links.
      for (const lines of Object.values(c.personality.voice ?? {})) for (const l of lines ?? []) {
        expect(l.length).toBeLessThanOrEqual(80);
        expect(l).not.toMatch(/https?:|www\./);
      }
    }
  });

  it("the model prompt names the character and says it is an animal, not an assistant", () => {
    const fox = characterById("mochi").personality;
    const prompt = buildSystemPrompt(fox, 50);
    expect(prompt).toContain("fox called Mochi");
    expect(prompt).toContain("not an assistant");
  });

  it("every character lives a normal simulated hour, and different characters behave differently", async () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const c of CHARACTERS) {
      const cat = new Cat({ rng: seeded(11), personality: c.personality, minDecisionGapMs: 20_000 });
      let world = makeWorld();
      cat.place(world, 200);
      const seen: Record<string, number> = {};
      for (let i = 0; i < 3 * 3600; i++) {
        world = { ...world, nowMs: world.nowMs + 1000 };
        const r = await cat.step(world, 1);
        for (const ev of r.mind) if (ev.type === "intent") seen[ev.intent.intent] = (seen[ev.intent.intent] ?? 0) + 1;
      }
      counts[c.id] = seen;
      expect(Object.keys(seen).length, c.id).toBeGreaterThan(2);
    }
    // The needy puppy asks for attention more than the aloof white cat.
    const needy = (id: string) => (counts[id]?.follow ?? 0) + (counts[id]?.meow ?? 0) + (counts[id]?.headbutt ?? 0) + (counts[id]?.cross ?? 0);
    expect(needy("biscuit")).toBeGreaterThanOrEqual(needy("pearl"));
    // Nine animals, three hours each: several seconds, more on a busy machine.
  }, 60_000);

  it("the Mac menu lists every character (the Rust list and the TypeScript list must match)", () => {
    const rust = fs.readFileSync("src-tauri/src/main.rs", "utf8");
    for (const c of CHARACTERS) expect(rust, c.id).toContain(`"character:${c.id}"`);
  });
});
