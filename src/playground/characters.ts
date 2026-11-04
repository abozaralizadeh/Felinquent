// A sheet of every character in a few poses, for checking the art and for docs.
import { CHARACTERS } from "../core/characters";
import type { Anim, CatBody } from "../core/executor";
import { drawCat } from "./draw";
import { spritesReady } from "./sprites";

const canvas = document.getElementById("sheet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const q = new URLSearchParams(location.search);
const ALL: Anim[] = ["idle_sit", "walk", "loaf", "sleep", "purr", "chatter", "knead", "peek", "sneeze", "chase_tail", "land"];
// ?only=mochi&big=1 draws one character large, in the first four poses, for a close look.
const only = q.get("only");
const big = q.has("big");
// ?strip=walk draws the same animation at 9 moments, 90 ms apart (?step=0.25 changes that), to check a cycle frame by frame.
const strip = q.get("strip") as Anim | null;
const stepSec = Number(q.get("step") ?? "0.09");
// ?poses=angry,hiss,belly draws exactly those animations (with ?only=biscuit&big=1 for one character).
const custom = q.get("poses")?.split(",") as Anim[] | undefined;
const POSES: Anim[] = custom ?? (strip ? Array.from({ length: 9 }, () => strip) : big ? ALL.slice(0, 4) : ALL);
const list = only ? CHARACTERS.filter((c) => c.id === only) : CHARACTERS;
if (big) {
  canvas.width = strip ? 1800 : custom ? Math.max(1320, custom.length * 220) : 1320;
  canvas.height = 360;
}
const colW = canvas.width / POSES.length;
const rowH = canvas.height / list.length;
const sc = big ? 2.6 : 1.05;
const t = Number(q.get("t") ?? "1.3");

ctx.font = "600 13px system-ui";

// ?walk=1&only=tabby walks one character to and fro over a floor marked every 10 px, in real time,
// with turns and the gait chosen by speed (?speed=64 is a walk, 100 a dog's walk, 230 a run).
// ?film=8 draws 8 moments instead, every ?every=3 frames (1/60 s each), each over the same patch of
// floor, to check that a planted paw stays on its mark. ?zoom=3 sets the size.
if (q.has("walk")) {
  const c = (list[0] ?? CHARACTERS[0]) as (typeof CHARACTERS)[number];
  const speed = Number(q.get("speed") ?? "64");
  const film = Number(q.get("film") ?? "0");
  const every = Number(q.get("every") ?? "3");
  const zoom = Number(q.get("zoom") ?? "3");
  const anim: Anim = speed >= 200 ? "run" : "walk";
  const cellW = 150 * zoom;
  const cellH = 120 * zoom;
  const cols = 4;
  canvas.width = film ? cols * cellW : 1400;
  canvas.height = film ? Math.ceil(film / cols) * cellH : Math.round(cellH);
  const st = { x: 300, dir: 1 as 1 | -1, turn: 0, t: 0 };
  const right = film ? 1e9 : canvas.width / zoom - 60;
  const advance = (dt: number): void => {
    st.t += dt;
    if (st.turn > 0) {
      st.turn -= dt;
      return;
    }
    st.x += st.dir * speed * dt;
    if ((st.dir === 1 && st.x > right) || (st.dir === -1 && st.x < 60)) {
      st.dir = st.dir === 1 ? -1 : 1;
      st.turn = 0.28;
    }
  };
  /** Draws the floor and the animal in a cell whose left edge is world x `wx`. */
  const scene = (cx: number, cy: number, w: number, h: number, wx: number): void => {
    const floor = cy + h - 14 * zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, w, h);
    ctx.clip();
    ctx.fillStyle = "#efe6da";
    ctx.fillRect(cx, cy, w, h);
    ctx.strokeStyle = "#b9a38c";
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(wx / 10) * 10; gx < wx + w / zoom; gx += 10) {
      ctx.beginPath();
      ctx.moveTo(cx + (gx - wx) * zoom, floor);
      ctx.lineTo(cx + (gx - wx) * zoom, floor + (gx % 50 === 0 ? 12 : 6) * zoom);
      ctx.stroke();
    }
    ctx.translate(cx - wx * zoom, floor);
    ctx.scale(zoom, zoom);
    const body: CatBody = { x: st.x, y: 0, vx: 0, vy: 0, facing: st.dir, platformId: "dock", anim, hidden: false };
    drawCat(ctx, body, { scale: 1, t: st.t, character: c.id, slot: "walk" });
    ctx.restore();
  };
  void spritesReady().then(() => {
    if (film) {
      // Warm up, so the gait and the speed have settled before the frames that are kept.
      const off = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
      for (let i = 0; i < 120; i++) {
        advance(1 / 60);
        const body: CatBody = { x: st.x, y: 0, vx: 0, vy: 0, facing: st.dir, platformId: "dock", anim, hidden: false };
        drawCat(off, body, { scale: 1, t: st.t, character: c.id, slot: "walk" });
      }
      const wx = st.x - 75;
      for (let i = 0; i < film; i++) {
        scene((i % cols) * cellW, Math.floor(i / cols) * cellH, cellW - 4, cellH - 4, wx);
        for (let k = 0; k < every; k++) {
          advance(1 / 60);
          const body: CatBody = { x: st.x, y: 0, vx: 0, vy: 0, facing: st.dir, platformId: "dock", anim, hidden: false };
          if (k < every - 1) drawCat(off, body, { scale: 1, t: st.t, character: c.id, slot: "walk" });
        }
      }
      return;
    }
    let last = performance.now();
    const loop = (): void => {
      const now = performance.now();
      advance(Math.min(0.05, (now - last) / 1000));
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      scene(0, 0, canvas.width, canvas.height, 0);
      requestAnimationFrame(loop);
    };
    loop();
  });
} else void spritesReady().then(() => list.forEach((c, row) => {
  ctx.fillStyle = "#4a3a30";
  ctx.fillText(`${c.name} (${c.species})`, 10, row * rowH + 20);
  POSES.forEach((anim, col) => {
    const body: CatBody = { x: col * colW + colW / 2, y: row * rowH + rowH - (big ? 30 : 22), vx: 0, vy: 0, facing: 1, platformId: "dock", anim, hidden: false };
    drawCat(ctx, body, { scale: sc, t: strip ? t + col * stepSec : t, character: c.id, phase: strip ? col / 9 : undefined, slot: `${row}/${col}` });
    if (row === list.length - 1) {
      ctx.fillStyle = "#9a8576";
      ctx.fillText(strip ? `t+${(col * stepSec).toFixed(2)}` : anim, col * colW + 8, canvas.height - 4);
    }
  });
}));
