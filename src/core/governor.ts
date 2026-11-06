import { BY_INTENT, CHAOS_ORDER, CHAOS_PARAMS, behavior } from "./behaviors";
import type { Approach, ChaosLevel, Intent, IntentName, Mood, Needs, Option, Settings, WorldSnapshot } from "./types";

export type RespectState =
  | { kind: "none" }
  | { kind: "meeting" }
  | { kind: "away"; reason: "panic" | "shoo" | "fullscreen" }
  | { kind: "quiet" }
  | { kind: "low_battery" };

const APPROACHES: readonly Approach[] = ["walk", "saunter", "sneak", "run"];
const MOODS: readonly Mood[] = ["content", "curious", "playful", "sleepy", "grumpy", "sulky", "smug"];

const HOUR_MS = 3_600_000;
const SHOO_COOLDOWN_MS = 3 * 60_000;
/**
 * The least time between two thought bubbles. A thought is where the model's wit shows, so it can't
 * be rare enough to never be seen (it was 10 minutes), but it mustn't chatter either.
 */
const THOUGHT_GAP_MS: Record<ChaosLevel, number> = { chill: 8 * 60_000, normal: 4 * 60_000, gremlin: 150_000 };
const MAX_THOUGHT_CHARS = 80;
/** What the cat may do in quiet hours and on low battery. */
const QUIET_INTENTS: readonly IntentName[] = ["nap", "nap_warm"];
const LOW_BATTERY_INTENTS: readonly IntentName[] = ["nap", "nap_warm", "groom", "stare"];

export function respectState(world: WorldSnapshot): RespectState {
  if (world.panic) return { kind: "away", reason: "panic" };
  if (world.shooedUntilMs > world.nowMs) return { kind: "away", reason: "shoo" };
  if (world.fullscreen) return { kind: "away", reason: "fullscreen" };
  if (world.inMeeting || world.screenSharing) return { kind: "meeting" };
  if (world.quietHours) return { kind: "quiet" };
  if (world.batteryLow) return { kind: "low_battery" };
  return { kind: "none" };
}

/** What the cat does when a respect mode starts. Always allowed, and the brain can't override it. */
export function respectPlan(state: RespectState): Intent | null {
  switch (state.kind) {
    case "meeting":
      return { intent: "nap", target: "corner", approach: "sneak", stay_sec: 300, mood: "sleepy" };
    case "away":
      return { intent: "leave", target: "corner", approach: "walk", stay_sec: 300, mood: "content" };
    default:
      return null;
  }
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+|www\.\S+/gi, "").replace(/\s+/g, " ").trim();
}

interface HistoryEntry {
  intent: IntentName;
  atMs: number;
}

/**
 * Approves or rejects every action. The brain (LLM or rules) can never override it.
 * See docs/technical-design.md section 6.7.
 */
export class Governor {
  private points: number;
  private lastRefillMs: number | null = null;
  private history: HistoryEntry[] = [];
  private blocks = new Map<string, number[]>();
  private shoos = new Map<string, number>();
  private lastShooAnyMs = -Infinity;
  private lastThoughtMs = -Infinity;
  private giftsOnScreen = 0;

  constructor(private settings: Settings) {
    this.points = CHAOS_PARAMS[settings.chaos].pointsPerHour * 0.6;
  }

  setSettings(settings: Settings): void {
    if (settings.chaos !== this.settings.chaos) {
      this.points = Math.min(this.points, CHAOS_PARAMS[settings.chaos].pointsPerHour);
    }
    this.settings = settings;
  }

  getSettings(): Settings {
    return this.settings;
  }

  /** Annoyance points left this hour. */
  get budget(): number {
    return this.points;
  }

  private refill(nowMs: number): void {
    const cap = CHAOS_PARAMS[this.settings.chaos].pointsPerHour;
    if (this.lastRefillMs === null) {
      this.lastRefillMs = nowMs;
      return;
    }
    const dt = Math.max(0, nowMs - this.lastRefillMs);
    this.points = Math.min(cap, this.points + (dt / HOUR_MS) * cap);
    this.lastRefillMs = nowMs;
  }

  noteShoo(windowId: string | null, nowMs: number): void {
    this.lastShooAnyMs = nowMs;
    if (windowId) this.shoos.set(windowId, nowMs);
  }

  clearGift(): void {
    this.giftsOnScreen = Math.max(0, this.giftsOnScreen - 1);
  }

  private recentBlocks(windowId: string, nowMs: number): number {
    const list = (this.blocks.get(windowId) ?? []).filter((t) => nowMs - t < HOUR_MS);
    this.blocks.set(windowId, list);
    return list.length;
  }

  private lastIntent(): IntentName | null {
    return this.history.length ? (this.history[this.history.length - 1] as HistoryEntry).intent : null;
  }

  /** Can this intent run at all right now? Targets are checked in allowedTargets. */
  private intentAllowed(intent: IntentName, world: WorldSnapshot, needs: Needs): boolean {
    const def = BY_INTENT.get(intent);
    if (!def) return false;
    const s = this.settings;
    const state = respectState(world);
    if (intent === "leave") return true;
    if (state.kind === "away" || state.kind === "meeting") return false;
    if (state.kind === "quiet" && !QUIET_INTENTS.includes(intent)) return false;
    if (state.kind === "low_battery" && !LOW_BATTERY_INTENTS.includes(intent)) return false;
    if (CHAOS_ORDER[s.chaos] < CHAOS_ORDER[def.minChaos]) return false;
    if (def.perm === "screen_recording" && !s.smartTargeting) return false;
    if (def.perm === "accessibility" && !(s.accessibility && s.chaos === "gremlin")) return false;
    this.refill(world.nowMs);
    if (def.annoy > this.points) return false;
    // Same attention or mischief move twice in a row is not fair.
    if (def.annoy >= 1 && this.lastIntent() === intent) return false;
    if (intent === "slow_blink" && needs.trust < 60) return false;
    if ((intent === "gift" || intent === "hairball") && this.giftsOnScreen >= 1) return false;
    if (intent === "keyboard_walk" && world.activity !== "typing" && world.activity !== "typing_fast") return false;
    return true;
  }

  private targetAllowed(intent: IntentName, target: string, world: WorldSnapshot): boolean {
    const def = behavior(intent);
    if (def.blocks) {
      if (this.recentBlocks(target, world.nowMs) >= 2) return false;
      const shooed = this.shoos.get(target);
      if (shooed !== undefined && world.nowMs - shooed < SHOO_COOLDOWN_MS) return false;
    }
    // Sitting on a window that isn't the focused one means reading titles.
    if (intent === "sit_on" && !this.settings.smartTargeting) {
      const w = world.windows.find((x) => x.id === target);
      if (w && !w.focused) return false;
    }
    if (intent === "box") {
      const w = world.windows.find((x) => x.id === target);
      if (!w || !(w.isNew || w.isEmpty)) return false;
    }
    return true;
  }

  /** Cuts the options down to what is allowed right now. */
  filter(options: Option[], world: WorldSnapshot, needs: Needs): Option[] {
    this.refill(world.nowMs);
    const out: Option[] = [];
    for (const o of options) {
      if (!this.intentAllowed(o.intent, world, needs)) continue;
      const targets = o.targets.filter((t) => this.targetAllowed(o.intent, t, world));
      if (targets.length === 0) continue;
      out.push({ ...o, targets });
    }
    return out;
  }

  /** Checks a chosen intent again, then clamps it. Returns null when it must not run. */
  validate(raw: Intent, options: Option[], world: WorldSnapshot, needs: Needs): Intent | null {
    // A trick planned earlier may not be the one on offer now: any trick option allows it.
    const option = options.find((o) => o.intent === raw.intent && (raw.trick === undefined || o.trick === raw.trick)) ?? options.find((o) => o.intent === raw.intent);
    if (!option) return null;
    if (!this.intentAllowed(raw.intent, world, needs)) return null;
    const allowedTargets = option.targets.filter((t) => this.targetAllowed(raw.intent, t, world));
    const target = allowedTargets.includes(raw.target) ? raw.target : allowedTargets[0];
    if (target === undefined) return null;
    const def = behavior(raw.intent);
    const maxStay = def.maxStay === "block" ? CHAOS_PARAMS[this.settings.chaos].maxBlockSec : def.maxStay;
    const minStay = def.minStay ?? 5;
    const stay = Number.isFinite(raw.stay_sec) ? Math.round(raw.stay_sec) : minStay;
    const out: Intent = {
      intent: raw.intent,
      target,
      approach: APPROACHES.includes(raw.approach) ? raw.approach : "walk",
      stay_sec: Math.max(minStay, Math.min(maxStay, stay)),
      mood: MOODS.includes(raw.mood) ? raw.mood : needs.mood,
    };
    if (raw.intent === "trick") out.trick = raw.trick ?? option.trick;
    if (this.settings.thoughtBubbles && raw.thought && world.nowMs - this.lastThoughtMs >= THOUGHT_GAP_MS[this.settings.chaos]) {
      const t = stripUrls(raw.thought).slice(0, MAX_THOUGHT_CHARS).trim();
      if (t) out.thought = t;
    }
    return out;
  }

  /** Call when an intent actually starts. Charges the budget and records history. */
  commit(intent: Intent, world: WorldSnapshot): void {
    const def = behavior(intent.intent);
    this.refill(world.nowMs);
    this.points = Math.max(0, this.points - def.annoy);
    this.history.push({ intent: intent.intent, atMs: world.nowMs });
    if (this.history.length > 50) this.history.shift();
    if (def.blocks) {
      const list = this.blocks.get(intent.target) ?? [];
      list.push(world.nowMs);
      this.blocks.set(intent.target, list);
    }
    if (intent.intent === "gift" || intent.intent === "hairball") this.giftsOnScreen += 1;
    if (intent.thought) this.lastThoughtMs = world.nowMs;
  }
}
