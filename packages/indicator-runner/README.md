# @fxtoolkit/indicator-runner

Runs compiled WebAssembly indicators and draws their output to a canvas — either a canvas you own or
a container we create one inside.

```
.                  runtime, engine, renderer, mounting API
./engine/worker    the worker entry (import it from your bundler)
```

## Quick start

```ts
import { mountIndicatorSurface, IndicatorEngine } from "@fxtoolkit/indicator-runner";
import EngineWorker from "@fxtoolkit/indicator-runner/engine/worker?worker";

// 1. Run the indicator. The worker resolves modules from a manifest you serve.
const engine = new IndicatorEngine({
  createWorker: () => new EngineWorker(),
  manifestUrl: "/indicators/manifest.json",
});

await engine.init();
await engine.loadIndicator({ module: "lumina-trend-channels" });

const history = await engine.replaceHistoryBars(bars); // bars: { time, open, high, low, close, ... }[]

// 2. Draw it. Pass a container to have a canvas created, or a canvas you already own.
const surface = mountIndicatorSurface(document.querySelector("#chart")!, {
  symbol: "ETHUSD",
  timeframeMs: 24 * 60 * 60 * 1000,
  pipSize: 0.01,
  prefer: "auto", // WebGL, falling back to Canvas2D
});

surface.setBars(bars);
surface.setBundles(history.bundles);

// Later, as bars arrive:
//   await engine.updateRealtimeBar(nextBar)   -> apply deltas
//   surface.setBars(bars, revision)
```

`mountIndicatorSurface` owns device-pixel sizing, a `ResizeObserver`, frame coalescing, and teardown.
`destroy()` removes the canvas **only if it created it**.

## Environment context

`symbol`, `timeframeMs` and `pipSize` are injected into the indicator and drive the price scale. All
are optional: omit them and they are inferred from the bars (symbol from `bar.meta.symbol`, interval
from the smallest bar gap, pip size from the symbol). Supply them when you already know your
instrument — inference is a convenience, not a substitute.

## Using your own viewport and price scale

If something else draws the candles and owns the viewport — TradingView Charting Library, for
instance — the built-in `viewport` model cannot express its transform, and the overlay will not line
up with the candles. Supply the projection instead:

```ts
const surface = mountIndicatorSurface(container, {
  getProjection: () => ({
    // 1. The box you draw in. The overlay canvas is sized to this, so its pixels are your pixels.
    plotWidth: paneWidth,
    plotHeight: paneHeight,
    // 2. Your time transform.
    timeAxis: {
      pixelsPerBar: chartApi.getTimeScale().barSpacing(),
      toX: (time) => /* your projection */,
      toTime: (x) => /* its inverse */,
      visibleTimeRange: { from, to },   // ms
    },
    // 3. Your price domain. Omit it and the surface fits its own, which will not match your axis.
    priceRange: { from: visiblePriceFrom, to: visiblePriceTo },
  }),
});
```

`getProjection` is called on every render, so it can read live state. Return `null` to fall back to
the built-in model and an automatic price domain.

**All three parts have to agree with your renderer.** Supplying only the time axis is the classic
mistake: the x positions line up, but the output sits at the wrong height, because our automatic
price domain is fitted to our idea of the visible bars and yours is fitted to yours. Supplying
`priceRange` also disables the automatic extents pass — with an explicit domain there is nothing to
fold in, and your scale is authoritative.

Two consequences of supplying `timeAxis`:

- **Your `visibleTimeRange` decides which bars are visible**, so the automatic price domain fits your
  window rather than ours.
- **Your `toX`/`toTime` are used verbatim.** TradingView's transform is
  `x = width - (rightOffset + barsFromRight(time) + 1) * barSpacing`, where `barsFromRight` counts bar
  indexes back from the newest bar. Note that its `xToTime` is *not* the inverse of its `timeToX` —
  the first returns a bar's left edge, the second treats x as a slot centre — so a round trip lands
  one bar back. Port both verbatim and the overlay keeps matching the candles.

## Rendering backends

`prefer` accepts `"auto"` (default), `"webgl"` or `"canvas"`. You can also construct a backend
directly with `createIndicatorRenderer({ canvas, prefer })`, which returns `{ backend, renderer }` so
you can report which one you got. Both backends implement `IndicatorRenderer` and produce
identical geometry for the same bundle and frame.

## Main-thread execution

The worker is optional. If you would rather avoid one, drive the runtime directly:

```ts
import { createStaticModuleSource, IndicatorRuntime } from "@fxtoolkit/indicator-runner";

const runtime = new IndicatorRuntime(
  createStaticModuleSource({ manifest, bytes }), // bytes: Map<module, Uint8Array>
);

const indicator = await runtime.resolveIndicator({ module: "my-indicator" });
const session = await runtime.createSession(indicator, { symbol: "ETHUSD", timeframeMs, pipSize });
const outputs = session.processHistoryBars(bars);
```

## Installing

```json
{
  "dependencies": {
    "@fxtoolkit/indicator-stdlib": "https://github.com/YOU/fxtoolkit-indicators/releases/download/v0.2.0/fxtoolkit-indicator-stdlib-0.2.0.tgz",
    "@fxtoolkit/indicator-runner": "https://github.com/YOU/fxtoolkit-indicators/releases/download/v0.2.0/fxtoolkit-indicator-runner-0.2.0.tgz"
  }
}
```

Install **both**: the runner peer-depends on the stdlib. Pinning exact tarball URLs means no version
ranges — check both together when you upgrade.
