/**
 * Node-side in-memory AssemblyScript compiler for indicator scripts.
 *
 * Exported at `@fxtoolkit/indicator-stdlib/compiler` only — importing this subpath pulls in
 * `assemblyscript` and `@assemblyscript/loader`, which browser consumers of `./abi` never touch.
 *
 * `assemblyscript` is an optional peer dependency: install it where you compile.
 */

export {
  compileScript,
  type CompileScriptOptions,
  type CompileScriptResult,
} from "./compile";

export {
  compileScriptIsolated,
  type CompileScriptIsolatedOptions,
} from "./isolated";

export {
  ENTRY_FILENAME,
  PACKAGE_SEARCH_DIRECTORY,
  STDLIB_SPECIFIER,
} from "./virtual-files";
