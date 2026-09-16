// Ported verbatim from orion
// src/library/models/chart/indicators/assemblyscript/reverse-logic-scalper.ts
// Only the import specifier changed: "orion-indicator-stdlib" -> "@fxtoolkit/indicator-stdlib".
//
// Compiled by scripts/build-fixtures.mjs; descriptor-parity fixture against
// fixtures/golden/manifest.json.
import {
  Bar,
  IndicatorContext,
  IndicatorDescriptor,
  InputChoice,
  InputField,
  buildBar,
  beginBatchBar,
  createIndicatorContext,
  describeIndicator,
  deserializeBarsSnapshot,
  inputBool,
  inputInt,
  inputNumber,
  inputString,
  serializeBarsSnapshot,
} from "@fxtoolkit/indicator-stdlib";

const BUY_SIDE = "BUY";
const SELL_SIDE = "SELL";

const ATR_LENGTH: i32 = 14;
const VOLUME_AVERAGE_LENGTH: i32 = 20;
const ATR_AVERAGE_LENGTH: i32 = 50;

const DEFAULT_SR_LOOKBACK: i32 = 20;
const DEFAULT_SR_TOLERANCE_PCT: f64 = 0.3;
const DEFAULT_BB_LENGTH: i32 = 20;
const DEFAULT_BB_MULTIPLIER: f64 = 2.0;
const DEFAULT_FAST_MA_LENGTH: i32 = 9;
const DEFAULT_SLOW_MA_LENGTH: i32 = 21;
const DEFAULT_MA_TYPE = "EMA";
const DEFAULT_MIN_SCORE: i32 = 2;
const DEFAULT_USE_VOLUME_FILTER: bool = true;
const DEFAULT_VOLUME_MULTIPLIER: f64 = 1.2;
const DEFAULT_USE_ATR_FILTER: bool = true;
const DEFAULT_ATR_MIN_MULTIPLIER: f64 = 0.5;
const DEFAULT_MIN_BARS_BETWEEN_SIGNALS: i32 = 3;
const DEFAULT_RISK_REWARD: f64 = 2.0;
const DEFAULT_ATR_STOP_MULTIPLIER: f64 = 1.5;

const DEFAULT_BULLISH_COLOR = "#00E676";
const DEFAULT_BEARISH_COLOR = "#FF5252";
const DEFAULT_SUPPORT_COLOR = "#22C55E";
const DEFAULT_RESISTANCE_COLOR = "#EF4444";

const SERIES_SUPPORT = "reverse-logic-support";
const SERIES_RESISTANCE = "reverse-logic-resistance";
const SERIES_BB_BASIS = "reverse-logic-bb-basis";
const SERIES_BB_UPPER = "reverse-logic-bb-upper";
const SERIES_BB_LOWER = "reverse-logic-bb-lower";
const SERIES_FAST_MA = "reverse-logic-fast-ma";
const SERIES_SLOW_MA = "reverse-logic-slow-ma";

const SHAPE_BUY = "reverse-logic-buy";
const SHAPE_SELL = "reverse-logic-sell";
const FILL_BOLLINGER = "reverse-logic-bollinger-fill";

const MA_CHOICES = new Array<InputChoice>();
MA_CHOICES.push(new InputChoice("EMA", "EMA"));
MA_CHOICES.push(new InputChoice("SMA", "SMA"));
MA_CHOICES.push(new InputChoice("WMA", "WMA"));

const descriptor = new IndicatorDescriptor(
  "reverse-logic-scalper",
  "Reverse Logic Scalper",
  "1.0.0",
  "Contrarian scalper signals using support/resistance, Bollinger breakouts, moving-average crosses, volume, and ATR filters.",
  [
    new InputField("srLookback", "S/R Lookback", "integer", DEFAULT_SR_LOOKBACK.toString(), "", 5, 100, 1),
    new InputField("srTolerancePct", "S/R Tolerance %", "number", DEFAULT_SR_TOLERANCE_PCT.toString(), "", 0.1, 1, 0.1),
    new InputField("bbLength", "BB Length", "integer", DEFAULT_BB_LENGTH.toString(), "", 5, 100, 1),
    new InputField("bbMultiplier", "BB Multiplier", "number", DEFAULT_BB_MULTIPLIER.toString(), "", 1, 4, 0.1),
    new InputField("fastMaLength", "Fast MA", "integer", DEFAULT_FAST_MA_LENGTH.toString(), "", 3, 100, 1),
    new InputField("slowMaLength", "Slow MA", "integer", DEFAULT_SLOW_MA_LENGTH.toString(), "", 5, 200, 1),
    new InputField("maType", "MA Type", "select", DEFAULT_MA_TYPE, "", NaN, NaN, NaN, MA_CHOICES),
    new InputField("minScore", "Minimum Score", "integer", DEFAULT_MIN_SCORE.toString(), "", 1, 3, 1),
    new InputField("useVolumeFilter", "Use Volume Filter", "boolean", "true"),
    new InputField("volumeMultiplier", "Volume Multiplier", "number", DEFAULT_VOLUME_MULTIPLIER.toString(), "", 0.5, 3, 0.1),
    new InputField("useAtrFilter", "Use ATR Filter", "boolean", "true"),
    new InputField("atrMinMultiplier", "ATR Min Multiplier", "number", DEFAULT_ATR_MIN_MULTIPLIER.toString(), "", 0.1, 2, 0.1),
    new InputField("minBarsBetweenSignals", "Signal Cooldown Bars", "integer", DEFAULT_MIN_BARS_BETWEEN_SIGNALS.toString(), "", 1, 50, 1),
    new InputField("riskReward", "Risk / Reward", "number", DEFAULT_RISK_REWARD.toString(), "", 0.5, 5, 0.1),
    new InputField("atrStopMultiplier", "ATR Stop Multiplier", "number", DEFAULT_ATR_STOP_MULTIPLIER.toString(), "", 0.5, 5, 0.1),
    new InputField("bullishColor", "Bullish Color", "color", DEFAULT_BULLISH_COLOR),
    new InputField("bearishColor", "Bearish Color", "color", DEFAULT_BEARISH_COLOR),
    new InputField("supportColor", "Support Color", "color", DEFAULT_SUPPORT_COLOR),
    new InputField("resistanceColor", "Resistance Color", "color", DEFAULT_RESISTANCE_COLOR),
    new InputField("showBollingerBands", "Show Bollinger Bands", "boolean", "true"),
    new InputField("showMovingAverages", "Show Moving Averages", "boolean", "true"),
    new InputField("showSupportResistance", "Show Support / Resistance", "boolean", "true"),
  ],
  ["plot", "fill", "plotshape", "signal"],
);

let srLookback: i32 = DEFAULT_SR_LOOKBACK;
let srTolerancePct: f64 = DEFAULT_SR_TOLERANCE_PCT;
let bbLength: i32 = DEFAULT_BB_LENGTH;
let bbMultiplier: f64 = DEFAULT_BB_MULTIPLIER;
let fastMaLength: i32 = DEFAULT_FAST_MA_LENGTH;
let slowMaLength: i32 = DEFAULT_SLOW_MA_LENGTH;
let maType = DEFAULT_MA_TYPE;
let minScore: i32 = DEFAULT_MIN_SCORE;
let useVolumeFilter: bool = DEFAULT_USE_VOLUME_FILTER;
let volumeMultiplier: f64 = DEFAULT_VOLUME_MULTIPLIER;
let useAtrFilter: bool = DEFAULT_USE_ATR_FILTER;
let atrMinMultiplier: f64 = DEFAULT_ATR_MIN_MULTIPLIER;
let minBarsBetweenSignals: i32 = DEFAULT_MIN_BARS_BETWEEN_SIGNALS;
let riskReward: f64 = DEFAULT_RISK_REWARD;
let atrStopMultiplier: f64 = DEFAULT_ATR_STOP_MULTIPLIER;
let bullishColor = DEFAULT_BULLISH_COLOR;
let bearishColor = DEFAULT_BEARISH_COLOR;
let supportColor = DEFAULT_SUPPORT_COLOR;
let resistanceColor = DEFAULT_RESISTANCE_COLOR;
let showBollingerBands: bool = true;
let showMovingAverages: bool = true;
let showSupportResistance: bool = true;

class BollingerBands {
  constructor(
    public basis: Array<f64>,
    public upper: Array<f64>,
    public lower: Array<f64>,
  ) {}
}

class SupportResistance {
  constructor(
    public support: Array<f64>,
    public resistance: Array<f64>,
  ) {}
}

class ReverseSignal {
  constructor(
    public index: i32,
    public id: string,
    public side: string,
    public price: f64,
    public stopLoss: f64,
    public takeProfit: f64,
    public time: f64,
    public score: i32,
    public reason: string,
    public payload: string,
  ) {}
}

class AnalysisResult {
  public support: Array<f64>;
  public resistance: Array<f64>;
  public bbBasis: Array<f64>;
  public bbUpper: Array<f64>;
  public bbLower: Array<f64>;
  public fastMa: Array<f64>;
  public slowMa: Array<f64>;
  public longSignals: Array<i32>;
  public shortSignals: Array<i32>;
  public signals: Array<ReverseSignal>;

  constructor(length: i32) {
    this.support = nullableSeries(length);
    this.resistance = nullableSeries(length);
    this.bbBasis = nullableSeries(length);
    this.bbUpper = nullableSeries(length);
    this.bbLower = nullableSeries(length);
    this.fastMa = nullableSeries(length);
    this.slowMa = nullableSeries(length);
    this.longSignals = new Array<i32>(length);
    this.shortSignals = new Array<i32>(length);
    this.signals = new Array<ReverseSignal>();

    for (let i = 0; i < length; i += 1) {
      this.longSignals[i] = 0;
      this.shortSignals[i] = 0;
    }
  }
}

let bars = new Array<Bar>();

export function describe(): string {
  return describeIndicator(descriptor);
}

export function init(): void {
  srLookback = inputInt("srLookback", DEFAULT_SR_LOOKBACK);
  srTolerancePct = inputNumber("srTolerancePct", DEFAULT_SR_TOLERANCE_PCT);
  bbLength = inputInt("bbLength", DEFAULT_BB_LENGTH);
  bbMultiplier = inputNumber("bbMultiplier", DEFAULT_BB_MULTIPLIER);
  fastMaLength = inputInt("fastMaLength", DEFAULT_FAST_MA_LENGTH);
  slowMaLength = inputInt("slowMaLength", DEFAULT_SLOW_MA_LENGTH);
  maType = inputString("maType", DEFAULT_MA_TYPE);
  minScore = inputInt("minScore", DEFAULT_MIN_SCORE);
  useVolumeFilter = inputBool("useVolumeFilter", DEFAULT_USE_VOLUME_FILTER);
  volumeMultiplier = inputNumber("volumeMultiplier", DEFAULT_VOLUME_MULTIPLIER);
  useAtrFilter = inputBool("useAtrFilter", DEFAULT_USE_ATR_FILTER);
  atrMinMultiplier = inputNumber("atrMinMultiplier", DEFAULT_ATR_MIN_MULTIPLIER);
  minBarsBetweenSignals = inputInt("minBarsBetweenSignals", DEFAULT_MIN_BARS_BETWEEN_SIGNALS);
  riskReward = inputNumber("riskReward", DEFAULT_RISK_REWARD);
  atrStopMultiplier = inputNumber("atrStopMultiplier", DEFAULT_ATR_STOP_MULTIPLIER);
  bullishColor = inputString("bullishColor", DEFAULT_BULLISH_COLOR);
  bearishColor = inputString("bearishColor", DEFAULT_BEARISH_COLOR);
  supportColor = inputString("supportColor", DEFAULT_SUPPORT_COLOR);
  resistanceColor = inputString("resistanceColor", DEFAULT_RESISTANCE_COLOR);
  showBollingerBands = inputBool("showBollingerBands", true);
  showMovingAverages = inputBool("showMovingAverages", true);
  showSupportResistance = inputBool("showSupportResistance", true);
}

export function reset(): void {
  bars = new Array<Bar>();
}

export function destroy(): void {
  reset();
}

export function saveState(): string {
  return serializeBarsSnapshot(bars);
}

export function loadState(state: string): void {
  bars = deserializeBarsSnapshot(state);
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

  bars.push(bar);

  if (!context.barState.isRealtime && !context.barState.isLastBar) {
    return;
  }

  emitAnalysis(context, analyzeBars(bars));
}

function nullableSeries(length: i32): Array<f64> {
  const result = new Array<f64>(length);

  for (let i = 0; i < length; i += 1) {
    result[i] = NaN;
  }

  return result;
}

function clampPeriod(value: i32): i32 {
  return max<i32>(1, value);
}

function calculateSma(values: Array<f64>, length: i32): Array<f64> {
  const period = clampPeriod(length);
  const result = nullableSeries(values.length);

  if (values.length < period) {
    return result;
  }

  let sum: f64 = 0.0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];

    if (i >= period) {
      sum -= values[i - period];
    }

    if (i >= period - 1) {
      result[i] = sum / f64(period);
    }
  }

  return result;
}

function calculateEma(values: Array<f64>, length: i32): Array<f64> {
  const period = clampPeriod(length);
  const result = nullableSeries(values.length);

  if (values.length < period) {
    return result;
  }

  let sum: f64 = 0.0;

  for (let i = 0; i < period; i += 1) {
    sum += values[i];
  }

  const multiplier = 2.0 / (f64(period) + 1.0);
  result[period - 1] = sum / f64(period);

  for (let i = period; i < values.length; i += 1) {
    const previous = isNaN(result[i - 1]) ? values[i - 1] : result[i - 1];
    result[i] = previous + (values[i] - previous) * multiplier;
  }

  return result;
}

function calculateWma(values: Array<f64>, length: i32): Array<f64> {
  const period = clampPeriod(length);
  const result = nullableSeries(values.length);
  const denominator = f64(period * (period + 1)) / 2.0;

  if (values.length < period) {
    return result;
  }

  for (let i = period - 1; i < values.length; i += 1) {
    let numerator: f64 = 0.0;

    for (let j = 0; j < period; j += 1) {
      numerator += values[i - period + 1 + j] * f64(j + 1);
    }

    result[i] = numerator / denominator;
  }

  return result;
}

function calculateMa(values: Array<f64>, length: i32, type: string): Array<f64> {
  if (type == "SMA") {
    return calculateSma(values, length);
  }

  if (type == "WMA") {
    return calculateWma(values, length);
  }

  return calculateEma(values, length);
}

function calculateBollingerBands(
  values: Array<f64>,
  length: i32,
  multiplier: f64,
): BollingerBands {
  const period = clampPeriod(length);
  const basis = nullableSeries(values.length);
  const upper = nullableSeries(values.length);
  const lower = nullableSeries(values.length);

  if (values.length < period) {
    return new BollingerBands(basis, upper, lower);
  }

  let sum: f64 = 0.0;
  let squaredSum: f64 = 0.0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    sum += value;
    squaredSum += value * value;

    if (i >= period) {
      const previous = values[i - period];
      sum -= previous;
      squaredSum -= previous * previous;
    }

    if (i >= period - 1) {
      const mean = sum / f64(period);
      const variance = max<f64>(0.0, squaredSum / f64(period) - mean * mean);
      const deviation = sqrt<f64>(variance);
      basis[i] = mean;
      upper[i] = mean + deviation * multiplier;
      lower[i] = mean - deviation * multiplier;
    }
  }

  return new BollingerBands(basis, upper, lower);
}

function trueRange(current: Bar, previous: Bar): f64 {
  const highLow = current.high - current.low;
  const highClose = abs<f64>(current.high - previous.close);
  const lowClose = abs<f64>(current.low - previous.close);

  return max<f64>(highLow, max<f64>(highClose, lowClose));
}

function calculateAtr(sourceBars: Array<Bar>, length: i32): Array<f64> {
  const period = clampPeriod(length);
  const result = nullableSeries(sourceBars.length);

  if (sourceBars.length <= period) {
    return result;
  }

  let trSum: f64 = 0.0;

  for (let i = 1; i <= period; i += 1) {
    trSum += trueRange(sourceBars[i], sourceBars[i - 1]);
  }

  let atrValue = trSum / f64(period);
  result[period] = atrValue;

  for (let i = period + 1; i < sourceBars.length; i += 1) {
    const range = trueRange(sourceBars[i], sourceBars[i - 1]);
    atrValue = (atrValue * f64(period - 1) + range) / f64(period);
    result[i] = atrValue;
  }

  return result;
}

function calculateNullableSma(values: Array<f64>, length: i32): Array<f64> {
  const period = clampPeriod(length);
  const result = nullableSeries(values.length);

  if (values.length < period) {
    return result;
  }

  let sum: f64 = 0.0;
  let validCount: i32 = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (!isNaN(value)) {
      sum += value;
      validCount += 1;
    }

    if (i >= period) {
      const previous = values[i - period];

      if (!isNaN(previous)) {
        sum -= previous;
        validCount -= 1;
      }
    }

    if (i >= period - 1 && validCount == period) {
      result[i] = sum / f64(period);
    }
  }

  return result;
}

function isPivotHigh(sourceBars: Array<Bar>, center: i32, lookback: i32): bool {
  if (center < lookback || center + lookback >= sourceBars.length) {
    return false;
  }

  const value = sourceBars[center].high;

  for (let i = center - lookback; i <= center + lookback; i += 1) {
    if (i == center) {
      continue;
    }

    const other = sourceBars[i].high;

    if (other > value || (i > center && other == value)) {
      return false;
    }
  }

  return true;
}

function isPivotLow(sourceBars: Array<Bar>, center: i32, lookback: i32): bool {
  if (center < lookback || center + lookback >= sourceBars.length) {
    return false;
  }

  const value = sourceBars[center].low;

  for (let i = center - lookback; i <= center + lookback; i += 1) {
    if (i == center) {
      continue;
    }

    const other = sourceBars[i].low;

    if (other < value || (i > center && other == value)) {
      return false;
    }
  }

  return true;
}

function calculateSupportResistance(sourceBars: Array<Bar>): SupportResistance {
  const support = nullableSeries(sourceBars.length);
  const resistance = nullableSeries(sourceBars.length);
  let currentSupport: f64 = NaN;
  let currentResistance: f64 = NaN;

  for (let i = 0; i < sourceBars.length; i += 1) {
    const pivotIndex = i - srLookback;

    if (
      pivotIndex >= srLookback
      && pivotIndex < sourceBars.length - srLookback
    ) {
      if (isPivotHigh(sourceBars, pivotIndex, srLookback)) {
        currentResistance = sourceBars[pivotIndex].high;
      }

      if (isPivotLow(sourceBars, pivotIndex, srLookback)) {
        currentSupport = sourceBars[pivotIndex].low;
      }
    }

    support[i] = currentSupport;
    resistance[i] = currentResistance;
  }

  return new SupportResistance(support, resistance);
}

function isCrossunder(
  fast: Array<f64>,
  slow: Array<f64>,
  index: i32,
): bool {
  if (index < 1) {
    return false;
  }

  const previousFast = fast[index - 1];
  const previousSlow = slow[index - 1];
  const currentFast = fast[index];
  const currentSlow = slow[index];

  if (
    isNaN(previousFast)
    || isNaN(previousSlow)
    || isNaN(currentFast)
    || isNaN(currentSlow)
  ) {
    return false;
  }

  return previousFast >= previousSlow && currentFast < currentSlow;
}

function isCrossover(
  fast: Array<f64>,
  slow: Array<f64>,
  index: i32,
): bool {
  if (index < 1) {
    return false;
  }

  const previousFast = fast[index - 1];
  const previousSlow = slow[index - 1];
  const currentFast = fast[index];
  const currentSlow = slow[index];

  if (
    isNaN(previousFast)
    || isNaN(previousSlow)
    || isNaN(currentFast)
    || isNaN(currentSlow)
  ) {
    return false;
  }

  return previousFast <= previousSlow && currentFast > currentSlow;
}

function boolText(value: bool): string {
  return value ? "true" : "false";
}

function numberText(value: f64): string {
  return isNaN(value) ? "null" : value.toString();
}

function buildSignalPayload(
  score: i32,
  nearResistance: bool,
  nearSupport: bool,
  bbLongSignal: bool,
  bbShortSignal: bool,
  maBearishCross: bool,
  maBullishCross: bool,
  volumeOk: bool,
  atrOk: bool,
  resistance: f64,
  support: f64,
): string {
  return "{\"score\":" + score.toString()
    + ",\"nearResistance\":" + boolText(nearResistance)
    + ",\"nearSupport\":" + boolText(nearSupport)
    + ",\"bbLongSignal\":" + boolText(bbLongSignal)
    + ",\"bbShortSignal\":" + boolText(bbShortSignal)
    + ",\"maBearishCross\":" + boolText(maBearishCross)
    + ",\"maBullishCross\":" + boolText(maBullishCross)
    + ",\"volumeOk\":" + boolText(volumeOk)
    + ",\"atrOk\":" + boolText(atrOk)
    + ",\"resistance\":" + numberText(resistance)
    + ",\"support\":" + numberText(support)
    + "}";
}

function analyzeBars(sourceBars: Array<Bar>): AnalysisResult {
  const analysis = new AnalysisResult(sourceBars.length);

  if (sourceBars.length == 0) {
    return analysis;
  }

  const closes = new Array<f64>(sourceBars.length);
  const volumes = new Array<f64>(sourceBars.length);

  for (let i = 0; i < sourceBars.length; i += 1) {
    closes[i] = sourceBars[i].close;
    volumes[i] = sourceBars[i].volume;
  }

  const supportResistance = calculateSupportResistance(sourceBars);
  const bollinger = calculateBollingerBands(closes, bbLength, bbMultiplier);
  const fastMa = calculateMa(closes, fastMaLength, maType);
  const slowMa = calculateMa(closes, slowMaLength, maType);
  const atr = calculateAtr(sourceBars, ATR_LENGTH);
  const volumeAverage = calculateSma(volumes, VOLUME_AVERAGE_LENGTH);
  const atrAverage = calculateNullableSma(atr, ATR_AVERAGE_LENGTH);

  analysis.support = supportResistance.support;
  analysis.resistance = supportResistance.resistance;
  analysis.bbBasis = bollinger.basis;
  analysis.bbUpper = bollinger.upper;
  analysis.bbLower = bollinger.lower;
  analysis.fastMa = fastMa;
  analysis.slowMa = slowMa;

  let lastSignalIndex: i32 = -1000000000;

  for (let i = 1; i < sourceBars.length; i += 1) {
    const bar = sourceBars[i];
    const resistanceLevel = analysis.resistance[i];
    const supportLevel = analysis.support[i];
    const atrValue = atr[i];
    const atrAverageValue = atrAverage[i];
    const volumeAverageValue = volumeAverage[i];
    const srZone = bar.close * (srTolerancePct / 100.0);
    const nearResistance =
      !isNaN(resistanceLevel)
      && abs<f64>(bar.close - resistanceLevel) <= srZone;
    const nearSupport =
      !isNaN(supportLevel)
      && abs<f64>(bar.close - supportLevel) <= srZone;
    const longBand = bollinger.upper[i];
    const shortBand = bollinger.lower[i];
    const bbLongSignal = !isNaN(longBand) && bar.close > longBand;
    const bbShortSignal = !isNaN(shortBand) && bar.close < shortBand;
    const maBearishCross = isCrossunder(fastMa, slowMa, i);
    const maBullishCross = isCrossover(fastMa, slowMa, i);
    const volumeOk = !useVolumeFilter
      || (!isNaN(volumeAverageValue)
        && bar.volume >= volumeAverageValue * volumeMultiplier);
    const atrOk = !useAtrFilter
      || (!isNaN(atrValue)
        && !isNaN(atrAverageValue)
        && atrValue >= atrAverageValue * atrMinMultiplier);

    const longScore: i32 =
      (nearResistance ? 1 : 0)
      + (bbLongSignal ? 1 : 0)
      + (maBearishCross ? 1 : 0);
    const shortScore: i32 =
      (nearSupport ? 1 : 0)
      + (bbShortSignal ? 1 : 0)
      + (maBullishCross ? 1 : 0);

    let shouldBuy = longScore >= minScore && volumeOk && atrOk;
    let shouldSell = shortScore >= minScore && volumeOk && atrOk;

    if (i - lastSignalIndex < minBarsBetweenSignals) {
      shouldBuy = false;
      shouldSell = false;
    }

    if (shouldBuy && shouldSell) {
      if (longScore > shortScore) {
        shouldSell = false;
      } else if (shortScore > longScore) {
        shouldBuy = false;
      } else {
        shouldBuy = false;
        shouldSell = false;
      }
    }

    if (!shouldBuy && !shouldSell) {
      continue;
    }

    const fallbackStopDistance = bar.high - bar.low;
    const stopDistance =
      (isNaN(atrValue) ? fallbackStopDistance : atrValue) * atrStopMultiplier;

    if (isNaN(stopDistance) || stopDistance <= 0) {
      continue;
    }

    if (shouldBuy) {
      const signalScore = longScore;
      const reason = "Reverse long " + signalScore.toString() + "/3";
      analysis.longSignals[i] = 1;
      analysis.signals.push(new ReverseSignal(
        i,
        "reverse-logic-buy-" + bar.time.toString(),
        BUY_SIDE,
        bar.close,
        bar.close - stopDistance,
        bar.close + stopDistance * riskReward,
        bar.time,
        signalScore,
        reason,
        buildSignalPayload(
          signalScore,
          nearResistance,
          nearSupport,
          bbLongSignal,
          bbShortSignal,
          maBearishCross,
          maBullishCross,
          volumeOk,
          atrOk,
          resistanceLevel,
          supportLevel,
        ),
      ));
      lastSignalIndex = i;
      continue;
    }

    const signalScore = shortScore;
    const reason = "Reverse short " + signalScore.toString() + "/3";
    analysis.shortSignals[i] = 1;
    analysis.signals.push(new ReverseSignal(
      i,
      "reverse-logic-sell-" + bar.time.toString(),
      SELL_SIDE,
      bar.close,
      bar.close + stopDistance,
      bar.close - stopDistance * riskReward,
      bar.time,
      signalScore,
      reason,
      buildSignalPayload(
        signalScore,
        nearResistance,
        nearSupport,
        bbLongSignal,
        bbShortSignal,
        maBearishCross,
        maBullishCross,
        volumeOk,
        atrOk,
        resistanceLevel,
        supportLevel,
      ),
    ));
    lastSignalIndex = i;
  }

  return analysis;
}

function emitAnalysis(context: IndicatorContext, analysis: AnalysisResult): void {
  const committed = context.barState.isConfirmed;

  if (showBollingerBands) {
    context.fill(
      FILL_BOLLINGER,
      SERIES_BB_UPPER,
      SERIES_BB_LOWER,
      "rgba(59, 130, 246, 0.08)",
      1.0,
    );
  }

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];

    if (showSupportResistance) {
      if (!isNaN(analysis.resistance[i])) {
        context.plot(
          SERIES_RESISTANCE,
          bar.time,
          analysis.resistance[i],
          resistanceColor,
          1.8,
          0.75,
          false,
          committed,
        );
      }

      if (!isNaN(analysis.support[i])) {
        context.plot(
          SERIES_SUPPORT,
          bar.time,
          analysis.support[i],
          supportColor,
          1.8,
          0.75,
          false,
          committed,
        );
      }
    }

    if (showBollingerBands) {
      if (!isNaN(analysis.bbUpper[i])) {
        context.plot(
          SERIES_BB_UPPER,
          bar.time,
          analysis.bbUpper[i],
          "#3B82F6",
          1.0,
          0.45,
          false,
          committed,
        );
      }

      if (!isNaN(analysis.bbLower[i])) {
        context.plot(
          SERIES_BB_LOWER,
          bar.time,
          analysis.bbLower[i],
          "#3B82F6",
          1.0,
          0.45,
          false,
          committed,
        );
      }

      if (!isNaN(analysis.bbBasis[i])) {
        context.plot(
          SERIES_BB_BASIS,
          bar.time,
          analysis.bbBasis[i],
          "#FB923C",
          1.2,
          0.6,
          false,
          committed,
        );
      }
    }

    if (showMovingAverages) {
      if (!isNaN(analysis.fastMa[i])) {
        context.plot(
          SERIES_FAST_MA,
          bar.time,
          analysis.fastMa[i],
          "#FACC15",
          1.7,
          0.95,
          false,
          committed,
        );
      }

      if (!isNaN(analysis.slowMa[i])) {
        context.plot(
          SERIES_SLOW_MA,
          bar.time,
          analysis.slowMa[i],
          "#22D3EE",
          1.7,
          0.9,
          false,
          committed,
        );
      }
    }

    if (analysis.longSignals[i] == 1) {
      context.plotshape(
        SHAPE_BUY,
        bar.time,
        bar.low,
        "arrow-up",
        bullishColor,
        10.0,
        0,
        16.0,
        committed,
        "",
      );
    }

    if (analysis.shortSignals[i] == 1) {
      context.plotshape(
        SHAPE_SELL,
        bar.time,
        bar.high,
        "arrow-down",
        bearishColor,
        10.0,
        0,
        -16.0,
        committed,
        "",
      );
    }
  }

  for (let i = 0; i < analysis.signals.length; i += 1) {
    const signal = analysis.signals[i];
    context.signal(
      signal.id,
      signal.side,
      signal.time,
      signal.price,
      signal.stopLoss,
      signal.takeProfit,
      signal.reason,
      committed,
      signal.payload,
    );
  }
}
