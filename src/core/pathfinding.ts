import type { Platform } from "./platforms";

export interface JumpLimits {
  /** Highest ledge the cat can jump up to, in points. */
  maxUp: number;
  /** Widest gap the cat can jump across, in points. */
  maxGap: number;
}

export type PathStep =
  | { kind: "walk"; x: number }
  | { kind: "jump"; toId: string; takeoffX: number; landX: number };

interface Edge {
  to: string;
  takeoffX: number;
  landX: number;
  cost: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function edgeBetween(a: Platform, b: Platform, lim: JumpLimits): Edge | null {
  const up = a.y - b.y;
  if (up > lim.maxUp) return null;
  const lo = Math.max(a.x1, b.x1);
  const hi = Math.min(a.x2, b.x2);
  if (lo < hi) {
    const x = (lo + hi) / 2;
    return { to: b.id, takeoffX: x, landX: x, cost: 12 + Math.max(0, up) };
  }
  const gap = b.x1 >= a.x2 ? b.x1 - a.x2 : a.x1 - b.x2;
  if (gap > lim.maxGap) return null;
  const right = b.x1 >= a.x2;
  const takeoffX = right ? a.x2 - 4 : a.x1 + 4;
  const landX = right ? b.x1 + 4 : b.x2 - 4;
  return { to: b.id, takeoffX, landX, cost: 12 + gap + Math.max(0, up) };
}

function buildGraph(platforms: Platform[], lim: JumpLimits): Map<string, Edge[]> {
  const g = new Map<string, Edge[]>();
  for (const a of platforms) {
    const edges: Edge[] = [];
    for (const b of platforms) {
      if (a.id === b.id) continue;
      const e = edgeBetween(a, b, lim);
      if (e) edges.push(e);
    }
    g.set(a.id, edges);
  }
  return g;
}

interface Node {
  cost: number;
  x: number;
  prev?: { id: string; edge: Edge };
}

/** Dijkstra over platforms. The cat walks inside a platform and jumps between them. */
function search(platforms: Platform[], fromId: string, fromX: number, lim: JumpLimits): Map<string, Node> {
  const graph = buildGraph(platforms, lim);
  const nodes = new Map<string, Node>([[fromId, { cost: 0, x: fromX }]]);
  const done = new Set<string>();
  while (true) {
    let curId: string | null = null;
    let best = Infinity;
    for (const [id, n] of nodes) if (!done.has(id) && n.cost < best) ((best = n.cost), (curId = id));
    if (curId === null) break;
    done.add(curId);
    const cur = nodes.get(curId) as Node;
    for (const e of graph.get(curId) ?? []) {
      const cost = cur.cost + Math.abs(e.takeoffX - cur.x) + e.cost;
      const existing = nodes.get(e.to);
      if (!existing || cost < existing.cost) nodes.set(e.to, { cost, x: e.landX, prev: { id: curId, edge: e } });
    }
  }
  return nodes;
}

function stepsTo(nodes: Map<string, Node>, toId: string, toX: number, platforms: Platform[]): PathStep[] {
  const chain: { edge: Edge }[] = [];
  let id = toId;
  for (;;) {
    const n = nodes.get(id) as Node;
    if (!n.prev) break;
    chain.unshift({ edge: n.prev.edge });
    id = n.prev.id;
  }
  const steps: PathStep[] = [];
  for (const { edge } of chain) {
    steps.push({ kind: "walk", x: edge.takeoffX });
    steps.push({ kind: "jump", toId: edge.to, takeoffX: edge.takeoffX, landX: edge.landX });
  }
  const dest = platforms.find((p) => p.id === toId);
  if (dest) steps.push({ kind: "walk", x: clamp(toX, dest.x1 + 2, dest.x2 - 2) });
  return steps;
}

export interface Plan {
  steps: PathStep[];
  /** False when the goal can't be reached. The plan then leads to the closest reachable point. */
  reached: boolean;
  /** Platform the plan ends on. */
  endId: string;
}

/**
 * Plans a route. If the goal platform can't be reached, walks to the nearest reachable spot.
 * A real cat does the same, then stares at what it wanted.
 */
export function planRoute(
  platforms: Platform[],
  fromId: string,
  fromX: number,
  goalId: string,
  goalX: number,
  lim: JumpLimits,
): Plan | null {
  if (!platforms.some((p) => p.id === fromId)) return null;
  const nodes = search(platforms, fromId, fromX, lim);
  if (nodes.has(goalId)) return { steps: stepsTo(nodes, goalId, goalX, platforms), reached: true, endId: goalId };
  const goal = platforms.find((p) => p.id === goalId);
  if (!goal) return null;
  let bestId = fromId;
  let bestD = Infinity;
  for (const id of nodes.keys()) {
    const p = platforms.find((q) => q.id === id) as Platform;
    const dx = goalX < p.x1 ? p.x1 - goalX : goalX > p.x2 ? goalX - p.x2 : 0;
    const d = dx + Math.abs(p.y - goal.y) * 0.5;
    if (d < bestD) ((bestD = d), (bestId = id));
  }
  const near = platforms.find((p) => p.id === bestId) as Platform;
  return { steps: stepsTo(nodes, bestId, clamp(goalX, near.x1, near.x2), platforms), reached: false, endId: bestId };
}
