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
export interface Settings {
  name: string;
  preset: "open" | "obstacles";
  seed: string;
  population: number;
  foodCount: number;
  obstacleCount: number;
  seconds: number;
  trials: number;
  elites: number;
  immigrants: number;
  mutationProbability: number;
  mutationSigma: number;
}
export const DEFAULT_SETTINGS: Settings = {
  name: "Foraging study",
  preset: "open",
  seed: "42",
  population: 128,
  foodCount: 48,
  obstacleCount: 5,
  seconds: 60,
  trials: 3,
  elites: 4,
  immigrants: 8,
  mutationProbability: 0.1,
  mutationSigma: 0.05,
};
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
export interface GenerationSummary {
  generation: number;
  best: number;
  median: number;
  validation: number | null;
  commitId: string;
  championId: string;
}
interface Replay {
  generation: number;
  genome: Genome;
  scenarios: Scenario[];
  results: TrialResult[];
}
export interface ViewState {
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
export class WorkbenchStore {
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
  constructor(readonly client = new SimulationClient()) {
    this.view = {
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
    void client.ready
      .then(() => {
        if (!this.disposed) this.update({ ready: true });
      })
      .catch((error) => this.problem(error, true));
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
    this.replays = [
      ...this.replays,
      {
        generation: summary.generation,
        genome,
        scenarios: commit.record.scenarios,
        results: commit.record.trials[index],
      },
    ].slice(-50);
    this.checkpoint = commit.nextCheckpoint;
    this.update({
      history: [...this.view.history, summary].slice(-1000),
      replayGenerations: this.replays.map((r) => r.generation),
      population: commit.nextCheckpoint.population.map((g) => ({
        id: g.id,
        birthGeneration: g.birthGeneration,
      })),
    });
    void this.client
      .request({
        type: "commitSucceeded",
        experimentId: cp.definition.id,
        epoch,
        commitId: commit.id,
      })
      .catch((error) => {
        if (this.scope?.epoch === epoch) this.problem(error);
      });
  }
  async create() {
    if (this.view.initializing) return;
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
      this.replays = [];
      this.frame = null;
      this.inspectFrame(true);
      this.update({
        name: this.view.draft.name,
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
  }
}
