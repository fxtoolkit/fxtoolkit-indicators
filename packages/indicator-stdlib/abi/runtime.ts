/**
 * WASM module export surface and per-bar session output types.
 *
 * Ported from orion `src/library/models/chart/workers/indicator-runtime.ts`.
 */

import type {
  IndicatorAlert,
  IndicatorFill,
  IndicatorObject,
  IndicatorSeriesKind,
  IndicatorSignal,
} from "./chart";
import type { IndicatorManifestEntry } from "./manifest";

/**
 * Custom exports every compiled indicator module provides.
 *
 * On an instantiated module these sit alongside the `@assemblyscript/loader`
 * runtime utilities (`__collect`, `__getString`, `__newString`, `__pin`,
 * `__unpin`, `__newArray`), which are emitted by the compiler's `--exportRuntime`
 * flag. The runner composes this interface with the loader's own utility type.
 */
export interface IndicatorWasmExports {
  [key: string]: unknown;
  FLOAT64_ARRAY_ID: number;
  describe(): number;
  destroy?(): void;
  init(): void;
  loadState(statePtr: number): void;
  onBar(
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    spread: number,
    index: number,
    isRealtime: number,
    isConfirmed: number,
    isLastBar: number,
    isFirst: number,
    isHistory: number,
    isNew: number,
  ): void;
  onBars(
    timesPtr: number,
    opensPtr: number,
    highsPtr: number,
    lowsPtr: number,
    closesPtr: number,
    volumesPtr: number,
    spreadsPtr: number,
  ): void;
  reset(): void;
  saveState(): number;
}

/** Compiled module bytes plus the manifest entry that describes them. */
export interface IndicatorModuleRecord {
  bytes: ArrayBuffer;
  entry: IndicatorManifestEntry;
}

export interface IndicatorRuntimeInfo {
  pipSize: number;
  symbol: string;
  timeframeMs: number;
}

export interface IndicatorBarState {
  index: number;
  isConfirmed: boolean;
  isFirst: boolean;
  isHistory: boolean;
  isLastBar: boolean;
  isNew: boolean;
  isRealtime: boolean;
}

export interface IndicatorSeriesPointOutput {
  baseStyle: Record<string, unknown>;
  committed: boolean;
  indicatorId: string;
  kind: IndicatorSeriesKind;
  revision: number;
  seriesId: string;
  style: Record<string, unknown>;
  text: string | null;
  time: number;
  value: number;
}

/** Everything a single `onBar` / `onBars` call emits. */
export interface IndicatorSessionOutputs {
  alerts: IndicatorAlert[];
  fills: IndicatorFill[];
  objects: IndicatorObject[];
  seriesPoints: IndicatorSeriesPointOutput[];
  signals: IndicatorSignal[];
}
