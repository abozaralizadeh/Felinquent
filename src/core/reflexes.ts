import type { Rect } from "./types";

export type ReflexKind = "pet" | "overpet" | "pickup" | "drop" | "throw" | "shoo" | "laser" | "call" | "poke";

export interface ReflexEvent {
  kind: ReflexKind;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface PointerSample {
  /** Milliseconds. */
  t: number;
  x: number;
  y: number;
  down: boolean;
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function reversals(samples: PointerSample[]): number {
  let count = 0;
  let lastSign = 0;
  for (let i = 1; i < samples.length; i++) {
    const dx = (samples[i] as PointerSample).x - (samples[i - 1] as PointerSample).x;
    if (Math.abs(dx) < 3) continue;
    const sign = Math.sign(dx);
    if (lastSign !== 0 && sign !== lastSign) count++;
    lastSign = sign;
  }
  return count;
}

function pathLength(samples: PointerSample[]): number {
  let len = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as PointerSample;
    const b = samples[i] as PointerSample;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** Turns raw pointer samples into cat reactions. Thresholds come from docs/technical-design.md section 7.3. */
export class ReflexDetector {
  private samples: PointerSample[] = [];
  private wasDown = false;
  private pressedOnCat = false;
  private pressAt: { x: number; y: number } | null = null;
  private holding = false;
  private shooedThisHold = false;
  private petting = false;
  private petMs = 0;
  private overpetDone = false;
  private lastPetSampleT = 0;
  private lastLaserT = -Infinity;

  constructor(private hit: () => Rect) {}

  get isHolding(): boolean {
    return this.holding;
  }

  feed(s: PointerSample): ReflexEvent[] {
    const out: ReflexEvent[] = [];
    this.samples.push(s);
    while (this.samples.length > 1 && s.t - (this.samples[0] as PointerSample).t > 2000) this.samples.shift();
    const rect = this.hit();
    const onCat = inside(rect, s.x, s.y);
    const recent = (ms: number) => this.samples.filter((p) => s.t - p.t <= ms);

    if (s.down && !this.wasDown) {
      this.pressedOnCat = onCat;
      this.pressAt = { x: s.x, y: s.y };
      this.holding = false;
      this.shooedThisHold = false;
    }

    if (s.down) {
      if (this.pressedOnCat && !this.holding && this.pressAt && Math.hypot(s.x - this.pressAt.x, s.y - this.pressAt.y) > 5) {
        this.holding = true;
        out.push({ kind: "pickup", x: s.x, y: s.y });
      }
      if (this.holding && !this.shooedThisHold) {
        const w = recent(600);
        if (reversals(w) >= 3 && pathLength(w) > 120) {
          this.shooedThisHold = true;
          out.push({ kind: "shoo", x: s.x, y: s.y });
        }
      }
    } else if (this.wasDown) {
      if (this.holding) {
        const w = recent(100);
        const first = w[0] as PointerSample;
        const dt = Math.max(1, s.t - first.t) / 1000;
        const vx = (s.x - first.x) / dt;
        const vy = (s.y - first.y) / dt;
        out.push(Math.hypot(vx, vy) > 1500 ? { kind: "throw", x: s.x, y: s.y, vx, vy } : { kind: "drop", x: s.x, y: s.y, vx: 0, vy: 0 });
        this.holding = false;
      } else if (this.pressedOnCat && onCat) {
        // A click on the animal is a poke. It has a mind of its own about that (see reactions.ts).
        out.push({ kind: "poke", x: s.x, y: s.y });
      }
      this.pressedOnCat = false;
    } else {
      // Pointer is up: laser and petting.
      const w1 = recent(1000);
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const near = Math.hypot(s.x - cx, s.y - cy) <= 250;
      const speed = w1.length > 1 ? pathLength(w1) / Math.max(0.001, (s.t - (w1[0] as PointerSample).t) / 1000) : 0;
      if (near && speed > 800 && reversals(w1) >= 4 && s.t - this.lastLaserT > 5000) {
        this.lastLaserT = s.t;
        out.push({ kind: "laser", x: s.x, y: s.y });
      } else if (onCat && pathLength(w1) >= 40) {
        const dt = this.lastPetSampleT ? s.t - this.lastPetSampleT : 0;
        if (!this.petting) {
          this.petting = true;
          this.petMs = 0;
          this.overpetDone = false;
          out.push({ kind: "pet", x: s.x, y: s.y });
        } else {
          this.petMs += dt;
          if (this.petMs >= 8000 && !this.overpetDone) {
            this.overpetDone = true;
            out.push({ kind: "overpet", x: s.x, y: s.y });
          }
        }
      } else if (!onCat) {
        this.petting = false;
      }
    }
    this.lastPetSampleT = s.t;
    this.wasDown = s.down;
    return out;
  }
}
