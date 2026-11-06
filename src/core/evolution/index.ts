import { hash, parameterHash } from "../canonical";
import { Random } from "../random";
import { initializeParameters, validateParameters } from "../controller/neural";
import {
  ENGINE_VERSION,
  DEFAULT_WORLD,
  FORMAT_VERSION,
  validateWorld,
  type WorldConfig,
  type Genome,
} from "../model";
export interface EvolutionConfig {
  population: number;
  elites: number;
  immigrants: number;
  trials: number;
  tournamentSize: number;
  mutationProbability: number;
  mutationSigma: number;
  validationInterval: number;
  validationTrials: number;
}
export const DEFAULT_EVOLUTION: EvolutionConfig = {
  population: 128,
  elites: 4,
  immigrants: 8,
  trials: 3,
  tournamentSize: 4,
  mutationProbability: 0.1,
  mutationSigma: 0.05,
  validationInterval: 10,
  validationTrials: 16,
};
export interface ExperimentDefinition {
  id: string;
  world: WorldConfig;
  evolution: EvolutionConfig;
  roots: {
    initialization: string;
    training: string;
    evolution: string;
    validation: string;
  };
}
export interface ExperimentCheckpoint {
  formatVersion: number;
  engineVersion: string;
  phase: "readyToEvaluate";
  generation: number;
  definition: ExperimentDefinition;
  population: Genome[];
  lastCommitId: string | null;
}
export function defineExperiment(
  seed = "42",
  obstacles = false,
): ExperimentDefinition {
  return {
    id: `experiment-${seed}`,
    world: { ...DEFAULT_WORLD, obstacleCount: obstacles ? 5 : 0 },
    evolution: { ...DEFAULT_EVOLUTION },
    roots: {
      initialization: `${seed}:initialization`,
      training: `${seed}:training`,
      evolution: `${seed}:evolution`,
      validation: `${seed}:validation`,
    },
  };
}
export function validateDefinition(d: ExperimentDefinition): void {
  validateWorld(d.world);
  const e = d.evolution;
  if (
    typeof d.id !== "string" ||
    !d.id ||
    Object.values(d.roots).length !== 4 ||
    Object.values(d.roots).some((x) => typeof x !== "string")
  )
    throw new Error("Invalid experiment identity/roots");
  for (const key of [
    "population",
    "elites",
    "immigrants",
    "trials",
    "tournamentSize",
    "validationInterval",
    "validationTrials",
  ] as const)
    if (!Number.isInteger(e[key]) || e[key] < 0)
      throw new Error(`Invalid ${key}`);
  if (
    e.population < 1 ||
    e.population > 4096 ||
    e.elites + e.immigrants > e.population ||
    e.trials < 1 ||
    e.trials > 64 ||
    e.tournamentSize < 1 ||
    e.tournamentSize > 4096 ||
    e.validationInterval < 1 ||
    e.validationTrials < 1 ||
    e.validationTrials > 1024 ||
    !Number.isFinite(e.mutationProbability) ||
    e.mutationProbability < 0 ||
    e.mutationProbability > 1 ||
    !Number.isFinite(e.mutationSigma) ||
    e.mutationSigma < 0 ||
    e.mutationSigma > 100
  )
    throw new Error("Invalid evolution config");
}
function makeGenome(
  d: ExperimentDefinition,
  g: number,
  slot: number,
  origin: Genome["origin"],
  parameters: Float32Array,
  parentIds: string[] = [],
): Genome {
  return {
    id: `${d.id}:g${g}:s${slot}`,
    parentIds,
    birthGeneration: g,
    origin,
    brainSchema: "dense-20-12-2-v1",
    parameterHash: parameterHash(parameters),
    parameters,
  };
}
export function initialCheckpoint(
  definition: ExperimentDefinition,
): ExperimentCheckpoint {
  validateDefinition(definition);
  const d = structuredClone(definition);
  return {
    formatVersion: FORMAT_VERSION,
    engineVersion: ENGINE_VERSION,
    phase: "readyToEvaluate",
    generation: 0,
    definition: d,
    lastCommitId: null,
    population: Array.from({ length: d.evolution.population }, (_, slot) =>
      makeGenome(
        d,
        0,
        slot,
        "founder",
        initializeParameters(
          Random.derive("initialization-v1", d.roots.initialization, slot),
        ),
      ),
    ),
  };
}
export function validateCheckpoint(c: ExperimentCheckpoint): void {
  if (
    c.formatVersion !== FORMAT_VERSION ||
    c.engineVersion !== ENGINE_VERSION ||
    c.phase !== "readyToEvaluate" ||
    !Number.isInteger(c.generation) ||
    c.generation < 0
  )
    throw new Error("Unsupported experiment checkpoint");
  validateDefinition(c.definition);
  if (
    c.population.length !== c.definition.evolution.population ||
    new Set(c.population.map((g) => g.id)).size !== c.population.length
  )
    throw new Error("Invalid population");
  for (const g of c.population) {
    validateParameters(g.parameters);
    if (
      g.brainSchema !== "dense-20-12-2-v1" ||
      g.parameterHash !== parameterHash(g.parameters) ||
      !Number.isInteger(g.birthGeneration) ||
      g.birthGeneration < 0 ||
      g.birthGeneration > c.generation ||
      typeof g.id !== "string" ||
      !Array.isArray(g.parentIds) ||
      g.parentIds.some((p) => typeof p !== "string")
    )
      throw new Error("Invalid genome");
  }
}
export function rankedSlots(
  c: ExperimentCheckpoint,
  totals: number[],
): number[] {
  if (
    totals.length !== c.population.length ||
    totals.some((x) => !Number.isInteger(x) || x < 0)
  )
    throw new Error("Incomplete fitness");
  const ties = totals.map((_, slot) =>
    Random.derive(
      "elite-ties-v1",
      c.definition.roots.evolution,
      c.generation,
      slot,
    ).uint32(),
  );
  return totals
    .map((_, i) => i)
    .sort((a, b) => totals[b] - totals[a] || ties[a] - ties[b] || a - b);
}
export function reproduce(c: ExperimentCheckpoint, totals: number[]): Genome[] {
  const d = c.definition,
    e = d.evolution,
    rank = rankedSlots(c, totals),
    g = c.generation + 1;
  const population = rank
    .slice(0, e.elites)
    .map((i) => structuredClone(c.population[i]));
  for (let slot = e.elites; slot < e.population - e.immigrants; slot++) {
    const select = Random.derive(
      "selection-v1",
      d.roots.evolution,
      c.generation,
      slot,
    );
    let best = select.integer(e.population);
    for (let i = 1; i < e.tournamentSize; i++) {
      const candidate = select.integer(e.population);
      if (
        totals[candidate] > totals[best] ||
        (totals[candidate] === totals[best] && select.integer(2) === 0)
      )
        best = candidate;
    }
    const parent = c.population[best],
      parameters = parent.parameters.slice(),
      seed = hash(["mutation-v1", d.roots.evolution, c.generation, slot]),
      r = Random.derive("mutation-v1", d.roots.evolution, c.generation, slot),
      changes: NonNullable<Genome["mutation"]>["changes"] = [];
    for (let i = 0; i < parameters.length; i++)
      if (r.uniform() < e.mutationProbability) {
        const value = Math.fround(parameters[i] + r.normal() * e.mutationSigma);
        if (!Number.isFinite(value)) throw new Error("Nonfinite mutation");
        if (!Object.is(value, parameters[i])) changes.push({ index: i, value });
        parameters[i] = value;
      }
    population.push({
      ...makeGenome(d, g, slot, "mutation", parameters, [parent.id]),
      mutation: { seed, changes },
    });
  }
  for (let slot = e.population - e.immigrants; slot < e.population; slot++)
    population.push(
      makeGenome(
        d,
        g,
        slot,
        "immigrant",
        initializeParameters(
          Random.derive("immigrant-v1", d.roots.evolution, c.generation, slot),
        ),
      ),
    );
  return population;
}
