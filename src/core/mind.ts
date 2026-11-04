import { behavior } from "./behaviors";
import type { Brain, BrainContext } from "./brain";
import { Governor, respectPlan, respectState, type RespectState } from "./governor";
import type { Memory } from "./memory";
import { applyEvent, initialNeeds, stepNeeds, type NeedsEvent } from "./needs";
import type { Personality } from "./personality";
import { ENERGY_BY_CHAOS, instinctFor } from "./species";
import type { ReflexKind } from "./reflexes";
import { pokeReaction, scriptSeconds } from "./reactions";
import type { Rng } from "./rng";
import { candidates, focusedWindow, intentFromOption, type RulesContext } from "./rules";
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
  /** Never receives window titles. */
  log?: (message: string, fields?: Record<string, unknown>) => void;
  minDecisionGapMs?: number;
}

const WAKE_ENERGY = 0.85;
const MIN_NAP_MS = 120_000;
const HOUR_MS = 3_600_000;

const SLEEP_INTENTS: readonly IntentName[] = ["nap", "nap_warm"];

/**
 * The slow brain loop. Decides what the cat wants every 20 to 60 seconds or when something happens.
 * It never moves the cat. The executor does that.
 */
const DECISION_GAP_MS: Record<ChaosLevel, number> = { chill: 20_000, normal: 8_000, gremlin: 2_500 };

/**
 * Seconds an animal does nothing after an action ends, before it thinks of the next one. Real cats
 * spend most of the day sitting or lying about, so a busy moment is followed by a calm one. The
 * species gap and laziness stretch it (a cat rests longer than a dog), and a lively action more so.
 */
const REST_SEC: Record<ChaosLevel, [number, number]> = { chill: [25, 60], normal: [8, 22], gremlin: [3, 8] };
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
  private lastShooMs = -Infinity;
  private lastPetMs = -Infinity;
  /** Times of the recent clicks on the animal, and what it did last, so a poke can escalate and vary. */
  private pokes: number[] = [];
  private lastReaction: string | undefined;
  private annoyedUntilMs = -Infinity;
  private seenWindows = new Set<string>();
  private groomAfterLanding = false;
  private revisit: { windowId: string; notBeforeMs: number } | null = null;
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
    const [lo, hi] = REST_SEC[this.settings.chaos];
    const lazy = 0.7 + 0.6 * this.personality.laziness;
    const lively = was !== undefined && LIVELY.has(was) ? 1.4 : 1;
    return this.d.rng.range(lo, hi) * 1000 * instinctFor(this.personality.species).gap * lazy * lively;
  }

  async tick(world: WorldSnapshot, dtSec: number, moving: boolean, held = false): Promise<MindEvent[]> {
    const events: MindEvent[] = [];
    const now = world.nowMs;
    this.lastTickMs = now;
    let newWindows = 0;
    for (const w of world.windows) {
      if (!this.seenWindows.has(w.id)) {
        this.seenWindows.add(w.id);
        if (w.isNew) newWindows += 1;
      }
    }
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
    if (this.revisit && now >= this.revisit.notBeforeMs) {
      const hit = options.find((o) => o.intent === "sit_on" && o.targets.includes(this.revisit!.windowId));
      if (hit) {
        options = [{ ...hit, targets: [this.revisit.windowId], score: hit.score * 10 }, ...options.filter((o) => o !== hit)];
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

    let intent: Intent | null = null;
    let source: "llm" | "rules" = "rules";
    if (options.length > 0 && !world.batteryLow && this.canCallLlm(now)) {
      this.llmCalls.push(now);
      try {
        const raw = await this.brain.decide(brainCtx);
        if (raw) {
          intent = gov.validate(raw, options, world, this.needs);
          if (intent) {
            source = "llm";
            this.llmFailures = 0;
            this.stats.llm += 1;
          }
        }
        if (!intent) this.stats.fallbacks += 1;
      } catch (err) {
        this.llmFailures += 1;
        this.stats.fallbacks += 1;
        const message = err instanceof Error ? err.message : String(err);
        events.push({ type: "llm_problem", message });
        this.d.log?.("llm problem", { message, failures: this.llmFailures });
        if (this.llmFailures >= 3) {
          this.llmCooldownUntil = now + 2 * 60_000;
          this.llmFailures = 0;
        }
      }
    }
    if (!intent && options.length > 0) {
      const raw = await this.d.fallback.decide(brainCtx);
      if (raw) {
        intent = gov.validate(raw, options, world, this.needs);
        if (intent) this.stats.rules += 1;
      }
    }
    if (!intent) {
      // Nothing was allowed. A cat can always wash itself, or nap if it is tired.
      const tired = this.needs.energy < 0.4;
      const safeName: IntentName = tired ? "nap" : "groom";
      const safe = intentFromOption({ intent: safeName, targets: ["here"], score: 1 }, rulesCtx, this.settings.chaos, false);
      intent = safe;
      source = "rules";
      this.stats.safe += 1;
      this.stats.decisions += 1;
      this.begin(intent, world, "safe", events, false);
      return;
    }
    this.stats.decisions += 1;
    this.begin(intent, world, source, events, true);
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
        quick("swat", "cursor", 5);
        break;
      case "pickup":
        this.sleeping = false;
        this.current = null;
        break;
      case "drop":
        this.needsEvent("gentle_drop");
        this.groomAfterLanding = true;
        break;
      case "throw":
        this.needsEvent("throw");
        this.groomAfterLanding = true;
        this.d.memory.log({ atMs: now, kind: "thrown" });
        break;
      case "shoo": {
        this.needsEvent("shoo");
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
