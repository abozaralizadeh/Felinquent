// Draws the mess (src/core/mess.ts): things on window tops, the pieces when they break, cracks and
// claw marks on windows, strips torn off a title bar and the fly. Everything is drawn on the
// overlay; nothing ever touches another app or reads its pixels (hard rules 2 and 3).
import { PROP_HEIGHT, SPOT_HEIGHT, type MessSnapshot, type PropKind } from "../core/mess";
import { PROP_ASPECT } from "../core/prop-aspect";
import type { WindowInfo } from "../core/types";

const images = new Map<string, HTMLImageElement>();
function propImage(kind: PropKind | string): HTMLImageElement | null {
  let img = images.get(kind);
  if (!img) {
    img = new Image();
    img.src = new URL(`props/${kind}.webp`, document.baseURI).href;
    images.set(kind, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Starts loading the drawings, so the first knock-off doesn't show an empty spot. */
export function preloadProps(): void {
  for (const k of [...Object.keys(PROP_HEIGHT), ...Object.keys(SPOT_HEIGHT)]) propImage(k);
}

/** A small random generator from a seed, so a crack keeps its shape from frame to frame. */
function seeded(seed: number): () => number {
  let s = Math.floor(seed * 2 ** 31) || 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647;
  };
}

/** Light or dark title bar pieces, to match how the windows look. */
function chromeColors(): { fill: string; edge: string } {
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? { fill: "#3a3a3c", edge: "rgba(255,255,255,0.18)" } : { fill: "#ececec", edge: "rgba(0,0,0,0.22)" };
}

let layer: HTMLCanvasElement | null = null;

/**
 * Marks on windows go on a layer of their own: each window's marks are clipped to it, and then
 * every window in front of it is cleared from the layer, so a crack never shows on top of the window
 * that covers it. Lower z is nearer the front.
 */
function drawDecals(ctx: CanvasRenderingContext2D, snap: MessSnapshot, windows: WindowInfo[], scale: number): void {
  const drips = (snap.spots ?? []).filter((x) => x.drips > 0 && x.windowId && x.cleaned === undefined);
  if (snap.decals.length === 0 && drips.length === 0) return;
  const target = ctx.canvas;
  if (!layer) layer = document.createElement("canvas");
  if (layer.width !== target.width || layer.height !== target.height) {
    layer.width = target.width;
    layer.height = target.height;
  }
  const lc = layer.getContext("2d") as CanvasRenderingContext2D;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, layer.width, layer.height);
  lc.setTransform(ctx.getTransform());
  const back = [...windows].sort((a, b) => b.z - a.z);
  for (const w of back) {
    const mine = snap.decals.filter((d) => d.windowId === w.id);
    if (mine.length > 0) {
      lc.save();
      lc.beginPath();
      lc.rect(w.bounds.x, w.bounds.y, w.bounds.w, w.bounds.h);
      lc.clip();
      for (const d of mine) {
        lc.globalAlpha = Math.max(0, Math.min(1, d.alpha));
        const x = w.bounds.x + d.dx;
        const y = w.bounds.y + d.dy;
        if (d.kind === "crack") drawCrack(lc, x, y, d.size, d.seed);
        else if (d.kind === "claw") drawClaw(lc, x, y, d.size, d.seed);
        else drawChip(lc, x, y, d.size, d.seed);
      }
      lc.restore();
    }
    const runs = drips.filter((x) => x.windowId === w.id);
    if (runs.length > 0) {
      lc.save();
      lc.beginPath();
      lc.rect(w.bounds.x, w.bounds.y, w.bounds.w, w.bounds.h);
      lc.clip();
      for (const d of runs) drawDrips(lc, d, scale);
      lc.restore();
    }
    // Whatever is in front of this window hides its marks (and the marks of the ones behind it).
    for (const f of windows) if (f.z < w.z) lc.clearRect(f.bounds.x, f.bounds.y, f.bounds.w, f.bounds.h);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  void scale;
}

type SpotView = MessSnapshot["spots"][number];
const PEE = { fill: "rgba(236, 206, 84, 0.78)", edge: "rgba(190, 150, 40, 0.85)", shine: "rgba(255, 252, 230, 0.9)" };

/** Little runs of pee down the front of the window under a puddle, growing for a while, ending in a drop. */
function drawDrips(ctx: CanvasRenderingContext2D, d: SpotView, scale: number): void {
  const r = seeded(d.seed + 0.37);
  ctx.globalAlpha = Math.max(0, Math.min(1, d.alpha)) * 0.9;
  ctx.strokeStyle = PEE.fill;
  ctx.fillStyle = PEE.fill;
  ctx.lineCap = "round";
  const width = d.w * (0.6 + 0.4 * d.alpha);
  for (let i = 0; i < d.drips; i++) {
    const x = d.x + (r() - 0.5) * width * 0.8;
    const most = (14 + r() * 26) * scale;
    // They start once the puddle reaches the edge, and creep down for half a minute or so.
    const len = Math.min(most, Math.max(0, d.ageSec - 1.5) * (1.2 + r()) * scale);
    if (len < 1) continue;
    ctx.lineWidth = (1.4 + r() * 0.8) * scale;
    ctx.beginPath();
    ctx.moveTo(x, d.y);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 2 * scale, d.y + len * 0.5, x, d.y + len);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, d.y + len + 1.2 * scale, 1.6 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Puddles and piles (ADR-048), before the animal. A puddle is a thin glossy pool lying on the window
 * edge, spreading while it pees and shrinking as it dries. A pile is a drawing with a soft shadow,
 * and a poop gets wavy stink lines for a while. A click cleans one: it shrinks into a sparkle.
 */
function drawSpots(ctx: CanvasRenderingContext2D, snap: MessSnapshot, scale: number): void {
  for (const d of snap.spots ?? []) {
    const gone = d.cleaned ?? 0;
    const alpha = Math.max(0, Math.min(1, d.alpha)) * (1 - gone);
    if (alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha;
      if (d.kind === "puddle") drawPuddle(ctx, d, scale, 1 - gone);
      else drawPile(ctx, d, scale, 1 - gone);
      ctx.restore();
    }
    if (d.cleaned !== undefined) drawSparkle(ctx, d.x, d.y - 6 * scale, d.cleaned, d.seed, scale);
  }
}

function drawPuddle(ctx: CanvasRenderingContext2D, d: SpotView, scale: number, shrink: number): void {
  const r = seeded(d.seed);
  // It spreads fast at first, then slower (a square root), and dries down to about half before it goes.
  const w = d.w * Math.sqrt(Math.max(0.05, d.grow)) * (0.55 + 0.45 * d.alpha) * shrink;
  const h = (2.6 + r() * 1.4) * scale * (0.7 + 0.3 * d.grow) * shrink;
  const x0 = d.x - w / 2;
  // A wobbly top edge: a few bumps from the seed, so no two puddles look the same.
  const bumps = 4 + Math.floor(r() * 3);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= bumps; i++) {
    const f = i / bumps;
    const hump = Math.sin(f * Math.PI);
    pts.push({ x: x0 + f * w, y: d.y - h * hump * (0.75 + r() * 0.5) });
  }
  ctx.fillStyle = PEE.fill;
  ctx.strokeStyle = PEE.edge;
  ctx.lineWidth = 0.8 * scale;
  ctx.beginPath();
  ctx.moveTo(x0 - 1.5 * scale, d.y + 0.5 * scale);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as { x: number; y: number };
    const b = pts[i + 1] as { x: number; y: number };
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  ctx.lineTo(x0 + w + 1.5 * scale, d.y + 0.5 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // A shine along the top.
  ctx.strokeStyle = PEE.shine;
  ctx.lineWidth = 0.9 * scale;
  ctx.beginPath();
  ctx.moveTo(d.x - w * 0.28, d.y - h * 0.62);
  ctx.quadraticCurveTo(d.x - w * 0.1, d.y - h * 0.8, d.x + w * 0.05, d.y - h * 0.66);
  ctx.stroke();
}

function drawPile(ctx: CanvasRenderingContext2D, d: SpotView, scale: number, shrink: number): void {
  const img = propImage(d.kind);
  const h = SPOT_HEIGHT[d.kind as keyof typeof SPOT_HEIGHT] * scale * shrink;
  const w = h * (PROP_ASPECT[d.kind] ?? (img ? img.naturalWidth / img.naturalHeight : 1.4));
  ctx.fillStyle = "rgba(0,0,0,0.13)";
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 0.5, w * 0.5, 2.2 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (img) ctx.drawImage(img, d.x - w / 2, d.y - h + 0.5 * scale, w, h);
  // Stink lines over a poop for the first few minutes (pellets hardly smell).
  if ((d.kind === "poop" || d.kind === "poop_log") && d.ageSec < 240 && shrink > 0.9) {
    const r = seeded(d.seed + 0.71);
    const fade = Math.min(1, d.ageSec / 2) * Math.min(1, (240 - d.ageSec) / 30);
    ctx.strokeStyle = "rgba(120, 140, 90, 0.5)";
    ctx.lineWidth = 1.3 * scale;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const x = d.x + (i - 1) * w * 0.32 + (r() - 0.5) * 2 * scale;
      // Each one rises and fades in a loop of its own.
      const phase = (d.ageSec * 0.45 + i * 0.33 + r() * 0.2) % 1;
      const y = d.y - h - 3 * scale - phase * 14 * scale;
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * fade * Math.sin(phase * Math.PI);
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const px = x + Math.sin(t * Math.PI * 2 + d.ageSec * 3 + i) * 2.2 * scale;
        const py = y - t * 10 * scale;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Little four-point stars flying out as a spot is cleaned (t from 0 to 1). */
function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, seed: number, scale: number): void {
  const r = seeded(seed + 0.91);
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - t) * 0.95;
  ctx.fillStyle = "#fff8c8";
  ctx.strokeStyle = "rgba(200, 170, 60, 0.7)";
  ctx.lineWidth = 0.6 * scale;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r();
    const dist = (4 + 16 * t) * scale * (0.7 + r() * 0.6);
    const sx = x + Math.cos(a) * dist;
    const sy = y + Math.sin(a) * dist * 0.6 - 4 * t * scale;
    const size = (2.5 + r() * 2) * scale * (1 - 0.5 * t);
    ctx.beginPath();
    ctx.moveTo(sx, sy - size);
    ctx.quadraticCurveTo(sx, sy, sx + size, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + size);
    ctx.quadraticCurveTo(sx, sy, sx - size, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A spider web in the "glass", from the point where the animal came down, spreading into the window. */
function drawCrack(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number): void {
  const r = seeded(seed);
  const arms = 6 + Math.floor(r() * 4);
  const rays: { x: number; y: number }[][] = [];
  for (let i = 0; i < arms; i++) {
    // Into the window only: angles in the lower half.
    const a = Math.PI * (0.06 + 0.88 * ((i + r() * 0.6) / arms));
    const len = size * (0.55 + r() * 0.6);
    const pts = [{ x, y }];
    let px = x;
    let py = y;
    const n = 4 + Math.floor(r() * 3);
    for (let k = 1; k <= n; k++) {
      const d = (len / n) * (0.8 + r() * 0.4);
      const aa = a + (r() - 0.5) * 0.35;
      px += Math.cos(aa) * d;
      py += Math.sin(aa) * d;
      pts.push({ x: px, y: py });
    }
    rays.push(pts);
  }
  const path = (): void => {
    ctx.beginPath();
    for (const pts of rays) {
      ctx.moveTo((pts[0] as { x: number }).x, (pts[0] as { y: number }).y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    }
    // Rings between neighbouring arms, at a couple of distances.
    for (const ring of [1, 2]) {
      for (let i = 0; i + 1 < rays.length; i++) {
        const a = (rays[i] as { x: number; y: number }[])[ring];
        const b = (rays[i + 1] as { x: number; y: number }[])[ring];
        if (!a || !b || r() < 0.25) continue;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2 + (r() - 0.5) * 4, (a.y + b.y) / 2 + (r() - 0.5) * 4, b.x, b.y);
      }
    }
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // A dark line under a light one shows on light and dark windows alike.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2.2;
  ctx.save();
  ctx.translate(0.8, 0.8);
  path();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.1;
  path();
  ctx.stroke();
  // The dent where it hit.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.arc(x, y + 2, 4, 0, Math.PI * 2);
  ctx.fill();
}

/** Three or four slanted grooves from claws dragged down the title bar. */
function drawClaw(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number): void {
  const r = seeded(seed);
  const n = 3 + (r() < 0.4 ? 1 : 0);
  const slant = (r() - 0.5) * 0.5;
  ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const ox = x + (i - (n - 1) / 2) * size * 0.22;
    const len = size * (0.75 + r() * 0.35);
    const x2 = ox + slant * len;
    const y2 = y + len;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(ox, y + 1);
    ctx.quadraticCurveTo(ox + slant * len * 0.5 + 1, y + len * 0.5, x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(ox + 1.4, y + 2);
    ctx.quadraticCurveTo(ox + 1.4 + slant * len * 0.5, y + len * 0.5, x2 + 1.2, y2 - 1);
    ctx.stroke();
  }
}

/** A jagged bite out of the top edge, where a strip was torn off. */
function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed: number): void {
  const r = seeded(seed);
  const pts: { x: number; y: number }[] = [{ x: x - size / 2, y }];
  const n = 5;
  for (let i = 1; i < n; i++) pts.push({ x: x - size / 2 + (size * i) / n, y: y + size * (0.25 + r() * 0.45) });
  pts.push({ x: x + size / 2, y });
  ctx.beginPath();
  ctx.moveTo((pts[0] as { x: number }).x, y);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = "rgba(20,20,22,0.7)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** front: only what is in your hand or the animal's mouth (drawn over the animal); otherwise the rest. */
function drawProps(ctx: CanvasRenderingContext2D, snap: MessSnapshot, scale: number, front = false): void {
  for (const p of snap.props) {
    if (!!p.front !== front) continue;
    if (p.trail && p.trail.length > 1) {
      // The yarn unwinds behind it.
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = "#d8402f";
      ctx.lineWidth = 1.6 * scale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo((p.trail[0] as { x: number }).x, (p.trail[0] as { y: number }).y);
      for (const q of p.trail) ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.restore();
    }
    const img = propImage(p.kind);
    if (!img) continue;
    const h = PROP_HEIGHT[p.kind] * scale;
    const w = h * (PROP_ASPECT[p.kind] ?? img.naturalWidth / img.naturalHeight);
    ctx.save();
    ctx.globalAlpha = p.alpha;
    // A soft shadow while it stands on something (a toy on the ground, whichever way it has turned).
    if (!p.front && (Math.abs(p.rot) < 0.4 || p.lying)) {
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 0.5, w * 0.42, 2.5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.translate(p.x, p.y - h / 2);
    ctx.rotate(p.rot);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function drawShards(ctx: CanvasRenderingContext2D, snap: MessSnapshot, scale: number): void {
  for (const s of snap.shards) {
    if (s.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    if (s.kind === "water") {
      ctx.fillStyle = "rgba(120,185,245,0.75)";
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - s.h / 2, s.w, s.h * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === "soil") {
      ctx.fillStyle = "#6b4a2b";
      ctx.beginPath();
      ctx.arc(s.x, s.y - s.h / 2, s.w * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === "sliver") {
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.beginPath();
      for (let k = 0; k < s.poly.length; k += 2) {
        const px = ((s.poly[k] as number) - s.cx) * s.w;
        const py = ((s.poly[k + 1] as number) - s.cy) * s.h;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(205,228,255,0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else {
      const img = propImage(s.kind);
      if (img) {
        // The piece is cut from the drawing itself.
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.translate(-s.cx * s.w, -s.cy * s.h);
        ctx.beginPath();
        for (let k = 0; k < s.poly.length; k += 2) {
          const px = (s.poly[k] as number) * s.w;
          const py = (s.poly[k + 1] as number) * s.h;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.save();
        ctx.clip();
        ctx.drawImage(img, 0, 0, s.w, s.h);
        ctx.restore();
        // A faint light edge on the break.
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 0.6 * scale;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function drawStrips(ctx: CanvasRenderingContext2D, snap: MessSnapshot): void {
  if (snap.strips.length === 0) return;
  const c = chromeColors();
  for (const s of snap.strips) {
    if (s.alpha <= 0) continue;
    const r = seeded(s.seed);
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    // A torn strip: straight sides, ragged ends.
    ctx.beginPath();
    ctx.moveTo(-s.w / 2, -s.h / 2 + r() * 3);
    ctx.lineTo(-s.w / 6, -s.h / 2 - r() * 2);
    ctx.lineTo(s.w / 4, -s.h / 2 + r() * 3);
    ctx.lineTo(s.w / 2, -s.h / 2);
    ctx.lineTo(s.w / 2, s.h / 2 - r() * 3);
    ctx.lineTo(s.w / 5, s.h / 2 + r() * 2);
    ctx.lineTo(-s.w / 4, s.h / 2 - r() * 2);
    ctx.lineTo(-s.w / 2, s.h / 2);
    ctx.closePath();
    ctx.fillStyle = c.fill;
    ctx.fill();
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }
}

function drawFly(ctx: CanvasRenderingContext2D, snap: MessSnapshot, scale: number): void {
  const f = snap.fly;
  if (!f) return;
  // Bigger than a real fly next to a cat this size, or nobody would see what it is hunting.
  const s = Math.max(0.8, scale) * 1.7;
  ctx.save();
  ctx.translate(f.x, f.y);
  // Wings: a blur more than a flap, so they don't strobe.
  ctx.fillStyle = "rgba(225,235,245,0.7)";
  ctx.strokeStyle = "rgba(60,70,80,0.35)";
  ctx.lineWidth = 0.6;
  const flap = 0.75 + 0.25 * Math.sin(f.t * 60);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 2.4 * s, -2.2 * s, 2.8 * s, 1.6 * s * flap, side * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#1d1f22";
  ctx.beginPath();
  ctx.ellipse(0, 0, 2.7 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes, a dull red.
  ctx.fillStyle = "#7a2a24";
  ctx.beginPath();
  ctx.arc(2 * s, -0.4 * s, 0.8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Only the marks in windows (the playground draws them on a layer above its pretend windows). */
export function drawMarks(ctx: CanvasRenderingContext2D, snap: MessSnapshot | null, windows: WindowInfo[], scale: number): void {
  if (snap) drawDecals(ctx, snap, windows, scale);
}

/** Only the things standing about (and the puddles and piles). */
export function drawPropsOnly(ctx: CanvasRenderingContext2D, snap: MessSnapshot | null, scale: number): void {
  if (!snap) return;
  drawSpots(ctx, snap, scale);
  drawProps(ctx, snap, scale);
}

/** Things standing on windows and the marks in windows: drawn before the animal. */
export function drawMessBehind(ctx: CanvasRenderingContext2D, snap: MessSnapshot | null, windows: WindowInfo[], scale: number): void {
  if (!snap) return;
  drawDecals(ctx, snap, windows, scale);
  drawSpots(ctx, snap, scale);
  drawProps(ctx, snap, scale);
}

/** What flies through the air: drawn after the animal. */
export function drawMessFront(ctx: CanvasRenderingContext2D, snap: MessSnapshot | null, scale: number): void {
  if (!snap) return;
  drawProps(ctx, snap, scale, true);
  drawShards(ctx, snap, scale);
  drawStrips(ctx, snap);
  drawFly(ctx, snap, scale);
}
