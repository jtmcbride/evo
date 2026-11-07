import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    fsModuleCache: false,
    environment: "node",
    include: [
      "tests/engine/**/*.test.ts",
      "tests/runtime/**/*.test.ts",
      "tests/persistence/**/*.test.ts",
    ],
  },
});
