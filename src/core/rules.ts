import { BY_INTENT, CHAOS_PARAMS } from "./behaviors";
import type { Habits } from "./habits";
import type { Personality } from "./personality";
import { instinctFor } from "./species";
import type { Rng } from "./rng";
import type { Approach, ChaosLevel, Intent, IntentName, Mood, Needs, Option, WindowInfo, WorldSnapshot } from "./types";

export interface RulesContext {
  world: WorldSnapshot;
  needs: Needs;
  personality: Personality;
  /** Show window titles to the rules (smart targeting is on). */
  smartTargeting: boolean;
  /** Where the cat is right now. */
  catPos: { x: number; y: number };
  justWoke: boolean;
  /** Most recent intents, newest last. */
  recent: IntentName[];
  rng: Rng;
  /** What the cat has learned. Nudges scores a little. */
  habits?: Habits;
  /** The chaos level. A chill cat naps more, a gremlin hardly stops. */
  chaos?: ChaosLevel;
}

const ACTIVE: IntentName[] = ["wander", "zoomies", "chase_tail", "stalk", "swat", "knock_toy", "perch", "tour", "sit_on", "sit_on_video", "peek", "meow", "headbutt", "nudge_window", "keyboard_walk", "chatter", "cross", "block_dock", "bounce", "tumble", "spook", "sniff", "dig", "roll"];
/** How much each chaos level changes napping and active behaviors. */
const PACE: Record<ChaosLevel, { nap: number; active: number; stay: number }> = {
  chill: { nap: 1.2, active: 0.8, stay: 1.25 },
  normal: { nap: 0.8, active: 1.1, stay: 1 },
  gremlin: { nap: 0.3, active: 2, stay: 0.4 },
};

const IMPORTANT_TITLE = /\.(docx?|xlsx?|pptx?|pdf|md|key|pages|numbers)\b|thesis|invoice|report|submit|deploy|contract|resume/i;
const VIDEO_TITLE = /youtube|netflix|vimeo|twitch|disney|prime video|video/i;
const VIDEO_APP = /vlc|quicktime|iina|plex/i;

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function focusedWindow(world: WorldSnapshot): WindowInfo | undefined {
  return world.windows.find((w) => w.focused);
}

export function importantWindow(world: WorldSnapshot): WindowInfo | undefined {
  return world.windows.find((w) => w.title && IMPORTANT_TITLE.test(w.title));
}

export function videoWindow(world: WorldSnapshot): WindowInfo | undefined {
  return world.windows.find((w) => (w.title && VIDEO_TITLE.test(w.title)) || VIDEO_APP.test(w.app));
}

export function hottestWindow(world: WorldSnapshot): WindowInfo | undefined {
  return world.windows.find((w) => w.cpu === "high");
}

/** Builds every behavior that makes sense now, with a score. The governor filters it after. */
export function candidates(ctx: RulesContext): Option[] {
  const { world: w, needs: n, personality: p } = ctx;
  const e = n.energy;
  const a = n.attention;
  const c = n.curiosity;
  const sleepy = Math.pow(1 - e, 1.5);
  const focused = focusedWindow(w);
  const active = w.activity === "typing" || w.activity === "typing_fast" || w.activity === "reading";
  const activeFit = active ? (w.activity === "typing_fast" ? 1.2 : 1) : w.activity === "idle" ? 0.4 : 0.15;
  const aloof = 1 - 0.5 * p.aloofness;
  const catDist = dist(ctx.catPos, w.cursor);
  const out: Option[] = [];
  const add = (intent: IntentName, score: number, targets: string[]) => {
    if (score > 0 && targets.length > 0) out.push({ intent, score, targets });
  };

  add("nap", 0.15 + 3 * sleepy * (0.5 + p.laziness), ["here", "dock"]);
  const hot = hottestWindow(w);
  if (hot) add("nap_warm", sleepy * 2.6 * (0.5 + p.laziness), [hot.id]);
  add("wander", 0.35 + 0.6 * c * e, ["here", "cursor", "corner", ...w.windows.slice(0, 4).map((x) => x.id)]);
  add("perch", 0.1 + 0.3 * e, w.windows.slice(0, 4).map((x) => x.id));
  add("groom", 0.2, ["here"]);
  if (w.cursorSpeed > 20) add("watch", 0.4, ["cursor"]);
  if (ctx.justWoke) add("stretch", 1.5, ["here"]);
  add("stare", 0.05 * e, ["corner"]);
  if (n.trust >= 60) add("slow_blink", (n.mood === "content" ? 0.3 : 0.1) * aloof, ["cursor"]);

  // Attention seeking
  if (w.appSwitchedSecAgo < 30 && focused) add("follow", a * 0.9 * (0.5 + p.neediness) * aloof * activeFit, [focused.id]);
  if (focused) add("cross", a * 0.8 * activeFit, [focused.id]);
  if (catDist < 300) add("headbutt", a * 0.8 * aloof, ["cursor"]);
  // Trailing you around is what dogs do all day, and cats do when they feel like it.
  if (catDist > 200) add("follow", 0.25 + 0.5 * a, ["cursor"]);
  add("meow", a * 0.6 * (0.5 + p.neediness) * aloof, ["here"]);
  const sitTargets: string[] = [];
  const important = ctx.smartTargeting ? importantWindow(w) : undefined;
  if (important) sitTargets.push(important.id);
  if (focused && !sitTargets.includes(focused.id)) sitTargets.push(focused.id);
  add("sit_on", Math.pow(a, 1.5) * 1.4 * (0.4 + p.chaos * 0.8) * activeFit, sitTargets);
  const video = ctx.smartTargeting ? videoWindow(w) : undefined;
  if (video) add("sit_on_video", a * 1.2 * (0.5 + p.chaos), [video.id]);
  if (a > 0.6) add("block_dock", a * (0.3 + p.chaos), ["dock"]);
  if ((w.activity === "typing" || w.activity === "typing_fast") && a > 0.4 && focused) {
    add("keyboard_walk", a * 1.1, [focused.id]);
  }

  // Mischief
  if (catDist < 400 && e > 0.4) add("swat", 0.5 * (0.4 + p.chaos) * e, ["cursor"]);
  const fresh = w.windows.filter((x) => x.isNew && x.isEmpty).map((x) => x.id);
  add("box", 0.9, fresh);
  if (n.trust > 40 && a < 0.5 && e > 0.4) add("gift", 0.25, ["here"]);
  if (a > 0.85) add("hairball", 0.7, ["here"]);
  if (e > 0.5 && n.mood === "playful") add("knock_toy", 0.4 * (p.chaos + 0.3), ["here"]);
  const zoomHour = w.hour >= 2 && w.hour < 4 && e > 0.6;
  add("zoomies", zoomHour ? 1.2 : ctx.justWoke && e > 0.9 ? 0.8 : 0.02, ["here"]);
  if (focused) add("nudge_window", a * 0.8 * p.chaos, [focused.id]);

  // Small, quiet things a cat does.
  const wins = w.windows.slice(0, 4).map((x) => x.id);
  add("peek", 0.15 + 0.45 * c, wins);
  if (e > 0.5) add("chase_tail", (n.mood === "playful" ? 0.5 : 0.12) * (0.4 + p.chaos), ["here"]);
  add("knead", 0.1 + 0.8 * sleepy, ["here"]);
  add("chatter", 0.08 + 0.25 * c, ["here"]);
  add("sneeze", 0.05, ["here"]);

  // Animal things. How much each animal likes them comes from its instinct weights.
  const night = w.hour >= 22 || w.hour < 5;
  add("scratch", 0.12 + 0.1 * e, ["here"]);
  add("sniff", 0.1 + 0.35 * c, ["here"]);
  if (e > 0.4) add("dig", 0.04 + 0.2 * c * e, ["here"]);
  if (e > 0.45) add("roll", 0.05 + 0.2 * (n.trust / 100) * e, ["here"]);
  if (e > 0.55) add("bounce", 0.06 + (n.mood === "playful" ? 0.35 : 0.05) * e, ["here"]);
  if (e > 0.55) add("tumble", 0.05 + (n.mood === "playful" ? 0.3 : 0.04) * e, ["here"]);
  if (e > 0.4) add("spook", 0.04 + 0.06 * e, ["here"]);
  add("howl", night ? 0.15 : 0.03, ["here"]);
  add("sprawl", 0.05 + 0.35 * sleepy * (0.4 + p.laziness), ["here"]);
  add("shy", n.trust < 40 ? 0.15 : 0.03, ["here"]);
  if (catDist > 150 && catDist < 700 && n.trust > 25) add("beg", 0.1 + 0.3 * a, ["cursor"]);

  // Routines: several moves chosen as one.
  if (catDist < 500 && e > 0.5) add("stalk", 0.45 * (0.4 + p.chaos) * e, ["cursor"]);
  add("tour", 0.1 + 0.4 * c * e, wins);
  add("cozy", 1.1 * sleepy * (0.4 + p.laziness), ["here"]);

  // A sulking cat avoids you. A tired one doesn't bother.
  for (const o of out) {
    const cat = BY_INTENT.get(o.intent)?.category;
    if (n.mood === "sulky") {
      if (cat === "attention") o.score *= 0.2;
      if (cat === "mischief") o.score *= 0.5;
    }
    // Variety: what it just did is far less likely again, and anything done lately a little less.
    const lately = ctx.recent.slice(-10);
    if (lately[lately.length - 1] === o.intent) o.score *= 0.3;
    for (const r of lately) if (r === o.intent) o.score *= 0.75;
    if (ctx.habits) o.score *= ctx.habits.multiplier(o.intent);
    o.score *= instinctFor(ctx.personality.species).weights[o.intent] ?? 1;
    const pace = PACE[ctx.chaos ?? "normal"];
    if (o.intent === "nap" || o.intent === "nap_warm" || o.intent === "cozy") o.score *= pace.nap;
    else if (ACTIVE.includes(o.intent)) o.score *= pace.active;
    o.score *= ctx.rng.range(0.8, 1.2);
  }
  return out.sort((x, y) => y.score - x.score);
}

export function defaultStay(intent: IntentName, chaos: ChaosLevel, rng: Rng): number {
  const def = BY_INTENT.get(intent);
  if (!def) return 20;
  const max = def.maxStay === "block" ? CHAOS_PARAMS[chaos].maxBlockSec : def.maxStay;
  const min = def.minStay ?? 5;
  // Naps used to last 10 to 30 minutes at every chaos level. Now a chill cat sleeps in, a gremlin dozes.
  if (intent === "nap" || intent === "nap_warm") {
    const range = { chill: [300, 1200], normal: [120, 480], gremlin: [40, 150] }[chaos];
    return Math.round(rng.range(range[0] as number, Math.min(max, range[1] as number)));
  }
  const hi = Math.max(min + 1, Math.min(max, def.maxStay === "block" ? max * 0.7 : 60));
  const stay = rng.range(Math.min(min + 5, hi - 1), hi) * PACE[chaos].stay;
  return Math.max(3, Math.round(stay));
}

export function defaultApproach(intent: IntentName, mood: Mood, rng: Rng): Approach {
  if (intent === "zoomies") return "run";
  if (intent === "sit_on" || intent === "sit_on_video" || intent === "cross") return mood === "smug" || mood === "grumpy" ? "saunter" : "walk";
  if (intent === "swat" || intent === "knock_toy" || intent === "stalk") return "sneak";
  return rng.pick(["walk", "walk", "saunter"] as const);
}

const MOOD_THOUGHTS: Partial<Record<IntentName, string[]>> = {
  sit_on: ["this window is warm. it's mine now.", "you looked busy. fixed that."],
  cross: ["just passing through. slowly."],
  meow: ["you said nothing. i said something."],
  nap: ["not sleeping. resting my eyes."],
  headbutt: ["pay attention to me."],
  block_dock: ["the dock was too straight."],
  ignore: ["you said my name. i heard. no."],
  peek: ["i see you. you don't see me."],
  chase_tail: ["it started it."],
  knead: ["making biscuits. do not interrupt."],
  chatter: ["a bird looked at me. rude."],
  sneeze: ["that was not a sneeze. that was a statement."],
  stalk: ["i am not following your cursor. i am hunting it."],
  tour: ["inspecting my property."],
  cozy: ["knead, turn around three times, sleep. the rules."],
  spook: ["did you see that. neither did i."],
  scratch: ["this sofa is mine. not yet. it will be."],
  dig: ["buried it. you will never know where."],
  sprawl: ["flat is a valid shape."],
};

/** Turns one option into a ready intent (used by the rules brain and the fake LLM). */
export function intentFromOption(o: Option, ctx: RulesContext, chaos: ChaosLevel, withThought: boolean): Intent {
  const mood = ctx.needs.mood;
  const intent: Intent = {
    intent: o.intent,
    target: o.targets[0] as string,
    approach: defaultApproach(o.intent, mood, ctx.rng),
    stay_sec: defaultStay(o.intent, chaos, ctx.rng),
    mood,
  };
  const lines = ctx.personality.voice?.[o.intent] ?? MOOD_THOUGHTS[o.intent];
  if (withThought && lines && ctx.rng.next() < 0.15) intent.thought = ctx.rng.pick(lines);
  return intent;
}
