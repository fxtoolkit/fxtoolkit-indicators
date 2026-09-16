/**
 * Where the runner gets compiled indicator modules from.
 *
 * Orion hardcoded the manifest URL and fetched each entry's `wasmUrl`
 * (orion `src/library/models/chart/workers/indicator-runtime.ts`). The standalone runner is
 * host-agnostic instead: the host supplies a source. Two implementations ship here.
 */

import type {
  IndicatorManifest,
  IndicatorManifestEntry,
} from "@fxtoolkit/indicator-stdlib/abi";

export interface IndicatorModuleSource {
  /** Every module the runner may load. */
  getManifest(): Promise<IndicatorManifest>;
  /** Compiled WASM bytes for a manifest entry. */
  loadModuleBytes(entry: IndicatorManifestEntry): Promise<ArrayBuffer>;
}

/**
 * Orion's original behavior: fetch a manifest URL, then each entry's `wasmUrl`.
 * Both requests use `cache: "no-store"`, matching Orion.
 */
export function createUrlModuleSource(options: {
  manifestUrl: string;
  fetch?: typeof fetch;
  wasmUrlFor?: (entry: IndicatorManifestEntry) => string;
}): IndicatorModuleSource {
  const fetchImpl = options.fetch ?? fetch;
  const wasmUrlFor = options.wasmUrlFor ?? ((entry) => entry.wasmUrl);

  return {
    async getManifest() {
      const response = await fetchImpl(options.manifestUrl, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to load indicator manifest");
      }

      return (await response.json()) as IndicatorManifest;
    },

    async loadModuleBytes(entry) {
      const response = await fetchImpl(wasmUrlFor(entry), {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to load indicator binary for "${entry.module}"`);
      }

      return response.arrayBuffer();
    },
  };
}

/**
 * Modules already in memory, for hosts that hold compiled bytes (and for tests).
 * `bytes` is keyed by module id.
 */
export function createStaticModuleSource(options: {
  manifest: IndicatorManifest;
  bytes: Map<string, ArrayBuffer | Uint8Array> | Record<string, ArrayBuffer | Uint8Array>;
}): IndicatorModuleSource {
  // Normalize to a standalone ArrayBuffer, matching a fetch().arrayBuffer() result.
  const toArrayBuffer = (value: Uint8Array | ArrayBuffer): ArrayBuffer =>
    value instanceof Uint8Array
      ? (value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ) as ArrayBuffer)
      : value;

  const lookup = (module: string) => {
    const value =
      options.bytes instanceof Map
        ? options.bytes.get(module)
        : options.bytes[module];

    if (!value) {
      throw new Error(`Failed to load indicator binary for "${module}"`);
    }

    return toArrayBuffer(value);
  };

  return {
    async getManifest() {
      return options.manifest;
    },

    async loadModuleBytes(entry) {
      return lookup(entry.module);
    },
  };
}
