import { defineConfig } from "vitest/config";

/**
 * Consumer-level configuration.
 *
 * Deliberately declares **no `resolve.alias`**, so package specifiers resolve through
 * `node_modules` → `package.json#exports` → `dist`. That is what a real consumer sees, and it is the
 * only way to catch a broken `exports` map or a missing build artifact.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/consumer/**/*.test.ts"],
  },
});
