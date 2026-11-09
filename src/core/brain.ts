import { pickBout, type BoutKind } from "./bouts";
import { intentFromOption, type RulesContext } from "./rules";
import { buildPlanPrompt, buildPlanSchema, buildPlanSummary, buildSchema, buildSummary, buildSystemPrompt, type BoutChoice, type IntentSchema } from "./summary";
import type { Approach, Intent, IntentName, Mood, Needs, Option, Settings, WorldSnapshot } from "./types";
import type { Personality } from "./personality";

/** The model's context window in tokens (prompt plus answer). */
export const NUM_CTX = 4096;

export interface BrainContext {
  rules: RulesContext;
  options: Option[];
  settings: Settings;
  personality: Personality;
  memory: string[];
  catWhere: string;
  catDoing: string;
}

/** What a brain needs to plan the next bout. */
export interface PlanContext extends BrainContext {
  /** The bouts that make sense now, with how well each fits and what the animal could do in each. */
  bouts: BoutChoice[];
  /** Things standing on windows that could be knocked off: "mug on w3". */
  things?: string[];
  /** Keep this bout and only plan more steps (the plan ran out before the bout did). */
  fixedBout?: BoutKind;
  /** What happened lately, newest first ("2 min ago: the human poked me, i hissed"). */
  happened: string[];
  lastBout: BoutKind | null;
  /** Minutes the human has been busy at the computer without a break. */
  busyForMin: number;
}

/** A bout and the first few things to do in it, in order. */
export interface Plan {
  bout: BoutKind;
  steps: Intent[];
  thought?: string;
}

export interface Brain {
  readonly name: string;
  /** Returns null when it has no answer. The caller then falls back to the rules. */
  decide(ctx: BrainContext): Promise<Intent | null>;
  /** Plans the next bout. Returns null when it has no answer. */
  plan?(ctx: PlanContext): Promise<Plan | null>;
}

/** A weighted pick among options. */
export function weighted(options: Option[], rng: RulesContext["rng"]): Option | undefined {
  const total = options.reduce((s, o) => s + o.score, 0);
  let roll = rng.next() * total;
  for (const o of options) {
    roll -= o.score;
    if (roll <= 0) return o;
  }
  return options[options.length - 1];
}

/** Weighted random pick from the top 3 options. Needs no setup. */
export class RulesBrain implements Brain {
  readonly name = "rules";
  async decide(ctx: BrainContext): Promise<Intent | null> {
    const top = ctx.options.slice(0, 3);
    if (top.length === 0) return null;
    const total = top.reduce((s, o) => s + o.score, 0);
    let roll = ctx.rules.rng.next() * total;
    let chosen = top[0] as Option;
    for (const o of top) {
      roll -= o.score;
      if (roll <= 0) {
        chosen = o;
        break;
      }
    }
    return intentFromOption(chosen, ctx.rules, ctx.settings.chaos, ctx.settings.thoughtBubbles);
  }

  /** The bout by its weights, then two or three different things from it, the likelier first. */
  async plan(ctx: PlanContext): Promise<Plan | null> {
    const weights: Record<BoutKind, number> = { rest: 0, explore: 0, play: 0, social: 0, mischief: 0 };
    for (const b of ctx.bouts) weights[b.kind] = b.weight;
    const kind = ctx.fixedBout ?? pickBout(weights, ctx.rules.rng);
    const choice = ctx.bouts.find((b) => b.kind === kind);
    if (!choice || choice.options.length === 0) return null;
    const pool = choice.options.slice(0, 6);
    const n = Math.min(pool.length, ctx.rules.rng.next() < 0.5 ? 2 : 3);
    const steps: Intent[] = [];
    for (let i = 0; i < n; i++) {
      const o = weighted(pool, ctx.rules.rng);
      if (!o) break;
      pool.splice(pool.indexOf(o), 1);
      steps.push(intentFromOption(o, ctx.rules, ctx.settings.chaos, ctx.settings.thoughtBubbles));
    }
    return steps.length ? { bout: kind, steps } : null;
  }
}

export interface LlmRequest {
  system: string;
  user: string;
  schema: IntentSchema;
  timeoutMs: number;
  /** Longest answer in tokens. */
  maxTokens?: number;
}

/** Anything that can turn a prompt into text. Ollama, a built-in engine later, or a fake. */
export interface LlmClient {
  readonly name: string;
  generate(req: LlmRequest): Promise<string>;
}

const APPROACH_SET = new Set<string>(["walk", "saunter", "sneak", "run"]);
const MOOD_SET = new Set<string>(["content", "curious", "playful", "sleepy", "grumpy", "sulky", "smug"]);

/** Reads the model's text. Accepts plain JSON or JSON with chatter around it. Returns null if unusable. */
export function parseIntent(text: string, options: Option[]): Intent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      raw = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const option = options.find((o) => o.intent === r.intent);
  if (!option) return null;
  const target = typeof r.target === "string" && option.targets.includes(r.target) ? r.target : (option.targets[0] as string);
  const approach = typeof r.approach === "string" && APPROACH_SET.has(r.approach) ? (r.approach as Approach) : "walk";
  const mood = typeof r.mood === "string" && MOOD_SET.has(r.mood) ? (r.mood as Mood) : "content";
  const stay = typeof r.stay_sec === "number" ? r.stay_sec : 20;
  const out: Intent = { intent: option.intent as IntentName, target, approach, stay_sec: stay, mood };
  if (option.trick) out.trick = option.trick;
  if (typeof r.thought === "string" && r.thought.trim()) out.thought = r.thought;
  return out;
}

/**
 * One short line: a small model sometimes rambles on for a paragraph. Keeps whole sentences up to
 * about 90 characters, or cuts at a word.
 */
export function shortThought(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?…]+[.!?…]+/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  if (out.trim()) return out.trim();
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}

const STOP = new Set(
  "your human have been with that this from there them they just into what when where while about after times time away ago row and the for was are you not but all its has had now one out can get got too very will some more much than then like".split(" "),
);
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s|ed|ing)$/, "") : w);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem));

/**
 * True when the thought says something about the topic it was given (shares a real word with it).
 * A 1b model otherwise writes about dust motes and sunbeams.
 */
export function thoughtFits(thought: string, about: string): boolean {
  if (/dust|sunbeam|sunlight|rain|scent/.test(thought.toLowerCase())) return false;
  const want = words(about);
  for (const w of words(thought)) if (want.has(w)) return true;
  return false;
}

const BOUT_SET = new Set<string>(["rest", "explore", "play", "social", "mischief"]);

/** Reads a plan from the model's text. Steps that are not on the menu are dropped. Null if nothing usable. */
export function parsePlan(text: string, bouts: BoutChoice[]): Plan | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      raw = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const offered = bouts.map((b) => b.kind as string);
  const bout = (typeof r.bout === "string" && BOUT_SET.has(r.bout) && offered.includes(r.bout) ? r.bout : offered[0]) as BoutKind | undefined;
  if (!bout) return null;
  // Steps come from the chosen bout's menu. A small model sometimes picks steps from another
  // bout; then the bout follows its first step, so the label and the steps agree.
  let chosen = bouts.find((b) => b.kind === bout) as BoutChoice;
  const first = Array.isArray(r.steps) ? (r.steps[0] as Record<string, unknown> | undefined)?.intent : undefined;
  if (typeof first === "string" && !chosen.options.some((o) => o.intent === first)) {
    const other = bouts.find((b) => b.options.some((o) => o.intent === first));
    if (other) chosen = other;
  }
  const all = chosen.options;
  const mood = typeof r.mood === "string" && MOOD_SET.has(r.mood) ? (r.mood as Mood) : "content";
  const steps: Intent[] = [];
  for (const st of Array.isArray(r.steps) ? r.steps.slice(0, 3) : []) {
    if (typeof st !== "object" || st === null) continue;
    const one = parseIntent(JSON.stringify({ mood, ...st }), all);
    // "nap, nap, nap" is one nap, and "hunt, chase_tail, hunt" is a hunt and a tail chase.
    if (one && !steps.some((x) => x.intent === one.intent)) steps.push(one);
  }
  if (steps.length === 0) return null;
  const out: Plan = { bout: chosen.kind, steps };
  // The voice is lowercase; a small model writes in sentence case.
  const thought = typeof r.thought === "string" ? shortThought(r.thought).toLowerCase() : "";
  if (thought) out.thought = thought;
  return out;
}

export class LlmBrain implements Brain {
  readonly name: string;
  calls = 0;
  failures = 0;
  invalid = 0;
  /** Thoughts dropped because they had nothing to do with the moment. */
  offTopic = 0;
  /** The last topic and thought, for the eval only (never logged: hard rule 6). */
  lastAbout = "";
  lastRawThought = "";
  lastLatencyMs = 0;
  latencies: number[] = [];

  constructor(
    private client: LlmClient,
    private timeoutMs = 8000,
  ) {
    this.name = `llm:${client.name}`;
  }

  async decide(ctx: BrainContext): Promise<Intent | null> {
    const world: WorldSnapshot = ctx.rules.world;
    const needs: Needs = ctx.rules.needs;
    const summary = buildSummary({
      world,
      needs,
      settings: ctx.settings,
      options: ctx.options,
      memory: ctx.memory,
      catWhere: ctx.catWhere,
      catDoing: ctx.catDoing,
    });
    const req: LlmRequest = {
      system: buildSystemPrompt(ctx.personality, needs.trust),
      user: JSON.stringify(summary),
      schema: buildSchema(ctx.options),
      timeoutMs: this.timeoutMs,
    };
    this.calls += 1;
    const t0 = Date.now();
    let text: string;
    try {
      text = await withTimeout(this.client.generate(req), this.timeoutMs);
    } catch (err) {
      this.failures += 1;
      throw err;
    } finally {
      this.lastLatencyMs = Date.now() - t0;
      this.latencies.push(this.lastLatencyMs);
      if (this.latencies.length > 200) this.latencies.shift();
    }
    const intent = parseIntent(text, ctx.options);
    if (!intent) {
      this.invalid += 1;
      return null;
    }
    return intent;
  }

  async plan(ctx: PlanContext): Promise<Plan | null> {
    const bouts = ctx.fixedBout ? ctx.bouts.filter((b) => b.kind === ctx.fixedBout) : ctx.bouts;
    if (bouts.length === 0) return null;
    const summary = buildPlanSummary({
      world: ctx.rules.world,
      needs: ctx.rules.needs,
      settings: ctx.settings,
      bouts,
      memory: ctx.memory,
      happened: ctx.happened,
      catWhere: ctx.catWhere,
      catDoing: ctx.catDoing,
      lastBout: ctx.lastBout,
      recent: ctx.rules.recent,
      busyForMin: ctx.busyForMin,
      things: ctx.things ?? [],
      catPos: ctx.rules.catPos,
      toy: ctx.rules.toy ?? null,
      scene: ctx.rules.scene ?? [],
    });
    const req: LlmRequest = {
      system: buildPlanPrompt(ctx.personality, ctx.rules.needs.trust),
      user: JSON.stringify(summary),
      schema: buildPlanSchema(bouts),
      timeoutMs: this.timeoutMs,
      maxTokens: 260,
    };
    this.calls += 1;
    const t0 = Date.now();
    let text: string;
    try {
      text = await withTimeout(this.client.generate(req), this.timeoutMs);
    } catch (err) {
      this.failures += 1;
      throw err;
    } finally {
      this.lastLatencyMs = Date.now() - t0;
      this.latencies.push(this.lastLatencyMs);
      if (this.latencies.length > 200) this.latencies.shift();
    }
    const plan = parsePlan(text, bouts);
    if (!plan) this.invalid += 1;
    this.lastAbout = summary.thought_about;
    this.lastRawThought = plan?.thought ?? "";
    if (plan?.thought && !thoughtFits(plan.thought, summary.thought_about)) {
      // Better no thought than a made-up one.
      delete plan.thought;
      this.offTopic += 1;
    }
    return plan;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM timeout after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function isLocalUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/**
 * The part of fetch the Ollama client uses, so an app can send the request its own way.
 * `timeoutMs` is how long the caller waits; fetch itself ignores it.
 */
export type FetchLike = (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;

/** Talks to a local Ollama server. Needs no key. Not used by the tests (no model is installed here). */
export class OllamaClient implements LlmClient {
  readonly name = "ollama";
  constructor(
    private baseUrl: string,
    private model: string,
    private send: FetchLike = (url, init) => fetch(url, init),
  ) {}

  async generate(req: LlmRequest): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await this.send(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        timeoutMs: req.timeoutMs,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: req.schema,
          keep_alive: "5m",
          // 4096: the whole screen in words (ADR-061) plus the answer fit with room to spare. Ollama
          // cuts a prompt that doesn't fit from the front, which would lose the instructions.
          options: { temperature: 0.8, num_predict: req.maxTokens ?? 120, num_ctx: NUM_CTX },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
      const data = (await res.json()) as { message?: { content?: string } };
      const text = data.message?.content;
      if (!text) throw new Error("Ollama sent no content");
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type FakeMode = "good" | "garbage" | "off_menu" | "slow" | "error" | "chatty";

/**
 * Local stand-in for a real model, so tests and the playground work with no model installed.
 * "good" picks the best option and sometimes adds a cat thought.
 */
export class FakeLlmClient implements LlmClient {
  readonly name = "fake";
  calls = 0;
  constructor(
    public mode: FakeMode = "good",
    private latencyMs = 5,
  ) {}

  async generate(req: LlmRequest): Promise<string> {
    this.calls += 1;
    // Well past the timeout, so a busy machine can never make it arrive in time.
    if (this.mode === "slow") await new Promise((r) => setTimeout(r, req.timeoutMs + 600));
    else if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.mode === "error") throw new Error("fake LLM is down");
    if (this.mode === "garbage") return "meow meow I am a cat {not json";
    const summary = JSON.parse(req.user) as { options: string[]; cat: { mood: Mood }; windows: { id: string; focused?: boolean }[]; bouts?: Record<string, { options: string[] | Record<string, string> }>; suggested?: string };
    if (summary.bouts) {
      // A plan: the suggested bout and its first two options.
      if (this.mode === "off_menu") return JSON.stringify({ bout: "rest", steps: [{ intent: "format_disk", target: "here" }], mood: "smug", thought: "x" });
      const bout = summary.suggested ?? Object.keys(summary.bouts)[0] ?? "rest";
      const listed = summary.bouts[bout]?.options ?? [];
      const opts = Array.isArray(listed) ? listed : Object.keys(listed);
      const json = JSON.stringify({ bout, steps: opts.slice(0, 2).map((intent) => ({ intent, target: "here", approach: "walk", stay_sec: 30 })), mood: summary.cat.mood, thought: "you typed all morning. i noticed." });
      return this.mode === "chatty" ? `Sure! Here is my plan:\n${json}\nHope that helps.` : json;
    }
    const props = req.schema.properties as { target: { enum: string[] } };
    if (this.mode === "off_menu") return JSON.stringify({ intent: "format_disk", target: "here", approach: "walk", stay_sec: 20, mood: "smug" });
    const intent = summary.options[0] ?? "nap";
    const focused = summary.windows.find((w) => w.focused)?.id;
    const target = props.target.enum.includes(focused ?? "") && ["sit_on", "cross", "follow"].includes(intent) ? focused : props.target.enum[1] ?? "here";
    const json = JSON.stringify({
      intent,
      target,
      approach: "saunter",
      stay_sec: 40,
      mood: summary.cat.mood,
      thought: "you moved me. i'm back.",
    });
    return this.mode === "chatty" ? `Sure! Here is my answer:\n${json}\nHope that helps.` : json;
  }
}
