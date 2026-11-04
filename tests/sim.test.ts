import { describe, expect, it } from "vitest";
import { behavior, CHAOS_PARAMS } from "../src/core/behaviors";
import { FakeLlmClient } from "../src/core/brain";
import { T0 } from "./helpers";
import { simulate, worstHour } from "./sim";

const HOUR = 3600;

describe("simulation: a day with the cat (rules brain)", () => {
  it("sleeps about half the day on normal and most of it on chill, with plenty of variety", async () => {
    const normal = await simulate({ hours: 8, seed: 11 });
    const asleep = normal.asleepSec / normal.totalSec;
    expect(asleep).toBeGreaterThan(0.42);
    expect(asleep).toBeLessThan(0.65);
    const kinds = new Set(normal.intents.filter((i) => i.source !== "respect").map((i) => i.intent.intent));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    const chill = await simulate({ hours: 8, seed: 11, settings: { chaos: "chill" } });
    expect(chill.asleepSec / chill.totalSec).toBeGreaterThan(0.62);
    expect(chill.asleepSec / chill.totalSec).toBeLessThan(0.82);
  }, 60_000);

  it("never repeats the same annoying move back to back", async () => {
    const log = await simulate({ hours: 8, seed: 21, settings: { chaos: "normal" } });
    const seq = log.intents.filter((i) => i.source === "rules" || i.source === "llm").map((i) => i.intent.intent);
    for (let i = 1; i < seq.length; i++) {
      if (behavior(seq[i]!).annoy >= 1) expect(seq[i], `at ${i}`).not.toBe(seq[i - 1]);
    }
  }, 60_000);

  it("stays inside the annoyance budget for every chaos level", async () => {
    for (const chaos of ["chill", "normal", "gremlin"] as const) {
      const log = await simulate({
        hours: 6,
        seed: 5,
        settings: { chaos, accessibility: true },
        onTick: (cat) => cat.mind.forceNeeds({ attention: 0.95 }), // an ignored, demanding cat
      });
      const cap = CHAOS_PARAMS[chaos].pointsPerHour;
      // The bucket starts at 60% and holds at most one cap. A cat that has saved up a full bucket can spend it
      // and then the next hour's refill, so a rolling hour holds at most 2 caps.
      expect(worstHour(log), chaos).toBeLessThanOrEqual(cap * 2 + 1);
    }
  }, 120_000);

  it("never blocks longer than the chaos level allows", async () => {
    const log = await simulate({
      hours: 4,
      seed: 3,
      settings: { chaos: "normal" },
      onTick: (cat) => cat.mind.forceNeeds({ attention: 1, energy: Math.max(cat.mind.needs.energy, 0.9) }),
    });
    const closed = log.blocks.filter((b) => b.end !== null);
    expect(closed.length).toBeGreaterThan(0);
    for (const b of closed) expect((b.end! - b.start) / 1000).toBeLessThanOrEqual(CHAOS_PARAMS.normal.maxBlockSec + 5);
  }, 60_000);

  it("is repeatable: the same seed gives the same cat", async () => {
    const a = await simulate({ hours: 2, seed: 99 });
    const b = await simulate({ hours: 2, seed: 99 });
    expect(a.intents.map((i) => i.intent.intent)).toEqual(b.intents.map((i) => i.intent.intent));
  }, 60_000);

  it("a chill cat never blocks anything", async () => {
    const log = await simulate({ hours: 4, seed: 8, settings: { chaos: "chill" }, onTick: (cat) => cat.mind.forceNeeds({ attention: 1 }) });
    expect(log.blocks).toHaveLength(0);
  }, 60_000);
});

describe("simulation: respect modes", () => {
  it("stops blocking within 2 seconds when a meeting starts, and naps in a far corner", async () => {
    const meetingAt = T0 + 40 * 60_000;
    const log = await simulate({
      hours: 1.2,
      seed: 3,
      settings: { chaos: "gremlin" },
      world: (now) => (now >= meetingAt ? { inMeeting: true, cursor: { x: 1300, y: 400 } } : {}),
      onTick: (cat, now) => {
        if (now < meetingAt) cat.mind.forceNeeds({ attention: 1, energy: 0.95 });
      },
    });
    expect(log.blocks.some((b) => b.start < meetingAt)).toBe(true);
    const plan = log.intents.find((i) => i.source === "respect")!;
    expect(plan.intent.intent).toBe("nap");
    expect(plan.intent.target).toBe("corner");
    for (const b of log.blocks) {
      expect(b.start, "a block started during the meeting").toBeLessThan(meetingAt);
      if (b.end !== null && b.end > meetingAt) expect(b.end - meetingAt).toBeLessThanOrEqual(2000);
    }
    // the cursor is on the right, so the far corner is on the left
    expect(log.cat.executor.body.x).toBeLessThan(200);
    expect(log.cat.mind.sleeping).toBe(true);
  }, 60_000);

  it("blocks nothing while in a meeting, fullscreen or shooed, then comes back", async () => {
    const minute = (ms: number) => (ms - T0) / 60_000;
    const away = [[30, 60], [70, 100], [110, 140]] as const;
    const log = await simulate({
      hours: 3,
      seed: 4,
      settings: { chaos: "gremlin" },
      world: (now) => {
        const m = minute(now);
        if (m >= 30 && m < 60) return { inMeeting: true };
        if (m >= 70 && m < 100) return { fullscreen: true };
        if (m >= 110 && m < 140) return { shooedUntilMs: now + 60_000 };
        return {};
      },
      onTick: (cat) => cat.mind.forceNeeds({ attention: 1 }),
    });
    expect(log.blocks.length).toBeGreaterThan(0);
    for (const b of log.blocks) {
      for (const [a, z] of away) expect(minute(b.start) < a || minute(b.start) >= z, `block at minute ${minute(b.start)}`).toBe(true);
    }
    // it came back after the last away window and is on screen
    expect(log.intents.some((i) => i.source !== "respect" && minute(i.atMs) >= 140)).toBe(true);
    expect(log.cat.executor.body.hidden).toBe(false);
  }, 60_000);

  it("panic hides the cat at once and it stays away", async () => {
    const log = await simulate({ hours: 1, seed: 6, world: (now, base) => (now - base.nowMs >= 20 * 60_000 ? { panic: true } : {}) });
    expect(log.cat.executor.body.hidden).toBe(true);
    const after = log.intents.filter((i) => i.atMs >= T0 + 20 * 60_000);
    expect(after.every((i) => i.intent.intent === "leave")).toBe(true);
  }, 60_000);

  it("sticks to quiet naps during quiet hours", async () => {
    const log = await simulate({ hours: 2, seed: 2, world: () => ({ quietHours: true }) });
    const kinds = new Set(log.intents.map((i) => i.intent.intent));
    for (const k of kinds) expect(["nap", "nap_warm"]).toContain(k);
  }, 60_000);
});

describe("simulation: the LLM brain with a fake model", () => {
  it("uses the model, keeps to the call limits, and never calls it while asleep", async () => {
    const fake = new FakeLlmClient("good", 0);
    const log = await simulate({ hours: 4, seed: 12, llm: fake, minDecisionGapMs: 20_000 });
    const perHour = fake.calls / 4;
    expect(fake.calls).toBeGreaterThan(5);
    expect(perHour).toBeLessThanOrEqual(60);
    const fromLlm = log.intents.filter((i) => i.source === "llm").length;
    expect(fromLlm).toBeGreaterThan(0);
  }, 90_000);

  it("falls back to the rules when the model is down, and pauses after 3 failures", async () => {
    const fake = new FakeLlmClient("error", 0);
    const log = await simulate({ hours: 1, seed: 12, llm: fake });
    expect(log.events.some((e) => e.type === "llm_problem")).toBe(true);
    expect(log.intents.length).toBeGreaterThan(3);
    expect(log.intents.every((i) => i.source !== "llm")).toBe(true);
    // 3 failures then a 2 minute pause: far fewer calls than decisions
    expect(fake.calls).toBeLessThan(log.intents.length);
  }, 60_000);

  it("copes with garbage and off-menu answers without crashing", async () => {
    for (const mode of ["garbage", "off_menu", "slow"] as const) {
      const fake = new FakeLlmClient(mode, 0);
      const log = await simulate({ hours: 0.5, seed: 14, llm: fake });
      expect(log.intents.length, mode).toBeGreaterThan(0);
      expect(log.intents.every((i) => i.source !== "llm"), mode).toBe(true);
    }
  }, 120_000);

  it("never runs the model on low battery", async () => {
    const fake = new FakeLlmClient("good", 0);
    await simulate({ hours: 1, seed: 12, llm: fake, world: () => ({ batteryLow: true }) });
    expect(fake.calls).toBe(0);
  }, 60_000);
});
