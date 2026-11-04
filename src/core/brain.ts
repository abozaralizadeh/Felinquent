import { intentFromOption, type RulesContext } from "./rules";
import { buildSchema, buildSummary, buildSystemPrompt, type IntentSchema } from "./summary";
import type { Approach, Intent, IntentName, Mood, Needs, Option, Settings, WorldSnapshot } from "./types";
import type { Personality } from "./personality";

export interface BrainContext {
  rules: RulesContext;
  options: Option[];
  settings: Settings;
  personality: Personality;
  memory: string[];
  catWhere: string;
  catDoing: string;
}

export interface Brain {
  readonly name: string;
  /** Returns null when it has no answer. The caller then falls back to the rules. */
  decide(ctx: BrainContext): Promise<Intent | null>;
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
}

export interface LlmRequest {
  system: string;
  user: string;
  schema: IntentSchema;
  timeoutMs: number;
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
  if (typeof r.thought === "string" && r.thought.trim()) out.thought = r.thought;
  return out;
}

export class LlmBrain implements Brain {
  readonly name: string;
  calls = 0;
  failures = 0;
  invalid = 0;
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

/** Talks to a local Ollama server. Needs no key. Not used by the tests (no model is installed here). */
export class OllamaClient implements LlmClient {
  readonly name = "ollama";
  constructor(
    private baseUrl: string,
    private model: string,
  ) {}

  async generate(req: LlmRequest): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: req.schema,
          keep_alive: "5m",
          options: { temperature: 0.8, num_predict: 120, num_ctx: 2048 },
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
    const summary = JSON.parse(req.user) as { options: string[]; cat: { mood: Mood }; windows: { id: string; focused?: boolean }[] };
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
