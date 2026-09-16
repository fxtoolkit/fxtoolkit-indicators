import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@fxtoolkit/indicator-stdlib/abi": path.resolve(
        root,
        "packages/indicator-stdlib/abi/index.ts",
      ),
      "@fxtoolkit/indicator-stdlib/compiler": path.resolve(
        root,
        "packages/indicator-stdlib/compiler/index.ts",
      ),
      "@fxtoolkit/indicator-runner": path.resolve(
        root,
        "packages/indicator-runner/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.dom.test.ts", "jsdom"]],
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
      "fixtures/**/*.test.ts",
    ],
    passWithNoTests: false,
  },
});
