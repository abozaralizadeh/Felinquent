import { BY_INTENT, CHAOS_PARAMS } from "./behaviors";
import type { Habits } from "./habits";
import type { Personality } from "./personality";
import { instinctFor } from "./species";
import type { Rng } from "./rng";
import type { TrickBook } from "./tricks";
import type { Approach, ChaosLevel, Intent, IntentName, Mood, Needs, Option, SeenThing, WindowInfo, WorldSnapshot } from "./types";

/** The animal's toy, as the brain sees it (mess.ts). */
export interface ToyView {
  kind: string;
  x: number;
  y: number;
  /** lying: still, where the animal can get it; rolling; held: in your hand; carried: in its mouth; buried: it buried it. */
  state: "lying" | "rolling" | "held" | "carried" | "buried";
  /** Seconds since you threw it or put it down (Infinity: you didn't). */
  thrownSecAgo: number;
}

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
  /** Its own tricks (tricks.ts). */
  tricks?: TrickBook;
  /** The chaos level. A chill cat naps more, a gremlin hardly stops. */
  chaos?: ChaosLevel;
  /** Windows with a thing standing on top (mess.ts), which can be knocked off. */
  propWindows?: string[];
  /** Its toy, if it is out (or buried). */
  toy?: ToyView | null;
  /** Everything else of the mess it can see (Mess.seen), for the model's screen block. */
  scene?: SeenThing[];
  /** How badly it has to pee and to poop (mind.ts, ADR-048): from 1 it has to go. */
  potty?: { pee: number; poop: number };
}

const ACTIVE: IntentName[] = ["chase_cursor", "fetch", "carry_toy", "invite_play", "play_cursor", "follow", "knock_off", "claw", "hunt", "wander", "zoomies", "chase_tail", "stalk", "swat", "knock_toy", "perch", "tour", "sit_on", "sit_on_video", "peek", "meow", "headbutt", "nudge_window", "keyboard_walk", "chatter", "cross", "block_dock", "bounce", "tumble", "spook", "sniff", "dig", "roll"];
/** How much each chaos level changes napping and active behaviors. */
// A gremlin used to cut every action to 40% of its length, which read as "very fast" on the real
// screen (Abozar, 6 Nov 2026). It does more things, not each thing in a hurry.
const PACE: Record<ChaosLevel, { nap: number; active: number; stay: number }> = {
  chill: { nap: 1.2, active: 0.8, stay: 1.35 },
  normal: { nap: 0.8, active: 1.1, stay: 1.15 },
  gremlin: { nap: 0.3, active: 2, stay: 0.8 },
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
  // Trailing your cursor around (and telling you about it) is what dogs do all day, and cats do when
  // they feel like it. Playing with it is for when it moves near them.
  if (catDist > 200) add("follow", 0.25 + 0.5 * a, ["cursor"]);
  if (catDist < 450 && w.cursorSpeed > 60 && e > 0.4) add("play_cursor", (n.mood === "playful" ? 0.75 : 0.3) * e * (0.6 + 0.4 * p.curiosity), ["cursor"]);
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
  // Its toy. Just thrown by you, it's the most interesting thing in the world (for a dog, anyway:
  // how much each animal cares, and what it does with it, comes from its instinct weights).
  const toy = ctx.toy;
  const thrown = toy && toy.thrownSecAgo < 45 ? 1 - toy.thrownSecAgo / 90 : 0;
  const playful = e > 0.5 && n.mood === "playful" ? 0.4 * (p.chaos + 0.3) : 0;
  // Just thrown and still flying or rolling counts too: it goes for it as it lands (the executor
  // watches it until it can get to it).
  const toyOut = toy && (toy.state === "lying" || (toy.state === "rolling" && toy.thrownSecAgo < 10));
  add("knock_toy", playful + (toyOut ? 1.6 * thrown * e : 0), ["here"]);
  if (toy && toyOut) {
    const near = dist(ctx.catPos, toy) < 700 ? 1 : 0.6;
    add("fetch", (0.06 + 2.4 * thrown) * (0.4 + e) * near * (0.6 + n.trust / 250), ["toy"]);
    add("carry_toy", (0.08 + 1.3 * thrown) * near, ["toy"]);
    add("stash_toy", (0.05 + 1 * thrown) * near, ["toy"]);
    add("nose_toy", (0.08 + 1 * thrown) * near * (0.5 + c), ["toy"]);
  }
  // A play bow at you: "chase me". Mostly dogs.
  if (catDist < 1000 && e > 0.5) add("invite_play", (0.08 + 0.35 * a) * (n.mood === "playful" ? 1.6 : 1) * aloof, ["cursor"]);
  // Running after the cursor while it moves: a gremlin does it a lot, a normal animal now and then.
  const chase = { chill: 0, normal: 0.12, gremlin: 0.9 }[ctx.chaos ?? "normal"];
  if (w.cursorSpeed > 150 && e > 0.45 && catDist < 1400) add("chase_cursor", chase * (0.5 + p.chaos) * e * (n.mood === "playful" ? 1.5 : 1), ["cursor"]);
  const zoomHour = w.hour >= 2 && w.hour < 4 && e > 0.6;
  add("zoomies", zoomHour ? 1.2 : ctx.justWoke && e > 0.9 ? 0.8 : 0.02, ["here"]);
  if (focused) add("nudge_window", a * 0.8 * p.chaos, [focused.id]);
  // A thing on a window is there to be pushed off it, slowly, while you watch.
  const props = (ctx.propWindows ?? []).filter((id) => w.windows.some((x) => x.id === id));
  if (props.length > 0 && e > 0.3) add("knock_off", (0.5 + 0.9 * a) * (0.4 + p.chaos), props);
  if (e > 0.4) add("claw", (0.06 + 0.3 * a * e) * (0.3 + p.chaos), w.windows.slice(0, 4).map((x) => x.id));

  // Small, quiet things a cat does.
  const wins = w.windows.slice(0, 4).map((x) => x.id);
  add("peek", 0.15 + 0.45 * c, wins);
  if (e > 0.5) add("chase_tail", (n.mood === "playful" ? 0.5 : 0.12) * (0.4 + p.chaos), ["here"]);
  add("knead", 0.1 + 0.8 * sleepy, ["here"]);
  add("chatter", 0.08 + 0.25 * c, ["here"]);
  add("sneeze", 0.05, ["here"]);
  add("yawn", 0.04 + 0.35 * sleepy, ["here"]);
  add("look_around", 0.08 + 0.25 * c, ["here"]);

  // It has to go (rare, mind.ts keeps count). Once it does, that comes before anything else. Where:
  // mostly where it is, sometimes off in a corner or on the Dock, and a gremlin likes your window.
  const potty = ctx.potty;
  if (potty && (potty.pee >= 1 || potty.poop >= 1)) {
    const first = ctx.rng.pick(["here", "here", "corner", "dock"]);
    const spots = [first, ...["here", "corner", "dock"].filter((t) => t !== first)];
    if (ctx.chaos === "gremlin" && focused && ctx.rng.next() < 0.6) spots.unshift(focused.id);
    if (potty.pee >= 1) add("pee", 4 + potty.pee, spots);
    if (potty.poop >= 1) add("poop", 4.2 + potty.poop, spots);
  }

  // Animal things. How much each animal likes them comes from its instinct weights.
  const night = w.hour >= 22 || w.hour < 5;
  add("scratch", 0.12 + 0.1 * e, ["here"]);
  add("sniff", 0.1 + 0.35 * c, ["here"]);
  if (e > 0.4) add("dig", 0.04 + 0.2 * c * e, ["here"]);
  if (e > 0.45) add("roll", 0.05 + 0.2 * (n.trust / 100) * e, ["here"]);
  if (e > 0.55) add("bounce", 0.06 + (n.mood === "playful" ? 0.35 : 0.05) * e, ["here"]);
  if (e > 0.55) add("tumble", 0.05 + (n.mood === "playful" ? 0.3 : 0.04) * e, ["here"]);
  if (e > 0.4) add("spook", 0.04 + 0.06 * e, ["here"]);
  if (e > 0.4) add("hunt", 0.06 + 0.22 * c * e, ["here"]);
  add("howl", night ? 0.15 : 0.03, ["here"]);
  add("sprawl", 0.05 + 0.35 * sleepy * (0.4 + p.laziness), ["here"]);
  add("shy", n.trust < 40 ? 0.15 : 0.03, ["here"]);
  if (catDist > 150 && catDist < 700 && n.trust > 25) add("beg", 0.1 + 0.3 * a, ["cursor"]);

  // Routines: several moves chosen as one.
  if (catDist < 500 && e > 0.5) add("stalk", 0.45 * (0.4 + p.chaos) * e, ["cursor"]);
  add("tour", 0.1 + 0.4 * c * e, wins);
  add("cozy", 1.1 * sleepy * (0.4 + p.laziness), ["here"]);

  // Its own tricks: every one is scored like an action (what you think of it, how fresh, how new),
  // then only the best of each kind stays on the menu. No rude tricks at chill, nothing lively when tired.
  for (const t of ctx.tricks?.all ?? []) {
    if (t.kind === "mischief" && (ctx.chaos ?? "normal") === "chill") continue;
    if ((t.kind === "play" || t.kind === "mischief") && e < 0.45) continue;
    if (t.kind === "rest" && e > 0.85) continue;
    out.push({ intent: "trick", targets: ["here"], score: 0.14, trick: t.id, kind: t.kind });
  }

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
    // What it learned you like, what it is bored of, and what it hasn't tried much (habits.ts).
    if (ctx.habits) o.score *= ctx.habits.multiplier(o.trick ? `trick:${o.trick}` : o.intent, ctx.world.nowMs, ctx.rng);
    o.score *= instinctFor(ctx.personality.species).weights[o.intent] ?? 1;
    const pace = PACE[ctx.chaos ?? "normal"];
    if (o.intent === "nap" || o.intent === "nap_warm" || o.intent === "cozy") o.score *= pace.nap;
    else if (ACTIVE.includes(o.intent)) o.score *= pace.active;
    o.score *= ctx.rng.range(0.8, 1.2);
  }
  // Of its tricks, only the best of each kind right now is on the menu.
  const best = new Map<string, Option>();
  for (const o of out) if (o.trick && o.kind && (best.get(o.kind)?.score ?? -1) < o.score) best.set(o.kind, o);
  return out.filter((o) => !o.trick || (o.kind !== undefined && best.get(o.kind) === o)).sort((x, y) => y.score - x.score);
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
  if (intent === "zoomies" || intent === "chase_cursor" || intent === "fetch") return "run";
  if (intent === "sit_on" || intent === "sit_on_video" || intent === "cross") return mood === "smug" || mood === "grumpy" ? "saunter" : "walk";
  if (intent === "swat" || intent === "knock_toy" || intent === "stalk" || intent === "knock_off") return "sneak";
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
  scratch: ["an itch. behind the ear. very serious."],
  dig: ["buried it. you will never know where."],
  sprawl: ["flat is a valid shape."],
  knock_off: ["it was too close to the edge. now it isn't.", "gravity check."],
  claw: ["this window needed texture."],
  hunt: ["a fly. this is my moment."],
  play_cursor: ["the little arrow is mine.", "it moved. it has to be stopped."],
  follow: ["where are we going. i'm coming too."],
  knock_toy: ["the ball started it."],
  fetch: ["again. throw it again.", "got it. you're welcome."],
  carry_toy: ["mine. i'm taking it somewhere you can't see.", "this is mine now."],
  stash_toy: ["buried. for later. don't look.", "you saw nothing."],
  nose_toy: ["is it alive. checking.", "it smells like you."],
  chase_cursor: ["it ran. so i ran.", "come back here, arrow."],
  invite_play: ["you. me. chase. now.", "bottom up means play. everyone knows that."],
  pee: ["when you have to go, you have to go.", "this spot looked important."],
  poop: ["don't look. seriously, don't look.", "a little present. for you."],
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
  if (o.trick) intent.trick = o.trick;
  const lines = ctx.personality.voice?.[o.intent] ?? MOOD_THOUGHTS[o.intent];
  if (withThought && lines && ctx.rng.next() < 0.15) intent.thought = ctx.rng.pick(lines);
  return intent;
}
