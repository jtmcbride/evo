import { hash, parameterHash } from "../canonical";
import { encode } from "../codec";
import { retainGenome } from "../lineage";
import { createEpisode, type EpisodeRunner } from "../episode";
import { generateScenario, validateScenario } from "../world/scenario";
import {
  ENGINE_VERSION,
  type Genome,
  type Scenario,
  type TrialResult,
  type WorldConfig,
} from "../model";
export interface MatrixController {
  experimentId: string;
  name: string;
  generation: number;
  genome: Genome;
}
export interface MatrixSuite {
  label: string;
  id: string;
  scenarios: Scenario[];
}
export interface MatrixInput {
  controllers: MatrixController[];
  suites: MatrixSuite[];
}
export interface BranchMatrix extends MatrixInput {
  version: 1;
  id: string;
  cells: {
    controller: number;
    suite: number;
    suiteId: string;
    results: TrialResult[];
  }[];
}
export function branchSuites(
  root: string,
  source: WorldConfig,
  branch: WorldConfig,
  count = 3,
): MatrixSuite[] {
  if (!Number.isInteger(count) || count < 1 || count > 8)
    throw new Error("Use one to eight comparison maps");
  return [source, branch].map((world, column) => {
    const scenarios = Array.from({ length: count }, (_, i) =>
      generateScenario(hash(["branch-matrix-world-v1", root, i]), world),
    );
    return {
      label: column ? "Branch environment" : "Source environment",
      id: hash(["branch-suite-v1", scenarios.map((s) => s.hash)]),
      scenarios,
    };
  });
}
export function validateMatrixInput(input: MatrixInput) {
  if (
    !Array.isArray(input.controllers) ||
    input.controllers.length !== 2 ||
    !Array.isArray(input.suites) ||
    input.suites.length !== 2
  )
    throw new Error(
      "A branch matrix requires two controllers and two environment suites",
    );
  for (const c of input.controllers) {
    retainGenome(c.genome);
    if (
      typeof c.experimentId !== "string" ||
      !c.experimentId ||
      c.experimentId.length > 256 ||
      typeof c.name !== "string" ||
      !c.name ||
      c.name.length > 64 ||
      !Number.isInteger(c.generation) ||
      c.generation < c.genome.birthGeneration
    )
      throw new Error("Invalid matrix champion selection");
  }
  if (input.controllers[0].experimentId === input.controllers[1].experimentId)
    throw new Error("Choose champions from separate experiments");
  for (const suite of input.suites) {
    if (
      typeof suite.label !== "string" ||
      !suite.label ||
      suite.label.length > 64 ||
      !Array.isArray(suite.scenarios) ||
      suite.scenarios.length < 1 ||
      suite.scenarios.length > 8 ||
      new Set(suite.scenarios.map((s) => s.hash)).size !==
        suite.scenarios.length ||
      suite.id !== hash(["branch-suite-v1", suite.scenarios.map((s) => s.hash)])
    )
      throw new Error("Invalid common comparison suite");
    suite.scenarios.forEach((s) => {
      validateScenario(s);
      if (
        s.config.maxTicks > 5400 ||
        s.food.length > 200 ||
        s.obstacles.length > 10
      )
        throw new Error("Comparison world exceeds browser limits");
    });
  }
}
export function matrixId(input: MatrixInput) {
  return hash({ version: 1, input: JSON.parse(encode(input)) });
}
export class BranchMatrixRunner {
  private input: MatrixInput;
  private cells: BranchMatrix["cells"] = [];
  private runner: EpisodeRunner | null = null;
  private results: TrialResult[] = [];
  constructor(input: MatrixInput) {
    validateMatrixInput(input);
    this.input = structuredClone(input);
  }
  advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0)
      throw new Error("Invalid matrix tick budget");
    let remaining = ticks;
    while (remaining > 0 && !this.done) {
      const controller = Math.floor(this.cells.length / 2),
        suite = this.cells.length % 2,
        conditions = this.input.suites[suite];
      if (!this.runner) {
        const g = this.input.controllers[controller].genome;
        this.runner = createEpisode({
          scenario: conditions.scenarios[this.results.length],
          controller: { kind: "neural", id: g.id, parameters: g.parameters },
        });
      }
      remaining -= this.runner.advance(remaining).advancedTicks;
      const result = this.runner.result();
      if (result) {
        this.results.push(result);
        this.runner = null;
        if (this.results.length === conditions.scenarios.length) {
          this.cells.push({
            controller,
            suite,
            suiteId: conditions.id,
            results: this.results,
          });
          this.results = [];
        }
      }
    }
    return this.done;
  }
  get done() {
    return this.cells.length === 4;
  }
  result(): BranchMatrix | null {
    return this.done
      ? structuredClone({
          version: 1,
          id: matrixId(this.input),
          ...this.input,
          cells: this.cells,
        })
      : null;
  }
}
export function validateMatrix(value: BranchMatrix) {
  validateMatrixInput(value);
  if (
    value.version !== 1 ||
    value.id !==
      matrixId({ controllers: value.controllers, suites: value.suites }) ||
    !Array.isArray(value.cells) ||
    value.cells.length !== 4
  )
    throw new Error("Invalid branch matrix identity");
  value.cells.forEach((cell, index) => {
    if (
      cell.controller !== Math.floor(index / 2) ||
      cell.suite !== index % 2 ||
      cell.suiteId !== value.suites[cell.suite].id ||
      cell.results.length !== value.suites[cell.suite].scenarios.length
    )
      throw new Error("Invalid matrix cell references");
    const g = value.controllers[cell.controller].genome;
    cell.results.forEach((r, i) => {
      const scenario = value.suites[cell.suite].scenarios[i],
        { hash: checksum, ...spec } = r.spec;
      if (
        spec.engineVersion !== ENGINE_VERSION ||
        spec.objectiveVersion !== "food-v1" ||
        spec.intervention ||
        hash(spec) !== checksum ||
        spec.scenarioHash !== scenario.hash ||
        spec.controllerId !== g.id ||
        spec.controllerVersion !== parameterHash(g.parameters) ||
        !Number.isInteger(r.foodCollected) ||
        r.foodCollected < 0 ||
        r.foodCollected > scenario.food.length ||
        r.score !== r.foodCollected ||
        !Number.isInteger(r.survivalTicks) ||
        r.survivalTicks < 1 ||
        r.survivalTicks > scenario.config.maxTicks ||
        !Number.isInteger(r.contactTicks) ||
        r.contactTicks < 0 ||
        r.contactTicks > r.survivalTicks ||
        !Number.isFinite(r.distanceTravelled) ||
        r.distanceTravelled < 0 ||
        !Number.isFinite(r.remainingEnergy) ||
        r.remainingEnergy < 0 ||
        r.remainingEnergy > scenario.config.maxEnergy ||
        !["allFoodCollected", "energyExhausted", "timeLimit"].includes(
          r.terminalReason,
        )
      )
        throw new Error("Invalid matrix evaluation");
    });
  });
}
