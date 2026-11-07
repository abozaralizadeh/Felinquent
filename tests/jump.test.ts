import { describe, expect, it } from "vitest";
import { Executor } from "../src/core/executor";
import { seeded } from "../src/core/rng";
import type { WindowInfo } from "../src/core/types";
import { makeWorld } from "../src/core/world";

const DT = 1 / 60;
const win = (id: string, x: number, y: number, w = 500, h = 300): WindowInfo => ({ id, app: "Notes", bounds: { x, y, w, h }, focused: id === "w1", cpu: "low", z: 0 });

/** Up from the Dock onto a window near the top of the screen, watching every frame of the way. */
function jumpUp(seed: number, top: number) {
  const world = makeWorld({ windows: [win("w1", 300, top, 600, 700)] });
  const ex = new Executor(seeded(seed));
  ex.placeOnDock(world, 600);
  ex.update(DT);
  ex.start({ intent: "sit_on", target: "w1", approach: "walk", stay_sec: 5, mood: "content" });
  let highest = Infinity;
  let airSec = 0;
  let flights = 0;
  let wasAir = false;
  const anims: string[] = [];
  for (let i = 0; i < 20 * 60 && ex.body.platformId !== "w1"; i++) {
    ex.update(DT);
    if (anims[anims.length - 1] !== ex.body.anim) anims.push(ex.body.anim);
    if (ex.airborne) {
      airSec += DT;
      highest = Math.min(highest, ex.body.y);
      if (!wasAir) flights++;
    }
    wasAir = ex.airborne;
  }
  return { ex, world, highest, airSec: airSec / Math.max(1, flights), anims };
}

describe("jumping", () => {
  it("a jump up stays on the screen and only just clears the edge it is jumping onto", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { ex, highest } = jumpUp(seed, 150);
      expect(ex.body.platformId).toBe("w1");
      // The whole animal stays under the top of the screen (y 0), even at the top of the jump.
      expect(highest - ex.size.h).toBeGreaterThanOrEqual(0);
      // And no huge arc over the window it lands on.
      expect(150 - highest).toBeLessThan(ex.size.h * 0.6);
    }
    // A window right under the menu bar: no room for an arc, so it barely rises above the edge.
    const { highest } = jumpUp(6, 40);
    expect(highest).toBeGreaterThan(40 - 6);
  });

  it("a big jump is sized up first: a crouch, then the flight, rising and coming down", () => {
    const { anims, airSec } = jumpUp(5, 300);
    const crouch = anims.indexOf("prep");
    expect(crouch).toBeGreaterThan(-1);
    expect(anims.indexOf("jump")).toBeGreaterThan(crouch);
    // Up 560 px takes most of a second, like a real cat's jump, never an instant hop.
    expect(airSec).toBeGreaterThan(0.45);
    expect(airSec).toBeLessThan(1.2);
  });

  it("past the top of the jump it is coming down (the drawing reaches for the landing)", () => {
    const world = makeWorld({ windows: [win("w1", 300, 400, 600, 400)] });
    const ex = new Executor(seeded(9));
    ex.placeOnDock(world, 600);
    ex.update(DT);
    ex.start({ intent: "sit_on", target: "w1", approach: "walk", stay_sec: 5, mood: "content" });
    let rising = false;
    let falling = false;
    for (let i = 0; i < 20 * 60 && ex.body.platformId !== "w1"; i++) {
      ex.update(DT);
      if (ex.body.anim === "jump" && ex.body.vy < -50) rising = true;
      if (ex.body.anim === "jump" && ex.body.vy > 50) falling = true;
    }
    expect(rising).toBe(true);
    expect(falling).toBe(true);
  });
});
