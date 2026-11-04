import type { Beat } from "./executor";
import type { Kind } from "./species";
import type { Rng } from "./rng";
import type { Mood } from "./types";
import { doing as d, go, leap, paced } from "./scenes";

/** What a click on the animal sets off. */
export interface Reaction {
  /** Short name, so the same one is not picked twice in a row. */
  name: string;
  script: Beat[];
  /** How it changes the needs: a happy one is play, a cross one annoys it for a while. */
  effect: "play" | "pet" | "annoy" | "none";
  /** Seconds that the mood stays sulky after it, for a cross one. */
  sulkSec?: number;
  mood: Mood;
  thought?: string;
}

export interface PokeInput {
  kind: Kind;
  /** 0 is the first poke in a while, 3 means it has had enough (or, for a dog, is worn out). */
  level: number;
  trust: number;
  energy: number;
  /** Fast and loud pokes in a row, for variety only. */
  pokes: number;
  asleep: boolean;
  /** The name of the last reaction, to avoid repeating it. */
  last?: string;
  rng: Rng;
}

type Maker = (i: PokeInput) => Reaction;
interface Variant {
  name: string;
  /** Returns 0 when the variant does not fit right now, otherwise a weight. */
  fit: (i: PokeInput) => number;
  make: Maker;
}

const r = (name: string, mood: Mood, effect: Reaction["effect"], script: Beat[], extra: Partial<Reaction> = {}): Reaction => ({ name, mood, effect, script: paced(script), ...extra });

const CAT: Record<number, Variant[]> = {
  0: [
    { name: "notice", fit: (i) => (i.trust >= 40 ? 2 : 1), make: () => r("notice", "content", "pet", [d("surprise", 0.4, "cursor"), d("stare", 1.4, "cursor"), d("blink", 1.8)]) },
    { name: "ignore", fit: (i) => (i.trust < 50 ? 3 : 1), make: () => r("ignore", "smug", "none", [d("curious", 1, "cursor"), d("yawn", 1.8), d("turn_away", 5, "away")], { thought: "you said my name. i heard. no." }) },
    { name: "headbutt", fit: (i) => (i.trust >= 45 ? 3 : 0), make: () => r("headbutt", "content", "pet", [d("surprise", 0.3, "cursor"), d("headbutt", 2.4, "cursor"), d("purr", 2.2)]) },
    { name: "sniff", fit: () => 1.5, make: () => r("sniff", "curious", "none", [d("curious", 0.9, "cursor"), d("sniff", 1.5, "cursor"), d("blink", 1.3)]) },
    { name: "pounce", fit: (i) => (i.energy > 0.45 ? 2.5 : 0.3), make: () => r("pounce", "playful", "play", [d("pounce", 1.3, "cursor"), leap("cursor", 70, 40), d("swat", 0.8, "cursor"), go("away", 160, "run"), d("proud", 1.4)]) },
  ],
  1: [
    { name: "warning swat", fit: () => 3, make: () => r("warning swat", "grumpy", "annoy", [d("annoyed", 1, "cursor"), d("swat", 0.6, "cursor"), d("annoyed", 1.2, "cursor"), d("turn_away", 4, "away")], { sulkSec: 40 }) },
    { name: "stalk off", fit: () => 2, make: () => r("stalk off", "grumpy", "annoy", [d("annoyed", 0.9, "cursor"), go("away", 150, "saunter"), d("turn_away", 5, "away")], { sulkSec: 40, thought: "i was busy being nothing." }) },
    { name: "wash it off", fit: () => 2, make: () => r("wash it off", "smug", "annoy", [d("annoyed", 1.5, "cursor"), d("swat", 0.5, "cursor"), d("groom", 3.2)], { sulkSec: 25, thought: "i meant to do that." }) },
    { name: "pounce", fit: (i) => (i.energy > 0.5 ? 2 : 0), make: () => r("pounce", "playful", "play", [d("pounce", 1.2, "cursor"), leap("cursor", 80, 45), d("swat", 0.7, "cursor"), d("swat", 0.7, "cursor"), go("away", 220, "run"), d("giggle", 1.4)]) },
  ],
  2: [
    { name: "hiss", fit: () => 3, make: () => r("hiss", "sulky", "annoy", [d("puffed", 0.5, "cursor"), d("hiss", 1.2, "cursor"), leap("away", 70, 45), go("away", 180, "run"), d("turn_away", 6, "away")], { sulkSec: 90, thought: "i have claws. you have a hand." }) },
    { name: "double swipe", fit: () => 2.5, make: () => r("double swipe", "sulky", "annoy", [d("hiss", 0.9, "cursor"), d("swat", 0.5, "cursor"), d("swat", 0.5, "cursor"), go("away", 120, "walk"), d("sulk", 5)], { sulkSec: 90 }) },
  ],
  3: [
    { name: "rage", fit: () => 3, make: () => r("rage", "sulky", "annoy", [d("angry", 1, "cursor"), d("hiss", 1.2, "cursor"), d("swat", 0.5, "cursor"), d("swat", 0.5, "cursor"), go("away", 320, "run"), d("sulk", 8, "away")], { sulkSec: 180, thought: "enough." }) },
    { name: "storm off", fit: () => 2.5, make: () => r("storm off", "sulky", "annoy", [d("puffed", 0.5, "cursor"), d("angry", 1.2, "cursor"), go("away", 420, "run"), d("turn_away", 10, "away")], { sulkSec: 180 }) },
  ],
};

const DOG: Record<number, Variant[]> = {
  0: [
    { name: "yip", fit: () => 2, make: () => r("yip", "playful", "play", [d("surprise", 0.3, "cursor"), d("bark", 1.2, "cursor"), d("happy", 2.2)]) },
    { name: "play bow", fit: () => 2.5, make: () => r("play bow", "playful", "play", [d("play_bow", 1.6, "cursor"), d("bark", 0.9, "cursor"), leap("ahead", 50, 45, "bounce"), d("happy", 1.5)]) },
    { name: "sit pretty", fit: () => 2, make: () => r("sit pretty", "content", "pet", [d("curious", 0.8, "cursor"), d("beg", 2.6, "cursor"), d("love", 1.5, "cursor")]) },
    { name: "hop hop", fit: () => 1.5, make: () => r("hop hop", "playful", "play", [d("surprise", 0.3, "cursor"), leap("away", 50, 50, "bounce"), leap("cursor", 50, 50, "bounce"), d("bark", 1)]) },
    { name: "howl", fit: () => 0.8, make: () => r("howl", "playful", "play", [d("look", 0.6, "cursor"), d("howl", 3), d("happy", 1.2)]) },
  ],
  1: [
    { name: "chase me", fit: () => 3, make: () => r("chase me", "playful", "play", [d("play_bow", 1, "cursor"), go("away", 260, "run"), d("bark", 0.8, "cursor"), go("cursor", 300, "run"), d("happy", 1.5)]) },
    { name: "zoomies", fit: () => 2.5, make: () => r("zoomies", "playful", "play", [d("bark", 0.8, "cursor"), go("away", 220, "run"), go("cursor", 450, "run"), go("away", 260, "run"), d("giggle", 1.8)]) },
    { name: "spin", fit: () => 2, make: () => r("spin", "playful", "play", [d("chase_tail", 3.5), d("dazed", 1.4), d("happy", 1.5)]) },
  ],
  2: [
    { name: "belly rub", fit: () => 3, make: () => r("belly rub", "content", "pet", [d("play_bow", 0.8, "cursor"), d("belly", 3.2), d("love", 1.6)]) },
    { name: "tumble", fit: () => 2.5, make: () => r("tumble", "playful", "play", [go("away", 150, "run", "tumble"), d("giggle", 2), d("happy", 1.5)]) },
  ],
  3: [
    { name: "worn out", fit: () => 3, make: () => r("worn out", "sleepy", "play", [d("sprawl", 5), d("yawn", 1.6)], { thought: "best day ever. so tired." }) },
    { name: "puppy eyes", fit: () => 2, make: () => r("puppy eyes", "content", "pet", [d("shy", 2.4, "cursor"), d("beg", 3, "cursor"), d("love", 1.5, "cursor")]) },
  ],
};

const FOX: Record<number, Variant[]> = {
  0: [
    { name: "pounce", fit: () => 3, make: () => r("pounce", "playful", "play", [d("curious", 1.4, "cursor"), d("pounce", 1, "cursor"), leap("cursor", 80, 55), d("swat", 0.8, "cursor"), d("proud", 1.2)]) },
    { name: "yip", fit: () => 2, make: () => r("yip", "playful", "play", [d("surprise", 0.3, "cursor"), d("bark", 1, "cursor"), d("happy", 1.8)]) },
    { name: "sniff", fit: () => 2, make: () => r("sniff", "curious", "none", [d("curious", 1, "cursor"), d("sniff", 1.4, "cursor"), d("blink", 1)]) },
  ],
  1: [
    { name: "tease", fit: () => 3, make: () => r("tease", "playful", "play", [d("play_bow", 0.9, "cursor"), go("away", 260, "run"), d("bark", 0.8, "cursor"), d("shy", 1.4, "cursor"), go("cursor", 200, "walk")]) },
    { name: "hop and pounce", fit: () => 2.5, make: () => r("hop and pounce", "playful", "play", [leap("away", 60, 50, "bounce"), d("giggle", 1.5, "cursor"), d("pounce", 1, "cursor"), leap("cursor", 90, 55), d("happy", 1.5)]) },
  ],
  2: [
    { name: "scold", fit: () => 3, make: () => r("scold", "sulky", "annoy", [d("puffed", 0.5, "cursor"), d("hiss", 1, "cursor"), leap("away", 60, 45), go("away", 160, "run"), d("flustered", 2)], { sulkSec: 60 }) },
  ],
  3: [
    { name: "play dead", fit: () => 3, make: () => r("play dead", "playful", "play", [d("startled", 0.5, "cursor"), d("dazed", 1), d("belly", 5), d("surprise", 0.6), d("proud", 1.2)], { thought: "i am dead. do not check." }) },
    { name: "huff", fit: () => 2, make: () => r("huff", "sulky", "annoy", [d("angry", 1, "cursor"), d("turn_away", 8, "away")], { sulkSec: 120 }) },
  ],
};

const RACCOON: Record<number, Variant[]> = {
  0: [
    { name: "chatter", fit: () => 2.5, make: () => r("chatter", "curious", "none", [d("curious", 1, "cursor"), d("chatter", 2.2, "cursor"), d("blink", 1)]) },
    { name: "got anything", fit: () => 2, make: () => r("got anything", "curious", "play", [d("surprise", 0.3, "cursor"), d("beg", 2.4, "cursor"), d("gift", 2)]) },
    { name: "sniff", fit: () => 1.5, make: () => r("sniff", "curious", "none", [d("sniff", 1.6, "cursor"), d("curious", 1)]) },
  ],
  1: [
    { name: "wash up", fit: () => 2.5, make: () => r("wash up", "smug", "annoy", [d("annoyed", 1, "cursor"), d("groom", 3.4), d("chatter", 1.4, "cursor")], { sulkSec: 20 }) },
    { name: "steal", fit: () => 2.5, make: () => r("steal", "smug", "play", [d("sniff", 1.2, "cursor"), d("gift", 1.2), go("away", 280, "run"), d("proud", 1.5)], { thought: "this is mine now." }) },
  ],
  2: [
    { name: "hiss and chatter", fit: () => 3, make: () => r("hiss and chatter", "sulky", "annoy", [d("puffed", 0.5, "cursor"), d("hiss", 1.2, "cursor"), d("chatter", 1.6, "cursor"), go("away", 160, "run")], { sulkSec: 70 }) },
  ],
  3: [
    { name: "tantrum", fit: () => 3, make: () => r("tantrum", "sulky", "annoy", [d("angry", 1, "cursor"), d("hiss", 1, "cursor"), d("dig", 2.4), go("away", 300, "run"), d("sulk", 6)], { sulkSec: 150 }) },
  ],
};

const TABLES: Record<Kind, Record<number, Variant[]>> = { cat: CAT, dog: DOG, fox: FOX, raccoon: RACCOON };

/** Woken by a click: every animal is a bit put out, but a dog is soon happy about it. */
function wokenUp(i: PokeInput): Reaction {
  if (i.kind === "dog") return r("woken happy", "playful", "play", [d("surprise", 0.5, "cursor"), d("stretch", 1.6), d("bark", 1), d("happy", 1.8)]);
  if (i.kind === "fox") return r("woken curious", "curious", "none", [d("surprise", 0.5, "cursor"), d("yawn", 1.6), d("curious", 1.2, "cursor")]);
  if (i.kind === "raccoon") return r("woken grumpy", "grumpy", "annoy", [d("annoyed", 1.2, "cursor"), d("chatter", 1.4, "cursor"), d("yawn", 1.4)], { sulkSec: 15 });
  return r("woken cross", "grumpy", "annoy", [d("annoyed", 1.4, "cursor"), d("yawn", 1.6), d("turn_away", 3, "away")], { sulkSec: 30, thought: "i was using that nap." });
}

/** Picks what the animal does when it is poked (clicked), by how many pokes it has had and how it feels. */
export function pokeReaction(i: PokeInput): Reaction {
  if (i.asleep && i.level < 2) return wokenUp(i);
  const table = TABLES[i.kind];
  const level = Math.max(0, Math.min(3, i.level));
  const options = (table[level] ?? table[0] ?? []).map((v) => ({ v, w: v.fit(i) * (v.name === i.last ? 0.15 : 1) })).filter((o) => o.w > 0);
  const pool = options.length ? options : (table[0] ?? []).map((v) => ({ v, w: 1 }));
  const total = pool.reduce((a, o) => a + o.w, 0);
  let roll = i.rng.next() * total;
  for (const o of pool) {
    roll -= o.w;
    if (roll <= 0) return o.v.make(i);
  }
  return (pool[pool.length - 1] as { v: Variant }).v.make(i);
}

/** How long a script takes, roughly, in seconds (walks counted at a run). */
export function scriptSeconds(script: Beat[]): number {
  return script.reduce((t, b) => t + ("do" in b ? b.sec : "go" in b ? b.by / 150 + 0.3 : 0.6), 0);
}
