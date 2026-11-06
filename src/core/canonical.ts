import { sha256 } from "@noble/hashes/sha2.js";
export function canonical(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Nonfinite number");
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "string"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  throw new Error("Unsupported canonical value");
}
export function hash(value: unknown): string {
  return Array.from(sha256(new TextEncoder().encode(canonical(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function parameterHash(values: Float32Array): string {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) throw new Error("Nonfinite parameter");
    view.setFloat32(i * 4, v, true);
  });
  return hash({ schema: "dense-20-12-2-v1", bytes: Array.from(bytes) });
}
