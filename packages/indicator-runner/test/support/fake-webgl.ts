/**
 * Recording WebGL context for tests.
 *
 * jsdom has no WebGL, and headless GL is a heavy native dependency. This stub returns real-looking
 * objects from the resource-creating calls and records the state-changing ones, enough to drive the
 * compositor end to end and assert on buffer uploads, draw calls and scissor state.
 *
 * The constant set and method list mirror exactly what `webgl-compositor.ts` uses.
 */

import { overrideCanvasWithWebGL } from "./fake-canvas";

export interface RecordedGlCall {
  args: unknown[];
  method: string;
}

export interface RecordingWebGL {
  calls: RecordedGlCall[];
  gl: WebGLRenderingContext;
}

const CONSTANTS = [
  "ARRAY_BUFFER",
  "BLEND",
  "CLAMP_TO_EDGE",
  "COLOR_BUFFER_BIT",
  "COMPILE_STATUS",
  "DYNAMIC_DRAW",
  "FLOAT",
  "FRAGMENT_SHADER",
  "LINK_STATUS",
  "NEAREST",
  "ONE_MINUS_SRC_ALPHA",
  "POINTS",
  "RGBA",
  "SCISSOR_TEST",
  "SRC_ALPHA",
  "TEXTURE0",
  "TEXTURE_2D",
  "TEXTURE_MAG_FILTER",
  "TEXTURE_MIN_FILTER",
  "TEXTURE_WRAP_S",
  "TEXTURE_WRAP_T",
  "TRIANGLES",
  "UNSIGNED_BYTE",
  "VERTEX_SHADER",
] as const;

const RECORDED_METHODS = [
  "activeTexture",
  "attachShader",
  "bindBuffer",
  "bindTexture",
  "blendFunc",
  "bufferData",
  "bufferSubData",
  "clear",
  "clearColor",
  "compileShader",
  "deleteBuffer",
  "deleteProgram",
  "deleteShader",
  "deleteTexture",
  "disable",
  "drawArrays",
  "enable",
  "enableVertexAttribArray",
  "linkProgram",
  "scissor",
  "shaderSource",
  "texImage2D",
  "texParameteri",
  "uniform1f",
  "uniform1i",
  "uniform2f",
  "uniform4f",
  "useProgram",
  "vertexAttribPointer",
  "viewport",
] as const;

export function createRecordingWebGL(): RecordingWebGL {
  const calls: RecordedGlCall[] = [];
  const constants = new Map<string, number>(
    CONSTANTS.map((name, index) => [name, 0x1000 + index]),
  );

  let nextHandle = 1;
  const handles = new WeakMap<object, number>();
  const handleFor = (value: object) => {
    let handle = handles.get(value);

    if (!handle) {
      handle = nextHandle;
      nextHandle += 1;
      handles.set(value, handle);
    }

    return handle;
  };

  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ args, method });
  };

  const target: Record<string, unknown> = {
    // Resource-creating calls must return distinct, truthy objects.
    createBuffer: () => {
      calls.push({ args: [], method: "createBuffer" });
      return {};
    },
    createProgram: () => {
      calls.push({ args: [], method: "createProgram" });
      return {};
    },
    createShader: () => {
      calls.push({ args: [], method: "createShader" });
      return {};
    },
    createTexture: () => {
      calls.push({ args: [], method: "createTexture" });
      return {};
    },
    getAttribLocation: (_program: unknown, name: string) => {
      calls.push({ args: [name], method: "getAttribLocation" });
      return name.length;
    },
    getExtension: () => null,
    getProgramInfoLog: () => "",
    // Compilation/linking always succeeds in the stub.
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getShaderParameter: () => true,
    getUniformLocation: (program: unknown, name: string) => {
      calls.push({ args: [name], method: "getUniformLocation" });
      return { name, program: handleFor(program as object) };
    },
  };

  for (const method of RECORDED_METHODS) {
    target[method] = record(method);
  }

  const gl = new Proxy(target, {
    get(object, property) {
      const name = String(property);

      if (name in object) {
        return object[name];
      }

      const constant = constants.get(name);

      if (constant !== undefined) {
        return constant;
      }

      return undefined;
    },
  }) as unknown as WebGLRenderingContext;

  return { calls, gl };
}

export function countGlCalls(recording: RecordingWebGL, method: string) {
  return recording.calls.filter((call) => call.method === method).length;
}

export function findGlCalls(recording: RecordingWebGL, method: string) {
  return recording.calls.filter((call) => call.method === method);
}

/** A canvas whose `getContext` answers WebGL, while "2d" still resolves via the prototype stub. */
export function createRecordingWebGLCanvas(
  options: { height?: number; width?: number } = {},
) {
  const recording = createRecordingWebGL();
  const canvas = document.createElement("canvas");

  overrideCanvasWithWebGL(canvas, recording.gl);

  const width = options.width ?? 800;
  const height = options.height ?? 400;
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: height });

  return { ...recording, canvas, cssHeight: height, cssWidth: width };
}
