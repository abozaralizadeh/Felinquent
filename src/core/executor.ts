import { behavior } from "./behaviors";
import { planRoute, type JumpLimits, type PathStep } from "./pathfinding";
import { buildPlatforms, segmentsOf, type Platform } from "./platforms";
import type { Rng } from "./rng";
import { sceneFor } from "./scenes";
import { INSTINCTS, type Instinct } from "./species";
import type { Approach, Intent, IntentName, Rect, WorldSnapshot } from "./types";

export type Anim =
  | "idle_sit" | "loaf" | "sleep" | "walk" | "run" | "jump" | "fall" | "land" | "perch" | "groom"
  | "stretch" | "look" | "meow" | "purr" | "swat" | "pounce" | "headbutt" | "sulk" | "dangle"
  | "turn_away" | "stare" | "blink" | "keyboard" | "hairball" | "box" | "push_toy" | "gift"
  | "peek" | "chase_tail" | "knead" | "chatter" | "sneeze" | "happy"
  | "angry" | "hiss" | "puffed" | "annoyed" | "flustered" | "play_bow" | "leap" | "belly" | "bark"
  | "shy" | "beg" | "dig" | "sniff" | "tumble" | "sprawl" | "howl" | "giggle" | "startled"
  | "proud" | "curious" | "love" | "yawn" | "surprise" | "dazed" | "scratch" | "bounce";

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
  | { type: "unreachable"; intent: IntentName };

type Step =
  | { k: "walk"; x: number; speed: number; anim?: Anim }
  | { k: "jump"; toId: string; takeoffX: number; landX: number }
  | { k: "do"; anim: Anim; sec: number; block?: boolean; face?: "cursor" | "away" }
  | { k: "leap"; dx: number; h: number; anim: Anim; face?: 1 | -1 }
  | { k: "beat"; beat: Beat }
  | { k: "hide" };

/**
 * Pixels a second at medium size. The gaits (tools/rig-gait.py) take about 27 px a cycle at a walk, so
 * a walk is about 2.4 steps cycles a second and a fast walker (a dog) breaks into a trot.
 */
const SPEED: Record<Approach, number> = { walk: 64, saunter: 42, sneak: 28, run: 230 };
/** How long an animal stands to turn round before it walks the other way. */
const TURN_SEC = 0.28;
/** Poses that can simply go on when an action is over. Anything else settles back to sitting. */
const CALM: ReadonlySet<Anim> = new Set<Anim>(["idle_sit", "loaf", "sleep", "perch", "box", "sulk", "turn_away", "sprawl", "peek"]);

/**
 * One-off moves and how long one takes, in seconds, then the pose it settles into. An intent that
 * stays longer does the move once and sits (or lies) for the rest, instead of holding a stretch or a
 * swat for half a minute.
 */
const ONCE: Partial<Record<Anim, [number, Anim]>> = {
  stretch: [3.2, "idle_sit"], swat: [1.8, "idle_sit"], push_toy: [3, "idle_sit"], headbutt: [3, "idle_sit"],
  meow: [2.6, "idle_sit"], sneeze: [1.6, "idle_sit"], hairball: [3.5, "idle_sit"], chatter: [2.8, "idle_sit"],
  chase_tail: [5, "idle_sit"], knead: [12, "loaf"], yawn: [2.6, "idle_sit"], scratch: [2.6, "idle_sit"],
  happy: [3, "idle_sit"], bark: [2.4, "idle_sit"], play_bow: [2.2, "idle_sit"], proud: [3, "idle_sit"],
  curious: [3, "idle_sit"], puffed: [2, "idle_sit"], giggle: [2.2, "idle_sit"], sniff: [3, "idle_sit"],
};

/** Walks shorter than this (px) are skipped: they would be a shuffle of a step or two. Runs shorter than MIN_RUN are walked. */
const MIN_WALK = 40;
const MIN_RUN = 160;
const GRAVITY = 2000;
const SIZE_SCALE = { S: 0.75, M: 1, L: 1.3 };

const DO_ANIM: Partial<Record<IntentName, Anim>> = {
  nap: "sleep", nap_warm: "sleep", wander: "idle_sit", perch: "perch", groom: "groom", watch: "look",
  stretch: "stretch", stare: "stare", slow_blink: "blink", follow: "idle_sit", cross: "idle_sit",
  headbutt: "headbutt", meow: "meow", swat: "swat", knock_toy: "push_toy", zoomies: "idle_sit",
  ignore: "turn_away", sulk: "sulk", box: "box", sit_on: "loaf", sit_on_video: "loaf", block_dock: "loaf",
  keyboard_walk: "keyboard", gift: "gift", hairball: "hairball", nudge_window: "swat", leave: "idle_sit",
  peek: "peek", chase_tail: "chase_tail", knead: "knead", chatter: "chatter", sneeze: "sneeze",
  stalk: "pounce", tour: "loaf", cozy: "sleep",
  roll: "belly", bounce: "bounce", sniff: "sniff", dig: "dig", howl: "howl", scratch: "scratch", beg: "beg",
  spook: "puffed", sprawl: "sprawl", tumble: "tumble", shy: "shy", react: "idle_sit",
};

interface JumpState {
  t: number;
  T: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  peak: number;
  toId: string;
  /** The pose in the air (a leap has its own) and which way the cat looks while it flies. */
  anim?: Anim;
  face?: 1 | -1;
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
  private mode: "ground" | "jump" | "fall" | "held" = "ground";
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
    return this.mode === "jump" || this.mode === "fall";
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
    if (win) b.x = win.bounds.x + this.ridingOffset;
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
    b.x = Math.max(seg.x1, Math.min(seg.x2, b.x));
    b.y = seg.y;
    b.platformId = seg.id;
    if (this.phase === "moving" && this.intent) this.replan();
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
    if (t === "cursor") {
      let best = dock;
      let bestD = Infinity;
      for (const p of this.platforms) {
        const dx = w.cursor.x < p.x1 ? p.x1 - w.cursor.x : w.cursor.x > p.x2 ? w.cursor.x - p.x2 : 0;
        const below = p.y >= w.cursor.y - 20 ? 0 : 400;
        const d = dx + Math.abs(p.y - w.cursor.y) * 0.5 + below;
        if (d < bestD) ((bestD = d), (best = p));
      }
      return { id: best.id, x: Math.max(best.x1 + 2, Math.min(best.x2 - 2, w.cursor.x)) };
    }
    const segs = segmentsOf(this.platforms, t);
    const seg = segs[0];
    if (!seg) return { id: cur.id, x: this.body.x };
    const mid = (seg.x1 + seg.x2) / 2;
    const jitter = (seg.x2 - seg.x1) * 0.15;
    switch (intent.intent) {
      case "perch":
      case "peek": return { id: seg.id, x: this.rng.next() < 0.5 ? seg.x1 + 30 : seg.x2 - 30 };
      case "cross": return { id: seg.id, x: seg.x1 + 20 };
      default: return { id: seg.id, x: mid + this.rng.range(-jitter, jitter) };
    }
  }

  setInstinct(i: Instinct): void {
    this.instinct = i;
  }

  private makeSteps(intent: Intent, path: PathStep[], reached: boolean): Step[] {
    const speed = SPEED[intent.approach];
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
    if (!reached) {
      steps.push({ k: "do", anim: "stare", sec: Math.min(6, intent.stay_sec) });
      return steps;
    }
    const def = behavior(intent.intent);
    if (intent.intent === "leave") {
      steps.push({ k: "hide" });
      return steps;
    }
    const cur = this.platforms.find((p) => p.id === (path.length ? this.lastPlatformOf(path) : this.body.platformId));
    if (intent.intent === "cross" && cur) {
      steps.push({ k: "walk", x: cur.x2 - 20, speed: SPEED.saunter });
    } else if (intent.intent === "keyboard_walk" && cur) {
      const mid = (cur.x1 + cur.x2) / 2;
      const span = (cur.x2 - cur.x1) * 0.25;
      for (let i = 0; i < 4; i++) steps.push({ k: "walk", x: mid + (i % 2 === 0 ? span : -span), speed: SPEED.walk, anim: "keyboard" });
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
        // A lively thing (a bark, a hop, a stretch) is short, then the animal just sits a while.
        const busy = Math.min(rest * 0.35, ONCE[anim]?.[0] ?? 3);
        out.push({ k: "do", anim, sec: busy }, { k: "do", anim: "idle_sit", sec: rest - busy });
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

  private lastPlatformOf(path: PathStep[]): string | null {
    for (let i = path.length - 1; i >= 0; i--) {
      const s = path[i] as PathStep;
      if (s.kind === "jump") return s.toId;
    }
    return this.body.platformId;
  }

  start(intent: Intent): void {
    if (this.mode !== "ground") {
      this.pending = intent;
      return;
    }
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
    this.phase = "moving";
    this.idleSec = 0;
    this.replan();
  }

  private replan(): void {
    const intent = this.intent;
    const cur = this.currentPlatform();
    if (!intent || !cur) return;
    const goal = this.resolveGoal(intent);
    const plan = planRoute(this.platforms, cur.id, this.body.x, goal.id, goal.x, this.limits);
    if (!plan) {
      this.queue = this.makeSteps(intent, [], true);
    } else {
      this.queue = this.makeSteps(intent, plan.steps, plan.reached);
      this.unreachable = !plan.reached;
    }
    this.current = null;
  }

  /** Stop what it is doing now (a respect mode, or a reflex). */
  interrupt(): void {
    this.vel = 0;
    this.queue = [];
    this.current = null;
    this.intent = null;
    this.phase = "idle";
    this.closeBlock();
  }

  pickUp(x: number, y: number): void {
    this.interrupt();
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

  update(dtSec: number): ExecEvent[] {
    const world = this.world;
    if (world && !this.body.hidden) {
      if (this.mode === "jump") this.stepJump(dtSec);
      else if (this.mode === "fall") this.stepFall(dtSec, world);
      else if (this.mode === "ground") this.stepGround(dtSec);
    }
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private land(p: Platform): void {
    const b = this.body;
    this.mode = "ground";
    b.platformId = p.id;
    b.y = p.y;
    b.vx = 0;
    b.vy = 0;
    b.anim = "land";
    this.syncRiding(p);
    this.outbox.push({ type: "landed" });
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
    b.x = Math.max(minX, Math.min(maxX, b.x + b.vx * dt));
    b.y += b.vy * dt;
    if (b.vy < 0) return;
    let hit: Platform | undefined;
    for (const p of this.platforms) {
      if (b.x < p.x1 || b.x > p.x2) continue;
      if (prevY <= p.y + 0.5 && b.y >= p.y) if (!hit || p.y < hit.y) hit = p;
    }
    if (!hit && b.y > world.dockTop) hit = this.platforms.find((p) => p.id === "dock");
    if (hit) this.land(hit);
  }

  private stepJump(dt: number): void {
    const j = this.jump as JumpState;
    const b = this.body;
    j.t = Math.min(1, j.t + dt / j.T);
    b.x = j.x0 + (j.x1 - j.x0) * j.t;
    b.y = j.y0 + (j.y1 - j.y0) * j.t - 4 * j.peak * j.t * (1 - j.t);
    b.facing = j.face ?? (j.x1 >= j.x0 ? 1 : -1);
    b.anim = j.anim ?? "jump";
    if (j.t >= 1) {
      const to = this.platforms.find((p) => p.id === j.toId);
      this.jump = null;
      if (to) this.land(to);
      else this.beginFall();
    }
  }

  private stepGround(dt: number): void {
    const b = this.body;
    if (!this.current) {
      this.current = this.queue.shift() ?? null;
      if (!this.current) {
        if (this.phase !== "idle") this.finish();
        // Done: settle down instead of going on bouncing, and after a while lie down.
        if (!CALM.has(b.anim)) b.anim = "idle_sit";
        this.idleSec += dt;
        // A huff doesn't last: after a while it turns back round, and later lies down.
        if (this.idleSec > 12 && (b.anim === "turn_away" || b.anim === "sulk")) b.anim = "idle_sit";
        if (this.idleSec > 30 && b.anim === "idle_sit") b.anim = "loaf";
        return;
      }
      if (this.current.k === "beat") this.current = this.resolveBeat(this.current.beat);
      if (this.current.k === "do") {
        this.phase = "doing";
        this.doTimer = this.current.sec;
        b.anim = this.current.anim;
        if (this.current.face && this.world) {
          const toward = this.world.cursor.x >= b.x ? 1 : -1;
          b.facing = this.current.face === "cursor" ? toward : (-toward as 1 | -1);
        }
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
        this.jump = { t: 0, T, x0: b.x, y0: b.y, x1: j.landX, y1: to.y, peak: Math.max(50, b.y - to.y + 50), toId: to.id };
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
        this.mode = "jump";
        this.jump = { t: 0, T: 0.5, x0: b.x, y0: b.y, x1, y1: p.y, peak: l.h, toId: p.id, anim: l.anim, face: l.face };
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
        // Stand and turn round first (the drawing squeezes and opens up the other way), then set off.
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
      if (p) {
        b.x = Math.max(p.x1, Math.min(p.x2, b.x));
        b.y = p.y;
        this.syncRiding(p);
      }
    } else if (s.k === "do") {
      this.vel = 0;
      this.doTimer -= dt;
      if (this.doTimer <= 0) {
        this.closeBlock();
        this.current = null;
      }
    }
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
    if (intent) {
      if (this.unreachable) this.outbox.push({ type: "unreachable", intent: intent.intent });
      this.outbox.push({ type: "done", intent: intent.intent });
    }
  }
}
