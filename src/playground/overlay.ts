// The native overlay: the same cat as the playground, but standing on the real windows
// of the Mac. Runs inside the Tauri windows (src-tauri), one per display.
// The window on the main display runs the cat and broadcasts its state. The others only draw it.
// Reads geometry and idle time only. No screenshots, no titles, no key contents.
import { isLocalUrl, LlmBrain, OllamaClient, RulesBrain } from "../core/brain";
import { Cat } from "../core/cat";
import type { CatBody } from "../core/executor";
import type { Activity, Rect, WindowInfo, WorldSnapshot } from "../core/types";
import { makeWorld } from "../core/world";
import { characterById, DEFAULT_CHARACTER_ID } from "../core/characters";
import { InMemoryMemory } from "../core/memory";
import { drawCat } from "./draw";
import type { MessSnapshot } from "../core/mess";
import { drawMessBehind, drawMessFront, preloadProps } from "./mess-draw";
import { drawThought, THOUGHT_SEC, type ShownThought } from "./thought";
import { onSpriteSet, setSpriteUrl, SPRITE_URL } from "./sprites";

interface NativeWin { id: string; app: string; x: number; y: number; w: number; h: number; z: number }
interface NativeSpace { id: string; index: number; spans: boolean; app?: boolean; hidden?: boolean }
interface NativeSensors { windows: NativeWin[]; idle_sec: number; since_key_sec: number; mic_in_use: boolean; camera_in_use: boolean; display_awake?: boolean; space: NativeSpace | null }
interface NativeWindows { windows: NativeWin[]; space: NativeSpace | null }
interface Layout { index: number; displays: Rect[]; dock_top: number }
interface Pointer { x: number; y: number; down: boolean; right?: boolean }
interface Config { demo: boolean; debug: boolean; brain: string; ollama_url: string; ollama_model: string }

/** What the master window tells the others, every frame. */
interface CatState {
  body: CatBody;
  scale: number;
  hit: Rect;
  block: Rect | null;
  cursor: { x: number; y: number };
  /** Where its eyes go (its toy in the air, else the cursor). */
  look?: { x: number; y: number };
  held: boolean;
  /** Its toy, where you can grab it, and whether you are holding it (clicks there are ours). */
  toy: Rect | null;
  toyHeld: boolean;
  /** Everything else you can pick up (a mug, a plant, a treat lying about): clicks there are ours too. */
  grabs?: Rect[];
  /** A treat in your hand: the next click anywhere lets it go, so every click is ours until then. */
  treatHeld?: boolean;
  /** Puddles and piles: a click there cleans one up (clicks there are ours too). */
  spots: Rect[];
  t: number;
  character: string;
  /** The mess (mess.ts) and the window shapes it needs to hide marks behind front windows. No titles, no app names. */
  mess: MessSnapshot | null;
  windows: WindowInfo[];
  /** The thought bubble, if one is up. */
  thought: ShownThought | null;
}

const dark = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

interface TauriGlobal {
  core: { invoke: <T>(cmd: string, args?: object) => Promise<T>; convertFileSrc: (path: string) => string };
  path?: { resourceDir: () => Promise<string> };
  event: { emit: (name: string, payload?: unknown) => Promise<void>; listen: <T>(name: string, cb: (e: { payload: T }) => void) => Promise<() => void> };
}
const tauri = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
const invoke = <T>(cmd: string, args?: object): Promise<T> => {
  if (!tauri) return Promise.reject(new Error("not running inside Tauri"));
  return tauri.core.invoke<T>(cmd, args);
};
const say = (line: string): void => void invoke("debug_log", { line }).catch(() => {});

// The app keeps the drawings once, in its Resources folder, and loads them from there. Built into
// the program they'd be in it twice: a universal Mac app is one program per chip. The dev server
// (it has a port) serves them next to the page.
if (tauri?.path && location.port === "") {
  const t = tauri;
  setSpriteUrl(
    t.path!.resourceDir().then(
      (dir) => (id: string, key: string) => t.core.convertFileSrc(`${dir}/sprites/${id}/${key}.webp`),
      () => SPRITE_URL,
    ),
  );
}
onSpriteSet((id, missing, usable) => say(`sprites: ${id} ${usable ? "ready" : "can't be drawn"}${missing ? `, ${missing} frames missing` : ""}`));

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function activityOf(s: NativeSensors): Activity {
  if (s.since_key_sec < 1) return "typing_fast";
  if (s.since_key_sec < 10) return "typing";
  if (s.idle_sec < 60) return "reading";
  if (s.idle_sec < 300) return "idle";
  return "away";
}

const inside = (r: Rect, p: { x: number; y: number }, m = 0): boolean => p.x >= r.x - m && p.x <= r.x + r.w + m && p.y >= r.y - m && p.y <= r.y + r.h + m;

async function main(): Promise<void> {
  const config = await invoke<Config>("read_config");
  const layout = await invoke<Layout>("read_layout");
  const me = layout.displays[layout.index] ?? (layout.displays[0] as Rect);
  preloadProps();
  const master = layout.index === 0;
  const main = layout.displays[0] as Rect;
  const others = layout.displays.slice(1);

  let clickThrough = true;
  async function setThrough(on: boolean): Promise<void> {
    if (on === clickThrough) return;
    clickThrough = on;
    await invoke("set_click_through", { on });
  }

  function render(st: CatState | null): void {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (!st) return;
    if (st.body.hidden) {
      // The cat may be away, but what it broke is still lying about.
      ctx.save();
      ctx.translate(-me.x, -me.y);
      drawMessBehind(ctx, st.mess, st.windows, st.scale);
      drawMessFront(ctx, st.mess, st.scale);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(-me.x, -me.y);
    drawMessBehind(ctx, st.mess, st.windows, st.scale);
    const mouth = drawCat(ctx, st.body, { scale: st.scale, t: st.t, character: st.character, cursor: st.look ?? st.cursor });
    drawMessFront(ctx, st.mess, st.scale, mouth);
    drawThought(ctx, st.thought, st.body.x, st.body.y - st.hit.h * 0.95, me, dark());
    // The red box is a debug aid. It only shows with FELINQUENT_DEBUG=1.
    if (config.debug && st.block) {
      ctx.strokeStyle = "rgba(220,50,50,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(st.block.x, st.block.y, st.block.w, st.block.h);
    }
    ctx.restore();
  }

  function applyHit(st: CatState): void {
    // A cat that isn't there (it left, or it's on another desktop) catches no clicks.
    const onToy =
      st.toyHeld || !!st.treatHeld || (st.toy !== null && inside(st.toy, st.cursor, 4)) || (st.grabs ?? []).some((r) => inside(r, st.cursor, 4)) || (st.spots ?? []).some((r) => inside(r, st.cursor, 0));
    void setThrough(!onToy && (st.body.hidden || !(inside(st.hit, st.cursor, 8) || st.held)));
  }

  // ---- A window on another display: draw what the master says. -------------------------
  if (!master) {
    let latest: CatState | null = null;
    await tauri?.event.listen<CatState>("cat-state", (e) => {
      latest = e.payload;
      applyHit(e.payload);
    });
    say(`mirror window for display ${layout.index} at ${me.x},${me.y} ${me.w}x${me.h}`);
    const loop = (): void => {
      render(latest);
      setTimeout(loop, 16);
    };
    loop();
    return;
  }

  // ---- The main display runs the cat. ----------------------------------------------------
  let world: WorldSnapshot = makeWorld({ windows: [], screen: main, displays: others, dockTop: layout.dock_top });
  let lastSensorsAt = -1000;
  let sensorsBusy = false;
  let windowCount = 0;
  /** Bumped by every read of the windows and the desktop, so a frame knows which read it drew. */
  let worldSeq = 0;
  /** Bumped when the Mac says the desktop changed: a slower read started before that is out of date. */
  let switchSeq = 0;
  /** After a desktop switch the windows are see-through until a frame has drawn a read this new. */
  let revealAfter: { turn: number; seq: number } | null = null;

  // Keep windows that are really on a display. Toolbar slivers are not places to sit.
  function toWindows(list: NativeWin[]): WindowInfo[] {
    const all = layout.displays;
    const onDisplay = (w: NativeWin): boolean =>
      w.h >= 100 && all.some((d) => w.x < d.x + d.w && w.x + w.w > d.x && w.y < d.y + d.h && w.y + w.h > d.y && w.y >= d.y - 1);
    return list.filter(onDisplay).map((w) => ({
      id: w.id,
      app: w.app,
      bounds: { x: w.x, y: w.y, w: w.w, h: w.h },
      focused: w.z === 0,
      cpu: "low",
      z: w.z,
    }));
  }
  const spaceOf = (s: NativeSpace | null): WorldSnapshot["space"] => (s ? { id: s.id, index: s.index, spans: s.spans, app: s.app, hidden: s.hidden } : undefined);

  /** Everything the cat senses, four times a second. Not awaited by the frame, so a slow read never stalls the drawing. */
  async function pollSensors(): Promise<void> {
    if (sensorsBusy) return;
    sensorsBusy = true;
    const asked = switchSeq;
    try {
      const s = await invoke<NativeSensors>("read_sensors");
      // The desktop changed while this was being read: its windows and desktop are the old ones.
      const stale = asked !== switchSeq;
      const windows = stale ? world.windows : toWindows(s.windows);
      if (!stale) worldSeq++;
      windowCount = windows.length;
      world = {
        ...world,
        hour: new Date().getHours(),
        windows,
        frontApp: windows[0]?.app ?? "",
        activity: activityOf(s),
        idleSec: s.idle_sec,
        inMeeting: s.mic_in_use || s.camera_in_use,
        // A full-screen app keeping the display awake is a video or a presentation: it goes outside
        // (respect mode RM-02). A full-screen app you just work in is fine.
        fullscreen: !!s.space?.app && !!s.display_awake,
        space: stale ? world.space : spaceOf(s.space),
      };
    } finally {
      lastSensorsAt = performance.now();
      sensorsBusy = false;
    }
  }

  /** Only the windows (and the desktop), every frame while one is being dragged, so what stands on it rides along in real time. */
  async function pollWindows(): Promise<void> {
    const asked = switchSeq;
    const s = await invoke<NativeWindows>("read_windows");
    if (asked !== switchSeq) return;
    const windows = toWindows(s.windows);
    windowCount = windows.length;
    worldSeq++;
    world = { ...world, windows, frontApp: windows[0]?.app ?? "", space: spaceOf(s.space) };
  }

  // The Mac moved the windows to another desktop and made them see-through (main.rs follow_spaces):
  // read the new desktop now, and show the windows again once a frame has drawn it, so the animal
  // never shows for a moment where it was on the old desktop.
  void tauri?.event.listen<number>("space-switch", (e) => {
    switchSeq++;
    const turn = e.payload;
    const ready = (): void => {
      revealAfter = { turn, seq: worldSeq };
    };
    void pollWindows().then(ready, ready);
  });

  // What the user chose and what the cat remembers survive a restart (local files only).
  let saved: { character?: string; chaos?: "chill" | "normal" | "gremlin"; model?: boolean; modelAskedMs?: number } = {};
  try {
    const text = await invoke<string | null>("load_state", { name: "settings.json" });
    if (text) saved = JSON.parse(text) as typeof saved;
  } catch {
    saved = {};
  }
  const memory = new InMemoryMemory();
  try {
    const text = await invoke<string | null>("load_state", { name: "memory.json" });
    if (text) memory.loadJson(text);
  } catch {
    // start with an empty memory
  }
  let character = characterById(saved.character ?? DEFAULT_CHARACTER_ID);
  const cat = new Cat({
    settings: { chaos: saved.chaos ?? "normal" },
    personality: character.personality,
    memory,
    log: (message, fields) => say(`${message} ${JSON.stringify(fields ?? {})}`),
    // The local model can take a few seconds; the animal keeps moving while it thinks.
    asyncMind: true,
  });
  // Whether to ask the local model at all. The menu turns it off and on.
  let useModel = saved.model ?? true;
  // When the app last offered to set up the local model, so "Not now" isn't asked again at every launch.
  let modelAskedMs = saved.modelAskedMs ?? 0;
  const saveSettings = (): void =>
    void invoke("save_state", { name: "settings.json", text: JSON.stringify({ character: character.id, chaos: cat.settings.chaos, model: useModel, modelAskedMs }) }).catch(() => {});
  // The menu bar ticks what is current. This page owns that state, so it tells the menu after every change.
  const showChoices = (): void =>
    void invoke("show_choices", {
      choices: { character: character.id, chaos: cat.settings.chaos, model: useModel, panic: world.panic, shoo: world.shooedUntilMs > Date.now() },
    }).catch(() => {});
  let memoryJson = memory.exportJson();
  setInterval(() => {
    const now = memory.exportJson();
    if (now === memoryJson) return;
    memoryJson = now;
    void invoke("save_state", { name: "memory.json", text: now }).catch(() => {});
  }, 30_000);

  // The local model, with the rules brain as the fallback. The Mind already falls back to rules
  // on a timeout, an error or an answer that is not on the menu, and pauses the model after 3 failures.
  /**
   * The model is wanted but missing: the app offers to set it up (src-tauri/src/ollama.rs asks, and
   * installs Ollama or pulls the model on a yes). At launch it asks at most once every 3 days; turning
   * the model on in the menu asks right away.
   */
  function offerSetup(reason: "no-ollama" | "not-running" | "no-model", asked: boolean): void {
    if (config.brain === "rules") return;
    const now = Date.now();
    if (!asked && now - modelAskedMs < 3 * 86_400_000) return;
    modelAskedMs = now;
    saveSettings();
    void invoke<boolean>("model_setup", { reason, model: config.ollama_model, url: config.ollama_url })
      .then((started) => say(`model setup ${started ? "offered" : "not started"} (${reason})`))
      .catch((e) => say(`model setup: ${String(e)}`));
  }

  async function chooseBrain(asked = false): Promise<string> {
    if (config.brain === "rules") return "rules (asked for)";
    if (!useModel) return "rules (the local model is off in the menu)";
    if (!isLocalUrl(config.ollama_url)) return "rules (the model address is not local)";
    try {
      const r = await fetch(`${config.ollama_url}/api/tags`, { signal: AbortSignal.timeout(2000) });
      const tags = (await r.json()) as { models?: { name: string }[] };
      if (!tags.models?.some((m) => m.name === config.ollama_model || m.name.startsWith(`${config.ollama_model}:`))) {
        offerSetup("no-model", asked);
        return `rules (model ${config.ollama_model} is not installed)`;
      }
      // The menu may have turned the model off while we waited for Ollama.
      if (!useModel) return "rules (the local model is off in the menu)";
      cat.setBrain(new LlmBrain(new OllamaClient(config.ollama_url, config.ollama_model), 8000));
      cat.updateSettings({ brain: "llm", llmUrl: config.ollama_url, llmModel: config.ollama_model });
      return `llm ${config.ollama_model} with rules as the fallback`;
    } catch {
      // Not running, or not installed: the setup looks and asks the right question.
      offerSetup("not-running", asked);
      return "rules (Ollama did not answer)";
    }
  }
  void chooseBrain().then((b) => say(`brain: ${b}`));
  showChoices();

  // Menu bar and hotkey controls. Panic, shoo and the model toggle; shoo keeps the cat away for an hour.
  void tauri?.event.listen<string>("ctl", (e) => {
    const msg = e.payload;
    if (msg === "model-ready") {
      void chooseBrain().then((b) => say(`brain: ${b}`));
    } else if (msg === "model-failed") {
      say("brain: rules (the model setup did not finish)");
    } else if (msg === "panic") {
      world = { ...world, panic: !world.panic };
      // Panic hides everything, the mess too.
      if (world.panic) cat.mess.clear();
      say(`panic ${world.panic ? "on" : "off"}`);
    } else if (msg === "shoo") {
      if (world.shooedUntilMs > Date.now()) {
        world = { ...world, shooedUntilMs: 0 };
        say("shoo ended, the cat may come back");
      } else {
        world = { ...world, shooedUntilMs: Date.now() + 3_600_000 };
        say("shoo for 1 hour");
        // Untick the menu when the hour is up.
        setTimeout(showChoices, 3_601_000);
      }
    } else if (msg === "model") {
      useModel = !useModel;
      saveSettings();
      if (useModel) {
        void chooseBrain(true).then((b) => say(`brain: ${b}`));
      } else {
        cat.setBrain(new RulesBrain());
        cat.updateSettings({ brain: "rules" });
        say("brain: rules (the local model is off in the menu)");
      }
    } else if (msg.startsWith("chaos:")) {
      const level = msg.slice(6);
      if (level === "chill" || level === "normal" || level === "gremlin") {
        cat.updateSettings({ chaos: level });
        say(`chaos level ${level}`);
        saveSettings();
      }
    } else if (msg.startsWith("character:")) {
      character = characterById(msg.slice(10));
      cat.setPersonality(character.personality);
      say(`character ${character.id}`);
      saveSettings();
    } else if (msg === "treat") {
      // A treat is an invitation, so it also ends a shoo.
      world = { ...world, shooedUntilMs: 0 };
      cat.treat(world);
      say("treat");
    } else if (msg === "toy") {
      cat.throwToy(world);
      say("toy thrown");
    } else if (msg === "petmenu-test") {
      // FELINQUENT_PETMENU_TEST: the menu on the animal, opened next to it with no click, once it
      // sits still (a minute at most), so a picture shows the two together.
      const still = new Set(["idle_sit", "loaf", "sleep", "watch", "groom", "blink", "stare", "look"]);
      const t0 = performance.now();
      const tryOpen = (): void => {
        if (!still.has(cat.executor.body.anim) && performance.now() - t0 < 60_000) {
          setTimeout(tryOpen, 300);
          return;
        }
        const r = cat.executor.hitRect();
        say(`pet menu: test (${cat.executor.body.anim})`);
        void invoke("pet_menu", { x: Math.round(r.x + r.w + 6), y: Math.round(r.y - 150) }).catch(() => {});
      };
      tryOpen();
    } else if (msg === "pet" || msg === "zoomies" || msg === "nap") {
      // From the menu on the animal: it starts now, from the rules.
      cat.ask(world, msg);
      say(`asked: ${msg}`);
    } else if (msg === "forget") {
      memory.forgetAll();
      memoryJson = memory.exportJson();
      void invoke("save_state", { name: "memory.json", text: memoryJson }).catch(() => {});
      say("memory cleared");
    }
    showChoices();
  });

  let placed = false;
  let lastLog = -10000;
  let lastErr = -10000;
  let lastT = performance.now();
  // Frame pacing, for the log: frames drawn and the longest gap since the last log line.
  let frames = 0;
  let worstGap = 0;
  let nextDue = performance.now();
  let cursor = { x: -9999, y: -9999 };
  let cursorSpeed = 0;
  let down = false;
  let rightDown = false;
  let lastDemo = 0;
  // The menu on the animal opens on a right-click over it. The button is read with the pointer (the
  // window lets clicks through most of the time), and the webview's own right-click is the backup,
  // for a click that comes and goes between two reads. Once per click, whichever is first.
  let petMenuAt = -1e9;
  const openPetMenu = (how: string): void => {
    const t = performance.now();
    if (t - petMenuAt < 800) return;
    if (!placed || cat.away || cat.executor.body.hidden || !inside(cat.executor.hitRect(), cursor, 8)) return;
    petMenuAt = t;
    say(`pet menu: right-click (${how})`);
    void invoke("pet_menu").catch(() => {});
  };
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openPetMenu("page");
  });

  let thought: { text: string; since: number } | null = null;
  // It just updated itself: once it has settled in, a hello in a bubble (once per update).
  void invoke<string | null>("just_updated")
    .then((was) => {
      if (!was) return;
      say(`updated from ${was}`);
      setTimeout(() => {
        if (cat.settings.thoughtBubbles) thought = { text: "i got updated. i feel brand new.", since: performance.now() };
      }, 6000);
    })
    .catch(() => {});
  let demoRound = 0;
  function demoStep(now: number): void {
    if (!config.demo || now - lastDemo < 25000) return;
    lastDemo = now;
    // Alternate: the front window, then a window on another display (if there is one), then the Dock.
    const elsewhere = world.windows.find((w) => w.bounds.y + 1 < main.y || w.bounds.x >= main.x + main.w || w.bounds.x + w.bounds.w <= main.x);
    const picks = [world.windows[0], elsewhere, undefined];
    const target = picks[demoRound++ % picks.length];
    if (!target) {
      cat.executor.start({ intent: "block_dock", target: "dock", approach: "walk", stay_sec: 8, mood: "smug" });
      say("demo: back to the dock");
      return;
    }
    cat.executor.start({ intent: "sit_on", target: target.id, approach: "walk", stay_sec: 20, mood: "smug" });
    say(`demo: sit_on ${target.id} (${target.app}) at ${JSON.stringify(target.bounds)}`);
  }

  let drawnSeq = 0;
  async function frame(): Promise<void> {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    worstGap = Math.max(worstGap, now - lastT);
    frames++;
    lastT = now;
    try {
      // A window being dragged (the mouse is down, or something moved a moment ago): read the windows
      // every frame. Otherwise four times a second, with the rest of the sensors.
      if (now - lastSensorsAt > 250) void pollSensors();
      else if (down || cat.motion.movedWithin(1)) await pollWindows();
      const p = await invoke<Pointer>("read_pointer");
      // How fast the cursor moves (px/s, smoothed): a moving cursor is something to watch or play with.
      if (cursor.x > -9000 && dt > 0) cursorSpeed += (Math.hypot(p.x - cursor.x, p.y - cursor.y) / dt - cursorSpeed) * Math.min(1, dt / 0.15);
      cursor = { x: p.x, y: p.y };
      // A right-click on the animal opens its menu (a treat, its toy, pet it, zoomies, a nap, the
      // character, the chaos level, shoo, panic).
      if (p.right && !rightDown) openPetMenu("button");
      rightDown = !!p.right;
      if (p.down && !down && placed) {
        // What a press landed on, so a grab that doesn't take shows in the log (no titles, just shapes).
        const near = cat.grabRects.map((r) => Math.round(Math.max(0, Math.abs(p.x - (r.x + r.w / 2)) - r.w / 2, Math.abs(p.y - (r.y + r.h / 2)) - r.h / 2)));
        say(`press: things ${near.length} nearest ${near.length ? Math.min(...near) : -1}px treat ${cat.treatHeld} through ${clickThrough}`);
      }
      down = p.down;
      world = { ...world, nowMs: Date.now(), cursor, cursorSpeed };
      drawnSeq = worldSeq;
      if (!placed) {
        cat.place(world, 200);
        placed = true;
      }
      demoStep(now);
      cat.pointer({ t: now, x: cursor.x, y: cursor.y, down }, world);
      const res = await cat.step(world, dt);
      for (const ev of res.mind) {
        if (ev.type === "llm_problem") say(`llm problem: ${ev.message}`);
        // Shown, never logged (hard rule 6).
        if (ev.type === "intent" && ev.intent.thought && cat.settings.thoughtBubbles) thought = { text: ev.intent.thought, since: now };
      }
    } catch (e) {
      if (now - lastErr > 3000) {
        lastErr = now;
        say(`error: ${String(e)}`);
      }
    }

    if (placed) {
      const st: CatState = {
        // On another desktop: not drawn here.
        body: { ...cat.executor.body, hidden: cat.executor.body.hidden || cat.away },
        scale: cat.executor.size.h / 90,
        hit: cat.executor.hitRect(),
        block: cat.blockingRect,
        cursor,
        look: cat.lookAt(cursor),
        held: cat.executor.held,
        toy: cat.toyRect,
        toyHeld: cat.mess.holding,
        grabs: cat.grabRects,
        treatHeld: cat.treatHeld,
        spots: cat.spotRects,
        t: now / 1000,
        character: character.id,
        mess: cat.mess.snapshot(),
        windows: world.windows.map((w) => ({ id: w.id, app: "", bounds: w.bounds, focused: false, cpu: "low", z: w.z })),
        thought: thought && (now - thought.since) / 1000 < THOUGHT_SEC && !cat.executor.body.hidden && !cat.away ? { text: thought.text, age: (now - thought.since) / 1000 } : null,
      };
      render(st);
      applyHit(st);
      if (others.length > 0) void tauri?.event.emit("cat-state", st);
      if (revealAfter && drawnSeq >= revealAfter.seq) {
        void invoke("overlay_reveal", { turn: revealAfter.turn }).catch(() => {});
        revealAfter = null;
      }
      if (now - lastLog > 3000) {
        const fps = (frames * 1000) / (now - lastLog);
        lastLog = now;
        const cur = cat.mind.current;
        const b = st.body;
        say(
          `cat x=${b.x.toFixed(0)} y=${b.y.toFixed(0)} anim=${b.anim} platform=${b.platformId ?? "-"} intent=${cur?.intent ?? (cat.mind.sleeping ? "asleep" : "deciding")} windows=${windowCount} desktop=${world.space ? `${world.space.id}#${world.space.index}${world.space.app ? " (full-screen app)" : ""}${world.fullscreen ? " (video or slides: outside)" : ""}` : "-"}${cat.away ? " (cat on its own desktop)" : ""} clickThrough=${clickThrough} down=${down} fps=${fps.toFixed(0)} gap=${worstGap.toFixed(0)}ms shown=${document.visibilityState === "visible" ? "yes" : "no"}`,
        );
        frames = 0;
        worstGap = 0;
      }
    }
    // Timers, not animation frames: WebKit stops animation frames in a transparent click-through window.
    // Each frame is due 1/60 s after the last one was due, so the time spent drawing does not add up
    // (a plain 16 ms wait after the work ran at about 52 frames a second). After a stall it starts again
    // from now instead of rushing to catch up.
    const clock = performance.now();
    nextDue = nextDue + 1000 / 60 < clock ? clock : nextDue + 1000 / 60;
    setTimeout(() => void frame(), nextDue - clock);
  }

  say(`character ${character.id}, memory events ${memory.events().length}`);
  say(`master window, ${layout.displays.length} display(s), dock top ${layout.dock_top}`);
  void frame();
}

// The webview's own right-click menu (Reload, Inspect) never shows over the animal: it has its own (pet_menu).
window.addEventListener("contextmenu", (e) => e.preventDefault());
void main().catch((e) => say(`fatal: ${String(e)}`));
