/**
 * Drives the real worker + engine against the golden binaries, so tests exercise genuine render
 * bundles rather than hand-built fixtures.
 *
 * The worker module is evaluated once per process and holds module-scope indicator state, so a
 * harness loads *all* the modules it wants in a single engine rather than creating several.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ChartBar,
  IndicatorRenderBundle,
} from "@fxtoolkit/indicator-stdlib/abi";
import { IndicatorEngine } from "@fxtoolkit/indicator-runner";
import { createInProcessWorker } from "./in-process-worker";
import { goldenDirectory, readBarBatch, readGoldenManifest } from "./indicator-fixtures";

export const GOLDEN_MANIFEST_URL = "/orion-indicators/manifest.json";

/** Serves the golden manifest and binaries to the worker's fetch-based module source. */
export async function installGoldenFetchStub() {
  const manifest = await readGoldenManifest();

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const filename = url.split("/").at(-1);

    if (filename === "manifest.json") {
      return { json: async () => manifest, ok: true };
    }

    const bytes = await readFile(resolve(goldenDirectory, filename!));

    return {
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ok: true,
    };
  }) as unknown as typeof fetch;
}

export interface GoldenEngineHarness {
  bars: ChartBar[];
  bundles: IndicatorRenderBundle[];
  destroy(): void;
  engine: IndicatorEngine;
}

export async function createGoldenEngineHarness(
  modules: readonly string[],
): Promise<GoldenEngineHarness> {
  await installGoldenFetchStub();

  const worker = await createInProcessWorker();
  const engine = new IndicatorEngine({
    createWorker: () => worker.asWorker(),
    manifestUrl: GOLDEN_MANIFEST_URL,
  });

  await engine.init();

  for (const module of modules) {
    await engine.loadIndicator({ module });
  }

  const bars = await readBarBatch();
  const history = await engine.replaceHistoryBars(bars);

  return {
    bars,
    bundles: history.bundles,
    destroy: () => engine.destroy(),
    engine,
  };
}

export function findBundle(
  harness: GoldenEngineHarness,
  module: string,
): IndicatorRenderBundle {
  const bundle = harness.bundles.find((candidate) => candidate.module === module);

  if (!bundle) {
    throw new Error(`No bundle produced for "${module}"`);
  }

  return bundle;
}
