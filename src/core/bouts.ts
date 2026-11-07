import type { Rng } from "./rng";
import type { Kind } from "./species";
import type { ChaosLevel, IntentName, Needs, WorldSnapshot } from "./types";

/**
 * Animals don't pick a random thing every few seconds. They live in stretches: a long rest, then
 * they get up, stretch and look around, play for a bit, wash, and settle again (Bradshaw, "Cat
 * Sense": house cats rest or sleep most of the day and are active in short bouts). A bout is one
 * such stretch. Inside it the animal only does things that belong to it, with its own pause between
 * two of them, and a bout lasts minutes, not seconds. Abozar found the old one-pick-at-a-time
 * series "not natural" (6 Nov 2026).
 */
export type BoutKind = "rest" | "explore" | "play" | "social" | "mischief";
export const BOUT_KINDS: readonly BoutKind[] = ["rest", "explore", "play", "social", "mischief"];

/** What each bout is for. The model reads these words too. */
export const BOUT_MEANING: Record<BoutKind, string> = {
  rest: "lie about, wash, doze, watch the room",
  explore: "stroll about, sniff, peek over windows, inspect your territory",
  play: "chase, pounce, bounce, roll: burn off energy",
  social: "go to your human: follow, rub, meow, sit on what they are using",
  mischief: "make trouble on purpose: knock things off, sit on the work, block the dock",
};

/** The actions that belong to each bout. */
export const BOUT_INTENTS: Record<BoutKind, readonly IntentName[]> = {
  rest: ["nap", "nap_warm", "cozy", "knead", "groom", "sprawl", "perch", "watch", "slow_blink", "stare", "ignore", "box", "scratch", "sneeze", "yawn", "look_around", "trick"],
  explore: ["wander", "tour", "peek", "sniff", "perch", "cross", "chatter", "dig", "spook", "scratch", "watch", "box", "look_around", "nose_toy", "stash_toy", "trick", "pee", "poop"],
  play: ["chase_tail", "bounce", "tumble", "roll", "stalk", "swat", "zoomies", "spook", "knock_toy", "hunt", "play_cursor", "chase_cursor", "fetch", "carry_toy", "nose_toy", "stash_toy", "invite_play", "trick"],
  social: ["follow", "headbutt", "meow", "beg", "slow_blink", "sit_on", "keyboard_walk", "block_dock", "cross", "gift", "howl", "roll", "shy", "invite_play", "fetch", "trick"],
  mischief: ["knock_off", "claw", "sit_on", "sit_on_video", "keyboard_walk", "block_dock", "zoomies", "hairball", "knock_toy", "nudge_window", "swat", "chase_cursor", "carry_toy", "trick", "pee", "poop"],
};

/** How long a bout lasts at the normal level, in seconds. */
const LENGTH: Record<BoutKind, [number, number]> = {
  rest: [240, 600],
  explore: [90, 200],
  play: [50, 120],
  social: [60, 150],
  mischief: [90, 200],
};
const LENGTH_BY_CHAOS: Record<ChaosLevel, Record<BoutKind, number>> = {
  chill: { rest: 1.6, explore: 0.9, play: 0.7, social: 0.9, mischief: 0.5 },
  normal: { rest: 1, explore: 1, play: 1, social: 1, mischief: 1 },
  gremlin: { rest: 0.45, explore: 1, play: 1.3, social: 1, mischief: 1.4 },
};

/**
 * Seconds of just sitting there between two actions of the same bout, at the normal level. A rest
 * bout is mostly pauses; a play bout has short ones. The species gap and laziness stretch these.
 */
export const PAUSE: Record<BoutKind, [number, number]> = {
  rest: [20, 45],
  explore: [9, 20],
  play: [7, 14],
  social: [8, 16],
  mischief: [8, 16],
};
export const PAUSE_BY_CHAOS: Record<ChaosLevel, number> = { chill: 1.6, normal: 1, gremlin: 0.55 };

/** Which bout tends to follow which. Rows are the bout that just ended. */
const NEXT: Record<BoutKind | "start", Record<BoutKind, number>> = {
  start: { rest: 2, explore: 2, play: 0.5, social: 1, mischief: 0.3 },
  rest: { rest: 0.3, explore: 3, play: 1.5, social: 2, mischief: 1 },
  explore: { rest: 2, explore: 0.3, play: 2, social: 1.5, mischief: 1 },
  play: { rest: 3, explore: 1, play: 0.2, social: 1, mischief: 0.6 },
  social: { rest: 2.5, explore: 1.5, play: 1, social: 0.3, mischief: 0.8 },
  mischief: { rest: 3, explore: 1, play: 1, social: 0.5, mischief: 0.2 },
};

/** A kind that isn't listed (a new animal) gets no bias. */
const KIND_BIAS: Partial<Record<string, Partial<Record<BoutKind, number>>>> = {
  cat: { rest: 1.3, social: 0.8 },
  dog: { rest: 0.7, social: 1.6, play: 1.4 },
  fox: { explore: 1.4, play: 1.2 },
  raccoon: { mischief: 1.5, explore: 1.2 },
  rabbit: { rest: 1.2, explore: 1.2, social: 0.7 },
  squirrel: { explore: 1.5, play: 1.3, rest: 0.7 },
};

const CHAOS_BIAS: Record<ChaosLevel, Record<BoutKind, number>> = {
  chill: { rest: 1.5, explore: 1, play: 0.6, social: 1, mischief: 0 },
  normal: { rest: 1, explore: 1, play: 1, social: 1, mischief: 0.45 },
  gremlin: { rest: 0.6, explore: 0.9, play: 1.4, social: 0.9, mischief: 2.4 },
};

export interface BoutInput {
  last: BoutKind | null;
  chaos: ChaosLevel;
  needs: Needs;
  kind: Kind;
  world: WorldSnapshot;
}

/** How likely each bout is next. Zero means not now. */
export function boutWeights(i: BoutInput): Record<BoutKind, number> {
  const n = i.needs;
  const w = { ...NEXT[i.last ?? "start"] };
  w.rest *= 0.5 + 2 * (1 - n.energy);
  w.play *= (0.3 + 1.4 * n.energy) * (n.mood === "playful" ? 1.6 : 1);
  w.social *= (0.4 + 1.6 * n.attention) * (n.mood === "sulky" || n.mood === "grumpy" ? 0.3 : 1);
  w.explore *= 0.5 + n.curiosity;
  w.mischief *= 0.5 + n.attention;
  const night = i.world.hour >= 22 || i.world.hour < 5;
  const zoomHour = i.world.hour >= 2 && i.world.hour < 4;
  if (night) w.rest *= 1.8;
  if (zoomHour) w.play *= 2;
  // Nobody to bother: rest. Someone busy: worth bothering.
  if (i.world.activity === "away") {
    w.rest *= 2;
    w.social *= 0.4;
    w.mischief *= 0.5;
  }
  if (i.world.activity === "typing_fast") {
    w.social *= 1.3;
    w.mischief *= 1.3;
  }
  for (const k of BOUT_KINDS) w[k] *= (KIND_BIAS[i.kind]?.[k] ?? 1) * CHAOS_BIAS[i.chaos][k];
  // Worn out: only rest.
  if (n.energy < 0.25) for (const k of BOUT_KINDS) if (k !== "rest") w[k] = 0;
  return w;
}

export function pickBout(weights: Record<BoutKind, number>, rng: Rng): BoutKind {
  const total = BOUT_KINDS.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  if (total <= 0) return "rest";
  let roll = rng.next() * total;
  for (const k of BOUT_KINDS) {
    roll -= Math.max(0, weights[k]);
    if (roll <= 0) return k;
  }
  return "rest";
}

/** How long this bout goes on, in ms. */
export function boutLengthMs(kind: BoutKind, chaos: ChaosLevel, rng: Rng, gap = 1): number {
  const [lo, hi] = LENGTH[kind];
  // A slow animal (a cat) rests longer; a quick one (a dog) doesn't rest longer, it plays longer.
  const g = kind === "rest" ? gap : 1;
  return rng.range(lo, hi) * LENGTH_BY_CHAOS[chaos][kind] * g * 1000;
}

/**
 * The move that opens a bout, which makes the change read as an animal's: after lying down it gets
 * up with a stretch; after playing it washes. Null when nothing is needed.
 */
export function openingMove(from: BoutKind | null, to: BoutKind, kind: Kind, wasLying: boolean, rng: Rng): IntentName | null {
  if ((from === "play" || from === "mischief") && to !== from) {
    // Cats wash after a bout of play ("displacement grooming"); dogs mostly don't.
    const p = kind === "dog" ? 0.2 : 0.75;
    if (rng.next() < p) return "groom";
  }
  if (to !== "rest" && (from === "rest" || wasLying) && rng.next() < 0.7) return "stretch";
  return null;
}
