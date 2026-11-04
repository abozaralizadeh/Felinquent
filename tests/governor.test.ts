import { describe, expect, it } from "vitest";
import { Governor, respectPlan, respectState } from "../src/core/governor";
import { initialNeeds } from "../src/core/needs";
import { DEFAULT_SETTINGS, type Intent, type Option } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const needs = { ...initialNeeds(), trust: 80, attention: 0.9 };
const opt = (intent: Option["intent"], targets: string[] = ["w1"]): Option => ({ intent, targets, score: 1 });
const intent = (name: Intent["intent"], over: Partial<Intent> = {}): Intent => ({ intent: name, target: "w1", approach: "walk", stay_sec: 30, mood: "smug", ...over });

describe("respectState", () => {
  it("puts the safe states in order: panic, shoo, fullscreen, meeting, quiet, battery", () => {
    const w = makeWorld({ nowMs: T0 });
    expect(respectState(w).kind).toBe("none");
    expect(respectState({ ...w, batteryLow: true }).kind).toBe("low_battery");
    expect(respectState({ ...w, quietHours: true, batteryLow: true }).kind).toBe("quiet");
    expect(respectState({ ...w, inMeeting: true, quietHours: true }).kind).toBe("meeting");
    expect(respectState({ ...w, screenSharing: true }).kind).toBe("meeting");
    expect(respectState({ ...w, fullscreen: true, inMeeting: true })).toEqual({ kind: "away", reason: "fullscreen" });
    expect(respectState({ ...w, shooedUntilMs: T0 + 1000, fullscreen: true })).toEqual({ kind: "away", reason: "shoo" });
    expect(respectState({ ...w, panic: true, shooedUntilMs: T0 + 1000 })).toEqual({ kind: "away", reason: "panic" });
  });

  it("has a plan for meetings (nap in a corner) and for leaving", () => {
    expect(respectPlan({ kind: "meeting" })).toMatchObject({ intent: "nap", target: "corner" });
    expect(respectPlan({ kind: "away", reason: "panic" })).toMatchObject({ intent: "leave" });
    expect(respectPlan({ kind: "none" })).toBeNull();
  });
});

describe("Governor.filter", () => {
  it("allows nothing but leave in meetings, fullscreen, panic and shoo", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const all = [opt("sit_on"), opt("nap", ["here"]), opt("groom", ["here"]), opt("leave", ["corner"])];
    for (const over of [{ inMeeting: true }, { fullscreen: true }, { panic: true }, { shooedUntilMs: T0 + 5000 }]) {
      const out = g.filter(all, makeWorld({ nowMs: T0, ...over }), needs).map((o) => o.intent);
      expect(out).toEqual(["leave"]);
    }
  });

  it("limits quiet hours to napping and low battery to quiet things", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const all = [opt("sit_on"), opt("nap", ["here"]), opt("groom", ["here"]), opt("meow", ["here"])];
    expect(g.filter(all, makeWorld({ nowMs: T0, quietHours: true }), needs).map((o) => o.intent)).toEqual(["nap"]);
    expect(g.filter(all, makeWorld({ nowMs: T0, batteryLow: true }), needs).map((o) => o.intent)).toEqual(["nap", "groom"]);
  });

  it("respects the chaos level", () => {
    const all = [opt("meow", ["here"]), opt("sit_on"), opt("nudge_window")];
    const w = makeWorld({ nowMs: T0 });
    expect(new Governor({ ...DEFAULT_SETTINGS, chaos: "chill" }).filter(all, w, needs).map((o) => o.intent)).toEqual(["meow"]);
    expect(new Governor({ ...DEFAULT_SETTINGS, chaos: "normal" }).filter(all, w, needs).map((o) => o.intent)).toEqual(["meow", "sit_on"]);
    // Gremlin nudges also need the Accessibility permission to be switched on.
    expect(new Governor({ ...DEFAULT_SETTINGS, chaos: "gremlin" }).filter(all, w, needs).map((o) => o.intent)).toEqual(["meow", "sit_on"]);
    const withAx = new Governor({ ...DEFAULT_SETTINGS, chaos: "gremlin", accessibility: true });
    expect(withAx.filter(all, w, needs).map((o) => o.intent)).toContain("nudge_window");
  });

  it("blocks permission features until the permission is on", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const w = makeWorld({ nowMs: T0 });
    expect(g.filter([opt("sit_on_video", ["w2"])], w, needs)).toEqual([]);
    g.setSettings({ ...DEFAULT_SETTINGS, smartTargeting: true });
    expect(g.filter([opt("sit_on_video", ["w2"])], w, needs)).toHaveLength(1);
  });

  it("only lets the cat sit on a window that isn't focused when smart targeting is on", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const w = makeWorld({ nowMs: T0 });
    expect(g.filter([opt("sit_on", ["w1", "w3"])], w, needs)[0]!.targets).toEqual(["w1"]);
    g.setSettings({ ...DEFAULT_SETTINGS, smartTargeting: true });
    expect(g.filter([opt("sit_on", ["w1", "w3"])], w, needs)[0]!.targets).toEqual(["w1", "w3"]);
  });

  it("keyboard walk needs typing, slow blink needs trust, box needs a new window", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const w = makeWorld({ nowMs: T0, activity: "reading" });
    expect(g.filter([opt("keyboard_walk")], w, needs)).toEqual([]);
    expect(g.filter([opt("keyboard_walk")], { ...w, activity: "typing_fast" }, needs)).toHaveLength(1);
    expect(g.filter([opt("slow_blink", ["cursor"])], w, { ...needs, trust: 40 })).toEqual([]);
    expect(g.filter([opt("slow_blink", ["cursor"])], w, { ...needs, trust: 60 })).toHaveLength(1);
    expect(g.filter([opt("box", ["w1"])], w, needs)).toEqual([]);
    const fresh = makeWorld({ nowMs: T0 });
    fresh.windows[0] = { ...fresh.windows[0]!, isNew: true, isEmpty: true };
    expect(g.filter([opt("box", ["w1"])], fresh, needs)).toHaveLength(1);
  });
});

describe("annoyance budget and fairness", () => {
  it("never repeats the same attention move twice in a row", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const w = makeWorld({ nowMs: T0 });
    g.commit(intent("meow", { target: "here" }), w);
    expect(g.filter([opt("meow", ["here"])], w, needs)).toEqual([]);
    expect(g.filter([opt("headbutt", ["cursor"])], w, needs)).toHaveLength(1);
  });

  it("spends points by annoyance level and stops mischief when they run out", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, chaos: "chill" });
    let w = makeWorld({ nowMs: T0 });
    g.filter([], w, needs); // starts the clock
    const start = g.budget; // 3 per hour, starts at 60%: 1.8
    expect(start).toBeCloseTo(1.8, 5);
    g.commit(intent("meow", { target: "here" }), w);
    expect(g.budget).toBeCloseTo(0.8, 5);
    w = at(w, T0 + 1000);
    g.commit(intent("headbutt", { target: "cursor" }), w);
    expect(g.budget).toBeLessThan(0.1);
    // out of points: annoying moves are gone, ambient ones remain
    const left = g.filter([opt("follow", ["w1"]), opt("groom", ["here"])], at(w, T0 + 2000), needs).map((o) => o.intent);
    expect(left).toEqual(["groom"]);
  });

  it("refills about one hour's worth of points per hour", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, chaos: "normal" });
    const w = makeWorld({ nowMs: T0 });
    g.filter([], w, needs);
    g.commit(intent("sit_on"), w);
    g.commit(intent("block_dock", { target: "dock" }), w);
    const low = g.budget;
    g.filter([], at(w, T0 + 3_600_000), needs);
    expect(g.budget).toBeGreaterThan(low + 5);
    expect(g.budget).toBeLessThanOrEqual(10);
  });

  it("allows at most 2 blocks of the same window per hour", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, chaos: "gremlin" });
    let w = makeWorld({ nowMs: T0 });
    g.commit(intent("sit_on"), w);
    w = at(w, T0 + 5 * 60_000);
    g.commit(intent("sit_on_video"), w);
    w = at(w, T0 + 10 * 60_000);
    g.setSettings({ ...DEFAULT_SETTINGS, chaos: "gremlin", smartTargeting: true });
    expect(g.filter([opt("sit_on", ["w1"])], w, needs)).toEqual([]);
    w = at(w, T0 + 61 * 60_000);
    expect(g.filter([opt("sit_on", ["w1"])], w, needs)).toHaveLength(1);
  });

  it("keeps off a window for 3 minutes after being shooed from it", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, chaos: "gremlin" });
    const w = makeWorld({ nowMs: T0 });
    g.noteShoo("w1", T0);
    expect(g.filter([opt("sit_on", ["w1"])], at(w, T0 + 2 * 60_000), needs)).toEqual([]);
    expect(g.filter([opt("sit_on", ["w1"])], at(w, T0 + 3 * 60_000 + 1), needs)).toHaveLength(1);
  });

  it("allows only one gift or hairball on screen until it is cleaned up", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, chaos: "gremlin" });
    const w = makeWorld({ nowMs: T0 });
    g.commit(intent("gift", { target: "here" }), w);
    expect(g.filter([opt("hairball", ["here"])], at(w, T0 + 1000), needs)).toEqual([]);
    g.clearGift();
    expect(g.filter([opt("hairball", ["here"])], at(w, T0 + 2000), needs)).toHaveLength(1);
  });
});

describe("Governor.validate", () => {
  const world = makeWorld({ nowMs: T0 });

  it("rejects an intent that isn't on the menu", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    expect(g.validate(intent("zoomies"), [opt("nap", ["here"])], world, needs)).toBeNull();
  });

  it("replaces an unknown target with the first valid one", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const out = g.validate(intent("sit_on", { target: "rm -rf" }), [opt("sit_on", ["w1"])], world, needs)!;
    expect(out.target).toBe("w1");
  });

  it("clamps stay time to the chaos level's longest block", () => {
    for (const [chaos, max] of [["normal", 90], ["gremlin", 180]] as const) {
      const g = new Governor({ ...DEFAULT_SETTINGS, chaos });
      const out = g.validate(intent("sit_on", { stay_sec: 9999 }), [opt("sit_on", ["w1"])], world, needs)!;
      expect(out.stay_sec).toBe(max);
    }
    // Chill never sits on windows at all, so its 30 second limit is a backstop only.
    const chill = new Governor({ ...DEFAULT_SETTINGS, chaos: "chill" });
    expect(chill.validate(intent("sit_on"), [opt("sit_on", ["w1"])], world, needs)).toBeNull();
  });

  it("keeps a sulk between 3 and 8 minutes and rounds nonsense numbers", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    expect(g.validate(intent("sulk", { stay_sec: 5 }), [opt("sulk", ["here"])], world, needs)!.stay_sec).toBe(180);
    expect(g.validate(intent("sulk", { stay_sec: 99999 }), [opt("sulk", ["here"])], world, needs)!.stay_sec).toBe(480);
    expect(g.validate(intent("groom", { stay_sec: Number.NaN }), [opt("groom", ["here"])], world, needs)!.stay_sec).toBe(5);
  });

  it("repairs a bad approach or mood", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const bad = { ...intent("groom"), approach: "teleport" as never, mood: "furious" as never };
    const out = g.validate(bad, [opt("groom", ["here"])], world, { ...needs, mood: "grumpy" })!;
    expect(out.approach).toBe("walk");
    expect(out.mood).toBe("grumpy");
  });

  it("trims thoughts to 80 characters, strips links, and allows one per 10 minutes", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const long = `see https://evil.example/x ${"a".repeat(200)}`;
    const first = g.validate(intent("groom", { thought: long }), [opt("groom", ["here"])], world, needs)!;
    expect(first.thought!.length).toBeLessThanOrEqual(80);
    expect(first.thought).not.toMatch(/https?:/);
    g.commit(first, world);
    const soon = g.validate(intent("headbutt", { target: "cursor", thought: "hi" }), [opt("headbutt", ["cursor"])], at(world, T0 + 60_000), needs)!;
    expect(soon.thought).toBeUndefined();
    const later = g.validate(intent("headbutt", { target: "cursor", thought: "hi" }), [opt("headbutt", ["cursor"])], at(world, T0 + 11 * 60_000), needs)!;
    expect(later.thought).toBe("hi");
  });

  it("drops thoughts when bubbles are off", () => {
    const g = new Governor({ ...DEFAULT_SETTINGS, thoughtBubbles: false });
    expect(g.validate(intent("groom", { thought: "hi" }), [opt("groom", ["here"])], world, needs)!.thought).toBeUndefined();
  });

  it("re-checks respect state at validation time", () => {
    const g = new Governor(DEFAULT_SETTINGS);
    const inMeeting = at(world, T0, { inMeeting: true });
    expect(g.validate(intent("sit_on"), [opt("sit_on")], inMeeting, needs)).toBeNull();
  });
});
