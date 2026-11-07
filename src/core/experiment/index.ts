import { hash } from "../canonical";
import { createEpisode, type EpisodeRunner } from "../episode";
import { generateScenario } from "../world/scenario";
import type { Scenario, TrialResult } from "../model";
import {
  validateCheckpoint,
  rankedSlots,
  reproduce,
  type ExperimentCheckpoint,
} from "../evolution";
export interface GenerationRecord {
  generation: number;
  populationIds: string[];
  scenarios: Scenario[];
  trials: TrialResult[][];
  totals: number[];
  championId: string;
  validationScenarios: Scenario[];
  validation: TrialResult[];
}
export interface GenerationCommit {
  id: string;
  record: GenerationRecord;
  nextCheckpoint: ExperimentCheckpoint;
}
export type ExperimentPhase =
  "readyToEvaluate" | "evaluating" | "reproducing" | "awaitingCommit" | "error";
interface Job {
  slot: number;
  trial: number;
  validation: boolean;
  scenario: Scenario;
}
export class ExperimentRunner {
  private current: ExperimentCheckpoint;
  private status: ExperimentPhase = "readyToEvaluate";
  private jobs: Job[] = [];
  private jobIndex = 0;
  private active: EpisodeRunner | null = null;
  private trials: TrialResult[][] = [];
  private validation: TrialResult[] = [];
  private scenarios: Scenario[] = [];
  private validationScenarios: Scenario[] = [];
  private pending: GenerationCommit | null = null;
  private lastAcknowledged: string | null = null;
  private order: number[];
  constructor(checkpoint: ExperimentCheckpoint, order?: number[]) {
    validateCheckpoint(checkpoint);
    this.current = structuredClone(checkpoint);
    this.order = order ? [...order] : checkpoint.population.map((_, i) => i);
    if (
      this.order.length !== checkpoint.population.length ||
      new Set(this.order).size !== this.order.length ||
      this.order.some(
        (i) =>
          !Number.isInteger(i) || i < 0 || i >= checkpoint.population.length,
      )
    )
      throw new Error("Invalid evaluation order");
  }
  get phase() {
    return this.status;
  }
  progress() {
    return {
      generation: this.current.generation,
      completedTrials: this.jobIndex,
      totalTrials: this.jobs.length,
      activeTick: this.active?.inspect().tick ?? null,
    };
  }
  checkpoint(): ExperimentCheckpoint {
    return structuredClone(this.current);
  }
  pendingCommit(): GenerationCommit | null {
    return structuredClone(this.pending);
  }
  private begin() {
    const c = this.current,
      d = c.definition;
    this.trials = c.population.map(() => []);
    this.validation = [];
    this.validationScenarios = [];
    this.jobIndex = 0;
    this.scenarios = Array.from({ length: d.evolution.trials }, (_, i) =>
      generateScenario(
        hash(["world-v1", d.roots.training, c.generation, i]),
        d.world,
      ),
    );
    this.jobs = this.order.flatMap((slot) =>
      this.scenarios.map((scenario, trial) => ({
        slot,
        trial,
        scenario,
        validation: false,
      })),
    );
    this.status = "evaluating";
  }
  advance(tickBudget: number): number {
    if (!Number.isInteger(tickBudget) || tickBudget < 0)
      throw new Error("Invalid tick budget");
    if (this.status === "error") throw new Error("Experiment failed");
    if (this.status === "awaitingCommit" || tickBudget === 0) return 0;
    let advanced = 0;
    try {
      if (this.status === "readyToEvaluate") this.begin();
      while (advanced < tickBudget && this.status === "evaluating") {
        const job = this.jobs[this.jobIndex],
          genome = this.current.population[job.slot];
        this.active ??= createEpisode({
          scenario: job.scenario,
          controller: {
            kind: "neural",
            id: genome.id,
            parameters: genome.parameters,
          },
        });
        advanced += this.active.advance(tickBudget - advanced).advancedTicks;
        const result = this.active.result();
        if (!result) break;
        if (job.validation) this.validation[job.trial] = result;
        else this.trials[job.slot][job.trial] = result;
        this.active = null;
        this.jobIndex++;
        if (this.jobIndex === this.jobs.length) {
          const e = this.current.definition.evolution;
          if (
            !job.validation &&
            (this.current.generation + 1) % e.validationInterval === 0
          ) {
            const totals = this.trials.map((r) =>
                r.reduce((sum, t) => sum + t.score, 0),
              ),
              champion = rankedSlots(this.current, totals)[0];
            this.validationScenarios = Array.from(
              { length: e.validationTrials },
              (_, i) =>
                generateScenario(
                  hash([
                    "validation-v1",
                    this.current.definition.roots.validation,
                    i,
                  ]),
                  this.current.definition.world,
                ),
            );
            this.jobs.push(
              ...this.validationScenarios.map((scenario, trial) => ({
                slot: champion,
                trial,
                scenario,
                validation: true,
              })),
            );
          } else this.finish();
        }
      }
      return advanced;
    } catch (error) {
      this.status = "error";
      throw error;
    }
  }
  private finish() {
    this.status = "reproducing";
    const c = this.current,
      totals = this.trials.map((r) => r.reduce((sum, t) => sum + t.score, 0));
    const record: GenerationRecord = {
      generation: c.generation,
      populationIds: c.population.map((g) => g.id),
      scenarios: this.scenarios,
      trials: this.trials,
      totals,
      championId: c.population[rankedSlots(c, totals)[0]].id,
      validationScenarios: this.validationScenarios,
      validation: this.validation,
    };
    const nextCheckpoint: ExperimentCheckpoint = {
      ...c,
      generation: c.generation + 1,
      population: reproduce(c, totals),
      lastCommitId: null,
    };
    const id = hash({
      record,
      nextCheckpoint: checkpointIdentity(nextCheckpoint),
    });
    nextCheckpoint.lastCommitId = id;
    this.pending = { id, record, nextCheckpoint };
    this.status = "awaitingCommit";
  }
  acknowledge(id: string) {
    if (id === this.lastAcknowledged) return;
    if (
      this.status !== "awaitingCommit" ||
      !this.pending ||
      id !== this.pending.id
    )
      throw new Error("Unexpected commit acknowledgment");
    this.current = this.pending.nextCheckpoint;
    this.pending = null;
    this.lastAcknowledged = id;
    this.status = "readyToEvaluate";
    this.jobs = [];
    this.trials = [];
    this.scenarios = [];
    this.validation = [];
    this.validationScenarios = [];
  }
}
export function checkpointIdentity(c: ExperimentCheckpoint): unknown {
  return {
    ...c,
    population: c.population.map(({ parameters, ...g }) => {
      void parameters;
      return g;
    }),
  };
}
export class MemoryCommitStore {
  private commits = new Map<string, GenerationCommit>();
  put(commit: GenerationCommit): void {
    this.commits.set(commit.id, structuredClone(commit));
  }
  get(id: string): GenerationCommit | undefined {
    const c = this.commits.get(id);
    return c ? structuredClone(c) : undefined;
  }
}
