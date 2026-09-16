/// <reference lib="webworker" />

// Ported from orion src/library/models/chart/workers/indicator-engine.worker.ts
//
// Changes from Orion:
//   - ABI/transport types come from @fxtoolkit/indicator-stdlib/abi.
//   - The runtime is created lazily from the manifest URL carried by the `init` request
//     (Orion hardcoded the manifest URL inside the runtime).

import {
  type ChartBar,
  type IndicatorAlert,
  type IndicatorAlertEvent,
  type IndicatorConfig,
  type IndicatorFill,
  type IndicatorInstance,
  type IndicatorObject,
  type IndicatorRenderBundle,
  type IndicatorSeries,
  type IndicatorSeriesPoint,
  type IndicatorSignal,
  type IndicatorSignalEvent,
  type IndicatorBarBatch,
  type IndicatorBundleDelta,
  type IndicatorEngineRequest,
  type IndicatorEngineResponse,
  type IndicatorEngineStatePayload,
  type IndicatorRuntimeInfo,
  type IndicatorSeriesPointOutput,
  type IndicatorSessionOutputs,
} from "@fxtoolkit/indicator-stdlib/abi";
import IndicatorRuntime from "../runtime/indicator-runtime";
import { createUrlModuleSource } from "../runtime/module-source";
import { getDummyPipSizeForSymbol, getStringFromMeta } from "../utils/market";

const workerScope = self as DedicatedWorkerGlobalScope;

type IndicatorSessionHandle = Awaited<
  ReturnType<IndicatorRuntime["createSession"]>
>;

interface IndicatorRuntimeRecord {
  instance: IndicatorInstance;
  revision: number;
  session: IndicatorSessionHandle | null;
  snapshot: string;
}

let committedBars: ChartBar[] = [];
let liveBar: ChartBar | null = null;
let runtimeInfo = createRuntimeInfo([]);
let manifestUrl: string | null = null;
let indicatorRuntime: IndicatorRuntime | null = null;

function getIndicatorRuntime(): IndicatorRuntime {
  if (!indicatorRuntime) {
    if (!manifestUrl) {
      throw new Error("Indicator worker has not been initialized");
    }

    indicatorRuntime = new IndicatorRuntime(
      createUrlModuleSource({ manifestUrl }),
    );
  }

  return indicatorRuntime;
}

const indicatorRecords = new Map<string, IndicatorRuntimeRecord>();
const committedBundles = new Map<string, IndicatorRenderBundle>();
const currentBundles = new Map<string, IndicatorRenderBundle>();
const provisionalAlerts = new Map<string, IndicatorAlert>();
const provisionalSignals = new Map<string, IndicatorSignal>();

workerScope.onmessage = async (
  event: MessageEvent<IndicatorEngineRequest>,
) => {
  const request = event.data;

  try {
    if (request.type === "init") {
      manifestUrl = request.manifestUrl;

      postResponse({
        manifest: await getIndicatorRuntime().getManifest(),
        ok: true,
        requestId: request.requestId,
        type: "init",
      });
      return;
    }

    if (request.type === "replace-history-bars") {
      committedBars = normalizeBarBatch(request.bars);
      liveBar = null;
      runtimeInfo = createRuntimeInfo(committedBars);
      clearAllIndicatorSessions();
      committedBundles.clear();
      currentBundles.clear();
      provisionalAlerts.clear();
      provisionalSignals.clear();

      const indicators = selectIndicatorInstances();

      for (const indicator of indicators) {
        const bundle = await recomputeIndicatorCommittedHistory(
          indicator,
          committedBars,
        );

        committedBundles.set(indicator.id, bundle);
        currentBundles.set(indicator.id, bundle);
      }

      postResponse({
        ok: true,
        payload: createStatePayload(indicators),
        requestId: request.requestId,
        type: "replace-history-bars",
      });
      return;
    }

    if (request.type === "load-indicator") {
      const indicator = await resolveIncomingIndicator(request.indicator);

      upsertIndicatorInstance(indicator);

      if (!committedBars.length && liveBar) {
        runtimeInfo = createRuntimeInfo([liveBar]);
        clearAllIndicatorSessions();
      }

      const committedBundle = await recomputeIndicatorCommittedHistory(
        indicator,
        committedBars,
      );
      committedBundles.set(indicator.id, committedBundle);

      let currentBundle = committedBundle;

      if (liveBar) {
        const liveState = await updateIndicatorLiveState(
          indicator,
          liveBar,
          false,
        );
        currentBundle = liveState.bundle;
        syncIndicatorProvisionalAlerts(indicator.id, liveState.liveAlerts);
        syncIndicatorProvisionalSignals(indicator.id, liveState.liveSignals);
      } else {
        currentBundles.set(indicator.id, committedBundle);
      }

      postResponse({
        bundle: currentBundle,
        instance: indicator,
        ok: true,
        requestId: request.requestId,
        type: "load-indicator",
      });
      return;
    }

    if (request.type === "remove-indicator") {
      removeIndicator(request.indicatorId);

      postResponse({
        indicatorId: request.indicatorId,
        ok: true,
        requestId: request.requestId,
        type: "remove-indicator",
      });
      return;
    }

    if (request.type === "update-realtime-bar") {
      const indicators = selectIndicatorInstances();
      const alertEvents: IndicatorAlertEvent[] = [];
      const bundleDeltas: IndicatorBundleDelta[] = [];
      const signalEvents: IndicatorSignalEvent[] = [];
      const hadLiveBar = !!liveBar;
      const previousLiveTime = liveBar?.time ?? null;

      liveBar = normalizeBar(request.bar);

      if (!committedBars.length) {
        runtimeInfo = createRuntimeInfo([liveBar]);
        clearAllIndicatorSessions();
      }

      for (const indicator of indicators) {
        const liveState = await updateIndicatorLiveState(
          indicator,
          liveBar,
          !hadLiveBar || previousLiveTime !== liveBar.time,
        );

        alertEvents.push(
          ...diffProvisionalAlerts(indicator.id, liveState.liveAlerts),
        );
        bundleDeltas.push(liveState.delta);
        signalEvents.push(
          ...diffProvisionalSignals(indicator.id, liveState.liveSignals),
        );
      }

      const response: IndicatorEngineResponse = {
        ok: true,
        payload: {
          alertEvents,
          bundleDeltas,
          emittedAlerts: [],
          emittedSignals: [],
          signalEvents,
        },
        requestId: request.requestId,
        type: "update-realtime-bar",
      };
      postResponse(response, getDeltaTransferables(bundleDeltas));
      return;
    }

    const indicators = selectIndicatorInstances();
    const emittedAlerts: IndicatorAlert[] = [];
    const alertEvents: IndicatorAlertEvent[] = [];
    const bundleDeltas: IndicatorBundleDelta[] = [];
    const emittedSignals: IndicatorSignal[] = [];
    const signalEvents: IndicatorSignalEvent[] = [];
    const nextLiveBar = normalizeBar(request.bar);

    if (liveBar) {
      const previousLiveBar = liveBar;

      liveBar = null;
      appendCommittedBar(previousLiveBar);

      if (committedBars.length === 1) {
        runtimeInfo = createRuntimeInfo(committedBars);
        clearAllIndicatorSessions();
      }

      for (const indicator of indicators) {
        const nextSignals = await commitIndicatorLiveBar(
          indicator,
          previousLiveBar,
        );
        const nextAlerts = nextSignals.alerts;

        bundleDeltas.push(nextSignals.delta);
        alertEvents.push(
          ...finalizeProvisionalAlerts(indicator.id, nextAlerts),
        );
        signalEvents.push(
          ...finalizeProvisionalSignals(indicator.id, nextSignals.signals),
        );
        emittedAlerts.push(...nextAlerts);
        emittedSignals.push(...nextSignals.signals);
      }
    }

    liveBar = nextLiveBar;

    if (!committedBars.length) {
      runtimeInfo = createRuntimeInfo([liveBar]);
      clearAllIndicatorSessions();
    }

    for (const indicator of indicators) {
      const liveState = await updateIndicatorLiveState(
        indicator,
        liveBar,
        true,
      );

      alertEvents.push(
        ...diffProvisionalAlerts(indicator.id, liveState.liveAlerts),
      );
      bundleDeltas.push(liveState.delta);
      signalEvents.push(
        ...diffProvisionalSignals(indicator.id, liveState.liveSignals),
      );
    }

    const response: IndicatorEngineResponse = {
      ok: true,
      payload: {
        alertEvents,
        bundleDeltas,
        emittedAlerts,
        emittedSignals,
        signalEvents,
      },
      requestId: request.requestId,
      type: "append-realtime-bar",
    };
    postResponse(response, getDeltaTransferables(bundleDeltas));
  } catch (error) {
    postResponse({
      error:
        error instanceof Error ? error.message : "Unknown indicator engine error",
      ok: false,
      requestId: request.requestId,
      type: request.type,
    });
  }
};

function postResponse(
  response: IndicatorEngineResponse,
  transferables: Transferable[] = [],
) {
  workerScope.postMessage(response, transferables);
}

async function resolveIncomingIndicator(
  indicator: IndicatorConfig,
) {
  return getIndicatorRuntime().resolveIndicator({
    ...indicator,
    id: indicator.id ?? `${indicator.module}-instance`,
  });
}

function selectIndicatorInstances() {
  return Array.from(indicatorRecords.values())
    .map((record) => record.instance)
    .filter((indicator) => indicator.enabled)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function upsertIndicatorInstance(indicator: IndicatorInstance) {
  const existing = indicatorRecords.get(indicator.id);

  destroyIndicatorSession(indicator.id);
  indicatorRecords.set(indicator.id, {
    instance: indicator,
    revision: existing?.revision ?? 0,
    session: null,
    snapshot: "",
  });
}

function removeIndicator(indicatorId: string) {
  destroyIndicatorSession(indicatorId);
  indicatorRecords.delete(indicatorId);
  committedBundles.delete(indicatorId);
  currentBundles.delete(indicatorId);
  clearIndicatorProvisionalAlerts(indicatorId);
  clearIndicatorProvisionalSignals(indicatorId);
}

function destroyIndicatorSession(indicatorId: string) {
  const record = indicatorRecords.get(indicatorId);

  record?.session?.destroy();

  if (record) {
    record.session = null;
  }
}

function clearAllIndicatorSessions() {
  for (const record of indicatorRecords.values()) {
    record.session?.destroy();
    record.session = null;
  }
}

async function getIndicatorSession(
  indicator: IndicatorInstance,
) {
  const record = indicatorRecords.get(indicator.id);

  if (!record) {
    throw new Error(`Indicator instance "${indicator.id}" not found`);
  }

  if (record.session) {
    return record.session;
  }

  const session = await getIndicatorRuntime().createSession(
    record.instance,
    runtimeInfo,
  );

  record.session = session;
  return session;
}

async function recomputeIndicatorCommittedHistory(
  indicator: IndicatorInstance,
  bars: ChartBar[],
) {
  const session = await getIndicatorSession(indicator);

  try {
    session.restore(null);
    const outputs = session.processHistoryBars(bars);
    const revision = advanceIndicatorRevision(indicator.id);
    const nextOutputs = applyRevisionToOutputs(outputs, revision);
    const record = getIndicatorRecord(indicator.id);

    record.snapshot = session.saveState();
    return createBundle(indicator, nextOutputs);
  } catch (error) {
    destroyIndicatorSession(indicator.id);
    throw error;
  }
}

async function updateIndicatorLiveState(
  indicator: IndicatorInstance,
  nextLiveBar: ChartBar,
  isNewBar: boolean,
) {
  const session = await getIndicatorSession(indicator);
  const record = getIndicatorRecord(indicator.id);

  try {
    session.restore(record.snapshot);

    const revision = advanceIndicatorRevision(indicator.id);
    const outputs = applyRevisionToOutputs(
      session.processBar(nextLiveBar, {
        index: committedBars.length,
        isConfirmed: false,
        isFirst: committedBars.length === 0,
        isHistory: false,
        isLastBar: true,
        isNew: isNewBar,
        isRealtime: true,
      }),
      revision,
    );

    const committedBundle =
      committedBundles.get(indicator.id) ?? createEmptyBundle(indicator);
    const currentBundle = updateCurrentBundle(
      committedBundle,
      currentBundles.get(indicator.id),
      outputs,
    );

    currentBundles.set(indicator.id, currentBundle);
    return {
      bundle: currentBundle,
      delta: createBundleDelta(indicator.id, currentBundle, outputs, revision),
      liveAlerts: outputs.alerts.map(cloneAlert),
      liveSignals: outputs.signals.map(cloneSignal),
    };
  } catch (error) {
    destroyIndicatorSession(indicator.id);
    throw error;
  }
}

async function commitIndicatorLiveBar(
  indicator: IndicatorInstance,
  previousLiveBar: ChartBar,
) {
  const previousAlertIds = new Set(
    (committedBundles.get(indicator.id)?.alerts ?? []).map((alert) => alert.id),
  );
  const previousSignalIds = new Set(
    (committedBundles.get(indicator.id)?.signals ?? []).map((signal) => signal.id),
  );
  const session = await getIndicatorSession(indicator);
  const record = getIndicatorRecord(indicator.id);

  try {
    session.restore(record.snapshot);

    const revision = advanceIndicatorRevision(indicator.id);
    const outputs = applyRevisionToOutputs(
      session.processBar(previousLiveBar, {
        index: committedBars.length - 1,
        isConfirmed: true,
        isFirst: committedBars.length === 1,
        isHistory: false,
        isLastBar: true,
        isNew: false,
        isRealtime: false,
      }),
      revision,
    );

    record.snapshot = session.saveState();

    const nextCommittedBundle =
      committedBundles.get(indicator.id) ?? createEmptyBundle(indicator);
    mergeOutputsIntoBundleInPlace(nextCommittedBundle, outputs);

    committedBundles.set(indicator.id, nextCommittedBundle);
    currentBundles.set(indicator.id, nextCommittedBundle);

    return {
      alerts: nextCommittedBundle.alerts.filter(
        (alert) => !previousAlertIds.has(alert.id),
      ),
      delta: createBundleDelta(
        indicator.id,
        nextCommittedBundle,
        outputs,
        revision,
      ),
      signals: nextCommittedBundle.signals.filter(
        (signal) => !previousSignalIds.has(signal.id),
      ),
    };
  } catch (error) {
    destroyIndicatorSession(indicator.id);
    throw error;
  }
}

function createStatePayload(
  indicators: IndicatorInstance[],
): IndicatorEngineStatePayload {
  return {
    alertEvents: [],
    bundles: indicators.map((indicator) =>
      currentBundles.get(indicator.id)
      ?? committedBundles.get(indicator.id)
      ?? createEmptyBundle(indicator)
    ),
    emittedAlerts: [],
    emittedSignals: [],
    signalEvents: [],
  };
}

function createBundleDelta(
  indicatorId: string,
  bundle: IndicatorRenderBundle,
  outputs: IndicatorSessionOutputs,
  revision: number,
): IndicatorBundleDelta {
  const pointsBySeries = new Map<
    string,
    IndicatorSeriesPointOutput[]
  >();

  for (const point of outputs.seriesPoints) {
    const points = pointsBySeries.get(point.seriesId) ?? [];
    points.push(point);
    pointsBySeries.set(point.seriesId, points);
  }

  return {
    alerts: bundle.alerts.map(cloneAlert),
    fills: bundle.fills.map(cloneFill),
    indicatorId,
    objects: bundle.objects.map(cloneObject),
    revision,
    series: Array.from(pointsBySeries.entries()).map(([seriesId, points]) => ({
      committed: Uint8Array.from(points, (point) => point.committed ? 1 : 0),
      id: seriesId,
      indicatorId,
      kind: points[0].kind,
      style: { ...points[0].baseStyle },
      styles: points.map((point) => ({ ...point.style })),
      texts: points.map((point) => point.text),
      times: Float64Array.from(points, (point) => point.time),
      values: Float64Array.from(points, (point) => point.value),
    })),
    signals: bundle.signals.map(cloneSignal),
  };
}

function getDeltaTransferables(deltas: IndicatorBundleDelta[]) {
  return deltas.flatMap((delta) =>
    delta.series.flatMap((series) => [
      series.committed.buffer as ArrayBuffer,
      series.times.buffer as ArrayBuffer,
      series.values.buffer as ArrayBuffer,
    ])
  );
}

function makeAlertEventKey(alert: IndicatorAlert) {
  return `${alert.indicatorId}::${alert.id}`;
}

function cloneAlert(alert: IndicatorAlert): IndicatorAlert {
  return {
    ...alert,
    payload: alert.payload ? { ...alert.payload } : null,
  };
}

function alertsEquivalent(
  left: IndicatorAlert,
  right: IndicatorAlert,
) {
  return (
    left.id === right.id
    && left.indicatorId === right.indicatorId
    && left.title === right.title
    && left.time === right.time
    && left.price === right.price
    && left.message === right.message
    && left.committed === right.committed
    && payloadsEqual(left.payload, right.payload)
  );
}

function getIndicatorProvisionalAlertKeys(indicatorId: string) {
  return Array.from(provisionalAlerts.keys()).filter((key) =>
    key.startsWith(`${indicatorId}::`)
  );
}

function clearIndicatorProvisionalAlerts(indicatorId: string) {
  for (const key of getIndicatorProvisionalAlertKeys(indicatorId)) {
    provisionalAlerts.delete(key);
  }
}

function syncIndicatorProvisionalAlerts(
  indicatorId: string,
  alerts: IndicatorAlert[],
) {
  clearIndicatorProvisionalAlerts(indicatorId);

  for (const alert of alerts) {
    provisionalAlerts.set(makeAlertEventKey(alert), cloneAlert(alert));
  }
}

function diffProvisionalAlerts(
  indicatorId: string,
  nextAlerts: IndicatorAlert[],
): IndicatorAlertEvent[] {
  const nextAlertsByKey = new Map(
    nextAlerts.map((alert) => [makeAlertEventKey(alert), cloneAlert(alert)]),
  );
  const previousKeys = getIndicatorProvisionalAlertKeys(indicatorId);
  const events: IndicatorAlertEvent[] = [];

  for (const key of previousKeys) {
    const previousAlert = provisionalAlerts.get(key);

    if (!previousAlert) {
      continue;
    }

    const nextAlert = nextAlertsByKey.get(key);

    if (!nextAlert) {
      events.push({
        alert: cloneAlert(previousAlert),
        type: "revoked",
      });
      provisionalAlerts.delete(key);
      continue;
    }

    if (!alertsEquivalent(previousAlert, nextAlert)) {
      events.push({
        alert: cloneAlert(nextAlert),
        type: "provisional",
      });
    }

    provisionalAlerts.set(key, nextAlert);
    nextAlertsByKey.delete(key);
  }

  for (const [key, alert] of nextAlertsByKey) {
    provisionalAlerts.set(key, alert);
    events.push({
      alert: cloneAlert(alert),
      type: "provisional",
    });
  }

  return events;
}

function finalizeProvisionalAlerts(
  indicatorId: string,
  committedAlerts: IndicatorAlert[],
): IndicatorAlertEvent[] {
  const committedAlertsByKey = new Map(
    committedAlerts.map((alert) => [makeAlertEventKey(alert), cloneAlert(alert)]),
  );
  const previousKeys = getIndicatorProvisionalAlertKeys(indicatorId);
  const events: IndicatorAlertEvent[] = [];

  for (const key of previousKeys) {
    const previousAlert = provisionalAlerts.get(key);

    if (!previousAlert) {
      continue;
    }

    if (!committedAlertsByKey.has(key)) {
      events.push({
        alert: cloneAlert(previousAlert),
        type: "revoked",
      });
    }

    provisionalAlerts.delete(key);
  }

  for (const alert of committedAlertsByKey.values()) {
    events.push({
      alert: cloneAlert(alert),
      type: "confirmed",
    });
  }

  return events;
}

function makeSignalEventKey(signal: IndicatorSignal) {
  return `${signal.indicatorId}::${signal.id}`;
}

function cloneSignal(
  signal: IndicatorSignal,
): IndicatorSignal {
  return {
    ...signal,
    payload: signal.payload ? { ...signal.payload } : null,
  };
}

function payloadsEqual(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return left === right;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

function signalsEquivalent(
  left: IndicatorSignal,
  right: IndicatorSignal,
) {
  return (
    left.id === right.id
    && left.indicatorId === right.indicatorId
    && left.side === right.side
    && left.time === right.time
    && left.price === right.price
    && left.stopLoss === right.stopLoss
    && left.takeProfit === right.takeProfit
    && left.message === right.message
    && left.committed === right.committed
    && payloadsEqual(left.payload, right.payload)
  );
}

function getIndicatorProvisionalSignalKeys(indicatorId: string) {
  return Array.from(provisionalSignals.keys()).filter((key) =>
    key.startsWith(`${indicatorId}::`)
  );
}

function clearIndicatorProvisionalSignals(indicatorId: string) {
  for (const key of getIndicatorProvisionalSignalKeys(indicatorId)) {
    provisionalSignals.delete(key);
  }
}

function syncIndicatorProvisionalSignals(
  indicatorId: string,
  signals: IndicatorSignal[],
) {
  clearIndicatorProvisionalSignals(indicatorId);

  for (const signal of signals) {
    provisionalSignals.set(makeSignalEventKey(signal), cloneSignal(signal));
  }
}

function diffProvisionalSignals(
  indicatorId: string,
  nextSignals: IndicatorSignal[],
): IndicatorSignalEvent[] {
  const nextSignalsByKey = new Map(
    nextSignals.map((signal) => [makeSignalEventKey(signal), cloneSignal(signal)]),
  );
  const previousKeys = getIndicatorProvisionalSignalKeys(indicatorId);
  const events: IndicatorSignalEvent[] = [];

  for (const key of previousKeys) {
    const previousSignal = provisionalSignals.get(key);

    if (!previousSignal) {
      continue;
    }

    const nextSignal = nextSignalsByKey.get(key);

    if (!nextSignal) {
      events.push({
        signal: cloneSignal(previousSignal),
        type: "revoked",
      });
      provisionalSignals.delete(key);
      continue;
    }

    if (!signalsEquivalent(previousSignal, nextSignal)) {
      events.push({
        signal: cloneSignal(nextSignal),
        type: "provisional",
      });
    }

    provisionalSignals.set(key, nextSignal);
    nextSignalsByKey.delete(key);
  }

  for (const [key, signal] of nextSignalsByKey) {
    provisionalSignals.set(key, signal);
    events.push({
      signal: cloneSignal(signal),
      type: "provisional",
    });
  }

  return events;
}

function finalizeProvisionalSignals(
  indicatorId: string,
  committedSignals: IndicatorSignal[],
): IndicatorSignalEvent[] {
  const committedSignalsByKey = new Map(
    committedSignals.map((signal) => [makeSignalEventKey(signal), cloneSignal(signal)]),
  );
  const previousKeys = getIndicatorProvisionalSignalKeys(indicatorId);
  const events: IndicatorSignalEvent[] = [];

  for (const key of previousKeys) {
    const previousSignal = provisionalSignals.get(key);

    if (!previousSignal) {
      continue;
    }

    if (!committedSignalsByKey.has(key)) {
      events.push({
        signal: cloneSignal(previousSignal),
        type: "revoked",
      });
    }

    provisionalSignals.delete(key);
  }

  for (const signal of committedSignalsByKey.values()) {
    events.push({
      signal: cloneSignal(signal),
      type: "confirmed",
    });
  }

  return events;
}

function getIndicatorRecord(indicatorId: string) {
  const record = indicatorRecords.get(indicatorId);

  if (!record) {
    throw new Error(`Indicator instance "${indicatorId}" not found`);
  }

  return record;
}

function advanceIndicatorRevision(indicatorId: string) {
  const record = getIndicatorRecord(indicatorId);

  record.revision += 1;
  return record.revision;
}

function createBundle(
  indicator: IndicatorInstance,
  outputs: IndicatorSessionOutputs,
): IndicatorRenderBundle {
  return {
    alerts: mergeAlerts([], outputs.alerts),
    descriptor: indicator.descriptor,
    fills: mergeFills([], outputs.fills),
    id: indicator.id,
    module: indicator.module,
    objects: outputs.objects.map(cloneObject),
    series: mergeSeries([], outputs.seriesPoints),
    signals: mergeSignals([], outputs.signals),
  };
}

function createEmptyBundle(
  indicator: IndicatorInstance,
): IndicatorRenderBundle {
  return {
    alerts: [],
    descriptor: indicator.descriptor,
    fills: [],
    id: indicator.id,
    module: indicator.module,
    objects: [],
    series: [],
    signals: [],
  };
}

function applyRevisionToOutputs(
  outputs: IndicatorSessionOutputs,
  revision: number,
) {
  return {
    alerts: outputs.alerts.map((alert) => ({
      ...alert,
      revision,
    })),
    fills: outputs.fills.map((fill) => ({
      ...fill,
      revision,
    })),
    objects: outputs.objects.map((object) => ({
      ...object,
      revision,
    })),
    seriesPoints: outputs.seriesPoints.map((point) => ({
      ...point,
      revision,
    })),
    signals: outputs.signals.map((signal) => ({
      ...signal,
      revision,
    })),
  } satisfies IndicatorSessionOutputs;
}

function updateCurrentBundle(
  committedBundle: IndicatorRenderBundle,
  currentBundle: IndicatorRenderBundle | undefined,
  outputs: IndicatorSessionOutputs,
) {
  const nextBundle = !currentBundle || currentBundle === committedBundle
    ? cloneBundle(committedBundle)
    : currentBundle;

  for (const series of nextBundle.series) removeProvisionalSeriesPoints(series);
  mergeSeriesPointsInPlace(nextBundle.series, outputs.seriesPoints);
  nextBundle.alerts = mergeAlerts(committedBundle.alerts, outputs.alerts);
  nextBundle.fills = mergeFills(committedBundle.fills, outputs.fills);
  nextBundle.objects = outputs.objects.map(cloneObject);
  nextBundle.signals = mergeSignals(committedBundle.signals, outputs.signals);
  return nextBundle;
}

function mergeOutputsIntoBundleInPlace(
  bundle: IndicatorRenderBundle,
  outputs: IndicatorSessionOutputs,
) {
  mergeSeriesPointsInPlace(bundle.series, outputs.seriesPoints);
  bundle.alerts = mergeAlerts(bundle.alerts, outputs.alerts);
  bundle.fills = mergeFills(bundle.fills, outputs.fills);
  bundle.objects = outputs.objects.map(cloneObject);
  bundle.signals = mergeSignals(bundle.signals, outputs.signals);
}

function mergeSeriesPointsInPlace(
  series: IndicatorSeries[],
  nextPoints: IndicatorSeriesPointOutput[],
) {
  const seriesById = new Map(series.map((item) => [item.id, item]));

  for (const point of nextPoints) {
    let target = seriesById.get(point.seriesId);
    if (!target) {
      target = {
        id: point.seriesId,
        indicatorId: point.indicatorId,
        kind: point.kind,
        points: [],
        style: { ...point.baseStyle },
      };
      series.push(target);
      seriesById.set(target.id, target);
    }

    target.kind = point.kind;
    target.style = { ...point.baseStyle };
    upsertSeriesPoint(target.points, point);
  }
}

function removeProvisionalSeriesPoints(series: IndicatorSeries) {
  while (
    series.points.length &&
    !series.points[series.points.length - 1].committed
  ) {
    series.points.pop();
  }
}

function cloneBundle(
  bundle: IndicatorRenderBundle,
): IndicatorRenderBundle {
  return {
    alerts: bundle.alerts.map(cloneAlert),
    descriptor: bundle.descriptor,
    fills: bundle.fills.map(cloneFill),
    id: bundle.id,
    module: bundle.module,
    objects: bundle.objects.map(cloneObject),
    series: bundle.series.map((series) => ({
      ...series,
      points: series.points.slice(),
      style: { ...series.style },
    })),
    signals: bundle.signals.map(cloneSignal),
  };
}

function mergeSeries(
  baseSeries: IndicatorSeries[],
  nextPoints: IndicatorSeriesPointOutput[],
) {
  if (!nextPoints.length) {
    return baseSeries;
  }

  const series = baseSeries.slice();
  const seriesIndexById = new Map(
    series.map((currentSeries, index) => [currentSeries.id, index]),
  );
  const mutableSeries = new Map<string, IndicatorSeries>();

  for (const point of nextPoints) {
    const currentSeries = ensureMutableSeries(
      series,
      seriesIndexById,
      mutableSeries,
      point,
    );

    currentSeries.kind = point.kind;
    currentSeries.style = { ...point.baseStyle };
    upsertSeriesPoint(currentSeries.points, point);
  }

  return series;
}

function ensureMutableSeries(
  seriesList: IndicatorSeries[],
  seriesIndexById: Map<string, number>,
  mutableSeries: Map<string, IndicatorSeries>,
  point: IndicatorSeriesPointOutput,
) {
  const existingMutable = mutableSeries.get(point.seriesId);

  if (existingMutable) {
    return existingMutable;
  }

  const existingIndex = seriesIndexById.get(point.seriesId);

  if (existingIndex === undefined) {
    const nextSeries: IndicatorSeries = {
      id: point.seriesId,
      indicatorId: point.indicatorId,
      kind: point.kind,
      points: [],
      style: { ...point.baseStyle },
    };

    seriesList.push(nextSeries);
    seriesIndexById.set(point.seriesId, seriesList.length - 1);
    mutableSeries.set(point.seriesId, nextSeries);
    return nextSeries;
  }

  const currentSeries = seriesList[existingIndex];
  const nextSeries: IndicatorSeries = {
    ...currentSeries,
    kind: point.kind,
    points: currentSeries.points.slice(),
    style: { ...point.baseStyle },
  };

  seriesList[existingIndex] = nextSeries;
  mutableSeries.set(point.seriesId, nextSeries);
  return nextSeries;
}

function upsertSeriesPoint(
  points: IndicatorSeriesPoint[],
  point: IndicatorSeriesPointOutput,
) {
  const insertIndex = lowerBoundRenderSeriesPoint(points, point.time);
  const nextPoint = createSeriesPoint(point);

  if (
    insertIndex < points.length
    && points[insertIndex].time === point.time
  ) {
    points[insertIndex] = nextPoint;
    return;
  }

  if (insertIndex >= points.length) {
    points.push(nextPoint);
    return;
  }

  points.splice(insertIndex, 0, nextPoint);
}

function lowerBoundRenderSeriesPoint(
  points: IndicatorSeries["points"],
  target: number,
) {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const mid = (low + high) >> 1;

    if (points[mid].time < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function createSeriesPoint(point: IndicatorSeriesPointOutput) {
  return {
    committed: point.committed,
    revision: point.revision,
    style: { ...point.style },
    text: point.text,
    time: point.time,
    value: point.value,
  } satisfies IndicatorSeriesPoint;
}

function mergeFills(
  baseFills: IndicatorFill[],
  nextFills: IndicatorFill[],
) {
  if (!nextFills.length) {
    return baseFills;
  }

  const fills = baseFills.slice();
  const fillIndexById = new Map(
    fills.map((fill, index) => [fill.id, index]),
  );

  for (const fill of nextFills) {
    const nextFill = cloneFill(fill);
    const existingIndex = fillIndexById.get(fill.id);

    if (existingIndex === undefined) {
      fills.push(nextFill);
      fillIndexById.set(fill.id, fills.length - 1);
      continue;
    }

    fills[existingIndex] = nextFill;
  }

  return fills;
}

function mergeAlerts(
  baseAlerts: IndicatorAlert[],
  nextAlerts: IndicatorAlert[],
) {
  if (!nextAlerts.length) {
    return baseAlerts;
  }

  const alertMap = new Map(baseAlerts.map((alert) => [alert.id, alert]));

  for (const alert of nextAlerts) {
    alertMap.set(alert.id, cloneAlert(alert));
  }

  return Array.from(alertMap.values()).sort((left, right) => left.time - right.time);
}

function mergeSignals(
  baseSignals: IndicatorSignal[],
  nextSignals: IndicatorSignal[],
) {
  if (!nextSignals.length) {
    return baseSignals;
  }

  const signalMap = new Map(baseSignals.map((signal) => [signal.id, signal]));

  for (const signal of nextSignals) {
    signalMap.set(signal.id, cloneSignal(signal));
  }

  return Array.from(signalMap.values()).sort(
    (left, right) => left.time - right.time,
  );
}

function cloneFill(fill: IndicatorFill): IndicatorFill {
  return {
    ...fill,
    style: { ...fill.style },
  };
}

function cloneObject(
  object: IndicatorObject,
): IndicatorObject {
  return {
    ...object,
    style: { ...object.style },
  };
}

function createRuntimeInfo(bars: ChartBar[]): IndicatorRuntimeInfo {
  const symbol = getStringFromMeta(bars[0]?.meta, "symbol") ?? "ETHUSD";
  const volatility = getSeriesVolatility(bars);

  return {
    pipSize: getDummyPipSizeForSymbol(symbol, volatility),
    symbol,
    timeframeMs: inferTimeFrameMs(bars),
  };
}

function getSeriesVolatility(bars: ChartBar[]) {
  if (!bars.length) {
    return 0;
  }

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let closeTotal = 0;

  for (const bar of bars) {
    low = Math.min(low, bar.low);
    high = Math.max(high, bar.high);
    closeTotal += bar.close;
  }

  const averageClose = closeTotal / Math.max(bars.length, 1);

  if (!averageClose) {
    return 0;
  }

  return (high - low) / averageClose;
}

function inferTimeFrameMs(bars: ChartBar[]) {
  if (bars.length < 2) {
    return 4 * 60 * 60 * 1000;
  }

  let lowestPositiveDelta = Number.POSITIVE_INFINITY;

  for (let index = 1; index < bars.length; index += 1) {
    const delta = bars[index].time - bars[index - 1].time;

    if (delta > 0) {
      lowestPositiveDelta = Math.min(lowestPositiveDelta, delta);
    }
  }

  if (!Number.isFinite(lowestPositiveDelta)) {
    return 4 * 60 * 60 * 1000;
  }

  return lowestPositiveDelta;
}

function appendCommittedBar(bar: ChartBar) {
  const nextBar = normalizeBar(bar);
  const lastBar = committedBars[committedBars.length - 1];

  if (!lastBar || nextBar.time > lastBar.time) {
    committedBars.push(nextBar);
    return;
  }

  if (nextBar.time === lastBar.time) {
    committedBars[committedBars.length - 1] = nextBar;
    return;
  }

  committedBars = normalizeBars([...committedBars, nextBar]);
}

function normalizeBars(bars: ChartBar[]) {
  const barsByTime = new Map<number, ChartBar>();

  for (const bar of bars) {
    barsByTime.set(bar.time, normalizeBar(bar));
  }

  return Array.from(barsByTime.values()).sort((left, right) => left.time - right.time);
}

function normalizeBarBatch(
  batch: IndicatorBarBatch,
) {
  const bars: ChartBar[] = [];
  for (let index = 0; index < batch.time.length; index += 1) {
    bars.push({
      close: batch.close[index],
      high: batch.high[index],
      low: batch.low[index],
      meta: { symbol: batch.symbol },
      open: batch.open[index],
      spread: batch.spread[index],
      time: batch.time[index],
      volume: batch.volume[index],
    });
  }
  return normalizeBars(bars);
}

function normalizeBar(bar: ChartBar): ChartBar {
  return {
    ...bar,
    meta: bar.meta,
  };
}
