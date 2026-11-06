// Portable JSON envelope: exact signed zeros and explicit little-endian Float32 data.
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("Nonfinite checkpoint value");
      if (Object.is(v, -0)) return { $evo: "negative-zero" };
    }
    if (v instanceof Float32Array) {
      const bytes = new Uint8Array(v.length * 4),
        view = new DataView(bytes.buffer);
      v.forEach((x, i) => {
        if (!Number.isFinite(x)) throw new Error("Nonfinite parameter");
        view.setFloat32(i * 4, x, true);
      });
      return { $evo: "float32le", bytes: Array.from(bytes) };
    }
    return v;
  });
}
export function decode(text: string): unknown {
  return JSON.parse(text, (_key, v) => {
    if (v && typeof v === "object" && "$evo" in v) {
      if (v.$evo === "negative-zero" && Object.keys(v).length === 1) return -0;
      if (
        v.$evo === "float32le" &&
        Object.keys(v).length === 2 &&
        Array.isArray(v.bytes) &&
        v.bytes.length % 4 === 0 &&
        v.bytes.every(
          (x: unknown) =>
            typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255,
        )
      ) {
        const bytes = Uint8Array.from(v.bytes),
          view = new DataView(bytes.buffer),
          out = new Float32Array(bytes.length / 4);
        for (let i = 0; i < out.length; i++) {
          out[i] = view.getFloat32(i * 4, true);
          if (!Number.isFinite(out[i])) throw new Error("Nonfinite parameter");
        }
        return out;
      }
      throw new Error("Invalid checkpoint encoding");
    }
    if (typeof v === "number" && !Number.isFinite(v))
      throw new Error("Nonfinite checkpoint value");
    return v;
  });
}
