/**
 * Renderer-side model types.
 *
 * These are not part of the WASM ABI (see `@fxtoolkit/indicator-stdlib/abi`); they describe the
 * frame and scale objects the renderer consumes. Field names and shapes follow Orion
 * `src/library/models/chart/types.ts` so ported renderer code stays recognisable.
 */

export type ValueScaleUnit = "price" | "percent" | "numeric";

export interface ChartPriceRange {
  from: number;
  to: number;
}

export interface ValueScaleProjection {
  id: string;
  unit: ValueScaleUnit;
  domain: ChartPriceRange;
  valueToY(value: number): number;
  yToValue(y: number): number;
  formatValue(value: number): string;
  quantizeValue(value: number): number;
}

export interface ChartSelectionPoint {
  x: number;
  y: number;
}

export interface ChartSelectionRectangle {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface IndicatorSelectionTarget {
  indicatorId: string;
  source: "indicator";
}

/** Low/high extent an indicator contributes to an automatic price domain. */
export interface ChartPlotExtents {
  high: number;
  low: number;
}

export interface ChartRenderPerformanceSnapshot {
  bufferUploads: number;
  drawCalls: number;
  geometryCacheHits: number;
  geometryRebuilds: number;
  lastRenderMs: number;
  renderedVertices: number;
}

/**
 * One immutable projection of the current viewport.
 *
 * The field set is exactly what the indicator render path consumes — `indicator-scene-adapter.ts`
 * uses `timeToX`, `valueToY`, `visibleTimeRange`, `timeFrameMs`, `plotWidth`, `pixelsPerBar`,
 * `plotRightX`, `plotHeight`, `visiblePriceRange`, `areTimesAdjacent`, `timeOrigin` and
 * `plotOffsetX`, and the scene compositors key their geometry cache on `dataRevision`.
 * `logicalToTime` is the inverse the adapter's host needs to map pointer x back to time.
 */
export interface ChartRenderFrame {
  areTimesAdjacent(leftTime: number, rightTime: number): boolean;
  dataRevision: number;
  logicalToTime(logical: number): number;
  pipSize: number;
  pixelsPerBar: number;
  plotHeight: number;
  /** Screen-space x origin of the plot area. */
  plotOffsetX: number;
  /** Exclusive right edge of the plot area. */
  plotRightX: number;
  plotWidth: number;
  timeFrameMs: number;
  timeOrigin: number;
  timeToX(time: number): number;
  valueToY(value: number, scaleId?: string): number;
  visiblePriceRange: ChartPriceRange;
  visibleTimeRange: {
    from: number;
    to: number;
  };
  /** Every value scale in play, keyed by scale id. The renderer's cache key reads these. */
  yScales: Map<string, ValueScaleProjection>;
}
