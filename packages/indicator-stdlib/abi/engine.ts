/**
 * Worker <-> main-thread indicator engine transport types.
 *
 * Ported from orion `src/library/models/chart/indicators/indicator-engine-types.ts`.
 */

import type {
  ChartBar,
  IndicatorAlert,
  IndicatorAlertEvent,
  IndicatorConfig,
  IndicatorFill,
  IndicatorInstance,
  IndicatorObject,
  IndicatorRenderBundle,
  IndicatorSeriesKind,
  IndicatorSignal,
  IndicatorSignalEvent,
} from "./chart";
import type { IndicatorManifest } from "./manifest";

export interface IndicatorEngineStatePayload {
  alertEvents: IndicatorAlertEvent[];
  bundles: IndicatorRenderBundle[];
  emittedAlerts: IndicatorAlert[];
  signalEvents: IndicatorSignalEvent[];
  emittedSignals: IndicatorSignal[];
}

/** Compact numeric transport for the hot realtime series path. */
export interface IndicatorSeriesDelta {
  committed: Uint8Array;
  id: string;
  indicatorId: string;
  kind: IndicatorSeriesKind;
  style: Record<string, unknown>;
  styles: Record<string, unknown>[];
  texts: Array<string | null>;
  times: Float64Array;
  values: Float64Array;
}

export interface IndicatorBundleDelta {
  alerts: IndicatorAlert[];
  fills: IndicatorFill[];
  indicatorId: string;
  objects: IndicatorObject[];
  revision: number;
  series: IndicatorSeriesDelta[];
  signals: IndicatorSignal[];
}

export interface IndicatorEngineIncrementalPayload {
  alertEvents: IndicatorAlertEvent[];
  bundleDeltas: IndicatorBundleDelta[];
  emittedAlerts: IndicatorAlert[];
  emittedSignals: IndicatorSignal[];
  signalEvents: IndicatorSignalEvent[];
}

export interface IndicatorBarBatch {
  close: Float64Array;
  high: Float64Array;
  low: Float64Array;
  open: Float64Array;
  spread: Float64Array;
  symbol: string;
  time: Float64Array;
  volume: Float64Array;
}

export type IndicatorEngineRequest =
  | {
      /**
       * Manifest URL the worker resolves modules from. Orion hardcoded this inside the
       * runtime; the standalone engine's worker receives it per init instead.
       */
      manifestUrl: string;
      requestId: string;
      type: "init";
    }
  | {
      requestId: string;
      type: "replace-history-bars";
      bars: IndicatorBarBatch;
    }
  | {
      requestId: string;
      type: "load-indicator";
      indicator: IndicatorConfig;
    }
  | {
      requestId: string;
      type: "remove-indicator";
      indicatorId: string;
    }
  | {
      requestId: string;
      type: "update-realtime-bar";
      bar: ChartBar;
    }
  | {
      requestId: string;
      type: "append-realtime-bar";
      bar: ChartBar;
    };

export type IndicatorEngineResponse =
  | {
      ok: true;
      manifest: IndicatorManifest;
      requestId: string;
      type: "init";
    }
  | {
      ok: true;
      payload: IndicatorEngineStatePayload;
      requestId: string;
      type: "replace-history-bars";
    }
  | {
      ok: true;
      payload: IndicatorEngineIncrementalPayload;
      requestId: string;
      type: "update-realtime-bar" | "append-realtime-bar";
    }
  | {
      ok: true;
      bundle: IndicatorRenderBundle;
      instance: IndicatorInstance;
      requestId: string;
      type: "load-indicator";
    }
  | {
      ok: true;
      indicatorId: string;
      requestId: string;
      type: "remove-indicator";
    }
  | {
      ok: false;
      error: string;
      requestId: string;
      type: IndicatorEngineRequest["type"];
    };
