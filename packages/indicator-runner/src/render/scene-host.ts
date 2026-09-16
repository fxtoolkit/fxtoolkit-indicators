/**
 * The minimal chart surface the ported indicator scene adapter depends on.
 *
 * Orion passes a real `Chart` and calls seven methods on it. The standalone renderer fulfils
 * the same seven from the current render frame, so the adapter's body stays unchanged.
 */

import type { ChartRenderFrame } from "../model/types";

export interface SceneHost {
  getPixelsPerBar(): number;
  getPlotHeight(): number;
  getPlotOffsetX?(): number;
  getPlotWidth(): number;
  getTimeFrameMs(): number;
  getVisibleTimeRange(): { from: number; to: number };
  /** Inverse of the frame's `timeToX`, for mapping pointer x back to a timestamp. */
  xToTime(x: number): number;
}

export function createFrameSceneHost(
  getFrame: () => ChartRenderFrame | null,
): SceneHost {
  const requireFrame = () => {
    const frame = getFrame();

    if (!frame) {
      throw new Error("Scene host has no render frame");
    }

    return frame;
  };

  return {
    getPixelsPerBar: () => requireFrame().pixelsPerBar,
    getPlotHeight: () => requireFrame().plotHeight,
    getPlotOffsetX: () => requireFrame().plotOffsetX,
    getPlotWidth: () => requireFrame().plotWidth,
    getTimeFrameMs: () => requireFrame().timeFrameMs,
    getVisibleTimeRange: () => requireFrame().visibleTimeRange,
    // The frame owns its own inverse, so this stays correct whether the projection came from a
    // viewport or from a host-supplied time axis.
    xToTime: (x) => requireFrame().xToTime(x),
  };
}
