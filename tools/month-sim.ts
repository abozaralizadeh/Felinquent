/**
 * A month in the life, fast: the real mind (rules brain, needs, bouts, habits) with a stand-in for
 * the body that just takes as long as each action says, and a made-up human who likes some things
 * and hates others. It answers: does the animal keep doing different things day after day, does it
 * fall into ruts, and does it learn what this human likes?
 *
 * Used by `npm run month` and by tests/freshness.test.ts.
 */
import { Cat } from "../src/core/cat";
import { InMemoryMemory, type Memory } from "../src/core/memory";
import type { Personality } from "../src/core/personality";
import { seeded } from "../src/core/rng";
import type { ChaosLevel, WorldSnapshot } from "../src/core/types";
import { makeWorld } from "../src/core/world";

export interface Human {
  /** Gets a pet now and then while it does these. */
  likes: readonly string[];
  /** Gets shooed while it does these. */
  hates: readonly string[];
  /** Tricks with these poses in them count as liked or hated. */
  likesPoses: readonly string[];
  hatesPoses: readonly string[];
  /** Chance to react to one liked or hated action (the human isn't always looking). */
  notice: number;
}

export const DEFAULT_HUMAN: Human = {
  likes: ["knead", "slow_blink", "headbutt", "roll", "chase_tail", "bounce"],
  hates: ["keyboard_walk", "sit_on", "knock_off", "meow", "howl", "block_dock"],
  likesPoses: ["headbutt", "knead", "chase_tail", "love", "belly"],
  hatesPoses: ["hiss", "swat", "turn_away"],
  notice: 0.6,
};

export interface DayStats {
  day: number;
  picks: number;
  /** Different actions chosen that day. */
  distinct: number;
  /** The same action twice in a row, as a share of picks. */
  repeats: number;
  /** Share of picks that it hadn't done in the three days before (each trick counts on its own). */
  surprise: number;
  /** Share of the day's picks taken by its most common action (the nap excluded). */
  topShare: number;
  liked: number;
  hated: number;
  /** Picks that were one of its own tricks. */
  tricks: number;
}

export interface SimResult {
  days: DayStats[];
  /** How often each action was picked over the whole run. */
  counts: Map<string, number>;
  cat: Cat;
}

/** The same memory, with learning what you like switched off (it still makes up tricks): for comparing. */
class NoLearning implements Memory {
  private inner = new InMemoryMemory();
  tricks = this.inner.tricks;
  log = this.inner.log.bind(this.inner);
  events = this.inner.events.bind(this.inner);
  recentLines = this.inner.recentLines.bind(this.inner);
  forgetAll = this.inner.forgetAll.bind(this.inner);
  exportJson = this.inner.exportJson.bind(this.inner);
}

export interface SimOptions {
  days: number;
  seed?: number;
  chaos?: ChaosLevel;
  personality?: Personality;
  human?: Human;
  /** Seconds per tick. 2 is plenty for decisions. */
  step?: number;
  learning?: boolean;
}

const T0 = Date.UTC(2026, 10, 2, 0, 0, 0);
const NAPS = new Set(["nap", "nap_warm", "cozy"]);

export async function simulate(o: SimOptions): Promise<SimResult> {
  const human = o.human ?? DEFAULT_HUMAN;
  const step = o.step ?? 2;
  const rng = seeded(o.seed ?? 21);
  const humanRng = seeded((o.seed ?? 21) * 31 + 7);
  const memory = o.learning === false ? new NoLearning() : new InMemoryMemory();
  const cat = new Cat({ rng, personality: o.personality, settings: { chaos: o.chaos ?? "normal" }, memory });
  const base = makeWorld({ nowMs: T0 });
  cat.place(base, 600);
  const days: DayStats[] = [];
  const counts = new Map<string, number>();
  const byDay: string[][] = [];
  let doneAt = Infinity;
  let running: string | null = null;
  let reacted = false;
  const trickTaste = new Map<string, string>();
  const likes = (k: string): boolean => human.likes.includes(k) || trickTaste.get(k) === "likes";
  const hates = (k: string): boolean => human.hates.includes(k) || trickTaste.get(k) === "hates";
  const total = Math.round((o.days * 86_400) / step);
  for (let i = 0; i < total; i++) {
    const now = T0 + i * step * 1000;
    const hour = new Date(now).getUTCHours();
    const day = Math.floor((now - T0) / 86_400_000);
    // At the desk from 9 to 18, around in the evening, away at night.
    const atDesk = hour >= 9 && hour < 18;
    const evening = hour >= 18 && hour < 23;
    const world: WorldSnapshot = {
      ...base,
      nowMs: now,
      hour,
      activity: atDesk ? "typing" : evening ? "idle" : "away",
      idleSec: atDesk ? 2 : evening ? 40 : 3600,
    };
    const res = await cat.mind.tick(world, step, false, false);
    for (const e of res) {
      if (e.type === "wake") ((running = null), (doneAt = Infinity));
      if (e.type !== "intent") continue;
      running = e.intent.trick ? `trick:${e.intent.trick}` : e.intent.intent;
      if (e.intent.trick) {
        // What the human makes of a trick: the poses in it.
        const poses = (e.intent.script ?? []).map((b) => ("do" in b ? (b.do as string) : ""));
        trickTaste.set(running, poses.some((p) => human.hatesPoses.includes(p)) ? "hates" : poses.some((p) => human.likesPoses.includes(p)) ? "likes" : "");
      }
      reacted = false;
      doneAt = cat.mind.sleeping ? Infinity : now + 4000 + Math.min(600, e.intent.stay_sec) * 1000;
      if (e.source === "rules" || e.source === "llm") {
        (byDay[day] ??= []).push(running);
        const k = e.intent.trick ? "trick" : e.intent.intent;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    // The human notices once per action, if they're there.
    if (running && !reacted && (atDesk || evening)) {
      reacted = true;
      if (likes(running) && humanRng.next() < human.notice) cat.react("pet", world);
      else if (hates(running) && humanRng.next() < human.notice) cat.react("shoo", world);
    }
    if (now >= doneAt) {
      doneAt = Infinity;
      running = null;
      cat.mind.notifyDone();
    }
  }
  for (let d = 0; d < o.days; d++) {
    const picks = byDay[d] ?? [];
    const before = new Set(byDay.slice(Math.max(0, d - 3), d).flat());
    const c = new Map<string, number>();
    for (const p of picks) if (!NAPS.has(p)) c.set(p, (c.get(p) ?? 0) + 1);
    const awake = picks.filter((p) => !NAPS.has(p)).length || 1;
    let rep = 0;
    for (let k = 1; k < picks.length; k++) if (picks[k] === picks[k - 1]) rep++;
    days.push({
      day: d + 1,
      picks: picks.length,
      distinct: new Set(picks).size,
      repeats: picks.length ? rep / picks.length : 0,
      surprise: d === 0 || !picks.length ? 0 : picks.filter((p) => !before.has(p)).length / picks.length,
      topShare: Math.max(0, ...c.values()) / awake,
      liked: picks.length ? picks.filter(likes).length / picks.length : 0,
      hated: picks.length ? picks.filter(hates).length / picks.length : 0,
      tricks: picks.filter((p) => p.startsWith("trick:")).length,
    });
  }
  return { days, counts, cat };
}

/** Averages of a stretch of days. */
export function mean(days: DayStats[], key: keyof DayStats): number {
  return days.length ? days.reduce((s, d) => s + (d[key] as number), 0) / days.length : 0;
}
