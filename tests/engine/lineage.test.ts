import { test, expect } from "vitest";
import {
  defineExperiment,
  initialCheckpoint,
  reproduce,
} from "../../src/core/evolution";
import { parameterHash } from "../../src/core/canonical";
import {
  retainGenome,
  reconstructGenome,
  type LineageNode,
} from "../../src/core/lineage";
import { encode, decode } from "../../src/core/codec";
import { ControllerComparisonRunner } from "../../src/core/comparison/controllers";
import { createEpisode } from "../../src/core/episode";
import { generateScenario } from "../../src/core/world/scenario";

function initial() {
  const d = defineExperiment("lineage");
  d.evolution.population = 4;
  d.evolution.elites = 1;
  d.evolution.immigrants = 0;
  d.world.maxTicks = 90;
  return initialCheckpoint(d);
}
test("sparse births reconstruct exact Float32 bits, retain dead descendants and bound anchor depth", () => {
  const cp = initial(),
    nodes = new Map<string, LineageNode>(),
    all = new Map(cp.population.map((g) => [g.id, g]));
  cp.population[0].parameters[240] = -0;
  cp.population[0].parameterHash = parameterHash(cp.population[0].parameters);
  for (const g of cp.population) nodes.set(g.id, retainGenome(g));
  for (let generation = 1; generation <= 21; generation++) {
    const next = reproduce(
      cp,
      cp.population.map((_, i) => i),
    );
    for (const g of next) {
      if (!nodes.has(g.id)) {
        const p = all.get(g.parentIds[0]);
        nodes.set(
          g.id,
          retainGenome(
            g,
            p ? { genome: p, node: nodes.get(p.id)! } : undefined,
          ),
        );
        all.set(g.id, g);
      }
    }
    cp.population = next;
    cp.generation++;
  }
  expect(nodes.size).toBeGreaterThan(cp.population.length * 10);
  expect([...nodes.values()].some((n) => n.storage.kind === "patch")).toBe(
    true,
  );
  for (const [id, g] of all) {
    expect(reconstructGenome(id, (k) => nodes.get(k))).toEqual(g);
    const n = nodes.get(id)!;
    expect(n.storage.depth).toBeLessThanOrEqual(16);
    if (g.birthGeneration % 10 === 0) expect(n.storage.kind).toBe("full");
  }
  const portable = decode(encode([...nodes])) as [string, LineageNode][];
  const restored = new Map(portable);
  expect(
    Object.is(
      reconstructGenome(cp.definition.id + ":g0:s0", (k) => restored.get(k))
        .parameters[240],
      -0,
    ),
  ).toBe(true);
  const child = [...nodes.values()].find((n) => n.storage.kind === "patch")!;
  const broken = structuredClone(child);
  broken.genome.mutation!.changes[0].value += 1;
  expect(() =>
    reconstructGenome(broken.genome.id, (k) =>
      k === broken.genome.id ? broken : nodes.get(k),
    ),
  ).toThrow();
  expect(() =>
    reconstructGenome(child.genome.id, (k) =>
      k === child.genome.id ? child : undefined,
    ),
  ).toThrow(/Missing/);
});
test("patch capture rejects an omitted change and reconstruction returns owned buffers", () => {
  const cp = initial(),
    parent = cp.population[0],
    child = structuredClone(parent);
  child.id = "child";
  child.birthGeneration = 1;
  child.origin = "mutation";
  child.parentIds = [parent.id];
  child.parameters[2] += 1;
  child.parameterHash = parameterHash(child.parameters);
  child.mutation = { seed: "a".repeat(64), changes: [] };
  const anchor = retainGenome(parent);
  expect(() => retainGenome(child, { node: anchor, genome: parent })).toThrow(
    /reconstruct/,
  );
  const reconstructed = reconstructGenome(parent.id, () => anchor);
  reconstructed.parameters[0] = 42;
  expect(parent.parameters[0]).not.toBe(42);
  expect(reconstructGenome(parent.id, () => anchor)).toEqual(parent);
});
test("parent and child run every shared scenario from tick zero without affecting source genomes", () => {
  const cp = initial(),
    next = reproduce(cp, [0, 1, 2, 3]),
    child = next.find((g) => g.origin === "mutation")!,
    parent = cp.population.find((g) => g.id === child.parentIds[0])!;
  const scenarios = ["one", "two"].map((seed) =>
      generateScenario(seed, cp.definition.world),
    ),
    before = encode([parent, child]);
  const run = (budget: number) => {
    const r = new ControllerComparisonRunner(parent, child, scenarios);
    while (!r.advance(budget)) {
      /* exact ticks */
    }
    return r.result()!;
  };
  const paired = run(7);
  expect(run(1)).toEqual(paired);
  paired.trials.forEach((t) => {
    expect(t.parent.trajectory[0]).toEqual(t.child.trajectory[0]);
    expect(t.parent.firstDecision.inputs).toEqual(t.child.firstDecision.inputs);
    for (const [g, arm] of [
      [parent, t.parent],
      [child, t.child],
    ] as const) {
      const r = createEpisode({
        scenario: t.scenario,
        controller: { kind: "neural", id: g.id, parameters: g.parameters },
      });
      r.advance(10000);
      expect(arm.result).toEqual(r.result());
    }
  });
  expect(encode([parent, child])).toBe(before);
  expect(
    () =>
      new ControllerComparisonRunner(
        cp.population.find((g) => g.id !== parent.id)!,
        child,
        scenarios,
      ),
  ).toThrow();
});
