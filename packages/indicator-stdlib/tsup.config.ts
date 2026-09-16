import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "abi/index": "abi/index.ts",
    "compiler/compile-worker": "compiler/compile-worker.ts",
    "compiler/index": "compiler/index.ts",
  },
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  // Only the `./compiler` subpath needs AssemblyScript; it is an optional peer dependency.
  external: ["assemblyscript"],
});
