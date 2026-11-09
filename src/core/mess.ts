import { GRIP, type WinMotion } from "./motion";
import { buildPlatforms, segmentsOf, type Platform } from "./platforms";
import { PROP_ASPECT } from "./prop-aspect";
import type { Rng } from "./rng";
import { toyName, treatName } from "./summary";
import type { ChaosLevel, SeenThing, WindowInfo, WorldSnapshot } from "./types";

/**
 * The mess a gremlin makes, drawn over the desktop and never touching another app (hard rules 2
 * and 3): a few small things standing on window tops that it knocks off and that break, cracks in
 * a window's "glass" after a hard landing, claw marks and strips torn off a title bar, and a fly to
 * hunt. Everything here is plain geometry and physics; src/playground/mess-draw.ts draws it.
 * Abozar asked for a chaos level where it "can run around and break things" (6 Nov 2026).
 */
export type ToyKind = "yarn" | "jingle" | "fish" | "sock" | "foil" | "tennis" | "bone" | "carrot" | "acorn";
/** What each kind of animal eats as a treat (from your hand): a cat a fish-shaped biscuit, a dog a bone-shaped one, a fox an egg, a raccoon grapes, a rabbit a strawberry, a squirrel a peanut. */
export type TreatKind = "fish_treat" | "biscuit" | "egg" | "grapes" | "strawberry" | "peanut";
export const TREAT_KINDS: readonly TreatKind[] = ["fish_treat", "biscuit", "egg", "grapes", "strawberry", "peanut"];
export type PropKind = "mug" | "glass" | "plant" | "vase" | "yarn" | "pencils" | "teacup" | "duck" | "mouse" | ToyKind | TreatKind;
/** What stands about on window tops to be knocked off. */
export const PROP_KINDS: readonly PropKind[] = ["mug", "glass", "plant", "vase", "yarn", "pencils", "teacup", "duck", "mouse"];
/** Those things in words, for the model. */
export const THING_NAME: Partial<Record<string, string>> = {
  mug: "mug", glass: "glass of water", plant: "potted plant", vase: "vase", yarn: "ball of yarn", pencils: "cup of pencils", teacup: "teacup", duck: "rubber duck", mouse: "toy mouse",
};
/** Each animal's own toy (Personality.toy): the yarn is the tabby's, the others belong to one animal each. */
export const TOY_KINDS: readonly ToyKind[] = ["yarn", "jingle", "fish", "sock", "foil", "tennis", "bone", "carrot", "acorn"];
/** Toys that roll. The fish, the bone and the carrot skid and come to a stop lying flat. */
export const ROLLS: ReadonlySet<PropKind> = new Set<PropKind>(["yarn", "jingle", "sock", "foil", "tennis", "acorn"]);
/** Height in pixels at the medium size. The drawing keeps its own proportions. */
export const PROP_HEIGHT: Record<PropKind, number> = {
  mug: 30, glass: 34, plant: 40, vase: 42, yarn: 26, pencils: 46, teacup: 24, duck: 28, mouse: 18,
  jingle: 21, fish: 18, sock: 23, foil: 20, tennis: 22, bone: 14, carrot: 17, acorn: 21,
  fish_treat: 13, biscuit: 13, egg: 17, grapes: 19, strawberry: 17, peanut: 12,
};
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
  /**
   * rest: standing; slide: being pushed; teeter: on the edge; fall: in the air; settled: down and
   * still; roll: the animal's toy rolling or skidding on a window top or the floor (windowId null), or lying there;
   * held: the toy in your hand (dragged with the mouse); carried: the toy in the animal's mouth;
   * stashed: the toy buried by the animal (not drawn), where it was buried.
   */
  state: "rest" | "slide" | "teeter" | "fall" | "settled" | "roll" | "held" | "carried" | "stashed";
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
  /** The animal's own toy: it stays around (no fading, not cleared at chill) and rolls or skids when batted. */
  toy?: boolean;
  /** Sliding on a window that was jerked: its own sideways speed (px/s), which the window drags along. */
  slip?: number;
  /** You threw it (or put it down): when it comes to rest, the animal is told (a "toy" event). */
  thrown?: boolean;
  /** A treat (from your hand): it lies where it lands until it is eaten. bites: how much of it is gone, 0 to 1. */
  treat?: boolean;
  bites?: number;
  /** You moved it with the mouse: it is sturdier than a thing knocked off (you put it down, you didn't hurl it). */
  handled?: boolean;
  /** Held in your hand: where you grabbed it, from its middle, and how fast your hand moves (px/s, smoothed). */
  grip?: { dx: number; dy: number; vx: number; vy: number };
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
  /** Lying on a window top: it rides along, kept as an offset from the window's left edge. */
  windowId?: string;
  offset?: number;
  /** A piece of something you threw. */
  byHuman?: boolean;
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

/**
 * What it leaves behind when it has to go, now and then (ADR-048). The puddle is drawn in code, the
 * rest are drawings (public/props/<kind>.webp). A spot sticks to the window it was made on, dries up
 * or fades after a while, and a click cleans it at once.
 */
export type SpotKind = "puddle" | "poop" | "poop_log" | "pellets" | "pellets_row";
/** Height in pixels at the medium size of each drawn spot (tools/cut-props.py reads this table too). */
export const SPOT_HEIGHT: Record<Exclude<SpotKind, "puddle">, number> = {
  poop: 16, poop_log: 9, pellets: 9, pellets_row: 6,
};

export interface Spot {
  id: number;
  kind: SpotKind;
  /** The window it is on, or null on the Dock or the floor. */
  windowId: string | null;
  /** From the window's left edge, so it rides along. */
  dx: number;
  /** Bottom centre, screen coordinates. */
  x: number;
  y: number;
  /** How wide the puddle gets (a drawing has its own width). */
  w: number;
  seed: number;
  bornMs: number;
  /** A puddle spreads while it pees. */
  growMs: number;
  ttlMs: number;
  /** A click cleaned it: it sparkles and is gone. */
  cleanedMs?: number;
  /** Little runs down the front of the window a puddle is on. */
  drips: number;
  /** A fly has been to this one already. */
  flown?: boolean;
}

/** What lies about on one desktop. */
export interface MessState {
  props: Prop[];
  shards: Shard[];
  decals: Decal[];
  strips: Strip[];
  fly: Fly | null;
  spots: Spot[];
}

export type MessEvent =
  /** thrown: it was you who threw it (a thing_landed event says the same). */
  | { type: "broke"; kind: PropKind; x: number; y: number; thrown?: boolean }
  | { type: "fell"; kind: PropKind }
  /** You picked up something that is neither its toy nor a treat (a mug, a plant), from a window or the floor. */
  | { type: "thing_grabbed"; kind: PropKind; x: number; y: number; windowId: string | null }
  /** You let go of it: vx, vy is your hand's speed, so a throw, or about 0 when you just put it down. */
  | { type: "thing_thrown"; kind: PropKind; x: number; y: number; vx: number; vy: number }
  /** What you threw or put down came down: where, and whether it broke. */
  | { type: "thing_landed"; kind: PropKind; x: number; y: number; windowId: string | null; broke: boolean }
  | { type: "cracked"; windowId: string }
  | { type: "fly"; caught: boolean }
  /** A window moved so hard that what stood on it flew off (the human did it). */
  | { type: "flung"; kind: PropKind }
  /** The toy you threw or put down came to rest. */
  | { type: "toy"; kind: ToyKind; x: number; y: number; windowId: string | null }
  /** You threw the toy (from the menu or out of your hand): it is in the air now. */
  | { type: "toy_thrown"; kind: ToyKind; x: number; y: number }
  /** You picked the toy up. */
  | { type: "toy_grabbed"; kind: ToyKind; x: number; y: number }
  /** You let go of the treat (a click), it fell and came to rest, and the animal ate the last of it. */
  | { type: "treat_dropped"; kind: TreatKind; x: number; y: number }
  | { type: "treat_landed"; kind: TreatKind; x: number; y: number; windowId: string | null }
  | { type: "treat_eaten"; kind: TreatKind };

const GRAVITY = 2000;
const STILL: WinMotion = { vx: 0, vy: 0, ax: 0, ay: 0 };
/** A ball on a window barely holds on: it rolls off at a jerk a mug would ride out. */
const BALL_GRIP = { hold: 2600, slide: 600, lift: 3600, stop: 150 } as const;
const MAX_SHARDS = 160;
const MAX_STRIPS = 40;
/** Things on the floor (the Dock) fade after this long, so the desktop cleans itself up. */
const FLOOR_LINGER_MS = 45_000;
const FADE_MS = 4_000;
/** How long a spot stays, shortest and longest, in minutes: a puddle dries, the rest fade away. */
const SPOT_LIFE: Record<SpotKind, [number, number]> = { puddle: [6, 9], poop: [12, 20], poop_log: [12, 20], pellets: [8, 12], pellets_row: [8, 12] };
/** The sparkle after a click. */
const CLEAN_MS = 700;
/** The last part of a spot's life, when it dries up or fades. */
const SPOT_FADE_MS = 40_000;
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
  spots: Spot[] = [];
  private nextId = 1;
  private ownToy: ToyKind = "yarn";
  private nextSpawnMs: number | null = null;
  private platforms: Platform[] = [];
  private world: WorldSnapshot | null = null;
  private outbox: MessEvent[] = [];
  /** Size of everything, with the animal's size (S, M, L). */
  scale = 1;
  /** The left and right edges of all the displays: things bounce off them instead of falling out of sight. */
  private wallL = -Infinity;
  private wallR = Infinity;
  /** How each window is moving (motion.ts), from the Cat. Without it windows are taken to be still. */
  private motion: (id: string) => WinMotion = () => STILL;

  constructor(private rng: Rng) {}

  /** Clears everything (panic, shoo, chill). */
  clear(): void {
    this.props = [];
    this.shards = [];
    this.decals = [];
    this.strips = [];
    this.fly = null;
    this.spots = [];
  }

  /** Everything lying about on one desktop, put away while you are on another one (Spaces on the Mac). */
  stash(): MessState {
    const st: MessState = { props: this.props, shards: this.shards, decals: this.decals, strips: this.strips, fly: this.fly, spots: this.spots };
    this.clear();
    return st;
  }

  /** Puts back what was lying about on the desktop you came back to. */
  unstash(st: MessState | undefined): void {
    this.clear();
    if (!st) return;
    // Another animal's toy, left there before you switched animals, is put away.
    this.props = st.props.filter((p) => !p.toy || p.kind === this.ownToy);
    this.shards = st.shards;
    this.decals = st.decals;
    this.strips = st.strips;
    this.fly = st.fly;
    this.spots = st.spots ?? [];
  }

  /**
   * It went, standing at x on that window (or on the floor when windowId is null). A puddle spreads
   * for about as long as it pees (sec); the rest are there at once.
   */
  relieve(kind: SpotKind, windowId: string | null, x: number, nowMs: number, sec = 5): Spot | null {
    const world = this.world;
    if (!world) return null;
    const win = windowId ? world.windows.find((w) => w.id === windowId) : undefined;
    if (windowId && !win) return null;
    const y = win ? win.bounds.y : this.floorAt(x, world);
    const life = SPOT_LIFE[kind];
    const puddle = kind === "puddle";
    const spot: Spot = {
      id: this.nextId++,
      kind,
      windowId: win ? win.id : null,
      dx: win ? x - win.bounds.x : x,
      x,
      y,
      w: puddle ? this.rng.range(26, 40) * this.scale : 0,
      seed: this.rng.next(),
      bornMs: nowMs,
      growMs: puddle ? Math.max(1000, sec * 800) : 0,
      ttlMs: this.rng.range(life[0], life[1]) * 60_000,
      drips: puddle && win ? 1 + Math.floor(this.rng.next() * 3) : 0,
    };
    this.spots.push(spot);
    // Only a few at once: the oldest goes first.
    while (this.spots.length > 6) this.spots.shift();
    return spot;
  }

  /** The box you click to clean a spot. */
  spotBox(s: Spot): { x: number; y: number; w: number; h: number } {
    const pad = 8 * this.scale;
    if (s.kind === "puddle") return { x: s.x - s.w / 2 - pad, y: s.y - 6 * this.scale - pad, w: s.w + 2 * pad, h: 10 * this.scale + 2 * pad };
    const h = SPOT_HEIGHT[s.kind] * this.scale;
    const w = h * (PROP_ASPECT[s.kind] ?? 1.4);
    return { x: s.x - w / 2 - pad, y: s.y - h - pad, w: w + 2 * pad, h: h + 2 * pad };
  }

  /** The spot under a point (the cursor), if there is one that can still be cleaned. */
  spotUnder(x: number, y: number): Spot | undefined {
    return this.spots.find((s) => {
      if (s.cleanedMs !== undefined) return false;
      const b = this.spotBox(s);
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    });
  }

  /** You clicked it away. */
  cleanSpot(id: number, nowMs: number): Spot | undefined {
    const s = this.spots.find((q) => q.id === id && q.cleanedMs === undefined);
    if (s) s.cleanedMs = nowMs;
    return s;
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

  /**
   * Everything of the mess the animal can see, for the model: things standing, sliding, falling or
   * lying about (also one in your hand or its mouth), pieces of what broke, spills, the puddles and
   * piles it left, cracks and claw marks, torn strips and the fly. Its own toy is left out (the
   * screen block has a line of its own for it). Screen coordinates; summary.ts puts it in words.
   */
  seen(): SeenThing[] {
    const out: SeenThing[] = [];
    for (const p of this.props) {
      if (p.toy || p.state === "stashed" || p.alpha < 0.4) continue;
      const name = p.treat ? `${(p.bites ?? 0) > 0 ? "half-eaten " : ""}${treatName(p.kind)}` : (THING_NAME[p.kind] ?? toyName(p.kind));
      const state: SeenThing["state"] =
        p.state === "rest"
          ? p.windowId
            ? "standing"
            : "lying"
          : p.state === "slide"
            ? "sliding"
            : p.state === "teeter"
              ? "teetering"
              : p.state === "fall"
                ? "flying"
                : p.state === "roll"
                  ? Math.abs(p.vx) > 25
                    ? "rolling"
                    : "lying"
                  : p.state === "held"
                    ? "in_hand"
                    : p.state === "carried"
                      ? "in_mouth"
                      : "lying";
      out.push({ what: name, state, x: p.x, y: p.y, windowId: p.windowId, ...(p.handled || p.treat ? { byHuman: true } : {}) });
    }
    // Pieces and spills, one entry per heap (by what broke, where, and roughly how far along).
    const heaps = new Map<string, { what: string; xs: number; ys: number; n: number; windowId: string | null; flying: boolean; byHuman: boolean }>();
    for (const s of this.shards) {
      const what = s.kind === "water" ? "spilled water" : s.kind === "soil" ? "spilled soil" : s.kind === "sliver" ? "bits of glass" : `pieces of a broken ${THING_NAME[s.kind] ?? s.kind}`;
      const key = `${what}|${s.windowId ?? ""}|${Math.round(s.x / 160)}`;
      const h = heaps.get(key) ?? { what, xs: 0, ys: 0, n: 0, windowId: s.windowId ?? null, flying: false, byHuman: false };
      h.byHuman ||= !!s.byHuman;
      h.xs += s.x;
      h.ys += s.y;
      h.n += 1;
      h.flying ||= !s.settled;
      heaps.set(key, h);
    }
    for (const h of heaps.values()) out.push({ what: h.what, state: h.flying ? "flying" : "lying", x: h.xs / h.n, y: h.ys / h.n, windowId: h.windowId, ...(h.byHuman ? { byHuman: true } : {}) });
    for (const s of this.spots) {
      if (s.cleanedMs !== undefined) continue;
      out.push({ what: s.kind === "puddle" ? "my puddle" : s.kind === "pellets" || s.kind === "pellets_row" ? "my droppings" : "my poop", state: "lying", x: s.x, y: s.y, windowId: s.windowId });
    }
    const wins = new Map((this.world?.windows ?? []).map((w) => [w.id, w]));
    for (const d of this.decals) {
      const w = wins.get(d.windowId);
      if (!w) continue;
      out.push({ what: d.kind === "crack" ? "a crack" : d.kind === "claw" ? "my claw marks" : "a chip", state: "mark", x: w.bounds.x + d.dx, y: w.bounds.y + d.dy, windowId: d.windowId });
    }
    for (const s of this.strips) out.push({ what: "a strip torn off a title bar", state: s.settled ? "lying" : "flying", x: s.x, y: s.y, windowId: null });
    if (this.fly && this.fly.state !== "caught") out.push({ what: "a fly", state: "buzzing", x: this.fly.x, y: this.fly.y, windowId: null });
    return out;
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

  /** Which toy the animal has. Another one (another animal) puts the old one away. */
  get toyKind(): ToyKind {
    return this.ownToy;
  }
  set toyKind(k: ToyKind) {
    if (k === this.ownToy) return;
    this.ownToy = k;
    this.props = this.props.filter((p) => !p.toy);
  }

  /** The animal's toy, if it is around (not buried). */
  get toy(): Prop | undefined {
    return this.props.find((p) => p.toy && p.state !== "stashed");
  }

  /** The toy, if the animal buried it. */
  get stashedToy(): Prop | undefined {
    return this.props.find((p) => p.toy && p.state === "stashed");
  }

  /** The box the toy is drawn in (bottom centre x, y), for a click on it. */
  toyBox(p: Prop): { x: number; y: number; w: number; h: number } {
    const h = PROP_HEIGHT[p.kind] * this.scale;
    const w = h * (PROP_ASPECT[p.kind] ?? 1);
    // Lying or turned, it may be wider than tall either way: a square around it is easy to hit.
    const s = Math.max(w, h) + 10 * this.scale;
    return { x: p.x - s / 2, y: p.y - h / 2 - s / 2, w: s, h: s };
  }

  /** The toy under a point (the cursor), if it is out and can be picked up. */
  toyUnder(x: number, y: number): Prop | undefined {
    const t = this.toy;
    if (!t || t.alpha < 0.5) return undefined;
    const b = this.toyBox(t);
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h ? t : undefined;
  }

  /** Things you can pick up with the mouse: the toy, a treat lying about, and whatever stands on a window or lies on the floor. */
  get grabbable(): Prop[] {
    return this.props.filter(
      (p) => p.alpha >= 0.5 && (p.state === "rest" || p.state === "roll" || p.state === "settled" || p.state === "carried" || p.state === "teeter") && !(p.treat && (p.bites ?? 0) > 0),
    );
  }

  /** The thing under a point (the cursor) that you can pick up: the toy first, then the smallest box. */
  grabbableUnder(x: number, y: number): Prop | undefined {
    const hit = this.grabbable.filter((p) => {
      const b = this.toyBox(p);
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    });
    return hit.find((p) => p.toy) ?? hit.sort((a, b) => PROP_HEIGHT[a.kind] - PROP_HEIGHT[b.kind])[0];
  }

  /** The thing in your hand, if any (the toy, a treat, a mug). */
  get held(): Prop | undefined {
    return this.props.find((p) => p.state === "held");
  }

  /**
   * "Give a treat": one appears in your hand at the cursor and stays there, swinging a little, until
   * you click to let it fall (a second "Give a treat" lets it go too). One at a time.
   */
  offerTreat(kind: TreatKind, x: number, y: number, nowMs: number): Prop | null {
    if (this.props.some((p) => p.treat && p.state === "held")) return null;
    const p: Prop = {
      id: `p${this.nextId++}`,
      kind,
      windowId: null,
      offset: 0,
      x,
      y,
      vx: 0,
      vy: 0,
      rot: 0,
      vr: 0,
      state: "held",
      alpha: 1,
      bornMs: nowMs,
      teeter: 0,
      dir: 1,
      slideLeft: 0,
      treat: true,
      bites: 0,
      // Just below and right of the pointer's tip, so the arrow doesn't cover it.
      grip: { dx: 9 * this.scale, dy: 4 * this.scale, vx: 0, vy: 0 },
    };
    this.props.push(p);
    this.holdAt(x, y, 0);
    return p;
  }

  /** The treat: in your hand, falling, or lying where it landed (not once it is eaten). */
  get treat(): Prop | undefined {
    return this.props.find((p) => p.treat && (p.bites ?? 0) < 1);
  }

  /** A bite of the treat (amount of the whole, 0 to 1). The last bite finishes it. */
  bite(id: string, amount: number): void {
    const p = this.props.find((q) => q.id === id && q.treat);
    if (!p || p.state === "held" || p.state === "fall") return;
    p.bites = Math.min(1, (p.bites ?? 0) + amount);
    if (p.bites >= 1) {
      p.alpha = 0;
      this.props = this.props.filter((q) => q !== p);
      this.outbox.push({ type: "treat_eaten", kind: p.kind as TreatKind });
    }
  }

  /** You picked the toy up with the mouse (out of the animal's mouth too). */
  grab(id: string, x: number, y: number): void {
    const p = this.props.find((q) => q.id === id);
    if (!p) return;
    const h = PROP_HEIGHT[p.kind] * this.scale;
    const from = p.windowId;
    p.state = "held";
    p.windowId = null;
    p.slip = undefined;
    p.alpha = 1;
    p.rot = p.toy ? p.rot : 0;
    p.settledMs = undefined;
    p.grip = { dx: p.x - x, dy: p.y - h / 2 - y, vx: 0, vy: 0 };
    if (!p.toy && !p.treat) p.handled = true;
    if (p.toy) this.outbox.push({ type: "toy_grabbed", kind: p.kind as ToyKind, x: p.x, y: p.y });
    else if (!p.treat) this.outbox.push({ type: "thing_grabbed", kind: p.kind, x: p.x, y: p.y, windowId: from });
  }

  /** Where your hand is now, every frame while you hold the toy. */
  holdAt(x: number, y: number, dt: number): void {
    const p = this.props.find((q) => q.state === "held");
    if (!p?.grip) return;
    const h = PROP_HEIGHT[p.kind] * this.scale;
    const nx = x + p.grip.dx;
    const ny = y + p.grip.dy + h / 2;
    if (dt > 0) {
      const k = Math.min(1, dt / 0.06);
      p.grip.vx += ((nx - p.x) / dt - p.grip.vx) * k;
      p.grip.vy += ((ny - p.y) / dt - p.grip.vy) * k;
    }
    p.x = nx;
    p.y = ny;
    // It swings a little with your hand.
    p.rot += (Math.max(-0.6, Math.min(0.6, p.grip.vx / 1500)) - p.rot) * Math.min(1, dt * 8);
  }

  /** You let go: it flies on with your hand's speed (a throw), or just drops. */
  letGo(): Prop | undefined {
    const p = this.props.find((q) => q.state === "held");
    if (!p) return undefined;
    const g = p.grip ?? { vx: 0, vy: 0 };
    const cap = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
    p.state = "fall";
    p.vx = cap(g.vx, 2200);
    p.vy = cap(g.vy, 1800);
    p.dir = p.vx >= 0 ? 1 : -1;
    // A ball spins off your hand; a mug or a treat put down mostly doesn't.
    p.vr = p.toy ? p.dir * Math.min(12, 2 + Math.abs(p.vx) / 150) : p.dir * Math.min(6, Math.abs(p.vx) / 300);
    p.grip = undefined;
    // A treat is let go of, not thrown: it mostly just drops.
    if (p.treat) {
      p.vx *= 0.3;
      p.vy = Math.max(-150, p.vy * 0.3);
      p.vr *= 0.3;
    }
    // Whatever you let go of, the animal hears where it comes down (cameToRest, or the landing in stepProps).
    p.thrown = true;
    if (p.toy) this.outbox.push({ type: "toy_thrown", kind: p.kind as ToyKind, x: p.x, y: p.y });
    else if (p.treat) this.outbox.push({ type: "treat_dropped", kind: p.kind as TreatKind, x: p.x, y: p.y });
    else this.outbox.push({ type: "thing_thrown", kind: p.kind, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    return p;
  }

  /** Is something in your hand (the toy, a thing you picked up; a treat counts, see treatInHand)? */
  get holding(): boolean {
    return this.props.some((p) => p.state === "held" && !p.treat);
  }

  /** A treat in your hand, waiting for your click. */
  get treatInHand(): Prop | undefined {
    return this.props.find((p) => p.treat && p.state === "held");
  }

  /**
   * "Throw its toy" from the menu: it drops out of your hand where the cursor is (out of hiding if the
   * animal buried it, or brought out if it isn't around).
   */
  toss(x: number, y: number, nowMs: number): Prop | null {
    let p: Prop | null | undefined = this.toy ?? this.stashedToy;
    if (!p) p = this.bringToy(x, nowMs);
    if (!p) return null;
    p.state = "fall";
    p.windowId = null;
    p.slip = undefined;
    p.alpha = 1;
    p.x = x;
    p.y = y + 10 * this.scale;
    p.vx = this.rng.range(-80, 80);
    p.vy = -this.rng.range(0, 120);
    p.vr = this.rng.range(-6, 6);
    p.thrown = true;
    this.outbox.push({ type: "toy_thrown", kind: p.kind as ToyKind, x: p.x, y: p.y });
    return p;
  }

  /** The animal picks the toy up in its mouth. */
  carry(id: string): boolean {
    const p = this.props.find((q) => q.id === id);
    if (!p || p.state === "held" || p.state === "stashed") return false;
    p.state = "carried";
    p.windowId = null;
    p.slip = undefined;
    p.thrown = false;
    p.alpha = 1;
    p.vx = 0;
    p.vy = 0;
    return true;
  }

  /** Where the mouth is, every frame while it carries the toy: the toy hangs from it. */
  carryAt(x: number, y: number, facing: 1 | -1): void {
    const p = this.props.find((q) => q.state === "carried");
    if (!p) return;
    const h = PROP_HEIGHT[p.kind] * this.scale;
    p.x = x;
    p.y = y + h / 2;
    // A ball sits in the mouth; a bone, a fish or a carrot is held across it.
    p.rot = ROLLS.has(p.kind) ? p.rot : 0;
    p.dir = facing;
  }

  /** It lets go of the toy: it drops from the mouth, a little forward. */
  dropCarried(dir: 1 | -1): void {
    const p = this.props.find((q) => q.state === "carried");
    if (!p) return;
    p.state = "fall";
    p.vx = dir * this.rng.range(30, 70);
    p.vy = -40;
    p.vr = dir * 2;
  }

  /** It buries the toy where it is. */
  bury(): void {
    const p = this.props.find((q) => q.state === "carried") ?? this.toy;
    if (!p) return;
    p.state = "stashed";
    p.alpha = 0;
    p.vx = 0;
    p.vy = 0;
  }

  /** It digs the toy up again: it pops out where it was buried. */
  digUp(): Prop | undefined {
    const p = this.stashedToy;
    if (!p) return undefined;
    p.state = "fall";
    p.windowId = null;
    p.alpha = 1;
    p.vx = this.rng.range(-40, 40);
    p.vy = -320;
    p.vr = this.rng.range(-5, 5);
    return p;
  }

  /**
   * Brings the toy ball out when it isn't around: it rolls in along the floor from the side of the
   * screen nearer the animal, as if it had been under the sofa all along.
   */
  bringToy(nearX: number, nowMs: number): Prop | null {
    const have = this.toy;
    if (have) return have;
    // Buried: it digs it up again instead.
    const hid = this.digUp();
    if (hid) return hid;
    const w = this.world;
    if (!w) return null;
    const left = nearX - w.screen.x < w.screen.x + w.screen.w - nearX;
    const dir: 1 | -1 = left ? 1 : -1;
    const p: Prop = {
      id: `p${this.nextId++}`,
      kind: this.ownToy,
      windowId: null,
      offset: 0,
      x: left ? w.screen.x + 8 : w.screen.x + w.screen.w - 8,
      y: w.dockTop,
      vx: dir * this.rng.range(260, 340),
      vy: 0,
      rot: 0,
      vr: 0,
      state: "roll",
      alpha: 0,
      bornMs: nowMs,
      teeter: 0,
      dir,
      slideLeft: 0,
      toy: true,
    };
    this.props.push(p);
    return p;
  }

  /** A swipe of the paw at the ball: it hops a little and rolls off that way. A softer pat sends it less far. */
  bat(id: string, dir: 1 | -1, strength = 1): void {
    const p = this.props.find((q) => q.id === id);
    if (!p || p.state === "fall" || p.state === "held" || p.state === "carried" || p.state === "stashed") return;
    p.state = "fall";
    p.windowId = null;
    p.slip = undefined;
    p.dir = dir;
    p.vx = dir * this.rng.range(170, 290) * strength;
    p.vy = -this.rng.range(80, 200) * Math.min(1, strength);
    p.vr = dir * this.rng.range(6, 10);
  }

  /**
   * A thing standing on a window that moves. It rides along while the window moves gently, slides
   * when the window is jerked sideways (and goes over the edge if it slides that far), and leaves
   * the window when it is pulled down from under it or stops hard on the way up. False: it flew off.
   */
  private ride(p: Prop, win: WindowInfo, dt: number, grip: { hold: number; slide: number; lift: number; stop: number }): boolean {
    const m = this.motion(win.id);
    // Stopped dead on the way up: it goes on up.
    if (m.stop && m.stop.vy < -grip.stop * 1.5) {
      this.throwOff(p, m.stop.vx, m.stop.vy * 0.8);
      return false;
    }
    if (m.ay > grip.lift) {
      this.throwOff(p, p.slip ?? m.vx, Math.min(m.vy, 0));
      return false;
    }
    // Stopped dead: it keeps the speed it had and slides on.
    if (m.stop && Math.abs(m.stop.vx) > grip.stop && (p.slip === undefined || Math.abs(m.stop.vx) > Math.abs(p.slip))) p.slip = m.stop.vx;
    if (p.slip === undefined && Math.abs(m.ax) > grip.hold) p.slip = m.vx - m.ax * dt;
    if (p.slip !== undefined) {
      const rel = p.slip - m.vx;
      const pull = grip.slide * dt;
      if (Math.abs(rel) <= pull && Math.abs(m.ax) < grip.hold) p.slip = undefined;
      else {
        p.slip -= Math.sign(rel) * Math.min(pull, Math.abs(rel));
        p.offset += (p.slip - m.vx) * dt;
      }
    }
    p.x = win.bounds.x + p.offset;
    // Slid off the end of the window.
    if (p.slip !== undefined && (p.x < win.bounds.x - 2 || p.x > win.bounds.x + win.bounds.w + 2)) {
      this.throwOff(p, p.slip, Math.min(m.vy, 0));
      return false;
    }
    // It leans against a jerk, the way a mug tips back when the table moves.
    if (!p.toy) p.vr += -0.003 * m.ax * dt;
    return true;
  }

  /** Off the window it goes, with the speed it had. */
  private throwOff(p: Prop, vx: number, vy: number): void {
    p.state = "fall";
    p.windowId = null;
    p.slip = undefined;
    p.dir = vx >= 0 ? 1 : -1;
    p.vx = vx;
    p.vy = vy;
    p.vr = p.dir * this.rng.range(4, 9);
    this.outbox.push({ type: "flung", kind: p.kind });
  }

  /** The floor under x: the Dock on the main display, the bottom edge on the others. */
  private floorAt(x: number, world: WorldSnapshot): number {
    const f = this.platforms.find((q) => (q.kind === "dock_top" || q.kind === "floor") && x >= q.x1 && x <= q.x2);
    return f?.y ?? world.dockTop;
  }

  /** A ball rolls on, slowing down, and turns as it goes. A long toy skids, stops sooner and settles flat. */
  private roll(p: Prop, dt: number): void {
    const v = Math.abs(p.vx);
    if (ROLLS.has(p.kind)) {
      const r = PROP_HEIGHT[p.kind] * this.scale * 0.5;
      const left = Math.max(0, v * Math.pow(0.55, dt) - 60 * dt);
      p.vx = left < 4 ? 0 : Math.sign(p.vx) * left;
      p.rot += (p.vx * dt) / r;
      return;
    }
    const left = Math.max(0, v * Math.pow(0.3, dt) - 150 * dt);
    p.vx = left < 4 ? 0 : Math.sign(p.vx) * left;
    // Either way up, whichever is nearer.
    const flat = Math.round(p.rot / Math.PI) * Math.PI;
    p.rot += (flat - p.rot) * Math.min(1, dt * 12);
  }

  /** A toy you threw has stopped rolling: the animal hears about it once. */
  private cameToRest(p: Prop): void {
    if (!p.thrown || Math.abs(p.vx) > 25) return;
    p.thrown = false;
    if (p.treat) this.outbox.push({ type: "treat_landed", kind: p.kind as TreatKind, x: p.x, y: p.y, windowId: p.windowId });
    else this.outbox.push({ type: "toy", kind: p.kind as ToyKind, x: p.x, y: p.y, windowId: p.windowId });
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
    const byHuman = !!p.thrown && !p.toy && !p.treat;
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
        ...(byHuman ? { byHuman } : {}),
      });
    }
    // A glass spills its water, a pot its soil.
    const spill = p.kind === "glass" ? "water" : p.kind === "plant" ? "soil" : null;
    if (spill) {
      for (let i = 0; i < 10 && this.shards.length < MAX_SHARDS; i++) {
        const s = this.rng.range(2, 5) * this.scale;
        this.shards.push({ kind: spill, x: p.x + this.rng.range(-6, 6), y: p.y - 4, vx: this.rng.range(-160, 160), vy: -this.rng.range(60, 220), rot: 0, vr: 0, poly: [], cx: 0, cy: 0, w: s, h: s, settled: false, bornMs: nowMs, ...(byHuman ? { byHuman } : {}) });
      }
    }
    this.outbox.push({ type: "broke", kind: p.kind, x: p.x, y: p.y, ...(byHuman ? { thrown: true } : {}) });
  }

  /** Runs one frame: new clutter now and then, things riding their windows, falling, breaking and fading. */
  step(dt: number, world: WorldSnapshot, chaos: ChaosLevel, catX: number | null, motion?: (id: string) => WinMotion): MessEvent[] {
    const now = world.nowMs;
    this.motion = motion ?? (() => STILL);
    if (this.world === null || world.windows !== this.world.windows || world.dockTop !== this.world.dockTop) this.platforms = buildPlatforms(world);
    this.world = world;
    const all = [world.screen, ...(world.displays ?? [])];
    this.wallL = Math.min(...all.map((d) => d.x)) + 4;
    this.wallR = Math.max(...all.map((d) => d.x + d.w)) - 4;
    this.spawn(world, chaos, catX);
    // Small steps, so a long frame (or a simulation that steps a second at a time) doesn't make things
    // bounce for ever. When nothing is moving (the usual case) one step is enough.
    const moving = (id: string | null | undefined): boolean => {
      if (!id) return false;
      const m = this.motion(id);
      return m.vx !== 0 || m.vy !== 0 || m.ax !== 0 || m.ay !== 0 || m.stop !== undefined;
    };
    const lively =
      this.fly !== null ||
      this.props.some((p) => (p.state !== "rest" && p.state !== "settled") || p.toy || p.treat || moving(p.windowId)) ||
      this.shards.some((x) => !x.settled || moving(x.windowId)) ||
      this.strips.some((x) => !x.settled);
    const n = lively ? Math.min(60, Math.ceil(dt / (1 / 30))) : 1;
    for (let i = 0; i < n; i++) {
      this.stepProps(dt / n, world);
      this.stepShards(dt / n, world);
      this.stepStrips(dt / n, world);
      this.stepFly(dt / n);
    }
    this.stepSpots(world);
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
      // In your hand or in its mouth: whoever holds it moves it. Buried: it waits.
      if (p.state === "held" || p.state === "carried" || p.state === "stashed") continue;
      if (p.state === "rest" || p.state === "slide" || p.state === "teeter" || (p.state === "roll" && p.windowId)) {
        const win = p.windowId ? windows.get(p.windowId) : undefined;
        if (!win) {
          // Its window closed (or went away): down it goes.
          p.state = "fall";
          p.windowId = null;
          p.slip = undefined;
          p.vx = p.toy || p.treat ? p.vx : this.rng.range(-30, 30);
          p.vr = this.rng.range(-3, 3);
          this.outbox.push({ type: "fell", kind: p.kind });
          continue;
        }
        if (!this.ride(p, win, dt, p.toy || p.treat ? BALL_GRIP : GRIP.prop)) continue;
        p.y = win.bounds.y;
        // Hidden behind a window in front: fade out until it shows again.
        const visible = segmentsOf(this.platforms, win.id).some((s) => p.x >= s.x1 - 4 && p.x <= s.x2 + 4);
        p.alpha = Math.max(0, Math.min(1, p.alpha + (visible ? dt / (p.toy || p.treat ? 0.3 : 1.2) : -dt / 0.25)));
        if (p.state === "roll") {
          // The ball rolls along the window top, and off the end of it.
          this.roll(p, dt);
          p.offset += p.vx * dt;
          p.x = win.bounds.x + p.offset;
          this.cameToRest(p);
          if (p.x < win.bounds.x || p.x > win.bounds.x + win.bounds.w) {
            p.state = "fall";
            p.windowId = null;
            p.vy = 0;
          }
          continue;
        }
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
      if (p.state === "roll") {
        // The ball on the floor.
        p.alpha = Math.min(1, p.alpha + dt / 0.3);
        this.roll(p, dt);
        p.x += p.vx * dt;
        this.wall(p);
        p.y = this.floorAt(p.x, world);
        this.cameToRest(p);
        continue;
      }
      if (p.state === "fall") {
        const y0 = p.y;
        p.vy += GRAVITY * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        this.wall(p);
        // A yarn knocked off a window unwinds behind it (not the animal's own ball, which is played with all day).
        if (p.kind === "yarn" && !p.toy) (p.trail ??= []).push({ x: p.x, y: p.y - 6 });
        const hit = landingOn(this.platforms, p.x, y0, p.y) ?? (p.y > world.dockTop ? this.platforms.find((q) => q.id === "dock") : undefined);
        if (!hit) {
          if (p.y > world.screen.y + world.screen.h + 200) p.alpha = 0;
          continue;
        }
        p.y = hit.y;
        // Put down by you it takes a real drop to break (about 300 px); knocked off, about 70 px does it.
        if (FRAGILE.has(p.kind) && p.vy > (p.handled ? 1100 : 520)) {
          this.breakProp(p, now);
          p.alpha = 0;
          if (p.thrown && !p.toy && !p.treat) this.outbox.push({ type: "thing_landed", kind: p.kind, x: p.x, y: p.y, windowId: hit.windowId ?? null, broke: true });
          p.thrown = false;
          continue;
        }
        // Bounces: less each time, until it lies there.
        p.vy = -p.vy * (p.kind === "duck" || ROLLS.has(p.kind) ? 0.45 : 0.3);
        p.vx *= 0.6;
        p.vr *= 0.5;
        if (Math.abs(p.vy) < 90 && (p.toy || p.treat)) {
          // The ball lands and rolls on, on a window or on the floor.
          p.state = "roll";
          p.vy = 0;
          p.vx /= 0.6;
          p.windowId = hit.windowId ?? null;
          p.offset = p.x - (hit.windowId ? (windows.get(hit.windowId)?.bounds.x ?? 0) : 0);
          continue;
        }
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
          // You threw it or put it down: the animal hears where it ended up.
          if (p.thrown && !p.toy && !p.treat) {
            p.thrown = false;
            this.outbox.push({ type: "thing_landed", kind: p.kind, x: p.x, y: p.y, windowId: hit.windowId ?? null, broke: false });
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
    this.props = this.props.filter((p) => p.alpha > 0 || p.state === "rest" || p.state === "slide" || p.state === "teeter" || p.state === "roll" || p.state === "stashed");
  }

  private stepShards(dt: number, world: WorldSnapshot): void {
    const now = world.nowMs;
    for (const s of this.shards) {
      if (s.settled && s.windowId) {
        // A piece lying on a window rides along, and a hard jerk throws it off again.
        const win = world.windows.find((w) => w.id === s.windowId);
        const m = this.motion(s.windowId);
        if (win && m.ay <= GRIP.prop.lift && Math.abs(m.ax) <= GRIP.prop.hold) {
          s.x = win.bounds.x + (s.offset ?? 0);
          s.y = win.bounds.y;
          continue;
        }
        s.settled = false;
        s.settledMs = undefined;
        s.windowId = undefined;
        s.vx = m.vx + this.rng.range(-40, 40);
        s.vy = Math.min(m.vy, 0) - this.rng.range(0, 80);
      }
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
        const win = hit.windowId ? world.windows.find((w) => w.id === hit.windowId) : undefined;
        if (win) ((s.windowId = win.id), (s.offset = s.x - win.bounds.x));
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

  /** Spots ride their window, go with it when it closes, dry up, and now and then a poop gets a fly. */
  private stepSpots(world: WorldSnapshot): void {
    if (this.spots.length === 0) return;
    const now = world.nowMs;
    const windows = new Map<string, WindowInfo>(world.windows.map((w) => [w.id, w]));
    this.spots = this.spots.filter((s) => {
      if (s.cleanedMs !== undefined && now - s.cleanedMs > CLEAN_MS) return false;
      if (now - s.bornMs > s.ttlMs) return false;
      if (s.windowId) {
        const w = windows.get(s.windowId);
        if (!w) return false;
        s.x = w.bounds.x + s.dx;
        s.y = w.bounds.y;
      } else {
        s.y = this.floorAt(s.x, world);
      }
      return true;
    });
    // A fly finds a poop that has been there a while, once, and buzzes about it (it can't be caught).
    if (this.fly) return;
    for (const s of this.spots) {
      if (s.kind === "puddle" || s.flown || s.cleanedMs !== undefined || now - s.bornMs < 25_000) continue;
      s.flown = true;
      if (this.rng.next() < 0.5) {
        const h = SPOT_HEIGHT[s.kind] * this.scale;
        this.flyIn(s.x, s.y - h - 14 * this.scale, this.rng.next() < 0.5 ? -1 : 1, false, now);
        if (this.fly) (this.fly as Fly).t = 30;
      }
      break;
    }
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
      props: this.props
        .filter((p) => p.alpha > 0 && p.state !== "stashed")
        .map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, rot: p.rot, alpha: p.alpha, trail: p.trail?.slice(-160), lying: (p.toy || p.treat) && p.state === "roll", front: p.state === "carried" || p.state === "held", carried: p.state === "carried", bites: p.bites })),
      shards: this.shards.map((s) => ({ kind: s.kind, x: s.x, y: s.y, rot: s.rot, poly: s.poly, cx: s.cx, cy: s.cy, w: s.w, h: s.h, alpha: s.settled && s.settledMs !== undefined ? fade(this.world?.nowMs ?? 0, s.settledMs) : 1 })),
      decals: this.decals.map((d) => ({ ...d, alpha: Math.min(1, ((d.bornMs + d.ttlMs) - (this.world?.nowMs ?? 0)) / 6000) })),
      strips: this.strips.map((s) => ({ x: s.x, y: s.y, rot: s.rot, w: s.w, h: s.h, seed: s.seed, alpha: s.settled && s.settledMs !== undefined ? fade(this.world?.nowMs ?? 0, s.settledMs) : 1 })),
      fly: this.fly ? { x: this.fly.x, y: this.fly.y, t: this.fly.t } : null,
      spots: this.spots.map((s) => {
        const now = this.world?.nowMs ?? s.bornMs;
        const left = s.bornMs + s.ttlMs - now;
        return {
          id: s.id,
          kind: s.kind,
          x: s.x,
          y: s.y,
          w: s.w,
          seed: s.seed,
          windowId: s.windowId,
          grow: s.growMs > 0 ? Math.min(1, (now - s.bornMs) / s.growMs) : 1,
          alpha: Math.max(0, Math.min(1, left / SPOT_FADE_MS)),
          cleaned: s.cleanedMs !== undefined ? Math.min(1, (now - s.cleanedMs) / CLEAN_MS) : undefined,
          drips: s.drips,
          ageSec: (now - s.bornMs) / 1000,
        };
      }),
    };
  }
}

const fade = (now: number, settledMs: number): number => Math.max(0, Math.min(1, 1 - (now - settledMs - FLOOR_LINGER_MS) / FADE_MS));

export interface MessSnapshot {
  /** lying: the animal's toy on a window top or the floor, however it has turned. front: in your hand or in its mouth, drawn in front of the animal. carried: in its mouth. */
  props: { id: string; kind: PropKind; x: number; y: number; rot: number; alpha: number; trail?: { x: number; y: number }[]; lying?: boolean; front?: boolean; carried?: boolean; bites?: number }[];
  shards: { kind: Shard["kind"]; x: number; y: number; rot: number; poly: number[]; cx: number; cy: number; w: number; h: number; alpha: number }[];
  decals: (Decal & { alpha: number })[];
  strips: { x: number; y: number; rot: number; w: number; h: number; seed: number; alpha: number }[];
  fly: { x: number; y: number; t: number } | null;
  /** grow: 0 to 1 while a puddle spreads. alpha: drying up or fading. cleaned: 0 to 1 through the sparkle after a click. */
  spots: { id: number; kind: SpotKind; x: number; y: number; w: number; seed: number; windowId: string | null; grow: number; alpha: number; cleaned?: number; drips: number; ageSec: number }[];
}
