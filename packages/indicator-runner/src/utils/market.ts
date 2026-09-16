/** Estimates a display pip size when an instrument does not provide one. */
export function getDummyPipSizeForSymbol(symbol: string, volatility = 0): number {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const absoluteVolatility = Math.abs(volatility);
  const isForex = /^[A-Z]{6}$/.test(normalized);
  const isCrypto =
    /(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|LTC|USDT|USDC)$/.test(normalized)
    || normalized.endsWith("USD");

  if (isForex) {
    const basePip = normalized.endsWith("JPY") ? 0.01 : 0.0001;
    if (absoluteVolatility > 0.03) return basePip * 10;
    if (absoluteVolatility > 0.015) return basePip * 5;
    return basePip;
  }

  if (isCrypto) {
    let basePip = 0.01;
    if (normalized.startsWith("BTC")) basePip = 0.5;
    else if (normalized.startsWith("ETH")) basePip = 0.05;
    else if (normalized.startsWith("XRP") || normalized.startsWith("DOGE")) basePip = 0.0001;

    if (absoluteVolatility > 0.08) return basePip * 5;
    if (absoluteVolatility > 0.03) return basePip * 2;
    return basePip;
  }

  if (absoluteVolatility > 0.05) return 1;
  if (absoluteVolatility > 0.01) return 0.1;
  return 0.01;
}

/** Reads a string field from provider metadata without trusting wire input. */
export function getStringFromMeta(meta: unknown, key: string): string | undefined {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }

  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Relative volatility of a series, used as the input to pip-size estimation.
 *
 * Ported from the identical local helpers in orion `workers/indicator-engine.worker.ts` and
 * `models/chart/index.ts`. Those two copies are left untouched so the parity-tested worker stays
 * textually comparable to Orion; this is the shared one the model uses.
 */
export function getSeriesVolatility(
  bars: readonly { close: number; high: number; low: number }[],
): number {
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

/** Infers a bar interval from the smallest positive gap in a series. */
export function inferTimeFrameMs(
  bars: readonly { time: number }[],
  fallbackMs = 4 * 60 * 60 * 1000,
): number {
  if (bars.length < 2) {
    return fallbackMs;
  }

  let lowestPositiveDelta = Number.POSITIVE_INFINITY;

  for (let index = 1; index < bars.length; index += 1) {
    const delta = bars[index].time - bars[index - 1].time;

    if (delta > 0) {
      lowestPositiveDelta = Math.min(lowestPositiveDelta, delta);
    }
  }

  return Number.isFinite(lowestPositiveDelta) && lowestPositiveDelta > 0
    ? lowestPositiveDelta
    : fallbackMs;
}
