# Indicator ABI

The contract between a compiled indicator WASM module and its host runtime.

**`ABI_VERSION = 4`** — exported from [`abi/index.ts`](./abi/index.ts). Any change to the names or
signatures below requires bumping that constant, updating this document, and regenerating the
golden fixtures in `../../fixtures/golden/`.

Ported from Orion Charts. Corrections against the original plan: the host surface is **23**
functions (not 27), and the runner asserts **11** exports while the compiler requires **12**.

## Module shape

A compiled indicator is a WebAssembly module produced by the AssemblyScript compiler with
`--exportRuntime`. It is instantiated with `@assemblyscript/loader`, which supplies the runtime
utilities (`__collect`, `__getString`, `__newString`, `__pin`, `__unpin`, `__newArray`).

### Required imports

| Namespace | Names |
| --- | --- |
| `env` | `abort` |
| `orion` | a subset of the 23 functions in the table below |

AssemblyScript dead-code-eliminates imports that are never called, so a given module imports only
the part of the `orion` surface it actually uses (the golden modules use between 10 and 13). The
contract is therefore one-directional and strict: **a module may import any subset of this surface,
and nothing outside it.** Both the compiler and the runner reject a module that imports anything
else.

This is the entire capability boundary. A module cannot reach the filesystem, the network, the DOM,
or any host API not listed here — and because WASM has no ambient authority, that holds regardless
of what the AssemblyScript source contains.

### Required exports

| Surface | Names | Asserted by |
| --- | --- | --- |
| Loader runtime | `__collect`, `__getString`, `__newString`, `__pin`, `__unpin` | runner |
| Indicator ABI | `describe`, `init`, `loadState`, `onBar`, `reset`, `saveState` | runner |
| Batch entry | `onBars` | compiler |
| Batch allocation | `FLOAT64_ARRAY_ID` (+ loader `__newArray`) | used, not asserted |
| Optional | `destroy` | — |

Constants: `RUNNER_REQUIRED_EXPORTS`, `COMPILER_ADDITIONAL_EXPORTS`.

### Export signatures

Pointers are `usize` in WASM, i.e. plain `number` on the host side. String arguments are pointers
into WASM memory, decoded with `__getString`. Strings returned to WASM are created with
`__newString`. Booleans cross as `i32` (`1`/`0`).

```ts
FLOAT64_ARRAY_ID: number
describe(): number                     // -> pointer to a JSON descriptor string
init(): void                           // pulls inputs from the host via inputBool/Int/Number/String
reset(): void
onBar(time, open, high, low, close, volume, spread: f64, index: i32,
      isRealtime, isConfirmed, isLastBar, isFirst, isHistory, isNew: i32): void
onBars(timesPtr, opensPtr, highsPtr, lowsPtr, closesPtr, volumesPtr, spreadsPtr: usize): void
saveState(): number                    // -> pointer to a state snapshot string
loadState(statePtr: number): void
destroy?(): void
```

## Host imports (`orion` namespace)

Every string argument arrives as a WASM pointer. `committed` and `dashed` are `i32` booleans.

| Function | Signature (host side) |
| --- | --- |
| `beginBar` | `() => void` — clears the per-bar object list |
| `plot` | `(seriesIdPtr, time, value, colorPtr, width, opacity, dashed, committed) => void` |
| `plotshape` | `(seriesIdPtr, time, value, shapePtr, colorPtr, size, offsetX, offsetY, committed, textPtr) => void` |
| `bgcolor` | `(seriesIdPtr, time, colorPtr, committed) => void` |
| `fill` | `(fillIdPtr, upperSeriesIdPtr, lowerSeriesIdPtr, colorPtr, opacity) => void` |
| `line` | `(objectIdPtr, time, endTime, price, endPrice, colorPtr, width, opacity, dashed, committed) => void` |
| `linefill` | `(objectIdPtr, pointsPtr, colorPtr, opacity, committed) => void` — `pointsPtr` is JSON |
| `ray` | `(objectIdPtr, time, price, colorPtr, width, opacity, dashed, committed) => void` |
| `box` | `(objectIdPtr, time, endTime, price, endPrice, colorPtr, backgroundColorPtr, width, opacity, dashed, committed) => void` |
| `polyline` | `(objectIdPtr, pointsPtr, colorPtr, width, opacity, dashed, committed) => void` — `pointsPtr` is JSON |
| `label` | `(objectIdPtr, time, price, textPtr, colorPtr, backgroundColorPtr, fontSize, offsetX, offsetY, committed) => void` |
| `panel` | `(objectIdPtr, anchorPtr, titlePtr, textPtr, colorPtr, backgroundColorPtr, accentColorPtr, fontSize, committed) => void` |
| `table` | `(objectIdPtr, anchorPtr, titlePtr, textPtr, colorPtr, backgroundColorPtr, columns, rows, committed) => void` — `textPtr` uses the delimited format below |
| `candle` | `(objectIdPtr, time, open, high, low, close, colorPtr, wickColorPtr, borderColorPtr, committed, modePtr) => void` |
| `signal` | `(signalIdPtr, sidePtr, time, price, stopLoss, takeProfit, messagePtr, committed, payloadPtr) => void` |
| `alert` | `(alertIdPtr, titlePtr, messagePtr, time, price, committed, payloadPtr) => void` |
| `inputBool` | `(keyPtr, defaultValue: i32) => i32` |
| `inputInt` | `(keyPtr, defaultValue: i32) => i32` |
| `inputNumber` | `(keyPtr, defaultValue: f64) => f64` |
| `inputString` | `(keyPtr, defaultPtr) => usize` — returns a pointer to a newly allocated string |
| `runtimePipSize` | `() => f64` |
| `runtimeSymbol` | `() => usize` — pointer to a string |
| `runtimeTimeframeMs` | `() => f64` |

`signal`/`alert` `payloadPtr`, and `linefill`/`polyline` `pointsPtr`, carry JSON. The `table`
payload uses `TABLE_RECORD_SEPARATOR` (`\u001e`) between records and `TABLE_FIELD_SEPARATOR`
(`\u001f`) between fields.

## Inputs

There is no `getOptions`/`setOptions` step. The host resolves the caller's params against the
descriptor's `InputField[]` (coercing booleans, rounding integers and clamping to `min`/`max`,
validating `select` membership, falling back to `defaultValue`) and then calls `init()`. Inside
`init()` the module pulls each value by key through the `input*` imports.

`runtimeSymbol`, `runtimeTimeframeMs`, and `runtimePipSize` are likewise pulled during `init()`.

## Per-call outputs

A single `onBar`/`onBars` call produces an `IndicatorSessionOutputs`:

| Bucket | Fed by |
| --- | --- |
| `seriesPoints` | `plot`, `plotshape`, `bgcolor` |
| `fills` | `fill` |
| `objects` | `line`, `linefill`, `ray`, `box`, `polyline`, `label`, `panel`, `table`, `candle` |
| `signals` | `signal` |
| `alerts` | `alert` |

`beginBar` (called per bar by the module, or once per history batch via the stdlib's
`beginBatchBar`) resets `objects`. Series points, fills, signals, and alerts accumulate. Non-finite
`time`/`value`/`price` are dropped by the host before entering a bucket.

`objects` entries carry `IndicatorObjectKind`; `seriesPoints` carry
`IndicatorSeriesKind` (`"plot" | "plotshape" | "bgcolor"`).

## State

`saveState()` returns an opaque, module-owned string snapshot; `loadState(ptr)` restores it. The
host pins the snapshot pointer so repeated live-bar updates do not reallocate. Semantics are owned
by the module — the ABI only guarantees the round trip.

## Bundle / delta transport

The worker → main-thread transport types (`IndicatorRenderBundle`,
`IndicatorBundleDelta`, `IndicatorSeriesDelta`, `IndicatorEngineRequest`,
`IndicatorEngineResponse`) live in [`abi/engine.ts`](./abi/engine.ts). The realtime path
transports series numbers as transferable `Float64Array`/`Uint8Array` rather than object arrays.

## Manifest

[`abi/manifest.ts`](./abi/manifest.ts) defines `IndicatorManifest` / `IndicatorManifestEntry`
(`{ abiVersion, module, descriptor, wasmUrl, sourceLanguage?, diagnostics?, generatedSourcePath? }`),
the format the compiler emits and the runner loads.

## Golden fixtures

`fixtures/golden/` holds Orion-built binaries and their captured outputs, so the runner can be
developed and validated against a known-good implementation:

| Artifact | Content |
| --- | --- |
| `manifest.json` | descriptors for all four modules |
| `<module>.wasm` | Orion-compiled binaries |
| `bar-batch.json` | the 300-bar ETHUSD daily batch (`{ data: { ticks } }`) |
| `expected-history/<module>.json` | outputs of `onBars` over that batch, plus `savedState` and resolved `params` |

`packages/indicator-runner/test/golden-abi.test.ts` asserts that every golden binary imports only
names from the documented surface, exports the required surface, and reports a descriptor equal to
its manifest entry.
