import type { Beat } from "./executor";
import type { Rng } from "./rng";
import type { IntentName } from "./types";

/** Short ways to write a beat. */
export const doing = (anim: Extract<Beat, { do: unknown }>["do"], sec: number, face?: "cursor" | "away"): Beat => ({ do: anim, sec, face });
export const go = (to: "cursor" | "away" | "stroll", by: number, speed: "walk" | "saunter" | "sneak" | "run", anim?: Extract<Beat, { go: unknown }>["anim"]): Beat => ({ go: to, by, speed, anim });
export const leap = (to: "cursor" | "away" | "ahead" | "stroll", by: number, h: number, anim?: Extract<Beat, { leap: unknown }>["anim"]): Beat => ({ leap: to, by, h, anim });

/** Quick by nature: a flinch, a puff of fur, a paw. */
const FLINCH: ReadonlySet<string> = new Set(["surprise", "startled", "puffed", "swat"]);
/** Poses a scene can end on without a calm beat after it. */
const CALM_END: ReadonlySet<string> = new Set(["turn_away", "sulk", "sprawl", "groom", "blink", "idle_sit", "yawn", "loaf", "sleep"]);

/**
 * Every scene and reaction goes through this, so it plays at an animal's pace: each pose is held long
 * enough to read (a flinch can be quick, nothing else is under a second), and a scene that ends on
 * something lively ends with the animal just sitting a moment, so it does not jump into the next thing.
 */
export function paced(beats: Beat[]): Beat[] {
  const out = beats.map((b): Beat => ("do" in b ? { ...b, sec: Math.max(b.sec * 1.3, FLINCH.has(b.do) ? 0.6 : 1.1) } : b));
  const last = out[out.length - 1];
  if (!last || !("do" in last) || !CALM_END.has(last.do)) out.push(doing("idle_sit", 1.8));
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

function rawScene(intent: IntentName, staySec: number, rng: Rng): Beat[] | null {
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
      return [doing("scratch", rng.range(3, 5.5)), doing("stretch", 2)];
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
    default:
      return null;
  }
}
