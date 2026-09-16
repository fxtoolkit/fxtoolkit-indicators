// Copies the golden fixtures into the demo's public directory so the dev server can serve the
// manifest and compiled binaries. They are not committed — regenerate with `npm run prepare:assets`.

import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const demoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const projectRoot = resolve(demoRoot, "../..");
const sourceDirectory = resolve(projectRoot, "fixtures/golden");
const targetDirectory = resolve(demoRoot, "public/orion-indicators");

await rm(targetDirectory, { force: true, recursive: true });
await mkdir(targetDirectory, { recursive: true });

const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.endsWith(".wasm") || entry.name === "manifest.json"),
  )
  .map((entry) => entry.name);

for (const name of entries) {
  await cp(resolve(sourceDirectory, name), resolve(targetDirectory, name));
}

// The demo fetches the bar series as a static asset.
await cp(
  resolve(sourceDirectory, "bar-batch.json"),
  resolve(targetDirectory, "bars.json"),
);

console.log(
  `Prepared ${entries.length} indicator assets + bars.json in ${targetDirectory}`,
);
