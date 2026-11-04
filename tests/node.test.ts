import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileMemory } from "../src/node/jsonMemory";
import { RotatingLogger } from "../src/node/logger";
import { createServer } from "../src/node/serve";
import { RULES, scanText } from "../tools/check-forbidden-apis";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "felinquent-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("RotatingLogger", () => {
  it("never grows past maxBytes * maxFiles", () => {
    const dir = tmp();
    const log = new RotatingLogger({ dir, name: "app", maxBytes: 2000, maxFiles: 3 });
    for (let i = 0; i < 500; i++) log.info("a line that takes up some room in the file", { i });
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(["app.log", "app.log.1", "app.log.2"]);
    for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThanOrEqual(2000);
  });

  it("keeps the newest lines and drops the oldest", () => {
    const dir = tmp();
    const log = new RotatingLogger({ dir, name: "app", maxBytes: 600, maxFiles: 2 });
    for (let i = 0; i < 100; i++) log.info(`line-${i}`);
    const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(all).toContain("line-99");
    expect(all).not.toContain("line-0 ");
  });

  it("keeps window titles and text out of the file at the default level", () => {
    const dir = tmp();
    const log = new RotatingLogger({ dir, name: "app" });
    log.info("intent", { intent: "sit_on", title: "Final_Thesis_v7.docx", text: "secret", windowId: "w3" });
    const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    expect(text).toContain("sit_on");
    expect(text).not.toContain("Final_Thesis");
    expect(text).not.toContain("secret");
  });

  it("only writes titles when debug is switched on", () => {
    const dir = tmp();
    const log = new RotatingLogger({ dir, name: "dbg", level: "debug" });
    log.debug("prompt", { title: "Final_Thesis_v7.docx" });
    expect(fs.readFileSync(path.join(dir, "dbg.log"), "utf8")).toContain("Final_Thesis");
  });

  it("skips levels below the threshold and truncates huge values", () => {
    const dir = tmp();
    const log = new RotatingLogger({ dir, name: "app", level: "warn" });
    log.info("quiet");
    log.warn("loud", { blob: "x".repeat(1000) });
    const text = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    expect(text).not.toContain("quiet");
    expect(text.length).toBeLessThan(500);
  });

  it("continues the size count from an existing file", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "app.log"), "x".repeat(960));
    const log = new RotatingLogger({ dir, name: "app", maxBytes: 1000, maxFiles: 2 });
    log.info("a line long enough to push it over the limit and force a rotate");
    expect(fs.existsSync(path.join(dir, "app.log.1"))).toBe(true);
  });
});

describe("JsonFileMemory", () => {
  it("saves, reloads, and forgets everything", () => {
    const file = path.join(tmp(), "mem", "cat.json");
    const m = new JsonFileMemory(file);
    m.log({ atMs: 1000, kind: "pet" });
    m.log({ atMs: 2000, kind: "shoo", app: "Slack" });
    const again = new JsonFileMemory(file);
    expect(again.events()).toHaveLength(2);
    again.forgetAll();
    expect(new JsonFileMemory(file).events()).toHaveLength(0);
  });

  it("survives a damaged file", () => {
    const file = path.join(tmp(), "cat.json");
    fs.writeFileSync(file, "{not json");
    expect(new JsonFileMemory(file).events()).toEqual([]);
  });
});

describe("static server", () => {
  async function start(root: string) {
    const dir = tmp();
    const logger = new RotatingLogger({ dir, name: "playground" });
    const server = createServer({ root, port: 0, logger });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, logFile: path.join(dir, "playground.log"), close: () => server.close() };
  }
  const get = (url: string) =>
    new Promise<{ status: number; body: string; type: string }>((resolve, reject) => {
      http.get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"]) }));
      }).on("error", reject);
    });

  it("serves files, health, 404 and refuses to leave its folder", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "index.html"), "<h1>cat</h1>");
    fs.writeFileSync(path.join(tmp(), "secret.txt"), "nope");
    const s = await start(root);
    try {
      expect(await get(`${s.base}/`)).toMatchObject({ status: 200, body: "<h1>cat</h1>", type: expect.stringContaining("text/html") });
      expect((await get(`${s.base}/healthz`)).body).toBe("ok\n");
      expect((await get(`${s.base}/nothing.js`)).status).toBe(404);
      const escape = await get(`${s.base}/..%2f..%2fetc%2fpasswd`);
      expect([403, 404]).toContain(escape.status);
      expect(escape.body).not.toContain("root:");
      expect(fs.readFileSync(s.logFile, "utf8")).toContain("request");
    } finally {
      s.close();
    }
  });
});

describe("forbidden API check (hard lines H-1 and H-2)", () => {
  const bad = [
    "CGEventPost(kCGHIDEventTap, ev)",
    "let e = CGEventCreateKeyboardEvent(src, 0, true)",
    "CGWarpMouseCursorPosition(p)",
    "SendInput(1, &input, sizeof(INPUT))",
    "use enigo::Enigo;",
    "osascript -e 'tell application \"System Events\" to keystroke \"a\"'",
    "CGWindowListCreateImage(rect, opt, id, img)",
    "navigator.mediaDevices.getDisplayMedia()",
    "exec('screencapture -x shot.png')",
  ];
  const fine = [
    "const windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID)",
    "NSEvent.mouseLocation",
    "CGEventSourceSecondsSinceLastEventType(state, type)",
    "element.dispatchEvent is not used here",
  ];

  it("flags every kind of input faking and screen capture", () => {
    for (const line of bad) expect(scanText("x", line).length, line).toBeGreaterThan(0);
  });

  it("allows the read-only calls the cat does use", () => {
    for (const line of fine) expect(scanText("x", line), line).toEqual([]);
  });

  it("has rules for both hard lines and reports file and line", () => {
    expect(new Set(RULES.map((r) => r.rule))).toEqual(new Set(["H-1 input synthesis", "H-2 screen capture"]));
    expect(scanText("f.ts", "ok\nCGEventPost()")[0]).toMatchObject({ file: "f.ts", line: 2 });
  });
});
