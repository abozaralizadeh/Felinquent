import { Executor } from "./executor";
import { Governor } from "./governor";
import { InMemoryMemory, type Memory } from "./memory";
import { Mind, type MindEvent } from "./mind";
import { RulesBrain, type Brain } from "./brain";
import { DEFAULT_PERSONALITY, type Personality } from "./personality";
import { ReflexDetector, type PointerSample, type ReflexEvent, type ReflexKind } from "./reflexes";
import { seeded, type Rng } from "./rng";
import { instinctFor } from "./species";
import { DEFAULT_SETTINGS, type Rect, type Settings, type WorldSnapshot } from "./types";

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
  private lastWindows: unknown = null;
  private lastDockTop = -1;
  private heldFromWindow: string | undefined;
  private lastWorld: WorldSnapshot | null = null;

  constructor(opts: CatOptions = {}) {
    const rng = opts.rng ?? seeded(1);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.governor = new Governor(settings);
    this.executor = new Executor(rng, settings.size);
    this.executor.setInstinct(instinctFor((opts.personality ?? DEFAULT_PERSONALITY).species));
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

  private syncWorld(world: WorldSnapshot, force = false): void {
    this.executor.observe(world);
    if (force || world.windows !== this.lastWindows || world.dockTop !== this.lastDockTop) {
      this.lastWindows = world.windows;
      this.lastDockTop = world.dockTop;
      this.executor.setWorld(world);
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
    for (const ev of this.executor.update(execDtSec)) {
      if (ev.type === "done") this.mind.notifyDone();
      if (ev.type === "landed") {
        const more = this.mind.onExecLanded(world);
        this.apply(more);
        out.push(...more);
      }
    }
    return { mind: out, reflexes: [] };
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
