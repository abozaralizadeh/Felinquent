import { behavior } from "./behaviors";
import { BOUT_INTENTS, BOUT_KINDS, PAUSE, PAUSE_BY_CHAOS, boutLengthMs, boutWeights, openingMove, pickBout, type BoutKind } from "./bouts";
import type { Brain, BrainContext, Plan, PlanContext } from "./brain";
import { Governor, respectPlan, respectState, type RespectState } from "./governor";
import type { Memory } from "./memory";
import { applyEvent, initialNeeds, stepNeeds, type NeedsEvent } from "./needs";
import type { Personality } from "./personality";
import { ENERGY_BY_CHAOS, instinctFor } from "./species";
import type { ReflexKind } from "./reflexes";
import { pokeReaction, scriptSeconds } from "./reactions";
import { lineFor } from "./lines";
import { seeded, type Rng } from "./rng";
import { candidates, focusedWindow, intentFromOption, type RulesContext } from "./rules";
import { thoughtTopic } from "./summary";
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
  /** Never receives window titles. */
  log?: (message: string, fields?: Record<string, unknown>) => void;
  minDecisionGapMs?: number;
}

const WAKE_ENERGY = 0.85;
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
const LIVELY: ReadonlySet<IntentName> = new Set<IntentName>(["zoomies", "follow", "tumble", "bounce", "spook", "chase_tail", "react", "stalk", "keyboard_walk", "knock_toy", "swat", "roll", "dig", "howl"]);

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
  private awaySinceMs: number | null = null;
  private lastTickMs: number | null = null;
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

  /** Swap the main brain at runtime (settings change). Pass the fallback to switch the LLM off. */
  setBrain(brain: Brain): void {
    this.brain = brain;
    this.llmFailures = 0;
    this.llmCooldownUntil = 0;
  }

  /** The last choice the cat made for itself, so a pet or a shoo soon after can teach it something. */
  private lastChosen: { intent: IntentName; atMs: number } | null = null;

  private learn(good: boolean, now: number): void {
    const c = this.lastChosen;
    const h = this.d.memory.habits;
    if (!c || !h || now - c.atMs > 120_000) return;
    if (good) h.reward(c.intent);
    else h.punish(c.intent);
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
  private watchHuman(world: WorldSnapshot, newApps: string[]): void {
    const now = world.nowMs;
    const busy = world.activity === "typing" || world.activity === "typing_fast" || world.activity === "reading";
    if (world.activity === "away") {
      this.awaySinceMs ??= now;
      this.busySinceMs = null;
    } else {
      if (this.awaySinceMs !== null) {
        const m = Math.round((now - this.awaySinceMs) / 60_000);
        if (m >= 5) this.note(now, `the human came back after ${m} min away`);
        this.awaySinceMs = null;
      }
      if (busy) this.busySinceMs ??= now;
      else if (world.idleSec > 120) this.busySinceMs = null;
    }
    for (const app of newApps.slice(0, 2)) this.note(now, `a new ${app || "window"} window opened`);
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
    this.watchHuman(world, newApps);
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

    const state = respectState(world);
    if (state.kind !== this.lastRespect) {
      const was = this.lastRespect;
      this.lastRespect = state.kind;
      events.push({ type: "respect", state: state.kind });
      this.d.log?.("respect mode", { from: was, to: state.kind });
      const plan = respectPlan(state);
      if (plan) {
        this.setCurrent(plan, now, "respect", events);
        this.sleeping = plan.intent === "nap";
        return events;
      }
      if (was === "meeting" || was === "away") {
        this.current = null;
        this.sleeping = false;
        this.bout = null;
        this.lastDecisionMs = now - this.gapMs;
        this.restUntilMs = -Infinity;
      }
    }
    if (state.kind === "meeting" || state.kind === "away") {
      if (!this.current) {
        const plan = respectPlan(state);
        if (plan) this.setCurrent(plan, now, "respect", events);
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
      } else if (!this.current) {
        // Nap ran out of time but the cat is still tired: keep sleeping, no new decision.
        this.current = { intent: "nap", target: "here", approach: "walk", stay_sec: 1800, mood: "sleepy" };
        events.push({ type: "intent", intent: this.current, source: "rules" });
      }
      return events;
    }

    if (this.current) return events;
    if (now - this.lastDecisionMs < this.gapMs || now < this.restUntilMs) return events;
    await this.decide(world, events);
    for (const message of this.llmProblems.splice(0)) events.unshift({ type: "llm_problem", message });
    return events;
  }

  private setCurrent(intent: Intent, _now: number, source: "llm" | "rules" | "respect" | "reflex" | "safe", events: MindEvent[]): void {
    this.current = intent;
    if (source === "llm" || source === "rules") this.lastChosen = { intent: intent.intent, atMs: _now };
    if (intent.intent !== "react") {
      this.recent.push(intent.intent);
      if (this.recent.length > 10) this.recent.shift();
    }
    events.push({ type: "intent", intent, source });
    this.d.log?.("intent", { intent: intent.intent, target: intent.target, source, mood: intent.mood });
  }

  private ctx(world: WorldSnapshot): RulesContext {
    return {
      habits: this.d.memory.habits,
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
    };
  }

  private canCallLlm(now: number): boolean {
    if (this.brain === this.d.fallback) return false;
    if (this.settings.brain !== "llm") return false;
    if (now < this.llmCooldownUntil) return false;
    this.llmCalls = this.llmCalls.filter((t) => now - t < HOUR_MS);
    if (this.llmCalls.length >= 60) return false;
    const last = this.llmCalls[this.llmCalls.length - 1];
    if (last !== undefined && now - last < 15_000) return false;
    return true;
  }

  private async decide(world: WorldSnapshot, events: MindEvent[]): Promise<void> {
    const now = world.nowMs;
    this.lastDecisionMs = now;
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

    // A new bout when there is none yet, when this one has run its course, or when the animal is worn out.
    const worn = this.needs.energy < 0.25 && this.bout !== null && this.bout.kind !== "rest";
    if (options.length > 0 && (!this.bout || now >= this.bout.untilMs || worn)) await this.startBout(world, options, brainCtx);

    // The next planned step, checked again now: the world may have changed since it was planned.
    // The opening moves (a stretch, a wash) are always on the menu.
    const menu = [...options, ...BASICS.filter((b) => !options.some((o) => o.intent === b.intent))];
    let intent: Intent | null = revisit;
    let source: "llm" | "rules" = revisit ? "rules" : (this.bout?.source ?? "rules");
    while (!intent && this.bout && this.bout.steps.length > 0) intent = gov.validate(this.bout.steps.shift() as Intent, menu, world, this.needs);
    // The plan ran out but the bout goes on: a few more steps of the same bout.
    if (!intent && this.bout && options.length > 0) {
      const more = await this.planBout(world, options, brainCtx, this.bout.kind);
      if (more) {
        source = more.source;
        this.bout.steps = more.plan.steps;
        if (more.plan.thought && this.bout.steps[0]) this.bout.steps[0] = { ...this.bout.steps[0], thought: more.plan.thought };
        while (!intent && this.bout.steps.length > 0) intent = gov.validate(this.bout.steps.shift() as Intent, menu, world, this.needs);
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
    const bouts = BOUT_KINDS.map((kind) => ({ kind, weight: w[kind], options: fresh.filter((o) => BOUT_INTENTS[kind].includes(o.intent)) })).filter(
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
    if (!world.batteryLow && this.canCallLlm(now) && this.brain.plan) {
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

  /** Starts the next bout: asks for a plan and puts the opening move (a stretch, a wash) first. */
  private async startBout(world: WorldSnapshot, options: Option[], brainCtx: BrainContext): Promise<void> {
    const now = world.nowMs;
    const got = await this.planBout(world, options, brainCtx);
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
    this.setCurrent(intent, world.nowMs, source, events);
  }

  private needsEvent(ev: NeedsEvent): void {
    this.needs = applyEvent(this.needs, ev);
  }

  /** Reacts to a reflex from the pointer. Reflexes skip the brain, but respect modes still win. */
  onReflex(kind: ReflexKind, world: WorldSnapshot, windowId?: string): MindEvent[] {
    const events: MindEvent[] = [];
    const now = world.nowMs;
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

  /** The shell passes executor events here (landing after a throw makes the cat groom, "I meant to do that"). */
  onExecLanded(world: WorldSnapshot): MindEvent[] {
    if (!this.groomAfterLanding) return [];
    this.groomAfterLanding = false;
    if (respectState(world).kind !== "none") return [];
    const events: MindEvent[] = [];
    this.setCurrent({ intent: "groom", target: "here", approach: "walk", stay_sec: 8, mood: this.needs.mood }, world.nowMs, "reflex", events);
    return events;
  }

  giveTreat(world: WorldSnapshot): MindEvent[] {
    this.needsEvent("treat");
    this.note(world.nowMs, "the human gave me a treat");
    this.learn(true, world.nowMs);
    this.d.memory.log({ atMs: world.nowMs, kind: "treat" });
    const events: MindEvent[] = [];
    if (respectState(world).kind !== "none") return events;
    this.sleeping = false;
    this.setCurrent({ intent: "follow", target: "cursor", approach: "run", stay_sec: 10, mood: "content" }, world.nowMs, "reflex", events);
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
