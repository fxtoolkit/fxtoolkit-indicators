// Builds both packages and packs them into installable tarballs under `release/`.
//
// Consumers install these by URL from a GitHub release:
//
//   "@fxtoolkit/indicator-runner": "https://github.com/YOU/REPO/releases/download/v0.1.0/fxtoolkit-indicator-runner-0.1.0.tgz"

import { spawn } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const releaseDirectory = resolve(projectRoot, "release");
const PACKAGES = ["@fxtoolkit/indicator-stdlib", "@fxtoolkit/indicator-runner"];

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

/** `npm pack` names the file `<name-without-scope>-<version>.tgz`. */
function tarballName(packageName, version) {
  return `${packageName.replace("@", "").replace("/", "-")}-${version}.tgz`;
}

async function main() {
  await rm(releaseDirectory, { force: true, recursive: true });
  await mkdir(releaseDirectory, { recursive: true });

  // Library packages only — the demo is not published.
  await run("npm", ["run", "build", "-w", PACKAGES[0]]);
  await run("npm", ["run", "build", "-w", PACKAGES[1]]);

  for (const packageName of PACKAGES) {
    await run("npm", [
      "pack",
      "-w",
      packageName,
      "--pack-destination",
      releaseDirectory,
    ]);
  }

  const tarballs = (await readdir(releaseDirectory)).filter((name) =>
    name.endsWith(".tgz"),
  );

  if (tarballs.length !== PACKAGES.length) {
    throw new Error(
      `Expected ${PACKAGES.length} tarballs, found ${tarballs.length}: ${tarballs.join(", ")}`,
    );
  }

  console.log("\nRelease tarballs:");
  for (const tarball of tarballs.sort()) {
    console.log(`  release/${tarball}`);
  }

  console.log(
    "\nAttach these to a GitHub release, then install them by URL. Reference:",
  );
  for (const tarball of tarballs.sort()) {
    console.log(
      `  https://github.com/YOU/REPO/releases/download/v<version>/${tarball}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export { tarballName };
