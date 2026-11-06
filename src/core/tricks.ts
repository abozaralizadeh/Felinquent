import { Executor, type Anim, type Beat } from "./executor";
import type { Habits } from "./habits";
import { scriptSeconds } from "./reactions";
import { seeded, type Rng } from "./rng";
import { paced, rawScene } from "./scenes";
import type { IntentName } from "./types";
import { makeWorld } from "./world";

/**
 * Tricks: little routines the animal makes up by itself (Abozar, 6 Nov 2026: stop hand-adding
 * funny actions, let it learn new things over time so it isn't predictable).
 *
 * A trick is data, never code: a short list of beats (hold a pose, walk or run a bit, leap) in the
 * same tiny language the scenes and click reactions use, and only from the poses listed here, so a
 * trick can't do anything the animal couldn't do already: no clicks, no keys, nothing to other apps.
 *
 * New tricks are bred from the scenes and from tricks it already knows (swap a pose for a related
 * one, hold longer or shorter, add a look at you, go the other way, repeat a beat, splice two
 * together). Each one is played in the real executor on a pretend screen before it is kept; one that
 * gets stuck, takes too long or is a near copy of something it knows is thrown away.
 *
 * The library is a grid (MAP-Elites): calm to wild, alone to at you, polite to rude. Each cell keeps
 * its two best, so it never ends up with forty versions of the same swat. "Best" is how you reacted
 * to it (habits.ts, under "trick:<id>"), with a small bonus for one that hasn't been shown much yet.
 */
export type TrickKind = "rest" | "explore" | "play" | "social" | "mischief";

export interface Trick {
  id: string;
  name: string;
  /** Unpaced beats; paced() is applied when it plays. */
  beats: Beat[];
  kind: TrickKind;
  born: { atMs: number; from: string[] };
  /** Times it was done. */
  shown: number;
  lastMs: number;
}

/** Poses a trick may use: ones every character has, that make sense on their own, anywhere. */
export const TRICK_POSES: readonly Anim[] = [
  "idle_sit", "loaf", "groom", "stretch", "look", "meow", "purr", "swat", "pounce", "headbutt", "sulk",
  "turn_away", "stare", "blink", "chase_tail", "knead", "chatter", "sneeze", "happy", "hiss", "puffed",
  "annoyed", "flustered", "play_bow", "belly", "shy", "beg", "dig", "sniff", "giggle", "startled", "proud",
  "curious", "love", "yawn", "surprise", "watch",
];
const POSE_SET = new Set<string>(TRICK_POSES);
const LEAP_ANIMS = new Set<string>(["leap", "bounce"]);
const GO_ANIMS = new Set<string>(["tumble"]);
const SPEEDS = ["walk", "saunter", "sneak", "run"] as const;

/** Poses that can stand in for each other. */
const RELATED: readonly (readonly Anim[])[] = [
  ["idle_sit", "loaf", "blink", "yawn", "stretch"],
  ["look", "curious", "watch", "stare", "sniff"],
  ["happy", "proud", "love", "giggle", "purr"],
  ["pounce", "swat", "play_bow", "chase_tail"],
  ["annoyed", "sulk", "turn_away", "hiss", "puffed", "flustered"],
  ["surprise", "startled", "puffed", "shy"],
  ["headbutt", "meow", "beg", "love", "purr", "knead"],
  ["sneeze", "chatter", "dig", "belly", "groom"],
];

const ENERGY: Partial<Record<string, number>> = {
  idle_sit: 0.1, loaf: 0.05, blink: 0.1, yawn: 0.1, groom: 0.2, stretch: 0.3, look: 0.2, watch: 0.2, stare: 0.2,
  curious: 0.3, sniff: 0.3, purr: 0.1, knead: 0.3, love: 0.3, proud: 0.3, happy: 0.5, giggle: 0.6, belly: 0.4,
  shy: 0.3, sulk: 0.1, turn_away: 0.2, annoyed: 0.3, meow: 0.4, headbutt: 0.4, beg: 0.4, chatter: 0.5,
  sneeze: 0.4, dig: 0.6, play_bow: 0.7, pounce: 0.9, swat: 0.8, chase_tail: 1, hiss: 0.6, puffed: 0.6,
  flustered: 0.5, surprise: 0.6, startled: 0.7,
};
const SOCIAL_POSES = new Set<string>(["headbutt", "meow", "beg", "love", "purr", "knead"]);
const RUDE_POSES = new Set<string>(["swat", "hiss", "annoyed", "turn_away", "stare"]);

/** Where a trick sits in the grid: each from 0 to 1. */
export function describe(beats: readonly Beat[]): { energy: number; social: number; mischief: number } {
  let energy = 0;
  let social = 0;
  let rude = 0;
  for (const b of beats) {
    if ("do" in b) {
      energy += ENERGY[b.do] ?? 0.4;
      if (b.face === "cursor" || SOCIAL_POSES.has(b.do)) social++;
      if (RUDE_POSES.has(b.do)) rude += b.face === "cursor" ? 1.5 : 1;
    } else if ("go" in b) {
      energy += b.anim === "tumble" ? 1 : b.speed === "run" ? 0.9 : b.speed === "sneak" ? 0.5 : b.speed === "walk" ? 0.4 : 0.3;
      if (b.go === "cursor") social++;
    } else {
      energy += 0.95;
      if (b.leap === "cursor") social++;
    }
  }
  const n = Math.max(1, beats.length);
  return { energy: energy / n, social: social / n, mischief: Math.min(1, rude / n) };
}

export function kindOf(beats: readonly Beat[]): TrickKind {
  const d = describe(beats);
  if (d.mischief >= 0.3) return "mischief";
  if (d.social >= 0.4) return "social";
  if (d.energy >= 0.55) return "play";
  if (d.energy < 0.3) return "rest";
  return "explore";
}

function cellOf(beats: readonly Beat[]): string {
  const d = describe(beats);
  const e = d.energy < 0.35 ? 0 : d.energy < 0.6 ? 1 : 2;
  const s = d.social < 0.2 ? 0 : d.social < 0.45 ? 1 : 2;
  const m = d.mischief < 0.25 ? 0 : 1;
  return `${e}${s}${m}`;
}

const PER_CELL = 2;
export const MAX_TRICKS = 18 * PER_CELL;
const MAX_BEATS = 8;
const MAX_SEC = 40;
/** At most one new trick every this long (it dreams them up when it wakes from a nap). */
export const BREED_GAP_MS = 3 * 60 * 60_000;

/** The scenes new tricks start from. */
const SEED_INTENTS: readonly IntentName[] = ["roll", "bounce", "sniff", "dig", "beg", "spook", "tumble", "shy"];
function seeds(): { name: string; beats: Beat[] }[] {
  const rng = seeded(77);
  const out: { name: string; beats: Beat[] }[] = [];
  for (const intent of SEED_INTENTS) {
    const beats = rawScene(intent, 20, rng);
    if (beats) out.push({ name: intent, beats: beats.filter(allowed) });
  }
  // A few more, the way cats are.
  out.push({ name: "stalk", beats: [{ do: "stare", sec: 1.5, face: "cursor" }, { do: "pounce", sec: 0.8 }, { do: "swat", sec: 1 }, { do: "groom", sec: 3 }] });
  out.push({ name: "greeting", beats: [{ do: "look", sec: 0.8, face: "cursor" }, { go: "cursor", by: 160, speed: "walk" }, { do: "headbutt", sec: 2 }, { do: "purr", sec: 2 }] });
  out.push({ name: "snub", beats: [{ do: "look", sec: 1, face: "cursor" }, { do: "turn_away", sec: 2.5 }, { do: "groom", sec: 2.5 }] });
  out.push({ name: "stretch", beats: [{ do: "yawn", sec: 1.2 }, { do: "stretch", sec: 2 }, { do: "blink", sec: 1.2 }] });
  return out;
}
const SEEDS = seeds();

/** A beat is one a trick may hold (and from a file: well formed, with numbers in range). */
function allowed(b: Beat): boolean {
  if ("do" in b) return POSE_SET.has(b.do) && Number.isFinite(b.sec);
  if ("go" in b) return (b.anim === undefined || GO_ANIMS.has(b.anim)) && Number.isFinite(b.by);
  if ("leap" in b) return (b.anim === undefined || LEAP_ANIMS.has(b.anim)) && Number.isFinite(b.by) && Number.isFinite(b.h);
  return false;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Numbers in range, poses from the list, only the fields a beat has. Null for anything else. */
export function cleanBeat(raw: unknown): Beat | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  if (typeof r.do === "string") {
    if (!POSE_SET.has(r.do)) return null;
    const face = r.face === "cursor" || r.face === "away" ? r.face : undefined;
    return { do: r.do as Anim, sec: clamp(num(r.sec, 1), 0.3, 6), ...(face ? { face } : {}) };
  }
  if (typeof r.go === "string") {
    if (r.go !== "cursor" && r.go !== "away" && r.go !== "stroll") return null;
    const speed = SPEEDS.includes(r.speed as never) ? (r.speed as (typeof SPEEDS)[number]) : "walk";
    const anim = typeof r.anim === "string" && GO_ANIMS.has(r.anim) ? (r.anim as Anim) : undefined;
    return { go: r.go, by: clamp(num(r.by, 100), 20, 400), speed, ...(anim ? { anim } : {}) };
  }
  if (typeof r.leap === "string") {
    if (r.leap !== "cursor" && r.leap !== "away" && r.leap !== "ahead" && r.leap !== "stroll") return null;
    const anim = typeof r.anim === "string" && LEAP_ANIMS.has(r.anim) ? (r.anim as Anim) : undefined;
    return { leap: r.leap, by: clamp(num(r.by, 60), 20, 200), h: clamp(num(r.h, 50), 20, 90), ...(anim ? { anim } : {}) };
  }
  return null;
}

// ---- breeding ----

function relatedTo(a: Anim, rng: Rng): Anim {
  const groups = RELATED.filter((g) => g.includes(a));
  if (!groups.length) return rng.pick(TRICK_POSES);
  const g = rng.pick(groups);
  const others = g.filter((x) => x !== a);
  return others.length ? rng.pick(others) : a;
}

const copy = (beats: readonly Beat[]): Beat[] => beats.map((b) => ({ ...b }));

/** One random change. */
export function mutate(beats: readonly Beat[], rng: Rng, other?: readonly Beat[]): Beat[] {
  let out = copy(beats);
  const dos = out.map((b, i) => ("do" in b ? i : -1)).filter((i) => i >= 0);
  const op = rng.next();
  if (op < 0.26 && dos.length) {
    // A pose for a related one.
    const i = rng.pick(dos);
    const b = out[i] as Extract<Beat, { do: unknown }>;
    out[i] = { ...b, do: relatedTo(b.do, rng) };
  } else if (op < 0.4 && dos.length) {
    // Held longer or shorter.
    const i = rng.pick(dos);
    const b = out[i] as Extract<Beat, { do: unknown }>;
    out[i] = { ...b, sec: clamp(b.sec * rng.range(0.5, 1.8), 0.3, 6) };
  } else if (op < 0.52) {
    // A look at you somewhere in it.
    const at = Math.floor(rng.range(0, out.length + 0.99));
    out.splice(at, 0, { do: rng.pick(["look", "curious", "stare", "blink"] as const), sec: rng.range(0.8, 1.8), face: "cursor" });
  } else if (op < 0.62) {
    // The other way: toward you instead of away, and back.
    out = out.map((b): Beat => ("go" in b ? { ...b, go: b.go === "cursor" ? "away" : b.go === "away" ? "cursor" : b.go } : "leap" in b ? { ...b, leap: b.leap === "cursor" ? "away" : b.leap === "away" ? "cursor" : b.leap } : b));
    if (!out.some((b) => "go" in b || "leap" in b)) out.unshift({ go: rng.pick(["cursor", "away", "stroll"] as const), by: rng.range(60, 220), speed: rng.pick(SPEEDS) });
  } else if (op < 0.72 && out.length) {
    // A beat twice.
    const i = Math.floor(rng.range(0, out.length - 0.01));
    out.splice(i, 0, { ...(out[i] as Beat) });
  } else if (op < 0.82 && other && other.length > 1 && out.length > 1) {
    // The start of one and the end of another.
    const a = Math.max(1, Math.floor(rng.range(1, out.length)));
    const b = Math.floor(rng.range(0, other.length - 1));
    out = [...out.slice(0, a), ...copy(other.slice(b))];
  } else if (op < 0.9 && out.length > 3) {
    out.splice(Math.floor(rng.range(0, out.length - 0.01)), 1);
  } else {
    // A move: a few steps, a dash or a hop.
    const at = Math.floor(rng.range(0, out.length + 0.99));
    const move: Beat =
      rng.next() < 0.5
        ? { go: rng.pick(["cursor", "away", "stroll"] as const), by: rng.range(60, 260), speed: rng.pick(SPEEDS) }
        : { leap: rng.pick(["ahead", "stroll", "away"] as const), by: rng.range(30, 90), h: rng.range(30, 70), anim: rng.next() < 0.5 ? "bounce" : "leap" };
    out.splice(at, 0, move);
  }
  return tidy(out.map((b) => cleanBeat(b)).filter((b): b is Beat => b !== null)).slice(0, MAX_BEATS);
}

/** The same pose twice in a row is one longer hold: "blink, blink" reads as nothing happening. */
function tidy(beats: Beat[]): Beat[] {
  const out: Beat[] = [];
  for (const b of beats) {
    const prev = out[out.length - 1];
    if (prev && "do" in prev && "do" in b && prev.do === b.do) out[out.length - 1] = { ...prev, sec: clamp(prev.sec + b.sec * 0.5, 0.3, 6) };
    else out.push(b);
  }
  return out;
}

const token = (b: Beat): string => ("do" in b ? `d:${b.do}:${b.face ?? ""}` : "go" in b ? `g:${b.go}:${b.speed}:${b.anim ?? ""}` : `l:${b.leap}`);

/** How different two tricks are, 0 (the same) to 1: the edit distance between their beats. */
export function distance(a: readonly Beat[], b: readonly Beat[]): number {
  const x = a.map(token);
  const y = b.map(token);
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++) {
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      row[j] = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
  return ((d[x.length] as number[])[y.length] as number) / Math.max(1, x.length, y.length);
}

export interface CheckResult {
  ok: boolean;
  why?: string;
  seconds: number;
}

/**
 * Plays a trick in the real executor on a pretend screen. It has to finish, in time, back on its
 * feet, on the screen, and look like something (at least three different poses).
 */
export function checkTrick(beats: readonly Beat[]): CheckResult {
  if (beats.length < 2) return { ok: false, why: "too short", seconds: 0 };
  if (beats.length > MAX_BEATS) return { ok: false, why: "too long", seconds: 0 };
  if (!beats.some((b) => "do" in b)) return { ok: false, why: "no poses", seconds: 0 };
  const script = paced(copy(beats));
  if (scriptSeconds(script) > MAX_SEC) return { ok: false, why: "takes too long", seconds: scriptSeconds(script) };
  for (const cursorX of [1100, 250]) {
    const world = makeWorld({ cursor: { x: cursorX, y: 700 } });
    const ex = new Executor(seeded(5));
    ex.placeOnDock(world, 700);
    ex.start({ intent: "trick", target: "here", approach: "walk", stay_sec: Math.ceil(scriptSeconds(script)), mood: "playful", script });
    const anims = new Set<string>();
    const dt = 1 / 30;
    let t = 0;
    let done = false;
    for (; t < MAX_SEC + 20 && !done; t += dt) {
      done = ex.update(dt).some((e) => e.type === "done");
      anims.add(ex.body.anim);
    }
    if (!done) return { ok: false, why: "got stuck", seconds: t };
    if (t > MAX_SEC + 8) return { ok: false, why: "takes too long", seconds: t };
    if (ex.airborne || ex.body.hidden) return { ok: false, why: "ended in the air", seconds: t };
    if (ex.body.x < world.screen.x || ex.body.x > world.screen.x + world.screen.w) return { ok: false, why: "left the screen", seconds: t };
    if (anims.size < 3) return { ok: false, why: "nothing to see", seconds: t };
    if (cursorX === 250) return { ok: true, seconds: t };
  }
  return { ok: true, seconds: 0 };
}

// ---- names ----

const NOUN: Partial<Record<string, string[]>> = {
  pounce: ["pounce", "ambush"], swat: ["betrayal", "slap"], chase_tail: ["spin", "whirl"], belly: ["flop", "trap"],
  play_bow: ["bow", "invitation"], dig: ["excavation"], sniff: ["inspection"], stare: ["stare-down"], headbutt: ["bonk"],
  meow: ["aria", "complaint"], beg: ["plea"], turn_away: ["snub"], hiss: ["opinion"], sneeze: ["sneeze"], chatter: ["chatter"],
  stretch: ["stretch"], yawn: ["yawn"], groom: ["spa day"], happy: ["victory lap"], proud: ["victory lap", "speech"],
  giggle: ["giggle fit"], surprise: ["double take"], startled: ["double take"], shy: ["peekaboo"], knead: ["biscuits"],
  love: ["swoon"], curious: ["investigation"], look: ["patrol"], blink: ["blink"], watch: ["vigil"], loaf: ["loaf"],
  sulk: ["sulk"], puffed: ["floof"], flustered: ["fluster"], annoyed: ["huff"], purr: ["purr"], idle_sit: ["pause"],
};
const ADJ = {
  wild: ["wild", "turbo", "bouncy", "frantic", "zippy"],
  calm: ["slow", "lazy", "gentle", "very calm", "sleepy"],
  social: ["polite", "clingy", "charming", "needy"],
  rude: ["sneaky", "smug", "rude", "petty"],
  other: ["curious", "sideways", "dramatic", "midnight", "secret", "accidental", "tiny", "backwards"],
};
/** The most telling pose in a trick: the rarest, the liveliest. */
function mainPose(beats: readonly Beat[]): string {
  const dos = beats.filter((b): b is Extract<Beat, { do: unknown }> => "do" in b).map((b) => b.do as string);
  const leaps = beats.filter((b) => "leap" in b).length;
  const runs = beats.filter((b) => "go" in b && b.speed === "run").length;
  if (leaps >= 2) return "hop";
  if (runs >= 2) return "dash";
  const calm = new Set(["idle_sit", "blink", "look", "loaf", "groom"]);
  return dos.find((d) => !calm.has(d)) ?? dos[0] ?? "pause";
}

export function nameFor(beats: readonly Beat[], rng: Rng, taken: ReadonlySet<string>): string {
  const d = describe(beats);
  const pose = mainPose(beats);
  const nouns = pose === "hop" ? ["hop", "boing"] : pose === "dash" ? ["dash", "zoom"] : (NOUN[pose] ?? ["thing"]);
  const pool = d.mischief >= 0.3 ? ADJ.rude : d.social >= 0.4 ? ADJ.social : d.energy >= 0.6 ? ADJ.wild : d.energy < 0.3 ? ADJ.calm : ADJ.other;
  for (let i = 0; i < 12; i++) {
    const name = `the ${rng.pick(rng.next() < 0.75 ? pool : ADJ.other)} ${rng.pick(nouns)}`;
    if (!taken.has(name)) return name;
  }
  let n = 2;
  const base = `the ${rng.pick(pool)} ${rng.pick(nouns)}`;
  while (taken.has(`${base}, part ${n}`)) n++;
  return `${base}, part ${n}`;
}

// ---- the library ----

export interface BreedResult {
  added: Trick;
  evicted?: Trick;
  tries: number;
}

export interface TricksData {
  tricks?: unknown[];
  lastBredMs?: number;
}

export class TrickBook {
  private list: Trick[] = [];
  private lastBredMs = -Infinity;

  get all(): readonly Trick[] {
    return this.list;
  }

  get(id: string | undefined): Trick | undefined {
    return id ? this.list.find((t) => t.id === id) : undefined;
  }

  /** How good a trick is for keeping: how you reacted, plus a little for one not shown much yet. */
  fitness(t: Trick, habits?: Habits, now?: number): number {
    const liked = habits ? habits.estimate(`trick:${t.id}`, now) : 0.5;
    return liked + 0.15 / (1 + t.shown);
  }

  /** Puts a checked trick in its cell. A full cell keeps its best: the new one only pushes out a worse one. */
  insert(t: Trick, habits?: Habits, now?: number): { added: boolean; evicted?: Trick } {
    const cell = cellOf(t.beats);
    const mates = this.list.filter((x) => cellOf(x.beats) === cell);
    if (mates.length < PER_CELL) {
      this.list.push(t);
      return { added: true };
    }
    const worst = mates.reduce((a, b) => (this.fitness(a, habits, now) <= this.fitness(b, habits, now) ? a : b));
    if (this.fitness(worst, habits, now) >= this.fitness(t, habits, now)) return { added: false };
    this.list = this.list.filter((x) => x !== worst);
    this.list.push(t);
    return { added: true, evicted: worst };
  }

  /**
   * Tries to come up with one new trick: a parent (a scene, or a trick it knows, the liked ones more
   * often), one to three changes, the check, the grid. Null when nothing good came of it, or when it
   * made one less than three hours ago (pass force to skip that).
   */
  breed(rng: Rng, now: number, habits?: Habits, force = false): BreedResult | null {
    if (!force && now - this.lastBredMs < BREED_GAP_MS) return null;
    this.lastBredMs = now;
    const known = [...SEEDS.map((s) => s.beats), ...this.list.map((t) => t.beats)];
    for (let tries = 1; tries <= 8; tries++) {
      const fromTrick = this.list.length > 0 && rng.next() < 0.5;
      const parent = fromTrick ? this.weightedTrick(rng, habits, now) : null;
      const seed = rng.pick(SEEDS);
      const base = parent ? parent.beats : seed.beats;
      const other = rng.next() < 0.5 ? rng.pick(SEEDS).beats : (this.list.length ? rng.pick(this.list).beats : undefined);
      let beats = copy(base);
      const n = 1 + Math.floor(rng.range(0, 2.99));
      for (let i = 0; i < n; i++) beats = mutate(beats, rng, other);
      if (known.some((k) => distance(k, beats) < 0.25)) continue;
      if (!checkTrick(beats).ok) continue;
      const taken = new Set(this.list.map((t) => t.name));
      const trick: Trick = {
        id: `t${Math.floor(now / 1000).toString(36)}${Math.floor(rng.next() * 46656).toString(36)}`,
        name: nameFor(beats, rng, taken),
        beats,
        kind: kindOf(beats),
        born: { atMs: now, from: [parent ? parent.name : seed.name] },
        shown: 0,
        lastMs: 0,
      };
      const r = this.insert(trick, habits, now);
      if (r.added) return { added: trick, evicted: r.evicted, tries };
    }
    return null;
  }

  private weightedTrick(rng: Rng, habits?: Habits, now?: number): Trick {
    const w = this.list.map((t) => Math.max(0.05, this.fitness(t, habits, now)) ** 2);
    let roll = rng.next() * w.reduce((s, v) => s + v, 0);
    for (let i = 0; i < this.list.length; i++) {
      roll -= w[i] as number;
      if (roll <= 0) return this.list[i] as Trick;
    }
    return this.list[this.list.length - 1] as Trick;
  }

  /** It is doing this trick now. True the first time (then the bubble says "new trick"). */
  shown(id: string, now: number): boolean {
    const t = this.get(id);
    if (!t) return false;
    t.shown++;
    t.lastMs = now;
    return t.shown === 1;
  }

  /** The beats as they play: paced, with the time it takes. */
  script(t: Trick): { beats: Beat[]; seconds: number } {
    const beats = paced(copy(t.beats));
    return { beats, seconds: scriptSeconds(beats) };
  }

  clear(): void {
    this.list = [];
    this.lastBredMs = -Infinity;
  }

  toJSON(): TricksData {
    return { tricks: this.list.map((t) => ({ ...t, beats: copy(t.beats) })), lastBredMs: Number.isFinite(this.lastBredMs) ? this.lastBredMs : undefined };
  }

  /** Reads what toJSON wrote. Every trick is checked again: a hand-edited file can't sneak anything in. */
  load(data: TricksData | undefined): void {
    this.clear();
    if (typeof data?.lastBredMs === "number" && Number.isFinite(data.lastBredMs)) this.lastBredMs = data.lastBredMs;
    if (!Array.isArray(data?.tricks)) return;
    for (const raw of data.tricks.slice(0, MAX_TRICKS * 2)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.beats)) continue;
      const beats = r.beats.slice(0, MAX_BEATS).map(cleanBeat);
      if (beats.some((b) => b === null) || beats.length < 2) continue;
      const clean = beats as Beat[];
      if (this.list.some((t) => t.id === r.id)) continue;
      const born = r.born && typeof r.born === "object" ? (r.born as Record<string, unknown>) : {};
      this.list.push({
        id: r.id.slice(0, 40),
        name: r.name.replace(/[^\w ,'-]/g, "").slice(0, 48) || "a trick",
        beats: clean,
        kind: kindOf(clean),
        born: { atMs: typeof born.atMs === "number" ? born.atMs : 0, from: Array.isArray(born.from) ? born.from.filter((x): x is string => typeof x === "string").slice(0, 3) : [] },
        shown: typeof r.shown === "number" && Number.isFinite(r.shown) ? Math.max(0, Math.floor(r.shown)) : 0,
        lastMs: typeof r.lastMs === "number" && Number.isFinite(r.lastMs) ? r.lastMs : 0,
      });
      if (this.list.length >= MAX_TRICKS) break;
    }
  }
}
