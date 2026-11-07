import { mkdir, writeFile, rename, access } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { hash } from "../src/core/canonical";
import { encode } from "../src/core/codec";
import { initialCheckpoint } from "../src/core/evolution";
import {
  ExperimentRunner,
  type GenerationRecord,
} from "../src/core/experiment";
import { createEpisode } from "../src/core/episode";
import { generateScenario } from "../src/core/world/scenario";
import type { ControllerDefinition } from "../src/core/controller";
import type { Genome } from "../src/core/model";
import {
  RELEASE_PROTOCOL,
  benchmarkDefinition,
  evaluationSeeds,
  mean,
  quantile,
  type BenchmarkProtocol,
} from "./benchmark-protocol";

export async function runBenchmark(
  run: number,
  out: string,
  p: BenchmarkProtocol = RELEASE_PROTOCOL,
) {
  await mkdir(out, { recursive: true });
  try {
    await access(`${out}/manifest.json`);
    throw new Error(
      "Benchmark directory already contains a run; use a new directory",
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const definition = benchmarkDefinition(run, p),
    initial = initialCheckpoint(definition),
    runner = new ExperimentRunner(initial);
  const manifest = {
    protocol: p,
    protocolHash: hash(p),
    run,
    definition,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    startedAt: new Date().toISOString(),
    workflowRun: process.env.GITHUB_RUN_ID ?? null,
    workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
    },
  };
  await writeFile(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  const atomic = async (name: string, data: string | Uint8Array) => {
    await writeFile(`${out}/${name}.tmp`, data);
    await rename(`${out}/${name}.tmp`, `${out}/${name}`);
  };
  const evaluate = (
    controller: ControllerDefinition,
    kind: "validation" | "heldOut",
  ) =>
    evaluationSeeds(run, kind, p).map((seed) => {
      const episode = createEpisode({
        scenario: generateScenario(seed, definition.world),
        controller,
      });
      episode.advance(definition.world.maxTicks);
      return episode.result()!;
    });
  const neural = (g: Genome): ControllerDefinition => ({
    kind: "neural",
    id: g.id,
    parameters: g.parameters,
  });
  const summaries: {
    generation: number;
    trainBest: number;
    trainMean: number;
    validation: number | null;
    commitId: string;
    computeSeconds: number;
    commitSeconds: number;
    rssBytes: number;
    heapBytes: number;
  }[] = [];
  let first: { genome: Genome; record: GenerationRecord } | null = null,
    last: { genome: Genome; record: GenerationRecord } | null = null;
  let initialValidation: ReturnType<typeof evaluate> = [];
  const started = performance.now();
  try {
    for (let generation = 0; generation < p.generations; generation++) {
      const before = performance.now(),
        population = runner.checkpoint().population;
      while (runner.phase !== "awaitingCommit") runner.advance(10000);
      const commit = runner.pendingCommit()!,
        genome = population.find((g) => g.id === commit.record.championId)!;
      const computeSeconds = (performance.now() - before) / 1000,
        saving = performance.now();
      // Full raw trial records and map definitions, compressed without changing numbers.
      await atomic(
        `generation-${generation}.json.gz`,
        gzipSync(JSON.stringify(commit.record)),
      );
      await atomic(
        "checkpoint.evo",
        encode({
          runtime: manifest.runtime,
          checkpoint: commit.nextCheckpoint,
        }),
      );
      const commitSeconds = (performance.now() - saving) / 1000;
      runner.acknowledge(commit.id);
      const memory = process.memoryUsage();
      summaries.push({
        generation,
        trainBest:
          Math.max(...commit.record.totals) / definition.evolution.trials,
        trainMean: mean(commit.record.totals) / definition.evolution.trials,
        validation: commit.record.validation.length
          ? mean(commit.record.validation.map((t) => t.score))
          : null,
        commitId: commit.id,
        computeSeconds,
        commitSeconds,
        rssBytes: memory.rss,
        heapBytes: memory.heapUsed,
      });
      if (generation === 0) {
        first = { genome, record: commit.record };
        initialValidation = evaluate(neural(genome), "validation");
      }
      last = { genome, record: commit.record };
      if ((generation + 1) % 10 === 0) {
        await atomic(
          "progress.json",
          JSON.stringify({ completed: generation + 1, summaries }),
        );
        console.log(
          JSON.stringify({
            run,
            completed: generation + 1,
            trainBest: summaries.at(-1)!.trainBest,
          }),
        );
      }
    }
    // Held-out maps are evaluated only after all selection/training is finished.
    const arms = {
      initial: neural(first!.genome),
      final: neural(last!.genome),
      frozenRandom: neural(initial.population[0]),
      randomActions: {
        kind: "random",
        id: "random-v1",
        seed: `${p.id}:baseline-${run}`,
      } as ControllerDefinition,
      scripted: { kind: "scripted", id: "scripted-v1" } as ControllerDefinition,
    };
    const suites = Object.fromEntries(
      (["validation", "heldOut"] as const).map((kind) => [
        kind,
        Object.fromEntries(
          Object.entries(arms).map(([arm, controller]) => [
            arm,
            kind === "validation" && arm === "initial"
              ? initialValidation
              : evaluate(controller, kind),
          ]),
        ),
      ]),
    ) as Record<
      "validation" | "heldOut",
      Record<keyof typeof arms, ReturnType<typeof evaluate>>
    >;
    const initialMean = mean(initialValidation.map((t) => t.score)),
      finalMean = mean(suites.validation.final.map((t) => t.score));
    const firstImprovement =
      summaries.find((s) => s.validation !== null && s.validation > initialMean)
        ?.generation ?? null;
    const result = {
      ...manifest,
      completedAt: new Date().toISOString(),
      completedGenerations: summaries.length,
      elapsedSeconds: (performance.now() - started) / 1000,
      initialValidation: initialMean,
      finalValidation: finalMean,
      pairedImprovement: finalMean - initialMean,
      firstScheduledImprovementGeneration: firstImprovement,
      initialNonzeroFraction:
        first!.record.totals.filter((x) => x > 0).length /
        definition.evolution.population,
      generationSeconds: {
        median: quantile(
          summaries.map((s) => s.computeSeconds),
          0.5,
        ),
        p95: quantile(
          summaries.map((s) => s.computeSeconds),
          0.95,
        ),
      },
      commitSeconds: {
        median: quantile(
          summaries.map((s) => s.commitSeconds),
          0.5,
        ),
        p95: quantile(
          summaries.map((s) => s.commitSeconds),
          0.95,
        ),
      },
      suites,
      summaries,
    };
    await atomic(
      "endpoints.evo",
      encode({ initial: first, final: last, checkpoint: runner.checkpoint() }),
    );
    await atomic("report.json", JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        run,
        initialValidation: initialMean,
        finalValidation: finalMean,
        elapsedSeconds: result.elapsedSeconds,
      }),
    );
    return result;
  } catch (error) {
    await atomic(
      "failure.json",
      JSON.stringify({
        run,
        completedGenerations: summaries.length,
        error: String(error),
        at: new Date().toISOString(),
      }),
    );
    throw error;
  }
}
export type BenchmarkResult = Awaited<ReturnType<typeof runBenchmark>>;
