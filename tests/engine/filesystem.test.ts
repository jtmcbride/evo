import { test, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCommitStore } from "../../scripts/filesystem-store";
import {
  defineExperiment,
  initialCheckpoint,
  type ExperimentCheckpoint,
} from "../../src/core/evolution";
import { ExperimentRunner } from "../../src/core/experiment";
import { decode } from "../../src/core/codec";
test("filesystem commit is idempotent, guarded and recoverable from a stale head", async () => {
  const out = await mkdtemp(join(tmpdir(), "evo-store-")),
    runtime = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  const d = defineExperiment("disk");
  Object.assign(d.evolution, {
    population: 4,
    elites: 1,
    immigrants: 1,
    trials: 1,
  });
  d.world.maxTicks = 3;
  const cp = initialCheckpoint(d),
    runner = new ExperimentRunner(cp);
  while (runner.phase !== "awaitingCommit") runner.advance(100);
  const commit = runner.pendingCommit()!;
  try {
    const store = await FileCommitStore.open(out, runtime, cp, false);
    await expect(FileCommitStore.open(out, runtime, cp, true)).rejects.toThrow(
      "locked",
    );
    const old = await readFile(join(out, "checkpoint.evo"), "utf8");
    await store.put(commit);
    await store.put(commit);
    await store.close();
    const saved = decode(
      await readFile(join(out, "checkpoint.evo"), "utf8"),
    ) as { checkpoint: ExperimentCheckpoint };
    expect(saved.checkpoint.generation).toBe(1);
    // Simulate a process dying after the immutable record was saved, before publishing the head.
    await writeFile(join(out, "checkpoint.evo"), old);
    const retry = await FileCommitStore.open(out, runtime, cp, true);
    await retry.put(commit);
    await retry.close();
    const conflict = await FileCommitStore.open(
      out,
      runtime,
      commit.nextCheckpoint,
      true,
    );
    await writeFile(join(out, "checkpoint.evo"), "changed");
    await expect(conflict.put(commit)).rejects.toThrow("head changed");
    await conflict.close();
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
