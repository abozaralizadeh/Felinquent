export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
}

/** Small seeded generator (mulberry32) so simulations and tests repeat exactly. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)] as never;
    },
  };
}

export const systemRng: Rng = {
  next: () => Math.random(),
  range: (min, max) => min + Math.random() * (max - min),
  pick: (items) => items[Math.floor(Math.random() * items.length)] as never,
};
