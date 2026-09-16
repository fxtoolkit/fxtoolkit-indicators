/**
 * Shared WASM <-> host ABI contract for FX Toolkit indicators.
 *
 * Types only (plus the ABI metadata constants). Nothing here has a runtime
 * dependency, so importing this module never pulls a compiler or a loader.
 *
 * Ported in milestone M1 from orion:
 *   src/library/models/chart/types.ts                              -> ./chart
 *   src/library/models/chart/indicators/indicator-engine-types.ts  -> ./engine
 *   src/library/models/chart/indicators/indicator-runtime-types.ts -> ./manifest
 *   src/library/models/chart/workers/indicator-runtime.ts          -> ./runtime
 *
 * Changing any constant in this file requires bumping `ABI_VERSION` and
 * regenerating the golden fixtures. See ABI.md.
 */

/**
 * Version of the host import surface plus module export surface a compiled
 * indicator targets. Mirrors orion `INDICATOR_ABI_VERSION`.
 */
export const ABI_VERSION = 4;

/**
 * Exports the runner requires on an instantiated module before it will run it.
 * Ported from orion `IndicatorSession.assertRuntimeExports`.
 *
 * `FLOAT64_ARRAY_ID` and the loader's `__newArray` are additionally used by the
 * history-batch path but are not asserted here, matching orion's behavior.
 */
export const RUNNER_REQUIRED_EXPORTS = [
  "__collect",
  "__getString",
  "__newString",
  "__pin",
  "__unpin",
  "describe",
  "init",
  "loadState",
  "onBar",
  "reset",
  "saveState",
] as const;

/**
 * Exports the compiler additionally requires when validating a freshly built
 * module. Ported from orion `scripts/build-indicators.mjs#assertRequiredExports`.
 */
export const COMPILER_ADDITIONAL_EXPORTS = ["onBars"] as const;

/** Host imports the runner must provide under the `env` namespace. */
export const HOST_ENV_IMPORTS = ["abort"] as const;

/** Host imports the runner must provide under the `orion` namespace. */
export const HOST_ORION_IMPORTS = [
  "beginBar",
  "bgcolor",
  "plot",
  "fill",
  "plotshape",
  "line",
  "linefill",
  "ray",
  "box",
  "polyline",
  "label",
  "panel",
  "table",
  "candle",
  "signal",
  "alert",
  "inputBool",
  "inputInt",
  "inputNumber",
  "inputString",
  "runtimePipSize",
  "runtimeSymbol",
  "runtimeTimeframeMs",
] as const;

/**
 * Record/field separators used by the `orion.table` host import payload.
 * Ported from orion `indicator-runtime.ts`.
 */
export const TABLE_RECORD_SEPARATOR = "\u001e";
export const TABLE_FIELD_SEPARATOR = "\u001f";

export type * from "./chart";
export type * from "./engine";
export type * from "./manifest";
export type * from "./runtime";
