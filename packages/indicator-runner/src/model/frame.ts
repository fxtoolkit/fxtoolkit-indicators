/**
 * Builds the immutable per-frame projection the renderer consumes.
 *
 * Reimplemented rather than ported: Orion's `createRenderFrame` reads its chart's viewport store,
 * pane/plot managers and document-backed scale configs. This produces the same projection contract
 * (`ChartRenderFrame`) from just a bar series, a viewport and a plot box.
 */

import type { ChartBar } from "@fxtoolkit/indicator-stdlib/abi";
import {
  getSeriesVolatility,
  getStringFromMeta,
  getDummyPipSizeForSymbol,
  inferTimeFrameMs,
} from "../utils/market";
import { createLogicalTimeScale, type TimeScaleMode } from "./time-scale";
import type {
  ChartPriceRange,
  ChartRenderFrame,
  ValueScaleProjection,
} from "./types";
import {
  createLinearValueScaleProjection,
  createLogarithmicValueScaleProjection,
  getAutomaticScaleDomain,
} from "./value-scale";
import {
  createViewport,
  resolveVisibleWindow,
  type IndicatorViewport,
} from "./viewport";

export type PriceScaleMode = "auto" | "free";
export type PriceScaleType = "linear" | "logarithmic";

export interface ChartFrameOptions {
  bars: readonly ChartBar[];
  /** Extra values (e.g. indicator output) folded into the automatic price domain. */
  additionalPriceValues?: readonly number[];
  dataRevision?: number;
  /** Overrides the bar interval inferred from `bars`. */
  timeFrameMs?: number;
  timeScaleMode?: TimeScaleMode;
  priceScaleMode?: PriceScaleMode;
  priceScaleType?: PriceScaleType;
  freePriceRange?: ChartPriceRange;
  /** Extra value scales keyed by `scaleId`; indicator objects may target these. */
  valueScales?: Record<string, { domain: ChartPriceRange; type?: PriceScaleType }>;
  plotHeight: number;
  plotOffsetX?: number;
  plotWidth: number;
  /** Overrides the symbol used for pip-size estimation. */
  symbol?: string;
  pipSize?: number;
  viewport?: IndicatorViewport;
}

/** The primary scale id; indicator output without a `scaleId` lands here. */
export const PRIMARY_SCALE_ID = "price";

export function createChartFrame(
  options: ChartFrameOptions,
): ChartRenderFrame {
  const plotOffsetX = options.plotOffsetX ?? 0;
  const plotWidth = Math.max(options.plotWidth, 0);
  const plotHeight = Math.max(options.plotHeight, 0);
  const viewport = options.viewport ?? createViewport();
  const window = resolveVisibleWindow(options.bars, viewport);
  const visibleBars = window.bars;

  const timeFrameMs = options.timeFrameMs ??
    inferTimeFrameMs(options.bars);
  const timeScaleMode = options.timeScaleMode ?? "continuous";
  // Built from every bar, not just the visible ones, so panning and zooming never move the
  // logical positions of bars that stay on screen.
  const logicalTimeScale = createLogicalTimeScale({
    mode: timeScaleMode,
    timeFrameMs,
    times: options.bars.map((bar) => bar.time),
  });

  const pipSize = options.pipSize ??
    getDummyPipSizeForSymbol(
      options.symbol ?? getStringFromMeta(options.bars[0]?.meta, "symbol") ?? "ETHUSD",
      getSeriesVolatility(options.bars),
    );

  const priceScaleType = options.priceScaleType ?? "linear";
  const visiblePriceRange = resolvePriceRange(options, visibleBars, pipSize);
  const primaryScale = createScale(
    PRIMARY_SCALE_ID,
    priceScaleType,
    visiblePriceRange,
    plotHeight,
    priceScaleType === "linear" ? pipSize : undefined,
  );
  const yScales = new Map<string, ValueScaleProjection>([
    [PRIMARY_SCALE_ID, primaryScale],
  ]);

  for (const [scaleId, config] of Object.entries(options.valueScales ?? {})) {
    yScales.set(
      scaleId,
      createScale(scaleId, config.type ?? "linear", config.domain, plotHeight),
    );
  }

  const visibleTimeRange = {
    from: visibleBars.length ? visibleBars[0].time : 0,
    to: visibleBars.length ? visibleBars[visibleBars.length - 1].time : 0,
  };
  const pixelsPerBar = visibleBars.length
    ? plotWidth / visibleBars.length
    : plotWidth;
  // The first visible bar sits at the plot's left edge.
  const timeOrigin = logicalTimeScale.timeToLogical(visibleTimeRange.from);

  return {
    areTimesAdjacent: (leftTime, rightTime) =>
      Math.abs(
        logicalTimeScale.timeToLogical(rightTime) -
          logicalTimeScale.timeToLogical(leftTime),
      ) <= 1.5,
    dataRevision: options.dataRevision ?? 0,
    logicalToTime: (logical) => logicalTimeScale.logicalToTime(logical),
    pipSize,
    pixelsPerBar,
    plotHeight,
    plotOffsetX,
    plotRightX: plotOffsetX + plotWidth,
    plotWidth,
    timeFrameMs,
    timeOrigin,
    timeToX: (time) =>
      plotOffsetX +
      pixelsPerBar * (logicalTimeScale.timeToLogical(time) - timeOrigin),
    valueToY: (value, scaleId = PRIMARY_SCALE_ID) =>
      (yScales.get(scaleId) ?? primaryScale).valueToY(value),
    visiblePriceRange,
    visibleTimeRange,
    yScales,
  };
}

function createScale(
  id: string,
  type: PriceScaleType,
  domain: ChartPriceRange,
  height: number,
  quantization?: number,
): ValueScaleProjection {
  return type === "logarithmic"
    ? createLogarithmicValueScaleProjection({ domain, height, id, quantization })
    : createLinearValueScaleProjection({
        domain,
        height,
        id,
        quantization,
        unit: "price",
      });
}

function resolvePriceRange(
  options: ChartFrameOptions,
  visibleBars: readonly ChartBar[],
  pipSize: number,
): ChartPriceRange {
  if (options.priceScaleMode === "free" && options.freePriceRange) {
    return normalizePriceRange(options.freePriceRange, pipSize);
  }

  const values: number[] = [];
  for (const bar of visibleBars) {
    values.push(bar.low, bar.high);
  }
  for (const value of options.additionalPriceValues ?? []) {
    values.push(value);
  }

  return getAutomaticScaleDomain(values, "price");
}

/** Mirrors orion's `normalizePriceRangeWithPipSize`. */
function normalizePriceRange(
  range: ChartPriceRange,
  pipSize: number,
): ChartPriceRange {
  let from = Math.min(range.from, range.to);
  let to = Math.max(range.from, range.to);

  if (to - from < pipSize * 8) {
    const padding = pipSize * 4;
    from -= padding;
    to += padding;
  }

  return { from, to };
}
