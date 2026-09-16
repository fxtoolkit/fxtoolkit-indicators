/**
 * Host-facing mounting API for an indicator surface.
 *
 * Takes either a canvas the host already owns or a container to create one inside, and owns the
 * render loop: device-pixel sizing, resize observation, and coalesced frames.
 *
 * This is the composition point for the pieces built earlier — `createChartFrame` (the projection),
 * `createIndicatorRenderer` (the backend), and `RenderScheduler` (frame coalescing).
 */

import type {
  ChartBar,
  IndicatorRenderBundle,
} from "@fxtoolkit/indicator-stdlib/abi";
import { createChartFrame, type PriceScaleMode } from "../model/frame";
import type {
  ChartPriceRange,
  ChartRenderFrame,
  ChartRenderPerformanceSnapshot,
  TimeAxis,
} from "../model/types";
import {
  createViewport,
  type IndicatorViewport,
} from "../model/viewport";
import {
  createIndicatorRenderer,
  type IndicatorRendererBackend,
  type IndicatorRendererPreference,
} from "../render/create-renderer";
import RenderScheduler from "./render-scheduler";
import {
  defaultFrameScheduler,
  type FrameScheduler,
  type RenderReason,
} from "./render-scheduler";

/**
 * Environment context injected into the compiled indicator and used for the price scale.
 *
 * Every field is optional: omitted values fall back to what can be inferred from the bars (symbol
 * from `bar.meta.symbol`, interval from the smallest bar gap, pip size from the symbol). Supply them
 * when the host already knows its instrument — inference is a convenience, not a substitute.
 */
export interface IndicatorEnvironmentOptions {
  pipSize?: number;
  symbol?: string;
  timeframeMs?: number;
}

/**
 * How the host draws: the box it draws in, its time axis, and optionally its price domain.
 *
 * Supplied by a host that owns its own viewport and price scale (a charting library, say) so the
 * overlay lands exactly on top of whatever it draws. All three have to agree with that renderer —
 * getting the time axis right but leaving the price domain automatic still misaligns the output,
 * because the two scales are fitted independently.
 */
export interface IndicatorProjection {
  /** Plot box in CSS pixels, in the coordinate space this surface draws in. */
  plotHeight: number;
  plotWidth: number;
  /**
   * The host's own price domain. When set, it replaces the automatic one, so the surface draws to
   * the same scale as the host's price axis.
   */
  priceRange?: ChartPriceRange | null;
  /** Timestamps to x, in the same plot box. */
  timeAxis: TimeAxis;
}

export interface IndicatorSurfaceOptions extends IndicatorEnvironmentOptions {
  /**
   * Supplies the projection each render, for a host that owns its own viewport and price scale.
   *
   * Called on every render, so it can read live state from whatever draws the candles. Return `null`
   * to fall back to the built-in `viewport` model and an automatic price domain.
   */
  getProjection?: () => IndicatorProjection | null;
  /** Render backend. Defaults to `"auto"` (WebGL, falling back to Canvas2D). */
  prefer?: IndicatorRendererPreference;
  /** Overrides device-pixel-ratio detection. */
  pixelRatio?: number;
  /** Frame scheduler. Defaults to requestAnimationFrame with a timer fallback. */
  scheduler?: FrameScheduler;
  priceScaleMode?: PriceScaleMode;
  /** Initial viewport. Defaults to the last 200 bars. */
  viewport?: Partial<IndicatorViewport>;
}

export interface IndicatorSurface {
  destroy(): void;
  getBackend(): IndicatorRendererBackend;
  getCanvas(): HTMLCanvasElement;
  /** The current projection; useful for host-side overlays and hit testing. */
  getFrame(): ChartRenderFrame | null;
  getPerformanceSnapshot(): ChartRenderPerformanceSnapshot;
  /** Requests a coalesced render. */
  requestRender(reason?: RenderReason): void;
  /** Forces an immediate render, bypassing scheduling. */
  renderNow(): void;
  setBars(bars: readonly ChartBar[], dataRevision?: number): void;
  setBundles(bundles: IndicatorRenderBundle[]): void;
  setViewport(viewport: Partial<IndicatorViewport>): void;
}

const DEFAULT_BAR_COUNT = 200;
const CREATED_CANVAS_CLASS = "fxtoolkit-indicator-surface";

export function mountIndicatorSurface(
  target: HTMLCanvasElement | HTMLElement,
  options: IndicatorSurfaceOptions = {},
): IndicatorSurface {
  const { canvas, container, ownsCanvas } = resolveCanvas(target);
  const { backend, renderer } = createIndicatorRenderer({
    canvas,
    // A host that supplies a projection owns the box the overlay must fill, so the canvas backing
    // store follows it rather than the canvas' own client box — otherwise the drawing is scaled into
    // a box the host is not using.
    getSize:
      options.getProjection === undefined
        ? undefined
        : () => {
            const projection = options.getProjection?.() ?? null;

            return projection
              ? { height: projection.plotHeight, width: projection.plotWidth }
              : { height: canvas.clientHeight || canvas.height, width: canvas.clientWidth || canvas.width };
          },
    pixelRatio: options.pixelRatio,
    prefer: options.prefer,
  });

  let bars: readonly ChartBar[] = [];
  let dataRevision = 0;
  let bundles: IndicatorRenderBundle[] = [];
  let viewport = createViewport(
    options.viewport?.barCount ?? DEFAULT_BAR_COUNT,
    options.viewport?.offsetBars ?? 0,
  );
  let currentFrame: ChartRenderFrame | null = null;
  let destroyed = false;

  const scheduler = new RenderScheduler(
    () => render(),
    options.scheduler ?? defaultFrameScheduler,
  );

  const observer = observeSize(container ?? canvas, () => {
    scheduler.request("resize");
  });

  renderer.setBundles(bundles);

  function baseFrameOptions(projection: IndicatorProjection | null) {
    return {
      bars,
      dataRevision,
      freePriceRange: projection?.priceRange ?? undefined,
      pipSize: options.pipSize,
      plotHeight:
        projection?.plotHeight ?? (canvas.clientHeight || canvas.height),
      plotWidth: projection?.plotWidth ?? (canvas.clientWidth || canvas.width),
      priceScaleMode: projection?.priceRange ? "free" : options.priceScaleMode,
      symbol: options.symbol,
      timeAxis: projection?.timeAxis,
      timeFrameMs: options.timeframeMs,
      viewport,
    };
  }

  function render() {
    if (destroyed) {
      return;
    }

    const projection = options.getProjection?.() ?? null;

    // A host-supplied price domain is authoritative: its scale already covers whatever the host
    // draws, and a free range wins over extents anyway, so there is nothing to fold in.
    if (projection?.priceRange) {
      currentFrame = createChartFrame(baseFrameOptions(projection));
      renderer.render(currentFrame);

      return;
    }

    // Two passes. An indicator can plot well outside the bar range, and clipping it would make the
    // drawing silently wrong, so its own price range has to be folded into the domain.
    //
    // Extents depend only on the viewport (visible time range and plot size), never on the price
    // domain, so a provisional frame is enough to resolve them — and the adapter's extents cache is
    // keyed on the viewport, so the second pass reuses it rather than recomputing.
    const provisional = createChartFrame(baseFrameOptions(projection));
    const extents = renderer.getVisiblePriceExtents(provisional);

    currentFrame = extents
      ? createChartFrame({
          ...baseFrameOptions(projection),
          additionalPriceValues: [extents.low, extents.high],
        })
      : provisional;

    renderer.render(currentFrame);
  }

  // First paint.
  render();

  return {
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      observer?.disconnect();
      scheduler.destroy();
      renderer.destroy();
      currentFrame = null;
      bars = [];
      bundles = [];

      if (ownsCanvas) {
        canvas.remove();
      }
    },

    getBackend() {
      return backend;
    },

    getCanvas() {
      return canvas;
    },

    getFrame() {
      return currentFrame;
    },

    getPerformanceSnapshot() {
      return renderer.getPerformanceSnapshot();
    },

    requestRender(reason) {
      scheduler.request(reason);
    },

    renderNow() {
      render();
    },

    setBars(nextBars, nextRevision) {
      bars = nextBars;
      dataRevision = nextRevision ?? dataRevision + 1;
      scheduler.request("data");
    },

    setBundles(nextBundles) {
      bundles = nextBundles;
      renderer.setBundles(nextBundles);
      scheduler.request("state");
    },

    setViewport(nextViewport) {
      viewport = createViewport(
        nextViewport.barCount ?? viewport.barCount,
        nextViewport.offsetBars ?? viewport.offsetBars,
      );
      scheduler.request("viewport");
    },
  };
}

function resolveCanvas(target: HTMLCanvasElement | HTMLElement) {
  if (isCanvasElement(target)) {
    return { canvas: target, container: null, ownsCanvas: false };
  }

  const canvas = document.createElement("canvas");
  canvas.className = CREATED_CANVAS_CLASS;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    display: "block",
    height: "100%",
    left: "0",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    width: "100%",
  });

  // The container must establish a positioning context for the absolute canvas to cover it.
  const position = getComputedStyle(target).position;

  if (position === "static" || !position) {
    target.style.position = "relative";
  }

  target.appendChild(canvas);

  return { canvas, container: target, ownsCanvas: true };
}

function isCanvasElement(target: HTMLCanvasElement | HTMLElement): target is HTMLCanvasElement {
  return (
    typeof HTMLCanvasElement !== "undefined" && target instanceof HTMLCanvasElement
  );
}

/** Observes element size, returning null where ResizeObserver is unavailable. */
function observeSize(element: Element, onResize: () => void) {
  if (typeof ResizeObserver === "undefined") {
    return null;
  }

  const observer = new ResizeObserver(() => onResize());
  observer.observe(element);

  return observer;
}
