# fxtoolkit-indicators

WebAssembly indicator tooling for FX Toolkit hosts, shipped as two packages:

| Package | Purpose |
| --- | --- |
| `@fxtoolkit/indicator-stdlib` | The AssemblyScript indicator standard library (helpers + utils imported by indicator scripts) **and** the Node-side compiler that turns a script into WASM + a descriptor, entirely in memory. |
| `@fxtoolkit/indicator-runner` | Takes compiled WASM plus environment context, injects host bindings, runs the indicator, and draws its output to a canvas you supply (or a container we mount our own canvas into). |

The runtime behaviour is a **port of the Orion Charts indicator pipeline** (`../orion`), which remains
the authoritative reference until the parity harness proves these packages match it. Every ported file
carries a header comment naming its Orion origin.

## Installing (GitHub release tarballs)

There is no registry publish yet. Build tarballs and attach them to a GitHub release:

```bash
npm run release      # builds both packages, writes release/*.tgz
```

Then consume them by URL. **Install both** — the runner peer-depends on the stdlib:

```json
{
  "dependencies": {
    "@fxtoolkit/indicator-stdlib": "https://github.com/YOU/fxtoolkit-indicators/releases/download/v0.1.0/fxtoolkit-indicator-stdlib-0.1.0.tgz",
    "@fxtoolkit/indicator-runner": "https://github.com/YOU/fxtoolkit-indicators/releases/download/v0.1.0/fxtoolkit-indicator-runner-0.1.0.tgz"
  }
}
```

Because tarball URLs pin an exact build, there are no version ranges to resolve — upgrade both
together. Install `assemblyscript` where you compile scripts:

```bash
npm install --save-dev assemblyscript
```

## Using it

```ts
import { compileScript } from "@fxtoolkit/indicator-stdlib/compiler";
import { IndicatorEngine, mountIndicatorSurface } from "@fxtoolkit/indicator-runner";

// Node, at build time: source -> wasm + descriptor.
const compiled = await compileScript(scriptSource, { module: "my-indicator" });

// Browser, at run time: wasm -> plots on a canvas.
const engine = new IndicatorEngine({ createWorker, manifestUrl: "/indicators/manifest.json" });
await engine.init();
await engine.loadIndicator({ module: "my-indicator" });
const history = await engine.replaceHistoryBars(bars);

const surface = mountIndicatorSurface(document.querySelector("#chart")!, { symbol: "ETHUSD" });
surface.setBars(bars);
surface.setBundles(history.bundles);
```

See each package's README for the full API, and
[`packages/indicator-stdlib/ABI.md`](packages/indicator-stdlib/ABI.md) for the WASM ↔ host contract.

## Layout

```text
packages/indicator-stdlib/   # AssemblyScript stdlib + Node compiler + shared ABI types
packages/indicator-runner/   # WASM runtime, model, renderer, canvas mounting
fixtures/indicators/         # ported indicator sources used to validate the toolchain
fixtures/golden/             # Orion's compiled WASM + manifest + captured parity oracle
examples/demo/               # browser app for manual visual validation
```

## Working in this repo

```bash
npm install
npm run build          # build every workspace (tsup / vite)
npm run typecheck      # tsc --noEmit for every workspace
npm test               # fixtures + stdlib build + vitest, then the consumer smoke test
npm run release        # release/*.tgz
npm run dev -w @fxtoolkit/example-indicator-demo
```

## ABI

The WASM ↔ host boundary (import namespace `orion`, the 23 host functions, required exports, output
shapes, `ABI_VERSION`) is documented in
[`packages/indicator-stdlib/ABI.md`](packages/indicator-stdlib/ABI.md). Changing it requires bumping
`ABI_VERSION` and regenerating the golden fixtures.

## Status

All milestones (M0–M10) are complete. `npm test` runs the parity harness against Orion and writes
`parity-report/report.md` — currently **16/16 behavioural scenarios** and **4/4 render backends**
matching. See [`TASKS.md`](TASKS.md) for the milestone log.

The remaining work is the **swap itself**: deleting Orion's indicator runtime and renderer and
pointing Orion at these packages. That is deliberately out of scope for the port.
