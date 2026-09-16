// Ported from orion src/library/models/chart/indicators/indicator-bundle-delta.ts
// Only the type imports changed (they now come from @fxtoolkit/indicator-stdlib/abi).

import type {
  IndicatorRenderBundle,
  IndicatorSeries,
  IndicatorSeriesPoint,
  IndicatorBundleDelta,
} from "@fxtoolkit/indicator-stdlib/abi";

/**
 * Applies a worker delta in place. Bundles are runtime cache objects rather
 * than document state, so mutation avoids copying historical series per tick.
 */
export function applyIndicatorBundleDelta(
  bundle: IndicatorRenderBundle,
  delta: IndicatorBundleDelta,
) {
  if (bundle.id !== delta.indicatorId) {
    throw new Error(`Indicator delta ${delta.indicatorId} targets ${bundle.id}`);
  }

  for (const series of bundle.series) {
    removeProvisionalPoints(series.points);
  }

  const seriesById = new Map(bundle.series.map((series) => [series.id, series]));

  for (const seriesDelta of delta.series) {
    let series = seriesById.get(seriesDelta.id);
    if (!series) {
      series = {
        id: seriesDelta.id,
        indicatorId: seriesDelta.indicatorId,
        kind: seriesDelta.kind,
        points: [],
        style: { ...seriesDelta.style },
      };
      bundle.series.push(series);
      seriesById.set(series.id, series);
    } else {
      series.kind = seriesDelta.kind;
      series.style = { ...seriesDelta.style };
    }

    for (let index = 0; index < seriesDelta.times.length; index += 1) {
      upsertPoint(series, {
        committed: seriesDelta.committed[index] === 1,
        revision: delta.revision,
        style: { ...(seriesDelta.styles[index] ?? {}) },
        text: seriesDelta.texts[index] ?? null,
        time: seriesDelta.times[index],
        value: seriesDelta.values[index],
      });
    }
  }

  bundle.alerts = delta.alerts.map((alert) => ({
    ...alert,
    payload: alert.payload ? { ...alert.payload } : null,
  }));
  bundle.fills = delta.fills.map((fill) => ({
    ...fill,
    style: { ...fill.style },
  }));
  bundle.objects = delta.objects.map((object) => ({
    ...object,
    style: { ...object.style },
  }));
  bundle.signals = delta.signals.map((signal) => ({
    ...signal,
    payload: signal.payload ? { ...signal.payload } : null,
  }));

  return bundle;
}

export function getIndicatorBundleRevision(
  bundle: IndicatorRenderBundle,
) {
  let revision = 0;
  for (const series of bundle.series) {
    for (const point of series.points) revision = Math.max(revision, point.revision);
  }
  for (const fill of bundle.fills) revision = Math.max(revision, fill.revision);
  for (const object of bundle.objects) revision = Math.max(revision, object.revision);
  for (const alert of bundle.alerts) revision = Math.max(revision, alert.revision);
  for (const signal of bundle.signals) revision = Math.max(revision, signal.revision);
  return revision;
}

function removeProvisionalPoints(points: IndicatorSeriesPoint[]) {
  while (points.length && !points[points.length - 1].committed) points.pop();
}

function upsertPoint(
  series: IndicatorSeries,
  point: IndicatorSeriesPoint,
) {
  const points = series.points;
  const lastPoint = points[points.length - 1];

  if (!lastPoint || lastPoint.time < point.time) {
    points.push(point);
    return;
  }

  if (lastPoint.time === point.time) {
    points[points.length - 1] = point;
    return;
  }

  const index = lowerBoundPoint(points, point.time);
  if (points[index]?.time === point.time) points[index] = point;
  else points.splice(index, 0, point);
}

function lowerBoundPoint(
  points: IndicatorSeriesPoint[],
  target: number,
) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].time < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
