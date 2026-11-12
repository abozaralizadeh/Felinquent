import type { ToyKind, TreatKind } from "./mess";
import type { Kind } from "./species";
import type { IntentName } from "./types";

export interface Personality {
  name: string;
  /** Used in the model prompt. Defaults to "house cat". */
  species?: string;
  /** Lines the character says for an intent, instead of the stock cat lines. */
  voice?: Partial<Record<IntentName, string[]>>;
  /** Its own toy, the one it brings out to play with. The yarn unless said. */
  toy?: ToyKind;
  /** The colour of the loose fur that flies off it in a shake (ADR-067); "none" for no fur at all. */
  fur?: string;
  /**
   * Which animal it acts like, when `species` doesn't say (a character from a package, ADR-069):
   * its ways, its own moves and what a click sets off. Without it the species name decides.
   */
  kind?: Kind;
  /** False: it never needs to pee or poop (a mascot from a package, ADR-069). */
  potty?: boolean;
  /**
   * How much it likes each move, over its kind's own weights (a package, ADR-069). 0 takes the move
   * off its menu (a mascot doesn't dig or claw); a click or a scene can still ask for it.
   */
  weights?: Partial<Record<IntentName, number>>;
  /** What each move means for this character, for the model (instead of MOVE_MEANING). */
  meanings?: Partial<Record<IntentName, string>>;
  /** Who it is, for the model, instead of "You are an animal, not a person: ..." (a package, ADR-069). */
  persona?: string;
  /** Its treat, when its kind's (TREAT_FOR in cat.ts) doesn't fit it: a mascot doesn't eat a dog biscuit. */
  treat?: TreatKind;
  /** All traits go from 0 to 1. */
  laziness: number;
  neediness: number;
  chaos: number;
  aloofness: number;
  curiosity: number;
}

export const ARCHETYPES: Record<string, Personality> = {
  loaf: { name: "Loaf", laziness: 0.9, neediness: 0.3, chaos: 0.3, aloofness: 0.4, curiosity: 0.3 },
  shadow: { name: "Shadow", laziness: 0.4, neediness: 0.9, chaos: 0.4, aloofness: 0.1, curiosity: 0.5 },
  gremlin: { name: "Gremlin", laziness: 0.2, neediness: 0.5, chaos: 0.95, aloofness: 0.4, curiosity: 0.8 },
  royal: { name: "Royal", laziness: 0.5, neediness: 0.4, chaos: 0.3, aloofness: 0.95, curiosity: 0.4 },
};

export const DEFAULT_PERSONALITY: Personality = {
  name: "Mix",
  laziness: 0.5,
  neediness: 0.5,
  chaos: 0.5,
  aloofness: 0.5,
  curiosity: 0.5,
};
