import { describe, expect, it } from "vitest";
import { applyEvent, deriveMood, initialNeeds, stepNeeds } from "../src/core/needs";
import { ARCHETYPES, DEFAULT_PERSONALITY } from "../src/core/personality";

const env = { sleeping: false, moving: false, newWindows: 0, personality: DEFAULT_PERSONALITY, sinceShooSec: 1e9, sincePetSec: 1e9 };

describe("needs", () => {
  it("drains energy awake (faster when moving) and restores it asleep", () => {
    const n = initialNeeds();
    const still = stepNeeds(n, 600, env);
    const moving = stepNeeds(n, 600, { ...env, moving: true });
    const asleep = stepNeeds({ ...n, energy: 0.3 }, 600, { ...env, sleeping: true });
    expect(still.energy).toBeLessThan(n.energy);
    expect(moving.energy).toBeLessThan(still.energy);
    expect(asleep.energy).toBeGreaterThan(0.3);
  });

  it("restores energy more slowly than it drains, so about 70% of the day is sleep", () => {
    // awake drain 0.55 energy at laziness .5 in ~49 min, sleep restore 0.55 in ~1.9 h
    let n = { ...initialNeeds(), energy: 0.85 };
    let awakeSec = 0;
    while (n.energy > 0.3) {
      n = stepNeeds(n, 10, env);
      awakeSec += 10;
    }
    let sleepSec = 0;
    while (n.energy < 0.85) {
      n = stepNeeds(n, 10, { ...env, sleeping: true });
      sleepSec += 10;
    }
    const asleep = sleepSec / (sleepSec + awakeSec);
    expect(asleep).toBeGreaterThan(0.65);
    expect(asleep).toBeLessThan(0.78);
  });

  it("builds attention need while awake, faster for a needy cat, and not while asleep", () => {
    const base = initialNeeds();
    const normal = stepNeeds(base, 1800, env);
    const needy = stepNeeds(base, 1800, { ...env, personality: ARCHETYPES.shadow! });
    const aloof = stepNeeds(base, 1800, { ...env, personality: ARCHETYPES.loaf! });
    expect(normal.attention).toBeGreaterThan(base.attention);
    expect(needy.attention).toBeGreaterThan(aloof.attention);
    expect(stepNeeds(base, 1800, { ...env, sleeping: true }).attention).toBe(base.attention);
  });

  it("raises curiosity when a new window shows up", () => {
    const calm = stepNeeds(initialNeeds(), 1, env);
    const nosy = stepNeeds(initialNeeds(), 1, { ...env, newWindows: 1 });
    expect(nosy.curiosity).toBeGreaterThan(calm.curiosity + 0.2);
  });

  it("keeps every need inside its range", () => {
    let n = initialNeeds();
    for (let i = 0; i < 5000; i++) n = stepNeeds(n, 60, env);
    expect(n.energy).toBeGreaterThanOrEqual(0);
    expect(n.attention).toBeLessThanOrEqual(1);
    let t = initialNeeds();
    for (let i = 0; i < 100; i++) t = applyEvent(t, "treat");
    expect(t.trust).toBe(100);
    for (let i = 0; i < 100; i++) t = applyEvent(t, "shoo");
    expect(t.trust).toBe(0);
  });

  it("reacts to events: petting and treats calm it, shooing and throwing cost trust", () => {
    const n = { ...initialNeeds(), attention: 0.8, trust: 50 };
    expect(applyEvent(n, "pet").attention).toBeCloseTo(0.3, 5);
    expect(applyEvent(n, "pet").trust).toBeGreaterThan(50);
    expect(applyEvent(n, "treat").trust).toBeGreaterThan(applyEvent(n, "pet").trust);
    expect(applyEvent(n, "shoo").trust).toBeLessThan(50);
    expect(applyEvent(n, "throw").trust).toBeLessThan(50);
    expect(applyEvent(n, "overpet").trust).toBeLessThan(50);
  });

  it("derives moods in priority order", () => {
    const n = initialNeeds();
    const quiet = { sinceShooSec: 1e9, sincePetSec: 1e9 };
    expect(deriveMood(n, { ...quiet, sinceShooSec: 60 })).toBe("sulky");
    expect(deriveMood({ ...n, energy: 0.1 }, quiet)).toBe("sleepy");
    expect(deriveMood({ ...n, attention: 0.9 }, quiet)).toBe("grumpy");
    expect(deriveMood({ ...n, trust: 80, attention: 0.6 }, quiet)).toBe("smug");
    expect(deriveMood({ ...n, trust: 60 }, { ...quiet, sincePetSec: 60 })).toBe("content");
    expect(deriveMood({ ...n, energy: 0.9, curiosity: 0.8 }, quiet)).toBe("playful");
    expect(deriveMood({ ...n, energy: 0.5, curiosity: 0.8 }, quiet)).toBe("curious");
  });
});
