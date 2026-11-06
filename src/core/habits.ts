import type { Rng } from "./rng";

/**
 * What the animal has learned about its own choices, and how it feels about doing them again.
 * Three things tilt the rules score of every action (Abozar, 6 Nov 2026: "so the cat isn't
 * predictable and doesn't get boring"):
 *
 * 1. Liked or disliked. A pet or a treat soon after a choice counts for it, a shoo against it. The
 *    counts slowly forget (half-life two weeks), so it follows how you feel this month, not forever.
 *    When it has learned something it doesn't take its own estimate at face value: it draws a guess
 *    from it each time (Thompson sampling), so a choice that is only probably liked still gets tried
 *    and a liked one now and then gets a rest.
 * 2. Bored. Each time it does something that thing gets stale, and the staleness wears off over an
 *    hour or two. Napping and washing hardly get stale (a cat is never bored of sleeping); playing
 *    and making trouble do.
 * 3. Curious. Something it has rarely done, or not done for a week, gets a bonus: it's drawn to
 *    what it doesn't know yet.
 *
 * Counts only, by action name. No window titles, nothing personal. Saved with the memory and wiped
 * by "Forget everything".
 */
const DAY = 86_400_000;
const LIKE_HALF = 14 * DAY;
const SEEN_HALF = 7 * DAY;
const STALE_HALF = 90 * 60_000;
/** Prior: as if it had seen this many good and bad reactions already. */
const PRIOR = 3;
const MIN_MUL = 0.15;
const MAX_MUL = 2.4;

/** How quickly an action gets stale. Not listed: 1. */
const BORES: Record<string, number> = {
  nap: 0.05,
  nap_warm: 0.05,
  cozy: 0.1,
  sprawl: 0.25,
  groom: 0.2,
  watch: 0.3,
  perch: 0.4,
  loaf: 0.2,
  stretch: 0.2,
  ignore: 0.4,
  slow_blink: 0.5,
};
/** Actions that are part of life, not things to be curious about. */
const NO_CURIOSITY = new Set(["nap", "nap_warm", "cozy", "groom", "stretch", "react", "flee", "hide", "go_outside"]);

interface Entry {
  /** Discounted counts of good and bad reactions. */
  a: number;
  b: number;
  /** Discounted count of times done (for curiosity). */
  n: number;
  /** Staleness (for boredom). */
  s: number;
  /** Clock of the last update. */
  t: number;
}

export interface HabitsData {
  liked?: Record<string, number>;
  disliked?: Record<string, number>;
  actions?: Record<string, Partial<Entry>>;
  /** How many choices it has made in its life (not forgotten). */
  life?: number;
}

const decay = (dt: number, half: number): number => (dt <= 0 ? 1 : Math.pow(0.5, dt / half));

export class Habits {
  private map = new Map<string, Entry>();
  /** The last clock seen, for callers that don't pass one. NaN until there is one. */
  private clock = Number.NaN;
  /** Choices made in its whole life, for "has it done enough to know what's new". */
  private life = 0;

  private entry(intent: string, now?: number): Entry {
    if (now !== undefined && (Number.isNaN(this.clock) || now > this.clock)) this.clock = now;
    // No clock yet: the entry takes the first one it sees and starts forgetting from then.
    const t = now ?? this.clock;
    let e = this.map.get(intent);
    if (!e) {
      e = { a: 0, b: 0, n: 0, s: 0, t };
      this.map.set(intent, e);
      return e;
    }
    // Made or loaded with no clock: it starts forgetting from now.
    if (Number.isNaN(e.t)) e.t = t;
    const dt = t - e.t;
    if (dt > 0) {
      const k = decay(dt, LIKE_HALF);
      e.a *= k;
      e.b *= k;
      e.n *= decay(dt, SEEN_HALF);
      e.s *= decay(dt, STALE_HALF);
      e.t = t;
    }
    return e;
  }

  /** A good reaction (a pet, a treat) soon after it chose this. */
  reward(intent: string, now?: number, amount = 1): void {
    this.entry(intent, now).a += amount;
  }

  /** A bad one (a shoo). Counts a bit more than a good one: a shoo is a clear message. */
  punish(intent: string, now?: number, amount = 1): void {
    this.entry(intent, now).b += 1.5 * amount;
  }

  /** It chose this (rules or model). Makes it a bit stale and a bit less new. */
  used(intent: string, now?: number): void {
    const e = this.entry(intent, now);
    e.s += 1;
    e.n += 1;
    this.life++;
  }

  /**
   * How much it likes doing this, from 0.5 to 1.6. With an rng it draws a guess from what it learned
   * (only when it has learned something about this action); without one it takes the average.
   */
  liking(intent: string, now?: number, rng?: Rng): number {
    const e = this.map.has(intent) ? this.entry(intent, now) : null;
    const a = e?.a ?? 0;
    const b = e?.b ?? 0;
    const theta = rng && a + b >= 0.5 ? betaSample(PRIOR + a, PRIOR + b, rng) : (PRIOR + a) / (2 * PRIOR + a + b);
    return Math.max(0.5, Math.min(1.6, Math.pow(2, (theta - 0.5) * 3)));
  }

  /** What it thinks you think of this, 0 (you hate it) to 1 (you love it); 0.5 when it doesn't know. */
  estimate(intent: string, now?: number): number {
    const e = this.map.has(intent) ? this.entry(intent, now) : null;
    const a = e?.a ?? 0;
    const b = e?.b ?? 0;
    return (PRIOR + a) / (2 * PRIOR + a + b);
  }

  /** 1 when fresh, down to about 0.2 when done over and over lately. */
  freshness(intent: string, now?: number): number {
    const e = this.map.has(intent) ? this.entry(intent, now) : null;
    const s = (e?.s ?? 0) * (BORES[intent] ?? 1);
    return Math.max(0.2, 1 / (1 + 0.3 * s + 0.12 * s * s));
  }

  /**
   * Up to 1.5 for something it has hardly ever done (or not for a week or two), 1 for the familiar.
   * A newcomer has done nothing yet, so nothing stands out: the bonus grows with experience (about
   * the first hundred choices). What you reacted to counts as known, and something you clearly
   * don't like isn't interesting at all (else it gets rare, and being rare would bring it back).
   */
  curiosity(intent: string, now?: number): number {
    if (NO_CURIOSITY.has(intent)) return 1;
    const e = this.map.has(intent) ? this.entry(intent, now) : null;
    if (e && (PRIOR + e.a) / (2 * PRIOR + e.a + e.b) < 0.42) return 1;
    const known = (e?.n ?? 0) + 2 * ((e?.a ?? 0) + (e?.b ?? 0));
    return 1 + Math.min(1, this.life / 100) * (0.5 / (1 + known / 2));
  }

  /** Everything together, for a rules score. Without a clock or rng: the liked part only, as before. */
  multiplier(intent: string, now?: number, rng?: Rng): number {
    const like = this.liking(intent, now, rng);
    if (now === undefined) return like;
    return Math.max(MIN_MUL, Math.min(MAX_MUL, like * this.freshness(intent, now) * this.curiosity(intent, now)));
  }

  /** One short line for the model prompt, or null when nothing is learned yet. */
  line(now?: number): string | null {
    const names = [...this.map.keys()];
    const best = names
      .map((k) => ({ k, e: this.entry(k, now) }))
      .filter(({ e }) => e.a >= 1.5 && e.a > e.b)
      .sort((x, y) => y.e.a - x.e.a)
      .slice(0, 3)
      .map(({ k }) => k.replace(/_/g, " "));
    const stale = names
      .filter((k) => this.freshness(k, now) < 0.5)
      .slice(0, 3)
      .map((k) => k.replace(/_/g, " "));
    const parts: string[] = [];
    if (best.length) parts.push(`likes ${best.join(", ")}`);
    if (stale.length) parts.push(`bored of ${stale.join(", ")}`);
    return parts.length ? `habits: ${parts.join("; ")}` : null;
  }

  clear(): void {
    this.map.clear();
    this.life = 0;
  }

  toJSON(): HabitsData {
    const actions: Record<string, Entry> = {};
    const liked: Record<string, number> = {};
    const disliked: Record<string, number> = {};
    const r = (v: number) => Math.round(v * 1000) / 1000;
    for (const [k, e] of this.map) {
      actions[k] = { a: r(e.a), b: r(e.b), n: r(e.n), s: r(e.s), t: e.t };
      // Also in the old shape, so an older version of the app reads something sensible.
      if (e.a >= 0.5) liked[k] = Math.round(e.a);
      if (e.b >= 0.5) disliked[k] = Math.round(e.b);
    }
    return { liked, disliked, actions, life: this.life };
  }

  load(data: Partial<HabitsData> | undefined): void {
    this.clear();
    const num = (v: unknown, max: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
    this.life = num(data?.life, 1e9);
    if (data?.actions && typeof data.actions === "object") {
      for (const [k, e] of Object.entries(data.actions)) {
        if (!e || typeof e !== "object") continue;
        const t = typeof e.t === "number" && Number.isFinite(e.t) ? e.t : Number.NaN;
        this.map.set(k, { a: num(e.a, 200), b: num(e.b, 200), n: num(e.n, 10_000), s: num(e.s, 100), t });
        if (Number.isNaN(this.clock) || t > this.clock) this.clock = t;
      }
      return;
    }
    // The old counter (before 0.1.5): counts with no clock. They start forgetting from the first use.
    for (const [k, v] of Object.entries(data?.liked ?? {})) this.entry(k).a = num(v, 12);
    for (const [k, v] of Object.entries(data?.disliked ?? {})) this.entry(k).b = num(v, 12);
    for (const e of this.map.values()) e.t = Number.NaN;
  }
}

/** A draw from Beta(a, b), from two Gamma draws (Marsaglia and Tsang). a and b are at least 1 here. */
export function betaSample(a: number, b: number, rng: Rng): number {
  const x = gammaSample(a, rng);
  const y = gammaSample(b, rng);
  return x + y > 0 ? x / (x + y) : 0.5;
}

function gammaSample(k: number, rng: Rng): number {
  if (k < 1) return gammaSample(k + 1, rng) * Math.pow(Math.max(1e-12, rng.next()), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 50; i++) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(1e-12, rng.next());
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return k;
}

function normal(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
