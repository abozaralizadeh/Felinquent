import type { ChaosLevel, IntentName } from "./types";

export type Category = "ambient" | "attention" | "mischief" | "response" | "system";
export type Permission = "none" | "screen_recording" | "accessibility";

export interface BehaviorDef {
  /** ID from docs/behavior-catalog.md. */
  id: string;
  intent: IntentName;
  /** Annoyance level 0 to 3. It is also the cost in annoyance points. */
  annoy: 0 | 1 | 2 | 3;
  category: Category;
  /** Lowest chaos level that allows it. */
  minChaos: ChaosLevel;
  perm: Permission;
  /** Longest stay in seconds. "block" means the chaos level decides. */
  maxStay: number | "block";
  /** Shortest stay in seconds. */
  minStay?: number;
  /** True when the cat covers part of a window and blocks clicks under its body. */
  blocks?: boolean;
  /** A short routine of several moves that the cat picks as one choice (stalk, tour, cozy). */
  combo?: boolean;
}

export const BEHAVIORS: readonly BehaviorDef[] = [
  { id: "B-01", intent: "nap", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 1800 },
  { id: "B-06", intent: "nap_warm", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 1800 },
  { id: "B-02", intent: "wander", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 120 },
  { id: "B-02p", intent: "perch", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 300 },
  { id: "B-03", intent: "groom", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "B-04", intent: "watch", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "B-05", intent: "stretch", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "B-07", intent: "stare", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 30 },
  { id: "B-08", intent: "slow_blink", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "B-10", intent: "follow", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 60, minStay: 12 },
  { id: "B-11", intent: "cross", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "B-14", intent: "headbutt", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 30 },
  { id: "B-15", intent: "meow", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 30 },
  { id: "B-12", intent: "sit_on", annoy: 2, category: "attention", minChaos: "normal", perm: "none", maxStay: "block", blocks: true },
  { id: "B-18", intent: "sit_on_video", annoy: 2, category: "attention", minChaos: "normal", perm: "screen_recording", maxStay: "block", blocks: true },
  { id: "B-24", intent: "block_dock", annoy: 2, category: "attention", minChaos: "normal", perm: "none", maxStay: "block", blocks: true },
  { id: "B-17", intent: "keyboard_walk", annoy: 2, category: "attention", minChaos: "normal", perm: "none", maxStay: 10 },
  { id: "B-20", intent: "swat", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 30 },
  { id: "B-21", intent: "box", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 120 },
  { id: "B-22g", intent: "gift", annoy: 2, category: "mischief", minChaos: "normal", perm: "none", maxStay: 600 },
  { id: "B-22h", intent: "hairball", annoy: 2, category: "mischief", minChaos: "normal", perm: "none", maxStay: 600 },
  { id: "B-23", intent: "zoomies", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 20 },
  { id: "B-26", intent: "knock_toy", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 30 },
  { id: "B-27", intent: "peek", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 30 },
  { id: "B-28", intent: "chase_tail", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20 },
  { id: "B-29", intent: "knead", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 30 },
  { id: "B-30", intent: "chatter", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 15 },
  { id: "B-31", intent: "sneeze", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 10 },
  { id: "B-32", intent: "roll", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-33", intent: "bounce", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-34", intent: "sniff", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 40, combo: true },
  { id: "B-35", intent: "dig", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-36", intent: "howl", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-37", intent: "scratch", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-38", intent: "beg", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 30, combo: true },
  { id: "B-39", intent: "spook", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-40", intent: "sprawl", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 120 },
  { id: "B-41", intent: "tumble", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-42", intent: "shy", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-43", intent: "knock_off", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 45, minStay: 12, combo: true },
  { id: "B-44", intent: "claw", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 20, minStay: 6, combo: true },
  { id: "B-45", intent: "hunt", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 40, minStay: 10, combo: true },
  { id: "B-49", intent: "trick", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 60, minStay: 3, combo: true },
  { id: "B-50", intent: "fetch", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60, minStay: 8, combo: true },
  { id: "B-51", intent: "carry_toy", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 60, minStay: 8, combo: true },
  { id: "B-52", intent: "stash_toy", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 40, minStay: 6, combo: true },
  { id: "B-53", intent: "nose_toy", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 30, minStay: 5, combo: true },
  { id: "B-54", intent: "chase_cursor", annoy: 1, category: "attention", minChaos: "normal", perm: "none", maxStay: 30, minStay: 8, combo: true },
  { id: "B-55", intent: "invite_play", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-56", intent: "yawn", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 10, combo: true },
  { id: "B-57", intent: "look_around", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 20, combo: true },
  { id: "B-48", intent: "play_cursor", annoy: 1, category: "attention", minChaos: "chill", perm: "none", maxStay: 40, minStay: 10, combo: true },
  { id: "RF-10", intent: "react", annoy: 0, category: "response", minChaos: "chill", perm: "none", maxStay: 60, minStay: 3 },
  { id: "C-01", intent: "stalk", annoy: 1, category: "mischief", minChaos: "normal", perm: "none", maxStay: 20, combo: true },
  { id: "C-02", intent: "tour", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 120, combo: true },
  { id: "C-03", intent: "cozy", annoy: 0, category: "ambient", minChaos: "chill", perm: "none", maxStay: 900, combo: true },
  { id: "B-25", intent: "nudge_window", annoy: 3, category: "mischief", minChaos: "gremlin", perm: "accessibility", maxStay: 10 },
  { id: "B-16", intent: "ignore", annoy: 0, category: "response", minChaos: "chill", perm: "none", maxStay: 60 },
  { id: "RF-03", intent: "sulk", annoy: 0, category: "response", minChaos: "chill", perm: "none", maxStay: 480, minStay: 180 },
  { id: "RM", intent: "leave", annoy: 0, category: "system", minChaos: "chill", perm: "none", maxStay: 3600 },
];

export const BY_INTENT: ReadonlyMap<IntentName, BehaviorDef> = new Map(BEHAVIORS.map((b) => [b.intent, b]));

export const INTENT_NAMES: readonly IntentName[] = BEHAVIORS.map((b) => b.intent);

export const CHAOS_ORDER: Record<ChaosLevel, number> = { chill: 0, normal: 1, gremlin: 2 };

export const CHAOS_PARAMS: Record<ChaosLevel, { pointsPerHour: number; maxBlockSec: number }> = {
  chill: { pointsPerHour: 3, maxBlockSec: 30 },
  normal: { pointsPerHour: 10, maxBlockSec: 90 },
  gremlin: { pointsPerHour: 25, maxBlockSec: 180 },
};

export function behavior(intent: IntentName): BehaviorDef {
  const b = BY_INTENT.get(intent);
  if (!b) throw new Error(`unknown intent ${intent}`);
  return b;
}
