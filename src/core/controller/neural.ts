import { Random } from "../random";
export const PARAMETER_COUNT = 278;
export function validateParameters(p: Float32Array): void {
  if (
    !(p instanceof Float32Array) ||
    p.length !== PARAMETER_COUNT ||
    !p.every(Number.isFinite)
  )
    throw new Error("Invalid neural parameters");
}
export function initializeParameters(rng: Random): Float32Array {
  const p = new Float32Array(PARAMETER_COUNT);
  for (let i = 0; i < 240; i++)
    p[i] = (rng.uniform() * 2 - 1) * Math.sqrt(6 / 32);
  for (let i = 252; i < 276; i++)
    p[i] = (rng.uniform() * 2 - 1) * Math.sqrt(6 / 14);
  return p;
}
export function forward(
  p: Float32Array,
  x: Float64Array,
  h: Float64Array,
  out: Float64Array,
): void {
  for (let j = 0; j < 12; j++) {
    let sum = p[240 + j];
    for (let i = 0; i < 20; i++) sum += p[j * 20 + i] * x[i];
    h[j] = Math.tanh(sum);
  }
  for (let j = 0; j < 2; j++) {
    let sum = p[276 + j];
    for (let i = 0; i < 12; i++) sum += p[252 + j * 12 + i] * h[i];
    out[j] = Math.tanh(sum);
  }
}
