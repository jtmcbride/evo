import { test, expect } from "vitest";
import {
  branchCheckpoint,
  validateOrigins,
  configDiff,
} from "../../src/core/branch";
import {
  branchSuites,
  BranchMatrixRunner,
  validateMatrix,
} from "../../src/core/branch/matrix";
import { defineExperiment, initialCheckpoint } from "../../src/core/evolution";
import { ExperimentRunner } from "../../src/core/experiment";
import {
  createEpisode,
  restoreEpisode,
  type EpisodeCheckpoint,
} from "../../src/core/episode";
import { ComparisonRunner, comparisonChoice } from "../../src/core/comparison";
import { parameterHash } from "../../src/core/canonical";
import { encode, decode } from "../../src/core/codec";
import { generateScenario } from "../../src/core/world/scenario";
import { DEFAULT_WORLD, type Genome } from "../../src/core/model";
function initial() {
  const d = defineExperiment("m9");
  Object.assign(d.evolution, {
    population: 4,
    elites: 1,
    immigrants: 1,
    trials: 2,
  });
  d.world.maxTicks = 90;
  return initialCheckpoint(d);
}
function generation(cp: ReturnType<typeof initial>) {
  const r = new ExperimentRunner(cp);
  while (r.phase !== "awaitingCommit") r.advance(10000);
  return r.pendingCommit()!;
}
function family() {
  const parent = initial().population[0];
  parent.parameters.fill(0);
  parent.parameters[16] = 1;
  parent.parameters[252] = 1;
  parent.parameterHash = parameterHash(parent.parameters);
  const child: Genome = {
    ...structuredClone(parent),
    id: "child",
    birthGeneration: 1,
    origin: "mutation",
    parentIds: [parent.id],
    mutation: { seed: "a".repeat(64), changes: [{ index: 252, value: 2 }] },
  };
  child.parameters[252] = 2;
  child.parameterHash = parameterHash(child.parameters);
  const episode = createEpisode({
    scenario: generateScenario("intervene", { ...DEFAULT_WORLD, maxTicks: 90 }),
    controller: { kind: "neural", id: child.id, parameters: child.parameters },
    trace: true,
  });
  episode.advance(1);
  return { parent, child, source: episode.checkpoint() };
}
test("hidden clamps replace post-tanh activation only at the next decision and restore exactly", () => {
  const { source } = family(),
    before = encode(source),
    runner = new ComparisonRunner(source, {
      kind: "hiddenClamp",
      neuron: 0,
      value: -1,
    });
  while (!runner.advance(11)) {
    /* exact ticks */
  }
  const record = runner.result()!,
    a = record.control.firstDecision,
    b = record.masked.firstDecision;
  expect(record.intervention.startTick).toBe(3);
  expect(b.inputs).toEqual(a.inputs);
  expect(b.rawHidden).toEqual(a.hidden);
  expect(b.hidden![0]).toBe(-1);
  expect(b.hidden!.slice(1)).toEqual(a.hidden!.slice(1));
  expect(b.outputs[0]).toBe(Math.tanh(-2));
  expect(encode(source)).toBe(before);
  const cp = structuredClone(source);
  cp.definition.intervention = record.intervention;
  const e = restoreEpisode(cp);
  e.advance(13);
  const restored = restoreEpisode(
    decode(encode(e.checkpoint())) as EpisodeCheckpoint,
  );
  e.advance(10000);
  restored.advance(10000);
  expect(restored.checkpoint()).toEqual(e.checkpoint());
});
test("parent restoration uses actual Float32 parent data without mutating either genome", () => {
  const { source, parent, child } = family(),
    before = encode([parent, child]),
    r = new ComparisonRunner(source, {
      kind: "parentWeight",
      parameter: 252,
      restoration: { parent, child },
    });
  while (!r.advance(13)) {
    /* exact ticks */
  }
  const record = r.result()!;
  expect(
    record.intervention.kind === "parentWeight" && record.intervention.value,
  ).toBe(1);
  expect(record.control.firstDecision.inputs).toEqual(
    record.masked.firstDecision.inputs,
  );
  expect(record.masked.firstDecision.outputs[0]).toBe(
    Math.tanh(record.masked.firstDecision.hidden![0]),
  );
  expect(encode([parent, child])).toBe(before);
  const replay = new ComparisonRunner(record.source, comparisonChoice(record));
  while (!replay.advance(1)) {
    /* arbitrary chunk */
  }
  expect(replay.result()).toEqual(record);
  expect(
    () =>
      new ComparisonRunner(source, {
        kind: "parentWeight",
        parameter: 252,
        restoration: { parent: { ...parent, id: "unrelated" }, child },
      }),
  ).toThrow(/actual parent/);
  expect(
    () =>
      new ComparisonRunner(source, {
        kind: "hiddenClamp",
        neuron: 12,
        value: 0,
      }),
  ).toThrow();
});
test("paired branches preserve generation, roots, membership and numerical randomness with separate birth IDs", () => {
  const cp = generation(initial()).nextCheckpoint,
    before = encode(cp),
    definition = structuredClone(cp.definition);
  definition.id = "branch-a";
  const fork = branchCheckpoint(cp, definition, "source-local", "Source");
  validateOrigins([fork.origin], fork.checkpoint);
  expect(fork.checkpoint.population).toEqual(cp.population);
  expect(configDiff(cp.definition, definition)).toEqual([]);
  const source = generation(cp),
    branch = generation(fork.checkpoint);
  expect(branch.record.trials).toEqual(source.record.trials);
  expect(branch.nextCheckpoint.population.map((g) => g.parameterHash)).toEqual(
    source.nextCheckpoint.population.map((g) => g.parameterHash),
  );
  expect(branch.nextCheckpoint.population[1].id).not.toBe(
    source.nextCheckpoint.population[1].id,
  );
  expect(encode(cp)).toBe(before);
  const other = structuredClone(definition);
  other.roots.training = "unpaired";
  expect(() => branchCheckpoint(cp, other, "source", "Source")).toThrow(
    /paired/,
  );
  expect(() =>
    branchCheckpoint(
      { ...cp, phase: "evaluating" } as unknown as typeof cp,
      definition,
      "source",
      "Source",
    ),
  ).toThrow();
});
test("branch world differences are explicit while shared schedule seeds remain paired", () => {
  const cp = initial(),
    definition = structuredClone(cp.definition);
  definition.id = "branch-world";
  definition.world.sensorRange = 70;
  definition.world.foodCount = 24;
  definition.world.bodyRadius = 10;
  const fork = branchCheckpoint(cp, definition, "source", "Source");
  expect(fork.origin.changes).toHaveLength(3);
  const a = generation(cp),
    b = generation(fork.checkpoint);
  expect(a.record.scenarios.map((s) => s.seed)).toEqual(
    b.record.scenarios.map((s) => s.seed),
  );
  expect(a.record.scenarios[0].hash).not.toBe(b.record.scenarios[0].hash);
  const invalid = structuredClone(fork.origin);
  invalid.changes = [];
  expect(() => validateOrigins([invalid], fork.checkpoint)).toThrow(/diff/);
});
test("every matrix cell evaluates its champion on the referenced common suite", () => {
  const cp = initial(),
    source = generation(cp),
    definition = structuredClone(cp.definition);
  definition.id = "branch-matrix";
  definition.world.sensorRange = 60;
  const fork = branchCheckpoint(cp, definition, "local", "Source"),
    branch = generation(fork.checkpoint);
  const selected = (
    record: typeof source,
    checkpoint: typeof cp,
    name: string,
  ) => ({
    experimentId: checkpoint.definition.id,
    name,
    generation: record.record.generation,
    genome: checkpoint.population.find(
      (g) => g.id === record.record.championId,
    )!,
  });
  const input = {
    controllers: [
      selected(source, cp, "Source"),
      selected(branch, fork.checkpoint, "Branch"),
    ],
    suites: branchSuites("common", cp.definition.world, definition.world, 2),
  };
  const run = (budget: number) => {
    const r = new BranchMatrixRunner(input);
    while (!r.advance(budget)) {
      /* exact jobs */
    }
    return r.result()!;
  };
  const matrix = run(17);
  expect(run(1)).toEqual(matrix);
  validateMatrix(matrix);
  expect(matrix.cells).toHaveLength(4);
  for (const cell of matrix.cells)
    cell.results.forEach((result, i) => {
      const g = input.controllers[cell.controller].genome,
        e = createEpisode({
          scenario: input.suites[cell.suite].scenarios[i],
          controller: { kind: "neural", id: g.id, parameters: g.parameters },
        });
      e.advance(10000);
      expect(result).toEqual(e.result());
    });
  const corrupt = structuredClone(matrix);
  corrupt.cells[0].suiteId = matrix.suites[1].id;
  expect(() => validateMatrix(corrupt)).toThrow(/references/);
});
