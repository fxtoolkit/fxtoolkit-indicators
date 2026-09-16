/**
 * The compiler's virtual filesystem.
 *
 * `asc` resolves a bare specifier by asking `readFile` for candidate paths, so the resolver is also
 * the import whitelist: anything we do not recognise returns `null`, which surfaces as a normal
 * "file not found" diagnostic. A script therefore cannot import anything except the standard library.
 */

import { STDLIB_SOURCE } from "./stdlib-source.generated";

/** The only module specifier an indicator script may import. */
export const STDLIB_SPECIFIER = "@fxtoolkit/indicator-stdlib";

/** Virtual filename `asc` compiles the user's script under. */
export const ENTRY_FILENAME = "input.ts";

/** Virtual directory offered to `asc` via `--path`, seeded so it has a candidate base to try. */
export const PACKAGE_SEARCH_DIRECTORY = "vfs";

const STDLIB_SUFFIX = `${STDLIB_SPECIFIER}/index.ts`;

export interface VirtualFileSystem {
  /**
   * `asc` calls this for the entry file and for every import. Returning null is how an unauthorised
   * import fails.
   */
  readFile(filename: string): string | null;
}

export function createVirtualFileSystem(userSource: string): VirtualFileSystem {
  return {
    readFile(filename) {
      const normalized = filename.replace(/\\/g, "/").replace(/^\.\//, "");

      if (normalized === ENTRY_FILENAME) {
        return userSource;
      }

      // Match on the suffix: `asc` builds candidate paths relative to the base directory, and the
      // exact prefix depends on its resolution internals.
      if (normalized.endsWith(STDLIB_SUFFIX)) {
        return STDLIB_SOURCE;
      }

      return null;
    },
  };
}
