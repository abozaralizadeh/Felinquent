import { FakeLlmClient, LlmBrain, OllamaClient, isLocalUrl, type Brain } from "../core/brain";
import { Cat } from "../core/cat";
import { generateDiary, InMemoryMemory } from "../core/memory";
import type { MindEvent } from "../core/mind";
import { CHARACTERS, characterById } from "../core/characters";
import { ARCHETYPES, DEFAULT_PERSONALITY } from "../core/personality";
import { seeded } from "../core/rng";
import type { Activity, ChaosLevel, Intent, Settings, WindowInfo, WorldSnapshot } from "../core/types";
import { DEFAULT_SETTINGS } from "../core/types";
import { drawCat } from "./draw";
import { drawMarks, drawMessFront, drawPropsOnly, preloadProps } from "./mess-draw";
import { PROP_KINDS } from "../core/mess";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const stage = $("stage");
const canvas = $<HTMLCanvasElement>("cat");
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
// Cracks and claw marks go on a layer above the pretend windows (on a Mac the overlay is above everything anyway).
const marks = $<HTMLCanvasElement>("marks");
const mctx = marks.getContext("2d") as CanvasRenderingContext2D;
const hit = $("hit");
const blockbox = $("blockbox");
const bubble = $("bubble");
const banner = $("banner");
const cover = $("cover");
const logEl = $("log");

// ---- state ----
const APP_COLORS: Record<string, string> = { Code: "#3b6fb5", Safari: "#d1623a", Word: "#2a5db0", Mail: "#4a8f5c", Notes: "#c2a032" };
const state = {
  w: 900,
  h: 600,
  windows: [] as WindowInfo[],
  nextId: 4,
  simNow: Date.now(),
  startOfDay: 0,
  activity: "typing" as Activity,
  cursor: { x: 450, y: 300 },
  cursorSpeed: 0,
  lastCursorT: 0,
  pointerDown: false,
  lastPetMs: -Infinity,
  lastFocusMs: Date.now() - 900_000,
  inMeeting: false,
  screenSharing: false,
  fullscreen: false,
  quietHours: false,
  batteryLow: false,
  panic: false,
  shooedUntilMs: 0,
  newUntil: new Map<string, number>(),
};
state.startOfDay = new Date(state.simNow).setHours(0, 0, 0, 0);
/** The desktops' windows (the one showing is in state.windows), and which one shows. */
const desks: WindowInfo[][] = [];
let desk = 0;

const logLines: string[] = [];
function log(line: string): void {
  const t = new Date(state.simNow).toTimeString().slice(0, 8);
  logLines.push(`${t} ${line}`);
  if (logLines.length > 300) logLines.shift();
  logEl.textContent = logLines.slice(-40).join("\n");
  logEl.scrollTop = logEl.scrollHeight;
}

function initialWindows(): WindowInfo[] {
  const { w, h } = state;
  const mk = (id: string, app: string, title: string, x: number, y: number, ww: number, hh: number, z: number, cpu: WindowInfo["cpu"] = "low"): WindowInfo => ({
    id, app, title, bounds: { x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(hh) }, focused: z === 0, cpu, z,
  });
  return [
    mk("w1", "Code", "auth.ts - backend", w * 0.06, h * 0.12, w * 0.5, h * 0.62, 0),
    mk("w2", "Safari", "cat videos - YouTube", w * 0.42, h * 0.2, w * 0.5, h * 0.55, 1, "high"),
    mk("w3", "Word", "Final_Thesis_v7.docx", w * 0.18, h * 0.34, w * 0.4, h * 0.4, 2),
  ];
}

// ---- cat ----
const memory = new InMemoryMemory();
const cat = new Cat({
  rng: seeded(Date.now() % 100000),
  settings: { ...DEFAULT_SETTINGS },
  memory,
  personality: DEFAULT_PERSONALITY,
  log: (m, f) => log(`${m} ${f ? JSON.stringify(f) : ""}`),
  // A local model takes a while; the animal keeps moving while it thinks.
  asyncMind: true,
});
let activeBrain: Brain = cat.rules;

function buildWorld(): WorldSnapshot {
  const now = state.simNow;
  const hour = new Date(now).getHours();
  const focused = state.windows.find((x) => x.focused);
  const idle: Record<Activity, number> = { typing_fast: 0.3, typing: 1, reading: 6, idle: 120, away: 900 };
  return {
    nowMs: now,
    hour,
    screen: { x: 0, y: 0, w: state.w, h: state.h },
    dockTop: state.h - 44,
    windows: state.windows,
    frontApp: focused?.app ?? "Finder",
    activity: state.activity,
    idleSec: idle[state.activity],
    cursor: state.cursor,
    cursorSpeed: state.cursorSpeed,
    appSwitchedSecAgo: (now - state.lastFocusMs) / 1000,
    minutesSincePet: Math.min(999, (now - state.lastPetMs) / 60000),
    inMeeting: state.inMeeting,
    screenSharing: state.screenSharing,
    fullscreen: state.fullscreen,
    batteryLow: state.batteryLow,
    panic: state.panic,
    quietHours: state.quietHours,
    shooedUntilMs: state.shooedUntilMs,
    space: { id: `d${desk}`, index: desk, spans: true },
  };
}

// ---- fake windows (DOM) ----
const winEls = new Map<string, HTMLDivElement>();
function renderWindows(): void {
  for (const [id, el] of winEls) if (!state.windows.some((w) => w.id === id)) (el.remove(), winEls.delete(id));
  for (const w of state.windows) {
    let el = winEls.get(w.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "win";
      el.innerHTML = `<div class="bar"><b></b><b></b><b></b><span></span></div><div class="body">${"<p></p>".repeat(12)}</div>`;
      stage.insertBefore(el, $("dock"));
      winEls.set(w.id, el);
      const bar = el.querySelector(".bar") as HTMLElement;
      bar.addEventListener("pointerdown", (e) => startDrag(e, w.id));
      el.addEventListener("pointerdown", () => focusWindow(w.id));
    }
    const b = w.bounds;
    el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;z-index:${100 - w.z};`;
    el.classList.toggle("focused", w.focused);
    const bar = el.querySelector(".bar") as HTMLElement;
    bar.style.background = APP_COLORS[w.app] ?? "#555";
    (bar.querySelector("span") as HTMLElement).textContent = `${w.app} - ${w.title ?? ""}`;
  }
  cat.worldChanged(buildWorld());
}

function focusWindow(id: string): void {
  const cur = state.windows.find((w) => w.focused);
  if (cur?.id === id) return;
  const sorted = [...state.windows].sort((a, b) => a.z - b.z);
  const target = sorted.find((w) => w.id === id);
  if (!target) return;
  const rest = sorted.filter((w) => w.id !== id);
  state.windows = [target, ...rest].map((w, i) => ({ ...w, z: i, focused: i === 0 }));
  state.lastFocusMs = state.simNow;
  renderWindows();
}

function startDrag(e: PointerEvent, id: string): void {
  // Its toy lying on the title bar: you pick up the toy, not the window.
  const at = stagePoint(e);
  if (cat.mess.toyUnder(at.x, at.y)) return;
  e.preventDefault();
  focusWindow(id);
  const start = { x: e.clientX, y: e.clientY };
  const orig = state.windows.find((w) => w.id === id)?.bounds;
  if (!orig) return;
  const move = (m: PointerEvent) => {
    const nx = Math.max(-orig.w + 80, Math.min(state.w - 80, orig.x + m.clientX - start.x));
    const ny = Math.max(30, Math.min(state.h - 90, orig.y + m.clientY - start.y));
    state.windows = state.windows.map((w) => (w.id === id ? { ...w, bounds: { ...w.bounds, x: Math.round(nx), y: Math.round(ny) } } : w));
    renderWindows();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function addWindow(): void {
  const apps = ["Mail", "Notes", "Safari", "Code"];
  const app = apps[state.nextId % apps.length] as string;
  const id = `w${state.nextId++}`;
  const w = state.w;
  const h = state.h;
  const win: WindowInfo = {
    id, app, title: "Untitled", isNew: true, isEmpty: true, cpu: "low", focused: false, z: state.windows.length,
    bounds: { x: Math.round(w * (0.1 + Math.random() * 0.4)), y: Math.round(h * (0.15 + Math.random() * 0.3)), w: Math.round(w * 0.3), h: Math.round(h * 0.32) },
  };
  state.windows = [...state.windows, win];
  state.newUntil.set(id, state.simNow + 60_000);
  renderWindows();
  focusWindow(id);
  log(`you opened a new window (${app})`);
}

function closeWindow(): void {
  if (state.windows.length <= 1) return;
  const victim = [...state.windows].sort((a, b) => a.z - b.z)[Math.floor(Math.random() * state.windows.length)] as WindowInfo;
  state.windows = state.windows.filter((w) => w.id !== victim.id).sort((a, b) => a.z - b.z).map((w, i) => ({ ...w, z: i, focused: i === 0 }));
  renderWindows();
  log(`you closed ${victim.app}`);
}

// ---- pointer ----
function stagePoint(e: PointerEvent): { x: number; y: number } {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function feedPointer(e: PointerEvent): void {
  const p = stagePoint(e);
  const t = performance.now();
  if (state.lastCursorT) {
    const dt = Math.max(1, t - state.lastCursorT) / 1000;
    const v = Math.hypot(p.x - state.cursor.x, p.y - state.cursor.y) / dt;
    state.cursorSpeed = state.cursorSpeed * 0.7 + v * 0.3;
  }
  state.lastCursorT = t;
  state.cursor = p;
  const events = cat.pointer({ t, x: p.x, y: p.y, down: state.pointerDown }, buildWorld());
  for (const ev of events) {
    if (ev.kind === "pet") state.lastPetMs = state.simNow;
    if (ev.kind !== "pet" || Math.random() < 0.3) log(`you: ${ev.kind}`);
  }
}
stage.addEventListener("pointermove", feedPointer);
stage.addEventListener("pointerdown", (e) => {
  state.pointerDown = true;
  feedPointer(e);
});
window.addEventListener("pointerup", (e) => {
  if (!state.pointerDown) return;
  state.pointerDown = false;
  feedPointer(e);
});
setInterval(() => (state.cursorSpeed *= 0.8), 100);

// ---- thought bubbles, gibberish, gifts ----
let bubbleTimer = 0;
function showThought(text: string): void {
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  bubble.style.opacity = "1";
  clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    bubble.style.opacity = "0";
    window.setTimeout(() => bubble.classList.add("hidden"), 400);
  }, 4000);
}

let lastGib = 0;
function spawnGibberish(): void {
  const now = performance.now();
  if (now - lastGib < 1500) return;
  lastGib = now;
  const el = document.createElement("div");
  el.className = "gib";
  el.textContent = ["jjjjkkkk;;;;", "asdfghjjjj", "llllk;;;mmm", "ffffgggghh"][Math.floor(Math.random() * 4)] as string;
  const b = cat.executor.body;
  el.style.left = `${b.x - 30}px`;
  el.style.top = `${b.y - 120}px`;
  stage.appendChild(el);
  window.setTimeout(() => (el.style.opacity = "0"), 1800);
  window.setTimeout(() => el.remove(), 3000);
}

let pendingGift: "gift" | "hairball" | null = null;
function placeGift(kind: "gift" | "hairball"): void {
  const b = cat.executor.body;
  const el = document.createElement("div");
  el.className = "gift";
  el.textContent = kind === "gift" ? "🐭" : "🟤";
  el.title = kind === "gift" ? "A gift. Click to clean it up." : "A hairball. Click to clean it up.";
  el.style.left = `${b.x + 60 * b.facing}px`;
  el.style.top = `${b.y}px`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
    cat.governor.clearGift();
    log(`you cleaned up the ${kind}`);
  });
  stage.appendChild(el);
}

function handleMindEvents(events: MindEvent[]): void {
  for (const ev of events) {
    if (ev.type === "intent") {
      const i = ev.intent;
      log(`${i.intent} -> ${i.target} (${ev.source}, ${i.mood})`);
      if (i.thought) showThought(i.thought);
      if (i.intent === "gift" || i.intent === "hairball") pendingGift = i.intent;
      if (i.intent === "meow" && cat.settings.thoughtBubbles) showThought("meow!");
    } else if (ev.type === "respect") log(`respect mode: ${ev.state}`);
    else if (ev.type === "wake") log("woke up");
    else if (ev.type === "llm_problem") log(`brain problem: ${ev.message} (using rules)`);
  }
}

// ---- drawing ----
function resize(): void {
  const r = stage.getBoundingClientRect();
  // The first layout pass can report a tiny box. Wait for a real size before placing anything.
  if (r.width < 200 || r.height < 200) return;
  const first = state.windows.length === 0;
  state.w = Math.round(r.width);
  state.h = Math.round(r.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(state.w * dpr);
  canvas.height = Math.round(state.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  marks.width = canvas.width;
  marks.height = canvas.height;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (first) {
    state.windows = initialWindows();
    renderWindows();
    cat.place(buildWorld(), state.w * 0.2);
  } else {
    cat.worldChanged(buildWorld());
  }
}
new ResizeObserver(resize).observe(stage);

function draw(tSec: number): void {
  ctx.clearRect(0, 0, state.w, state.h);
  const body = cat.executor.body;
  const scale = cat.executor.size.h / 90;
  const snap = cat.mess.snapshot();
  mctx.clearRect(0, 0, state.w, state.h);
  drawMarks(mctx, snap, buildWorld().windows, scale);
  drawPropsOnly(ctx, snap, scale);
  // On another desktop: it isn't here.
  if (!cat.away) drawCat(ctx, body, { scale, t: tSec, character: characterId, cursor: state.cursor });
  drawMessFront(ctx, snap, scale);
  const r = cat.executor.hitRect();
  hit.classList.toggle("hidden", body.hidden || cat.away);
  hit.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;`;
  const br = cat.blockingRect;
  blockbox.classList.toggle("hidden", !br);
  if (br) blockbox.style.cssText = `left:${br.x}px;top:${br.y}px;width:${br.w}px;height:${br.h}px;`;
  if (!bubble.classList.contains("hidden")) {
    bubble.style.left = `${body.x}px`;
    bubble.style.top = `${r.y - 8}px`;
  }
  cover.classList.toggle("hidden", !state.fullscreen);
  cover.textContent = "A fullscreen app is in front. The cat went outside.";
  const msg = state.panic ? "Panic: the cat is hidden." : state.inMeeting ? "In a meeting (camera on): the cat naps in a corner." : state.screenSharing ? "Screen sharing: the cat naps in a corner." : state.shooedUntilMs > state.simNow ? "Shooed for an hour." : "";
  banner.classList.toggle("hidden", !msg);
  banner.textContent = msg;
}

// ---- main loop ----
let last = performance.now();
let busy = false;
let statusTimer = 0;
let frameCount = 0;
let lastDt = 0;
async function tick(now: number): Promise<void> {
  const dt = Math.min(0.1, (now - last) / 1000);
  frameCount++;
  lastDt = dt;
  last = now;
  const warp = Number(($("warp") as HTMLInputElement).value);
  state.simNow += dt * warp * 1000;
  for (const [id, until] of state.newUntil) {
    if (state.simNow > until) {
      state.newUntil.delete(id);
      state.windows = state.windows.map((w) => (w.id === id ? { ...w, isNew: false, isEmpty: false } : w));
      cat.worldChanged(buildWorld());
    }
  }
  const res = await cat.step(buildWorld(), dt * warp, dt);
  handleMindEvents(res.mind);
  if (cat.executor.body.anim === "keyboard" && cat.executor.phase !== "idle") spawnGibberish();
  if (pendingGift && cat.executor.phase === "doing") {
    placeGift(pendingGift);
    pendingGift = null;
  }
  draw(now / 1000);
  if (now - statusTimer > 250) {
    statusTimer = now;
    updateStatus();
  }
}
// ?timer drives the loop with timers instead of animation frames: a headless browser with virtual
// time runs timers but hardly any animation frames.
const byTimer = new URLSearchParams(location.search).has("timer");
// ?stop=<ms> freezes the page at that moment, so a headless screenshot catches it.
const stopAt = Number(new URLSearchParams(location.search).get("stop") ?? "0");
let frozen = false;
function frame(now: number): void {
  if (stopAt > 0 && now > stopAt) {
    // A canvas drawn from timers may never reach the screen in a headless browser: show a still of it.
    if (!frozen) {
      frozen = true;
      const still = document.createElement("img");
      // The cat layer and the marks layer, as one picture.
      const both = document.createElement("canvas");
      both.width = canvas.width;
      both.height = canvas.height;
      const bc = both.getContext("2d") as CanvasRenderingContext2D;
      bc.drawImage(canvas, 0, 0);
      bc.drawImage(marks, 0, 0);
      still.src = both.toDataURL();
      still.style.cssText = `position:absolute;left:0;top:0;width:${state.w}px;height:${state.h}px;pointer-events:none;z-index:200`;
      stage.appendChild(still);
      // A thought that is up stays in the picture.
      bubble.style.zIndex = "201";
      bubble.style.transition = "none";
    }
    return;
  }
  if (byTimer) setTimeout(() => frame(performance.now()), 1000 / 60);
  else requestAnimationFrame(frame);
  if (busy) return;
  busy = true;
  tick(now).catch((e) => console.error(e)).finally(() => (busy = false));
}

function updateStatus(): void {
  trickCount();
  const n = cat.mind.needs;
  const cur = cat.mind.current;
  const bar = (v: number) => `${Math.round(v * 100)}%`;
  $("status").innerHTML = [
    `<span>mood <b>${n.mood}</b></span>`,
    `<span>energy <b>${bar(n.energy)}</b></span>`,
    `<span>wants attention <b>${bar(n.attention)}</b></span>`,
    `<span>trust <b>${Math.round(n.trust)}</b></span>`,
    `<span>doing <b>${cat.executor.body.hidden ? "away" : cat.mind.sleeping ? "asleep" : (cur?.intent ?? (cat.mind.resting ? `resting ${Math.ceil(cat.mind.restLeftSec)} s` : "deciding"))}</b></span>`,
    `<span>annoyance points <b>${cat.governor.budget.toFixed(1)}</b></span>`,
    `<span>brain <b>${activeBrain.name}</b></span>`,
  ].join("");
  $("clock").textContent = new Date(state.simNow).toTimeString().slice(0, 5);
}

// ---- controls ----
function toggle(id: string, key: "inMeeting" | "screenSharing" | "fullscreen" | "quietHours" | "batteryLow" | "panic"): void {
  const el = $(id);
  el.addEventListener("click", () => {
    state[key] = !state[key];
    el.classList.toggle("on", state[key]);
    log(`${id}: ${state[key] ? "on" : "off"}`);
  });
}
toggle("meeting", "inMeeting");
toggle("share", "screenSharing");
toggle("fullscreen", "fullscreen");
toggle("quiet", "quietHours");
toggle("battery", "batteryLow");
toggle("panic", "panic");
$("shoo").addEventListener("click", () => {
  const on = state.shooedUntilMs <= state.simNow;
  state.shooedUntilMs = on ? state.simNow + 3_600_000 : 0;
  $("shoo").classList.toggle("on", on);
});

$("chaos").addEventListener("change", (e) => cat.updateSettings({ chaos: (e.target as HTMLSelectElement).value as ChaosLevel }));
$("smart").addEventListener("change", (e) => cat.updateSettings({ smartTargeting: (e.target as HTMLInputElement).checked }));
$("thoughts").addEventListener("change", (e) => cat.updateSettings({ thoughtBubbles: (e.target as HTMLInputElement).checked }));
$("activity").addEventListener("change", (e) => (state.activity = (e.target as HTMLSelectElement).value as Activity));
$("warp").addEventListener("input", (e) => ($("warpv").textContent = `${(e.target as HTMLInputElement).value}x`));
let characterId = "tabby";
const characterSelect = $("character") as HTMLSelectElement;
for (const c of CHARACTERS) characterSelect.add(new Option(`${c.name} (${c.species})`, c.id));
function pickCharacter(id: string): void {
  const c = characterById(id);
  characterId = c.id;
  characterSelect.value = c.id;
  cat.setPersonality(c.personality);
  $("characterHint").textContent = c.blurb;
  ($("name") as HTMLInputElement).value = c.name;
  log(`character: ${c.name}`);
}
characterSelect.addEventListener("change", () => pickCharacter(characterSelect.value));
$("characterHint").textContent = characterById("tabby").blurb;
// ?character=<id> starts with that animal (to look at one, or record it).
const startWith = new URLSearchParams(location.search).get("character");
if (startWith) pickCharacter(startWith);
$("persona").addEventListener("change", (e) => {
  const key = (e.target as HTMLSelectElement).value;
  cat.setPersonality(key === "mix" ? DEFAULT_PERSONALITY : (ARCHETYPES[key] ?? DEFAULT_PERSONALITY));
  log(`personality: ${key}`);
});
for (const id of ["energy", "attention", "trust"] as const) {
  $(id).addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value) / 100;
    cat.mind.forceNeeds({ [id]: id === "trust" ? v * 100 : v });
  });
}
$("demand").addEventListener("click", () => {
  cat.mind.forceNeeds({ attention: 1, energy: 0.95 });
  log("you ignored the cat for a long time");
});
$("tired").addEventListener("click", () => cat.mind.forceNeeds({ energy: 0.1 }));
$("treat").addEventListener("click", () => {
  cat.treat(buildWorld());
  log("you gave a treat");
});
/** Drops its toy a little way off, as if you threw it there (you can also drag the toy with the mouse). */
function throwToy(): void {
  const w = buildWorld();
  const b = cat.executor.body;
  const side = b.x > w.screen.w / 2 ? -1 : 1;
  cat.throwToy({ ...w, cursor: { x: Math.max(60, Math.min(w.screen.w - 60, b.x + side * (220 + Math.random() * 200))), y: 90 } });
  log("you threw its toy");
}
$("throwtoy").addEventListener("click", throwToy);
$("addwin").addEventListener("click", addWindow);
preloadProps();
// Mischief on demand, to see it without waiting for the cat to feel like it.
const doNow = (intent: "knock_off" | "claw" | "hunt" | "zoomies" | "knock_toy" | "play_cursor" | "follow", target: string): void => {
  start({ intent, target, approach: intent === "zoomies" ? "run" : "walk", stay_sec: 20, mood: "smug" });
  log(`you asked for ${intent}`);
};
/** Starts something you asked for, and tells the mind, so it doesn't pick something else halfway through. */
function start(intent: Intent): void {
  cat.mind.sleeping = false;
  cat.mind.current = intent;
  cat.executor.start(intent);
}
$("ball").addEventListener("click", () => doNow("knock_toy", "here"));
$("playcur").addEventListener("click", () => doNow("play_cursor", "cursor"));
$("followme").addEventListener("click", () => doNow("follow", "cursor"));

// Tricks (tricks.ts): it makes them up by itself; these buttons skip the wait.
const trickCount = (): void => void ($("trickCount").textContent = `knows ${memory.tricks.all.length} tricks`);
$("dream").addEventListener("click", () => {
  let name: string | null = null;
  for (let i = 0; i < 6 && !name; i++) name = cat.mind.dream(state.simNow, true);
  log(name ? `it made up a new trick: ${name}` : "it tried to make up a trick, nothing good came of it");
  trickCount();
});
$("dotrick").addEventListener("click", () => {
  const t = memory.tricks.all[memory.tricks.all.length - 1];
  if (!t) return log("it doesn't know any tricks yet");
  const { beats, seconds } = memory.tricks.script(t);
  const first = memory.tricks.shown(t.id, state.simNow);
  start({ intent: "trick", target: "here", approach: "walk", stay_sec: Math.ceil(seconds), mood: "playful", script: beats, trick: t.id });
  showThought(first ? `new trick: ${t.name}` : t.name);
  log(`you asked for its trick "${t.name}"`);
});

// Desktops, like Spaces on the Mac: each has its own windows. The animal stays on its own desktop
// and comes over a while later, walking in from the side its desktop is on.
function switchDesk(to: number): void {
  if (to < 0 || to > 3 || to === desk) return;
  desks[desk] = state.windows;
  desk = to;
  const { w, h } = state;
  const mk = (id: string, app: string, x: number, y: number, ww: number, hh: number, z: number): WindowInfo => ({
    id, app, title: "Untitled", bounds: { x: Math.round(x), y: Math.round(y), w: Math.round(ww), h: Math.round(hh) }, focused: z === 0, cpu: "low", z,
  });
  state.windows = desks[desk] ?? [mk(`d${desk}a`, "Notes", w * (0.1 + 0.2 * (desk % 2)), h * 0.25, w * 0.45, h * 0.5, 0), mk(`d${desk}b`, "Mail", w * 0.5, h * 0.4, w * 0.4, h * 0.38, 1)];
  $("deskName").textContent = `Desktop ${desk + 1}`;
  renderWindows();
  log(`you went to desktop ${desk + 1}`);
}
$("deskL").addEventListener("click", () => switchDesk(desk - 1));
$("deskR").addEventListener("click", () => switchDesk(desk + 1));
$("putmug").addEventListener("click", () => {
  const w = buildWorld();
  const win = w.windows[Math.floor(Math.random() * w.windows.length)];
  if (!win) return;
  const kind = PROP_KINDS[Math.floor(Math.random() * PROP_KINDS.length)] ?? "mug";
  cat.mess.place(kind, win.id, win.bounds.x + win.bounds.w * (0.3 + Math.random() * 0.4), w.nowMs);
  log(`a ${kind} on ${win.id}`);
});
$("knock").addEventListener("click", () => {
  const ids = cat.mess.windowsWithProps();
  if (ids[0]) doNow("knock_off", ids[0]);
  else log("nothing to knock off: put a mug on a window first");
});
$("claw").addEventListener("click", () => {
  const w = buildWorld().windows[0];
  if (w) doNow("claw", w.id);
});
$("hunt").addEventListener("click", () => doNow("hunt", "here"));
$("zoom").addEventListener("click", () => doNow("zoomies", "here"));
$("closewin").addEventListener("click", closeWindow);

function setBrain(kind: string): void {
  const hint = $("brainHint");
  hint.textContent = "";
  if (kind === "rules") {
    activeBrain = cat.rules;
    cat.updateSettings({ brain: "rules" });
  } else {
    let client;
    if (kind === "ollama") {
      const url = DEFAULT_SETTINGS.llmUrl;
      client = new OllamaClient(url, DEFAULT_SETTINGS.llmModel);
      hint.textContent = `${isLocalUrl(url) ? "Local only." : "NOT local!"} Needs a model (${DEFAULT_SETTINGS.llmModel}) and OLLAMA_ORIGINS for this page. Falls back to rules when it fails.`;
    } else {
      client = new FakeLlmClient(kind === "fake" ? "good" : kind === "fake-garbage" ? "garbage" : "error", 150);
      hint.textContent = "A local stand-in, not a real model. Try the broken ones: the cat falls back to rules.";
    }
    activeBrain = new LlmBrain(client, 8000);
    cat.updateSettings({ brain: "llm" });
  }
  cat.setBrain(activeBrain);
  log(`brain: ${activeBrain.name}`);
}
$("brain").addEventListener("change", (e) => setBrain((e.target as HTMLSelectElement).value));

$("diaryBtn").addEventListener("click", () => {
  const name = ($("name") as HTMLInputElement).value || "Mrrlo";
  $("diary").textContent = generateDiary(memory.events(), state.startOfDay, name).join("\n");
});
$("forget").addEventListener("click", () => {
  memory.forgetAll();
  $("diary").textContent = "Memory wiped. The cat remembers nothing. (It will pretend that was always true.)";
});
$("copy").addEventListener("click", async () => {
  const text = [`Felinquent playground diagnostics`, `brain ${activeBrain.name}`, JSON.stringify(cat.settings), ...logLines].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    log("diagnostics copied to the clipboard");
  } catch {
    log("could not copy: select the log text by hand");
  }
});

// Test and debug hook so the page can be driven from the console or a browser test.
(window as unknown as { felinquent: unknown }).felinquent = { cat, state, buildWorld, addWindow, focusWindow };

resize();
log("a cat has moved in");
// With ?timer the first frame comes from a timer too: a hidden page never gets an animation frame.
if (byTimer) setTimeout(() => frame(performance.now()), 0);
else requestAnimationFrame(frame);

/**
 * ?scene=knock|shatter|claw|hunt|zoom sets up a bit of gremlin mischief a second after loading, to
 * look at it (or record it) without waiting for the cat to feel like it. ?scene=ball brings out its
 * own toy (each animal has its own; ?character=<id> picks the animal), ?scene=fetch throws it for the animal to react to, ?scene=trick makes up a trick and does it (with ?seed=N for another trick).
 */
const scene = new URLSearchParams(location.search).get("scene");
if (scene) {
  const chaosSel = $<HTMLSelectElement>("chaos");
  chaosSel.value = "gremlin";
  cat.updateSettings({ chaos: "gremlin" });
  setTimeout(() => {
    const w = buildWorld();
    const win = w.windows.find((x) => x.id === "w2") ?? w.windows[0];
    if (!win) return;
    if (scene === "knock") {
      cat.mess.place("mug", win.id, win.bounds.x + win.bounds.w - 90, w.nowMs);
      setTimeout(() => doNow("knock_off", win.id), 1500);
    } else if (scene === "shatter") {
      const mug = cat.mess.place("mug", win.id, win.bounds.x + win.bounds.w - 30, w.nowMs);
      const glass = cat.mess.place("glass", win.id, win.bounds.x + win.bounds.w - 100, w.nowMs);
      const plant = cat.mess.place("plant", win.id, win.bounds.x + 40, w.nowMs);
      setTimeout(() => {
        if (mug) cat.mess.nudge(mug.id, 1, 40);
        if (glass) cat.mess.nudge(glass.id, 1, 110);
        if (plant) cat.mess.nudge(plant.id, -1, 60);
      }, 1500);
    } else if (scene === "claw") doNow("claw", win.id);
    else if (scene === "hunt") doNow("hunt", "here");
    else if (scene === "zoom") doNow("zoomies", "here");
    else if (scene === "ball") doNow("knock_toy", "here");
    else if (scene === "fetch") {
      // ?do=fetch|carry_toy|stash_toy|nose_toy skips the animal's own choice.
      throwToy();
      const pick = new URLSearchParams(location.search).get("do");
      if (pick === "fetch" || pick === "carry_toy" || pick === "stash_toy" || pick === "nose_toy")
        setTimeout(() => start({ intent: pick, target: "toy", approach: pick === "fetch" ? "run" : "walk", stay_sec: 20, mood: "playful" }), 1200);
    }
    else if (scene === "trick") {
      const seed = Number(new URLSearchParams(location.search).get("seed") ?? "0");
      for (let i = 0; i <= seed; i++) cat.mind.dream(state.simNow + i, true);
      $("dotrick").click();
    }
  }, 1000);
  // For a headless browser: what the mess is doing, readable from the page.
  setInterval(() => {
    document.body.dataset.mess = JSON.stringify({
      t: Math.round(performance.now()),
      anim: cat.executor.body.anim,
      props: cat.mess.props.map((p) => [p.kind, p.state, Math.round(p.alpha * 100) / 100, Math.round(p.x), Math.round(p.y)]),
      shards: cat.mess.shards.length,
      decals: cat.mess.decals.length,
      strips: cat.mess.strips.length,
      fly: cat.mess.fly ? cat.mess.fly.state : null,
      frames: frameCount,
      plats: (cat.mess as unknown as { platforms: { id: string; x1: number; x2: number; y: number }[] }).platforms.map((q) => [q.id, Math.round(q.x1), Math.round(q.x2), Math.round(q.y)]),
      shardY: cat.mess.shards.map((q) => [q.kind, Math.round(q.x), Math.round(q.y)]),
      dockTop: buildWorld().dockTop,
      screen: buildWorld().screen,
      lastDt: Math.round(lastDt * 1000),
    });
  }, 250);
}
