import { branchCheckpoint } from "../core/branch";
import type { ExperimentDefinition } from "../core/evolution";
import type { LineageBundle } from "../core/lineage";
import { parseSession, type SavedHandle, type SavedSession } from "./model";
export function makeBranch(
  source: SavedHandle,
  lineage: LineageBundle,
  name: string,
  definition: ExperimentDefinition,
): SavedSession {
  const fork = branchCheckpoint(
    source.session.checkpoint,
    definition,
    source.entry.id,
    source.session.name,
  );
  const settings = {
    ...source.session.settings,
    name,
    preset: definition.world.obstacleCount
      ? ("obstacles" as const)
      : ("open" as const),
    foodCount: definition.world.foodCount,
    obstacleCount: Math.max(1, definition.world.obstacleCount),
    seconds: definition.world.maxTicks / 30,
    ...{
      population: definition.evolution.population,
      trials: definition.evolution.trials,
      elites: definition.evolution.elites,
      immigrants: definition.evolution.immigrants,
      mutationProbability: definition.evolution.mutationProbability,
      mutationSigma: definition.evolution.mutationSigma,
    },
    body: {
      bodyRadius: definition.world.bodyRadius,
      sensorRange: definition.world.sensorRange,
      vMax: definition.world.vMax,
    },
  };
  return parseSession({
    ...structuredClone(source.session),
    name,
    settings,
    checkpoint: fork.checkpoint,
    branchOrigins: [...(source.session.branchOrigins ?? []), fork.origin],
    lineage: {
      ...structuredClone(lineage),
      generations: lineage.generations.map((r) => ({
        ...r,
        definition: r.definition ?? source.session.checkpoint.definition,
      })),
    },
    bookmark: null,
    comparisons: [],
    matrices: [],
  });
}
