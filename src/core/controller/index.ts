export type ControllerDefinition =
  | { kind: "scripted"; id: string }
  | { kind: "constant"; id: string; left: number; right: number };
export interface Controller {
  act(inputs: Float64Array, outputs: Float64Array): void;
}
export function createController(def: ControllerDefinition): Controller {
  if (
    def.kind === "constant" &&
    (![def.left, def.right].every(Number.isFinite) ||
      Math.abs(def.left) > 1 ||
      Math.abs(def.right) > 1)
  )
    throw new Error("Invalid motors");
  return {
    act(inputs, out) {
      if (def.kind === "constant") {
        out[0] = def.left;
        out[1] = def.right;
        return;
      }
      let best = 0;
      for (let i = 1; i < 8; i++) if (inputs[i] > inputs[best]) best = i;
      const angle = ((best <= 4 ? best : best - 8) * Math.PI) / 4;
      const blocked = Math.max(inputs[8], inputs[9], inputs[15]) > 0.8;
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
