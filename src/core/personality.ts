import type { ToyKind } from "./mess";
import type { IntentName } from "./types";

export interface Personality {
  name: string;
  /** Used in the model prompt. Defaults to "house cat". */
  species?: string;
  /** Lines the character says for an intent, instead of the stock cat lines. */
  voice?: Partial<Record<IntentName, string[]>>;
  /** Its own toy, the one it brings out to play with. The yarn unless said. */
  toy?: ToyKind;
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
