import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { instantiate } from "@assemblyscript/loader";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ABI_VERSION,
  COMPILER_ADDITIONAL_EXPORTS,
  HOST_ENV_IMPORTS,
  HOST_ORION_IMPORTS,
  RUNNER_REQUIRED_EXPORTS,
  type IndicatorManifest,
} from "@fxtoolkit/indicator-stdlib/abi";
import {
  createStubImports,
  goldenDirectory,
  readGoldenManifest,
  wasmFilename,
} from "./support/indicator-fixtures";

describe("golden indicator ABI conformance", () => {
  let manifest: IndicatorManifest;
  let bytesByModule: Map<string, Uint8Array>;

  beforeAll(async () => {
    manifest = await readGoldenManifest();

    expect(manifest.indicators.length).toBeGreaterThan(0);

    bytesByModule = new Map(
      await Promise.all(
        manifest.indicators.map(
          async (entry) =>
            [
              entry.module,
              await readFile(resolve(goldenDirectory, wasmFilename(entry))),
            ] as const,
        ),
      ),
    );
  });

  it("ships every manifest entry at the pinned ABI version", () => {
    for (const entry of manifest.indicators) {
      expect(entry.abiVersion, entry.module).toBe(ABI_VERSION);
    }
  });

  it("imports only the documented host surface", async () => {
    const documentedOrionImports = new Set<string>(HOST_ORION_IMPORTS);
    const documentedEnvImports = new Set<string>(HOST_ENV_IMPORTS);

    for (const entry of manifest.indicators) {
      const compiled = await WebAssembly.compile(bytesByModule.get(entry.module)!);
      const imports = WebAssembly.Module.imports(compiled);

      // AssemblyScript dead-code-eliminates unused imports, so a module imports
      // the subset of the surface it actually calls — never anything outside it.
      expect(imports.length, `${entry.module} import count`).toBeGreaterThan(0);

      for (const entryImport of imports) {
        if (entryImport.module === "env") {
          expect(
            documentedEnvImports.has(entryImport.name),
            `${entry.module} imports undocumented env.${entryImport.name}`,
          ).toBe(true);
          continue;
        }

        expect(entryImport.module, `${entry.module} import namespace`).toBe("orion");
        expect(
          documentedOrionImports.has(entryImport.name),
          `${entry.module} imports undocumented orion.${entryImport.name}`,
        ).toBe(true);
      }
    }
  });

  it("exports the required surface and reports its descriptor", async () => {
    const requiredExports = [
      ...RUNNER_REQUIRED_EXPORTS,
      ...COMPILER_ADDITIONAL_EXPORTS,
    ];

    for (const entry of manifest.indicators) {
      const runtime = await instantiate(
        bytesByModule.get(entry.module)!,
        createStubImports(),
      );
      const exports = runtime.exports as Record<string, unknown>;

      for (const requiredExport of requiredExports) {
        expect(
          exports[requiredExport],
          `${entry.module}.${requiredExport}`,
        ).toBeTruthy();
      }

      const describeFn = exports.describe as () => number;
      const getString = exports.__getString as (pointer: number) => string;

      expect(JSON.parse(getString(describeFn())), entry.module).toEqual(
        entry.descriptor,
      );
    }
  });
});
