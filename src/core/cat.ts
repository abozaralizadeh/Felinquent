import { Executor, type ExecEvent } from "./executor";
import { Mess, type MessEvent, type MessState } from "./mess";
import { WindowMotion } from "./motion";
import { Governor } from "./governor";
import { InMemoryMemory, type Memory } from "./memory";
import { Mind, type MindEvent } from "./mind";
import { RulesBrain, type Brain } from "./brain";
import { DEFAULT_PERSONALITY, type Personality } from "./personality";
import { ReflexDetector, type PointerSample, type ReflexEvent, type ReflexKind } from "./reflexes";
import { seeded, type Rng } from "./rng";
import { instinctFor } from "./species";
import { DEFAULT_SETTINGS, type Rect, type Settings, type WindowInfo, type WorldSnapshot } from "./types";

/** How long a window list that looks like a desktop swipe is held before it is believed. */
export const SWIPE_HOLD_MS = 1000;
/** How long past its time to come over a sleeping animal naps on before it wakes and comes. */
export const WAKE_TO_COME_MS = 60_000;

/**
 * Whether going from `before` to `after` looks like the whole desktop sliding away: most windows
 * gone at once, or several windows moving sideways by the same amount in one read. Dragging moves one
 * window; closing one or two leaves the rest.
 */
export function looksLikeSwipe(before: readonly WindowInfo[], after: readonly WindowInfo[]): boolean {
  if (before.length === 0) return false;
  const now = new Map(after.map((w) => [w.id, w]));
  let gone = 0;
  const shifts: number[] = [];
  for (const w of before) {
    const a = now.get(w.id);
    if (!a) gone++;
    else if (a.bounds.x !== w.bounds.x || a.bounds.y !== w.bounds.y) shifts.push(a.bounds.x - w.bounds.x);
  }
  if (gone >= Math.max(1, before.length * 0.5)) return true;
  const first = shifts[0];
  return first !== undefined && shifts.length >= 2 && shifts.length >= (before.length - gone) * 0.6 && Math.abs(first) > 120 && shifts.every((d) => Math.abs(d - first) < 8);
}

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
  /** How each window moves, so things on it ride along, slide or fly off (motion.ts). */
  readonly motion = new WindowMotion();
  /**
   * Desktops (Spaces on the Mac). The animal lives on one of them: when you go to another, it stays
   * behind and goes on with its life there (its desktop's windows as you left them), and comes over
   * a while later, walking in from the side its desktop is on. What lies about stays on each desktop.
   */
  private home: { id: string; index: number } | null = null;
  private homeWorld: WorldSnapshot | null = null;
  private comeAtMs: number | null = null;
  private shownSpace: string | null = null;
  private messBySpace = new Map<string, MessState>();
  private desktopRng: Rng = seeded(4243);
  /**
   * The last window list it believed, and since when the list has looked like a desktop sliding
   * away (see steadied()).
   */
  private steady: WorldSnapshot | null = null;
  private shakySince: number | null = null;

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
    this.mess.toyKind = (opts.personality ?? DEFAULT_PERSONALITY).toy ?? "yarn";
    this.executor.props = () =>
      this.mess.props
        .filter((p) => p.state === "rest" && p.windowId !== null && p.alpha > 0.9 && !p.toy)
        .map((p) => ({ id: p.id, windowId: p.windowId as string, x: p.x }));
    this.executor.toyAt = () => {
      const t = this.mess.toy;
      return t ? { id: t.id, x: t.x, y: t.y, windowId: t.windowId, moving: t.state === "fall" || Math.abs(t.vx) > 25 } : null;
    };
    this.executor.glanceChance = 0.95 - 0.6 * (opts.personality ?? DEFAULT_PERSONALITY).aloofness;
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
    this.executor.glanceChance = 0.95 - 0.6 * p.aloofness;
    this.mess.toyKind = p.toy ?? "yarn";
  }

  /** The animal is on another desktop than the one you're looking at: don't draw it. */
  get away(): boolean {
    return this.homeWorld !== null;
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
  async step(live: WorldSnapshot, dtSec: number, execDtSec: number = dtSec): Promise<StepResult> {
    this.desktops(live);
    const seen = this.steadied(live);
    this.motion.update(seen.windows, execDtSec);
    // Away on its own desktop: it lives among that desktop's windows, and you and your cursor aren't there.
    const world: WorldSnapshot = this.homeWorld
      ? { ...live, windows: this.homeWorld.windows, frontApp: this.homeWorld.frontApp, cursor: { x: -100_000, y: -100_000 }, cursorSpeed: 0 }
      : seen;
    // How the window under it moves, before it is carried to where the window is now: thrown off
    // by a yank, it leaves from where it was, not from the window's new spot.
    if (!this.homeWorld) this.executor.ride(this.motion.of(this.executor.windowId), execDtSec);
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
    if (!this.homeWorld) this.bumpWhileRunning();
    const catX = this.executor.body.hidden || this.homeWorld ? null : this.executor.body.x;
    for (const ev of this.mess.step(execDtSec, seen, chaos, catX, (id) => this.motion.of(id))) this.onMess(ev, seen);
    return { mind: out, reflexes: [] };
  }

  /**
   * Mid-swipe from one desktop to the next, macOS already lists the next desktop's windows (or
   * slides them all along) while it still names the old desktop. Believed, the animal falls off a
   * window that is still there, and takes the next desktop's windows for its own. So a list that
   * looks like the desktop sliding away is held for up to a second: the desktop change shows up in
   * that time, or the change was real (an app hid its windows) and is believed after all.
   */
  private steadied(live: WorldSnapshot): WorldSnapshot {
    const prev = this.steady;
    if (prev && live.space && prev.space?.id === live.space.id && looksLikeSwipe(prev.windows, live.windows)) {
      this.shakySince ??= live.nowMs;
      if (live.nowMs - this.shakySince < SWIPE_HOLD_MS) return { ...live, windows: prev.windows, frontApp: prev.frontApp };
    }
    this.shakySince = null;
    this.steady = live;
    return live;
  }

  /** You gave a treat (or otherwise asked for it) while it was on another desktop: it comes now. */
  private callOver(now: number): void {
    if (this.homeWorld) this.comeAtMs = now;
  }

  /**
   * You went to another desktop: the animal stays where it was, and the mess of each desktop stays
   * on it. Back before it came over: there it is. Otherwise it comes over after a while (a needy
   * one soon, an aloof one when it feels like it, a sleeping one when it wakes up), from the side
   * its desktop is on: you swiped right, so it was to the left, so it comes in from the left.
   */
  private desktops(live: WorldSnapshot): void {
    const sp = live.space;
    if (!sp) return;
    const now = live.nowMs;
    if (this.shownSpace !== null && sp.id !== this.shownSpace) {
      this.messBySpace.set(this.shownSpace, this.mess.stash());
      this.mess.unstash(this.messBySpace.get(sp.id));
      this.messBySpace.delete(sp.id);
      // Only a few desktops are remembered.
      while (this.messBySpace.size > 8) this.messBySpace.delete(this.messBySpace.keys().next().value as string);
    }
    this.shownSpace = sp.id;
    if (!this.home) {
      this.home = { id: sp.id, index: sp.index };
      return;
    }
    if (sp.id === this.home.id) {
      if (this.homeWorld) {
        // Back on its desktop before it came over. The list may still be mid-swipe, so the windows it
        // knows are the ones to hold on to for a moment (steadied()).
        this.steady = { ...this.homeWorld, space: sp, nowMs: now };
        this.shakySince = null;
        this.homeWorld = null;
        this.comeAtMs = null;
      }
      return;
    }
    if (!this.homeWorld) {
      const b = this.executor.body;
      const onMain = b.x >= live.screen.x && b.x <= live.screen.x + live.screen.w;
      // Each display has its own desktops and it's on another display: this switch isn't its business.
      if ((!sp.spans && !onMain) || b.hidden || !this.lastWorld) {
        this.home = { id: sp.id, index: sp.index };
        return;
      }
      // Its desktop's windows as they were before the swipe began, not a list from half way through.
      this.homeWorld = this.steady && this.steady.space?.id === this.home.id ? this.steady : this.lastWorld;
      this.comeAtMs = null;
      this.mind.onDesktop(now, false);
    }
    // A Space where the animal's window isn't shown (an app in full screen, when the overlay stays
    // on every desktop at once): it never moves in, or it would be lost, even to a treat. It waits
    // on its own desktop, and the wait starts when you come to one it can be seen on.
    if (sp.hidden) {
      this.comeAtMs = null;
      return;
    }
    if (this.comeAtMs === null) {
      const p = this.mind.traits;
      const r = this.desktopRng;
      // Mostly a few seconds to half a minute; now and then (an aloof one more often) it takes its time.
      const slow = r.next() < 0.15 + 0.25 * p.aloofness;
      this.comeAtMs = now + (slow ? r.range(25, 60) : r.range(4, 15)) * 1000 * (0.5 + 1.8 * p.aloofness) / (0.6 + p.neediness);
    }
    if (now < this.comeAtMs) return;
    // Held or in the air: it comes as soon as it is back on its feet. Asleep: it sleeps on a little,
    // then wakes up to the quiet and comes looking (a nap can be half an hour, too long to wait).
    if (this.executor.airborne || this.executor.held) return;
    if (this.mind.sleeping) {
      if (now < this.comeAtMs + WAKE_TO_COME_MS) return;
      this.mind.wake(now);
    }
    const side: 1 | -1 = sp.index > this.home.index ? -1 : sp.index < this.home.index ? 1 : this.desktopRng.next() < 0.5 ? -1 : 1;
    this.home = { id: sp.id, index: sp.index };
    this.homeWorld = null;
    this.comeAtMs = null;
    this.executor.interrupt();
    this.syncWorld(live, true);
    this.executor.enterFrom(side);
    this.mind.onDesktop(now, true);
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
      else if (f.fx === "toy_out") this.mess.bringToy(ev.x, now);
      else if (f.fx === "bat") this.mess.bat(f.prop, ev.dir, f.strength);
    } else if (ev.type === "impact") {
      // Only a gremlin comes down hard enough to crack a window.
      // Not every landing, or the screen would be all cracks: one now and then.
      if (this.executor.wild >= 2 && ev.windowId && ev.speed > 1000 && now - this.lastCrackMs > 25_000 && this.messRng.next() < 0.6) {
        this.lastCrackMs = now;
        this.mess.crack(ev.windowId, ev.x, (ev.speed - 1000) / 800, now);
      }
    } else if (ev.type === "flung" || ev.type === "held_on") {
      this.mind.onJolt(now, ev.type === "flung");
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
    else if (ev.type === "flung") this.mind.note(now, `the human moved a window so hard the ${ev.kind} flew off it`);
  }

  /** A reflex happened (from the pointer or from a menu button). Runs the Mind's reaction and starts any intent. */
  react(kind: ReflexKind, world: WorldSnapshot, windowId?: string): MindEvent[] {
    const mind = this.mind.onReflex(kind, world, windowId);
    this.apply(mind);
    return mind;
  }

  /** Feed one pointer sample. Returns what the cat reacted to. */
  pointer(sample: PointerSample, world: WorldSnapshot): ReflexEvent[] {
    // On another desktop: nothing here to pet or pick up.
    if (this.homeWorld) return [];
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
    // On another desktop, a treat calls it over first.
    if (this.homeWorld) {
      this.callOver(world.nowMs);
      if (this.mind.sleeping) this.mind.wake(world.nowMs);
      this.desktops(world);
    }
    this.apply(this.mind.giveTreat(world));
  }
}
