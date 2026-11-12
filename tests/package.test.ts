import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { allCharacters, CHARACTERS, characterById, forgetCharacter, registerCharacter } from "../src/core/characters";
import { parsePackage } from "../src/core/package";
import { instinctFor, instinctOf, OWN_INTENTS } from "../src/core/species";
import { buildPlanPrompt, buildPlanSummary } from "../src/core/summary";
import { simulate } from "../tools/month-sim";

/** Character packages (ADR-069): character.json read and checked, the registry, a mascot that acts like a dog. */
const GOOD = {
  format: 1,
  id: "mascot",
  name: "Mascot",
  blurb: "A little round mascot.",
  kind: "dog",
  species: "little round mascot in a red cap",
  potty: false,
  toy: "tennis",
  color: "#e60000",
  size: 1,
  traits: { laziness: 0.4, neediness: 0.8, chaos: 0.3, aloofness: 0.1, curiosity: 0.8 },
  voice: { meow: ["hello!"], nap: ["five more minutes."], "bad key!": ["x"] },
  art: { own: ["dshake1", "wag1"], gaits: { walk: 80, trot: 100, run: 140 }, ground: { sit: 3 }, heads: { sit: [1, 10, 20] } },
};

describe("character packages (ADR-069)", () => {
  it("reads a good character.json into a character that acts like its kind", () => {
    const { character, art } = parsePackage(GOOD);
    expect(character.id).toBe("mascot");
    expect(character.pack).toBe(true);
    expect(character.personality.kind).toBe("dog");
    expect(character.personality.species).toBe("little round mascot in a red cap");
    expect(character.personality.voice?.meow).toEqual(["hello!"]);
    expect(Object.keys(character.personality.voice ?? {})).not.toContain("bad key!");
    // Its species name says nothing about a dog, but its kind does: a dog's ways and own moves.
    expect(instinctFor(character.personality.species).kind).toBe("cat");
    const ins = instinctOf(character.personality);
    expect(ins.kind).toBe("dog");
    expect(ins.own).toEqual(instinctFor("puppy").own);
    expect([...(ins.own ?? [])].every((i) => OWN_INTENTS.has(i))).toBe(true);
    // potty: false, so the needs never fill.
    expect(ins.potty).toEqual([0, 0]);
    expect(art.gaits).toEqual({ walk: 80, trot: 100, run: 140 });
    expect(art.heads?.sit).toEqual([1, 10, 20]);
  });

  it("says what is wrong with a bad one", () => {
    const bad: [object, string][] = [
      [{ ...GOOD, format: 2 }, "format"],
      [{ ...GOOD, id: "Mascot" }, "id"],
      [{ ...GOOD, id: "../x" }, "id"],
      [{ ...GOOD, id: "tabby" }, "built-in"],
      [{ ...GOOD, name: "" }, "name"],
      [{ ...GOOD, name: "x".repeat(30) }, "name"],
      [{ ...GOOD, kind: "dragon" }, "kind"],
      [{ ...GOOD, toy: "chainsaw" }, "toy"],
      [{ ...GOOD, color: "red" }, "color"],
      [{ ...GOOD, size: 9 }, "size"],
      [{ ...GOOD, traits: { chaos: "lots" } }, "chaos"],
      [{ ...GOOD, art: { own: ["../x"] } }, "art.own"],
      [{ ...GOOD, art: { gaits: { walk: 1 } } }, "art.gaits"],
      [{ ...GOOD, weights: { dig: "never" } }, "weights.dig"],
      [{ ...GOOD, meanings: { groom: "x".repeat(90) } }, "meanings.groom"],
      [{ ...GOOD, persona: 7 }, "persona"],
      [{ ...GOOD, fur: "fluffy" }, "fur"],
      [{ ...GOOD, treat: "cake" }, "treat"],
    ];
    for (const [json, word] of bad) expect(() => parsePackage(json), word).toThrow(new RegExp(word.replace(".", "\\.")));
  });

  it("adds, finds, swaps and forgets package characters, never over a built-in one", () => {
    const { character } = parsePackage(GOOD);
    expect(registerCharacter(character)).toBe(true);
    expect(characterById("mascot").name).toBe("Mascot");
    expect(allCharacters().length).toBe(CHARACTERS.length + 1);
    expect(registerCharacter({ ...character, name: "Mascot 2" })).toBe(true);
    expect(allCharacters().length).toBe(CHARACTERS.length + 1);
    expect(characterById("mascot").name).toBe("Mascot 2");
    expect(registerCharacter({ ...character, id: "tabby" })).toBe(false);
    expect(characterById("tabby").pack).toBeUndefined();
    forgetCharacter("mascot");
    expect(characterById("mascot").id).toBe("tabby");
    expect(allCharacters()).toBe(CHARACTERS);
  });

  it("a mascot with potty off never needs to go, even at gremlin, and still lives a full day", async () => {
    const { character } = parsePackage(GOOD);
    const r = await simulate({ days: 2, seed: 4, step: 3, chaos: "gremlin", personality: character.personality });
    expect((r.counts.get("pee") ?? 0) + (r.counts.get("poop") ?? 0)).toBe(0);
    expect(r.counts.size).toBeGreaterThan(8);
    // A dog's own move shows up in its day.
    expect([...r.counts.keys()].some((k) => k === "shake_off" || k === "chew")).toBe(true);
  }, 60_000);

  it("a mascot has its own ways: moves it never does, what its moves mean and who it is", async () => {
    const MASCOT = {
      ...GOOD,
      fur: "none",
      persona: "You are a tiny round mascot, not an animal.",
      weights: { dig: 0, claw: 0, hunt: 0, stash_toy: 0, groom: 9, "bad key!": 1 },
      meanings: { groom: "check your phone" },
      treat: "strawberry",
    };
    const p = parsePackage(MASCOT).character.personality;
    expect(p.fur).toBe("none");
    expect(p.treat).toBe("strawberry");
    expect(p.weights).toEqual({ dig: 0, claw: 0, hunt: 0, stash_toy: 0, groom: 5 });
    const ins = instinctOf(p);
    expect(ins.weights.dig).toBe(0);
    expect(ins.weights.groom).toBe(5);
    // The rest of its kind's ways are kept.
    expect(ins.weights.fetch).toBe(instinctFor("puppy").weights.fetch);
    // The model is told who it is, and never that it is an animal.
    const prompt = buildPlanPrompt(p, 60);
    expect(prompt).toContain("tiny round mascot");
    expect(prompt).not.toContain("You are an animal");
    expect(prompt).toContain("You never help.");
    // A whole gremlin day: it never digs, claws, hunts or buries, and checks its phone a lot.
    const r = await simulate({ days: 2, seed: 7, step: 3, chaos: "gremlin", personality: p });
    for (const never of ["dig", "claw", "hunt", "stash_toy"]) expect(r.counts.get(never) ?? 0, never).toBe(0);
    expect(r.counts.get("groom") ?? 0).toBeGreaterThan(0);
  }, 60_000);

  it("the plan request carries a package's own meanings for its moves", () => {
    const p = parsePackage({ ...GOOD, meanings: { groom: "check your phone" } }).character.personality;
    const s = buildPlanSummary({
      world: { nowMs: Date.UTC(2026, 10, 12, 10), screen: { w: 1440, h: 900 }, windows: [], cursor: { x: 0, y: 0 }, idleSec: 0, inMeeting: false, fullscreen: false, frontApp: null } as never,
      needs: { energy: 0.5, boredom: 0.5, affection: 0.5, trust: 50 } as never,
      settings: { chaos: "normal" } as never,
      bouts: [{ kind: "rest", weight: 1, options: [{ intent: "groom", score: 1 } as never] }],
      meanings: p.meanings,
      memory: [],
      happened: [],
      catWhere: "on the floor",
      catDoing: "sitting",
      lastBout: null,
      recent: [],
      busyForMin: 0,
    });
    expect(JSON.stringify(s.bouts)).toContain("check your phone");
  });

  it("the app lists package characters in its menus and reads them from its own folder only", () => {
    const rust = fs.readFileSync("src-tauri/src/main.rs", "utf8");
    expect(rust).toContain('"addchar" => characters::pick_and_add(app)');
    expect(rust).toContain("characters::read_characters");
    const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(conf.app.security.assetProtocol.scope).toContain("$APPCONFIG/characters/**");
    const page = fs.readFileSync("src/playground/overlay.ts", "utf8");
    expect(page).toContain('msg.startsWith("packs:")');
    expect(page).toContain("parsePackage(JSON.parse(it.json))");
  });
});
