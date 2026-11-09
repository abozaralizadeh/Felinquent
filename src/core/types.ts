import type { Anim, Beat } from "./executor";

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

/**
 * One thing the animal can see on the screen besides itself, its toy and the windows: a mug, a
 * treat, pieces of something broken, a puddle it left, a crack, the fly (mess.ts Mess.seen). Only
 * drawings on its own layer, never anything read from your screen. Turned into words for the model
 * in summary.ts screenView.
 */
export interface SeenThing {
  /** In words: "mug", "biscuit", "pieces of a broken mug", "my puddle", "a crack". */
  what: string;
  state: "standing" | "teetering" | "sliding" | "flying" | "rolling" | "lying" | "in_hand" | "in_mouth" | "mark" | "buzzing";
  /** Bottom centre, screen coordinates. */
  x: number;
  y: number;
  windowId: string | null;
  /** Your human picked it up, put it there or threw it. */
  byHuman?: boolean;
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
  /**
   * The desktop (a Space on the Mac) the main display shows: an id, and its place in the row of
   * desktops (0 is the leftmost). spans: one desktop covers every display (no separate Spaces).
   * app: an app in full screen, not a desktop. hidden: the animal's window can't be shown there
   * (on a Mac set up to keep the overlay on every desktop at once). Unknown on systems without them.
   */
  space?: { id: string; index: number; spans: boolean; app?: boolean; hidden?: boolean };
  /**
   * When each display has its own row of desktops (the Mac's default): the desktop each display
   * shows, with that display's rect. The animal goes by the one its own display shows, so a switch
   * on a second display (to a full-screen app there, say) leaves it behind too. Empty or missing
   * when one row of desktops covers every display (Windows, or a Mac set up that way).
   */
  spaces?: DisplaySpace[];
}

/** One display's own desktop, with the display's rect (see WorldSnapshot.spaces). */
export interface DisplaySpace extends Rect {
  id: string;
  index: number;
  app?: boolean;
  hidden?: boolean;
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
  /** Eating the treat you dropped (a response to you, never picked by the brain). */
  | "eat"
  | "knock_off"
  | "claw"
  | "hunt"
  | "play_cursor"
  /** One of its own made-up tricks (tricks.ts). Which one is in Intent.trick. */
  | "trick"
  /** Its toy (mess.ts): bring it back to you, take it off somewhere, bury it, give it a sniff and a nudge. */
  | "fetch"
  | "carry_toy"
  | "stash_toy"
  | "nose_toy"
  /** Run at the cursor and keep after it while it moves (mostly a gremlin). */
  | "chase_cursor"
  /** A play bow at you: "chase me". */
  | "invite_play"
  | "yawn"
  | "look_around"
  /** It has to go, now and then (ADR-048): a puddle or a little pile, on a window top or the Dock. */
  | "pee"
  | "poop"
  | "leave";

export interface Intent {
  intent: IntentName;
  /** "here", "cursor", "dock", "corner", "toy" or a window id. */
  target: string;
  approach: Approach;
  stay_sec: number;
  mood: Mood;
  thought?: string;
  /** A scripted scene (a reaction to a click). Without it the executor builds the moves from the intent. */
  script?: Beat[];
  /** A pose held before the moves, facing you (licking its lips after a treat). */
  opener?: { anim: Anim; sec: number };
  /** For "trick": which of its tricks (an id from tricks.ts). */
  trick?: string;
  /** "follow" the cursor because you hold a treat: it begs under it instead of just tagging along. */
  treat?: boolean;
}

export interface Option {
  intent: IntentName;
  /** Valid targets for this intent right now. The first one is the default. */
  targets: string[];
  score: number;
  /** For "trick": which trick, and the bout it belongs to. */
  trick?: string;
  kind?: "rest" | "explore" | "play" | "social" | "mischief";
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
