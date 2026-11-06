import { Habits, type HabitsData } from "./habits";
import { TrickBook, type TricksData } from "./tricks";

export interface MemoryEvent {
  atMs: number;
  /** pet, shoo, sat_on, napped, treat, thrown, gift, ... */
  kind: string;
  /** App name only. Window titles are never stored by default. */
  app?: string;
}

export interface Memory {
  log(ev: MemoryEvent): void;
  events(): MemoryEvent[];
  /** Short lines for the prompt, newest relevant first. */
  recentLines(n: number, nowMs: number): string[];
  forgetAll(): void;
  exportJson(): string;
  /** What the cat learned about its own choices. */
  habits?: Habits;
  /** The tricks it made up. */
  tricks?: TrickBook;
}

const DAY_MS = 86_400_000;
const RETENTION_MS = 30 * DAY_MS;

const mins = (nowMs: number, t: number) => Math.max(0, Math.round((nowMs - t) / 60_000));

export class InMemoryMemory implements Memory {
  protected list: MemoryEvent[] = [];
  readonly habits = new Habits();
  readonly tricks = new TrickBook();

  log(ev: MemoryEvent): void {
    this.list.push(ev);
    this.prune(ev.atMs);
  }

  protected prune(nowMs: number): void {
    const cut = nowMs - RETENTION_MS;
    if (this.list.length && (this.list[0] as MemoryEvent).atMs < cut) this.list = this.list.filter((e) => e.atMs >= cut);
    if (this.list.length > 5000) this.list = this.list.slice(-5000);
  }

  events(): MemoryEvent[] {
    return [...this.list];
  }

  recentLines(n: number, nowMs: number): string[] {
    const lines: string[] = [];
    const last = (kind: string) => [...this.list].reverse().find((e) => e.kind === kind);
    const shoo = last("shoo");
    if (shoo && nowMs - shoo.atMs < 60 * 60_000) lines.push(`shooed${shoo.app ? ` from ${shoo.app}` : ""} ${mins(nowMs, shoo.atMs)} min ago`);
    const pet = last("pet");
    if (pet) lines.push(`petted ${mins(nowMs, pet.atMs)} min ago`);
    const sat = last("sat_on");
    if (sat) lines.push(`sat on ${sat.app ?? "a window"} ${mins(nowMs, sat.atMs)} min ago`);
    const counts = new Map<string, number>();
    for (const e of this.list) if (e.kind === "shoo" && e.app) counts.set(e.app, (counts.get(e.app) ?? 0) + 1);
    for (const [app, c] of counts) if (c >= 3) lines.push(`shooed from ${app} x${c}`);
    const fav = this.favoriteSpot();
    if (fav) lines.push(`favorite spot: ${fav}`);
    const habit = this.habits.line(nowMs);
    if (habit) lines.push(habit);
    return lines.slice(0, n);
  }

  favoriteSpot(): string | null {
    const counts = new Map<string, number>();
    for (const e of this.list) if (e.kind === "sat_on" && e.app) counts.set(e.app, (counts.get(e.app) ?? 0) + 1);
    let best: string | null = null;
    let bc = 1;
    for (const [app, c] of counts) if (c > bc) ((best = app), (bc = c));
    return best;
  }

  forgetAll(): void {
    this.list = [];
    this.habits.clear();
    this.tricks.clear();
  }

  exportJson(): string {
    return JSON.stringify({ events: this.list, habits: this.habits.toJSON(), tricks: this.tricks.toJSON() }, null, 2);
  }

  /** Reads what exportJson wrote. Bad or empty input leaves an empty memory. */
  loadJson(text: string): void {
    try {
      const data = JSON.parse(text) as { events?: MemoryEvent[]; habits?: Partial<HabitsData>; tricks?: TricksData };
      this.list = Array.isArray(data.events) ? data.events : [];
      this.habits.load(data.habits);
      this.tricks.load(data.tricks);
    } catch {
      this.list = [];
      this.habits.clear();
      this.tricks.clear();
    }
  }
}

/** One cat-voiced line per day. App names only unless the caller allows more. */
export function generateDiary(events: MemoryEvent[], dayStartMs: number, catName: string): string[] {
  const day = events.filter((e) => e.atMs >= dayStartMs && e.atMs < dayStartMs + DAY_MS);
  const count = (k: string) => day.filter((e) => e.kind === k).length;
  const sat = count("sat_on");
  const pets = count("pet");
  const shoos = count("shoo");
  const treats = count("treat");
  const lines: string[] = [];
  if (sat > 0) lines.push(`sat on the important window ${sat} time${sat === 1 ? "" : "s"}.`);
  if (pets > 0) lines.push(`got petted ${pets} time${pets === 1 ? "" : "s"}.${pets < 3 ? " unacceptable." : " acceptable."}`);
  else lines.push("nobody petted me. noted.");
  if (shoos > 0) lines.push(`was shooed ${shoos} time${shoos === 1 ? "" : "s"}. i remember everything.`);
  if (treats > 0) lines.push(`received ${treats} treat${treats === 1 ? "" : "s"}. adequate.`);
  if (lines.length < 3) lines.push("slept. the rest is none of your business.");
  return [`dear diary, it's ${catName}.`, ...lines.slice(0, 3)];
}
