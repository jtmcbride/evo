import { hash } from "../core/canonical";
import { encode, decode } from "../core/codec";
import {
  retainGenome,
  reconstructGenome,
  validateNode,
  validateLineage,
  contentHash,
  type LineageNode,
  type LineageBundle,
} from "../core/lineage";
import type { Genome } from "../core/model";
import type { ExperimentCheckpoint } from "../core/evolution";
import type { GenerationRecord } from "../core/experiment";
import { parseSession, type SavedSession } from "./model";
import { RevisionConflict } from "./repository";
import {
  initialLineage,
  sessionGenomes,
  type LineageQuery,
  type LineageView,
} from "./lineage";
import type { LabDatabase } from "./database";

export interface LineageRow {
  experimentId: string;
  key: string;
  parentId: string;
  birthGeneration: number;
  payload: string;
  checksum: string;
}
export async function writeGeneration(
  db: LabDatabase,
  id: string,
  r: GenerationRecord,
  commitId: string,
) {
  await db.memberships.bulkPut(
    r.populationIds.map((genomeId, slot) => ({
      experimentId: id,
      key: `${r.generation}:${slot}`,
      data: { generation: r.generation, slot, genomeId },
    })),
  );
  await db.generations.put({
    experimentId: id,
    key: String(r.generation),
    data: {
      commitId,
      generation: r.generation,
      populationIds: r.populationIds,
      totals: r.totals,
      championId: r.championId,
      scenarioHashes: r.scenarios.map((s) => s.hash),
      validationHashes: r.validationScenarios.map((s) => s.hash),
      recordChecksum: contentHash(r),
    },
  });
  await db.scenarios.bulkPut(
    [...r.scenarios, ...r.validationScenarios].map((s) => ({
      hash: s.hash,
      data: s,
    })),
  );
  const trials = r.trials.flatMap((list, slot) =>
    list.map((data, trial) => ({
      experimentId: id,
      key: `${r.generation}:training:${slot}:${trial}`,
      data,
    })),
  );
  trials.push(
    ...r.validation.map((data, trial) => ({
      experimentId: id,
      key: `${r.generation}:validation:${trial}`,
      data,
    })),
  );
  if (trials.length) {
    await db.trials.bulkPut(trials);
    await db.evaluations.bulkPut(
      trials.map((t) => ({
        experimentId: id,
        key: t.data.spec.hash,
        data: t.data.spec,
      })),
    );
  }
}
export class LineageStorage {
  constructor(private db: LabDatabase) {}
  private async decode(row: LineageRow): Promise<LineageNode> {
    if (hash(row.payload) !== row.checksum)
      throw new Error("Saved lineage checksum mismatch");
    const node = decode(row.payload) as LineageNode;
    if (node.storage.kind === "full" && "parameterHash" in node.storage) {
      const storage = node.storage as {
        kind: "full";
        depth: 0;
        parameterHash: string;
      };
      if (
        storage.parameterHash !== node.genome.parameterHash ||
        Object.keys(storage).some(
          (k) => !["kind", "depth", "parameterHash"].includes(k),
        )
      )
        throw new Error("Invalid lineage anchor reference");
      const blob = await this.db.parameters.get(storage.parameterHash);
      if (!blob) throw new Error("Missing lineage anchor parameters");
      node.storage = {
        kind: "full",
        depth: storage.depth,
        parameters: blob.values,
      };
    }
    validateNode(node);
    if (
      node.genome.id !== row.key ||
      (node.genome.parentIds[0] ?? "") !== row.parentId ||
      node.genome.birthGeneration !== row.birthGeneration
    )
      throw new Error("Saved lineage index mismatch");
    return node;
  }
  private async node(id: string, key: string) {
    const row = await this.db.lineageNodes.get([id, key]);
    return row ? this.decode(row) : undefined;
  }
  private async put(id: string, node: LineageNode) {
    if (node.storage.kind === "full")
      await this.db.parameters.put({
        hash: node.genome.parameterHash,
        values: node.storage.parameters,
      });
    const payload = encode(
      node.storage.kind === "full"
        ? {
            ...node,
            storage: {
              kind: "full",
              depth: 0,
              parameterHash: node.genome.parameterHash,
            },
          }
        : node,
    );
    await this.db.lineageNodes.add({
      experimentId: id,
      key: node.genome.id,
      parentId: node.genome.parentIds[0] ?? "",
      birthGeneration: node.genome.birthGeneration,
      payload,
      checksum: hash(payload),
    });
  }
  async ensure(id: string) {
    if (await this.db.lineageMeta.get(id)) return;
    await this.db.transaction("rw", this.db.tables, async () => {
      if (await this.db.lineageMeta.get(id)) return;
      const head = await this.db.experiments.get(id);
      if (!head) throw new Error("Saved experiment not found");
      const cp = await this.db.checkpoints.get([id, head.generation]);
      if (
        !cp ||
        hash(cp.payload) !== cp.checksum ||
        cp.checksum !== head.checksum
      )
        throw new Error("Saved checkpoint checksum mismatch");
      const session = parseSession(decode(cp.payload));
      const old = await this.db.genomes
        .where("experimentId")
        .equals(id)
        .toArray();
      const blobs = await this.db.parameters.bulkGet(
        old.map((row) => (row.data as Genome).parameterHash),
      );
      const genomes = new Map<string, Genome>();
      old.forEach((row, index) => {
        const g = row.data as Omit<Genome, "parameters">;
        if (!blobs[index] || g.id !== row.key)
          throw new Error("Missing legacy lineage parameters");
        genomes.set(g.id, { ...g, parameters: blobs[index]!.values });
      });
      for (const g of sessionGenomes(session)) {
        const existing = genomes.get(g.id);
        if (existing && contentHash(existing) !== contentHash(g))
          throw new Error("Conflicting legacy lineage identity");
        genomes.set(g.id, g);
      }
      const nodes = new Map<string, LineageNode>();
      for (const g of [...genomes.values()].sort(
        (a, b) =>
          a.birthGeneration - b.birthGeneration || a.id.localeCompare(b.id),
      )) {
        const p = genomes.get(g.parentIds[0]),
          parent = nodes.get(g.parentIds[0]);
        const node = retainGenome(
          g,
          p && parent ? { genome: p, node: parent } : undefined,
        );
        await this.put(id, node);
        nodes.set(g.id, node);
      }
      const generations = await this.db.generations
          .where("experimentId")
          .equals(id)
          .toArray(),
        keys = new Set(
          generations
            .filter((r) => /^\d+$/.test(r.key))
            .map((r) => Number(r.key)),
        );
      let since = head.generation;
      while (since > 0 && keys.has(since - 1)) since--;
      // A checkpoint imported at generation zero still contains all founders.
      await this.db.lineageMeta.add({
        experimentId: id,
        fromGeneration: since,
      });
    });
  }
  /** Called inside the same write transaction as the population head. */
  async capture(
    id: string,
    session: SavedSession,
    previous?: ExperimentCheckpoint,
  ) {
    if (!(await this.db.lineageMeta.get(id))) {
      const bundle = initialLineage(session);
      for (const node of bundle.nodes) await this.put(id, node);
      await this.db.genomes.bulkPut(
        bundle.nodes.map((node) => ({
          experimentId: id,
          key: node.genome.id,
          data: node.genome,
        })),
      );
      for (const { commitId, ...r } of bundle.generations)
        await writeGeneration(this.db, id, r, commitId);
      await this.db.lineageMeta.add({
        experimentId: id,
        fromGeneration: bundle.fromGeneration,
      });
    }
    const parents = new Map(previous?.population.map((g) => [g.id, g]) ?? []);
    for (const g of sessionGenomes(session)) {
      let node = await this.node(id, g.id);
      if (node) {
        const { parameters, ...metadata } = g;
        void parameters;
        if (contentHash(node.genome) !== contentHash(metadata))
          throw new Error("Conflicting immutable lineage identity");
      } else {
        const p = parents.get(g.parentIds[0]),
          parent = p ? await this.node(id, p.id) : undefined;
        node = retainGenome(
          g,
          p && parent ? { genome: p, node: parent } : undefined,
        );
        await this.put(id, node);
      }
    }
  }
  private async genome(id: string, key: string) {
    const nodes = new Map<string, LineageNode>();
    let cursor = key;
    for (let depth = 0; depth <= 16; depth++) {
      const node = await this.node(id, cursor);
      if (!node) throw new Error(`Missing lineage record: ${cursor}`);
      nodes.set(cursor, node);
      if (node.storage.kind === "full") break;
      cursor = node.genome.parentIds[0];
    }
    return reconstructGenome(key, (k) => nodes.get(k));
  }
  private async generation(id: string, generation: number) {
    const row = await this.db.generations.get([id, String(generation)]);
    if (!row) return null;
    const m = row.data as {
      commitId: string;
      populationIds: string[];
      scenarioHashes: string[];
      validationHashes: string[];
      totals: number[];
      championId: string;
      recordChecksum?: string;
    };
    if (
      !Array.isArray(m.populationIds) ||
      m.populationIds.length > 512 ||
      !Array.isArray(m.scenarioHashes) ||
      m.scenarioHashes.length < 1 ||
      m.scenarioHashes.length > 8 ||
      !Array.isArray(m.validationHashes) ||
      m.validationHashes.length > 16
    )
      throw new Error("Invalid retained generation dimensions");
    const scenarios = await this.db.scenarios.bulkGet([
      ...m.scenarioHashes,
      ...m.validationHashes,
    ]);
    const keys = m.populationIds.flatMap((_, slot) =>
      m.scenarioHashes.map(
        (_, trial) =>
          [id, `${generation}:training:${slot}:${trial}`] as [string, string],
      ),
    );
    keys.push(
      ...m.validationHashes.map(
        (_, trial) =>
          [id, `${generation}:validation:${trial}`] as [string, string],
      ),
    );
    const trials = await this.db.trials.bulkGet(keys);
    if (scenarios.some((s) => !s) || trials.some((t) => !t))
      throw new Error("Incomplete retained generation");
    const count = m.scenarioHashes.length;
    const record: GenerationRecord = {
      generation,
      populationIds: m.populationIds,
      scenarios: scenarios
        .slice(0, count)
        .map((s) => s!.data) as GenerationRecord["scenarios"],
      trials: m.populationIds.map(
        (_, slot) =>
          trials
            .slice(slot * count, (slot + 1) * count)
            .map((t) => t!.data) as GenerationRecord["validation"],
      ),
      totals: m.totals,
      championId: m.championId,
      validationScenarios: scenarios
        .slice(count)
        .map((s) => s!.data) as GenerationRecord["scenarios"],
      validation: trials
        .slice(m.populationIds.length * count)
        .map((t) => t!.data) as GenerationRecord["validation"],
    };
    if (m.recordChecksum && contentHash(record) !== m.recordChecksum)
      throw new Error("Retained generation checksum mismatch");
    return { ...record, commitId: m.commitId };
  }
  async read(
    id: string,
    genomeId: string,
    query: LineageQuery = {},
  ): Promise<LineageView> {
    await this.ensure(id);
    const offset = query.childrenOffset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
      throw new Error("Invalid lineage page");
    return this.db.transaction("r", this.db.tables, async () => {
      const genome = await this.genome(id, genomeId),
        parentId = genome.parentIds[0];
      const parent =
        parentId && (await this.node(id, parentId))
          ? await this.genome(id, parentId)
          : null;
      const ancestors: LineageView["ancestors"] = [];
      let cursor: string | undefined = query.ancestorStart ?? parentId,
        missingAncestor: string | null = null;
      const seen = new Set<string>();
      while (cursor && ancestors.length < 30) {
        if (seen.has(cursor)) throw new Error("Cyclic saved ancestry");
        seen.add(cursor);
        const n = await this.node(id, cursor);
        if (!n) {
          missingAncestor = cursor;
          cursor = undefined;
          break;
        }
        ancestors.push(n.genome);
        cursor = n.genome.parentIds[0];
      }
      const children = this.db.lineageNodes
        .where("[experimentId+parentId+birthGeneration+key]")
        .between(
          [id, genomeId, 0, ""],
          [id, genomeId, Number.MAX_SAFE_INTEGER, "\uffff"],
        );
      const childrenCount = await children.count(),
        rows = await children.clone().offset(offset).limit(20).toArray();
      const birth = await this.generation(id, genome.birthGeneration),
        slot = birth?.populationIds.indexOf(genomeId) ?? -1;
      const meta = await this.db.lineageMeta.get(id);
      let replay =
        birth && slot >= 0
          ? {
              generation: birth.generation,
              genome,
              scenarios: birth.scenarios,
              results: birth.trials[slot],
            }
          : null;
      if (!replay && genome.birthGeneration < meta!.fromGeneration) {
        const head = await this.db.experiments.get(id),
          row = head
            ? await this.db.checkpoints.get([id, head.generation])
            : undefined;
        if (
          !head ||
          !row ||
          hash(row.payload) !== head.checksum ||
          row.checksum !== head.checksum
        )
          throw new Error("Saved checkpoint checksum mismatch");
        const session = parseSession(decode(row.payload));
        replay = session.replays.find((r) => r.genome.id === genomeId) ?? null;
        if (replay && contentHash(replay.genome) !== contentHash(genome))
          throw new Error("Retained replay lineage mismatch");
      }
      return {
        genome,
        parent,
        ancestors,
        nextAncestor: cursor ?? null,
        missingAncestor,
        children: await Promise.all(
          rows.map(async (row) => (await this.decode(row)).genome),
        ),
        childrenOffset: offset,
        childrenCount,
        fromGeneration: meta!.fromGeneration,
        totalNodes: await this.db.lineageNodes
          .where("experimentId")
          .equals(id)
          .count(),
        replay,
      };
    });
  }
  async export(id: string, revision: number) {
    await this.ensure(id);
    const snapshot = await this.db.transaction(
      "r",
      this.db.tables,
      async () => {
        const entry = await this.db.experiments.get(id);
        if (!entry) throw new Error("Saved experiment not found");
        if (entry.revision !== revision) throw new RevisionConflict();
        const row = await this.db.checkpoints.get([id, entry.generation]);
        if (
          !row ||
          hash(row.payload) !== entry.checksum ||
          hash(row.payload) !== row.checksum
        )
          throw new Error("Saved checkpoint checksum mismatch");
        const checkpoint = parseSession(decode(row.payload)).checkpoint,
          meta = await this.db.lineageMeta.get(id);
        const bundle: LineageBundle = {
          version: 1,
          fromGeneration: meta!.fromGeneration,
          nodes: await Promise.all(
            (
              await this.db.lineageNodes
                .where("experimentId")
                .equals(id)
                .toArray()
            ).map((row) => this.decode(row)),
          ),
          generations: [],
        };
        for (let g = bundle.fromGeneration; g < entry.generation; g++) {
          const r = await this.generation(id, g);
          if (!r) throw new Error("Missing retained generation");
          bundle.generations.push(r);
        }
        return { bundle, checkpoint };
      },
    );
    validateLineage(snapshot.bundle, snapshot.checkpoint);
    return snapshot.bundle;
  }
}
