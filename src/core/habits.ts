/**
 * What the cat has learned about itself: which of its own choices got a good reaction
 * (a pet or a treat soon after) and which got a bad one (a shoo). It nudges the rules scores
 * a little, so the cat slowly develops habits. Counts only, no window titles, saved with the memory.
 */
const CAP = 12;

export interface HabitsData {
  liked: Record<string, number>;
  disliked: Record<string, number>;
}

export class Habits {
  private liked = new Map<string, number>();
  private disliked = new Map<string, number>();

  reward(intent: string): void {
    this.liked.set(intent, Math.min(CAP, (this.liked.get(intent) ?? 0) + 1));
  }

  punish(intent: string): void {
    this.disliked.set(intent, Math.min(CAP, (this.disliked.get(intent) ?? 0) + 1));
  }

  /** Multiplier for a rules score: a liked choice gets up to 1.6, a punished one down to 0.5. */
  multiplier(intent: string): number {
    const l = this.liked.get(intent) ?? 0;
    const d = this.disliked.get(intent) ?? 0;
    return Math.max(0.5, Math.min(1.6, 1 + 0.12 * l - 0.2 * d));
  }

  /** One short line for the model prompt, or null when nothing is learned yet. */
  line(): string | null {
    const best = [...this.liked.entries()].filter(([k, v]) => v >= 2 && v > (this.disliked.get(k) ?? 0)).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (best.length === 0) return null;
    return `habits: likes ${best.map(([k]) => k.replace(/_/g, " ")).join(", ")}`;
  }

  clear(): void {
    this.liked.clear();
    this.disliked.clear();
  }

  toJSON(): HabitsData {
    return { liked: Object.fromEntries(this.liked), disliked: Object.fromEntries(this.disliked) };
  }

  load(data: Partial<HabitsData> | undefined): void {
    this.clear();
    for (const [k, v] of Object.entries(data?.liked ?? {})) if (Number.isFinite(v)) this.liked.set(k, Math.min(CAP, Math.max(0, v)));
    for (const [k, v] of Object.entries(data?.disliked ?? {})) if (Number.isFinite(v)) this.disliked.set(k, Math.min(CAP, Math.max(0, v)));
  }
}
