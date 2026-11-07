import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { chromium, firefox, webkit, expect } from "@playwright/test";
import { preview } from "vite";
import { generateScenario } from "../src/core/world/scenario";
import { move } from "../src/core/world/geometry";
import { observe } from "../src/core/world/sensing";
import { forward } from "../src/core/controller/neural";
import { createEpisode } from "../src/core/episode";
import { initialCheckpoint, defineExperiment } from "../src/core/evolution";
import { quantile } from "./benchmark-protocol";
import type { RuntimeHarness } from "../src/runtime/harness";

const stats = (xs: number[]) => ({
  samples: xs.length,
  median: quantile(xs, 0.5),
  p95: quantile(xs, 0.95),
  min: Math.min(...xs),
  max: Math.max(...xs),
});
const d = defineExperiment("release-performance-v1", true),
  scenario = generateScenario("release-performance-scene-v1", d.world),
  genome = initialCheckpoint(d).population[0];
const episode = createEpisode({
    scenario,
    controller: {
      kind: "neural",
      id: genome.id,
      parameters: genome.parameters,
    },
  }),
  state = episode.inspect();
const inputs = new Float64Array(20),
  hidden = new Float64Array(12),
  outputs = new Float64Array(2);
observe(scenario, state, inputs);
let sink = 0;
function sample(iterations: number, fn: (i: number) => void) {
  for (let i = 0; i < iterations; i++) fn(i);
  return stats(
    Array.from({ length: 30 }, () => {
      const t = performance.now();
      for (let i = 0; i < iterations; i++) fn(i);
      return (performance.now() - t) / iterations;
    }),
  );
}
const microMilliseconds = {
  scenario: sample(20, (i) => {
    sink += generateScenario(`release-micro-${i}`, d.world).food.length;
  }),
  sensing: sample(1000, () => {
    observe(scenario, state, inputs);
    sink += inputs[0];
  }),
  collisionMove: sample(1000, () => {
    sink += move(state, { x: 20, y: 10 }, d.world, scenario.obstacles).length;
  }),
  inference: sample(1000, () => {
    forward(genome.parameters, inputs, hidden, outputs);
    sink += outputs[0];
  }),
  episode: sample(2, () => {
    const e = createEpisode({
      scenario,
      controller: {
        kind: "neural",
        id: genome.id,
        parameters: genome.parameters,
      },
    });
    e.advance(d.world.maxTicks);
    sink += e.result()!.score;
  }),
};
const server = await preview({
  base: "/evo/",
  preview: { host: "127.0.0.1", port: 4175, strictPort: true },
});
const browsers = [];
try {
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch();
    try {
      const context = await browser.newContext(),
        page = await context.newPage();
      await page.addInitScript(() => {
        const paints: number[] = [],
          transactions: number[] = [];
        Reflect.set(window, "releasePaints", paints);
        Reflect.set(window, "releaseTransactions", transactions);
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
          if (this.canvas.classList.contains("arena-canvas"))
            paints.push(performance.now());
          return clear.apply(this, args);
        };
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          const start = performance.now(),
            tx = transaction.apply(this, args);
          if (
            tx.mode === "readwrite" &&
            tx.objectStoreNames.contains("experiments")
          )
            tx.addEventListener("complete", () =>
              transactions.push(performance.now() - start),
            );
          return tx;
        };
      });
      await page.goto("http://127.0.0.1:4175/evo/");
      await page
        .getByRole("button", { name: "Create experiment", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Initial controller", exact: true }),
      ).toBeVisible();
      await page.getByLabel("Generations to train").fill("1");
      await page.evaluate(() => {
        (Reflect.get(window, "releasePaints") as number[]).length = 0;
        (Reflect.get(window, "releaseTransactions") as number[]).length = 0;
      });
      await page
        .getByRole("button", { name: "Play trial", exact: true })
        .click();
      const start = performance.now();
      await page
        .getByRole("button", { name: "Train 1 generation", exact: true })
        .click();
      await expect(page.locator(".save-status strong")).toHaveText(
        "Saved population 1",
        { timeout: 30000 },
      );
      const generationMilliseconds = performance.now() - start;
      await page
        .getByRole("button", { name: "Pause trial", exact: true })
        .click();
      const ui = await page.evaluate(() => ({
        paints: Reflect.get(window, "releasePaints") as number[],
        transactions: Reflect.get(window, "releaseTransactions") as number[],
        runtime: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
        },
      }));
      await page.goto("http://127.0.0.1:4175/evo/runtime.html");
      await page.waitForFunction(() => !!window.m4);
      const responsiveness = await page.evaluate(async () => {
        const h = window.m4 as RuntimeHarness;
        await h.client.ready;
        await h.initialize();
        await h.open();
        await h.playback("play");
        await h.start(100);
        const latencies: number[] = [];
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 20));
          const start = performance.now();
          await h.pause();
          latencies.push(performance.now() - start);
          if (i < 19) await h.start(100);
        }
        await h.dispose();
        return latencies;
      });
      const intervals = ui.paints
        .slice(1)
        .map((v, i) => v - ui.paints[i])
        .filter((x) => x > 0);
      browsers.push({
        name,
        version: browser.version(),
        runtime: ui.runtime,
        generationMilliseconds,
        pauseMilliseconds: stats(responsiveness),
        arenaPaintIntervalMilliseconds: intervals.length
          ? stats(intervals)
          : null,
        arenaPaintCount: ui.paints.length,
        indexedDbHeadTransactionMilliseconds: ui.transactions.length
          ? stats(ui.transactions)
          : null,
      });
      console.log(JSON.stringify(browsers.at(-1)));
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise<void>((resolve) =>
    server.httpServer.close(() => resolve()),
  );
}
const report = {
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  measuredAt: new Date().toISOString(),
  runtimeSourceDirty: !!execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--",
      "src",
      "scripts/profile-release.ts",
      "vite.config.ts",
      "package.json",
      "package-lock.json",
    ],
    { encoding: "utf8" },
  ).trim(),
  buildAssetSha256: Object.fromEntries(
    await Promise.all(
      [
        "dist/index.html",
        "dist/runtime.html",
        ...(await readdir("dist/assets")).map((f) => `dist/assets/${f}`),
      ].map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  ),
  host: {
    cpu: os.cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  fixture: {
    seed: "release-performance-v1",
    world: d.world,
    controllerHash: genome.parameterHash,
  },
  microMilliseconds,
  browsers,
  sink,
  limits:
    "Headless focused desktop smoke measurements, not physical display FPS or a memory-leak proof. Microbenchmarks use the obstacle fixture; default-generation and UI checks use open-world defaults. Pause samples use the diagnostic harness. IndexedDB transactions cover numerical heads, not complete export cost. Core times are per call after one warmup batch, with 30 batches. No timing threshold is a correctness gate.",
};
await mkdir("docs/benchmarks", { recursive: true });
await writeFile(
  "docs/benchmarks/m10-performance.json",
  JSON.stringify(report, null, 2) + "\n",
);
