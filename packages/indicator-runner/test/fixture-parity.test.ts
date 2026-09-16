import { beforeAll, describe, expect, it } from "vitest";
import type { IndicatorManifestEntry } from "@fxtoolkit/indicator-stdlib/abi";
import {
  readDescriptor,
  readExportedNames,
  readFixtureModules,
  readGoldenBytes,
  readGoldenManifest,
  readImportedNames,
} from "./support/indicator-fixtures";

describe("ported stdlib vs golden indicators", () => {
  let fixtures: Map<string, Uint8Array>;
  let goldenByModule: Map<string, IndicatorManifestEntry>;

  beforeAll(async () => {
    fixtures = await readFixtureModules();
    goldenByModule = new Map(
      (await readGoldenManifest()).indicators.map((entry) => [entry.module, entry]),
    );

    expect(fixtures.size).toBeGreaterThan(0);
  });

  it("builds one fixture per golden module", () => {
    expect([...fixtures.keys()].sort()).toEqual([...goldenByModule.keys()].sort());
  });

  it("describes each fixture identically to its golden manifest entry", async () => {
    for (const [module, bytes] of fixtures) {
      const golden = goldenByModule.get(module)!;
      expect(await readDescriptor(bytes), module).toEqual(golden.descriptor);
    }
  });

  it("imports and exports the same surface as the golden binary", async () => {
    for (const [module, bytes] of fixtures) {
      const goldenBytes = await readGoldenBytes(goldenByModule.get(module)!);

      expect(await readImportedNames(bytes), `${module} imports`).toEqual(
        await readImportedNames(goldenBytes),
      );
      expect(await readExportedNames(bytes), `${module} exports`).toEqual(
        await readExportedNames(goldenBytes),
      );
    }
  });
});
