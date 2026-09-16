/**
 * @fxtoolkit/indicator-runner public entry.
 *
 * Ported from orion:
 *   src/library/models/chart/workers/indicator-runtime.ts        -> ./runtime/indicator-runtime
 *   src/library/models/chart/workers/indicator-engine.worker.ts  -> ./engine/worker
 *   src/library/models/chart/indicators/indicator-engine.ts      -> ./engine/engine
 *   src/library/models/chart/indicators/indicator-bundle-delta.ts -> ./manager/bundle-delta
 *
 * The worker entry (`./engine/worker`) is intentionally not re-exported: hosts point their
 * bundler at it directly. The canvas mounting surface lands in M7.
 */

export { default as IndicatorRuntime } from "./runtime/indicator-runtime";

export {
  createStaticModuleSource,
  createUrlModuleSource,
  type IndicatorModuleSource,
} from "./runtime/module-source";

export { applyIndicatorBundleDelta } from "./manager/bundle-delta";

export {
  default as IndicatorEngine,
  type IndicatorEngineOptions,
  type IndicatorEnginePerformanceSnapshot,
} from "./engine/engine";

export { getDummyPipSizeForSymbol, getStringFromMeta } from "./utils/market";

// --- model (M4): the projection the renderer consumes -----------------------

export type {
  ChartPriceRange,
  ChartRenderFrame,
  ValueScaleProjection,
  ValueScaleUnit,
} from "./model/types";

export {
  createLogicalTimeScale,
  resolveTimeScaleMode,
  type LogicalTimeScale,
  type TimeScaleMode,
} from "./model/time-scale";

export {
  createLinearValueScaleProjection,
  createLogarithmicValueScaleProjection,
  getAutomaticScaleDomain,
} from "./model/value-scale";

export {
  createChartFrame,
  PRIMARY_SCALE_ID,
  type ChartFrameOptions,
  type PriceScaleMode,
  type PriceScaleType,
} from "./model/frame";

export {
  createViewport,
  MAXIMUM_VISIBLE_BARS,
  MINIMUM_VISIBLE_BARS,
  panViewport,
  resolveVisibleWindow,
  zoomViewport,
  type IndicatorViewport,
  type VisibleWindow,
} from "./model/viewport";

export {
  default as RenderScheduler,
  defaultFrameScheduler,
  type FrameScheduler,
  type RenderReason,
} from "./mount/render-scheduler";

export {
  mountIndicatorSurface,
  type IndicatorEnvironmentOptions,
  type IndicatorSurface,
  type IndicatorSurfaceOptions,
} from "./mount/indicator-surface";

// --- render (M5): the Canvas2D indicator surface ----------------------------

export {
  default as IndicatorCanvasRenderer,
  type IndicatorCanvasRendererOptions,
} from "./render/canvas-renderer";

export {
  default as SceneWebGLCompositor,
  type WebGLCompositorOptions,
} from "./render/webgl-compositor";

export {
  createIndicatorRenderer,
  type CreateIndicatorRendererOptions,
  type IndicatorRendererBackend,
  type IndicatorRendererHandle,
  type IndicatorRendererPreference,
} from "./render/create-renderer";

export type {
  IndicatorLayerGeometry,
  IndicatorRenderer,
} from "./render/renderer";

export { createFrameSceneHost, type SceneHost } from "./render/scene-host";

export type {
  ScenePanelDrawCommand,
  SceneTextDrawCommand,
} from "./render/scene-commands";

export {
  pushDashedLineSegmentTriangles,
  pushFillSegmentTriangles,
  pushLineSegmentTriangles,
  pushRectTriangles,
  pushTriangleMarker,
  pushTriangleVertex,
} from "./render/scene-geometry-utils";

export { parseColor } from "./render/scene-color-utils";

export {
  getPreferredCanvasPixelRatio,
  snapStrokeCoordinate,
} from "./utils/canvas";
