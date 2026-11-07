import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { IndexedRepository } from "../../src/persistence/database";
import { savedFixture, nextFixture } from "./fixtures";
import { createArchive, readArchive } from "../../src/persistence/archive";
import { ComparisonRunner } from "../../src/core/comparison";
import { createEpisode } from "../../src/core/episode";
import { generateScenario } from "../../src/core/world/scenario";
import { branchSuites, BranchMatrixRunner } from "../../src/core/branch/matrix";
import { parameterHash } from "../../src/core/canonical";
import { zipSync, unzipSync, strFromU8 } from "fflate";

test("branches preserve source bytes, ancestry and mixed-environment history through nested archive restore", async () => {
  const repo = new IndexedRepository(`branches-${crypto.randomUUID()}`);
  try {
    const initial = savedFixture("branch-retain"),
      source = await repo.create(initial),
      next = nextFixture(initial);
    await repo.save(source.entry.id, 0, next.session, next.commit);
    const before = await repo.load(source.entry.id),
      row = await repo.db.checkpoints.get([source.entry.id, 1]),
      definition = structuredClone(next.session.checkpoint.definition);
    definition.id = "branch-one";
    definition.world.foodCount = 12;
    definition.world.sensorRange = 65;
    definition.world.bodyRadius = 10;
    let branch = await repo.fork(
      source.entry.id,
      1,
      "Smaller food suite",
      definition,
    );
    expect(await repo.load(source.entry.id)).toEqual(before);
    expect(await repo.db.checkpoints.get([source.entry.id, 1])).toEqual(row);
    expect(branch.session.checkpoint.population).toEqual(
      before.session.checkpoint.population,
    );
    expect(branch.session.checkpoint.generation).toBe(1);
    const trained = nextFixture(branch.session);
    branch = await repo.save(
      branch.entry.id,
      0,
      trained.session,
      trained.commit,
    );
    const lineage = await repo.exportLineage(branch.entry.id, 1);
    expect(lineage.generations[0].definition!.id).toBe(
      initial.checkpoint.definition.id,
    );
    expect(lineage.generations[1].definition!.id).toBe("branch-one");
    const restored = readArchive(createArchive({ ...branch.session, lineage }));
    expect(restored.branchOrigins?.[0].changes).toHaveLength(3);
    const imported = await repo.create(restored);
    expect(
      (await repo.exportLineage(imported.entry.id, 0)).generations,
    ).toEqual(lineage.generations);
    const again = nextFixture(restored),
      control = nextFixture(branch.session);
    expect(again.commit.id).toBe(control.commit.id);
    const nested = structuredClone(definition);
    nested.id = "branch-two";
    nested.evolution.mutationSigma = 0.1;
    const second = await repo.fork(
      branch.entry.id,
      1,
      "Nested mutation study",
      nested,
    );
    expect(second.session.branchOrigins).toHaveLength(2);
    readArchive(
      createArchive({
        ...second.session,
        lineage: await repo.exportLineage(second.entry.id, 0),
      }),
    );
    const bad = structuredClone(restored);
    bad.branchOrigins![0].source.checkpointHash = "b".repeat(64);
    expect(() => createArchive(bad)).toThrow(/source checkpoint/);
  } finally {
    await repo.db.delete();
  }
});
test("failed or stale forks publish no partial experiment and leave the source active", async () => {
  const repo = new IndexedRepository(`branches-${crypto.randomUUID()}`);
  try {
    const session = savedFixture(),
      source = await repo.create(session),
      definition = structuredClone(session.checkpoint.definition);
    definition.id = "branch-fail";
    const fail = () => {
      throw new DOMException(
        "Injected branch write failure",
        "QuotaExceededError",
      );
    };
    repo.db.checkpoints.hook("creating", fail);
    await expect(
      repo.fork(source.entry.id, 0, "Failure", definition),
    ).rejects.toThrow();
    repo.db.checkpoints.hook("creating").unsubscribe(fail);
    expect(await repo.list()).toHaveLength(1);
    expect(await repo.active()).toBe(source.entry.id);
    expect(await repo.db.lineageMeta.count()).toBe(1);
    const next = nextFixture(session);
    await repo.save(source.entry.id, 0, next.session, next.commit);
    await expect(
      repo.fork(source.entry.id, 0, "Stale", definition),
    ).rejects.toThrow(/newer saved/);
    expect(await repo.list()).toHaveLength(1);
  } finally {
    await repo.db.delete();
  }
});
test("extended intervention archives preserve exact parent weights, hidden traces and negative zero", () => {
  const session = savedFixture("restoration");
  for (const g of session.checkpoint.population) {
    g.parameters[240] = -0;
    g.parameterHash = parameterHash(g.parameters);
  }
  const next = nextFixture(session),
    child = next.session.checkpoint.population.find(
      (g) => g.origin === "mutation",
    )!,
    parent = session.checkpoint.population.find(
      (g) => g.id === child.parentIds[0],
    )!;
  const episode = createEpisode({
    scenario: generateScenario(
      "restore-parent",
      session.checkpoint.definition.world,
    ),
    controller: { kind: "neural", id: child.id, parameters: child.parameters },
    trace: true,
  });
  episode.advance(17);
  const runner = new ComparisonRunner(episode.checkpoint(), {
    kind: "parentWeight",
    parameter: 240,
    restoration: { parent, child },
  });
  while (!runner.advance(32)) {
    /* numerical work */
  }
  const clamp = new ComparisonRunner(episode.checkpoint(), {
    kind: "hiddenClamp",
    neuron: 0,
    value: -0,
  });
  while (!clamp.advance(32)) {
    /* numerical work */
  }
  const bytes = createArchive({
      ...next.session,
      comparisons: [runner.result()!, clamp.result()!],
    }),
    restored = readArchive(bytes);
  expect(
    JSON.parse(strFromU8(unzipSync(bytes)["manifest.json"])).formatVersion,
  ).toBe(4);
  expect(
    Object.is(
      restored.comparisons![0].intervention.kind === "parentWeight" &&
        restored.comparisons![0].intervention.value,
      -0,
    ),
  ).toBe(true);
  expect(restored.comparisons).toEqual([runner.result(), clamp.result()]);
  const wrong = structuredClone(restored);
  if (wrong.comparisons![0].intervention.kind === "parentWeight")
    wrong.comparisons![0].intervention.value = 0;
  expect(() => createArchive(wrong)).toThrow();
});
test("matrix writes survive generation commits and replay from portable controller/suite snapshots", async () => {
  const repo = new IndexedRepository(`matrix-${crypto.randomUUID()}`);
  try {
    const initial = savedFixture("matrix-save"),
      source = await repo.create(initial),
      first = nextFixture(initial);
    await repo.save(source.entry.id, 0, first.session, first.commit);
    const def = structuredClone(first.session.checkpoint.definition);
    def.id = "matrix-branch";
    def.world.sensorRange = 60;
    const fork = await repo.fork(source.entry.id, 1, "Range study", def),
      next = nextFixture(fork.session);
    await repo.save(fork.entry.id, 0, next.session, next.commit);
    const sourceChampion = initial.checkpoint.population.find(
        (g) => g.id === first.commit.record.championId,
      )!,
      branchChampion = fork.session.checkpoint.population.find(
        (g) => g.id === next.commit.record.championId,
      )!;
    const input = {
        controllers: [
          {
            experimentId: source.entry.id,
            name: "Source",
            generation: 0,
            genome: sourceChampion,
          },
          {
            experimentId: fork.entry.id,
            name: "Branch",
            generation: 1,
            genome: branchChampion,
          },
        ],
        suites: branchSuites(
          "frozen",
          initial.checkpoint.definition.world,
          def.world,
          2,
        ),
      },
      runner = new BranchMatrixRunner(input);
    while (!runner.advance(19)) {
      /* all cells */
    }
    const matrix = runner.result()!;
    const later = nextFixture(next.session);
    await Promise.all([
      repo.saveMatrix(fork.entry.id, matrix),
      repo.save(fork.entry.id, 1, later.session, later.commit),
    ]);
    const loaded = await repo.load(fork.entry.id);
    expect(loaded.entry.revision).toBe(2);
    expect(loaded.session.matrices).toEqual([matrix]);
    await repo.saveMatrix(fork.entry.id, matrix);
    const restored = readArchive(
        createArchive({
          ...loaded.session,
          lineage: await repo.exportLineage(fork.entry.id, 2),
        }),
      ),
      imported = await repo.create(restored);
    expect((await repo.load(imported.entry.id)).session.matrices).toEqual([
      matrix,
    ]);
    const replay = new BranchMatrixRunner({
      controllers: restored.matrices![0].controllers,
      suites: restored.matrices![0].suites,
    });
    while (!replay.advance(1)) {
      /* chunk independent */
    }
    expect(replay.result()).toEqual(matrix);
    const corrupted = structuredClone(matrix);
    corrupted.cells[0].results[0].score++;
    await expect(repo.saveMatrix(fork.entry.id, corrupted)).rejects.toThrow();
  } finally {
    await repo.db.delete();
  }
});
test("version-three lineage archives remain readable without M9 records", async () => {
  const repo = new IndexedRepository(`legacy-v3-${crypto.randomUUID()}`);
  try {
    const initial = savedFixture(),
      source = await repo.create(initial),
      next = nextFixture(initial);
    await repo.save(source.entry.id, 0, next.session, next.commit);
    const lineage = await repo.exportLineage(source.entry.id, 1);
    for (const r of lineage.generations) delete r.definition;
    const bytes = createArchive({ ...next.session, lineage });
    expect(
      JSON.parse(strFromU8(unzipSync(bytes)["manifest.json"])).formatVersion,
    ).toBe(3);
    expect(
      readArchive(zipSync(unzipSync(bytes))).lineage?.generations,
    ).toHaveLength(1);
  } finally {
    await repo.db.delete();
  }
});
