/**
 * Recording 2D context for tests.
 *
 * jsdom has no canvas implementation, and asserting on recorded draw calls is a better gate than
 * comparing pixels. Methods are recorded; property writes are tracked so code that reads back
 * `fillStyle`/`font` behaves sensibly. `measureText` returns deterministic metrics.
 *
 * `installCanvasContextStub` patches `HTMLCanvasElement.prototype.getContext` so canvases created
 * *inside* the code under test (e.g. the renderer's hidden scratch canvas) also get a context.
 */

export interface RecordedCall {
  args: unknown[];
  method: string;
}

export interface RecordingContext {
  calls: RecordedCall[];
  context: CanvasRenderingContext2D;
  state: Record<string, unknown>;
}

const RECORDED_METHODS = new Set([
  "arc",
  "beginPath",
  "clearRect",
  "clip",
  "closePath",
  "drawImage",
  "fill",
  "fillRect",
  "fillText",
  "lineTo",
  "moveTo",
  "quadraticCurveTo",
  "rect",
  "restore",
  "rotate",
  "save",
  "scale",
  "setTransform",
  "stroke",
  "strokeRect",
  "translate",
]);

export function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const state: Record<string, unknown> = {
    fillStyle: "#000000",
    font: "10px Arial",
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "#000000",
    textAlign: "start",
    textBaseline: "alphabetic",
  };

  const target: Record<string, unknown> = {
    measureText: (text: string) => {
      const font = String(state.font ?? "");
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);

      return {
        actualBoundingBoxAscent: size * 0.8,
        actualBoundingBoxDescent: size * 0.2,
        width: text.length * size * 0.6,
      };
    },
    restore: () => {
      calls.push({ args: [], method: "restore" });
    },
    save: () => {
      calls.push({ args: [], method: "save" });
    },
  };

  const context = new Proxy(target, {
    get(object, property) {
      const name = String(property);

      if (name in object) {
        return object[name];
      }

      if (RECORDED_METHODS.has(name)) {
        return (...args: unknown[]) => {
          calls.push({ args, method: name });
        };
      }

      return state[name];
    },
    set(_object, property, value) {
      const name = String(property);

      if (name === "canvas") {
        return true;
      }

      state[name] = value;
      calls.push({ args: [value], method: `set:${name}` });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { calls, context, state };
}

export function countCalls(recording: RecordingContext, method: string) {
  return recording.calls.filter((call) => call.method === method).length;
}

const recordingByCanvas = new WeakMap<HTMLCanvasElement, RecordingContext>();

/** Every canvas — including ones created inside the code under test — gets a recording context. */
export function installCanvasContextStub() {
  const original = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== "2d") {
      return null;
    }

    let recording = recordingByCanvas.get(this);

    if (!recording) {
      recording = createRecordingContext();
      recordingByCanvas.set(this, recording);
    }

    return recording.context;
  } as HTMLCanvasElement["getContext"];

  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

export function createRecordingCanvas(options: { height?: number; width?: number } = {}) {
  const canvas = document.createElement("canvas");
  const width = options.width ?? 800;
  const height = options.height ?? 400;
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: height });

  // Trigger the prototype stub so the canvas gets (and caches) its recording context.
  canvas.getContext("2d");

  const recording = recordingByCanvas.get(canvas);

  if (!recording) {
    throw new Error("Call installCanvasContextStub() before createRecordingCanvas()");
  }

  return { canvas, cssHeight: height, cssWidth: width, recording };
}

/** The 2D recording context a canvas was given by the prototype stub. */
export function getCanvasRecordingContext(canvas: HTMLCanvasElement) {
  const recording = recordingByCanvas.get(canvas);

  if (!recording) {
    throw new Error("Call installCanvasContextStub() before requesting a context");
  }

  return recording;
}

/**
 * Makes one canvas answer WebGL while still answering "2d" from the prototype stub — which is what
 * the WebGL compositor needs (its own canvas is GL, its sprite scratch canvas is 2D).
 */
export function overrideCanvasWithWebGL(
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext,
) {
  const twoDimensionalGetContext = canvas.getContext.bind(canvas);

  canvas.getContext = ((kind: string, ...rest: unknown[]) =>
    kind === "2d"
      ? twoDimensionalGetContext(kind, ...(rest as []))
      : gl) as HTMLCanvasElement["getContext"];
}
