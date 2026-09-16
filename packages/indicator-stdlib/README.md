# @fxtoolkit/indicator-stdlib

AssemblyScript standard library for FX Toolkit indicators, plus a Node-side compiler that turns an
indicator script into WebAssembly — entirely in memory.

```
./abi        types + the ABI constants (no dependencies, safe in browsers)
./compiler   the in-memory compiler (Node only)
.            the AssemblyScript standard library itself, resolved by `asc` via `ascMain`
```

## Writing an indicator

```ts
import {
  Bar,
  IndicatorContext,
  IndicatorDescriptor,
  InputField,
  buildBar,
  beginBatchBar,
  createIndicatorContext,
  describeIndicator,
  inputInt,
} from "@fxtoolkit/indicator-stdlib";

const descriptor = new IndicatorDescriptor(
  "my-indicator",
  "My Indicator",
  "1.0.0",
  "Does a thing.",
  [new InputField("length", "Length", "integer", "14", "", 2, 200, 1)],
  ["plot"],
);

export function describe(): string { return describeIndicator(descriptor); }
export function init(): void { /* read inputs */ }
export function reset(): void {}
export function saveState(): string { return ""; }
export function loadState(state: string): void {}
export const FLOAT64_ARRAY_ID: i32 = idof<Float64Array>();
export function onBars(...) { /* ... */ }
export function onBar(...) { /* ... */ }
```

The full host contract — the 23 importable host functions, the required exports, and the output
shapes — is documented in [`ABI.md`](./ABI.md). That document is the specification; the compiler and
the runner both enforce it.

## Compiling

```ts
import { compileScript } from "@fxtoolkit/indicator-stdlib/compiler";

const result = await compileScript(source, { module: "my-indicator" });

if (!result.ok) {
  for (const diagnostic of result.diagnostics) {
    console.error(`${diagnostic.level} ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
  }
}
// result.wasm, result.descriptor
```

Nothing touches the filesystem: the script and the packaged standard library are the entire input
space. **A script can only import `@fxtoolkit/indicator-stdlib`** — any other import fails to resolve,
which is also the security boundary.

For scripts you do not trust, use `compileScriptIsolated`, which compiles on a worker thread and
terminates it on a deadline:

```ts
import { compileScriptIsolated } from "@fxtoolkit/indicator-stdlib/compiler";

const result = await compileScriptIsolated(source, { module: "untrusted", timeoutMs: 5000 });
```

`compileScriptIsolated` spawns a worker from the package's built output, so it must be installed from
a tarball or a build — it cannot run from source.

## Installing

```json
{
  "dependencies": {
    "@fxtoolkit/indicator-stdlib": "https://github.com/YOU/fxtoolkit-indicators/releases/download/v0.1.0/fxtoolkit-indicator-stdlib-0.1.0.tgz"
  }
}
```

`assemblyscript` is an **optional peer dependency** — install it where you compile:

```bash
npm install --save-dev assemblyscript
```

Consumers that only need `./abi` (types and constants) pull nothing heavy.
