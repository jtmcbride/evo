import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { hash } from "../src/core/canonical";
import { decode } from "../src/core/codec";
import {
  checkpointIdentity,
  type GenerationRecord,
} from "../src/core/experiment";
import {
  validateCheckpoint,
  type ExperimentCheckpoint,
} from "../src/core/evolution";
import { generateScenario } from "../src/core/world/scenario";
import {
  benchmarkDefinition,
  evaluationSeeds,
  protocolHash,
  mean,
} from "./benchmark-protocol";
import type { BenchmarkResult } from "./benchmark-runner";
const { values } = parseArgs({ options: { input: { type: "string" } } });
if (!values.input) throw new Error("Use --input DOWNLOADED_ARTIFACT_ROOT");
let trialCount = 0;
const sources = new Set<string>();
for (let run = 0; run < 20; run++) {
  const dir = join(values.input, `benchmark-open-v1-run-${run}`),
    report = JSON.parse(
      await readFile(join(dir, "report.json"), "utf8"),
    ) as BenchmarkResult;
  const definition = benchmarkDefinition(run);
  if (
    report.run !== run ||
    report.protocolHash !== protocolHash ||
    report.completedGenerations !== 200 ||
    hash(report.definition) !== hash(definition)
  )
    throw new Error(`Run ${run}: mixed protocol`);
  sources.add(report.sourceCommit);
  for (let generation = 0; generation < 200; generation++) {
    const record = JSON.parse(
      gunzipSync(
        await readFile(join(dir, `generation-${generation}.json.gz`)),
      ).toString(),
    ) as GenerationRecord;
    if (
      record.generation !== generation ||
      record.populationIds.length !== 128 ||
      new Set(record.populationIds).size !== 128 ||
      record.trials.length !== 128 ||
      record.totals.length !== 128 ||
      record.scenarios.length !== 3
    )
      throw new Error(
        `Run ${run}, generation ${generation}: incomplete raw records`,
      );
    const expectedMaps = Array.from({ length: 3 }, (_, i) =>
      generateScenario(
        hash(["world-v1", definition.roots.training, generation, i]),
        definition.world,
      ),
    );
    if (hash(record.scenarios) !== hash(expectedMaps))
      throw new Error("Training scenario mismatch");
    record.trials.forEach((trials, slot) => {
      if (
        trials.length !== 3 ||
        trials.some(
          (t, i) =>
            t.spec.scenarioHash !== record.scenarios[i].hash ||
            t.spec.controllerId !== record.populationIds[slot] ||
            t.score !== t.foodCollected ||
            !Number.isInteger(t.score) ||
            t.score < 0 ||
            t.score > 48,
        ) ||
        trials.reduce((a, t) => a + t.score, 0) !== record.totals[slot]
      )
        throw new Error("Raw score/membership mismatch");
      trialCount += trials.length;
    });
    const summary = report.summaries[generation];
    if (
      summary.generation !== generation ||
      summary.trainBest !== Math.max(...record.totals) / 3 ||
      summary.trainMean !== mean(record.totals) / 3 ||
      !record.populationIds.includes(record.championId) ||
      record.totals[record.populationIds.indexOf(record.championId)] !==
        Math.max(...record.totals)
    )
      throw new Error("Training-selected champion or summary mismatch");
    const expectedValidation =
      (generation + 1) % 10 === 0
        ? evaluationSeeds(run, "validation").map((seed) =>
            generateScenario(seed, definition.world),
          )
        : [];
    if (
      hash(record.validationScenarios) !== hash(expectedValidation) ||
      record.validation.length !== expectedValidation.length ||
      record.validation.some(
        (t, i) =>
          t.spec.controllerId !== record.championId ||
          t.spec.scenarioHash !== expectedValidation[i].hash,
      ) ||
      summary.validation !==
        (record.validation.length
          ? mean(record.validation.map((t) => t.score))
          : null)
    )
      throw new Error("Scheduled validation mismatch");
    if (generation === 199) {
      const cp = (
        decode(await readFile(join(dir, "checkpoint.evo"), "utf8")) as {
          checkpoint: ExperimentCheckpoint;
        }
      ).checkpoint;
      validateCheckpoint(cp);
      if (
        cp.generation !== 200 ||
        cp.lastCommitId !== summary.commitId ||
        hash({
          record,
          nextCheckpoint: checkpointIdentity({ ...cp, lastCommitId: null }),
        }) !== summary.commitId
      )
        throw new Error("Final raw record/checkpoint commit mismatch");
    }
  }
  for (const kind of ["validation", "heldOut"] as const) {
    const expected = evaluationSeeds(run, kind).map(
      (seed) => generateScenario(seed, definition.world).hash,
    );
    const arms = Object.values(report.suites[kind]);
    if (
      arms.length !== 5 ||
      arms.some(
        (arm) =>
          arm.length !== expected.length ||
          arm.some((t, i) => t.spec.scenarioHash !== expected[i]),
      )
    )
      throw new Error("Endpoint suite mismatch");
  }
  console.log(JSON.stringify({ verifiedRun: run, generations: 200 }));
}
if (sources.size !== 1) throw new Error("Mixed source builds");
const evidence = {
  protocolHash,
  sourceCommit: [...sources][0],
  verifiedRuns: 20,
  verifiedGenerations: 4000,
  verifiedTrainingTrials: trialCount,
  checks: [
    "fresh frozen definitions",
    "rotating map seeds",
    "raw memberships and integer trial totals",
    "training-selected champions",
    "scheduled validation maps and scores",
    "final checkpoint/commit identity",
    "matched validation/held-out endpoint maps",
  ],
};
await writeFile(
  join(values.input, "verification.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
