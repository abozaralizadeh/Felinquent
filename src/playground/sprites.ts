import { TURN_SEC, type Anim } from "../core/executor";
import { SCRATCH_SEC } from "../core/scenes";
import { GAIT_STRIDE } from "./gaits";

/**
 * Illustrated sprites (see docs/art-and-ux.md §5). Each character has fourteen sheets of drawn
 * poses, flow in-betweens between drawings that follow each other (tools/tween-sprites.py), licks
 * made by nodding one drawing (tools/nod-sprites.py) and 76 gait frames rigged from the standing
 * drawing (tools/rig-gait.py): a 32 frame walk, a 24 frame trot and a 20 frame run. This file plays
 * them. It picks the frames for each animation, glides between neighbouring frames (so motion is
 * smooth at any frame rate), cross-fades between poses that are not neighbours, plays turning round,
 * washing and the ear scratch as little programs, and adds breathing in code.
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
const SCRATCH = ["scratch1", "scratch2", "scratch3", "scratch4", "scratch5", "scratch6", "scratch7", "scratch8", "scratch9"] as const;
/** Turning round: standing (s) and sitting (t), head round, three quarters, front, then the far side mirrored. */
const TURN = ["turn_s1", "turn_s2", "turn_s3", "turn_s4", "turn_s5", "turn_t1", "turn_t2", "turn_t3", "turn_t4", "turn_t5", "slow_blink"] as const;

type Drawn =
  | (typeof BASE)[number] | (typeof WALK)[number] | (typeof RUN)[number] | (typeof FACE)[number] | (typeof ACTION)[number] | (typeof LIFE)[number]
  | (typeof EXTRA)[number] | (typeof GROOM)[number] | (typeof SPIN)[number] | (typeof SEQ)[number] | (typeof TRANS)[number] | (typeof REACT)[number]
  | (typeof PLAY)[number] | (typeof SCRATCH)[number] | (typeof TURN)[number];
/**
 * Frames made from the drawings: `groom1t1` and `groom1t2` sit between groom1 and the frame after it,
 * another letter is a second link out of the same drawing (`groom5u1` leads back to groom2), and
 * `groom2n1` to `groom2n5` are groom2 nodding down and back up (a lick).
 */
type Made = `${Drawn}${"t" | "u" | "v" | "d" | "l" | "f" | "m" | "n"}${1 | 2 | 3 | 4 | 5}`;

/**
 * Gait cycles rigged from the standing drawing (tools/rig-gait.py): a walk in lateral sequence, a trot
 * and a run. Every frame is the same drawing with the legs moved, so nothing flickers.
 */
type GaitKey = `g${"w" | "t" | "r"}${number}`;
const gait = (p: "gw" | "gt" | "gr", n: number): GaitKey[] => Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, "0")}` as GaitKey);
const GW = gait("gw", 32);
const GT = gait("gt", 24);
const GR = gait("gr", 20);
const GAITISH = /^(g[wtr]\d|stand$|stand2$)/;

export type SpriteKey = Drawn | Made | GaitKey;

/** A chain of drawings with `n` in-betweens after each one but the last, named the way tween-sprites.py names them. */
function chain(names: readonly SpriteKey[], n = 2, tag = "t"): SpriteKey[] {
  return names.flatMap((k, i) => (i === names.length - 1 ? [k] : [k, ...Array.from({ length: n }, (_, j) => `${k}${tag}${j + 1}` as SpriteKey)]));
}
/** A loop: in-betweens after every drawing, the last ones leading back to the first. */
function dense(names: readonly SpriteKey[], n: number): SpriteKey[] {
  return names.flatMap((k) => [k, ...Array.from({ length: n }, (_, i) => `${k}t${i + 1}` as SpriteKey)]);
}
/** Two drawings and the in-betweens from one to the other. */
const link = (a: SpriteKey, b: SpriteKey, tag = "t"): SpriteKey[] => chain([a, b], 2, tag);
/** One lick: a drawing nodded down and back up (nod-sprites.py), ending where it started. */
const nodOf = (k: SpriteKey): SpriteKey[] => [k, ...[1, 2, 3, 4, 5].map((i) => `${k}n${i}` as SpriteKey), k];

const GROOM_LOOP = dense(GROOM, 2);
const TURN_STAND = chain(["stand", "turn_s1", "turn_s2", "turn_s3", "turn_s4", "turn_s5"]);
const TURN_SIT = chain(["sit", "turn_t1", "turn_t2", "turn_t3", "turn_t4", "turn_t5"]);
/**
 * A turn plays its drawings one after another like a drawn turnaround, without blending (two views
 * of a body blended show two heads). The in-betweens into and out of the front view are left out:
 * flow cannot follow a body turning that far, and they come out with doubled eyes.
 */
const STEPS_OF = (c: readonly SpriteKey[]): SpriteKey[] => c.filter((k) => !/^turn_[st][23]t\d$/.test(k));
const TURN_STEPS = { stand: STEPS_OF(TURN_STAND), sit: STEPS_OF(TURN_SIT) };
const TURN_SETS = [new Set(TURN_STAND), new Set(TURN_SIT)];
/** Two frames of one turn swap straight away, like the drawings of a turnaround. */
const sameTurn = (a: SpriteKey, b: SpriteKey): boolean => TURN_SETS.some((set) => set.has(a) && set.has(b));
const KNEAD = [...dense(["knead_a", "knead_b"], 3), "knead_a"] as SpriteKey[];
const RETCH = [...dense(["retch1", "retch2"], 2), "retch1"] as SpriteKey[];
const MEOW = link("sit", "meow", "m");

/** Every frame made from the drawings (tools/tween-all.sh makes them). */
const MADE: SpriteKey[] = [
  ...GROOM_LOOP, ...link("groom5", "groom2", "u"), ...link("groom2", "groom6", "u"), ...(["groom2", "groom6", "groom7", "groom8"] as const).flatMap(nodOf),
  ...TURN_STAND, ...TURN_SIT, ...chain(SCRATCH), ...KNEAD, ...RETCH, ...MEOW,
  ...chain(["sitting_down", "sit2", "sit"]), ...link("stand", "sitting_down", "d"), ...link("sit", "stand2", "v"), ...link("stand2", "stand"), ...link("sit2", "lowering", "l"),
  ...chain(["lowering", "loaf2", "drowsy", "curl", "sleep"]), ...link("loaf2", "loaf", "f"), ...chain(["waking", "wake", "sit"]),
  ...chain(["stretch1", "stretch2", "stretch3", "shake"]), ...chain(["presneeze", "sneeze2", "dazed"]),
];

/** Cut from the sheets but no longer played: the rigged gaits replaced the drawn walk and run, sitting no longer flicks its tail by swapping drawings, and the ear scratch is a sheet of its own now. */
const RETIRED = new Set<SpriteKey>(["walk_a", "walk_b", "tail_a", "tail_b", "walk1", "walk2", "walk3", "walk4", "walk5", "walk6", "walk7", "walk8", "run1", "run2", "run3", "run4", "run5", "run6", "scratch"]);

/** Every frame that gets loaded and played. */
export const SPRITE_KEYS: SpriteKey[] = [
  ...new Set<SpriteKey>([...BASE, ...WALK, ...RUN, ...FACE, ...ACTION, ...LIFE, ...EXTRA, ...GROOM, ...SPIN, ...SEQ, ...TRANS, ...REACT, ...PLAY, ...SCRATCH, ...TURN, ...MADE, ...GW, ...GT, ...GR]),
].filter((k) => !RETIRED.has(k));

/** Frames that follow each other inside one loop and swap without a glide: they swap without a cross-fade too. */
const LOOPS: readonly (readonly SpriteKey[])[] = [GW, GT, GR, SPIN];
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
  // A few hundred frames: ask for them a few at a time (a dev server drops a flood), and retry a failure once.
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

/** What to draw: a frame, or a glide from it to the next one, `mix` of the way there. */
export interface Shot {
  key: SpriteKey;
  next: SpriteKey | null;
  mix: number;
  /** A quick shake of the head, in radians (after scratching an ear). */
  shake?: number;
}

export interface SpritePlan {
  key: SpriteKey;
  /** A glide to this frame, `mix` of the way (a loop of in-betweens). */
  next?: SpriteKey | null;
  mix?: number;
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

const smooth = (u: number): number => u * u * (3 - 2 * u);
const still = (key: SpriteKey): Shot => ({ key, next: null, mix: 0 });

/** The frame at `phase` (0 to 1) of a cycle. */
const pick = <T extends SpriteKey>(names: readonly T[], phase: number): T => names[Math.floor(phase * names.length) % names.length] as T;

/** Plays `names` in a loop at `fps` frames a second. */
const cycle = <T extends SpriteKey>(names: readonly T[], t: number, fps: number): T => names[Math.floor(t * fps) % names.length] as T;

/**
 * The point `u` (0 to 1) along a run of frames, gliding between neighbours. `band` is the share of
 * the way from one frame to the next spent blending the two: 1 blends all the way (right for frames
 * that hardly differ, like a nod), less shows each frame clean and only blends round the change, so a
 * paw that moves far never shows as two see-through paws.
 */
function along(keys: readonly SpriteKey[], u: number, band = 1): Shot {
  if (keys.length < 2) return still(keys[0] as SpriteKey);
  const x = Math.max(0, Math.min(1, u)) * (keys.length - 1);
  const i = Math.min(keys.length - 2, Math.floor(x));
  const f = x - i;
  const mix = band >= 1 ? f : smooth(Math.max(0, Math.min(1, (f - (1 - band) / 2) / band)));
  return { key: keys[i] as SpriteKey, next: keys[i + 1] as SpriteKey, mix };
}

/** A stretch of a little program: how long it lasts and what it shows `u` (0 to 1) of the way through. */
interface Seg {
  sec: number;
  at: (u: number) => Shot;
}
const hold = (key: SpriteKey, sec: number, shake = 0): Seg => ({ sec, at: () => (shake ? { ...still(key), shake } : still(key)) });
/** How much of each step a move between two different drawings spends blending (see along). */
const FAR = 0.2;
/** Through a run of frames, slow at both ends unless `even`. `band` as in along. */
const move = (keys: readonly SpriteKey[], sec: number, even = false, band = FAR): Seg => ({ sec, at: (u) => along(keys, even ? u : smooth(u), band) });

/** Through a run of frames one at a time, without blending (for drawings far apart), slow at both ends. */
const steps = (keys: readonly SpriteKey[], sec: number): Seg => ({ sec, at: (u) => still(keys[Math.min(keys.length - 1, Math.round(smooth(u) * (keys.length - 1)))] as SpriteKey) });

/** The shot `e` seconds into a program, or null once it is over. */
function play(segs: readonly Seg[], e: number): Shot | null {
  let at = 0;
  for (const s of segs) {
    if (e < at + s.sec) return s.at(Math.max(0, (e - at) / s.sec));
    at += s.sec;
  }
  return null;
}

/** How long a program lasts. */
export const lengthOf = (segs: readonly Seg[]): number => segs.reduce((a, s) => a + s.sec, 0);

/** A number in [0, 1) made from `n`, the same every time. */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A small seeded random source (mulberry32), so a program is the same in every window. */
function rng(seed: number): () => number {
  let a = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

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

/** Whether an event of eventAt (the same `every`, `len`, `seed` and `p`) comes anywhere between `a` and `b`. */
function eventBetween(a: number, b: number, every: number, len: number, seed: number, p = 1): boolean {
  for (let k = Math.floor(a / every); k <= Math.floor(b / every); k++) {
    if (hash(k * 3.1 + seed) >= p) continue;
    const start = k * every + hash(k * 7.7 + seed * 1.3) * (every - len);
    if (start < b && start + len > a) return true;
  }
  return false;
}

/** Sleeping: slow breathing between two frames, and about once a minute a dream. */
function sleeping(t: number): SpriteKey {
  if (eventAt(t, 40, 3, 5, 0.6)) return "sleep_c";
  return (t * 0.45) % 1 < 0.5 ? "sleep" : "sleep_b";
}

/** Turning half round to face you, a slow blink (a cat's "I trust you"), and back. */
const HALF_TURN = TURN_STEPS.sit.slice(0, TURN_STEPS.sit.indexOf("turn_t3") + 1);
const SLOW_BLINK: Seg[] = [
  steps(HALF_TURN, 0.6), hold("turn_t3", 0.5), move(["turn_t3", "slow_blink"], 0.35, false, 1), hold("slow_blink", 1.1),
  move(["slow_blink", "turn_t3"], 0.3, false, 1), hold("turn_t3", 0.4), steps([...HALF_TURN].reverse(), 0.6),
];
export const SLOW_BLINK_SEC = lengthOf(SLOW_BLINK);

/** Looks held for a while when sitting. */
export const LOOKS: ReadonlySet<SpriteKey> = new Set<SpriteKey>(["yawn", "lookup", "curious", "proud"]);

/**
 * A sitting cat is calm and mostly still (it breathes). About once every 45 s it looks up, tilts its
 * head, looks proud or yawns, and holds it for 3 s. About every two and a half minutes it turns to
 * you and gives you a slow blink. It blinks about four times a minute, at uneven times, and now and
 * then twice. Real cats blink far less, but a cartoon that never blinks looks stuffed. All of it
 * follows the clock, so every window shows the same thing.
 */
function sitting(t: number): Shot {
  const fond = eventAt(t, 75, SLOW_BLINK_SEC, 11, 0.5);
  if (fond && !eventBetween(t - fond.into, t - fond.into + SLOW_BLINK_SEC, 22, 3, 1, 0.5)) return play(SLOW_BLINK, fond.into) ?? still("sit");
  const look = eventAt(t, 22, 3, 1, 0.5);
  if (look) {
    const r = hash(look.k * 5.3 + 2);
    return still(r < 0.15 ? "yawn" : r < 0.45 ? "lookup" : r < 0.8 ? "curious" : "proud");
  }
  const b = eventAt(t, 12, 0.75, 3, 0.9);
  if (b && (b.into < 0.18 || (hash(b.k * 9.1 + 4) < 0.25 && b.into > 0.45 && b.into < 0.63))) return still("blink");
  return still("sit");
}

/** Plays a loop of frames (the last one equal to the first) `hz` times a second, gliding. */
const loopAt = (keys: readonly SpriteKey[], t: number, hz: number): Pick<SpritePlan, "key" | "next" | "mix"> => along(keys, (t * hz) % 1);

/** A meow: the mouth opens, holds and closes, about once a second. */
const MEOWING: Seg[] = [move(MEOW, 0.18, false, 1), hold("meow", 0.38), move([...MEOW].reverse(), 0.22, false, 1), hold("sit", 0.47)];

/**
 * `phase` is how far through a walking or running cycle the cat is (0 to 1), driven by distance walked.
 * `trot` swaps the walk for a trot (a fast walker trots, like a dog or a fox does). The gait frames
 * already bob and sway, so no bounce is added in code. Washing, the ear scratch and turning round are
 * programs that depend on when they began, so drawSprite plays those (this gives their first frame).
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
    // Heaving: hunched and crouched by turns, a little over once a second.
    case "hairball": return { ...loopAt(RETCH, t, 1.25), group: "retch", head: HEAD_LOW, motion: M({ wobble: 0.02, wobbleHz: 30, breath: 0.04, breathHz: 12 }) };
    case "sleep": return { key: sleeping(t), group: "sleep", head: HEAD_LOW, motion: M({ breath: 0.015, breathHz: 2 }), fade: 0.8 };
    // Kneading: one paw and then the other pushes down, about once a second each.
    case "knead": return { ...loopAt(KNEAD, t, 0.55), group: "knead", head: HEAD_LOW, motion: M({ breath: 0.03, breathHz: 5 }) };
    case "loaf":
    case "peek": return { key: "loaf", group: "loaf", head: HEAD_LOW, motion: LOAF };
    case "sulk": return { key: "sulk", group: "sulk", head: HEAD_SIT, motion: M({ breath: 0.02 }) };
    case "groom": return { key: "groom1", group: "groom", head: HEAD_SIT, motion: M({ breath: 0.015, breathHz: 2.5 }) };
    case "happy": return { key: cycle(["wave", "hop", "joy", "hop"] as const, t, 2), group: "happy", head: HEAD_SIT, motion: M({ bounce: 2.5, stepHz: 2, wobble: 0.04, wobbleHz: 4 }), fade: 0.18 };
    case "gift": return { key: "gift", group: "gift", head: HEAD_SIDE, motion: M({ breath: 0.02, fidget: true }) };
    case "purr": return { key: cycle(["joy", "love"] as const, t, 0.5), group: "sit", head: HEAD_SIT, motion: M({ breath: 0.035, breathHz: 6, wobble: 0.012, wobbleHz: 28 }), fade: 0.6 };
    case "headbutt": return { key: "rub", group: "rub", head: HEAD_LOW, motion: M({ wobble: 0.04, wobbleHz: 6, breath: 0.03, breathHz: 5 }) };
    case "sneeze": return { key: "sneeze", group: "sneeze", head: HEAD_SIT, motion: M({ wobble: 0.04, wobbleHz: 44, breath: 0.04, breathHz: 9 }) };
    case "meow": return { ...(play(MEOWING, t % lengthOf(MEOWING)) ?? still("sit")), group: "sit", head: HEAD_SIT, motion: REST };
    // Chattering at a bird: the jaw going fast.
    case "chatter": return { ...along([...MEOW, ...[...MEOW].reverse().slice(1)], (t * 2.6) % 1), group: "sit", head: HEAD_SIT, motion: M({ wobble: 0.02, wobbleHz: 30, breath: 0.03, breathHz: 8 }) };
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
    case "scratch": return { key: "scratch1", group: "scratch", head: HEAD_SIT, motion: M({ breath: 0.015 }) };
    default: return { ...sitting(t), group: "sit", head: HEAD_SIT, motion: REST };
  }
}

/** Licks a second while washing: Noel and Hu (2018) measured 1.4 ± 0.6 tongue strokes a second in cats. */
export const LICK_HZ = 1.4;
/** Strokes a second of the ear scratch: the scratch reflex runs at 4 to 8 a second, about 5.6 on average. */
export const SCRATCH_HZ = 5.6;

/** Licks with one drawing nodding, `n` of them, now and then a short pause between two. */
function licks(segs: Seg[], key: SpriteKey, n: number, hz: number, r: () => number): void {
  const path = nodOf(key);
  for (let i = 0; i < n; i++) {
    segs.push(move(path, (1 / hz) * (0.85 + 0.3 * r()), true, 1));
    if (i < n - 1 && r() < 0.2) segs.push(hold(key, 0.2 + 0.4 * r()));
  }
}

/**
 * How each animal washes: how many licks of a paw before it washes its face, and how many times it
 * wipes its face. Cats wipe two to four times, the fox less, the raccoon fusses over its paws, and the
 * puppy licks its paw but does not wash its face with it.
 */
const WASH: Record<string, { paw: [number, number]; face: [number, number] }> = {
  mochi: { paw: [3, 6], face: [1, 2] },
  bandit: { paw: [5, 9], face: [2, 3] },
  biscuit: { paw: [4, 7], face: [0, 0] },
};
const CAT_WASH: { paw: [number, number]; face: [number, number] } = { paw: [3, 6], face: [2, 4] };

/**
 * One bout of washing, head first and working down the body, the way cats do: lick a paw a few
 * times, wipe it over the ear and down the cheek (licking the paw again between wipes), lick the
 * nose, then the chest, then a hind leg, and end with a content blink. Each part goes on for a
 * while before it moves to the next one, and it never goes back and forth.
 */
export function groomBout(id: string, r: () => number, first: boolean): Seg[] {
  const w = WASH[id] ?? CAT_WASH;
  const hz = LICK_HZ * (0.85 + 0.3 * r());
  const segs: Seg[] = [];
  if (!first) segs.push(move(link("groom9", "groom1"), 0.5));
  segs.push(move(link("groom1", "groom2"), 0.45));
  licks(segs, "groom2", between(r, ...w.paw), hz, r);
  const wipes = between(r, ...w.face);
  for (let i = 0; i < wipes; i++) {
    // The paw goes over the ear, behind it and down the cheek.
    segs.push(move(link("groom2", "groom3"), 0.35), hold("groom3", 0.12), move(link("groom3", "groom4"), 0.35), hold("groom4", 0.15), move(link("groom4", "groom5"), 0.4), hold("groom5", 0.1));
    if (i < wipes - 1) {
      segs.push(move(link("groom5", "groom2", "u"), 0.35));
      licks(segs, "groom2", between(r, 1, 3), hz, r);
    }
  }
  segs.push(wipes > 0 ? move(link("groom5", "groom6"), 0.3) : move(link("groom2", "groom6", "u"), 0.4));
  licks(segs, "groom6", between(r, 1, 3), hz * 1.5, r);
  segs.push(move(link("groom6", "groom7"), 0.45));
  licks(segs, "groom7", between(r, 2, 6), hz, r);
  segs.push(move(link("groom7", "groom8"), 0.5));
  licks(segs, "groom8", between(r, 3, 8), hz, r);
  segs.push(move(link("groom8", "groom9"), 0.5), hold("groom9", 0.9 + 0.8 * r()));
  return segs;
}

/** A program that grows as it is played (a wash goes on as long as the groom does). */
interface Program {
  segs: Seg[];
  len: number;
  r: () => number;
}
const programs = new Map<string, Program>();
function programFor(key: string, seed: number): Program {
  let p = programs.get(key);
  if (!p) {
    if (programs.size > 32) programs.clear();
    programs.set(key, (p = { segs: [], len: 0, r: rng(seed) }));
  }
  return p;
}

const LONGEST_WASH = 900;

/** The shot `e` seconds into a wash: one bout after another, each a little different. `seed` picks the variation. */
export function groomShot(id: string, e: number, seed: number): Shot {
  const p = programFor(`groom/${id}/${seed}`, seed);
  // Nobody washes for a quarter of an hour, but if it ever does, the last minute repeats instead of growing forever.
  if (e > LONGEST_WASH) e = LONGEST_WASH - 60 + ((e - LONGEST_WASH) % 60);
  while (p.len <= e) {
    const bout = groomBout(id, p.r, p.segs.length === 0);
    p.segs.push(...bout);
    p.len += lengthOf(bout);
  }
  return play(p.segs, Math.max(0, e)) ?? still("groom9");
}

/**
 * Scratching an ear with a hind leg: the head tilts, the leg comes up, a burst of quick strokes (a
 * dozen or so at about 5.6 a second, the head tilting further halfway through), the leg goes down,
 * a shake of the head, and a content sit.
 */
export function scratchProgram(seed: number): Seg[] {
  // It has to fit in the time the executor holds the pose (SCRATCH_SEC): the strokes take what is left.
  const r = rng(seed);
  const hz = SCRATCH_HZ * (0.9 + 0.2 * r());
  const up: SpriteKey[] = ["scratch4", "scratch4t1", "scratch4t2", "scratch5", "scratch4t2", "scratch4t1", "scratch4"];
  const over: SpriteKey[] = ["scratch4", "scratch4t1", "scratch4t2", "scratch5", "scratch5t1", "scratch5t2", "scratch6"];
  const tilted: SpriteKey[] = ["scratch6", "scratch5t2", "scratch5t1", "scratch5", "scratch5t1", "scratch5t2", "scratch6"];
  const lift: Seg[] = [hold("scratch1", 0.3), move(link("scratch1", "scratch2"), 0.3), move(link("scratch2", "scratch3"), 0.25), move(link("scratch3", "scratch4"), 0.15)];
  const down: Seg[] = [move(link("scratch6", "scratch7"), 0.3), hold("scratch7", 0.15), move(link("scratch7", "scratch8"), 0.15), hold("scratch8", 0.45, 0.07), move(link("scratch8", "scratch9"), 0.25)];
  // A little time to spare at the end, sitting content.
  const strokes = Math.max(4, Math.floor((SCRATCH_SEC - 0.2 - lengthOf(lift) - lengthOf(down)) * hz));
  const half = Math.floor(strokes * 0.55);
  // Fast enough that blending all the way reads as a blur of the paw, which is what the eye sees.
  const burst = Array.from({ length: strokes }, (_, i) => move(i < half ? up : i === half ? over : tilted, 1 / hz, true, 1));
  return [...lift, ...burst, ...down];
}
/** The shot `e` seconds into an ear scratch. */
export function scratchShot(e: number, seed: number): Shot {
  const p = programFor(`scratch/${seed}`, seed);
  if (p.segs.length === 0) {
    p.segs = scratchProgram(seed);
    p.len = lengthOf(p.segs);
  }
  return play(p.segs, Math.max(0, e)) ?? still("scratch9");
}

/** Turning round on the spot, standing or sitting, `u` (0 to 1) of the way: slow to start and to stop. */
export function turnShot(kind: "stand" | "sit", u: number): Shot {
  const steps = TURN_STEPS[kind];
  const x = smooth(Math.max(0, Math.min(1, u))) * (steps.length - 1);
  return still(steps[Math.min(steps.length - 1, Math.round(x))] as SpriteKey);
}

/** Sitting down after a walk, standing up, lying down, settling into a loaf, waking, stretching, sneezing. */
// Stopping from a walk: the walk frames are the standing drawing, so the rear goes down out of it.
const FROM_STAND: Seg[] = [move(link("stand", "sitting_down", "d"), 0.22), hold("sitting_down", 0.08), move(link("sitting_down", "sit2"), 0.25)];
const SIT_DOWN: Seg[] = [...FROM_STAND, hold("sit2", 0.08), move(link("sit2", "sit"), 0.22)];
const STAND_UP: Seg[] = [move(link("sit", "stand2", "v"), 0.18), move(link("stand2", "stand"), 0.14)];
const LIE_DOWN: Seg[] = [
  hold("sit2", 0.15), move(link("sit2", "lowering", "l"), 0.35), hold("lowering", 0.25), move(link("lowering", "loaf2"), 0.35), hold("loaf2", 0.25),
  move(link("loaf2", "drowsy"), 0.4), hold("drowsy", 0.5), move(link("drowsy", "curl"), 0.4), hold("curl", 0.3), move(link("curl", "sleep"), 0.4),
];
const STOP_TO_SLEEP: Seg[] = [...FROM_STAND, ...LIE_DOWN];
const WAKE: Seg[] = [hold("waking", 0.45), move(link("waking", "wake"), 0.3), hold("wake", 0.35)];
const WAKE_TO_SIT: Seg[] = [...WAKE, move(link("wake", "sit"), 0.35)];
const LOAF_IN: Seg[] = [move(link("sit2", "lowering", "l"), 0.35), hold("lowering", 0.2), move(link("lowering", "loaf2"), 0.3), hold("loaf2", 0.15), move(link("loaf2", "loaf", "f"), 0.3)];
const STOP_TO_LOAF: Seg[] = [...FROM_STAND, ...LOAF_IN];
const STRETCH_IN: Seg[] = [hold("stretch1", 0.3), move(link("stretch1", "stretch2"), 0.3), hold("stretch2", 0.3), move(link("stretch2", "stretch3"), 0.35), hold("stretch3", 1.45), move(link("stretch3", "shake"), 0.25)];
const SNEEZE_IN: Seg[] = [hold("presneeze", 0.55), move(link("presneeze", "sneeze2"), 0.12), hold("sneeze2", 0.3), move(link("sneeze2", "dazed"), 0.25)];

/**
 * Frames that play once when a pose starts: stretching, sneezing, settling down to sleep, waking up,
 * lying down, sitting down after a walk, standing up. `prev` is the kind of pose before, `e` seconds
 * since this one began.
 */
function sequenceShot(anim: Anim, plan: SpritePlan, prev: string, e: number): Shot | null {
  const wasMoving = prev === "walk" || prev === "trot" || prev === "run";
  if (plan.group === "stretch") return play(STRETCH_IN, e) ?? still("shake");
  if (anim === "sneeze") return play(SNEEZE_IN, e) ?? still("dazed");
  if (plan.group === "sleep" && prev !== "sleep" && prev !== "") return play(wasMoving ? STOP_TO_SLEEP : LIE_DOWN, e);
  if (prev === "sleep" && plan.group !== "sleep" && plan.group !== "dangle") return play(plan.group === "sit" ? WAKE_TO_SIT : WAKE, e);
  if (plan.group === "loaf" && prev !== "loaf" && prev !== "sleep" && prev !== "") return play(wasMoving ? STOP_TO_LOAF : LOAF_IN, e);
  if (plan.group === "sit" && wasMoving) return play(SIT_DOWN, e);
  // Standing up first: the gait frames are made from "stand", so the walk grows out of it.
  if ((plan.group === "walk" || plan.group === "trot" || plan.group === "run") && prev === "sit") return play(STAND_UP, e);
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

/** How each sprite set moved last: where, how fast, how far through its gait, which way it faces and any turn. */
interface Gait {
  x: number | null;
  t: number;
  phase: number;
  /** Ground speed in pixels a second, smoothed. */
  speed: number;
  trot: boolean;
  dir: number;
  /** A turn round in progress: when it began, which way it faced before, standing or sitting. */
  turn: { at: number; from: number; kind: "stand" | "sit" } | null;
  /** When the last turn began and ended: a pose that began with it waits for it to finish. */
  turnAt: number;
  turnEnd: number;
}
const gaits = new Map<string, Gait>();

/** What each sprite set showed last, so a new pose can cross-fade in instead of cutting. */
interface Shown {
  key: SpriteKey;
  next: SpriteKey | null;
  mix: number;
  /** The way the shown frame faced. */
  dir: number;
  group: string;
  since: number;
  prev: string;
  from: SpriteKey | null;
  fromDir: number;
  fadeAt: number;
  fade: number;
}
const shown = new Map<string, Shown>();

/** Steps a second where a walker breaks into a trot, and where it drops back to a walk. */
const TROT_ABOVE = 2.9;
const WALK_BELOW = 2.5;

/**
 * Which drawn turn fits: standing (on its feet, walking on or stopping to sit) or sitting (sitting
 * before and after). Anything else (a jump, a hiss) turns by fading the old frame out facing the old way.
 */
function turnKind(key: SpriteKey, was: string, now: string): "stand" | "sit" | null {
  const settled = now === "walk" || now === "trot" || now === "run" || now === "sit";
  if (!settled) return null;
  if (GAITISH.test(key) || key.startsWith("turn_s")) return "stand";
  if (was === "sit") return "sit";
  return null;
}

/** A frame of the set. Every key is loaded before a set is handed out (see load), so it is never missing. */
const frameOf = (set: SpriteSet, key: SpriteKey): HTMLImageElement => set.img[key] as HTMLImageElement;

const strideOf = (set: SpriteSet, g: "walk" | "trot" | "run"): number => GAIT_STRIDE[set.id]?.[g] ?? 90;

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

/** One frame of a mix, how much of it, and whether it faces the other way. */
interface Layer {
  img: HTMLImageElement;
  w: number;
  flip: boolean;
}

/**
 * Frames mixed by weight, feet on the bottom edge and centred like a single frame. They are added in
 * premultiplied colour ("lighter"), so where all are solid the result is solid too: a cross-fade
 * with no see-through moment in the middle. A flipped layer is mirrored round the middle.
 */
function blend(set: SpriteSet, layers: readonly Layer[], ppu: number): { src: CanvasImageSource; w: number; h: number } {
  const w = Math.max(...layers.map((l) => l.img.naturalWidth * K));
  const h = Math.max(...layers.map((l) => l.img.naturalHeight * K));
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
  layers.forEach((l, i) => {
    const lw = l.img.naturalWidth * K;
    const lh = l.img.naturalHeight * K;
    cx.setTransform(l.flip ? -1 : 1, 0, 0, 1, l.flip ? cw : 0, 0);
    cx.globalCompositeOperation = i === 0 ? "source-over" : "lighter";
    cx.globalAlpha = l.w;
    cx.drawImage(scaledFor(l.img, lw * ppu), ((w - lw) / 2) * ppu, (h - lh) * ppu, lw * ppu, lh * ppu);
  });
  cx.setTransform(1, 0, 0, 1, 0, 0);
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
  if (!g) gaits.set(slot, (g = { x: null, t, phase: 0, speed: 0, trot: false, dir: facing, turn: null, turnAt: -1e9, turnEnd: -1e9 }));
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
  const dir = plan.flip ? -facing : facing;

  let sh = shown.get(slot);
  // A new drawing starts the pose now (with no pose before it, so no one-off sequence replays).
  if (!sh) shown.set(slot, (sh = { key: plan.key, next: null, mix: 0, dir, group: plan.group, since: t, prev: "", from: null, fromDir: dir, fadeAt: -1e9, fade: 0 }));
  const was = sh.group;
  if (sh.group !== plan.group) {
    sh.prev = sh.group;
    sh.group = plan.group;
    sh.since = t;
  }

  // Turning round: the drawn turn (through three quarters and the front view), the same length as
  // the executor's stop to turn. Where no turn is drawn, the old frame fades out facing the old way.
  let flipFade = false;
  if (dir !== g.dir) {
    const kind = g.turn ? null : turnKind(sh.key, was, plan.group);
    if (kind) {
      g.turn = { at: t, from: g.dir, kind };
      g.turnAt = t;
      g.turnEnd = t + TURN_SEC;
    } else {
      if (g.turn) g.turnEnd = t;
      g.turn = null;
      flipFade = true;
    }
    g.dir = dir;
  }
  if (g.turn && t >= g.turn.at + TURN_SEC) {
    // The last frame of a turn is the first drawing mirrored: go on as that drawing, facing the new way.
    sh.key = g.turn.kind === "stand" ? "stand" : "sit";
    sh.next = null;
    sh.mix = 0;
    sh.dir = g.dir;
    g.turn = null;
  }
  const drawDir = g.turn ? g.turn.from : g.dir;
  // A pose that began with a turn starts its own frames when the turn is over.
  const poseAt = sh.since >= g.turnAt - 0.05 && sh.since < g.turnEnd ? g.turnEnd : sh.since;
  const e = t - poseAt;

  let shot: Shot;
  if (g.turn) shot = turnShot(g.turn.kind, (t - g.turn.at) / TURN_SEC);
  else if (plan.group === "groom") shot = groomShot(set.id, e, hash(poseAt * 0.731 + 1));
  else if (plan.group === "scratch") shot = scratchShot(e, hash(poseAt * 0.731 + 2));
  else shot = sequenceShot(anim, plan, sh.prev, e) ?? { key: plan.key, next: plan.next ?? null, mix: plan.mix ?? 0 };

  // A new frame cross-fades in, except where it is the neighbour the last one was gliding to (or
  // from), or the next frame of a gait or a spin.
  const fadeFrom = (sec: number): void => {
    const s = sh as Shown;
    s.from = s.next && s.mix >= 0.5 ? s.next : s.key;
    s.fromDir = s.dir;
    s.fadeAt = t;
    s.fade = sec;
  };
  if (flipFade) fadeFrom(0.22);
  else if (shot.key !== sh.key) {
    const glided = shot.key === sh.next || shot.next === sh.key || sameTurn(shot.key, sh.key);
    const loop = loopOf.get(shot.key);
    if (!glided && (loop === undefined || loop !== loopOf.get(sh.key))) {
      // Out of a walk (or into one) is quick: a moving animal changes pose fast, and two different
      // bodies overlapping for long look like a double exposure.
      const gaitSide = GAITISH.test(shot.key) || GAITISH.test(sh.key);
      fadeFrom(shot.key === "blink" || sh.key === "blink" ? 0.06 : gaitSide ? 0.12 : g.turn ? 0.1 : (plan.fade ?? 0.24));
    }
  }
  sh.key = shot.key;
  sh.next = shot.next;
  sh.mix = shot.mix;
  sh.dir = drawDir;
  const k = sh.from !== null && t - sh.fadeAt < sh.fade ? smooth(Math.max(0, (t - sh.fadeAt) / sh.fade)) : 1;
  if (k >= 1) sh.from = null;
  const img = frameOf(set, shot.key);
  const w = img.naturalWidth * K;
  const h = img.naturalHeight * K;

  // Breathing, steps, rocking and the occasional fidget.
  const breath = Math.sin(t * m.breathHz) * m.breath;
  // A hop on the clock for bouncy poses. The gaits bob in their own frames.
  let hop = !moving && m.stepHz ? Math.abs(Math.sin(Math.PI * t * m.stepHz)) * m.bounce : 0;
  let rot = (plan.rot ?? 0) + m.lean + (m.wobbleHz ? Math.sin(t * m.wobbleHz) * m.wobble : 0) + (shot.shake ? Math.sin(t * 88) * shot.shake : 0);
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
  ctx.rotate(rot * drawDir);
  ctx.scale(scale * drawDir * sx, scale * sy);
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
  const layers: Layer[] = [];
  if (k < 1 && sh.from !== null) layers.push({ img: frameOf(set, sh.from), w: 1 - k, flip: sh.fromDir !== drawDir });
  const mix = shot.next ? shot.mix : 0;
  if (mix < 0.999) layers.push({ img, w: k * (1 - mix), flip: false });
  if (shot.next && mix > 0.001) layers.push({ img: frameOf(set, shot.next), w: k * mix, flip: false });
  if (layers.length === 1 && !(layers[0] as Layer).flip) {
    const only = (layers[0] as Layer).img;
    const ow = only.naturalWidth * K;
    const oh = only.naturalHeight * K;
    ctx.drawImage(scaledFor(only, ow * ppu), -ow / 2, -oh, ow, oh);
  } else {
    const b = blend(set, layers, ppu);
    ctx.drawImage(b.src, -b.w / 2, -b.h, b.w, b.h);
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
