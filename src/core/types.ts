import type { Beat } from "./executor";

export type Mood = "content" | "curious" | "playful" | "sleepy" | "grumpy" | "sulky" | "smug";
export type ChaosLevel = "chill" | "normal" | "gremlin";
export type Activity = "typing_fast" | "typing" | "reading" | "idle" | "away";
export type CpuLevel = "low" | "mid" | "high";
export type Approach = "walk" | "saunter" | "sneak" | "run";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowInfo {
  id: string;
  app: string;
  /** Only filled when smart targeting is on. */
  title?: string;
  bounds: Rect;
  focused: boolean;
  cpu: CpuLevel;
  /** 0 is the frontmost window. */
  z: number;
  isNew?: boolean;
  isEmpty?: boolean;
}

/** One reading of everything the cat can sense. No screenshots, no key contents. */
export interface WorldSnapshot {
  nowMs: number;
  /** Local hour 0 to 23. */
  hour: number;
  screen: Rect;
  /** Other displays, in the same coordinates as `screen` (the main display). Each has a floor at its bottom edge and no Dock. */
  displays?: Rect[];
  /** y of the top of the Dock (or taskbar) on the main display. */
  dockTop: number;
  windows: WindowInfo[];
  frontApp: string;
  activity: Activity;
  idleSec: number;
  cursor: { x: number; y: number };
  cursorSpeed: number;
  appSwitchedSecAgo: number;
  minutesSincePet: number;
  inMeeting: boolean;
  screenSharing: boolean;
  fullscreen: boolean;
  batteryLow: boolean;
  panic: boolean;
  quietHours: boolean;
  /** The cat is away until this time (Shoo for 1 hour). */
  shooedUntilMs: number;
}

export interface Needs {
  energy: number;
  attention: number;
  curiosity: number;
  /** 0 to 100. */
  trust: number;
  mood: Mood;
}

export type IntentName =
  | "nap"
  | "nap_warm"
  | "wander"
  | "perch"
  | "groom"
  | "watch"
  | "stretch"
  | "stare"
  | "slow_blink"
  | "follow"
  | "cross"
  | "headbutt"
  | "meow"
  | "swat"
  | "knock_toy"
  | "zoomies"
  | "ignore"
  | "sulk"
  | "box"
  | "sit_on"
  | "sit_on_video"
  | "block_dock"
  | "keyboard_walk"
  | "gift"
  | "hairball"
  | "nudge_window"
  | "peek"
  | "chase_tail"
  | "knead"
  | "chatter"
  | "sneeze"
  | "stalk"
  | "tour"
  | "cozy"
  | "roll"
  | "bounce"
  | "sniff"
  | "dig"
  | "howl"
  | "scratch"
  | "beg"
  | "spook"
  | "sprawl"
  | "tumble"
  | "shy"
  | "react"
  | "knock_off"
  | "claw"
  | "hunt"
  | "leave";

export interface Intent {
  intent: IntentName;
  /** "here", "cursor", "dock", "corner" or a window id. */
  target: string;
  approach: Approach;
  stay_sec: number;
  mood: Mood;
  thought?: string;
  /** A scripted scene (a reaction to a click). Without it the executor builds the moves from the intent. */
  script?: Beat[];
}

export interface Option {
  intent: IntentName;
  /** Valid targets for this intent right now. The first one is the default. */
  targets: string[];
  score: number;
}

export interface Settings {
  chaos: ChaosLevel;
  /** Needs the Screen Recording permission on macOS. Off by default. */
  smartTargeting: boolean;
  /** Needs the Accessibility permission on macOS. Off by default. */
  accessibility: boolean;
  thoughtBubbles: boolean;
  sounds: boolean;
  brain: "rules" | "llm";
  llmUrl: string;
  llmModel: string;
  size: "S" | "M" | "L";
}

export const DEFAULT_SETTINGS: Settings = {
  chaos: "normal",
  smartTargeting: false,
  accessibility: false,
  thoughtBubbles: true,
  sounds: false,
  brain: "rules",
  llmUrl: "http://localhost:11434",
  llmModel: "gemma3:1b",
  size: "M",
};
