export interface Neuron {
  id: string;
  label: string;
  x: number;
  y: number;
  index: number;
  layer: "input" | "hidden" | "output";
}
export interface Connection {
  index: number;
  from: string;
  to: string;
  weight: number;
}
export const DIRECTIONS = [
  "Forward",
  "Front right",
  "Right",
  "Back right",
  "Back",
  "Back left",
  "Left",
  "Front left",
];
export const INPUT_LABELS = [
  ...DIRECTIONS.map((d) => `Food · ${d.toLowerCase()}`),
  ...DIRECTIONS.map((d) => `Obstacle · ${d.toLowerCase()}`),
  "Energy",
  "Signed speed",
  "Angular velocity",
  "Contact before decision",
];
export const NEURONS: Neuron[] = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `I${i}`,
    label: INPUT_LABELS[i],
    x: 36,
    y: 28 + i * 20,
    index: i,
    layer: "input" as const,
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `H${i}`,
    label: "Hidden neuron",
    x: 150,
    y: 62 + i * 28,
    index: i,
    layer: "hidden" as const,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `O${i}`,
    label: i ? "Right motor" : "Left motor",
    x: 264,
    y: 186 + i * 80,
    index: i,
    layer: "output" as const,
  })),
];
export const NODE_BY_ID = new Map(NEURONS.map((n) => [n.id, n]));
export function connections(parameters: Float32Array): Connection[] {
  return [
    ...Array.from({ length: 240 }, (_, i) => ({
      index: i,
      from: `I${i % 20}`,
      to: `H${Math.floor(i / 20)}`,
      weight: parameters[i],
    })),
    ...Array.from({ length: 24 }, (_, i) => ({
      index: 252 + i,
      from: `H${i % 12}`,
      to: `O${Math.floor(i / 12)}`,
      weight: parameters[252 + i],
    })),
  ];
}
export function bias(parameters: Float32Array, node: Neuron): number | null {
  return node.layer === "input"
    ? null
    : parameters[node.layer === "hidden" ? 240 + node.index : 276 + node.index];
}
