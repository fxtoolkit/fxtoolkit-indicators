/**
 * Picks a drawing backend for an indicator surface.
 *
 * WebGL is preferred, matching Orion; Canvas2D is the fallback when a WebGL context cannot be
 * created (no GPU, blocked context, or an explicit request for the 2D path).
 */

import IndicatorCanvasRenderer from "./canvas-renderer";
import type { IndicatorRenderer } from "./renderer";
import SceneWebGLCompositor from "./webgl-compositor";

export type IndicatorRendererBackend = "canvas" | "webgl";
export type IndicatorRendererPreference = "auto" | "canvas" | "webgl";

export interface CreateIndicatorRendererOptions {
  canvas: HTMLCanvasElement;
  /** CSS size the canvas covers. Defaults to the canvas' own client box. */
  getSize?: () => { height: number; width: number };
  /** Overrides device-pixel-ratio detection. */
  pixelRatio?: number;
  /** Defaults to "auto" (WebGL, falling back to Canvas2D). */
  prefer?: IndicatorRendererPreference;
}

export interface IndicatorRendererHandle {
  backend: IndicatorRendererBackend;
  renderer: IndicatorRenderer;
}

export function createIndicatorRenderer(
  options: CreateIndicatorRendererOptions,
): IndicatorRendererHandle {
  const preference = options.prefer ?? "auto";

  if (preference !== "canvas") {
    try {
      return {
        backend: "webgl",
        renderer: new SceneWebGLCompositor(options),
      };
    } catch (error) {
      if (preference === "webgl") {
        throw error;
      }
      // Fall through to the Canvas2D backend.
    }
  }

  return {
    backend: "canvas",
    renderer: new IndicatorCanvasRenderer(options),
  };
}
