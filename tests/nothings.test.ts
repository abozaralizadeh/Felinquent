import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { Brain } from "../src/core/brain";
import { Cat } from "../src/core/cat";
import { CHARACTERS, characterById } from "../src/core/characters";
import { InMemoryMemory } from "../src/core/memory";
import { candidates, THING_MOVES, type RulesContext } from "../src/core/rules";
import { seeded } from "../src/core/rng";
import { DEFAULT_SETTINGS, type ChaosLevel, type IntentName, type WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

/**
 * "No toys or objects" (ADR-077): with it on only the animal is on the screen. No toy, nothing on the
 * windows, no pieces, no fly, no puddles or piles, and no move that is about a thing. Off by default.
 * Every run here has the model off: a brain that counts it if it is ever asked.
 */

const never = (): { brain: Brain; asked: () => number } => {
  let n = 0;
  const brain = { name: "never", decide: async () => (n++, null), plan: async () => (n++, null) } as unknown as Brain;
  return { brain, asked: () => n };
};

/** Things on the screen right now (a treat you gave doesn't count: it gets eaten). */
function things(cat: Cat): string[] {
  const m = cat.mess;
  return [
    ...m.props.filter((p) => !p.treat).map((p) => `prop:${p.kind}`),
    ...m.shards.map((s) => `shard:${s.kind ?? "glass"}`),
    ...m.spots.map((s) => `spot:${s.kind}`),
    ...(m.fly ? ["fly"] : []),
  ];
}

/**
 * Lives a while at that chaos level, a busy human with a cursor that moves and stops, a fresh empty
 * window now and then. Steps of a quarter of a second, like the potty and month runs.
 */
async function live(id: string, chaos: ChaosLevel, noThings: boolean, minutes: number, seed = 3) {
  const base = makeWorld({ nowMs: T0 });
  const { brain, asked } = never();
  const cat = new Cat({ rng: seeded(seed), brain, memory: new InMemoryMemory(), settings: { chaos, brain: "rules", noThings }, personality: characterById(id).personality });
  cat.place(base, 500);
  const ran = new Set<IntentName>();
  const seen = new Set<string>();
  let pottyMax = 0;
  const dt = 0.25;
  const steps = Math.round((minutes * 60) / dt);
  for (let i = 0; i < steps; i++) {
    const s = i * dt;
    // The cursor sweeps for 20 s, then rests for 40 (play, chase, follow), and the animal is kept lively.
    const sweeping = s % 60 < 20;
    const cursor = { x: 300 + ((s * 90) % 1000), y: 200 + 150 * Math.sin(s / 3) };
    const w: WorldSnapshot = at(base, T0 + Math.round(s * 1000), { cursor, cursorSpeed: sweeping ? 400 : 0, activity: s % 600 < 400 ? "typing" : "idle", idleSec: s % 600 < 400 ? 1 : 120 });
    if (i % 2400 === 0) cat.mind.forceNeeds({ energy: 0.9, attention: 0.8 });
    await cat.step(w, dt);
    const doing = cat.executor.intent?.intent;
    if (doing) ran.add(doing);
    for (const t of things(cat)) seen.add(t);
    pottyMax = Math.max(pottyMax, cat.mind.potty.pee, cat.mind.potty.poop);
  }
  return { cat, ran, seen, pottyMax, asked: asked() };
}

describe("No toys or objects (ADR-077)", () => {
  it("is off by default, in the core and in the app", () => {
    expect(DEFAULT_SETTINGS.noThings).toBe(false);
    const cat = new Cat({ rng: seeded(1) });
    expect(cat.settings.noThings).toBe(false);
    expect(cat.mess.bare).toBe(false);
    const page = fs.readFileSync("src/playground/overlay.ts", "utf8");
    expect(page).toContain("noThings: saved.noThings ?? false");
  });

  it("left off, a gremlin still puts things on the screen (so the next test can see them)", async () => {
    const r = await live("tabby", "gremlin", false, 30);
    expect([...r.seen].some((t) => t.startsWith("prop:"))).toBe(true);
    expect(r.asked).toBe(0);
  });

  it("turned on, every animal stays alone on the screen for two hours of gremlin", async () => {
    for (const c of CHARACTERS) {
      const r = await live(c.id, "gremlin", true, 120, 7);
      expect([...r.seen], c.id).toEqual([]);
      expect([...r.ran].filter((x) => THING_MOVES.has(x)), c.id).toEqual([]);
      // It never even has to go, so it never looks for a spot.
      expect(r.pottyMax, c.id).toBe(0);
      // It still does plenty: more than a handful of different moves.
      expect(r.ran.size, c.id).toBeGreaterThan(8);
      expect(r.asked, c.id).toBe(0);
    }
  }, 120_000);

  it("keeps every move about a thing off the menu, even with a toy out, a thing on a window and a full need", () => {
    const w = makeWorld({ nowMs: T0, cursor: { x: 520, y: 700 }, cursorSpeed: 300 });
    const ctx = (noThings: boolean, id: string): RulesContext => ({
      world: w,
      needs: { energy: 0.9, attention: 0.9, curiosity: 0.9, trust: 80, mood: "playful" } as RulesContext["needs"],
      personality: characterById(id).personality,
      smartTargeting: false,
      catPos: { x: 500, y: w.dockTop },
      justWoke: false,
      recent: [],
      rng: seeded(2),
      chaos: "gremlin",
      propWindows: [w.windows[0]?.id as string],
      toy: { kind: "yarn", x: 700, y: w.dockTop, state: "lying", thrownSecAgo: 5 },
      potty: { pee: 1.5, poop: 1.5 },
      noThings,
    });
    let offered = 0;
    for (const c of CHARACTERS) {
      const off = candidates(ctx(false, c.id)).map((o) => o.intent);
      const on = candidates(ctx(true, c.id)).map((o) => o.intent);
      offered += off.filter((x) => THING_MOVES.has(x)).length;
      expect(on.filter((x) => THING_MOVES.has(x)), c.id).toEqual([]);
      expect(on.length, c.id).toBeGreaterThan(10);
    }
    // Left off, those moves are there (the switch is what takes them away).
    expect(offered).toBeGreaterThan(20);
  });

  it("turned on, what lies about goes at once and a move about a thing stops", async () => {
    const base = makeWorld({ nowMs: T0 });
    const { brain } = never();
    const cat = new Cat({ rng: seeded(9), brain, settings: { chaos: "normal", brain: "rules" }, personality: characterById("biscuit").personality });
    cat.place(base, 500);
    await cat.step(base, 1 / 60);
    const win = base.windows[0];
    if (!win) throw new Error("no window");
    cat.mess.step(1 / 60, base, "normal", null);
    cat.mess.place("mug", win.id, win.bounds.x + 100, T0);
    cat.mess.bringToy(500, T0);
    cat.mess.relieve("poop", null, 300, T0);
    cat.mess.flyIn(600, 400, 1, false, T0);
    cat.mess.spray("soil", 400, base.dockTop, 1, 6, T0);
    expect(things(cat).length).toBeGreaterThan(4);
    cat.executor.start({ intent: "fetch", target: "toy", approach: "run", stay_sec: 20, mood: "playful" });
    expect(cat.executor.intent?.intent).toBe("fetch");
    cat.updateSettings({ noThings: true });
    expect(things(cat)).toEqual([]);
    expect(cat.executor.intent).toBeNull();
    // And nothing new can be put down while it is on.
    expect(cat.mess.place("mug", win.id, win.bounds.x + 100, T0)).toBeNull();
    expect(cat.mess.bringToy(500, T0)).toBeNull();
    expect(cat.mess.relieve("puddle", null, 300, T0)).toBeNull();
    cat.mess.flyIn(600, 400, 1, false, T0);
    expect(things(cat)).toEqual([]);
    // Off again: things can come back.
    cat.updateSettings({ noThings: false });
    expect(cat.mess.place("mug", win.id, win.bounds.x + 100, T0)).not.toBeNull();
  });

  it("Throw its toy does nothing while it is on, and a treat still works", async () => {
    const base = makeWorld({ nowMs: T0, cursor: { x: 700, y: 300 } });
    const { brain } = never();
    const cat = new Cat({ rng: seeded(4), brain, settings: { chaos: "normal", brain: "rules", noThings: true }, personality: characterById("tabby").personality });
    cat.place(base, 500);
    await cat.step(base, 1 / 60);
    cat.throwToy(base);
    expect(cat.mess.toy).toBeUndefined();
    cat.treat(base);
    expect(cat.mess.treat).toBeDefined();
  });

  it("the moves that stay leave nothing behind: a dig, the raccoon washing its hands, the fox and the squirrel", async () => {
    const tries: [string, IntentName][] = [
      ["tabby", "dig"],
      ["bandit", "wash"],
      ["mochi", "dig"],
      ["hazel", "dig"],
      ["clover", "nibble"],
    ];
    for (const [id, intent] of tries) {
      const base = makeWorld({ nowMs: T0 });
      const { brain } = never();
      const cat = new Cat({ rng: seeded(5), brain, settings: { chaos: "normal", brain: "rules", noThings: true }, personality: characterById(id).personality });
      cat.place(base, 500);
      let t = 0;
      const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor: { x: 1100, y: 300 } });
      for (let i = 0; i < 180 && (cat.executor as unknown as { mode: string }).mode !== "ground"; i++) (t += 1 / 60), await cat.step(world(), 1 / 60);
      cat.executor.start({ intent, target: intent === "nibble" ? (base.windows[0]?.id as string) : "here", approach: "walk", stay_sec: 20, mood: "content" });
      const seen = new Set<string>();
      for (let i = 0; i < 40 * 60 && cat.executor.intent?.intent === intent; i++) {
        t += 1 / 60;
        await cat.step(world(), 1 / 60);
        for (const x of things(cat)) seen.add(x);
      }
      expect([...seen], `${id} ${intent}`).toEqual([]);
    }
  }, 60_000);

  it("the menu bar has the switch, it is saved, and the toy items grey out", () => {
    const rust = fs.readFileSync("src-tauri/src/main.rs", "utf8");
    expect(rust).toContain('check("nothings", "No toys or objects")');
    expect(rust).toContain("t.toy.set_enabled(!choices.no_things)");
    expect(rust).toContain("toy.set_enabled(!cur.is_some_and(|c| c.no_things))");
    const page = fs.readFileSync("src/playground/overlay.ts", "utf8");
    expect(page).toContain('msg === "nothings"');
    expect(page).toContain("noThings: cat.settings.noThings }");
    expect(page).toContain("no_things: cat.settings.noThings");
    const play = fs.readFileSync("src/playground/main.ts", "utf8");
    expect(play).toContain('$("nothings")');
  });
});
