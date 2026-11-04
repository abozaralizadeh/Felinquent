import type { Anim } from "../core/executor";
import { GAIT_STRIDE } from "./gaits";

/**
 * Illustrated sprites (see docs/art-and-ux.md §5). Each character has eleven sheets of nine poses
 * plus eighteen reaction and play poses, two in-betweens
 * after each groom frame (tools/tween-sprites.py), and 76 gait frames rigged from the standing
 * drawing (tools/rig-gait.py): a 32 frame walk, a 24 frame trot and a 20 frame run. This file plays
 * them: it picks frames for each animation, cross-fades between poses and adds squash, turns and
 * breathing in code.
 *
 * draw.ts draws the characters without sprites (and also draws while images load, and in tests,
 * where there is no Image).
 */
const BASE = ["sit", "walk_a", "walk_b", "sleep", "groom", "jump", "crouch", "loaf", "wave"] as const;
const WALK = ["walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "stand"] as const;
const RUN = ["run1", "run2", "run3", "run4", "run5", "run6", "prep", "fall", "land"] as const;
const FACE = ["blink", "yawn", "joy", "sulk", "surprise", "sneeze", "lookup", "meow", "curious"] as const;
const ACTION = ["stretch", "knead_a", "knead_b", "swat_a", "swat_b", "scratch", "chase", "retch", "proud"] as const;
const LIFE = ["sleep_b", "sleep_c", "wake", "dangle", "peek", "box", "gift", "back", "rub"] as const;
const GROOM = ["groom1", "groom2", "groom3", "groom4", "groom5", "groom6", "groom7", "groom8", "groom9"] as const;
const SPIN = ["spin1", "spin2", "spin3", "spin4", "spin5", "spin6", "spin7", "spin8", "spin9"] as const;
const REACT = ["angry", "hiss", "puffed", "annoyed", "flustered", "play_bow", "leap", "belly", "bark"] as const;
const PLAY = ["shy", "beg", "dig", "sniff", "tumble", "sprawl", "howl", "giggle", "startled"] as const;
const SEQ = ["stretch1", "stretch2", "stretch3", "shake", "presneeze", "sneeze2", "dazed", "retch1", "retch2"] as const;
const TRANS = ["stand2", "sitting_down", "sit2", "lowering", "loaf2", "drowsy", "curl", "deep", "waking"] as const;
const EXTRA = ["tiptoe", "perch", "push", "wiggle_a", "wiggle_b", "love", "tail_a", "tail_b", "hop"] as const;

/** In-between frames (tools/tween-sprites.py): `groom1t1` and `groom1t2` sit between groom1 and groom2, and so on. */
type Groom9 = (typeof GROOM)[number];
type TweenKey = `${Groom9}t${1 | 2}`;

/**
 * Gait cycles rigged from the standing drawing (tools/rig-gait.py): a walk in lateral sequence, a trot
 * and a run. Every frame is the same drawing with the legs moved, so nothing flickers.
 */
type GaitKey = `g${"w" | "t" | "r"}${number}`;
const gait = (p: "gw" | "gt" | "gr", n: number): GaitKey[] => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, "0")}` as GaitKey);
const GW = gait("gw", 32);
const GT = gait("gt", 24);
const GR = gait("gr", 20);

/** Every frame of a loop with its in-betweens: n of them after each original. */
function dense<T extends string>(names: readonly T[], n: number): SpriteKey[] {
  return names.flatMap((k) => [k, ...Array.from({ length: n }, (_, i) => `${k}t${i + 1}`)]) as SpriteKey[];
}

export type SpriteKey = TweenKey | GaitKey | (typeof BASE)[number] | (typeof WALK)[number] | (typeof RUN)[number] | (typeof FACE)[number] | (typeof ACTION)[number] | (typeof LIFE)[number] | (typeof EXTRA)[number] | (typeof GROOM)[number] | (typeof SPIN)[number] | (typeof SEQ)[number] | (typeof TRANS)[number] | (typeof REACT)[number] | (typeof PLAY)[number];
const GROOM_LOOP = dense(GROOM, 2);

/** Cut from the sheets but no longer played: the rigged gaits replaced the drawn walk and run, and sitting no longer flicks its tail by swapping drawings. */
const RETIRED = new Set<SpriteKey>(["walk_a", "walk_b", "tail_a", "tail_b", "walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "run1", "run2", "run3", "run4", "run5", "run6"]);

/** Every frame that gets loaded and played. */
export const SPRITE_KEYS: SpriteKey[] = [...BASE, ...WALK, ...RUN, ...FACE, ...ACTION, ...LIFE, ...EXTRA, ...GROOM, ...SPIN, ...SEQ, ...TRANS, ...REACT, ...PLAY, ...GROOM_LOOP.filter((k) => /t\d$/.test(k)), ...GW, ...GT, ...GR].filter((k) => !RETIRED.has(k));

/** Frames that follow each other inside one loop: they swap without a cross-fade. */
const LOOPS: readonly (readonly SpriteKey[])[] = [GW, GT, GR, GROOM_LOOP, SPIN];
const loopOf = new Map<SpriteKey, number>(LOOPS.flatMap((keys, i) => keys.map((k) => [k, i] as [SpriteKey, number])));

/** Characters that have sprite art. The folder is public/sprites/<id>/. */
const SPRITE_CHARACTERS = new Set(["tabby", "inky", "pearl", "mochi", "bandit", "biscuit"]);

/** Cat units per sprite pixel: a sitting sprite ends up about as tall as the code-drawn cat. */
const K = 0.3;

export interface SpriteSet {
  id: string;
  img: Record<SpriteKey, HTMLImageElement>;
}

const sets = new Map<string, SpriteSet | "none">();
const loading = new Map<string, Promise<void>>();

function loadImage(src: string, el: HTMLImageElement, tries = 2): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    el.onload = (): void => resolve(true);
    el.onerror = (): void => {
      if (tries > 1) setTimeout(() => void loadImage(src, el, tries - 1).then(resolve), 150);
      else resolve(false);
    };
    el.src = src;
  });
}

function load(id: string): Promise<void> {
  const have = loading.get(id);
  if (have) return have;
  const img = {} as Record<SpriteKey, HTMLImageElement>;
  // A couple of hundred frames: ask for them a few at a time (a dev server drops a flood), and retry a failure once.
  const queue = [...SPRITE_KEYS];
  const results: boolean[] = [];
  const worker = async (): Promise<void> => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const el = new Image();
      img[key] = el;
      results.push(await loadImage(`./sprites/${id}/${key}.webp`, el));
    }
  };
  const done = Promise.all(Array.from({ length: 12 }, worker)).then(() => {
    sets.set(id, results.every(Boolean) ? { id, img } : "none");
  });
  loading.set(id, done);
  return done;
}

/** The sprite set for a character once every image has loaded, else null (draw it in code). */
export function getSprites(id: string): SpriteSet | null {
  if (!SPRITE_CHARACTERS.has(id) || typeof Image === "undefined") return null;
  const have = sets.get(id);
  if (have && have !== "none") return have;
  if (!have) void load(id);
  return null;
}

/** True while a character that has sprites is still loading them (draw nothing rather than the old art). */
export function spritesPending(id: string): boolean {
  if (!SPRITE_CHARACTERS.has(id) || typeof Image === "undefined") return false;
  return sets.get(id) === undefined;
}

/** Resolves when the sprites of every character that has them are loaded (or have failed). */
export function spritesReady(): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return Promise.all([...SPRITE_CHARACTERS].map(load)).then(() => undefined);
}

/** How a pose moves in code, on top of the drawn frames. */
interface Motion {
  /** Breathing: how much the body squashes and stretches, and how fast. */
  breath: number;
  breathHz: number;
  /** A hop on every step (cat units) and the step rate in steps per second. */
  bounce: number;
  stepHz: number;
  /** Leaning forward while moving, in radians. */
  lean: number;
  /** A rhythmic side to side rock, in radians, and its speed. */
  wobble: number;
  wobbleHz: number;
  /** Now and then a small shift of weight, so a resting cat never looks stuffed. */
  fidget: boolean;
}

const M = (o: Partial<Motion>): Motion => ({ breath: 0.02, breathHz: 2.2, bounce: 0, stepHz: 0, lean: 0, wobble: 0, wobbleHz: 0, fidget: false, ...o });

export interface SpritePlan {
  key: SpriteKey;
  /** Frames of the same group do not pop when they swap (a walk cycle, or blinking while sitting). */
  group: string;
  /** Radians, around the feet. */
  rot?: number;
  /** Turned the other way (looking away from you). */
  flip?: boolean;
  /** The whole body rocks around its middle (chasing its tail). */
  spin?: boolean;
  /** The whole body turns over and over around its middle (a somersault). */
  roll?: boolean;
  /** Where the head is, as a share of the sprite's width and height from its bottom centre. */
  head: { x: number; y: number };
  motion: Motion;
  /** Seconds the cross-fade into a new frame of this pose takes (default 0.24). */
  fade?: number;
}

const HEAD_SIT = { x: 0.1, y: 0.78 };
const HEAD_SIDE = { x: 0.3, y: 0.72 };
const HEAD_LOW = { x: 0.2, y: 0.6 };

const REST = M({ breath: 0.022, fidget: true });
const LOAF = M({ breath: 0.03, fidget: true });
const STILL = M({ breath: 0.015 });

/** The frame at `phase` (0 to 1) of a cycle. */
const pick = <T extends SpriteKey>(names: readonly T[], phase: number): T => names[Math.floor(phase * names.length) % names.length] as T;

/** Plays `names` in a loop at `fps` frames a second. */
const cycle = <T extends SpriteKey>(names: readonly T[], t: number, fps: number): T => names[Math.floor(t * fps) % names.length] as T;

/** A number in [0, 1) made from `n`, the same every time. */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Idle events that follow the clock but come at uneven times, like an animal's. Time is cut into
 * slots of `every` seconds; a slot holds one event of `len` seconds at a random place in it, or none
 * (it has one with chance `p`), so on average one comes every `every / p` seconds. While an event is
 * on it returns its slot number and how many seconds into it we are, else null. `seed` keeps
 * different kinds of event apart.
 */
function eventAt(t: number, every: number, len: number, seed: number, p = 1): { k: number; into: number } | null {
  const k = Math.floor(t / every);
  if (hash(k * 3.1 + seed) >= p) return null;
  const into = t - k * every - hash(k * 7.7 + seed * 1.3) * (every - len);
  return into >= 0 && into < len ? { k, into } : null;
}

/** Sleeping: slow breathing between two frames, and about once a minute a dream. */
function sleeping(t: number): SpriteKey {
  if (eventAt(t, 40, 3, 5, 0.6)) return "sleep_c";
  return (t * 0.45) % 1 < 0.5 ? "sleep" : "sleep_b";
}

/**
 * A sitting cat is calm and mostly still (it breathes). About once every 45 s it looks up, tilts its
 * head, looks proud or yawns, and holds it for 3 s. It blinks about four times a minute, at uneven
 * times, and now and then twice. Real cats blink far less, but a cartoon that never blinks looks
 * stuffed. All of it follows the clock, so every window shows the same thing. (The tail flick frames
 * are a different drawing of the cat, so they are not used here.)
 */
function sitting(t: number): SpriteKey {
  const look = eventAt(t, 22, 3, 1, 0.5);
  if (look) {
    const r = hash(look.k * 5.3 + 2);
    return r < 0.15 ? "yawn" : r < 0.45 ? "lookup" : r < 0.8 ? "curious" : "proud";
  }
  const b = eventAt(t, 12, 0.75, 3, 0.9);
  if (b && (b.into < 0.18 || (hash(b.k * 9.1 + 4) < 0.25 && b.into > 0.45 && b.into < 0.63))) return "blink";
  return "sit";
}

/**
 * `phase` is how far through a walking or running cycle the cat is (0 to 1), driven by distance walked.
 * `trot` swaps the walk for a trot (a fast walker trots, like a dog or a fox does). The gait frames
 * already bob and sway, so no bounce is added in code.
 */
export function planFor(anim: Anim, t: number, vy = 0, phase = 0, trot = false): SpritePlan {
  switch (anim) {
    case "keyboard": return { key: pick(GW, phase), group: "walk", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "walk": return { key: pick(trot ? GT : GW, phase), group: trot ? "trot" : "walk", head: HEAD_SIDE, motion: M({ breath: 0, lean: trot ? 0.01 : 0 }) };
    case "run": return { key: pick(GR, phase), group: "run", head: HEAD_SIDE, motion: M({ breath: 0, lean: 0.02 }) };
    case "jump": return { key: vy > 80 ? "fall" : "jump", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "fall": return { key: "fall", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "land": return { key: "land", group: "land", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 14 }) };
    case "dangle": return { key: "dangle", group: "dangle", head: HEAD_SIT, motion: M({ wobble: 0.05, wobbleHz: 5, breath: 0.01 }) };
    case "peek": return { key: "peek", group: "peek", head: { x: 0.15, y: 0.6 }, motion: M({ breath: 0.02 }) };
    case "box": return { key: "box", group: "box", head: { x: 0.0, y: 0.8 }, motion: M({ breath: 0.015, wobble: 0.01, wobbleHz: 2 }) };
    case "perch": return { key: "perch", group: "perch", head: HEAD_SIT, motion: M({ breath: 0.02, fidget: true }) };
    case "stretch": return { key: "stretch", group: "stretch", head: HEAD_LOW, motion: M({ breath: 0.035, breathHz: 3 }) };
    case "swat":
    case "push_toy": return { key: "push", group: "push", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 7, breath: 0.02 }) };
    case "pounce": return { key: cycle(["wiggle_a", "prep", "wiggle_b", "prep"] as const, t, 5), group: "pounce", head: HEAD_LOW, motion: M({ wobble: 0.015, wobbleHz: 16, breath: 0.02, breathHz: 5 }), fade: 0.08 };
    case "hairball": return { key: cycle(["retch1", "retch2"] as const, t, 2.5), group: "retch", head: HEAD_LOW, motion: M({ wobble: 0.025, wobbleHz: 30, breath: 0.04, breathHz: 12 }), fade: 0.15 };
    case "sleep": return { key: sleeping(t), group: "sleep", head: HEAD_LOW, motion: M({ breath: 0.015, breathHz: 2 }), fade: 0.8 };
    case "knead": return { key: cycle(["knead_a", "knead_b"] as const, t, 2.2), group: "knead", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 5 }), fade: 0.2 };
    case "loaf":
    case "peek": return { key: "loaf", group: "loaf", head: HEAD_LOW, motion: LOAF };
    case "sulk": return { key: "sulk", group: "sulk", head: HEAD_SIT, motion: M({ breath: 0.02 }) };
    case "groom": return { key: (t + 2) % 11 < 2 ? "scratch" : cycle(GROOM_LOOP, t, 12), group: "groom", head: HEAD_SIT, motion: M({ breath: 0.02, breathHz: 4 }) };
    case "happy": return { key: cycle(["wave", "hop", "joy", "hop"] as const, t, 2), group: "happy", head: HEAD_SIT, motion: M({ bounce: 2.5, stepHz: 2, wobble: 0.04, wobbleHz: 4 }), fade: 0.18 };
    case "gift": return { key: "gift", group: "gift", head: HEAD_SIDE, motion: M({ breath: 0.02, fidget: true }) };
    case "purr": return { key: cycle(["joy", "love"] as const, t, 0.5), group: "sit", head: HEAD_SIT, motion: M({ breath: 0.035, breathHz: 6, wobble: 0.012, wobbleHz: 28 }), fade: 0.6 };
    case "headbutt": return { key: "rub", group: "rub", head: HEAD_LOW, motion: M({ wobble: 0.04, wobbleHz: 6, breath: 0.03, breathHz: 5 }) };
    case "sneeze": return { key: "sneeze", group: "sneeze", head: HEAD_SIT, motion: M({ wobble: 0.04, wobbleHz: 44, breath: 0.04, breathHz: 9 }) };
    case "meow": return { key: cycle(["meow", "sit"] as const, t, 1.6), group: "sit", head: HEAD_SIT, motion: REST, fade: 0.15 };
    case "chatter": return { key: cycle(["meow", "sit"] as const, t, 5), group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.03, wobbleHz: 30, breath: 0.03, breathHz: 8 }), fade: 0.08 };
    case "look": return { key: "lookup", group: "sit", head: HEAD_SIT, motion: REST };
    case "stare": return { key: "surprise", group: "sit", head: HEAD_SIT, motion: STILL };
    case "blink": return { key: "blink", group: "sit", head: HEAD_SIT, motion: REST };
    case "turn_away": return { key: "back", group: "back", head: HEAD_SIT, motion: M({ breath: 0.02, fidget: true }) };
    case "chase_tail": return { key: cycle(SPIN, t, 9), group: "chase", head: HEAD_SIT, motion: M({ breath: 0 }) };
    case "angry": return { key: "angry", group: "angry", head: HEAD_SIDE, motion: M({ wobble: 0.012, wobbleHz: 24, breath: 0.03, breathHz: 7 }) };
    case "hiss": return { key: cycle(["hiss", "hiss", "angry"] as const, t, 2.5), group: "angry", head: HEAD_SIDE, motion: M({ wobble: 0.02, wobbleHz: 30, breath: 0.035, breathHz: 9 }), fade: 0.12 };
    case "puffed": return { key: "puffed", group: "angry", head: HEAD_SIDE, motion: M({ wobble: 0.02, wobbleHz: 38, breath: 0.03, breathHz: 10 }) };
    case "annoyed": return { key: "annoyed", group: "sit", head: HEAD_SIT, motion: M({ breath: 0.02, breathHz: 3, wobble: 0.006, wobbleHz: 3 }) };
    case "flustered": return { key: "flustered", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.03, wobbleHz: 26, breath: 0.03, breathHz: 8 }) };
    case "play_bow": return { key: "play_bow", group: "bow", head: HEAD_LOW, motion: M({ wobble: 0.035, wobbleHz: 13, bounce: 1.2, stepHz: 6, breath: 0.03, breathHz: 6 }) };
    case "leap": return { key: "leap", group: "air", head: HEAD_SIDE, motion: M({ breath: 0 }) };
    case "bounce": return { key: vy > 120 ? "land" : "hop", group: "air", head: HEAD_SIT, motion: M({ breath: 0 }) };
    case "belly": return { key: "belly", group: "belly", head: HEAD_LOW, motion: M({ wobble: 0.03, wobbleHz: 6, breath: 0.03, breathHz: 4 }) };
    case "bark": return { key: cycle(["bark", "bark", "sit"] as const, t, 3), group: "bark", head: HEAD_SIT, motion: M({ bounce: 1.5, stepHz: 3, breath: 0.03, breathHz: 8 }), fade: 0.1 };
    case "shy": return { key: "shy", group: "shy", head: HEAD_SIT, motion: M({ breath: 0.02, wobble: 0.01, wobbleHz: 3 }) };
    case "beg": return { key: "beg", group: "beg", head: HEAD_SIT, motion: M({ wobble: 0.025, wobbleHz: 7, breath: 0.025, breathHz: 5 }) };
    case "dig": return { key: "dig", group: "dig", head: HEAD_LOW, motion: M({ wobble: 0.06, wobbleHz: 15, bounce: 1.5, stepHz: 7, breath: 0.02 }) };
    case "sniff": return { key: "sniff", group: "sniff", head: HEAD_LOW, motion: M({ wobble: 0.015, wobbleHz: 9, breath: 0.03, breathHz: 9 }) };
    case "tumble": return { key: "tumble", group: "tumble", head: HEAD_SIT, roll: true, motion: M({ breath: 0 }) };
    case "sprawl": return { key: "sprawl", group: "sprawl", head: HEAD_LOW, motion: M({ breath: 0.025, breathHz: 2 }) };
    case "howl": return { key: "howl", group: "howl", head: HEAD_SIT, motion: M({ breath: 0.04, breathHz: 2.4, wobble: 0.008, wobbleHz: 3 }) };
    case "giggle": return { key: "giggle", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.04, wobbleHz: 21, bounce: 1.5, stepHz: 6, breath: 0.03 }) };
    case "startled": return { key: "startled", group: "startled", head: HEAD_SIDE, motion: M({ wobble: 0.02, wobbleHz: 32, breath: 0.03, breathHz: 10 }) };
    case "proud": return { key: "proud", group: "sit", head: HEAD_SIT, motion: STILL };
    case "curious": return { key: "curious", group: "sit", head: HEAD_SIT, motion: REST };
    case "love": return { key: cycle(["love", "joy"] as const, t, 0.7), group: "sit", head: HEAD_SIT, motion: M({ breath: 0.035, breathHz: 5 }), fade: 0.4 };
    case "yawn": return { key: "yawn", group: "sit", head: HEAD_SIT, motion: M({ breath: 0.04, breathHz: 1.6 }) };
    case "surprise": return { key: "surprise", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.01, wobbleHz: 20, breath: 0.03 }) };
    case "dazed": return { key: "dazed", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.05, wobbleHz: 4, breath: 0.02 }) };
    case "scratch": return { key: "scratch", group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.05, wobbleHz: 17, breath: 0.02 }) };
    default: return { key: sitting(t), group: "sit", head: HEAD_SIT, motion: REST };
  }
}

/** The frame at time `e` seconds into a list of frames and how long each lasts, or null once it is over. */
function timeline(e: number, steps: [SpriteKey, number][]): SpriteKey | null {
  let at = 0;
  for (const [key, sec] of steps) {
    at += sec;
    if (e < at) return key;
  }
  return null;
}

/**
 * Frames that play once when a pose starts: stretching, sneezing, settling down to sleep, waking up,
 * lying down, sitting down after a walk. `prev` is the kind of pose before, `e` seconds since this one began.
 */
function sequenceKey(anim: Anim, plan: SpritePlan, prev: string, e: number): SpriteKey | null {
  const wasMoving = prev === "walk" || prev === "trot" || prev === "run";
  if (plan.group === "stretch") return timeline(e, [["stretch1", 0.5], ["stretch2", 0.6], ["stretch3", 1.8]]) ?? "shake";
  if (anim === "sneeze") return timeline(e, [["presneeze", 0.7], ["sneeze2", 0.35]]) ?? "dazed";
  if (plan.group === "sleep" && prev !== "sleep" && prev !== "") {
    const down: [SpriteKey, number][] = [["sit2", 0.35], ["lowering", 0.5], ["loaf2", 0.55], ["drowsy", 0.8], ["curl", 0.7]];
    return timeline(e, wasMoving ? [["sitting_down", 0.4], ...down] : down);
  }
  if (prev === "sleep" && plan.group !== "sleep" && plan.group !== "dangle") return timeline(e, [["waking", 0.7], ["wake", 0.6]]);
  if (plan.group === "loaf" && prev !== "loaf" && prev !== "sleep" && prev !== "") return timeline(e, [["lowering", 0.5], ["loaf2", 0.45]]);
  if (plan.group === "sit" && wasMoving) return timeline(e, [["sitting_down", 0.4], ["sit2", 0.3]]);
  // Standing up first: the gait frames are made from "stand", so the walk grows out of it.
  if ((plan.group === "walk" || plan.group === "trot" || plan.group === "run") && prev === "sit") return timeline(e, [["stand2", 0.18], ["stand", 0.12]]);
  return null;
}

export interface SpriteDraw {
  sx: number;
  sy: number;
  bob: number;
  /** Vertical speed in pixels a second, positive going down. */
  vy: number;
  /** Forces the position in a walking cycle (for the filmstrip page). */
  phase?: number;
  /** Which drawing of this set it is, when a page draws one character several times. */
  slot?: string;
}

/** How each sprite set moved last: where, how fast, how far through its gait, and its last turn. */
interface Gait {
  x: number | null;
  t: number;
  phase: number;
  /** Ground speed in pixels a second, smoothed. */
  speed: number;
  trot: boolean;
  dir: number;
  turnAt: number;
  turnFrom: number;
}
const gaits = new Map<string, Gait>();

/** What each sprite set showed last, so a new pose can cross-fade in instead of cutting. */
interface Shown {
  key: SpriteKey;
  group: string;
  since: number;
  prev: string;
  from: SpriteKey | null;
  fadeAt: number;
  fade: number;
}
const shown = new Map<string, Shown>();

/** A turn on the spot: the body squeezes narrow and opens up the other way. */
const TURN_SEC = 0.22;
/** Steps a second where a walker breaks into a trot, and where it drops back to a walk. */
const TROT_ABOVE = 2.9;
const WALK_BELOW = 2.5;

/** A frame of the set. Every key is loaded before a set is handed out (see load), so it is never missing. */
const frameOf = (set: SpriteSet, key: SpriteKey): HTMLImageElement => set.img[key] as HTMLImageElement;

const strideOf = (set: SpriteSet, g: "walk" | "trot" | "run"): number => GAIT_STRIDE[set.id]?.[g] ?? 90;
const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * The sprites are drawn about twice as big as most screens show them. A canvas only smooths
 * between neighbouring pixels, so shrinking a lot in one go looks jagged. Halving step by step
 * (and keeping the result) gives a clean picture.
 */
const halved = new Map<HTMLImageElement, Map<number, HTMLCanvasElement>>();
function scaledFor(img: HTMLImageElement, targetPx: number): CanvasImageSource {
  const levels = Math.max(0, Math.floor(Math.log2(img.naturalWidth / Math.max(1, targetPx))));
  if (levels === 0 || typeof document === "undefined") return img;
  let byLevel = halved.get(img);
  if (!byLevel) halved.set(img, (byLevel = new Map()));
  const have = byLevel.get(levels);
  if (have) return have;
  let src: CanvasImageSource = img;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let out = img as unknown as HTMLCanvasElement;
  for (let i = 0; i < levels; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, 0, w, h);
    src = c;
    out = c;
  }
  byLevel.set(levels, out);
  return out;
}

const blendCanvas = new WeakMap<SpriteSet, HTMLCanvasElement>();

/**
 * Two frames mixed, `k` of the new one, feet on the bottom edge and centred like a single frame.
 * They are added in premultiplied colour ("lighter"), so where both are solid the result is solid
 * too: a cross-fade with no see-through moment in the middle.
 */
function blend(set: SpriteSet, a: HTMLImageElement, b: HTMLImageElement, k: number, ppu: number): { src: CanvasImageSource; w: number; h: number } {
  const wa = a.naturalWidth * K;
  const ha = a.naturalHeight * K;
  const wb = b.naturalWidth * K;
  const hb = b.naturalHeight * K;
  const w = Math.max(wa, wb);
  const h = Math.max(ha, hb);
  let c = blendCanvas.get(set);
  if (!c) blendCanvas.set(set, (c = document.createElement("canvas")));
  const cw = Math.max(1, Math.ceil(w * ppu));
  const ch = Math.max(1, Math.ceil(h * ppu));
  if (c.width !== cw || c.height !== ch) {
    c.width = cw;
    c.height = ch;
  }
  const cx = c.getContext("2d") as CanvasRenderingContext2D;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = "source-over";
  cx.globalAlpha = 1;
  cx.clearRect(0, 0, cw, ch);
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = "high";
  cx.globalAlpha = 1 - k;
  cx.drawImage(scaledFor(a, wa * ppu), ((w - wa) / 2) * ppu, (h - ha) * ppu, wa * ppu, ha * ppu);
  cx.globalCompositeOperation = "lighter";
  cx.globalAlpha = k;
  cx.drawImage(scaledFor(b, wb * ppu), ((w - wb) / 2) * ppu, (h - hb) * ppu, wb * ppu, hb * ppu);
  cx.globalCompositeOperation = "source-over";
  cx.globalAlpha = 1;
  return { src: c, w, h };
}

/** Draws the sprite with its feet at body.x, body.y. Returns the head position in cat units. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  set: SpriteSet,
  facing: number,
  anim: Anim,
  x: number,
  y: number,
  scale: number,
  t: number,
  d: SpriteDraw,
): { x: number; y: number } {
  const slot = `${set.id}/${d.slot ?? ""}`;
  let g = gaits.get(slot);
  if (!g) gaits.set(slot, (g = { x: null, t, phase: 0, speed: 0, trot: false, dir: facing, turnAt: -1e9, turnFrom: facing }));
  const moving = anim === "walk" || anim === "run" || anim === "keyboard";
  const dx = g.x === null ? 0 : Math.abs(x - g.x);
  const dt = t - g.t;
  if (dt > 0 && dx < 60) g.speed += (dx / dt - g.speed) * Math.min(1, dt * 6);
  // One sprite pixel is K * scale screen pixels. A walker that would step too fast breaks into a trot.
  const px = K * scale;
  if (anim === "walk") {
    const hz = g.speed / (strideOf(set, "walk") * px);
    if (!g.trot && hz > TROT_ABOVE) g.trot = true;
    else if (g.trot && hz < WALK_BELOW) g.trot = false;
  }
  const which = anim === "run" ? "run" : anim === "walk" && g.trot ? "trot" : "walk";
  if (d.phase !== undefined) g.phase = d.phase;
  else if (moving && dx > 0 && dx < 60) {
    // The cycle advances by the distance walked over the stride the gait was made with, so a planted
    // foot stays put on the ground. The keyboard walk is a tiptoe: shorter steps.
    g.phase = (g.phase + dx / (strideOf(set, which) * px * (anim === "keyboard" ? 0.7 : 1))) % 1;
  }
  g.x = x;
  g.t = t;
  const plan = planFor(anim, t, d.vy, g.phase, which === "trot");
  const m = plan.motion;

  // Turning round: squeeze, swap sides, open up, instead of a mirror flip in one frame.
  const dir = plan.flip ? -facing : facing;
  if (dir !== g.dir) {
    g.turnFrom = g.dir;
    g.turnAt = t;
    g.dir = dir;
  }
  const tau = (t - g.turnAt) / TURN_SEC;
  const xs = tau >= 0 && tau < 1 ? (tau < 0.5 ? g.turnFrom : dir) * Math.max(0.12, Math.abs(Math.cos(Math.PI * tau))) : dir;

  // The pose: a one-off sequence when the kind of pose changes, then the pose's own frames. A new
  // frame cross-fades in, except between frames of one loop (a gait, grooming, spinning).
  let sh = shown.get(slot);
  if (!sh) shown.set(slot, (sh = { key: plan.key, group: plan.group, since: -1e9, prev: "", from: null, fadeAt: -1e9, fade: 0 }));
  if (sh.group !== plan.group) {
    sh.prev = sh.group;
    sh.group = plan.group;
    sh.since = t;
  }
  const key: SpriteKey = sequenceKey(anim, plan, sh.prev, t - sh.since) ?? plan.key;
  if (key !== sh.key) {
    const loop = loopOf.get(key);
    if (loop === undefined || loop !== loopOf.get(sh.key)) {
      const gaitToGait = /^g[wtr]\d/.test(key) && /^g[wtr]\d/.test(sh.key);
      sh.from = sh.key;
      sh.fadeAt = t;
      sh.fade = key === "blink" || sh.key === "blink" ? 0.06 : gaitToGait ? 0.12 : (plan.fade ?? 0.24);
    }
    sh.key = key;
  }
  const k = sh.from !== null && t - sh.fadeAt < sh.fade ? smooth(Math.max(0, (t - sh.fadeAt) / sh.fade)) : 1;
  if (k >= 1) sh.from = null;
  const img = frameOf(set, key);
  const w = img.naturalWidth * K;
  const h = img.naturalHeight * K;

  // Breathing, steps, rocking and the occasional fidget.
  const breath = Math.sin(t * m.breathHz) * m.breath;
  // A hop on the clock for bouncy poses. The gaits bob in their own frames.
  let hop = !moving && m.stepHz ? Math.abs(Math.sin(Math.PI * t * m.stepHz)) * m.bounce : 0;
  let rot = (plan.rot ?? 0) + m.lean + (m.wobbleHz ? Math.sin(t * m.wobbleHz) * m.wobble : 0);
  // About every half minute, at uneven times, it shifts its weight a little.
  const shift = m.fidget ? eventAt(t, 18, 0.9, 9, 0.6) : null;
  if (shift) {
    const ph = shift.into / 0.9;
    rot += Math.sin(ph * Math.PI * 2) * 0.025 * (1 - ph);
    hop += Math.sin(ph * Math.PI) * 0.8;
  }
  const sx = d.sx * (1 - breath * 0.5);
  const sy = d.sy * (1 + breath);

  const deviceScale = ctx.getTransform();
  const ppu = scale * Math.hypot(deviceScale.a, deviceScale.b);
  ctx.save();
  ctx.translate(x, y + (d.bob - hop) * scale);
  ctx.rotate(rot * Math.sign(xs));
  ctx.scale(scale * xs * sx, scale * sy);
  if (plan.spin) {
    ctx.translate(0, -h / 2);
    ctx.rotate(Math.sin(t * 9) * 0.35);
    ctx.translate(0, h / 2);
  }
  if (plan.roll) {
    // Over and over around the middle, with the feet still the pivot of the placement.
    ctx.translate(0, -h / 2);
    ctx.rotate(t * 13);
    ctx.translate(0, h / 2);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (k < 1 && sh.from !== null) {
    const b = blend(set, frameOf(set, sh.from), img, k, ppu);
    ctx.drawImage(b.src, -b.w / 2, -b.h, b.w, b.h);
  } else {
    ctx.drawImage(scaledFor(img, w * ppu), -w / 2, -h, w, h);
  }
  ctx.restore();
  // The head, upright and in the direction the cat is facing, for hearts and other effects.
  return { x: plan.head.x * w, y: -plan.head.y * h };
}

/** The width of the current sprite in cat units (for the soft shadow). */
export function spriteWidth(set: SpriteSet, anim: Anim, t: number): number {
  const key = planFor(anim, t).key;
  // Gait frames have room around the drawing for the legs, so the shadow goes by the standing pose.
  const img = frameOf(set, /^g[wtr]\d/.test(key) ? "stand" : key);
  return img.naturalWidth * K;
}
