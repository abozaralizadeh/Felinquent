import type { Mood, Needs } from "./types";
import type { Personality } from "./personality";

export type NeedsEvent = "pet" | "overpet" | "annoy" | "shoo" | "treat" | "throw" | "play" | "panic" | "gentle_drop";

export interface NeedsEnv {
  sleeping: boolean;
  moving: boolean;
  newWindows: number;
  personality: Personality;
  sinceShooSec: number;
  sincePetSec: number;
  /** Multipliers on tiring and recovering (the animal and the chaos level set them). Default 1. */
  drainMul?: number;
  restoreMul?: number;
  /** Seconds left that it stays put out after being poked too much. */
  annoyedLeftSec?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampTrust = (v: number) => Math.max(0, Math.min(100, v));

export function initialNeeds(): Needs {
  return { energy: 0.8, attention: 0.2, curiosity: 0.3, trust: 30, mood: "content" };
}

/** Real cats sleep 12 to 16 hours a day. These rates aim for about 75% asleep for a cat on chill. */
const DRAIN_PER_SEC = 1 / 5400;
const RESTORE_PER_SEC = 1 / 12600;

export function stepNeeds(n: Needs, dtSec: number, env: NeedsEnv): Needs {
  let energy = n.energy;
  let attention = n.attention;
  let curiosity = n.curiosity;
  if (env.sleeping) {
    energy = clamp01(energy + dtSec * RESTORE_PER_SEC * (env.restoreMul ?? 1));
  } else {
    const drain = DRAIN_PER_SEC * (0.7 + 0.6 * env.personality.laziness) * (env.moving ? 2 : 1) * (env.drainMul ?? 1);
    energy = clamp01(energy - dtSec * drain);
    attention = clamp01(attention + (dtSec * (0.3 + 0.9 * env.personality.neediness)) / 2700);
    curiosity = clamp01(curiosity - dtSec / 900 + env.newWindows * 0.3);
    if (curiosity < 0.2) curiosity = Math.min(0.2, curiosity + dtSec / 900);
  }
  if (env.sleeping && env.newWindows > 0) curiosity = clamp01(curiosity + env.newWindows * 0.1);
  const next = { ...n, energy, attention, curiosity };
  return { ...next, mood: deriveMood(next, env) };
}

export function applyEvent(n: Needs, ev: NeedsEvent): Needs {
  const out = { ...n };
  switch (ev) {
    case "pet":
      out.attention = clamp01(n.attention - 0.5);
      out.trust = clampTrust(n.trust + 1.5);
      break;
    case "overpet":
      out.attention = clamp01(n.attention - 0.2);
      out.trust = clampTrust(n.trust - 0.5);
      break;
    case "annoy":
      out.trust = clampTrust(n.trust - 1.5);
      out.attention = clamp01(n.attention - 0.1);
      break;
    case "shoo":
      out.trust = clampTrust(n.trust - 3);
      out.attention = clamp01(n.attention + 0.1);
      break;
    case "treat":
      out.attention = clamp01(n.attention - 0.4);
      out.trust = clampTrust(n.trust + 4);
      break;
    case "throw":
      out.trust = clampTrust(n.trust - 2);
      out.curiosity = clamp01(n.curiosity + 0.1);
      break;
    case "play":
      out.attention = clamp01(n.attention - 0.3);
      out.trust = clampTrust(n.trust + 1);
      out.energy = clamp01(n.energy - 0.05);
      break;
    case "panic":
      out.trust = clampTrust(n.trust - 0.5);
      break;
    case "gentle_drop":
      out.trust = clampTrust(n.trust + 0.2);
      break;
  }
  return out;
}

export function deriveMood(n: Needs, env: Pick<NeedsEnv, "sinceShooSec" | "sincePetSec" | "annoyedLeftSec">): Mood {
  if (env.sinceShooSec < 8 * 60) return "sulky";
  if ((env.annoyedLeftSec ?? 0) > 0) return "sulky";
  if (n.energy < 0.25) return "sleepy";
  if (n.attention > 0.8) return "grumpy";
  if (n.trust > 70 && n.attention > 0.5) return "smug";
  if (env.sincePetSec < 10 * 60 && n.trust > 50) return "content";
  if (n.energy > 0.7 && n.curiosity > 0.5) return "playful";
  if (n.curiosity > 0.5) return "curious";
  return "content";
}
