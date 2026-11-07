import { describe, expect, it } from "vitest";
import type { Brain } from "../src/core/brain";
import { Cat, TREAT_FOR, TREAT_HOLD_MS } from "../src/core/cat";
import { CHARACTERS, characterById } from "../src/core/characters";
import type { Anim } from "../src/core/executor";
import { seeded } from "../src/core/rng";
import { instinctFor } from "../src/core/species";
import type { WindowInfo, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

const DT = 1 / 60;

/** An animal on the Dock with the model off (a brain that counts it if it is ever asked). */
async function setup(id: string, windows: WindowInfo[] = []) {
  const base = makeWorld({ nowMs: T0, windows });
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
  const cat = new Cat({ rng: seeded(5), brain: never, settings: { chaos: "normal", brain: "rules" }, personality: characterById(id).personality });
  cat.place(base, 200);
  await cat.step(base, DT);
  cat.mind.forceNeeds({ energy: 0.9, attention: 0.8 });
  let t = 0;
  let cursor = { x: 900, y: base.dockTop - 160 };
  let down = false;
  const world = (): WorldSnapshot => at(base, T0 + Math.round(t * 1000), { cursor });
  const anims: Anim[] = [];
  const run = async (sec: number): Promise<void> => {
    for (let i = 0; i < sec * 60; i++) {
      t += DT;
      const w = world();
      cat.pointer({ t: w.nowMs, x: cursor.x, y: cursor.y, down }, w);
      await cat.step(w, DT);
      const a = cat.executor.body.anim;
      if (anims[anims.length - 1] !== a) anims.push(a);
    }
  };
  return {
    cat,
    anims,
    run,
    world,
    asked: () => asked,
    moveTo: (x: number, y: number) => (cursor = { x, y }),
    press: (on: boolean) => (down = on),
  };
}

describe("treats", () => {
  it("each kind of animal gets its own treat", () => {
    for (const c of CHARACTERS) expect(TREAT_FOR[instinctFor(c.personality.species).kind]).toBeTruthy();
    expect(TREAT_FOR.cat).toBe("fish_treat");
    expect(TREAT_FOR.rabbit).toBe("strawberry");
  });

  for (const id of CHARACTERS.map((c) => c.id)) {
    it(`${id}: comes to beg under the treat, a click drops it, and it eats it (model off)`, async () => {
      const s = await setup(id);
      s.cat.treat(s.world());
      const held = s.cat.mess.treatInHand;
      expect(held?.kind).toBe(TREAT_FOR[instinctFor(characterById(id).personality.species).kind]);
      // It runs over and begs under it. The treat stays in your hand all the while.
      await s.run(8);
      expect(Math.abs(s.cat.executor.body.x - 900)).toBeLessThan(120);
      expect(s.cat.mess.treatInHand).toBeTruthy();
      expect(s.cat.mind.current?.intent).toBe("follow");
      // You click: it falls, and it goes for it.
      s.press(true);
      await s.run(0.1);
      s.press(false);
      expect(s.cat.mess.treatInHand).toBeFalsy();
      expect(s.cat.mind.current?.intent).toBe("eat");
      const attention = s.cat.mind.needs.attention;
      let eaten = false;
      for (let i = 0; i < 30 && !eaten; i++) {
        await s.run(1);
        eaten = !s.cat.mess.treat;
      }
      expect(eaten).toBe(true);
      expect(s.anims).toContain("eat");
      expect(s.cat.mind.needs.attention).toBeLessThan(attention);
      expect(s.cat.memory.events().some((e) => e.kind === "treat")).toBe(true);
      expect(s.asked()).toBe(0);
    });
  }

  it("the click that lets go of a treat is not a poke at the animal", async () => {
    const s = await setup("tabby");
    s.cat.treat(s.world());
    await s.run(8);
    const r = s.cat.executor.hitRect();
    s.moveTo(r.x + r.w / 2, r.y + r.h / 2);
    await s.run(0.2);
    s.press(true);
    await s.run(0.6);
    s.press(false);
    await s.run(0.1);
    expect(s.cat.executor.held).toBe(false);
    expect(s.cat.mind.current?.intent).toBe("eat");
  });

  it("dropped on a window, it climbs up there to eat it", async () => {
    const win: WindowInfo = { id: "w1", app: "Notes", bounds: { x: 700, y: 520, w: 500, h: 300 }, focused: true, cpu: "low", z: 0 };
    const s = await setup("mochi", [win]);
    s.moveTo(950, 380);
    s.cat.treat(s.world());
    await s.run(6);
    s.press(true);
    await s.run(0.1);
    s.press(false);
    let eaten = false;
    for (let i = 0; i < 40 && !eaten; i++) {
      await s.run(1);
      eaten = !s.cat.mess.treat;
    }
    expect(eaten).toBe(true);
    expect(s.cat.executor.body.platformId).toBe("w1");
  });

  it("a treat held out too long slips out of your fingers, and it still gets eaten", async () => {
    const s = await setup("biscuit");
    s.cat.treat(s.world());
    await s.run(TREAT_HOLD_MS / 1000 + 1);
    expect(s.cat.mess.treatInHand).toBeFalsy();
    let eaten = false;
    for (let i = 0; i < 30 && !eaten; i++) {
      await s.run(1);
      eaten = !s.cat.mess.treat;
    }
    expect(eaten).toBe(true);
  });

  it("with thoughts on, holding out a treat and dropping it get lines about the treat", async () => {
    const s = await setup("tabby");
    s.cat.updateSettings({ thoughtBubbles: true });
    const offered = s.cat.mind.onTreatOffered(s.world(), "fish_treat");
    const a = offered.find((e) => e.type === "intent");
    expect(a?.type === "intent" && a.intent.thought).toMatch(/fish treat|good|drop it/);
    const dropped = s.cat.mind.onTreatDropped(s.world(), "fish_treat");
    const b = dropped.find((e) => e.type === "intent");
    expect(b?.type === "intent" && b.intent.thought).toMatch(/mine/);
  });

  it("asking for a treat again while one is in your hand lets it go", async () => {
    const s = await setup("hazel");
    s.cat.treat(s.world());
    await s.run(1);
    s.cat.treat(s.world());
    expect(s.cat.mess.treatInHand).toBeFalsy();
    expect(s.cat.mess.treat).toBeTruthy();
  });
});
