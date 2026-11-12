import { CHARACTERS, type Character, type Palette, type Species } from "./characters";
import { TOY_KINDS, TREAT_KINDS, type ToyKind, type TreatKind } from "./mess";
import type { Personality } from "./personality";
import { INSTINCTS, type Kind } from "./species";
import type { IntentName } from "./types";

/**
 * A character package (ADR-069): a `.felinquent` zip with `character.json`, the drawings in
 * `sprites/<key>.webp` and an optional `icon.png`. Data only, nothing in it runs. The app unpacks it
 * into its own folder; this reads and checks `character.json`. Anything unknown is left out, and a
 * bad value is an error that says what is wrong, so a package made by hand is easy to fix.
 */
export const PACKAGE_FORMAT = 1;

/** Ids: lowercase letters, digits, `-` and `_`, 2 to 24 long, starting with a letter. */
export const PACKAGE_ID = /^[a-z][a-z0-9_-]{1,23}$/;

/** The measured tables the built-in characters have in generated files (gaits, ground, heads). */
export interface PackageArt {
  own?: string[];
  gaits?: { walk: number; trot: number; run: number };
  ground?: Record<string, number>;
  heads?: Record<string, readonly [number | null, number | null, number | null]>;
  decal?: PackageDecal;
}

/**
 * A badge printed on the drawings at draw time (a mascot's logo on its cap, ADR-069), from the
 * package's `decal.png`, so it reads the right way round when a frame is drawn mirrored. Per frame
 * file: where the plain disc it goes on is, [centre x, centre y, half long axis, half short axis,
 * angle in radians] in the file's pixels, and the colour to print it in.
 */
export interface PackageDecal {
  /** The badge's width over the disc's long axis. */
  size: number;
  /** Where the badge's middle is from the disc's middle, along its long and short axes, in half axes. */
  dx: number;
  dy: number;
  frames: Record<string, readonly [number, number, number, number, number, string]>;
}

export interface Package {
  character: Character;
  art: PackageArt;
}

const KEY = /^[a-z0-9_]{1,32}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function text(v: unknown, what: string, max: number, need = true): string | undefined {
  if (v === undefined && !need) return undefined;
  if (typeof v !== "string" || !v.trim()) throw new Error(`${what} must be some text`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${what} is longer than ${max} characters`);
  return t;
}

function unit(v: unknown, what: string): number {
  if (!num(v)) throw new Error(`traits.${what} must be a number from 0 to 1`);
  return Math.max(0, Math.min(1, v));
}

/** A palette for the drawn-in-code fallback, from the one colour given. */
function paletteFrom(c: string): Palette {
  return { base: c, belly: "#ffffff", mark: c, line: "#2a2a2a", ear: c, eye: "#1a1a1a", blush: "#ff9aa8" };
}

/** Reads `character.json`. Throws an Error that says what is wrong. */
export function parsePackage(json: unknown): Package {
  if (!isObj(json)) throw new Error("character.json must be an object");
  if (json.format !== PACKAGE_FORMAT) throw new Error(`format must be ${PACKAGE_FORMAT}`);
  const id = json.id;
  if (typeof id !== "string" || !PACKAGE_ID.test(id)) throw new Error("id must be 2 to 24 lowercase letters, digits, - or _, starting with a letter");
  if (CHARACTERS.some((c) => c.id === id)) throw new Error(`id ${id} is a built-in character`);
  const name = text(json.name, "name", 24) as string;
  const blurb = text(json.blurb, "blurb", 160, false) ?? `${name}, from a character package.`;
  const kind = json.kind ?? "cat";
  if (typeof kind !== "string" || !(kind in INSTINCTS)) throw new Error(`kind must be one of ${Object.keys(INSTINCTS).join(", ")}`);
  const species = text(json.species, "species", 60, false);
  const toy = json.toy ?? "tennis";
  if (!(TOY_KINDS as readonly unknown[]).includes(toy)) throw new Error(`toy must be one of ${TOY_KINDS.join(", ")}`);
  const color = json.color ?? "#e08a3c";
  if (typeof color !== "string" || !COLOR.test(color)) throw new Error("color must look like #e60000");
  const size = json.size ?? 1;
  if (!num(size) || size < 0.6 || size > 1.6) throw new Error("size must be a number from 0.6 to 1.6");
  const tr = isObj(json.traits) ? json.traits : {};
  const voice: Partial<Record<IntentName, string[]>> = {};
  if (json.voice !== undefined) {
    if (!isObj(json.voice)) throw new Error("voice must be an object of lists of lines");
    for (const [k, lines] of Object.entries(json.voice)) {
      if (!KEY.test(k) || !Array.isArray(lines)) continue;
      const ok = lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0 && l.length <= 120).slice(0, 12);
      if (ok.length) voice[k as IntentName] = ok;
    }
  }
  // Its own ways over its kind's (a mascot doesn't dig): 0 to 5 per move, 0 is never on its own.
  const weights: Partial<Record<IntentName, number>> = {};
  if (json.weights !== undefined) {
    if (!isObj(json.weights)) throw new Error("weights must be an object of move names and numbers");
    for (const [k, w] of Object.entries(json.weights)) {
      if (!KEY.test(k)) continue;
      if (!num(w)) throw new Error(`weights.${k} must be a number from 0 to 5`);
      weights[k as IntentName] = Math.max(0, Math.min(5, w));
    }
  }
  // What a move means for it, for the model ("groom": "check your phone").
  const meanings: Partial<Record<IntentName, string>> = {};
  if (json.meanings !== undefined) {
    if (!isObj(json.meanings)) throw new Error("meanings must be an object of move names and short texts");
    for (const [k, m] of Object.entries(json.meanings)) if (KEY.test(k)) meanings[k as IntentName] = text(m, `meanings.${k}`, 80) as string;
  }
  const persona = text(json.persona, "persona", 240, false);
  const treat = json.treat;
  if (treat !== undefined && !(TREAT_KINDS as readonly unknown[]).includes(treat)) throw new Error(`treat must be one of ${TREAT_KINDS.join(", ")}`);
  const fur = json.fur ?? color;
  if (typeof fur !== "string" || !(fur === "none" || COLOR.test(fur))) throw new Error('fur must be "none" or look like #e60000');
  const personality: Personality = {
    name,
    species: species ?? kind,
    kind: kind as Kind,
    toy: toy as ToyKind,
    fur,
    laziness: unit(tr.laziness ?? 0.5, "laziness"),
    neediness: unit(tr.neediness ?? 0.5, "neediness"),
    chaos: unit(tr.chaos ?? 0.5, "chaos"),
    aloofness: unit(tr.aloofness ?? 0.5, "aloofness"),
    curiosity: unit(tr.curiosity ?? 0.5, "curiosity"),
    ...(json.potty === false ? { potty: false } : {}),
    ...(Object.keys(voice).length ? { voice } : {}),
    ...(Object.keys(weights).length ? { weights } : {}),
    ...(Object.keys(meanings).length ? { meanings } : {}),
    ...(persona ? { persona } : {}),
    ...(treat !== undefined ? { treat: treat as TreatKind } : {}),
  };
  const character: Character = {
    id,
    name,
    species: kind as Species,
    pattern: "none",
    blurb,
    palette: paletteFrom(color),
    size,
    personality,
    pack: true,
  };
  return { character, art: parseArt(json.art) };
}

function parseArt(v: unknown): PackageArt {
  if (v === undefined) return {};
  if (!isObj(v)) throw new Error("art must be an object");
  const art: PackageArt = {};
  if (v.own !== undefined) {
    if (!Array.isArray(v.own) || !v.own.every((k) => typeof k === "string" && KEY.test(k))) throw new Error("art.own must be a list of frame names");
    art.own = [...new Set(v.own as string[])].slice(0, 600);
  }
  if (v.gaits !== undefined) {
    const g = v.gaits;
    if (!isObj(g) || !num(g.walk) || !num(g.trot) || !num(g.run)) throw new Error("art.gaits needs walk, trot and run strides");
    art.gaits = { walk: g.walk, trot: g.trot, run: g.run };
  }
  if (v.ground !== undefined) {
    if (!isObj(v.ground)) throw new Error("art.ground must map frame names to numbers");
    art.ground = {};
    for (const [k, n] of Object.entries(v.ground)) if (KEY.test(k) && num(n)) art.ground[k] = n;
  }
  if (v.heads !== undefined) {
    if (!isObj(v.heads)) throw new Error("art.heads must map frame names to [size, mouth x, mouth y]");
    art.heads = {};
    const n = (x: unknown): number | null => (num(x) ? x : null);
    for (const [k, h] of Object.entries(v.heads)) if (KEY.test(k) && Array.isArray(h) && h.length === 3) art.heads[k] = [n(h[0]), n(h[1]), n(h[2])];
  }
  if (v.decal !== undefined) {
    const d = v.decal;
    if (!isObj(d) || !isObj(d.frames)) throw new Error("art.decal needs frames: the disc in each frame and a colour");
    const size = d.size ?? 0.5;
    const dx = d.dx ?? 0;
    const dy = d.dy ?? 0;
    if (!num(size) || size < 0.1 || size > 1.5 || !num(dx) || !num(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1) throw new Error("art.decal size is 0.1 to 1.5, dx and dy -1 to 1");
    const frames: PackageDecal["frames"] = {};
    for (const [k, f] of Object.entries(d.frames)) {
      if (!KEY.test(k) || !Array.isArray(f) || f.length !== 6) continue;
      const [cx, cy, a, b, ang, color] = f as unknown[];
      if (![cx, cy, a, b, ang].every(num) || (a as number) <= 0 || (b as number) <= 0 || typeof color !== "string" || !COLOR.test(color)) continue;
      frames[k] = [cx as number, cy as number, a as number, b as number, ang as number, color];
    }
    art.decal = { size, dx, dy, frames };
  }
  return art;
}
