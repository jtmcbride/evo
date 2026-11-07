import { z } from "zod";
import {
  ENGINE_VERSION,
  type Genome,
  type Scenario,
  type TrialResult,
} from "../core/model";
import {
  validateCheckpoint,
  type ExperimentCheckpoint,
} from "../core/evolution";
import { hash, parameterHash } from "../core/canonical";
import { validateScenario } from "../core/world/scenario";
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
export interface GenerationSummary {
  generation: number;
  best: number;
  median: number;
  validation: number | null;
  commitId: string;
  championId: string;
}
export interface Replay {
  generation: number;
  genome: Genome;
  scenarios: Scenario[];
  results: TrialResult[];
}
export interface RuntimeFingerprint {
  userAgent: string;
  platform: string;
}
export interface Bookmark {
  genome: Genome;
  generation: number;
  label: string;
  scenario: Scenario;
  trial: number;
  recordedResult: TrialResult | null;
  historyGeneration: number | null;
  tick: number;
}
export interface SavedSession {
  formatVersion: 1;
  engineVersion: string;
  name: string;
  settings: Settings;
  checkpoint: ExperimentCheckpoint;
  history: GenerationSummary[];
  replays: Replay[];
  bookmark: Bookmark | null;
  provenance: {
    created: RuntimeFingerprint;
    current: RuntimeFingerprint;
    changes: { from: RuntimeFingerprint; to: RuntimeFingerprint; at: string }[];
  };
}
export interface SavedEntry {
  id: string;
  name: string;
  generation: number;
  revision: number;
  updatedAt: number;
  engineVersion: string;
  checksum: string;
  interrupted: boolean;
  lastCommitId: string | null;
}
export interface SavedHandle {
  entry: SavedEntry;
  session: SavedSession;
}
export function fingerprint(): RuntimeFingerprint {
  return typeof navigator === "undefined"
    ? { userAgent: "headless", platform: "test" }
    : { userAgent: navigator.userAgent, platform: navigator.platform };
}
const str = z.string().min(1).max(256),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  finite = z.number().finite(),
  integer = z.number().int().nonnegative();
const world = z
  .object({
    width: finite.min(100).max(10000),
    height: finite.min(100).max(10000),
    foodCount: integer.min(1).max(200),
    obstacleCount: integer.max(10),
    bodyRadius: finite.positive(),
    foodRadius: finite.positive(),
    sensorRange: finite.positive(),
    vMax: finite.positive(),
    omegaMax: finite.positive(),
    maxTicks: integer.min(1).max(5400),
    maxEnergy: finite.positive(),
    foodEnergy: finite.nonnegative(),
  })
  .strict();
const genome = z
  .object({
    id: str,
    parentIds: z.array(str).max(2),
    birthGeneration: integer,
    origin: z.enum(["founder", "mutation", "immigrant"]),
    brainSchema: z.literal("dense-20-12-2-v1"),
    parameterHash: digest,
    parameters: z.custom<Float32Array>(
      (v) =>
        v instanceof Float32Array &&
        v.length === 278 &&
        v.every(Number.isFinite),
    ),
    mutation: z
      .object({
        seed: digest,
        changes: z
          .array(z.object({ index: integer.max(277), value: finite }).strict())
          .max(278),
      })
      .strict()
      .optional(),
  })
  .strict();
const scenario = z
  .object({
    hash: digest,
    generatorVersion: str,
    seed: z.string().max(256),
    config: world,
    obstacles: z
      .array(
        z
          .object({
            id: str,
            x: finite,
            y: finite,
            width: finite.positive(),
            height: finite.positive(),
          })
          .strict(),
      )
      .max(10),
    food: z
      .array(z.object({ id: str, x: finite, y: finite }).strict())
      .max(200),
    start: z.object({ x: finite, y: finite, heading: finite }).strict(),
  })
  .strict();
const result = z
  .object({
    spec: z
      .object({
        engineVersion: z.literal(ENGINE_VERSION),
        objectiveVersion: z.literal("food-v1"),
        scenarioHash: digest,
        controllerId: str,
        controllerVersion: digest,
        hash: digest,
      })
      .strict(),
    foodCollected: integer.max(200),
    distanceTravelled: finite.nonnegative(),
    contactTicks: integer.max(5400),
    survivalTicks: integer.max(5400),
    remainingEnergy: finite.nonnegative(),
    terminalReason: z.enum([
      "allFoodCollected",
      "energyExhausted",
      "timeLimit",
    ]),
    score: integer.max(200),
  })
  .strict();
const settings = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .refine((v) => v.trim().length > 0),
    preset: z.enum(["open", "obstacles"]),
    seed: z.string().min(1).max(64),
    population: integer.min(16).max(512),
    foodCount: integer.min(1).max(200),
    obstacleCount: integer.min(1).max(10),
    seconds: integer.min(5).max(180),
    trials: integer.min(1).max(8),
    elites: integer.max(512),
    immigrants: integer.max(512),
    mutationProbability: finite.min(0).max(1),
    mutationSigma: finite.min(0).max(1),
  })
  .strict();
const runtime = z
  .object({ userAgent: z.string().max(1000), platform: z.string().max(100) })
  .strict();
const schema = z
  .object({
    formatVersion: z.literal(1),
    engineVersion: z.literal(ENGINE_VERSION),
    name: z.string().min(1).max(64),
    settings,
    checkpoint: z
      .object({
        formatVersion: z.literal(1),
        engineVersion: z.literal(ENGINE_VERSION),
        phase: z.literal("readyToEvaluate"),
        generation: integer,
        definition: z
          .object({
            id: str,
            world,
            evolution: z
              .object({
                population: integer.min(16).max(512),
                elites: integer.max(512),
                immigrants: integer.max(512),
                trials: integer.min(1).max(8),
                tournamentSize: integer.min(1).max(512),
                mutationProbability: finite.min(0).max(1),
                mutationSigma: finite.min(0).max(1),
                validationInterval: integer.min(1),
                validationTrials: integer.min(1).max(64),
              })
              .strict(),
            roots: z
              .object({
                initialization: str,
                training: str,
                evolution: str,
                validation: str,
              })
              .strict(),
          })
          .strict(),
        population: z.array(genome).min(16).max(512),
        lastCommitId: digest.nullable(),
      })
      .strict(),
    history: z
      .array(
        z
          .object({
            generation: integer,
            best: finite.nonnegative().max(200),
            median: finite.nonnegative().max(200),
            validation: finite.nonnegative().max(200).nullable(),
            commitId: digest,
            championId: str,
          })
          .strict(),
      )
      .max(1000),
    replays: z
      .array(
        z
          .object({
            generation: integer,
            genome,
            scenarios: z.array(scenario).min(1).max(8),
            results: z.array(result).min(1).max(8),
          })
          .strict(),
      )
      .max(51),
    bookmark: z
      .object({
        genome,
        generation: integer,
        label: z.string().max(128),
        scenario,
        trial: integer.max(7),
        recordedResult: result.nullable(),
        historyGeneration: integer.nullable(),
        tick: integer.max(5400),
      })
      .strict()
      .nullable(),
    provenance: z
      .object({
        created: runtime,
        current: runtime,
        changes: z
          .array(
            z
              .object({ from: runtime, to: runtime, at: z.string().max(64) })
              .strict(),
          )
          .max(32),
      })
      .strict(),
  })
  .strict();
function validateGenome(g: Genome) {
  if (g.parameterHash !== parameterHash(g.parameters))
    throw new Error("Parameter checksum mismatch");
  if (
    g.origin === "mutation"
      ? g.parentIds.length !== 1
      : g.parentIds.length !== 0
  )
    throw new Error("Invalid genome ancestry");
  if (
    g.mutation?.changes.some(
      (change) => !Object.is(change.value, g.parameters[change.index]),
    )
  )
    throw new Error("Mutation patch does not match its genome");
  if (
    g.mutation &&
    new Set(g.mutation.changes.map((c) => c.index)).size !==
      g.mutation.changes.length
  )
    throw new Error("Duplicate mutation index");
}
function validateResult(r: TrialResult, g: Genome, s: Scenario) {
  const { hash: _, ...spec } = r.spec;
  void _;
  if (
    hash(spec) !== r.spec.hash ||
    r.spec.scenarioHash !== s.hash ||
    r.spec.controllerId !== g.id ||
    r.spec.controllerVersion !== g.parameterHash ||
    r.foodCollected !== r.score ||
    r.foodCollected > s.food.length ||
    r.survivalTicks < 1 ||
    r.contactTicks > r.survivalTicks ||
    r.survivalTicks > s.config.maxTicks ||
    r.remainingEnergy > s.config.maxEnergy
  )
    throw new Error("Invalid evaluation reference");
}
export function parseSession(value: unknown): SavedSession {
  if (
    value &&
    typeof value === "object" &&
    "engineVersion" in value &&
    value.engineVersion !== ENGINE_VERSION
  )
    throw new Error(
      `Unsupported engine version: ${String(value.engineVersion)}`,
    );
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Invalid checkpoint: " +
        parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
    );
  const s = parsed.data as SavedSession;
  validateCheckpoint(s.checkpoint);
  s.checkpoint.population.forEach(validateGenome);
  const c = s.checkpoint,
    def = c.definition,
    config = s.settings;
  if (
    s.name !== config.name ||
    def.world.foodCount !== config.foodCount ||
    def.world.obstacleCount !==
      (config.preset === "obstacles" ? config.obstacleCount : 0) ||
    def.world.maxTicks !== config.seconds * 30 ||
    def.evolution.population !== config.population ||
    def.evolution.trials !== config.trials ||
    def.evolution.elites !== config.elites ||
    def.evolution.immigrants !== config.immigrants ||
    def.evolution.mutationSigma !== config.mutationSigma ||
    def.evolution.mutationProbability !== config.mutationProbability
  )
    throw new Error("Saved settings do not match the checkpoint");
  const seen = new Set<number>();
  let lastGeneration = -1;
  for (const h of s.history) {
    if (
      h.generation <= lastGeneration ||
      h.median > h.best ||
      h.best > def.world.foodCount
    )
      throw new Error("Invalid generation measurements");
    lastGeneration = h.generation;
    if (h.generation >= c.generation || seen.has(h.generation))
      throw new Error("Invalid generation history");
    seen.add(h.generation);
  }
  const replayIds = new Set<number>();
  for (const r of s.replays) {
    if (
      r.generation >= c.generation ||
      replayIds.has(r.generation) ||
      r.scenarios.length !== r.results.length
    )
      throw new Error("Invalid replay");
    replayIds.add(r.generation);
    validateGenome(r.genome);
    if (r.genome.birthGeneration > r.generation)
      throw new Error("Invalid replay birth generation");
    const summary = s.history.find((h) => h.generation === r.generation);
    if (
      summary &&
      (summary.championId !== r.genome.id ||
        summary.best !==
          r.results.reduce((sum, t) => sum + t.score, 0) / r.results.length)
    )
      throw new Error("Replay does not match its generation summary");
    r.scenarios.forEach((world, i) => {
      validateScenario(world);
      validateResult(r.results[i], r.genome, world);
    });
  }
  if (s.bookmark) {
    validateGenome(s.bookmark.genome);
    if (
      s.bookmark.genome.birthGeneration > s.bookmark.generation ||
      s.bookmark.generation > c.generation ||
      (s.bookmark.historyGeneration !== null &&
        s.bookmark.historyGeneration !== s.bookmark.generation)
    )
      throw new Error("Invalid bookmark generation");
    validateScenario(s.bookmark.scenario);
    if (s.bookmark.tick > s.bookmark.scenario.config.maxTicks)
      throw new Error("Invalid playback bookmark");
    if (s.bookmark.recordedResult)
      validateResult(
        s.bookmark.recordedResult,
        s.bookmark.genome,
        s.bookmark.scenario,
      );
  }
  return s;
}
export function withRuntime(
  s: SavedSession,
  current: RuntimeFingerprint,
): SavedSession {
  const next = structuredClone(s);
  if (hash(next.provenance.current) !== hash(current)) {
    next.provenance.changes = [
      ...next.provenance.changes,
      {
        from: next.provenance.current,
        to: current,
        at: new Date().toISOString(),
      },
    ].slice(-32);
    next.provenance.current = current;
  }
  return next;
}
