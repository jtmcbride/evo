import { test, expect } from "vitest";
import {
  initializeParameters,
  forward,
} from "../../src/core/controller/neural";
import { Random } from "../../src/core/random";
import { generateScenario } from "../../src/core/world/scenario";
import {
  createEpisode,
  restoreEpisode,
  type EpisodeCheckpoint,
} from "../../src/core/episode";
import { encode, decode } from "../../src/core/codec";
import type { ControllerDefinition } from "../../src/core/controller";
test("hand-calculated network and independently grouped reference", () => {
  const p = new Float32Array(278);
  p[0] = 0.5;
  p[240] = 0.25;
  p[252] = 2;
  p[276] = -0.1;
  const x = new Float64Array(20);
  x[0] = 1;
  const h = new Float64Array(12),
    y = new Float64Array(2);
  forward(p, x, h, y);
  expect(y[0]).toBe(Math.tanh(2 * Math.tanh(0.75) + p[276]));
  expect(y[1]).toBe(0);
  for (let n = 0; n < 20; n++) {
    const r = Random.derive("reference", n),
      p = initializeParameters(r),
      x = Float64Array.from({ length: 20 }, () => r.uniform() * 2 - 1);
    const h = Array.from({ length: 12 }, (_, j) =>
      Math.tanh(
        Array.from({ length: 20 }, (_, i) => p[j * 20 + i] * x[i]).reduce(
          (a, b) => a + b,
          p[240 + j],
        ),
      ),
    );
    const expected = [0, 1].map((j) =>
      Math.tanh(
        h.reduce((sum, v, i) => sum + v * p[252 + j * 12 + i], p[276 + j]),
      ),
    );
    forward(p, x, new Float64Array(12), y);
    expect(Array.from(y)).toEqual(expected);
  }
});
test("trace and arbitrary-tick portable restore preserve neural and random trials", () => {
  const scenario = generateScenario("restore");
  const defs: ControllerDefinition[] = [
    {
      kind: "neural",
      id: "n",
      parameters: initializeParameters(Random.derive("brain")),
    },
    { kind: "random", id: "r", seed: "actions" },
  ];
  for (const controller of defs) {
    const a = createEpisode({ scenario, controller, trace: true }),
      untraced = createEpisode({ scenario, controller });
    a.advance(17);
    const cp = a.checkpoint();
    const b = restoreEpisode(decode(encode(cp)) as EpisodeCheckpoint);
    expect(b.decisionTrace()).toEqual(a.decisionTrace());
    expect(a.decisionTrace()?.tick).toBe(15);
    a.advance(1800);
    b.advance(1800);
    untraced.advance(1800);
    expect(b.checkpoint()).toEqual(a.checkpoint());
    expect(a.result()).toEqual(untraced.result());
    cp.state.remaining.fill(false);
    expect(a.inspect().remaining).not.toEqual(cp.state.remaining);
  }
});
test("codec preserves float bits and rejects malformed checkpoints", () => {
  const p = new Float32Array([0, -0, Math.fround(1 / 3)]);
  const restored = decode(encode({ p, zero: -0 })) as {
    p: Float32Array;
    zero: number;
  };
  expect(new Uint8Array(restored.p.buffer)).toEqual(new Uint8Array(p.buffer));
  expect(Object.is(restored.zero, -0)).toBe(true);
  expect(() => decode('{"$evo":"float32le","bytes":[300]}')).toThrow();
  const e = createEpisode({
    scenario: generateScenario("bad"),
    controller: { kind: "random", id: "r", seed: "s" },
  });
  const cp = e.checkpoint();
  cp.state.left = 2;
  expect(() => restoreEpisode(cp)).toThrow();
});
