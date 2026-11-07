import {
  validateCheckpoint,
  validateDefinition,
  type ExperimentCheckpoint,
  type ExperimentDefinition,
} from "../evolution";
import { hash } from "../canonical";
import { encode } from "../codec";
export interface ConfigChange {
  group: "world" | "evolution";
  key: string;
  before: number;
  after: number;
}
export interface BranchOrigin {
  version: 1;
  sourceLocalId: string;
  sourceName: string;
  source: {
    generation: number;
    definition: ExperimentDefinition;
    lastCommitId: string | null;
    checkpointHash: string;
    members: { id: string; parameterHash: string }[];
  };
  definition: ExperimentDefinition;
  changes: ConfigChange[];
  paired: true;
}
export const checkpointHash = (c: ExperimentCheckpoint) =>
  hash(JSON.parse(encode(c)));
export function configDiff(
  before: ExperimentDefinition,
  after: ExperimentDefinition,
): ConfigChange[] {
  return (["world", "evolution"] as const).flatMap((group) =>
    Object.keys(before[group])
      .filter(
        (key) =>
          before[group][key as keyof (typeof before)[typeof group]] !==
          after[group][key as keyof (typeof after)[typeof group]],
      )
      .map((key) => ({
        group,
        key,
        before: (before[group] as unknown as Record<string, number>)[key],
        after: (after[group] as unknown as Record<string, number>)[key],
      })),
  );
}
export function branchCheckpoint(
  source: ExperimentCheckpoint,
  definition: ExperimentDefinition,
  sourceLocalId: string,
  sourceName: string,
) {
  validateCheckpoint(source);
  validateDefinition(definition);
  if (
    !definition.id ||
    definition.id.length > 256 ||
    source.definition.id === definition.id ||
    definition.evolution.population !==
      source.definition.evolution.population ||
    hash(source.definition.roots) !== hash(definition.roots)
  )
    throw new Error(
      "Branches preserve population size, generation, and paired seed roots and require a new identity",
    );
  const origin: BranchOrigin = {
    version: 1,
    sourceLocalId,
    sourceName,
    source: {
      generation: source.generation,
      definition: structuredClone(source.definition),
      lastCommitId: source.lastCommitId,
      checkpointHash: checkpointHash(source),
      members: source.population.map((g) => ({
        id: g.id,
        parameterHash: g.parameterHash,
      })),
    },
    definition: structuredClone(definition),
    changes: configDiff(source.definition, definition),
    paired: true,
  };
  return {
    checkpoint: {
      ...structuredClone(source),
      definition: structuredClone(definition),
    },
    origin,
  };
}
export function validateOrigins(
  origins: BranchOrigin[],
  checkpoint: ExperimentCheckpoint,
) {
  if (!Array.isArray(origins) || origins.length > 16)
    throw new Error("Invalid branch ancestry");
  const seen = new Set<string>();
  let previous: BranchOrigin | undefined;
  for (const origin of origins) {
    const s = origin.source;
    validateDefinition(s.definition);
    validateDefinition(origin.definition);
    if (
      origin.version !== 1 ||
      origin.paired !== true ||
      typeof origin.sourceLocalId !== "string" ||
      !origin.sourceLocalId ||
      origin.sourceLocalId.length > 256 ||
      typeof origin.sourceName !== "string" ||
      !origin.sourceName ||
      origin.sourceName.length > 64 ||
      !Number.isInteger(s.generation) ||
      s.generation < 0 ||
      s.generation > checkpoint.generation ||
      !/^[a-f0-9]{64}$/.test(s.checkpointHash) ||
      (s.lastCommitId !== null && !/^[a-f0-9]{64}$/.test(s.lastCommitId)) ||
      !Array.isArray(s.members) ||
      s.members.length !== s.definition.evolution.population ||
      new Set(s.members.map((m) => m.id)).size !== s.members.length ||
      s.members.some(
        (m) =>
          typeof m.id !== "string" ||
          !m.id ||
          m.id.length > 256 ||
          !/^[a-f0-9]{64}$/.test(m.parameterHash),
      ) ||
      seen.has(origin.definition.id) ||
      origin.definition.id === s.definition.id ||
      hash(origin.definition.roots) !== hash(s.definition.roots) ||
      origin.definition.evolution.population !==
        s.definition.evolution.population ||
      hash(origin.changes) !==
        hash(configDiff(s.definition, origin.definition)) ||
      (previous &&
        (hash(previous.definition) !== hash(s.definition) ||
          previous.source.generation > s.generation))
    )
      throw new Error("Invalid branch source or configuration diff");
    seen.add(origin.definition.id);
    previous = origin;
  }
  if (previous && hash(previous.definition) !== hash(checkpoint.definition))
    throw new Error("Branch definition does not match current population");
}
