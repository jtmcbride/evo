import { hash } from "../src/core/canonical";
import type {
  ExperimentDefinition,
  EvolutionConfig,
} from "../src/core/evolution";
import type { WorldConfig } from "../src/core/model";

export interface BenchmarkProtocol {
  id: string;
  runs: number;
  generations: number;
  heldOutTrials: number;
  world: WorldConfig;
  evolution: EvolutionConfig;
  selection: string;
  exampleRule: string;
}

// Freeze before looking at release-run outcomes. Changes require a new suite ID.
export const RELEASE_PROTOCOL = {
  id: "benchmark-open-v1",
  runs: 20,
  generations: 200,
  heldOutTrials: 64,
  world: {
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
  } satisfies WorldConfig,
  evolution: {
    population: 128,
    elites: 4,
    immigrants: 8,
    trials: 3,
    tournamentSize: 4,
    mutationProbability: 0.1,
    mutationSigma: 0.05,
    validationInterval: 10,
    validationTrials: 16,
  },
  selection:
    "Training-selected generation-0 and generation-199 champions; no validation selection",
  exampleRule:
    "Nearest to median final validation mean; lowest run index breaks ties",
} as const;
export const protocolHash = hash(RELEASE_PROTOCOL);
export function benchmarkDefinition(
  run: number,
  p: BenchmarkProtocol = RELEASE_PROTOCOL,
): ExperimentDefinition {
  if (!Number.isInteger(run) || run < 0 || run >= p.runs)
    throw new Error("Invalid benchmark run");
  const seed = `${p.id}:run-${run}`;
  return {
    id: `experiment-${seed}`,
    world: structuredClone(p.world),
    evolution: structuredClone(p.evolution),
    roots: Object.fromEntries(
      ["initialization", "training", "evolution", "validation"].map((k) => [
        k,
        `${seed}:${k}`,
      ]),
    ) as ExperimentDefinition["roots"],
  };
}
export function evaluationSeeds(
  run: number,
  kind: "validation" | "heldOut",
  p: BenchmarkProtocol = RELEASE_PROTOCOL,
): string[] {
  const d = benchmarkDefinition(run, p);
  return Array.from(
    {
      length:
        kind === "validation" ? p.evolution.validationTrials : p.heldOutTrials,
    },
    (_, i) =>
      kind === "validation"
        ? hash(["validation-v1", d.roots.validation, i])
        : hash(["held-out-v1", p.id, run, i]),
  );
}
export function mean(xs: readonly number[]) {
  if (!xs.length || xs.some((x) => !Number.isFinite(x)))
    throw new Error("Invalid numeric sample");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
export function quantile(xs: readonly number[], q: number) {
  if (!xs.length || xs.some((x) => !Number.isFinite(x)) || q < 0 || q > 1)
    throw new Error("Invalid quantile");
  const s = [...xs].sort((a, b) => a - b),
    pos = (s.length - 1) * q,
    lo = Math.floor(pos);
  return s[lo] + (s[Math.ceil(pos)] - s[lo]) * (pos - lo);
}
export function representativeRun(
  rows: { run: number; finalValidation: number }[],
) {
  const median = quantile(
    rows.map((r) => r.finalValidation),
    0.5,
  );
  return [...rows].sort(
    (a, b) =>
      Math.abs(a.finalValidation - median) -
        Math.abs(b.finalValidation - median) || a.run - b.run,
  )[0].run;
}
