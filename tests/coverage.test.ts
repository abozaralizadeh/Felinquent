import { describe, expect, it } from "vitest";
import { BEHAVIORS } from "../src/core/behaviors";
import { Executor } from "../src/core/executor";
import { Governor } from "../src/core/governor";
import { initialNeeds } from "../src/core/needs";
import { ARCHETYPES } from "../src/core/personality";
import { candidates, type RulesContext } from "../src/core/rules";
import { seeded } from "../src/core/rng";
import { TrickBook } from "../src/core/tricks";
import { DEFAULT_SETTINGS, type IntentName, type Needs, type Settings, type WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0 } from "./helpers";

interface Situation {
  world?: Partial<WorldSnapshot>;
  needs?: Partial<Needs>;
  justWoke?: boolean;
  catNearCursor?: boolean;
  settings?: Partial<Settings>;
  newWindow?: boolean;
  /** A thing stands on the first window (mess.ts). */
  props?: boolean;
  /** It has made up a few tricks (tricks.ts). */
  tricks?: boolean;
  /** Its toy lies on the Dock a little way off, just thrown by you. */
  toy?: boolean;
  /** It has to go (mind.ts). */
  potty?: { pee: number; poop: number };
}

const book = new TrickBook();
for (let i = 0; i < 30; i++) book.breed(seeded(i + 1), T0 + i, undefined, true);

/** The situation that makes each behavior a sensible choice. Intents not listed are reactions, not choices. */
const SITUATIONS: Partial<Record<IntentName, Situation>> = {
  nap: {},
  nap_warm: {},
  wander: {},
  perch: {},
  groom: {},
  watch: { world: { cursorSpeed: 100 } },
  stretch: { justWoke: true },
  stare: {},
  slow_blink: { needs: { trust: 80, mood: "content" } },
  follow: { world: { appSwitchedSecAgo: 5 }, needs: { attention: 0.8 } },
  cross: { needs: { attention: 0.8 } },
  headbutt: { needs: { attention: 0.8 }, catNearCursor: true },
  meow: { needs: { attention: 0.8 } },
  swat: { needs: { energy: 0.9 }, catNearCursor: true },
  knock_toy: { needs: { energy: 0.9, mood: "playful" } },
  play_cursor: { world: { cursorSpeed: 200 }, needs: { energy: 0.9, mood: "playful" }, catNearCursor: true },
  zoomies: { world: { hour: 3 }, needs: { energy: 0.9 } },
  sit_on: { needs: { attention: 0.9 } },
  sit_on_video: { needs: { attention: 0.9 }, settings: { smartTargeting: true } },
  block_dock: { needs: { attention: 0.9 } },
  keyboard_walk: { world: { activity: "typing_fast" }, needs: { attention: 0.8 } },
  box: { newWindow: true },
  gift: { needs: { trust: 60, attention: 0.2, energy: 0.8 } },
  hairball: { needs: { attention: 0.95 } },
  peek: {},
  chase_tail: { needs: { energy: 0.9, mood: "playful" } },
  knead: {},
  chatter: {},
  sneeze: {},
  stalk: { needs: { energy: 0.9 }, catNearCursor: true },
  tour: {},
  cozy: { needs: { energy: 0.2 } },
  scratch: {},
  sniff: {},
  dig: {},
  roll: {},
  bounce: {},
  tumble: {},
  spook: {},
  howl: {},
  sprawl: {},
  shy: {},
  beg: { needs: { trust: 60 } },
  nudge_window: { needs: { attention: 0.9 }, settings: { chaos: "gremlin", accessibility: true } },
  knock_off: { needs: { attention: 0.8, energy: 0.8 }, props: true },
  claw: { needs: { attention: 0.8, energy: 0.9 } },
  hunt: { needs: { energy: 0.9, curiosity: 0.9 } },
  trick: { needs: { energy: 0.8 }, tricks: true },
  fetch: { needs: { energy: 0.9, trust: 70 }, toy: true },
  carry_toy: { needs: { energy: 0.8 }, toy: true },
  stash_toy: { needs: { energy: 0.6 }, toy: true },
  nose_toy: { needs: { energy: 0.5 }, toy: true },
  chase_cursor: { world: { cursorSpeed: 900 }, needs: { energy: 0.9, mood: "playful" } },
  invite_play: { needs: { energy: 0.9, attention: 0.8, mood: "playful" } },
  yawn: { needs: { energy: 0.3 } },
  look_around: {},
  pee: { potty: { pee: 1.2, poop: 0 } },
  poop: { potty: { pee: 0, poop: 1.2 } },
};

function build(s: Situation) {
  const settings: Settings = { ...DEFAULT_SETTINGS, chaos: "gremlin", ...s.settings };
  let world = makeWorld({ nowMs: T0, ...s.world });
  if (s.newWindow) {
    world = { ...world, windows: world.windows.map((w, i) => (i === 1 ? { ...w, isNew: true, isEmpty: true } : w)) };
  }
  const needs: Needs = { ...initialNeeds(), energy: 0.6, ...s.needs };
  const ctx: RulesContext = {
    world,
    needs,
    personality: s.settings?.accessibility ? { ...ARCHETYPES.gremlin! } : ARCHETYPES.gremlin!,
    smartTargeting: settings.smartTargeting,
    catPos: s.catNearCursor ? { x: world.cursor.x + 40, y: world.cursor.y } : { x: 200, y: 800 },
    justWoke: s.justWoke ?? false,
    recent: [],
    rng: seeded(1),
    propWindows: s.props ? [(world.windows[0] as { id: string }).id] : [],
    tricks: s.tricks ? book : undefined,
    toy: s.toy ? { kind: "tennis", x: 700, y: world.dockTop, state: "lying", thrownSecAgo: 3 } : null,
    potty: s.potty,
  };
  return { settings, world, needs, ctx };
}

describe("every behavior can be chosen and runs to the end", () => {
  for (const [name, situation] of Object.entries(SITUATIONS) as [IntentName, Situation][]) {
    it(`${name}`, () => {
      const { settings, world, needs, ctx } = build(situation);
      const options = candidates(ctx);
      expect(options.map((o) => o.intent), "offered by the rules").toContain(name);
      const allowed = new Governor(settings).filter(options, world, needs);
      const option = allowed.find((o) => o.intent === name);
      expect(option, "allowed by the governor").toBeTruthy();

      const ex = new Executor(seeded(2));
      ex.placeOnDock(world, 200);
      if (situation.props) {
        const w = world.windows[0]!;
        ex.props = () => [{ id: "p1", windowId: w.id, x: w.bounds.x + w.bounds.w * 0.6 }];
      }
      if (situation.toy) ex.toyAt = () => ({ id: "toy1", x: 700, y: world.dockTop, windowId: null, moving: false });
      const t = book.get(option!.trick);
      const script = t ? book.script(t).beats : undefined;
      ex.start({ intent: name, target: option!.targets[0]!, approach: "run", stay_sec: 3, mood: "content", script, trick: t?.id });
      let done = false;
      for (let i = 0; i < 90 * 60 && !done; i++) done = ex.update(1 / 60).some((e) => e.type === "done");
      expect(done, "finished").toBe(true);
    });
  }

  it("the reactions (ignore, sulk, leave) run too", () => {
    for (const name of ["ignore", "sulk", "leave"] as const) {
      const world = makeWorld({ nowMs: T0 });
      const ex = new Executor(seeded(2));
      ex.placeOnDock(world, 200);
      ex.start({ intent: name, target: name === "leave" ? "corner" : "here", approach: "walk", stay_sec: 3, mood: "content" });
      let finished = false;
      for (let i = 0; i < 90 * 60 && !finished; i++) {
        ex.update(1 / 60);
        finished = ex.phase === "idle" || ex.body.hidden;
      }
      expect(finished, name).toBe(true);
    }
  });

  it("eating a treat (only ever the answer to one you drop) runs to the end, a bite at a time", () => {
    const world = makeWorld({ nowMs: T0 });
    const ex = new Executor(seeded(2));
    ex.placeOnDock(world, 200);
    let left = 1;
    ex.treatAt = () => (left > 0 ? { id: "t1", x: 600, y: world.dockTop, windowId: null, moving: false } : null);
    ex.start({ intent: "eat", target: "treat", approach: "run", stay_sec: 30, mood: "content" });
    let done = false;
    let bites = 0;
    for (let i = 0; i < 90 * 60 && !done; i++) {
      for (const e of ex.update(1 / 60)) {
        if (e.type === "done") done = true;
        if (e.type === "fx" && e.fx.fx === "bite") {
          bites++;
          left -= e.fx.amount;
          expect(Math.abs(ex.body.x + ex.body.facing * ex.size.w * 0.4 - 600)).toBeLessThan(25);
        }
      }
    }
    expect(done).toBe(true);
    expect(bites).toBeGreaterThanOrEqual(3);
    expect(left).toBeLessThanOrEqual(0);
  });

  it("covers every behavior in the catalog table", () => {
    const covered = new Set<string>([...Object.keys(SITUATIONS), "ignore", "sulk", "leave", "react", "eat"]);
    expect(BEHAVIORS.map((b) => b.intent).filter((i) => !covered.has(i))).toEqual([]);
  });
});
