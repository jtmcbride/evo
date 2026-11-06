import type { Scenario, Vec } from "../model";
import { rayRect, distance } from "./geometry";
export const wrap = (angle: number) =>
  ((((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) -
  Math.PI;
export interface SenseState extends Vec {
  heading: number;
  energy: number;
  speed: number;
  angularSpeed: number;
  contact: boolean;
  remaining: boolean[];
}
export function observe(
  s: Scenario,
  state: SenseState,
  out = new Float64Array(20),
): Float64Array {
  out.fill(0);
  const c = s.config;
  for (let i = 0; i < 8; i++) {
    const angle = state.heading + (i * Math.PI) / 4,
      d = { x: Math.cos(angle), y: Math.sin(angle) };
    let nearest = Math.min(
      d.x > 0 ? (c.width - state.x) / d.x : d.x < 0 ? -state.x / d.x : Infinity,
      d.y > 0
        ? (c.height - state.y) / d.y
        : d.y < 0
          ? -state.y / d.y
          : Infinity,
    );
    for (const o of s.obstacles)
      nearest = Math.min(nearest, rayRect(state, d, o));
    out[8 + i] = Math.max(0, 1 - nearest / c.sensorRange);
  }
  for (let i = 0; i < s.food.length; i++)
    if (state.remaining[i]) {
      const f = s.food[i],
        length = distance(state, f),
        dist = Math.max(0, length - c.foodRadius);
      if (dist >= c.sensorRange) continue;
      const dir =
        length === 0
          ? { x: 1, y: 0 }
          : { x: (f.x - state.x) / length, y: (f.y - state.y) / length };
      if (s.obstacles.some((o) => rayRect(state, dir, o) <= length)) continue;
      const relative = wrap(
        Math.atan2(f.y - state.y, f.x - state.x) - state.heading,
      );
      const sector =
        ((Math.floor((relative + Math.PI / 8) / (Math.PI / 4)) % 8) + 8) % 8;
      out[sector] = Math.max(out[sector], 1 - dist / c.sensorRange);
    }
  out[16] = state.energy / c.maxEnergy;
  out[17] = Math.max(-1, Math.min(1, state.speed / c.vMax));
  out[18] = state.angularSpeed / c.omegaMax;
  out[19] = Number(state.contact);
  return out;
}
