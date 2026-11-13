import { Executor, type ExecEvent, type Fx } from "./executor";
import { Mess, TRASH_KINDS, type MessEvent, type MessState, type SpotKind, type TreatKind } from "./mess";
import { WindowMotion } from "./motion";
import { Governor } from "./governor";
import { InMemoryMemory, type Memory } from "./memory";
import { Mind, toyName, treatName, type MindEvent, type Ask } from "./mind";
import { RulesBrain, type Brain } from "./brain";
import type { ToyView } from "./rules";
import { DEFAULT_PERSONALITY, type Personality } from "./personality";
import { ReflexDetector, type PointerSample, type ReflexEvent, type ReflexKind } from "./reflexes";
import { seeded, type Rng } from "./rng";
import { instinctOf, type Kind } from "./species";
import { DEFAULT_SETTINGS, type Rect, type Settings, type WindowInfo, type WorldSnapshot } from "./types";

/** How long a window list that looks like a desktop swipe is held before it is believed. */
export const SWIPE_HOLD_MS = 1000;
/** What each kind of animal gets as a treat. */
export const TREAT_FOR: Record<Kind, TreatKind> = { cat: "fish_treat", dog: "biscuit", fox: "egg", raccoon: "grapes", rabbit: "strawberry", squirrel: "peanut" };
/** A treat held out this long without a click slips out of your fingers. */
export const TREAT_HOLD_MS = 45_000;
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
  /**
   * Don't wait for the brain: while the local model thinks (a second or more), the animal goes on
   * moving and its plan starts when the answer comes. The overlay and the playground use it; the
   * simulations wait, so a seeded run stays the same.
   */
  asyncMind?: boolean;
}

export interface StepResult {
  mind: MindEvent[];
  reflexes: ReflexEvent[];
}

/** A display, by where it is and its size, to tell its desktop apart from the other displays'. */
function displayKey(d: Rect): string {
  return `${Math.round(d.x)},${Math.round(d.y)},${Math.round(d.w)},${Math.round(d.h)}`;
}

/** Every display's desktop at once: a change is a switch somewhere. */
function desktopsOf(w: WorldSnapshot): string {
  return w.spaces?.length ? w.spaces.map((d) => d.id).join(",") : (w.space?.id ?? "");
}

/** A window is on the display its top edge's middle is on. */
function onDisplay(b: Rect, d: Rect): boolean {
  const cx = b.x + b.w / 2;
  return cx >= d.x && cx < d.x + d.w && b.y >= d.y - 1 && b.y <= d.y + d.h;
}

/** The display nearest to a point (one that is off every display: thrown, or hidden outside). */
function nearestDisplay<T extends Rect>(all: readonly T[], x: number, y: number): T {
  const gap = (d: Rect): number => Math.hypot(Math.max(d.x - x, 0, x - (d.x + d.w)), Math.max(d.y - y, 0, y - (d.y + d.h)));
  return all.reduce((a, b) => (gap(b) < gap(a) ? b : a));
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
  /** The colour of its loose fur, for a shake (ADR-067). */
  private fur = "#c9a27a";
  /** The chihuahua's blanket and the raccoon's snack box while they are out. */
  private blanketId: string | null = null;
  private snackId: string | null = null;
  private lastCrackMs = -1e12;
  private lastWindows: unknown = null;
  private lastDockTop = -1;
  /** The screen and the other displays it was handed last: a display plugged in or out changes them. */
  private lastScreens: unknown[] = [];
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
  private home: { id: string; index: number; display: string } | null = null;
  private homeWorld: WorldSnapshot | null = null;
  private comeAtMs: number | null = null;
  private shownSpace: string | null = null;
  /** With a desktop per display: the desktop each display showed last (by the display's rect). */
  private shownBy = new Map<string, string>();
  private messBySpace = new Map<string, MessState>();
  private desktopRng: Rng = seeded(4243);
  /**
   * The last window list it believed, and since when the list has looked like a desktop sliding
   * away (see steadied()).
   */
  private steady: WorldSnapshot | null = null;
  private shakySince: number | null = null;
  /** The brain's tick while the model thinks (asyncMind), what it decided meanwhile, and the time it missed. */
  private readonly asyncMind: boolean;
  private thinking: Promise<void> | null = null;
  private thought: MindEvent[] = [];
  private missedSec = 0;
  /** When you last threw the toy or put it down, and the pointer as it was last time (for grabbing the toy). */
  private toyThrownMs: number | null = null;
  private lastPointer: { t: number; down: boolean } | null = null;
  /** A press that was used up (it cleaned a spot, or let go of a treat): the rest of it, to the mouse-up, is not a poke. */
  private cleaning = false;
  /** When you took a treat out (it is in your hand until you click). */
  private treatOfferedMs: number | null = null;
  private readonly log?: (message: string, fields?: Record<string, unknown>) => void;

  constructor(opts: CatOptions = {}) {
    const rng = opts.rng ?? seeded(1);
    const settings: Settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.governor = new Governor(settings);
    this.executor = new Executor(rng, settings.size);
    this.executor.setInstinct(instinctOf(opts.personality ?? DEFAULT_PERSONALITY));
    // The mess has its own dice, so adding it doesn't change what the animal does in a seeded run.
    this.messRng = seeded(7919);
    this.mess = new Mess(this.messRng);
    this.mess.scale = this.executor.size.h / 90;
    this.mess.toyKind = (opts.personality ?? DEFAULT_PERSONALITY).toy ?? "yarn";
    this.fur = (opts.personality ?? DEFAULT_PERSONALITY).fur ?? this.fur;
    this.executor.props = () =>
      this.mess.props
        .filter((p) => p.state === "rest" && p.windowId !== null && p.alpha > 0.9 && !p.toy && !p.own)
        .map((p) => ({ id: p.id, windowId: p.windowId as string, x: p.x }));
    this.executor.toyAt = () => {
      const t = this.mess.toy;
      return t
        ? { id: t.id, x: t.x, y: t.y, windowId: t.windowId, moving: t.state === "fall" || Math.abs(t.vx) > 25, flying: t.state === "fall", held: t.state === "held", carried: t.state === "carried" }
        : null;
    };
    this.executor.treatAt = () => {
      // The nearest treat lying about first, else the one falling or in your hand.
      const b = this.executor.body;
      const all = this.mess.props.filter((p) => p.treat && (p.bites ?? 0) < 1);
      const down = all.filter((p) => p.state !== "held" && p.state !== "fall").sort((a, c) => Math.abs(a.x - b.x) - Math.abs(c.x - b.x));
      const t = down[0] ?? all.find((p) => p.state === "fall") ?? all[0];
      return t ? { id: t.id, x: t.x, y: t.y, windowId: t.windowId, moving: t.state === "fall" || Math.abs(t.vx) > 25, flying: t.state === "fall", held: t.state === "held" } : null;
    };
    this.asyncMind = opts.asyncMind ?? false;
    this.log = opts.log;
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
      toy: () => this.toyView(),
      scene: () => this.mess.seen(),
      log: opts.log,
      minDecisionGapMs: opts.minDecisionGapMs,
    });
    this.reflexes = new ReflexDetector(() => this.executor.hitRect());
  }

  /** Its toy as the brain sees it: where, and lying, rolling, in your hand, in its mouth or buried. */
  toyView(): ToyView | null {
    const t = this.mess.toy ?? this.mess.stashedToy;
    if (!t) return null;
    const now = this.lastWorld?.nowMs ?? 0;
    const state: ToyView["state"] =
      t.state === "held" ? "held" : t.state === "carried" ? "carried" : t.state === "stashed" ? "buried" : t.state === "fall" || Math.abs(t.vx) > 25 ? "rolling" : "lying";
    return { kind: t.kind, x: t.x, y: t.y, state, thrownSecAgo: this.toyThrownMs === null ? Infinity : Math.max(0, (now - this.toyThrownMs) / 1000) };
  }

  /** Is the brain waiting for the local model right now? */
  get pondering(): boolean {
    return this.thinking !== null;
  }

  get settings(): Settings {
    return this.governor.getSettings();
  }

  setPersonality(p: Personality): void {
    this.mind.setPersonality(p);
    this.executor.setInstinct(instinctOf(p));
    this.executor.glanceChance = 0.95 - 0.6 * p.aloofness;
    this.mess.toyKind = p.toy ?? "yarn";
    this.fur = p.fur ?? "#c9a27a";
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
    // A display plugged in or out while nothing else moved still changes where it can stand.
    const screensChanged = world.screen !== this.lastScreens[0] || world.displays !== this.lastScreens[1];
    if (force || screensChanged || world.windows !== this.lastWindows || world.dockTop !== this.lastDockTop) {
      const shape = shapeOf(world);
      this.lastWindows = world.windows;
      this.lastDockTop = world.dockTop;
      this.lastScreens = [world.screen, world.displays];
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
    // The treat in your hand stays at the pointer, every frame, until you click.
    if (this.mess.treatInHand) {
      this.mess.holdAt(live.cursor.x, live.cursor.y, execDtSec);
      if (this.treatOfferedMs !== null && live.nowMs - this.treatOfferedMs > TREAT_HOLD_MS) this.mess.letGo();
    }
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
    const mind = await this.think(world, dtSec, moving);
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
    // The toy in its mouth goes where its mouth goes; one it no longer holds drops.
    const carried = this.mess.props.find((p) => p.state === "carried");
    if (carried && this.executor.carrying === carried.id && !this.homeWorld) {
      const m = this.executor.mouth();
      this.mess.carryAt(m.x, m.y, this.executor.body.facing);
    } else if (carried?.own) this.mess.finishItem();
    else if (carried) this.mess.dropCarried(this.executor.body.facing);
    // Out from under its blanket some other way (a fright, a respect mode): the blanket shows again.
    const blanket = this.blanketId ? this.mess.props.find((p) => p.id === this.blanketId) : undefined;
    if (blanket?.hidden && this.executor.body.anim !== "burrow") this.mess.releaseOwn(blanket.id, world.nowMs, 60_000);
    if (!this.homeWorld) this.bumpWhileRunning();
    const catX = this.executor.body.hidden || this.homeWorld ? null : this.executor.body.x;
    for (const ev of this.mess.step(execDtSec, seen, chaos, catX, (id) => this.motion.of(id))) this.onMess(ev, seen);
    return { mind: out, reflexes: [] };
  }

  /**
   * One tick of the brain. Waited for, unless asyncMind: then a tick that has to wait for the local
   * model goes on by itself, and what it decides is handed over on a later frame. The animal keeps
   * moving meanwhile (the model used to freeze it for up to 8 s, seen in Abozar's log on 7 Nov 2026).
   */
  private async think(world: WorldSnapshot, dtSec: number, moving: boolean): Promise<MindEvent[]> {
    if (!this.asyncMind) return this.mind.tick(world, dtSec, moving, this.executor.held);
    if (this.thinking) {
      this.missedSec += dtSec;
      return [];
    }
    const out = this.thought.splice(0);
    let settled = false;
    let got: MindEvent[] = [];
    const task = this.mind.tick(world, dtSec + this.missedSec, moving, this.executor.held).then(
      (ev) => {
        settled = true;
        got = ev;
      },
      (err: unknown) => {
        settled = true;
        this.mind.note(world.nowMs, "my head went blank for a moment");
        void err;
      },
    );
    this.missedSec = 0;
    // A tick with no model call settles in a few microtasks: then it counts for this frame.
    for (let i = 0; i < 25 && !settled; i++) await Promise.resolve();
    if (settled) return [...out, ...got];
    this.thinking = task.then(() => {
      this.thought.push(...got);
      this.thinking = null;
    });
    return out;
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
    // With a desktop per display, only its own display's windows slide away on a swipe there.
    const rect = this.spaceHere(live)?.rect;
    const mine = (ws: readonly WindowInfo[]): readonly WindowInfo[] => (rect ? ws.filter((w) => onDisplay(w.bounds, rect)) : ws);
    const known = !!live.space || !!live.spaces?.length;
    if (prev && known && desktopsOf(prev) === desktopsOf(live) && looksLikeSwipe(mine(prev.windows), mine(live.windows))) {
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
   * What lies about stays on each desktop. One row of desktops for every display: all of it is put
   * away when you switch. A desktop per display: only what lies on the display that switched.
   */
  private swapMess(live: WorldSnapshot): void {
    const all = live.spaces;
    if (all && all.length > 0) {
      for (const d of all) {
        const key = displayKey(d);
        const was = this.shownBy.get(key);
        if (was !== undefined && was !== d.id) {
          this.messBySpace.set(was, this.mess.stash(d));
          this.mess.unstash(this.messBySpace.get(d.id), true);
          this.messBySpace.delete(d.id);
        }
        this.shownBy.set(key, d.id);
      }
    } else if (live.space) {
      const sp = live.space;
      if (this.shownSpace !== null && sp.id !== this.shownSpace) {
        this.messBySpace.set(this.shownSpace, this.mess.stash());
        this.mess.unstash(this.messBySpace.get(sp.id));
        this.messBySpace.delete(sp.id);
      }
      this.shownSpace = sp.id;
    }
    // Only a few desktops are remembered.
    while (this.messBySpace.size > 8) this.messBySpace.delete(this.messBySpace.keys().next().value as string);
  }

  /**
   * The desktop the animal goes by, and the display it is on. With a desktop per display (a Mac's
   * default) that is the one its own display shows, so a switch on a second display leaves it
   * behind too, and one on a display it isn't on is none of its business. Away on its own desktop,
   * it is the display it stayed behind on. With one row of desktops, it is that row.
   */
  private spaceHere(live: WorldSnapshot): { sp: NonNullable<WorldSnapshot["space"]>; display: string; rect?: Rect } | null {
    const all = live.spaces;
    if (all && all.length > 0) {
      const b = this.executor.body;
      // A little above the paws: on the floor of a display above the main one, the paws are on the edge between the two.
      const y = b.y - 4;
      const home = this.homeWorld && this.home ? all.find((d) => displayKey(d) === this.home?.display) : undefined;
      const mine = home ?? all.find((d) => b.x >= d.x && b.x < d.x + d.w && y >= d.y && y <= d.y + d.h) ?? nearestDisplay(all, b.x, y);
      return { sp: { id: mine.id, index: mine.index, spans: false, app: mine.app, hidden: mine.hidden }, display: displayKey(mine), rect: mine };
    }
    return live.space ? { sp: live.space, display: "all" } : null;
  }

  /**
   * You went to another desktop: the animal stays where it was, and the mess of each desktop stays
   * on it. Back before it came over: there it is. Otherwise it comes over after a while (a needy
   * one soon, an aloof one when it feels like it, a sleeping one when it wakes up), from the side
   * its desktop is on: you swiped right, so it was to the left, so it comes in from the left.
   */
  private desktops(live: WorldSnapshot): void {
    this.swapMess(live);
    const here = this.spaceHere(live);
    if (!here) return;
    const { sp, display } = here;
    const now = live.nowMs;
    if (!this.home) {
      this.home = { id: sp.id, index: sp.index, display };
      return;
    }
    if (sp.id === this.home.id) {
      if (this.homeWorld) {
        // Back on its desktop before it came over. The list may still be mid-swipe, so the windows it
        // knows are the ones to hold on to for a moment (steadied()).
        this.steady = { ...this.homeWorld, space: live.space, spaces: live.spaces, nowMs: now };
        this.shakySince = null;
        this.homeWorld = null;
        this.comeAtMs = null;
      }
      return;
    }
    if (!this.homeWorld) {
      const b = this.executor.body;
      const s = live.screen;
      const onMain = b.x >= s.x && b.x <= s.x + s.w && b.y - 4 >= s.y && b.y - 4 <= s.y + s.h;
      // It went over to another display (walked, jumped or was carried there): that display's
      // desktop is simply where it is now. Without a desktop per display known, a switch while
      // it's on another display than the main one isn't its business either.
      const moved = display !== this.home.display;
      if (moved || (!sp.spans && display === "all" && !onMain) || b.hidden || !this.lastWorld) {
        this.home = { id: sp.id, index: sp.index, display };
        return;
      }
      // Its desktop's windows as they were before the swipe began, not a list from half way through.
      this.homeWorld = this.steady && this.steadyHome() ? this.steady : this.lastWorld;
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
    this.home = { id: sp.id, index: sp.index, display };
    this.homeWorld = null;
    this.comeAtMs = null;
    this.executor.interrupt();
    this.syncWorld(live, true);
    // On the display you are on: its floor, or the Dock on the main display.
    this.executor.enterFrom(side, here.rect);
    this.mind.onDesktop(now, true);
  }

  /** The last window list it believed was read on its own desktop (not on the one you went to). */
  private steadyHome(): boolean {
    const st = this.steady;
    const home = this.home;
    if (!st || !home) return false;
    if (home.display === "all") return st.space?.id === home.id;
    return (st.spaces ?? []).some((d) => displayKey(d) === home.display && d.id === home.id);
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
      else if (f.fx === "bite") this.mess.bite(f.prop, f.amount);
      else if (f.fx === "pick_up") {
        // Gone by the time its mouth got there (you took it, or it rolled off): nothing in its mouth.
        if (!this.mess.carry(f.prop)) this.executor.carrying = null;
      } else if (f.fx === "drop_toy" && this.mess.props.find((p) => p.state === "carried")?.own) {
        this.mess.finishItem();
      } else if (f.fx === "drop_toy") {
        const kind = this.mess.props.find((p) => p.state === "carried")?.kind;
        this.mess.dropCarried(ev.dir);
        const doing = this.executor.intent?.intent;
        if (kind && doing === "fetch") this.mind.note(now, `i brought my ${toyName(kind)} back to you. throw it again.`);
        else if (kind && doing === "carry_toy") this.mind.note(now, `i took my ${toyName(kind)} away to a spot of my own`);
      } else if (f.fx === "bury") {
        const kind = (this.mess.props.find((p) => p.state === "carried") ?? this.mess.toy)?.kind;
        this.mess.bury();
        if (kind) this.mind.note(now, `i buried my ${toyName(kind)} where you can't find it`);
      } else if (f.fx === "potty") {
        // A puddle, or a pile that looks like the animal: a dog's swirl, a cat's log, a rabbit's pellets.
        const kind = instinctOf(this.mind.traits).kind;
        const pile: SpotKind = kind === "dog" ? "poop" : kind === "rabbit" ? "pellets" : kind === "squirrel" ? "pellets_row" : "poop_log";
        this.mess.relieve(f.kind === "pee" ? "puddle" : pile, ev.windowId, ev.x, now, f.sec);
        this.mind.relieved(f.kind, now);
      } else this.ownFx(f, ev, now);
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

  /** What each animal's own moves leave or set off (ADR-067): all drawn, nothing real is touched. */
  private ownFx(f: Fx, ev: Extract<ExecEvent, { type: "fx" }>, now: number): void {
    const sz = this.executor.size;
    const sc = this.mess.scale;
    const dir = ev.dir;
    const mid = ev.y - sz.h * 0.5;
    switch (f.fx) {
      case "shake":
        // Loose fur and a little dust, flying off all along the shake.
        if (this.fur !== "none") this.mess.puff("fur", ev.x, mid, 14, now, { spread: 150, up: 90, color: this.fur, overMs: 1000, w: sz.w / sc, h: sz.h * 0.5 / sc, size: 3.2 });
        this.mess.puff("dust", ev.x, ev.y - sz.h * 0.25, 5, now, { spread: 60, up: 30, overMs: 900, w: sz.w / sc, size: 4 });
        break;
      case "dirt": {
        // Out from under it, behind it, the way a digging animal throws it.
        const x = ev.x + dir * sz.w * 0.15;
        this.mess.spray("soil", x, ev.y, (-dir) as 1 | -1, f.n, now);
        this.mess.puff("dust", x, ev.y - 4 * sc, 3, now, { dir: (-dir) as 1 | -1, spread: 70, up: 30, size: 4 });
        break;
      }
      case "spot":
        this.mess.relieve(f.kind, ev.windowId, ev.x + dir * sz.w * f.ahead, now);
        break;
      case "splash":
        this.mess.puff("drop", ev.x + dir * sz.w * 0.45, ev.y - 4 * sc, 7, now, { spread: 70, up: 190, color: "#78bfea", overMs: 700, size: 2.2, floor: ev.y });
        break;
      case "item": {
        const m = this.executor.mouth();
        const p = this.mess.holdItem(f.kind, m.x, m.y, now);
        this.executor.carrying = p.id;
        break;
      }
      case "item_bite": {
        const kind = this.mess.props.find((p) => p.own && p.state === "carried")?.kind;
        this.mess.nibbleItem(f.amount, now, kind === "grapes" ? "#7b4a8f" : "#9a6a3c", ev.y);
        break;
      }
      case "item_done":
        this.mess.finishItem();
        this.executor.carrying = null;
        break;
      case "blanket": {
        const p = this.mess.putOwn("blanket", ev.windowId, ev.x + dir * sz.w * 0.7, now, 10 * 60_000);
        this.blanketId = p?.id ?? null;
        break;
      }
      case "blanket_in":
        if (this.blanketId) this.mess.hideOwn(this.blanketId, true, ev.x);
        break;
      case "blanket_out":
        if (this.blanketId) this.mess.releaseOwn(this.blanketId, now, 60_000);
        break;
      case "snack_box": {
        const p = this.mess.putOwn("snack_box", ev.windowId, ev.x + dir * sz.w * 0.5, now, 3 * 60_000);
        this.snackId = p?.id ?? null;
        break;
      }
      case "trash":
        this.mess.throwOut(this.messRng.pick(TRASH_KINDS), ev.x - dir * sz.w * 0.1, ev.y - sz.h * 0.75, (-dir) as 1 | -1, now);
        break;
      case "snack_done":
        if (this.snackId) this.mess.releaseOwn(this.snackId, now, 25_000);
        this.snackId = null;
        break;
      case "shiver":
        this.mess.puff("tremble", ev.x, mid, 10, now, { overMs: 2600, size: (sz.w * 0.42) / sc, w: 0, h: 10, ttlMs: 520 });
        break;
      case "thud": {
        const x = ev.x - dir * sz.w * 0.28;
        this.mess.puff("dust", x, ev.y - 2 * sc, 5, now, { spread: 80, up: 20, size: 4 });
        this.mess.puff("impact", x, ev.y - 6 * sc, 1, now, { size: 7, w: 0, h: 0, ttlMs: 320 });
        break;
      }
      case "nibble":
        if (ev.windowId) this.mess.biteMark(ev.windowId, ev.x + dir * sz.w * 0.42, now);
        this.mess.puff("crumb", ev.x + dir * sz.w * 0.42, ev.y - 2 * sc, 4, now, { spread: 40, up: 50, color: "#b9b2a6", size: 1.6, overMs: 500, floor: ev.y });
        break;
      default:
        break;
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
    // Something you threw that broke is said once, by thing_landed.
    if (ev.type === "broke" && !ev.thrown) this.mind.note(now, mine ? `i knocked the ${ev.kind} off. it broke.` : `the ${ev.kind} fell and broke`);
    else if (ev.type === "fell") this.mind.note(now, !mine ? `the ${ev.kind} fell off a window` : doing === "knock_off" ? `i pushed the ${ev.kind} off the edge` : `i ran into the ${ev.kind} and it went flying`);
    else if (ev.type === "thing_grabbed") this.mind.onThingGrabbed(world, ev);
    else if (ev.type === "thing_thrown") this.mind.onThingThrown(world, ev);
    else if (ev.type === "thing_landed") {
      // On another desktop it doesn't see it (the note still says what happened).
      this.apply(this.mind.onThingLanded(world, ev, this.executor.held || this.executor.airborne || !!this.homeWorld));
    }
    else if (ev.type === "cracked") this.mind.note(now, "i landed so hard a window cracked");
    else if (ev.type === "fly") this.mind.note(now, ev.caught ? "i caught a fly" : "a fly got away from me");
    else if (ev.type === "flung") this.mind.note(now, `the human moved a window so hard the ${ev.kind} flew off it`);
    else if (ev.type === "toy") this.mind.onToyLanded(world, ev);
    else if (ev.type === "toy_thrown") {
      // On another desktop, a toy thrown here calls it over, like a treat.
      if (this.homeWorld) {
        this.callOver(now);
        if (this.mind.sleeping) this.mind.wake(now);
      }
      this.apply(this.mind.onToyThrown(world, ev));
    } else if (ev.type === "toy_grabbed") this.mind.note(now, "the human picked up my toy");
    else if (ev.type === "treat_dropped") {
      this.treatOfferedMs = null;
      if (this.homeWorld) {
        this.callOver(now);
        if (this.mind.sleeping) this.mind.wake(now);
      }
      this.apply(this.mind.onTreatDropped(world, ev.kind));
    } else if (ev.type === "treat_landed") this.apply(this.mind.onTreatLanded(world, ev));
    else if (ev.type === "treat_eaten") {
      this.mind.ateTreat(world, ev.kind);
      // Another one still lying about: that one next.
      const more = this.mess.props.find((p) => p.treat && p.state !== "held" && (p.bites ?? 0) < 1);
      if (more) this.apply(this.mind.onTreatDropped(world, more.kind));
    }
  }

  /** "Throw its toy" (the menu): it drops out of your hand at the cursor, out of hiding if it was buried. */
  throwToy(world: WorldSnapshot): void {
    if (this.executor.carrying) this.executor.carrying = null;
    if (this.mess.toss(world.cursor.x, world.cursor.y, world.nowMs)) this.toyThrownMs = world.nowMs;
  }

  /**
   * Something you asked for in the menu on the animal (Pet it, Zoomies!, Nap time). It starts in this
   * frame, from the rules; the model is never asked. Respect modes still win (see Mind.onAsked).
   */
  ask(world: WorldSnapshot, what: Ask): MindEvent[] {
    const events = this.mind.onAsked(world, what);
    this.apply(events);
    return events;
  }

  /** A reflex happened (from the pointer or from a menu button). Runs the Mind's reaction and starts any intent. */
  react(kind: ReflexKind, world: WorldSnapshot, windowId?: string): MindEvent[] {
    const mind = this.mind.onReflex(kind, world, windowId);
    this.apply(mind);
    return mind;
  }

  /** Feed one pointer sample. Returns what the cat reacted to. */
  pointer(sample: PointerSample, world: WorldSnapshot): ReflexEvent[] {
    // The toy first: you can pick it up (out of its mouth too), carry it about and throw it, even
    // while the animal is on another desktop.
    const last = this.lastPointer;
    this.lastPointer = { t: sample.t, down: sample.down };
    if (this.cleaning) {
      if (!sample.down) this.cleaning = false;
      return [];
    }
    // A treat held out: the click lets it go, wherever you are (and nothing else happens with it).
    if (this.mess.treatInHand) {
      if (sample.down && !last?.down) {
        this.mess.letGo();
        this.cleaning = true;
      }
      return [];
    }
    if (this.mess.holding) {
      if (sample.down) this.mess.holdAt(sample.x, sample.y, last ? Math.max(0, (sample.t - last.t) / 1000) : 0);
      else if (this.mess.letGo()) this.toyThrownMs = world.nowMs;
      return [];
    }
    if (sample.down && !last?.down) {
      const t = this.mess.grabbableUnder(sample.x, sample.y);
      if (t) {
        if (t.state === "carried") {
          this.executor.carrying = null;
          this.mind.note(world.nowMs, `the human took my ${toyName(t.kind)} out of my mouth`);
        } else if (t.treat) this.mind.note(world.nowMs, `the human picked up my ${treatName(t.kind)}`);
        this.log?.("grab", { kind: t.kind, state: t.state });
        this.mess.grab(t.id, sample.x, sample.y);
        return [];
      }
    }
    // A click on a puddle or a pile (not on the animal) cleans it up.
    if (sample.down && last && !last.down && !this.executor.held) {
      const spot = this.mess.spotUnder(sample.x, sample.y);
      const r = this.executor.hitRect();
      const onAnimal = !this.executor.body.hidden && !this.homeWorld && sample.x >= r.x && sample.x <= r.x + r.w && sample.y >= r.y && sample.y <= r.y + r.h;
      if (spot && !onAnimal) {
        this.mess.cleanSpot(spot.id, world.nowMs);
        this.cleaning = true;
        if (!this.homeWorld) this.mind.note(world.nowMs, "the human cleaned up after me");
        return [];
      }
    }
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

  /** The puddles and piles you can click away (the overlay catches clicks there too). */
  get spotRects(): Rect[] {
    return this.mess.spots.filter((x) => x.cleanedMs === undefined).map((x) => this.mess.spotBox(x));
  }

  /** The toy's box on screen while it can be grabbed. */
  get toyRect(): Rect | null {
    const t = this.mess.toy;
    if (!t || t.alpha < 0.5) return null;
    return this.mess.toyBox(t);
  }

  /** Everything you can pick up with the mouse, as boxes on screen (the overlay lets clicks through everywhere else). */
  get grabRects(): Rect[] {
    return this.mess.grabbable.map((p) => this.mess.toyBox(p));
  }

  /**
   * Where its eyes go: anything flying through the air (a thing you threw, a mug it knocked off, its
   * toy, a treat), its toy or a treat rolling away, else the pointer (which is where a thing waved
   * in your hand is too).
   */
  lookAt(cursor: { x: number; y: number }): { x: number; y: number } {
    const t = this.mess.props.find((p) => p.alpha > 0.5 && (p.state === "fall" || ((p.toy || p.treat) && p.state === "roll" && Math.abs(p.vx) > 40)));
    return t ? { x: t.x, y: t.y - 8 * this.mess.scale } : cursor;
  }

  /** A treat is in your hand: the next click anywhere lets it go (the overlay catches that click). */
  get treatHeld(): boolean {
    return !!this.mess.treatInHand;
  }

  treat(world: WorldSnapshot): void {
    // On another desktop, a treat calls it over first.
    if (this.homeWorld) {
      this.callOver(world.nowMs);
      if (this.mind.sleeping) this.mind.wake(world.nowMs);
      this.desktops(world);
    }
    // A treat already in your hand: asking again lets it fall.
    if (this.mess.treatInHand) {
      this.mess.letGo();
      return;
    }
    if (this.mess.holding) this.mess.letGo();
    const kind = this.mind.traits.treat ?? TREAT_FOR[instinctOf(this.mind.traits).kind];
    if (!this.mess.offerTreat(kind, world.cursor.x, world.cursor.y, world.nowMs)) return;
    this.treatOfferedMs = world.nowMs;
    this.apply(this.mind.onTreatOffered(world, kind));
  }
}
