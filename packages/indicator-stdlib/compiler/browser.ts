/**
 * Browser in-memory compiler.
 *
 * Same contract as the Node compiler (`./compile`) and the same shared logic — only the `asc` build
 * differs. `asc` carries its own browser branch (in-memory shims instead of `fs`/`path`), which this
 * entry bundles for the browser target.
 *
 * **Import it lazily.** `asc` plus `binaryen` is ~15 MB; it must never reach app startup or a chart
 * render path. Import it only when a user actually compiles something:
 *
 * ```ts
 * const { compileScriptInBrowser } = await import("@fxtoolkit/indicator-stdlib/compiler/browser");
 * ```
 *
 * Compilation is CPU-bound and synchronous inside `asc.main`, so run it in a Web Worker if the host
 * UI needs to stay responsive.
 */

import asc from "assemblyscript/asc";
import {
  compileWithAsc,
  type AscLike,
  type CompileScriptOptions,
  type CompileScriptResult,
} from "./compile-core";

export type { CompileScriptOptions, CompileScriptResult };

export async function compileScriptInBrowser(
  source: string,
  options: CompileScriptOptions,
): Promise<CompileScriptResult> {
  return compileWithAsc(asc as unknown as AscLike, source, options);
}
