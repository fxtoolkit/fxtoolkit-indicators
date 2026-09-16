/**
 * Backend-neutral surface for an indicator renderer.
 *
 * Both backends (Canvas2D and WebGL) implement this, so a host can swap them and tests can assert
 * that they build identical geometry from the same bundle and frame.
 */

import type { IndicatorRenderBundle } from "@fxtoolkit/indicator-stdlib/abi";
import type {
  ChartPlotExtents,
  ChartRenderFrame,
  ChartRenderPerformanceSnapshot,
} from "../model/types";
import type {
  ScenePanelDrawCommand,
  SceneTextDrawCommand,
} from "./scene-commands";

/** Command buffers for one indicator layer, as handed to the drawing backend. */
export interface IndicatorLayerGeometry {
  panelCommands: ScenePanelDrawCommand[];
  pointData: Float32Array;
  textCommands: SceneTextDrawCommand[];
  triangleData: Float32Array;
}

export interface IndicatorRenderer {
  destroy(): void;
  /** Built geometry for an indicator, or null when it has none cached. Diagnostic/parity surface. */
  getLayerGeometry(indicatorId: string): IndicatorLayerGeometry | null;
  getPerformanceSnapshot(): ChartRenderPerformanceSnapshot;
  /**
   * Price range the indicators contribute on the primary scale, for building an automatic domain.
   *
   * Pass a frame when asking *before* rendering — a caller building a frame needs the extents to
   * feed back into it, and nothing has been rendered yet. Extents depend only on the viewport
   * (visible time range, plot size), never on the price domain, so a provisional frame suffices.
   */
  getVisiblePriceExtents(frame?: ChartRenderFrame): ChartPlotExtents | null;
  render(frame: ChartRenderFrame): void;
  setBundles(bundles: IndicatorRenderBundle[]): void;
}
