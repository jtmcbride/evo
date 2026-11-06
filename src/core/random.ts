import { sha256 } from "@noble/hashes/sha2.js";
import { canonical } from "./canonical";
export type RandomState = [number, number, number, number];
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
export class Random {
  private s: RandomState;
  constructor(state: RandomState) {
    if (
      state.length !== 4 ||
      state.some((x) => !Number.isInteger(x) || x < 0 || x > 0xffffffff) ||
      state.every((x) => x === 0)
    )
      throw new Error("Invalid PRNG state");
    this.s = [...state];
  }
  static derive(...key: (string | number)[]): Random {
    const bytes = sha256(new TextEncoder().encode(canonical(key)));
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const state = [0, 1, 2, 3].map((i) =>
      d.getUint32(i * 4, true),
    ) as RandomState;
    return new Random(state.every((x) => x === 0) ? [1, 0, 0, 0] : state);
  }
  state(): RandomState {
    return [...this.s];
  }
  uint32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    for (let i = 0; i < 4; i++) s[i] >>>= 0;
    return result;
  }
  uniform(): number {
    return this.uint32() / 0x100000000;
  }
  integer(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000)
      throw new Error("Invalid integer bound");
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      x = this.uint32();
    } while (x >= limit);
    return x % n;
  }
  normal(): number {
    return (
      Math.sqrt(-2 * Math.log((this.uint32() + 1) / 0x100000000)) *
      Math.cos(2 * Math.PI * this.uniform())
    );
  }
}
