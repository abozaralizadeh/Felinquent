// Checks a character folder the way the app does, and packs it into a .felinquent file.
// See docs/CHARACTERS.md for the whole story.
//
//   npm run character -- check <folder>              is it ready? what's still missing?
//   npm run character -- pack <folder> [out]         check, then write <Name>.felinquent
//   npm run character -- art <folder> [--gaits f] [--ground f] [--heads f]
//                                                    put the art tools' tables into character.json
//   npm run character -- frames [kind]               every drawing the app plays, by sheet
//   npm run character -- moves                       the move names weights and meanings take
//
// The folder holds character.json and sprites/<frame>.webp, and maybe icon.png and decal.png.
// `--sprites <dir>` takes the drawings from another folder (where the art tools wrote them).
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import { parsePackage, type Package } from "../src/core/package";
import { MOVE_MEANING } from "../src/core/summary";
import { DRAWN_SHEETS, OWN_DRAWN, OWN_KEYS, OWN_LIKE, SPRITE_KEYS } from "../src/playground/sprites";

/** The app's limits (src-tauri/src/characters.rs). */
export const LIMITS = { files: 4000, file: 4 << 20, total: 400 << 20 };
const KEY = /^[a-z0-9_]{1,32}$/;
const isWebp = (b: Buffer): boolean => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
const isPng = (b: Buffer): boolean => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const DRAWN = new Set<string>(Object.values(DRAWN_SHEETS).flat());

export interface Report {
  pkg: Package | null;
  /** character.json as written, to pack it with the own frames filled in. */
  json: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
  /** What goes in the package: its path in the zip, and the file on disk. */
  files: Map<string, string>;
  frames: string[];
  /** Frames of this kind's own moves that are here (art.own lists them for the app). */
  own: string[];
  /** Frames the app plays that this package lacks, with the drawing each one is drawn as instead. */
  missing: Map<string, string>;
}

/** What a missing frame is drawn as (frameKey in src/playground/sprites.ts). */
export function standIn(key: string, have: Set<string>): string {
  const from = /^(.+)[a-z]\d$/.exec(key)?.[1];
  if (from && have.has(from)) return from;
  return /^(g[wtr]\d|t[gqb]_|turn_s|stand|walk|run|trot)/.test(key) ? "stand" : "sit";
}

export function check(folder: string, spritesDir?: string): Report {
  const dir = resolve(folder);
  const sprites = resolve(spritesDir ?? join(dir, "sprites"));
  const r: Report = { pkg: null, json: null, errors: [], warnings: [], files: new Map(), frames: [], own: [], missing: new Map() };
  try {
    r.json = JSON.parse(readFileSync(join(dir, "character.json"), "utf8")) as Record<string, unknown>;
  } catch (e) {
    r.errors.push(`character.json: ${e instanceof Error ? e.message : String(e)}`);
    return r;
  }
  try {
    r.pkg = parsePackage(r.json);
  } catch (e) {
    r.errors.push(`character.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  r.files.set("character.json", join(dir, "character.json"));
  const moves = new Set(Object.keys(MOVE_MEANING));
  for (const field of ["weights", "meanings", "voice"] as const) {
    const v = r.json[field];
    if (typeof v === "object" && v !== null) {
      for (const k of Object.keys(v)) if (!moves.has(k)) r.warnings.push(`${field}.${k} isn't a move the app knows, so it does nothing (npm run character -- moves)`);
    }
  }

  let total = statSync(join(dir, "character.json")).size;
  for (const name of readdirSync(dir)) {
    if (name === "character.json" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (name === "icon.png" || name === "decal.png") {
      const b = readFileSync(path);
      if (!isPng(b)) r.errors.push(`${name} isn't a PNG`);
      else if (b.length > LIMITS.file) r.errors.push(`${name} is over 4 MB`);
      else {
        total += b.length;
        r.files.set(name, path);
      }
    }
  }
  let names: string[] = [];
  try {
    names = readdirSync(sprites).filter((n) => !n.startsWith("."));
  } catch {
    r.errors.push(`there's no ${spritesDir ? spritesDir : "sprites"} folder`);
  }
  for (const name of names.sort()) {
    const key = name.endsWith(".webp") ? name.slice(0, -5) : null;
    if (key === null || !KEY.test(key)) {
      r.warnings.push(`sprites/${name} is left out: frame files are <name>.webp, the name in lowercase letters, digits and _`);
      continue;
    }
    const path = join(sprites, name);
    const b = readFileSync(path);
    if (!isWebp(b)) r.errors.push(`sprites/${name} isn't a WebP file`);
    else if (b.length > LIMITS.file) r.errors.push(`sprites/${name} is over 4 MB`);
    else {
      total += b.length;
      r.files.set(`sprites/${name}`, path);
      r.frames.push(key);
    }
  }
  const have = new Set(r.frames);
  for (const need of ["sit", "stand"]) if (!have.has(need)) r.errors.push(`sprites/${need}.webp is missing: every character needs at least a sitting and a standing drawing`);
  if (r.files.size > LIMITS.files) r.errors.push(`${r.files.size} files, the app takes ${LIMITS.files} at most`);
  if (total > LIMITS.total) r.errors.push(`${Math.round(total / 2 ** 20)} MB in all, the app takes 400 MB at most`);

  const kind = r.pkg?.character.personality.kind ?? "cat";
  const like = OWN_LIKE[kind];
  const ownKeys = new Set<string>(like ? OWN_KEYS[like] : []);
  r.own = r.frames.filter((k) => ownKeys.has(k));
  const art = r.pkg?.art;
  for (const k of art?.own ?? []) if (!have.has(k)) r.warnings.push(`art.own lists ${k}, but there's no sprites/${k}.webp`);
  if (art?.decal && !r.files.has("decal.png")) r.errors.push("art.decal is set but there's no decal.png");
  for (const k of SPRITE_KEYS) if (!have.has(k)) r.missing.set(k, standIn(k, have));
  const played = new Set<string>([...SPRITE_KEYS, ...ownKeys, ...(art?.own ?? [])]);
  // Drawings the app never plays (art tool input like walk1..walk8 for biped-gait.py) stay out of the package.
  const unused = r.frames.filter((k) => !played.has(k));
  for (const k of unused) r.files.delete(`sprites/${k}.webp`);
  if (unused.length) r.warnings.push(`never played, so pack leaves them out: ${unused.slice(0, 12).join(", ")}${unused.length > 12 ? ` and ${unused.length - 12} more` : ""}`);
  return r;
}

/** character.json as it goes in the package: art.own filled in from the frames when it isn't set. */
function packedJson(r: Report): Buffer {
  const json = { ...r.json } as Record<string, unknown> & { art?: Record<string, unknown> };
  if (r.own.length && !json.art?.own) json.art = { ...json.art, own: r.own };
  return Buffer.from(JSON.stringify(json, null, 1));
}

/** A zip of the files as they are (method 0, "stored"): the drawings are compressed already. */
export function zipStored(files: Map<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // 1 Jan 2026 at midnight in DOS time, so the same files always make the same zip.
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, from] of files) {
    const data = typeof from === "string" ? readFileSync(from) : from;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** Writes the package; returns where. */
export function pack(r: Report, out: string): string {
  const files = new Map<string, string | Buffer>(r.files);
  files.set("character.json", packedJson(r));
  const file = resolve(out);
  writeFileSync(file, zipStored(files));
  return file;
}

/** A table from one of the art tools: its row for this character, or its only row. */
function rowOf(path: string, id: string): unknown {
  const text = readFileSync(path, "utf8").trim();
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // A gait tool may print other lines first; its JSON is the last one.
    v = JSON.parse(text.split("\n").at(-1) ?? "") as Record<string, unknown>;
  }
  if ("strides" in v) return v.strides;
  const keys = Object.keys(v);
  const row = (id in v ? v[id] : keys.length === 1 ? v[keys[0] as string] : v) as Record<string, unknown>;
  return row && typeof row === "object" && "final" in row ? row.final : row;
}

/** Puts the tables into character.json's art, and art.own from the frames that are here. */
export function mergeArt(folder: string, tables: { gaits?: string; ground?: string; heads?: string }, spritesDir?: string): Record<string, unknown> {
  const r = check(folder, spritesDir);
  if (!r.json) throw new Error(r.errors.join("; "));
  const id = String(r.json.id ?? "");
  const art = { ...((r.json.art as Record<string, unknown> | undefined) ?? {}) };
  if (r.own.length) art.own = r.own;
  if (tables.gaits) art.gaits = rowOf(tables.gaits, id);
  if (tables.ground) art.ground = rowOf(tables.ground, id);
  if (tables.heads) art.heads = rowOf(tables.heads, id);
  const json = { ...r.json, art };
  parsePackage(json);
  writeFileSync(join(resolve(folder), "character.json"), `${JSON.stringify(json, null, 1)}\n`);
  return art;
}

function print(r: Report): void {
  const c = r.pkg?.character;
  if (c) console.log(`${c.name} (${c.id}), acts like a ${c.personality.kind}, ${r.frames.length} frames`);
  for (const w of r.warnings) console.log(`  note: ${w}`);
  if (r.frames.length) {
    const drawings = [...r.missing.keys()].filter((k) => DRAWN.has(k));
    const made = r.missing.size - drawings.length;
    console.log(`  ${SPRITE_KEYS.length - r.missing.size} of the ${SPRITE_KEYS.length} frames the app plays are here.`);
    if (drawings.length) {
      console.log(`  ${drawings.length} drawings are missing. Each one is drawn as another drawing instead (mostly sit or stand), so those moves look still:`);
      for (const [sheet, keys] of Object.entries(DRAWN_SHEETS)) {
        const left = keys.filter((k) => r.missing.has(k));
        if (left.length) console.log(`    ${sheet.padEnd(10)} ${left.length === keys.length ? "all of it" : left.join(" ")}`);
      }
    }
    if (made) console.log(`  ${made} made frames are missing (in-betweens, licks, the gaits): the art tools make them, else they show the drawing they come from.`);
    const like = OWN_LIKE[c?.personality.kind ?? "cat"];
    if (like) {
      const ownLeft = (OWN_DRAWN[c?.personality.kind ?? "cat"] ?? []).filter((k) => !r.frames.includes(k));
      if (ownLeft.length) console.log(`  its kind's own moves: ${ownLeft.join(" ")} not drawn (it does those moves in a shared pose instead).`);
    }
    if (r.own.length && !r.pkg?.art.own) console.log(`  ${r.own.length} own-move frames are here: pack puts them in art.own for you.`);
  }
  for (const e of r.errors) console.log(`  error: ${e}`);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function main(): void {
  const args = process.argv.slice(2);
  const spritesDir = opt(args, "--sprites");
  const tables = { gaits: opt(args, "--gaits"), ground: opt(args, "--ground"), heads: opt(args, "--heads") };
  const [cmd, folder, out] = args;
  if (cmd === "moves") {
    for (const [k, v] of Object.entries(MOVE_MEANING)) console.log(`${k.padEnd(16)} ${v}`);
    return;
  }
  if (cmd === "frames") {
    for (const [sheet, keys] of Object.entries(DRAWN_SHEETS)) console.log(`${sheet.padEnd(10)} ${keys.join(" ")}`);
    const kind = folder ?? "";
    if (OWN_DRAWN[kind]?.length) console.log(`${`own (${kind})`.padEnd(10)} ${OWN_DRAWN[kind]?.join(" ")}`);
    else if (!kind) console.log(`own       per kind: npm run character -- frames dog|fox|raccoon|rabbit|squirrel`);
    return;
  }
  if (!["check", "pack", "art"].includes(cmd ?? "") || !folder) {
    console.log("usage: npm run character -- check <folder> | pack <folder> [out.felinquent] | art <folder> [--gaits f] [--ground f] [--heads f] | frames [kind] | moves");
    console.log("       add --sprites <dir> to take the drawings from another folder");
    process.exit(2);
  }
  if (cmd === "art") {
    const art = mergeArt(folder, tables, spritesDir);
    console.log(`character.json: art now has ${Object.keys(art).join(", ") || "nothing"}`);
    return;
  }
  const r = check(folder, spritesDir);
  print(r);
  if (r.errors.length || !r.pkg) {
    console.log("Not ready: fix the errors above.");
    process.exit(1);
  }
  if (cmd === "check") {
    console.log("Ready to pack.");
    return;
  }
  const file = pack(r, out ?? `${r.pkg.character.name.replace(/[^\w.-]+/g, "-")}.felinquent`);
  console.log(`Wrote ${file} (${(statSync(file).size / 2 ** 20).toFixed(1)} MB). In the app: Character > Add a character…`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) main();
