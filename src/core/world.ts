import type { Rect, WindowInfo, WorldSnapshot } from "./types";

const SCREEN: Rect = { x: 0, y: 0, w: 1440, h: 900 };

/** A ready-made desktop for tests, the playground and the brain eval. */
export function makeWindows(withTitles = true): WindowInfo[] {
  const t = (s: string) => (withTitles ? { title: s } : {});
  return [
    { id: "w1", app: "Code", ...t("auth.ts - backend"), bounds: { x: 100, y: 120, w: 800, h: 620 }, focused: true, cpu: "low", z: 0 },
    { id: "w2", app: "Safari", ...t("cat videos - YouTube"), bounds: { x: 700, y: 200, w: 640, h: 520 }, focused: false, cpu: "high", z: 1 },
    { id: "w3", app: "Word", ...t("Final_Thesis_v7.docx"), bounds: { x: 200, y: 300, w: 560, h: 420 }, focused: false, cpu: "low", z: 2 },
  ];
}

export function makeWorld(over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    nowMs: Date.UTC(2026, 10, 2, 10, 0, 0),
    hour: 10,
    screen: SCREEN,
    dockTop: 860,
    windows: makeWindows(),
    frontApp: "Code",
    activity: "typing",
    idleSec: 2,
    cursor: { x: 600, y: 400 },
    cursorSpeed: 0,
    appSwitchedSecAgo: 600,
    minutesSincePet: 30,
    inMeeting: false,
    screenSharing: false,
    fullscreen: false,
    batteryLow: false,
    panic: false,
    quietHours: false,
    shooedUntilMs: 0,
    ...over,
  };
}
