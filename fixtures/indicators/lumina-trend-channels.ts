// Ported verbatim from orion
// src/library/models/chart/indicators/assemblyscript/lumina-trend-channels.ts
// Only the import specifier changed: "orion-indicator-stdlib" -> "@fxtoolkit/indicator-stdlib".
//
// Compiled by scripts/build-fixtures.mjs; descriptor-parity fixture against
// fixtures/golden/manifest.json.
import {
  Bar,
  IndicatorContext,
  IndicatorDescriptor,
  InputField,
  buildBar,
  beginBatchBar,
  createIndicatorContext,
  describeIndicator,
  inputBool,
  inputInt,
  inputNumber,
  inputString,
} from "@fxtoolkit/indicator-stdlib";

const BUY_SIDE = "BUY";
const SELL_SIDE = "SELL";
const DEFAULT_LENGTH: i32 = 21;
const DEFAULT_OUTER_MULTIPLIER: f64 = 2.0;
const DEFAULT_INNER_MULTIPLIER: f64 = 1.0;
const DEFAULT_BULLISH_COLOR = "#00E676";
const DEFAULT_BEARISH_COLOR = "#FF5252";
const DEFAULT_SHOW_DASHBOARD = true;
const TREND_MARKER_SIZE: f64 = 7.0;
const SIGNAL_MARKER_SIZE: f64 = 10.0;
const SIGNAL_MARKER_OFFSET: f64 = 16.0;

const SERIES_UPPER_OUTER = "lumina-upper-outer";
const SERIES_UPPER_INNER = "lumina-upper-inner";
const SERIES_BASIS = "lumina-basis";
const SERIES_LOWER_INNER = "lumina-lower-inner";
const SERIES_LOWER_OUTER = "lumina-lower-outer";

const FILL_UPPER_OUTER = "lumina-fill-upper-outer";
const FILL_UPPER_INNER = "lumina-fill-upper-inner";
const FILL_LOWER_INNER = "lumina-fill-lower-inner";
const FILL_LOWER_OUTER = "lumina-fill-lower-outer";

const SHAPE_TREND_CHANGE = "lumina-trend-change";
const SHAPE_BUY_SIGNAL = "lumina-buy-signal";
const SHAPE_SELL_SIGNAL = "lumina-sell-signal";

const descriptor = new IndicatorDescriptor(
  "lumina-trend-channels",
  "Lumina Trend Channels",
  "1.0.0",
  "EMA + ATR trend channels with dynamic color, fills, and crossover signals.",
  [
    new InputField("length", "Channel Length", "integer", DEFAULT_LENGTH.toString(), "", 5, 200, 1),
    new InputField("outerMultiplier", "Outer Band Multiplier", "number", DEFAULT_OUTER_MULTIPLIER.toString(), "", 0.5, 10, 0.1),
    new InputField("innerMultiplier", "Inner Band Multiplier", "number", DEFAULT_INNER_MULTIPLIER.toString(), "", 0.2, 10, 0.1),
    new InputField("bullishColor", "Bullish Color", "color", DEFAULT_BULLISH_COLOR),
    new InputField("bearishColor", "Bearish Color", "color", DEFAULT_BEARISH_COLOR),
    new InputField("showDashboard", "Show Dashboard", "boolean", "true"),
  ],
  ["plot", "fill", "plotshape", "panel", "signal"],
);

let length: i32 = DEFAULT_LENGTH;
let outerMultiplier: f64 = DEFAULT_OUTER_MULTIPLIER;
let innerMultiplier: f64 = DEFAULT_INNER_MULTIPLIER;
let bullishColor = DEFAULT_BULLISH_COLOR;
let bearishColor = DEFAULT_BEARISH_COLOR;
let showDashboard = DEFAULT_SHOW_DASHBOARD;

let barsProcessed: i32 = 0;
let closeSeedCount: i32 = 0;
let closeSeedSum: f64 = 0.0;
let atrSeedCount: i32 = 0;
let atrSeedSum: f64 = 0.0;
let prevClose: f64 = NaN;
let prevEma: f64 = NaN;
let prevAtr: f64 = NaN;
let basisPrev1: f64 = NaN;
let basisPrev2: f64 = NaN;
let lastTrend: i32 = 1;

export function describe(): string {
  return describeIndicator(descriptor);
}

export function init(): void {
  length = inputInt("length", DEFAULT_LENGTH);
  outerMultiplier = inputNumber("outerMultiplier", DEFAULT_OUTER_MULTIPLIER);
  innerMultiplier = inputNumber("innerMultiplier", DEFAULT_INNER_MULTIPLIER);
  bullishColor = inputString("bullishColor", DEFAULT_BULLISH_COLOR);
  bearishColor = inputString("bearishColor", DEFAULT_BEARISH_COLOR);
  showDashboard = inputBool("showDashboard", DEFAULT_SHOW_DASHBOARD) as boolean;
}

export function reset(): void {
  barsProcessed = 0;
  closeSeedCount = 0;
  closeSeedSum = 0.0;
  atrSeedCount = 0;
  atrSeedSum = 0.0;
  prevClose = NaN;
  prevEma = NaN;
  prevAtr = NaN;
  basisPrev1 = NaN;
  basisPrev2 = NaN;
  lastTrend = 1;
}

export function destroy(): void {
  reset();
}

export function saveState(): string {
  const parts = new Array<string>();

  parts.push(barsProcessed.toString());
  parts.push(closeSeedCount.toString());
  parts.push(closeSeedSum.toString());
  parts.push(atrSeedCount.toString());
  parts.push(atrSeedSum.toString());
  parts.push(prevClose.toString());
  parts.push(prevEma.toString());
  parts.push(prevAtr.toString());
  parts.push(basisPrev1.toString());
  parts.push(basisPrev2.toString());
  parts.push(lastTrend.toString());

  return parts.join("\t");
}

export function loadState(state: string): void {
  reset();

  if (state.length == 0) {
    return;
  }

  const parts = state.split("\t");

  if (parts.length < 11) {
    return;
  }

  barsProcessed = i32(parseFloat(parts[0]));
  closeSeedCount = i32(parseFloat(parts[1]));
  closeSeedSum = parseFloat(parts[2]);
  atrSeedCount = i32(parseFloat(parts[3]));
  atrSeedSum = parseFloat(parts[4]);
  prevClose = parseFloat(parts[5]);
  prevEma = parseFloat(parts[6]);
  prevAtr = parseFloat(parts[7]);
  basisPrev1 = parseFloat(parts[8]);
  basisPrev2 = parseFloat(parts[9]);
  lastTrend = i32(parseFloat(parts[10]));
}

export const FLOAT64_ARRAY_ID: i32 = idof<Float64Array>();

export function onBars(
  times: Float64Array,
  opens: Float64Array,
  highs: Float64Array,
  lows: Float64Array,
  closes: Float64Array,
  volumes: Float64Array,
  spreads: Float64Array,
): void {
  const count = times.length;
  for (let index = 0; index < count; index += 1) {
    beginBatchBar();
    onBar(
      times[index],
      opens[index],
      highs[index],
      lows[index],
      closes[index],
      volumes[index],
      spreads[index],
      index,
      0,
      1,
      index == count - 1 ? 1 : 0,
    );
  }
}

export function onBar(
  time: f64,
  open: f64,
  high: f64,
  low: f64,
  close: f64,
  volume: f64,
  spread: f64,
  index: i32,
  isRealtime: i32,
  isConfirmed: i32,
  isLastBar: i32,
): void {
  const bar = buildBar(time, open, high, low, close, volume, spread);
  const context = createIndicatorContext(
    index,
    isRealtime != 0,
    isConfirmed != 0,
    isLastBar != 0,
  );
  const previousTrend = lastTrend;
  const previousBasis = basisPrev1;
  const basis = nextBasis(bar.close);
  const atr = nextAtr(bar);
  const hasBasis = !isNaN(basis);
  const hasAtr = !isNaN(atr);
  let currentTrend = lastTrend;

  if (isRisingBasis(basis)) {
    currentTrend = 1;
  } else if (isFallingBasis(basis)) {
    currentTrend = -1;
  }

  lastTrend = currentTrend;

  const color = currentTrend == 1 ? bullishColor : bearishColor;
  const committed = context.barState.isConfirmed;
  const upperOuter = hasBasis && hasAtr
    ? basis + atr * outerMultiplier
    : NaN;
  const upperInner = hasBasis && hasAtr
    ? basis + atr * innerMultiplier
    : NaN;
  const lowerInner = hasBasis && hasAtr
    ? basis - atr * innerMultiplier
    : NaN;
  const lowerOuter = hasBasis && hasAtr
    ? basis - atr * outerMultiplier
    : NaN;

  emitFills(context);

  if (hasBasis && hasAtr) {
    context.plot(SERIES_UPPER_OUTER, bar.time, upperOuter, color, 1.0, 0.5, false, committed);
    context.plot(SERIES_UPPER_INNER, bar.time, upperInner, color, 1.0, 0.3, false, committed);
    context.plot(SERIES_BASIS, bar.time, basis, color, 2.0, 1.0, false, committed);
    context.plot(SERIES_LOWER_INNER, bar.time, lowerInner, color, 1.0, 0.3, false, committed);
    context.plot(SERIES_LOWER_OUTER, bar.time, lowerOuter, color, 1.0, 0.5, false, committed);
  }

  if (barsProcessed > 0 && currentTrend != previousTrend && hasBasis) {
    context.plotshape(
      SHAPE_TREND_CHANGE,
      bar.time,
      basis,
      "circle",
      color,
      TREND_MARKER_SIZE,
      0,
      0,
      committed,
      "",
    );
  }

  if (
    currentTrend == 1
    && hasBasis
    && hasAtr
    && !isNaN(previousBasis)
    && !isNaN(prevClose)
    && prevClose <= previousBasis
    && bar.close > basis
  ) {
    context.plotshape(
      SHAPE_BUY_SIGNAL,
      bar.time,
      bar.low,
      "arrow-up",
      bullishColor,
      SIGNAL_MARKER_SIZE,
      0,
      SIGNAL_MARKER_OFFSET,
      committed,
      "",
    );
    context.signal(
      "lumina-buy-" + bar.time.toString(),
      BUY_SIDE,
      bar.time,
      bar.close,
      lowerOuter,
      upperOuter,
      "Bullish crossover above EMA baseline",
      committed,
      "",
    );
  }

  if (
    currentTrend == -1
    && hasBasis
    && hasAtr
    && !isNaN(previousBasis)
    && !isNaN(prevClose)
    && prevClose >= previousBasis
    && bar.close < basis
  ) {
    context.plotshape(
      SHAPE_SELL_SIGNAL,
      bar.time,
      bar.high,
      "arrow-down",
      bearishColor,
      SIGNAL_MARKER_SIZE,
      0,
      -SIGNAL_MARKER_OFFSET,
      committed,
      "",
    );
    context.signal(
      "lumina-sell-" + bar.time.toString(),
      SELL_SIDE,
      bar.time,
      bar.close,
      upperOuter,
      lowerOuter,
      "Bearish crossunder below EMA baseline",
      committed,
      "",
    );
  }

  if (showDashboard && context.barState.isLastBar) {
    emitDashboard(
      context,
      bar.close,
      currentTrend,
      basis,
      upperOuter,
      lowerOuter,
      atr,
      committed,
    );
  }

  if (hasBasis) {
    basisPrev2 = basisPrev1;
    basisPrev1 = basis;
  }

  prevClose = bar.close;
  barsProcessed += 1;
}

function emitFills(context: IndicatorContext): void {
  context.fill(FILL_UPPER_OUTER, SERIES_UPPER_OUTER, SERIES_UPPER_INNER, "", 0.15);
  context.fill(FILL_UPPER_INNER, SERIES_UPPER_INNER, SERIES_BASIS, "", 0.3);
  context.fill(FILL_LOWER_INNER, SERIES_BASIS, SERIES_LOWER_INNER, "", 0.3);
  context.fill(FILL_LOWER_OUTER, SERIES_LOWER_INNER, SERIES_LOWER_OUTER, "", 0.15);
}

function emitDashboard(
  context: IndicatorContext,
  close: f64,
  trend: i32,
  basis: f64,
  upperOuter: f64,
  lowerOuter: f64,
  atr: f64,
  committed: bool,
): void {
  const trendLabel = trend == 1 ? "Bullish" : "Bearish";
  const accent = trend == 1 ? bullishColor : bearishColor;
  const basisText = isNaN(basis) ? "n/a" : basis.toString();
  const upperText = isNaN(upperOuter) ? "n/a" : upperOuter.toString();
  const lowerText = isNaN(lowerOuter) ? "n/a" : lowerOuter.toString();
  const atrText = isNaN(atr) ? "n/a" : atr.toString();

  context.panel(
    "lumina-dashboard",
    "top-right",
    "Lumina Trend",
    "Trend: " + trendLabel
      + "\nClose: " + close.toString()
      + "\nBasis: " + basisText
      + "\nUpper: " + upperText
      + "\nLower: " + lowerText
      + "\nATR: " + atrText,
    "#f5f5f5",
    "rgba(28, 28, 28, 0.92)",
    accent,
    10.0,
    committed,
  );
}

function nextBasis(close: f64): f64 {
  if (length <= 0) {
    return NaN;
  }

  if (closeSeedCount < length) {
    closeSeedCount += 1;
    closeSeedSum += close;

    if (closeSeedCount == length) {
      prevEma = closeSeedSum / f64(length);
      return prevEma;
    }

    return NaN;
  }

  if (isNaN(prevEma)) {
    prevEma = close;
    return prevEma;
  }

  const smoothing = 2.0 / (f64(length) + 1.0);

  prevEma = prevEma + (close - prevEma) * smoothing;
  return prevEma;
}

function nextAtr(bar: Bar): f64 {
  if (length <= 0) {
    return NaN;
  }

  if (isNaN(prevClose)) {
    return NaN;
  }

  const range = trueRange(bar.high, bar.low, prevClose);

  if (atrSeedCount < length) {
    atrSeedCount += 1;
    atrSeedSum += range;

    if (atrSeedCount == length) {
      prevAtr = atrSeedSum / f64(length);
      return prevAtr;
    }

    return NaN;
  }

  if (isNaN(prevAtr)) {
    prevAtr = range;
    return prevAtr;
  }

  prevAtr = (prevAtr * f64(length - 1) + range) / f64(length);
  return prevAtr;
}

function trueRange(high: f64, low: f64, previousClose: f64): f64 {
  const highLow = high - low;
  const highClose = abs<f64>(high - previousClose);
  const lowClose = abs<f64>(low - previousClose);

  return max<f64>(highLow, max<f64>(highClose, lowClose));
}

function isRisingBasis(currentBasis: f64): bool {
  if (isNaN(currentBasis) || isNaN(basisPrev1) || isNaN(basisPrev2)) {
    return false;
  }

  return currentBasis > basisPrev1 && basisPrev1 > basisPrev2;
}

function isFallingBasis(currentBasis: f64): bool {
  if (isNaN(currentBasis) || isNaN(basisPrev1) || isNaN(basisPrev2)) {
    return false;
  }

  return currentBasis < basisPrev1 && basisPrev1 < basisPrev2;
}
