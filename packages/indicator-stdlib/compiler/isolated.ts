/**
 * Runs `compileScript` on a worker thread.
 *
 * A pathological script (deep generic expansion, recursive types) can make the compiler spin; the
 * worker can be terminated on a wall-clock deadline, which is the only way to bound it. Use this for
 * anything not already trusted.
 *
 * Requires the **built** package: the worker is a separate emitted entry (`compile-worker.js`), so
 * running this from source will not find it.
 */

import { compileScript, type CompileScriptOptions, type CompileScriptResult } from "./compile";

export interface CompileScriptIsolatedOptions extends CompileScriptOptions {
  /** Wall-clock deadline in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function compileScriptIsolated(
  source: string,
  options: CompileScriptIsolatedOptions,
): Promise<CompileScriptResult> {
  const { Worker } = await import("node:worker_threads");
  const { fileURLToPath } = await import("node:url");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const workerUrl = new URL("./compile-worker.js", import.meta.url);

  return new Promise<CompileScriptResult>((resolve) => {
    const worker = new Worker(fileURLToPath(workerUrl), {
      workerData: { module: options.module, source },
    });

    let settled = false;
    const finish = (result: CompileScriptResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        diagnostics: [
          {
            level: "error",
            message: `Compilation exceeded ${timeoutMs}ms and was terminated`,
          },
        ],
        ok: false,
      });
    }, timeoutMs);

    worker.on("message", (message: CompileScriptResult) => {
      finish(message);
    });

    worker.on("error", (error: Error) => {
      finish({
        diagnostics: [{ level: "error", message: error.message }],
        ok: false,
      });
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        finish({
          diagnostics: [
            { level: "error", message: `Compiler worker exited with code ${code}` },
          ],
          ok: false,
        });
      }
    });
  });
}

export { compileScript };
