import Dexie, { type Table } from "dexie";
import { encode, decode } from "../core/codec";
import { hash } from "../core/canonical";
import type { Genome } from "../core/model";
import type { GenerationCommit } from "../core/experiment";
import {
  parseSession,
  parseComparison,
  type SavedSession,
  type SavedEntry,
  type SavedHandle,
} from "./model";
import {
  entryFor,
  validateCommit,
  RevisionConflict,
  type Repository,
  mergeComparisons,
} from "./repository";
import type { SensorComparison } from "../core/comparison";
interface CheckpointRow {
  experimentId: string;
  generation: number;
  payload: string;
  checksum: string;
}
interface DataRow {
  experimentId: string;
  key: string;
  data: unknown;
}
export class LabDatabase extends Dexie {
  experiments!: Table<SavedEntry, string>;
  checkpoints!: Table<CheckpointRow, [string, number]>;
  genomes!: Table<DataRow, [string, string]>;
  parameters!: Table<{ hash: string; values: Float32Array }, string>;
  memberships!: Table<DataRow, [string, string]>;
  generations!: Table<DataRow, [string, string]>;
  scenarios!: Table<{ hash: string; data: unknown }, string>;
  evaluations!: Table<DataRow, [string, string]>;
  trials!: Table<DataRow, [string, string]>;
  meta!: Table<{ key: string; value: string }, string>;
  comparisons!: Table<
    { experimentId: string; key: string; payload: string; checksum: string },
    [string, string]
  >;
  constructor(name = "evolution-lab-v1") {
    super(name);
    this.version(1).stores({
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
    this.version(2).stores({ comparisons: "[experimentId+key],experimentId" });
  }
}
function prepareRows(
  id: string,
  session: SavedSession,
  commit?: GenerationCommit,
) {
  const genomes = new Map<string, Genome>();
  for (const g of session.checkpoint.population) genomes.set(g.id, g);
  for (const r of session.replays) genomes.set(r.genome.id, r.genome);
  if (session.bookmark)
    genomes.set(session.bookmark.genome.id, session.bookmark.genome);
  const scenarios = new Map(
    session.replays.flatMap((r) =>
      r.scenarios.map((s) => [s.hash, s] as const),
    ),
  );
  if (session.bookmark)
    scenarios.set(session.bookmark.scenario.hash, session.bookmark.scenario);
  if (commit)
    for (const s of [
      ...commit.record.scenarios,
      ...commit.record.validationScenarios,
    ])
      scenarios.set(s.hash, s);
  // Numerical checkpoint payloads stay small; comparison records have independent checksums.
  const payload = encode({ ...session, comparisons: [] }),
    trials: DataRow[] = [],
    evaluations: DataRow[] = [];
  const result = (data: unknown, key: string) =>
    trials.push({ experimentId: id, key, data });
  if (commit) {
    commit.record.trials.forEach((list, slot) =>
      list.forEach((t, i) => {
        result(t, `${commit.record.generation}:training:${slot}:${i}`);
        evaluations.push({ experimentId: id, key: t.spec.hash, data: t.spec });
      }),
    );
    commit.record.validation.forEach((t, i) => {
      result(t, `${commit.record.generation}:validation:${i}`);
      evaluations.push({ experimentId: id, key: t.spec.hash, data: t.spec });
    });
  }
  for (const r of session.replays)
    r.results.forEach((t, i) => {
      result(t, `${r.generation}:champion:${i}`);
      evaluations.push({ experimentId: id, key: t.spec.hash, data: t.spec });
    });
  return {
    payload,
    checksum: hash(payload),
    genomes: Array.from(genomes.values(), ({ parameters, ...g }) => ({
      experimentId: id,
      key: g.id,
      data: g,
      parameters,
    })),
    scenarios: Array.from(scenarios.values(), (s) => ({
      hash: s.hash,
      data: s,
    })),
    trials,
    evaluations,
    memberships: session.checkpoint.population.map((g, slot) => ({
      experimentId: id,
      key: `${session.checkpoint.generation}:${slot}`,
      data: { generation: session.checkpoint.generation, slot, genomeId: g.id },
    })),
  };
}
export class IndexedRepository implements Repository {
  readonly db: LabDatabase;
  constructor(name?: string) {
    this.db = new LabDatabase(name);
  }
  async list() {
    return this.db.experiments.orderBy("updatedAt").reverse().toArray();
  }
  async active() {
    return (await this.db.meta.get("active"))?.value ?? null;
  }
  async activate(id: string) {
    await this.db.transaction(
      "rw",
      this.db.experiments,
      this.db.meta,
      async () => {
        if (!(await this.db.experiments.get(id)))
          throw new Error("Saved experiment not found");
        await this.db.meta.put({ key: "active", value: id });
      },
    );
  }
  private decode(row: CheckpointRow, entry: SavedEntry): SavedHandle {
    if (hash(row.payload) !== row.checksum || row.checksum !== entry.checksum)
      throw new Error(
        "Saved checkpoint checksum mismatch. Import a backup or choose another experiment.",
      );
    const session = parseSession(decode(row.payload));
    if (session.checkpoint.generation !== entry.generation)
      throw new Error("Saved checkpoint head mismatch");
    return { entry, session };
  }
  async load(id: string) {
    return this.db.transaction(
      "r",
      this.db.experiments,
      this.db.checkpoints,
      this.db.comparisons,
      async () => {
        const entry = await this.db.experiments.get(id);
        if (!entry) throw new Error("Saved experiment not found");
        const row = await this.db.checkpoints.get([id, entry.generation]);
        if (!row) throw new Error("Saved checkpoint is missing");
        const handle = this.decode(row, entry);
        const records = await this.readComparisons(id);
        handle.session.comparisons = mergeComparisons(
          handle.session.comparisons,
          records,
        );
        return handle;
      },
    );
  }
  async create(value: SavedSession) {
    const session = parseSession(value),
      id = crypto.randomUUID(),
      rows = prepareRows(id, session),
      entry = entryFor(id, 0, { ...session, comparisons: [] });
    await this.db.transaction("rw", this.db.tables, async () => {
      await this.writeRows(id, session, rows);
      await this.db.experiments.add(entry);
      await this.db.meta.put({ key: "active", value: id });
    });
    return { entry, session };
  }
  async save(
    id: string,
    revision: number,
    value: SavedSession,
    commit?: GenerationCommit,
    interrupted = false,
  ) {
    const session = parseSession(value);
    if (commit) validateCommit(commit, session);
    const rows = prepareRows(id, session, commit);
    return this.db.transaction("rw", this.db.tables, async () => {
      const previous = await this.db.experiments.get(id);
      if (!previous) throw new Error("Saved experiment not found");
      if (
        commit &&
        previous.lastCommitId === commit.id &&
        previous.generation === session.checkpoint.generation
      ) {
        const row = await this.db.checkpoints.get([id, previous.generation]);
        if (!row) throw new Error("Saved checkpoint is missing");
        return this.decode(row, previous);
      }
      if (previous.revision !== revision) throw new RevisionConflict();
      if (
        session.checkpoint.generation !==
        previous.generation + (commit ? 1 : 0)
      )
        throw new Error("Invalid saved generation transition");
      await this.writeRows(id, session, rows);
      if (commit) {
        const r = commit.record;
        await this.db.generations.put({
          experimentId: id,
          key: String(r.generation),
          data: {
            commitId: commit.id,
            generation: r.generation,
            populationIds: r.populationIds,
            totals: r.totals,
            championId: r.championId,
            scenarioHashes: r.scenarios.map((s) => s.hash),
            validationHashes: r.validationScenarios.map((s) => s.hash),
          },
        });
      }
      const entry = entryFor(
        id,
        revision + 1,
        { ...session, comparisons: [] },
        interrupted,
      );
      await this.db.experiments.put(entry);
      // Keep the head plus historical populations every ten generations.
      await this.db.checkpoints
        .where("experimentId")
        .equals(id)
        .filter(
          (r) => r.generation !== entry.generation && r.generation % 10 !== 0,
        )
        .delete();
      return { entry, session };
    });
  }
  private async writeRows(
    id: string,
    session: SavedSession,
    rows: ReturnType<typeof prepareRows>,
  ) {
    for (const c of session.comparisons ?? [])
      await this.writeComparison(id, c);
    await this.db.parameters.bulkPut(
      rows.genomes.map((g) => ({
        hash: (g.data as Genome).parameterHash,
        values: g.parameters,
      })),
    );
    await this.db.genomes.bulkPut(
      rows.genomes.map(({ parameters, ...g }) => {
        void parameters;
        return g;
      }),
    );
    await this.db.memberships.bulkPut(rows.memberships);
    await this.db.scenarios.bulkPut(rows.scenarios);
    if (rows.trials.length) await this.db.trials.bulkPut(rows.trials);
    if (rows.evaluations.length)
      await this.db.evaluations.bulkPut(rows.evaluations);
    if (session.history.length)
      await this.db.generations.bulkPut(
        session.history.map((data) => ({
          experimentId: id,
          key: `summary:${data.generation}`,
          data,
        })),
      );
    await this.db.checkpoints.put({
      experimentId: id,
      generation: session.checkpoint.generation,
      payload: rows.payload,
      checksum: rows.checksum,
    });
  }
  async markRunning(id: string, revision: number) {
    await this.db.transaction("rw", this.db.experiments, async () => {
      const entry = await this.db.experiments.get(id);
      if (!entry || entry.revision !== revision) throw new RevisionConflict();
      await this.db.experiments.update(id, { interrupted: true });
    });
  }
  private async readComparisons(id: string) {
    const rows = await this.db.comparisons
      .where("experimentId")
      .equals(id)
      .toArray();
    if (rows.length > 32) throw new Error("Excessive saved comparisons");
    return rows.map((row) => {
      if (hash(row.payload) !== row.checksum)
        throw new Error("Saved comparison checksum mismatch");
      const c = parseComparison(decode(row.payload));
      if (row.key !== c.id)
        throw new Error("Saved comparison identity mismatch");
      return c;
    });
  }
  private async writeComparison(id: string, c: SensorComparison) {
    const payload = encode(c),
      checksum = hash(payload);
    const old = await this.db.comparisons.get([id, c.id]);
    if (old) {
      if (old.checksum !== checksum || hash(old.payload) !== checksum)
        throw new Error("Comparison checksum conflict");
      return;
    }
    if (
      (await this.db.comparisons.where("experimentId").equals(id).count()) >= 32
    )
      throw new Error(
        "This experiment already contains 32 comparisons. Start a new experiment for more.",
      );
    await this.db.comparisons.add({
      experimentId: id,
      key: c.id,
      payload,
      checksum,
    });
  }
  async saveComparison(id: string, value: SensorComparison) {
    const c = parseComparison(value);
    await this.db.transaction(
      "rw",
      this.db.experiments,
      this.db.comparisons,
      async () => {
        if (!(await this.db.experiments.get(id)))
          throw new Error("Saved experiment not found");
        await this.writeComparison(id, c);
      },
    );
  }
  close() {
    this.db.close();
  }
}
