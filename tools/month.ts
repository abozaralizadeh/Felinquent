/**
 * A simulated month with a made-up human, with learning on and off, and how varied the days are.
 *
 * Usage: npm run month -- [days=30] [chaos=normal] [--seed N] [--days-detail]
 */
import { mean, simulate, DEFAULT_HUMAN, type DayStats } from "./month-sim";
import type { ChaosLevel } from "../src/core/types";

const args = process.argv.slice(2);
const seedAt = args.indexOf("--seed");
const SEED = seedAt >= 0 ? Number(args[seedAt + 1]) : 21;
const [daysArg, chaosArg] = args.filter((a, i) => !a.startsWith("--") && (seedAt < 0 || i !== seedAt + 1));
const DAYS = Number(daysArg ?? "30");
const CHAOS = (chaosArg ?? "normal") as ChaosLevel;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

function summary(label: string, days: DayStats[]): Record<string, string | number> {
  const first = days.slice(0, 3);
  const last = days.slice(-3);
  return {
    run: label,
    "picks/day": Math.round(mean(days, "picks")),
    "different/day": Math.round(mean(days, "distinct") * 10) / 10,
    "twice in a row": pct(mean(days, "repeats")),
    "new vs 3 days": pct(mean(days.slice(1), "surprise")),
    "top action": pct(mean(days, "topShare")),
    "tricks/day": Math.round(mean(days, "tricks")),
    "liked, first 3 days": pct(mean(first, "liked")),
    "liked, last 3 days": pct(mean(last, "liked")),
    "hated, first 3 days": pct(mean(first, "hated")),
    "hated, last 3 days": pct(mean(last, "hated")),
  };
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`A ${DAYS}-day month at ${CHAOS}, seed ${SEED}. The human likes ${DEFAULT_HUMAN.likes.join(", ")} and hates ${DEFAULT_HUMAN.hates.join(", ")}.`);
  const on = await simulate({ days: DAYS, seed: SEED, chaos: CHAOS });
  const off = await simulate({ days: DAYS, seed: SEED, chaos: CHAOS, learning: false });
  console.table([summary("learning on", on.days), summary("learning off", off.days)]);
  if (args.includes("--days-detail")) console.table(on.days.map((d) => ({ ...d, repeats: pct(d.repeats), surprise: pct(d.surprise), topShare: pct(d.topShare), liked: pct(d.liked), hated: pct(d.hated) })));
  const top = [...on.counts].sort((a, b) => b[1] - a[1]);
  console.log(`most picked: ${top.slice(0, 8).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`least picked: ${top.slice(-6).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

void main();
