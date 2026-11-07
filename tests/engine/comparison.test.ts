import { test, expect } from "vitest";
import { ComparisonRunner } from "../../src/core/comparison";
import {
  createEpisode,
  restoreEpisode,
  type EpisodeCheckpoint,
} from "../../src/core/episode";
import { DEFAULT_WORLD } from "../../src/core/model";
import { generateScenario } from "../../src/core/world/scenario";
import { encode, decode } from "../../src/core/codec";

function source(tick = 1) {
  const parameters = new Float32Array(278);
  parameters[16] = 1;
  parameters[252] = 1;
  const r = createEpisode({
    scenario: generateScenario("mask", { ...DEFAULT_WORLD, maxTicks: 150 }),
    controller: { kind: "neural", id: "test", parameters },
    trace: true,
  });
  r.advance(tick);
  return r.checkpoint();
}
function finish(r: ComparisonRunner, budget = 17) {
  while (!r.advance(budget)) {
    /* bounded numerical work */
  }
  return r.result()!;
}
test("forks exact pre-decision state and masks only one effective observation at the next decision", () => {
  const cp = source(),
    frozen = encode(cp),
    paired = finish(new ComparisonRunner(cp, 16));
  expect(paired.source.state.tick).toBe(1);
  expect(paired.intervention.startTick).toBe(3);
  expect(paired.control.firstDecision.tick).toBe(3);
  const a = paired.control.firstDecision,
    b = paired.masked.firstDecision;
  expect(b.rawInputs).toEqual(a.inputs);
  expect(b.inputs).toEqual(a.inputs.map((v, i) => (i === 16 ? 0 : v)));
  expect(b.inputs[16]).toBe(0);
  expect(b.outputs).not.toEqual(a.outputs);
  expect(paired.masked.trajectory[0]).toEqual(paired.control.trajectory[0]);
  expect(encode(cp)).toBe(frozen);
  const direct = restoreEpisode(cp);
  direct.advance(10000);
  expect(paired.control.result).toEqual(direct.result());
  expect(paired.control.result.spec.intervention).toBeUndefined();
  expect(paired.masked.result.spec.intervention).toEqual(paired.intervention);
  expect(paired.masked.result.spec.hash).not.toBe(
    paired.control.result.spec.hash,
  );
  expect(paired.actionDifferences.changed).toBeGreaterThan(0);
  expect(
    finish(
      new ComparisonRunner(decode(encode(cp)) as EpisodeCheckpoint, 16),
      1,
    ),
  ).toEqual(paired);
});
test("decision-boundary masks resume exactly with raw/effective traces and unchanged random streams", () => {
  const cp = source(3);
  cp.definition.controller = {
    kind: "random",
    id: "random",
    seed: "same-stream",
  };
  const random = createEpisode(cp.definition);
  random.advance(3);
  const pair = finish(new ComparisonRunner(random.checkpoint(), 0));
  expect(pair.intervention.startTick).toBe(3);
  expect(pair.actionDifferences.changed).toBe(0);
  expect(pair.control.trajectory).toEqual(pair.masked.trajectory);
  const masked = source(3);
  masked.definition.intervention = {
    kind: "sensorMask",
    version: 1,
    channel: 16,
    startTick: 3,
  };
  const r = restoreEpisode(masked);
  r.advance(41);
  const restored = restoreEpisode(
    decode(encode(r.checkpoint())) as EpisodeCheckpoint,
  );
  r.advance(10000);
  restored.advance(10000);
  expect(restored.checkpoint()).toEqual(r.checkpoint());
  expect(restored.decisionTrace()?.rawInputs).toHaveLength(20);
});
test("rejects terminal sources, invalid channels and nested interventions", () => {
  for (const channel of [-1, 20, 1.5, NaN])
    expect(() => new ComparisonRunner(source(), channel)).toThrow();
  expect(() => new ComparisonRunner(source(150), 0)).toThrow();
  const cp = source();
  cp.definition.intervention = {
    kind: "sensorMask",
    version: 1,
    channel: 0,
    startTick: 3,
  };
  expect(() => new ComparisonRunner(cp, 1)).toThrow(/unmodified/);
});
