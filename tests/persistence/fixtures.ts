import {
  DEFAULT_SETTINGS,
  fingerprint,
  type SavedSession,
} from "../../src/persistence/model";
import { defineExperiment, initialCheckpoint } from "../../src/core/evolution";
import { ExperimentRunner } from "../../src/core/experiment";
export function savedFixture(seed = "save-test"): SavedSession {
  const d = defineExperiment(seed);
  d.world.maxTicks = 150;
  d.evolution.population = 16;
  return {
    formatVersion: 1,
    engineVersion: "evo-engine-1",
    name: DEFAULT_SETTINGS.name,
    settings: { ...DEFAULT_SETTINGS, seed, population: 16, seconds: 5 },
    checkpoint: initialCheckpoint(d),
    history: [],
    replays: [],
    bookmark: null,
    comparisons: [],
    provenance: { created: fingerprint(), current: fingerprint(), changes: [] },
  };
}
export function nextFixture(session: SavedSession) {
  const r = new ExperimentRunner(session.checkpoint);
  while (r.phase !== "awaitingCommit") r.advance(10000);
  const commit = r.pendingCommit()!;
  return {
    commit,
    session: { ...structuredClone(session), checkpoint: commit.nextCheckpoint },
  };
}
