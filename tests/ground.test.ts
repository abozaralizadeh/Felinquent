import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/core/characters";
import { GROUND } from "../src/playground/ground";
import { groundOf, SPRITE_KEYS } from "../src/playground/sprites";

const DIR = join(__dirname, "..", "src", "playground", "public", "sprites");

describe("paws on the ground (a tail lower than the paws)", () => {
  it("every measured frame exists, for every character", () => {
    const keys = new Set<string>(SPRITE_KEYS);
    const bad: string[] = [];
    for (const c of CHARACTERS) {
      expect(GROUND[c.id], c.id).toBeDefined();
      for (const k of Object.keys(GROUND[c.id] ?? {})) if (!keys.has(k) || !existsSync(join(DIR, c.id, `${k}.webp`))) bad.push(`${c.id}/${k}`);
    }
    expect(bad).toEqual([]);
  });

  it("a sitting cat whose tail curls round in front stands on its paws, not on the tail tip", () => {
    for (const id of ["tabby", "mochi", "pearl", "inky", "bandit"]) expect(groundOf(id, "sit"), id).toBeGreaterThan(8);
  });

  it("sitting on a ledge, the seat is on the edge and the tail hangs over it", () => {
    for (const c of CHARACTERS) expect(groundOf(c.id, "perch_fwd"), c.id).toBeGreaterThan(40);
  });

  it("an in-between is between its two drawings, so the body doesn't jump", () => {
    for (const c of CHARACTERS) {
      const a = groundOf(c.id, "perch_fwd");
      const b = groundOf(c.id, "perch_back");
      const m = groundOf(c.id, "perch_fwdt2");
      expect(m, c.id).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
      expect(m, c.id).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
      // A lick nod keeps its drawing's ground.
      expect(groundOf(c.id, "lick1n3"), c.id).toBe(groundOf(c.id, "lick1"));
    }
  });

  it("jumps, falls, hops and the walk stay on their bottom edge", () => {
    for (const c of CHARACTERS) for (const k of ["jump", "fall", "binky", "dangle", "peek", "run1", "gw03", "stand"]) expect(groundOf(c.id, k), `${c.id}/${k}`).toBe(0);
  });
});
