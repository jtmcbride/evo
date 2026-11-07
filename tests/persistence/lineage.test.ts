import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { sha256 } from "@noble/hashes/sha2.js";
import { IndexedRepository } from "../../src/persistence/database";
import { createArchive, readArchive } from "../../src/persistence/archive";
import { reconstructGenome, validateLineage } from "../../src/core/lineage";
import { createEpisode } from "../../src/core/episode";
import { savedFixture, nextFixture } from "./fixtures";
import { contentHash } from "../../src/core/lineage";
import { decode } from "../../src/core/codec";
import type { Genome } from "../../src/core/model";
import { retainGenome, type LineageNode } from "../../src/core/lineage";

test("retains unsuccessful births, sparse patches and original trials across full archive import", async () => {
  const repo = new IndexedRepository(`lineage-${crypto.randomUUID()}`);
  try {
    let session = savedFixture("all-births"),
      handle = await repo.create(session);
    const ancestors = new Map(
      session.checkpoint.population.map((g) => [g.id, g]),
    );
    for (let g = 0; g < 12; g++) {
      const next = nextFixture(session);
      handle = await repo.save(
        handle.entry.id,
        handle.entry.revision,
        next.session,
        next.commit,
      );
      session = next.session;
      session.checkpoint.population.forEach((genome) =>
        ancestors.set(genome.id, genome),
      );
    }
    const lineage = await repo.exportLineage(
      handle.entry.id,
      handle.entry.revision,
    );
    expect(lineage.fromGeneration).toBe(0);
    expect(lineage.generations).toHaveLength(12);
    expect(lineage.nodes).toHaveLength(ancestors.size);
    expect(
      lineage.nodes.filter((n) => n.storage.kind === "patch").length,
    ).toBeGreaterThan(10);
    expect(await repo.db.parameters.count()).toBeLessThan(ancestors.size);
    const retired = lineage.nodes.find(
      (n) =>
        n.genome.origin === "mutation" &&
        n.genome.birthGeneration < 10 &&
        !session.checkpoint.population.some((g) => g.id === n.genome.id),
    )!;
    const view = await repo.lineage(handle.entry.id, retired.genome.id);
    expect(view.genome).toEqual(ancestors.get(retired.genome.id));
    expect(view.parent).not.toBeNull();
    expect(view.replay).not.toBeNull();
    const bytes = createArchive({ ...session, lineage }),
      files = unzipSync(bytes),
      manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.formatVersion).toBe(4);
    expect(manifest.ancestry).toBe("complete");
    expect(files["lineage-parameters.f32"]).toBeDefined();
    const restored = readArchive(bytes);
    expect(restored.lineage).toEqual(lineage);
    const fresh = await repo.create(restored),
      reopened = await repo.lineage(fresh.entry.id, retired.genome.id);
    expect(reopened).toEqual(view);
    expect(
      await repo.db.genomes
        .where("experimentId")
        .equals(fresh.entry.id)
        .count(),
    ).toBe(lineage.nodes.length);
    expect(
      await repo.db.memberships
        .where("experimentId")
        .equals(fresh.entry.id)
        .count(),
    ).toBe(13 * session.checkpoint.population.length);
    const map = new Map(restored.lineage!.nodes.map((n) => [n.genome.id, n]));
    for (const [id, g] of ancestors)
      expect(reconstructGenome(id, (k) => map.get(k))).toEqual(g);
    for (const r of [view, reopened]) {
      const e = createEpisode({
        scenario: r.replay!.scenarios[0],
        controller: {
          kind: "neural",
          id: r.genome.id,
          parameters: r.genome.parameters,
        },
      });
      e.advance(10000);
      expect(e.result()).toEqual(r.replay!.results[0]);
    }
    const next = nextFixture(restored);
    await repo.save(fresh.entry.id, 0, next.session, next.commit);
    expect(
      (await repo.exportLineage(fresh.entry.id, 1)).generations,
    ).toHaveLength(13);
  } finally {
    await repo.db.delete();
  }
});
test("lineage writes roll back with a failed checkpoint and idempotent retry preserves births", async () => {
  const repo = new IndexedRepository(`lineage-${crypto.randomUUID()}`);
  try {
    const session = savedFixture(),
      h = await repo.create(session),
      next = nextFixture(session),
      before = await repo.db.lineageNodes.count();
    const fail = () => {
      throw new DOMException("Injected failure", "QuotaExceededError");
    };
    repo.db.checkpoints.hook("creating", fail);
    await expect(
      repo.save(h.entry.id, 0, next.session, next.commit),
    ).rejects.toThrow();
    repo.db.checkpoints.hook("creating").unsubscribe(fail);
    expect(await repo.db.lineageNodes.count()).toBe(before);
    expect(await repo.db.generations.count()).toBe(0);
    await repo.save(h.entry.id, 0, next.session, next.commit);
    const count = await repo.db.lineageNodes.count();
    await repo.save(h.entry.id, 0, next.session, next.commit);
    expect(await repo.db.lineageNodes.count()).toBe(count);
    await expect(repo.exportLineage(h.entry.id, 0)).rejects.toThrow(
      /newer saved/,
    );
    const row = (await repo.db.lineageNodes
      .where("experimentId")
      .equals(h.entry.id)
      .first())!;
    await repo.db.lineageNodes.update([h.entry.id, row.key], {
      payload: "broken",
    });
    await expect(repo.lineage(h.entry.id, row.key)).rejects.toThrow(/checksum/);
  } finally {
    await repo.db.delete();
  }
});
test("checkpoint imports honestly mark incomplete ancestry while full exports validate coverage and blobs", async () => {
  const repo = new IndexedRepository(`lineage-${crypto.randomUUID()}`);
  try {
    const s = nextFixture(savedFixture()).session,
      partial = await repo.create(readArchive(createArchive(s)));
    const lineage = await repo.exportLineage(partial.entry.id, 0);
    expect(lineage.fromGeneration).toBe(1);
    expect(lineage.generations).toHaveLength(0);
    const bytes = createArchive({ ...s, lineage }),
      files = unzipSync(bytes),
      manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.ancestry).toBe("partial");
    manifest.ancestry = "complete";
    files["manifest.json"] = strToU8(JSON.stringify(manifest));
    expect(() => readArchive(zipSync(files))).toThrow(/ancestry claim/);
    const invalid = structuredClone(lineage);
    invalid.fromGeneration = 0;
    expect(() => validateLineage(invalid, s.checkpoint)).toThrow(/coverage/);
    const full = await repo.create(savedFixture("tamper"));
    const next = nextFixture(full.session);
    await repo.save(full.entry.id, 0, next.session, next.commit);
    const bundle = await repo.exportLineage(full.entry.id, 1),
      all = unzipSync(createArchive({ ...next.session, lineage: bundle }));
    const data = JSON.parse(strFromU8(all["lineage.json"]));
    data.generations[0].totals[0] += 1;
    all["lineage.json"] = strToU8(JSON.stringify(data));
    const m = JSON.parse(strFromU8(all["manifest.json"]));
    const entry = m.entries.find(
      (e: { path: string }) => e.path === "lineage.json",
    );
    entry.bytes = all["lineage.json"].length;
    entry.sha256 = Array.from(sha256(all["lineage.json"]), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    all["manifest.json"] = strToU8(JSON.stringify(m));
    expect(() => readArchive(zipSync(all))).toThrow(/totals|commit/);
  } finally {
    await repo.db.delete();
  }
});
test("M7 normalized full-weight records migrate lazily without rewriting the checkpoint", async () => {
  const repo = new IndexedRepository(`lineage-${crypto.randomUUID()}`);
  try {
    const original = savedFixture("legacy-births"),
      created = await repo.create(original),
      next = nextFixture(original);
    await repo.save(created.entry.id, 0, next.session, next.commit);
    // Recreate the M7 layout: all birth weights, with no lineage tables populated.
    await repo.db.lineageNodes.clear();
    await repo.db.lineageMeta.clear();
    const genomes = new Map(
      [
        ...original.checkpoint.population,
        ...next.session.checkpoint.population,
      ].map((g) => [g.id, g]),
    );
    await repo.db.parameters.bulkPut(
      [...genomes.values()].map((g) => ({
        hash: g.parameterHash,
        values: g.parameters,
      })),
    );
    const before = (await repo.db.checkpoints.get([created.entry.id, 1]))!;
    const exported = await repo.exportLineage(created.entry.id, 1);
    expect(exported.nodes).toHaveLength(genomes.size);
    expect(exported.fromGeneration).toBe(0);
    expect(await repo.db.checkpoints.get([created.entry.id, 1])).toEqual(
      before,
    );
    const meta = await repo.db.genomes.get([
      created.entry.id,
      next.session.checkpoint.population[0].id,
    ]);
    expect(contentHash(meta!.data)).toBe(
      contentHash(
        (({ parameters, ...g }: Genome) => {
          void parameters;
          return g;
        })(next.session.checkpoint.population[0]),
      ),
    );
    expect(decode(before.payload)).toBeDefined();
  } finally {
    await repo.db.delete();
  }
});
test("ancestry and child navigation use bounded pages over retained records", async () => {
  const repo = new IndexedRepository(`lineage-pages-${crypto.randomUUID()}`);
  try {
    const s = savedFixture("pages"),
      root = s.checkpoint.population[0],
      nodes = new Map<string, LineageNode>(
        s.checkpoint.population.map((g) => [g.id, retainGenome(g)]),
      );
    let parent = root;
    for (let g = 1; g <= 70; g++) {
      const child: Genome = {
        ...structuredClone(parent),
        id: `chain-${g}`,
        birthGeneration: g,
        origin: "mutation",
        parentIds: [parent.id],
        mutation: { seed: "a".repeat(64), changes: [] },
      };
      nodes.set(
        child.id,
        retainGenome(child, { genome: parent, node: nodes.get(parent.id)! }),
      );
      parent = child;
    }
    for (let g = 1; g <= 65; g++) {
      const child: Genome = {
        ...structuredClone(root),
        id: `sibling-${g}`,
        birthGeneration: g,
        origin: "mutation",
        parentIds: [root.id],
        mutation: { seed: "b".repeat(64), changes: [] },
      };
      nodes.set(
        child.id,
        retainGenome(child, { genome: root, node: nodes.get(root.id)! }),
      );
    }
    s.checkpoint.generation = 70;
    s.lineage = {
      version: 1,
      fromGeneration: 70,
      nodes: [...nodes.values()],
      generations: [],
    };
    const h = await repo.create(s),
      first = await repo.lineage(h.entry.id, parent.id);
    expect(first.ancestors).toHaveLength(30);
    expect(first.nextAncestor).toBe("chain-39");
    const second = await repo.lineage(h.entry.id, parent.id, {
      ancestorStart: first.nextAncestor!,
    });
    expect(second.ancestors).toHaveLength(30);
    expect(second.nextAncestor).toBe("chain-9");
    const children = await repo.lineage(h.entry.id, root.id);
    expect(children.children).toHaveLength(20);
    expect(children.childrenCount).toBe(66);
    const later = await repo.lineage(h.entry.id, root.id, {
      childrenOffset: 20,
    });
    expect(later.children).toHaveLength(20);
    expect(
      later.children.some((c) => children.children.some((g) => g.id === c.id)),
    ).toBe(false);
    await expect(
      repo.lineage(h.entry.id, root.id, { childrenOffset: -1 }),
    ).rejects.toThrow(/page/);
  } finally {
    await repo.db.delete();
  }
});
