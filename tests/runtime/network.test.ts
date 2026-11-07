import { test, expect } from "vitest";
import {
  connections,
  NEURONS,
  bias,
  NODE_BY_ID,
} from "../../src/ui/inspector/network";
test("inspector maps the documented parameter layout without treating biases as edges", () => {
  const p = Float32Array.from({ length: 278 }, (_, i) => i / 100);
  const edges = connections(p);
  expect(edges).toHaveLength(264);
  expect(NEURONS).toHaveLength(34);
  expect(edges[239]).toEqual({
    index: 239,
    from: "I19",
    to: "H11",
    weight: p[239],
  });
  expect(edges[240]).toEqual({
    index: 252,
    from: "H0",
    to: "O0",
    weight: p[252],
  });
  expect(edges[263]).toEqual({
    index: 275,
    from: "H11",
    to: "O1",
    weight: p[275],
  });
  expect(bias(p, NODE_BY_ID.get("H11")!)).toBe(p[251]);
  expect(bias(p, NODE_BY_ID.get("O1")!)).toBe(p[277]);
  expect(bias(p, NODE_BY_ID.get("I0")!)).toBeNull();
});
