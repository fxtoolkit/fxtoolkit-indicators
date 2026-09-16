import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createChartFrame,
  createIndicatorRenderer,
  createViewport,
  IndicatorCanvasRenderer,
  SceneWebGLCompositor,
  type ChartRenderFrame,
} from "@fxtoolkit/indicator-runner";
import { installCanvasContextStub } from "./support/fake-canvas";
import { countGlCalls, createRecordingWebGLCanvas } from "./support/fake-webgl";
import {
  createGoldenEngineHarness,
  findBundle,
  type GoldenEngineHarness,
} from "./support/golden-engine";
import { MODULES } from "./support/indicator-fixtures";

const PLOT_WIDTH = 900;
const PLOT_HEIGHT = 500;
const PIXEL_RATIO = 1;

let harness: GoldenEngineHarness;
let restoreCanvasContext: () => void;

function buildFrame(barCount: number): ChartRenderFrame {
  return createChartFrame({
    bars: harness.bars,
    plotHeight: PLOT_HEIGHT,
    plotWidth: PLOT_WIDTH,
    viewport: createViewport(barCount, 0),
  });
}

function createBoth() {
  const webglCanvas = createRecordingWebGLCanvas({
    height: PLOT_HEIGHT,
    width: PLOT_WIDTH,
  });
  const canvasCanvas = document.createElement("canvas");
  Object.defineProperty(canvasCanvas, "clientWidth", {
    configurable: true,
    value: PLOT_WIDTH,
  });
  Object.defineProperty(canvasCanvas, "clientHeight", {
    configurable: true,
    value: PLOT_HEIGHT,
  });

  const webgl = new SceneWebGLCompositor({
    canvas: webglCanvas.canvas,
    pixelRatio: PIXEL_RATIO,
  });
  const canvas = new IndicatorCanvasRenderer({
    canvas: canvasCanvas,
    pixelRatio: PIXEL_RATIO,
  });

  return { canvas, webgl, webglCanvas };
}

describe("WebGL vs Canvas2D parity", () => {
  beforeAll(async () => {
    restoreCanvasContext = installCanvasContextStub();
    harness = await createGoldenEngineHarness(MODULES);
  });

  afterAll(() => {
    harness.destroy();
    restoreCanvasContext();
  });

  it("builds identical geometry from the same bundle and frame", () => {
    const { canvas, webgl } = createBoth();
    const frame = buildFrame(120);
    const bundles = MODULES.map((module) => findBundle(harness, module));

    canvas.setBundles(bundles);
    webgl.setBundles(bundles);
    canvas.render(frame);
    webgl.render(frame);

    for (const module of MODULES) {
      const bundle = findBundle(harness, module);
      const canvasGeometry = canvas.getLayerGeometry(bundle.id);
      const webglGeometry = webgl.getLayerGeometry(bundle.id);

      expect(canvasGeometry, `${module} canvas geometry`).not.toBeNull();
      expect(webglGeometry, `${module} webgl geometry`).not.toBeNull();

      expect(webglGeometry!.triangleData, `${module} triangles`).toEqual(
        canvasGeometry!.triangleData,
      );
      expect(webglGeometry!.pointData, `${module} points`).toEqual(
        canvasGeometry!.pointData,
      );
      expect(webglGeometry!.textCommands.length, `${module} text commands`).toBe(
        canvasGeometry!.textCommands.length,
      );
      expect(webglGeometry!.panelCommands.length, `${module} panel commands`).toBe(
        canvasGeometry!.panelCommands.length,
      );
    }

    canvas.destroy();
    webgl.destroy();
  });

  it("produces non-trivial geometry, so parity is not vacuous", () => {
    const { canvas, webgl } = createBoth();
    const frame = buildFrame(120);
    const bundles = MODULES.map((module) => findBundle(harness, module));

    canvas.setBundles(bundles);
    webgl.setBundles(bundles);
    canvas.render(frame);
    webgl.render(frame);

    let triangleCount = 0;
    let pointCount = 0;

    for (const module of MODULES) {
      const geometry = webgl.getLayerGeometry(findBundle(harness, module).id)!;
      triangleCount += geometry.triangleData.length;
      pointCount += geometry.pointData.length;
    }

    expect(triangleCount).toBeGreaterThan(0);
    expect(pointCount).toBeGreaterThan(0);

    canvas.destroy();
    webgl.destroy();
  });

  it("keeps parity when the viewport changes", () => {
    const { canvas, webgl } = createBoth();
    const bundles = MODULES.map((module) => findBundle(harness, module));

    canvas.setBundles(bundles);
    webgl.setBundles(bundles);

    for (const barCount of [60, 120, 240]) {
      const frame = buildFrame(barCount);
      canvas.render(frame);
      webgl.render(frame);

      for (const module of MODULES) {
        const id = findBundle(harness, module).id;
        expect(
          webgl.getLayerGeometry(id)!.triangleData,
          `${module} @ ${barCount} bars`,
        ).toEqual(canvas.getLayerGeometry(id)!.triangleData);
      }
    }

    canvas.destroy();
    webgl.destroy();
  });

  it("reuses layer geometry across identical frames", () => {
    const { webgl } = createBoth();
    const frame = buildFrame(120);

    webgl.setBundles(MODULES.map((module) => findBundle(harness, module)));
    webgl.render(frame);

    const first = webgl.getPerformanceSnapshot();
    expect(first.geometryRebuilds).toBe(MODULES.length);
    expect(first.geometryCacheHits).toBe(0);

    webgl.render(frame);

    // Nothing is rebuilt, everything is reused — which is also what keeps layer buffers from
    // re-uploading. (The raw GL call count is not a usable proxy here: the sprite vertex buffer
    // is re-uploaded per frame by design, and `bufferUploads` counts those too.)
    const second = webgl.getPerformanceSnapshot();
    expect(second.geometryRebuilds).toBe(first.geometryRebuilds);
    expect(second.geometryCacheHits).toBe(MODULES.length);

    webgl.destroy();
  });

  it("scissors to the plot box in device pixels", () => {
    const { webgl, webglCanvas } = createBoth();

    webgl.setBundles([findBundle(harness, "lumina-trend-channels")]);
    webgl.render(buildFrame(120));

    const scissorCalls = webglCanvas.calls.filter((call) => call.method === "scissor");
    expect(scissorCalls.length).toBeGreaterThan(0);
    // x, y, width, height — width is the plot width scaled by the pixel ratio.
    expect(scissorCalls[0].args[2]).toBe(PLOT_WIDTH * PIXEL_RATIO);

    webgl.destroy();
  });

  it("draws triangles, points and sprites through GL", () => {
    const { webgl, webglCanvas } = createBoth();

    webgl.setBundles([findBundle(harness, "lumina-trend-channels")]);
    webgl.render(buildFrame(120));

    expect(countGlCalls(webglCanvas, "drawArrays")).toBeGreaterThan(0);
    expect(countGlCalls(webglCanvas, "texImage2D")).toBeGreaterThan(0);

    webgl.destroy();
  });

  it("hides the canvas and skips drawing when there is nothing to draw", () => {
    const { webgl, webglCanvas } = createBoth();

    webgl.setBundles([]);
    webgl.render(buildFrame(120));

    expect(webglCanvas.canvas.style.display).toBe("none");
    expect(countGlCalls(webglCanvas, "drawArrays")).toBe(0);
    expect(webgl.getPerformanceSnapshot().bufferUploads).toBe(0);

    webgl.destroy();
  });
});

describe("renderer selection", () => {
  beforeAll(() => {
    restoreCanvasContext = installCanvasContextStub();
  });

  afterAll(() => {
    restoreCanvasContext();
  });

  it("prefers WebGL when a context is available", () => {
    const { canvas } = createRecordingWebGLCanvas({
      height: PLOT_HEIGHT,
      width: PLOT_WIDTH,
    });

    expect(createIndicatorRenderer({ canvas }).backend).toBe("webgl");
  });

  it("falls back to Canvas2D when WebGL is unavailable", () => {
    // A plain canvas has no WebGL under the 2D-only stub, so the compositor cannot be built.
    const { backend, renderer } = createIndicatorRenderer({
      canvas: document.createElement("canvas"),
      prefer: "auto",
    });

    expect(backend).toBe("canvas");
    expect(renderer).toBeInstanceOf(IndicatorCanvasRenderer);
  });

  it("honours an explicit canvas preference", () => {
    const { canvas } = createRecordingWebGLCanvas({
      height: PLOT_HEIGHT,
      width: PLOT_WIDTH,
    });

    expect(createIndicatorRenderer({ canvas, prefer: "canvas" }).backend).toBe(
      "canvas",
    );
  });

  it("surfaces the error when WebGL is demanded but unavailable", () => {
    expect(() =>
      createIndicatorRenderer({
        canvas: document.createElement("canvas"),
        prefer: "webgl",
      }),
    ).toThrow(/WebGL/i);
  });
});
