import { characterById, type Character, type Palette } from "../core/characters";
import type { Anim, CatBody } from "../core/executor";
import { drawSprite, getSprites, spritesPending, spriteWidth } from "./sprites";

/**
 * Characters with illustrated sprites (sprites.ts) are drawn from those. Every other character is
 * drawn in code, which is also the fallback while images load. Cute on purpose: a big head, big
 * shiny eyes, blush, a little squash and stretch, and hearts.
 */
type Fx = "hearts" | "puff" | "notes" | "sparkle" | "anger" | "alarm" | "sweat" | "dust";

interface Pose {
  body: { x: number; y: number; rx: number; ry: number; rot: number };
  head: { x: number; y: number; r: number };
  legs: "sit" | "walk" | "run" | "loaf" | "dangle" | "air" | "crouch" | "perch" | "none";
  eyes: "open" | "closed" | "half" | "wide" | "away" | "happy";
  mouth: "smile" | "open" | "none" | "chatter";
  ears: "up" | "flat";
  tail: "up" | "curl" | "low" | "wrap";
  paw: boolean;
  /** Both front paws pressing, one after the other. */
  knead?: boolean;
  /** The whole cat rocks fast (chasing its own tail). */
  spin?: boolean;
  fx?: Fx;
}

const SIT = { body: { x: 0, y: -30, rx: 25, ry: 29, rot: 0 }, head: { x: 8, y: -68, r: 22 } };
const LOW = { body: { x: 0, y: -44, rx: 40, ry: 20, rot: 0 }, head: { x: 38, y: -58, r: 20 } };
/** The head is drawn bigger than the pose says, so everyone looks like a baby. */
const HEAD_K = 1.22;

export function poseFor(anim: Anim): Pose {
  const base: Pose = { ...SIT, legs: "sit", eyes: "open", mouth: "smile", ears: "up", tail: "curl", paw: false };
  switch (anim) {
    case "loaf": return { ...base, body: { x: 0, y: -22, rx: 44, ry: 22, rot: 0 }, head: { x: 30, y: -36, r: 20 }, legs: "loaf", eyes: "half" };
    case "sleep": return { ...base, body: { x: 0, y: -22, rx: 42, ry: 20, rot: 0 }, head: { x: 20, y: -20, r: 17 }, legs: "loaf", eyes: "closed", mouth: "none", tail: "wrap" };
    case "walk": return { ...base, ...LOW, legs: "walk", tail: "up" };
    case "run": return { ...base, body: { x: 0, y: -42, rx: 46, ry: 17, rot: 0 }, head: { x: 46, y: -50, r: 19 }, legs: "run", tail: "up", eyes: "wide" };
    case "keyboard": return { ...base, ...LOW, legs: "walk", tail: "up", eyes: "wide" };
    case "jump": return { ...base, body: { x: 0, y: -50, rx: 44, ry: 17, rot: -0.25 }, head: { x: 46, y: -66, r: 19 }, legs: "air", tail: "low", eyes: "wide", mouth: "open" };
    case "fall": return { ...base, body: { x: 0, y: -50, rx: 36, ry: 22, rot: 0.2 }, head: { x: 30, y: -48, r: 20 }, legs: "air", eyes: "wide", mouth: "open", tail: "up" };
    case "land": return { ...base, body: { x: 0, y: -24, rx: 32, ry: 24, rot: 0 }, head: { x: 20, y: -44, r: 21 }, legs: "crouch" };
    case "perch": return { ...base, legs: "perch", eyes: "half" };
    case "watch_stand": return { ...base, ...LOW, legs: "walk", tail: "up", eyes: "wide" };
    case "groom": return { ...base, paw: true, eyes: "closed" };
    case "stretch": return { ...base, body: { x: 0, y: -34, rx: 42, ry: 18, rot: 0.3 }, head: { x: 46, y: -22, r: 19 }, legs: "crouch", eyes: "closed", mouth: "open" };
    case "look": return { ...base, head: { x: 14, y: -68, r: 22 } };
    case "meow": return { ...base, mouth: "open" };
    case "purr": return { ...base, eyes: "happy", fx: "hearts" };
    case "happy": return { ...base, eyes: "happy", mouth: "open", fx: "hearts" };
    case "swat": return { ...base, ...LOW, head: { x: 40, y: -52, r: 20 }, legs: "crouch", paw: true, eyes: "wide", tail: "up" };
    case "pounce": return { ...base, ...LOW, legs: "crouch", paw: true, eyes: "wide" };
    case "headbutt": return { ...base, head: { x: 20, y: -62, r: 22 }, eyes: "happy", fx: "hearts" };
    case "sulk": return { ...base, eyes: "away", mouth: "none", ears: "flat", tail: "low", head: { x: -4, y: -66, r: 22 } };
    case "turn_away": return { ...base, eyes: "away", mouth: "none", head: { x: -4, y: -68, r: 22 } };
    case "dangle": return { ...base, body: { x: 0, y: -48, rx: 20, ry: 30, rot: 0 }, head: { x: 0, y: -84, r: 20 }, legs: "dangle", eyes: "wide", mouth: "open", tail: "low" };
    case "stare": return { ...base, eyes: "wide", mouth: "none" };
    case "blink": return { ...base, eyes: "half", fx: "hearts" };
    case "hairball": return { ...base, ...LOW, head: { x: 42, y: -38, r: 20 }, legs: "crouch", eyes: "closed", mouth: "open" };
    case "gift": return { ...base, eyes: "happy", fx: "sparkle" };
    case "box": return { ...base, body: { x: 0, y: -26, rx: 24, ry: 26, rot: 0 }, head: { x: 8, y: -56, r: 20 }, legs: "none" };
    case "push_toy": return { ...base, ...LOW, head: { x: 40, y: -56, r: 20 }, legs: "crouch", paw: true };
    case "peek": return { ...base, head: { x: 20, y: -58, r: 22 }, eyes: "wide", legs: "perch", paw: true };
    case "chase_tail": return { ...base, eyes: "wide", mouth: "open", tail: "up", spin: true };
    case "knead": return { ...base, ...LOW, head: { x: 38, y: -48, r: 20 }, legs: "crouch", eyes: "happy", knead: true, fx: "hearts" };
    case "chatter": return { ...base, head: { x: 12, y: -74, r: 22 }, eyes: "wide", mouth: "chatter", fx: "notes" };
    case "sneeze": return { ...base, head: { x: 20, y: -56, r: 22 }, eyes: "closed", mouth: "open", fx: "puff" };
    case "angry":
    case "hiss": return { ...base, ears: "flat", fx: "anger" };
    case "puffed":
    case "startled": return { ...base, eyes: "wide", fx: "alarm" };
    case "flustered": return { ...base, eyes: "closed", fx: "sweat" };
    case "play_bow":
    case "bark":
    case "giggle":
    case "bounce": return { ...base, mouth: "open", eyes: "happy", fx: "sparkle" };
    case "belly":
    case "love":
    case "beg": return { ...base, eyes: "happy", fx: "hearts" };
    case "howl": return { ...base, mouth: "open", eyes: "closed", fx: "notes" };
    case "dig":
    case "cover":
    case "tumble": return { ...base, legs: "crouch", fx: "dust" };
    case "pee":
    case "poop": return { ...base, ...LOW, legs: "crouch", eyes: "half", tail: "up" };
    case "potty_look": return { ...base, ...LOW, head: { x: -10, y: -56, r: 20 }, legs: "walk", tail: "up" };
    default: return base;
  }
}

type Ctx = CanvasRenderingContext2D;

function ell(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string, stroke = true): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

function tri(ctx: Ctx, pts: [number, number][], fill: string, stroke = true): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) ctx.stroke();
}

function limb(ctx: Ctx, pal: Palette, color: string, x0: number, y0: number, x1: number, y1: number): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
}

/** Fox and raccoon legs are dark, like socks. */
function legColor(ch: Character): string {
  return ch.species === "fox" || ch.species === "raccoon" ? ch.palette.mark : ch.palette.base;
}

function legs(ctx: Ctx, ch: Character, p: Pose, t: number): void {
  const b = p.body;
  const pal = ch.palette;
  const c = legColor(ch);
  const L = (x0: number, y0: number, x1: number, y1: number) => limb(ctx, pal, c, x0, y0, x1, y1);
  const sw = (speed: number, phase: number, amp: number) => Math.sin(t * speed + phase) * amp;
  switch (p.legs) {
    case "walk":
    case "run": {
      const [s, a] = p.legs === "run" ? [18, 22] : [9, 12];
      L(b.x - b.rx * 0.6, b.y + 8, b.x - b.rx * 0.6 + sw(s, 0, a), 0);
      L(b.x - b.rx * 0.3, b.y + 8, b.x - b.rx * 0.3 + sw(s, Math.PI, a), 0);
      L(b.x + b.rx * 0.5, b.y + 8, b.x + b.rx * 0.5 + sw(s, Math.PI, a), 0);
      L(b.x + b.rx * 0.75, b.y + 8, b.x + b.rx * 0.75 + sw(s, 0, a), 0);
      break;
    }
    case "sit":
      L(b.x + 8, b.y + 18, b.x + 10, -3);
      L(b.x - 8, b.y + 22, b.x - 10, -3);
      break;
    case "perch":
      L(b.x + 8, b.y + 18, b.x + 12, b.y + 44 + sw(3, 0, 4));
      L(b.x - 6, b.y + 22, b.x - 6, b.y + 48 + sw(3, 1.5, 4));
      break;
    case "crouch":
      L(b.x + b.rx * 0.5, b.y + 10, b.x + b.rx * 0.7 + 8, -2);
      L(b.x - b.rx * 0.5, b.y + 10, b.x - b.rx * 0.6, -2);
      break;
    case "air":
      L(b.x + b.rx * 0.6, b.y, b.x + b.rx + 16, b.y - 8 + sw(10, 0, 5));
      L(b.x - b.rx * 0.6, b.y, b.x - b.rx - 14, b.y + 6 + sw(10, 2, 5));
      break;
    case "dangle":
      L(b.x + 8, b.y + 20, b.x + 12 + sw(6, 0, 4), b.y + 52);
      L(b.x - 8, b.y + 20, b.x - 12 + sw(6, 2, 4), b.y + 50);
      break;
    default:
      break;
  }
}

function quad(t: number, p0: number, p1: number, p2: number): number {
  return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
}

function tail(ctx: Ctx, ch: Character, p: Pose, t: number, wag: boolean): void {
  const b = p.body;
  const pal = ch.palette;
  const x0 = b.x - b.rx * 0.9;
  const y0 = b.y;
  let c1x: number, c1y: number, x1: number, y1: number;
  if (p.tail === "up") {
    c1x = x0 - 22;
    c1y = y0 - 30 + Math.sin(t * 4) * 5;
    x1 = x0 - 6 + Math.sin(t * (p.spin ? 12 : 4)) * 8;
    y1 = y0 - 56;
  } else if (p.tail === "low") {
    c1x = x0 - 20;
    c1y = y0 + 6;
    x1 = x0 - 36 + Math.sin(t * 5) * 6;
    y1 = y0 + 4;
  } else if (p.tail === "wrap") {
    c1x = x0 - 10;
    c1y = y0 + 24;
    x1 = b.x + b.rx * 0.9;
    y1 = y0 + 18;
  } else {
    c1x = x0 - 26 + Math.sin(t * 2) * 4;
    c1y = y0 + 4;
    x1 = x0 - 20;
    y1 = y0 - 26;
  }
  if (ch.species === "rabbit") {
    // A cotton puff, no tail to speak of.
    ell(ctx, x0 - 2, y0 - 4 + Math.sin(t * 3) * 1, 11, 10, 0, pal.belly);
    return;
  }
  if (ch.species === "squirrel") {
    // A big bushy tail that curls up over the back, with a flick at the tip.
    const flick = Math.sin(t * (p.spin ? 12 : 3)) * 6;
    const up = p.tail === "low" || p.tail === "wrap" ? 0.5 : 1;
    c1x = x0 - 34;
    c1y = y0 - 24 * up;
    x1 = x0 - 4 + flick;
    y1 = y0 - 70 * up;
  }
  if (ch.species === "dog") {
    // A curved tail that sweeps up and back and wags by swinging around its base.
    // (A fat straight bar that slid sideways looked like a blinking text cursor.)
    const a = -Math.PI / 2 - 0.6 + (wag ? Math.sin(t * 9) * 0.4 : 0);
    const len = 40;
    x1 = x0 + Math.cos(a) * len;
    y1 = y0 + Math.sin(a) * len;
    c1x = x0 + Math.cos(a + 0.55) * len * 0.6;
    c1y = y0 + Math.sin(a + 0.55) * len * 0.6;
  }
  const fat = ch.species === "squirrel" ? 15 : ch.species === "fox" || ch.species === "raccoon" ? 11 : ch.species === "dog" ? 6 : 5.5;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(c1x, c1y, x1, y1);
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = fat * 2 + 3.5;
  path();
  ctx.stroke();
  ctx.strokeStyle = pal.base;
  ctx.lineWidth = fat * 2;
  path();
  ctx.stroke();
  if (ch.species === "raccoon") {
    ctx.fillStyle = pal.mark;
    for (const k of [0.35, 0.6, 0.85]) {
      const px = quad(k, x0, c1x, x1);
      const py = quad(k, y0, c1y, y1);
      ctx.beginPath();
      ctx.arc(px, py, fat * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (ch.species === "fox" || ch.species === "dog") {
    // A light tip (a paintbrush on the fox, a fluffy end on the dog).
    ctx.fillStyle = ch.palette.belly;
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x1, y1, fat * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function heart(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.6, y - s * 1.1, x, y - s * 0.55);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s, y - s * 0.3, x, y + s * 0.35);
  ctx.closePath();
  ctx.fill();
}

function ears(ctx: Ctx, ch: Character, p: Pose): void {
  const { x, y, r } = p.head;
  const pal = ch.palette;
  const flat = p.ears === "flat";
  for (const side of [-1, 1]) {
    const bx = x + side * r * 0.62;
    if (ch.species === "cat" || ch.species === "fox") {
      const tall = ch.species === "fox" ? 1.95 : 1.55;
      const tip: [number, number] = [bx + (flat ? side * r * 0.6 : side * r * 0.1), y - r * (flat ? 1.0 : tall)];
      tri(ctx, [[bx - side * r * 0.5, y - r * 0.45], tip, [bx + side * r * 0.28, y - r * 0.15]], pal.base);
      // inside of the ear
      tri(ctx, [[bx - side * r * 0.28, y - r * 0.5], [tip[0] - side * r * 0.04, tip[1] + r * 0.38], [bx + side * r * 0.12, y - r * 0.3]], pal.ear, false);
      if (ch.species === "fox") {
        ctx.fillStyle = pal.mark;
        ctx.beginPath();
        ctx.moveTo(tip[0] - side * r * 0.22, tip[1] + r * 0.4);
        ctx.lineTo(tip[0], tip[1]);
        ctx.lineTo(tip[0] + side * r * 0.2, tip[1] + r * 0.42);
        ctx.closePath();
        ctx.fill();
      }
    } else if (ch.species === "raccoon") {
      ell(ctx, bx, y - r * (flat ? 0.75 : 0.95), r * 0.34, r * 0.34, 0, pal.mark);
      ell(ctx, bx, y - r * (flat ? 0.72 : 0.92), r * 0.17, r * 0.17, 0, pal.ear, false);
    } else if (ch.species === "rabbit") {
      // Long ears that stand up, or lie back along the neck when it's cross.
      ctx.save();
      ctx.translate(x + side * r * 0.3, y - r * 0.6);
      ctx.rotate(flat ? -1.3 : side * 0.18 - 0.12);
      ell(ctx, 0, -r * 0.85, r * 0.26, r * 0.9, 0, pal.base);
      ell(ctx, 0, -r * 0.8, r * 0.13, r * 0.7, 0, pal.ear, false);
      ctx.restore();
    } else if (ch.species === "squirrel") {
      // Small round ears with a tuft on top.
      const ey = y - r * (flat ? 0.7 : 0.88);
      ell(ctx, bx, ey, r * 0.24, r * 0.3, 0, pal.base);
      ell(ctx, bx, ey + 1, r * 0.12, r * 0.16, 0, pal.ear, false);
      if (!flat) tri(ctx, [[bx - r * 0.12, ey - r * 0.2], [bx + side * r * 0.08, ey - r * 0.62], [bx + r * 0.12, ey - r * 0.2]], pal.mark, false);
    } else if (/chihuahua/.test(ch.personality.species ?? "")) {
      // Huge upright ears, wider than the head.
      const tip: [number, number] = [bx + side * r * (flat ? 1.2 : 0.75), y - r * (flat ? 0.9 : 1.55)];
      tri(ctx, [[bx - side * r * 0.45, y - r * 0.55], tip, [bx + side * r * 0.45, y - r * 0.05]], pal.base);
      tri(ctx, [[bx - side * r * 0.22, y - r * 0.5], [tip[0] - side * r * 0.08, tip[1] + r * 0.32], [bx + side * r * 0.25, y - r * 0.15]], pal.ear, false);
    } else {
      // Floppy dog ears that hang past the cheeks.
      const sag = flat ? 1.0 : 0.8;
      ctx.save();
      ctx.translate(x + side * r * 0.9, y - r * 0.35);
      ctx.rotate(side * (0.25 + 0.1 * Math.sin((x + y) * 0.1)));
      ell(ctx, 0, r * 0.45 * sag, r * 0.34, r * 0.62 * sag, 0, pal.mark);
      ctx.restore();
    }
  }
}

function face(ctx: Ctx, ch: Character, p: Pose, t: number): void {
  const { x, y, r } = p.head;
  const pal = ch.palette;
  ctx.strokeStyle = pal.line;
  if (p.eyes === "away") {
    // The back of the head: no face, just a little mark.
    ctx.strokeStyle = pal.mark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - r + 4);
    ctx.lineTo(x, y - 4);
    ctx.stroke();
    return;
  }
  // Muzzle first, so the nose and mouth sit on it.
  const muzzle = ch.species !== "cat";
  const fx0 = muzzle ? 0.18 : 0.12;
  if (ch.pattern === "fox") {
    // White cheek fluff.
    ctx.fillStyle = pal.belly;
    for (const s of [-1, 1]) {
      tri(ctx, [[x + s * r * 0.35, y + r * 0.1], [x + s * r * 1.12, y + r * 0.55], [x + s * r * 0.2, y + r * 0.88]], pal.belly, false);
    }
  }
  if (ch.pattern === "raccoon") {
    // The bandit mask.
    ctx.save();
    ctx.fillStyle = pal.mark;
    ctx.translate(x + r * 0.1, y - r * 0.02);
    ctx.rotate(-0.04);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.98, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (muzzle) ell(ctx, x + r * 0.42, y + r * 0.46, r * 0.4, r * 0.3, 0, ch.species === "raccoon" ? "#f1eef5" : pal.belly, false);

  const ex = [x - r * 0.3 + r * fx0 * 0.4, x + r * 0.5 + r * fx0 * 0.2];
  const ey = y - r * (muzzle ? 0.14 : 0.04);
  const blinking = (t % 3.7) < 0.12 && (p.eyes === "open" || p.eyes === "wide");
  for (const e of ex) {
    const wide = p.eyes === "wide";
    if (p.eyes === "closed" || blinking) {
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(e, ey + 1, 5, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    } else if (p.eyes === "happy") {
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(e, ey + 4, 5.2, 1.12 * Math.PI, 1.88 * Math.PI);
      ctx.stroke();
    } else if (p.eyes === "half") {
      ell(ctx, e, ey + 1.5, 5.4, 3.2, 0, pal.eye, false);
      ell(ctx, e, ey + 1.5, 2.6, 2.6, 0, "#1b1620", false);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(e - 1.6, ey + 0.4, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const rx = wide ? 6.6 : 5.8;
      const ry = wide ? 8.6 : 7.4;
      ell(ctx, e, ey, rx, ry, 0, pal.eye, false);
      ell(ctx, e + 0.4, ey + 0.8, rx * 0.56, ry * 0.62, 0, "#1b1620", false);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(e - rx * 0.32, ey - ry * 0.36, rx * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(e + rx * 0.34, ey + ry * 0.34, rx * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Blush.
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const e of ex) ell(ctx, e + (e < x ? -2 : 2), ey + r * 0.42, 4.6, 2.9, 0, pal.blush, false);
  ctx.restore();

  // Nose.
  const nx = x + r * (muzzle ? 0.64 : 0.24);
  const ny = y + r * (muzzle ? 0.36 : 0.2);
  ctx.lineWidth = 2;
  if (ch.species === "cat") {
    tri(ctx, [[nx - 3.2, ny], [nx + 3.2, ny], [nx, ny + 3.6]], "#f08c9a", false);
  } else {
    if (ch.species === "rabbit") tri(ctx, [[nx - 3, ny], [nx + 3, ny], [nx, ny + 3]], "#f08c9a", false);
    else ell(ctx, nx, ny + 1, ch.species === "dog" ? 5.2 : 4, ch.species === "dog" ? 3.8 : 3, 0, "#3a2a2e", false);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(nx - 1.4, ny, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mouth.
  const mx = nx - (muzzle ? 0.5 : 0);
  const my = ny + (muzzle ? 5 : 3.6);
  ctx.strokeStyle = pal.line;
  const open = p.mouth === "open" || (p.mouth === "chatter" && Math.sin(t * 30) > 0);
  if (open) {
    ell(ctx, mx, my + 3, 3.6, 4.6, 0, "#7a2d3a", false);
    ell(ctx, mx, my + 5, 2.2, 1.8, 0, "#f08c9a", false);
  } else if (p.mouth !== "none") {
    ctx.beginPath();
    ctx.moveTo(mx, my - 1);
    ctx.quadraticCurveTo(mx - 3.5, my + 4.5, mx - 7, my + 1);
    ctx.moveTo(mx, my - 1);
    ctx.quadraticCurveTo(mx + 3.5, my + 4.5, mx + 7, my + 1);
    ctx.stroke();
    if (ch.species === "dog" && p.eyes === "happy") ell(ctx, mx, my + 5.5, 3, 2.6, 0, "#f08c9a", false);
  }
  if (ch.species === "cat") {
    ctx.lineWidth = 1.4;
    for (const dy of [-1, 3]) {
      ctx.beginPath();
      ctx.moveTo(x + r * 0.7, y + r * 0.3 + dy);
      ctx.lineTo(x + r * 1.32, y + r * 0.18 + dy * 2);
      ctx.moveTo(x - r * 0.2, y + r * 0.3 + dy);
      ctx.lineTo(x - r * 0.82, y + r * 0.18 + dy * 2);
      ctx.stroke();
    }
  }
}

function head(ctx: Ctx, ch: Character, p: Pose, t: number): void {
  const { x, y, r } = p.head;
  const pal = ch.palette;
  ears(ctx, ch, p);
  ell(ctx, x, y, r * (ch.species === "fox" ? 1.08 : 1), r * 0.92, 0, pal.base);
  if (ch.pattern === "stripes") {
    ctx.save();
    ctx.strokeStyle = pal.mark;
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    for (const dx of [-5, 0, 5]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y - r * 0.9);
      ctx.lineTo(x + dx * 0.8, y - r * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (ch.species === "dog" && !/chihuahua/.test(ch.personality.species ?? "")) {
    // A soft patch around one eye.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ell(ctx, x - r * 0.3, y - r * 0.05, r * 0.38, r * 0.42, 0, pal.mark, false);
    ctx.restore();
  }
  ctx.lineWidth = 3;
  face(ctx, ch, p, t);
}

function collar(ctx: Ctx, ch: Character, p: Pose): void {
  const acc = ch.accessory;
  if (!acc) return;
  const { x, y, r } = p.head;
  const cy = y + r * 0.86;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = ch.palette.line;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.62, cy - 1);
  ctx.quadraticCurveTo(x + r * 0.05, cy + 8, x + r * 0.7, cy - 1);
  ctx.stroke();
  ctx.strokeStyle = acc.color;
  ctx.lineWidth = 5.5;
  ctx.stroke();
  if (acc.charm) {
    ctx.fillStyle = "#ffd75a";
    ctx.strokeStyle = ch.palette.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + r * 0.08, cy + 7, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export interface DrawOptions {
  scale: number;
  /** Seconds, for swings and breathing. */
  t: number;
  cursor?: { x: number; y: number };
  /** Which character to draw. Defaults to Tabby. */
  character?: string;
  /** Forces the position in a walking cycle, 0 to 1 (the filmstrip page uses it). */
  phase?: number;
  /** Which drawing this is, when one page draws the same character several times (each keeps its own fades and turns). */
  slot?: string;
}

/** Draws the character with its feet at body.x, body.y. */
export function drawCat(ctx: Ctx, body: CatBody, o: DrawOptions): void {
  if (body.hidden) return;
  const ch = characterById(o.character);
  const pal = ch.palette;
  const p = poseFor(body.anim);
  const scale = o.scale * ch.size;
  const moving = body.anim === "walk" || body.anim === "run" || body.anim === "keyboard";

  // Squash and stretch, breathing and a little walking bob.
  let sx = 1;
  let sy = 1;
  if (body.anim === "land") ((sx = 1.14), (sy = 0.86));
  else if (body.anim === "jump") ((sx = 0.92), (sy = 1.1));
  else if (body.anim === "fall") ((sx = 0.94), (sy = 1.08));
  else sy = 1 + Math.sin(o.t * (body.anim === "sleep" ? 1.6 : 2.4)) * 0.018;
  const bob = moving ? -Math.abs(Math.sin(o.t * (body.anim === "run" ? 14 : 9))) * 2.2 : 0;
  const wag = ch.species === "dog" && body.anim !== "sleep" && body.anim !== "sulk";
  const spr = getSprites(ch.id);
  if (!spr && spritesPending(ch.id)) return;

  // A soft shadow on the ground, so it sits on the window instead of floating over it.
  if (body.anim !== "fall" && body.anim !== "jump" && body.anim !== "dangle" && body.anim !== "hang") {
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    ctx.beginPath();
    ctx.ellipse(0, 1, (spr ? spriteWidth(spr, body.anim, o.t) * 0.4 : 34) * scale, 5.5 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (spr) {
    // The sprite gaits bob in their own frames, so the walking bob above is only for the drawn-in-code art.
    const head = drawSprite(ctx, spr, body.facing, body.anim, body.x, body.y, scale, o.t, { sx, sy, bob: 0, vy: body.vy, phase: o.phase, slot: o.slot, cursor: o.cursor });
    drawEffects(ctx, body, p.fx, head, scale, o.t);
    return;
  }

  ctx.save();
  ctx.translate(body.x, body.y + bob);
  ctx.scale(scale * body.facing * sx, scale * sy);
  ctx.lineWidth = 3.2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = pal.line;
  const shake = body.anim === "purr" || body.anim === "sneeze" ? Math.sin(o.t * 60) * 0.8 : 0;
  ctx.translate(shake, 0);
  if (p.spin) {
    ctx.translate(p.body.x, p.body.y);
    ctx.rotate(Math.sin(o.t * 9) * 0.35);
    ctx.translate(-p.body.x, -p.body.y);
  }
  tail(ctx, ch, p, o.t, wag);
  legs(ctx, ch, p, o.t);
  const b = p.body;
  ell(ctx, b.x, b.y, b.rx, b.ry, b.rot, pal.base);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(b.x, b.y, b.rx - 1, b.ry - 1, b.rot, 0, Math.PI * 2);
  ctx.clip();
  if (ch.pattern === "stripes") {
    ctx.strokeStyle = pal.mark;
    ctx.lineWidth = 4.5;
    ctx.lineCap = "round";
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(b.x + i * 12, b.y - b.ry);
      ctx.lineTo(b.x + i * 12 + 4, b.y - b.ry * 0.3);
      ctx.stroke();
    }
  }
  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.ellipse(b.x + b.rx * 0.2, b.y + b.ry * 0.55, b.rx * 0.58, b.ry * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 3.2;
  // Head, a little bigger than the pose says.
  ctx.save();
  ctx.translate(p.head.x, p.head.y);
  ctx.scale(HEAD_K, HEAD_K);
  ctx.translate(-p.head.x, -p.head.y);
  collar(ctx, ch, p);
  head(ctx, ch, p, o.t);
  ctx.restore();
  if (p.paw) {
    const swing = Math.sin(o.t * 9) * 6;
    limb(ctx, pal, legColor(ch), p.head.x + 6, p.head.y + 24, p.head.x + 16 + swing, p.head.y - 2 + swing);
  }
  if (p.knead) {
    const a = Math.sin(o.t * 7) * 5;
    limb(ctx, pal, legColor(ch), p.head.x + 4, -14, p.head.x + 18, -2 + a);
    limb(ctx, pal, legColor(ch), p.head.x - 8, -14, p.head.x + 6, -2 - a);
  }
  ctx.restore();

  drawEffects(ctx, body, p.fx, p.head, scale, o.t);
}

/** Effects are drawn upright (not mirrored), above the head. */
function drawEffects(ctx: Ctx, body: CatBody, fx: Fx | undefined, head: { x: number; y: number }, scale: number, t: number): void {
  ctx.save();
  ctx.translate(body.x, body.y);
  ctx.scale(scale, scale);
  const hx = head.x * body.facing;
  const hy = head.y;
  const f = (t * 0.8) % 1;
  if (body.anim === "sleep") {
    ctx.fillStyle = "rgba(100,80,120,0.85)";
    ctx.font = "bold 18px system-ui";
    ctx.globalAlpha = 1 - f;
    ctx.fillText("z", hx + 14 + f * 10, hy - 22 - f * 22);
    ctx.fillText("Z", hx + 28 + f * 8, hy - 36 - f * 22);
  } else if (fx === "hearts") {
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.7 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(Math.PI * k);
      ctx.fillStyle = i % 2 ? "#ff7aa8" : "#ff4f86";
      heart(ctx, hx + (i - 1) * 14, hy - 34 - k * 30, 5.5 + (i === 1 ? 1.5 : 0));
    }
  } else if (fx === "sparkle") {
    ctx.fillStyle = "#ffd75a";
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.2 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(Math.PI * k);
      const sxp = hx + (i - 1) * 16;
      const syp = hy - 30 - k * 22;
      ctx.beginPath();
      ctx.moveTo(sxp, syp - 5);
      ctx.lineTo(sxp + 1.6, syp - 1.6);
      ctx.lineTo(sxp + 5, syp);
      ctx.lineTo(sxp + 1.6, syp + 1.6);
      ctx.lineTo(sxp, syp + 5);
      ctx.lineTo(sxp - 1.6, syp + 1.6);
      ctx.lineTo(sxp - 5, syp);
      ctx.lineTo(sxp - 1.6, syp - 1.6);
      ctx.closePath();
      ctx.fill();
    }
  } else if (fx === "notes") {
    ctx.fillStyle = "#6a8fe8";
    ctx.font = "bold 16px system-ui";
    for (let i = 0; i < 2; i++) {
      const k = (t * 1.1 + i / 2) % 1;
      ctx.globalAlpha = Math.sin(Math.PI * k);
      ctx.fillText(i ? "♫" : "♪", hx + 18 + i * 12, hy - 22 - k * 22);
    }
  } else if (fx === "anger") {
    // A little pulsing cross of anger above the head.
    const k = (t * 3.2) % 1;
    const grow = 1 + 0.35 * Math.sin(k * Math.PI);
    ctx.strokeStyle = "#e5473b";
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    const ax = hx + 10;
    const ay = hy - 34;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const a = Math.atan2(-sy, -sx);
        ctx.beginPath();
        ctx.arc(ax + sx * 6.5 * grow, ay + sy * 6.5 * grow, 5.5 * grow, a - 1.15, a + 1.15);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.5 * (1 - k);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(hx - 18 - k * 14 - i * 8, hy + 4 - i * 6 - k * 6, 3 + k * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (fx === "alarm") {
    // A quick yellow exclamation mark that pops and drifts up.
    const k = (t * 1.5) % 1;
    const pop = k < 0.2 ? k / 0.2 : 1;
    ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
    ctx.fillStyle = "#ffb627";
    ctx.strokeStyle = "rgba(90,50,0,0.7)";
    ctx.lineWidth = 1.5;
    const ex = hx + 6;
    const ey = hy - 36 - k * 6;
    ctx.beginPath();
    ctx.roundRect(ex - 3 * pop, ey - 14 * pop, 6 * pop, 12 * pop, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey + 4, 2.4 * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (fx === "sweat") {
    ctx.fillStyle = "#7ec8ff";
    ctx.strokeStyle = "rgba(30,90,160,0.6)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const k = (t * 1.1 + i * 0.5) % 1;
      ctx.globalAlpha = Math.sin(Math.PI * k);
      const dx = hx + 16 + i * 9;
      const dy = hy - 20 + k * 18;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 6);
      ctx.quadraticCurveTo(dx + 4, dy, dx, dy + 3);
      ctx.quadraticCurveTo(dx - 4, dy, dx, dy - 6);
      ctx.fill();
      ctx.stroke();
    }
  } else if (fx === "dust") {
    ctx.fillStyle = "rgba(170,140,100,0.8)";
    for (let i = 0; i < 4; i++) {
      const k = (t * 2.4 + i / 4) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(hx * 0.3 - 24 + i * 9 - k * 12, -4 - k * 22 - (i % 2) * 6, 2.2 + k * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (fx === "puff") {
    const k = (t * 1.6) % 1;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(hx + 30 + k * 24 + i * 5, hy + 4 - i * 5, 4 + k * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
