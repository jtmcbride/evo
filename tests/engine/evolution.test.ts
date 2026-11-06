import { test, expect } from "vitest";
import {
  defineExperiment,
  initialCheckpoint,
  reproduce,
  type ExperimentCheckpoint,
} from "../../src/core/evolution";
import {
  ExperimentRunner,
  MemoryCommitStore,
  checkpointIdentity,
} from "../../src/core/experiment";
import { encode, decode } from "../../src/core/codec";
import { hash, parameterHash } from "../../src/core/canonical";
function small() {
  const d = defineExperiment("test");
  Object.assign(d.evolution, {
    population: 8,
    elites: 2,
    immigrants: 1,
    trials: 2,
    validationInterval: 1,
    validationTrials: 2,
  });
  d.world.maxTicks = 90;
  return initialCheckpoint(d);
}
function finish(r: ExperimentRunner, budget = 137) {
  while (r.phase !== "awaitingCommit") r.advance(budget);
  return r.pendingCommit()!;
}
test("shuffled evaluations and tick budgets preserve all reproduction and validation", () => {
  const cp = small(),
    before = encode(cp),
    a = new ExperimentRunner(cp),
    b = new ExperimentRunner(cp, [7, 2, 6, 0, 5, 1, 4, 3]);
  const x = finish(a),
    y = finish(b, 1);
  expect(x).toEqual(y);
  expect(encode(cp)).toBe(before);
  expect(x.record.validation).toHaveLength(2);
  for (let t = 0; t < 2; t++)
    expect(
      new Set(x.record.trials.map((r) => r[t].spec.scenarioHash)).size,
    ).toBe(1);
  const eliteIds = x.nextCheckpoint.population.slice(0, 2).map((g) => g.id);
  expect(eliteIds.every((id) => cp.population.some((g) => g.id === id))).toBe(
    true,
  );
  expect(x.nextCheckpoint.population[7].origin).toBe("immigrant");
});
test("durable restore, acknowledgment barrier and memory store", () => {
  const a = new ExperimentRunner(small()),
    store = new MemoryCommitStore(),
    first = finish(a);
  expect(a.advance(100)).toBe(0);
  expect(a.checkpoint().generation).toBe(0);
  expect(() => a.acknowledge("wrong")).toThrow();
  store.put(first);
  expect(store.get(first.id)).toEqual(first);
  a.acknowledge(first.id);
  a.acknowledge(first.id);
  const cp = decode(encode(a.checkpoint())) as ExperimentCheckpoint;
  const b = new ExperimentRunner(cp);
  expect(finish(a, 13)).toEqual(finish(b, 999));
  expect(hash(checkpointIdentity(a.checkpoint()))).toBe(
    hash(checkpointIdentity(b.checkpoint())),
  );
});
test("mutation patches reconstruct children and preserve their parents", () => {
  const cp = small();
  cp.definition.evolution.mutationProbability = 1;
  const before = encode(cp),
    next = reproduce(cp, [0, 1, 2, 3, 4, 5, 6, 7]);
  expect(encode(cp)).toBe(before);
  for (const child of next.filter((g) => g.origin === "mutation")) {
    const parent = cp.population.find((g) => g.id === child.parentIds[0])!;
    const weights = parent.parameters.slice();
    for (const patch of child.mutation!.changes)
      weights[patch.index] = patch.value;
    expect(parameterHash(weights)).toBe(child.parameterHash);
    expect(child.parameters.buffer).not.toBe(parent.parameters.buffer);
  }
  cp.definition.evolution.mutationProbability = 0;
  for (const child of reproduce(cp, [0, 0, 0, 0, 0, 0, 0, 0]).filter(
    (g) => g.origin === "mutation",
  )) {
    expect(child.mutation?.changes).toHaveLength(0);
    expect(child.id).not.toBe(child.parentIds[0]);
  }
});
test("malformed configuration and tampered checkpoint are rejected", () => {
  const cp = small();
  cp.population[0].parameters[0] += 1;
  expect(() => new ExperimentRunner(cp)).toThrow("Invalid genome");
  const d = defineExperiment();
  d.evolution.elites = 999;
  expect(() => initialCheckpoint(d)).toThrow();
});

test("training scenarios rotate while validation scenarios remain fixed", () => {
  const runner = new ExperimentRunner(small()),
    first = finish(runner);
  runner.acknowledge(first.id);
  const second = finish(runner);
  expect(first.record.scenarios.map((s) => s.hash)).not.toEqual(
    second.record.scenarios.map((s) => s.hash),
  );
  expect(first.record.validationScenarios.map((s) => s.hash)).toEqual(
    second.record.validationScenarios.map((s) => s.hash),
  );
});
