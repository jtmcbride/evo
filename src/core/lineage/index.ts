import { hash, parameterHash } from "../canonical";
import { encode } from "../codec";
import { validateParameters } from "../controller/neural";
import type { GenerationRecord } from "../experiment";
import type { ExperimentCheckpoint } from "../evolution";
import { ENGINE_VERSION, type Genome } from "../model";
import { validateScenario } from "../world/scenario";

export const MAX_PATCH_DEPTH = 16;
export type GenomeMetadata = Omit<Genome, "parameters">;
export interface LineageNode {
  genome: GenomeMetadata;
  storage:
    | { kind: "full"; depth: 0; parameters: Float32Array }
    | { kind: "patch"; depth: number };
}
export interface LineageBundle {
  version: 1;
  fromGeneration: number;
  nodes: LineageNode[];
  generations: (GenerationRecord & { commitId: string })[];
}
export const contentHash = (value: unknown) => hash(JSON.parse(encode(value)));
function integer(v: number) {
  return Number.isInteger(v) && v >= 0;
}
function identity(v: string) {
  return typeof v === "string" && v.length > 0 && v.length <= 256;
}
function digest(v: string) {
  return typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
}
export function validateNode(node: LineageNode): void {
  const g = node.genome,
    s = node.storage;
  if (
    !identity(g.id) ||
    !integer(g.birthGeneration) ||
    g.brainSchema !== "dense-20-12-2-v1" ||
    !digest(g.parameterHash) ||
    !["founder", "immigrant", "mutation"].includes(g.origin) ||
    !Array.isArray(g.parentIds) ||
    g.parentIds.some((p) => !identity(p)) ||
    g.parentIds.length !== (g.origin === "mutation" ? 1 : 0) ||
    Object.keys(node).some((k) => !["genome", "storage"].includes(k)) ||
    Object.keys(g).some(
      (k) =>
        ![
          "id",
          "parentIds",
          "birthGeneration",
          "origin",
          "brainSchema",
          "parameterHash",
          "mutation",
        ].includes(k),
    )
  )
    throw new Error("Invalid lineage metadata");
  if (
    g.mutation &&
    (g.origin !== "mutation" ||
      !digest(g.mutation.seed) ||
      !Array.isArray(g.mutation.changes) ||
      g.mutation.changes.length > 278 ||
      new Set(g.mutation.changes.map((c) => c.index)).size !==
        g.mutation.changes.length ||
      g.mutation.changes.some(
        (c) =>
          !integer(c.index) ||
          c.index >= 278 ||
          !Number.isFinite(c.value) ||
          !Object.is(Math.fround(c.value), c.value) ||
          Object.keys(c).some((k) => !["index", "value"].includes(k)),
      ) ||
      Object.keys(g.mutation).some((k) => !["seed", "changes"].includes(k)))
  )
    throw new Error("Invalid lineage mutation patch");
  if (s.kind === "full") {
    validateParameters(s.parameters);
    if (
      s.depth !== 0 ||
      parameterHash(s.parameters) !== g.parameterHash ||
      Object.keys(s).some(
        (k) => !["kind", "depth", "parameters"].includes(k),
      ) ||
      g.mutation?.changes.some(
        (c) => !Object.is(s.parameters[c.index], c.value),
      )
    )
      throw new Error("Invalid full lineage anchor");
  } else if (
    s.kind !== "patch" ||
    !g.mutation ||
    !integer(s.depth) ||
    s.depth < 1 ||
    s.depth > MAX_PATCH_DEPTH ||
    Object.keys(s).some((k) => !["kind", "depth"].includes(k))
  )
    throw new Error("Invalid lineage patch storage");
}
/** A birth is stored once. Full anchors bound patch reconstruction to sixteen edges. */
export function retainGenome(
  genome: Genome,
  parent?: { node: LineageNode; genome: Genome },
): LineageNode {
  const { parameters, ...metadata } = structuredClone(genome);
  validateParameters(parameters);
  if (parent) {
    validateNode(parent.node);
    if (
      genome.parentIds[0] !== parent.genome.id ||
      parent.node.genome.id !== parent.genome.id ||
      parent.genome.parameterHash !== parent.node.genome.parameterHash ||
      parameterHash(parent.genome.parameters) !== parent.genome.parameterHash ||
      genome.birthGeneration <= parent.genome.birthGeneration
    )
      throw new Error("Invalid lineage parent");
    if (genome.mutation) {
      const restored = parent.genome.parameters.slice();
      for (const c of genome.mutation.changes) restored[c.index] = c.value;
      if (parameterHash(restored) !== genome.parameterHash)
        throw new Error("Mutation patch does not reconstruct child");
    }
  }
  const compact =
    parent &&
    genome.mutation &&
    genome.mutation.changes.length <= 64 &&
    parent.node.storage.depth < MAX_PATCH_DEPTH &&
    genome.birthGeneration % 10 !== 0;
  const node: LineageNode = {
    genome: metadata,
    storage: compact
      ? { kind: "patch", depth: parent.node.storage.depth + 1 }
      : { kind: "full", depth: 0, parameters },
  };
  validateNode(node);
  return node;
}
/** Lookup can be a map or a small set of records fetched from persistent storage. */
export function reconstructGenome(
  id: string,
  lookup: (id: string) => LineageNode | undefined,
): Genome {
  const chain: LineageNode[] = [],
    seen = new Set<string>();
  let cursor = id;
  while (true) {
    if (seen.has(cursor) || chain.length > MAX_PATCH_DEPTH)
      throw new Error("Invalid or excessive lineage chain");
    seen.add(cursor);
    const node = lookup(cursor);
    if (!node) throw new Error(`Missing lineage record: ${cursor}`);
    validateNode(node);
    if (node.genome.id !== cursor) throw new Error("Lineage identity mismatch");
    chain.push(node);
    if (node.storage.kind === "full") break;
    cursor = node.genome.parentIds[0];
  }
  const anchor = chain.pop()!;
  if (anchor.storage.kind !== "full") throw new Error("Missing lineage anchor");
  let genome: Genome = {
    ...structuredClone(anchor.genome),
    parameters: anchor.storage.parameters.slice(),
  };
  let depth = 0;
  for (const node of chain.reverse()) {
    if (
      node.genome.birthGeneration <= genome.birthGeneration ||
      node.storage.depth !== ++depth
    )
      throw new Error("Invalid lineage order or depth");
    const parameters = genome.parameters.slice();
    for (const c of node.genome.mutation!.changes)
      parameters[c.index] = c.value;
    if (parameterHash(parameters) !== node.genome.parameterHash)
      throw new Error("Reconstructed parameter checksum mismatch");
    genome = { ...structuredClone(node.genome), parameters };
  }
  return genome;
}

/** Validate a portable closure, including recorded scenario and evaluation references. */
export function validateLineage(
  bundle: LineageBundle,
  checkpoint: ExperimentCheckpoint,
): void {
  if (
    bundle.version !== 1 ||
    !integer(bundle.fromGeneration) ||
    bundle.fromGeneration > checkpoint.generation ||
    !Array.isArray(bundle.nodes) ||
    bundle.nodes.length > 100000 ||
    !Array.isArray(bundle.generations) ||
    bundle.generations.length > 10000 ||
    bundle.generations.length !==
      checkpoint.generation - bundle.fromGeneration ||
    Object.keys(bundle).some(
      (k) => !["version", "fromGeneration", "nodes", "generations"].includes(k),
    )
  )
    throw new Error("Invalid lineage coverage");
  const nodes = new Map(bundle.nodes.map((n) => [n.genome.id, n]));
  if (nodes.size !== bundle.nodes.length)
    throw new Error("Duplicate lineage identity");
  for (const n of bundle.nodes) {
    validateNode(n);
    if (n.genome.birthGeneration > checkpoint.generation)
      throw new Error("Lineage birth is ahead of the population");
    const parent = nodes.get(n.genome.parentIds[0]);
    if (
      parent
        ? parent.genome.birthGeneration >= n.genome.birthGeneration
        : bundle.fromGeneration === 0 && n.genome.parentIds.length > 0
    )
      throw new Error("Missing or invalid ancestry");
    reconstructGenome(n.genome.id, (id) => nodes.get(id));
    if (parent && n.genome.mutation) {
      const parameters = reconstructGenome(parent.genome.id, (id) =>
        nodes.get(id),
      ).parameters;
      for (const change of n.genome.mutation.changes)
        parameters[change.index] = change.value;
      if (parameterHash(parameters) !== n.genome.parameterHash)
        throw new Error("Lineage mutation patch omits a parameter change");
    }
  }
  for (const g of checkpoint.population) {
    if (
      contentHash(reconstructGenome(g.id, (id) => nodes.get(id))) !==
      contentHash(g)
    )
      throw new Error("Lineage does not match the population");
  }
  bundle.generations.forEach((r, index) => {
    const count = checkpoint.definition.evolution.population;
    if (
      r.generation !== bundle.fromGeneration + index ||
      !digest(r.commitId) ||
      !Array.isArray(r.populationIds) ||
      r.populationIds.length !== count ||
      new Set(r.populationIds).size !== count ||
      !r.populationIds.includes(r.championId) ||
      !Array.isArray(r.scenarios) ||
      r.scenarios.length !== checkpoint.definition.evolution.trials ||
      !Array.isArray(r.trials) ||
      r.trials.length !== count ||
      !Array.isArray(r.totals) ||
      r.totals.length !== count ||
      !Array.isArray(r.validationScenarios) ||
      !Array.isArray(r.validation) ||
      r.validationScenarios.length !== r.validation.length ||
      r.validation.length > 16 ||
      Object.keys(r).some(
        (k) =>
          ![
            "generation",
            "populationIds",
            "scenarios",
            "trials",
            "totals",
            "championId",
            "validationScenarios",
            "validation",
            "commitId",
          ].includes(k),
      )
    )
      throw new Error("Invalid lineage generation");
    [...r.scenarios, ...r.validationScenarios].forEach((s) => {
      validateScenario(s);
      if (contentHash(s.config) !== contentHash(checkpoint.definition.world))
        throw new Error("Lineage scenario configuration mismatch");
    });
    const check = (
      result: GenerationRecord["validation"][number],
      genomeId: string,
      scenarioHash: string,
    ) => {
      const g = nodes.get(genomeId)?.genome,
        { hash: checksum, ...spec } = result.spec;
      if (
        !g ||
        g.birthGeneration > r.generation ||
        spec.engineVersion !== ENGINE_VERSION ||
        spec.objectiveVersion !== "food-v1" ||
        spec.intervention ||
        hash(spec) !== checksum ||
        spec.scenarioHash !== scenarioHash ||
        spec.controllerId !== genomeId ||
        spec.controllerVersion !== g.parameterHash ||
        !integer(result.foodCollected) ||
        result.foodCollected !== result.score ||
        result.foodCollected > checkpoint.definition.world.foodCount ||
        !integer(result.survivalTicks) ||
        result.survivalTicks < 1 ||
        result.survivalTicks > checkpoint.definition.world.maxTicks ||
        !integer(result.contactTicks) ||
        result.contactTicks > result.survivalTicks ||
        !Number.isFinite(result.distanceTravelled) ||
        result.distanceTravelled < 0 ||
        !Number.isFinite(result.remainingEnergy) ||
        result.remainingEnergy < 0 ||
        result.remainingEnergy > checkpoint.definition.world.maxEnergy ||
        !["timeLimit", "allFoodCollected", "energyExhausted"].includes(
          result.terminalReason,
        )
      )
        throw new Error("Invalid lineage evaluation");
    };
    r.trials.forEach((trials, slot) => {
      if (
        trials.length !== r.scenarios.length ||
        trials.reduce((sum, t) => sum + t.score, 0) !== r.totals[slot]
      )
        throw new Error("Invalid lineage trial totals");
      trials.forEach((t, trial) =>
        check(t, r.populationIds[slot], r.scenarios[trial].hash),
      );
    });
    r.validation.forEach((t, trial) =>
      check(t, r.championId, r.validationScenarios[trial].hash),
    );
    const { commitId, ...record } = r;
    const nextIds =
      bundle.generations[index + 1]?.populationIds ??
      checkpoint.population.map((g) => g.id);
    const population = nextIds.map((id) => {
      const n = nodes.get(id);
      if (!n) throw new Error("Missing next-generation lineage");
      return n.genome;
    });
    if (
      hash({
        record,
        nextCheckpoint: {
          ...checkpoint,
          generation: r.generation + 1,
          population,
          lastCommitId: null,
        },
      }) !== commitId
    )
      throw new Error("Lineage generation commit mismatch");
  });
  if (
    bundle.generations.length &&
    bundle.generations.at(-1)!.commitId !== checkpoint.lastCommitId
  )
    throw new Error("Lineage head does not match population");
}
