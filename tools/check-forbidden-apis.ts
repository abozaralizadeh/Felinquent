import fs from "node:fs";
import path from "node:path";

/**
 * Hard lines H-1 and H-2 from docs/safety-and-privacy.md, enforced as a build check.
 * The cat must never fake input and never capture the screen.
 */
export interface Rule {
  rule: "H-1 input synthesis" | "H-2 screen capture";
  pattern: RegExp;
}

export const RULES: Rule[] = [
  { rule: "H-1 input synthesis", pattern: /\bCGEventPost\b|\bCGEventCreate(Keyboard|Mouse|Scroll)\w*|\bCGWarpMouseCursorPosition\b|\bCGEventTapPostEvent\b/ },
  { rule: "H-1 input synthesis", pattern: /\bSendInput\b|\bkeybd_event\b|\bmouse_event\b|\bSetCursorPos\b|\bXTestFake\w+|\buinput\b/ },
  { rule: "H-1 input synthesis", pattern: /\benigo\b|\brobotjs\b|\bnut-js\b|\bpyautogui\b|\bpynput\b/i },
  { rule: "H-1 input synthesis", pattern: /osascript[\s\S]{0,80}(keystroke|key code|click at)/i },
  { rule: "H-2 screen capture", pattern: /\bCGWindowListCreateImage\b|\bCGDisplayCreateImage\b|\bSCScreenshotManager\b|\bSCStream\b|\bScreenCaptureKit\b/ },
  { rule: "H-2 screen capture", pattern: /\bscreencapture\b|\bdesktopCapturer\b|\bgetDisplayMedia\b|\bscrot\b/ },
];

export interface Finding {
  file: string;
  line: number;
  rule: Rule["rule"];
  text: string;
}

export function scanText(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const r of RULES) if (r.pattern.test(line)) out.push({ file, line: i + 1, rule: r.rule, text: line.trim().slice(0, 120) });
  });
  return out;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "target", ".vitest", "research"]);
const EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".rs", ".swift", ".m", ".py", ".sh", ".html", ".toml", ".json"]);

export function scanDir(dir: string, self: string): Finding[] {
  const out: Finding[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scanDir(full, self));
    else if (EXT.has(path.extname(entry.name)) && path.resolve(full) !== self && entry.name !== "package-lock.json") {
      out.push(...scanText(full, fs.readFileSync(full, "utf8")));
    }
  }
  return out;
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const self = path.resolve(process.argv[1] as string);
  const roots = ["src", "src-tauri", "tools", "native"].filter((d) => fs.existsSync(d));
  const findings = roots.flatMap((r) => scanDir(r, self));
  if (findings.length) {
    for (const f of findings) console.error(`${f.rule}: ${f.file}:${f.line}  ${f.text}`);
    console.error(`\n${findings.length} forbidden API use(s) found.`);
    process.exit(1);
  }
  console.log(`forbidden-API check passed (scanned: ${roots.join(", ")})`);
}
