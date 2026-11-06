// A sheet of every character in a few poses, for checking the art and for docs.
import { CHARACTERS } from "../core/characters";
import { TURN_SEC, type Anim, type CatBody } from "../core/executor";
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
// ?film=12&anim=groom&only=tabby draws 12 moments of one animal doing `anim`, in one drawing slot
// played frame by frame at 60 a second, so the programs (washing, the ear scratch, turning round)
// run as they do in the app. ?from=idle_sit is the pose before and ?at=0.5 when it changes;
// ?start is the first moment kept (default ?at) and ?every=0.1 the time between moments. ?flip=1
// turns it round at that second. ?zoom=2 sets the size, ?cols=6 the moments in a row. ?ledge=56
// draws a window top that many pixels above the feet, to line up the hang off a ledge.
if (q.has("film") && q.has("anim")) {
  const c = (list[0] ?? CHARACTERS[0]) as (typeof CHARACTERS)[number];
  const n = Number(q.get("film"));
  const anim = q.get("anim") as Anim;
  const from = (q.get("from") ?? "idle_sit") as Anim;
  const at = Number(q.get("at") ?? "0.5");
  const start = Number(q.get("start") ?? String(at));
  const every = Number(q.get("every") ?? "0.1");
  const flip = q.has("flip") ? Number(q.get("flip")) : Infinity;
  const zoom = Number(q.get("zoom") ?? "2");
  const cols = Number(q.get("cols") ?? "6");
  const cellW = 130 * zoom;
  const cellH = 115 * zoom;
  canvas.width = cols * cellW;
  canvas.height = Math.ceil(n / cols) * cellH;
  void spritesReady().then(() => {
    const off = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
    let kept = 0;
    for (let f = 1; kept < n && f < 60 * 600; f++) {
      const ft = f / 60;
      const body: CatBody = { x: 0, y: 0, vx: 0, vy: 0, facing: ft >= flip ? -1 : 1, platformId: "dock", anim: ft < at ? from : anim, hidden: false };
      if (ft + 1e-6 < start + kept * every) {
        drawCat(off, body, { scale: 1, t: ft, character: c.id, slot: "film" });
        continue;
      }
      const cx = (kept % cols) * cellW;
      const cy = Math.floor(kept / cols) * cellH;
      ctx.fillStyle = kept % 2 ? "#f6ecdf" : "#efe4d6";
      ctx.fillRect(cx, cy, cellW - 3, cellH - 3);
      ctx.save();
      ctx.translate(cx + cellW / 2, cy + cellH - 12 * zoom);
      ctx.scale(zoom, zoom);
      // ?ledge=56 draws a window top that far above the feet (for the hang off a ledge).
      if (q.has("ledge")) {
        const ly = -Number(q.get("ledge"));
        ctx.fillStyle = "#3b6fb5";
        ctx.fillRect(-65, ly, 130, 14);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-65, ly + 14, 130, 60);
      }
      drawCat(ctx, body, { scale: 1, t: ft, character: c.id, slot: "film" });
      ctx.restore();
      ctx.fillStyle = "#7a6656";
      ctx.fillText(`${ft.toFixed(2)} s`, cx + 6, cy + 16);
      kept++;
    }
  });
} else if (q.has("walk")) {
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
      st.turn = TURN_SEC;
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
