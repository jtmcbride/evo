import { test, expect } from "vitest";
import { DEFAULT_WORLD, type Scenario } from "../../src/core/model";
import { hash } from "../../src/core/canonical";
import { generateScenario } from "../../src/core/world/scenario";
import { move, rectDistance } from "../../src/core/world/geometry";
import { observe } from "../../src/core/world/sensing";
import { createEpisode } from "../../src/core/episode";
export function fixture(
  overrides: Partial<Omit<Scenario, "hash">> = {},
): Scenario {
  const body = {
    generatorVersion: "fixture-v1",
    seed: "fixture",
    config: { ...DEFAULT_WORLD, foodCount: 1, maxTicks: 30 },
    obstacles: [],
    food: [{ id: "f0", x: 700, y: 500 }],
    start: { x: 100, y: 100, heading: 0 },
    ...overrides,
  };
  return { ...body, hash: hash(body) };
}
test("seeded worlds and tick chunking are reproducible", () => {
  for (const count of [0, 5]) {
    const world = generateScenario("42", {
      ...DEFAULT_WORLD,
      obstacleCount: count,
    });
    expect(world).toEqual(
      generateScenario("42", { ...DEFAULT_WORLD, obstacleCount: count }),
    );
    const a = createEpisode({
        scenario: world,
        controller: { kind: "scripted", id: "scripted-v1" },
      }),
      b = createEpisode({
        scenario: world,
        controller: { kind: "scripted", id: "scripted-v1" },
      });
    a.advance(1800);
    for (let i = 0; i < 600; i++) b.advance(3);
    expect(a.result()).toEqual(b.result());
  }
});
test("straight motion, motor sign and energy have analytic outcomes", () => {
  const a = createEpisode({
    scenario: fixture(),
    controller: { kind: "constant", id: "forward", left: 1, right: 1 },
  });
  a.advance(30);
  expect(a.inspect().x).toBeCloseTo(190, 10);
  expect(a.inspect().energy).toBeCloseTo(97.5, 10);
  const b = createEpisode({
    scenario: fixture(),
    controller: { kind: "constant", id: "turn", left: 1, right: -1 },
  });
  b.advance(1);
  expect(b.inspect().heading).toBeCloseTo(Math.PI / 30);
  expect(b.inspect().x).toBe(100);
});
test("swept walls, corners and sliding prevent tunneling", () => {
  const c = { ...DEFAULT_WORLD, bodyRadius: 8 };
  const obstacle = { id: "wall", x: 200, y: 100, width: 1, height: 200 };
  const hit = move({ x: 100, y: 150 }, { x: 300, y: 50 }, c, [obstacle]);
  expect(hit.contact).toBe(true);
  expect(hit.position.x).toBeLessThanOrEqual(192);
  expect(hit.position.y).toBeCloseTo(200);
  const corner = move({ x: 180, y: 80 }, { x: 40, y: 40 }, c, [obstacle]);
  expect(rectDistance(corner.position, obstacle)).toBeGreaterThanOrEqual(
    8 - 1e-6,
  );
  const boundary = move({ x: 20, y: 20 }, { x: -100, y: -100 }, c, []);
  expect(boundary.position.x).toBeGreaterThanOrEqual(8);
  expect(boundary.position.y).toBeGreaterThanOrEqual(8);
});
test("path food is collected once and collection can avert starvation", () => {
  const world = fixture({
    config: {
      ...DEFAULT_WORLD,
      foodCount: 2,
      maxTicks: 60,
      vMax: 900,
      foodEnergy: 20,
      maxEnergy: 0.01,
    },
    food: [
      { id: "f0", x: 115, y: 100 },
      { id: "f1", x: 700, y: 500 },
    ],
  });
  const e = createEpisode({
    scenario: world,
    controller: { kind: "constant", id: "forward", left: 1, right: 1 },
  });
  e.advance(1);
  expect(e.inspect().foodCollected).toBe(1);
  expect(e.inspect().energy).toBe(0.01);
  e.advance(1);
  expect(e.inspect().foodCollected).toBe(1);
  expect(e.result()?.terminalReason).toBe("energyExhausted");
});
test("stationary collection and private world state", () => {
  const world = fixture({ food: [{ id: "f0", x: 105, y: 100 }] });
  const a = createEpisode({
    scenario: world,
    controller: { kind: "constant", id: "still", left: 0, right: 0 },
  });
  a.advance(1);
  expect(a.result()?.foodCollected).toBe(1);
  expect(world.food).toHaveLength(1);
});
test("food sensing skips occluded nearer food and respects local orientation", () => {
  const world = fixture({
    config: { ...DEFAULT_WORLD, foodCount: 2, obstacleCount: 1 },
    food: [
      { id: "blocked", x: 150, y: 100 },
      { id: "visible", x: 180, y: 125 },
    ],
    obstacles: [{ id: "wall", x: 120, y: 95, width: 10, height: 10 }],
  });
  const state = {
    ...world.start,
    remaining: [true, true],
    energy: 100,
    speed: 0,
    angularSpeed: 0,
    contact: false,
  };
  const x = observe(world, state);
  expect(x[0]).toBeCloseTo(1 - (Math.hypot(80, 25) - 4) / 140);
  expect(x[8]).toBeCloseTo(1 - 20 / 140);
  expect(observe(world, { ...state, heading: Math.PI })[4]).toBe(x[0]);
});
