// @ts-nocheck
// Ported verbatim from orion
// src/library/models/chart/indicators/packages/orion-indicator-stdlib/index.ts
// The only change is the package identity: this file is consumed as
// "@fxtoolkit/indicator-stdlib" (see package.json `ascMain`).
@external("orion", "beginBar")
declare function hostBeginBar(): void;

export function beginBatchBar(): void {
  hostBeginBar();
}

@external("orion", "plot")
declare function hostPlot(
  seriesIdPtr: usize,
  time: f64,
  value: f64,
  colorPtr: usize,
  width: f64,
  opacity: f64,
  dashed: i32,
  committed: i32,
): void;

@external("orion", "fill")
declare function hostFill(
  objectIdPtr: usize,
  upperSeriesIdPtr: usize,
  lowerSeriesIdPtr: usize,
  colorPtr: usize,
  opacity: f64,
): void;

@external("orion", "plotshape")
declare function hostPlotShape(
  seriesIdPtr: usize,
  time: f64,
  value: f64,
  shapePtr: usize,
  colorPtr: usize,
  size: f64,
  offsetX: f64,
  offsetY: f64,
  committed: i32,
  textPtr: usize,
): void;

@external("orion", "bgcolor")
declare function hostBgcolor(
  seriesIdPtr: usize,
  time: f64,
  colorPtr: usize,
  committed: i32,
): void;

@external("orion", "line")
declare function hostLine(
  objectIdPtr: usize,
  time: f64,
  endTime: f64,
  price: f64,
  endPrice: f64,
  colorPtr: usize,
  width: f64,
  opacity: f64,
  dashed: i32,
  committed: i32,
): void;

@external("orion", "linefill")
declare function hostLinefill(
  objectIdPtr: usize,
  pointsPtr: usize,
  colorPtr: usize,
  opacity: f64,
  committed: i32,
): void;

@external("orion", "ray")
declare function hostRay(
  objectIdPtr: usize,
  time: f64,
  price: f64,
  colorPtr: usize,
  width: f64,
  opacity: f64,
  dashed: i32,
  committed: i32,
): void;

@external("orion", "box")
declare function hostBox(
  objectIdPtr: usize,
  time: f64,
  endTime: f64,
  price: f64,
  endPrice: f64,
  colorPtr: usize,
  backgroundColorPtr: usize,
  width: f64,
  opacity: f64,
  dashed: i32,
  committed: i32,
): void;

@external("orion", "polyline")
declare function hostPolyline(
  objectIdPtr: usize,
  pointsPtr: usize,
  colorPtr: usize,
  width: f64,
  opacity: f64,
  dashed: i32,
  committed: i32,
): void;

@external("orion", "label")
declare function hostLabel(
  objectIdPtr: usize,
  time: f64,
  price: f64,
  textPtr: usize,
  colorPtr: usize,
  backgroundColorPtr: usize,
  fontSize: f64,
  offsetX: f64,
  offsetY: f64,
  committed: i32,
): void;

@external("orion", "panel")
declare function hostPanel(
  objectIdPtr: usize,
  anchorPtr: usize,
  titlePtr: usize,
  textPtr: usize,
  colorPtr: usize,
  backgroundColorPtr: usize,
  accentColorPtr: usize,
  fontSize: f64,
  committed: i32,
): void;

@external("orion", "table")
declare function hostTable(
  objectIdPtr: usize,
  anchorPtr: usize,
  titlePtr: usize,
  textPtr: usize,
  colorPtr: usize,
  backgroundColorPtr: usize,
  columns: f64,
  rows: f64,
  committed: i32,
): void;

@external("orion", "candle")
declare function hostCandle(
  objectIdPtr: usize,
  time: f64,
  open: f64,
  high: f64,
  low: f64,
  close: f64,
  colorPtr: usize,
  wickColorPtr: usize,
  borderColorPtr: usize,
  committed: i32,
  modePtr: usize,
): void;

@external("orion", "signal")
declare function hostSignal(
  signalIdPtr: usize,
  sidePtr: usize,
  time: f64,
  price: f64,
  stopLoss: f64,
  takeProfit: f64,
  messagePtr: usize,
  committed: i32,
  payloadPtr: usize,
): void;

@external("orion", "alert")
declare function hostAlert(
  alertIdPtr: usize,
  titlePtr: usize,
  messagePtr: usize,
  time: f64,
  price: f64,
  committed: i32,
  payloadPtr: usize,
): void;

@external("orion", "inputBool")
declare function hostInputBool(keyPtr: usize, defaultValue: i32): i32;

@external("orion", "inputInt")
declare function hostInputInt(keyPtr: usize, defaultValue: i32): i32;

@external("orion", "inputNumber")
declare function hostInputNumber(keyPtr: usize, defaultValue: f64): f64;

@external("orion", "inputString")
declare function hostInputString(keyPtr: usize, defaultPtr: usize): usize;

@external("orion", "runtimePipSize")
declare function hostRuntimePipSize(): f64;

@external("orion", "runtimeSymbol")
declare function hostRuntimeSymbol(): usize;

@external("orion", "runtimeTimeframeMs")
declare function hostRuntimeTimeframeMs(): f64;

export class Bar {
  constructor(
    public time: f64,
    public open: f64,
    public high: f64,
    public low: f64,
    public close: f64,
    public volume: f64 = 0,
    public spread: f64 = 0,
  ) {}
}

export class BarState {
  constructor(
    public index: i32,
    public isRealtime: bool,
    public isConfirmed: bool,
    public isLastBar: bool,
    public isFirst: bool = false,
    public isHistory: bool = false,
    public isNew: bool = false,
  ) {}
}

export class RuntimeInfo {
  constructor(
    public symbol: string,
    public timeframeMs: f64,
    public pipSize: f64,
  ) {}
}

export class IndicatorContext {
  constructor(
    public readonly barState: BarState,
    public readonly runtime: RuntimeInfo,
  ) {}

  plot(
    seriesId: string,
    time: f64,
    value: f64,
    color: string,
    width: f64 = 1.0,
    opacity: f64 = 1.0,
    dashed: bool = false,
    committed: bool = true,
  ): void {
    hostPlot(
      changetype<usize>(seriesId),
      time,
      value,
      changetype<usize>(color),
      width,
      opacity,
      dashed ? 1 : 0,
      committed ? 1 : 0,
    );
  }

  fill(
    fillId: string,
    upperSeriesId: string,
    lowerSeriesId: string,
    color: string = "",
    opacity: f64 = 0.2,
  ): void {
    hostFill(
      changetype<usize>(fillId),
      changetype<usize>(upperSeriesId),
      changetype<usize>(lowerSeriesId),
      changetype<usize>(color),
      opacity,
    );
  }

  plotshape(
    seriesId: string,
    time: f64,
    value: f64,
    shape: string,
    color: string,
    size: f64 = 14.0,
    offsetX: f64 = 0,
    offsetY: f64 = 0,
    committed: bool = true,
    text: string = "",
  ): void {
    hostPlotShape(
      changetype<usize>(seriesId),
      time,
      value,
      changetype<usize>(shape),
      changetype<usize>(color),
      size,
      offsetX,
      offsetY,
      committed ? 1 : 0,
      changetype<usize>(text),
    );
  }

  bgcolor(
    seriesId: string,
    time: f64,
    color: string,
    committed: bool = true,
  ): void {
    hostBgcolor(
      changetype<usize>(seriesId),
      time,
      changetype<usize>(color),
      committed ? 1 : 0,
    );
  }

  line(
    objectId: string,
    time: f64,
    endTime: f64,
    price: f64,
    endPrice: f64,
    color: string,
    width: f64 = 1.0,
    opacity: f64 = 1.0,
    dashed: bool = false,
    committed: bool = true,
  ): void {
    hostLine(
      changetype<usize>(objectId),
      time,
      endTime,
      price,
      endPrice,
      changetype<usize>(color),
      width,
      opacity,
      dashed ? 1 : 0,
      committed ? 1 : 0,
    );
  }

  linefill(
    objectId: string,
    pointsJson: string,
    color: string,
    opacity: f64 = 0.18,
    committed: bool = true,
  ): void {
    hostLinefill(
      changetype<usize>(objectId),
      changetype<usize>(pointsJson),
      changetype<usize>(color),
      opacity,
      committed ? 1 : 0,
    );
  }

  ray(
    objectId: string,
    time: f64,
    price: f64,
    color: string,
    width: f64 = 1.0,
    opacity: f64 = 1.0,
    dashed: bool = false,
    committed: bool = true,
  ): void {
    hostRay(
      changetype<usize>(objectId),
      time,
      price,
      changetype<usize>(color),
      width,
      opacity,
      dashed ? 1 : 0,
      committed ? 1 : 0,
    );
  }

  box(
    objectId: string,
    time: f64,
    endTime: f64,
    price: f64,
    endPrice: f64,
    color: string,
    backgroundColor: string = "",
    width: f64 = 1.0,
    opacity: f64 = 0.18,
    dashed: bool = false,
    committed: bool = true,
  ): void {
    hostBox(
      changetype<usize>(objectId),
      time,
      endTime,
      price,
      endPrice,
      changetype<usize>(color),
      changetype<usize>(backgroundColor),
      width,
      opacity,
      dashed ? 1 : 0,
      committed ? 1 : 0,
    );
  }

  polyline(
    objectId: string,
    pointsJson: string,
    color: string,
    width: f64 = 1.0,
    opacity: f64 = 1.0,
    dashed: bool = false,
    committed: bool = true,
  ): void {
    hostPolyline(
      changetype<usize>(objectId),
      changetype<usize>(pointsJson),
      changetype<usize>(color),
      width,
      opacity,
      dashed ? 1 : 0,
      committed ? 1 : 0,
    );
  }

  label(
    objectId: string,
    time: f64,
    price: f64,
    text: string,
    color: string,
    backgroundColor: string,
    fontSize: f64 = 10.0,
    offsetX: f64 = 0,
    offsetY: f64 = 0,
    committed: bool = true,
  ): void {
    hostLabel(
      changetype<usize>(objectId),
      time,
      price,
      changetype<usize>(text),
      changetype<usize>(color),
      changetype<usize>(backgroundColor),
      fontSize,
      offsetX,
      offsetY,
      committed ? 1 : 0,
    );
  }

  table(
    objectId: string,
    anchor: string,
    title: string,
    text: string,
    color: string,
    backgroundColor: string,
    columns: f64 = 1.0,
    rows: f64 = 1.0,
    committed: bool = true,
  ): void {
    hostTable(
      changetype<usize>(objectId),
      changetype<usize>(anchor),
      changetype<usize>(title),
      changetype<usize>(text),
      changetype<usize>(color),
      changetype<usize>(backgroundColor),
      columns,
      rows,
      committed ? 1 : 0,
    );
  }

  candle(
    objectId: string,
    time: f64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    color: string,
    wickColor: string,
    borderColor: string,
    committed: bool = true,
    mode: string = "candle",
  ): void {
    hostCandle(
      changetype<usize>(objectId),
      time,
      open,
      high,
      low,
      close,
      changetype<usize>(color),
      changetype<usize>(wickColor),
      changetype<usize>(borderColor),
      committed ? 1 : 0,
      changetype<usize>(mode),
    );
  }

  panel(
    objectId: string,
    anchor: string,
    title: string,
    text: string,
    color: string,
    backgroundColor: string,
    accentColor: string = "",
    fontSize: f64 = 10.0,
    committed: bool = true,
  ): void {
    hostPanel(
      changetype<usize>(objectId),
      changetype<usize>(anchor),
      changetype<usize>(title),
      changetype<usize>(text),
      changetype<usize>(color),
      changetype<usize>(backgroundColor),
      changetype<usize>(accentColor),
      fontSize,
      committed ? 1 : 0,
    );
  }

  signal(
    signalId: string,
    side: string,
    time: f64,
    price: f64,
    stopLoss: f64,
    takeProfit: f64,
    message: string,
    committed: bool = true,
    payload: string = "",
  ): void {
    hostSignal(
      changetype<usize>(signalId),
      changetype<usize>(side),
      time,
      price,
      stopLoss,
      takeProfit,
      changetype<usize>(message),
      committed ? 1 : 0,
      changetype<usize>(payload),
    );
  }

  alert(
    alertId: string,
    title: string,
    message: string,
    time: f64,
    price: f64,
    committed: bool = true,
    payload: string = "",
  ): void {
    hostAlert(
      changetype<usize>(alertId),
      changetype<usize>(title),
      changetype<usize>(message),
      time,
      price,
      committed ? 1 : 0,
      changetype<usize>(payload),
    );
  }
}

export class InputChoice {
  constructor(public label: string, public value: string) {}
}

export class InputField {
  constructor(
    public key: string,
    public label: string,
    public type: string,
    public defaultValue: string,
    public description: string = "",
    public min: f64 = NaN,
    public max: f64 = NaN,
    public step: f64 = NaN,
    public choices: Array<InputChoice> = new Array<InputChoice>(),
  ) {}
}

export class IndicatorDescriptor {
  constructor(
    public module: string,
    public title: string,
    public version: string,
    public description: string = "",
    public inputs: Array<InputField> = new Array<InputField>(),
    public outputKinds: Array<string> = new Array<string>(),
  ) {}
}

export function buildBar(
  time: f64,
  open: f64,
  high: f64,
  low: f64,
  close: f64,
  volume: f64 = 0,
  spread: f64 = 0,
): Bar {
  return new Bar(time, open, high, low, close, volume, spread);
}

export function createIndicatorContext(
  index: i32,
  isRealtime: bool,
  isConfirmed: bool,
  isLastBar: bool,
  isFirst: bool = false,
  isHistory: bool = false,
  isNew: bool = false,
): IndicatorContext {
  return new IndicatorContext(
    new BarState(index, isRealtime, isConfirmed, isLastBar, isFirst, isHistory, isNew),
    new RuntimeInfo(
      changetype<string>(hostRuntimeSymbol()),
      hostRuntimeTimeframeMs(),
      hostRuntimePipSize(),
    ),
  );
}

export function describeIndicator(descriptor: IndicatorDescriptor): string {
  return (
    "{"
    + "\"module\":\"" + escapeJsonString(descriptor.module) + "\","
    + "\"title\":\"" + escapeJsonString(descriptor.title) + "\","
    + "\"version\":\"" + escapeJsonString(descriptor.version) + "\","
    + "\"description\":\"" + escapeJsonString(descriptor.description) + "\","
    + "\"inputs\":" + serializeInputs(descriptor.inputs) + ","
    + "\"outputKinds\":" + serializeStringArray(descriptor.outputKinds)
    + "}"
  );
}

export function inputBool(key: string, defaultValue: bool = false): bool {
  return hostInputBool(changetype<usize>(key), defaultValue ? 1 : 0) != 0;
}

export function inputInt(key: string, defaultValue: i32 = 0): i32 {
  return hostInputInt(changetype<usize>(key), defaultValue);
}

export function inputNumber(key: string, defaultValue: f64 = 0): f64 {
  return hostInputNumber(changetype<usize>(key), defaultValue);
}

export function inputString(key: string, defaultValue: string = ""): string {
  return changetype<string>(
    hostInputString(changetype<usize>(key), changetype<usize>(defaultValue)),
  );
}

export function bucketStartMs(time: f64, intervalMs: f64): f64 {
  if (intervalMs <= 0) {
    return time;
  }

  return floor<f64>(time / intervalMs) * intervalMs;
}

export function epsilonForPrice(price: f64): f64 {
  const magnitude = abs<f64>(price) * 1e-8;
  return max<f64>(magnitude, 1e-8);
}

export function isSwingHigh(
  bars: Array<Bar>,
  index: i32,
  strength: i32,
): bool {
  if (index < strength || index >= bars.length - strength) {
    return false;
  }

  const high = bars[index].high;

  for (let i = 1; i <= strength; i += 1) {
    if (bars[index - i].high >= high || bars[index + i].high >= high) {
      return false;
    }
  }

  return true;
}

export function isSwingLow(
  bars: Array<Bar>,
  index: i32,
  strength: i32,
): bool {
  if (index < strength || index >= bars.length - strength) {
    return false;
  }

  const low = bars[index].low;

  for (let i = 1; i <= strength; i += 1) {
    if (bars[index - i].low <= low || bars[index + i].low <= low) {
      return false;
    }
  }

  return true;
}

export function makeObjectId(prefix: string, time: f64): string {
  return prefix + "-" + time.toString();
}

export function na(): f64 {
  return NaN;
}

export function nz(value: f64, fallback: f64 = 0): f64 {
  return isNaN(value) ? fallback : value;
}

export function sourceValue(bar: Bar, source: string): f64 {
  if (source == "open") {
    return bar.open;
  }

  if (source == "high") {
    return bar.high;
  }

  if (source == "low") {
    return bar.low;
  }

  if (source == "volume") {
    return bar.volume;
  }

  if (source == "hl2") {
    return (bar.high + bar.low) / 2.0;
  }

  if (source == "hlc3") {
    return (bar.high + bar.low + bar.close) / 3.0;
  }

  if (source == "ohlc4") {
    return (bar.open + bar.high + bar.low + bar.close) / 4.0;
  }

  return bar.close;
}

export function pineSma(
  bars: Array<Bar>,
  source: string,
  length: i32,
): f64 {
  if (length <= 0 || bars.length == 0) {
    return NaN;
  }

  const start = max<i32>(0, bars.length - length);
  let total = 0.0;
  let count = 0;

  for (let i = start; i < bars.length; i += 1) {
    total += sourceValue(bars[i], source);
    count += 1;
  }

  if (count == 0) {
    return NaN;
  }

  return total / count;
}

export function pineAtr(
  bars: Array<Bar>,
  length: i32,
): f64 {
  if (length <= 0 || bars.length == 0) {
    return NaN;
  }

  const start = max<i32>(1, bars.length - length);
  let total = 0.0;
  let count = 0;

  for (let i = start; i < bars.length; i += 1) {
    const current = bars[i];
    const previousClose = bars[i - 1].close;
    const trueRange = Math.max(
      current.high - current.low,
      Math.max(
        Math.abs(current.high - previousClose),
        Math.abs(current.low - previousClose),
      ),
    );
    total += trueRange;
    count += 1;
  }

  if (count == 0) {
    return bars[bars.length - 1].high - bars[bars.length - 1].low;
  }

  return total / f64(count);
}

export function pineEma(
  bars: Array<Bar>,
  source: string,
  length: i32,
): f64 {
  if (length <= 0 || bars.length == 0) {
    return NaN;
  }

  const alpha = 2.0 / (f64(length) + 1.0);
  let ema = sourceValue(bars[0], source);

  for (let i = 1; i < bars.length; i += 1) {
    const value = sourceValue(bars[i], source);
    ema = alpha * value + (1.0 - alpha) * ema;
  }

  return ema;
}

export function timeframeToMs(timeframe: string): f64 {
  if (timeframe.length == 0) {
    return 0;
  }

  if (timeframe == "D") {
    return 24.0 * 60.0 * 60.0 * 1000.0;
  }

  if (timeframe == "W") {
    return 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;
  }

  if (timeframe == "M") {
    return 30.0 * 24.0 * 60.0 * 60.0 * 1000.0;
  }

  if (looksNumeric(timeframe)) {
    return parseFloat(timeframe) * 60.0 * 1000.0;
  }

  return 0;
}

function aggregateBarsToTimeframe(
  bars: Array<Bar>,
  timeframe: string,
): Array<Bar> {
  const intervalMs = timeframeToMs(timeframe);
  const aggregated = new Array<Bar>();

  if (intervalMs <= 0 || bars.length == 0) {
    return aggregated;
  }

  let current: Bar | null = null;

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const bucketStart = bucketStartMs(bar.time, intervalMs);

    if (current == null || current.time != bucketStart) {
      if (current != null) {
        aggregated.push(current);
      }

      current = new Bar(
        bucketStart,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.spread,
      );
      continue;
    }

    current.high = max<f64>(current.high, bar.high);
    current.low = min<f64>(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
    current.spread = bar.spread;
  }

  if (current != null) {
    aggregated.push(current);
  }

  return aggregated;
}

export function requestSecuritySource(
  bars: Array<Bar>,
  timeframe: string,
  source: string,
): f64 {
  const aggregated = aggregateBarsToTimeframe(bars, timeframe);

  if (aggregated.length == 0) {
    return NaN;
  }

  return sourceValue(aggregated[aggregated.length - 1], source);
}

export function requestSecuritySma(
  bars: Array<Bar>,
  timeframe: string,
  source: string,
  length: i32,
): f64 {
  return pineSma(aggregateBarsToTimeframe(bars, timeframe), source, length);
}

export function requestSecurityEma(
  bars: Array<Bar>,
  timeframe: string,
  source: string,
  length: i32,
): f64 {
  return pineEma(aggregateBarsToTimeframe(bars, timeframe), source, length);
}

export function serializePolylinePoints(
  times: Array<f64>,
  prices: Array<f64>,
): string {
  const points = new Array<string>();
  const count = min<i32>(times.length, prices.length);

  for (let i = 0; i < count; i += 1) {
    points.push(
      "{"
      + "\"time\":" + times[i].toString() + ","
      + "\"price\":" + prices[i].toString()
      + "}",
    );
  }

  return "[" + points.join(",") + "]";
}

export function serializeBarsSnapshot(bars: Array<Bar>): string {
  const lines = new Array<string>();

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];

    lines.push(
      bar.time.toString()
      + "\t" + bar.open.toString()
      + "\t" + bar.high.toString()
      + "\t" + bar.low.toString()
      + "\t" + bar.close.toString()
      + "\t" + bar.volume.toString()
      + "\t" + bar.spread.toString(),
    );
  }

  return lines.join("\n");
}

export function deserializeBarsSnapshot(snapshot: string): Array<Bar> {
  const bars = new Array<Bar>();

  if (snapshot.length == 0) {
    return bars;
  }

  const lines = snapshot.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.length == 0) {
      continue;
    }

    const parts = line.split("\t");

    if (parts.length < 7) {
      continue;
    }

    bars.push(
      new Bar(
        parseFloat(parts[0]),
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
        parseFloat(parts[4]),
        parseFloat(parts[5]),
        parseFloat(parts[6]),
      ),
    );
  }

  return bars;
}

function escapeJsonString(value: string): string {
  let escaped = "";

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code == 34) {
      escaped += "\\\"";
    } else if (code == 92) {
      escaped += "\\\\";
    } else if (code == 10) {
      escaped += "\\n";
    } else if (code == 13) {
      escaped += "\\r";
    } else if (code == 9) {
      escaped += "\\t";
    } else {
      escaped += value.substring(i, i + 1);
    }
  }

  return escaped;
}

function serializeChoice(choice: InputChoice): string {
  return (
    "{"
    + "\"label\":\"" + escapeJsonString(choice.label) + "\","
    + "\"value\":\"" + escapeJsonString(choice.value) + "\""
    + "}"
  );
}

function serializeInputs(inputs: Array<InputField>): string {
  const serialized = new Array<string>();

  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    let next = "{";

    next += "\"key\":\"" + escapeJsonString(input.key) + "\",";
    next += "\"label\":\"" + escapeJsonString(input.label) + "\",";
    next += "\"type\":\"" + escapeJsonString(input.type) + "\",";
    next += "\"defaultValue\":" + serializeScalar(input.defaultValue);

    if (input.description.length) {
      next += ",\"description\":\"" + escapeJsonString(input.description) + "\"";
    }

    if (!isNaN(input.min)) {
      next += ",\"min\":" + input.min.toString();
    }

    if (!isNaN(input.max)) {
      next += ",\"max\":" + input.max.toString();
    }

    if (!isNaN(input.step)) {
      next += ",\"step\":" + input.step.toString();
    }

    if (input.choices.length) {
      const serializedChoices = new Array<string>();

      for (let j = 0; j < input.choices.length; j += 1) {
        serializedChoices.push(serializeChoice(input.choices[j]));
      }

      next += ",\"choices\":[" + serializedChoices.join(",") + "]";
    }

    next += "}";
    serialized.push(next);
  }

  return "[" + serialized.join(",") + "]";
}

function serializeScalar(value: string): string {
  if (value == "true" || value == "false") {
    return value;
  }

  if (looksNumeric(value)) {
    return value;
  }

  return "\"" + escapeJsonString(value) + "\"";
}

function serializeStringArray(values: Array<string>): string {
  const serialized = new Array<string>();

  for (let i = 0; i < values.length; i += 1) {
    serialized.push("\"" + escapeJsonString(values[i]) + "\"");
  }

  return "[" + serialized.join(",") + "]";
}

function looksNumeric(value: string): bool {
  if (value.length == 0) {
    return false;
  }

  let hasDigit = false;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code >= 48 && code <= 57) {
      hasDigit = true;
      continue;
    }

    if (code == 45 || code == 46) {
      continue;
    }

    return false;
  }

  return hasDigit;
}
