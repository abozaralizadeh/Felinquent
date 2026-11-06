import { buildPlatforms, segmentsOf, type Platform } from "./platforms";
import { PROP_ASPECT } from "./prop-aspect";
import type { Rng } from "./rng";
import type { ChaosLevel, WindowInfo, WorldSnapshot } from "./types";

/**
 * The mess a gremlin makes, drawn over the desktop and never touching another app (hard rules 2
 * and 3): a few small things standing on window tops that it knocks off and that break, cracks in
 * a window's "glass" after a hard landing, claw marks and strips torn off a title bar, and a fly to
 * hunt. Everything here is plain geometry and physics; src/playground/mess-draw.ts draws it.
 * Abozar asked for a chaos level where it "can run around and break things" (6 Nov 2026).
 */
export type PropKind = "mug" | "glass" | "plant" | "vase" | "yarn" | "pencils" | "teacup" | "duck" | "mouse";
export const PROP_KINDS: readonly PropKind[] = ["mug", "glass", "plant", "vase", "yarn", "pencils", "teacup", "duck", "mouse"];
/** Height in pixels at the medium size. The drawing keeps its own proportions. */
export const PROP_HEIGHT: Record<PropKind, number> = { mug: 30, glass: 34, plant: 40, vase: 42, yarn: 26, pencils: 46, teacup: 24, duck: 28, mouse: 18 };
/** What shatters when it lands hard. The rest bounces (and the yarn rolls). */
export const FRAGILE: ReadonlySet<PropKind> = new Set<PropKind>(["mug", "glass", "plant", "vase", "teacup", "pencils"]);

export interface Prop {
  id: string;
  kind: PropKind;
  /** The window it stands on; x is kept as an offset from that window's left edge, so it rides along. */
  windowId: string | null;
  offset: number;
  /** Bottom centre, screen coordinates. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** rest: standing; slide: being pushed; teeter: on the edge; fall: in the air; settled: down and still. */
  state: "rest" | "slide" | "teeter" | "fall" | "settled";
  alpha: number;
  bornMs: number;
  /** When it came to rest after a fall: it fades out a while later. */
  settledMs?: number;
  /** Seconds left wobbling on the edge, and which way it will go. */
  teeter: number;
  dir: 1 | -1;
  /** Pixels still to slide from the last nudge of a paw. */
  slideLeft: number;
  /** The edge it is teetering on. */
  edge?: number;
  /** The yarn leaves a thread behind it. */
  trail?: { x: number; y: number }[];
}

/** One piece of something broken: a polygon cut from the drawing (in 0..1 of its box), or a bit of glass, soil or water. */
export interface Shard {
  kind: PropKind | "sliver" | "soil" | "water";
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  /** The piece in the prop's own box, 0..1, as x,y pairs; and its centre there. */
  poly: number[];
  cx: number;
  cy: number;
  /** The prop's box in pixels, so a piece is drawn at the right size. */
  w: number;
  h: number;
  settled: boolean;
  settledMs?: number;
  bornMs: number;
}

/** A mark on a window: it rides with the window and fades away. dx, dy are from the window's top left. */
export interface Decal {
  id: number;
  kind: "crack" | "claw" | "chip";
  windowId: string;
  dx: number;
  dy: number;
  size: number;
  seed: number;
  bornMs: number;
  ttlMs: number;
}

/** A strip torn off a title bar, fluttering down. */
export interface Strip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  seed: number;
  settled: boolean;
  settledMs?: number;
  bornMs: number;
}

export interface Fly {
  x: number;
  y: number;
  /** Where it buzzes around, and its own clock. */
  homeX: number;
  homeY: number;
  t: number;
  state: "buzz" | "flee" | "caught";
  /** Decided when the hunt starts: does the pounce get it? */
  willBeCaught: boolean;
  bornMs: number;
}

export type MessEvent =
  | { type: "broke"; kind: PropKind; x: number; y: number }
  | { type: "fell"; kind: PropKind }
  | { type: "cracked"; windowId: string }
  | { type: "fly"; caught: boolean };

const GRAVITY = 2000;
const MAX_SHARDS = 160;
const MAX_STRIPS = 40;
/** Things on the floor (the Dock) fade after this long, so the desktop cleans itself up. */
const FLOOR_LINGER_MS = 45_000;
const FADE_MS = 4_000;
/** How many things stand on windows at once, and how often a new one shows up. */
const CLUTTER: Record<ChaosLevel, { max: number; every: [number, number] }> = {
  chill: { max: 0, every: [600, 900] },
  normal: { max: 1, every: [120, 300] },
  gremlin: { max: 3, every: [30, 90] },
};

/** Cuts the unit square into convex pieces around random points (a Voronoi split). */
export function shatterPieces(n: number, rng: Rng, impact = { x: 0.5, y: 1 }): number[][] {
  // More points near where it hit, so the pieces there are smaller, like real breakage.
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const near = rng.next() < 0.5;
    pts.push(near ? { x: clamp01(impact.x + rng.range(-0.3, 0.3)), y: clamp01(impact.y + rng.range(-0.35, 0)) } : { x: rng.next(), y: rng.next() });
  }
  return pts.map((p, i) => {
    let poly = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let j = 0; j < pts.length && poly.length >= 6; j++) {
      if (j === i) continue;
      const q = pts[j] as { x: number; y: number };
      // Keep the half of the plane closer to p than to q.
      const nx = q.x - p.x;
      const ny = q.y - p.y;
      const c = (q.x * q.x + q.y * q.y - p.x * p.x - p.y * p.y) / 2;
      poly = clipHalf(poly, nx, ny, c);
    }
    return poly;
  }).filter((poly) => poly.length >= 6);
}

const clamp01 = (v: number): number => Math.max(0.02, Math.min(0.98, v));

/** Clips a polygon to the half plane nx*x + ny*y <= c. */
function clipHalf(poly: number[], nx: number, ny: number, c: number): number[] {
  const out: number[] = [];
  const n = poly.length / 2;
  for (let k = 0; k < n; k++) {
    const ax = poly[2 * k] as number;
    const ay = poly[2 * k + 1] as number;
    const bx = poly[(2 * ((k + 1) % n)) as number] as number;
    const by = poly[(2 * ((k + 1) % n) + 1) as number] as number;
    const da = nx * ax + ny * ay - c;
    const db = nx * bx + ny * by - c;
    if (da <= 0) out.push(ax, ay);
    if (da * db < 0) {
      const t = da / (da - db);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

function centroid(poly: number[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const n = poly.length / 2;
  for (let k = 0; k < n; k++) {
    x += poly[2 * k] as number;
    y += poly[2 * k + 1] as number;
  }
  return { x: x / n, y: y / n };
}

/** The platform a falling thing at x crosses between y0 and y1, if any (the highest one). */
function landingOn(platforms: Platform[], x: number, y0: number, y1: number): Platform | undefined {
  let hit: Platform | undefined;
  for (const p of platforms) {
    if (x < p.x1 || x > p.x2) continue;
    if (y0 <= p.y + 0.5 && y1 >= p.y && (!hit || p.y < hit.y)) hit = p;
  }
  return hit;
}

export class Mess {
  props: Prop[] = [];
  shards: Shard[] = [];
  decals: Decal[] = [];
  strips: Strip[] = [];
  fly: Fly | null = null;
  private nextId = 1;
  private nextSpawnMs: number | null = null;
  private platforms: Platform[] = [];
  private world: WorldSnapshot | null = null;
  private outbox: MessEvent[] = [];
  /** Size of everything, with the animal's size (S, M, L). */
  scale = 1;
  /** The left and right edges of all the displays: things bounce off them instead of falling out of sight. */
  private wallL = -Infinity;
  private wallR = Infinity;

  constructor(private rng: Rng) {}

  /** Clears everything (panic, shoo, chill). */
  clear(): void {
    this.props = [];
    this.shards = [];
    this.decals = [];
    this.strips = [];
    this.fly = null;
  }

  /** A resting prop on this window, the one nearest x if there are several. */
  propOn(windowId: string, x?: number): Prop | undefined {
    const on = this.props.filter((p) => p.state === "rest" && p.windowId === windowId && p.alpha > 0.9);
    if (x === undefined) return on[0];
    return on.sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  }

  /** Windows that have something on them that could be knocked off. */
  /** "mug on w3": what stands where, for the model (no titles, only ids). */
  thingsOnWindows(): string[] {
    return this.props.filter((p) => p.state === "rest" && p.windowId && p.alpha > 0.9).map((p) => `${p.kind} on ${p.windowId}`);
  }

  windowsWithProps(): string[] {
    return [...new Set(this.props.filter((p) => p.state === "rest" && p.windowId && p.alpha > 0.9).map((p) => p.windowId as string))];
  }

  /** Puts a thing on a window top now (also used by tests and the playground). */
  place(kind: PropKind, windowId: string, x: number, nowMs: number): Prop | null {
    const world = this.world;
    const win = world?.windows.find((w) => w.id === windowId);
    if (!win) return null;
    const p: Prop = {
      id: `p${this.nextId++}`,
      kind,
      windowId,
      offset: x - win.bounds.x,
      x,
      y: win.bounds.y,
      vx: 0,
      vy: 0,
      rot: 0,
      vr: 0,
      state: "rest",
      alpha: 0,
      bornMs: nowMs,
      teeter: 0,
      dir: 1,
      slideLeft: 0,
    };
    this.props.push(p);
    return p;
  }

  /** A push with the paw: it slides px that way (about half a second), and if that takes it past the edge it goes over. */
  nudge(id: string, dir: 1 | -1, px: number): void {
    const p = this.props.find((q) => q.id === id);
    if (!p || (p.state !== "rest" && p.state !== "slide")) return;
    p.state = "slide";
    p.dir = dir;
    p.slideLeft = px;
  }

  /** A tap with the paw: a little wobble, nothing more. */
  tap(id: string, dir: 1 | -1): void {
    const p = this.props.find((q) => q.id === id);
    if (p && p.state === "rest") p.vr = dir * 1.6;
  }

  /** Knocked by a running animal: it flies off the way the animal was going. */
  bump(id: string, dir: 1 | -1): void {
    const p = this.props.find((q) => q.id === id);
    if (!p || (p.state !== "rest" && p.state !== "settled")) return;
    p.state = "fall";
    p.windowId = null;
    p.vx = dir * this.rng.range(160, 260);
    p.vy = -this.rng.range(120, 260);
    p.vr = dir * this.rng.range(6, 11);
    this.outbox.push({ type: "fell", kind: p.kind });
  }

  /**
   * A hard landing on a window: the "glass" cracks where it landed, and the harder the landing the
   * bigger the crack. A few slivers fall out of it.
   */
  crack(windowId: string, x: number, strength: number, nowMs: number): void {
    const win = this.world?.windows.find((w) => w.id === windowId);
    if (!win) return;
    const size = (40 + 60 * Math.min(1, strength)) * this.scale;
    this.decals.push({ id: this.nextId++, kind: "crack", windowId, dx: x - win.bounds.x, dy: 3, size, seed: this.rng.next(), bornMs: nowMs, ttlMs: this.rng.range(40_000, 60_000) });
    const n = Math.round(2 + 4 * Math.min(1, strength));
    for (let i = 0; i < n; i++) this.glassSliver(x + this.rng.range(-size * 0.4, size * 0.4), win.bounds.y + this.rng.range(6, size * 0.5), nowMs);
    this.outbox.push({ type: "cracked", windowId });
  }

  /** Claws dug into a title bar: scratch marks, and strips of it torn off that flutter down. */
  claw(windowId: string, x: number, dir: 1 | -1, nowMs: number): void {
    const win = this.world?.windows.find((w) => w.id === windowId);
    if (!win) return;
    this.decals.push({ id: this.nextId++, kind: "claw", windowId, dx: x - win.bounds.x, dy: 2, size: 34 * this.scale, seed: this.rng.next(), bornMs: nowMs, ttlMs: this.rng.range(50_000, 70_000) });
    if (this.rng.next() < 0.6) {
      this.decals.push({ id: this.nextId++, kind: "chip", windowId, dx: x - win.bounds.x + dir * 8 * this.scale, dy: 0, size: this.rng.range(10, 18) * this.scale, seed: this.rng.next(), bornMs: nowMs, ttlMs: this.rng.range(50_000, 70_000) });
    }
    const n = Math.round(this.rng.range(2, 4));
    for (let i = 0; i < n && this.strips.length < MAX_STRIPS; i++) {
      this.strips.push({
        x: x + this.rng.range(-10, 10) * this.scale,
        y: win.bounds.y + this.rng.range(2, 10),
        vx: dir * this.rng.range(10, 50),
        vy: this.rng.range(-40, 10),
        rot: this.rng.range(-0.5, 0.5),
        vr: this.rng.range(-3, 3),
        w: this.rng.range(5, 10) * this.scale,
        h: this.rng.range(14, 26) * this.scale,
        seed: this.rng.next(),
        settled: false,
        bornMs: nowMs,
      });
    }
  }

  /** A fly comes in from that side and buzzes about (x, y). */
  flyIn(x: number, y: number, from: 1 | -1, willBeCaught: boolean, nowMs: number): void {
    this.fly = { x: x + from * 320, y: y - 160, homeX: x, homeY: y, t: 0, state: "buzz", willBeCaught, bornMs: nowMs };
  }

  /** The pounce: the fly is caught (and gone) or it gets away. */
  pounceFly(): void {
    const f = this.fly;
    if (!f || f.state !== "buzz") return;
    f.state = f.willBeCaught ? "caught" : "flee";
    this.outbox.push({ type: "fly", caught: f.willBeCaught });
  }

  /** Bounces a moving thing off the outer edges of the displays. */
  private wall(o: { x: number; vx: number }): void {
    if (o.x < this.wallL) ((o.x = this.wallL), (o.vx = Math.abs(o.vx) * 0.35));
    else if (o.x > this.wallR) ((o.x = this.wallR), (o.vx = -Math.abs(o.vx) * 0.35));
  }

  private glassSliver(x: number, y: number, nowMs: number): void {
    if (this.shards.length >= MAX_SHARDS) return;
    const r = this.rng;
    const s = r.range(5, 13) * this.scale;
    const poly = [0, 0, r.range(0.6, 1), r.range(0, 0.4), r.range(0.2, 0.8), 1];
    const c = centroid(poly);
    this.shards.push({ kind: "sliver", x, y, vx: r.range(-60, 60), vy: r.range(-60, 30), rot: r.range(0, 6), vr: r.range(-8, 8), poly, cx: c.x, cy: c.y, w: s, h: s * 1.4, settled: false, bornMs: nowMs });
  }

  private releaseSlide(p: Prop, letGo: boolean): void {
    const segs = p.windowId ? segmentsOf(this.platforms, p.windowId) : [];
    const seg = segs.find((s) => p.x >= s.x1 && p.x <= s.x2);
    if (!seg || (p.dir === 1 && p.x > seg.x2 - 6) || (p.dir === -1 && p.x < seg.x1 + 6)) {
      p.state = "teeter";
      p.teeter = this.rng.range(0.35, 0.7);
      p.edge = seg ? (p.dir === 1 ? seg.x2 : seg.x1) : p.x;
      return;
    }
    if (letGo) {
      p.state = "rest";
      const win = this.world?.windows.find((w) => w.id === p.windowId);
      if (win) p.offset = p.x - win.bounds.x;
    }
  }

  private breakProp(p: Prop, nowMs: number): void {
    const h = PROP_HEIGHT[p.kind] * this.scale;
    const w = h * (PROP_ASPECT[p.kind] ?? 1);
    const pieces = shatterPieces(p.kind === "glass" ? 9 : p.kind === "pencils" ? 5 : 7, this.rng, { x: 0.5, y: 0.95 });
    for (const poly of pieces) {
      if (this.shards.length >= MAX_SHARDS) break;
      const c = centroid(poly);
      const ox = (c.x - 0.5) * w;
      const oy = -(1 - c.y) * h;
      this.shards.push({
        kind: p.kind,
        x: p.x + ox,
        y: p.y + oy,
        vx: ox * this.rng.range(3, 7) + p.vx * 0.3,
        vy: -this.rng.range(140, 340),
        rot: p.rot,
        vr: this.rng.range(-9, 9),
        poly,
        cx: c.x,
        cy: c.y,
        w,
        h,
        settled: false,
        bornMs: nowMs,
      });
    }
    // A glass spills its water, a pot its soil.
    const spill = p.kind === "glass" ? "water" : p.kind === "plant" ? "soil" : null;
    if (spill) {
      for (let i = 0; i < 10 && this.shards.length < MAX_SHARDS; i++) {
        const s = this.rng.range(2, 5) * this.scale;
        this.shards.push({ kind: spill, x: p.x + this.rng.range(-6, 6), y: p.y - 4, vx: this.rng.range(-160, 160), vy: -this.rng.range(60, 220), rot: 0, vr: 0, poly: [], cx: 0, cy: 0, w: s, h: s, settled: false, bornMs: nowMs });
      }
    }
    this.outbox.push({ type: "broke", kind: p.kind, x: p.x, y: p.y });
  }

  /** Runs one frame: new clutter now and then, things riding their windows, falling, breaking and fading. */
  step(dt: number, world: WorldSnapshot, chaos: ChaosLevel, catX: number | null): MessEvent[] {
    const now = world.nowMs;
    if (this.world === null || world.windows !== this.world.windows || world.dockTop !== this.world.dockTop) this.platforms = buildPlatforms(world);
    this.world = world;
    const all = [world.screen, ...(world.displays ?? [])];
    this.wallL = Math.min(...all.map((d) => d.x)) + 4;
    this.wallR = Math.max(...all.map((d) => d.x + d.w)) - 4;
    this.spawn(world, chaos, catX);
    this.stepProps(dt, world);
    this.stepShards(dt, world);
    this.stepStrips(dt, world);
    this.stepFly(dt);
    // Marks fade and go with their window.
    this.decals = this.decals.filter((d) => now - d.bornMs < d.ttlMs && world.windows.some((w) => w.id === d.windowId));
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private spawn(world: WorldSnapshot, chaos: ChaosLevel, catX: number | null): void {
    const now = world.nowMs;
    const c = CLUTTER[chaos];
    // Chill: no clutter. What stands about fades away.
    if (chaos === "chill") {
      for (const p of this.props) if (p.state === "rest") ((p.state = "settled"), (p.settledMs = now - FLOOR_LINGER_MS));
    }
    if (this.nextSpawnMs === null) this.nextSpawnMs = now + this.rng.range(20, 60) * 1000;
    const standing = this.props.filter((p) => p.state === "rest" || p.state === "slide" || p.state === "teeter").length;
    if (standing >= c.max || now < this.nextSpawnMs) return;
    this.nextSpawnMs = now + this.rng.range(c.every[0], c.every[1]) * 1000;
    // A wide enough stretch of a window top, not right where the animal is or another thing stands.
    const spots = this.platforms.filter((p) => p.kind === "window_top" && p.x2 - p.x1 >= 180);
    if (spots.length === 0) return;
    const seg = this.rng.pick(spots);
    const x = this.rng.range(seg.x1 + 40, seg.x2 - 40);
    if (catX !== null && Math.abs(x - catX) < 90) return;
    if (this.props.some((p) => p.state === "rest" && Math.abs(p.x - x) < 70 && p.windowId === seg.windowId)) return;
    this.place(this.rng.pick(PROP_KINDS), seg.windowId as string, x, now);
  }

  private stepProps(dt: number, world: WorldSnapshot): void {
    const now = world.nowMs;
    const windows = new Map<string, WindowInfo>(world.windows.map((w) => [w.id, w]));
    for (const p of this.props) {
      if (p.state === "rest" || p.state === "slide" || p.state === "teeter") {
        const win = p.windowId ? windows.get(p.windowId) : undefined;
        if (!win) {
          // Its window closed (or went away): down it goes.
          p.state = "fall";
          p.windowId = null;
          p.vx = this.rng.range(-30, 30);
          p.vr = this.rng.range(-3, 3);
          this.outbox.push({ type: "fell", kind: p.kind });
          continue;
        }
        if (p.state === "rest") p.x = win.bounds.x + p.offset;
        else p.offset = p.x - win.bounds.x;
        p.y = win.bounds.y;
        // Hidden behind a window in front: fade out until it shows again.
        const visible = segmentsOf(this.platforms, win.id).some((s) => p.x >= s.x1 - 4 && p.x <= s.x2 + 4);
        p.alpha = Math.max(0, Math.min(1, p.alpha + (visible ? dt / 1.2 : -dt / 0.25)));
        // A tap's wobble dies down.
        p.rot += p.vr * dt;
        p.vr += (-p.rot * 60 - p.vr * 6) * dt;
        if (p.state === "slide") {
          const step = Math.min(p.slideLeft, dt * 70 * this.scale + p.slideLeft * dt * 3);
          p.x += p.dir * step;
          p.slideLeft -= step;
          p.offset = p.x - win.bounds.x;
          if (p.slideLeft <= 0.01) this.releaseSlide(p, true);
          else this.releaseSlide(p, false);
        }
        if (p.state === "teeter") {
          p.teeter -= dt;
          p.rot = p.dir * (0.12 + 0.18 * Math.abs(Math.sin(now / 90)));
          if (p.teeter <= 0) {
            p.state = "fall";
            p.windowId = null;
            // Over the edge, so it doesn't land back where it stood.
            p.x = (p.edge ?? p.x) + p.dir * 3;
            p.vx = p.dir * this.rng.range(30, 70);
            p.vy = 0;
            p.vr = p.dir * this.rng.range(3, 6);
            this.outbox.push({ type: "fell", kind: p.kind });
          }
        }
        continue;
      }
      if (p.state === "fall") {
        const y0 = p.y;
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        this.wall(p);
        if (p.kind === "yarn") (p.trail ??= []).push({ x: p.x, y: p.y - 6 });
        const hit = landingOn(this.platforms, p.x, y0, p.y) ?? (p.y > world.dockTop ? this.platforms.find((q) => q.id === "dock") : undefined);
        if (!hit) {
          if (p.y > world.screen.y + world.screen.h + 200) p.alpha = 0;
          continue;
        }
        p.y = hit.y;
        if (FRAGILE.has(p.kind) && p.vy > 520) {
          this.breakProp(p, now);
          p.alpha = 0;
          continue;
        }
        // Bounces: less each time, until it lies there.
        p.vy = -p.vy * (p.kind === "duck" || p.kind === "yarn" ? 0.45 : 0.3);
        p.vx *= 0.6;
        p.vr *= 0.5;
        if (Math.abs(p.vy) < 90) {
          p.state = "settled";
          p.settledMs = now;
          p.vy = 0;
          p.rot = p.kind === "yarn" ? p.rot : p.kind === "mouse" || p.kind === "duck" ? p.dir * 0.3 : Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2);
          // Landed on another window's top: it stands there now and can be knocked off again.
          if (hit.windowId && Math.abs(p.rot) < 0.01) {
            const win = windows.get(hit.windowId);
            p.state = "rest";
            p.windowId = hit.windowId;
            p.offset = p.x - (win?.bounds.x ?? 0);
          }
        }
        continue;
      }
      if (p.state === "settled") {
        // The yarn rolls on a bit, unwinding.
        if (p.kind === "yarn" && Math.abs(p.vx) > 4) {
          p.x += p.vx * dt;
          this.wall(p);
          p.rot += (p.vx * dt) / (PROP_HEIGHT.yarn * this.scale * 0.5);
          p.vx *= Math.pow(0.35, dt);
          (p.trail ??= []).push({ x: p.x, y: p.y - 3 });
          if (p.trail.length > 240) p.trail.shift();
        }
        if (p.settledMs !== undefined && now - p.settledMs > FLOOR_LINGER_MS) p.alpha = Math.max(0, 1 - (now - p.settledMs - FLOOR_LINGER_MS) / FADE_MS);
      }
    }
    // Gone (broken, faded, or fell off the screen). One still fading in, or hidden behind a window, stays.
    this.props = this.props.filter((p) => p.alpha > 0 || p.state === "rest" || p.state === "slide" || p.state === "teeter");
  }

  private stepShards(dt: number, world: WorldSnapshot): void {
    const now = world.nowMs;
    for (const s of this.shards) {
      if (s.settled) continue;
      const y0 = s.y;
      // Water and soil fall straight; a sliver of glass also drifts a little.
      s.vy += GRAVITY * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      this.wall(s);
      const hit = landingOn(this.platforms, s.x, y0, s.y) ?? (s.y > world.dockTop ? this.platforms.find((q) => q.id === "dock") : undefined);
      if (!hit) continue;
      s.y = hit.y;
      if (s.kind === "water" || s.kind === "soil" || Math.abs(s.vy) < 120) {
        s.settled = true;
        s.settledMs = now;
        s.vy = 0;
        continue;
      }
      s.vy = -s.vy * 0.25;
      s.vx *= 0.5;
      s.vr *= 0.4;
    }
    this.shards = this.shards.filter((s) => !(s.settled && s.settledMs !== undefined && now - s.settledMs > FLOOR_LINGER_MS + FADE_MS) && s.y < world.screen.y + world.screen.h + 400);
  }

  private stepStrips(dt: number, world: WorldSnapshot): void {
    const now = world.nowMs;
    for (const s of this.strips) {
      if (s.settled) continue;
      const y0 = s.y;
      // Light and flat: it falls slowly and sways from side to side.
      s.vy += (GRAVITY * 0.25 - s.vy * 2.2) * dt;
      const sway = Math.sin((now - s.bornMs) / 260 + s.seed * 6) * 70;
      s.x += (s.vx + sway) * dt;
      s.y += s.vy * dt;
      this.wall(s);
      s.rot = Math.sin((now - s.bornMs) / 300 + s.seed * 5) * 0.9;
      const hit = landingOn(this.platforms, s.x, y0, s.y) ?? (s.y > world.dockTop ? this.platforms.find((q) => q.id === "dock") : undefined);
      if (hit && s.vy > 0) {
        s.y = hit.y;
        s.settled = true;
        s.settledMs = now;
        s.rot = Math.PI / 2 + (s.seed - 0.5) * 0.4;
      }
    }
    this.strips = this.strips.filter((s) => !(s.settled && s.settledMs !== undefined && now - s.settledMs > FLOOR_LINGER_MS + FADE_MS));
  }

  private stepFly(dt: number): void {
    const f = this.fly;
    if (!f) return;
    f.t += dt;
    if (f.state === "buzz") {
      // Never quite still, never in a straight line.
      const tx = f.homeX + Math.sin(f.t * 2.3) * 40 + Math.sin(f.t * 7.1) * 9;
      const ty = f.homeY + Math.sin(f.t * 3.1 + 1) * 22 + Math.cos(f.t * 8.3) * 6;
      f.x += (tx - f.x) * Math.min(1, dt * 4);
      f.y += (ty - f.y) * Math.min(1, dt * 4);
    } else if (f.state === "flee") {
      f.x += 380 * dt * (f.x >= f.homeX ? 1 : -1);
      f.y -= 260 * dt;
      if (f.t > 30 || f.y < -200) this.fly = null;
    } else {
      this.fly = null;
    }
    if (f.t > 90) this.fly = null;
  }

  /** Where the fly is, for the animal to look at and leap toward. */
  get flyAt(): { x: number; y: number } | null {
    return this.fly && this.fly.state === "buzz" ? { x: this.fly.x, y: this.fly.y } : null;
  }

  /** A copy for drawing (and for the windows on other displays). */
  snapshot(): MessSnapshot {
    return {
      props: this.props.filter((p) => p.alpha > 0).map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, rot: p.rot, alpha: p.alpha, trail: p.trail?.slice(-160) })),
      shards: this.shards.map((s) => ({ kind: s.kind, x: s.x, y: s.y, rot: s.rot, poly: s.poly, cx: s.cx, cy: s.cy, w: s.w, h: s.h, alpha: s.settled && s.settledMs !== undefined ? fade(this.world?.nowMs ?? 0, s.settledMs) : 1 })),
      decals: this.decals.map((d) => ({ ...d, alpha: Math.min(1, ((d.bornMs + d.ttlMs) - (this.world?.nowMs ?? 0)) / 6000) })),
      strips: this.strips.map((s) => ({ x: s.x, y: s.y, rot: s.rot, w: s.w, h: s.h, seed: s.seed, alpha: s.settled && s.settledMs !== undefined ? fade(this.world?.nowMs ?? 0, s.settledMs) : 1 })),
      fly: this.fly ? { x: this.fly.x, y: this.fly.y, t: this.fly.t } : null,
    };
  }
}

const fade = (now: number, settledMs: number): number => Math.max(0, Math.min(1, 1 - (now - settledMs - FLOOR_LINGER_MS) / FADE_MS));

export interface MessSnapshot {
  props: { id: string; kind: PropKind; x: number; y: number; rot: number; alpha: number; trail?: { x: number; y: number }[] }[];
  shards: { kind: Shard["kind"]; x: number; y: number; rot: number; poly: number[]; cx: number; cy: number; w: number; h: number; alpha: number }[];
  decals: (Decal & { alpha: number })[];
  strips: { x: number; y: number; rot: number; w: number; h: number; seed: number; alpha: number }[];
  fly: { x: number; y: number; t: number } | null;
}
