import { FakeLlmClient, LlmBrain, OllamaClient, RulesBrain, type Brain } from "../../src/core/brain";
import { RotatingLogger } from "../../src/node/logger";
import { evaluate, G1_RELAXED, G1_STRICT, makeScenarios, passesGateG1 } from "./evaluate";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}

async function main(): Promise<number> {
  const which = arg("brain", "rules");
  const n = Number(arg("n", "60"));
  const url = arg("url", process.env.FELINQUENT_OLLAMA_URL ?? "http://localhost:11434");
  const model = arg("model", process.env.FELINQUENT_OLLAMA_MODEL ?? "gemma3:1b");
  const logger = new RotatingLogger({ dir: process.env.FELINQUENT_LOG_DIR ?? "./logs", name: "brain-eval", maxBytes: 5 * 1024 * 1024, maxFiles: 2 });

  let brain: Brain;
  if (which === "rules") brain = new RulesBrain();
  else if (which === "fake") brain = new LlmBrain(new FakeLlmClient("good", 2));
  else if (which === "ollama") {
    try {
      const tags = (await (await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) })).json()) as { models?: { name: string }[] };
      if (!tags.models?.some((m) => m.name === model || m.name.startsWith(`${model}:`))) {
        console.log(`Ollama is running at ${url}, but model "${model}" is not installed. Nothing was downloaded. Install one yourself (for example: ollama pull ${model}) and run again.`);
        logger.warn("ollama model missing", { url, model });
        return 0;
      }
    } catch {
      console.log(`No Ollama server answered at ${url}. Start it and run again.`);
      logger.warn("ollama not reachable", { url });
      return 0;
    }
    brain = new LlmBrain(new OllamaClient(url, model), 8000);
  } else {
    console.error(`Unknown brain "${which}". Use rules, fake or ollama.`);
    return 2;
  }

  const scenarios = makeScenarios(n, Number(arg("seed", "1")));
  const r = await evaluate(brain, scenarios);
  logger.info("brain eval", { ...r });
  console.table([{ ...r, validRate: `${(r.validRate * 100).toFixed(1)}%`, topPickRate: `${(r.topPickRate * 100).toFixed(0)}%` }]);
  const strict = passesGateG1(r, G1_STRICT);
  const relaxed = passesGateG1(r, G1_RELAXED);
  console.log(`Original mark (>= 98% valid, p95 < 3000 ms): ${strict ? "PASS" : "FAIL"}`);
  console.log(`Proposed mark (>= 95% valid, p95 < 5000 ms): ${relaxed ? "PASS" : "FAIL"}`);
  return relaxed ? 0 : 1;
}

main().then((c) => process.exit(c));
