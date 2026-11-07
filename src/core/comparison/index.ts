import { hash } from "../canonical";
import { encode } from "../codec";
import {
  restoreEpisode,
  validateIntervention,
  type EpisodeCheckpoint,
  type DecisionTrace,
} from "../episode";
import type { Intervention, Genome, TrialResult } from "../model";
import { parameterHash } from "../canonical";
import { validateParameters } from "../controller/neural";
export interface Restoration {
  parent: Genome;
  child: Genome;
}
export type InterventionChoice =
  | { kind: "sensorMask"; channel: number }
  | { kind: "hiddenClamp"; neuron: number; value: number }
  | { kind: "parentWeight"; parameter: number; restoration: Restoration };
export function comparisonChoice(record: SensorComparison): InterventionChoice {
  const v = record.intervention;
  return v.kind === "parentWeight"
    ? { kind: v.kind, parameter: v.parameter, restoration: record.restoration! }
    : v;
}

export interface TrajectoryPoint {
  tick: number;
  x: number;
  y: number;
}
export interface ComparisonArm {
  result: TrialResult;
  trajectory: TrajectoryPoint[];
  firstDecision: DecisionTrace;
}
export interface SensorComparison {
  version: 1;
  id: string;
  source: EpisodeCheckpoint;
  intervention: Intervention;
  restoration?: Restoration;
  control: ComparisonArm;
  masked: ComparisonArm;
  actionDifferences: { changed: number; compared: number };
}
export function comparisonId(
  source: EpisodeCheckpoint,
  intervention: Intervention,
  restoration?: Restoration,
) {
  return hash({
    version: 1,
    source: JSON.parse(encode(source)),
    intervention:
      intervention.kind === "sensorMask"
        ? intervention
        : JSON.parse(encode(intervention)),
    ...(restoration ? { restoration: JSON.parse(encode(restoration)) } : {}),
  });
}
/** Owns two private forks. No experiment, genome, or playback state is shared. */
export class ComparisonRunner {
  private source: EpisodeCheckpoint;
  private intervention: Intervention;
  private restoration?: Restoration;
  private control;
  private masked;
  private paths: [TrajectoryPoint[], TrajectoryPoint[]] = [[], []];
  private first: [DecisionTrace | null, DecisionTrace | null] = [null, null];
  private differences = { changed: 0, compared: 0 };
  constructor(
    source: EpisodeCheckpoint,
    operation: number | InterventionChoice,
  ) {
    if (source.definition.intervention)
      throw new Error("Comparison requires an unmodified source episode");
    this.source = structuredClone(source);
    const choice =
      typeof operation === "number"
        ? { kind: "sensorMask" as const, channel: operation }
        : operation;
    const timing = {
      version: 1 as const,
      startTick: Math.ceil(source.state.tick / 3) * 3,
    };
    if (choice.kind === "parentWeight") {
      const { parent, child } = choice.restoration;
      for (const g of [parent, child]) {
        validateParameters(g.parameters);
        if (parameterHash(g.parameters) !== g.parameterHash)
          throw new Error("Restoration parameter checksum mismatch");
      }
      if (
        child.parentIds[0] !== parent.id ||
        parent.birthGeneration >= child.birthGeneration ||
        source.definition.controller.kind !== "neural" ||
        source.definition.controller.id !== child.id ||
        parameterHash(source.definition.controller.parameters) !==
          child.parameterHash
      )
        throw new Error(
          "Restoration requires the actual parent of the selected controller",
        );
      this.restoration = structuredClone(choice.restoration);
      this.intervention = {
        kind: choice.kind,
        parameter: choice.parameter,
        value: parent.parameters[choice.parameter],
        parentId: parent.id,
        parentParameterHash: parent.parameterHash,
        ...timing,
      };
    } else this.intervention = { ...choice, ...timing };
    validateIntervention(
      this.intervention,
      source.definition.scenario.config.maxTicks,
    );
    const aligned = restoreEpisode(source);
    aligned.advance(this.intervention.startTick - source.state.tick);
    if (aligned.result())
      throw new Error("Choose a tick before the episode ends");
    const checkpoint = aligned.checkpoint();
    checkpoint.definition.trace = true;
    this.control = restoreEpisode(checkpoint);
    checkpoint.definition.intervention = this.intervention;
    this.masked = restoreEpisode(checkpoint);
    this.sample(0);
    this.sample(1);
  }
  private sample(arm: 0 | 1) {
    const { tick, x, y } = (arm === 0 ? this.control : this.masked).inspect();
    if (this.paths[arm].at(-1)?.tick !== tick)
      this.paths[arm].push({ tick, x, y });
  }
  advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0)
      throw new Error("Invalid tick budget");
    for (let i = 0; i < ticks && !this.done; i++) {
      const tick = this.control.inspect().tick;
      const both = !this.control.result() && !this.masked.result();
      for (const arm of [0, 1] as const) {
        const runner = arm === 0 ? this.control : this.masked;
        if (runner.result()) continue;
        runner.advance(1);
        if (!this.first[arm]) this.first[arm] = runner.decisionTrace();
        if (runner.inspect().tick % 3 === 0 || runner.result())
          this.sample(arm);
      }
      if (both && tick % 3 === 0) {
        this.differences.compared++;
        const a = this.control.decisionTrace()!,
          b = this.masked.decisionTrace()!;
        if (a.outputs.some((v, j) => !Object.is(v, b.outputs[j])))
          this.differences.changed++;
      }
    }
    return this.done;
  }
  get done() {
    return !!this.control.result() && !!this.masked.result();
  }
  result(): SensorComparison | null {
    if (!this.done) return null;
    return structuredClone({
      version: 1,
      id: comparisonId(this.source, this.intervention, this.restoration),
      source: this.source,
      intervention: this.intervention,
      ...(this.restoration ? { restoration: this.restoration } : {}),
      control: {
        result: this.control.result()!,
        trajectory: this.paths[0],
        firstDecision: this.first[0]!,
      },
      masked: {
        result: this.masked.result()!,
        trajectory: this.paths[1],
        firstDecision: this.first[1]!,
      },
      actionDifferences: this.differences,
    });
  }
}
