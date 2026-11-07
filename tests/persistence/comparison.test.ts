import "fake-indexeddb/auto";
import Dexie from "dexie";
import { test, expect } from "vitest";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import { ComparisonRunner } from "../../src/core/comparison";
import { createEpisode } from "../../src/core/episode";
import { generateScenario } from "../../src/core/world/scenario";
import { encode } from "../../src/core/codec";
import { parseComparison, parseSession } from "../../src/persistence/model";
import { createArchive, readArchive } from "../../src/persistence/archive";
import { IndexedRepository } from "../../src/persistence/database";
import { entryFor } from "../../src/persistence/repository";
import { savedFixture, nextFixture } from "./fixtures";

function fixture(channel = 16) {
  const s = savedFixture("comparison-save"),
    g = structuredClone(s.checkpoint.population[0]);
  // A controller absent from the retained population still needs its own archive blob.
  g.parameters[0] = -0;
  g.parameters[1] = 0.123456;
  const episode = createEpisode({
    scenario: generateScenario("paired-save", s.checkpoint.definition.world),
    controller: {
      kind: "neural",
      id: "old-controller",
      parameters: g.parameters,
    },
    trace: true,
  });
  episode.advance(17);
  const runner = new ComparisonRunner(episode.checkpoint(), channel);
  while (!runner.advance(32)) {
    /* complete in bounded chunks */
  }
  return { session: s, comparison: runner.result()! };
}
test("archives preserve comparison-only parameters and exact matched replays", () => {
  const { session, comparison } = fixture();
  session.comparisons = [comparison];
  const restored = readArchive(createArchive(session));
  expect(restored).toEqual(session);
  expect(
    Object.is(
      restored.comparisons![0].source.definition.controller.kind === "neural" &&
        restored.comparisons![0].source.definition.controller.parameters[0],
      -0,
    ),
  ).toBe(true);
  const r = new ComparisonRunner(restored.comparisons![0].source, 16);
  while (!r.advance(7)) {
    /* same result with another chunk size */
  }
  expect(r.result()).toEqual(comparison);
  expect(nextFixture(restored).commit.id).toBe(
    nextFixture(savedFixture("comparison-save")).commit.id,
  );
});
test("imports M6 version-one archives and rejects invalid comparison references", () => {
  const { session, comparison } = fixture();
  const files = unzipSync(createArchive(session)),
    manifest = JSON.parse(strFromU8(files["manifest.json"])),
    data = JSON.parse(strFromU8(files["session.json"]));
  delete data.comparisons;
  manifest.formatVersion = 1;
  files["session.json"] = strToU8(JSON.stringify(data));
  const entry = manifest.entries.find(
    (e: { path: string }) => e.path === "session.json",
  );
  entry.bytes = files["session.json"].length;
  entry.sha256 = Array.from(sha256(files["session.json"]), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  expect(readArchive(zipSync(files))).toEqual(session);
  const bad = structuredClone(comparison);
  bad.masked.firstDecision.inputs[16] = 0.5;
  expect(() => parseComparison(bad)).toThrow(/observations/);
  expect(() =>
    parseSession({ ...session, comparisons: [comparison, comparison] }),
  ).toThrow(/Duplicate/);
  const wrong = structuredClone(comparison);
  if (wrong.masked.result.spec.intervention?.kind === "sensorMask")
    wrong.masked.result.spec.intervention.channel = 2;
  expect(() => parseComparison(wrong)).toThrow();
});
test("comparison writes are independent of population revisions and survive concurrent generation saves", async () => {
  const name = `comparison-${crypto.randomUUID()}`,
    a = new IndexedRepository(name),
    b = new IndexedRepository(name);
  try {
    const { session, comparison } = fixture(),
      other = fixture(17).comparison;
    const initial = await a.create(session),
      next = nextFixture(session);
    await Promise.all([
      a.saveComparison(initial.entry.id, comparison),
      b.save(initial.entry.id, 0, next.session, next.commit),
    ]);
    await b.saveComparison(initial.entry.id, other);
    await a.saveComparison(initial.entry.id, comparison);
    const loaded = await a.load(initial.entry.id);
    expect(loaded.entry.revision).toBe(1);
    expect(loaded.session.checkpoint).toEqual(next.session.checkpoint);
    expect(loaded.session.comparisons!.map((c) => c.id).sort()).toEqual(
      [comparison.id, other.id].sort(),
    );
    expect(await a.db.comparisons.count()).toBe(2);
    const later = nextFixture(next.session);
    await b.save(initial.entry.id, 1, later.session, later.commit);
    expect((await a.load(initial.entry.id)).session.comparisons).toHaveLength(
      2,
    );
    await a.db.comparisons.update([initial.entry.id, comparison.id], {
      payload: "corrupt",
    });
    await expect(a.load(initial.entry.id)).rejects.toThrow(/checksum/);
    expect((await a.db.experiments.get(initial.entry.id))!.generation).toBe(2);
  } finally {
    b.close();
    await a.db.delete();
  }
});
test("upgrades an existing M6 database without rewriting its checkpoint or checksum", async () => {
  const name = `legacy-${crypto.randomUUID()}`,
    old = new Dexie(name);
  old.version(1).stores({
    experiments: "id,updatedAt",
    checkpoints: "[experimentId+generation],experimentId",
    genomes: "[experimentId+key],experimentId",
    parameters: "hash",
    memberships: "[experimentId+key],experimentId",
    generations: "[experimentId+key],experimentId",
    scenarios: "hash",
    evaluations: "[experimentId+key],experimentId",
    trials: "[experimentId+key],experimentId",
    meta: "key",
  });
  const session = savedFixture("legacy");
  delete session.comparisons;
  const entry = entryFor("legacy", 7, session),
    payload = encode(session);
  await old.table("experiments").put(entry);
  await old.table("checkpoints").put({
    experimentId: entry.id,
    generation: 0,
    payload,
    checksum: entry.checksum,
  });
  await old.table("meta").put({ key: "active", value: entry.id });
  old.close();
  const current = new IndexedRepository(name);
  try {
    const loaded = await current.load("legacy");
    expect(loaded.entry).toEqual(entry);
    expect(loaded.session).toEqual({ ...session, comparisons: [] });
    expect(await current.active()).toBe("legacy");
    expect((await current.db.checkpoints.get([entry.id, 0]))!.payload).toBe(
      payload,
    );
    await current.saveComparison(entry.id, fixture().comparison);
    expect((await current.load(entry.id)).entry.revision).toBe(7);
  } finally {
    await current.db.delete();
  }
});
