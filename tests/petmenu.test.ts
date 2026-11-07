import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { Brain } from "../src/core/brain";
import { Cat } from "../src/core/cat";
import { CHARACTERS, characterById } from "../src/core/characters";
import type { Anim } from "../src/core/executor";
import { seeded } from "../src/core/rng";
import type { ChaosLevel, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/** An animal on the Dock with the model off: a brain that counts it if it is ever asked. */
async function setup(id = "tabby", chaos: ChaosLevel = "normal", over: Partial<WorldSnapshot> = {}) {
  const base = makeWorld({ nowMs: T0 });
  let asked = 0;
  const never = {
    name: "never",
    decide: async () => {
      asked++;
      return null;
    },
    plan: async () => {
      asked++;
      return null;
    },
  } as unknown as Brain;
  const cat = new Cat({ rng: seeded(11), brain: never, settings: { chaos, brain: "rules" }, personality: characterById(id).personality });
  cat.place(base, 400);
  await cat.step(base, DT);
  let t = 0;
  let extra: Partial<WorldSnapshot> = over;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor: { x: 520, y: base.dockTop - 120 }, ...extra });
  const anims: Anim[] = [];
  const run = async (sec: number): Promise<void> => {
    for (let i = 0; i < sec * 60; i++) {
      t += DT;
      await cat.step(world(), DT);
      const a = cat.executor.body.anim;
      if (anims[anims.length - 1] !== a) anims.push(a);
    }
  };
  return { cat, anims, run, world, asked: () => asked, set: (o: Partial<WorldSnapshot>) => (extra = { ...extra, ...o }) };
}

describe("the menu on the animal (right-click)", () => {
  it("every item in the Mac menu is handled by the overlay page", () => {
    const rust = fs.readFileSync("src-tauri/src/main.rs", "utf8");
    const body = rust.slice(rust.indexOf("fn build_pet_menu"), rust.indexOf("fn set_click_through"));
    const ids = [...body.matchAll(/(?:item|check)\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["treat", "toy", "pet", "zoomies", "nap", "shoo", "panic"]);
    const page = fs.readFileSync("src/playground/overlay.ts", "utf8");
    for (const id of ids) expect(page, id).toContain(`"${id}"`);
    // Characters and chaos levels come from the same lists as the menu bar menu.
    expect(body).toContain("group(&CHARACTERS)");
    expect(body).toContain("group(&CHAOS)");
    // Short: no more than about ten things to pick.
    expect(ids.length + 2).toBeLessThanOrEqual(10);
  });

  for (const id of CHARACTERS.map((c) => c.id)) {
    it(`${id}: Pet it, Zoomies! and Nap time start in the same frame, with the model off`, async () => {
      const s = await setup(id);
      s.cat.mind.forceNeeds({ attention: 0.8 });
      const before = s.cat.mind.needs.attention;
      // Pet it: a reaction facing you (or a swat, for the ones that do that), at once.
      s.cat.ask(s.world(), "pet");
      expect(s.cat.mind.current?.intent).toBe("react");
      expect(s.cat.executor.intent?.intent).toBe("react");
      expect(s.cat.mind.needs.attention).toBeLessThan(before);
      expect(s.cat.memory.events().some((e) => e.kind === "pet")).toBe(true);
      await s.run(7);
      expect(s.anims.some((a) => a === "love" || a === "happy" || a === "purr" || a === "headbutt" || a === "swat")).toBe(true);
      // Zoomies!
      s.cat.ask(s.world(), "zoomies");
      expect(s.cat.executor.intent?.intent).toBe("zoomies");
      const x0 = s.cat.executor.body.x;
      let far = 0;
      for (let i = 0; i < 8; i++) {
        await s.run(0.5);
        far = Math.max(far, Math.abs(s.cat.executor.body.x - x0));
      }
      expect(far).toBeGreaterThan(150);
      // Nap time: it lies down and sleeps.
      s.cat.ask(s.world(), "nap");
      expect(s.cat.executor.intent?.intent).toBe("nap");
      expect(s.cat.mind.sleeping).toBe(true);
      await s.run(8);
      expect(s.cat.executor.body.anim).toBe("sleep");
      expect(s.asked()).toBe(0);
    }, 20_000);
  }

  it("zoomies when you ask for them, even at chill", async () => {
    const s = await setup("pearl", "chill");
    s.cat.ask(s.world(), "zoomies");
    expect(s.cat.executor.intent?.intent).toBe("zoomies");
  });

  it("respect modes still win: nothing in a meeting, only a nap in quiet hours", async () => {
    const m = await setup("biscuit", "normal", { inMeeting: true });
    await m.run(1);
    const meeting = m.cat.mind.current?.intent;
    for (const what of ["pet", "zoomies", "nap"] as const) {
      m.cat.ask(m.world(), what);
      expect(m.cat.mind.current?.intent, what).toBe(meeting);
    }
    const q = await setup("biscuit", "normal", { quietHours: true });
    q.cat.ask(q.world(), "zoomies");
    expect(q.cat.executor.intent?.intent).not.toBe("zoomies");
    q.cat.ask(q.world(), "nap");
    expect(q.cat.executor.intent?.intent).toBe("nap");
  });

  it("a nap you asked for ends by itself once it's rested", async () => {
    const s = await setup("tabby");
    s.cat.mind.forceNeeds({ energy: 0.95 });
    s.cat.ask(s.world(), "nap");
    await s.run(60);
    expect(s.cat.mind.sleeping).toBe(true);
    await s.run(90);
    expect(s.cat.mind.sleeping).toBe(false);
  }, 20_000);

  it("shooed for a while, it comes back in a huff", async () => {
    const s = await setup("tabby");
    s.cat.updateSettings({ thoughtBubbles: true });
    s.set({ shooedUntilMs: T0 + 20_000 });
    await s.run(19);
    expect(s.cat.mind.current?.intent).toBe("leave");
    await s.run(2);
    const back = s.cat.mind.current;
    expect(back?.intent).toBe("sulk");
    expect(back?.mood).toBe("sulky");
    expect(back?.thought).toMatch(/back|shooed|on my own/);
    expect(s.cat.executor.body.hidden).toBe(false);
    await s.run(6);
    expect(s.anims).toContain("sulk");
    expect(s.asked()).toBe(0);
  });

  it("a treat ends a shoo, and it comes to beg, no grudge", async () => {
    const s = await setup("biscuit");
    s.set({ shooedUntilMs: T0 + 3_600_000 });
    await s.run(8);
    expect(s.cat.mind.current?.intent).toBe("leave");
    // The menu's treat ends the shoo (as the overlay does) and holds one out.
    s.set({ shooedUntilMs: 0 });
    s.cat.treat(s.world());
    await s.run(3);
    expect(s.cat.mind.current?.intent).toBe("follow");
    expect(s.cat.mind.current?.treat).toBe(true);
    expect(s.cat.executor.body.hidden).toBe(false);
  });
});
