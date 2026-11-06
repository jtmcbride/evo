import { hash } from "../canonical";
import { Random } from "../random";
import {
  DEFAULT_WORLD,
  validateWorld,
  type Scenario,
  type WorldConfig,
  type Vec,
  type Rect,
} from "../model";
import { rectDistance, distance } from "./geometry";
export function validateScenario(s: Scenario): void {
  validateWorld(s.config);
  const c = s.config;
  if (
    s.food.length !== c.foodCount ||
    s.obstacles.length !== c.obstacleCount ||
    !Number.isFinite(s.start.heading)
  )
    throw new Error("Invalid scenario counts or heading");
  const clear = (p: Vec, r: number) =>
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= r &&
    p.y >= r &&
    p.x <= c.width - r &&
    p.y <= c.height - r &&
    s.obstacles.every((o) => rectDistance(p, o) >= r);
  const ids = new Set<string>();
  for (const o of s.obstacles) {
    if (
      ids.has(o.id) ||
      ![o.x, o.y, o.width, o.height].every(Number.isFinite) ||
      o.width <= 0 ||
      o.height <= 0 ||
      o.x < 0 ||
      o.y < 0 ||
      o.x + o.width > c.width ||
      o.y + o.height > c.height
    )
      throw new Error("Invalid obstacle");
    ids.add(o.id);
  }
  if (!clear(s.start, c.bodyRadius)) throw new Error("Invalid start");
  for (const f of s.food) {
    if (ids.has(f.id) || !clear(f, c.foodRadius))
      throw new Error("Invalid food");
    ids.add(f.id);
  }
  const { hash: _, ...body } = s;
  void _;
  if (hash(body) !== s.hash) throw new Error("Scenario hash mismatch");
}
export function generateScenario(
  seed: string,
  config: WorldConfig = { ...DEFAULT_WORLD },
): Scenario {
  validateWorld(config);
  const c = { ...config },
    obstacles: Rect[] = [],
    food: Scenario["food"] = [];
  const geometry = Random.derive("geometry-v1", seed),
    foods = Random.derive("food-v1", seed),
    pose = Random.derive("pose-v1", seed);
  for (let i = 0; i < c.obstacleCount; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const width = 40 + geometry.uniform() * 60,
        height = 30 + geometry.uniform() * 50;
      const o = {
        id: `o${i}`,
        x: 32 + geometry.uniform() * (c.width - width - 64),
        y: 32 + geometry.uniform() * (c.height - height - 64),
        width,
        height,
      };
      if (
        o.x < 32 ||
        o.y < 32 ||
        o.x + width > c.width - 32 ||
        o.y + height > c.height - 32
      )
        continue;
      if (
        obstacles.every(
          (r) =>
            o.x + o.width + 32 <= r.x ||
            r.x + r.width + 32 <= o.x ||
            o.y + o.height + 32 <= r.y ||
            r.y + r.height + 32 <= o.y,
        )
      ) {
        obstacles.push(o);
        placed = true;
        break;
      }
    }
    if (!placed) throw new Error("Cannot place requested obstacles");
  }
  const sample = (rng: Random, r: number, accept: (p: Vec) => boolean): Vec => {
    for (let i = 0; i < 10000; i++) {
      const p = {
        x: r + rng.uniform() * (c.width - 2 * r),
        y: r + rng.uniform() * (c.height - 2 * r),
      };
      if (obstacles.every((o) => rectDistance(p, o) > r) && accept(p)) return p;
    }
    throw new Error("Cannot place requested objects");
  };
  const start = {
    ...sample(pose, c.bodyRadius, () => true),
    heading: pose.uniform() * 2 * Math.PI - Math.PI,
  };
  for (let i = 0; i < c.foodCount; i++)
    food.push({
      id: `f${i}`,
      ...sample(
        foods,
        c.bodyRadius + c.foodRadius,
        (p) =>
          distance(p, start) > c.bodyRadius + c.foodRadius &&
          food.every((f) => distance(p, f) > 2 * c.foodRadius),
      ),
    });
  const body = {
    generatorVersion: "world-v1",
    seed,
    config: c,
    obstacles,
    food,
    start,
  };
  return { hash: hash(body), ...body };
}
