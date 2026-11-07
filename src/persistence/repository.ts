import { encode } from "../core/codec";
import { hash } from "../core/canonical";
import { checkpointIdentity, type GenerationCommit } from "../core/experiment";
import {
  parseSession,
  type SavedSession,
  type SavedEntry,
  type SavedHandle,
} from "./model";
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
    return structuredClone(h);
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
  close() {}
}
