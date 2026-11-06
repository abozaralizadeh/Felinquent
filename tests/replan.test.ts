import { describe, expect, it } from "vitest";
import { Cat } from "../src/core/cat";
import { characterById } from "../src/core/characters";
import { seeded } from "../src/core/rng";
import type { WindowInfo, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

/**
 * The Mac reads the windows four times a second and hands over a fresh list each time, even when
 * nothing moved. That must not change what the animal does: before this was caught, every fresh list
 * threw away the plan, so a reaction looped for minutes and a stroll never got past its first step.
 */
const fresh = (ws: WindowInfo[]): WindowInfo[] => ws.map((w) => ({ ...w, bounds: { ...w.bounds } }));

interface Trace {
  anims: string[];
  xs: number[];
  intents: string[];
  doneAt: number | null;
}

async function run(opts: { refresh: boolean; seconds: number; poke?: boolean; id?: string; seed?: number; move?: (s: number, ws: WindowInfo[]) => WindowInfo[] }): Promise<Trace> {
  const base = makeWorld({ nowMs: T0 });
  const cat = new Cat({ rng: seeded(opts.seed ?? 3), personality: characterById(opts.id ?? "tabby").personality });
  cat.place(base, 400);
  let windows = base.windows;
  const trace: Trace = { anims: [], xs: [], intents: [], doneAt: null };
  const dt = 1 / 60;
  let world: WorldSnapshot = at(base, T0);
  for (let i = 0; i < opts.seconds * 60; i++) {
    const ms = T0 + Math.round(i * dt * 1000);
    if (i % 15 === 0) {
      if (opts.move) windows = opts.move(i / 60, windows);
      else if (opts.refresh) windows = fresh(windows);
    }
    world = at(base, ms, { windows, cursor: { x: 520, y: 700 } });
    if (opts.poke && i === 60) {
      // A click on the animal, a second in.
      const r = cat.executor.hitRect();
      cat.pointer({ t: ms, x: r.x + r.w / 2, y: r.y + r.h / 2, down: true }, world);
      cat.pointer({ t: ms + 50, x: r.x + r.w / 2, y: r.y + r.h / 2, down: false }, world);
    }
    const res = await cat.step(world, dt);
    for (const e of res.mind) if (e.type === "intent") trace.intents.push(e.intent.intent);
    trace.anims.push(cat.executor.body.anim);
    trace.xs.push(Math.round(cat.executor.body.x));
    if (opts.poke && i > 60 && trace.doneAt === null && cat.mind.current?.intent !== "react") trace.doneAt = i / 60;
  }
  return trace;
}

describe("a fresh window list with the same windows changes nothing", () => {
  it("a reaction to a click plays once and ends", async () => {
    const t = await run({ refresh: true, seconds: 60, poke: true });
    expect(t.doneAt, "the reaction ended").not.toBeNull();
    expect(t.doneAt as number).toBeLessThan(30);
  });

  for (const id of ["tabby", "biscuit", "mochi"]) {
    it(`${id} does exactly the same with or without the refreshes`, async () => {
      const a = await run({ refresh: false, seconds: 240, id, seed: 5 });
      const b = await run({ refresh: true, seconds: 240, id, seed: 5 });
      expect(b.intents).toEqual(a.intents);
      expect(b.xs).toEqual(a.xs);
      expect(b.anims).toEqual(a.anims);
    });
  }

  it("a window the animal isn't using can move without disturbing what it does", async () => {
    // w3 drifts a little every quarter second, far from where the cat is, like a window being dragged.
    const drift = (s: number, ws: WindowInfo[]): WindowInfo[] => ws.map((w) => (w.id === "w3" ? { ...w, bounds: { ...w.bounds, x: 200 + Math.round(20 * Math.sin(s)) } } : { ...w }));
    const a = await run({ refresh: false, seconds: 120, seed: 8 });
    const b = await run({ refresh: false, seconds: 120, seed: 8, move: drift });
    // The plan may differ once it involves w3, but the animal must not flicker: count pose changes.
    const changes = (xs: string[]): number => xs.filter((v, i) => i > 0 && v !== xs[i - 1]).length;
    expect(changes(b.anims)).toBeLessThanOrEqual(changes(a.anims) * 1.5 + 6);
  });
});
