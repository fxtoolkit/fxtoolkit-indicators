// Ported from orion src/library/models/chart/indicators/indicator-engine.ts
//
// Changes from Orion:
//   - The worker is supplied by the host (`createWorker`) instead of Vite's
//     `import IndicatorEngineWorker from "...?worker"`, so the package does not depend on a
//     bundler-specific worker import.
//   - `init` carries the manifest URL, because the worker no longer hardcodes one.

import {
  type ChartBar,
  type IndicatorConfig,
  type IndicatorBarBatch,
  type IndicatorEngineRequest,
  type IndicatorEngineResponse,
  type IndicatorManifest,
} from "@fxtoolkit/indicator-stdlib/abi";
import { getStringFromMeta } from "../utils/market";

export interface IndicatorEngineOptions {
  /** Builds the worker that executes compiled indicators. */
  createWorker: () => Worker;
  /** Manifest URL the worker resolves indicator modules from. */
  manifestUrl: string;
}

type IndicatorEngineRequestType = IndicatorEngineRequest["type"];
type IndicatorEngineRequestPayload<
  TType extends IndicatorEngineRequestType,
> = Omit<
  Extract<IndicatorEngineRequest, { type: TType }>,
  "requestId" | "type"
>;

export interface IndicatorEnginePerformanceSnapshot {
  averageRoundTripMs: number;
  completedRequests: number;
  lastRoundTripMs: number;
  maxRoundTripMs: number;
  pendingRequests: number;
}

export default class IndicatorEngine {
  private readonly worker: Worker;
  private readonly manifestUrl: string;
  private readonly pending = new Map<
    string,
    {
      reject: (reason?: unknown) => void;
      resolve: (response: IndicatorEngineResponse) => void;
    }
  >();
  private initialized = false;
  private initializationPromise: Promise<IndicatorManifest | null> | null = null;
  private manifest: IndicatorManifest | null = null;
  private requestCount = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private completedRequestCount = 0;
  private totalRoundTripMs = 0;
  private lastRoundTripMs = 0;
  private maxRoundTripMs = 0;

  constructor(options: IndicatorEngineOptions) {
    this.manifestUrl = options.manifestUrl;
    this.worker = options.createWorker();
    this.worker.onmessage = (
      event: MessageEvent<IndicatorEngineResponse>,
    ) => {
      const response = event.data;
      const pendingRequest = this.pending.get(response.requestId);

      if (!pendingRequest) {
        return;
      }

      this.pending.delete(response.requestId);

      if (!response.ok) {
        pendingRequest.reject(new Error(response.error));
        return;
      }

      pendingRequest.resolve(response);
    };
    this.worker.onerror = (event) => {
      this.rejectPendingRequests(
        new Error(event.message || "Indicator worker failed"),
      );
    };
    this.worker.onmessageerror = () => {
      this.rejectPendingRequests(
        new Error("Indicator worker returned an unreadable response"),
      );
    };
  }

  destroy() {
    this.rejectPendingRequests(new Error("Indicator engine terminated"));
    this.worker.terminate();
  }

  async init() {
    if (this.initialized) {
      return this.manifest;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.sendDirect("init", {
        manifestUrl: this.manifestUrl,
      }).then((response) => {
        if (!response.ok || response.type !== "init") {
          throw new Error("Unexpected indicator engine response for init");
        }

        this.manifest = response.manifest;
        this.initialized = true;
        return this.manifest;
      });
    }

    return this.initializationPromise;
  }

  getManifest() {
    return this.manifest;
  }

  getPerformanceSnapshot(): IndicatorEnginePerformanceSnapshot {
    return {
      averageRoundTripMs: this.completedRequestCount
        ? this.totalRoundTripMs / this.completedRequestCount
        : 0,
      completedRequests: this.completedRequestCount,
      lastRoundTripMs: this.lastRoundTripMs,
      maxRoundTripMs: this.maxRoundTripMs,
      pendingRequests: this.pending.size,
    };
  }

  async loadIndicator(indicator: IndicatorConfig) {
    const response = await this.send("load-indicator", { indicator });

    if (!response.ok || response.type !== "load-indicator") {
      throw new Error(
        "Unexpected indicator engine response for load-indicator",
      );
    }

    return response;
  }

  async removeIndicator(indicatorId: string) {
    const response = await this.send("remove-indicator", { indicatorId });

    if (!response.ok || response.type !== "remove-indicator") {
      throw new Error(
        "Unexpected indicator engine response for remove-indicator",
      );
    }
  }

  async replaceHistoryBars(bars: ChartBar[]) {
    const response = await this.send("replace-history-bars", {
      bars: createBarBatch(bars),
    });

    if (!response.ok || response.type !== "replace-history-bars") {
      throw new Error(
        "Unexpected indicator engine response for replace-history-bars",
      );
    }

    return response.payload;
  }

  async updateRealtimeBar(bar: ChartBar) {
    const response = await this.send("update-realtime-bar", { bar });

    if (!response.ok || response.type !== "update-realtime-bar") {
      throw new Error(
        "Unexpected indicator engine response for update-realtime-bar",
      );
    }

    return response.payload;
  }

  async appendRealtimeBar(bar: ChartBar) {
    const response = await this.send("append-realtime-bar", { bar });

    if (!response.ok || response.type !== "append-realtime-bar") {
      throw new Error(
        "Unexpected indicator engine response for append-realtime-bar",
      );
    }

    return response.payload;
  }

  private async send<TType extends IndicatorEngineRequestType>(
    type: TType,
    payload?: IndicatorEngineRequestPayload<TType>,
  ) {
    if (type !== "init" && !this.initialized) {
      await this.init();
    }

    const task = this.requestQueue.then(
      () => this.sendDirect(type, payload),
      () => this.sendDirect(type, payload),
    );
    this.requestQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async sendDirect<TType extends IndicatorEngineRequestType>(
    type: TType,
    payload?: IndicatorEngineRequestPayload<TType>,
  ) {
    const startedAt = performance.now();

    const requestId = `${type}-${(this.requestCount += 1)}`;
    const request = {
      ...(payload ?? {}),
      requestId,
      type,
    } as IndicatorEngineRequest;

    const response = await new Promise<IndicatorEngineResponse>(
      (resolve, reject) => {
        this.pending.set(requestId, { reject, resolve });
        this.worker.postMessage(request, getRequestTransferables(request));
      },
    );

    const elapsed = performance.now() - startedAt;
    this.completedRequestCount += 1;
    this.totalRoundTripMs += elapsed;
    this.lastRoundTripMs = elapsed;
    this.maxRoundTripMs = Math.max(this.maxRoundTripMs, elapsed);
    return response;
  }

  private rejectPendingRequests(error: Error) {
    for (const pendingRequest of this.pending.values()) {
      pendingRequest.reject(error);
    }

    this.pending.clear();
  }
}

function createBarBatch(bars: ChartBar[]): IndicatorBarBatch {
  return {
    close: Float64Array.from(bars, (bar) => bar.close),
    high: Float64Array.from(bars, (bar) => bar.high),
    low: Float64Array.from(bars, (bar) => bar.low),
    open: Float64Array.from(bars, (bar) => bar.open),
    spread: Float64Array.from(bars, (bar) => bar.spread ?? 0),
    symbol: getStringFromMeta(bars[0]?.meta, "symbol") ?? "ETHUSD",
    time: Float64Array.from(bars, (bar) => bar.time),
    volume: Float64Array.from(bars, (bar) => bar.volume ?? 0),
  };
}

function getRequestTransferables(request: IndicatorEngineRequest) {
  if (request.type !== "replace-history-bars") return [];
  return [
    request.bars.close.buffer,
    request.bars.high.buffer,
    request.bars.low.buffer,
    request.bars.open.buffer,
    request.bars.spread.buffer,
    request.bars.time.buffer,
    request.bars.volume.buffer,
  ] as Transferable[];
}
