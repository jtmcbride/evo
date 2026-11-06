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

test("rounded corners allow paths outside the actual disk expansion", () => {
  const r = { id: "corner", x: 200, y: 100, width: 50, height: 50 };
  const result = move({ x: 180, y: 93 }, { x: 13, y: 0 }, DEFAULT_WORLD, [r]);
  expect(result.contact).toBe(false);
  expect(result.position).toEqual({ x: 193, y: 93 });
});
test("contact survives until the next controller decision and scenarios are copied", () => {
  const scenario = fixture({
    config: { ...DEFAULT_WORLD, foodCount: 1, obstacleCount: 1 },
    start: { x: 190, y: 150, heading: 0 },
    obstacles: [{ id: "wall", x: 200, y: 100, width: 10, height: 200 }],
  });
  const episode = createEpisode({
    scenario,
    controller: { kind: "constant", id: "push", left: 1, right: 1 },
    trace: true,
  });
  scenario.start.x = 300;
  episode.advance(4);
  expect(episode.decisionTrace()?.inputs[19]).toBe(1);
  expect(episode.inspect().x).toBeLessThan(193);
});
test("many swept movements remain outside rectangles and arena walls", () => {
  const obstacles = [{ id: "r", x: 300, y: 200, width: 150, height: 120 }];
  for (let i = 0; i < 100; i++) {
    const angle = (i * Math.PI) / 50,
      start = {
        x: 375 + 200 * Math.cos(angle),
        y: 260 + 180 * Math.sin(angle),
      },
      delta = { x: 400 * Math.cos(angle + 2), y: 400 * Math.sin(angle + 2) };
    const result = move(start, delta, DEFAULT_WORLD, obstacles);
    expect(rectDistance(result.position, obstacles[0])).toBeGreaterThanOrEqual(
      8 - 1e-6,
    );
    expect(result.position.x).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(result.position.x).toBeLessThanOrEqual(792 + 1e-6);
    expect(result.position.y).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(result.position.y).toBeLessThanOrEqual(592 + 1e-6);
    expect(result.length).toBeLessThanOrEqual(
      Math.hypot(delta.x, delta.y) + 1e-6,
    );
  }
});
