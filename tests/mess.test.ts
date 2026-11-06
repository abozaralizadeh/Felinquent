import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { Mess, shatterPieces } from "../src/core/mess";
import { seeded } from "../src/core/rng";
import type { IntentName, WindowInfo, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

/** Polygon area (shoelace), for checking that the pieces of a broken thing add up to the whole. */
function area(poly: number[]): number {
  let a = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (poly[2 * i] as number) * (poly[2 * j + 1] as number) - (poly[2 * j] as number) * (poly[2 * i + 1] as number);
  }
  return Math.abs(a) / 2;
}

/** Runs a gremlin cat that is told to do one thing, and collects what happened. */
async function act(intent: IntentName, opts: { seconds?: number; setup?: (cat: Cat, world: WorldSnapshot) => void; target?: (w: WorldSnapshot) => string } = {}) {
  const base = makeWorld({ nowMs: T0 });
  const cat = new Cat({ rng: seeded(4), settings: { chaos: "gremlin" } });
  cat.place(base, 300);
  const dt = 1 / 60;
  let world = at(base, T0);
  await cat.step(world, dt);
  opts.setup?.(cat, world);
  // Give a new thing a moment to fade in.
  for (let i = 0; i < 90; i++) cat.mess.step(dt, world, "gremlin", null);
  cat.executor.start({ intent, target: opts.target?.(world) ?? "here", approach: "walk", stay_sec: 20, mood: "smug" });
  let done = false;
  const anims: string[] = [];
  for (let i = 0; i < (opts.seconds ?? 120) * 60; i++) {
    world = at(base, T0 + Math.round((i + 1) * dt * 1000), { cursor: { x: 700, y: 500 } });
    await cat.step(world, dt);
    anims.push(cat.executor.body.anim);
    if (cat.executor.intent === null) done = true;
    if (done && i > 60 * 20) break;
  }
  return { cat, done, anims };
}

describe("the mess", () => {
  it("the pieces of a broken thing cover all of it, with no overlap", () => {
    const pieces = shatterPieces(8, seeded(3));
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const total = pieces.reduce((s, p) => s + area(p), 0);
    expect(total).toBeCloseTo(1, 3);
  });

  it("a cat pushes a mug off a window, slowly, and it breaks", async () => {
    let target = "";
    const { cat, done, anims } = await act("knock_off", {
      seconds: 90,
      setup: (c, w) => {
        const win = w.windows[0] as WindowInfo;
        target = win.id;
        c.mess.place("mug", win.id, win.bounds.x + win.bounds.w * 0.7, w.nowMs);
      },
      target: () => target,
    });
    expect(done, "the knock-off ended").toBe(true);
    expect(cat.mess.props.some((p) => p.kind === "mug" && p.state === "rest"), "the mug is no longer standing").toBe(false);
    expect(cat.mess.shards.length, "it broke into pieces").toBeGreaterThan(3);
    // It looked at the human, tapped, pushed: the classic.
    expect(anims).toContain("stare");
    expect(anims).toContain("swat");
    expect(anims).toContain("push_toy");
    const lines = cat.mind.happenedLines(T0 + 90_000).join(" ");
    expect(lines).toMatch(/knocked the mug off/);
  });

  it("claws leave marks on the title bar and tear strips off it", async () => {
    let target = "";
    const { cat, done } = await act("claw", { seconds: 60, target: (w) => (target = (w.windows[0] as WindowInfo).id) });
    expect(done).toBe(true);
    expect(cat.mess.decals.filter((d) => d.windowId === target && d.kind === "claw").length).toBeGreaterThanOrEqual(1);
    expect(cat.mess.strips.length).toBeGreaterThan(0);
  });

  it("a fly comes, gets pounced on, and is gone", async () => {
    const { cat, done } = await act("hunt", { seconds: 60 });
    expect(done).toBe(true);
    const lines = cat.mind.happenedLines(T0 + 60_000).join(" ");
    expect(lines).toMatch(/fly/);
  });

  it("things on a window fall when the window closes, and things fade out in chill", () => {
    const base = makeWorld({ nowMs: T0 });
    const mess = new Mess(seeded(5));
    const win = base.windows[0] as WindowInfo;
    mess.step(1 / 60, base, "gremlin", null);
    mess.place("duck", win.id, win.bounds.x + 100, T0);
    mess.step(1 / 60, base, "gremlin", null);
    const gone = { ...base, nowMs: T0 + 100, windows: base.windows.filter((w) => w.id !== win.id) };
    for (let i = 0; i < 120; i++) mess.step(1 / 60, { ...gone, nowMs: T0 + 100 + i * 16 }, "gremlin", null);
    const duck = mess.props.find((p) => p.kind === "duck");
    expect(duck?.state === "rest" && duck.windowId === win.id).toBe(false);

    const m2 = new Mess(seeded(6));
    m2.step(1 / 60, base, "gremlin", null);
    m2.place("plant", win.id, win.bounds.x + 100, T0);
    for (let i = 0; i < 400; i++) m2.step(1 / 60, { ...base, nowMs: T0 + i * 16 }, "chill", null);
    expect(m2.props.length).toBe(0);
  });

  it("a gremlin brings things to knock off; chill brings none", () => {
    const base = makeWorld({ nowMs: T0 });
    for (const [chaos, want] of [["gremlin", true], ["chill", false]] as const) {
      const mess = new Mess(seeded(8));
      let seen = false;
      for (let s = 0; s < 600; s++) {
        mess.step(1, { ...base, nowMs: T0 + s * 1000 }, chaos, 50);
        if (mess.props.length > 0) seen = true;
      }
      expect(seen, chaos).toBe(want);
    }
  });
});
