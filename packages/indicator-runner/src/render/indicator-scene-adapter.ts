// Ported from orion src/library/models/chart/components/scene/indicator-scene-adapter.ts
//
// Changes from Orion: import paths point into this package, and the concrete `Chart`
// dependency is replaced by the minimal `SceneHost` seam (same seven calls, sourced from the
// current render frame). The adapter body is unchanged.

import {
  computeTableLayout,
  getPanelAnchorPosition,
  normalizeTableCells,
  normalizeTableMerges,
  normalizeHorizontalTextAlign,
} from "./scene-command-utils";
import {
  pushDashedLineSegmentTriangles,
  pushFillSegmentTriangles,
  pushLineSegmentTriangles,
  pushRectTriangles,
  pushTriangleMarker,
  pushTriangleVertex,
} from "./scene-geometry-utils";
import type {
  ScenePanelDrawCommand,
  SceneTextDrawCommand,
} from "./scene-commands";
import { parseColor } from "./scene-color-utils";
import type {
  IndicatorFill,
  IndicatorObject,
  IndicatorRenderBundle,
  IndicatorSeries,
} from "@fxtoolkit/indicator-stdlib/abi";
import type {
  IndicatorSelectionTarget,
  ChartPlotExtents,
  ChartRenderFrame,
  ChartSelectionPoint,
  ChartSelectionRectangle,
} from "../model/types";
import { snapStrokeCoordinate } from "../utils/canvas";
import type { SceneHost } from "./scene-host";

interface VisibleSeriesPoint {
  committed: boolean;
  style: Record<string, unknown>;
  text: string | null;
  time: number;
  value: number;
}

interface PairedFillPoint {
  lower: VisibleSeriesPoint;
  time: number;
  upper: VisibleSeriesPoint;
}

interface OrderedBundle {
  bundle: IndicatorRenderBundle;
  order: number;
}

const MAX_POINTS_PER_PIXEL = 1.35;
const MAX_MARKERS_PER_PIXEL = 0.35;
const PLOT_HIT_DISTANCE = 8;
const MAX_SELECTION_POINTS = 8;

export default class IndicatorSceneAdapter {
  private bundles: IndicatorRenderBundle[] = [];
  private orderedBundles: OrderedBundle[] = [];
  private readonly indicatorStackOrder = new Map<string, number>();
  private readonly visibleScaleExtentsCache = new Map<
    string,
    Map<string, ChartPlotExtents>
  >();
  private readonly visibleSeriesCache = new Map<string, VisibleSeriesPoint[]>();
  private readonly screenPointCache = new Map<string, ChartSelectionPoint[]>();
  private readonly colorCache = new Map<string, [number, number, number, number]>();
  private bundleVersion = 0;
  private devicePixelRatio = 1;
  private viewportCacheKey = "";

  constructor(
    private readonly host: SceneHost,
    private readonly spriteScratchContext: CanvasRenderingContext2D,
  ) {}

  destroy() {
    this.resetCaches();
  }

  setDevicePixelRatio(devicePixelRatio: number) {
    if (this.devicePixelRatio === devicePixelRatio) return;
    this.devicePixelRatio = devicePixelRatio;
    this.resetCaches();
  }

  resetCaches() {
    this.visibleScaleExtentsCache.clear();
    this.visibleSeriesCache.clear();
    this.screenPointCache.clear();
    this.viewportCacheKey = "";
  }

  setStackOrder(indicatorId: string, order: number) {
    this.indicatorStackOrder.set(indicatorId, order);
    this.rebuildOrderedBundles();
  }

  updateBundles(
    bundles: IndicatorRenderBundle[],
    changedIndicatorIds?: ReadonlySet<string>,
  ) {
    const previousBundles = new Map(this.bundles.map((bundle) => [bundle.id, bundle]));
    const changedIds = new Set(changedIndicatorIds);

    for (const bundle of bundles) {
      if (previousBundles.get(bundle.id) !== bundle) changedIds.add(bundle.id);
      previousBundles.delete(bundle.id);
    }
    for (const removedId of previousBundles.keys()) changedIds.add(removedId);

    this.bundles = bundles;
    if (changedIds.size) {
      this.bundleVersion += 1;
      this.resetCaches();
    }
    this.rebuildOrderedBundles();
  }

  appendGeometry(
    bundle: IndicatorRenderBundle,
    frame: ChartRenderFrame,
    triangleVertices: number[],
    pointVertices: number[],
    panelCommands: ScenePanelDrawCommand[],
    textCommands: SceneTextDrawCommand[],
    selected: boolean,
  ) {
    this.prepareViewportCaches(frame);
    this.appendIndicatorLayerGeometry(
      bundle,
      frame,
      triangleVertices,
      pointVertices,
      panelCommands,
      textCommands,
      selected,
    );
  }

  hitTest(
    indicatorId: string,
    frame: ChartRenderFrame,
    x: number,
    y: number,
  ) {
    return this.hitTestIndicatorLayer(indicatorId, frame, x, y);
  }

  getSelectionTargetInRectangle(
    frame: ChartRenderFrame,
    target: IndicatorSelectionTarget,
    rectangle: ChartSelectionRectangle,
  ) {
    return this.getIndicatorSelectionTargetInRectangle(frame, target, rectangle);
  }

  getSelectionPoints(
    frame: ChartRenderFrame,
    target: IndicatorSelectionTarget,
  ) {
    return this.getIndicatorSelectionPoints(frame, target);
  }

  private prepareViewportCaches(frame: ChartRenderFrame) {
    const nextKey = [
      frame.visibleTimeRange.from,
      frame.visibleTimeRange.to,
      frame.visiblePriceRange.from,
      frame.visiblePriceRange.to,
      frame.pixelsPerBar,
      frame.timeFrameMs,
      frame.timeOrigin,
      frame.plotWidth,
      frame.plotHeight,
      this.devicePixelRatio,
    ].join(":");

    if (this.viewportCacheKey === nextKey) return;
    this.viewportCacheKey = nextKey;
    this.visibleSeriesCache.clear();
    this.screenPointCache.clear();
    this.visibleScaleExtentsCache.clear();
  }

  private toDeviceX(x: number) {
    return x * this.devicePixelRatio;
  }

  private toDeviceY(y: number) {
    return y * this.devicePixelRatio;
  }

  getVisiblePriceExtents() {
    return this.getVisibleScaleExtents().get("price") ?? null;
  }

  getVisibleScaleExtents() {
    const viewportKey = this.getViewportCacheKey();
    const cached = this.visibleScaleExtentsCache.get(viewportKey);

    if (cached !== undefined) {
      return cached;
    }

    const extents = new Map<string, ChartPlotExtents>();
    const addExtent = (scaleId: string, low: number, high: number) => {
      if (!Number.isFinite(low) || !Number.isFinite(high)) {
        return;
      }

      const current = extents.get(scaleId);
      extents.set(scaleId, current
        ? {
            high: Math.max(current.high, high),
            low: Math.min(current.low, low),
          }
        : { high, low });
    };
    const visibleTimeRange = this.host.getVisibleTimeRange();
    const timeFrameMs = this.host.getTimeFrameMs();

    for (const { bundle } of this.orderedBundles) {
      for (const series of bundle.series) {
        if (series.kind === "bgcolor") {
          continue;
        }

        const points = getVisibleSeriesPoints(
          series,
          visibleTimeRange,
          timeFrameMs,
          false,
          this.host.getPlotWidth(),
          this.devicePixelRatio,
        );

        for (const point of points) {
          addExtent(series.scaleId ?? bundle.scaleId ?? "price", point.value, point.value);
        }
      }

      for (const object of bundle.objects) {
        if (!this.isObjectVisible(object, visibleTimeRange, timeFrameMs)) {
          continue;
        }

        if (object.kind === "panel" || object.kind === "table") {
          continue;
        }

        if (object.kind === "candle") {
          const candleLow = typeof object.style.low === "number" ? object.style.low : object.price;
          const candleHigh =
            typeof object.style.high === "number"
              ? object.style.high
              : (typeof object.endPrice === "number" ? object.endPrice : object.price);

          addExtent(object.scaleId ?? bundle.scaleId ?? "price", candleLow, candleHigh);

          continue;
        }

        if (object.kind === "polyline" || object.kind === "linefill") {
          const points = Array.isArray(object.style.points)
            ? object.style.points as Array<{ price?: number }>
            : [];

          for (const point of points) {
            if (typeof point.price !== "number" || !Number.isFinite(point.price)) {
              continue;
            }

            addExtent(object.scaleId ?? bundle.scaleId ?? "price", point.price, point.price);
          }

          continue;
        }

        addExtent(object.scaleId ?? bundle.scaleId ?? "price", object.price, object.price);

        if (typeof object.endPrice === "number") {
          addExtent(object.scaleId ?? bundle.scaleId ?? "price", object.endPrice, object.endPrice);
        }
      }
    }

    this.visibleScaleExtentsCache.set(viewportKey, extents);
    return extents;
  }


  private hitTestIndicatorLayer(
    indicatorId: string,
    frame: ChartRenderFrame,
    x: number,
    y: number,
  ): IndicatorSelectionTarget | null {
    this.prepareViewportCaches(frame);

    for (let bundleIndex = this.orderedBundles.length - 1; bundleIndex >= 0; bundleIndex -= 1) {
      const bundle = this.orderedBundles[bundleIndex].bundle;

      if (bundle.id !== indicatorId) {
        continue;
      }

      for (let seriesIndex = bundle.series.length - 1; seriesIndex >= 0; seriesIndex -= 1) {
        const series = bundle.series[seriesIndex];

        if (series.kind !== "plot") {
          continue;
        }

        const screenPoints = this.getCachedScreenPoints(series, frame, true);

        if (isPointNearPolyline(x, y, screenPoints, PLOT_HIT_DISTANCE)) {
          return {
            indicatorId: bundle.id,
            source: "indicator",
          };
        }
      }

      for (let objectIndex = bundle.objects.length - 1; objectIndex >= 0; objectIndex -= 1) {
        const object = bundle.objects[objectIndex];

        if (!this.isObjectVisible(object, frame.visibleTimeRange, frame.timeFrameMs)) {
          continue;
        }

        if (object.kind === "panel" || object.kind === "table") {
          continue;
        }

        if (object.kind === "label") {
          const labelX = frame.timeToX(object.time)
            + (typeof object.style.offsetX === "number" ? object.style.offsetX : 0);
          const labelY = frame.valueToY(object.price, object.scaleId)
            + (typeof object.style.offsetY === "number" ? object.style.offsetY : 0);

          if (distanceSquared(x, y, labelX, labelY) <= (PLOT_HIT_DISTANCE * 2) ** 2) {
            return {
              indicatorId: bundle.id,
              source: "indicator",
            };
          }

          continue;
        }

        const startX = frame.timeToX(object.time);
        const startY = frame.valueToY(object.price, object.scaleId);
        const endPoint = getIndicatorObjectEndScreenPoint(object, frame);

        if (
          distanceSquaredToSegment(
            x,
            y,
            startX,
            startY,
            endPoint.x,
            endPoint.y,
          ) <= PLOT_HIT_DISTANCE * PLOT_HIT_DISTANCE
        ) {
          return {
            indicatorId: bundle.id,
            source: "indicator",
          };
        }
      }
    }

    return null;
  }


  private getIndicatorSelectionTargetInRectangle(
    frame: ChartRenderFrame,
    target: IndicatorSelectionTarget,
    rectangle: ChartSelectionRectangle,
  ): IndicatorSelectionTarget | null {
    this.prepareViewportCaches(frame);

    const bundle = this.orderedBundles.find(
      ({ bundle: currentBundle }) => currentBundle.id === target.indicatorId,
    )?.bundle;

    if (!bundle) {
      return null;
    }

    for (const series of bundle.series.filter((currentSeries) => currentSeries.kind === "plot")) {
      const points = this.getCachedScreenPoints(series, frame, true);

      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];

        if (isPointInSelectionRectangle(point, rectangle)) {
          return target;
        }

        const previousPoint = points[index - 1];

        if (previousPoint && segmentIntersectsSelectionRectangle(previousPoint, point, rectangle)) {
          return target;
        }
      }
    }

    for (const object of bundle.objects) {
      if (
        object.kind === "panel" ||
        object.kind === "table" ||
        !this.isObjectVisible(object, frame.visibleTimeRange, frame.timeFrameMs)
      ) {
        continue;
      }

      const startPoint = {
        x: frame.timeToX(object.time),
        y: frame.valueToY(object.price, object.scaleId),
      };

      if (object.kind === "label") {
        if (isPointInSelectionRectangle(startPoint, rectangle)) {
          return target;
        }

        continue;
      }

      const endPoint = getIndicatorObjectEndScreenPoint(object, frame);

      if (segmentIntersectsSelectionRectangle(startPoint, endPoint, rectangle)) {
        return target;
      }
    }

    return null;
  }


  private getIndicatorSelectionPoints(
    frame: ChartRenderFrame,
    target: IndicatorSelectionTarget,
  ) {
    this.prepareViewportCaches(frame);
    const selectionPoints: ChartSelectionPoint[] = [];

    for (const { bundle } of this.orderedBundles) {
      if (bundle.id !== target.indicatorId) {
        continue;
      }

      const plotSeries = bundle.series.filter((series) => series.kind === "plot");

      for (const series of plotSeries) {
        selectionPoints.push(
          ...sampleSelectionPoints(
            this.getCachedScreenPoints(series, frame, true),
            Math.max(2, Math.ceil(MAX_SELECTION_POINTS / Math.max(plotSeries.length, 1))),
          ),
        );
      }

      if (selectionPoints.length) {
        return sampleSelectionPoints(selectionPoints, MAX_SELECTION_POINTS);
      }

      for (const object of bundle.objects) {
        if (!this.isObjectVisible(object, frame.visibleTimeRange, frame.timeFrameMs)) {
          continue;
        }

        if (object.kind === "panel" || object.kind === "table") {
          continue;
        }

        const startPoint = {
          x: frame.timeToX(object.time),
          y: frame.valueToY(object.price, object.scaleId),
        };

        selectionPoints.push(startPoint);

        if (object.kind !== "label") {
          const endPoint = getIndicatorObjectEndScreenPoint(object, frame);

          selectionPoints.push(endPoint);
          selectionPoints.push({
            x: (startPoint.x + endPoint.x) / 2,
            y: (startPoint.y + endPoint.y) / 2,
          });
        }
      }

      return sampleSelectionPoints(selectionPoints, MAX_SELECTION_POINTS);
    }

    return [];
  }


  private rebuildOrderedBundles() {
    const orderLookup = new Map<string, number>();

    for (let index = 0; index < this.bundles.length; index += 1) {
      orderLookup.set(this.bundles[index].id, index);
    }

    this.orderedBundles = this.bundles
      .map((bundle) => ({
        bundle,
        order: this.indicatorStackOrder.get(bundle.id)
          ?? orderLookup.get(bundle.id)
          ?? 0,
      }))
      .sort(
        (left, right) =>
          left.order - right.order || left.bundle.id.localeCompare(right.bundle.id),
      );
  }


  private appendIndicatorLayerGeometry(
    bundle: IndicatorRenderBundle,
    frame: ChartRenderFrame,
    triangleVertices: number[],
    pointVertices: number[],
    panelCommands: ScenePanelDrawCommand[],
    textCommands: SceneTextDrawCommand[],
    _selected: boolean,
  ) {
    const backgroundSeries = bundle.series.filter(
      (series) => series.kind === "bgcolor",
    );
    const plotSeries = bundle.series.filter(
      (series) => series.kind === "plot",
    );
    const shapeSeries = bundle.series.filter(
      (series) => series.kind === "plotshape",
    );
    const seriesMap = new Map(
      bundle.series.map((series) => [series.id, series]),
    );

    for (const series of backgroundSeries) {
      this.appendBackgroundSeriesGeometry(series, frame, triangleVertices);
    }
    for (const fill of bundle.fills) {
      this.appendFillGeometry(fill, seriesMap, frame, triangleVertices);
    }
    for (const series of plotSeries) {
      this.appendPlotSeriesGeometry(
        series,
        frame,
        triangleVertices,
        textCommands,
      );
    }
    for (const object of bundle.objects) {
      this.appendObjectGeometry(
        object,
        frame,
        triangleVertices,
        panelCommands,
        textCommands,
      );
    }
    for (const series of shapeSeries) {
      this.appendShapeSeriesGeometry(
        series,
        frame,
        triangleVertices,
        pointVertices,
        textCommands,
      );
    }
  }

  private appendPlotSeriesGeometry(
    series: IndicatorSeries,
    frame: ChartRenderFrame,
    triangleVertices: number[],
    textCommands: SceneTextDrawCommand[],
  ) {
    const points = this.getCachedVisibleSeriesPoints(
      series,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      true,
    );

    if (points.length < 2) {
      return;
    }

    let previousPoint: VisibleSeriesPoint | null = null;
    let previousX = 0;
    let previousY = 0;

    for (const point of points) {
      if (!Number.isFinite(point.value)) {
        previousPoint = null;
        continue;
      }

      const cssX = frame.timeToX(point.time);
      const cssY = frame.valueToY(point.value, series.scaleId);
      const x = this.toDeviceX(cssX);
      const y = this.toDeviceY(cssY);
      const style = { ...series.style, ...point.style };
      const strokeWidth = Math.max(1, getLineWidth(style) * this.devicePixelRatio);
      const snappedX = snapStrokeCoordinate(x, strokeWidth);
      const snappedY = snapStrokeCoordinate(y, strokeWidth);

      if (
        previousPoint
        && frame.areTimesAdjacent(previousPoint.time, point.time)
      ) {
        if (style.dashed === true) {
          pushDashedLineSegmentTriangles(
            triangleVertices,
            previousX,
            previousY,
            snappedX,
            snappedY,
            strokeWidth,
            getColorComponents(this.colorCache, style, point.committed),
            4 * this.devicePixelRatio,
            4 * this.devicePixelRatio,
          );
        } else {
          pushLineSegmentTriangles(
            triangleVertices,
            previousX,
            previousY,
            snappedX,
            snappedY,
            strokeWidth,
            getColorComponents(this.colorCache, style, point.committed),
          );
        }
      }

      if (point.text) {
        textCommands.push({
          backgroundColor: "rgba(0, 0, 0, 0)",
          color: typeof style.color === "string" ? style.color : "#ffffff",
          fontSize: 10,
          opacity: point.committed ? 1 : 0.7,
          text: point.text,
          x: cssX,
          y: cssY + Math.max(6, getShapeSize(style) / 2 + 4),
        });
      }

      previousPoint = point;
      previousX = snappedX;
      previousY = snappedY;
    }
  }

  private appendFillGeometry(
    fill: IndicatorFill,
    seriesMap: Map<string, IndicatorSeries>,
    frame: ChartRenderFrame,
    triangleVertices: number[],
  ) {
    const upperSeries = seriesMap.get(fill.upperSeriesId);
    const lowerSeries = seriesMap.get(fill.lowerSeriesId);

    if (!upperSeries || !lowerSeries) {
      return;
    }

    const upperPoints = this.getCachedVisibleSeriesPoints(
      upperSeries,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      true,
    );
    const lowerPoints = this.getCachedVisibleSeriesPoints(
      lowerSeries,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      true,
    );
    const pairedPoints = this.createPairedFillPoints(
      upperPoints,
      lowerPoints,
      frame.plotWidth,
    );

    if (pairedPoints.length < 2) {
      return;
    }

    let previousPoint: PairedFillPoint | null = null;

    for (const point of pairedPoints) {
      if (
        !Number.isFinite(point.upper.value)
        || !Number.isFinite(point.lower.value)
      ) {
        previousPoint = null;
        continue;
      }

      if (
        previousPoint
        && frame.areTimesAdjacent(previousPoint.time, point.time)
      ) {
        const rawColor =
          typeof fill.style.color === "string" && fill.style.color.length
            ? fill.style.color
            : (typeof point.upper.style.color === "string" && point.upper.style.color.length
              ? point.upper.style.color
              : (typeof upperSeries.style.color === "string" && upperSeries.style.color.length
                ? upperSeries.style.color
                : "#ffffff"));
        const opacity =
          typeof fill.style.opacity === "number" ? fill.style.opacity : 0.18;

        pushFillSegmentTriangles(
          triangleVertices,
          this.toDeviceX(frame.timeToX(previousPoint.time)),
          this.toDeviceY(frame.valueToY(previousPoint.upper.value, upperSeries.scaleId)),
          this.toDeviceY(frame.valueToY(previousPoint.lower.value, lowerSeries.scaleId)),
          this.toDeviceX(frame.timeToX(point.time)),
          this.toDeviceY(frame.valueToY(point.upper.value, upperSeries.scaleId)),
          this.toDeviceY(frame.valueToY(point.lower.value, lowerSeries.scaleId)),
          parseColor(this.colorCache, rawColor, opacity),
        );
      }

      previousPoint = point;
    }
  }

  private appendBackgroundSeriesGeometry(
    series: IndicatorSeries,
    frame: ChartRenderFrame,
    triangleVertices: number[],
  ) {
    const points = this.getCachedVisibleSeriesPoints(
      series,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      false,
    );
    const fullHeight = Math.max(1, Math.round(frame.plotHeight * this.devicePixelRatio));

    for (const point of points) {
      const style = { ...series.style, ...point.style };
      const cssX = frame.timeToX(point.time);

      if (
        cssX < (frame.plotOffsetX ?? 0) - frame.pixelsPerBar ||
        cssX > (frame.plotRightX ?? frame.plotWidth) + frame.pixelsPerBar
      ) {
        continue;
      }

      const widthCss = Math.max(1, frame.pixelsPerBar);
      const left = Math.round(this.toDeviceX(cssX - widthCss / 2));
      const right = Math.round(this.toDeviceX(cssX + widthCss / 2));
      const width = Math.max(1, right - left);
      const color = getColorComponents(this.colorCache, style, point.committed);

      pushRectTriangles(
        triangleVertices,
        left,
        0,
        width,
        fullHeight,
        color,
      );
    }
  }

  private appendShapeSeriesGeometry(
    series: IndicatorSeries,
    frame: ChartRenderFrame,
    triangleVertices: number[],
    pointVertices: number[],
    textCommands: SceneTextDrawCommand[],
  ) {
    const points = this.getCachedVisibleSeriesPoints(
      series,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      true,
    );

    for (const point of points) {
      if (!Number.isFinite(point.value)) {
        continue;
      }

      const style = { ...series.style, ...point.style };
      const shape = typeof style.shape === "string" ? style.shape : "circle";
      const cssX = frame.timeToX(point.time) + (typeof style.offsetX === "number" ? style.offsetX : 0);
      const cssY = frame.valueToY(point.value, series.scaleId) + (typeof style.offsetY === "number" ? style.offsetY : 0);
      const x = snapStrokeCoordinate(this.toDeviceX(cssX));
      const y = snapStrokeCoordinate(this.toDeviceY(cssY));
      const color = getColorComponents(this.colorCache, style, point.committed);
      const size = Math.max(4, getShapeSize(style) * this.devicePixelRatio);

      if (shape === "arrow-up" || shape === "arrow-down") {
        pushTriangleMarker(
          triangleVertices,
          x,
          y,
          size,
          shape === "arrow-up",
          color,
        );
      } else if (shape !== "none") {
        pointVertices.push(x, y, size, color[0], color[1], color[2], color[3]);
      }

      if (point.text) {
        textCommands.push({
          backgroundColor: "rgba(0, 0, 0, 0)",
          color: typeof style.color === "string" ? style.color : "#ffffff",
          fontSize: Math.max(8, getShapeSize(style)),
          opacity: point.committed ? 1 : 0.7,
          text: point.text,
          x: cssX,
          y: cssY + (shape === "none" ? 0 : Math.max(6, size / this.devicePixelRatio / 2 + 4)),
        });
      }
    }
  }

  private appendObjectGeometry(
    object: IndicatorObject,
    frame: ChartRenderFrame,
    triangleVertices: number[],
    panelCommands: ScenePanelDrawCommand[],
    textCommands: SceneTextDrawCommand[],
  ) {
    if (!this.isObjectVisible(object, frame.visibleTimeRange, frame.timeFrameMs)) {
      return;
    }

    if (object.kind === "panel") {
      panelCommands.push({
        accentColor:
          typeof object.style.accentColor === "string" ? object.style.accentColor : "",
        anchor: typeof object.style.anchor === "string" ? object.style.anchor : "top-right",
        backgroundColor:
          typeof object.style.backgroundColor === "string"
            ? object.style.backgroundColor
            : "rgba(10, 10, 10, 0.88)",
        color: typeof object.style.color === "string" ? object.style.color : "#f5f5f5",
        fontSize: typeof object.style.fontSize === "number" ? object.style.fontSize : 10,
        kind: "panel",
        opacity: object.committed ? 1 : 0.7,
        text: object.text ?? "",
        title:
          typeof object.style.title === "string"
            ? object.style.title
            : "",
      });
      return;
    }

    if (object.kind === "table") {
      const style = object.style;
      const cells = normalizeTableCells(style.cells);
      const merges = normalizeTableMerges(style.merges);
      const layout = computeTableLayout(
        {
          anchor: typeof style.anchor === "string" ? style.anchor : "top-right",
          cells,
          color: typeof style.color === "string" ? style.color : "#f5f5f5",
          columns: typeof style.columns === "number" ? style.columns : 1,
          fontSize: typeof style.fontSize === "number" ? style.fontSize : 10,
          merges,
          rows: typeof style.rows === "number" ? style.rows : 1,
        },
        frame,
        this.devicePixelRatio,
        this.spriteScratchContext,
      );

      if (!cells.length && object.text) {
        panelCommands.push({
          accentColor: "",
          anchor: typeof style.anchor === "string" ? style.anchor : "top-right",
          backgroundColor:
            typeof style.backgroundColor === "string"
              ? style.backgroundColor
              : "rgba(10, 10, 10, 0.88)",
          color: typeof style.color === "string" ? style.color : "#f5f5f5",
          fontSize: typeof style.fontSize === "number" ? style.fontSize : 10,
          kind: "panel",
          opacity: object.committed ? 1 : 0.7,
          text: object.text,
          title: `Table: ${typeof style.title === "string" ? style.title : ""}`.trim(),
        });
        return;
      }

      panelCommands.push({
        accentColor: "",
        anchor: typeof style.anchor === "string" ? style.anchor : "top-right",
        backgroundColor:
          typeof style.backgroundColor === "string"
            ? style.backgroundColor
            : "rgba(0, 0, 0, 0)",
        borderColor:
          typeof style.borderColor === "string" ? style.borderColor : undefined,
        borderWidth:
          typeof style.borderWidth === "number" ? style.borderWidth : undefined,
        cells,
        color: typeof style.color === "string" ? style.color : "#f5f5f5",
        columns: typeof style.columns === "number" ? style.columns : 1,
        fontSize: typeof style.fontSize === "number" ? style.fontSize : 10,
        frameColor:
          typeof style.frameColor === "string" ? style.frameColor : undefined,
        frameWidth:
          typeof style.frameWidth === "number" ? style.frameWidth : undefined,
        kind: "table",
        merges,
        opacity: object.committed ? 1 : 0.7,
        rows: typeof style.rows === "number" ? style.rows : 1,
        text: object.text ?? "",
        title:
          typeof style.title === "string"
            ? style.title
            : "",
      });

      if (layout) {
        const anchorPosition = getPanelAnchorPosition(
          typeof style.anchor === "string" ? style.anchor : "top-right",
          Math.max(1, Math.round(frame.plotWidth)),
          Math.max(1, Math.round(frame.plotHeight)),
          layout.width / this.devicePixelRatio,
          layout.height / this.devicePixelRatio,
          12,
        );

        for (const cell of layout.renderCells) {
          const leftCss = anchorPosition.x + cell.left / this.devicePixelRatio;
          const rightCss = anchorPosition.x + cell.right / this.devicePixelRatio;
          const topCss = anchorPosition.y + cell.textTop / this.devicePixelRatio;
          const align = normalizeHorizontalTextAlign(cell.textHAlign);
          const paddingCss = layout.horizontalPadding / this.devicePixelRatio;
          const x = align === "left"
            ? leftCss + paddingCss
            : align === "right"
              ? rightCss - paddingCss
              : (leftCss + rightCss) / 2;

          textCommands.push({
            align,
            backgroundColor: "rgba(0, 0, 0, 0)",
            color: cell.textColor,
            fontSize: cell.fontSize,
            opacity: object.committed ? 1 : 0.7,
            text: cell.lines.join("\n"),
            x,
            y: topCss,
          });
        }
      }
      return;
    }

    if (object.kind === "label") {
      const style = object.style;
      textCommands.push({
        backgroundColor:
          typeof style.backgroundColor === "string"
            ? style.backgroundColor
            : "rgba(0, 0, 0, 0.72)",
        color: typeof style.color === "string" ? style.color : "#ffffff",
        fontSize: typeof style.fontSize === "number" ? style.fontSize : 10,
        opacity: object.committed ? 1 : 0.7,
        text: object.text ?? "",
        x: frame.timeToX(object.time) + (typeof style.offsetX === "number" ? style.offsetX : 0),
          y: frame.valueToY(object.price, object.scaleId) + (typeof style.offsetY === "number" ? style.offsetY : 0),
      });
      return;
    }

    const style = object.style;

    if (object.kind === "candle") {
      const open = typeof style.open === "number" ? style.open : NaN;
      const high = typeof style.high === "number" ? style.high : NaN;
      const low = typeof style.low === "number" ? style.low : NaN;
      const close = typeof style.close === "number" ? style.close : NaN;

      if (
        !Number.isFinite(open)
        || !Number.isFinite(high)
        || !Number.isFinite(low)
        || !Number.isFinite(close)
      ) {
        return;
      }

      const candleX = this.toDeviceX(frame.timeToX(object.time));
      const valueToY = (value: number) => frame.valueToY(value, object.scaleId);
      const yOpen = this.toDeviceY(valueToY(open));
      const yClose = this.toDeviceY(valueToY(close));
      const yHigh = this.toDeviceY(valueToY(high));
      const yLow = this.toDeviceY(valueToY(low));
      const wickWidth = Math.max(1, this.devicePixelRatio);
      const bodyWidth = Math.max(wickWidth, Math.round(frame.pixelsPerBar * 0.75 * this.devicePixelRatio));
      const halfBodyWidth = bodyWidth / 2;
      const centerX = snapStrokeCoordinate(candleX, wickWidth);
      const bodyLeft = Math.round(candleX - halfBodyWidth);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
      const bodyColor = getColorComponents(
        this.colorCache,
        { color: typeof style.color === "string" ? style.color : "#2962ff" },
        object.committed,
      );
      const wickColor = getColorComponents(
        this.colorCache,
        { color: typeof style.wickColor === "string" ? style.wickColor : typeof style.color === "string" ? style.color : "#2962ff" },
        object.committed,
      );
      const borderColor = getColorComponents(
        this.colorCache,
        { color: typeof style.borderColor === "string" ? style.borderColor : typeof style.wickColor === "string" ? style.wickColor : typeof style.color === "string" ? style.color : "#2962ff" },
        object.committed,
      );
      const mode = style.mode === "bar" ? "bar" : "candle";

      pushLineSegmentTriangles(
        triangleVertices,
        centerX,
        snapStrokeCoordinate(yHigh, wickWidth),
        centerX,
        snapStrokeCoordinate(yLow, wickWidth),
        wickWidth,
        wickColor,
      );

      if (mode === "bar") {
        pushLineSegmentTriangles(
          triangleVertices,
          bodyLeft,
          snapStrokeCoordinate(yOpen, wickWidth),
          centerX,
          snapStrokeCoordinate(yOpen, wickWidth),
          wickWidth,
          borderColor,
        );
        pushLineSegmentTriangles(
          triangleVertices,
          centerX,
          snapStrokeCoordinate(yClose, wickWidth),
          bodyLeft + bodyWidth,
          snapStrokeCoordinate(yClose, wickWidth),
          wickWidth,
          borderColor,
        );
        return;
      }

      pushRectTriangles(
        triangleVertices,
        bodyLeft,
        Math.round(bodyTop),
        Math.max(1, bodyWidth),
        Math.max(1, Math.round(bodyHeight)),
        bodyColor,
      );
      pushLineSegmentTriangles(
        triangleVertices,
        bodyLeft,
        snapStrokeCoordinate(bodyTop, wickWidth),
        bodyLeft + bodyWidth,
        snapStrokeCoordinate(bodyTop, wickWidth),
        wickWidth,
        borderColor,
      );
      pushLineSegmentTriangles(
        triangleVertices,
        bodyLeft + bodyWidth,
        snapStrokeCoordinate(bodyTop, wickWidth),
        bodyLeft + bodyWidth,
        snapStrokeCoordinate(bodyTop + bodyHeight, wickWidth),
        wickWidth,
        borderColor,
      );
      pushLineSegmentTriangles(
        triangleVertices,
        bodyLeft + bodyWidth,
        snapStrokeCoordinate(bodyTop + bodyHeight, wickWidth),
        bodyLeft,
        snapStrokeCoordinate(bodyTop + bodyHeight, wickWidth),
        wickWidth,
        borderColor,
      );
      pushLineSegmentTriangles(
        triangleVertices,
        bodyLeft,
        snapStrokeCoordinate(bodyTop + bodyHeight, wickWidth),
        bodyLeft,
        snapStrokeCoordinate(bodyTop, wickWidth),
        wickWidth,
        borderColor,
      );
      return;
    }

    const strokeWidth = Math.max(1, getLineWidth(style) * this.devicePixelRatio);
    const screenX1 = frame.timeToX(object.time);
    const screenY1 = frame.valueToY(object.price, object.scaleId);
    const x1 = snapStrokeCoordinate(this.toDeviceX(screenX1), strokeWidth);
    const y1 = snapStrokeCoordinate(this.toDeviceY(screenY1), strokeWidth);
    let screenX2 = screenX1;
    let screenY2 = screenY1;
    let x2 = x1;
    let y2 = y1;

    if (object.kind === "polyline" || object.kind === "linefill") {
      const points = Array.isArray(style.points)
        ? style.points as Array<{ price?: number; time?: number }>
        : [];
      const color = getColorComponents(this.colorCache, style, object.committed);

      if (object.kind === "linefill") {
        if (points.length >= 4) {
          const p0 = points[0];
          const p1 = points[1];
          const p2 = points[2];
          const p3 = points[3];

          if (
            typeof p0.time === "number"
            && typeof p0.price === "number"
            && typeof p1.time === "number"
            && typeof p1.price === "number"
            && typeof p2.time === "number"
            && typeof p2.price === "number"
            && typeof p3.time === "number"
            && typeof p3.price === "number"
          ) {
            const x0 = this.toDeviceX(frame.timeToX(p0.time));
            const y0 = this.toDeviceY(frame.valueToY(p0.price, object.scaleId));
            const x1Fill = this.toDeviceX(frame.timeToX(p1.time));
            const y1Fill = this.toDeviceY(frame.valueToY(p1.price, object.scaleId));
            const x2Fill = this.toDeviceX(frame.timeToX(p2.time));
            const y2Fill = this.toDeviceY(frame.valueToY(p2.price, object.scaleId));
            const x3 = this.toDeviceX(frame.timeToX(p3.time));
            const y3 = this.toDeviceY(frame.valueToY(p3.price, object.scaleId));

            pushTriangleVertex(triangleVertices, x0, y0, color);
            pushTriangleVertex(triangleVertices, x1Fill, y1Fill, color);
            pushTriangleVertex(triangleVertices, x2Fill, y2Fill, color);
            pushTriangleVertex(triangleVertices, x0, y0, color);
            pushTriangleVertex(triangleVertices, x2Fill, y2Fill, color);
            pushTriangleVertex(triangleVertices, x3, y3, color);
          }
        }

        return;
      }

      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];

        if (
          typeof previous.time !== "number"
          || typeof previous.price !== "number"
          || typeof current.time !== "number"
          || typeof current.price !== "number"
        ) {
          continue;
        }

        const pointX1 = snapStrokeCoordinate(
          this.toDeviceX(frame.timeToX(previous.time)),
          strokeWidth,
        );
        const pointY1 = snapStrokeCoordinate(
          this.toDeviceY(frame.valueToY(previous.price, object.scaleId)),
          strokeWidth,
        );
        const pointX2 = snapStrokeCoordinate(
          this.toDeviceX(frame.timeToX(current.time)),
          strokeWidth,
        );
        const pointY2 = snapStrokeCoordinate(
          this.toDeviceY(frame.valueToY(current.price, object.scaleId)),
          strokeWidth,
        );

        if (style.dashed === true) {
          pushDashedLineSegmentTriangles(
            triangleVertices,
            pointX1,
            pointY1,
            pointX2,
            pointY2,
            strokeWidth,
            color,
            4 * this.devicePixelRatio,
            4 * this.devicePixelRatio,
          );
          continue;
        }

        pushLineSegmentTriangles(
          triangleVertices,
          pointX1,
          pointY1,
          pointX2,
          pointY2,
          strokeWidth,
          color,
        );
      }

      return;
    }

    if (object.kind === "ray") {
      const projectionTime = frame.visibleTimeRange.to + frame.timeFrameMs;
      screenX2 = Math.max(frame.plotRightX ?? frame.plotWidth, frame.timeToX(projectionTime));
      x2 = snapStrokeCoordinate(this.toDeviceX(screenX2), strokeWidth);
      y2 = y1;
    } else if (typeof object.endTime === "number") {
      screenX2 = frame.timeToX(object.endTime);
      screenY2 = frame.valueToY(object.endPrice ?? object.price, object.scaleId);
      x2 = snapStrokeCoordinate(this.toDeviceX(screenX2), strokeWidth);
      y2 = snapStrokeCoordinate(this.toDeviceY(screenY2), strokeWidth);
    }

    if (object.kind === "box") {
      const fillColor = getColorComponents(
        this.colorCache,
        {
          ...style,
          color:
            typeof style.backgroundColor === "string"
              ? style.backgroundColor
              : "rgba(47, 107, 255, 0.12)",
        },
        object.committed,
      );

      pushRectTriangles(
        triangleVertices,
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.abs(x2 - x1),
        Math.abs(y2 - y1),
        fillColor,
      );
    }

    if (style.dashed === true) {
      pushDashedLineSegmentTriangles(
        triangleVertices,
        x1,
        y1,
        x2,
        y2,
        strokeWidth,
        getColorComponents(this.colorCache, style, object.committed),
        4 * this.devicePixelRatio,
        4 * this.devicePixelRatio,
      );
      return;
    }

    const strokeColor = getColorComponents(this.colorCache, style, object.committed);

    if (object.kind === "box") {
      pushLineSegmentTriangles(triangleVertices, x1, y1, x2, y1, strokeWidth, strokeColor);
      pushLineSegmentTriangles(triangleVertices, x2, y1, x2, y2, strokeWidth, strokeColor);
      pushLineSegmentTriangles(triangleVertices, x2, y2, x1, y2, strokeWidth, strokeColor);
      pushLineSegmentTriangles(triangleVertices, x1, y2, x1, y1, strokeWidth, strokeColor);
      return;
    }

    pushLineSegmentTriangles(
      triangleVertices,
      x1,
      y1,
      x2,
      y2,
      strokeWidth,
      strokeColor,
    );
  }


  private createPairedFillPoints(
    upperPoints: VisibleSeriesPoint[],
    lowerPoints: VisibleSeriesPoint[],
    plotWidth: number,
  ) {
    const paired: PairedFillPoint[] = [];
    let upperIndex = 0;
    let lowerIndex = 0;

    while (upperIndex < upperPoints.length && lowerIndex < lowerPoints.length) {
      const upperPoint = upperPoints[upperIndex];
      const lowerPoint = lowerPoints[lowerIndex];

      if (upperPoint.time === lowerPoint.time) {
        paired.push({
          lower: lowerPoint,
          time: upperPoint.time,
          upper: upperPoint,
        });
        upperIndex += 1;
        lowerIndex += 1;
        continue;
      }

      if (upperPoint.time < lowerPoint.time) {
        upperIndex += 1;
      } else {
        lowerIndex += 1;
      }
    }

    const maxPoints = Math.max(
      64,
      Math.round(plotWidth * this.devicePixelRatio * MAX_POINTS_PER_PIXEL),
    );

    if (paired.length <= maxPoints) {
      return paired;
    }

    const stride = Math.max(1, Math.ceil(paired.length / maxPoints));
    const nextPaired: PairedFillPoint[] = [];

    for (let index = 0; index < paired.length; index += stride) {
      pushUniquePairedPoint(nextPaired, paired[index]);
    }

    pushUniquePairedPoint(nextPaired, paired[paired.length - 1]);
    return nextPaired;
  }

  private getCachedVisibleSeriesPoints(
    series: IndicatorSeries,
    visibleTimeRange: ReturnType<SceneHost["getVisibleTimeRange"]>,
    timeFrameMs: number,
    plotWidth: number,
    useDecimation: boolean,
  ) {
    const cacheKey = [
      this.viewportCacheKey,
      this.bundleVersion,
      series.indicatorId,
      series.id,
      useDecimation ? 1 : 0,
    ].join(":");
    const cached = this.visibleSeriesCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const nextPoints = getVisibleSeriesPoints(
      series,
      visibleTimeRange,
      timeFrameMs,
      useDecimation,
      plotWidth,
      this.devicePixelRatio,
    );

    this.visibleSeriesCache.set(cacheKey, nextPoints);
    return nextPoints;
  }

  private getCachedScreenPoints(
    series: IndicatorSeries,
    frame: ChartRenderFrame,
    useDecimation: boolean,
  ) {
    const cacheKey = [
      this.viewportCacheKey,
      this.bundleVersion,
      series.indicatorId,
      series.id,
      "screen",
      useDecimation ? 1 : 0,
    ].join(":");
    const cached = this.screenPointCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const points = this.getCachedVisibleSeriesPoints(
      series,
      frame.visibleTimeRange,
      frame.timeFrameMs,
      frame.plotWidth,
      useDecimation,
    );
    const screenPoints = toScreenPoints(points, frame, series.scaleId);

    this.screenPointCache.set(cacheKey, screenPoints);
    return screenPoints;
  }

  private isObjectVisible(
    object: IndicatorObject,
    visibleTimeRange: ReturnType<SceneHost["getVisibleTimeRange"]>,
    timeFrameMs: number,
  ) {
    if (object.kind === "panel" || object.kind === "table") {
      return true;
    }

    if (object.kind === "polyline" || object.kind === "linefill") {
      const points = Array.isArray(object.style.points)
        ? object.style.points as Array<{ time?: number }>
        : [];

      if (!points.length) {
        return false;
      }

      const rangeStart = Math.min(
        ...points
          .map((point) => (typeof point.time === "number" ? point.time : Number.POSITIVE_INFINITY)),
      );
      const rangeEnd = Math.max(
        ...points
          .map((point) => (typeof point.time === "number" ? point.time : Number.NEGATIVE_INFINITY)),
      );

      return (
        Number.isFinite(rangeStart)
        && Number.isFinite(rangeEnd)
        && rangeEnd >= visibleTimeRange.from - timeFrameMs
        && rangeStart <= visibleTimeRange.to + timeFrameMs
      );
    }

    if (object.kind === "ray") {
      return object.time <= visibleTimeRange.to + timeFrameMs;
    }

    if (typeof object.endTime === "number") {
      const rangeStart = Math.min(object.time, object.endTime);
      const rangeEnd = Math.max(object.time, object.endTime);

      return (
        rangeEnd >= visibleTimeRange.from - timeFrameMs &&
        rangeStart <= visibleTimeRange.to + timeFrameMs
      );
    }

    return (
      object.time >= visibleTimeRange.from - timeFrameMs &&
      object.time <= visibleTimeRange.to + timeFrameMs
    );
  }

  private getViewportCacheKey() {
    const visibleTimeRange = this.host.getVisibleTimeRange();

    return [
      this.bundleVersion,
      visibleTimeRange.from,
      visibleTimeRange.to,
      this.host.getTimeFrameMs(),
      this.host.getPixelsPerBar(),
      this.host.xToTime(this.host.getPlotOffsetX?.() ?? 0),
      this.host.getPlotWidth(),
      this.host.getPlotHeight(),
      this.devicePixelRatio,
    ].join(":");
  }


}

function getVisibleSeriesPoints(
  series: IndicatorSeries,
  visibleTimeRange: ReturnType<SceneHost["getVisibleTimeRange"]>,
  timeFrameMs: number,
  useDecimation: boolean,
  plotWidth: number,
  devicePixelRatio: number,
) {
  const points = series.points;

  if (!points.length) {
    return [] as VisibleSeriesPoint[];
  }

  const fromTime = visibleTimeRange.from - timeFrameMs;
  const toTime = visibleTimeRange.to + timeFrameMs;
  const startIndex = Math.max(0, lowerBoundSeriesPoint(points, fromTime) - 1);
  const endIndex = Math.min(points.length, upperBoundSeriesPoint(points, toTime) + 1);
  const visiblePoints = points.slice(startIndex, endIndex).map((point) => ({
    committed: point.committed,
    style: point.style,
    text: point.text,
    time: point.time,
    value: point.value,
  }));

  if (!useDecimation) {
    return visiblePoints;
  }

  if (series.kind === "plotshape") {
    return downsampleSparsePoints(
      visiblePoints,
      Math.max(24, Math.round(plotWidth * MAX_MARKERS_PER_PIXEL)),
    );
  }

  return downsampleLinePoints(
    visiblePoints,
    Math.max(64, Math.round(plotWidth * devicePixelRatio * MAX_POINTS_PER_PIXEL)),
  );
}

function lowerBoundSeriesPoint(
  points: IndicatorSeries["points"],
  target: number,
) {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = (low + high) >> 1;

    if (points[mid].time < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function upperBoundSeriesPoint(
  points: IndicatorSeries["points"],
  target: number,
) {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = (low + high) >> 1;

    if (points[mid].time <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function toScreenPoints(
  points: VisibleSeriesPoint[],
  frame: ChartRenderFrame,
  scaleId = "price",
) {
  const screenPoints: ChartSelectionPoint[] = [];

  for (const point of points) {
    if (!Number.isFinite(point.value)) {
      continue;
    }

    screenPoints.push({
      x: frame.timeToX(point.time),
      y: frame.valueToY(point.value, scaleId),
    });
  }

  return screenPoints;
}

function isPointInSelectionRectangle(
  point: ChartSelectionPoint,
  rectangle: ChartSelectionRectangle,
) {
  return (
    point.x >= rectangle.left &&
    point.x <= rectangle.right &&
    point.y >= rectangle.top &&
    point.y <= rectangle.bottom
  );
}

function segmentIntersectsSelectionRectangle(
  start: ChartSelectionPoint,
  end: ChartSelectionPoint,
  rectangle: ChartSelectionRectangle,
) {
  return (
    Math.min(start.x, end.x) <= rectangle.right &&
    Math.max(start.x, end.x) >= rectangle.left &&
    Math.min(start.y, end.y) <= rectangle.bottom &&
    Math.max(start.y, end.y) >= rectangle.top
  );
}

function sampleSelectionPoints(
  points: ChartSelectionPoint[],
  maxPoints: number,
) {
  if (points.length <= maxPoints) {
    return points;
  }

  const nextPoints: ChartSelectionPoint[] = [];
  const lastIndex = points.length - 1;

  for (let index = 0; index < maxPoints; index += 1) {
    const pointIndex = Math.round((index / Math.max(maxPoints - 1, 1)) * lastIndex);
    const point = points[pointIndex];
    const previous = nextPoints[nextPoints.length - 1];

    if (previous && previous.x === point.x && previous.y === point.y) {
      continue;
    }

    nextPoints.push(point);
  }

  return nextPoints;
}

function isPointNearPolyline(
  x: number,
  y: number,
  points: ChartSelectionPoint[],
  threshold: number,
) {
  if (points.length < 2) {
    return false;
  }

  const thresholdSquared = threshold * threshold;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    if (
      distanceSquaredToSegment(x, y, start.x, start.y, end.x, end.y)
      <= thresholdSquared
    ) {
      return true;
    }
  }

  return false;
}

function distanceSquaredToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    const pointDx = px - x1;
    const pointDy = py - y1;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)),
  );
  const projectedX = x1 + t * dx;
  const projectedY = y1 + t * dy;
  const distanceX = px - projectedX;
  const distanceY = py - projectedY;

  return distanceX * distanceX + distanceY * distanceY;
}

function distanceSquared(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  return dx * dx + dy * dy;
}

function getIndicatorObjectEndScreenPoint(
  object: IndicatorObject,
  frame: ChartRenderFrame,
) {
    if (object.kind === "polyline" || object.kind === "linefill") {
      const points = Array.isArray(object.style.points)
        ? object.style.points as Array<{ price?: number; time?: number }>
        : [];
    const lastPoint = points[points.length - 1];

    if (lastPoint && typeof lastPoint.time === "number" && typeof lastPoint.price === "number") {
      return {
        x: frame.timeToX(lastPoint.time),
        y: frame.valueToY(lastPoint.price, object.scaleId),
      };
    }
  }

  if (object.kind === "candle") {
    const close = typeof object.style.close === "number" ? object.style.close : object.price;

    return {
      x: frame.timeToX(object.time),
      y: frame.valueToY(close, object.scaleId),
    };
  }

  if (object.kind === "ray") {
    const projectionTime = frame.visibleTimeRange.to + frame.timeFrameMs;

    return {
      x: Math.max(frame.plotRightX ?? frame.plotWidth, frame.timeToX(projectionTime)),
      y: frame.valueToY(object.price, object.scaleId),
    };
  }

  if (typeof object.endTime === "number") {
    return {
      x: frame.timeToX(object.endTime),
      y: frame.valueToY(object.endPrice ?? object.price, object.scaleId),
    };
  }

  return {
    x: frame.timeToX(object.time),
    y: frame.valueToY(object.price, object.scaleId),
  };
}

function downsampleLinePoints(
  points: VisibleSeriesPoint[],
  maxPoints: number,
) {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = Math.max(1, Math.ceil(points.length / maxPoints));
  const nextPoints: VisibleSeriesPoint[] = [];

  for (let index = 0; index < points.length; index += stride) {
    pushUniqueVisiblePoint(nextPoints, points[index]);
  }

  pushUniqueVisiblePoint(nextPoints, points[points.length - 1]);
  return nextPoints;
}

function downsampleSparsePoints(
  points: VisibleSeriesPoint[],
  maxPoints: number,
) {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = Math.max(1, Math.ceil(points.length / maxPoints));
  const nextPoints: VisibleSeriesPoint[] = [];

  for (let index = 0; index < points.length; index += stride) {
    nextPoints.push(points[index]);
  }

  if (nextPoints[nextPoints.length - 1] !== points[points.length - 1]) {
    nextPoints.push(points[points.length - 1]);
  }

  return nextPoints;
}

function pushUniqueVisiblePoint(
  points: VisibleSeriesPoint[],
  nextPoint: VisibleSeriesPoint,
) {
  const previous = points[points.length - 1];

  if (
    previous
    && previous.time === nextPoint.time
    && previous.value === nextPoint.value
  ) {
    return;
  }

  points.push(nextPoint);
}

function pushUniquePairedPoint(
  points: PairedFillPoint[],
  nextPoint: PairedFillPoint,
) {
  const previous = points[points.length - 1];

  if (
    previous
    && previous.time === nextPoint.time
    && previous.upper.value === nextPoint.upper.value
    && previous.lower.value === nextPoint.lower.value
  ) {
    return;
  }

  points.push(nextPoint);
}

function getLineWidth(style: Record<string, unknown>) {
  return typeof style.width === "number" ? style.width : 1;
}

function getShapeSize(style: Record<string, unknown>) {
  return typeof style.size === "number" ? style.size : 10;
}

function getColorComponents(
  cache: Map<string, [number, number, number, number]>,
  style: Record<string, unknown>,
  committed: boolean,
): [number, number, number, number] {
  const color = typeof style.color === "string" ? style.color : "#ffffff";
  const opacity = (typeof style.opacity === "number" ? style.opacity : 1) * (committed ? 1 : 0.7);
  return parseColor(cache, color, opacity);
}
