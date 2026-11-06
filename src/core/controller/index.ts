import { Random, type RandomState } from "../random";
import { forward, validateParameters } from "./neural";
export type ControllerDefinition =
  | { kind: "scripted"; id: string }
  | { kind: "constant"; id: string; left: number; right: number }
  | { kind: "neural"; id: string; parameters: Float32Array }
  | { kind: "random"; id: string; seed: string };
export interface Controller {
  act(inputs: Float64Array, outputs: Float64Array): void;
  state(): RandomState | null;
  hidden(): Float64Array | null;
}
export function createController(
  definition: ControllerDefinition,
  state?: RandomState | null,
): Controller {
  const def = structuredClone(definition);
  if (
    !["constant", "scripted", "neural", "random"].includes(def.kind) ||
    typeof def.id !== "string"
  )
    throw new Error("Invalid controller");
  if (
    def.kind === "constant" &&
    (![def.left, def.right].every(Number.isFinite) ||
      Math.abs(def.left) > 1 ||
      Math.abs(def.right) > 1)
  )
    throw new Error("Invalid motors");
  if (def.kind === "neural") validateParameters(def.parameters);
  if (def.kind === "random" && typeof def.seed !== "string")
    throw new Error("Invalid random seed");
  const random =
    def.kind === "random"
      ? state
        ? new Random(state)
        : Random.derive("random-actions-v1", def.seed)
      : null;
  if (def.kind !== "random" && state != null)
    throw new Error("Unexpected controller state");
  const hidden = def.kind === "neural" ? new Float64Array(12) : null;
  return {
    state: () => random?.state() ?? null,
    hidden: () => hidden?.slice() ?? null,
    act(inputs, out) {
      if (inputs.length !== 20 || !inputs.every(Number.isFinite))
        throw new Error("Invalid observations");
      if (def.kind === "neural") {
        forward(def.parameters, inputs, hidden!, out);
        return;
      }
      if (def.kind === "random") {
        out[0] = random!.uniform() * 2 - 1;
        out[1] = random!.uniform() * 2 - 1;
        return;
      }
      if (def.kind === "constant") {
        out[0] = def.left;
        out[1] = def.right;
        return;
      }
      let best = 0;
      for (let i = 1; i < 8; i++) if (inputs[i] > inputs[best]) best = i;
      const angle = ((best <= 4 ? best : best - 8) * Math.PI) / 4,
        blocked = Math.max(inputs[8], inputs[9], inputs[15]) > 0.8;
      const turn = blocked
        ? inputs[9] > inputs[15]
          ? -0.8
          : 0.8
        : inputs[best] > 0
          ? Math.max(-0.8, Math.min(0.8, angle))
          : 0.3;
      const speed = blocked ? 0 : 0.5 * (1 - Math.abs(turn));
      out[0] = speed + turn;
      out[1] = speed - turn;
    },
  };
}
