import { test, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runBenchmark } from "../../scripts/benchmark-runner";
import {
  RELEASE_PROTOCOL,
  evaluationSeeds,
  representativeRun,
  quantile,
  type BenchmarkProtocol,
} from "../../scripts/benchmark-protocol";

test("release suites separate seeds and representative selection uses run medians with deterministic ties", () => {
  const namespaces = Array.from({ length: 20 }, (_, run) => [
    ...evaluationSeeds(run, "validation"),
    ...evaluationSeeds(run, "heldOut"),
  ]).flat();
  expect(new Set(namespaces).size).toBe(20 * (16 + 64));
  expect(() => evaluationSeeds(20, "heldOut")).toThrow();
  expect(quantile([2, 8, 4, 6], 0.5)).toBe(5);
  expect(
    representativeRun([
      { run: 3, finalValidation: 8 },
      { run: 1, finalValidation: 2 },
      { run: 2, finalValidation: 6 },
      { run: 0, finalValidation: 4 },
    ]),
  ).toBe(0);
});

test("benchmark preserves reproducible raw trials and scores all arms on matched held-out maps", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-benchmark-"));
  const p: BenchmarkProtocol = {
    ...structuredClone(RELEASE_PROTOCOL),
    id: "test-only-benchmark",
    runs: 1,
    generations: 2,
    heldOutTrials: 3,
    world: { ...RELEASE_PROTOCOL.world, maxTicks: 30 },
    evolution: {
      ...RELEASE_PROTOCOL.evolution,
      population: 16,
      validationTrials: 2,
      validationInterval: 1,
    },
  };
  try {
    const a = await runBenchmark(0, join(root, "a"), p),
      b = await runBenchmark(0, join(root, "b"), p);
    expect(a.completedGenerations).toBe(2);
    expect(a.summaries.map((x) => x.commitId)).toEqual(
      b.summaries.map((x) => x.commitId),
    );
    expect(a.suites).toEqual(b.suites);
    const raw = JSON.parse(
      gunzipSync(
        await readFile(join(root, "a", "generation-1.json.gz")),
      ).toString(),
    );
    expect(raw.trials).toHaveLength(16);
    expect(raw.trials.every((t: unknown[]) => t.length === 3)).toBe(true);
    const all = Object.values(a.suites.heldOut);
    expect(all).toHaveLength(5);
    expect(all.every((arm) => arm.length === 3)).toBe(true);
    for (const arm of all)
      expect(arm.map((t) => t.spec.scenarioHash)).toEqual(
        all[0].map((t) => t.spec.scenarioHash),
      );
    expect(a.suites.validation.final).toEqual(raw.validation);
    await expect(runBenchmark(0, join(root, "a"), p)).rejects.toThrow(
      "already contains",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
