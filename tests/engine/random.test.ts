import { expect, test } from "vitest";
import { Random } from "../../src/core/random";
import { canonical, hash } from "../../src/core/canonical";
test("xoshiro128** reference vector and state restore", () => {
  const r = new Random([1, 2, 3, 4]);
  expect(Array.from({ length: 5 }, () => r.uint32())).toEqual([
    11520, 0, 5927040, 70819200, 2031721883,
  ]);
  const copy = new Random(r.state());
  expect(copy.uint32()).toBe(r.uint32());
});
test("canonical hashes and named streams", () => {
  expect(hash({ b: 2, a: 1 })).toBe(hash({ a: 1, b: 2 }));
  expect(canonical(-0)).toBe("0");
  expect(() => hash({ a: NaN })).toThrow();
  expect(Random.derive("world", 42).state()).not.toEqual(
    Random.derive("mutation", 42).state(),
  );
  const r = Random.derive("test");
  for (let i = 0; i < 1000; i++) {
    expect(r.integer(7)).toBeLessThan(7);
    expect(Number.isFinite(r.normal())).toBe(true);
  }
});
