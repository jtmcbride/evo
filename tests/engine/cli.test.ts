import { test, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const exec = promisify(execFile);
test("CLI resume produces exactly the uninterrupted generation checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "evo-cli-")),
    continuous = join(root, "continuous"),
    split = join(root, "split");
  const run = (args: string[]) =>
    exec(process.execPath, ["--import", "tsx", "scripts/evolve.ts", ...args]);
  try {
    await run([
      "--seed",
      "cli-fixture",
      "--population",
      "16",
      "--ticks",
      "90",
      "--generations",
      "2",
      "--out",
      continuous,
    ]);
    await run([
      "--seed",
      "cli-fixture",
      "--population",
      "16",
      "--ticks",
      "90",
      "--generations",
      "1",
      "--out",
      split,
    ]);
    await run([
      "--resume",
      join(split, "checkpoint.evo"),
      "--generations",
      "1",
    ]);
    expect(await readFile(join(split, "checkpoint.evo"), "utf8")).toBe(
      await readFile(join(continuous, "checkpoint.evo"), "utf8"),
    );
    expect(
      await readFile(join(split, "generation-1", "commit.evo"), "utf8"),
    ).toBe(
      await readFile(join(continuous, "generation-1", "commit.evo"), "utf8"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
