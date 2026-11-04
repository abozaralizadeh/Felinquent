import { describe, expect, it } from "vitest";
import { ReflexDetector, type PointerSample, type ReflexEvent } from "../src/core/reflexes";

const hit = { x: 100, y: 100, w: 100, h: 90 };
const kinds = (e: ReflexEvent[]) => e.map((x) => x.kind);

function run(d: ReflexDetector, samples: PointerSample[]): ReflexEvent[] {
  return samples.flatMap((s) => d.feed(s));
}

describe("ReflexDetector", () => {
  it("click without moving is a poke", () => {
    const d = new ReflexDetector(() => hit);
    const ev = run(d, [
      { t: 0, x: 150, y: 150, down: false },
      { t: 50, x: 150, y: 150, down: true },
      { t: 120, x: 150, y: 150, down: false },
    ]);
    expect(kinds(ev)).toEqual(["poke"]);
  });

  it("a click outside the cat does nothing", () => {
    const d = new ReflexDetector(() => hit);
    const ev = run(d, [
      { t: 0, x: 500, y: 500, down: true },
      { t: 80, x: 500, y: 500, down: false },
    ]);
    expect(ev).toEqual([]);
  });

  it("press and move is a pickup, a slow release is a drop", () => {
    const d = new ReflexDetector(() => hit);
    const ev = run(d, [
      { t: 0, x: 150, y: 150, down: true },
      { t: 50, x: 160, y: 150, down: true },
      { t: 100, x: 170, y: 150, down: true },
      { t: 400, x: 170, y: 150, down: true },
      { t: 450, x: 170, y: 150, down: false },
    ]);
    expect(kinds(ev)).toEqual(["pickup", "drop"]);
  });

  it("a fast release is a throw and carries velocity", () => {
    const d = new ReflexDetector(() => hit);
    const ev = run(d, [
      { t: 0, x: 150, y: 150, down: true },
      { t: 20, x: 190, y: 150, down: true },
      { t: 40, x: 260, y: 150, down: true },
      { t: 60, x: 360, y: 150, down: true },
      { t: 80, x: 480, y: 150, down: false },
    ]);
    const throwEv = ev.find((e) => e.kind === "throw")!;
    expect(throwEv).toBeTruthy();
    expect(throwEv.vx!).toBeGreaterThan(1500);
  });

  it("shaking the cat while holding it is a shoo, reported once per hold", () => {
    const d = new ReflexDetector(() => hit);
    const samples: PointerSample[] = [{ t: 0, x: 150, y: 150, down: true }];
    for (let i = 1; i <= 10; i++) samples.push({ t: i * 60, x: 150 + (i % 2 === 0 ? -50 : 50), y: 150, down: true });
    const ev = run(d, samples);
    expect(kinds(ev).filter((k) => k === "shoo")).toHaveLength(1);
    expect(kinds(ev)).toContain("pickup");
  });

  it("stroking the cat is a pet, and 8 seconds of it is too much", () => {
    const d = new ReflexDetector(() => hit);
    const samples: PointerSample[] = [];
    for (let i = 0; i < 200; i++) samples.push({ t: i * 50, x: 130 + (i % 2) * 20, y: 140, down: false });
    const ev = run(d, samples);
    expect(kinds(ev)).toEqual(["pet", "overpet"]);
  });

  it("slow cursor movement over the cat is not petting", () => {
    const d = new ReflexDetector(() => hit);
    const samples: PointerSample[] = [];
    for (let i = 0; i < 40; i++) samples.push({ t: i * 100, x: 130 + i * 0.5, y: 140, down: false });
    expect(run(d, samples)).toEqual([]);
  });

  it("wiggling the cursor fast near the cat is a laser, with a cooldown", () => {
    const d = new ReflexDetector(() => hit);
    const samples: PointerSample[] = [];
    for (let i = 0; i < 100; i++) samples.push({ t: i * 25, x: 300 + (i % 2 === 0 ? -60 : 60), y: 300, down: false });
    const ev = run(d, samples);
    expect(kinds(ev).filter((k) => k === "laser")).toHaveLength(1);
  });

  it("a fast wiggle far from the cat is ignored", () => {
    const d = new ReflexDetector(() => hit);
    const samples: PointerSample[] = [];
    for (let i = 0; i < 60; i++) samples.push({ t: i * 25, x: 1200 + (i % 2 === 0 ? -60 : 60), y: 700, down: false });
    expect(run(d, samples)).toEqual([]);
  });
});
