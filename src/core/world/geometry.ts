import type { Rect, Vec, WorldConfig } from "../model";
export const EPS = 1e-6;
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = dx * dx + dy * dy;
  const t =
    d === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function rectDistance(p: Vec, r: Rect): number {
  return Math.hypot(
    Math.max(r.x - p.x, 0, p.x - r.x - r.width),
    Math.max(r.y - p.y, 0, p.y - r.y - r.height),
  );
}
export function rayRect(p: Vec, d: Vec, r: Rect): number {
  let lo = 0,
    hi = Infinity;
  for (const [v, s, min, max] of [
    [p.x, d.x, r.x, r.x + r.width],
    [p.y, d.y, r.y, r.y + r.height],
  ]) {
    if (Math.abs(s) < 1e-15) {
      if (v < min || v > max) return Infinity;
    } else {
      const a = (min - v) / s,
        b = (max - v) / s;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    }
  }
  return hi >= lo ? lo : Infinity;
}
interface Hit {
  t: number;
  nx: number;
  ny: number;
  id: string;
}
function circleHits(p: Vec, d: Vec, c: Vec, r: number): number[] {
  const a = d.x * d.x + d.y * d.y;
  if (a === 0) return [];
  const x = p.x - c.x,
    y = p.y - c.y,
    b = 2 * (x * d.x + y * d.y),
    disc = b * b - 4 * a * (x * x + y * y - r * r);
  return disc < 0 ? [] : [(-b - Math.sqrt(disc)) / (2 * a)];
}
export function move(
  p: Vec,
  delta: Vec,
  c: WorldConfig,
  obstacles: Rect[],
): { position: Vec; segments: [Vec, Vec][]; contact: boolean; length: number } {
  let at = { ...p },
    d = { ...delta },
    contact = false;
  const segments: [Vec, Vec][] = [];
  for (let iter = 0; iter < 4 && Math.hypot(d.x, d.y) > 1e-12; iter++) {
    const hits: Hit[] = [];
    const add = (t: number, nx: number, ny: number, id: string) => {
      if (t >= -1e-12 && t <= 1 && d.x * nx + d.y * ny < -1e-12)
        hits.push({ t: Math.max(0, t), nx, ny, id });
    };
    const radius = c.bodyRadius;
    if (d.x < 0) add((radius - at.x) / d.x, 1, 0, "!left");
    if (d.x > 0) add((c.width - radius - at.x) / d.x, -1, 0, "!right");
    if (d.y < 0) add((radius - at.y) / d.y, 0, 1, "!top");
    if (d.y > 0) add((c.height - radius - at.y) / d.y, 0, -1, "!bottom");
    for (const r of obstacles) {
      for (const [x, nx] of [
        [r.x - radius, -1],
        [r.x + r.width + radius, 1],
      ])
        if (d.x !== 0) {
          const t = (x - at.x) / d.x,
            y = at.y + t * d.y;
          if (y >= r.y && y <= r.y + r.height) add(t, nx, 0, r.id);
        }
      for (const [y, ny] of [
        [r.y - radius, -1],
        [r.y + r.height + radius, 1],
      ])
        if (d.y !== 0) {
          const t = (y - at.y) / d.y,
            x = at.x + t * d.x;
          if (x >= r.x && x <= r.x + r.width) add(t, 0, ny, r.id);
        }
      for (const [x, sx] of [
        [r.x, -1],
        [r.x + r.width, 1],
      ])
        for (const [y, sy] of [
          [r.y, -1],
          [r.y + r.height, 1],
        ])
          for (const t of circleHits(at, d, { x, y }, radius)) {
            const dx = at.x + t * d.x - x,
              dy = at.y + t * d.y - y;
            if (dx * sx >= 0 && dy * sy >= 0)
              add(t, dx / radius, dy / radius, r.id);
          }
    }
    hits.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const hit = hits[0];
    const t = hit?.t ?? 1,
      end = { x: at.x + d.x * t, y: at.y + d.y * t };
    segments.push([{ ...at }, end]);
    at = end;
    if (!hit) break;
    contact = true;
    d = { x: d.x * (1 - t), y: d.y * (1 - t) };
    const dot = d.x * hit.nx + d.y * hit.ny;
    d.x -= dot * hit.nx;
    d.y -= dot * hit.ny;
    at = { x: at.x + EPS * hit.nx, y: at.y + EPS * hit.ny };
  }
  if (segments.length === 0) segments.push([{ ...at }, { ...at }]);
  return {
    position: at,
    segments,
    contact,
    length: segments.reduce((sum, [a, b]) => sum + distance(a, b), 0),
  };
}
