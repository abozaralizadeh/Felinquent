import type { BoutKind } from "./bouts";
import type { Anim, Beat } from "./executor";
import type { Activity, Approach, Intent, Mood, Needs, WorldSnapshot } from "./types";

/**
 * A character's own moves as data (ADR-078). A package can bring drawings of its own (a chip held up
 * like a trophy, a cricket shot) and say in `character.json` how to play them, with no code:
 *
 * - `poses`: named little animations made of its drawings. Each is a list of steps played once
 *   (`play`), then a list played over and over (`loop`) for as long as the move lasts. A step holds a
 *   drawing, glides through a few (with the in-betweens made for that pair, when there are any),
 *   swaps through them one by one, hops one up off the ground, or shakes one.
 * - `moves`: what the animal can choose to do, each with what it means (for the model), which bout
 *   it belongs to, how much it likes it, when it fits best (a mood, what you are doing, an hour, how
 *   much energy it has, being near you), what to say, and the beats: walk somewhere, then do a pose.
 *
 * The rules score a move like any other (with a boost when it fits the moment), the model gets every
 * move by its own name with what it means, and the mind turns a chosen move into a scripted scene.
 * Nothing in a package runs: these are only names and numbers, checked here.
 */

/** One step of a pose. Times in seconds; a hop's height and a shake's size in sprite pixels and radians. */
export type PoseStep =
  | readonly ["hold", string, number]
  | readonly ["move", readonly string[], number]
  | readonly ["steps", readonly string[], number]
  | readonly ["hop", string, number, number]
  | readonly ["shake", string, number, number?];

export interface PoseDef {
  play: readonly PoseStep[];
  loop: readonly PoseStep[];
  /** What it stands on: a pose that starts from "sit" is a sitting pose. */
  base: "stand" | "sit";
}

/** Something a move gives off (drawn on the animal's own layer, like a shake's fur). */
export const ACT_FX = ["spark", "heart", "smoke", "sweat", "dust"] as const;
export type ActFx = (typeof ACT_FX)[number];

/** When a move fits best. Every part is optional; a move with none fits any time. */
export interface ActWhen {
  moods?: Mood[];
  /** What your human is doing. */
  human?: Activity[];
  /** From and to, local hours (22 to 6 goes over midnight). */
  hours?: [number, number];
  energy?: "low" | "high";
  /** Close to your pointer. */
  near?: "cursor";
}

export type ActBeat =
  | { do: string; sec: number; face?: "cursor" | "away"; fx?: ActFx; fxAt?: number }
  | { go: "cursor" | "away" | "stroll"; by: number; speed: Approach; anim?: "walk" | "run" };

export interface ActDef {
  id: string;
  /** What it means, for the model: "hold up a shiny new chip like at a keynote". */
  means: string;
  bout: BoutKind;
  /** How much it likes this move, 0 to 5 (1 is like any other move). */
  weight: number;
  when: ActWhen;
  beats: readonly ActBeat[];
  /** Lines for its thought bubble while it does it. */
  say: readonly string[];
  /** Not again within this many minutes. */
  restMin: number;
}

/** The built-in poses a move's beat may use besides its own (every character has these drawn). */
export const SHARED_POSES: ReadonlySet<string> = new Set<Anim>([
  "happy", "proud", "idle_sit", "look", "stretch", "yawn", "love", "giggle", "startled", "annoyed", "sulk", "beg", "bark", "howl",
  "meow", "sniff", "stare", "blink", "wag", "curious", "surprise", "flustered", "shy", "play_bow", "belly", "sprawl", "dazed", "purr",
  "gift", "loaf", "sleep", "watch", "watch_stand",
]);

const KEY = /^[a-z0-9_]{1,32}$/;
const MOODS: readonly Mood[] = ["content", "curious", "playful", "sleepy", "grumpy", "sulky", "smug"];
const ACTIVITIES: readonly Activity[] = ["typing_fast", "typing", "reading", "idle", "away"];
const BOUTS: readonly BoutKind[] = ["rest", "explore", "play", "social", "mischief"];
const SPEEDS: readonly Approach[] = ["walk", "saunter", "sneak", "run"];
/** How many poses and moves a package may have, and steps and beats in one. */
export const MAX_POSES = 40;
export const MAX_MOVES = 16;
const MAX_STEPS = 24;
const MAX_BEATS = 8;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function secs(v: unknown, what: string, lo = 0.03, hi = 30): number {
  if (!num(v) || v < lo || v > hi) throw new Error(`${what} must be a number of seconds from ${lo} to ${hi}`);
  return v;
}

function frame(v: unknown, what: string): string {
  if (typeof v !== "string" || !KEY.test(v)) throw new Error(`${what} must be a frame name (lowercase letters, digits and _)`);
  return v;
}

function step(v: unknown, what: string): PoseStep {
  if (!Array.isArray(v) || typeof v[0] !== "string") throw new Error(`${what} must be a list like ["hold", "sit", 1]`);
  const [k, a, b, c] = v as unknown[];
  switch (k) {
    case "hold":
      return ["hold", frame(a, `${what} frame`), secs(b, `${what} time`)];
    case "move":
    case "steps": {
      if (!Array.isArray(a) || a.length < 2 || a.length > 12) throw new Error(`${what} needs a list of 2 to 12 frames`);
      return [k, a.map((f, i) => frame(f, `${what} frame ${i + 1}`)), secs(b, `${what} time`)];
    }
    case "hop":
      if (!num(c) || c < 0 || c > 300) throw new Error(`${what} height must be 0 to 300`);
      return ["hop", frame(a, `${what} frame`), secs(b, `${what} time`), c];
    case "shake":
      if (c !== undefined && (!num(c) || c < 0 || c > 0.3)) throw new Error(`${what} size must be 0 to 0.3`);
      return ["shake", frame(a, `${what} frame`), secs(b, `${what} time`), (c as number | undefined) ?? 0.05];
    default:
      throw new Error(`${what} must start with hold, move, steps, hop or shake`);
  }
}

/** Reads `poses` from character.json. Throws an Error that says what is wrong. */
export function parsePoses(v: unknown): Record<string, PoseDef> {
  if (v === undefined) return {};
  if (!isObj(v)) throw new Error("poses must be an object of pose names");
  const out: Record<string, PoseDef> = {};
  for (const [name, p] of Object.entries(v).slice(0, MAX_POSES)) {
    if (!KEY.test(name)) throw new Error(`pose ${name}: a name is lowercase letters, digits and _`);
    if (!isObj(p)) throw new Error(`pose ${name} must be an object with play and loop`);
    const list = (x: unknown, part: string): PoseStep[] => {
      if (x === undefined) return [];
      if (!Array.isArray(x) || x.length > MAX_STEPS) throw new Error(`pose ${name}: ${part} must be a list of up to ${MAX_STEPS} steps`);
      return x.map((s, i) => step(s, `pose ${name} ${part} step ${i + 1}`));
    };
    const play = list(p.play, "play");
    const loop = list(p.loop, "loop");
    if (play.length === 0 && loop.length === 0) throw new Error(`pose ${name} has no steps`);
    const base = p.base ?? "stand";
    if (base !== "stand" && base !== "sit") throw new Error(`pose ${name}: base must be "stand" or "sit"`);
    out[name] = { play, loop, base };
  }
  return out;
}

function when(v: unknown, what: string): ActWhen {
  if (v === undefined) return {};
  if (!isObj(v)) throw new Error(`${what} must be an object`);
  const w: ActWhen = {};
  if (v.moods !== undefined) {
    if (!Array.isArray(v.moods) || !v.moods.every((m) => (MOODS as readonly unknown[]).includes(m))) throw new Error(`${what}.moods must be a list of ${MOODS.join(", ")}`);
    w.moods = v.moods as Mood[];
  }
  if (v.human !== undefined) {
    if (!Array.isArray(v.human) || !v.human.every((m) => (ACTIVITIES as readonly unknown[]).includes(m))) throw new Error(`${what}.human must be a list of ${ACTIVITIES.join(", ")}`);
    w.human = v.human as Activity[];
  }
  if (v.hours !== undefined) {
    const h = v.hours;
    if (!Array.isArray(h) || h.length !== 2 || !h.every((x) => num(x) && x >= 0 && x <= 24)) throw new Error(`${what}.hours must be [from, to], 0 to 24`);
    w.hours = [h[0] as number, h[1] as number];
  }
  if (v.energy !== undefined) {
    if (v.energy !== "low" && v.energy !== "high") throw new Error(`${what}.energy must be "low" or "high"`);
    w.energy = v.energy;
  }
  if (v.near !== undefined) {
    if (v.near !== "cursor") throw new Error(`${what}.near can only be "cursor"`);
    w.near = "cursor";
  }
  return w;
}

/**
 * Reads `moves` from character.json, against its poses. `taken` are names it can't use (the
 * built-in moves): a move called "nap" would be ambiguous for the model.
 */
export function parseActs(v: unknown, poses: Record<string, PoseDef>, taken: ReadonlySet<string>): ActDef[] {
  if (v === undefined) return [];
  if (!isObj(v)) throw new Error("moves must be an object of move names");
  const out: ActDef[] = [];
  for (const [id, m] of Object.entries(v).slice(0, MAX_MOVES)) {
    const what = `move ${id}`;
    if (!KEY.test(id)) throw new Error(`${what}: a name is lowercase letters, digits and _`);
    if (taken.has(id)) throw new Error(`${what}: that name is a built-in move, pick another`);
    if (!isObj(m)) throw new Error(`${what} must be an object`);
    if (typeof m.means !== "string" || !m.means.trim() || m.means.length > 90) throw new Error(`${what}: means must be some text, up to 90 characters`);
    if (!(BOUTS as readonly unknown[]).includes(m.bout)) throw new Error(`${what}: bout must be one of ${BOUTS.join(", ")}`);
    const weight = m.weight ?? 1;
    if (!num(weight) || weight < 0 || weight > 5) throw new Error(`${what}: weight must be 0 to 5`);
    if (!Array.isArray(m.beats) || m.beats.length === 0 || m.beats.length > MAX_BEATS) throw new Error(`${what}: beats must be a list of 1 to ${MAX_BEATS}`);
    const beats: ActBeat[] = m.beats.map((b, i): ActBeat => {
      const bw = `${what} beat ${i + 1}`;
      if (!isObj(b)) throw new Error(`${bw} must be an object`);
      if (b.go !== undefined) {
        if (b.go !== "cursor" && b.go !== "away" && b.go !== "stroll") throw new Error(`${bw}: go must be "cursor", "away" or "stroll"`);
        if (!num(b.by) || b.by < 20 || b.by > 1200) throw new Error(`${bw}: by must be 20 to 1200 pixels`);
        const speed = b.speed ?? "walk";
        if (!(SPEEDS as readonly unknown[]).includes(speed)) throw new Error(`${bw}: speed must be one of ${SPEEDS.join(", ")}`);
        if (b.anim !== undefined && b.anim !== "walk" && b.anim !== "run") throw new Error(`${bw}: anim must be "walk" or "run"`);
        return { go: b.go, by: b.by, speed: speed as Approach, ...(b.anim ? { anim: b.anim as "walk" | "run" } : {}) };
      }
      if (typeof b.do !== "string" || !(b.do in poses || SHARED_POSES.has(b.do))) throw new Error(`${bw}: do must be one of its poses or a shared one (${[...SHARED_POSES].slice(0, 6).join(", ")}...)`);
      const sec = secs(b.sec, `${bw} sec`, 0.2, 30);
      if (b.face !== undefined && b.face !== "cursor" && b.face !== "away") throw new Error(`${bw}: face must be "cursor" or "away"`);
      if (b.fx !== undefined && !(ACT_FX as readonly unknown[]).includes(b.fx)) throw new Error(`${bw}: fx must be one of ${ACT_FX.join(", ")}`);
      const fxAt = b.fx_at ?? b.fxAt;
      if (fxAt !== undefined && (!num(fxAt) || fxAt < 0 || fxAt > sec)) throw new Error(`${bw}: fx_at must be 0 to its sec`);
      return {
        do: b.do,
        sec,
        ...(b.face ? { face: b.face as "cursor" | "away" } : {}),
        ...(b.fx ? { fx: b.fx as ActFx } : {}),
        ...(fxAt !== undefined ? { fxAt: fxAt as number } : {}),
      };
    });
    if (!beats.some((b) => "do" in b)) throw new Error(`${what}: at least one beat must do a pose`);
    const say = Array.isArray(m.say) ? m.say.filter((l): l is string => typeof l === "string" && l.trim().length > 0 && l.length <= 90).slice(0, 8) : [];
    const restMin = m.rest_min ?? m.restMin ?? 10;
    if (!num(restMin) || restMin < 0 || restMin > 600) throw new Error(`${what}: rest_min must be 0 to 600 minutes`);
    out.push({ id, means: m.means.trim(), bout: m.bout as BoutKind, weight, when: when(m.when, `${what} when`), beats, say, restMin });
  }
  return out;
}

/** How well a move fits right now: a multiplier for its score, and whether it fits on purpose (all its conditions met). */
export function actFit(a: ActDef, world: WorldSnapshot, needs: Needs, catDist: number): { mult: number; fits: boolean } {
  const w = a.when;
  let mult = 1;
  let any = false;
  let all = true;
  const check = (ok: boolean, yes: number, no: number): void => {
    any = true;
    if (ok) mult *= yes;
    else {
      mult *= no;
      all = false;
    }
  };
  if (w.moods) check(w.moods.includes(needs.mood), 1.5, 0.4);
  if (w.human) check(w.human.includes(world.activity), 1.5, 0.5);
  if (w.hours) {
    const [from, to] = w.hours;
    const h = world.hour;
    check(from <= to ? h >= from && h < to : h >= from || h < to, 1.7, 0.25);
  }
  if (w.energy) check(w.energy === "low" ? needs.energy < 0.45 : needs.energy > 0.6, 1.5, 0.45);
  if (w.near) check(catDist < 700, 1.3, 0.5);
  return { mult, fits: any && all };
}

/** Pixels a second, as the executor walks (executor.ts SPEED). */
const SPEED: Record<Approach, number> = { walk: 64, saunter: 42, sneak: 28, run: 230 };

/** The anim that plays one of its own poses (sprites.ts plays the pose's steps). */
export const poseAnim = (name: string): Anim => `pose:${name}` as Anim;

/** The scripted scene of a move, and about how long it lasts. */
export function actScript(a: ActDef, poses: Record<string, PoseDef>): { beats: Beat[]; seconds: number } {
  let seconds = 0;
  const beats = a.beats.map((b): Beat => {
    if ("go" in b) {
      seconds += b.by / SPEED[b.speed] + 0.6;
      return { go: b.go, by: b.by, speed: b.speed, ...(b.anim ? { anim: b.anim } : {}) };
    }
    seconds += b.sec;
    return {
      do: b.do in poses ? poseAnim(b.do) : (b.do as Anim),
      sec: b.sec,
      ...(b.face ? { face: b.face } : {}),
      ...(b.fx ? { fx: { fx: "act" as const, kind: b.fx } } : {}),
      ...(b.fxAt !== undefined ? { fxAt: b.fxAt } : {}),
    };
  });
  return { beats, seconds };
}

const BOUT_MOOD: Record<BoutKind, Mood> = { rest: "content", explore: "curious", play: "playful", social: "content", mischief: "smug" };

/** A chosen move as an intent with its scene. `line`: a thought from the model, kept over its own lines. */
export function actIntent(a: ActDef, poses: Record<string, PoseDef>, base: Intent, sayLine: string | null): Intent {
  const { beats, seconds } = actScript(a, poses);
  const out: Intent = { ...base, intent: "act", act: a.id, script: beats, stay_sec: Math.ceil(seconds), mood: BOUT_MOOD[a.bout] };
  if (!base.thought && sayLine) out.thought = sayLine;
  return out;
}

/** The name an option goes by for the model: a move's own name ("keynote"), or the intent's. */
export const optionName = (o: { intent: string; act?: string }): string => o.act ?? o.intent;
