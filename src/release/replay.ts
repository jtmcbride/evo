import { createEpisode } from "../core/episode";
import type { Genome, Scenario } from "../core/model";

export function evaluateFrozen(genome: Genome, scenario: Scenario) {
  const episode = createEpisode({
    scenario,
    controller: {
      kind: "neural",
      id: genome.id,
      parameters: genome.parameters,
    },
    trace: true,
  });
  const path: { tick: number; x: number; y: number }[] = [];
  let firstDecision: ReturnType<typeof episode.decisionTrace> = null;
  while (!episode.result()) {
    episode.advance(3);
    firstDecision ??= episode.decisionTrace();
    const s = episode.inspect();
    path.push({ tick: s.tick, x: s.x, y: s.y });
  }
  return { result: episode.result()!, firstDecision, path };
}
