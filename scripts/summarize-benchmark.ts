import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { join } from "node:path";
import {
  RELEASE_PROTOCOL,
  protocolHash,
  quantile,
  mean,
  representativeRun,
  evaluationSeeds,
} from "./benchmark-protocol";
import type { BenchmarkResult } from "./benchmark-runner";
const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string", default: "docs/benchmarks" },
  },
});
if (!values.input)
  throw new Error("Use --input ROOT_CONTAINING_DOWNLOADED_RUN_DIRECTORIES");
const runs: BenchmarkResult[] = [],
  failures: { run: number; error: string }[] = [];
for (let run = 0; run < 20; run++) {
  try {
    const result = JSON.parse(
      await readFile(
        join(values.input, `benchmark-open-v1-run-${run}`, "report.json"),
        "utf8",
      ),
    ) as BenchmarkResult;
    if (
      result.run !== run ||
      result.protocolHash !== protocolHash ||
      result.completedGenerations !== 200 ||
      result.summaries.length !== 200
    )
      throw new Error("Incomplete or mismatched protocol");
    if (new Set(result.summaries.map((r) => r.generation)).size !== 200)
      throw new Error("Duplicate generations");
    for (const [suite, count] of [
      ["validation", 16],
      ["heldOut", 64],
    ] as const) {
      const arms = Object.values(result.suites[suite]);
      if (arms.length !== 5 || arms.some((arm) => arm.length !== count))
        throw new Error("Incomplete endpoint evaluations");
      const expected = arms[0].map((t) => t.spec.scenarioHash);
      if (
        arms.some((arm) =>
          arm.some((t, i) => t.spec.scenarioHash !== expected[i]),
        )
      )
        throw new Error("Unmatched endpoint maps");
    }
    runs.push(result);
  } catch (e) {
    failures.push({ run, error: String(e) });
  }
}
if (new Set(runs.map((r) => r.sourceCommit)).size > 1)
  throw new Error("Mixed benchmark source commits");
const compact = runs.map((r) => ({
  ...r,
  suites: Object.fromEntries(
    Object.entries(r.suites).map(([suite, arms]) => [
      suite,
      Object.fromEntries(
        Object.entries(arms).map(([arm, results]) => [
          arm,
          {
            mean: mean(results.map((t) => t.score)),
            scores: results.map((t) => t.score),
            scenarioHashes: results.map((t) => t.spec.scenarioHash),
          },
        ]),
      ),
    ]),
  ),
}));
const spread = (xs: number[]) => ({
  mean: mean(xs),
  median: quantile(xs, 0.5),
  q1: quantile(xs, 0.25),
  q3: quantile(xs, 0.75),
  min: Math.min(...xs),
  max: Math.max(...xs),
});
if (!runs.length) throw new Error("No completed benchmark runs");
const held = (
  r: BenchmarkResult,
  arm: keyof BenchmarkResult["suites"]["heldOut"],
) => mean(r.suites.heldOut[arm].map((t) => t.score));
const aggregate = {
  validation: {
    initial: spread(runs.map((r) => r.initialValidation)),
    final: spread(runs.map((r) => r.finalValidation)),
    paired: spread(runs.map((r) => r.pairedImprovement)),
    improved: runs.filter((r) => r.pairedImprovement > 0).length,
    nonImproving: runs.filter((r) => r.pairedImprovement <= 0).length,
  },
  heldOut: {
    initial: spread(runs.map((r) => held(r, "initial"))),
    final: spread(runs.map((r) => held(r, "final"))),
    paired: spread(runs.map((r) => held(r, "final") - held(r, "initial"))),
    improved: runs.filter((r) => held(r, "final") > held(r, "initial")).length,
  },
  baselineWins: Object.fromEntries(
    (["validation", "heldOut"] as const).map((suite) => [
      suite,
      Object.fromEntries(
        (["frozenRandom", "randomActions", "scripted"] as const).map((b) => [
          b,
          runs.filter(
            (r) =>
              mean(r.suites[suite].final.map((t) => t.score)) >
              mean(r.suites[suite][b].map((t) => t.score)),
          ).length,
        ]),
      ),
    ]),
  ),
  firstScheduledImprovement: {
    notObserved: runs.filter(
      (r) => r.firstScheduledImprovementGeneration === null,
    ).length,
    indices: runs.map((r) => r.firstScheduledImprovementGeneration),
  },
  computeSeconds: runs.reduce((a, r) => a + r.elapsedSeconds, 0),
  generationSeconds: spread(
    runs.flatMap((r) => r.summaries.map((s) => s.computeSeconds)),
  ),
  generationP95: quantile(
    runs.flatMap((r) => r.summaries.map((s) => s.computeSeconds)),
    0.95,
  ),
  saveSeconds: spread(
    runs.flatMap((r) => r.summaries.map((s) => s.commitSeconds)),
  ),
  rssBytes: {
    peak: Math.max(...runs.flatMap((r) => r.summaries.map((s) => s.rssBytes))),
    perRunChange: runs.map((r) => ({
      run: r.run,
      change: r.summaries.at(-1)!.rssBytes - r.summaries[0].rssBytes,
    })),
  },
  representativeRun: failures.length ? null : representativeRun(runs),
};
let execution: {
  id: number;
  url: string;
  startedAt: string;
  completedAt: string;
  workflowWallSeconds: number;
} | null = null;
try {
  const workflow = JSON.parse(
    await readFile(join(values.input, "workflow.json"), "utf8"),
  );
  execution = {
    id: workflow.id,
    url: workflow.html_url,
    startedAt: workflow.run_started_at,
    completedAt: workflow.updated_at,
    workflowWallSeconds:
      (Date.parse(workflow.updated_at) - Date.parse(workflow.run_started_at)) /
      1000,
  };
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const report = {
  execution,
  protocol: RELEASE_PROTOCOL,
  protocolHash,
  sourceCommit: runs[0].sourceCommit,
  complete: failures.length === 0,
  technicalFailures: failures,
  aggregate,
  evaluationSeedPolicy: {
    validation: evaluationSeeds(0, "validation"),
    heldOut: evaluationSeeds(0, "heldOut"),
    note: "Run-0 seeds shown; regenerate all runs with evaluationSeeds(run,kind). Scenario hashes for every endpoint arm are preserved below.",
  },
  runs: compact,
};
await mkdir(values.out!, { recursive: true });
await writeFile(
  join(values.out!, "benchmark-open-v1.json"),
  JSON.stringify(report, null, 2) + "\n",
);
const f = (n: number) => n.toFixed(3),
  s = aggregate;
const rows = runs
  .map(
    (r) =>
      `| ${r.run} | ${f(r.initialValidation)} | ${f(r.finalValidation)} | ${f(r.pairedImprovement)} | ${f(held(r, "initial"))} | ${f(held(r, "final"))} | ${r.firstScheduledImprovementGeneration ?? "not observed"} | ${f(r.elapsedSeconds)} |`,
  )
  .join("\n");
const text = `# Frozen open-arena benchmark\n\nProtocol [benchmark-open-v1](benchmark-open-v1-protocol.md), SHA-256 \`${protocolHash}\`, source commit \`${runs[0].sourceCommit}\`. ${runs.length}/20 runs completed 200 generations; ${failures.length} technical failures. ${failures.length ? "Incomplete results must not be treated as a finished release benchmark." : "All 4,000 evaluated generations completed."}\n\nAll scores are mean food collected per episode. Initial/final champions were selected only by generation-0/generation-199 training totals. Each run uses 16 fixed validation maps and 64 distinct endpoint-only held-out maps; reproduction never sees those scores. These fresh seeds were frozen before execution.\n\n| Run | Initial validation | Final validation | Paired change | Initial held-out | Final held-out | First observed improvement (generation index) | Run seconds |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\nValidation improved in ${s.validation.improved}/${runs.length} runs; ${s.validation.nonImproving}/${runs.length} did not improve. Across-run means: ${f(s.validation.initial.mean)} → ${f(s.validation.final.mean)}. Final median ${f(s.validation.final.median)}, IQR ${f(s.validation.final.q1)}–${f(s.validation.final.q3)}, range ${f(s.validation.final.min)}–${f(s.validation.final.max)}. Median paired improvement ${f(s.validation.paired.median)}, IQR ${f(s.validation.paired.q1)}–${f(s.validation.paired.q3)}, range ${f(s.validation.paired.min)}–${f(s.validation.paired.max)}.\n\nHeld-out improvement: ${s.heldOut.improved}/${runs.length}. Across-run means ${f(s.heldOut.initial.mean)} → ${f(s.heldOut.final.mean)}; median paired change ${f(s.heldOut.paired.median)}, IQR ${f(s.heldOut.paired.q1)}–${f(s.heldOut.paired.q3)}, range ${f(s.heldOut.paired.min)}–${f(s.heldOut.paired.max)}. Held-out maps were generated/evaluated after training and did not choose the example. They share the same open-arena distribution; this does not establish obstacle-world or out-of-distribution generalization.\n\nFinal champions strictly exceeded frozen random networks / random actions / the scripted controller in ${s.baselineWins.validation.frozenRandom} / ${s.baselineWins.validation.randomActions} / ${s.baselineWins.validation.scripted} validation runs and ${s.baselineWins.heldOut.frozenRandom} / ${s.baselineWins.heldOut.randomActions} / ${s.baselineWins.heldOut.scripted} held-out runs (out of ${runs.length}). Full per-run baseline means and score arrays are in the [JSON report](benchmark-open-v1.json). No confidence interval or significance claim is made; evolutionary runs, not map trials, are the independent replicates.\n\nFirst improvement is observed on scheduled validation at generation indices 9, 19, …, 199, relative to that run's initial champion. It is not the exact earliest learning event and need not persist in every later generation. ${s.firstScheduledImprovement.notObserved} runs had no observed scheduled improvement.\n\n## Runtime and retained evidence\n\nAggregate run elapsed time: ${f(s.computeSeconds)} seconds (${f(s.computeSeconds / 3600)} runner-hours), including endpoint evaluations and saves, excluding dependency installation/artifact upload. Jobs execute independently in parallel, so this sum is not workflow wall time. Per-generation core compute median ${f(s.generationSeconds.median)} seconds, p95 ${f(s.generationP95)}, range ${f(s.generationSeconds.min)}–${f(s.generationSeconds.max)}. File-save median ${f(s.saveSeconds.median)} seconds; peak sampled RSS ${f(s.rssBytes.peak / 1024 / 1024)} MiB. These hosted Node measurements do not measure browser rendering or IndexedDB.\n\nRuntime/hardware per run, memory samples, timing samples, commit IDs, endpoint scores and scenario hashes are retained in JSON. Full raw generation/map/trial records, endpoint genomes and resumable checkpoints are in [workflow artifacts](https://github.com/jtmcbride/evo/actions/runs/${runs[0].workflowRun}) with 30-day retention, and downloaded under ignored local artifacts. Regenerate from the frozen protocol and source commit; do not assume exact equality across operating systems, browser engines, Node versions, or CPUs.\n\n## Bundled example selection\n\nThe preregistered nearest-median rule selects run **${s.representativeRun ?? "unavailable until all runs finish"}**, with lowest run index breaking ties. Its initial and final training-selected controllers are displayed on validation map 0, without choosing a favorable trajectory. Archives contain Node-trained populations and Chromium-generated replay records, with both fingerprints. They are partial-history examples, not complete training lineage archives. Browser replay/continuation on a different runtime is explicitly labelled.\n`;
await writeFile(join(values.out!, "benchmark-open-v1.md"), text);
if (execution)
  await writeFile(
    join(values.out!, "benchmark-open-v1.md"),
    text +
      `\nWorkflow wall time, including setup and artifact upload: **${execution.workflowWallSeconds} seconds** (${execution.startedAt} to ${execution.completedAt}). [The raw-data verification record](benchmark-open-v1-verification.json) covers 4,000 generations and 1,536,000 training trials. [Release browser/performance notes](../release.md) record browser acceptance and measured replay limits.\n`,
  );
console.log(
  JSON.stringify({ complete: report.complete, failures, aggregate }, null, 2),
);
if (failures.length) process.exitCode = 1;
