import { ENGINE_VERSION, type Scenario, type TrialResult } from "../model";
import { hash } from "../canonical";
import { createController, type ControllerDefinition } from "../controller";
import { validateScenario } from "../world/scenario";
import { observe, wrap, type SenseState } from "../world/sensing";
import { move, segmentDistance } from "../world/geometry";
export interface EpisodeDefinition {
  scenario: Scenario;
  controller: ControllerDefinition;
  trace?: boolean;
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
export class EpisodeRunner {
  private definition: EpisodeDefinition;
  private state: EpisodeState;
  private controller;
  private inputs = new Float64Array(20);
  private outputs = new Float64Array(2);
  constructor(def: EpisodeDefinition) {
    validateScenario(def.scenario);
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
      this.controller.act(this.inputs, this.outputs);
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
      controllerVersion: hash(this.definition.controller),
    };
    return {
      spec: { ...body, hash: hash(body) },
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
