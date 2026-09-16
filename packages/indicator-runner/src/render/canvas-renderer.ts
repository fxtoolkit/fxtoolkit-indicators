/**
 * Standalone Canvas2D indicator surface.
 *
 * Ported from orion `src/library/models/chart/components/scene/canvas-scene-renderer.ts`.
 *
 * Changes from Orion:
 *   - It renders **indicator layers only**. Orion's renderer also dispatches plot and drawing
 *     layers, which belong to its chart/document model and have no counterpart here.
 *   - It draws into a canvas the host owns (or that the mounting layer created) rather than one it
 *     inserts into a Konva stage; sizes come from an injected provider.
 *   - The layer cache is keyed by bundle id instead of a global layer-order item.
 *   - Geometry replay (`drawTriangleBatch`, `drawPointBatch`, text/panel/table drawing) is a
 *     faithful port, unchanged.
 */

import type {
  IndicatorRenderBundle,
} from "@fxtoolkit/indicator-stdlib/abi";
import type {
  ChartPlotExtents,
  ChartRenderFrame,
  ChartRenderPerformanceSnapshot,
} from "../model/types";
import type {
  IndicatorLayerGeometry,
  IndicatorRenderer,
} from "./renderer";
import {
  getPreferred2DContext,
  getPreferredCanvasPixelRatio,
} from "../utils/canvas";
import IndicatorSceneAdapter from "./indicator-scene-adapter";
import { createFrameSceneHost } from "./scene-host";
import {
  computeTableLayout,
  getPanelAnchorPosition,
  measureTextLines,
} from "./scene-command-utils";
import type {
  ScenePanelDrawCommand,
  SceneTextDrawCommand,
} from "./scene-commands";

interface CanvasLayerGeometryRecord {
  key: string;
  panelCommands: ScenePanelDrawCommand[];
  pointData: Float32Array;
  textCommands: SceneTextDrawCommand[];
  triangleData: Float32Array;
}

export interface IndicatorCanvasRendererOptions {
  canvas: HTMLCanvasElement;
  /** CSS size the canvas covers. Defaults to the canvas' own client box. */
  getSize?: () => { height: number; width: number };
  /** Overrides device-pixel-ratio detection (tests pass 1 for deterministic geometry). */
  pixelRatio?: number;
}

const MAX_CANVAS_PIXEL_RATIO = 2;
const INDICATOR_LAYER_PREFIX = "indicator:";

export default class IndicatorCanvasRenderer implements IndicatorRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly scratchCanvas: HTMLCanvasElement;
  private readonly scratchContext: CanvasRenderingContext2D;
  private readonly indicatorAdapter: IndicatorSceneAdapter;
  private readonly getSize: () => { height: number; width: number };
  private readonly fixedPixelRatio: number | null;
  private readonly layerGeometryCache = new Map<string, CanvasLayerGeometryRecord>();
  private readonly layerVersions = new Map<string, number>();
  private readonly colorCache = new Map<string, [number, number, number, number]>();
  private readonly performanceMetrics: ChartRenderPerformanceSnapshot = {
    bufferUploads: 0,
    drawCalls: 0,
    geometryCacheHits: 0,
    geometryRebuilds: 0,
    lastRenderMs: 0,
    renderedVertices: 0,
  };
  private bundles: IndicatorRenderBundle[] = [];
  private currentFrame: ChartRenderFrame | null = null;
  private devicePixelRatio = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private viewportCacheKey = "";

  constructor(options: IndicatorCanvasRendererOptions) {
    const context = getPreferred2DContext(options.canvas);
    const scratchCanvas = document.createElement("canvas");
    const scratchContext = getPreferred2DContext(scratchCanvas);

    if (!context || !scratchContext) {
      throw new Error("Failed to create the indicator canvas renderer");
    }

    this.canvas = options.canvas;
    this.context = context;
    this.scratchCanvas = scratchCanvas;
    this.scratchContext = scratchContext;
    this.fixedPixelRatio = options.pixelRatio ?? null;
    this.getSize = options.getSize ??
      (() => ({
        height: this.canvas.clientHeight || this.canvas.height,
        width: this.canvas.clientWidth || this.canvas.width,
      }));
    this.indicatorAdapter = new IndicatorSceneAdapter(
      createFrameSceneHost(() => this.currentFrame),
      scratchContext,
    );
  }

  destroy() {
    this.indicatorAdapter.destroy();
    this.layerGeometryCache.clear();
    this.layerVersions.clear();
    this.colorCache.clear();
    this.bundles = [];
    this.currentFrame = null;
    // Release the scratch backing store; the canvas is held only for its 2D context.
    this.scratchCanvas.width = 0;
    this.scratchCanvas.height = 0;
  }

  getPerformanceSnapshot(): ChartRenderPerformanceSnapshot {
    return { ...this.performanceMetrics };
  }

  getVisiblePriceExtents(frame?: ChartRenderFrame): ChartPlotExtents | null {
    if (frame) {
      this.currentFrame = frame;
    }

    return this.indicatorAdapter.getVisiblePriceExtents();
  }

  getLayerGeometry(indicatorId: string): IndicatorLayerGeometry | null {
    return (
      this.layerGeometryCache.get(INDICATOR_LAYER_PREFIX + indicatorId) ?? null
    );
  }

  setBundles(bundles: IndicatorRenderBundle[]) {
    this.bundles = bundles;

    // Always invalidate. The documented realtime pattern is to mutate bundles in place through
    // `applyIndicatorBundleDelta`, which object-identity comparison cannot detect — so an
    // identity check here silently served stale geometry. Calling `setBundles` already means
    // "the indicator output changed"; rebuilding geometry is the correct response.
    //
    // The adapter owns the visible-extents cache the price domain is built from, so it has to
    // learn about the change before anything asks for extents.
    this.indicatorAdapter.updateBundles(
      bundles,
      new Set(bundles.map((bundle) => bundle.id)),
    );

    for (const bundle of bundles) {
      this.markLayerDirty(bundle.id);
    }

    this.pruneLayerGeometry(bundles);
  }

  render(frame: ChartRenderFrame) {
    const renderStartedAt = performance.now();
    this.currentFrame = frame;
    this.ensureCanvasSize();
    const { plotHeight, plotWidth } = frame;

    if (plotWidth <= 0 || plotHeight <= 0 || !this.bundles.length) {
      this.canvas.style.display = "none";
      this.clearCanvas();
      this.performanceMetrics.lastRenderMs = performance.now() - renderStartedAt;
      return;
    }

    this.canvas.style.display = "block";
    this.clearCanvas();
    this.context.save();
    this.clipToPlot(
      plotWidth,
      plotHeight,
      frame.plotOffsetX,
    );

    this.updateViewportCacheKey(frame);

    for (const bundle of this.bundles) {
      const layerKey = INDICATOR_LAYER_PREFIX + bundle.id;
      const geometryKey = [
        this.viewportCacheKey,
        this.layerVersions.get(layerKey) ?? 0,
      ].join(":");
      let geometry = this.layerGeometryCache.get(layerKey);

      if (!geometry || geometry.key !== geometryKey) {
        const triangleVertices: number[] = [];
        const pointVertices: number[] = [];
        const panelCommands: ScenePanelDrawCommand[] = [];
        const textCommands: SceneTextDrawCommand[] = [];

        this.indicatorAdapter.appendGeometry(
          bundle,
          frame,
          triangleVertices,
          pointVertices,
          panelCommands,
          textCommands,
          false,
        );

        geometry = {
          key: geometryKey,
          panelCommands,
          pointData: new Float32Array(pointVertices),
          textCommands,
          triangleData: new Float32Array(triangleVertices),
        };
        this.layerGeometryCache.set(layerKey, geometry);
        this.performanceMetrics.geometryRebuilds += 1;
      } else {
        this.performanceMetrics.geometryCacheHits += 1;
      }

      this.drawTriangleBatch(geometry.triangleData);
      this.drawPointBatch(geometry.pointData);

      for (const command of geometry.panelCommands) {
        this.drawPanelCommand(command, frame);
      }

      for (const command of geometry.textCommands) {
        this.drawTextCommand(command);
      }
    }

    this.context.restore();
    this.performanceMetrics.lastRenderMs = performance.now() - renderStartedAt;
  }

  private markLayerDirty(indicatorId: string) {
    const key = INDICATOR_LAYER_PREFIX + indicatorId;
    this.layerVersions.set(key, (this.layerVersions.get(key) ?? 0) + 1);
    this.layerGeometryCache.delete(key);
  }

  private pruneLayerGeometry(bundles: readonly IndicatorRenderBundle[]) {
    const activeKeys = new Set(
      bundles.map((bundle) => INDICATOR_LAYER_PREFIX + bundle.id),
    );

    for (const key of [...this.layerGeometryCache.keys()]) {
      if (!activeKeys.has(key)) {
        this.layerGeometryCache.delete(key);
        this.layerVersions.delete(key);
      }
    }
  }

  private ensureCanvasSize() {
    const size = this.getSize();
    const nextCssWidth = Math.max(1, Math.round(size.width));
    const nextCssHeight = Math.max(1, Math.round(size.height));
    const nextPixelRatio = this.fixedPixelRatio ??
      getPreferredCanvasPixelRatio(MAX_CANVAS_PIXEL_RATIO);

    if (
      this.cssWidth === nextCssWidth
      && this.cssHeight === nextCssHeight
      && this.devicePixelRatio === nextPixelRatio
    ) {
      return;
    }

    this.cssWidth = nextCssWidth;
    this.cssHeight = nextCssHeight;
    this.devicePixelRatio = nextPixelRatio;

    // Geometry buffers are produced in device pixels (toDeviceX/Y), so the
    // context draws 1:1 into a device-sized canvas with no CSS scaling math.
    this.canvas.width = Math.max(1, Math.round(nextCssWidth * nextPixelRatio));
    this.canvas.height = Math.max(1, Math.round(nextCssHeight * nextPixelRatio));
    this.canvas.style.width = `${nextCssWidth}px`;
    this.canvas.style.height = `${nextCssHeight}px`;
    this.viewportCacheKey = "";
    this.indicatorAdapter.setDevicePixelRatio(this.devicePixelRatio);
    this.indicatorAdapter.resetCaches();
  }

  private updateViewportCacheKey(frame: ChartRenderFrame) {
    this.viewportCacheKey = [
      frame.visibleTimeRange.from,
      frame.visibleTimeRange.to,
      frame.visiblePriceRange.from,
      frame.visiblePriceRange.to,
      ...[...frame.yScales.entries()].flatMap(([id, scale]) => [
        id,
        scale.domain.from,
        scale.domain.to,
      ]),
      frame.pixelsPerBar,
      frame.timeFrameMs,
      frame.timeOrigin,
      frame.plotWidth,
      frame.plotHeight,
      this.devicePixelRatio,
    ].join(":");
  }

  private clearCanvas() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private clipToPlot(plotWidth: number, plotHeight: number, plotOffsetX: number) {
    this.context.beginPath();
    this.context.rect(
      Math.round(plotOffsetX * this.devicePixelRatio),
      Math.max(
        0,
        this.canvas.height - Math.round(plotHeight * this.devicePixelRatio),
      ),
      Math.max(1, Math.round(plotWidth * this.devicePixelRatio)),
      Math.max(1, Math.round(plotHeight * this.devicePixelRatio)),
    );
    this.context.clip();
  }

  private toDeviceX(x: number) {
    return x * this.devicePixelRatio;
  }

  private toDeviceY(y: number) {
    return y * this.devicePixelRatio;
  }

  private drawTriangleBatch(data: Float32Array) {
    const triangleCount = data.length / 18;

    if (!triangleCount) {
      return;
    }

    this.context.beginPath();
    let currentFillStyle: string | null = null;
    let pathVertexCount = 0;

    for (let index = 0; index < triangleCount; index += 1) {
      const colorOffset = index * 18 + 2;
      const color = formatSceneColor(data, colorOffset);

      if (color !== currentFillStyle) {
        if (pathVertexCount) {
          this.context.fill();
        }
        this.context.fillStyle = color;
        currentFillStyle = color;
        this.context.beginPath();
        pathVertexCount = 0;
      }

      const vertexOffset = index * 18;
      this.context.moveTo(data[vertexOffset], data[vertexOffset + 1]);
      this.context.lineTo(data[vertexOffset + 6], data[vertexOffset + 7]);
      this.context.lineTo(data[vertexOffset + 12], data[vertexOffset + 13]);
      pathVertexCount += 3;
      this.performanceMetrics.drawCalls += 1;
    }

    if (pathVertexCount) {
      this.context.fill();
    }
    this.performanceMetrics.renderedVertices += triangleCount * 3;
  }

  private drawPointBatch(data: Float32Array) {
    const pointCount = data.length / 7;

    for (let index = 0; index < pointCount; index += 1) {
      const vertexOffset = index * 7;
      const x = data[vertexOffset];
      const y = data[vertexOffset + 1];
      const size = data[vertexOffset + 2];

      this.context.beginPath();
      this.context.fillStyle = formatSceneColor(data, vertexOffset + 3);
      this.context.arc(x, y, Math.max(0.5, size / 2), 0, Math.PI * 2);
      this.context.fill();
      this.performanceMetrics.drawCalls += 1;
    }

    this.performanceMetrics.renderedVertices += pointCount;
  }

  private drawTextCommand(command: SceneTextDrawCommand) {
    if (!command.text.length) {
      return;
    }

    const lines = command.text.split("\n");
    const textAlign = command.align ?? "center";
    const fontSize = Math.max(1, Math.round(command.fontSize * this.devicePixelRatio));
    const paddingX = Math.max(1, Math.round(6 * this.devicePixelRatio));
    const paddingY = Math.max(1, Math.round(4 * this.devicePixelRatio));
    const lineGap = Math.max(1, Math.round(2 * this.devicePixelRatio));
    const font = `${fontSize}px Arial`;
    const metrics = measureTextLines(this.scratchContext, lines, font);
    const width = Math.max(1, Math.ceil(metrics.width + paddingX * 2));
    const height = Math.max(
      1,
      Math.ceil(
        metrics.lineHeight * lines.length
        + lineGap * Math.max(lines.length - 1, 0)
        + paddingY * 2,
      ),
    );
    const x = Math.round(
      textAlign === "left"
        ? this.toDeviceX(command.x)
        : textAlign === "right"
          ? this.toDeviceX(command.x) - width
          : this.toDeviceX(command.x) - width / 2,
    );
    const y = Math.round(this.toDeviceY(command.y));
    const context = this.context;

    context.save();
    context.globalAlpha = command.opacity;

    if (command.backgroundColor !== "rgba(0, 0, 0, 0)") {
      drawRoundedRectPath(context, x, y, width, height, Math.max(1, Math.round(4 * this.devicePixelRatio)));
      context.fillStyle = command.backgroundColor;
      context.fill();
    }

    context.font = font;
    context.textAlign = textAlign;
    context.textBaseline = "alphabetic";
    context.fillStyle = command.color;
    const textX = textAlign === "left"
      ? x + paddingX
      : textAlign === "right"
        ? x + width - paddingX
        : x + width / 2;

    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(
        lines[index],
        textX,
        y + paddingY + metrics.ascent + index * (metrics.lineHeight + lineGap),
      );
    }

    context.restore();
  }

  private drawPanelCommand(
    command: ScenePanelDrawCommand,
    frame: ChartRenderFrame,
  ) {
    if (command.kind === "table") {
      this.drawTableCommand(command, frame);
      return;
    }

    this.drawPanelBoxCommand(command, frame);
  }

  private drawTableCommand(
    command: ScenePanelDrawCommand,
    frame: ChartRenderFrame,
  ) {
    const layout = computeTableLayout(
      command,
      frame,
      this.devicePixelRatio,
      this.scratchContext,
    );

    if (!layout) {
      return;
    }

    const width = layout.width;
    const height = layout.height;
    const { x, y } = getPanelAnchorPosition(
      command.anchor,
      Math.max(1, Math.round(frame.plotWidth)),
      Math.max(1, Math.round(frame.plotHeight)),
      width / this.devicePixelRatio,
      height / this.devicePixelRatio,
      12,
    );
    const originX = Math.round(this.toDeviceX(x));
    const originY = Math.round(this.toDeviceY(y));
    const context = this.context;

    context.save();
    context.globalAlpha = command.opacity;

    if (command.backgroundColor !== "rgba(0, 0, 0, 0)") {
      context.fillStyle = command.backgroundColor;
      context.fillRect(originX, originY, width, height);
    }

    const borderColor = command.borderColor ?? command.frameColor ?? command.color;
    const borderWidth = Math.max(
      0,
      Math.round((command.borderWidth ?? 0) * this.devicePixelRatio),
    );

    for (const cell of layout.renderCells) {
      const left = originX + cell.left;
      const top = originY + cell.top;
      const right = originX + cell.right;
      const bottom = originY + cell.bottom;
      const cellWidth = right - left;
      const cellHeight = bottom - top;

      if (cell.backgroundColor !== "rgba(0, 0, 0, 0)") {
        context.fillStyle = cell.backgroundColor;
        context.fillRect(left, top, cellWidth, cellHeight);
      }

      if (borderColor.length && borderWidth > 0) {
        context.strokeStyle = borderColor;
        context.lineWidth = borderWidth;
        context.strokeRect(
          left + borderWidth / 2,
          top + borderWidth / 2,
          Math.max(0, cellWidth - borderWidth),
          Math.max(0, cellHeight - borderWidth),
        );
      }
    }

    const frameColor = command.frameColor ?? "";
    const frameWidth = Math.max(
      0,
      Math.round((command.frameWidth ?? 0) * this.devicePixelRatio),
    );

    if (frameColor.length && frameWidth > 0) {
      context.strokeStyle = frameColor;
      context.lineWidth = frameWidth;
      context.strokeRect(
        originX + frameWidth / 2,
        originY + frameWidth / 2,
        Math.max(0, width - frameWidth),
        Math.max(0, height - frameWidth),
      );
    }

    context.restore();
  }

  private drawPanelBoxCommand(
    command: ScenePanelDrawCommand,
    frame: ChartRenderFrame,
  ) {
    const title = command.title.trim();
    const bodyLines = command.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!title.length && !bodyLines.length) {
      return;
    }

    const titleFontSize = Math.max(1, Math.round(Math.max(command.fontSize + 1, 11) * this.devicePixelRatio));
    const bodyFontSize = Math.max(1, Math.round(command.fontSize * this.devicePixelRatio));
    const horizontalPadding = Math.max(1, Math.round(12 * this.devicePixelRatio));
    const verticalPadding = Math.max(1, Math.round(10 * this.devicePixelRatio));
    const blockGap = title.length && bodyLines.length ? Math.max(1, Math.round(4 * this.devicePixelRatio)) : 0;
    const bodyLineGap = Math.max(1, Math.round(4 * this.devicePixelRatio));
    const titleFont = `600 ${titleFontSize}px Arial`;
    const bodyFont = `400 ${bodyFontSize}px Arial`;
    const titleMetrics = title.length
      ? measureTextLines(this.scratchContext, [title], titleFont)
      : null;
    const bodyMetrics = bodyLines.length
      ? measureTextLines(this.scratchContext, bodyLines, bodyFont)
      : null;
    const width = Math.max(
      1,
      Math.ceil(
        Math.max(titleMetrics?.width ?? 0, bodyMetrics?.width ?? 0) + horizontalPadding * 2,
      ),
    );
    const bodyHeight = bodyMetrics
      ? bodyMetrics.lineHeight * bodyLines.length + bodyLineGap * Math.max(bodyLines.length - 1, 0)
      : 0;
    const height = Math.max(
      1,
      Math.ceil(
        verticalPadding * 2
        + (titleMetrics ? titleMetrics.lineHeight : 0)
        + bodyHeight
        + blockGap,
      ),
    );
    const { x, y } = getPanelAnchorPosition(
      command.anchor,
      Math.max(1, Math.round(frame.plotWidth)),
      Math.max(1, Math.round(frame.plotHeight)),
      width / this.devicePixelRatio,
      height / this.devicePixelRatio,
      12,
    );
    const originX = Math.round(this.toDeviceX(x));
    const originY = Math.round(this.toDeviceY(y));
    const context = this.context;

    context.save();
    context.globalAlpha = command.opacity;
    drawRoundedRectPath(
      context,
      originX,
      originY,
      width,
      height,
      Math.max(1, Math.round(8 * this.devicePixelRatio)),
    );
    context.fillStyle = command.backgroundColor;
    context.fill();

    let currentY = originY + verticalPadding;

    if (titleMetrics) {
      context.font = titleFont;
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = command.accentColor.length ? command.accentColor : command.color;
      context.fillText(title, originX + horizontalPadding, currentY + titleMetrics.ascent);
      currentY += titleMetrics.lineHeight + blockGap;
    }

    if (bodyMetrics) {
      context.font = bodyFont;
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = command.color;

      for (let index = 0; index < bodyLines.length; index += 1) {
        context.fillText(
          bodyLines[index],
          originX + horizontalPadding,
          currentY + bodyMetrics.ascent + index * (bodyMetrics.lineHeight + bodyLineGap),
        );
      }
    }

    context.restore();
  }
}

function formatSceneColor(data: Float32Array, offset: number) {
  const red = Math.round(Math.max(0, Math.min(1, data[offset])) * 255);
  const green = Math.round(Math.max(0, Math.min(1, data[offset + 1])) * 255);
  const blue = Math.round(Math.max(0, Math.min(1, data[offset + 2])) * 255);
  const alpha = Math.max(0, Math.min(1, data[offset + 3]));

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const resolvedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - resolvedRadius, y + height);
  context.lineTo(x + resolvedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.quadraticCurveTo(x, y, x + resolvedRadius, y);
  context.closePath();
}
