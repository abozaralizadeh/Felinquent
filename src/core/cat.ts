import { Executor, type ExecEvent } from "./executor";
import { Mess, type MessEvent } from "./mess";
import { Governor } from "./governor";
import { InMemoryMemory, type Memory } from "./memory";
import { Mind, type MindEvent } from "./mind";
import { RulesBrain, type Brain } from "./brain";
import { DEFAULT_PERSONALITY, type Personality } from "./personality";
import { ReflexDetector, type PointerSample, type ReflexEvent, type ReflexKind } from "./reflexes";
import { seeded, type Rng } from "./rng";
import { instinctFor } from "./species";
import { DEFAULT_SETTINGS, type Rect, type Settings, type WorldSnapshot } from "./types";

/** Everything about the windows and displays that changes where the animal can stand. */
function shapeOf(world: WorldSnapshot): string {
  const ws = world.windows.map((w) => `${w.id}:${w.bounds.x},${w.bounds.y},${w.bounds.w},${w.bounds.h},${w.z}`).join(";");
  const ds = (world.displays ?? []).map((d) => `${d.x},${d.y},${d.w},${d.h}`).join(";");
  const s = world.screen;
  return `${ws}|${world.dockTop}|${s.x},${s.y},${s.w},${s.h}|${ds}`;
}

export interface CatOptions {
  settings?: Partial<Settings>;
  brain?: Brain;
  personality?: Personality;
  memory?: Memory;
  rng?: Rng;
  log?: (message: string, fields?: Record<string, unknown>) => void;
  minDecisionGapMs?: number;
}

export interface StepResult {
  mind: MindEvent[];
  reflexes: ReflexEvent[];
}

/**
 * The whole cat in one object: Mind (slow brain), Governor, Executor (fast brain) and the reflex detector.
 * The playground, the simulation tests and the future native shell all drive this.
 */
export class Cat {
  readonly governor: Governor;
  readonly executor: Executor;
  readonly mind: Mind;
  readonly memory: Memory;
  readonly reflexes: ReflexDetector;
  readonly rules = new RulesBrain();
  /** Things on windows to knock off, and what is left when they break (gremlin and normal only). */
  readonly mess: Mess;
  private messRng: Rng;
  private lastCrackMs = -1e12;
  private lastWindows: unknown = null;
  private lastDockTop = -1;
  private lastShape = "";
  private heldFromWindow: string | undefined;
  private lastWorld: WorldSnapshot | null = null;

  constructor(opts: CatOptions = {}) {
    const rng = opts.rng ?? seeded(1);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.governor = new Governor(settings);
    this.executor = new Executor(rng, settings.size);
    this.executor.setInstinct(instinctFor((opts.personality ?? DEFAULT_PERSONALITY).species));
    // The mess has its own dice, so adding it doesn't change what the animal does in a seeded run.
    this.messRng = seeded(7919);
    this.mess = new Mess(this.messRng);
    this.mess.scale = this.executor.size.h / 90;
    this.executor.props = () =>
      this.mess.props
        .filter((p) => p.state === "rest" && p.windowId !== null && p.alpha > 0.9)
        .map((p) => ({ id: p.id, windowId: p.windowId as string, x: p.x }));
    this.memory = opts.memory ?? new InMemoryMemory();
    this.mind = new Mind({
      brain: opts.brain ?? this.rules,
      fallback: this.rules,
      governor: this.governor,
      rng,
      personality: opts.personality ?? DEFAULT_PERSONALITY,
      memory: this.memory,
      catPos: () => ({ x: this.executor.body.x, y: this.executor.body.y - this.executor.size.h / 2 }),
      catWhere: () => (this.executor.body.platformId === "dock" ? "dock" : this.executor.windowId ? `on ${this.executor.windowId}` : "floating"),
      catDoing: () => this.executor.body.anim,
      propWindows: () => this.mess.windowsWithProps(),
      things: () => this.mess.thingsOnWindows(),
      log: opts.log,
      minDecisionGapMs: opts.minDecisionGapMs,
    });
    this.reflexes = new ReflexDetector(() => this.executor.hitRect());
  }

  get settings(): Settings {
    return this.governor.getSettings();
  }

  setPersonality(p: Personality): void {
    this.mind.setPersonality(p);
    this.executor.setInstinct(instinctFor(p.species));
  }

  setBrain(brain: Brain): void {
    this.mind.setBrain(brain);
  }

  updateSettings(patch: Partial<Settings>): void {
    this.governor.setSettings({ ...this.governor.getSettings(), ...patch });
  }

  /** Where clicks are blocked (only while the cat sits on something). */
  get blockingRect(): Rect | null {
    return this.executor.blockingRect();
  }

  place(world: WorldSnapshot, x = 120): void {
    this.executor.placeOnDock(world, x);
    this.syncWorld(world, true);
  }

  /**
   * Hands the executor a new world only when the windows really changed shape. The Mac reads the
   * windows four times a second and makes a new list each time; comparing the lists themselves made
   * the animal drop its plan four times a second (a reaction looped, a stroll never got going).
   */
  private syncWorld(world: WorldSnapshot, force = false): void {
    this.executor.observe(world);
    if (force || world.windows !== this.lastWindows || world.dockTop !== this.lastDockTop) {
      const shape = shapeOf(world);
      this.lastWindows = world.windows;
      this.lastDockTop = world.dockTop;
      if (force || shape !== this.lastShape) {
        this.lastShape = shape;
        this.executor.setWorld(world);
      }
    }
    this.lastWorld = world;
  }

  private apply(events: MindEvent[]): void {
    for (const ev of events) if (ev.type === "intent") this.executor.start(ev.intent);
  }

  /** Call whenever the window list changes shape (the playground does this on every drag). */
  worldChanged(world: WorldSnapshot): void {
    this.syncWorld(world, true);
  }

  /** dtSec drives needs and decisions. execDtSec (default: the same) drives movement, so a demo can warp time. */
  async step(world: WorldSnapshot, dtSec: number, execDtSec: number = dtSec): Promise<StepResult> {
    this.syncWorld(world);
    const moving = this.executor.phase === "moving" || this.executor.airborne;
    const mind = await this.mind.tick(world, dtSec, moving, this.executor.held);
    this.apply(mind);
    const out: MindEvent[] = [...mind];
    const chaos = this.settings.chaos;
    this.executor.wild = chaos === "gremlin" ? 2 : chaos === "normal" ? 1 : 0;
    for (const ev of this.executor.update(execDtSec)) {
      if (ev.type === "done") this.mind.notifyDone();
      if (ev.type === "landed") {
        const more = this.mind.onExecLanded(world);
        this.apply(more);
        out.push(...more);
      }
      this.onExec(ev, world);
    }
    this.bumpWhileRunning();
    for (const ev of this.mess.step(execDtSec, world, chaos, this.executor.body.hidden ? null : this.executor.body.x)) this.onMess(ev, world);
    return { mind: out, reflexes: [] };
  }

  /** The paw, the claws and the leap reach the things around the animal. */
  private onExec(ev: ExecEvent, world: WorldSnapshot): void {
    const now = world.nowMs;
    if (ev.type === "fx") {
      const f = ev.fx;
      if (f.fx === "tap") this.mess.tap(f.prop, ev.dir);
      else if (f.fx === "nudge") this.mess.nudge(f.prop, ev.dir, f.px);
      else if (f.fx === "claw" && ev.windowId) this.mess.claw(ev.windowId, ev.x + ev.dir * this.executor.size.w * 0.28, ev.dir, now);
      else if (f.fx === "fly_in") this.mess.flyIn(ev.x + f.dx, ev.y + f.dy, ev.dir, f.caught, now);
      else if (f.fx === "pounce_fly") this.mess.pounceFly();
    } else if (ev.type === "impact") {
      // Only a gremlin comes down hard enough to crack a window.
      // Not every landing, or the screen would be all cracks: one now and then.
      if (this.executor.wild >= 2 && ev.windowId && ev.speed > 1000 && now - this.lastCrackMs > 25_000 && this.messRng.next() < 0.6) {
        this.lastCrackMs = now;
        this.mess.crack(ev.windowId, ev.x, (ev.speed - 1000) / 800, now);
      }
    } else if (ev.type === "hang") {
      this.mind.note(now, "i fell short of a jump and hung off the edge of a window");
    } else if (ev.type === "slipped") {
      this.mind.note(now, "i fell off a window. on purpose.");
    }
  }

  /** Running flat out along a window, it sends anything in its way flying. */
  private bumpWhileRunning(): void {
    const b = this.executor.body;
    const win = this.executor.windowId;
    if (b.anim !== "run" || !win) return;
    const front = b.x + b.facing * this.executor.size.w * 0.38;
    for (const p of this.mess.props) {
      if (p.state !== "rest" || p.windowId !== win || p.alpha < 0.9) continue;
      if (Math.abs(p.x - front) < 14) this.mess.bump(p.id, b.facing);
    }
  }

  private onMess(ev: MessEvent, world: WorldSnapshot): void {
    const now = world.nowMs;
    const doing = this.executor.intent?.intent;
    const mine = doing === "knock_off" || doing === "zoomies" || this.executor.body.anim === "run";
    if (ev.type === "broke") this.mind.note(now, mine ? `i knocked the ${ev.kind} off. it broke.` : `the ${ev.kind} fell and broke`);
    else if (ev.type === "fell" && mine) this.mind.note(now, doing === "knock_off" ? `i pushed the ${ev.kind} off the edge` : `i ran into the ${ev.kind} and it went flying`);
    else if (ev.type === "cracked") this.mind.note(now, "i landed so hard a window cracked");
    else if (ev.type === "fly") this.mind.note(now, ev.caught ? "i caught a fly" : "a fly got away from me");
  }

  /** A reflex happened (from the pointer or from a menu button). Runs the Mind's reaction and starts any intent. */
  react(kind: ReflexKind, world: WorldSnapshot, windowId?: string): MindEvent[] {
    const mind = this.mind.onReflex(kind, world, windowId);
    this.apply(mind);
    return mind;
  }

  /** Feed one pointer sample. Returns what the cat reacted to. */
  pointer(sample: PointerSample, world: WorldSnapshot): ReflexEvent[] {
    const events = this.reflexes.feed(sample);
    if (this.executor.held) this.executor.dragTo(sample.x, sample.y);
    for (const ev of events) {
      if (ev.kind === "pickup") {
        this.heldFromWindow = this.executor.windowId ?? undefined;
        this.executor.pickUp(ev.x ?? 0, ev.y ?? 0);
        this.react("pickup", world);
      } else if (ev.kind === "drop" || ev.kind === "throw") {
        this.executor.release(ev.vx ?? 0, ev.vy ?? 0);
        this.react(ev.kind, world);
      } else if (ev.kind === "shoo") {
        this.react("shoo", world, this.heldFromWindow);
      } else {
        this.react(ev.kind, world);
      }
    }
    return events;
  }

  treat(world: WorldSnapshot): void {
    this.apply(this.mind.giveTreat(world));
  }
}
