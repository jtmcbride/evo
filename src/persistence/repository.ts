import { encode } from "../core/codec";
import { hash } from "../core/canonical";
import { checkpointIdentity, type GenerationCommit } from "../core/experiment";
import {
  parseSession,
  parseComparison,
  type SavedSession,
  type SavedEntry,
  type SavedHandle,
} from "./model";
import type { SensorComparison } from "../core/comparison";
import type { LineageBundle } from "../core/lineage";
import {
  initialLineage,
  appendLineage,
  lineageView,
  type LineageQuery,
  type LineageView,
} from "./lineage";
export function mergeComparisons(
  a: SensorComparison[] = [],
  b: SensorComparison[] = [],
) {
  const records = new Map(a.map((c) => [c.id, c]));
  for (const c of b) {
    const old = records.get(c.id);
    if (old && hash(encode(old)) !== hash(encode(c)))
      throw new Error("Comparison checksum conflict");
    records.set(c.id, c);
  }
  if (records.size > 32)
    throw new Error(
      "This experiment already contains 32 comparisons. Start a new experiment for more.",
    );
  return Array.from(records.values());
}
export class RevisionConflict extends Error {
  constructor() {
    super(
      "This experiment has a newer saved population in another tab. Load the saved population or export this one as a separate checkpoint.",
    );
    this.name = "RevisionConflict";
  }
}
export interface Repository {
  list(): Promise<SavedEntry[]>;
  active(): Promise<string | null>;
  load(id: string): Promise<SavedHandle>;
  activate(id: string): Promise<void>;
  create(session: SavedSession): Promise<SavedHandle>;
  save(
    id: string,
    revision: number,
    session: SavedSession,
    commit?: GenerationCommit,
    interrupted?: boolean,
  ): Promise<SavedHandle>;
  markRunning(id: string, revision: number): Promise<void>;
  saveComparison(id: string, comparison: SensorComparison): Promise<void>;
  lineage(
    id: string,
    genomeId: string,
    query?: LineageQuery,
  ): Promise<LineageView>;
  exportLineage(id: string, revision: number): Promise<LineageBundle>;
  close(): void;
}
export function validateCommit(
  commit: GenerationCommit,
  session: SavedSession,
) {
  const cp = commit.nextCheckpoint;
  const expected = hash({
    record: commit.record,
    nextCheckpoint: checkpointIdentity({ ...cp, lastCommitId: null }),
  });
  if (
    expected !== commit.id ||
    cp.lastCommitId !== commit.id ||
    cp.generation !== commit.record.generation + 1 ||
    hash(JSON.parse(encode(cp))) !==
      hash(JSON.parse(encode(session.checkpoint)))
  )
    throw new Error("Invalid generation commit");
}
export function entryFor(
  id: string,
  revision: number,
  session: SavedSession,
  interrupted = false,
): SavedEntry {
  return {
    id,
    name: session.name,
    generation: session.checkpoint.generation,
    revision,
    engineVersion: session.engineVersion,
    updatedAt: Date.now(),
    checksum: hash(encode(session)),
    interrupted,
    lastCommitId: session.checkpoint.lastCommitId,
  };
}
/** Used by numerical/store tests; browser application explicitly supplies IndexedRepository. */
export class MemoryRepository implements Repository {
  private data = new Map<string, SavedHandle>();
  private activeId: string | null = null;
  private comparisons = new Map<string, SensorComparison[]>();
  private histories = new Map<string, LineageBundle>();
  async list() {
    return structuredClone(
      Array.from(this.data.values(), (v) => v.entry).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
  }
  async active() {
    return this.activeId;
  }
  async load(id: string) {
    const h = this.data.get(id);
    if (!h) throw new Error("Saved experiment not found");
    return structuredClone({
      ...h,
      session: {
        ...h.session,
        comparisons: mergeComparisons(
          h.session.comparisons,
          this.comparisons.get(id),
        ),
      },
    });
  }
  async activate(id: string) {
    if (!this.data.has(id)) throw new Error("Saved experiment not found");
    this.activeId = id;
  }
  async create(value: SavedSession) {
    const session = parseSession(value),
      id = crypto.randomUUID(),
      h = { entry: entryFor(id, 0, session), session };
    this.data.set(id, structuredClone(h));
    this.histories.set(id, initialLineage(session));
    this.comparisons.set(id, structuredClone(session.comparisons ?? []));
    this.activeId = id;
    return structuredClone(h);
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
    const old = await this.load(id);
    if (
      commit &&
      old.entry.lastCommitId === commit.id &&
      old.entry.generation === session.checkpoint.generation
    )
      return old;
    if (old.entry.revision !== revision) throw new RevisionConflict();
    if (commit)
      this.histories.set(
        id,
        appendLineage(this.histories.get(id)!, old.session.checkpoint, commit),
      );
    this.comparisons.set(
      id,
      mergeComparisons(
        this.comparisons.get(id),
        mergeComparisons(old.session.comparisons, session.comparisons),
      ),
    );
    const h = {
      entry: entryFor(id, revision + 1, session, interrupted),
      session,
    };
    this.data.set(id, structuredClone(h));
    return structuredClone(h);
  }
  async markRunning(id: string, revision: number) {
    const old = this.data.get(id);
    if (!old || old.entry.revision !== revision) throw new RevisionConflict();
    old.entry.interrupted = true;
  }
  async saveComparison(id: string, value: SensorComparison) {
    if (!this.data.has(id)) throw new Error("Saved experiment not found");
    const c = parseComparison(value);
    const current = await this.load(id);
    this.comparisons.set(
      id,
      mergeComparisons(
        this.comparisons.get(id),
        mergeComparisons(current.session.comparisons, [c]),
      ),
    );
  }
  async lineage(id: string, genomeId: string, query?: LineageQuery) {
    const bundle = this.histories.get(id);
    if (!bundle) throw new Error("Saved lineage not found");
    return lineageView(bundle, genomeId, query);
  }
  async exportLineage(id: string, revision: number) {
    if ((await this.load(id)).entry.revision !== revision)
      throw new RevisionConflict();
    const bundle = this.histories.get(id);
    if (!bundle) throw new Error("Saved lineage not found");
    return structuredClone(bundle);
  }
  close() {}
}
