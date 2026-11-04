import type { Anim } from "./executor";
import type { IntentName } from "./types";

/**
 * What each kind of animal is like, so a dog and a cat do not just look different.
 * The personality traits (laziness, aloofness...) tune one character inside its kind, this table
 * sets the kind. Everything here is a multiplier on what the rules already do, so the governor and
 * the respect modes still decide what is allowed.
 */
export type Kind = "cat" | "dog" | "fox" | "raccoon";

export interface Instinct {
  kind: Kind;
  /** Walking and running speed. */
  speed: number;
  /** Time between decisions. Below 1 acts more often. */
  gap: number;
  /** How fast it tires while awake, and how fast it recovers asleep. Together they set how much it sleeps. */
  drain: number;
  restore: number;
  /** How much it likes each behavior. Missing means 1. */
  weights: Partial<Record<IntentName, number>>;
  /** Chance of coming when called, on top of trust. */
  comes: number;
  /** Chance that being petted ends in a swat. */
  bite: number;
  /** What it does between strolls, while it has nothing in particular to do. */
  idle: Anim[];
  /** How far a stroll goes, in pixels, shortest and longest. */
  stroll: [number, number];
  /** How long it stands around between strolls, in seconds, shortest and longest. */
  rest: [number, number];
  /** Share of strolls that are a run. */
  runs: number;
  /** How many pokes it takes before the mood turns, a click each. A dog shrugs off several, a cat none. */
  patience: number;
}

const CAT: Instinct = {
  kind: "cat",
  speed: 1,
  gap: 1.3,
  drain: 1,
  restore: 1,
  // Aloof and a little cruel: ignores you, swats, knocks things off, sits on your work, naps a lot.
  weights: { ignore: 2.5, swat: 2.2, knock_toy: 2.5, nudge_window: 1.8, sit_on: 1.6, sit_on_video: 1.5, block_dock: 1.6, stare: 2, groom: 1.6, nap: 1.4, cozy: 1.4, stalk: 1.5, sulk: 1.4, headbutt: 0.5, meow: 0.7, follow: 0.4, zoomies: 0.7, wander: 0.8, scratch: 3, spook: 3, sprawl: 2.5, roll: 1, sniff: 0.5, tumble: 0.5, shy: 0.7, bounce: 0.5, beg: 0, dig: 0.2, howl: 0.15 },
  comes: 0.3,
  bite: 0.14,
  idle: ["blink", "groom", "stare", "loaf", "stretch", "idle_sit", "yawn", "curious", "scratch", "proud", "look"],
  stroll: [60, 220],
  rest: [12, 28],
  runs: 0.05,
  patience: 1,
};

const DOG: Instinct = {
  kind: "dog",
  speed: 1.55,
  gap: 0.5,
  drain: 0.6,
  restore: 1.5,
  // Thrilled about everything: follows you, runs about, jumps, barks, hardly ever naps, never sulks for long.
  weights: { follow: 3, zoomies: 3, watch: 2, headbutt: 2.2, meow: 2, chase_tail: 2.5, wander: 1.7, chatter: 1.4, gift: 1.5, nap: 0.35, cozy: 0.5, nap_warm: 0.4, ignore: 0.1, sulk: 0.4, stalk: 0.5, swat: 0.4, knock_toy: 0.8, perch: 0.5, groom: 0.5, stare: 0.3, block_dock: 0.5, roll: 2.5, bounce: 3, sniff: 3, dig: 2.5, howl: 1.4, scratch: 0.8, beg: 3.5, spook: 0.4, sprawl: 1.5, tumble: 2.5, shy: 0.4 },
  comes: 1.6,
  bite: 0,
  idle: ["look", "happy", "bark", "stretch", "chase_tail", "curious", "sniff", "yawn", "proud", "play_bow"],
  stroll: [120, 480],
  rest: [7, 16],
  runs: 0.45,
  patience: 3,
};

const FOX: Instinct = {
  kind: "fox",
  speed: 1.25,
  gap: 0.7,
  drain: 0.75,
  restore: 1.25,
  // Curious and sneaky: stalks, pounces, peeks around corners, explores everything.
  weights: { stalk: 2.6, peek: 2.6, tour: 2.2, gift: 2, wander: 1.6, watch: 1.6, zoomies: 1.6, chase_tail: 1.4, sit_on: 1.3, perch: 1.3, knock_toy: 1.2, nap: 0.7, cozy: 0.8, ignore: 0.8, follow: 0.9, roll: 1.5, bounce: 2, sniff: 2.2, dig: 1.8, howl: 1.5, scratch: 0.6, beg: 0.3, spook: 1.5, sprawl: 1, tumble: 2, shy: 1.5 },
  comes: 0.55,
  bite: 0.04,
  idle: ["look", "peek", "stare", "chase_tail", "stretch", "blink", "curious", "sniff", "proud", "giggle", "yawn"],
  stroll: [100, 360],
  rest: [9, 20],
  runs: 0.2,
  patience: 1.5,
};

const RACCOON: Instinct = {
  kind: "raccoon",
  speed: 1.1,
  gap: 0.8,
  drain: 0.8,
  restore: 1.2,
  // A thief and a tinkerer: takes things, knocks stuff over, walks across the keyboard, raids the dock.
  weights: { knock_toy: 3, gift: 3, nudge_window: 2.5, keyboard_walk: 2.6, block_dock: 1.8, peek: 1.6, tour: 1.6, sit_on: 1.5, zoomies: 1.5, chatter: 1.8, knead: 1.3, nap: 0.8, headbutt: 0.7, follow: 0.7, ignore: 1.2, roll: 0.8, bounce: 1.2, sniff: 2.5, dig: 2, howl: 0.2, scratch: 1, beg: 1.2, spook: 0.6, sprawl: 1, tumble: 1.5, shy: 0.5 },
  comes: 0.5,
  bite: 0.06,
  idle: ["groom", "look", "chatter", "knead", "stare", "idle_sit", "sniff", "curious", "scratch", "proud", "giggle"],
  stroll: [80, 300],
  rest: [9, 20],
  runs: 0.15,
  patience: 1.5,
};

export const INSTINCTS: Record<Kind, Instinct> = { cat: CAT, dog: DOG, fox: FOX, raccoon: RACCOON };

/** The kind from a species name ("black cat", "puppy", "fox"...). Anything unknown acts like a cat. */
export function kindOf(species?: string): Kind {
  const s = (species ?? "").toLowerCase();
  if (/dog|puppy|pup/.test(s)) return "dog";
  if (/fox/.test(s)) return "fox";
  if (/raccoon/.test(s)) return "raccoon";
  return "cat";
}

export function instinctFor(species?: string): Instinct {
  return INSTINCTS[kindOf(species)];
}

/** How the chaos level changes sleepiness: chill sleeps most of the day, gremlin is rarely down. */
export const ENERGY_BY_CHAOS = {
  chill: { drain: 1, restore: 1 },
  normal: { drain: 0.55, restore: 1.5 },
  gremlin: { drain: 0.3, restore: 2.2 },
} as const;
