/**
 * Standalone viewport and bar-window model.
 *
 * Reimplemented rather than ported: Orion's viewport lives in its chart `generalStore` alongside
 * pointer handling, pane/plot managers and the normalized document, none of which exist here. This
 * is the minimal equivalent the renderer needs — which bars are on screen, and how many pixels
 * each one occupies.
 */

import type { ChartBar } from "@fxtoolkit/indicator-stdlib/abi";

export interface IndicatorViewport {
  /** Number of bars visible in the window. */
  barCount: number;
  /** Bars the window is offset from the newest bar; 0 pins it to the right edge. */
  offsetBars: number;
}

export interface VisibleWindow {
  bars: ChartBar[];
  endIndex: number;
  startIndex: number;
}

export const MINIMUM_VISIBLE_BARS = 10;
export const MAXIMUM_VISIBLE_BARS = 5000;

export function createViewport(
  barCount = 200,
  offsetBars = 0,
): IndicatorViewport {
  return {
    barCount: clampBarCount(barCount),
    offsetBars: Math.max(0, Math.round(offsetBars)),
  };
}

/**
 * Resolves which slice of `bars` the viewport shows. `offsetBars` moves the window backwards in
 * time, and the window is clamped so it never runs past either end of the series.
 */
export function resolveVisibleWindow(
  bars: readonly ChartBar[],
  viewport: IndicatorViewport,
): VisibleWindow {
  const total = bars.length;

  if (!total) {
    return { bars: [], endIndex: -1, startIndex: 0 };
  }

  const barCount = Math.min(clampBarCount(viewport.barCount), total);
  const endIndex = Math.max(total - 1 - Math.max(0, viewport.offsetBars), barCount - 1);
  const startIndex = Math.max(0, endIndex - barCount + 1);

  return {
    bars: bars.slice(startIndex, endIndex + 1),
    endIndex,
    startIndex,
  };
}

/** Shifts the window by `bars` (positive moves forward in time). */
export function panViewport(
  bars: readonly ChartBar[],
  viewport: IndicatorViewport,
  deltaBars: number,
): IndicatorViewport {
  const barCount = Math.min(clampBarCount(viewport.barCount), Math.max(bars.length, 1));
  const total = Math.max(bars.length, 1);
  // Offset 0 shows the newest bar; the largest useful offset is total - barCount.
  const maximumOffset = Math.max(total - barCount, 0);

  return {
    barCount: viewport.barCount,
    offsetBars: Math.min(Math.max(viewport.offsetBars - deltaBars, 0), maximumOffset),
  };
}

/**
 * Zooms by `factor` (> 1 shows more bars). The window's right edge stays where it is: the newest
 * visible bar is determined by `offsetBars` alone, so only the left edge moves.
 */
export function zoomViewport(
  bars: readonly ChartBar[],
  viewport: IndicatorViewport,
  factor: number,
): IndicatorViewport {
  const total = Math.max(bars.length, 1);
  const nextBarCount = clampBarCount(
    Math.min(Math.round(viewport.barCount * factor), total),
  );

  return {
    barCount: nextBarCount,
    offsetBars: Math.min(
      viewport.offsetBars,
      Math.max(total - nextBarCount, 0),
    ),
  };
}

function clampBarCount(barCount: number) {
  if (!Number.isFinite(barCount)) {
    return MINIMUM_VISIBLE_BARS;
  }

  return Math.min(
    Math.max(Math.round(barCount), MINIMUM_VISIBLE_BARS),
    MAXIMUM_VISIBLE_BARS,
  );
}
