import { behavior } from "./behaviors";
import { BOUT_INTENTS, BOUT_KINDS, PAUSE, PAUSE_BY_CHAOS, boutLengthMs, boutWeights, openingMove, pickBout, type BoutKind } from "./bouts";
import { weighted, type Brain, type BrainContext, type Plan, type PlanContext } from "./brain";
import { Governor, respectPlan, respectState, type RespectState } from "./governor";
import type { Memory } from "./memory";
import { applyEvent, initialNeeds, stepNeeds, type NeedsEvent } from "./needs";
import type { Personality } from "./personality";
import { ENERGY_BY_CHAOS, instinctFor } from "./species";
import type { ReflexKind } from "./reflexes";
import { pokeReaction, scriptSeconds } from "./reactions";
import { doing } from "./scenes";
import { lineFor } from "./lines";
import { seeded, type Rng } from "./rng";
import { candidates, focusedWindow, intentFromOption, type RulesContext, type ToyView } from "./rules";
import { spotWords, thoughtTopic, toyName, treatName } from "./summary";

export { spotWords, toyName, treatName };
import type { ChaosLevel, Intent, IntentName, Needs, Option, Settings, WorldSnapshot } from "./types";

export type MindEvent =
  | { type: "intent"; intent: Intent; source: "llm" | "rules" | "respect" | "reflex" | "safe" }
  | { type: "wake" }
  | { type: "respect"; state: RespectState["kind"] }
  | { type: "llm_problem"; message: string };

export interface MindDeps {
  /** The main brain. When it is the same object as `fallback`, no LLM is used. */
  brain: Brain;
  fallback: Brain;
  governor: Governor;
  rng: Rng;
  personality: Personality;
  memory: Memory;
  catPos: () => { x: number; y: number };
  catWhere: () => string;
  catDoing: () => string;
  /** Windows with something standing on them that could be knocked off (mess.ts). */
  propWindows?: () => string[];
  /** The same, said for the model: "mug on w3". */
  things?: () => string[];
  /** Its toy, where it is and what state it is in (mess.ts). */
  toy?: () => ToyView | null;
  /** Never receives window titles. */
  log?: (message: string, fields?: Record<string, unknown>) => void;
  minDecisionGapMs?: number;
}

const WAKE_ENERGY = 0.85;
/** What you can ask it from the menu on the animal (right-click). */
export type Ask = "pet" | "zoomies" | "nap";
const MIN_NAP_MS = 120_000;
const HOUR_MS = 3_600_000;

const SLEEP_INTENTS: readonly IntentName[] = ["nap", "nap_warm"];
/** Harmless moves that open a bout (bouts.ts openingMove). The governor still checks them. */
const BASICS: readonly Option[] = [
  { intent: "stretch", targets: ["here"], score: 0.1 },
  { intent: "groom", targets: ["here"], score: 0.1 },
];

/**
 * The slow brain loop. Decides what the cat wants every 20 to 60 seconds or when something happens.
 * It never moves the cat. The executor does that.
 */
const DECISION_GAP_MS: Record<ChaosLevel, number> = { chill: 20_000, normal: 8_000, gremlin: 2_500 };

/**
 * After an action ends the animal does nothing for a while before the next one. How long depends on
 * the bout it is in (bouts.ts: long pauses in a rest bout, short ones at play), the chaos level, the
 * species gap and laziness (a cat pauses longer than a dog), and a lively action adds a little.
 */
const LIVELY: ReadonlySet<IntentName> = new Set<IntentName>(["chase_cursor", "fetch", "invite_play", "zoomies", "follow", "tumble", "bounce", "spook", "chase_tail", "react", "stalk", "keyboard_walk", "knock_toy", "swat", "roll", "dig", "howl", "play_cursor"]);

/** What it may do about its toy when you throw it: the toy jobs, a bat, or a wash to show it doesn't care. */
const TOY_REACTIONS: ReadonlySet<IntentName> = new Set<IntentName>(["fetch", "carry_toy", "stash_toy", "nose_toy", "knock_toy", "groom"]);
/** What may follow when it has been: a race about (mostly after a poop), a wash, a sniff. */
const POTTY_AFTER: ReadonlySet<IntentName> = new Set<IntentName>(["zoomies", "groom", "sniff", "scratch", "look_around", "wander"]);
/**
 * How many waking hours between two pees and two poops at each chaos level (ADR-048): rare on
 * purpose, and never at chill. Asleep it builds up slower. Each animal kind changes it (species.ts).
 */
const POTTY_HOURS: Record<ChaosLevel, { pee: number; poop: number } | null> = {
  chill: null,
  normal: { pee: 5, poop: 12 },
  gremlin: { pee: 3, poop: 7 },
};
/** When it has to go and the governor said no (a meeting, the budget), it asks again after this. */
const POTTY_RETRY_MS = 45_000;
/** What it can be doing and still drop it to chase a cursor that shoots past. */
/** Away at least this long (minutes) and it comes to say hello when you're back. */
const GREET_AFTER_MIN = 10;
/** What it drops to come and say hello. */
const GREET_FROM: ReadonlySet<IntentName> = new Set<IntentName>(["watch", "groom", "stare", "look_around", "yawn", "wander", "sniff", "perch", "peek", "tour", "sit_on", "block_dock", "follow"]);
const CHASE_FROM: ReadonlySet<IntentName> = new Set<IntentName>(["watch", "groom", "stare", "look_around", "yawn", "wander", "sniff", "perch", "peek", "tour"]);
/** How often per second a cursor racing past sets it off (while it moves fast nearby), and how long before it may again. */
const CHASE_IMPULSE: Record<ChaosLevel, { perSec: number; coolMs: number }> = {
  chill: { perSec: 0, coolMs: Infinity },
  normal: { perSec: 0.05, coolMs: 240_000 },
  gremlin: { perSec: 0.35, coolMs: 40_000 },
};

export class Mind {
  needs: Needs = initialNeeds();
  sleeping = false;
  current: Intent | null = null;
  recent: IntentName[] = [];
  stats = { decisions: 0, llm: 0, rules: 0, fallbacks: 0, safe: 0 };

  private lastDecisionMs = -Infinity;
  /** No new decision before this time: the animal is resting after its last action. */
  private restUntilMs = -Infinity;
  private lastRespect: RespectState["kind"] = "none";
  /** Why it was away last time (panic, shoo, full screen), so coming back from a shoo can be in a huff. */
  private awayReason: string | null = null;
  /** What the respect mode had it do (leave, nap in a corner), to tell it from something you started since. */
  private respectIntent: Intent | null = null;
  private justWoke = false;
  private napStartMs = 0;
  private llmCalls: number[] = [];
  private llmFailures = 0;
  private llmCooldownUntil = 0;
  /** Model problems since the last tick, passed on as events. */
  private llmProblems: string[] = [];
  private lastShooMs = -Infinity;
  private lastPetMs = -Infinity;
  /** Times of the recent clicks on the animal, and what it did last, so a poke can escalate and vary. */
  private pokes: number[] = [];
  private lastReaction: string | undefined;
  private annoyedUntilMs = -Infinity;
  private seenWindows = new Set<string>();
  private groomAfterLanding = false;
  private revisit: { windowId: string; notBeforeMs: number } | null = null;
  /** The stretch of life the animal is in now (bouts.ts), and the steps it planned for it. */
  bout: { kind: BoutKind; startedMs: number; untilMs: number; steps: Intent[]; source: "llm" | "rules" } | null = null;
  private lastBout: BoutKind | null = null;
  /** What happened lately, for the model: "the human poked me", "a new window opened". */
  private happened: { atMs: number; text: string }[] = [];
  /** Since when the human has been at it without a break, and since when they were away. */
  private busySinceMs: number | null = null;
  /** Written lines said lately, so they don't repeat. Their own random source keeps the rest of the mind's choices as they were. */
  private said: string[] = [];
  private lineRng = seeded(1013);
  /** Its own dice for making up tricks, so a seeded run does the same with or without them. */
  private trickRng = seeded(2027);
  private awaySinceMs: number | null = null;
  private lastTickMs: number | null = null;
  /**
   * Bumped by anything that changes the animal's mind from outside (a click, a treat, the toy, a new
   * desktop). A plan the model was still working on when it changed is dropped.
   */
  private epoch = 0;
  /** You threw the toy: the next decision is about it. */
  /** How badly it has to pee and to poop (ADR-048). From 1 it has to go, and that comes first. */
  potty = { pee: 0, poop: 0 };
  private pottyRng = seeded(4409);
  private pottyCall = false;
  private pottyNoted = false;
  private pottyRetryMs = -Infinity;
  private pottyStarted = false;
  private lastChaseMs = -Infinity;
  /** Its own dice for the quick impulses, so a seeded run of the rest is unchanged. */
  private impulseRng = seeded(3301);
  private brain: Brain;
  private personality: Personality;

  /** How long the cat waits between decisions. A calmer cat thinks less often. */
  private get gapMs(): number {
    const fixed = this.d.minDecisionGapMs;
    return fixed === undefined ? DECISION_GAP_MS[this.settings.chaos] * instinctFor(this.personality.species).gap : fixed;
  }

  constructor(private d: MindDeps) {
    this.brain = d.brain;
    this.personality = d.personality;
  }

  setPersonality(p: Personality): void {
    this.personality = p;
  }

  get traits(): Personality {
    return this.personality;
  }

  /** Swap the main brain at runtime (settings change). Pass the fallback to switch the LLM off. */
  setBrain(brain: Brain): void {
    this.brain = brain;
    this.llmFailures = 0;
    this.llmCooldownUntil = 0;
  }

  /** The last choice the cat made for itself, so a pet or a shoo soon after can teach it something. */
  private lastChosen: { intent: string; atMs: number } | null = null;

  private learn(good: boolean, now: number): void {
    const c = this.lastChosen;
    const h = this.d.memory.habits;
    if (!c || !h || now - c.atMs > 120_000) return;
    if (good) h.reward(c.intent, now);
    else h.punish(c.intent, now);
    this.lastChosen = null;
  }

  private get settings(): Settings {
    return this.d.governor.getSettings();
  }

  /** Call when the executor reports the intent is finished. Starts the rest before the next decision. */
  notifyDone(): void {
    if (this.sleeping) return;
    const was = this.current?.intent;
    this.current = null;
    this.restUntilMs = (this.lastTickMs ?? 0) + this.restMs(was);
  }

  private restMs(was: IntentName | undefined): number {
    const fixed = this.d.minDecisionGapMs;
    if (fixed !== undefined) return fixed;
    const [lo, hi] = PAUSE[this.bout?.kind ?? "rest"];
    const lazy = 0.7 + 0.6 * this.personality.laziness;
    const lively = was !== undefined && LIVELY.has(was) ? 1.25 : 1;
    return this.d.rng.range(lo, hi) * 1000 * PAUSE_BY_CHAOS[this.settings.chaos] * instinctFor(this.personality.species).gap * lazy * lively;
  }

  /** Remembers something that happened, for the model to react to. */
  /** Something happened that is worth remembering for a while (the model reads these). */
  note(now: number, text: string): void {
    this.happened.push({ atMs: now, text });
    this.happened = this.happened.filter((h) => now - h.atMs < 45 * 60_000).slice(-12);
  }

  /** What happened lately, newest first, with how long ago. */
  happenedLines(now: number): string[] {
    return [...this.happened].reverse().map((h) => {
      const m = Math.round((now - h.atMs) / 60_000);
      return `${m < 1 ? "just now" : `${m} min ago`}: ${h.text}`;
    });
  }

  /** Keeps track of the human: busy for how long, back from being away, a new window. */
  private watchHuman(world: WorldSnapshot, newApps: string[]): number {
    let backAfterMin = 0;
    const now = world.nowMs;
    const busy = world.activity === "typing" || world.activity === "typing_fast" || world.activity === "reading";
    if (world.activity === "away") {
      this.awaySinceMs ??= now;
      this.busySinceMs = null;
    } else {
      if (this.awaySinceMs !== null) {
        const m = Math.round((now - this.awaySinceMs) / 60_000);
        if (m >= 5) this.note(now, `the human came back after ${m} min away`);
        backAfterMin = m;
        this.awaySinceMs = null;
      }
      if (busy) this.busySinceMs ??= now;
      else if (world.idleSec > 120) this.busySinceMs = null;
    }
    for (const app of newApps.slice(0, 2)) this.note(now, `a new ${app || "window"} window opened`);
    return backAfterMin;
  }

  /**
   * You're back after a while away: it comes over to say hello, a meow (a dog: a happy wiggle) and a
   * headbutt. A dog nearly always does; an aloof cat only now and then. Not while it sleeps, not in
   * a meeting, and not in the middle of something it cares about.
   */
  private greet(world: WorldSnapshot, events: MindEvent[]): void {
    const now = world.nowMs;
    if (this.sleeping || respectState(world).kind !== "none") return;
    if (this.current && !GREET_FROM.has(this.current.intent)) return;
    const ins = instinctFor(this.personality.species);
    const keen = ins.kind === "dog" ? 0.95 : 0.9 - 0.6 * this.personality.aloofness;
    if (this.impulseRng.next() > keen) return;
    this.epoch++;
    this.restUntilMs = -Infinity;
    this.lastDecisionMs = now;
    const thought = this.writtenLine(world, "social");
    const opener: Intent["opener"] = { anim: ins.kind === "dog" ? "happy" : "meow", sec: 1.4 };
    this.setCurrent({ intent: "follow", target: "cursor", approach: ins.kind === "dog" ? "run" : "walk", stay_sec: 14, mood: "content", opener, ...(thought ? { thought } : {}) }, now, "reflex", events);
  }

  async tick(world: WorldSnapshot, dtSec: number, moving: boolean, held = false): Promise<MindEvent[]> {
    const events: MindEvent[] = [];
    const now = world.nowMs;
    this.lastTickMs = now;
    let newWindows = 0;
    const newApps: string[] = [];
    for (const w of world.windows) {
      if (!this.seenWindows.has(w.id)) {
        this.seenWindows.add(w.id);
        if (w.isNew) {
          newWindows += 1;
          newApps.push(w.app);
        }
      }
    }
    if (this.watchHuman(world, newApps) >= GREET_AFTER_MIN) this.greet(world, events);
    this.needs = stepNeeds(this.needs, dtSec, {
      sleeping: this.sleeping,
      moving,
      newWindows,
      personality: this.personality,
      sinceShooSec: (now - this.lastShooMs) / 1000,
      sincePetSec: (now - this.lastPetMs) / 1000,
      annoyedLeftSec: (this.annoyedUntilMs - now) / 1000,
      drainMul: instinctFor(this.personality.species).drain * ENERGY_BY_CHAOS[this.settings.chaos].drain,
      restoreMul: instinctFor(this.personality.species).restore * ENERGY_BY_CHAOS[this.settings.chaos].restore,
    });

    this.stepPotty(world, dtSec);

    const state = respectState(world);
    if (state.kind !== this.lastRespect) {
      const was = this.lastRespect;
      this.lastRespect = state.kind;
      const wasShooed = was === "away" && this.awayReason === "shoo";
      this.awayReason = state.kind === "away" ? state.reason : null;
      events.push({ type: "respect", state: state.kind });
      this.d.log?.("respect mode", { from: was, to: state.kind });
      const plan = respectPlan(state);
      if (plan) {
        this.setCurrent(plan, now, "respect", events);
        this.respectIntent = plan;
        this.sleeping = plan.intent === "nap";
        return events;
      }
      // Something you started as the mode ended (a treat ends a shoo) goes on, and wins over a grudge.
      const yours = this.current !== null && this.current !== this.respectIntent;
      this.respectIntent = null;
      if ((was === "meeting" || was === "away") && yours) {
        this.bout = null;
        this.restUntilMs = -Infinity;
        return events;
      }
      if (was === "meeting" || was === "away") {
        this.current = null;
        this.sleeping = false;
        this.bout = null;
        this.lastDecisionMs = now - this.gapMs;
        this.restUntilMs = -Infinity;
        // Back from being shooed: it comes back in a huff and lets you know.
        if (wasShooed && state.kind === "none") {
          this.note(now, "i'm back on the screen after a shoo");
          const thought = this.writtenLine(world, "rest");
          const script = [doing("sulk", 4), doing("look", 1, "cursor"), doing("sulk", 5)];
          this.setCurrent({ intent: "sulk", target: "here", approach: "walk", stay_sec: Math.ceil(scriptSeconds(script)), mood: "sulky", script, ...(thought ? { thought } : {}) }, now, "reflex", events);
          return events;
        }
      }
    }
    if (state.kind === "meeting" || state.kind === "away") {
      if (!this.current) {
        const plan = respectPlan(state);
        if (plan) {
          this.setCurrent(plan, now, "respect", events);
          this.respectIntent = plan;
        }
      }
      return events;
    }

    // A cat that is being held by the scruff doesn't plan anything.
    if (held) return events;

    if (this.sleeping) {
      const slept = now - this.napStartMs;
      if (this.needs.energy >= WAKE_ENERGY && slept >= MIN_NAP_MS) {
        this.sleeping = false;
        this.justWoke = true;
        this.current = null;
        // Awake again: whatever comes next is a new bout (it starts with a stretch).
        if (this.bout?.kind === "rest") this.bout.untilMs = now;
        this.lastDecisionMs = now - this.gapMs;
        this.restUntilMs = -Infinity;
        events.push({ type: "wake" });
        // Waking up from a nap, it sometimes has a new idea.
        this.dream(now);
      } else if (!this.current) {
        // Nap ran out of time but the cat is still tired: keep sleeping, no new decision.
        this.current = { intent: "nap", target: "here", approach: "walk", stay_sec: 1800, mood: "sleepy" };
        events.push({ type: "intent", intent: this.current, source: "rules" });
      }
      return events;
    }

    if (this.impulse(world, dtSec, events)) return events;
    if (this.current) return events;
    // It has to go: that doesn't wait for the usual pause between actions.
    if (this.pottyDue(now)) this.pottyCall = true;
    if (!this.pottyCall && (now - this.lastDecisionMs < this.gapMs || now < this.restUntilMs)) return events;
    await this.decide(world, events);
    for (const message of this.llmProblems.splice(0)) events.unshift({ type: "llm_problem", message });
    return events;
  }

  private setCurrent(intent: Intent, _now: number, source: "llm" | "rules" | "respect" | "reflex" | "safe", events: MindEvent[]): void {
    this.current = intent;
    if (source === "llm" || source === "rules") {
      // A trick is learned about on its own, not as "trick".
      const key = intent.trick ? `trick:${intent.trick}` : intent.intent;
      this.lastChosen = { intent: key, atMs: _now };
      this.d.memory.habits?.used(key, _now);
    }
    if (intent.intent !== "react") {
      this.recent.push(intent.intent);
      if (this.recent.length > 10) this.recent.shift();
    }
    events.push({ type: "intent", intent, source });
    this.d.log?.("intent", { intent: intent.intent, target: intent.target, source, mood: intent.mood });
  }

  /**
   * Quick impulses that don't wait for a decision: a cursor racing past sets a playful animal off after
   * it (a gremlin does it a lot, a normal one now and then). True when one started.
   */
  private impulse(world: WorldSnapshot, dtSec: number, events: MindEvent[]): boolean {
    const now = world.nowMs;
    const c = CHASE_IMPULSE[this.settings.chaos];
    if (c.perSec <= 0 || now - this.lastChaseMs < c.coolMs) return false;
    if (world.cursorSpeed < 350 || this.needs.energy < 0.45 || this.needs.mood === "sulky") return false;
    if (this.current && !CHASE_FROM.has(this.current.intent)) return false;
    const pos = this.d.catPos();
    if (Math.hypot(world.cursor.x - pos.x, world.cursor.y - pos.y) > 800) return false;
    const like = instinctFor(this.personality.species).weights.chase_cursor ?? 1;
    if (this.impulseRng.next() > 1 - Math.exp(-c.perSec * like * (0.5 + this.personality.chaos) * Math.min(1, dtSec))) return false;
    // The governor still has the last word (a respect mode, the annoyance budget).
    const options = this.d.governor.filter([{ intent: "chase_cursor", targets: ["cursor"], score: 1 }], world, this.needs);
    if (options.length === 0) return false;
    const intent = this.d.governor.validate(
      { intent: "chase_cursor", target: "cursor", approach: "run", stay_sec: Math.round(this.impulseRng.range(10, 22)), mood: "playful" },
      options,
      world,
      this.needs,
    );
    if (!intent) return false;
    this.lastChaseMs = now;
    this.epoch++;
    this.note(now, "the cursor shot past me and i chased it");
    this.d.governor.commit(intent, world);
    this.setCurrent(intent, now, "reflex", events);
    return true;
  }

  /**
   * You threw its toy (from the menu, or out of your hand). It reacts at once, by the rules: eyes on
   * it while it flies, then what it does about it (fetch, carry it off, bury it, sniff it, bat it, or
   * pretend not to care). Waiting for the model here took 9 to 27 s on Abozar's Mac (7 Nov 2026), so
   * the model only plans what comes after, when this move is done. A sleeping dog wakes up for it;
   * most others sleep on.
   */
  onToyThrown(world: WorldSnapshot, toy: { kind: string; x: number; y: number }): MindEvent[] {
    const now = world.nowMs;
    const events: MindEvent[] = [];
    this.note(now, `the human threw my ${toyName(toy.kind)}`);
    if (respectState(world).kind !== "none") return events;
    const pos = this.d.catPos();
    const d = Math.hypot(toy.x - pos.x, toy.y - pos.y);
    if (this.sleeping) {
      const ins = instinctFor(this.personality.species);
      const wakes = (ins.kind === "dog" ? 0.75 : ins.kind === "squirrel" || ins.kind === "fox" ? 0.35 : 0.2) * (d < 400 ? 1 : 0.5);
      if (this.impulseRng.next() > wakes) return events;
      this.wake(now);
    }
    const intent = this.toyReaction(world);
    if (!intent) return events;
    // Whatever the brain was busy planning is out of date now.
    this.epoch++;
    this.restUntilMs = -Infinity;
    this.lastDecisionMs = now;
    const ins = instinctFor(this.personality.species);
    this.bout = { kind: "play", startedMs: now, untilMs: now + boutLengthMs("play", this.settings.chaos, this.d.rng, ins.gap), steps: [], source: "rules" };
    this.lastBout = "play";
    const thought = intent.thought ?? this.writtenLine(world, "play");
    this.d.governor.commit(intent, world);
    this.setCurrent(thought ? { ...intent, thought } : intent, now, "rules", events);
    this.d.log?.("bout", { kind: "play", source: "rules", steps: [intent.intent], about: "toy" });
    return events;
  }

  /** The toy you threw came to rest: where, for the brain's next plan. */
  onToyLanded(world: WorldSnapshot, toy: { kind: string; x: number; y: number }): void {
    const pos = this.d.catPos();
    this.note(world.nowMs, `my ${toyName(toy.kind)} landed ${spotWords(toy.x - pos.x, pos.y - toy.y)}`);
  }

  /** What it does about the toy you just threw, picked by the rules (weighted by how it feels about it). */
  private toyReaction(world: WorldSnapshot): Intent | null {
    const rulesCtx = this.ctx(world);
    const gov = this.d.governor;
    const options = gov.filter(candidates(rulesCtx), world, this.needs).filter((o) => TOY_REACTIONS.has(o.intent));
    // The toy moves first: a wash only when nothing about the toy is allowed or wanted.
    const keen = options.filter((o) => o.intent !== "groom");
    const pick = weighted(keen.length > 0 ? keen : options, this.impulseRng);
    if (!pick) return null;
    return gov.validate(intentFromOption(pick, rulesCtx, this.settings.chaos, this.settings.thoughtBubbles), options, world, this.needs);
  }

  private ctx(world: WorldSnapshot): RulesContext {
    return {
      habits: this.d.memory.habits,
      tricks: this.d.memory.tricks,
      chaos: this.settings.chaos,
      world,
      needs: this.needs,
      personality: this.personality,
      smartTargeting: this.settings.smartTargeting,
      catPos: this.d.catPos(),
      justWoke: this.justWoke,
      recent: this.recent,
      rng: this.d.rng,
      propWindows: this.d.propWindows?.() ?? [],
      toy: this.d.toy?.() ?? null,
      potty: { ...this.potty },
    };
  }

  /**
   * The need to go builds up slowly while it is awake (slower asleep), from a random start, so it
   * never runs like a clock. Once it has to, it says so, and a sleeping one gets up for it.
   */
  private stepPotty(world: WorldSnapshot, dtSec: number): void {
    if (!this.pottyStarted) {
      // A random start (from the clock, so a test repeats exactly), never on a schedule.
      this.pottyStarted = true;
      this.pottyRng = seeded(Math.floor(world.nowMs / 1000) % 2_147_483_647);
      this.potty = { pee: this.pottyRng.range(0, 0.6), poop: this.pottyRng.range(0, 0.5) };
    }
    const hours = POTTY_HOURS[this.settings.chaos];
    if (!hours) return;
    const [kp, kq] = instinctFor(this.personality.species).potty ?? [1, 1];
    const slow = this.sleeping ? 0.4 : 1;
    const dt = Math.max(0, Math.min(dtSec, 600));
    this.potty.pee = Math.min(3, this.potty.pee + (dt * kp * slow) / (hours.pee * 3600));
    this.potty.poop = Math.min(3, this.potty.poop + (dt * kq * slow) / (hours.poop * 3600));
    const which = this.potty.poop >= 1 ? "poop" : this.potty.pee >= 1 ? "pee" : null;
    if (!which) {
      this.pottyNoted = false;
      return;
    }
    const now = world.nowMs;
    if (!this.pottyNoted) {
      this.pottyNoted = true;
      this.note(now, which === "pee" ? "i really need to pee" : "i need to go. the other one.");
    }
    if (this.sleeping && Math.max(this.potty.pee, this.potty.poop) > 1.25 && respectState(world).kind === "none") this.wake(now);
  }

  private pottyDue(now: number): boolean {
    if (!POTTY_HOURS[this.settings.chaos] || this.sleeping) return false;
    return (this.potty.pee >= 1 || this.potty.poop >= 1) && now >= this.pottyRetryMs;
  }

  /** It went: the spot is there. The need starts again from a little below nothing. */
  relieved(kind: "pee" | "poop", now: number): void {
    if (kind === "pee") this.potty.pee = -this.pottyRng.range(0, 0.35);
    else {
      this.potty.poop = -this.pottyRng.range(0, 0.3);
      // Mostly both at once.
      this.potty.pee = Math.min(this.potty.pee, this.pottyRng.range(-0.2, 0.3));
    }
    this.pottyNoted = false;
    this.note(now, kind === "pee" ? "i peed on the screen. it had to happen." : "i pooped on the screen. you're welcome.");
    this.d.log?.("potty", { kind });
  }

  /** Test and debug hook: it has to go right now. */
  forcePotty(kind: "pee" | "poop", level = 1.05): void {
    this.pottyStarted = true;
    this.potty[kind] = level;
    this.pottyRetryMs = -Infinity;
  }

  /** urgent: something just happened that deserves a thought now (the toy), so the 15 s gap doesn't apply. */
  private canCallLlm(now: number, urgent = false): boolean {
    if (this.brain === this.d.fallback) return false;
    if (this.settings.brain !== "llm") return false;
    if (now < this.llmCooldownUntil) return false;
    this.llmCalls = this.llmCalls.filter((t) => now - t < HOUR_MS);
    if (this.llmCalls.length >= 60) return false;
    const last = this.llmCalls[this.llmCalls.length - 1];
    if (!urgent && last !== undefined && now - last < 15_000) return false;
    return true;
  }

  private async decide(world: WorldSnapshot, events: MindEvent[]): Promise<void> {
    const now = world.nowMs;
    this.lastDecisionMs = now;
    const epoch = this.epoch;
    const pottyCall = this.pottyCall;
    this.pottyCall = false;
    const rulesCtx = this.ctx(world);
    const gov = this.d.governor;
    let options: Option[] = gov.filter(candidates(rulesCtx), world, this.needs);

    // A shooed cat sometimes comes back to the same window later.
    let revisit: Intent | null = null;
    if (this.revisit && now >= this.revisit.notBeforeMs) {
      const hit = options.find((o) => o.intent === "sit_on" && o.targets.includes(this.revisit!.windowId));
      if (hit) {
        options = [{ ...hit, targets: [this.revisit.windowId], score: hit.score * 10 }, ...options.filter((o) => o !== hit)];
        revisit = gov.validate(intentFromOption(options[0] as Option, rulesCtx, this.settings.chaos, false), options, world, this.needs);
        this.revisit = null;
      } else if (now - this.revisit.notBeforeMs > 20 * 60_000) {
        this.revisit = null;
      }
    }

    const brainCtx: BrainContext = {
      rules: rulesCtx,
      options,
      settings: this.settings,
      personality: this.personality,
      memory: this.d.memory.recentLines(5, now),
      catWhere: this.d.catWhere(),
      catDoing: this.d.catDoing(),
    };

    let toyPlanned = false;
    // It has to go: a short bout that starts with that. Not allowed right now (a meeting, the budget,
    // chill): it holds on and asks again in a bit.
    const pottyOptions = pottyCall ? options.filter((o) => o.intent === "pee" || o.intent === "poop") : [];
    if (pottyCall) this.pottyRetryMs = now + POTTY_RETRY_MS;
    if (pottyOptions.length > 0) toyPlanned = await this.startPottyBout(world, pottyOptions, options, brainCtx);
    // A new bout when there is none yet, when this one has run its course, or when the animal is worn out.
    const worn = this.needs.energy < 0.25 && this.bout !== null && this.bout.kind !== "rest";
    if (!toyPlanned && options.length > 0 && (!this.bout || now >= this.bout.untilMs || worn)) await this.startBout(world, options, brainCtx);
    // Something changed its mind while the model was thinking (a click, a treat, the toy): that plan is stale.
    if (this.epoch !== epoch) return;

    // The next planned step, checked again now: the world may have changed since it was planned.
    // The opening moves (a stretch, a wash) are always on the menu.
    const menu = [...options, ...BASICS.filter((b) => !options.some((o) => o.intent === b.intent))];
    let intent: Intent | null = revisit;
    let source: "llm" | "rules" = revisit ? "rules" : (this.bout?.source ?? "rules");
    while (!intent && this.bout && this.bout.steps.length > 0) intent = this.withTrick(gov.validate(this.bout.steps.shift() as Intent, menu, world, this.needs), world);
    // The plan ran out but the bout goes on: a few more steps of the same bout.
    if (!intent && this.bout && options.length > 0) {
      const more = await this.planBout(world, options, brainCtx, this.bout.kind);
      if (more) {
        source = more.source;
        this.bout.steps = more.plan.steps;
        if (more.plan.thought && this.bout.steps[0]) this.bout.steps[0] = { ...this.bout.steps[0], thought: more.plan.thought };
        while (!intent && this.bout.steps.length > 0) intent = this.withTrick(gov.validate(this.bout.steps.shift() as Intent, menu, world, this.needs), world);
      } else {
        // Nothing left that fits this bout: end it, the next decision starts another.
        this.bout.untilMs = now;
      }
    }
    if (!intent) {
      // Nothing was allowed. A cat can always wash itself, or nap if it is tired.
      const tired = this.needs.energy < 0.4;
      const safeName: IntentName = tired ? "nap" : "groom";
      const safe = intentFromOption({ intent: safeName, targets: ["here"], score: 1 }, rulesCtx, this.settings.chaos, false);
      this.stats.safe += 1;
      this.stats.decisions += 1;
      this.begin(safe, world, "safe", events, false);
      return;
    }
    this.stats.decisions += 1;
    this.begin(intent, world, source, events, true);
  }

  /** Asks the brain (the model when it may, else the rules) for the next bout, or more of `fixed`. */
  private async planBout(world: WorldSnapshot, options: Option[], brainCtx: BrainContext, fixed?: BoutKind): Promise<{ plan: Plan; source: "llm" | "rules" } | null> {
    const now = world.nowMs;
    const ins = instinctFor(this.personality.species);
    const w = boutWeights({ last: this.lastBout, chaos: this.settings.chaos, needs: this.needs, kind: ins.kind, world });
    // Never plan what it just did again: a small model asked for "more of this bout" will happily
    // say "hunt" four times in a row. With nothing else left, the bout ends.
    const last = this.recent[this.recent.length - 1];
    const fresh = options.filter((o) => o.intent !== last);
    const bouts = BOUT_KINDS.map((kind) => ({ kind, weight: w[kind], options: fresh.filter((o) => BOUT_INTENTS[kind].includes(o.intent) && (o.kind === undefined || o.kind === kind)) })).filter(
      (b) => (b.weight > 0 || b.kind === fixed) && b.options.length > 0,
    );
    if (bouts.length === 0 || (fixed && !bouts.some((b) => b.kind === fixed))) return null;
    // The body picks the bout by its weights (needs, chaos, what came before): that keeps the
    // natural rhythm. The model then plans inside it: which steps, where, and what it thinks.
    // A 1b model asked to pick the bout too mostly picked "explore" and never mischief (ADR-031).
    const picked = fixed ?? pickBout(Object.fromEntries(BOUT_KINDS.map((k) => [k, bouts.find((b) => b.kind === k)?.weight ?? 0])) as Record<BoutKind, number>, this.d.rng);
    const ctx: PlanContext = {
      ...brainCtx,
      bouts: bouts.filter((b) => b.kind === (bouts.some((x) => x.kind === picked) ? picked : bouts[0]?.kind)),
      fixedBout: fixed,
      happened: this.happenedLines(now),
      lastBout: this.lastBout,
      busyForMin: this.busySinceMs === null ? 0 : (now - this.busySinceMs) / 60_000,
      things: this.d.things?.() ?? [],
    };
    return this.askPlan(ctx, world, false);
  }

  /** Asks the model for a plan when it may (urgent: right now, whatever the gap), else the rules. */
  private async askPlan(ctx: PlanContext, world: WorldSnapshot, urgent: boolean): Promise<{ plan: Plan; source: "llm" | "rules" } | null> {
    const now = world.nowMs;
    if (!world.batteryLow && this.canCallLlm(now, urgent) && this.brain.plan) {
      this.llmCalls.push(now);
      try {
        const plan = await this.brain.plan(ctx);
        if (plan) {
          this.llmFailures = 0;
          this.stats.llm += 1;
          return { plan, source: "llm" };
        }
        this.stats.fallbacks += 1;
      } catch (err) {
        this.llmFailures += 1;
        this.stats.fallbacks += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.d.log?.("llm problem", { message, failures: this.llmFailures });
        this.llmProblems.push(message);
        if (this.llmFailures >= 3) {
          this.llmCooldownUntil = now + 2 * 60_000;
          this.llmFailures = 0;
        }
      }
    }
    const plan = await this.d.fallback.plan?.(ctx);
    if (!plan) return null;
    this.stats.rules += 1;
    return { plan, source: "rules" };
  }

  /**
   * A trick step gets its beats from the library. The first time it does one, the bubble names it.
   * A trick that is gone from the library (pushed out by a better one) is skipped.
   */
  private withTrick(intent: Intent | null, world: WorldSnapshot): Intent | null {
    if (!intent || intent.intent !== "trick") return intent;
    const book = this.d.memory.tricks;
    const t = book?.get(intent.trick);
    if (!book || !t) return null;
    const { beats, seconds } = book.script(t);
    const first = book.shown(t.id, world.nowMs);
    const out: Intent = { ...intent, script: beats, stay_sec: Math.ceil(seconds), mood: t.kind === "mischief" ? "smug" : t.kind === "rest" ? "content" : "playful" };
    if (first && this.settings.thoughtBubbles) out.thought = `new trick: ${t.name}`;
    if (first) this.note(world.nowMs, `showed you my new trick, ${t.name}`);
    return out;
  }

  /**
   * Makes up a new trick, at most one every few hours (tricks.ts breeds it, checks it and files it).
   * Returns its name, or null. `force` skips the wait (the playground's button).
   */
  dream(now: number, force = false): string | null {
    const book = this.d.memory.tricks;
    if (!book) return null;
    const got = book.breed(this.trickRng, now, this.d.memory.habits, force);
    if (!got) return null;
    this.note(now, `dreamed up a new trick: ${got.added.name}`);
    this.d.memory.log({ atMs: now, kind: "trick" });
    this.d.log?.("new trick", { name: got.added.name, kind: got.added.kind, beats: got.added.beats.length, replaced: got.evicted?.name, tries: got.tries });
    return got.added.name;
  }

  /**
   * It has to go: the model (or the rules) plans the bout, with the pee or the poop first wherever
   * the plan put it (else where the rules say), and what comes after: zoomies, a wash, a sniff.
   */
  private async startPottyBout(world: WorldSnapshot, potty: Option[], options: Option[], brainCtx: BrainContext): Promise<boolean> {
    const now = world.nowMs;
    const after = options.filter((o) => POTTY_AFTER.has(o.intent));
    const ctx: PlanContext = {
      ...brainCtx,
      bouts: [{ kind: "explore", weight: 1, options: [...potty, ...after] }],
      fixedBout: "explore",
      happened: this.happenedLines(now),
      lastBout: this.lastBout,
      busyForMin: this.busySinceMs === null ? 0 : (now - this.busySinceMs) / 60_000,
      things: this.d.things?.() ?? [],
    };
    const epoch = this.epoch;
    const got = await this.askPlan(ctx, world, true);
    // Something newer took over while the model thought (the toy, a treat): leave it be.
    if (this.epoch !== epoch) return true;
    const first = [...potty].sort((a, b) => b.score - a.score)[0] as Option;
    const planned = got?.plan.steps.find((x) => x.intent === first.intent);
    const go = planned ?? intentFromOption(first, this.ctx(world), this.settings.chaos, false);
    const steps = [go, ...(got?.plan.steps ?? []).filter((x) => x.intent !== "pee" && x.intent !== "poop")];
    const thought = got?.plan.thought ?? this.writtenLine(world, "explore");
    if (thought) steps[0] = { ...(steps[0] as Intent), thought };
    const ins = instinctFor(this.personality.species);
    this.bout = { kind: "explore", startedMs: now, untilMs: now + boutLengthMs("explore", this.settings.chaos, this.d.rng, ins.gap), steps, source: got?.source ?? "rules" };
    this.lastBout = "explore";
    this.d.log?.("bout", { kind: "explore", source: got?.source ?? "rules", steps: steps.map((x) => x.intent), about: first.intent });
    return true;
  }

  /** Starts the next bout: asks for a plan and puts the opening move (a stretch, a wash) first. */
  private async startBout(world: WorldSnapshot, options: Option[], brainCtx: BrainContext): Promise<void> {
    const now = world.nowMs;
    const epoch = this.epoch;
    const got = await this.planBout(world, options, brainCtx);
    // Something newer took over while the model thought (the toy, a treat): leave it be.
    if (this.epoch !== epoch) return;
    if (!got) {
      this.bout = null;
      return;
    }
    const { plan, source } = got;
    const ins = instinctFor(this.personality.species);
    const lying = ["loaf", "sleep", "sprawl"].includes(this.d.catDoing());
    const steps = [...plan.steps];
    // The model's line when it fits the moment, else a written line about the same moment.
    const thought = plan.thought ?? this.writtenLine(world, plan.bout);
    if (thought && steps[0]) steps[0] = { ...steps[0], thought };
    const open = openingMove(this.lastBout, plan.bout, ins.kind, lying || this.justWoke, this.d.rng);
    if (open && !steps.some((x) => x.intent === open)) {
      steps.unshift(intentFromOption({ intent: open, targets: ["here"], score: 1 }, this.ctx(world), this.settings.chaos, false));
    }
    this.bout = { kind: plan.bout, startedMs: now, untilMs: now + boutLengthMs(plan.bout, this.settings.chaos, this.d.rng, ins.gap), steps, source };
    this.lastBout = plan.bout;
    this.d.log?.("bout", { kind: plan.bout, source, steps: steps.map((x) => x.intent) });
  }

  /** A written line about something real right now (lines.ts), or undefined. */
  private writtenLine(world: WorldSnapshot, bout: BoutKind): string | undefined {
    if (!this.settings.thoughtBubbles) return undefined;
    const now = world.nowMs;
    const topic = thoughtTopic({
      world,
      happened: this.happenedLines(now),
      things: this.d.things?.() ?? [],
      bout,
      busyForMin: this.busySinceMs === null ? 0 : (now - this.busySinceMs) / 60_000,
    });
    const line = lineFor(topic, this.lineRng, this.said);
    if (!line) return undefined;
    this.said = [...this.said, line].slice(-12);
    return line;
  }

  private begin(intent: Intent, world: WorldSnapshot, source: "llm" | "rules" | "safe", events: MindEvent[], commit: boolean): void {
    if (commit) this.d.governor.commit(intent, world);
    this.justWoke = false;
    this.sleeping = SLEEP_INTENTS.includes(intent.intent);
    if (this.sleeping) this.napStartMs = world.nowMs;
    if (intent.intent === "sit_on" || intent.intent === "sit_on_video" || intent.intent === "block_dock") {
      const app = world.windows.find((w) => w.id === intent.target)?.app ?? (intent.target === "dock" ? "Dock" : undefined);
      this.d.memory.log({ atMs: world.nowMs, kind: "sat_on", app });
    }
    if (intent.intent === "gift" || intent.intent === "hairball") this.d.memory.log({ atMs: world.nowMs, kind: intent.intent });
    // A go at it: if it gets interrupted before it went, it tries again in a few minutes, not at once.
    if (intent.intent === "pee" || intent.intent === "poop") this.pottyRetryMs = world.nowMs + 3 * 60_000;
    this.setCurrent(intent, world.nowMs, source, events);
  }

  private needsEvent(ev: NeedsEvent): void {
    this.needs = applyEvent(this.needs, ev);
  }

  /** Reacts to a reflex from the pointer. Reflexes skip the brain, but respect modes still win. */
  onReflex(kind: ReflexKind, world: WorldSnapshot, windowId?: string): MindEvent[] {
    const events: MindEvent[] = [];
    const now = world.nowMs;
    this.epoch++;
    const away = respectState(world).kind !== "none";
    const gov = this.d.governor;
    const quick = (name: IntentName, target: string, stay: number): void => {
      if (away) return;
      this.sleeping = false;
      this.setCurrent(
        { intent: name, target, approach: "walk", stay_sec: Math.max(behavior(name).minStay ?? 5, stay), mood: this.needs.mood },
        now,
        "reflex",
        events,
      );
    };
    const app = windowId ? world.windows.find((w) => w.id === windowId)?.app : focusedWindow(world)?.app;
    switch (kind) {
      case "pet":
        this.needsEvent("pet");
        this.note(now, "the human petted me");
        this.lastPetMs = now;
        this.learn(true, now);
        this.d.memory.log({ atMs: now, kind: "pet" });
        // Some animals take a pet well. Some take the chance to swat the hand.
        if (this.d.rng.next() < instinctFor(this.personality.species).bite) quick("swat", "cursor", 4);
        break;
      case "poke": {
        const ins = instinctFor(this.personality.species);
        this.pokes = this.pokes.filter((t) => now - t < 15_000);
        this.pokes.push(now);
        // The more pokes in a row, the further up the ladder: curious, playful or put out, then fed up.
        let level = Math.floor((this.pokes.length - 1) / ins.patience);
        if (this.needs.mood === "sulky" || this.needs.mood === "grumpy") level += 1;
        else if (this.needs.trust > 70 && ins.kind !== "dog") level -= 1;
        const reaction = pokeReaction({
          kind: ins.kind,
          animal: ins.animal,
          level,
          trust: this.needs.trust,
          energy: this.needs.energy,
          pokes: this.pokes.length,
          asleep: this.sleeping,
          last: this.lastReaction,
          rng: this.d.rng,
        });
        this.lastReaction = reaction.name;
        this.note(now, `the human poked me${this.pokes.length > 1 ? ` (${this.pokes.length} times in a row)` : ""}, my reaction: ${reaction.name}`);
        if (away) break;
        if (reaction.effect === "annoy") {
          this.needsEvent("annoy");
          this.annoyedUntilMs = Math.max(this.annoyedUntilMs, now + (reaction.sulkSec ?? 30) * 1000);
        } else if (reaction.effect === "play") this.needsEvent("play");
        else if (reaction.effect === "pet") {
          this.needsEvent("pet");
          this.lastPetMs = now;
        }
        this.d.memory.log({ atMs: now, kind: "poke" });
        this.sleeping = false;
        this.lastDecisionMs = now;
        this.setCurrent(
          { intent: "react", target: "here", approach: "walk", stay_sec: Math.ceil(scriptSeconds(reaction.script)), mood: reaction.mood, thought: reaction.thought, script: reaction.script },
          now,
          "reflex",
          events,
        );
        break;
      }
      case "overpet":
        this.needsEvent("overpet");
        this.note(now, "the human petted me for far too long");
        quick("swat", "cursor", 5);
        break;
      case "pickup":
        this.note(now, "the human picked me up");
        this.sleeping = false;
        this.current = null;
        break;
      case "drop":
        this.needsEvent("gentle_drop");
        this.note(now, "the human put me down");
        this.groomAfterLanding = true;
        break;
      case "throw":
        this.needsEvent("throw");
        this.note(now, "the human threw me");
        this.groomAfterLanding = true;
        this.d.memory.log({ atMs: now, kind: "thrown" });
        break;
      case "shoo": {
        this.needsEvent("shoo");
        this.note(now, `the human shooed me${app ? ` off their ${app} window` : ""}`);
        this.lastShooMs = now;
        this.learn(false, now);
        gov.noteShoo(windowId ?? null, now);
        this.d.memory.log({ atMs: now, kind: "shoo", app });
        if (windowId && this.d.rng.next() < 0.5) this.revisit = { windowId, notBeforeMs: now + this.d.rng.range(180, 480) * 1000 };
        quick("sulk", "here", this.d.rng.range(180, 480));
        break;
      }
      case "laser":
        this.needsEvent("play");
        this.note(now, "something zipped past my nose");
        quick("swat", "cursor", 4);
        break;
      case "call": {
        const t = this.needs.trust / 100;
        const roll = this.d.rng.next();
        const ins = instinctFor(this.personality.species);
        const base = (0.15 + 0.7 * t) * (1 - 0.6 * this.personality.aloofness) * ins.comes;
        // A dog nearly always comes. A cat has to feel like it.
        const comeChance = Math.min(0.95, Math.max(ins.kind === "dog" ? 0.85 : 0, base));
        if (roll < comeChance) quick("follow", "cursor", ins.kind === "dog" ? 14 : 8);
        else if (roll < comeChance + (ins.kind === "cat" ? 0.1 : 0.25)) quick("watch", "cursor", 6);
        else quick("ignore", "here", 8);
        this.note(now, roll < comeChance ? "the human called me and i came" : "the human called me and i pretended not to hear");
        this.d.memory.log({ atMs: now, kind: "call" });
        break;
      }
    }
    return events;
  }

  /**
   * Its window moved under it: flung off (like being thrown, it minds that), or a rough ride it held
   * on through. Remembered for the model.
   */
  onJolt(now: number, flung: boolean): void {
    if (flung) {
      this.needsEvent("throw");
      this.note(now, "the human moved my window so hard i flew off it");
      this.d.memory.log({ atMs: now, kind: "flung" });
    } else this.note(now, "the human dragged my window around with me on it. i held on.");
  }

  /** Woken from outside, not by a full battery: the room went quiet, or a treat. Up, and a new bout. */
  wake(now: number): void {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.justWoke = true;
    this.current = null;
    if (this.bout?.kind === "rest") this.bout.untilMs = now;
    this.lastDecisionMs = now - this.gapMs;
    this.restUntilMs = -Infinity;
  }

  /** It went to the desktop you're on (Spaces), or you left it behind on another one. */
  onDesktop(now: number, came: boolean): void {
    this.epoch++;
    this.note(now, came ? "the human went to another desktop. i followed." : "the human went to another desktop without me");
    if (came && this.current && !this.sleeping) this.notifyDone();
  }

  /** The shell passes executor events here (landing after a throw makes the cat groom, "I meant to do that"). */
  onExecLanded(world: WorldSnapshot): MindEvent[] {
    if (!this.groomAfterLanding) return [];
    this.groomAfterLanding = false;
    if (respectState(world).kind !== "none") return [];
    const events: MindEvent[] = [];
    this.setCurrent({ intent: "groom", target: "here", approach: "walk", stay_sec: 8, mood: this.needs.mood }, world.nowMs, "reflex", events);
    return events;
  }

  /**
   * You hold out a treat (it hangs at the cursor until you click): it comes right under it and begs,
   * whatever it was doing, and keeps begging until you let go of it.
   */
  onTreatOffered(world: WorldSnapshot, kind: string): MindEvent[] {
    const now = world.nowMs;
    const events: MindEvent[] = [];
    this.note(now, `the human is holding out a ${treatName(kind)} for me`);
    if (respectState(world).kind !== "none") return events;
    this.epoch++;
    if (this.sleeping) this.wake(now);
    this.restUntilMs = -Infinity;
    this.lastDecisionMs = now;
    const thought = this.writtenLine(world, "social");
    this.setCurrent({ intent: "follow", target: "cursor", approach: "run", stay_sec: 50, mood: "content", treat: true, ...(thought ? { thought } : {}) }, now, "reflex", events);
    return events;
  }

  /** You let go of the treat (a click): it watches it fall and goes straight for it. */
  onTreatDropped(world: WorldSnapshot, kind: string): MindEvent[] {
    const now = world.nowMs;
    const events: MindEvent[] = [];
    this.note(now, `the human dropped the ${treatName(kind)}`);
    if (respectState(world).kind !== "none") return events;
    this.epoch++;
    if (this.sleeping) this.wake(now);
    this.restUntilMs = -Infinity;
    this.lastDecisionMs = now;
    const thought = this.writtenLine(world, "social");
    this.setCurrent({ intent: "eat", target: "treat", approach: "run", stay_sec: 30, mood: "content", ...(thought ? { thought } : {}) }, now, "reflex", events);
    return events;
  }

  /** The treat came to rest. If it isn't already on its way (it was busy, or held), it goes now. */
  onTreatLanded(world: WorldSnapshot, treat: { kind: string; x: number; y: number }): MindEvent[] {
    const pos = this.d.catPos();
    this.note(world.nowMs, `the ${treatName(treat.kind)} landed ${spotWords(treat.x - pos.x, pos.y - treat.y)}`);
    if (this.current?.intent === "eat") return [];
    return this.onTreatDropped(world, treat.kind);
  }

  /** It ate the last of the treat: a treat as far as its mood goes, and something for later. */
  ateTreat(world: WorldSnapshot, kind: string): void {
    const now = world.nowMs;
    this.needsEvent("treat");
    // What goes in comes out, eventually.
    this.potty.poop += 0.03;
    this.note(now, `i ate the ${treatName(kind)} the human gave me`);
    this.learn(true, now);
    this.d.memory.log({ atMs: now, kind: "treat" });
  }

  /**
   * You asked for something from the menu on the animal. It starts in this same frame, from the
   * rules, never waiting on the model. Your ask beats the chaos level (zoomies at chill, if you want
   * them), but never a respect mode: in a meeting, on a full-screen app, in panic or shooed it
   * doesn't come, and in quiet hours or on a low battery only a nap goes.
   */
  onAsked(world: WorldSnapshot, ask: Ask): MindEvent[] {
    const now = world.nowMs;
    const events: MindEvent[] = [];
    const state = respectState(world).kind;
    const quietOnly = state === "quiet" || state === "low_battery";
    if (ask === "pet") {
      // The same as a pet with the pointer, and it shows it.
      this.needsEvent("pet");
      this.note(now, "the human petted me");
      this.lastPetMs = now;
      this.learn(true, now);
      this.d.memory.log({ atMs: now, kind: "pet" });
    } else this.note(now, ask === "zoomies" ? "the human asked me for zoomies" : "the human told me to take a nap");
    if (state === "away" || state === "meeting") return events;
    if (quietOnly && ask !== "nap") return events;
    this.epoch++;
    this.restUntilMs = -Infinity;
    this.lastDecisionMs = now;
    const ins = instinctFor(this.personality.species);
    const thought = this.writtenLine(world, ask === "pet" ? "social" : ask === "nap" ? "rest" : "play");
    if (ask === "nap") {
      this.sleeping = true;
      this.napStartMs = now;
      this.setCurrent({ intent: "nap", target: "here", approach: "walk", stay_sec: 600, mood: "sleepy", ...(thought ? { thought } : {}) }, now, "reflex", events);
      return events;
    }
    if (this.sleeping) this.wake(now);
    if (ask === "zoomies") {
      this.needsEvent("play");
      this.setCurrent({ intent: "zoomies", target: "here", approach: "run", stay_sec: 12, mood: "playful", ...(thought ? { thought } : {}) }, now, "reflex", events);
      return events;
    }
    // A pet: some take it well, some take the chance to swat the hand.
    const swat = this.d.rng.next() < ins.bite;
    const script = swat
      ? [doing("surprise", 0.3, "cursor"), doing("swat", 0.8, "cursor"), doing("sulk", 2)]
      : ins.kind === "dog"
        ? [doing("happy", 1.6, "cursor"), doing("love", 1.6, "cursor"), doing("happy", 1.2, "cursor")]
        : [doing("headbutt", 1.8, "cursor"), doing("purr", 2.4), doing("love", 1.4, "cursor")];
    this.setCurrent(
      { intent: "react", target: "here", approach: "walk", stay_sec: Math.ceil(scriptSeconds(script)), mood: swat ? "grumpy" : "content", script, ...(thought ? { thought } : {}) },
      now,
      "reflex",
      events,
    );
    return events;
  }

  /** Test and debug hooks. */
  forceNeeds(patch: Partial<Needs>): void {
    this.needs = { ...this.needs, ...patch };
  }
  get lastTick(): number | null {
    return this.lastTickMs;
  }
  /** Seconds left of the rest between one action and choosing the next, 0 when it isn't resting. */
  get restLeftSec(): number {
    if (this.current !== null || this.sleeping || this.lastTickMs === null) return 0;
    return Math.max(0, (this.restUntilMs - this.lastTickMs) / 1000);
  }
  get resting(): boolean {
    return this.restLeftSec > 0;
  }
}
