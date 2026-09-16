// Bumps both packages in lockstep and keeps their cross-package range in sync.
//
// Doing this by hand has broken the release twice: once by editing package.json without re-running
// `npm install` (lockfile out of sync -> `npm ci` fails), and once by bumping the versions but not
// the runner's range on the stdlib (`^0.3.0` cannot match a 0.4.0 workspace package, so npm tries the
// registry and 404s).
//
//   node scripts/bump-version.mjs 0.4.0

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <major.minor.patch>");
  process.exit(1);
}

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const STDLIB = "@fxtoolkit/indicator-stdlib";
const PACKAGES = ["indicator-stdlib", "indicator-runner"];

for (const name of PACKAGES) {
  const path = resolve(projectRoot, "packages", name, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = version;

  // The runner must accept the stdlib we are shipping with it, or npm will try the registry.
  if (name === "indicator-runner") {
    manifest.peerDependencies[STDLIB] = `^${version}`;
    manifest.devDependencies[STDLIB] = `^${version}`;
  }

  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.name} -> ${version}`);
}

// Sync the lockfile. Skipping this is what broke the first release.
const install = spawnSync("npm", ["install"], { cwd: projectRoot, stdio: "inherit" });

if (install.status !== 0) {
  console.error("\nnpm install failed — fix that before tagging.");
  process.exit(install.status ?? 1);
}

console.log("\nNow verify with the exact command CI runs before tagging:");
console.log("  npm ci && npm run typecheck && npm test");
