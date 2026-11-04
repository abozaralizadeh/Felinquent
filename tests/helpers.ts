import { Cat, type CatOptions } from "../src/core/cat";
import { makeWorld } from "../src/core/world";
import { seeded } from "../src/core/rng";
import type { WorldSnapshot } from "../src/core/types";

export const T0 = Date.UTC(2026, 10, 2, 10, 0, 0);

/** Moves the world clock forward and keeps the hour in step. */
export function at(world: WorldSnapshot, ms: number, over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return { ...world, nowMs: ms, hour: new Date(ms).getUTCHours(), ...over };
}

export function newCat(opts: CatOptions = {}, world = makeWorld()) {
  const cat = new Cat({ rng: seeded(7), ...opts });
  cat.place(world, 200);
  return { cat, world };
}
