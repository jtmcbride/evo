import { hash, parameterHash } from "../canonical";
import { createEpisode, type EpisodeRunner } from "../episode";
import type { Genome, Scenario } from "../model";
import { validateParameters } from "../controller/neural";
import type { ComparisonArm, TrajectoryPoint } from ".";

export interface ControllerComparison {
  version: 1;
  suiteId: string;
  parentId: string;
  childId: string;
  trials: { scenario: Scenario; parent: ComparisonArm; child: ComparisonArm }[];
}
/** New episodes for both frozen controllers on each explicitly shared map. */
export class ControllerComparisonRunner {
  private genomes: [Genome, Genome];
  private scenarios: Scenario[];
  private pair: [EpisodeRunner, EpisodeRunner] | null = null;
  private paths: [TrajectoryPoint[], TrajectoryPoint[]] = [[], []];
  private first: [
    ComparisonArm["firstDecision"] | null,
    ComparisonArm["firstDecision"] | null,
  ] = [null, null];
  private trials: ControllerComparison["trials"] = [];
  constructor(parent: Genome, child: Genome, scenarios: Scenario[]) {
    if (
      child.parentIds[0] !== parent.id ||
      child.birthGeneration <= parent.birthGeneration ||
      scenarios.length < 1 ||
      scenarios.length > 8 ||
      new Set(scenarios.map((s) => s.hash)).size !== scenarios.length
    )
      throw new Error("Invalid parent/child comparison suite");
    for (const g of [parent, child]) {
      validateParameters(g.parameters);
      if (parameterHash(g.parameters) !== g.parameterHash)
        throw new Error("Invalid comparison genome");
    }
    this.genomes = structuredClone([parent, child]);
    this.scenarios = structuredClone(scenarios);
    // Validate all scenarios before exposing the job to the scheduler.
    for (const scenario of this.scenarios)
      createEpisode({
        scenario,
        controller: {
          kind: "neural",
          id: parent.id,
          parameters: parent.parameters,
        },
      });
  }
  private sample(index: 0 | 1) {
    const { tick, x, y } = this.pair![index].inspect();
    if (this.paths[index].at(-1)?.tick !== tick)
      this.paths[index].push({ tick, x, y });
  }
  advance(ticks: number) {
    if (!Number.isInteger(ticks) || ticks < 0)
      throw new Error("Invalid tick budget");
    for (let i = 0; i < ticks && !this.done; i++) {
      if (!this.pair) {
        const scenario = this.scenarios[this.trials.length];
        this.pair = this.genomes.map((g) =>
          createEpisode({
            scenario,
            controller: { kind: "neural", id: g.id, parameters: g.parameters },
            trace: true,
          }),
        ) as [EpisodeRunner, EpisodeRunner];
        this.paths = [[], []];
        this.first = [null, null];
        this.sample(0);
        this.sample(1);
      }
      for (const index of [0, 1] as const) {
        const r = this.pair[index];
        if (r.result()) continue;
        r.advance(1);
        this.first[index] ??= r.decisionTrace();
        if (r.inspect().tick % 3 === 0 || r.result()) this.sample(index);
      }
      if (this.pair.every((r) => r.result())) {
        const arm = (index: 0 | 1): ComparisonArm => ({
          result: this.pair![index].result()!,
          trajectory: this.paths[index],
          firstDecision: this.first[index]!,
        });
        this.trials.push({
          scenario: this.scenarios[this.trials.length],
          parent: arm(0),
          child: arm(1),
        });
        this.pair = null;
      }
    }
    return this.done;
  }
  get done() {
    return this.trials.length === this.scenarios.length;
  }
  result(): ControllerComparison | null {
    return this.done
      ? structuredClone({
          version: 1,
          suiteId: hash([
            "controller-suite-v1",
            this.scenarios.map((s) => s.hash),
          ]),
          parentId: this.genomes[0].id,
          childId: this.genomes[1].id,
          trials: this.trials,
        })
      : null;
  }
}
