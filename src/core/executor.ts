import { behavior } from "./behaviors";
import { BRACE_JERK, BRACE_SPEED, GRIP, type WinMotion } from "./motion";
import { planRoute, type JumpLimits, type PathStep } from "./pathfinding";
import { buildPlatforms, segmentsOf, type Platform } from "./platforms";
import type { Rng } from "./rng";
import { SCRATCH_SEC, sceneFor } from "./scenes";
import { INSTINCTS, type Instinct } from "./species";
import type { Approach, Intent, IntentName, Rect, WorldSnapshot } from "./types";

export type Anim =
  | "idle_sit" | "loaf" | "sleep" | "walk" | "run" | "jump" | "fall" | "land" | "perch" | "groom"
  | "stretch" | "look" | "meow" | "purr" | "swat" | "pounce" | "headbutt" | "sulk" | "dangle"
  | "turn_away" | "stare" | "blink" | "keyboard" | "hairball" | "box" | "push_toy" | "gift"
  | "peek" | "chase_tail" | "knead" | "chatter" | "sneeze" | "happy"
  | "angry" | "hiss" | "puffed" | "annoyed" | "flustered" | "play_bow" | "leap" | "belly" | "bark"
  | "shy" | "beg" | "dig" | "sniff" | "tumble" | "sprawl" | "howl" | "giggle" | "startled"
  | "proud" | "curious" | "love" | "yawn" | "surprise" | "dazed" | "scratch" | "bounce" | "hang"
  // Watching something (the cursor): sitting or standing still, only the head turns to follow it.
  | "watch" | "watch_stand"
  // Licking its lips (after a treat, or just because), sitting.
  | "lick_lips";

/**
 * Something the animal does to the things around it (mess.ts): a paw on a mug, a nudge toward the
 * edge, claws in a title bar, a fly to chase. The executor only says when; the Cat makes it happen.
 */
export type Fx =
  | { fx: "tap"; prop: string }
  | { fx: "nudge"; prop: string; px: number }
  | { fx: "claw" }
  | { fx: "fly_in"; caught: boolean; dx: number; dy: number }
  | { fx: "pounce_fly" }
  /** The toy ball comes out (it rolls in from the side if it isn't around). */
  | { fx: "toy_out" }
  /** A swipe at the toy ball. */
  | { fx: "bat"; prop: string; strength: number }
  /** The toy picked up in the mouth, let go of, or buried where the animal is. */
  | { fx: "pick_up"; prop: string }
  | { fx: "drop_toy" }
  | { fx: "bury" };

/** What it does with its toy: bring it back to you, take it off somewhere, bury it, or give it a sniff and a nudge. */
export type ToyTask = "fetch" | "carry" | "stash" | "nose";

/** A thing standing on a window, as the executor sees it. */
export interface PropSpot {
  id: string;
  windowId: string;
  x: number;
}

/** The toy ball, as the executor sees it: where it is, on which window (null: the floor), and whether it is still rolling. */
export interface ToySpot {
  id: string;
  x: number;
  y: number;
  windowId: string | null;
  moving: boolean;
  /** In your hand: it can't be reached. In its own mouth: it has it. */
  held?: boolean;
  carried?: boolean;
}

/**
 * One beat of a scripted scene. A reaction to a click is a little scene (look, react, leave) and
 * not one pose, so it is a list of beats. Where a beat goes is worked out when it starts, from where
 * the cat and the cursor are then.
 */
export type Beat =
  | { do: Anim; sec: number; face?: "cursor" | "away" }
  | { go: "cursor" | "away" | "stroll"; by: number; speed: Approach; anim?: Anim }
  | { leap: "cursor" | "away" | "ahead" | "stroll"; by: number; h: number; anim?: Anim };

export interface CatBody {
  x: number;
  /** Feet. */
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  platformId: string | null;
  anim: Anim;
  hidden: boolean;
}

export type ExecEvent =
  | { type: "done"; intent: IntentName }
  | { type: "landed" }
  | { type: "block_start"; windowId: string }
  | { type: "block_end" }
  | { type: "hidden" }
  | { type: "unreachable"; intent: IntentName }
  | { type: "fx"; fx: Fx; x: number; y: number; dir: 1 | -1; windowId: string | null }
  /** Touched down: how fast it came down (px/s) and on which window, for a crack in a hard landing. */
  | { type: "impact"; x: number; y: number; speed: number; windowId: string | null }
  | { type: "hang"; windowId: string | null }
  | { type: "slipped" }
  /** Its window was jerked or yanked so hard that it came off. */
  | { type: "flung" }
  /** It rode out a rough move of its window. */
  | { type: "held_on" };

type Step =
  /** free: it may start off the edge of the screen (walking in from another desktop). */
  | { k: "walk"; x: number; speed: number; anim?: Anim; free?: boolean }
  | { k: "jump"; toId: string; takeoffX: number; landX: number }
  /** fxAt: the effect happens this many seconds in (the paw hits the ball mid-swipe), else at the start. */
  | { k: "do"; anim: Anim; sec: number; block?: boolean; face?: "cursor" | "away" | 1 | -1; fx?: Fx; fxAt?: number }
  | { k: "leap"; dx: number; h: number; anim: Anim; face?: 1 | -1; fx?: Fx }
  | { k: "beat"; beat: Beat }
  /** Playing with the toy ball: worked out when it comes up, from where the ball is then. */
  | { k: "toy"; bats: number; waited?: number }
  /** Following the cursor around, playing with it, or chasing it flat out, until the executor's clock reaches `until`. */
  | { k: "cursor"; mode: "follow" | "play" | "chase"; until: number }
  /** A job with the toy, worked out a stage at a time from where the toy, the animal and the cursor are then. */
  | { k: "toytask"; mode: ToyTask; stage: "get" | "bring" | "away" | "bury"; waited?: number; legs?: number; dest?: { id: string; x: number } }
  | { k: "hide" };

/**
 * Pixels a second at medium size. The gaits (tools/rig-gait.py) take about 27 px a cycle at a walk, so
 * a walk is about 2.4 steps cycles a second and a fast walker (a dog) breaks into a trot.
 */
const SPEED: Record<Approach, number> = { walk: 64, saunter: 42, sneak: 28, run: 230 };
/**
 * How long an animal takes to turn round on the spot, standing before it walks the other way (or
 * sitting, to face you). The sprites play their drawn turn over the same time (sprites.ts): head
 * round, three quarters, the front view, the other side. A real cat takes about half a second.
 */
export const TURN_SEC = 0.6;
/** Poses that can simply go on when an action is over. Anything else settles back to sitting. */
const CALM: ReadonlySet<Anim> = new Set<Anim>(["idle_sit", "loaf", "sleep", "perch", "box", "sulk", "turn_away", "sprawl", "peek"]);
/** Poses from which the animal looks up at the cursor when it comes close (the head follows it). Both watches keep following it and turn round when it goes behind. */
const GLANCE: ReadonlySet<Anim> = new Set<Anim>(["idle_sit", "look", "stare", "blink", "perch", "watch", "watch_stand"]);
/** How close the cursor comes before the animal notices it (px at medium size). */
const GLANCE_DIST = 260;

/**
 * One-off moves and how long one takes, in seconds, then the pose it settles into. An intent that
 * stays longer does the move once and sits (or lies) for the rest, instead of holding a stretch or a
 * swat for half a minute.
 */
const ONCE: Partial<Record<Anim, [number, Anim]>> = {
  stretch: [3.2, "idle_sit"], swat: [1.8, "idle_sit"], push_toy: [3, "idle_sit"], headbutt: [3, "idle_sit"],
  meow: [2.6, "idle_sit"], sneeze: [1.6, "idle_sit"], hairball: [3.5, "idle_sit"], chatter: [2.8, "idle_sit"],
  chase_tail: [5, "idle_sit"], knead: [12, "loaf"], yawn: [2.6, "idle_sit"], scratch: [SCRATCH_SEC, "idle_sit"],
  happy: [3, "idle_sit"], bark: [2.4, "idle_sit"], play_bow: [2.2, "idle_sit"], proud: [3, "idle_sit"],
  curious: [3, "idle_sit"], puffed: [2, "idle_sit"], giggle: [2.2, "idle_sit"], sniff: [3, "idle_sit"],
};

/** Walks shorter than this (px) are skipped: they would be a shuffle of a step or two. Runs shorter than MIN_RUN are walked. */
const MIN_WALK = 40;
const MIN_RUN = 160;
const GRAVITY = 2000;
const SIZE_SCALE = { S: 0.75, M: 1, L: 1.3 };
/** How often a big jump up falls short (chill, normal, gremlin). Cats misjudge one now and then. */
const MISS = [0.03, 0.08, 0.22] as const;

const DO_ANIM: Partial<Record<IntentName, Anim>> = {
  nap: "sleep", nap_warm: "sleep", wander: "idle_sit", perch: "perch", groom: "groom", watch: "watch",
  stretch: "stretch", stare: "stare", slow_blink: "blink", follow: "idle_sit", cross: "idle_sit", play_cursor: "pounce",
  headbutt: "headbutt", meow: "meow", swat: "swat", knock_toy: "push_toy", zoomies: "idle_sit",
  ignore: "turn_away", sulk: "sulk", box: "box", sit_on: "loaf", sit_on_video: "loaf", block_dock: "loaf",
  keyboard_walk: "keyboard", gift: "gift", hairball: "hairball", nudge_window: "swat", leave: "idle_sit",
  peek: "peek", chase_tail: "chase_tail", knead: "knead", chatter: "chatter", sneeze: "sneeze",
  stalk: "pounce", tour: "loaf", cozy: "sleep",
  roll: "belly", bounce: "bounce", sniff: "sniff", dig: "dig", howl: "howl", scratch: "scratch", beg: "beg",
  spook: "puffed", sprawl: "sprawl", tumble: "tumble", shy: "shy", react: "idle_sit",
  knock_off: "push_toy", claw: "scratch", hunt: "pounce",
  fetch: "watch_stand", carry_toy: "watch_stand", stash_toy: "watch_stand", nose_toy: "sniff", chase_cursor: "pounce",
  invite_play: "play_bow", yawn: "yawn", look_around: "look",
};

/**
 * Where the mouth is in each pose, as a share of the animal's box: forward from the middle (in the way
 * it faces) and up from the feet. A carried toy hangs there. Poses not listed use the standing one.
 */
const MOUTH: Partial<Record<Anim, [number, number]>> = {
  idle_sit: [0.2, 0.6], watch: [0.2, 0.6], look: [0.2, 0.62], beg: [0.18, 0.66], meow: [0.2, 0.6], proud: [0.2, 0.62],
  curious: [0.2, 0.6], happy: [0.2, 0.6], love: [0.2, 0.6], blink: [0.2, 0.6], stare: [0.2, 0.6], groom: [0.2, 0.6],
  sniff: [0.42, 0.16], dig: [0.4, 0.22], pounce: [0.4, 0.28], play_bow: [0.4, 0.3], push_toy: [0.38, 0.3],
  loaf: [0.34, 0.32], sleep: [0.3, 0.22], sprawl: [0.36, 0.2], sulk: [0.2, 0.55],
  jump: [0.38, 0.5], leap: [0.4, 0.45], fall: [0.36, 0.5], land: [0.4, 0.34], dangle: [0.2, 0.5],
};
const MOUTH_STAND: [number, number] = [0.38, 0.5];
/** The toy jobs that keep the toy in the mouth when they start. */
const CARRY_INTENTS: ReadonlySet<IntentName> = new Set<IntentName>(["fetch", "carry_toy", "stash_toy"]);

interface JumpState {
  t: number;
  T: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  peak: number;
  toId: string;
  /** The window it is jumping onto, so it still lands if the windows moved and the ledge got a new id. */
  toWin?: string;
  /** The pose in the air (a leap has its own) and which way the cat looks while it flies. */
  anim?: Anim;
  face?: 1 | -1;
  /** The highest point so far, for how hard it comes down. */
  minY: number;
  /** A real jump to another ledge (not a hop on the spot), which can fall short. */
  far?: boolean;
}

/** Hanging off a ledge after a jump that fell short: it scrabbles, then pulls itself up or drops. */
interface HangState {
  t: number;
  T: number;
  windowId: string | null;
  offset: number;
  climbs: boolean;
}

/** The fast brain: turns an intent into steps and moves the cat at 60 fps. Contains no decisions. */
export class Executor {
  body: CatBody;
  phase: "idle" | "moving" | "doing" = "idle";
  private instinct: Instinct = INSTINCTS.cat;
  /** Current walking speed in pixels a second, so it eases in and out. */
  private vel = 0;
  /** Seconds left standing to turn round, and seconds spent with nothing to do. */
  private turnSec = 0;
  private idleSec = 0;
  private sizeScale = 1;
  intent: Intent | null = null;
  platforms: Platform[] = [];
  readonly limits: JumpLimits;
  readonly size: { w: number; h: number };

  private world: WorldSnapshot | null = null;
  private mode: "ground" | "jump" | "fall" | "held" | "hang" = "ground";
  private queue: Step[] = [];
  private current: Step | null = null;
  private doTimer = 0;
  private jump: JumpState | null = null;
  private blockingWindow: string | null = null;
  private pending: Intent | null = null;
  private ridingWindow: string | null = null;
  private ridingOffset = 0;
  private outbox: ExecEvent[] = [];
  private unreachable = false;
  /**
   * Where the animal is going, fixed when the intent starts: on a window it is kept as an offset from
   * the window's left edge, so it follows the window when it moves instead of being picked again.
   */
  private goal: { id: string; windowId?: string; offset: number } | null = null;
  /** The route there is done and the action itself (the tail) has been planned and is under way. */
  private inTail = false;
  /**
   * Seconds left crouched after a landing. A cat absorbs a landing in a crouch for about a quarter
   * of a second; showing the crouch drawing for one frame and swapping back read as a flicker.
   */
  private landHold = 0;
  /** Things standing on windows, from the Cat (mess.ts). Without it there is nothing to knock off. */
  props: (() => PropSpot[]) | null = null;
  /**
   * How wild it is: 0 chill, 1 normal, 2 gremlin. A gremlin runs across several windows, lands hard
   * enough to crack one, and now and then falls short of a jump and hangs off the edge.
   */
  wild: 0 | 1 | 2 = 1;
  /** The thing it is going to push off, and which way. */
  private knock: { prop: string; dir: 1 | -1 } | null = null;
  private hanging: HangState | null = null;
  /** It let go of a ledge: on landing it shakes it off before anything else. */
  private slipped = false;
  /** The toy ball, from the Cat (mess.ts). */
  toyAt: (() => ToySpot | null) | null = null;
  /** The toy it has in its mouth (a prop id), or null. */
  carrying: string | null = null;
  /** Seconds since the executor started: deadlines for following the cursor. */
  private clock = 0;
  /** An effect due part way into the current step. */
  private fxLater: { fx: Fx; at: number } | null = null;
  /** Where the cursor was last frame, and for how long it has not moved. */
  private lastCursor = { x: NaN, y: NaN };
  private cursorStill = 99;
  /** Looking at the cursor: seconds left, and no new look before the cooldown ends. */
  private glance = 0;
  private glanceCool = 0;
  /** How likely it is to look when the cursor comes close (the Cat sets it from the personality). */
  glanceChance = 0.8;
  /** Holding on to a window that moves: seconds left crouched, whether the ride was rough, and its own speed while it slides. */
  private brace = 0;
  private braceRough = false;
  private slideU: number | null = null;
  /** Thrown off a window: on landing it shakes it off and gives you a look. */
  private flung = false;

  constructor(
    private rng: Rng,
    size: "S" | "M" | "L" = "M",
  ) {
    const s = SIZE_SCALE[size];
    this.sizeScale = s;
    this.size = { w: 110 * s, h: 90 * s };
    // Cartoon leaps: a Dock cat has to reach window tops near the top of the screen. Proposed value, tune in the alpha.
    this.limits = { maxUp: this.size.h * 9, maxGap: this.size.w * 4 };
    this.body = { x: 100, y: 0, vx: 0, vy: 0, facing: 1, platformId: null, anim: "idle_sit", hidden: false };
  }

  get airborne(): boolean {
    return this.mode === "jump" || this.mode === "fall" || this.mode === "hang";
  }
  get held(): boolean {
    return this.mode === "held";
  }
  /** Id of the window the cat is standing on, if any. */
  get windowId(): string | null {
    return this.ridingWindow;
  }
  get blocking(): boolean {
    return this.blockingWindow !== null;
  }

  /** Where its mouth is now (a carried toy hangs there). */
  mouth(): { x: number; y: number } {
    const b = this.body;
    const [fx, fy] = MOUTH[b.anim] ?? MOUTH_STAND;
    return { x: b.x + b.facing * this.size.w * fx, y: b.y - this.size.h * fy };
  }

  /** Lets go of the toy in its mouth, if it has one. */
  private letGoOfToy(): void {
    if (!this.carrying) return;
    this.carrying = null;
    this.emitFx({ fx: "drop_toy" });
  }

  hitRect(): Rect {
    return { x: this.body.x - this.size.w / 2, y: this.body.y - this.size.h, w: this.size.w, h: this.size.h };
  }

  /** The area where clicks are blocked, only while the cat sits on something. */
  blockingRect(): Rect | null {
    return this.blockingWindow !== null && this.phase === "doing" ? this.hitRect() : null;
  }

  /** Places the cat on the dock the first time. */
  placeOnDock(world: WorldSnapshot, x: number): void {
    this.setWorld(world);
    const dock = this.platforms.find((p) => p.id === "dock");
    if (dock) {
      this.body.x = Math.max(dock.x1, Math.min(dock.x2, x));
      this.body.y = dock.y;
      this.body.platformId = "dock";
    }
  }

  /**
   * Comes in from the desktop next door: from beyond the left (-1) or right (1) edge of the main
   * display, walking along the Dock, then a look round and a look at you.
   */
  enterFrom(side: 1 | -1): void {
    const dock = this.platforms.find((p) => p.id === "dock");
    if (!dock) return;
    this.interrupt();
    this.mode = "ground";
    this.jump = null;
    this.hanging = null;
    this.pending = null;
    this.landHold = 0;
    this.brace = 0;
    this.slideU = null;
    this.flung = false;
    this.slipped = false;
    const b = this.body;
    b.hidden = false;
    b.platformId = "dock";
    this.ridingWindow = null;
    b.vx = 0;
    b.vy = 0;
    b.y = dock.y;
    b.x = side < 0 ? dock.x1 - this.size.w * 0.6 : dock.x2 + this.size.w * 0.6;
    b.facing = (-side) as 1 | -1;
    b.anim = "walk";
    const into = side < 0 ? dock.x1 + this.rng.range(120, 280) : dock.x2 - this.rng.range(120, 280);
    this.queue = [
      { k: "walk", x: into, speed: SPEED.walk, free: true },
      { k: "do", anim: "look", sec: 1.2 },
      { k: "do", anim: "watch", sec: 1.6, face: "cursor" },
    ];
    this.phase = "moving";
  }

  /** Keeps the latest cursor, time and flags without rebuilding platforms. */
  observe(world: WorldSnapshot): void {
    this.world = world;
  }

  setWorld(world: WorldSnapshot): void {
    this.world = world;
    this.platforms = buildPlatforms(world);
    if (this.mode !== "ground") return;
    const b = this.body;
    if (b.platformId === null) {
      if (b.y === 0 && b.x === 100) return;
      this.beginFall();
      return;
    }
    const win = this.ridingWindow ? world.windows.find((w) => w.id === this.ridingWindow) : undefined;
    if (this.ridingWindow && !win) {
      this.beginFall();
      return;
    }
    if (win) {
      // The window it stands on moved: it rides along, and so do the spots it was about to walk to.
      const shift = win.bounds.x + this.ridingOffset - b.x;
      b.x += shift;
      if (shift !== 0 && this.inTail) this.shiftWalks(shift);
    }
    const here = this.platforms.find((p) => p.id === b.platformId);
    let seg: Platform | undefined = here && b.x >= here.x1 && b.x <= here.x2 ? here : undefined;
    if (!seg && win) {
      const segs = segmentsOf(this.platforms, win.id);
      seg = segs.find((p) => b.x >= p.x1 && b.x <= p.x2) ?? [...segs].sort((p, q) => Math.abs(p.x1 - b.x) - Math.abs(q.x1 - b.x))[0];
    }
    if (!seg) seg = here;
    if (!seg) {
      this.beginFall();
      return;
    }
    // Walking in from beyond the edge of the screen: not snapped onto the ledge.
    if (!(this.current?.k === "walk" && this.current.free)) b.x = Math.max(seg.x1, Math.min(seg.x2, b.x));
    b.y = seg.y;
    b.platformId = seg.id;
    // Still on the way: find a new way to the same spot. Already doing the thing: carry on.
    if (this.intent && !this.inTail) this.replan();
  }

  private shiftWalks(dx: number): void {
    const move = (s: Step | null): void => {
      if (s && s.k === "walk") s.x += dx;
    };
    move(this.current);
    this.queue.forEach(move);
  }

  private beginFall(): void {
    this.mode = "fall";
    this.body.platformId = null;
    this.ridingWindow = null;
    this.body.vy = 0;
    this.body.anim = "fall";
    this.closeBlock();
  }

  private closeBlock(): void {
    if (this.blockingWindow !== null) {
      this.blockingWindow = null;
      this.outbox.push({ type: "block_end" });
    }
  }

  private currentPlatform(): Platform | undefined {
    return this.platforms.find((p) => p.id === this.body.platformId) ?? this.platforms.find((p) => p.id === "dock");
  }

  private resolveGoal(intent: Intent): { id: string; x: number } {
    const w = this.world as WorldSnapshot;
    const cur = this.currentPlatform() as Platform;
    const dock = this.platforms.find((p) => p.id === "dock") as Platform;
    const t = intent.target;
    if (t === "here") return { id: cur.id, x: this.body.x };
    if (t === "dock") return { id: dock.id, x: dock.x1 + (dock.x2 - dock.x1) * this.rng.range(0.25, 0.75) };
    if (t === "corner") {
      const left = w.cursor.x > (dock.x1 + dock.x2) / 2;
      return { id: dock.id, x: left ? dock.x1 + 40 : dock.x2 - 40 };
    }
    if (t === "cursor") return this.spotUnder(w.cursor);
    const segs = segmentsOf(this.platforms, t);
    const seg = segs[0];
    if (!seg) return { id: cur.id, x: this.body.x };
    const mid = (seg.x1 + seg.x2) / 2;
    const jitter = (seg.x2 - seg.x1) * 0.15;
    if (intent.intent === "knock_off") {
      const spot = this.knockSpot(t);
      if (spot) return spot;
    }
    switch (intent.intent) {
      case "perch":
      case "peek": return { id: seg.id, x: this.rng.next() < 0.5 ? seg.x1 + 30 : seg.x2 - 30 };
      case "cross": return { id: seg.id, x: seg.x1 + 20 };
      default: return { id: seg.id, x: mid + this.rng.range(-jitter, jitter) };
    }
  }

  /** The ledge right under a point (or the nearest one a little below it), and where on it. */
  private spotUnder(pt: { x: number; y: number }): { id: string; x: number } {
    let best = this.platforms.find((p) => p.id === "dock") as Platform;
    let bestD = Infinity;
    for (const p of this.platforms) {
      const dx = pt.x < p.x1 ? p.x1 - pt.x : pt.x > p.x2 ? pt.x - p.x2 : 0;
      const below = p.y >= pt.y - 20 ? 0 : 400;
      const d = dx + Math.abs(p.y - pt.y) * 0.5 + below;
      if (d < bestD) ((bestD = d), (best = p));
    }
    return { id: best.id, x: Math.max(best.x1 + 2, Math.min(best.x2 - 2, pt.x)) };
  }

  /** How far from the thing the animal stands to reach it with a paw. */
  private get reach(): number {
    return this.size.w * 0.42;
  }

  /**
   * Where to stand to push a thing off this window: beside it, on the side away from the nearer
   * edge, so the push goes the short way.
   */
  private knockSpot(windowId: string): { id: string; x: number } | null {
    this.knock = null;
    const pool = (this.props?.() ?? []).filter((q) => q.windowId === windowId);
    if (pool.length === 0) return null;
    const pr = pool.sort((a, b) => Math.abs(a.x - this.body.x) - Math.abs(b.x - this.body.x))[0] as PropSpot;
    const seg = segmentsOf(this.platforms, windowId).find((s) => pr.x >= s.x1 && pr.x <= s.x2);
    if (!seg) return null;
    const dir: 1 | -1 = seg.x2 - pr.x <= pr.x - seg.x1 ? 1 : -1;
    // Not enough room to stand on the inner side: push it the long way.
    const room = dir === 1 ? pr.x - seg.x1 : seg.x2 - pr.x;
    const d: 1 | -1 = room < this.reach + 10 ? (-dir as 1 | -1) : dir;
    this.knock = { prop: pr.id, dir: d };
    const x = Math.max(seg.x1 + 2, Math.min(seg.x2 - 2, pr.x - d * this.reach));
    return { id: seg.id, x };
  }

  setInstinct(i: Instinct): void {
    this.instinct = i;
  }

  /** The walks and jumps that get the animal to where the intent happens. */
  private routeSteps(approach: Approach, path: PathStep[]): Step[] {
    const speed = SPEED[approach];
    const steps: Step[] = [];
    let x = this.body.x;
    path.forEach((p) => {
      if (p.kind === "jump") {
        steps.push({ k: "jump", toId: p.toId, takeoffX: p.takeoffX, landX: p.landX });
        x = p.landX;
        return;
      }
      const d = Math.abs(p.x - x);
      // A few pixels are not worth a shuffle (a jump takes off from where it stands), and nobody runs a few steps.
      if (d >= MIN_WALK) {
        steps.push({ k: "walk", x: p.x, speed: speed >= SPEED.run && d < MIN_RUN ? SPEED.walk : speed });
        x = p.x;
      }
    });
    return steps;
  }

  /**
   * The action itself, planned once the animal has arrived (so it is planned once, from where it
   * really is, and a window moving under it doesn't make it pick a new one).
   */
  private tailSteps(intent: Intent, reached: boolean): Step[] {
    const steps: Step[] = [];
    if (!reached) {
      steps.push({ k: "do", anim: "stare", sec: Math.min(6, intent.stay_sec) });
      return steps;
    }
    const def = behavior(intent.intent);
    if (intent.intent === "leave") {
      steps.push({ k: "hide" });
      return steps;
    }
    const cur = this.currentPlatform();
    if (intent.intent === "cross" && cur) {
      steps.push({ k: "walk", x: cur.x2 - 20, speed: SPEED.saunter });
    } else if (intent.intent === "keyboard_walk" && cur) {
      const mid = (cur.x1 + cur.x2) / 2;
      const span = (cur.x2 - cur.x1) * 0.25;
      for (let i = 0; i < 4; i++) steps.push({ k: "walk", x: mid + (i % 2 === 0 ? span : -span), speed: SPEED.walk, anim: "keyboard" });
    } else if (intent.intent === "zoomies" && cur && this.wild >= 2) {
      steps.push(...this.zoomChain(cur, intent.stay_sec));
    } else if (intent.intent === "zoomies" && cur) {
      let t = 0;
      let x = this.body.x;
      while (t < intent.stay_sec) {
        const nx = this.rng.range(cur.x1 + 20, cur.x2 - 20);
        steps.push({ k: "walk", x: nx, speed: SPEED.run });
        t += Math.abs(nx - x) / SPEED.run;
        x = nx;
      }
    }
    if (intent.intent === "knock_off" && cur && !intent.script) return [...steps, ...this.knockSteps(cur)];
    if (intent.intent === "knock_toy" && !intent.script) {
      // Its own ball: out it comes (rolling in if it was put away), then it plays with it.
      return [...steps, { k: "do", anim: "look", sec: 0.8, fx: { fx: "toy_out" } }, { k: "toy", bats: Math.floor(this.rng.range(2, 6)) }];
    }
    if (intent.intent === "fetch" || intent.intent === "carry_toy" || intent.intent === "stash_toy" || intent.intent === "nose_toy") {
      const mode: ToyTask = intent.intent === "fetch" ? "fetch" : intent.intent === "carry_toy" ? "carry" : intent.intent === "stash_toy" ? "stash" : "nose";
      const t = this.toyAt?.();
      const face: 1 | -1 = t && t.x < this.body.x ? -1 : 1;
      // It has it already (it carried it here): straight on with the job.
      if (t?.carried && this.carrying === t.id) return [...steps, { k: "toytask", mode, stage: mode === "fetch" ? "bring" : mode === "stash" ? "bury" : "away" }];
      return [...steps, { k: "do", anim: "watch", sec: 0.6, face }, { k: "toytask", mode, stage: "get" }];
    }
    if (intent.intent === "chase_cursor") {
      return [...steps, { k: "do", anim: "pounce", sec: 0.7, face: "cursor" }, { k: "cursor", mode: "chase", until: this.clock + Math.max(8, intent.stay_sec) }];
    }
    if ((intent.intent === "follow" && intent.target === "cursor") || intent.intent === "play_cursor") {
      const mode = intent.intent === "follow" ? "follow" : "play";
      const open: Step[] = intent.opener ? [{ k: "do", anim: intent.opener.anim, sec: intent.opener.sec, face: "cursor" }] : [];
      return [...steps, ...open, { k: "do", anim: "watch", sec: 0.8, face: "cursor" }, { k: "cursor", mode, until: this.clock + Math.max(8, intent.stay_sec) }];
    }
    if (intent.intent === "claw" && cur && !intent.script) return [...steps, ...this.clawSteps()];
    if (intent.intent === "hunt" && cur && !intent.script) return [...steps, ...this.huntSteps(cur)];
    // Scripted scenes: a reaction to a click, and the little routines of the playful intents.
    const script = intent.script ?? sceneFor(intent.intent, intent.stay_sec, this.rng);
    if (script) {
      steps.push(...script.map((beat): Step => ({ k: "beat", beat })));
      return steps;
    }
    // Combos: a short routine of several moves, chosen as one.
    if (intent.intent === "stalk") {
      steps.push({ k: "do", anim: "stare", sec: 1.5 }, { k: "do", anim: "pounce", sec: 0.8 }, { k: "do", anim: "swat", sec: 1 }, { k: "do", anim: "groom", sec: 3 });
      return steps;
    }
    if (intent.intent === "tour" && cur) {
      steps.push({ k: "walk", x: cur.x1 + 24, speed: SPEED.walk }, { k: "do", anim: "look", sec: 1.5 });
      steps.push({ k: "walk", x: cur.x2 - 24, speed: SPEED.walk }, { k: "do", anim: "blink", sec: 1.5 }, { k: "do", anim: "stretch", sec: 2 });
      steps.push({ k: "do", anim: "loaf", sec: Math.max(3, intent.stay_sec - 8) });
      return steps;
    }
    if (intent.intent === "cozy") {
      steps.push({ k: "do", anim: "knead", sec: 4 }, { k: "do", anim: "idle_sit", sec: 1 }, { k: "do", anim: "sleep", sec: intent.stay_sec });
      return steps;
    }
    if ((intent.intent === "wander" || intent.intent === "follow") && cur) {
      steps.push(...this.amble(cur, intent.stay_sec, this.lastWalkX(steps)));
      return steps;
    }
    const sec = intent.intent === "cross" || intent.intent === "keyboard_walk" || intent.intent === "zoomies" ? 0.5 : intent.stay_sec;
    const anim = DO_ANIM[intent.intent] ?? "idle_sit";
    const once = ONCE[anim];
    if (once && sec > once[0] + 1) {
      steps.push({ k: "do", anim, sec: once[0], block: def.blocks }, { k: "do", anim: once[1], sec: sec - once[0], block: def.blocks });
    } else steps.push({ k: "do", anim, sec, block: def.blocks });
    return steps;
  }

  /**
   * Pushing a thing off a window, the way cats do it: look at it, look at you, a tap, another look
   * at you, then a slow push, a creep after it, another push, until it goes over. Then it watches it
   * fall and looks very pleased with itself.
   */
  private knockSteps(cur: Platform): Step[] {
    // Picked on the way here; if there was nothing to see then (it was still fading in), look again now.
    if (!this.knock && this.ridingWindow) this.knockSpot(this.ridingWindow);
    const k = this.knock;
    this.knock = null;
    const pr = k ? (this.props?.() ?? []).find((q) => q.id === k.prop) : undefined;
    if (!k || !pr || pr.windowId !== this.ridingWindow) {
      // Gone by the time it got there (it fell, or that bit of the window is covered): a look, and on with life.
      return [{ k: "do", anim: "look", sec: 2 }, { k: "do", anim: "idle_sit", sec: 2.5 }];
    }
    const dir = k.dir;
    const seg = segmentsOf(this.platforms, pr.windowId).find((q) => pr.x >= q.x1 - 4 && pr.x <= q.x2 + 4) ?? cur;
    const edge = dir === 1 ? seg.x2 : seg.x1;
    const total = Math.abs(edge - pr.x) + 10;
    const n = Math.max(2, Math.min(4, Math.ceil(total / 55)));
    const each = total / n;
    const steps: Step[] = [];
    // Close enough for a paw.
    let x = Math.max(seg.x1 + 2, Math.min(seg.x2 - 2, pr.x - dir * this.reach));
    if (Math.abs(x - this.body.x) > 4) steps.push({ k: "walk", x, speed: SPEED.sneak });
    steps.push(
      { k: "do", anim: "curious", sec: 1.8, face: dir },
      { k: "do", anim: "stare", sec: 2.4, face: "cursor" },
      { k: "do", anim: "swat", sec: 1.5, face: dir, fx: { fx: "tap", prop: pr.id } },
      { k: "do", anim: "stare", sec: 2, face: "cursor" },
    );
    for (let i = 0; i < n; i++) {
      steps.push({ k: "do", anim: "push_toy", sec: 1.3, face: dir, fx: { fx: "nudge", prop: pr.id, px: each } });
      // One last look before the end: are you watching?
      if (i === n - 2) steps.push({ k: "do", anim: "stare", sec: 1.8, face: "cursor" });
      if (i < n - 1) {
        x += dir * each;
        steps.push({ k: "walk", x, speed: SPEED.saunter });
      }
    }
    steps.push({ k: "do", anim: "peek", sec: 2.6, face: dir }, { k: "do", anim: "proud", sec: 2.4, face: "cursor" }, { k: "do", anim: "idle_sit", sec: 2 });
    return steps;
  }

  /** The ledge the toy ball is on. */
  private toyPlatform(t: ToySpot): Platform | undefined {
    if (t.windowId) return segmentsOf(this.platforms, t.windowId).find((p) => t.x >= p.x1 - 6 && t.x <= p.x2 + 6);
    return this.platforms.find((p) => !p.windowId && t.x >= p.x1 && t.x <= p.x2 && Math.abs(p.y - t.y) < 30);
  }

  /**
   * One go at the toy ball, from where it is now: watch it while it rolls, go after it (stalking the
   * last bit), crouch with a wiggle, and swipe it on. The next go follows until the bats run out.
   */
  private toyRound(bats: number, waited = 0): Step[] {
    const b = this.body;
    const t = this.toyAt?.() ?? null;
    const cur = this.currentPlatform();
    if (!t || !cur) return [{ k: "do", anim: "look", sec: 1.5 }, { k: "do", anim: "idle_sit", sec: 1.5 }];
    const toward: 1 | -1 = t.x >= b.x ? 1 : -1;
    if (bats <= 0) return [{ k: "do", anim: "watch", sec: 1.4, face: toward }, { k: "do", anim: "proud", sec: 1.8 }, { k: "do", anim: "groom", sec: 3 }];
    // Still rolling: eyes on it until it stops.
    // Standing: it is about to go after it.
    if (t.moving && waited < 20) return [{ k: "do", anim: "watch_stand", sec: 0.35, face: toward }, { k: "toy", bats, waited: waited + 1 }];
    const plat = this.toyPlatform(t);
    if (!plat) return [{ k: "do", anim: "watch", sec: 1.5, face: toward }, { k: "do", anim: "idle_sit", sec: 1 }];
    // Usually on in the same direction; now and then back the other way, or toward the edge for fun.
    let dir: 1 | -1 = this.rng.next() < 0.7 ? toward : (-toward as 1 | -1);
    const room = (d: 1 | -1): number => (d === 1 ? plat.x2 - t.x : t.x - plat.x1);
    if (room((-dir) as 1 | -1) < this.reach + 8) dir = (-dir) as 1 | -1;
    const standX = Math.max(plat.x1 + 2, Math.min(plat.x2 - 2, t.x - dir * this.reach));
    const steps: Step[] = [];
    if (plat.id !== cur.id) {
      const plan = planRoute(this.platforms, cur.id, b.x, plat.id, standX, this.limits);
      if (!plan || !plan.reached) return [{ k: "do", anim: "watch", sec: 2, face: toward }, { k: "do", anim: "sulk", sec: 2 }];
      steps.push(...this.routeSteps(Math.abs(t.x - b.x) > 300 ? "run" : "walk", plan.steps));
    } else if (Math.abs(standX - b.x) > 6) {
      const far = Math.abs(standX - b.x);
      // Runs after it, then creeps up the last bit.
      if (far > 260) steps.push({ k: "walk", x: standX - Math.sign(standX - b.x) * 90, speed: SPEED.run });
      steps.push({ k: "walk", x: standX, speed: far > 120 ? SPEED.walk : SPEED.sneak });
    }
    steps.push(
      { k: "do", anim: "pounce", sec: this.rng.range(0.6, 1.4), face: dir },
      { k: "do", anim: "swat", sec: 0.9, face: dir, fx: { fx: "bat", prop: t.id, strength: this.rng.range(0.6, 1.25) }, fxAt: 0.3 },
      { k: "toy", bats: bats - 1 },
    );
    return steps;
  }

  /**
   * Following the cursor around (and pestering you about it), or playing with it like a toy. Worked
   * out again after every short leg, from where the cursor is then, until the time is up.
   */
  private cursorRound(mode: "follow" | "play" | "chase", until: number): Step[] {
    const w = this.world;
    const b = this.body;
    const cur = this.currentPlatform();
    if (!w || !cur || this.clock >= until) {
      if (mode === "chase") return [{ k: "do", anim: "watch_stand", sec: 1, face: "cursor" }, { k: "do", anim: "proud", sec: 1.8 }, { k: "do", anim: "groom", sec: 2.5 }];
      return mode === "follow" ? [{ k: "do", anim: "watch", sec: 1.5, face: "cursor" }, { k: "do", anim: "idle_sit", sec: 1 }] : [{ k: "do", anim: "watch", sec: 1, face: "cursor" }, { k: "do", anim: "groom", sec: 2.5 }];
    }
    // A cursor that sits still is no fun: it loses interest (a chaser waits a moment longer for it to run again).
    if (mode === "play" && this.cursorStill > 4) return [{ k: "do", anim: "look", sec: 1.2, face: "cursor" }, { k: "do", anim: "groom", sec: 2.5 }];
    if (mode === "chase" && this.cursorStill > 3) return [{ k: "do", anim: "watch_stand", sec: 1.2, face: "cursor" }, { k: "do", anim: "proud", sec: 1.6 }, { k: "do", anim: "groom", sec: 2.5 }];
    if (mode === "chase") return this.chaseLeg(w, cur, until);
    const again: Step = { k: "cursor", mode, until };
    const goal = this.spotUnder(w.cursor);
    const toward: 1 | -1 = w.cursor.x >= b.x ? 1 : -1;
    const gap = (mode === "play" ? 80 : 55) * this.sizeScale;
    if (goal.id !== cur.id) {
      const plan = planRoute(this.platforms, cur.id, b.x, goal.id, goal.x, this.limits);
      if (!plan || !plan.reached || plan.steps.length === 0) return [{ k: "do", anim: "watch", sec: 1.5, face: "cursor" }, again];
      return [...this.routeSteps(Math.abs(goal.x - b.x) > 400 ? "run" : "walk", plan.steps), again];
    }
    const far = Math.abs(goal.x - b.x);
    if (far > gap + 40) {
      // A short leg at a time, so it turns when the cursor does.
      const stop = goal.x - Math.sign(goal.x - b.x) * gap;
      const x = b.x + Math.sign(stop - b.x) * Math.min(Math.abs(stop - b.x), 320);
      const speed = far > 420 ? SPEED.run : mode === "play" && far < 220 ? SPEED.sneak : SPEED.walk;
      return [{ k: "walk", x, speed }, again];
    }
    const head = b.y - this.size.h * 0.7;
    const up = head - w.cursor.y;
    const dx = w.cursor.x - b.x;
    if (mode === "follow") {
      // Caught up with you: sit, look up, and have a word about it.
      const r = this.rng.next();
      if (r < 0.3) return [{ k: "do", anim: "meow", sec: 1.8, face: "cursor" }, { k: "do", anim: "watch", sec: this.rng.range(1, 2.2), face: "cursor" }, again];
      if (r < 0.45 && Math.abs(dx) < 70 && up < 70) return [{ k: "do", anim: "headbutt", sec: 2.4, face: "cursor" }, again];
      if (r < 0.55) return [{ k: "do", anim: "beg", sec: 2.2, face: "cursor" }, again];
      return [{ k: "do", anim: "watch", sec: this.rng.range(1.4, 3), face: "cursor" }, again];
    }
    // Play: crouch and wiggle, then jump at it if it hangs above, swipe at it if it is down here.
    const steps: Step[] = [{ k: "do", anim: "pounce", sec: this.rng.range(0.5, 1.3), face: "cursor" }];
    if (up > 30 && up < 280 * this.sizeScale && Math.abs(dx) < 220) {
      steps.push({ k: "leap", dx: Math.max(-170, Math.min(170, dx)), h: Math.min(300, up + 50), anim: "leap", face: toward });
    } else if (Math.abs(dx) < this.reach * 1.8) {
      steps.push({ k: "do", anim: "swat", sec: 0.9, face: "cursor" });
    } else {
      steps.push({ k: "leap", dx: Math.max(-140, Math.min(140, dx * 0.8)), h: 45, anim: "leap", face: toward });
    }
    // Stays on its feet between goes, eyes on it.
    steps.push({ k: "do", anim: "watch_stand", sec: this.rng.range(0.5, 1.3), face: "cursor" }, again);
    return steps;
  }

  /**
   * Chasing the cursor flat out: it runs at it in short legs (so it swerves when you do), jumps at it
   * when it hangs just above, and swats when it catches up. Worked out again after every leg.
   */
  private chaseLeg(w: WorldSnapshot, cur: Platform, until: number): Step[] {
    const b = this.body;
    const again: Step = { k: "cursor", mode: "chase", until };
    const goal = this.spotUnder(w.cursor);
    const toward: 1 | -1 = w.cursor.x >= b.x ? 1 : -1;
    if (goal.id !== cur.id) {
      const plan = planRoute(this.platforms, cur.id, b.x, goal.id, goal.x, this.limits);
      if (!plan || !plan.reached || plan.steps.length === 0) return [{ k: "do", anim: "watch_stand", sec: 0.8, face: "cursor" }, again];
      return [...this.routeSteps("run", plan.steps), again];
    }
    const far = Math.abs(goal.x - b.x);
    if (far > 60 * this.sizeScale) {
      const stop = goal.x - Math.sign(goal.x - b.x) * 30 * this.sizeScale;
      const x = b.x + Math.sign(stop - b.x) * Math.min(Math.abs(stop - b.x), 260);
      return [{ k: "walk", x, speed: far > 140 ? SPEED.run : SPEED.walk }, again];
    }
    const up = b.y - this.size.h * 0.7 - w.cursor.y;
    if (up > 30 && up < 260 * this.sizeScale) return [{ k: "leap", dx: Math.max(-90, Math.min(90, w.cursor.x - b.x)), h: Math.min(280, up + 40), anim: "leap", face: toward }, again];
    return [{ k: "do", anim: "swat", sec: 0.6, face: "cursor" }, { k: "do", anim: "watch_stand", sec: 0.3, face: "cursor" }, again];
  }

  /**
   * One stage of a job with the toy. get: go to it (watching it while it rolls) and pick it up, or for
   * a sniff, nose it about. bring: carry it back to under the cursor, drop it at your feet and ask for
   * another throw. away: carry it off to a spot of its own, far from you, and lie down with it. bury:
   * carry it a little way and dig it in.
   */
  private toyTask(st: Extract<Step, { k: "toytask" }>): Step[] {
    const b = this.body;
    const w = this.world;
    const t = this.toyAt?.() ?? null;
    const cur = this.currentPlatform();
    const sit: Step[] = [{ k: "do", anim: "look", sec: 1.2 }, { k: "do", anim: "idle_sit", sec: 1.5 }];
    if (!w || !cur) return sit;
    if (st.stage === "get") {
      if (!t || t.held) return t?.held ? [{ k: "do", anim: "watch", sec: 1.5, face: "cursor" }, { k: "do", anim: "idle_sit", sec: 1 }] : sit;
      if (t.carried && this.carrying === t.id) return [{ ...st, stage: st.mode === "fetch" ? "bring" : st.mode === "stash" ? "bury" : "away" }];
      const toward: 1 | -1 = t.x >= b.x ? 1 : -1;
      // Still rolling: eyes on it, on its feet, until it stops (or nearly).
      if (t.moving && (st.waited ?? 0) < 24) return [{ k: "do", anim: "watch_stand", sec: 0.3, face: toward }, { ...st, waited: (st.waited ?? 0) + 1 }];
      const plat = this.toyPlatform(t);
      if (!plat) return [{ k: "do", anim: "watch", sec: 1.5, face: toward }, { k: "do", anim: "idle_sit", sec: 1 }];
      // Right up to it, nose over it (a sniff stands a bit further back).
      const back = (st.mode === "nose" ? 0.75 : 0.42) * this.size.w;
      const side: 1 | -1 = Math.abs(t.x - b.x) < back ? (-toward as 1 | -1) : toward;
      const standX = Math.max(plat.x1 + 2, Math.min(plat.x2 - 2, t.x - side * back));
      const steps: Step[] = [];
      const fast = st.mode === "fetch" ? "run" : "walk";
      if (plat.id !== cur.id) {
        const plan = planRoute(this.platforms, cur.id, b.x, plat.id, standX, this.limits);
        if (!plan || !plan.reached) return [{ k: "do", anim: "watch", sec: 2, face: toward }, { k: "do", anim: "sulk", sec: 2 }];
        steps.push(...this.routeSteps(Math.abs(t.x - b.x) > 260 ? fast : "walk", plan.steps));
        // It may have rolled on meanwhile: look again once there.
        return [...steps, { ...st, waited: 0 }];
      }
      if (Math.abs(standX - b.x) > 8) {
        const far = Math.abs(standX - b.x);
        steps.push({ k: "walk", x: standX, speed: far > 240 ? SPEED[fast] : st.mode === "nose" ? SPEED.sneak : SPEED.walk });
        // A long way: look again once there, it may have moved.
        if (far > 120) return [...steps, { ...st, waited: 0 }];
      }
      const face = (t.x >= standX ? 1 : -1) as 1 | -1;
      if (st.mode === "nose") {
        return [
          ...steps,
          { k: "do", anim: "sniff", sec: 1.6, face },
          { k: "do", anim: "sniff", sec: 0.7, face, fx: { fx: "bat", prop: t.id, strength: 0.3 }, fxAt: 0.4 },
          { k: "do", anim: "watch", sec: 1.4, face },
          { k: "walk", x: Math.max(plat.x1 + 2, Math.min(plat.x2 - 2, b.x + face * 40)), speed: SPEED.sneak },
          { k: "do", anim: "sniff", sec: 1.2, face },
          { k: "do", anim: "loaf", sec: 4 },
        ];
      }
      return [
        ...steps,
        { k: "do", anim: "sniff", sec: 0.8, face, fx: { fx: "pick_up", prop: t.id }, fxAt: 0.45 },
        { k: "do", anim: "watch_stand", sec: 0.5, face },
        { ...st, stage: st.mode === "fetch" ? "bring" : st.mode === "stash" ? "bury" : "away" },
      ];
    }
    // From here on it should have the toy in its mouth. Dropped (or taken away): the job is over.
    if (!this.carrying) return sit;
    if (st.stage === "bring") {
      const goal = this.spotUnder(w.cursor);
      const legs = (st.legs ?? 0) + 1;
      const gap = 70 * this.sizeScale;
      const toward: 1 | -1 = w.cursor.x >= b.x ? 1 : -1;
      const drop: Step[] = [
        { k: "do", anim: "idle_sit", sec: 0.5, face: "cursor", fx: { fx: "drop_toy" }, fxAt: 0.25 },
        { k: "do", anim: "beg", sec: 1.8, face: "cursor" },
        { k: "do", anim: "watch", sec: 3, face: "cursor" },
      ];
      // Too far, or it can't get to you: it brings it as far as it can and drops it there.
      if (legs > 14) return drop;
      if (goal.id !== cur.id) {
        const plan = planRoute(this.platforms, cur.id, b.x, goal.id, goal.x - toward * gap, this.limits);
        if (!plan || !plan.reached || plan.steps.length === 0) return drop;
        return [...this.routeSteps(Math.abs(goal.x - b.x) > 300 ? "run" : "walk", plan.steps), { ...st, legs }];
      }
      const far = Math.abs(goal.x - b.x);
      if (far > gap + 30) {
        const stop = goal.x - Math.sign(goal.x - b.x) * gap;
        const x = b.x + Math.sign(stop - b.x) * Math.min(Math.abs(stop - b.x), 320);
        return [{ k: "walk", x, speed: far > 300 ? SPEED.run : SPEED.walk }, { ...st, legs }];
      }
      return drop;
    }
    if (st.stage === "away") {
      // Somewhere of its own: the ledge farthest from you it can get to, picked once.
      let dest = st.dest;
      if (!dest) {
        const ledges = this.platforms.filter((q) => q.x2 - q.x1 > 140);
        const scored = ledges
          .map((q) => {
            const x = this.rng.range(q.x1 + 40, q.x2 - 40);
            return { q, x, d: Math.hypot(x - w.cursor.x, q.y - w.cursor.y) + this.rng.range(0, 200) };
          })
          .sort((a, c) => c.d - a.d);
        for (const c of scored.slice(0, 4)) {
          const plan = planRoute(this.platforms, cur.id, b.x, c.q.id, c.x, this.limits);
          if (plan?.reached) {
            dest = { id: c.q.id, x: c.x };
            break;
          }
        }
        dest ??= { id: cur.id, x: Math.max(cur.x1 + 20, Math.min(cur.x2 - 20, b.x + (w.cursor.x >= b.x ? -1 : 1) * 200)) };
      }
      const legs = (st.legs ?? 0) + 1;
      const there = dest.id === cur.id && Math.abs(dest.x - b.x) < 12;
      if (!there && legs <= 6) {
        const plan = planRoute(this.platforms, cur.id, b.x, dest.id, dest.x, this.limits);
        if (plan?.reached && plan.steps.length > 0) return [...this.routeSteps("walk", plan.steps), { ...st, dest, legs }];
      }
      const away: 1 | -1 = w.cursor.x >= b.x ? -1 : 1;
      return [
        { k: "do", anim: "look", sec: 0.8, face: (-away) as 1 | -1 },
        { k: "do", anim: "idle_sit", sec: 0.5, face: away, fx: { fx: "drop_toy" }, fxAt: 0.25 },
        { k: "do", anim: "loaf", sec: this.rng.range(4, 7), face: away },
        { k: "do", anim: "groom", sec: 2.5 },
        { k: "do", anim: "loaf", sec: this.rng.range(3, 6) },
      ];
    }
    // bury: a few steps away from you, then dig it in and pat it down.
    if (!st.dest) {
      const away: 1 | -1 = w.cursor.x >= b.x ? -1 : 1;
      let x = b.x + away * this.rng.range(80, 180);
      if (x < cur.x1 + 20 || x > cur.x2 - 20) x = b.x - away * this.rng.range(60, 140);
      x = Math.max(cur.x1 + 20, Math.min(cur.x2 - 20, x));
      return [{ k: "walk", x, speed: SPEED.walk }, { ...st, dest: { id: cur.id, x } }];
    }
    return [
      { k: "do", anim: "sniff", sec: 1.2 },
      { k: "do", anim: "dig", sec: 2.4, fx: { fx: "bury" }, fxAt: 1.4 },
      { k: "do", anim: "dig", sec: 1.2 },
      { k: "do", anim: "sniff", sec: 1 },
      { k: "do", anim: "proud", sec: 2, face: "cursor" },
    ];
  }

  /** Claws into the title bar: marks, a look at you, more marks a step on. */
  private clawSteps(): Step[] {
    const dir = this.body.facing;
    return [
      { k: "do", anim: "sniff", sec: 1.6 },
      { k: "do", anim: "dig", sec: 2.8, fx: { fx: "claw" } },
      { k: "do", anim: "stare", sec: 2, face: "cursor" },
      { k: "walk", x: this.body.x + dir * 30, speed: SPEED.sneak },
      { k: "do", anim: "dig", sec: 2.4, face: dir, fx: { fx: "claw" } },
      { k: "do", anim: "proud", sec: 2.4, face: "cursor" },
      { k: "do", anim: "idle_sit", sec: 1.5 },
    ];
  }

  /**
   * A fly turns up. The cat watches it, chatters at it, wiggles and leaps. Whether it gets it is
   * settled now, so the fly can be caught or get away at the right moment.
   */
  private huntSteps(cur: Platform): Step[] {
    const room = (d: 1 | -1): number => (d === 1 ? cur.x2 - this.body.x : this.body.x - cur.x1);
    const dir: 1 | -1 = room(1) >= room(-1) ? 1 : -1;
    const by = Math.max(0, Math.min(90, room(dir) - 10));
    const caught = this.rng.next() < 0.45;
    const steps: Step[] = [
      { k: "do", anim: "look", sec: 1.2, face: dir, fx: { fx: "fly_in", caught, dx: dir * Math.max(30, by * 0.55), dy: -(this.size.h + 30) } },
      { k: "do", anim: "look", sec: 2.4, face: dir },
      { k: "do", anim: "chatter", sec: 2.6, face: dir },
      { k: "do", anim: "pounce", sec: 1.6, face: dir },
      { k: "leap", dx: dir * by, h: 90, anim: "leap", face: dir, fx: { fx: "pounce_fly" } },
    ];
    if (caught) steps.push({ k: "do", anim: "proud", sec: 2.4 }, { k: "do", anim: "groom", sec: 3 });
    else steps.push({ k: "do", anim: "dazed", sec: 1.5 }, { k: "do", anim: "look", sec: 2, face: (-dir) as 1 | -1 }, { k: "do", anim: "groom", sec: 3 });
    return steps;
  }

  /** Zoomies for real: flat out from window to window, three or four of them. */
  private zoomChain(cur: Platform, sec: number): Step[] {
    const steps: Step[] = [];
    let at = { id: cur.id, x: this.body.x };
    let t = 0;
    const ledges = this.platforms.filter((p) => p.x2 - p.x1 > 100);
    for (let leg = 0; leg < 6 && t < Math.max(8, sec); leg++) {
      const others = ledges.filter((p) => p.id !== at.id);
      if (others.length === 0) break;
      const to = this.rng.pick(others);
      const x = this.rng.range(to.x1 + 30, to.x2 - 30);
      const plan = planRoute(this.platforms, at.id, at.x, to.id, x, this.limits);
      if (!plan || !plan.reached) continue;
      let px = at.x;
      for (const p of plan.steps) {
        if (p.kind === "jump") {
          steps.push({ k: "jump", toId: p.toId, takeoffX: p.takeoffX, landX: p.landX });
          px = p.landX;
          t += 0.8;
        } else if (Math.abs(p.x - px) >= 20) {
          steps.push({ k: "walk", x: p.x, speed: SPEED.run });
          t += Math.abs(p.x - px) / SPEED.run;
          px = p.x;
        }
      }
      at = { id: to.id, x: px };
    }
    return steps;
  }

  /** Where the cat will stand after the steps so far. */
  private lastWalkX(steps: Step[]): number {
    for (let i = steps.length - 1; i >= 0; i--) {
      const st = steps[i] as Step;
      if (st.k === "walk") return st.x;
      if (st.k === "jump") return st.landX;
    }
    return this.body.x;
  }

  /**
   * Hanging around the way an animal does: stand and do a small thing, stroll a bit, repeat.
   * How far, how fast, how long it rests and what it does there depend on the kind of animal.
   */
  private amble(cur: Platform, totalSec: number, fromX: number): Step[] {
    const ins = this.instinct;
    const out: Step[] = [];
    let x = fromX;
    let t = 0;
    while (t < totalSec && out.length < 60) {
      const rest = this.rng.range(ins.rest[0], ins.rest[1]);
      // Half the stops are just sitting there. The others do one small thing.
      const anim = this.rng.next() < 0.5 ? "idle_sit" : this.rng.pick(ins.idle);
      if (CALM.has(anim) || anim === "blink" || anim === "look" || anim === "stare") {
        out.push({ k: "do", anim, sec: rest });
      } else {
        // A lively thing (a bark, a hop, a stretch) is short, then the animal just sits a while. An
        // ear scratch plays whole: cut short, the leg would vanish mid-stroke.
        const busy = anim === "scratch" ? SCRATCH_SEC : Math.min(rest * 0.35, ONCE[anim]?.[0] ?? 3);
        out.push({ k: "do", anim, sec: busy }, { k: "do", anim: "idle_sit", sec: Math.max(0.5, rest - busy) });
      }
      t += rest;
      // Not every stop ends in a stroll: sometimes it just stays where it is.
      if (this.rng.next() < 0.35) continue;
      const dir = this.rng.next() < 0.5 ? -1 : 1;
      const nx = Math.max(cur.x1 + 20, Math.min(cur.x2 - 20, x + dir * this.rng.range(ins.stroll[0], ins.stroll[1])));
      if (Math.abs(nx - x) > Math.max(MIN_WALK, 60)) {
        const sp = this.rng.next() < ins.runs && Math.abs(nx - x) >= MIN_RUN ? SPEED.run : this.rng.pick([SPEED.walk, SPEED.walk, SPEED.saunter]);
        out.push({ k: "walk", x: nx, speed: sp });
        t += Math.abs(nx - x) / (sp * ins.speed * this.sizeScale);
        x = nx;
      }
    }
    return out;
  }

  start(intent: Intent): void {
    if (this.mode !== "ground") {
      this.pending = intent;
      return;
    }
    if (!CARRY_INTENTS.has(intent.intent)) this.letGoOfToy();
    if (this.body.hidden && intent.intent !== "leave") {
      const dock = this.platforms.find((p) => p.id === "dock");
      if (dock) {
        this.body.x = dock.x1 + 20;
        this.body.y = dock.y;
        this.body.platformId = "dock";
        this.ridingWindow = null;
      }
      this.body.hidden = false;
    }
    this.closeBlock();
    this.intent = intent;
    this.queue = [];
    this.current = null;
    this.unreachable = false;
    this.inTail = false;
    this.phase = "moving";
    this.idleSec = 0;
    const g = this.resolveGoal(intent);
    const p = this.platforms.find((q) => q.id === g.id);
    const win = p?.windowId ? this.world?.windows.find((w) => w.id === p.windowId) : undefined;
    this.goal = win ? { id: g.id, windowId: win.id, offset: g.x - win.bounds.x } : { id: g.id, offset: g.x };
    this.replan();
  }

  /** Where the goal is now: a spot on a window moves with the window. */
  private goalNow(): { id: string; x: number } | null {
    const g = this.goal;
    if (!g) return null;
    if (!g.windowId) return this.platforms.some((p) => p.id === g.id) ? { id: g.id, x: g.offset } : null;
    const win = this.world?.windows.find((w) => w.id === g.windowId);
    if (!win) return null;
    const x = win.bounds.x + g.offset;
    const segs = segmentsOf(this.platforms, win.id);
    const seg = segs.find((s) => x >= s.x1 && x <= s.x2) ?? [...segs].sort((a, b) => Math.abs((a.x1 + a.x2) / 2 - x) - Math.abs((b.x1 + b.x2) / 2 - x))[0];
    if (!seg) return null;
    return { id: seg.id, x: Math.max(seg.x1 + 2, Math.min(seg.x2 - 2, x)) };
  }

  /** Finds the way to the goal (again, when the windows moved). The action is planned on arrival. */
  private replan(): void {
    const intent = this.intent;
    const cur = this.currentPlatform();
    if (!intent || !cur) return;
    let goal = this.goalNow();
    if (!goal) {
      // The window it was going to is gone, or covered: it settles for where it is.
      goal = { id: cur.id, x: this.body.x };
      this.goal = { id: cur.id, offset: this.body.x };
    }
    const plan = planRoute(this.platforms, cur.id, this.body.x, goal.id, goal.x, this.limits);
    this.queue = plan ? this.routeSteps(intent.approach, plan.steps) : [];
    // Still coming in from beyond the edge of the screen: first onto the ledge.
    if (this.body.x < cur.x1 || this.body.x > cur.x2) this.queue.unshift({ k: "walk", x: Math.max(cur.x1 + 30, Math.min(cur.x2 - 30, this.body.x)), speed: SPEED.walk, free: true });
    this.unreachable = plan ? !plan.reached : false;
    this.current = null;
  }

  /** Stop what it is doing now (a respect mode, or a reflex). */
  interrupt(): void {
    this.letGoOfToy();
    this.vel = 0;
    this.queue = [];
    this.current = null;
    this.fxLater = null;
    this.glance = 0;
    this.intent = null;
    this.goal = null;
    this.inTail = false;
    this.phase = "idle";
    this.closeBlock();
  }

  pickUp(x: number, y: number): void {
    // Picked up by the scruff: whatever was in its mouth drops (interrupt() lets go of it).
    this.interrupt();
    this.landHold = 0;
    this.hanging = null;
    this.slipped = false;
    this.flung = false;
    this.brace = 0;
    this.slideU = null;
    this.mode = "held";
    this.body.platformId = null;
    this.ridingWindow = null;
    this.body.anim = "dangle";
    this.dragTo(x, y);
  }

  dragTo(x: number, y: number): void {
    this.body.x = x;
    this.body.y = y + this.size.h * 0.6;
  }

  release(vx: number, vy: number): void {
    this.mode = "fall";
    this.body.vx = vx;
    this.body.vy = vy;
    this.body.anim = "fall";
  }

  /**
   * The window under the animal moves (motion.ts). A gentle move it rides out without a fuss. A fast
   * one and it crouches and digs its claws in until it stops. Jerked sideways hard enough and it
   * slides, maybe off the end. Pulled down from under it, or stopped hard on the way up, and it comes
   * off and flies. Call every frame, after the world was handed over and before update().
   */
  ride(m: WinMotion, dt: number): void {
    if (this.mode !== "ground" || !this.ridingWindow) {
      this.slideU = null;
      return;
    }
    const g = GRIP.animal;
    const b = this.body;
    if (m.stop && m.stop.vy < -g.stop) {
      this.fling(m.stop.vx, m.stop.vy * 0.7);
      return;
    }
    if (m.ay > g.lift) {
      this.fling(this.slideU ?? m.vx, Math.min(m.vy, 0));
      return;
    }
    if (m.stop && Math.abs(m.stop.vx) > g.stop && this.slideU === null) this.slideU = m.stop.vx;
    if (this.slideU === null && Math.abs(m.ax) > g.hold) this.slideU = m.vx - m.ax * dt;
    if (this.slideU !== null) {
      const rel = this.slideU - m.vx;
      const pull = g.slide * dt;
      if (Math.abs(rel) <= pull && Math.abs(m.ax) < g.hold) this.slideU = null;
      else {
        this.slideU -= Math.sign(rel) * Math.min(pull, Math.abs(rel));
        b.x += (this.slideU - m.vx) * dt;
        const win = this.world?.windows.find((w) => w.id === this.ridingWindow);
        if (win && (b.x < win.bounds.x - 4 || b.x > win.bounds.x + win.bounds.w + 4)) {
          this.fling(this.slideU, Math.min(m.vy, 0));
          return;
        }
        if (win) this.ridingOffset = b.x - win.bounds.x;
      }
    }
    const speed = Math.hypot(m.vx, m.vy);
    const jerk = Math.hypot(m.ax, m.ay);
    if (speed > BRACE_SPEED || jerk > BRACE_JERK || this.slideU !== null) {
      if (this.brace <= 0) this.braceRough = false;
      this.brace = Math.max(this.brace, 0.35);
      if (speed > 900 || jerk > g.hold * 0.6) this.braceRough = true;
    }
  }

  /** Off the window, with the speed the window gave it. */
  private fling(vx: number, vy: number): void {
    this.letGoOfToy();
    this.slideU = null;
    this.brace = 0;
    this.fxLater = null;
    this.glance = 0;
    this.beginFall();
    this.body.vx = vx;
    this.body.vy = vy;
    this.flung = true;
    this.outbox.push({ type: "flung" });
  }

  /** It held on through a rough ride: a look at you, and a wash to calm down. */
  private afterBrace(): void {
    const b = this.body;
    const cur = this.current;
    if (cur?.k === "do") b.anim = cur.anim;
    if (!this.braceRough) return;
    this.braceRough = false;
    this.outbox.push({ type: "held_on" });
    // Sitting on the window: it gets up for this (the sit picks up again after, blocking again).
    this.closeBlock();
    const rest: Step[] = cur ? [cur.k === "do" ? { ...cur, sec: Math.max(0.3, this.doTimer), fx: undefined } : cur] : [];
    this.current = null;
    this.queue.unshift({ k: "do", anim: "annoyed", sec: 1.4, face: "cursor" }, { k: "do", anim: "groom", sec: 2.2 }, ...rest);
  }

  update(dtSec: number): ExecEvent[] {
    const world = this.world;
    this.clock += dtSec;
    if (world) {
      const c = world.cursor;
      const moved = Math.hypot(c.x - this.lastCursor.x, c.y - this.lastCursor.y);
      if (!(moved < 2)) ((this.cursorStill = 0), (this.lastCursor = { x: c.x, y: c.y }));
      else this.cursorStill += dtSec;
    }
    if (world && !this.body.hidden) {
      if (this.mode === "jump") this.stepJump(dtSec);
      else if (this.mode === "fall") this.stepFall(dtSec, world);
      else if (this.mode === "ground") this.stepGround(dtSec);
      else if (this.mode === "hang") this.stepHang(dtSec);
    }
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private emitFx(fx: Fx): void {
    const b = this.body;
    if (fx.fx === "pick_up") this.carrying = fx.prop;
    else if (fx.fx === "bury" || fx.fx === "drop_toy") this.carrying = null;
    this.outbox.push({ type: "fx", fx, x: b.x, y: b.y, dir: b.facing, windowId: this.ridingWindow });
  }

  private land(p: Platform, speed = 0): void {
    const b = this.body;
    this.mode = "ground";
    if (speed > 0) this.outbox.push({ type: "impact", x: b.x, y: p.y, speed, windowId: p.windowId ?? null });
    b.platformId = p.id;
    b.y = p.y;
    b.vx = 0;
    b.vy = 0;
    b.anim = "land";
    // A hop in a row (a bounce, a zoomie) only touches down; a real jump or a fall sinks in.
    this.landHold = this.queue[0]?.k === "beat" || this.queue[0]?.k === "leap" ? 0.16 : 0.28;
    this.syncRiding(p);
    this.outbox.push({ type: "landed" });
    if (this.slipped || this.flung) {
      // Fell off a ledge: it shakes it off and has a wash, then (on the way somewhere) tries again.
      // Thrown off by its window: a fright, a look at whoever did that, a wash.
      const after: Step[] = this.flung
        ? [{ k: "do", anim: "startled", sec: 0.9 }, { k: "do", anim: "annoyed", sec: 1.6, face: "cursor" }, { k: "do", anim: "groom", sec: 2.4 }]
        : [{ k: "do", anim: "dazed", sec: 1.4 }, { k: "do", anim: "groom", sec: 2.4 }];
      this.slipped = false;
      this.flung = false;
      if (this.intent && !this.inTail) {
        this.replan();
        this.queue.unshift(...after);
      } else this.queue = after;
      this.current = null;
    }
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.start(next);
    }
  }

  private syncRiding(p: Platform): void {
    const win = p.windowId ? this.world?.windows.find((w) => w.id === p.windowId) : undefined;
    if (win) {
      this.ridingWindow = win.id;
      this.ridingOffset = this.body.x - win.bounds.x;
    } else {
      this.ridingWindow = null;
    }
  }

  private stepFall(dt: number, world: WorldSnapshot): void {
    const b = this.body;
    const prevY = b.y;
    b.vy += GRAVITY * dt;
    const all = [world.screen, ...(world.displays ?? [])];
    const minX = Math.min(...all.map((d) => d.x));
    const maxX = Math.max(...all.map((d) => d.x + d.w));
    b.x += b.vx * dt;
    // Thrown at the edge of the screen: it bounces off it instead of sliding down it.
    if (b.x < minX || b.x > maxX) ((b.x = Math.max(minX, Math.min(maxX, b.x))), (b.vx = -b.vx * 0.3));
    b.y += b.vy * dt;
    if (b.vy < 0) return;
    let hit: Platform | undefined;
    for (const p of this.platforms) {
      if (b.x < p.x1 || b.x > p.x2) continue;
      if (prevY <= p.y + 0.5 && b.y >= p.y) if (!hit || p.y < hit.y) hit = p;
    }
    if (!hit && b.y > world.dockTop) hit = this.platforms.find((p) => p.id === "dock");
    if (hit) this.land(hit, b.vy);
  }

  private stepJump(dt: number): void {
    const j = this.jump as JumpState;
    const b = this.body;
    j.t = Math.min(1, j.t + dt / j.T);
    b.x = j.x0 + (j.x1 - j.x0) * j.t;
    b.y = j.y0 + (j.y1 - j.y0) * j.t - 4 * j.peak * j.t * (1 - j.t);
    j.minY = Math.min(j.minY, b.y);
    b.facing = j.face ?? (j.x1 >= j.x0 ? 1 : -1);
    b.anim = j.anim ?? "jump";
    if (j.t >= 1) {
      const to =
        this.platforms.find((p) => p.id === j.toId) ??
        (j.toWin ? this.platforms.find((p) => p.windowId === j.toWin && b.x >= p.x1 && b.x <= p.x2) : undefined);
      if (to) b.x = Math.max(to.x1, Math.min(to.x2, b.x));
      this.jump = null;
      // A big jump up onto a window sometimes falls just short: it catches the edge with its front paws.
      const up = j.y0 - j.y1;
      if (to && j.far && to.windowId && up > this.size.h * 1.2 && this.rng.next() < MISS[this.wild]) {
        this.startHang(to);
        return;
      }
      if (to) this.land(to, Math.sqrt(2 * GRAVITY * Math.max(0, to.y - j.minY)));
      else this.beginFall();
    }
  }

  /** How far below the edge the feet are while it hangs by its front paws (the hang pose is drawn tilted, sprites.ts). */
  private get hangDrop(): number {
    return this.size.h * 0.52;
  }

  private startHang(to: Platform): void {
    const b = this.body;
    const win = this.world?.windows.find((w) => w.id === to.windowId);
    this.mode = "hang";
    this.hanging = { t: 0, T: this.rng.range(1.6, 2.8), windowId: win?.id ?? null, offset: b.x - (win?.bounds.x ?? 0), climbs: this.rng.next() < 0.7 };
    b.platformId = null;
    this.ridingWindow = null;
    b.anim = "hang";
    b.y = to.y + this.hangDrop;
    this.outbox.push({ type: "hang", windowId: win?.id ?? null });
  }

  /** Hanging on: it scrabbles, then hauls itself up, or lets go and drops. It hangs on if the window moves. */
  private stepHang(dt: number): void {
    const h = this.hanging as HangState;
    const b = this.body;
    h.t += dt;
    const win = h.windowId ? this.world?.windows.find((w) => w.id === h.windowId) : undefined;
    const seg = win ? segmentsOf(this.platforms, win.id).find((q) => win.bounds.x + h.offset >= q.x1 - 12 && win.bounds.x + h.offset <= q.x2 + 12) : undefined;
    if (!win || !seg) {
      this.slip();
      return;
    }
    b.x = win.bounds.x + h.offset;
    b.y = seg.y + this.hangDrop;
    b.anim = "hang";
    if (h.t < h.T) return;
    this.hanging = null;
    if (!h.climbs) {
      this.slip();
      return;
    }
    const x1 = Math.max(seg.x1 + 4, Math.min(seg.x2 - 4, b.x + b.facing * 18));
    this.mode = "jump";
    this.jump = { t: 0, T: 0.42, x0: b.x, y0: b.y, x1, y1: seg.y, peak: 26, toId: seg.id, toWin: win.id, anim: "jump", face: b.facing, minY: b.y };
  }

  /** Lets go of the edge. */
  private slip(): void {
    this.hanging = null;
    this.beginFall();
    this.body.vx = -this.body.facing * 40;
    this.slipped = true;
    this.outbox.push({ type: "slipped" });
  }

  private stepGround(dt: number): void {
    const b = this.body;
    if (this.landHold > 0) {
      this.landHold -= dt;
      b.anim = "land";
      return;
    }
    if (this.brace > 0) {
      // Crouched low with its claws in while the window moves; whatever it was doing waits.
      this.brace -= dt;
      b.anim = this.slideU !== null ? "startled" : "land";
      if (this.brace <= 0) this.afterBrace();
      return;
    }
    if (!this.current) {
      // Arrived: now plan the action itself, from where it really is.
      if (this.queue.length === 0 && this.intent && !this.inTail) {
        this.inTail = true;
        this.queue = this.tailSteps(this.intent, !this.unreachable);
      }
      this.current = this.queue.shift() ?? null;
      if (!this.current) {
        if (this.phase !== "idle") this.finish();
        // Done: settle down instead of going on bouncing, and after a while lie down.
        if (!CALM.has(b.anim) && b.anim !== "watch") b.anim = "idle_sit";
        this.idleSec += dt;
        if (this.lookAtCursor(dt, "idle_sit")) return;
        // A huff doesn't last: after a while it turns back round, and later lies down.
        if (this.idleSec > 12 && (b.anim === "turn_away" || b.anim === "sulk")) b.anim = "idle_sit";
        if (this.idleSec > 30 && b.anim === "idle_sit") b.anim = "loaf";
        return;
      }
      // Steps worked out only now, from where the ball or the cursor is (each expansion starts with a plain step).
      for (let i = 0; i < 4 && this.current && (this.current.k === "toy" || this.current.k === "cursor" || this.current.k === "toytask"); i++) {
        const c: Step = this.current;
        this.queue.unshift(
          ...(c.k === "toy" ? this.toyRound(c.bats, c.waited) : c.k === "cursor" ? this.cursorRound(c.mode, c.until) : c.k === "toytask" ? this.toyTask(c) : []),
        );
        this.current = this.queue.shift() ?? null;
      }
      if (!this.current) return;
      if (this.current.k === "beat") this.current = this.resolveBeat(this.current.beat);
      this.fxLater = null;
      if (this.current.k === "do") {
        this.phase = "doing";
        this.doTimer = this.current.sec;
        b.anim = this.current.anim;
        const face = this.current.face;
        if (face === 1 || face === -1) b.facing = face;
        else if (face && this.world) {
          const toward = this.world.cursor.x >= b.x ? 1 : -1;
          b.facing = face === "cursor" ? toward : (-toward as 1 | -1);
        }
        if (this.current.fx && this.current.fxAt) this.fxLater = { fx: this.current.fx, at: this.current.fxAt };
        else if (this.current.fx) this.emitFx(this.current.fx);
        if (this.current.block) {
          const p = this.currentPlatform();
          const target = this.intent?.target ?? "here";
          const id = target === "dock" ? "dock" : (p?.windowId ?? target);
          this.blockingWindow = id;
          this.outbox.push({ type: "block_start", windowId: id });
        }
      } else if (this.current.k === "jump") {
        const j = this.current;
        const to = this.platforms.find((p) => p.id === j.toId);
        const from = this.currentPlatform();
        if (!to || !from) {
          this.current = null;
          return;
        }
        if (Math.abs(j.landX - b.x) > 4) b.facing = j.landX > b.x ? 1 : -1;
        const T = Math.max(0.4, Math.min(1.2, 0.4 + Math.abs(j.landX - b.x) / 600 + Math.max(0, b.y - to.y) / 1500));
        this.mode = "jump";
        this.jump = { t: 0, T, x0: b.x, y0: b.y, x1: j.landX, y1: to.y, peak: Math.max(50, b.y - to.y + 50), toId: to.id, toWin: to.windowId, minY: b.y, far: true };
        this.current = null;
        this.ridingWindow = null;
        return;
      } else if (this.current.k === "leap") {
        const l = this.current;
        const p = this.currentPlatform();
        if (!p) {
          this.current = null;
          return;
        }
        const x1 = Math.max(p.x1 + 2, Math.min(p.x2 - 2, b.x + l.dx));
        if (l.face) b.facing = l.face;
        if (l.fx) this.emitFx(l.fx);
        this.mode = "jump";
        this.jump = { t: 0, T: 0.5, x0: b.x, y0: b.y, x1, y1: p.y, peak: l.h, toId: p.id, anim: l.anim, face: l.face, minY: b.y };
        this.current = null;
        this.ridingWindow = null;
        this.vel = 0;
        this.phase = "moving";
        return;
      } else if (this.current.k === "hide") {
        b.hidden = true;
        this.outbox.push({ type: "hidden" });
        this.current = null;
        this.finish();
        return;
      } else {
        this.phase = "moving";
        const w = this.current;
        if (w.k === "walk" && w.x !== b.x && (w.x > b.x ? 1 : -1) !== b.facing) {
          this.turnSec = TURN_SEC;
          this.vel = 0;
        }
      }
    }
    const s = this.current;
    if (!s) return;
    if (s.k === "walk") {
      const dx = s.x - b.x;
      if (this.turnSec > 0) {
        // Stand and turn round first (the sprites play the drawn turn meanwhile), then set off.
        this.turnSec -= dt;
        if (dx !== 0) b.facing = dx > 0 ? 1 : -1;
        b.anim = s.anim ?? (s.speed >= 200 ? "run" : "walk");
        return;
      }
      // Ease in at the start and slow down before a stop, like an animal, instead of snapping to full speed.
      // (Only keep going between two walking steps the same way; a turn round is a stop too.)
      const top = s.speed * this.instinct.speed * this.sizeScale;
      const next = this.queue[0];
      const onward = next !== undefined && next.k === "walk" && Math.sign(next.x - s.x) === Math.sign(dx);
      const cap = onward ? top : Math.max(40, Math.abs(dx) * 3);
      const want = Math.min(top, cap);
      this.vel += Math.max(-900 * dt, Math.min(500 * dt, want - this.vel));
      const step = Math.max(this.vel, 12) * dt;
      b.anim = s.anim ?? (s.speed >= 200 ? "run" : "walk");
      if (dx !== 0) b.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) <= step) {
        b.x = s.x;
        this.current = null;
      } else {
        b.x += Math.sign(dx) * step;
      }
      const p = this.currentPlatform();
      // Walking in from beyond the edge of the screen (from another desktop) isn't held to the ledge until it is on it.
      const onIt = p && b.x >= p.x1 && b.x <= p.x2;
      if (p && (onIt || !s.free)) {
        b.x = Math.max(p.x1, Math.min(p.x2, b.x));
        b.y = p.y;
        this.syncRiding(p);
      }
    } else if (s.k === "do") {
      this.vel = 0;
      this.doTimer -= dt;
      if (this.fxLater && s.sec - this.doTimer >= this.fxLater.at) {
        this.emitFx(this.fxLater.fx);
        this.fxLater = null;
      }
      this.lookAtCursor(dt, s.anim, s.face === "away");
      if (this.doTimer <= 0) {
        if (this.glance > 0) ((this.glance = 0), (this.glanceCool = this.rng.range(3, 8)));
        this.closeBlock();
        this.current = null;
      }
    }
  }

  /**
   * The cursor comes close while the animal sits: it looks at it, its head following it, and turns
   * round if it went behind. It looks away again when the cursor leaves or stops for a while. Not
   * while it is ignoring you on purpose. True while it is looking.
   */
  /** How long the cursor has been behind it while it watches, and how long until it turns round. */
  private behindSec = 0;
  private behindLimit = 2.2;

  private lookAtCursor(dt: number, base: Anim, ignoring = false): boolean {
    const w = this.world;
    const b = this.body;
    this.glanceCool -= dt;
    if (!w || ignoring || !GLANCE.has(base)) {
      this.glance = 0;
      return false;
    }
    const dx = w.cursor.x - b.x;
    const d = Math.hypot(dx, w.cursor.y - (b.y - this.size.h * 0.7));
    const near = d < GLANCE_DIST * this.sizeScale;
    const lively = this.cursorStill < 0.4;
    const watching = base === "watch" || base === "watch_stand";
    if (watching || this.glance > 0) {
      if (!watching) {
        if (near && lively) this.glance = Math.max(this.glance, 1.2);
        this.glance -= dt;
        if (this.glance <= 0 || d > GLANCE_DIST * 1.5 * this.sizeScale) {
          this.glance = 0;
          this.glanceCool = this.rng.range(3, 8);
          b.anim = base;
          return false;
        }
      }
      b.anim = watching ? base : "watch";
      // Behind it, the head goes round over the shoulder first (the drawings have that look now). It
      // turns its body round when the thing stays behind for a while or goes far behind.
      if (Math.abs(dx) > 40 && Math.sign(dx) !== b.facing) {
        this.behindSec += dt;
        if (this.behindSec > this.behindLimit || Math.abs(dx) > 320 * this.sizeScale) {
          b.facing = dx > 0 ? 1 : -1;
          this.behindSec = 0;
          this.behindLimit = this.rng.range(1.5, 3.5);
        }
      } else this.behindSec = 0;
      return true;
    }
    if (near && lively && this.glanceCool <= 0) {
      if (this.rng.next() < this.glanceChance) {
        this.glance = this.rng.range(2.2, 4.5);
        b.anim = "watch";
        if (Math.abs(dx) > 30) b.facing = dx > 0 ? 1 : -1;
        return true;
      }
      this.glanceCool = this.rng.range(2, 5);
    }
    return false;
  }

  /** Turns a beat into a concrete step, using where the cat and the cursor are right now. */
  private resolveBeat(beat: Beat): Step {
    const b = this.body;
    const p = this.currentPlatform();
    const cursorX = this.world?.cursor.x ?? b.x;
    const toward: 1 | -1 = cursorX >= b.x ? 1 : -1;
    if ("do" in beat) return { k: "do", anim: beat.do, sec: beat.sec, face: beat.face };
    if (!p) return { k: "do", anim: "idle_sit", sec: 0.2 };
    const room = (dir: 1 | -1): number => (dir === 1 ? p.x2 - 20 - b.x : b.x - (p.x1 + 20));
    const goDir = (to: "cursor" | "away" | "ahead" | "stroll"): 1 | -1 =>
      to === "cursor" ? toward : to === "away" ? (-toward as 1 | -1) : to === "ahead" ? b.facing : this.rng.next() < 0.5 ? -1 : 1;
    if ("leap" in beat) {
      let dir = goDir(beat.leap);
      if (room(dir) < 30) dir = (-dir) as 1 | -1;
      const dx = dir * Math.max(0, Math.min(beat.by, room(dir)));
      // A leap away keeps its eyes on you: the cat jumps backwards.
      return { k: "leap", dx, h: beat.h, anim: beat.anim ?? "leap", face: beat.leap === "away" ? toward : undefined };
    }
    let dir = goDir(beat.go);
    if (beat.go !== "cursor" && room(dir) < 50 && room((-dir) as 1 | -1) > room(dir)) dir = (-dir) as 1 | -1;
    // Going to the cursor stops a little short of it.
    const reach = beat.go === "cursor" ? Math.max(0, Math.abs(cursorX - b.x) - 60) : room(dir);
    const dist = Math.min(beat.by, reach, Math.max(0, room(dir)));
    // A few pixels is not worth a walk: a shuffle that short reads as a twitch. Keep the pose.
    if (dist < MIN_WALK) return { k: "do", anim: b.anim === "walk" || b.anim === "run" ? "idle_sit" : b.anim, sec: 0 };
    // Nobody breaks into a run for a few steps: a short run is a quick walk.
    const speed = beat.speed === "run" && dist < MIN_RUN ? "walk" : beat.speed;
    return { k: "walk", x: b.x + dir * dist, speed: SPEED[speed], anim: beat.anim };
  }

  private finish(): void {
    const intent = this.intent;
    this.phase = "idle";
    this.intent = null;
    this.goal = null;
    this.inTail = false;
    if (intent) {
      if (this.unreachable) this.outbox.push({ type: "unreachable", intent: intent.intent });
      this.outbox.push({ type: "done", intent: intent.intent });
    }
  }
}
