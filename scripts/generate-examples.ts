import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import {
  representativeRun,
  RELEASE_PROTOCOL,
  protocolHash,
} from "./benchmark-protocol";
import type { BenchmarkResult } from "./benchmark-runner";
import type { buildExample } from "../src/release/example-session";
import { exampleManifest } from "../src/release/catalog";
import { decode } from "../src/core/codec";
import { hash } from "../src/core/canonical";
import { generateScenario } from "../src/core/world/scenario";
import { evaluateFrozen } from "../src/release/replay";
import type { Genome } from "../src/core/model";
import type { ExperimentCheckpoint } from "../src/core/evolution";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string", default: "public/examples" },
  },
});
if (!values.input)
  throw new Error("Use --input ROOT_CONTAINING_DOWNLOADED_RUN_DIRECTORIES");
const results: BenchmarkResult[] = [];
for (let run = 0; run < 20; run++) {
  const report = JSON.parse(
    await readFile(
      join(values.input, `benchmark-open-v1-run-${run}`, "report.json"),
      "utf8",
    ),
  ) as BenchmarkResult;
  if (
    report.run !== run ||
    report.protocolHash !== protocolHash ||
    report.completedGenerations !== 200
  )
    throw new Error("Incomplete or mixed benchmark reports");
  results.push(report);
}
if (new Set(results.map((r) => r.sourceCommit)).size !== 1)
  throw new Error("Mixed benchmark source commits");
const run = representativeRun(results),
  report = results[run];
const encoded = await readFile(
  join(values.input, `benchmark-open-v1-run-${run}`, "endpoints.evo"),
  "utf8",
);
const server = await createServer({
  server: { host: "127.0.0.1", port: 4180, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4180/runtime.html");
  const entries = [],
    evidence = [],
    crossRuntime = [];
  const decoded = decode(encoded) as {
    initial: { genome: Genome };
    final: { genome: Genome };
    checkpoint: ExperimentCheckpoint;
  };
  await mkdir(values.out!, { recursive: true });
  for (const which of ["initial", "final"] as const) {
    const generated = await page.evaluate(
      async ({ encoded, which, trainingRuntime, moduleUrl }) => {
        const module = (await import(moduleUrl)) as {
          buildExample: typeof buildExample;
        };
        return module.buildExample(encoded, which, trainingRuntime);
      },
      {
        encoded,
        which,
        trainingRuntime: {
          userAgent: `Node ${report.runtime.node}; V8 ${report.runtime.v8}; training ${report.sourceCommit}`,
          platform: `${report.runtime.platform}/${report.runtime.arch}`,
        },
        moduleUrl: "/src/release/example-session.ts",
      },
    );
    const bytes = Uint8Array.from(generated.archive),
      file = `${which}.evolab`;
    await writeFile(join(values.out!, file), bytes);
    entries.push({
      id: which,
      title: which === "initial" ? "Before evolution" : "After 200 generations",
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      generation: generated.evidence.generation,
      validationMean:
        which === "initial" ? report.initialValidation : report.finalValidation,
      description:
        which === "initial"
          ? "The training-selected starting champion from the representative run, before reproduction."
          : "The final training-selected champion from that same run. Open it to inspect the fixed network, local observations, and motor commands.",
    });
    evidence.push({ which, ...generated.evidence });
    const def = decoded.checkpoint.definition;
    const node = evaluateFrozen(
      decoded[which].genome,
      generateScenario(
        hash(["validation-v1", def.roots.validation, 0]),
        def.world,
      ),
    );
    const browser = generated.evidence;
    const difference = (a: readonly number[], b: readonly number[]) =>
      a.length === b.length
        ? Math.max(0, ...a.map((v, i) => Math.abs(v - b[i])))
        : null;
    crossRuntime.push({
      which,
      scenarioHash: browser.scenarioHash,
      parameterHash: browser.parameterHash,
      localNode: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      browserRuntime: browser.runtime,
      exactEvaluation: hash(node) === browser.evaluationHash,
      nodeEvaluationHash: hash(node),
      browserEvaluationHash: browser.evaluationHash,
      originalHostedNodeResult: report.suites.validation[which][0],
      localNodeResult: node.result,
      browserResult: browser.result,
      pathSamples: { node: node.path.length, browser: browser.path.length },
      maxCoordinateDifference: difference(
        node.path.flatMap((p) => [p.x, p.y]),
        browser.path.flatMap((p) => [p.x, p.y]),
      ),
      maxFirstInputDifference: difference(
        node.firstDecision!.inputs,
        browser.firstDecision!.inputs,
      ),
      maxFirstHiddenDifference: difference(
        node.firstDecision!.hidden!,
        browser.firstDecision!.hidden!,
      ),
      maxFirstOutputDifference: difference(
        node.firstDecision!.outputs,
        browser.firstDecision!.outputs,
      ),
    });
  }
  const manifest = exampleManifest.parse({
    formatVersion: 1,
    suiteId: RELEASE_PROTOCOL.id,
    run,
    sourceCommit: report.sourceCommit,
    selectionRule: RELEASE_PROTOCOL.exampleRule,
    generatedRuntime: evidence[0].runtime,
    examples: entries,
  });
  await writeFile(
    join(values.out!, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await mkdir("artifacts/m10-example-generation", { recursive: true });
  await writeFile(
    "artifacts/m10-example-generation/replay-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    "docs/benchmarks/m10-replay.json",
    JSON.stringify(
      {
        run,
        sourceCommit: report.sourceCommit,
        browser: browser.version(),
        examples: crossRuntime,
        limits:
          "Two fixed validation-map replays, not proof of cross-runtime identity for other seeds, hardware or versions. Archives preserve Chromium-generated results and Node training provenance. Exact equality is measured, never assumed.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      selectedRun: run,
      browser: browser.version(),
      files: entries.map((e) => e.file),
      runtime: manifest.generatedRuntime,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
