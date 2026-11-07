import { type RandomState } from "../random";
import {
  ENGINE_VERSION,
  type Scenario,
  type TrialResult,
  type SensorMask,
  type Intervention,
  type EvaluationSpec,
} from "../model";
import { encode } from "../codec";
import { parameterHash, hash } from "../canonical";
import { createController, type ControllerDefinition } from "../controller";
import { validateScenario } from "../world/scenario";
import { observe, wrap, type SenseState } from "../world/sensing";
import { move, segmentDistance } from "../world/geometry";
export interface EpisodeDefinition {
  scenario: Scenario;
  controller: ControllerDefinition;
  trace?: boolean;
  intervention?: Intervention;
}
export interface EpisodeState extends SenseState {
  tick: number;
  foodCollected: number;
  distanceTravelled: number;
  contactTicks: number;
  left: number;
  right: number;
  terminal: TrialResult["terminalReason"] | null;
}
export interface DecisionTrace {
  tick: number;
  x: number;
  y: number;
  heading: number;
  inputs: number[];
  rawInputs?: number[];
  rawHidden?: number[];
  hidden: number[] | null;
  outputs: number[];
}
export interface EpisodeCheckpoint {
  formatVersion: 1;
  engineVersion: string;
  definition: EpisodeDefinition;
  state: EpisodeState;
  controllerState: RandomState | null;
  lastDecision: DecisionTrace | null;
}
export class EpisodeRunner {
  private lastDecision: DecisionTrace | null = null;
  decisionTrace(): DecisionTrace | null {
    return structuredClone(this.lastDecision);
  }
  checkpoint(): EpisodeCheckpoint {
    return structuredClone({
      formatVersion: 1,
      engineVersion: ENGINE_VERSION,
      definition: this.definition,
      state: this.state,
      controllerState: this.controller.state(),
      lastDecision: this.lastDecision,
    });
  }
  static restore(checkpoint: EpisodeCheckpoint): EpisodeRunner {
    if (
      checkpoint.formatVersion !== 1 ||
      checkpoint.engineVersion !== ENGINE_VERSION
    )
      throw new Error("Unsupported episode checkpoint");
    const c = structuredClone(checkpoint),
      runner = new EpisodeRunner(c.definition),
      s = c.state,
      world = c.definition.scenario;
    if (
      ![
        s.x,
        s.y,
        s.heading,
        s.energy,
        s.speed,
        s.angularSpeed,
        s.tick,
        s.foodCollected,
        s.distanceTravelled,
        s.contactTicks,
        s.left,
        s.right,
      ].every(Number.isFinite) ||
      !Number.isInteger(s.tick) ||
      s.tick < 0 ||
      s.tick > world.config.maxTicks ||
      !Array.isArray(s.remaining) ||
      s.remaining.length !== world.food.length ||
      s.remaining.some((x) => typeof x !== "boolean") ||
      s.foodCollected !== s.remaining.filter((x) => !x).length ||
      s.energy < 0 ||
      s.energy > world.config.maxEnergy ||
      s.x < world.config.bodyRadius - 1e-5 ||
      s.x > world.config.width - world.config.bodyRadius + 1e-5 ||
      s.y < world.config.bodyRadius - 1e-5 ||
      s.y > world.config.height - world.config.bodyRadius + 1e-5 ||
      !Number.isInteger(s.contactTicks) ||
      s.contactTicks < 0 ||
      s.contactTicks > s.tick ||
      s.distanceTravelled < 0 ||
      Math.abs(s.left) > 1 ||
      Math.abs(s.right) > 1 ||
      typeof s.contact !== "boolean"
    )
      throw new Error("Invalid episode state");
    const expected =
      s.foodCollected === world.food.length
        ? "allFoodCollected"
        : s.energy <= 0
          ? "energyExhausted"
          : s.tick >= world.config.maxTicks
            ? "timeLimit"
            : null;
    if (s.terminal !== expected) throw new Error("Invalid terminal state");
    if (c.definition.controller.kind === "random" && !c.controllerState)
      throw new Error("Missing random controller state");
    runner.state = s;
    runner.controller = createController(
      c.definition.controller,
      c.controllerState,
    );
    runner.lastDecision = c.lastDecision;
    return runner;
  }
  private definition: EpisodeDefinition;
  private state: EpisodeState;
  private controller;
  private inputs = new Float64Array(20);
  private outputs = new Float64Array(2);
  constructor(def: EpisodeDefinition) {
    validateScenario(def.scenario);
    if (def.intervention)
      validateIntervention(def.intervention, def.scenario.config.maxTicks);
    if (
      def.intervention &&
      def.intervention.kind !== "sensorMask" &&
      def.controller.kind !== "neural"
    )
      throw new Error("Neural intervention requires a neural controller");
    this.definition = structuredClone(def);
    this.controller = createController(this.definition.controller);
    const s = def.scenario;
    this.state = {
      ...s.start,
      energy: s.config.maxEnergy,
      speed: 0,
      angularSpeed: 0,
      contact: false,
      remaining: s.food.map(() => true),
      tick: 0,
      foodCollected: 0,
      distanceTravelled: 0,
      contactTicks: 0,
      left: 0,
      right: 0,
      terminal: null,
    };
  }
  inspect() {
    return structuredClone(this.state);
  }
  advance(maxTicks: number) {
    if (!Number.isInteger(maxTicks) || maxTicks < 0)
      throw new Error("Invalid tick budget");
    let advancedTicks = 0;
    while (advancedTicks < maxTicks && !this.state.terminal) {
      this.step();
      advancedTicks++;
    }
    return { advancedTicks, terminal: this.state.terminal !== null };
  }
  private step() {
    const s = this.state,
      world = this.definition.scenario,
      c = world.config,
      dt = 1 / 30;
    if (s.tick % 3 === 0) {
      observe(world, s, this.inputs);
      const variant = this.definition.intervention;
      const active =
        variant && s.tick >= variant.startTick ? variant : undefined;
      const mask = active?.kind === "sensorMask" ? active : undefined;
      const rawInputs =
        mask && s.tick >= mask.startTick ? Array.from(this.inputs) : undefined;
      if (rawInputs) this.inputs[mask!.channel] = 0;
      this.controller.act(
        this.inputs,
        this.outputs,
        active?.kind !== "sensorMask" ? active : undefined,
      );
      if (
        !this.outputs.every(Number.isFinite) ||
        this.outputs.some((x) => Math.abs(x) > 1)
      )
        throw new Error("Invalid controller output");
      if (this.definition.trace)
        this.lastDecision = {
          tick: s.tick,
          x: s.x,
          y: s.y,
          heading: s.heading,
          inputs: Array.from(this.inputs),
          ...(rawInputs ? { rawInputs } : {}),
          ...(this.controller.rawHidden()
            ? { rawHidden: Array.from(this.controller.rawHidden()!) }
            : {}),
          hidden: this.controller.hidden()
            ? Array.from(this.controller.hidden()!)
            : null,
          outputs: Array.from(this.outputs),
        };
      s.left = this.outputs[0];
      s.right = this.outputs[1];
      s.contact = false;
    }
    const v = (c.vMax * (s.left + s.right)) / 2,
      w = (c.omegaMax * (s.left - s.right)) / 2;
    s.heading = wrap(s.heading + w * dt);
    const movement = move(
      s,
      { x: v * Math.cos(s.heading) * dt, y: v * Math.sin(s.heading) * dt },
      c,
      world.obstacles,
    );
    s.x = movement.position.x;
    s.y = movement.position.y;
    let collected = 0;
    for (let i = 0; i < world.food.length; i++)
      if (
        s.remaining[i] &&
        movement.segments.some(
          ([a, b]) =>
            segmentDistance(world.food[i], a, b) <= c.bodyRadius + c.foodRadius,
        )
      ) {
        s.remaining[i] = false;
        collected++;
      }
    s.energy = Math.max(
      0,
      Math.min(
        c.maxEnergy,
        s.energy -
          dt *
            (1 + 1.5 * Math.abs(v / c.vMax) + 0.5 * Math.abs(w / c.omegaMax)) +
          collected * c.foodEnergy,
      ),
    );
    s.foodCollected += collected;
    s.distanceTravelled += movement.length;
    s.contactTicks += Number(movement.contact);
    s.contact ||= movement.contact;
    s.speed = (Math.sign(v) * movement.length) / dt;
    s.angularSpeed = w;
    s.tick++;
    s.terminal =
      s.foodCollected === world.food.length
        ? "allFoodCollected"
        : s.energy <= 0
          ? "energyExhausted"
          : s.tick >= c.maxTicks
            ? "timeLimit"
            : null;
  }
  result(): TrialResult | null {
    const s = this.state;
    if (!s.terminal) return null;
    const body = {
      engineVersion: ENGINE_VERSION,
      objectiveVersion: "food-v1" as const,
      scenarioHash: this.definition.scenario.hash,
      controllerId: this.definition.controller.id,
      controllerVersion:
        this.definition.controller.kind === "neural"
          ? parameterHash(this.definition.controller.parameters)
          : hash(this.definition.controller),
      ...(this.definition.intervention
        ? { intervention: this.definition.intervention }
        : {}),
    };
    return {
      spec: { ...body, hash: evaluationHash(body) },
      foodCollected: s.foodCollected,
      distanceTravelled: s.distanceTravelled,
      contactTicks: s.contactTicks,
      survivalTicks: s.tick,
      remainingEnergy: s.energy,
      terminalReason: s.terminal,
      score: s.foodCollected,
    };
  }
}
export const createEpisode = (def: EpisodeDefinition) => new EpisodeRunner(def);

export const restoreEpisode = (checkpoint: EpisodeCheckpoint) =>
  EpisodeRunner.restore(checkpoint);
export function evaluationHash(spec: Omit<EvaluationSpec, "hash">) {
  return hash(
    spec.intervention && spec.intervention.kind !== "sensorMask"
      ? JSON.parse(encode(spec))
      : spec,
  );
}

export function validateSensorMask(mask: SensorMask, maxTicks: number) {
  if (
    mask.kind !== "sensorMask" ||
    mask.version !== 1 ||
    !Number.isInteger(mask.channel) ||
    mask.channel < 0 ||
    mask.channel >= 20 ||
    !Number.isInteger(mask.startTick) ||
    mask.startTick < 0 ||
    mask.startTick >= maxTicks ||
    mask.startTick % 3 !== 0
  )
    throw new Error("Invalid sensor mask");
}
export function validateIntervention(value: Intervention, maxTicks: number) {
  if (value.kind === "sensorMask") return validateSensorMask(value, maxTicks);
  if (
    value.version !== 1 ||
    !Number.isInteger(value.startTick) ||
    value.startTick < 0 ||
    value.startTick >= maxTicks ||
    value.startTick % 3 !== 0 ||
    !Number.isFinite(value.value)
  )
    throw new Error("Invalid intervention timing or value");
  if (value.kind === "hiddenClamp") {
    if (
      !Number.isInteger(value.neuron) ||
      value.neuron < 0 ||
      value.neuron >= 12 ||
      Math.abs(value.value) > 1
    )
      throw new Error("Invalid hidden neuron clamp");
  } else if (value.kind === "parentWeight") {
    if (
      !Number.isInteger(value.parameter) ||
      value.parameter < 0 ||
      value.parameter >= 278 ||
      !Object.is(Math.fround(value.value), value.value) ||
      typeof value.parentId !== "string" ||
      !value.parentId ||
      value.parentId.length > 256 ||
      !/^[a-f0-9]{64}$/.test(value.parentParameterHash)
    )
      throw new Error("Invalid parent weight restoration");
  } else throw new Error("Unknown intervention");
}
