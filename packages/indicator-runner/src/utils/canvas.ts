const SAFARI_USER_AGENT_PATTERN = /^((?!chrome|android|crios|fxios|edgios).)*safari/i;

export function isSafariBrowser() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return SAFARI_USER_AGENT_PATTERN.test(navigator.userAgent);
}

export function getPreferredCanvasPixelRatio(maxPixelRatio = 2) {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const safariBoostedMax = isSafariBrowser() ? Math.max(maxPixelRatio, 3) : maxPixelRatio;

  return Math.min(devicePixelRatio, safariBoostedMax);
}

export function getPreferred2DContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: !isSafariBrowser(),
  });

  if (context) {
    context.imageSmoothingEnabled = true;
  }

  return context;
}

export function getPreferredWebGLContext(canvas: HTMLCanvasElement) {
  const options = {
    alpha: true,
    antialias: true,
    depth: false,
    desynchronized: !isSafariBrowser(),
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    stencil: false,
  } as const;

  return (
    canvas.getContext("webgl", options)
    ?? canvas.getContext("experimental-webgl", options)
  ) as WebGLRenderingContext | null;
}

export function snapStrokeCoordinate(
  value: number,
  lineWidth = 1,
  pixelRatio = 1,
) {
  const safePixelRatio = Math.max(1, pixelRatio);
  const physicalLineWidth = Math.max(1, Math.round(lineWidth * safePixelRatio));
  const offset = physicalLineWidth % 2 === 0 ? 0 : 0.5;

  return (Math.round(value * safePixelRatio - offset) + offset) / safePixelRatio;
}
