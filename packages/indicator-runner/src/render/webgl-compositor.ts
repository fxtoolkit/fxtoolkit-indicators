// Ported from orion src/library/models/chart/components/scene/scene-webgl-compositor.ts
//
// Changes from Orion:
//   - It draws **indicator layers only**; plot and drawing layer dispatch belongs to Orion's
//     chart/document model.
//   - It renders into a host-owned canvas instead of one it creates and inserts into a Konva stage.
//   - The chart dependency is the `SceneHost` seam (see ./scene-host).
//   - Layer keys derive from indicator ids rather than a global layer-order item.
//   - The GL program/texture/buffer machinery is unchanged.

import type { IndicatorRenderBundle } from "@fxtoolkit/indicator-stdlib/abi";
import {
  computeTableLayout,
  getPanelAnchorPosition,
  measureTextLines,
} from "./scene-command-utils";
import type {
  ScenePanelDrawCommand,
  SceneTextDrawCommand,
} from "./scene-commands";
import type {
  ChartPlotExtents,
  ChartRenderFrame,
  ChartRenderPerformanceSnapshot,
  ChartSelectionRectangle,
} from "../model/types";
import {
  getPreferred2DContext,
  getPreferredCanvasPixelRatio,
  getPreferredWebGLContext,
} from "../utils/canvas";
import IndicatorSceneAdapter from "./indicator-scene-adapter";
import type {
  IndicatorLayerGeometry,
  IndicatorRenderer,
} from "./renderer";
import { createFrameSceneHost } from "./scene-host";

interface SpriteDrawCommand {
  height: number;
  opacity: number;
  texture: WebGLTexture;
  width: number;
  x: number;
  y: number;
}

interface SpriteTextureRecord {
  height: number;
  texture: WebGLTexture;
  width: number;
  key: string;
};

interface LayerGeometryRecord {
  key: string;
  panelCommands: ScenePanelDrawCommand[];
  pointData: Float32Array;
  textCommands: SceneTextDrawCommand[];
  triangleData: Float32Array;
}

interface LayerBufferRecord {
  pointBuffer: WebGLBuffer;
  pointUploadKey: string;
  triangleBuffer: WebGLBuffer;
  triangleUploadKey: string;
}

interface PrimitiveProgramBindings {
  color: number;
  position: number;
  resolution: WebGLUniformLocation | null;
}

interface PointProgramBindings extends PrimitiveProgramBindings {
  size: number;
}

interface SpriteProgramBindings {
  opacity: WebGLUniformLocation | null;
  position: number;
  resolution: WebGLUniformLocation | null;
  texCoord: number;
  texture: WebGLUniformLocation | null;
}

const MAX_CANVAS_PIXEL_RATIO = 2;
const INDICATOR_LAYER_PREFIX = "indicator:";

export interface WebGLCompositorOptions {
  canvas: HTMLCanvasElement;
  /** CSS size the canvas covers. Defaults to the canvas' own client box. */
  getSize?: () => { height: number; width: number };
  /** Overrides device-pixel-ratio detection (tests pass 1 for deterministic geometry). */
  pixelRatio?: number;
}

export default class SceneWebGLCompositor implements IndicatorRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly primitiveProgram: WebGLProgram;
  private readonly pointProgram: WebGLProgram;
  private readonly spriteProgram: WebGLProgram;
  private readonly primitiveBindings: PrimitiveProgramBindings;
  private readonly pointBindings: PointProgramBindings;
  private readonly spriteBindings: SpriteProgramBindings;
  private readonly spriteBuffer: WebGLBuffer;
  private readonly spriteVertexData = new Float32Array(24);
  private readonly spriteScratchCanvas = document.createElement("canvas");
  private readonly spriteScratchContext: CanvasRenderingContext2D;
  private readonly indicatorAdapter: IndicatorSceneAdapter;
  private readonly spriteTextureCache = new Map<string, SpriteTextureRecord>();
  private readonly layerBuffers = new Map<string, LayerBufferRecord>();
  private readonly layerGeometryCache = new Map<string, LayerGeometryRecord>();
  private readonly layerVersions = new Map<string, number>();
  private readonly performanceMetrics: ChartRenderPerformanceSnapshot = {
    bufferUploads: 0,
    drawCalls: 0,
    geometryCacheHits: 0,
    geometryRebuilds: 0,
    lastRenderMs: 0,
    renderedVertices: 0,
  };
  private cssHeight = 0;
  private cssWidth = 0;
  private devicePixelRatio = 1;
  private viewportCacheKey = "";
  private bundles: IndicatorRenderBundle[] = [];
  private currentFrame: ChartRenderFrame | null = null;
  private readonly getSize: () => { height: number; width: number };
  private readonly fixedPixelRatio: number | null;

  constructor(options: WebGLCompositorOptions) {
    this.canvas = options.canvas;
    this.fixedPixelRatio = options.pixelRatio ?? null;
    this.getSize = options.getSize ??
      (() => ({
        height: this.canvas.clientHeight || this.canvas.height,
        width: this.canvas.clientWidth || this.canvas.width,
      }));

    const gl = getPreferredWebGLContext(this.canvas);

    if (!gl) {
      throw new Error("Failed to create WebGL indicator compositor context");
    }

    const spriteScratchContext = getPreferred2DContext(this.spriteScratchCanvas);

    if (!spriteScratchContext) {
      throw new Error("Failed to create sprite scratch canvas context");
    }

    this.gl = gl;
    this.spriteScratchContext = spriteScratchContext;
    this.indicatorAdapter = new IndicatorSceneAdapter(
      createFrameSceneHost(() => this.currentFrame),
      this.spriteScratchContext,
    );
    this.primitiveProgram = createPrimitiveProgram(gl);
    this.pointProgram = createPointProgram(gl);
    this.spriteProgram = createSpriteProgram(gl);
    this.primitiveBindings = {
      color: gl.getAttribLocation(this.primitiveProgram, "a_color"),
      position: gl.getAttribLocation(this.primitiveProgram, "a_position"),
      resolution: gl.getUniformLocation(this.primitiveProgram, "u_resolution"),
    };
    this.pointBindings = {
      color: gl.getAttribLocation(this.pointProgram, "a_color"),
      position: gl.getAttribLocation(this.pointProgram, "a_position"),
      resolution: gl.getUniformLocation(this.pointProgram, "u_resolution"),
      size: gl.getAttribLocation(this.pointProgram, "a_size"),
    };
    this.spriteBindings = {
      opacity: gl.getUniformLocation(this.spriteProgram, "u_opacity"),
      position: gl.getAttribLocation(this.spriteProgram, "a_position"),
      resolution: gl.getUniformLocation(this.spriteProgram, "u_resolution"),
      texCoord: gl.getAttribLocation(this.spriteProgram, "a_texCoord"),
      texture: gl.getUniformLocation(this.spriteProgram, "u_texture"),
    };
    this.spriteBuffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.spriteVertexData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  destroy() {
    this.indicatorAdapter.destroy();
    this.gl.deleteBuffer(this.spriteBuffer);
    for (const buffers of this.layerBuffers.values()) {
      this.gl.deleteBuffer(buffers.triangleBuffer);
      this.gl.deleteBuffer(buffers.pointBuffer);
    }
    this.layerBuffers.clear();
    this.layerGeometryCache.clear();
    this.gl.deleteProgram(this.primitiveProgram);
    this.gl.deleteProgram(this.pointProgram);
    this.gl.deleteProgram(this.spriteProgram);
    for (const record of this.spriteTextureCache.values()) {
      this.gl.deleteTexture(record.texture);
    }
    this.spriteTextureCache.clear();
    this.bundles = [];
    this.currentFrame = null;
    // Release the scratch backing stores; the canvases are held only for their 2D contexts.
    this.spriteScratchCanvas.width = 0;
    this.spriteScratchCanvas.height = 0;
  }

  setIndicatorStackOrder(indicatorId: string, order: number) {
    this.indicatorAdapter.setStackOrder(indicatorId, order);
  }

  setBundles(bundles: IndicatorRenderBundle[]) {
    const previousIds = new Set(this.bundles.map((bundle) => bundle.id));

    this.bundles = bundles;

    // Always invalidate — see the note in canvas-renderer.setBundles: in-place mutation through
    // `applyIndicatorBundleDelta` is the documented realtime pattern and identity comparison
    // cannot see it.
    for (const bundle of bundles) {
      this.markLayerDirty(bundle.id);
    }

    const changedIndicatorIds = new Set(bundles.map((bundle) => bundle.id));

    // Removed indicators keep their dirty marker so their buffers are pruned below.
    for (const indicatorId of previousIds) {
      if (!bundles.some((bundle) => bundle.id === indicatorId)) {
        this.markLayerDirty(indicatorId);
        changedIndicatorIds.add(indicatorId);
      }
    }

    this.indicatorAdapter.updateBundles(bundles, changedIndicatorIds);
    this.pruneLayerResources(bundles);
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

  getVisibleScaleExtents() {
    return this.indicatorAdapter.getVisibleScaleExtents();
  }

  getLayerGeometry(indicatorId: string): IndicatorLayerGeometry | null {
    return (
      this.layerGeometryCache.get(INDICATOR_LAYER_PREFIX + indicatorId) ?? null
    );
  }

  clear() {
    this.canvas.style.display = "none";
    this.clearGlCanvas();
  }

  render(frame: ChartRenderFrame) {
    this.currentFrame = frame;
    const renderStartedAt = performance.now();
    this.ensureCanvasSize();
    this.prepareViewportCaches(frame);
    const { plotHeight, plotWidth } = frame;

    if (plotWidth <= 0 || plotHeight <= 0 || !this.bundles.length) {
      this.canvas.style.display = "none";
      this.clearGlCanvas();
      this.pruneSpriteTextureCache(new Set<string>());
      this.performanceMetrics.lastRenderMs = performance.now() - renderStartedAt;
      return;
    }

    this.canvas.style.display = "block";
    this.clearGlCanvas();
    const usedSpriteKeys = new Set<string>();

    for (const bundle of this.bundles) {
      const layerKey = INDICATOR_LAYER_PREFIX + bundle.id;
      const geometryKey = [
        this.viewportCacheKey,
        this.layerVersions.get(layerKey) ?? 0,
        frame.dataRevision,
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

      this.drawTriangleBatch(geometry.triangleData, layerKey, geometryKey);
      this.drawPointBatch(geometry.pointData, layerKey, geometryKey);
      this.drawSpriteCommands(
        [
          ...geometry.panelCommands.map((command) =>
            this.createPanelSpriteCommand(command, frame, usedSpriteKeys)
          ),
          ...geometry.textCommands.map((command) =>
            this.createTextSpriteCommand(command, usedSpriteKeys)
          ),
        ].filter((command): command is SpriteDrawCommand => command !== null),
      );
    }

    this.pruneSpriteTextureCache(usedSpriteKeys);
    this.performanceMetrics.lastRenderMs = performance.now() - renderStartedAt;
  }

  hitTestLayer(
    frame: ChartRenderFrame,
    x: number,
    y: number,
    indicatorId?: string,
  ) {
    return this.indicatorAdapter.hitTest(indicatorId ?? "", frame, x, y);
  }

  getSelectionPoints(
    frame: ChartRenderFrame,
    indicatorId: string,
  ) {
    return this.indicatorAdapter.getSelectionPoints(frame, {
      indicatorId,
      source: "indicator",
    });
  }

  getSelectionTargetInRectangle(
    frame: ChartRenderFrame,
    indicatorId: string,
    rectangle: ChartSelectionRectangle,
  ) {
    return this.indicatorAdapter.getSelectionTargetInRectangle(
      frame,
      { indicatorId, source: "indicator" },
      rectangle,
    );
  }

  private markLayerDirty(indicatorId: string) {
    const key = INDICATOR_LAYER_PREFIX + indicatorId;
    this.layerVersions.set(key, (this.layerVersions.get(key) ?? 0) + 1);
    this.layerGeometryCache.delete(key);
  }

  private pruneLayerResources(bundles: readonly IndicatorRenderBundle[]) {
    const activeKeys = new Set(
      bundles.map((bundle) => INDICATOR_LAYER_PREFIX + bundle.id),
    );

    for (const [key, buffers] of this.layerBuffers) {
      if (activeKeys.has(key)) continue;
      this.gl.deleteBuffer(buffers.triangleBuffer);
      this.gl.deleteBuffer(buffers.pointBuffer);
      this.layerBuffers.delete(key);
      this.layerGeometryCache.delete(key);
      this.layerVersions.delete(key);
    }
  }

  private currentFrameOrThrow(): ChartRenderFrame {
    if (!this.currentFrame) {
      throw new Error("WebGL compositor has no render frame");
    }

    return this.currentFrame;
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

    this.canvas.width = Math.max(1, Math.round(nextCssWidth * nextPixelRatio));
    this.canvas.height = Math.max(1, Math.round(nextCssHeight * nextPixelRatio));
    this.canvas.style.width = `${nextCssWidth}px`;
    this.canvas.style.height = `${nextCssHeight}px`;

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.viewportCacheKey = "";
    this.indicatorAdapter.setDevicePixelRatio(this.devicePixelRatio);
    this.indicatorAdapter.resetCaches();
  }

  private prepareViewportCaches(frame: ChartRenderFrame) {
    const nextKey = [
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

    if (this.viewportCacheKey === nextKey) {
      return;
    }

    this.viewportCacheKey = nextKey;
  }


  private clearGlCanvas() {
    const gl = this.gl;

    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private getLayerBuffers(layerKey: string) {
    const existing = this.layerBuffers.get(layerKey);
    if (existing) return existing;

    const buffers: LayerBufferRecord = {
      pointBuffer: createBuffer(this.gl),
      pointUploadKey: "",
      triangleBuffer: createBuffer(this.gl),
      triangleUploadKey: "",
    };
    this.layerBuffers.set(layerKey, buffers);
    return buffers;
  }

  private drawTriangleBatch(
    data: Float32Array,
    layerKey: string,
    geometryKey: string,
  ) {
    if (!data.length) {
      return;
    }

    const gl = this.gl;
    const buffers = this.getLayerBuffers(layerKey);
    const program = this.primitiveProgram;
    const bindings = this.primitiveBindings;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.triangleBuffer);
    if (buffers.triangleUploadKey !== geometryKey) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      buffers.triangleUploadKey = geometryKey;
      this.performanceMetrics.bufferUploads += 1;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.round(this.currentFrameOrThrow().plotOffsetX * this.devicePixelRatio),
      Math.max(0, this.canvas.height - Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotWidth * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
    );
    gl.uniform2f(bindings.resolution, this.canvas.width, this.canvas.height);
    gl.enableVertexAttribArray(bindings.position);
    gl.vertexAttribPointer(bindings.position, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(bindings.color);
    gl.vertexAttribPointer(bindings.color, 4, gl.FLOAT, false, 24, 8);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    this.performanceMetrics.drawCalls += 1;
    this.performanceMetrics.renderedVertices += data.length / 6;
    gl.disable(gl.SCISSOR_TEST);
  }

  private drawPointBatch(
    data: Float32Array,
    layerKey: string,
    geometryKey: string,
  ) {
    if (!data.length) {
      return;
    }

    const gl = this.gl;
    const buffers = this.getLayerBuffers(layerKey);
    const program = this.pointProgram;
    const bindings = this.pointBindings;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pointBuffer);
    if (buffers.pointUploadKey !== geometryKey) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      buffers.pointUploadKey = geometryKey;
      this.performanceMetrics.bufferUploads += 1;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.round(this.currentFrameOrThrow().plotOffsetX * this.devicePixelRatio),
      Math.max(0, this.canvas.height - Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotWidth * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
    );
    gl.uniform2f(bindings.resolution, this.canvas.width, this.canvas.height);
    gl.enableVertexAttribArray(bindings.position);
    gl.vertexAttribPointer(bindings.position, 2, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(bindings.size);
    gl.vertexAttribPointer(bindings.size, 1, gl.FLOAT, false, 28, 8);
    gl.enableVertexAttribArray(bindings.color);
    gl.vertexAttribPointer(bindings.color, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.POINTS, 0, data.length / 7);
    this.performanceMetrics.drawCalls += 1;
    this.performanceMetrics.renderedVertices += data.length / 7;
    gl.disable(gl.SCISSOR_TEST);
  }

  private drawSpriteCommands(commands: SpriteDrawCommand[]) {
    if (!commands.length) {
      return;
    }

    const gl = this.gl;
    const program = this.spriteProgram;
    const bindings = this.spriteBindings;

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuffer);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    this.applyPlotScissor();
    gl.uniform2f(bindings.resolution, this.canvas.width, this.canvas.height);
    gl.uniform1i(bindings.texture, 0);
    gl.enableVertexAttribArray(bindings.position);
    gl.vertexAttribPointer(bindings.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(bindings.texCoord);
    gl.vertexAttribPointer(bindings.texCoord, 2, gl.FLOAT, false, 16, 8);

    for (const command of commands) {
      writeSpriteVertices(this.spriteVertexData, command);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.spriteVertexData);
      this.performanceMetrics.bufferUploads += 1;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, command.texture);
      gl.uniform1f(bindings.opacity, command.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      this.performanceMetrics.drawCalls += 1;
      this.performanceMetrics.renderedVertices += 6;
    }

    gl.disable(gl.SCISSOR_TEST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private createTextSpriteCommand(
    command: SceneTextDrawCommand,
    usedKeys: Set<string>,
  ) {
    if (!command.text.length) {
      return null;
    }

    const record = this.getOrCreateLabelSpriteTexture(command);

    usedKeys.add(record.key);

    return {
      height: record.height,
      opacity: command.opacity,
      texture: record.texture,
      width: record.width,
      x: Math.round(
        command.align === "left"
          ? this.toDeviceX(command.x)
          : command.align === "right"
            ? this.toDeviceX(command.x) - record.width
            : this.toDeviceX(command.x) - record.width / 2,
      ),
      y: Math.round(this.toDeviceY(command.y)),
    } satisfies SpriteDrawCommand;
  }

  private createPanelSpriteCommand(
    command: ScenePanelDrawCommand,
    frame: ChartRenderFrame,
    usedKeys: Set<string>,
  ) {
    if (command.kind === "table") {
      const record = this.getOrCreateTableSpriteTexture(command, frame);

      if (!record) {
        return null;
      }

      usedKeys.add(record.key);

      const { x, y } = getPanelAnchorPosition(
        command.anchor,
        Math.max(1, Math.round(frame.plotWidth)),
        Math.max(1, Math.round(frame.plotHeight)),
        record.width / this.devicePixelRatio,
        record.height / this.devicePixelRatio,
        12,
      );

      return {
        height: record.height,
        opacity: command.opacity,
        texture: record.texture,
        width: record.width,
        x: Math.round(this.toDeviceX(x)),
        y: Math.round(this.toDeviceY(y)),
      } satisfies SpriteDrawCommand;
    }

    const title = command.title.trim();
    const bodyLines = command.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!title.length && !bodyLines.length) {
      return null;
    }

    const record = this.getOrCreatePanelSpriteTexture(command);

    usedKeys.add(record.key);

    const { x, y } = getPanelAnchorPosition(
      command.anchor,
      Math.max(1, Math.round(frame.plotWidth)),
      Math.max(1, Math.round(frame.plotHeight)),
      record.width / this.devicePixelRatio,
      record.height / this.devicePixelRatio,
      12,
    );

    return {
      height: record.height,
      opacity: command.opacity,
      texture: record.texture,
      width: record.width,
      x: Math.round(this.toDeviceX(x)),
      y: Math.round(this.toDeviceY(y)),
    } satisfies SpriteDrawCommand;
  }

  private getOrCreateLabelSpriteTexture(command: SceneTextDrawCommand) {
    const lines = command.text.split("\n");
    const textAlign = command.align ?? "center";
    const key = JSON.stringify([
      "label",
      this.devicePixelRatio,
      textAlign,
      command.backgroundColor,
      command.color,
      command.fontSize,
      lines,
    ]);
    const cached = this.spriteTextureCache.get(key);

    if (cached) {
      return cached;
    }

    const fontSize = Math.max(1, Math.round(command.fontSize * this.devicePixelRatio));
    const paddingX = Math.max(1, Math.round(6 * this.devicePixelRatio));
    const paddingY = Math.max(1, Math.round(4 * this.devicePixelRatio));
    const lineGap = Math.max(1, Math.round(2 * this.devicePixelRatio));
    const font = `${fontSize}px Arial`;
    const metrics = measureTextLines(this.spriteScratchContext, lines, font);
    const width = Math.max(1, Math.ceil(metrics.width + paddingX * 2));
    const height = Math.max(
      1,
      Math.ceil(metrics.lineHeight * lines.length + lineGap * Math.max(lines.length - 1, 0) + paddingY * 2),
    );

    this.spriteScratchCanvas.width = width;
    this.spriteScratchCanvas.height = height;

    const context = this.spriteScratchContext;
    context.clearRect(0, 0, width, height);
    context.font = font;
    context.textAlign = textAlign;
    context.textBaseline = "alphabetic";

    if (command.backgroundColor !== "rgba(0, 0, 0, 0)") {
      drawRoundedRect(context, 0, 0, width, height, Math.max(1, Math.round(4 * this.devicePixelRatio)));
      context.fillStyle = command.backgroundColor;
      context.fill();
    }

    context.fillStyle = command.color;
    const textX = textAlign === "left"
      ? paddingX
      : textAlign === "right"
        ? width - paddingX
        : width / 2;

    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(
        lines[index],
        textX,
        paddingY + metrics.ascent + index * (metrics.lineHeight + lineGap),
      );
    }

    const record = this.createSpriteTextureRecord(key, width, height);

    this.spriteTextureCache.set(key, record);
    return record;
  }

  private getOrCreateTableSpriteTexture(
    command: ScenePanelDrawCommand,
    frame: ChartRenderFrame,
  ) {
    const layout = computeTableLayout(command, frame, this.devicePixelRatio, this.spriteScratchContext);

    if (!layout) {
      return null;
    }

    const key = JSON.stringify([
      "table",
      this.devicePixelRatio,
      Math.round(frame.plotWidth),
      Math.round(frame.plotHeight),
      command.backgroundColor,
      command.borderColor ?? "",
      command.borderWidth ?? 0,
      command.color,
      layout.columns,
      command.fontSize,
      command.frameColor ?? "",
      command.frameWidth ?? 0,
      layout.merges,
      layout.rows,
      layout.renderCells.map((cell) => ({
        backgroundColor: cell.backgroundColor,
        bottom: cell.bottom,
        left: cell.left,
        lines: cell.lines,
        right: cell.right,
        textColor: cell.textColor,
        top: cell.top,
      })),
    ]);
    const cached = this.spriteTextureCache.get(key);

    if (cached) {
      return cached;
    }
    const width = layout.width;
    const height = layout.height;
    this.spriteScratchCanvas.width = width;
    this.spriteScratchCanvas.height = height;

    const context = this.spriteScratchContext;
    context.clearRect(0, 0, width, height);

    if (command.backgroundColor !== "rgba(0, 0, 0, 0)") {
      context.fillStyle = command.backgroundColor;
      context.fillRect(0, 0, width, height);
    }

    for (const cell of layout.renderCells) {
      const left = cell.left;
      const top = cell.top;
      const right = cell.right;
      const bottom = cell.bottom;
      const cellWidth = right - left;
      const cellHeight = bottom - top;

      if (cell.backgroundColor !== "rgba(0, 0, 0, 0)") {
        context.fillStyle = cell.backgroundColor;
        context.fillRect(left, top, cellWidth, cellHeight);
      }

      const borderColor = command.borderColor ?? command.frameColor ?? command.color;
      const borderWidth = Math.max(
        0,
        Math.round((command.borderWidth ?? 0) * this.devicePixelRatio),
      );

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
        frameWidth / 2,
        frameWidth / 2,
        Math.max(0, width - frameWidth),
        Math.max(0, height - frameWidth),
      );
    }

    const record = this.createSpriteTextureRecord(key, width, height);

    this.spriteTextureCache.set(key, record);
    return record;
  }

  private getOrCreatePanelSpriteTexture(command: ScenePanelDrawCommand) {
    const title = command.title.trim();
    const bodyLines = command.text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const key = JSON.stringify([
      "panel",
      this.devicePixelRatio,
      command.accentColor,
      command.backgroundColor,
      command.color,
      command.fontSize,
      title,
      bodyLines,
    ]);
    const cached = this.spriteTextureCache.get(key);

    if (cached) {
      return cached;
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
      ? measureTextLines(this.spriteScratchContext, [title], titleFont)
      : null;
    const bodyMetrics = bodyLines.length
      ? measureTextLines(this.spriteScratchContext, bodyLines, bodyFont)
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

    this.spriteScratchCanvas.width = width;
    this.spriteScratchCanvas.height = height;

    const context = this.spriteScratchContext;
    context.clearRect(0, 0, width, height);
    drawRoundedRect(
      context,
      0,
      0,
      width,
      height,
      Math.max(1, Math.round(8 * this.devicePixelRatio)),
    );
    context.fillStyle = command.backgroundColor;
    context.fill();

    let currentY = verticalPadding;

    if (titleMetrics) {
      context.font = titleFont;
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.fillStyle = command.accentColor.length ? command.accentColor : command.color;
      context.fillText(title, horizontalPadding, currentY + titleMetrics.ascent);
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
          horizontalPadding,
          currentY + bodyMetrics.ascent + index * (bodyMetrics.lineHeight + bodyLineGap),
        );
      }
    }

    const record = this.createSpriteTextureRecord(key, width, height);

    this.spriteTextureCache.set(key, record);
    return record;
  }

  private createSpriteTextureRecord(
    key: string,
    width: number,
    height: number,
  ) {
    const texture = this.gl.createTexture();

    if (!texture) {
      throw new Error("Failed to create WebGL texture");
    }

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.spriteScratchCanvas,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    return {
      height,
      key,
      texture,
      width,
    } satisfies SpriteTextureRecord;
  }

  private pruneSpriteTextureCache(usedKeys: Set<string>) {
    for (const [key, record] of this.spriteTextureCache.entries()) {
      if (usedKeys.has(key)) {
        continue;
      }

      this.gl.deleteTexture(record.texture);
      this.spriteTextureCache.delete(key);
    }
  }

  private applyPlotScissor() {
    this.gl.scissor(
      Math.round(this.currentFrameOrThrow().plotOffsetX * this.devicePixelRatio),
      Math.max(0, this.canvas.height - Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotWidth * this.devicePixelRatio)),
      Math.max(1, Math.round(this.currentFrameOrThrow().plotHeight * this.devicePixelRatio)),
    );
  }


  private toDeviceX(x: number) {
    return x * this.devicePixelRatio;
  }

  private toDeviceY(y: number) {
    return y * this.devicePixelRatio;
  }
}

function writeSpriteVertices(
  target: Float32Array,
  command: SpriteDrawCommand,
) {
  const left = command.x;
  const top = command.y;
  const right = command.x + command.width;
  const bottom = command.y + command.height;
  target[0] = left;
  target[1] = top;
  target[2] = 0;
  target[3] = 0;
  target[4] = right;
  target[5] = top;
  target[6] = 1;
  target[7] = 0;
  target[8] = left;
  target[9] = bottom;
  target[10] = 0;
  target[11] = 1;
  target[12] = left;
  target[13] = bottom;
  target[14] = 0;
  target[15] = 1;
  target[16] = right;
  target[17] = top;
  target[18] = 1;
  target[19] = 0;
  target[20] = right;
  target[21] = bottom;
  target[22] = 1;
  target[23] = 1;
}

function drawRoundedRect(
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

function createPrimitiveProgram(gl: WebGLRenderingContext) {
  return createProgram(
    gl,
    `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      varying vec4 v_color;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_color = a_color;
      }
    `,
    `
      precision mediump float;
      varying vec4 v_color;

      void main() {
        gl_FragColor = v_color;
      }
    `,
  );
}

function createPointProgram(gl: WebGLRenderingContext) {
  return createProgram(
    gl,
    `
      attribute vec2 a_position;
      attribute float a_size;
      attribute vec4 a_color;
      uniform vec2 u_resolution;
      varying vec4 v_color;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        gl_PointSize = a_size;
        v_color = a_color;
      }
    `,
    `
      precision mediump float;
      varying vec4 v_color;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;

        if (dot(centered, centered) > 1.0) {
          discard;
        }

        gl_FragColor = v_color;
      }
    `,
  );
}

function createSpriteProgram(gl: WebGLRenderingContext) {
  return createProgram(
    gl,
    `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      uniform vec2 u_resolution;
      varying vec2 v_texCoord;

      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `,
    `
      precision mediump float;
      uniform sampler2D u_texture;
      uniform float u_opacity;
      varying vec2 v_texCoord;

      void main() {
        vec4 sampled = texture2D(u_texture, v_texCoord);
        gl_FragColor = vec4(sampled.rgb, sampled.a * u_opacity);
      }
    `,
  );
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error("Failed to create WebGL program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown WebGL link error";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(message);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error("Failed to create WebGL shader");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown WebGL compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createBuffer(gl: WebGLRenderingContext) {
  const buffer = gl.createBuffer();

  if (!buffer) {
    throw new Error("Failed to create WebGL buffer");
  }

  return buffer;
}
