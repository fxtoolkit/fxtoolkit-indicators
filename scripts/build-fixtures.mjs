// Compiles the fixture indicators against the ported @fxtoolkit/indicator-stdlib.
//
// Ported from orion `scripts/build-indicators.mjs` (the asc invocation is identical, minus
// descriptor readback/manifest emission, which the parity test does instead). The only
// differences are the source/output directories and that the stdlib resolves through the
// workspace's node_modules rather than an explicit --path.

import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceDirectory = resolve(projectRoot, "fixtures/indicators");
const outputDirectory = resolve(projectRoot, "fixtures/build");
const ascPath = resolve(projectRoot, "node_modules/assemblyscript/bin/asc");

// asc does not walk node_modules up from the importing file, and its package
// resolution looks for `<path>/<package>/index.ts` — it does not read `ascMain`.
// So the package base dir is passed explicitly and the stdlib entry lives at the
// stdlib package root as `index.ts` (matching orion's layout). This directory
// contains `@fxtoolkit/indicator-stdlib`, the npm workspace symlink.
const packageSearchDirectory = resolve(projectRoot, "node_modules");

function runAsc(entryPath, outFile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        ascPath,
        entryPath,
        "-O",
        "--noAssert",
        "--exportRuntime",
        "--path",
        packageSearchDirectory,
        "--outFile",
        outFile,
      ],
      { cwd: projectRoot, stdio: "inherit" },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`AssemblyScript compilation failed for ${entryPath}`));
    });
  });
}

async function main() {
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });

  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !entry.name.startsWith("_"),
    )
    .map((entry) => entry.name)
    .sort();

  if (!entries.length) {
    throw new Error(`No fixture indicators found in ${sourceDirectory}`);
  }

  for (const entry of entries) {
    const type = basename(entry, ".ts");
    await runAsc(
      resolve(sourceDirectory, entry),
      resolve(outputDirectory, `${type}.wasm`),
    );
  }

  console.log(`Compiled ${entries.length} fixture indicators into ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
