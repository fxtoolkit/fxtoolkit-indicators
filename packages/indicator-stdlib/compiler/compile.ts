/**
 * In-memory AssemblyScript compiler for indicator scripts.
 *
 * Uses `asc`'s programmatic API with a virtual filesystem, so nothing touches disk: the user's
 * source and the packaged standard library are the entire input space, and only the standard library
 * is importable.
 */

import asc from "assemblyscript/asc";
import type {
  IndicatorCompileDiagnostic,
  IndicatorDescriptor,
} from "../abi";
import {
  createVirtualFileSystem,
  ENTRY_FILENAME,
  PACKAGE_SEARCH_DIRECTORY,
} from "./virtual-files";

export interface CompileScriptOptions {
  /** Identifier for the script. Used in error messages and as the descriptor's module fallback. */
  module: string;
}

export interface CompileScriptResult {
  /** Parsed `describe()` descriptor, when it could be read. */
  descriptor?: IndicatorDescriptor;
  diagnostics: IndicatorCompileDiagnostic[];
  ok: boolean;
  /** Compiled module bytes on success. */
  wasm?: Uint8Array;
}

const OUTPUT_FILENAME = "output.wasm";

/**
 * AssemblyScript `DiagnosticCategory`. The ordinal order is Debug/Info/Warning/Error — confirmed by
 * inspecting a real parse failure, which reports `category: 3`.
 */
const CATEGORY_ERROR = 3;
const CATEGORY_WARNING = 2;

export async function compileScript(
  source: string,
  options: CompileScriptOptions,
): Promise<CompileScriptResult> {
  const vfs = createVirtualFileSystem(source);
  const outputs = new Map<string, Uint8Array>();
  const diagnostics: IndicatorCompileDiagnostic[] = [];
  const stderr = asc.createMemoryStream();

  const { error } = await asc.main(
    [
      ENTRY_FILENAME,
      "-O",
      "--noAssert",
      "--exportRuntime",
      "--noColors",
      "--path",
      PACKAGE_SEARCH_DIRECTORY,
      "--outFile",
      OUTPUT_FILENAME,
    ],
    {
      listFiles: () => [],
      readFile: (filename: string) => vfs.readFile(filename),
      reportDiagnostic: (diagnostic) => {
        diagnostics.push(
          toCompileDiagnostic(diagnostic, source, userSourcePath(diagnostic)),
        );
      },
      stderr,
      writeFile: (filename: string, contents: Uint8Array) => {
        outputs.set(filename, contents);
      },
    } as Parameters<typeof asc.main>[1],
  );

  const wasm = outputs.get(OUTPUT_FILENAME);

  if (error || !wasm) {
    // `asc` reports a thrown/crashed compile through `error`; make sure the caller still gets
    // something actionable even when no diagnostic was emitted.
    if (!diagnostics.length) {
      diagnostics.push({
        level: "error",
        message: error?.message ?? `Failed to compile indicator "${options.module}"`,
      });
    }

    return { diagnostics, ok: false };
  }

  const descriptor = await readDescriptor(wasm);

  return {
    descriptor,
    diagnostics,
    ok: true,
    wasm,
  };
}

function userSourcePath(diagnostic: { range?: { source?: { normalizedPath?: string } } | null }) {
  return diagnostic.range?.source?.normalizedPath ?? "";
}

type AscDiagnostic = {
  category: number;
  message: string;
  range?: {
    end: number;
    source?: { normalizedPath?: string } | null;
    start: number;
  } | null;
};

function toCompileDiagnostic(
  diagnostic: AscDiagnostic,
  source: string,
  sourcePath: string,
): IndicatorCompileDiagnostic {
  const level: IndicatorCompileDiagnostic["level"] =
    diagnostic.category === CATEGORY_ERROR
      ? "error"
      : diagnostic.category === CATEGORY_WARNING
        ? "warning"
        : "info";

  const result: IndicatorCompileDiagnostic = {
    level,
    message: diagnostic.message,
  };

  // Positions are only useful for the script the caller wrote.
  if (diagnostic.range && sourcePath.endsWith(ENTRY_FILENAME)) {
    const { column, line } = positionAt(source, diagnostic.range.start);
    result.line = line;
    result.column = column;
  }

  return result;
}

function positionAt(source: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const newlineIndex = before.lastIndexOf("\n");

  return {
    column: clamped - newlineIndex,
    line: before.split("\n").length,
  };
}

/**
 * Instantiates the compiled module just far enough to read its descriptor.
 *
 * The module only needs the host imports to exist; `describe()` does not call them. A failure here
 * is not fatal to compilation, so the descriptor is simply omitted.
 */
async function readDescriptor(
  wasm: Uint8Array,
): Promise<IndicatorDescriptor | undefined> {
  try {
    const { instantiate } = await import("@assemblyscript/loader");
    const runtime = await instantiate(wasm, createDescriptorImports());
    const exports = runtime.exports as Record<string, unknown>;
    const describe = exports.describe as (() => number) | undefined;
    const getString = exports.__getString as ((ptr: number) => string) | undefined;

    if (!describe || !getString) {
      return undefined;
    }

    return JSON.parse(getString(describe())) as IndicatorDescriptor;
  } catch {
    // A module that links but cannot be described is not a compile failure.
    return undefined;
  }
}

/** Mirrors orion's `createDescriptorImports`: enough surface for the module to link and describe. */
function createDescriptorImports() {
  const orion: Record<string, (...args: never[]) => unknown> = {
    alert: () => undefined,
    beginBar: () => undefined,
    bgcolor: () => undefined,
    box: () => undefined,
    candle: () => undefined,
    fill: () => undefined,
    inputBool: (_keyPtr, defaultValue) => defaultValue,
    inputInt: (_keyPtr, defaultValue) => defaultValue,
    inputNumber: (_keyPtr, defaultValue) => defaultValue,
    inputString: (_keyPtr, defaultPtr) => defaultPtr,
    label: () => undefined,
    line: () => undefined,
    linefill: () => undefined,
    panel: () => undefined,
    plot: () => undefined,
    plotshape: () => undefined,
    polyline: () => undefined,
    ray: () => undefined,
    runtimePipSize: () => 0.01,
    runtimeSymbol: () => 0,
    runtimeTimeframeMs: () => 0,
    signal: () => undefined,
    table: () => undefined,
  };

  return {
    env: {
      abort: () => {
        throw new Error("Indicator module aborted while reading its descriptor");
      },
    },
    orion,
  } as unknown as Record<string, Record<string, unknown>>;
}
