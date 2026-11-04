import { LlmBrain, type LlmClient } from "../src/core/brain";
import { Cat, type CatOptions } from "../src/core/cat";
import { behavior } from "../src/core/behaviors";
import type { MindEvent } from "../src/core/mind";
import { seeded } from "../src/core/rng";
import type { Intent, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0, at } from "./helpers";

export interface SimLog {
  intents: { atMs: number; intent: Intent; source: string }[];
  blocks: { start: number; end: number | null; windowId: string }[];
  events: MindEvent[];
  asleepSec: number;
  totalSec: number;
  cat: Cat;
}

export interface SimOptions extends CatOptions {
  hours: number;
  seed?: number;
  /** Change the world each second (meetings, activity, ...). */
  world?: (nowMs: number, base: WorldSnapshot) => Partial<WorldSnapshot>;
  llm?: LlmClient;
  onTick?: (cat: Cat, nowMs: number) => void;
}

/** Runs the whole cat for simulated hours at one tick per second. */
export async function simulate(o: SimOptions): Promise<SimLog> {
  const brain = o.llm ? new LlmBrain(o.llm, 50) : undefined;
  const cat = new Cat({ rng: seeded(o.seed ?? 11), settings: o.llm ? { brain: "llm", ...o.settings } : o.settings, brain, ...o });
  const base = makeWorld({ nowMs: T0 });
  cat.place(base, 300);
  const log: SimLog = { intents: [], blocks: [], events: [], asleepSec: 0, totalSec: 0, cat };
  const open = new Map<string, number>();
  for (let s = 0; s < o.hours * 3600; s++) {
    const now = T0 + s * 1000;
    const world = at(base, now, o.world?.(now, base) ?? {});
    o.onTick?.(cat, now);
    const res = await cat.step(world, 1);
    for (const ev of res.mind) {
      log.events.push(ev);
      if (ev.type === "intent") log.intents.push({ atMs: now, intent: ev.intent, source: ev.source });
    }
    // block start/end come from executor events through the intent flow; read the executor state instead
    const blocking = cat.executor.blocking;
    const key = "b";
    if (blocking && !open.has(key)) {
      open.set(key, now);
      log.blocks.push({ start: now, end: null, windowId: cat.executor.windowId ?? "dock" });
    } else if (!blocking && open.has(key)) {
      open.delete(key);
      const b = log.blocks[log.blocks.length - 1]!;
      b.end = now;
    }
    log.totalSec += 1;
    if (cat.mind.sleeping) log.asleepSec += 1;
  }
  return log;
}

/** Sum of annoyance points of intents started in any 60-minute window. */
export function worstHour(log: SimLog): number {
  const pts = log.intents.filter((i) => i.source === "rules" || i.source === "llm").map((i) => ({ t: i.atMs, p: behavior(i.intent.intent).annoy }));
  let worst = 0;
  for (const a of pts) {
    const sum = pts.filter((b) => b.t >= a.t && b.t < a.t + 3_600_000).reduce((s, b) => s + b.p, 0);
    worst = Math.max(worst, sum);
  }
  return worst;
}
