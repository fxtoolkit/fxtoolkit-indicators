import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountIndicatorSurface,
  type FrameScheduler,
  type IndicatorSurface,
} from "@fxtoolkit/indicator-runner";
import type { IndicatorRenderBundle } from "@fxtoolkit/indicator-stdlib/abi";
import { installCanvasContextStub } from "./support/fake-canvas";
import {
  createGoldenEngineHarness,
  findBundle,
  type GoldenEngineHarness,
} from "./support/golden-engine";
import { MODULES } from "./support/indicator-fixtures";

const CSS_WIDTH = 640;
const CSS_HEIGHT = 360;

/** Captures scheduled frames so tests decide when a render happens. */
function createManualScheduler() {
  const pending: Array<() => void> = [];

  const scheduler: FrameScheduler = {
    cancel: () => {
      pending.length = 0;
    },
    request: (callback) => {
      pending.push(() => callback(0));
      return pending.length;
    },
  };

  return {
    flush() {
      const callbacks = pending.splice(0, pending.length);
      for (const callback of callbacks) {
        callback();
      }
    },
    pendingCount: () => pending.length,
    scheduler,
  };
}

class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    RecordingResizeObserver.instances.push(this);
  }

  disconnect() {
    this.disconnected = true;
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  trigger() {
    this.callback();
  }
}

/** A minimal single-series bundle, for exercising the surface without the worker. */
function plotBundle(
  points: Array<{ time: number; value: number }>,
): IndicatorRenderBundle {
  return {
    alerts: [],
    descriptor: {
      inputs: [],
      module: "surface-test",
      outputKinds: ["plot"],
      title: "Surface test",
      version: "1.0.0",
    },
    fills: [],
    id: "surface-test",
    module: "surface-test",
    objects: [],
    series: [
      {
        id: "surface-test-line",
        indicatorId: "surface-test",
        kind: "plot",
        points: points.map((point) => ({
          committed: true,
          revision: 0,
          style: { color: "#00e676" },
          text: null,
          time: point.time,
          value: point.value,
        })),
        style: { color: "#00e676", dashed: false, opacity: 1, width: 2 },
      },
    ],
    signals: [],
  };
}

function setClientSize(element: HTMLElement) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: CSS_WIDTH,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: CSS_HEIGHT,
  });
}

let harness: GoldenEngineHarness;
let restoreCanvasContext: () => void;

beforeAll(async () => {
  restoreCanvasContext = installCanvasContextStub();
  harness = await createGoldenEngineHarness(MODULES);
});

afterEach(() => {
  vi.unstubAllGlobals();
  RecordingResizeObserver.instances = [];
});

describe("mountIndicatorSurface", () => {
  let surfaces: IndicatorSurface[] = [];

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    surfaces = [];
  });

  afterEach(() => {
    for (const surface of surfaces) {
      surface.destroy();
    }
  });

  function mountInContainer(options = {}) {
    const container = document.createElement("div");
    setClientSize(container);
    document.body.appendChild(container);

    const manual = createManualScheduler();
    const surface = mountIndicatorSurface(container, {
      ...options,
      prefer: "canvas",
      scheduler: manual.scheduler,
    });
    surfaces.push(surface);

    return { container, manual, surface };
  }

  function mountOnCanvas(options = {}) {
    const canvas = document.createElement("canvas");
    setClientSize(canvas);
    document.body.appendChild(canvas);

    const manual = createManualScheduler();
    const surface = mountIndicatorSurface(canvas, {
      ...options,
      pixelRatio: 2,
      prefer: "canvas",
      scheduler: manual.scheduler,
    });
    surfaces.push(surface);

    return { canvas, manual, surface };
  }

  it("creates a canvas inside a container and makes the container a positioning context", () => {
    const { container, surface } = mountInContainer();
    const canvas = surface.getCanvas();

    expect(canvas.parentElement).toBe(container);
    expect(container.style.position).toBe("relative");
    expect(surface.getBackend()).toBe("canvas");
  });

  it("uses a supplied canvas without creating another one", () => {
    const { canvas, surface } = mountOnCanvas();

    expect(surface.getCanvas()).toBe(canvas);
    expect(canvas.parentElement).toBe(document.body);
    // No child canvas was appended anywhere.
    expect(document.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("observes the container for resizes and renders on demand", () => {
    const { container, manual } = mountInContainer();
    const observer = RecordingResizeObserver.instances[0];

    expect(observer.observed).toEqual([container]);

    observer.trigger();
    expect(manual.pendingCount()).toBe(1);

    manual.flush();
    expect(manual.pendingCount()).toBe(0);
  });

  it("sizes the backing store in device pixels", () => {
    const { surface } = mountOnCanvas();
    const canvas = surface.getCanvas();

    expect(canvas.width).toBe(CSS_WIDTH * 2);
    expect(canvas.height).toBe(CSS_HEIGHT * 2);
  });

  it("honours a host-supplied environment context", () => {
    const { surface } = mountOnCanvas({
      pipSize: 0.25,
      symbol: "EURUSD",
      timeframeMs: 15 * 60 * 1000,
    });

    const frame = surface.getFrame()!;

    expect(frame.timeFrameMs).toBe(15 * 60 * 1000);
    expect(frame.pipSize).toBe(0.25);
  });

  it("derives the environment context from the bars when not supplied", () => {
    const { manual, surface } = mountOnCanvas();

    surface.setBars(harness.bars);
    manual.flush();

    const frame = surface.getFrame()!;
    // The golden batch is daily ETHUSD data.
    expect(frame.timeFrameMs).toBe(24 * 60 * 60 * 1000);
    expect(frame.pipSize).toBeGreaterThan(0);
  });

  it("reprojects when the viewport changes", () => {
    const { manual, surface } = mountOnCanvas();

    surface.setBars(harness.bars);
    surface.setViewport({ barCount: 60 });
    manual.flush();

    const narrow = surface.getFrame()!;
    expect(narrow.pixelsPerBar).toBeCloseTo(CSS_WIDTH / 60, 6);

    surface.setViewport({ barCount: 120 });
    manual.flush();

    expect(surface.getFrame()!.pixelsPerBar).toBeCloseTo(CSS_WIDTH / 120, 6);
  });

  it("draws indicator geometry once bundles arrive", () => {
    const { manual, surface } = mountOnCanvas();

    surface.setBars(harness.bars);
    surface.setBundles([findBundle(harness, "lumina-trend-channels")]);
    manual.flush();

    const bundle = findBundle(harness, "lumina-trend-channels");
    expect(surface.getPerformanceSnapshot().geometryRebuilds).toBeGreaterThan(0);
    expect(surface.getFrame()).not.toBeNull();
    expect(bundle.series.length).toBeGreaterThan(0);
  });

  it("bumps the data revision on each setBars unless one is given", () => {
    const { manual, surface } = mountOnCanvas();

    surface.setBars(harness.bars);
    manual.flush();
    const first = surface.getFrame()!.dataRevision;

    surface.setBars(harness.bars);
    manual.flush();
    expect(surface.getFrame()!.dataRevision).toBe(first + 1);

    surface.setBars(harness.bars, 42);
    manual.flush();
    expect(surface.getFrame()!.dataRevision).toBe(42);
  });

  it("tears everything down on destroy", () => {
    const { container, manual, surface } = mountInContainer();
    const observer = RecordingResizeObserver.instances[0];
    const canvas = surface.getCanvas();

    surface.setBars(harness.bars);
    manual.flush();

    surface.destroy();

    expect(observer.disconnected).toBe(true);
    expect(canvas.parentElement).toBeNull();
    expect(container.querySelectorAll("canvas")).toHaveLength(0);

    // Requests after destroy do nothing.
    surface.requestRender("data");
    manual.flush();
    expect(manual.pendingCount()).toBe(0);
  });

  it("keeps a host-owned canvas mounted after destroy", () => {
    const { canvas, surface } = mountOnCanvas();

    surface.destroy();

    expect(canvas.parentElement).toBe(document.body);
  });

  it("is idempotent on double destroy", () => {
    const { surface } = mountOnCanvas();

    surface.destroy();
    expect(() => surface.destroy()).not.toThrow();
  });

  it("renders immediately via renderNow without waiting for a frame", () => {
    const { manual, surface } = mountOnCanvas();

    surface.setBars(harness.bars);
    expect(manual.pendingCount()).toBe(1);

    surface.renderNow();
    expect(surface.getFrame()!.visibleTimeRange.to).toBe(
      harness.bars[harness.bars.length - 1].time,
    );
  });

  it("widens the price domain to include indicator output", () => {
    // The bars sit in the low thousands; this indicator plots far above them.
    const FAR_ABOVE = 1_000_000;

    const { manual, surface } = mountOnCanvas();
    surface.setBars(harness.bars);
    manual.flush();

    const withoutIndicator = surface.getFrame()!.visiblePriceRange;
    expect(FAR_ABOVE).toBeGreaterThan(withoutIndicator.to);

    surface.setBundles([
      plotBundle([{ time: 1_700_000_000_000, value: FAR_ABOVE }]),
    ]);
    manual.flush();

    const withIndicator = surface.getFrame()!.visiblePriceRange;

    // Before the fix the surface fitted the domain to bar highs/lows only, so this was clipped.
    expect(withIndicator.to).toBeGreaterThanOrEqual(FAR_ABOVE);
    expect(withIndicator.to).toBeGreaterThan(withoutIndicator.to);
  });

  it("rebuilds geometry when a bundle is mutated in place", () => {
    const { manual, surface } = mountOnCanvas();
    const bundle = plotBundle([{ time: 1_700_000_000_000, value: 100 }]);

    surface.setBars(harness.bars);
    surface.setBundles([bundle]);
    manual.flush();

    const afterFirst = surface.getPerformanceSnapshot().geometryRebuilds;
    expect(afterFirst).toBeGreaterThan(0);

    // The realtime pattern: mutate the bundle in place, then hand the SAME array back.
    // Identity comparison cannot see that, so this used to serve stale geometry.
    bundle.series[0].points.push({
      committed: true,
      revision: 1,
      style: {},
      text: null,
      time: 1_700_086_400_000,
      value: 120,
    });
    surface.setBundles([bundle]);
    manual.flush();

    expect(surface.getPerformanceSnapshot().geometryRebuilds).toBeGreaterThan(
      afterFirst,
    );
  });
});

afterAll(() => {
  restoreCanvasContext();
});
