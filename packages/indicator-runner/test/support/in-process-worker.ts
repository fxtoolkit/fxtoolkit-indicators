/**
 * Runs the indicator worker module in-process so tests can drive the real engine + worker
 * without a browser `Worker`.
 *
 * The worker module resolves `self` at import time and assigns `self.onmessage`, so a fake
 * worker scope is installed before the dynamic import. The module is evaluated once per
 * process, so the scope (and the response sink) are shared: the most recently created handle
 * receives responses.
 */

interface WorkerScope {
  onmessage: ((event: { data: unknown }) => unknown) | null;
  postMessage: (data: unknown, transferables?: unknown[]) => void;
}

export interface InProcessWorkerHandle {
  asWorker: () => Worker;
}

let responseSink: ((event: MessageEvent) => void) | null = null;
let workerModule: Promise<unknown> | null = null;

const scope: WorkerScope = {
  onmessage: null,
  postMessage: (data) => {
    responseSink?.({ data } as MessageEvent);
  },
};

export async function createInProcessWorker(): Promise<InProcessWorkerHandle> {
  if (!workerModule) {
    (globalThis as { self?: unknown }).self = scope;
    workerModule = import("../../src/engine/worker");
  }

  await workerModule;

  const worker = {
    onerror: null as unknown,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onmessageerror: null as unknown,
    postMessage(data: unknown) {
      // The worker handler is async; its responses arrive through scope.postMessage.
      void Promise.resolve(scope.onmessage?.({ data }));
    },
    terminate() {},
  };

  responseSink = (event) => worker.onmessage?.(event);

  return {
    asWorker: () => worker as unknown as Worker,
  };
}
