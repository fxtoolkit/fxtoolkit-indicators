/**
 * Node in-memory compiler.
 *
 * Uses `asc`'s programmatic API with a virtual filesystem, so nothing touches disk: the user's
 * source and the packaged standard library are the entire input space, and only the standard library
 * is importable.
 *
 * All logic lives in `./compile-core`; this module only supplies the Node `asc` build.
 */

import asc from "assemblyscript/asc";
import {
  compileWithAsc,
  type AscLike,
  type CompileScriptOptions,
  type CompileScriptResult,
} from "./compile-core";

export type { CompileScriptOptions, CompileScriptResult };

export async function compileScript(
  source: string,
  options: CompileScriptOptions,
): Promise<CompileScriptResult> {
  return compileWithAsc(asc as unknown as AscLike, source, options);
}
