import { describe, expect, it } from "vitest";
import { planRoute } from "../src/core/pathfinding";
import type { Platform } from "../src/core/platforms";

const lim = { maxUp: 300, maxGap: 200 };
const P = (id: string, x1: number, x2: number, y: number): Platform => ({ id, x1, x2, y, kind: "window_top", windowId: id });

describe("planRoute", () => {
  it("walks inside a platform", () => {
    const plan = planRoute([P("a", 0, 500, 500)], "a", 50, "a", 400, lim)!;
    expect(plan.reached).toBe(true);
    expect(plan.steps).toEqual([{ kind: "walk", x: 400 }]);
  });

  it("jumps between platforms that overlap horizontally", () => {
    const plan = planRoute([P("a", 0, 500, 500), P("b", 100, 300, 350)], "a", 50, "b", 200, lim)!;
    expect(plan.reached).toBe(true);
    expect(plan.steps.some((s) => s.kind === "jump" && s.toId === "b")).toBe(true);
  });

  it("goes through stepping stones when the goal is too high for one jump", () => {
    const platforms = [P("floor", 0, 1000, 800), P("mid", 100, 400, 600), P("top", 200, 500, 400)];
    const plan = planRoute(platforms, "floor", 50, "top", 300, lim)!;
    expect(plan.reached).toBe(true);
    const jumps = plan.steps.filter((s) => s.kind === "jump").map((s) => (s as { toId: string }).toId);
    expect(jumps).toEqual(["mid", "top"]);
  });

  it("jumps across a gap that is small enough, not one that is too wide", () => {
    const near = planRoute([P("a", 0, 200, 500), P("b", 300, 500, 500)], "a", 50, "b", 400, lim)!;
    expect(near.reached).toBe(true);
    const far = planRoute([P("a", 0, 200, 500), P("b", 600, 800, 500)], "a", 50, "b", 700, lim)!;
    expect(far.reached).toBe(false);
  });

  it("falls down to any lower platform", () => {
    const plan = planRoute([P("hi", 0, 300, 100), P("lo", 0, 300, 900)], "hi", 100, "lo", 100, lim)!;
    expect(plan.reached).toBe(true);
  });

  it("walks to the nearest reachable spot when the goal can't be reached", () => {
    const platforms = [P("a", 0, 300, 500), P("island", 1000, 1200, 500)];
    const plan = planRoute(platforms, "a", 50, "island", 1100, lim)!;
    expect(plan.reached).toBe(false);
    expect(plan.endId).toBe("a");
    const last = plan.steps[plan.steps.length - 1] as { kind: string; x: number };
    expect(last.x).toBeGreaterThan(290);
    expect(last.x).toBeLessThanOrEqual(300);
  });

  it("returns null when the start platform doesn't exist", () => {
    expect(planRoute([P("a", 0, 300, 500)], "gone", 0, "a", 10, lim)).toBeNull();
  });
});
