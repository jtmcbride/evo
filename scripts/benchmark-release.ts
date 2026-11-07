import { parseArgs } from "node:util";
import { runBenchmark } from "./benchmark-runner";
const { values } = parseArgs({
  options: { run: { type: "string" }, out: { type: "string" } },
});
if (values.run === undefined || !values.out)
  throw new Error("Use --run 0..19 --out NEW_DIRECTORY");
await runBenchmark(Number(values.run), values.out);
