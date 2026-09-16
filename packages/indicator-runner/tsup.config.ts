import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "engine/worker": "src/engine/worker.ts",
  },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["@assemblyscript/loader", "@fxtoolkit/indicator-stdlib"],
});
