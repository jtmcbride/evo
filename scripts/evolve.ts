import { readFile } from "node:fs/promises";
import { FileCommitStore } from "./filesystem-store";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { args } from "./args";
import { decode } from "../src/core/codec";
import {
  defineExperiment,
  initialCheckpoint,
  type ExperimentCheckpoint,
} from "../src/core/evolution";
import { ExperimentRunner } from "../src/core/experiment";
const a = args();
if (!["open-v1", "obstacles-v1"].includes(a.preset))
  throw new Error("Unsupported preset");
const generations = Number(a.generations);
if (!Number.isInteger(generations) || generations < 1)
  throw new Error("Invalid generation count");
const runtime = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
};
let checkpoint: ExperimentCheckpoint;
if (a.resume) {
  const saved = decode(await readFile(a.resume, "utf8")) as {
    runtime: typeof runtime;
    checkpoint: ExperimentCheckpoint;
  };
  if (JSON.stringify(saved.runtime) !== JSON.stringify(runtime))
    throw new Error(
      "Checkpoint runtime differs; exact continuation is unsupported",
    );
  checkpoint = saved.checkpoint;
} else {
  const d = defineExperiment(a.seed, a.preset === "obstacles-v1");
  if (a.population) {
    d.evolution.population = Number(a.population);
    d.evolution.elites = Math.min(4, d.evolution.population);
    d.evolution.immigrants = Math.min(
      8,
      Math.max(0, d.evolution.population - d.evolution.elites),
    );
  }
  if (a.ticks) d.world.maxTicks = Number(a.ticks);
  checkpoint = initialCheckpoint(d);
}
const out = a.out ?? (a.resume ? dirname(a.resume) : `artifacts/run-${a.seed}`);
const runner = new ExperimentRunner(checkpoint),
  start = performance.now();
const store = await FileCommitStore.open(out, runtime, checkpoint, !!a.resume);
try {
  for (let i = 0; i < generations; i++) {
    while (runner.phase !== "awaitingCommit") runner.advance(10000);
    const commit = runner.pendingCommit()!;
    await store.put(commit);
    runner.acknowledge(commit.id);
    console.log(
      JSON.stringify({
        generation: commit.record.generation,
        best:
          Math.max(...commit.record.totals) /
          checkpoint.definition.evolution.trials,
        mean:
          commit.record.totals.reduce((s, x) => s + x, 0) /
          commit.record.totals.length /
          checkpoint.definition.evolution.trials,
        validationMean: commit.record.validation.length
          ? commit.record.validation.reduce((s, t) => s + t.score, 0) /
            commit.record.validation.length
          : null,
        commitId: commit.id,
      }),
    );
  }
  console.log(
    JSON.stringify({
      checkpoint: join(out, "checkpoint.evo"),
      elapsedSeconds: (performance.now() - start) / 1000,
      runtime,
    }),
  );
} finally {
  await store.close();
}
