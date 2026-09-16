import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IndicatorRenderBundle } from "@fxtoolkit/indicator-stdlib/abi";
import {
  createChartFrame,
  createViewport,
  type ChartRenderFrame,
} from "@fxtoolkit/indicator-runner";
import IndicatorSceneAdapter from "../src/render/indicator-scene-adapter";
import { createFrameSceneHost } from "../src/render/scene-host";
import { createRecordingContext } from "./support/fake-canvas";
import {
  createGoldenEngineHarness,
  findBundle,
  type GoldenEngineHarness,
} from "./support/golden-engine";
import { MODULES } from "./support/indicator-fixtures";

const PLOT_WIDTH = 900;
const PLOT_HEIGHT = 500;

/** Each triangle is 3 vertices of (x, y, r, g, b, a); each point is 7 floats. */
const TRIANGLE_STRIDE = 18;
const POINT_STRIDE = 7;

function appendBundle(
  adapter: IndicatorSceneAdapter,
  bundle: IndicatorRenderBundle,
  frame: ChartRenderFrame,
) {
  const triangleVertices: number[] = [];
  const pointVertices: number[] = [];
  const panelCommands: unknown[] = [];
  const textCommands: unknown[] = [];

  adapter.appendGeometry(
    bundle,
    frame,
    triangleVertices,
    pointVertices,
    panelCommands as never[],
    textCommands as never[],
    false,
  );

  return { panelCommands, pointVertices, textCommands, triangleVertices };
}

describe("indicator scene adapter geometry", () => {
  let harness: GoldenEngineHarness;
  let frame: ChartRenderFrame;
  let adapter: IndicatorSceneAdapter;

  beforeAll(async () => {
    harness = await createGoldenEngineHarness(MODULES);

    frame = createChartFrame({
      bars: harness.bars,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(120, 0),
    });

    const scratch = createRecordingContext();
    adapter = new IndicatorSceneAdapter(
      createFrameSceneHost(() => frame),
      scratch.context,
    );
    adapter.updateBundles(MODULES.map((module) => findBundle(harness, module)));
  });

  afterAll(() => {
    adapter.destroy();
    harness.destroy();
  });

  it("produces well-formed command buffers for every indicator", () => {
    for (const module of MODULES) {
      const geometry = appendBundle(adapter, findBundle(harness, module), frame);

      expect(
        geometry.triangleVertices.length % TRIANGLE_STRIDE,
        `${module} triangle stride`,
      ).toBe(0);
      expect(
        geometry.pointVertices.length % POINT_STRIDE,
        `${module} point stride`,
      ).toBe(0);
      expect(
        geometry.triangleVertices.length + geometry.pointVertices.length,
        `${module} produced geometry`,
      ).toBeGreaterThan(0);
    }
  });

  it("emits line triangles for a channel-style plot series", () => {
    const geometry = appendBundle(
      adapter,
      findBundle(harness, "lumina-trend-channels"),
      frame,
    );

    // Lumina plots five series, so it must produce line segments.
    expect(geometry.triangleVertices.length).toBeGreaterThanOrEqual(TRIANGLE_STRIDE);
  });

  it("emits point markers for circular plotshapes", () => {
    const geometry = appendBundle(
      adapter,
      findBundle(harness, "lumina-trend-channels"),
      frame,
    );

    // Lumina's trend-change marker uses shape "circle", which the adapter emits as a point
    // vertex (7 floats). Arrow shapes instead become triangles.
    expect(geometry.pointVertices.length).toBeGreaterThan(0);
  });

  it("emits triangle markers for arrow plotshapes", () => {
    const geometry = appendBundle(
      adapter,
      findBundle(harness, "reverse-logic-scalper"),
      frame,
    );

    expect(geometry.triangleVertices.length).toBeGreaterThan(0);
    expect(geometry.pointVertices.length).toBe(0);
  });

  it("emits the lumina dashboard as a panel command", () => {
    const geometry = appendBundle(
      adapter,
      findBundle(harness, "lumina-trend-channels"),
      frame,
    );

    expect(geometry.panelCommands.length).toBeGreaterThan(0);
    const panel = geometry.panelCommands[0] as { kind: string; title: string };
    expect(panel.kind).toBe("panel");
  });

  it("emits text commands for object labels", () => {
    const geometry = appendBundle(
      adapter,
      findBundle(harness, "qmra-indicator"),
      frame,
    );

    // QMRA labels each pattern ("QM" / "IGNORED / BREAKER").
    expect(geometry.textCommands.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same bundle and frame", () => {
    const bundle = findBundle(harness, "lumina-trend-channels");
    const first = appendBundle(adapter, bundle, frame);
    const second = appendBundle(adapter, bundle, frame);

    expect(second.triangleVertices).toEqual(first.triangleVertices);
    expect(second.pointVertices).toEqual(first.pointVertices);
    expect(second.panelCommands.length).toBe(first.panelCommands.length);
  });

  it("reprojects when the viewport changes but keeps the same bundle", () => {
    const bundle = findBundle(harness, "lumina-trend-channels");
    const wider = createChartFrame({
      bars: harness.bars,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(240, 0),
    });

    const before = appendBundle(adapter, bundle, frame);
    const after = appendBundle(adapter, bundle, wider);

    expect(after.triangleVertices).not.toEqual(before.triangleVertices);
  });

  it("reports the price extents the indicators contribute", () => {
    for (const module of MODULES) {
      appendBundle(adapter, findBundle(harness, module), frame);
    }

    const extents = adapter.getVisiblePriceExtents();
    expect(extents).not.toBeNull();
    expect(extents!.high).toBeGreaterThan(extents!.low);
  });

  it("produces nothing for an indicator with no output", () => {
    const empty: IndicatorRenderBundle = {
      alerts: [],
      descriptor: {
        inputs: [],
        module: "empty",
        outputKinds: [],
        title: "Empty",
        version: "1.0.0",
      },
      fills: [],
      id: "empty",
      module: "empty",
      objects: [],
      series: [],
      signals: [],
    };

    const geometry = appendBundle(adapter, empty, frame);

    expect(geometry.triangleVertices).toEqual([]);
    expect(geometry.pointVertices).toEqual([]);
    expect(geometry.panelCommands).toEqual([]);
    expect(geometry.textCommands).toEqual([]);
  });
});
