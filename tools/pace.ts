/**
 * How busy each animal looks: simulates life at 10 Hz for every character and chaos level and prints
 * how much of the time it sleeps, rests and acts, how often its pose and its frame change while it's
 * awake, and how long poses are held.
 *
 * Usage: npm run pace -- [minutes=60] [character] [--detail]
 * --detail also prints the most common pose changes, the picked intents and the time per animation.
 */
import { Cat } from "../src/core/cat";
import { CHARACTERS } from "../src/core/characters";
import { seeded } from "../src/core/rng";
import { makeWorld } from "../src/core/world";
import { planFor } from "../src/playground/sprites";

const args = process.argv.slice(2);
const detail = args.includes("--detail");
const [minArg, only] = args.filter((a) => !a.startsWith("--"));
const MIN = Number(minArg ?? "60");
const T0 = Date.UTC(2026, 10, 2, 10, 0, 0);
// Animations that are cycles of frames: their frame changes are the motion itself, not a change of pose.
const CYCLES = new Set(["walk", "run", "keyboard", "groom", "sleep", "chase_tail", "jump", "fall"]);
const top = (m: Map<string, number>, n: number, f = (v: number) => `${v}`): string =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${f(v)}`).join(", ");
const add = (m: Map<string, number>, k: string, v = 1): void => void m.set(k, (m.get(k) ?? 0) + v);

async function main(): Promise<void> {
  const rows: Record<string, string | number>[] = [];
  for (const c of CHARACTERS.filter((c) => !only || c.id === only)) {
    for (const chaos of ["chill", "normal", "gremlin"] as const) {
      const world = makeWorld({ nowMs: T0 });
      const cat = new Cat({ rng: seeded(11), personality: c.personality, settings: { chaos } });
      cat.place(world, 600);
      const steps = MIN * 60 * 10;
      let asleep = 0, resting = 0, acting = 0, moving = 0, decisions = 0, poseChanges = 0, frameChanges = 0;
      let anim = "", key = "", since = 0;
      const holds: number[] = [];
      const changes = new Map<string, number>();
      const picked = new Map<string, number>();
      const timeIn = new Map<string, number>();
      for (let i = 0; i < steps; i++) {
        const ms = T0 + (i + 1) * 100;
        const res = await cat.step({ ...world, nowMs: ms, hour: new Date(ms).getUTCHours() }, 0.1);
        for (const e of res.mind) if (e.type === "intent") (decisions++, add(picked, e.intent.intent));
        const b = cat.executor.body;
        const t = i / 10;
        if (cat.mind.sleeping) asleep++;
        else if (cat.mind.current) acting++;
        else resting++;
        if (b.anim === "walk" || b.anim === "run") moving++;
        if (!cat.mind.sleeping) add(timeIn, b.anim);
        if (b.anim !== anim) {
          if (anim && !cat.mind.sleeping) {
            poseChanges++;
            holds.push(t - since);
            add(changes, `${anim}>${b.anim}`);
          }
          anim = b.anim;
          since = t;
        }
        if (!CYCLES.has(b.anim) && !cat.mind.sleeping) {
          const k = planFor(b.anim, t).key;
          if (k !== key) frameChanges++;
          key = k;
        } else key = "";
      }
      const awakeMin = Math.max(0.1, (steps - asleep) / 600);
      const pct = (n: number): number => Math.round((100 * n) / steps);
      holds.sort((a, b) => a - b);
      rows.push({
        id: c.id,
        chaos,
        "asleep%": pct(asleep),
        "rest%": pct(resting),
        "act%": pct(acting),
        "move%": pct(moving),
        "picks/min": +(decisions / MIN).toFixed(1),
        "poses/awake min": +(poseChanges / awakeMin).toFixed(1),
        "frames/awake min": +(frameChanges / awakeMin).toFixed(1),
        "hold p10 s": +(holds[Math.floor(holds.length * 0.1)] ?? 0).toFixed(1),
        "hold median s": +(holds[Math.floor(holds.length * 0.5)] ?? 0).toFixed(1),
      });
      if (detail) {
        console.log(`${c.id} ${chaos}`);
        console.log(`  changes: ${top(changes, 12)}`);
        console.log(`  picked: ${top(picked, 12)}`);
        console.log(`  time awake %: ${top(timeIn, 10, (v) => `${Math.round((100 * v) / Math.max(1, steps - asleep))}`)}`);
      }
    }
  }
  console.table(rows);
}

void main();
