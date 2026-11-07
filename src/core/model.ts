export const ENGINE_VERSION = "evo-engine-1";
export const FORMAT_VERSION = 1;
export interface Vec {
  x: number;
  y: number;
}
export interface Rect extends Vec {
  id: string;
  width: number;
  height: number;
}
export interface Food extends Vec {
  id: string;
}
export interface WorldConfig {
  width: number;
  height: number;
  foodCount: number;
  obstacleCount: number;
  bodyRadius: number;
  foodRadius: number;
  sensorRange: number;
  vMax: number;
  omegaMax: number;
  maxTicks: number;
  maxEnergy: number;
  foodEnergy: number;
}
export const DEFAULT_WORLD: WorldConfig = {
  width: 800,
  height: 600,
  foodCount: 48,
  obstacleCount: 0,
  bodyRadius: 8,
  foodRadius: 4,
  sensorRange: 140,
  vMax: 90,
  omegaMax: Math.PI,
  maxTicks: 1800,
  maxEnergy: 100,
  foodEnergy: 20,
};
export interface Scenario {
  hash: string;
  generatorVersion: string;
  seed: string;
  config: WorldConfig;
  obstacles: Rect[];
  food: Food[];
  start: Vec & { heading: number };
}
export interface Genome {
  id: string;
  parentIds: string[];
  birthGeneration: number;
  origin: "founder" | "mutation" | "immigrant";
  brainSchema: "dense-20-12-2-v1";
  parameterHash: string;
  parameters: Float32Array;
  mutation?: { seed: string; changes: { index: number; value: number }[] };
}
export interface EvaluationSpec {
  engineVersion: string;
  objectiveVersion: "food-v1";
  scenarioHash: string;
  controllerId: string;
  controllerVersion: string;
  intervention?: Intervention;
  hash: string;
}
export interface SensorMask {
  kind: "sensorMask";
  version: 1;
  channel: number;
  startTick: number;
}
export interface HiddenClamp {
  kind: "hiddenClamp";
  version: 1;
  neuron: number;
  value: number;
  startTick: number;
}
export interface ParentWeight {
  kind: "parentWeight";
  version: 1;
  parameter: number;
  value: number;
  parentId: string;
  parentParameterHash: string;
  startTick: number;
}
export type Intervention = SensorMask | HiddenClamp | ParentWeight;
export interface TrialResult {
  spec: EvaluationSpec;
  foodCollected: number;
  distanceTravelled: number;
  contactTicks: number;
  survivalTicks: number;
  remainingEnergy: number;
  terminalReason: "allFoodCollected" | "energyExhausted" | "timeLimit";
  score: number;
}
export function validateWorld(c: WorldConfig): void {
  for (const v of Object.values(c))
    if (!Number.isFinite(v)) throw new Error("Nonfinite world config");
  if (
    c.width < 100 ||
    c.height < 100 ||
    c.bodyRadius <= 0 ||
    c.bodyRadius * 2 >= Math.min(c.width, c.height) ||
    c.foodRadius <= 0 ||
    c.sensorRange <= 0 ||
    c.vMax <= 0 ||
    c.omegaMax <= 0 ||
    c.maxEnergy <= 0 ||
    c.foodEnergy < 0 ||
    !Number.isInteger(c.maxTicks) ||
    c.maxTicks <= 0 ||
    !Number.isInteger(c.foodCount) ||
    c.foodCount < 1 ||
    c.foodCount > 10000 ||
    !Number.isInteger(c.obstacleCount) ||
    c.obstacleCount < 0 ||
    c.obstacleCount > 100
  )
    throw new Error("Invalid world config");
}
