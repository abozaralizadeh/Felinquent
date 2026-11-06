// A thought bubble over the animal's head, drawn on the overlay canvas. The thoughts come from the
// model (or the animal's own lines) and are the one place its wit shows, so the Mac app shows them
// too. The text is never logged (hard rule 6).
import type { Rect } from "../core/types";

/** How long a thought stays up, and its fade in and out, in seconds. */
export const THOUGHT_SEC = 6;
const FADE_IN = 0.3;
const FADE_OUT = 0.7;

export interface ShownThought {
  text: string;
  /** Seconds since it came up. */
  age: number;
}

/** 0 to 1, or 0 when it has gone. */
export function thoughtAlpha(age: number): number {
  if (age < 0 || age > THOUGHT_SEC) return 0;
  if (age < FADE_IN) return age / FADE_IN;
  if (age > THOUGHT_SEC - FADE_OUT) return (THOUGHT_SEC - age) / FADE_OUT;
  return 1;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/**
 * Draws the bubble with its little trail of dots down to the head at (x, headY). It stays inside
 * `area` (the display it is on).
 */
export function drawThought(ctx: CanvasRenderingContext2D, th: ShownThought | null, x: number, headY: number, area: Rect, dark: boolean): void {
  if (!th) return;
  const a = thoughtAlpha(th.age);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = "500 12.5px -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif";
  const lines = wrap(ctx, th.text, 190);
  const lh = 16;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22;
  const h = lines.length * lh + 14;
  // A gentle rise as it appears.
  const rise = (1 - Math.min(1, th.age / FADE_IN)) * 6;
  let bx = x + 18 - w / 2;
  let by = headY - 30 - h + rise;
  bx = Math.max(area.x + 6, Math.min(area.x + area.w - w - 6, bx));
  by = Math.max(area.y + 30, by);
  const fill = dark ? "rgba(44,44,48,0.94)" : "rgba(255,255,255,0.96)";
  const line = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)";
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 12);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Two small dots from the bubble down to the head: a thought, not something said.
  for (const [k, r] of [[0.45, 4], [0.8, 2.6]] as const) {
    const dx = x + 6;
    const dy = by + h + (headY - (by + h)) * k;
    ctx.beginPath();
    ctx.arc(dx, dy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = line;
    ctx.stroke();
  }
  ctx.fillStyle = dark ? "#f2f2f4" : "#2b2b30";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, bx + 11, by + 7 + i * lh));
  ctx.restore();
}
