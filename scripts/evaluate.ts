import { args } from "./args";
import { DEFAULT_WORLD } from "../src/core/model";
import { generateScenario } from "../src/core/world/scenario";
import { createEpisode } from "../src/core/episode";
import { hash } from "../src/core/canonical";
const a = args();
if (
  !["open-v1", "obstacles-v1"].includes(a.preset) ||
  a.controller !== "scripted-v1"
)
  throw new Error("Unsupported preset/controller");
const scenario = generateScenario(a.seed, {
  ...DEFAULT_WORLD,
  obstacleCount: a.preset === "obstacles-v1" ? 5 : 0,
});
const episode = createEpisode({
  scenario,
  controller: { kind: "scripted", id: "scripted-v1" },
});
episode.advance(scenario.config.maxTicks);
console.log(
  JSON.stringify(
    { result: episode.result(), hash: hash(episode.result()) },
    null,
    2,
  ),
);
