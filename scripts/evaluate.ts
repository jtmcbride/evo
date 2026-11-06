import { Random } from "../src/core/random";
console.log(
  JSON.stringify({
    status: "M0 toolchain ready",
    sample: Random.derive("cli-v1", "42").uint32(),
  }),
);
