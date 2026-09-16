import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createChartFrame,
  createViewport,
  IndicatorCanvasRenderer,
  type ChartRenderFrame,
} from "@fxtoolkit/indicator-runner";
import {
  countCalls,
  createRecordingCanvas,
  installCanvasContextStub,
} from "./support/fake-canvas";
import {
  createGoldenEngineHarness,
  findBundle,
  type GoldenEngineHarness,
} from "./support/golden-engine";
import { MODULES } from "./support/indicator-fixtures";

const PLOT_WIDTH = 900;
const PLOT_HEIGHT = 500;
const PIXEL_RATIO = 2;

describe("indicator canvas renderer", () => {
  let harness: GoldenEngineHarness;
  let frame: ChartRenderFrame;
  let restoreCanvasContext: () => void;

  beforeAll(async () => {
    restoreCanvasContext = installCanvasContextStub();
    harness = await createGoldenEngineHarness(MODULES);

    frame = createChartFrame({
      bars: harness.bars,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(120, 0),
    });
  });

  afterAll(() => {
    harness.destroy();
    restoreCanvasContext();
  });

  function createRenderer() {
    const { canvas, recording } = createRecordingCanvas({
      height: PLOT_HEIGHT,
      width: PLOT_WIDTH,
    });
    const renderer = new IndicatorCanvasRenderer({
      canvas,
      pixelRatio: PIXEL_RATIO,
    });

    return { canvas, recording, renderer };
  }

  it("sizes the backing store in device pixels", () => {
    const { canvas, renderer } = createRenderer();

    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);
    renderer.render(frame);

    expect(canvas.width).toBe(PLOT_WIDTH * PIXEL_RATIO);
    expect(canvas.height).toBe(PLOT_HEIGHT * PIXEL_RATIO);
    expect(canvas.style.width).toBe(`${PLOT_WIDTH}px`);
    expect(canvas.style.display).toBe("block");

    renderer.destroy();
  });

  it("replays indicator geometry onto the 2D context", () => {
    const { recording, renderer } = createRenderer();

    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);
    renderer.render(frame);

    // Triangles arrive as moveTo/lineTo paths, and the dashboard panel draws text.
    expect(countCalls(recording, "moveTo")).toBeGreaterThan(0);
    expect(countCalls(recording, "lineTo")).toBeGreaterThan(0);
    expect(countCalls(recording, "fill")).toBeGreaterThan(0);
    expect(countCalls(recording, "fillText")).toBeGreaterThan(0);

    renderer.destroy();
  });

  it("draws point markers as arcs", () => {
    const { recording, renderer } = createRenderer();

    // Lumina's trend-change markers are circles, which replay as arcs. Arrow markers would
    // arrive as triangles instead.
    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);
    renderer.render(frame);

    expect(countCalls(recording, "arc")).toBeGreaterThan(0);

    renderer.destroy();
  });

  it("clips to the plot area", () => {
    const { recording, renderer } = createRenderer();

    renderer.setBundles([findBundle(harness, "qmra-indicator")]);
    renderer.render(frame);

    const rectCalls = recording.calls.filter((call) => call.method === "rect");
    expect(rectCalls.length).toBeGreaterThan(0);
    // Clipped to the plot box converted to device pixels.
    expect(rectCalls[0].args[2]).toBe(PLOT_WIDTH * PIXEL_RATIO);

    renderer.destroy();
  });

  it("reuses cached geometry across identical frames", () => {
    const { renderer } = createRenderer();

    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);

    renderer.render(frame);
    const first = renderer.getPerformanceSnapshot();
    expect(first.geometryRebuilds).toBe(1);
    expect(first.geometryCacheHits).toBe(0);

    renderer.render(frame);
    const second = renderer.getPerformanceSnapshot();
    expect(second.geometryRebuilds).toBe(1);
    expect(second.geometryCacheHits).toBe(1);

    renderer.destroy();
  });

  it("rebuilds geometry when the viewport changes", () => {
    const { renderer } = createRenderer();
    const wider = createChartFrame({
      bars: harness.bars,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(240, 0),
    });

    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);
    renderer.render(frame);
    renderer.render(wider);

    expect(renderer.getPerformanceSnapshot().geometryRebuilds).toBe(2);

    renderer.destroy();
  });

  it("hides the canvas when there is nothing to draw", () => {
    const { canvas, recording, renderer } = createRenderer();

    renderer.setBundles([]);
    renderer.render(frame);

    expect(canvas.style.display).toBe("none");
    expect(countCalls(recording, "clearRect")).toBeGreaterThan(0);

    renderer.destroy();
  });

  it("clears its caches on destroy", () => {
    const { renderer } = createRenderer();

    renderer.setBundles([findBundle(harness, "qmra-indicator")]);
    renderer.render(frame);
    renderer.destroy();

    // Re-rendering after destroy has no bundles and must not throw.
    expect(() => renderer.render(frame)).not.toThrow();
    expect(renderer.getPerformanceSnapshot().geometryRebuilds).toBe(1);
  });

  it("records no drawing when the plot box is degenerate", () => {
    const { canvas, recording, renderer } = createRenderer();
    const collapsed = createChartFrame({
      bars: harness.bars,
      plotHeight: 0,
      plotWidth: 0,
      viewport: createViewport(120, 0),
    });

    renderer.setBundles([findBundle(harness, "lumina-trend-channels")]);
    renderer.render(collapsed);

    expect(canvas.style.display).toBe("none");
    expect(countCalls(recording, "moveTo")).toBe(0);

    renderer.destroy();
  });
});
