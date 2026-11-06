import { Random } from "../src/core/random";
import { initializeParameters } from "../src/core/controller/neural";
import type { ControllerDefinition } from "../src/core/controller";
import { args } from "./args";
import { DEFAULT_WORLD } from "../src/core/model";
import { generateScenario } from "../src/core/world/scenario";
import { createEpisode } from "../src/core/episode";
import { hash } from "../src/core/canonical";
const a = args();
if (
  !["open-v1", "obstacles-v1"].includes(a.preset) ||
  !["scripted-v1", "random-v1", "neural-v1"].includes(a.controller)
)
  throw new Error("Unsupported preset/controller");
const scenario = generateScenario(a.seed, {
  ...DEFAULT_WORLD,
  obstacleCount: a.preset === "obstacles-v1" ? 5 : 0,
});
const controller: ControllerDefinition =
  a.controller === "neural-v1"
    ? {
        kind: "neural",
        id: "frozen-neural-v1",
        parameters: initializeParameters(
          Random.derive("initialization-v1", a.seed, 0),
        ),
      }
    : a.controller === "random-v1"
      ? { kind: "random", id: "random-v1", seed: a.seed }
      : { kind: "scripted", id: "scripted-v1" };
const episode = createEpisode({
  scenario,
  controller,
});
episode.advance(scenario.config.maxTicks);
console.log(
  JSON.stringify(
    { result: episode.result(), hash: hash(episode.result()) },
    null,
    2,
  ),
);
