import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { check, mergeArt, pack, standIn } from "../tools/character";

/** tools/character.ts (docs/CHARACTERS.md): checks a character folder like the app, packs it, merges the art tables. */
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(16)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JSON_OK = { format: 1, id: "pickle", name: "Pickle", kind: "dog", weights: { nap: 4 } };

let dirs: string[] = [];
function folder(json: object, frames: string[], extra: Record<string, Buffer> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "fq-char-"));
  dirs.push(dir);
  writeFileSync(join(dir, "character.json"), JSON.stringify(json));
  mkdirSync(join(dir, "sprites"));
  for (const f of frames) writeFileSync(join(dir, "sprites", `${f}.webp`), WEBP);
  for (const [name, b] of Object.entries(extra)) writeFileSync(join(dir, name), b);
  return dir;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** The entries of a zip, read from its central directory (all stored, as the packer writes them). */
function unzip(b: Buffer): Map<string, Buffer> {
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(at + 10);
    const size = b.readUInt32LE(at + 20);
    const nameLen = b.readUInt16LE(at + 28);
    const extraLen = b.readUInt16LE(at + 30);
    const commentLen = b.readUInt16LE(at + 32);
    const local = b.readUInt32LE(at + 42);
    const name = b.toString("utf8", at + 46, at + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    out.set(name, method === 0 ? data : inflateRawSync(data));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("the character tool", () => {
  it("passes a folder with a sit and a stand, and lists what's missing", () => {
    const r = check(folder(JSON_OK, ["sit", "stand"]));
    expect(r.errors).toEqual([]);
    expect(r.frames).toEqual(["sit", "stand"]);
    expect(r.missing.get("sleep")).toBe("sit");
    expect(r.missing.get("gw00")).toBe("stand");
    expect(r.missing.has("sit")).toBe(false);
  });

  it("says what the app would refuse", () => {
    const bad = check(folder({ ...JSON_OK, id: "Bad Id" }, ["sit"], { "icon.png": Buffer.from("nope") }));
    expect(bad.errors.join("\n")).toMatch(/id must be/);
    expect(bad.errors.join("\n")).toMatch(/stand\.webp is missing/);
    expect(bad.errors.join("\n")).toMatch(/icon\.png isn't a PNG/);
    const notWebp = folder(JSON_OK, ["sit"]);
    writeFileSync(join(notWebp, "sprites", "stand.webp"), PNG);
    expect(check(notWebp).errors.join("\n")).toMatch(/stand\.webp isn't a WebP/);
  });

  it("notes move names the app doesn't know and files it leaves out", () => {
    const dir = folder({ ...JSON_OK, weights: { nap: 4, flyy: 2 } }, ["sit", "stand", "walk1"]);
    writeFileSync(join(dir, "sprites", "Big Sit.webp"), WEBP);
    const notes = check(dir).warnings.join("\n");
    expect(notes).toMatch(/weights\.flyy/);
    expect(notes).toMatch(/Big Sit\.webp is left out/);
    expect(notes).toMatch(/never played.*walk1/);
    expect(check(dir).files.has("sprites/walk1.webp")).toBe(false);
  });

  it("draws a missing in-between as its drawing, like the app", () => {
    const have = new Set(["sit", "stand", "groom1"]);
    expect(standIn("groom1t1", have)).toBe("groom1");
    expect(standIn("groom2t1", have)).toBe("sit");
    expect(standIn("tg_down", have)).toBe("stand");
  });

  it("packs a zip the app can read, with its own frames listed", () => {
    const dir = folder(JSON_OK, ["sit", "stand", "wag1", "wag2"], { "icon.png": PNG });
    const r = check(dir);
    expect(r.own).toEqual(["wag1", "wag2"]);
    const file = pack(r, join(dir, "Pickle.felinquent"));
    const zip = unzip(readFileSync(file));
    expect([...zip.keys()].sort()).toEqual(["character.json", "icon.png", "sprites/sit.webp", "sprites/stand.webp", "sprites/wag1.webp", "sprites/wag2.webp"]);
    expect(zip.get("sprites/sit.webp")?.equals(WEBP)).toBe(true);
    const json = JSON.parse(zip.get("character.json")?.toString() ?? "{}");
    expect(json.art.own).toEqual(["wag1", "wag2"]);
    expect(json.weights).toEqual({ nap: 4 });
  });

  it("puts the art tools' tables into character.json", () => {
    const dir = folder(JSON_OK, ["sit", "stand"]);
    const gaits = join(dir, "gaits.json");
    writeFileSync(gaits, `rigging...\n${JSON.stringify({ id: "sprites", strides: { walk: 91, trot: 130, run: 290.9 } })}\n`);
    const ground = join(dir, "ground.json");
    writeFileSync(ground, JSON.stringify({ pickle: { sit: 6 } }));
    const heads = join(dir, "heads.json");
    writeFileSync(heads, JSON.stringify({ pickle: { final: { sit: [1, 120, 60], stand: [0.98, 150, 70] } } }));
    mergeArt(dir, { gaits, ground, heads });
    const json = JSON.parse(readFileSync(join(dir, "character.json"), "utf8"));
    expect(json.art).toEqual({ gaits: { walk: 91, trot: 130, run: 290.9 }, ground: { sit: 6 }, heads: { sit: [1, 120, 60], stand: [0.98, 150, 70] } });
    expect(check(dir).errors).toEqual([]);
  });
});
