import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { args } from "./args";
import { defineExperiment, initialCheckpoint } from "../src/core/evolution";
import { ExperimentRunner } from "../src/core/experiment";
import { createEpisode } from "../src/core/episode";
import { generateScenario } from "../src/core/world/scenario";
import type { ControllerDefinition } from "../src/core/controller";
import { hash } from "../src/core/canonical";
import { encode } from "../src/core/codec";
const a = args(),
  runs = Number(a.runs ?? 5),
  generations = Number(a.generations),
  out = a.out ?? "artifacts/pilot";
if (
  !Number.isInteger(runs) ||
  runs < 1 ||
  !Number.isInteger(generations) ||
  generations < 1
)
  throw new Error("Invalid pilot dimensions");
await mkdir(out, { recursive: true });
const report = {
  purpose: "Exploratory task-design pilot; not a held-out benchmark",
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
  },
  runs: [] as unknown[],
};
for (let run = 0; run < runs; run++) {
  const d = defineExperiment(`pilot-v1-${run}`, a.preset === "obstacles-v1");
  if (a.ticks) d.world.maxTicks = Number(a.ticks);
  const initial = initialCheckpoint(d),
    runner = new ExperimentRunner(initial),
    summaries = [],
    times: number[] = [];
  const evaluate = (controller: ControllerDefinition) =>
    Array.from({ length: 16 }, (_, i) => {
      const scenario = generateScenario(
          hash(["validation-v1", d.roots.validation, i]),
          d.world,
        ),
        episode = createEpisode({ scenario, controller });
      episode.advance(d.world.maxTicks);
      return episode.result()!.score;
    }).reduce((sum, v) => sum + v, 0) / 16;
  let initialValidation = 0,
    initialNonzeroFraction = 0,
    finalValidation = 0;
  for (let generation = 0; generation < generations; generation++) {
    const start = performance.now(),
      population = runner.checkpoint().population;
    while (runner.phase !== "awaitingCommit") runner.advance(10000);
    const commit = runner.pendingCommit()!,
      champion = population.find((g) => g.id === commit.record.championId)!;
    times.push((performance.now() - start) / 1000);
    if (generation === 0) {
      initialValidation = evaluate({
        kind: "neural",
        id: champion.id,
        parameters: champion.parameters,
      });
      initialNonzeroFraction =
        commit.record.totals.filter((v) => v > 0).length /
        d.evolution.population;
    }
    if (generation === generations - 1)
      finalValidation = evaluate({
        kind: "neural",
        id: champion.id,
        parameters: champion.parameters,
      });
    summaries.push({
      generation,
      trainBest: Math.max(...commit.record.totals) / d.evolution.trials,
      trainMean:
        commit.record.totals.reduce((sum, v) => sum + v, 0) /
        d.evolution.population /
        d.evolution.trials,
      validation: commit.record.validation.map((t) => t.score),
      commitId: commit.id,
    });
    runner.acknowledge(commit.id);
    if ((generation + 1) % 10 === 0)
      console.log(
        JSON.stringify({
          run,
          completed: generation + 1,
          trainBest: summaries.at(-1)!.trainBest,
        }),
      );
  }
  const sorted = [...times].sort((a, b) => a - b),
    result = {
      run,
      definition: d,
      initialValidation,
      finalValidation,
      initialNonzeroFraction,
      baselines: {
        frozenRandom: evaluate({
          kind: "neural",
          id: initial.population[0].id,
          parameters: initial.population[0].parameters,
        }),
        randomActions: evaluate({
          kind: "random",
          id: "random-v1",
          seed: `pilot-baseline-${run}`,
        }),
        scripted: evaluate({ kind: "scripted", id: "scripted-v1" }),
      },
      generationSeconds: {
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
        ],
      },
      summaries,
    };
  report.runs.push(result);
  await writeFile(
    `${out}/run-${run}-checkpoint.evo`,
    encode({
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      checkpoint: runner.checkpoint(),
    }),
  );
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      run,
      initialValidation,
      finalValidation,
      generationSeconds: result.generationSeconds,
    }),
  );
}
