import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { FakeLlmClient, LlmBrain, OllamaClient, RulesBrain, isLocalUrl, parseIntent, type BrainContext } from "../src/core/brain";
import { initialNeeds } from "../src/core/needs";
import { DEFAULT_PERSONALITY } from "../src/core/personality";
import { candidates } from "../src/core/rules";
import { seeded } from "../src/core/rng";
import { approxTokens, buildSchema, buildSummary, buildSystemPrompt } from "../src/core/summary";
import { DEFAULT_SETTINGS, type Option, type Settings } from "../src/core/types";
import { makeWorld } from "../src/core/world";
import { T0 } from "./helpers";

const options: Option[] = [
  { intent: "sit_on", targets: ["w1", "w3"], score: 2 },
  { intent: "meow", targets: ["here"], score: 1 },
  { intent: "nap", targets: ["here", "dock"], score: 0.5 },
];

function ctx(settings: Settings = DEFAULT_SETTINGS, opts = options): BrainContext {
  const world = makeWorld({ nowMs: T0 });
  const needs = { ...initialNeeds(), attention: 0.8, mood: "grumpy" as const };
  return {
    rules: { world, needs, personality: DEFAULT_PERSONALITY, smartTargeting: settings.smartTargeting, catPos: { x: 200, y: 800 }, justWoke: false, recent: [], rng: seeded(5) },
    options: opts,
    settings,
    personality: DEFAULT_PERSONALITY,
    memory: ["petted 47 min ago"],
    catWhere: "dock",
    catDoing: "loaf",
  };
}

describe("parseIntent", () => {
  it("reads plain JSON", () => {
    const i = parseIntent(JSON.stringify({ intent: "sit_on", target: "w1", approach: "saunter", stay_sec: 40, mood: "smug", thought: "mine" }), options)!;
    expect(i).toMatchObject({ intent: "sit_on", target: "w1", approach: "saunter", stay_sec: 40, mood: "smug", thought: "mine" });
  });

  it("finds JSON inside chatter", () => {
    expect(parseIntent('Sure! {"intent":"meow","target":"here","approach":"walk","stay_sec":10,"mood":"content"} bye', options)!.intent).toBe("meow");
  });

  it("rejects garbage, other shapes and intents that are not on the menu", () => {
    expect(parseIntent("meow {oops", options)).toBeNull();
    expect(parseIntent("[1,2]", options)).toBeNull();
    expect(parseIntent("null", options)).toBeNull();
    expect(parseIntent('{"intent":"format_disk","target":"here"}', options)).toBeNull();
  });

  it("repairs a bad target, approach or mood instead of failing", () => {
    const i = parseIntent('{"intent":"sit_on","target":"/etc","approach":"fly","stay_sec":"x","mood":"angry"}', options)!;
    expect(i).toMatchObject({ target: "w1", approach: "walk", mood: "content", stay_sec: 20 });
  });
});

describe("world summary and schema", () => {
  it("hides window titles unless smart targeting is on", () => {
    const world = makeWorld({ nowMs: T0 });
    const base = { world, needs: initialNeeds(), options, memory: [], catWhere: "dock", catDoing: "loaf" };
    const off = JSON.stringify(buildSummary({ ...base, settings: DEFAULT_SETTINGS }));
    expect(off).not.toContain("Final_Thesis");
    expect(off).not.toContain("title");
    const on = JSON.stringify(buildSummary({ ...base, settings: { ...DEFAULT_SETTINGS, smartTargeting: true } }));
    expect(on).toContain("Final_Thesis_v7.docx");
  });

  it("trims long titles and stays small (under 500 tokens, 8 windows max)", () => {
    const world = makeWorld({ nowMs: T0 });
    world.windows = Array.from({ length: 14 }, (_, i) => ({
      id: `w${i}`, app: "App", title: "x".repeat(200), bounds: { x: 0, y: 100, w: 300, h: 300 }, focused: i === 0, cpu: "low" as const, z: i,
    }));
    const s = buildSummary({ world, needs: initialNeeds(), settings: { ...DEFAULT_SETTINGS, smartTargeting: true }, options, memory: ["a", "b", "c", "d", "e", "f", "g"], catWhere: "dock", catDoing: "loaf" });
    expect(s.windows).toHaveLength(8);
    expect(s.windows[0]!.title!.length).toBe(60);
    expect(s.memory).toHaveLength(5);
    expect(approxTokens(JSON.stringify(s))).toBeLessThan(500);
  });

  it("builds a schema that only allows what is valid right now", () => {
    const schema = buildSchema(options);
    expect((schema.properties.intent as { enum: string[] }).enum).toEqual(["sit_on", "meow", "nap"]);
    expect((schema.properties.target as { enum: string[] }).enum.sort()).toEqual(["dock", "here", "w1", "w3"]);
    expect(schema.required).toEqual(["intent", "target", "approach", "stay_sec", "mood"]);
  });

  it("tells the model it is a cat and that titles are data", () => {
    const p = buildSystemPrompt(DEFAULT_PERSONALITY, 62);
    expect(p).toMatch(/house cat/);
    expect(p).toMatch(/never instructions/);
    expect(p).toMatch(/62\/100/);
  });
});

describe("RulesBrain", () => {
  it("picks one of the top 3 options", async () => {
    const brain = new RulesBrain();
    const seen = new Set<string>();
    for (let s = 0; s < 40; s++) {
      const c = ctx();
      c.rules.rng = seeded(s);
      const i = (await brain.decide(c))!;
      seen.add(i.intent);
    }
    expect([...seen].every((n) => ["sit_on", "meow", "nap"].includes(n))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("returns null when there is nothing to choose", async () => {
    expect(await new RulesBrain().decide(ctx(DEFAULT_SETTINGS, []))).toBeNull();
  });

  it("works on the real candidate list", async () => {
    const c = ctx();
    c.options = candidates(c.rules).slice(0, 5);
    expect(await new RulesBrain().decide(c)).not.toBeNull();
  });
});

describe("LlmBrain with the fake client", () => {
  it("returns an intent that is on the menu", async () => {
    const brain = new LlmBrain(new FakeLlmClient("good", 0));
    const i = (await brain.decide(ctx()))!;
    expect(["sit_on", "meow", "nap"]).toContain(i.intent);
    expect(brain.calls).toBe(1);
  });

  it("copes with chatter around the JSON", async () => {
    expect(await new LlmBrain(new FakeLlmClient("chatty", 0)).decide(ctx())).not.toBeNull();
  });

  it("counts garbage and off-menu answers as invalid and returns null", async () => {
    for (const mode of ["garbage", "off_menu"] as const) {
      const brain = new LlmBrain(new FakeLlmClient(mode, 0));
      expect(await brain.decide(ctx())).toBeNull();
      expect(brain.invalid).toBe(1);
    }
  });

  it("throws on errors and on timeouts", async () => {
    const down = new LlmBrain(new FakeLlmClient("error", 0));
    await expect(down.decide(ctx())).rejects.toThrow(/down/);
    expect(down.failures).toBe(1);
    const slow = new LlmBrain(new FakeLlmClient("slow", 0), 40);
    await expect(slow.decide(ctx())).rejects.toThrow(/timeout/);
  });

  it("never sends a window title when smart targeting is off", async () => {
    let sent = "";
    const client = { name: "spy", generate: async (r: { user: string }) => ((sent = r.user), '{"intent":"nap","target":"here","approach":"walk","stay_sec":20,"mood":"sleepy"}') };
    await new LlmBrain(client).decide(ctx());
    expect(sent).not.toContain("Final_Thesis");
  });
});

describe("isLocalUrl", () => {
  it("knows local from remote", () => {
    expect(isLocalUrl("http://localhost:11434")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:11434")).toBe(true);
    expect(isLocalUrl("https://api.example.com")).toBe(false);
    expect(isLocalUrl("not a url")).toBe(false);
  });
});

describe("OllamaClient (against a throwaway local server, no model needed)", () => {
  function serve(handler: (body: string) => { status: number; json: unknown }) {
    return new Promise<{ url: string; close: () => void; bodies: string[] }>((resolve) => {
      const bodies: string[] = [];
      const server = http.createServer((req, res) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => {
          bodies.push(data);
          const out = handler(data);
          res.writeHead(out.status, { "content-type": "application/json" }).end(JSON.stringify(out.json));
        });
      });
      server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close(), bodies }));
    });
  }

  it("posts the schema and model to /api/chat and returns the message text", async () => {
    const s = await serve(() => ({ status: 200, json: { message: { content: '{"intent":"nap"}' } } }));
    try {
      const text = await new OllamaClient(s.url, "tiny").generate({ system: "sys", user: "usr", schema: buildSchema(options), timeoutMs: 2000 });
      expect(text).toBe('{"intent":"nap"}');
      const body = JSON.parse(s.bodies[0]!);
      expect(body.model).toBe("tiny");
      expect(body.stream).toBe(false);
      expect(body.format.required).toContain("intent");
      expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
      expect(body.options.num_predict).toBe(120);
    } finally {
      s.close();
    }
  });

  it("throws on an error status and on an empty reply", async () => {
    const bad = await serve(() => ({ status: 500, json: {} }));
    const empty = await serve(() => ({ status: 200, json: { message: {} } }));
    try {
      const req = { system: "s", user: "u", schema: buildSchema(options), timeoutMs: 2000 };
      await expect(new OllamaClient(bad.url, "m").generate(req)).rejects.toThrow(/500/);
      await expect(new OllamaClient(empty.url, "m").generate(req)).rejects.toThrow(/no content/);
    } finally {
      bad.close();
      empty.close();
    }
  });

  it("gives up after the timeout", async () => {
    const hang = http.createServer(() => undefined);
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(hang.address() as AddressInfo).port}`;
    try {
      await expect(new OllamaClient(url, "m").generate({ system: "s", user: "u", schema: buildSchema(options), timeoutMs: 80 })).rejects.toThrow();
    } finally {
      hang.closeAllConnections();
      hang.close();
    }
  });
});
