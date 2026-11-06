import { parseArgs } from "node:util";
export function args() {
  return parseArgs({
    options: {
      preset: { type: "string", default: "open-v1" },
      seed: { type: "string", default: "42" },
      controller: { type: "string", default: "scripted-v1" },
      generations: { type: "string", default: "50" },
      out: { type: "string" },
      resume: { type: "string" },
      population: { type: "string" },
      ticks: { type: "string" },
      runs: { type: "string" },
    },
  }).values;
}
