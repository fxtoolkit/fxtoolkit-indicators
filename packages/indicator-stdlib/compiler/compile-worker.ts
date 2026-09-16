// Worker-thread entry for `compileScriptIsolated`. Not part of the public API.

import { parentPort, workerData } from "node:worker_threads";
import { compileScript } from "./compile";

interface CompileWorkerData {
  module: string;
  source: string;
}

const payload = workerData as CompileWorkerData;

const result = await compileScript(payload.source, { module: payload.module });

// `Uint8Array` survives structured cloning; the descriptor is plain JSON.
parentPort?.postMessage(result);
