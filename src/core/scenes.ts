import type { Beat, Fx } from "./executor";
import type { Rng } from "./rng";
import type { IntentName } from "./types";

/** How long an ear scratch with a hind leg takes, start to end (src/playground/sprites.ts plays it). */
export const SCRATCH_SEC = 4.8;

/** Short ways to write a beat. */
export const doing = (anim: Extract<Beat, { do: unknown }>["do"], sec: number, face?: "cursor" | "away", fx?: Fx, fxAt?: number): Beat => ({ do: anim, sec, face, ...(fx ? { fx, fxAt } : {}) });
export const go = (to: "cursor" | "away" | "stroll", by: number, speed: "walk" | "saunter" | "sneak" | "run", anim?: Extract<Beat, { go: unknown }>["anim"]): Beat => ({ go: to, by, speed, anim });
export const leap = (to: "cursor" | "away" | "ahead" | "stroll", by: number, h: number, anim?: Extract<Beat, { leap: unknown }>["anim"]): Beat => ({ leap: to, by, h, anim });

/** Quick by nature: a flinch, a puff of fur, a paw. */
const FLINCH: ReadonlySet<string> = new Set(["surprise", "startled", "puffed", "swat"]);
/**
 * How much longer than written each pose of a scene is held, and the shortest holds. Abozar found the
 * actions "very fast" on the real screen (6 Nov 2026), so a pose now stays at least 1.4 s (a flinch
 * 0.7 s): long enough to see what the animal is doing before it does the next thing.
 */
export const HOLD = 1.5;
export const MIN_HOLD = 1.4;
export const MIN_FLINCH = 0.7;
/** Poses a scene can end on without a calm beat after it. */
const CALM_END: ReadonlySet<string> = new Set(["turn_away", "sulk", "sprawl", "groom", "blink", "idle_sit", "yawn", "loaf", "sleep"]);

/**
 * Every scene and reaction goes through this, so it plays at an animal's pace: each pose is held long
 * enough to read (a flinch can be quick, nothing else is under 1.4 s), and a scene that ends on
 * something lively ends with the animal just sitting a moment, so it does not jump into the next thing.
 */
export function paced(beats: Beat[]): Beat[] {
  const out = beats.map((b): Beat => ("do" in b ? { ...b, sec: Math.max(b.sec * HOLD, FLINCH.has(b.do) ? MIN_FLINCH : MIN_HOLD) } : b));
  const last = out[out.length - 1];
  if (!last || !("do" in last) || !CALM_END.has(last.do)) out.push(doing("idle_sit", 2.6));
  return out;
}

/**
 * The little routines behind the playful and animal-like behaviors. Each one is a list of beats, so a
 * cat that rolls over, digs or gets spooked does a real sequence (a build-up, the thing, a finish)
 * instead of holding one pose. Returns null for intents the executor already knows how to run.
 */
export function sceneFor(intent: IntentName, staySec: number, rng: Rng): Beat[] | null {
  const beats = rawScene(intent, staySec, rng);
  return beats ? paced(beats) : null;
}

/** The same scenes before pacing: the trick library (tricks.ts) breeds new tricks from these. */
export function rawScene(intent: IntentName, staySec: number, rng: Rng): Beat[] | null {
  switch (intent) {
    case "roll":
      return [doing("play_bow", 1), doing("belly", rng.range(2.5, 5)), doing("love", 1.2), doing("happy", 1.4)];
    case "bounce": {
      const beats: Beat[] = [];
      const n = Math.round(rng.range(3, 6));
      for (let i = 0; i < n; i++) beats.push(leap(i % 2 ? "ahead" : "stroll", rng.range(30, 70), rng.range(40, 60), "bounce"));
      beats.push(doing("happy", 1.2));
      return beats;
    }
    case "sniff": {
      // Nose down for a good while at each spot, then a slow few steps to the next one.
      const beats: Beat[] = [doing("curious", 0.8)];
      let t = 0;
      for (let i = 0; i < 4 && t < Math.min(staySec, 24); i++) {
        const by = rng.range(80, 200);
        beats.push(go("stroll", by, "saunter"), doing("sniff", rng.range(2.5, 4.5)));
        t += by / 40 + 3.5;
      }
      beats.push(rng.next() < 0.5 ? doing("surprise", 0.5) : doing("proud", 1));
      return beats;
    }
    case "dig":
      return [doing("sniff", 1.2), doing("dig", rng.range(3, 5.5)), doing("proud", 1.4)];
    case "howl":
      return [doing("look", 0.8), doing("howl", rng.range(3, 4.5)), doing("happy", 1.2)];
    case "scratch":
      // An ear scratch with a hind leg (sprites.ts plays it), then it licks the paw a little.
      return [doing("scratch", SCRATCH_SEC), doing("groom", rng.range(2.2, 3.4))];
    case "beg":
      return [doing("curious", 0.8, "cursor"), doing("beg", rng.range(3, 5), "cursor"), doing("love", 1.5, "cursor"), doing("happy", 1.2)];
    case "spook":
      // Spooked by nothing at all, which is the most cat thing there is.
      return [doing("surprise", 0.35), doing("puffed", 0.6), leap("away", 70, 50, "leap"), go("away", 220, "run"), doing("curious", 1.2, "cursor"), doing("groom", 2.5)];
    case "sprawl":
      return [doing("sprawl", Math.max(6, staySec)), doing("yawn", 1.6)];
    case "tumble":
      return [doing("play_bow", 0.9), go("stroll", rng.range(120, 220), "run", "tumble"), doing("giggle", 1.8), doing("happy", 1.2)];
    case "shy":
      return [doing("shy", rng.range(2, 3.2)), doing("curious", 0.9), doing("shy", 1.4), doing("blink", 1.2)];
    case "invite_play":
      // Come over, bow with the bottom up, spring back and bow again: "chase me".
      return [go("cursor", 420, "run"), doing("play_bow", 1.2, "cursor"), leap("away", 55, 35, "bounce"), doing("play_bow", 1, "cursor"), doing("happy", 1, "cursor"), doing("watch_stand", 1.2, "cursor")];
    case "yawn":
      return [doing("yawn", 1.8), doing("blink", 1.2), doing("idle_sit", 1)];
    case "look_around":
      // Sitting up and taking in the room: up, along, at you, down (sprites.ts plays the look).
      return [doing("look", Math.max(6, Math.min(12, staySec)))];
    default:
      return null;
  }
}
