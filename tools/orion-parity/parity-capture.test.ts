// COPY THIS FILE INTO ORION to regenerate the parity oracle.
//
//   cp tools/orion-parity/parity-capture.test.ts ../orion/src/test/__parity-capture.test.ts
//   cd ../orion && npx vitest run src/test/__parity-capture.test.ts
//   rm ../orion/src/test/__parity-capture.test.ts
//
// It must run inside Orion because Orion's runtime resolves its own `@/library/...` aliases, which
// this repo cannot satisfy. Everything else — the scenario spec and the runner — is shared, so the
// only thing that differs between the two sides is which runtime is handed in.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import type { OrionChartBar } from "@/library/models/chart/types";
import OrionIndicatorRuntime from "@/library/models/chart/workers/indicator-runtime";
// Assumes the standard side-by-side checkout: <parent>/orion and <parent>/fxtoolkit-indicators.
// This has to be a *static* import — vitest resolves static specifiers at transform time, but
// rejects a dynamically computed path that falls outside its root.
import { runScenarios } from "../../../fxtoolkit-indicators/tools/orion-parity/scenario-runner.mjs";

// Derived from the running repo (Orion) so nothing personal is baked into the file.
const PROJECT_ROOT = resolve(process.cwd(), "../fxtoolkit-indicators");
const ORION_ROOT = resolve(process.cwd());
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, "fixtures/parity/orion");

if (!existsSync(resolve(PROJECT_ROOT, "fixtures/parity/scenarios.json"))) {
  throw new Error(
    `Expected the fxtoolkit-indicators checkout next to Orion, at ${PROJECT_ROOT}`,
  );
}

describe("orion parity capture", () => {
  it("records every scenario through Orion's runtime", async () => {
    const { scenarios } = JSON.parse(
      await readFile(resolve(PROJECT_ROOT, "fixtures/parity/scenarios.json"), "utf8"),
    );
    const barsPayload = JSON.parse(
      await readFile(resolve(ORION_ROOT, "public/bars-1d.json"), "utf8"),
    ) as { data: { ticks: OrionChartBar[] } };

    const manifest = JSON.parse(
      await readFile(
        resolve(ORION_ROOT, "public/orion-indicators/manifest.json"),
        "utf8",
      ),
    );

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith("/orion-indicators/manifest.json")) {
        return { json: async () => manifest, ok: true };
      }

      const filename = url.split("/").at(-1);
      if (!filename?.endsWith(".wasm")) {
        return { ok: false };
      }

      const bytes = await readFile(
        resolve(ORION_ROOT, "public/orion-indicators", filename),
      );
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;

      return { arrayBuffer: async () => arrayBuffer, ok: true };
    }) as unknown as typeof fetch;

    const results = await runScenarios({
      bars: barsPayload.data.ticks,
      runtime: new OrionIndicatorRuntime(),
      scenarios,
    });

    await mkdir(OUTPUT_DIRECTORY, { recursive: true });

    for (const [id, result] of Object.entries(results)) {
      await writeFile(
        resolve(OUTPUT_DIRECTORY, `${id}.json`),
        JSON.stringify(result),
      );
    }

    console.log(
      `Captured ${Object.keys(results).length} scenarios into ${OUTPUT_DIRECTORY}`,
    );
  }, 120_000);
});
