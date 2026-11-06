import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { InMemoryMemory, generateDiary } from "../src/core/memory";
import type { PointerSample } from "../src/core/reflexes";
import { seeded } from "../src/core/rng";
import { makeWorld } from "../src/core/world";
import { T0, at, newCat } from "./helpers";

async function settle(cat: Cat, world = makeWorld(), secs = 5, start = T0) {
  for (let i = 0; i < secs; i++) await cat.step(at(world, start + i * 1000), 1);
}

describe("reflex reactions in the Mind", () => {
  it("petting calms it down and makes it trust you more", () => {
    const { cat, world } = newCat();
    cat.mind.forceNeeds({ attention: 0.8, trust: 50 });
    cat.mind.onReflex("pet", world);
    expect(cat.mind.needs.attention).toBeCloseTo(0.3, 5);
    expect(cat.mind.needs.trust).toBeGreaterThan(50);
  });

  it("shooing makes it sulk for 3 to 8 minutes, costs trust, and the governor remembers the window", () => {
    const { cat, world } = newCat();
    cat.mind.forceNeeds({ trust: 50 });
    const ev = cat.mind.onReflex("shoo", world, "w1");
    const intent = ev.find((e) => e.type === "intent")!;
    expect(intent).toMatchObject({ intent: { intent: "sulk" }, source: "reflex" });
    if (intent.type === "intent") {
      expect(intent.intent.stay_sec).toBeGreaterThanOrEqual(180);
      expect(intent.intent.stay_sec).toBeLessThanOrEqual(480);
    }
    expect(cat.mind.needs.trust).toBeLessThan(50);
    expect(cat.memory.events().some((e) => e.kind === "shoo" && e.app === "Code")).toBe(true);
    const filtered = cat.governor.filter([{ intent: "sit_on", targets: ["w1"], score: 1 }], at(world, T0 + 60_000), { ...cat.mind.needs, attention: 1 });
    expect(filtered).toEqual([]);
  });

  it("over-petting gets a swat", () => {
    const { cat, world } = newCat();
    const ev = cat.mind.onReflex("overpet", world);
    expect(ev.find((e) => e.type === "intent")).toMatchObject({ intent: { intent: "swat" } });
  });

  it("a call has three outcomes (come, look, ignore) and trust makes it more likely to come", () => {
    const count = (trust: number) => {
      const out: Record<string, number> = {};
      for (let s = 0; s < 300; s++) {
        const { cat, world } = newCat({ rng: seeded(s) });
        cat.mind.forceNeeds({ trust });
        const e = cat.mind.onReflex("call", world).find((x) => x.type === "intent");
        if (e && e.type === "intent") out[e.intent.intent] = (out[e.intent.intent] ?? 0) + 1;
      }
      return out;
    };
    const low = count(5);
    const high = count(95);
    expect(Object.keys(high).sort()).toEqual(["follow", "ignore", "watch"]);
    expect(high.follow!).toBeGreaterThan(low.follow!);
    expect(low.ignore!).toBeGreaterThan(high.ignore!);
  });

  it("after being thrown it lands and washes itself as if it meant to", async () => {
    const { cat, world } = newCat();
    cat.mind.onReflex("throw", world);
    cat.executor.pickUp(600, 300);
    cat.executor.release(0, 0);
    const kinds: string[] = [];
    for (let i = 0; i < 240; i++) {
      const res = await cat.step(at(world, T0 + i * 16), 1 / 60);
      for (const e of res.mind) if (e.type === "intent") kinds.push(e.intent.intent);
      if (kinds.includes("groom")) break;
    }
    expect(kinds).toContain("groom");
  });

  it("does nothing visible during a meeting except note the pet", () => {
    const { cat, world } = newCat();
    const ev = cat.mind.onReflex("shoo", at(world, T0, { inMeeting: true }), "w1");
    expect(ev.filter((e) => e.type === "intent")).toEqual([]);
  });

  it("a treat brings it running and lowers its attention need", () => {
    const { cat, world } = newCat();
    cat.mind.forceNeeds({ attention: 0.8, trust: 40 });
    cat.treat(world);
    expect(cat.mind.needs.attention).toBeCloseTo(0.4, 5);
    expect(cat.mind.current).toMatchObject({ intent: "follow", target: "cursor", approach: "run" });
  });
});

describe("Cat pointer handling", () => {
  it("picks the cat up, carries it, throws it and it lands", async () => {
    const { cat, world } = newCat();
    const r = cat.executor.hitRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const samples: PointerSample[] = [
      { t: 0, x: cx, y: cy, down: false },
      { t: 10, x: cx, y: cy, down: true },
      { t: 40, x: cx + 30, y: cy - 20, down: true },
      { t: 60, x: cx + 120, y: cy - 60, down: true },
      { t: 80, x: cx + 260, y: cy - 90, down: false },
    ];
    const seen: string[] = [];
    for (const s of samples) for (const e of cat.pointer(s, world)) seen.push(e.kind);
    expect(seen).toEqual(["pickup", "throw"]);
    expect(cat.executor.airborne).toBe(true);
    for (let i = 0; i < 600 && cat.executor.airborne; i++) await cat.step(at(world, T0 + i * 16), 1 / 60);
    expect(cat.executor.airborne).toBe(false);
  });

  it("shooing the cat off a window records that window", () => {
    const { cat, world } = newCat();
    cat.executor.start({ intent: "sit_on", target: "w1", approach: "run", stay_sec: 600, mood: "smug" });
    for (let i = 0; i < 1200 && cat.executor.phase !== "doing"; i++) cat.executor.update(1 / 60);
    expect(cat.executor.windowId).toBe("w1");
    const r = cat.executor.hitRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    cat.pointer({ t: 0, x: cx, y: cy, down: true }, world);
    for (let i = 1; i <= 10; i++) cat.pointer({ t: i * 60, x: cx + (i % 2 ? 60 : -60), y: cy, down: true }, world);
    expect(cat.memory.events().some((e) => e.kind === "shoo" && e.app === "Code")).toBe(true);
  });
});

describe("a shooed cat sometimes comes back to the same window", () => {
  it("revisits about half the time, never before 3 minutes", async () => {
    let revisited = 0;
    const trials = 40;
    for (let s = 0; s < trials; s++) {
      const { cat, world } = newCat({ rng: seeded(s + 100), settings: { chaos: "normal" } });
      cat.react("shoo", world, "w1");
      let sitAt: number | null = null;
      for (let i = 0; i < 1500 && sitAt === null; i++) {
        cat.mind.forceNeeds({ attention: 1, energy: 0.9 });
        const res = await cat.step(at(world, T0 + i * 1000), 1);
        for (const e of res.mind) if (e.type === "intent" && e.intent.intent === "sit_on" && e.intent.target === "w1") sitAt = i;
      }
      if (sitAt !== null) {
        revisited += 1;
        expect(sitAt).toBeGreaterThanOrEqual(180);
      }
    }
    expect(revisited).toBeGreaterThan(trials * 0.25);
  }, 60_000);
});

describe("memory and diary", () => {
  it("builds short prompt lines and finds a favourite spot", () => {
    const m = new InMemoryMemory();
    const now = T0 + 3_600_000;
    m.log({ atMs: T0, kind: "sat_on", app: "Word" });
    m.log({ atMs: T0 + 1000, kind: "sat_on", app: "Word" });
    m.log({ atMs: T0 + 2000, kind: "pet" });
    for (let i = 0; i < 3; i++) m.log({ atMs: T0 + 3000 + i, kind: "shoo", app: "Slack" });
    const lines = m.recentLines(5, now).join(" | ");
    expect(lines).toMatch(/petted \d+ min ago/);
    expect(lines).toMatch(/shooed from Slack x3/);
    expect(m.favoriteSpot()).toBe("Word");
  });

  it("forgets after 30 days and on request, and exports JSON", () => {
    const m = new InMemoryMemory();
    m.log({ atMs: T0, kind: "pet" });
    m.log({ atMs: T0 + 31 * 86_400_000, kind: "pet" });
    expect(m.events()).toHaveLength(1);
    expect(JSON.parse(m.exportJson()).events).toHaveLength(1);
    m.forgetAll();
    expect(m.events()).toEqual([]);
  });

  it("writes a diary in the cat's voice, with app names but never titles", () => {
    const m = new InMemoryMemory();
    m.log({ atMs: T0, kind: "sat_on", app: "Word" });
    m.log({ atMs: T0 + 1, kind: "sat_on", app: "Word" });
    m.log({ atMs: T0 + 2, kind: "pet" });
    m.log({ atMs: T0 + 3, kind: "shoo", app: "Code" });
    const day = Date.UTC(2026, 10, 2);
    const lines = generateDiary(m.events(), day, "Mrrlo");
    expect(lines[0]).toBe("dear diary, it's Mrrlo.");
    expect(lines.join(" ")).toMatch(/2 times/);
    expect(lines.join(" ")).toMatch(/unacceptable/);
    expect(lines.length).toBeLessThanOrEqual(4);
    expect(generateDiary([], day, "Mrrlo").join(" ")).toMatch(/nobody petted me/);
  });
});

describe("sleep", () => {
  it("a tired cat falls asleep, stays asleep, and wakes with a stretch", async () => {
    const { cat, world } = newCat();
    cat.mind.forceNeeds({ energy: 0.05 });
    const kinds: string[] = [];
    let woke = false;
    for (let i = 0; i < 4 * 3600 && !woke; i++) {
      const res = await cat.step(at(world, T0 + i * 1000), 1);
      for (const e of res.mind) {
        if (e.type === "intent") kinds.push(e.intent.intent);
        if (e.type === "wake") woke = true;
      }
    }
    // Straight to sleep, or a cozy circle first and then sleep, the way cats do.
    const firstSleep = kinds[0] === "cozy" ? kinds[1] : kinds[0];
    expect(["nap", "nap_warm"]).toContain(firstSleep);
    expect(woke).toBe(true);
    expect(cat.mind.needs.energy).toBeGreaterThanOrEqual(0.85);
  }, 60_000);
});

describe("a held cat", () => {
  it("makes no plans and spends no annoyance points while it is held", async () => {
    const { cat, world } = newCat();
    cat.mind.forceNeeds({ attention: 1, energy: 0.95 });
    cat.executor.pickUp(500, 300);
    const before = cat.governor.budget;
    const intents: string[] = [];
    for (let i = 0; i < 120; i++) {
      const res = await cat.step(at(world, T0 + i * 1000), 1);
      for (const e of res.mind) if (e.type === "intent") intents.push(e.intent.intent);
    }
    expect(intents).toEqual([]);
    expect(cat.governor.budget).toBeGreaterThanOrEqual(before);
    expect(cat.executor.held).toBe(true);
  });
});
