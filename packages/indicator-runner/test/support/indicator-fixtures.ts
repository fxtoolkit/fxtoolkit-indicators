import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { instantiate } from "@assemblyscript/loader";
import type {
  ChartBar,
  IndicatorManifest,
  IndicatorManifestEntry,
  IndicatorRuntimeInfo,
  IndicatorSessionOutputs,
} from "@fxtoolkit/indicator-stdlib/abi";

export const goldenDirectory = resolve(process.cwd(), "fixtures/golden");
export const fixtureBuildDirectory = resolve(process.cwd(), "fixtures/build");

export const MODULES = [
  "htf-confluence",
  "lumina-trend-channels",
  "qmra-indicator",
  "reverse-logic-scalper",
] as const;

/**
 * Oracle captured from orion's runtime (see TASKS.md M1): the outputs of feeding
 * `bar-batch.json` through each golden binary's `onBars`.
 */
export interface ExpectedHistory {
  barCount: number;
  enabled: boolean;
  instanceId: string;
  module: string;
  outputs: IndicatorSessionOutputs;
  params: Record<string, unknown>;
  runtimeInfo: IndicatorRuntimeInfo;
  savedState: string;
}

export async function readExpectedHistory(
  module: string,
): Promise<ExpectedHistory> {
  return JSON.parse(
    await readFile(
      resolve(goldenDirectory, "expected-history", `${module}.json`),
      "utf8",
    ),
  ) as ExpectedHistory;
}

/** The 300-bar batch the oracle was captured from. */
export async function readBarBatch(): Promise<ChartBar[]> {
  const payload = JSON.parse(
    await readFile(resolve(goldenDirectory, "bar-batch.json"), "utf8"),
  ) as { data: { ticks: ChartBar[] } };

  return payload.data.ticks;
}

/**
 * Mirrors orion `scripts/build-indicators.mjs#createDescriptorImports` so a module can be
 * instantiated far enough to be asked for its descriptor.
 */
export function createStubImports() {
  const orion: Record<string, (...args: never[]) => unknown> = {
    beginBar: () => undefined,
    bgcolor: () => undefined,
    plot: () => undefined,
    fill: () => undefined,
    plotshape: () => undefined,
    line: () => undefined,
    linefill: () => undefined,
    ray: () => undefined,
    box: () => undefined,
    polyline: () => undefined,
    label: () => undefined,
    table: () => undefined,
    panel: () => undefined,
    candle: () => undefined,
    signal: () => undefined,
    alert: () => undefined,
    inputBool: (_keyPtr, defaultValue) => defaultValue,
    inputInt: (_keyPtr, defaultValue) => defaultValue,
    inputNumber: (_keyPtr, defaultValue) => defaultValue,
    inputString: (_keyPtr, defaultPtr) => defaultPtr,
    runtimePipSize: () => 0.01,
    runtimeSymbol: () => 0,
    runtimeTimeframeMs: () => 0,
  };

  return {
    env: {
      abort: () => {
        throw new Error("Indicator module aborted while reading descriptor");
      },
    },
    orion,
  } as unknown as Record<string, Record<string, unknown>>;
}

export function wasmFilename(entry: IndicatorManifestEntry) {
  const filename = entry.wasmUrl.split("/").at(-1);
  if (!filename) {
    throw new Error(`Manifest entry for "${entry.module}" has no wasm filename`);
  }

  return filename;
}

export async function readGoldenManifest(): Promise<IndicatorManifest> {
  return JSON.parse(
    await readFile(resolve(goldenDirectory, "manifest.json"), "utf8"),
  ) as IndicatorManifest;
}

/** Bytes of the Orion-built binary a manifest entry points at. */
export async function readGoldenBytes(
  entry: IndicatorManifestEntry,
): Promise<Uint8Array> {
  return readFile(resolve(goldenDirectory, wasmFilename(entry)));
}

/** Instantiates a module with stub host imports and returns its parsed `describe()` descriptor. */
export async function readDescriptor(bytes: Uint8Array): Promise<unknown> {
  const runtime = await instantiate(bytes, createStubImports());
  const exports = runtime.exports as Record<string, unknown>;
  const describe = exports.describe as (() => number) | undefined;
  const getString = exports.__getString as ((pointer: number) => string) | undefined;

  if (!describe || !getString) {
    throw new Error("Module does not expose describe()/__getString");
  }

  return JSON.parse(getString(describe()));
}

/** Sorted `namespace.name` pairs every module imports. */
export async function readImportedNames(bytes: Uint8Array): Promise<string[]> {
  const compiled = await WebAssembly.compile(bytes);
  return WebAssembly.Module.imports(compiled)
    .map((entry) => `${entry.module}.${entry.name}`)
    .sort();
}

/** Sorted names every module exports. */
export async function readExportedNames(bytes: Uint8Array): Promise<string[]> {
  const compiled = await WebAssembly.compile(bytes);
  return WebAssembly.Module.exports(compiled)
    .map((entry) => entry.name)
    .sort();
}

export async function readFixtureModules(): Promise<Map<string, Uint8Array>> {
  const filenames = (await readdir(fixtureBuildDirectory))
    .filter((filename) => filename.endsWith(".wasm"))
    .sort();

  return new Map(
    await Promise.all(
      filenames.map(
        async (filename) =>
          [
            filename.replace(/\.wasm$/, ""),
            await readFile(resolve(fixtureBuildDirectory, filename)),
          ] as const,
      ),
    ),
  );
}
