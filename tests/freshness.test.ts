import { describe, expect, it } from "vitest";
import { Habits } from "../src/core/habits";
import { InMemoryMemory } from "../src/core/memory";
import { seeded } from "../src/core/rng";
import { mean, simulate } from "../tools/month-sim";

const T = Date.UTC(2026, 10, 2, 10, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

describe("liked and disliked, with forgetting", () => {
  it("a liked choice goes up, a shooed one goes down, and both fade over weeks", () => {
    const h = new Habits();
    for (let i = 0; i < 4; i++) h.reward("knead", T + i * MIN);
    for (let i = 0; i < 4; i++) h.punish("meow", T + i * MIN);
    expect(h.liking("knead", T + 5 * MIN)).toBeGreaterThan(1.3);
    expect(h.liking("meow", T + 5 * MIN)).toBeLessThan(0.7);
    // Two months on, most of it is forgotten.
    expect(h.liking("knead", T + 60 * DAY)).toBeLessThan(1.1);
    expect(h.liking("meow", T + 60 * DAY)).toBeGreaterThan(0.9);
  });

  it("draws a guess from what it learned, so a liked thing isn't always top", () => {
    const h = new Habits();
    h.reward("roll", T);
    h.reward("roll", T);
    const rng = seeded(3);
    const draws = Array.from({ length: 400 }, () => h.liking("roll", T, rng));
    const avg = draws.reduce((s, v) => s + v, 0) / draws.length;
    expect(Math.min(...draws)).toBeLessThan(1);
    expect(Math.max(...draws)).toBeGreaterThan(1.4);
    expect(avg).toBeGreaterThan(1.05);
    // Nothing learned yet: no dice, exactly neutral.
    expect(h.liking("tour", T, rng)).toBe(1);
  });
});

describe("boredom and curiosity", () => {
  it("doing the same thing over and over makes it stale, and that wears off in a few hours", () => {
    const h = new Habits();
    for (let i = 0; i < 5; i++) h.used("zoomies", T + i * 5 * MIN);
    const now = T + 25 * MIN;
    expect(h.freshness("zoomies", now)).toBeLessThan(0.4);
    expect(h.freshness("zoomies", now + 6 * 60 * MIN)).toBeGreaterThan(0.85);
  });

  it("a cat is never bored of sleeping", () => {
    const h = new Habits();
    for (let i = 0; i < 6; i++) h.used("nap", T + i * 10 * MIN);
    expect(h.freshness("nap", T + 60 * MIN)).toBeGreaterThan(0.85);
  });

  it("something it has never done is interesting, something it does daily isn't", () => {
    const h = new Habits();
    // A few days of life: a hundred and twenty choices, a quarter of them perching.
    const usual = ["perch", "watch", "tour", "sniff"];
    for (let i = 0; i < 120; i++) h.used(usual[i % 4]!, T + i * 45 * MIN);
    const now = T + 4 * DAY;
    expect(h.curiosity("gift", now)).toBeGreaterThan(1.4);
    expect(h.curiosity("perch", now)).toBeLessThan(1.1);
    expect(h.multiplier("gift", now)).toBeGreaterThan(h.multiplier("perch", now));
    // Two weeks without it and it is half new again.
    expect(h.curiosity("perch", now + 21 * DAY)).toBeGreaterThan(1.15);
  });

  it("a newcomer has done nothing yet, so nothing stands out", () => {
    const h = new Habits();
    expect(h.curiosity("gift", T)).toBe(1);
  });

  it("tells the model what it likes and what it's bored of", () => {
    const h = new Habits();
    h.reward("headbutt", T);
    h.reward("headbutt", T + MIN);
    for (let i = 0; i < 6; i++) h.used("swat", T + i * MIN);
    expect(h.line(T + 10 * MIN)).toBe("habits: likes headbutt; bored of swat");
  });
});

describe("saving", () => {
  it("round-trips with the memory, and forgetting wipes it", () => {
    const m = new InMemoryMemory();
    m.habits.reward("knead", T);
    m.habits.used("knead", T);
    const m2 = new InMemoryMemory();
    m2.loadJson(m.exportJson());
    expect(m2.habits.liking("knead", T)).toBeCloseTo(m.habits.liking("knead", T), 5);
    expect(m2.habits.freshness("knead", T)).toBeCloseTo(m.habits.freshness("knead", T), 5);
    m2.forgetAll();
    expect(m2.habits.multiplier("knead", T)).toBeCloseTo(m2.habits.multiplier("tour", T), 5);
  });

  it("reads the old counter and starts forgetting it from then on", () => {
    const m = new InMemoryMemory();
    m.loadJson(JSON.stringify({ events: [], habits: { liked: { knead: 5 }, disliked: { meow: 3 } } }));
    expect(m.habits.liking("knead", T)).toBeGreaterThan(1.3);
    expect(m.habits.liking("meow", T)).toBeLessThan(0.9);
    expect(m.habits.liking("knead", T + 90 * DAY)).toBeLessThan(1.05);
  });

  it("ignores junk in the file", () => {
    const h = new Habits();
    h.load({ actions: { a: { a: Number.NaN, b: -4, n: 1e9, s: "x" as never, t: 5 } } } as never);
    expect(Number.isFinite(h.multiplier("a", T))).toBe(true);
  });
});

describe("a month with a made-up human", () => {
  it("keeps doing different things, never twice in a row, and learns what the human likes", async () => {
    const on = await simulate({ days: 6, seed: 5, step: 3 });
    const off = await simulate({ days: 6, seed: 5, step: 3, learning: false });
    expect(mean(on.days, "distinct")).toBeGreaterThan(20);
    expect(mean(on.days, "repeats")).toBeLessThan(0.02);
    expect(mean(on.days, "topShare")).toBeLessThan(0.3);
    // Variety doesn't collapse as it learns.
    expect(on.days[5]!.distinct).toBeGreaterThan(on.days[0]!.distinct * 0.75);
    const late = on.days.slice(-2);
    expect(mean(late, "liked")).toBeGreaterThan(mean(on.days.slice(0, 1), "liked"));
    expect(mean(late, "liked")).toBeGreaterThan(mean(off.days.slice(-2), "liked"));
    expect(mean(late, "hated")).toBeLessThanOrEqual(mean(off.days.slice(-2), "hated"));
  }, 60_000);
});
