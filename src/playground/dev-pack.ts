import { registerCharacter } from "../core/characters";
import { parsePackage } from "../core/package";
import { registerSprites } from "./sprites";

/**
 * `?pack=<folder>` on the dev server: loads an unpacked character package (character.json and
 * sprites/) from any folder on this computer through Vite's /@fs/ path, so a package can be tried in
 * the playground without copying it into the page's public files (ADR-069). Only the dev server
 * serves /@fs/, so a build never has it. Returns the character's id, or null without ?pack.
 */
export async function loadDevPack(): Promise<string | null> {
  const dir = new URLSearchParams(location.search).get("pack");
  if (!dir) return null;
  const base = `/@fs${dir.replace(/\/+$/, "")}`;
  const res = await fetch(`${base}/character.json`);
  if (!res.ok) throw new Error(`?pack: no character.json in ${dir}`);
  const { character, art } = parsePackage(await res.json());
  registerCharacter(character);
  const { decal, ...rest } = art;
  registerSprites({ id: character.id, url: (key) => `${base}/sprites/${key}.webp`, ...rest, ...(decal ? { decal: { ...decal, url: `${base}/decal.png` } } : {}) });
  return character.id;
}
