import type { Anim } from "./executor";
import type { IntentName } from "./types";

/**
 * What each kind of animal is like, so a dog and a cat do not just look different.
 * The personality traits (laziness, aloofness...) tune one character inside its kind, this table
 * sets the kind. Everything here is a multiplier on what the rules already do, so the governor and
 * the respect modes still decide what is allowed.
 */
export type Kind = "cat" | "dog" | "fox" | "raccoon" | "rabbit" | "squirrel";

export interface Instinct {
  kind: Kind;
  /** Which animal exactly, for its own reactions to a click: the kind, or a breed with its own ways ("chihuahua"). */
  animal: string;
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
  /** How much more often than a cat it has to pee and to poop (ADR-048). Missing means [1, 1]. */
  potty?: [number, number];
  /**
   * Its own things (ADR-067): actions drawn for this animal only. Anything in OWN_INTENTS that isn't
   * listed here never reaches its menu, whatever the model or the rules would like.
   */
  own?: IntentName[];
}

/** The actions only some animals have (each one is drawn for them alone, ADR-067). */
export const OWN_INTENTS: ReadonlySet<IntentName> = new Set<IntentName>(["shake_off", "chew", "burrow", "shiver", "mouse", "cache", "wash", "raid", "binky", "thump", "flop", "nibble", "nut", "cling"]);

/** Whether this animal can do that at all (its own things are its alone). */
export function canDo(ins: Instinct, intent: IntentName): boolean {
  return !OWN_INTENTS.has(intent) || (ins.own ?? []).includes(intent);
}

const CAT: Instinct = {
  kind: "cat",
  animal: "cat",
  speed: 1,
  gap: 1.3,
  drain: 1,
  restore: 1,
  // Aloof and a little cruel: ignores you, swats, knocks things off, sits on your work, naps a lot.
  weights: { knock_off: 2.6, claw: 1.6, hunt: 1.8, ignore: 2.5, swat: 2.2, knock_toy: 2.5, nudge_window: 1.8, sit_on: 1.6, sit_on_video: 1.5, block_dock: 1.6, stare: 2, groom: 1.6, nap: 1.4, cozy: 1.4, stalk: 1.5, sulk: 1.4, headbutt: 0.5, meow: 0.7, follow: 0.4, zoomies: 0.7, wander: 0.8, scratch: 3, spook: 3, sprawl: 2.5, roll: 1, sniff: 0.5, tumble: 0.5, shy: 0.7, bounce: 0.5, beg: 0, dig: 0.2, howl: 0.15, fetch: 0.3, carry_toy: 0.8, stash_toy: 0.1, nose_toy: 0.9, chase_cursor: 1.6, invite_play: 0.25, yawn: 1.4, look_around: 1.2 },
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
  animal: "dog",
  speed: 1.55,
  gap: 0.5,
  drain: 0.6,
  restore: 1.5,
  // Thrilled about everything: follows you, runs about, jumps, barks, hardly ever naps, never sulks for long.
  weights: { knock_off: 0.4, claw: 0.5, hunt: 0.6, follow: 3, zoomies: 3, watch: 2, headbutt: 2.2, meow: 2, chase_tail: 2.5, wander: 1.7, chatter: 1.4, gift: 1.5, nap: 0.35, cozy: 0.5, nap_warm: 0.4, ignore: 0.1, sulk: 0.4, stalk: 0.5, swat: 0.4, knock_toy: 0.8, perch: 0.5, groom: 0.35, stare: 0.3, block_dock: 0.5, roll: 2.5, bounce: 3, sniff: 3, dig: 2.5, howl: 1.4, scratch: 0.8, beg: 3.5, spook: 0.4, sprawl: 1.5, tumble: 2.5, shy: 0.4, fetch: 4, carry_toy: 1.2, stash_toy: 0.9, nose_toy: 0.5, chase_cursor: 2.2, invite_play: 3, yawn: 0.8, look_around: 1, knead: 0, hairball: 0, shake_off: 2.4, chew: 2.6 },
  comes: 1.6,
  bite: 0,
  idle: ["look", "happy", "bark", "stretch", "chase_tail", "curious", "sniff", "yawn", "proud", "play_bow"],
  stroll: [120, 480],
  rest: [7, 16],
  runs: 0.45,
  patience: 3,
  potty: [1.3, 1],
  own: ["shake_off", "chew"],
};

const FOX: Instinct = {
  kind: "fox",
  animal: "fox",
  speed: 1.25,
  gap: 0.7,
  drain: 0.75,
  restore: 1.25,
  // Curious and sneaky: stalks, pounces, peeks around corners, explores everything.
  weights: { knock_off: 1.2, claw: 0.8, hunt: 2.4, stalk: 2.6, peek: 2.6, tour: 2.2, gift: 2, wander: 1.6, watch: 1.6, zoomies: 1.6, chase_tail: 1, sit_on: 1.3, perch: 1.3, knock_toy: 1.2, nap: 0.7, cozy: 0.8, ignore: 0.8, follow: 0.9, roll: 1.5, bounce: 2, sniff: 2.2, dig: 1.8, howl: 1.5, scratch: 0.6, beg: 0.3, spook: 1.5, sprawl: 1, tumble: 2, shy: 1.5, fetch: 0.9, carry_toy: 3, stash_toy: 2.2, nose_toy: 1, chase_cursor: 1.6, invite_play: 1.6, yawn: 1, look_around: 1.6, knead: 0.2, hairball: 0, mouse: 3.2, cache: 2.4, groom: 0.8 },
  comes: 0.55,
  bite: 0.04,
  idle: ["look", "peek", "stare", "chase_tail", "stretch", "blink", "curious", "sniff", "proud", "giggle", "yawn"],
  stroll: [100, 360],
  rest: [9, 20],
  runs: 0.2,
  patience: 1.5,
  own: ["mouse", "cache"],
};

const RACCOON: Instinct = {
  kind: "raccoon",
  animal: "raccoon",
  speed: 1.1,
  gap: 0.8,
  drain: 0.8,
  restore: 1.2,
  // A thief and a tinkerer: takes things, knocks stuff over, walks across the keyboard, raids the dock.
  weights: { knock_off: 3, claw: 1.4, hunt: 0.8, knock_toy: 3, gift: 3, nudge_window: 2.5, keyboard_walk: 2.6, block_dock: 1.8, peek: 1.6, tour: 1.6, sit_on: 1.5, zoomies: 1.5, chatter: 1.8, knead: 0, nap: 0.8, headbutt: 0.7, follow: 0.7, ignore: 1.2, roll: 0.8, bounce: 1.2, sniff: 2.5, dig: 2, howl: 0.2, scratch: 1, beg: 1.2, spook: 0.6, sprawl: 1, tumble: 1.5, shy: 0.5, fetch: 0.3, carry_toy: 3.2, stash_toy: 1.4, nose_toy: 1.2, chase_cursor: 1, invite_play: 0.6, yawn: 1, look_around: 1.2, hairball: 0, chase_tail: 0.3, groom: 0.45, wash: 3, raid: 3.2 },
  comes: 0.5,
  bite: 0.06,
  idle: ["groom", "look", "chatter", "knead", "stare", "idle_sit", "sniff", "curious", "scratch", "proud", "giggle"],
  stroll: [80, 300],
  rest: [9, 20],
  runs: 0.15,
  patience: 1.5,
  own: ["wash", "raid"],
};

/**
 * A chihuahua is a dog (it comes when called, it's happy to see you), but a small, trembly and loud
 * one: it follows you, begs, yaps at everything (howl and meow are its yapping) and spooks easily.
 */
const CHIHUAHUA: Instinct = {
  kind: "dog",
  animal: "chihuahua",
  speed: 1.35,
  gap: 0.55,
  drain: 0.75,
  restore: 1.3,
  weights: { follow: 3.2, beg: 3.2, howl: 3, meow: 2.5, spook: 3, shy: 1.8, watch: 2, stare: 1.5, headbutt: 1.6, zoomies: 2, bounce: 1.5, chase_tail: 1.5, sniff: 2, dig: 1.2, cozy: 1.6, nap_warm: 1.8, nap: 0.6, sulk: 0.8, ignore: 0.4, knock_off: 0.4, claw: 0.4, hunt: 0.6, stalk: 0.5, swat: 0.3, sprawl: 0.8, roll: 1.5, tumble: 1.2, scratch: 1.2, groom: 0.5, gift: 1, perch: 0.5, sit_on: 1.2, knock_toy: 0.8, block_dock: 0.6, fetch: 2.6, carry_toy: 1.4, stash_toy: 1.8, nose_toy: 0.6, chase_cursor: 2.4, invite_play: 2.2, yawn: 1.2, look_around: 1.4, knead: 0, hairball: 0, shake_off: 2.2, burrow: 3, shiver: 2.8 },
  comes: 1.4,
  bite: 0.03,
  idle: ["look", "bark", "curious", "sniff", "stare", "yawn", "surprise", "idle_sit", "startled", "shy"],
  stroll: [80, 320],
  rest: [6, 14],
  runs: 0.35,
  patience: 2,
  potty: [1.5, 1],
  own: ["shake_off", "burrow", "shiver"],
};

const RABBIT: Instinct = {
  kind: "rabbit",
  animal: "rabbit",
  speed: 1.2,
  gap: 1,
  drain: 0.9,
  restore: 1.1,
  // Quiet and wary: sniffs everything, digs, spooks at nothing, thumps a warning, nibbles what it
  // shouldn't, flops over when happy and does binkies when it thinks nobody is looking. Doesn't hunt,
  // doesn't call out.
  weights: { bounce: 1.4, dig: 3, sniff: 3, spook: 3, sprawl: 2.2, roll: 0.8, cozy: 1.6, nap: 1.2, groom: 1.8, peek: 1.8, box: 1.6, shy: 2, zoomies: 1.6, beg: 1.2, headbutt: 1, ignore: 1.6, sulk: 1.4, scratch: 1.2, tumble: 1, sit_on: 1, follow: 0.7, stare: 0.8, perch: 0.6, knock_toy: 0.5, keyboard_walk: 0.5, gift: 0.4, chase_tail: 0.1, knock_off: 0.3, swat: 0.2, claw: 0.2, meow: 0.2, hunt: 0.1, stalk: 0.1, chatter: 0.1, howl: 0.05, hairball: 0, fetch: 0.05, carry_toy: 1, stash_toy: 0.3, nose_toy: 3, chase_cursor: 0.4, invite_play: 0.3, yawn: 1.2, look_around: 1.6, knead: 0, binky: 3.2, thump: 2.4, flop: 3, nibble: 2.6 },
  comes: 0.35,
  bite: 0.05,
  idle: ["sniff", "groom", "loaf", "look", "curious", "blink", "idle_sit", "scratch", "yawn", "stare"],
  stroll: [60, 240],
  rest: [10, 24],
  runs: 0.15,
  patience: 1.2,
  potty: [1, 1.8],
  own: ["binky", "thump", "flop", "nibble"],
};

const SQUIRREL: Instinct = {
  kind: "squirrel",
  animal: "squirrel",
  speed: 1.45,
  gap: 0.5,
  drain: 0.7,
  restore: 1.3,
  // Never still: chatters and scolds, peeks, digs to hide things, climbs up high, has zoomies.
  weights: { chatter: 3.2, peek: 2.8, dig: 3, zoomies: 3, tour: 2.4, perch: 2.4, gift: 2.4, wander: 1.8, hunt: 0.4, stalk: 1.6, sniff: 2.2, spook: 2, bounce: 1.8, knock_toy: 1.8, knock_off: 1.6, keyboard_walk: 1.6, chase_tail: 0.1, groom: 1.4, tumble: 1.5, scratch: 1.2, beg: 1.2, sit_on: 1.2, nudge_window: 1.2, claw: 1, ignore: 1, block_dock: 1, sprawl: 1, roll: 0.4, shy: 0.8, cozy: 0.7, nap: 0.6, follow: 0.6, sulk: 0.6, swat: 0.6, headbutt: 0.4, meow: 0.3, howl: 0.2, fetch: 0.15, carry_toy: 1.8, stash_toy: 4, nose_toy: 1, chase_cursor: 1.4, invite_play: 0.3, yawn: 0.7, look_around: 2, knead: 0, hairball: 0, nut: 3.4, cache: 3.2, cling: 3 },
  comes: 0.45,
  bite: 0.06,
  idle: ["chatter", "look", "peek", "sniff", "groom", "curious", "stare", "idle_sit", "scratch", "proud"],
  stroll: [100, 380],
  rest: [6, 14],
  runs: 0.4,
  patience: 1.3,
  potty: [1, 1.4],
  own: ["nut", "cache", "cling"],
};

export const INSTINCTS: Record<Kind, Instinct> = { cat: CAT, dog: DOG, fox: FOX, raccoon: RACCOON, rabbit: RABBIT, squirrel: SQUIRREL };
/** Animals with ways of their own inside a kind. */
const BREEDS: Record<string, Instinct> = { chihuahua: CHIHUAHUA };

/** The kind from a species name ("black cat", "puppy", "fox"...). Anything unknown acts like a cat. */
export function kindOf(species?: string): Kind {
  const s = (species ?? "").toLowerCase();
  if (/dog|puppy|pup|chihuahua/.test(s)) return "dog";
  if (/fox/.test(s)) return "fox";
  if (/raccoon/.test(s)) return "raccoon";
  if (/rabbit|bunny/.test(s)) return "rabbit";
  if (/squirrel/.test(s)) return "squirrel";
  return "cat";
}

export function instinctFor(species?: string): Instinct {
  const s = (species ?? "").toLowerCase();
  for (const [name, ins] of Object.entries(BREEDS)) if (s.includes(name)) return ins;
  return INSTINCTS[kindOf(species)];
}

/** How the chaos level changes sleepiness: chill sleeps most of the day, gremlin is rarely down. */
export const ENERGY_BY_CHAOS = {
  chill: { drain: 1, restore: 1 },
  normal: { drain: 0.55, restore: 1.5 },
  gremlin: { drain: 0.3, restore: 2.2 },
} as const;
