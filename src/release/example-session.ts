// Browser-only authoring entry, imported by the generation script through Vite.
// It is not part of the application bundle.
import { decode } from "../core/codec";
import { hash } from "../core/canonical";
import { evaluateFrozen } from "./replay";
import { generateScenario } from "../core/world/scenario";
import {
  initialCheckpoint,
  type ExperimentCheckpoint,
} from "../core/evolution";
import type { GenerationRecord } from "../core/experiment";
import type { Genome } from "../core/model";
import { createArchive } from "../persistence/archive";
import {
  DEFAULT_SETTINGS,
  fingerprint,
  type SavedSession,
} from "../persistence/model";

export function buildExample(
  encoded: string,
  which: "initial" | "final",
  trainingRuntime: { userAgent: string; platform: string },
) {
  const source = decode(encoded) as {
    initial: { genome: Genome; record: GenerationRecord };
    final: { genome: Genome; record: GenerationRecord };
    checkpoint: ExperimentCheckpoint;
  };
  const endpoint = source[which],
    definition = source.checkpoint.definition;
  const scenario = generateScenario(
    hash(["validation-v1", definition.roots.validation, 0]),
    definition.world,
  );
  const evaluate = () => evaluateFrozen(endpoint.genome, scenario);
  const evaluation = evaluate();
  if (hash(evaluation) !== hash(evaluate()))
    throw new Error("Browser example replay is not exact");
  const runtime = fingerprint(),
    generation = endpoint.record.generation;
  const name =
    which === "initial"
      ? "Example · before evolution"
      : "Example · after 200 generations";
  const checkpoint =
    which === "initial" ? initialCheckpoint(definition) : source.checkpoint;
  const session: SavedSession = {
    formatVersion: 1,
    engineVersion: "evo-engine-1",
    name,
    settings: {
      ...DEFAULT_SETTINGS,
      name,
      seed: definition.roots.initialization.replace(/:initialization$/, ""),
      obstacleCount: 5,
    },
    checkpoint,
    history: [],
    replays: [],
    comparisons: [],
    bookmark: {
      genome: endpoint.genome,
      generation,
      label: `Previously generated · generation ${generation}`,
      scenario,
      trial: 0,
      recordedResult: evaluation.result,
      historyGeneration: null,
      tick: 0,
    },
    provenance: {
      created: trainingRuntime,
      current: runtime,
      changes: [
        { from: trainingRuntime, to: runtime, at: new Date().toISOString() },
      ],
    },
  };
  const bytes = createArchive(session);
  return {
    archive: Array.from(bytes),
    evidence: {
      runtime,
      generation,
      genomeId: endpoint.genome.id,
      parameterHash: endpoint.genome.parameterHash,
      scenarioHash: scenario.hash,
      evaluationHash: hash(evaluation),
      ...evaluation,
    },
  };
}
