import { SimulationClient, type RequestBody } from "../runtime/client";
import type {
  RuntimeStatus,
  PlaybackSnapshot,
  RuntimeEvent,
} from "../runtime/protocol";
import {
  defineExperiment,
  initialCheckpoint,
  validateDefinition,
  type ExperimentDefinition,
  type ExperimentCheckpoint,
} from "../core/evolution";
import { hash } from "../core/canonical";
import { generateScenario } from "../core/world/scenario";
import type { Genome, Scenario, TrialResult } from "../core/model";
import type { GenerationCommit } from "../core/experiment";
import {
  DEFAULT_SETTINGS,
  type Settings,
  type GenerationSummary,
  type Replay,
  type SavedSession,
  type SavedEntry,
  type SavedHandle,
  fingerprint,
  withRuntime,
} from "../persistence/model";
export { DEFAULT_SETTINGS };
export type { Settings, GenerationSummary };
export function prepare(settings: Settings): ExperimentDefinition {
  const s = settings;
  if (
    !s.name.trim() ||
    s.name.length > 64 ||
    !s.seed.trim() ||
    s.seed.length > 64 ||
    !["open", "obstacles"].includes(s.preset) ||
    !Number.isInteger(s.population) ||
    s.population < 16 ||
    s.population > 512 ||
    !Number.isInteger(s.foodCount) ||
    s.foodCount < 1 ||
    s.foodCount > 200 ||
    !Number.isInteger(s.obstacleCount) ||
    s.obstacleCount < 1 ||
    s.obstacleCount > 10 ||
    !Number.isInteger(s.seconds) ||
    s.seconds < 5 ||
    s.seconds > 180 ||
    !Number.isInteger(s.trials) ||
    s.trials < 1 ||
    s.trials > 8 ||
    s.mutationSigma > 1
  )
    throw new Error(
      "Use a population of 16–512, 1–200 food, 1–10 obstacles, 5–180 seconds and 1–8 trials. Names and seeds must be 1–64 characters.",
    );
  const d = defineExperiment(s.seed, s.preset === "obstacles");
  Object.assign(d.world, {
    foodCount: s.foodCount,
    obstacleCount: s.preset === "obstacles" ? s.obstacleCount : 0,
    maxTicks: s.seconds * 30,
  });
  Object.assign(d.evolution, {
    population: s.population,
    trials: s.trials,
    elites: s.elites,
    immigrants: s.immigrants,
    mutationProbability: s.mutationProbability,
    mutationSigma: s.mutationSigma,
  });
  validateDefinition(d);
  return d;
}
export function firstScenario(d: ExperimentDefinition): Scenario {
  return generateScenario(hash(["world-v1", d.roots.training, 0, 0]), d.world);
}
export interface Selection {
  genome: Genome;
  generation: number;
  label: string;
  scenario: Scenario;
  trial: number;
  recordedResult: TrialResult | null;
  historyGeneration: number | null;
  playbackId: string;
}
export interface StorageView {
  state: "opening" | "saved" | "saving" | "error" | "conflict" | "memory";
  id: string | null;
  revision: number;
  entries: SavedEntry[];
  lastSaved: number | null;
  blocked: boolean;
  notice: string | null;
  archiveBusy: boolean;
}
export interface ViewState {
  storage: StorageView;
  ready: boolean;
  failed: boolean;
  error: string | null;
  initializing: boolean;
  loadingPlayback: boolean;
  draft: Settings;
  preview: Scenario | null;
  configError: string | null;
  name: string | null;
  definition: ExperimentDefinition | null;
  status: RuntimeStatus | null;
  selection: Selection | null;
  history: GenerationSummary[];
  replayGenerations: number[];
  population: { id: string; birthGeneration: number }[];
  speed: number;
  showSensors: boolean;
  sensorOnly: boolean;
  showTrail: boolean;
}
import {
  MemoryRepository,
  RevisionConflict,
  type Repository,
} from "../persistence/repository";
import { ENGINE_VERSION } from "../core/model";
export class WorkbenchStore {
  readonly ready: Promise<void>;
  private activeSettings: Settings = { ...DEFAULT_SETTINGS };
  private provenance: SavedSession["provenance"] = {
    created: fingerprint(),
    current: fingerprint(),
    changes: [],
  };
  private pendingSave: {
    commit: GenerationCommit;
    session: SavedSession;
    epoch: number;
  } | null = null;
  private saving = false;

  private view: ViewState;
  private listeners = new Set<() => void>();
  private frameListeners = new Set<() => void>();
  private inspectionListeners = new Set<() => void>();
  private frame: PlaybackSnapshot | null = null;
  private inspection: PlaybackSnapshot | null = null;
  private inspectionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInspection = 0;
  private scope: { experimentId: string; epoch: number } | null = null;
  private checkpoint: ExperimentCheckpoint | null = null;
  private replays: Replay[] = [];
  private selectedReplay: Replay | null = null;
  private serial = 0;
  private disposed = false;
  private unsubscribe: () => void;
  constructor(
    readonly client = new SimulationClient(),
    readonly repository: Repository = new MemoryRepository(),
  ) {
    this.view = {
      storage: {
        state: "opening",
        id: null,
        revision: 0,
        entries: [],
        lastSaved: null,
        blocked: false,
        notice: null,
        archiveBusy: false,
      },
      ready: false,
      failed: false,
      error: null,
      initializing: false,
      loadingPlayback: false,
      draft: { ...DEFAULT_SETTINGS },
      preview: firstScenario(prepare(DEFAULT_SETTINGS)),
      configError: null,
      name: null,
      definition: null,
      status: null,
      selection: null,
      history: [],
      replayGenerations: [],
      population: [],
      speed: 1,
      showSensors: true,
      sensorOnly: false,
      showTrail: true,
    };
    this.unsubscribe = client.subscribe(this.onEvent);
    this.ready = this.boot();
  }
  private storage(patch: Partial<StorageView>) {
    this.update({ storage: { ...this.view.storage, ...patch } });
  }
  private async boot() {
    try {
      await this.client.ready;
    } catch (error) {
      this.problem(error, true);
      return;
    }
    try {
      this.storage({ entries: await this.repository.list(), state: "memory" });
      const id = await this.repository.active();
      if (id) await this.loadSaved(id);
    } catch (error) {
      this.storage({
        state: "error",
        notice: `Local save recovery failed: ${String(error)}`,
      });
    }
    this.update({ ready: true });
  }
  private async refreshLibrary() {
    try {
      this.storage({ entries: await this.repository.list() });
    } catch (error) {
      this.problem(error);
    }
  }
  private makeSession(
    checkpoint = this.checkpoint!,
    history = this.view.history,
    replays = this.replays,
  ): SavedSession {
    const selected = this.view.selection,
      frame = this.frame;
    const retained =
      this.selectedReplay &&
      !replays.some((r) => r.generation === this.selectedReplay!.generation)
        ? [...replays, this.selectedReplay]
        : replays;
    return structuredClone({
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      name: this.view.name ?? this.activeSettings.name,
      settings: this.activeSettings,
      checkpoint,
      history,
      replays: retained,
      bookmark: selected
        ? {
            genome: selected.genome,
            generation: selected.generation,
            label: selected.label,
            scenario: selected.scenario,
            trial: selected.trial,
            recordedResult: selected.recordedResult,
            historyGeneration: selected.historyGeneration,
            tick: frame?.state.tick ?? 0,
          }
        : null,
      provenance: this.provenance,
    });
  }
  getExportSession(): SavedSession {
    if (!this.checkpoint) throw new Error("Create an experiment first");
    return this.pendingSave
      ? structuredClone(this.pendingSave.session)
      : this.makeSession();
  }
  async loadSaved(id: string) {
    if (this.saving) return;
    this.update({ initializing: true, error: null });
    try {
      const handle = await this.repository.load(id);
      await this.activateSaved(handle);
      await this.repository.activate(id);
      await this.refreshLibrary();
    } catch (error) {
      this.problem(error);
      this.storage({ state: "error", notice: String(error) });
    } finally {
      this.update({ initializing: false });
    }
  }
  private async activateSaved(handle: SavedHandle) {
    const session = withRuntime(handle.session, fingerprint()),
      cp = session.checkpoint;
    const reply = await this.client.request({
      type: "initialize",
      checkpoint: cp,
    });
    if (reply.type !== "status")
      throw new Error("Unexpected initialization reply");
    this.scope = { experimentId: cp.definition.id, epoch: reply.status.epoch };
    this.checkpoint = cp;
    this.activeSettings = session.settings;
    this.provenance = session.provenance;
    this.pendingSave = null;
    this.replays = [...session.replays]
      .sort((a, b) => a.generation - b.generation)
      .slice(-50);
    this.selectedReplay =
      session.bookmark?.historyGeneration !== null
        ? (session.replays.find(
            (r) => r.generation === session.bookmark?.historyGeneration,
          ) ?? null)
        : null;
    this.frame = null;
    this.inspectFrame(true);
    this.update({
      name: session.name,
      definition: cp.definition,
      draft: session.settings,
      preview: firstScenario(cp.definition),
      configError: null,
      history: session.history,
      replayGenerations: this.replays.map((r) => r.generation),
      selection: null,
      population: cp.population.map((g) => ({
        id: g.id,
        birthGeneration: g.birthGeneration,
      })),
      status: reply.status,
    });
    this.storage({
      id: handle.entry.id,
      revision: handle.entry.revision,
      state: "saved",
      lastSaved: handle.entry.updatedAt,
      blocked: false,
      notice: session.provenance.changes.length
        ? "This checkpoint has been continued in a different browser runtime; exact cross-runtime replay is not guaranteed."
        : handle.entry.interrupted
          ? `Training stopped before the next save. Recovered population ${cp.generation}; its unfinished generation will rerun.`
          : null,
    });
    if (session.bookmark) {
      const { tick, ...selection } = session.bookmark;
      await this.open(selection);
      if (tick !== 1) await this.playback("seek", tick);
    } else if (cp.generation === 0)
      await this.open({
        genome: cp.population[0],
        generation: 0,
        label: "Initial controller",
        scenario: firstScenario(cp.definition),
        trial: 0,
        recordedResult: null,
        historyGeneration: null,
      });
    else await this.selectPopulation(cp.population[0].id);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  subscribeFrames = (listener: () => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };
  subscribeInspection = (listener: () => void) => {
    this.inspectionListeners.add(listener);
    return () => {
      this.inspectionListeners.delete(listener);
    };
  };
  getView = () => this.view;
  getFrame = () => this.frame;
  getInspection = () => this.inspection;
  private update(patch: Partial<ViewState>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
  private problem(error: unknown, failed = false) {
    this.update({
      error: error instanceof Error ? error.message : String(error),
      failed: failed || this.view.failed,
    });
  }
  clearError() {
    this.update({ error: null });
  }
  updateDraft(patch: Partial<Settings>) {
    const draft = { ...this.view.draft, ...patch };
    try {
      const d = prepare(draft),
        key = hash([d.roots.training, d.world]);
      const old = this.view.preview;
      const preview =
        old &&
        hash([prepare(this.view.draft).roots.training, old.config]) === key
          ? old
          : firstScenario(d);
      this.update({ draft, preview, configError: null });
    } catch (error) {
      this.update({
        draft,
        preview: null,
        configError: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private inspectFrame(force = false) {
    if (this.disposed) return;
    const elapsed = performance.now() - this.lastInspection;
    if (!force && elapsed < 100) {
      if (this.inspectionTimer === null)
        this.inspectionTimer = setTimeout(() => {
          this.inspectionTimer = null;
          this.inspectFrame(true);
        }, 100 - elapsed);
      return;
    }
    if (this.inspectionTimer !== null) {
      clearTimeout(this.inspectionTimer);
      this.inspectionTimer = null;
    }
    this.lastInspection = performance.now();
    this.inspection = this.frame;
    for (const f of this.inspectionListeners) f();
  }
  private acceptFrame(snapshot: PlaybackSnapshot, force = false) {
    if (snapshot.playbackId !== this.view.selection?.playbackId) return;
    this.frame = snapshot;
    for (const f of this.frameListeners) f();
    this.inspectFrame(force);
  }
  private acceptStatus(status: RuntimeStatus) {
    if (this.view.status && status.epoch < this.view.status.epoch) return;
    this.update({ status });
    if (!status.playing) this.inspectFrame(true);
  }
  private onEvent = (event: RuntimeEvent) => {
    if (event.type === "status") this.acceptStatus(event.status);
    if (event.type === "reply" && event.data.type === "status")
      this.acceptStatus(event.data.status);
    if (event.type === "snapshot") this.acceptFrame(event.snapshot);
    if (
      event.type === "generationCommit" &&
      event.epoch === this.scope?.epoch &&
      event.experimentId === this.scope.experimentId
    )
      this.acceptCommit(event.commit, event.epoch);
    if (
      event.type === "error" &&
      (event.scope === "training" ||
        event.scope === "worker" ||
        event.scope === "playback")
    )
      this.problem(event.message, event.scope === "worker");
  };
  private acceptCommit(commit: GenerationCommit, epoch: number) {
    const cp = this.checkpoint;
    if (!cp || cp.generation !== commit.record.generation) return;
    const index = cp.population.findIndex(
        (g) => g.id === commit.record.championId,
      ),
      genome = cp.population[index];
    if (!genome) {
      this.problem("Champion is missing from its evaluated population.");
      return;
    }
    const k = cp.definition.evolution.trials,
      sorted = commit.record.totals.map((x) => x / k).sort((a, b) => a - b),
      n = sorted.length;
    const summary: GenerationSummary = {
      generation: commit.record.generation,
      best: sorted[n - 1],
      median:
        n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
      validation: commit.record.validation.length
        ? commit.record.validation.reduce((sum, t) => sum + t.score, 0) /
          commit.record.validation.length
        : null,
      commitId: commit.id,
      championId: genome.id,
    };
    const replays = [
      ...this.replays,
      {
        generation: summary.generation,
        genome,
        scenarios: commit.record.scenarios,
        results: commit.record.trials[index],
      },
    ].slice(-50);
    const session = this.makeSession(
      commit.nextCheckpoint,
      [...this.view.history, summary].slice(-1000),
      replays,
    );
    this.pendingSave = { commit, session, epoch };
    void this.retrySave();
  }
  async retrySave() {
    if (this.saving || !this.checkpoint) return;
    this.saving = true;
    this.storage({ state: "saving", blocked: true });
    const pending = this.pendingSave;
    try {
      let id = this.view.storage.id,
        revision = this.view.storage.revision;
      if (!id) {
        const created = await this.repository.create(this.makeSession());
        id = created.entry.id;
        revision = created.entry.revision;
        this.storage({ id, revision });
      }
      const session = pending?.session ?? this.makeSession();
      const interrupted = pending
        ? (this.view.status?.targetGeneration ?? 0) >
          session.checkpoint.generation
        : this.view.status?.phase === "evaluating";
      const handle = await this.repository.save(
        id,
        revision,
        session,
        pending?.commit,
        interrupted,
      );
      this.storage({
        id,
        revision: handle.entry.revision,
        state: "saved",
        lastSaved: handle.entry.updatedAt,
        blocked: false,
        notice: null,
      });
      if (pending) {
        this.checkpoint = handle.session.checkpoint;
        this.replays = [...handle.session.replays]
          .sort((a, b) => a.generation - b.generation)
          .slice(-50);
        this.pendingSave = null;
        this.update({
          history: handle.session.history,
          replayGenerations: this.replays.map((r) => r.generation),
          population: this.checkpoint.population.map((g) => ({
            id: g.id,
            birthGeneration: g.birthGeneration,
          })),
        });
        await this.client.request({
          type: "commitSucceeded",
          experimentId: this.checkpoint.definition.id,
          epoch: pending.epoch,
          commitId: pending.commit.id,
        });
      }
      await this.refreshLibrary();
    } catch (error) {
      this.storage({
        state: error instanceof RevisionConflict ? "conflict" : "error",
        blocked: true,
        notice: String(error),
      });
      if (pending)
        await this.client
          .request({
            type: "commitFailed",
            experimentId: pending.session.checkpoint.definition.id,
            epoch: pending.epoch,
            commitId: pending.commit.id,
            message: String(error).slice(0, 1000),
          })
          .catch(() => {});
    } finally {
      this.saving = false;
    }
  }
  async saveSeparate() {
    if (this.saving || !this.checkpoint) return;
    this.update({ initializing: true });
    try {
      const handle = await this.repository.create(
        withRuntime(this.getExportSession(), fingerprint()),
      );
      await this.activateSaved(handle);
      await this.refreshLibrary();
    } catch (error) {
      this.problem(error);
    } finally {
      this.update({ initializing: false });
    }
  }

  async create() {
    await this.ready;
    if (this.view.initializing || this.saving) return;
    if (this.pendingSave) {
      this.problem(
        "Retry the pending save, export it, or load a saved population before replacing this experiment.",
      );
      return;
    }
    this.update({ initializing: true, error: null });
    const serial = ++this.serial;
    try {
      const d = prepare(this.view.draft),
        cp = initialCheckpoint(d),
        reply = await this.client.request({
          type: "initialize",
          checkpoint: cp,
        });
      if (reply.type !== "status")
        throw new Error("Unexpected initialization reply");
      this.scope = { experimentId: d.id, epoch: reply.status.epoch };
      this.checkpoint = cp;
      this.activeSettings = { ...this.view.draft };
      this.provenance = {
        created: fingerprint(),
        current: fingerprint(),
        changes: [],
      };
      this.replays = [];
      this.selectedReplay = null;
      this.frame = null;
      this.inspectFrame(true);
      this.update({
        name: this.activeSettings.name,
        definition: d,
        history: [],
        replayGenerations: [],
        selection: null,
        population: cp.population.map((g) => ({
          id: g.id,
          birthGeneration: g.birthGeneration,
        })),
        status: reply.status,
      });
      try {
        const handle = await this.repository.create(this.makeSession());
        this.storage({
          id: handle.entry.id,
          revision: 0,
          state: "saved",
          lastSaved: handle.entry.updatedAt,
          blocked: false,
          notice: null,
        });
        await this.refreshLibrary();
      } catch (error) {
        this.storage({
          id: null,
          revision: 0,
          state: "error",
          blocked: false,
          notice: `Initial population is in memory; saving failed: ${String(error)}`,
        });
      }
      await this.open({
        genome: cp.population[0],
        generation: 0,
        label: "Initial controller",
        scenario: firstScenario(d),
        trial: 0,
        recordedResult: null,
        historyGeneration: null,
      });
    } catch (error) {
      if (serial <= this.serial) this.problem(error);
    } finally {
      this.update({ initializing: false });
    }
  }
  private requiredScope() {
    if (!this.scope) throw new Error("Create an experiment first");
    return this.scope;
  }
  async train(generations: number) {
    try {
      if (this.view.storage.blocked || this.pendingSave)
        throw new Error(
          "Retry or export the pending save before training again.",
        );
      if (this.view.storage.id) {
        try {
          await this.repository.markRunning(
            this.view.storage.id,
            this.view.storage.revision,
          );
        } catch (error) {
          this.storage({
            state: error instanceof RevisionConflict ? "conflict" : "error",
            blocked: true,
            notice: String(error),
          });
          return;
        }
      }
      await this.client.request({
        type: "startTraining",
        ...this.requiredScope(),
        generations,
      });
    } catch (error) {
      this.problem(error);
    }
  }
  async pauseTraining() {
    try {
      await this.client.request({
        type: "pauseTraining",
        ...this.requiredScope(),
      });
    } catch (error) {
      this.problem(error);
    }
  }
  private async open(value: Omit<Selection, "playbackId">) {
    if (value.historyGeneration === null) this.selectedReplay = null;
    const serial = ++this.serial,
      selection = { ...value, playbackId: `workbench-${serial}` };
    this.frame = null;
    this.inspectFrame(true);
    this.update({ selection, loadingPlayback: true });
    for (const f of this.frameListeners) f();
    try {
      const reply = await this.client.request({
        type: "openPlayback",
        playbackId: selection.playbackId,
        definition: {
          scenario: selection.scenario,
          controller: {
            kind: "neural",
            id: selection.genome.id,
            parameters: selection.genome.parameters,
          },
        },
      });
      if (serial !== this.serial) return;
      if (reply.type === "playback") this.acceptFrame(reply.snapshot, true);
      const first = await this.client.request({
        type: "stepPlayback",
        playbackId: selection.playbackId,
        mode: "decision",
      });
      if (serial === this.serial && first.type === "playback")
        this.acceptFrame(first.snapshot, true);
    } catch (error) {
      if (serial === this.serial) this.problem(error);
    } finally {
      if (serial === this.serial) this.update({ loadingPlayback: false });
    }
  }
  selectPopulation(id: string) {
    const cp = this.checkpoint,
      genome = cp?.population.find((g) => g.id === id);
    if (!genome || !cp) return;
    const scenario = generateScenario(
      hash(["world-v1", cp.definition.roots.training, cp.generation, 0]),
      cp.definition.world,
    );
    return this.open({
      genome,
      generation: cp.generation,
      label: `Population ${cp.generation}`,
      scenario,
      trial: 0,
      recordedResult: null,
      historyGeneration: null,
    });
  }
  selectChampion(generation: number, trial = 0) {
    const r =
      this.replays.find((r) => r.generation === generation) ??
      (this.selectedReplay?.generation === generation
        ? this.selectedReplay
        : null);
    if (!r || !r.scenarios[trial]) return;
    this.selectedReplay = r;
    return this.open({
      genome: r.genome,
      generation,
      label: `Generation ${generation} champion`,
      scenario: r.scenarios[trial],
      trial,
      recordedResult: r.results[trial],
      historyGeneration: generation,
    });
  }
  getTrialCount() {
    const g = this.view.selection?.historyGeneration;
    return (
      (this.selectedReplay && this.selectedReplay.generation === g
        ? this.selectedReplay.scenarios.length
        : this.replays.find((r) => r.generation === g)?.scenarios.length) ?? 1
    );
  }
  async playback(
    action: "toggle" | "pause" | "tick" | "decision" | "seek",
    tick = 0,
  ) {
    const id = this.view.selection?.playbackId;
    if (!id) return;
    let command: RequestBody;
    if (action === "toggle" || action === "pause")
      command = {
        type: "setPlaybackState",
        playbackId: id,
        playing: action === "toggle" ? !this.view.status?.playing : false,
        speed: this.view.speed,
      };
    else if (action === "seek")
      command = { type: "seekPlayback", playbackId: id, tick };
    else command = { type: "stepPlayback", playbackId: id, mode: action };
    try {
      const reply = await this.client.request(command);
      if (reply.type === "playback") this.acceptFrame(reply.snapshot, true);
    } catch (error) {
      if (
        id === this.view.selection?.playbackId &&
        !String(error).includes("CANCELLED")
      )
        this.problem(error);
    }
  }
  async setSpeed(speed: number) {
    this.update({ speed });
    const id = this.view.selection?.playbackId;
    if (id) {
      try {
        await this.client.request({
          type: "setPlaybackState",
          playbackId: id,
          playing: this.view.status?.playing ?? false,
          speed,
        });
      } catch (error) {
        this.problem(error);
      }
    }
  }
  preference(
    patch: Partial<Pick<ViewState, "showSensors" | "sensorOnly" | "showTrail">>,
  ) {
    this.update(patch);
    for (const f of this.frameListeners) f();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.serial++;
    this.unsubscribe();
    if (this.inspectionTimer !== null) clearTimeout(this.inspectionTimer);
    this.listeners.clear();
    this.frameListeners.clear();
    this.inspectionListeners.clear();
    this.client.close();
    this.repository.close();
  }
}
