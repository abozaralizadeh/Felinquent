import type { Personality } from "./personality";

/**
 * Characters the user can choose. Each one is a look (species, colors) and a personality
 * (how lazy, needy, chaotic, aloof and curious it is, and what it says). All art is drawn in code.
 * Same rules for all of them: the hard lines in docs/safety-and-privacy.md apply to every character.
 */
export type Species = "cat" | "fox" | "raccoon" | "dog" | "rabbit" | "squirrel";
export type Pattern = "stripes" | "none" | "fox" | "raccoon";

export interface Palette {
  base: string;
  belly: string;
  /** Stripes, ear tips, socks, the raccoon mask. */
  mark: string;
  line: string;
  /** Inside of the ears. */
  ear: string;
  eye: string;
  blush: string;
}

export interface Accessory {
  kind: "collar";
  color: string;
  /** A little gold bell or tag. */
  charm: boolean;
}

export interface Character {
  id: string;
  name: string;
  species: Species;
  pattern: Pattern;
  blurb: string;
  palette: Palette;
  accessory?: Accessory;
  /** Body size multiplier on top of the size setting. */
  size: number;
  personality: Personality;
}

const stock = (p: Omit<Personality, "voice"> & { voice?: Personality["voice"] }): Personality => p;

export const CHARACTERS: readonly Character[] = [
  {
    id: "tabby",
    name: "Tabby",
    species: "cat",
    pattern: "stripes",
    blurb: "The classic orange cat. Lazy, proud, and sits on your work.",
    palette: { base: "#f2a650", belly: "#fde7bf", mark: "#d9822a", line: "#6a3f26", ear: "#f8b4a8", eye: "#3b2417", blush: "#ff8f8f" },
    accessory: { kind: "collar", color: "#e0525a", charm: true },
    size: 1,
    personality: stock({ name: "Tabby", species: "cat", laziness: 0.6, neediness: 0.5, chaos: 0.5, aloofness: 0.5, curiosity: 0.5 }),
  },
  {
    id: "inky",
    name: "Inky",
    species: "cat",
    pattern: "none",
    blurb: "A black cat with yellow eyes who follows you and pretends it doesn't.",
    palette: { base: "#454459", belly: "#5f5e78", mark: "#2f2e3f", line: "#1c1b27", ear: "#e79aaa", eye: "#f5c431", blush: "#ff9aa8" },
    size: 1,
    personality: stock({
      name: "Inky",
      species: "black cat",
      laziness: 0.4,
      neediness: 0.9,
      chaos: 0.4,
      aloofness: 0.2,
      curiosity: 0.5,
      voice: { sit_on: ["i was never here. i am here."], meow: ["you looked lonely. i looked too."], follow: ["not following you. we're just going the same way."], nap: ["the dark is just a nap with better lighting."] },
    }),
  },
  {
    id: "pearl",
    name: "Pearl",
    species: "cat",
    pattern: "none",
    blurb: "A fluffy white cat. Royal, aloof, and very much above this.",
    palette: { base: "#f7f2ef", belly: "#ffffff", mark: "#e6d9d2", line: "#7c6a66", ear: "#fbc4c8", eye: "#4d94dc", blush: "#ffa9b3" },
    accessory: { kind: "collar", color: "#8a6fd1", charm: true },
    size: 1.02,
    personality: stock({
      name: "Pearl",
      species: "white cat",
      laziness: 0.5,
      neediness: 0.3,
      chaos: 0.3,
      aloofness: 0.95,
      curiosity: 0.4,
      voice: { ignore: ["you may speak. i may not answer."], sit_on: ["this window is acceptable. i will allow it."], cross: ["make way."], headbutt: ["you may pet me. briefly."] },
    }),
  },
  {
    id: "mochi",
    name: "Mochi",
    species: "fox",
    pattern: "fox",
    blurb: "A cream-colored fox. Curious about everything, trouble about most of it.",
    palette: { base: "#f6dcae", belly: "#fff7e6", mark: "#c98b55", line: "#7a4b2c", ear: "#fbd0c0", eye: "#43281a", blush: "#ff9c8a" },
    size: 1.02,
    personality: stock({
      name: "Mochi",
      species: "fox",
      laziness: 0.3,
      neediness: 0.6,
      chaos: 0.75,
      aloofness: 0.35,
      curiosity: 0.95,
      voice: { peek: ["i can see everything from here. everything."], tour: ["new window. new den."], stalk: ["pounce practice. you are the mouse."], gift: ["i found a shiny. it's yours. now give it back."], sit_on: ["i have decided this is my den now."] },
    }),
  },
  {
    id: "bandit",
    name: "Bandit",
    species: "raccoon",
    pattern: "raccoon",
    blurb: "A raccoon in a mask. Takes things, then acts surprised.",
    palette: { base: "#aaa6b4", belly: "#e8e4ee", mark: "#3f3b4b", line: "#34303f", ear: "#d9c9d6", eye: "#241f2b", blush: "#ff9fb0" },
    size: 1.04,
    personality: stock({
      name: "Bandit",
      species: "raccoon",
      laziness: 0.35,
      neediness: 0.4,
      chaos: 0.9,
      aloofness: 0.45,
      curiosity: 0.9,
      voice: { gift: ["found this. it's mine now. you can have it."], knock_toy: ["it was already falling. i helped."], sit_on: ["i'm just borrowing this window."], zoomies: ["night shift."], chatter: ["something shiny is out there."] },
    }),
  },
  {
    id: "biscuit",
    name: "Biscuit",
    species: "dog",
    pattern: "none",
    blurb: "A golden pup who is thrilled you exist. Hard to shoo, impossible to stay mad at.",
    palette: { base: "#e6ad63", belly: "#fae6c2", mark: "#bf7f37", line: "#6c4220", ear: "#f6c2a0", eye: "#33200f", blush: "#ff8f86" },
    accessory: { kind: "collar", color: "#3d7be0", charm: true },
    size: 1.05,
    personality: stock({
      name: "Biscuit",
      species: "puppy",
      laziness: 0.3,
      neediness: 0.98,
      chaos: 0.4,
      aloofness: 0.0,
      curiosity: 0.7,
      voice: { follow: ["you're back!! you were gone for a minute!!"], headbutt: ["hi!! hi hi hi!!"], meow: ["woof. (that means i love you)"], sit_on: ["i'll keep this one warm for you!"], nap: ["five minutes. then more fun."] },
    }),
  },
  {
    id: "chili",
    name: "Chili",
    species: "dog",
    pattern: "none",
    blurb: "A tiny black-and-tan chihuahua. Shivers, yaps at everything, and follows you like it's its job.",
    palette: { base: "#3b3439", belly: "#e3a464", mark: "#d48a4a", line: "#1f1a1e", ear: "#f2a7a0", eye: "#3a2216", blush: "#ff8f9a" },
    accessory: { kind: "collar", color: "#ff6fa5", charm: true },
    size: 0.82,
    personality: stock({
      name: "Chili",
      species: "chihuahua",
      laziness: 0.3,
      neediness: 0.9,
      chaos: 0.6,
      aloofness: 0.1,
      curiosity: 0.6,
      voice: { follow: ["wait for me!! wait!!"], meow: ["YAP. that was important."], howl: ["yap yap yap. (i was right.)"], sit_on: ["this window is mine. i will fight you for it."], nap: ["i'm not shaking. this is how i nap."], spook: ["WHAT WAS THAT. was it you."] },
    }),
  },
  {
    id: "clover",
    name: "Clover",
    species: "rabbit",
    pattern: "none",
    blurb: "A brown bunny with a cotton tail. Quiet, easily startled, and does happy little jumps when nobody's looking.",
    palette: { base: "#c79a6c", belly: "#f6e7d3", mark: "#a77b52", line: "#5d3f29", ear: "#f6b3b6", eye: "#3a2418", blush: "#ff9aa2" },
    size: 0.95,
    personality: stock({
      name: "Clover",
      species: "rabbit",
      laziness: 0.5,
      neediness: 0.45,
      chaos: 0.35,
      aloofness: 0.55,
      curiosity: 0.6,
      voice: { bounce: ["binky. you didn't see that."], dig: ["digging a little room. just for me."], sniff: ["sniff. sniff. something changed here."], spook: ["nope. nope. i'm under something."], nap: ["eyes open. technically."] },
    }),
  },
  {
    id: "hazel",
    name: "Hazel",
    species: "squirrel",
    pattern: "none",
    blurb: "A red squirrel with a huge tail. Can't sit still, hides things, and tells you off about it.",
    palette: { base: "#cf6a2c", belly: "#fbe6cf", mark: "#a94c1a", line: "#5e2a10", ear: "#f3b19a", eye: "#2f1a10", blush: "#ff9a86" },
    size: 0.92,
    personality: stock({
      name: "Hazel",
      species: "squirrel",
      laziness: 0.2,
      neediness: 0.4,
      chaos: 0.85,
      aloofness: 0.45,
      curiosity: 0.95,
      voice: { chatter: ["chk chk chk. i'm telling you off."], dig: ["burying this. forget you saw it."], zoomies: ["up. down. up. why not."], peek: ["i see you. you don't see me."], gift: ["found it. it's an acorn now."] },
    }),
  },
];

export const DEFAULT_CHARACTER_ID = "tabby";

export function characterById(id: string | undefined): Character {
  return CHARACTERS.find((c) => c.id === id) ?? (CHARACTERS[0] as Character);
}
