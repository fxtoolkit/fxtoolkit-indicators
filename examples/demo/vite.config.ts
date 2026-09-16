import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5273 },
  build: { outDir: "dist", emptyOutDir: true },
});
