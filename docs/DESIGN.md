# Design as built

The design intent lives in [technical-design.md](technical-design.md) (architecture, sensors, brain, governor) and [art-and-ux.md](art-and-ux.md) (character, sprites, UI). This page records what the code does today, where it differs from that design, and how to extend it. For the step-by-step behavior see [LOGICAL-FLOW.md](LOGICAL-FLOW.md).

## Module map

| File | Job | Tested in |
|---|---|---|
| `src/core/types.ts` | World snapshot, needs, intents, settings and their defaults | everywhere |
| `src/core/behaviors.ts` | The behavior table (ID, annoyance level, category, lowest chaos level, permission, longest stay) and chaos parameters. Mirrors [behavior-catalog.md](behavior-catalog.md). | `governor`, `coverage` |
| `src/core/needs.ts` | Energy, attention need, curiosity, trust, mood. Events (pet, shoo, treat, throw...). | `needs` |
| `src/core/personality.ts` | Traits and the four archetypes (Loaf, Shadow, Gremlin, Royal) | `needs`, `coverage` |
| `src/core/rules.ts` | Builds and scores every sensible option. Default stay times and thoughts. | `brain`, `coverage` |
| `src/core/governor.ts` | Respect modes, budget, fairness, permissions, validation, clamping | `governor`, `sim` |
| `src/core/summary.ts` | The world summary sent to the model, the per-request JSON schema, the system prompt | `brain` |
| `src/core/brain.ts` | `Brain` and `LlmClient` interfaces, `RulesBrain`, `LlmBrain`, `OllamaClient`, `FakeLlmClient`, `parseIntent` | `brain`, `eval` |
| `src/core/mind.ts` | The slow brain loop: needs, respect, sleep, decide, reflex reactions, LLM limits and cool-down | `mind`, `sim` |
| `src/core/platforms.ts` | Window edges to walkable segments, with occlusion | `platforms` |
| `src/core/pathfinding.ts` | Route over platforms, nearest reachable fallback | `pathfinding` |
| `src/core/executor.ts` | The fast brain: walking, jumping, falling, riding windows, blocking, being held | `executor`, `coverage` |
| `src/core/reflexes.ts` | Pointer samples to pet, pick up, throw, shoo, laser, call | `reflexes` |
| `src/core/memory.ts` | In-memory events, prompt lines, favorite spot, diary text | `mind`, `node` |
| `src/core/cat.ts` | Wires Mind, Governor, Executor and reflexes into one object | `mind`, `sim` |
| `src/core/sensors.ts` | The `Sensors` interface the native shell must fill, and a scripted fake | n/a |
| `src/core/world.ts` | `makeWorld()` for tests, the playground and the eval | everywhere |
| `src/node/logger.ts` | Size-limited rotating log (5 MB by 3 by default), keeps titles out | `node` |
| `src/node/jsonMemory.ts` | Memory saved to a JSON file | `node` |
| `src/node/serve.ts` | Tiny static server for the demo on a VM | `node` |
| `src/playground/*` | The browser demo: pretend windows, controls, canvas drawing of the cat | checked by hand in a browser |
| `tools/check-forbidden-apis.ts` | Build check for the two hard lines (no fake input, no screen capture) | `node` |
| `tools/brain-eval/*` | Scores a brain on repeatable scenarios against the G1 mark | `eval` |

`src/core` has no browser or Node imports. It is plain TypeScript, which is what makes a later port to Rust or a native shell mechanical.

## The seams (where things plug in)

```ts
// Anything that turns a prompt into text. Ollama, a built-in engine later, or a fake.
interface LlmClient { name: string; generate(req: LlmRequest): Promise<string>; }

// A brain picks one option from a menu, or returns null.
interface Brain { name: string; decide(ctx: BrainContext): Promise<Intent | null>; }

// What the native shell has to provide on each platform.
interface Sensors { read(): WorldSnapshot | Promise<WorldSnapshot>; }

// Where memory lives.
interface Memory { log, events, recentLines, forgetAll, exportJson }
```

## Differences from technical-design.md

| Design says | Built | Why |
|---|---|---|
| Rust core owns sensing and decisions, TypeScript overlay owns movement | TypeScript core owns all logic. A native shell will only provide sensors and the overlay window. | No Rust toolchain on this machine and installing one needs approval |
| SQLite memory | JSON file | No dependency yet, same interface |
| Jumps up to about 3 times the cat's height | 9 times (cartoon leaps) | Otherwise a Dock cat can't reach window tops near the top of the screen |
| PixiJS renderer | Canvas 2D, code-drawn placeholder cat | No sprite sheets exist yet |
| A* path finding | Dijkstra (same result on a graph this small) | Simpler |
| Playwright playground tests | Manual browser checks, plus unit and simulation tests of everything the page uses | Keeps dependencies small |
| Menu bar app, panic hotkey, Copy diagnostics in the app | Playground buttons for the same actions (panic, shoo, copy diagnostics). Menu bar and global hotkey need the native shell. | Native |

## Playground design

- **One page, same code.** `main.ts` builds a `Cat`, feeds it a world made from pretend windows (draggable divs), and draws it on a canvas.
- **Click-through is simulated.** The cat's canvas ignores the mouse. A small invisible box over the cat takes the pointer. While the cat blocks, a red dashed box shows where clicks would be blocked.
- **Time warp.** The slider speeds up needs and decisions (not movement), so you can watch a sleep cycle in a minute.
- **Brain switch.** Rules, fake model (good, garbage, down), or Ollama on localhost. Broken models show the fallback to rules.
- **Controls** cover every behavior trigger: set needs, activity, open and close windows, treats, all respect modes, diary, forget, copy diagnostics.
- **Debug hook.** `window.felinquent` exposes the cat and state for the console.

## How to extend

Add a behavior (full checklist is at the end of [behavior-catalog.md](behavior-catalog.md)):

1. Add its row to `BEHAVIORS` in `behaviors.ts` and the intent name to `IntentName` in `types.ts`.
2. Score it in `candidates()` in `rules.ts`, with the right targets.
3. Map its animation in `DO_ANIM` in `executor.ts` and its pose in `poseFor()` in `draw.ts`.
4. Add a situation to `SITUATIONS` in `tests/coverage.test.ts`. The test fails until the cat can choose it and finish it.
5. If it needs a permission or a new signal, update [safety-and-privacy.md](safety-and-privacy.md).

Add a brain: implement `Brain` (or `LlmClient` for a model), then run `npm run eval` against it. A model passes the G1 mark with at least 98 percent valid answers and p95 under 3 seconds.

Add a platform: implement `Sensors` natively and keep every OS call out of `src/core`.

## Not designed yet

- Sprite sheets and a real renderer ([art-and-ux.md](art-and-ux.md)).
- Multi-display (one `Platform` set per display).
- Sound.
- The adoption onboarding screens.
- The diary share card (the text exists, the image does not).
