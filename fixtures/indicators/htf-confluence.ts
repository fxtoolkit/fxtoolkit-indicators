// Ported verbatim from orion
// src/library/models/chart/indicators/assemblyscript/htf-confluence.ts
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
  bucketStartMs,
  buildBar,
  beginBatchBar,
  createIndicatorContext,
  describeIndicator,
  deserializeBarsSnapshot,
  epsilonForPrice,
  inputBool,
  inputInt,
  inputNumber,
  inputString,
  isSwingHigh,
  isSwingLow,
  serializeBarsSnapshot,
} from "@fxtoolkit/indicator-stdlib";

const BUY_SIDE = "BUY";
const SELL_SIDE = "SELL";
const LTF_CONFLUENCE_OPTIONS = new Array<InputChoice>();

LTF_CONFLUENCE_OPTIONS.push(new InputChoice("Break of Structure", "BOS"));
LTF_CONFLUENCE_OPTIONS.push(new InputChoice("Quasimodo", "QMR"));
LTF_CONFLUENCE_OPTIONS.push(new InputChoice("Inverse FVG", "iFVG"));
LTF_CONFLUENCE_OPTIONS.push(new InputChoice("Any (BOS/QMR/iFVG)", "ANY"));

class HtfBar extends Bar {
  constructor(
    time: f64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
    spread: f64,
    public endTime: f64,
  ) {
    super(time, open, high, low, close, volume, spread);
  }
}

class HtfLevel {
  constructor(
    public id: string,
    public type: string,
    public price: f64,
    public time: f64,
    public activeFromTime: f64,
    public bodyBroken: bool = false,
  ) {}
}

class ConfluenceSignal {
  constructor(
    public id: string,
    public side: string,
    public price: f64,
    public stopLoss: f64,
    public target: f64,
    public time: f64,
    public reason: string,
  ) {}
}

class SwingPoint {
  constructor(
    public index: i32,
    public price: f64,
    public time: f64,
    public type: string,
  ) {}
}

class ArmedState {
  constructor(
    public direction: string,
    public levelId: string,
    public sweepBarIndex: i32,
    public extremePrice: f64,
  ) {}
}

const descriptor = new IndicatorDescriptor(
  "htf-confluence",
  "HTF Confluence Signal",
  "1.0.0",
  "Triggers on wick sweeps of HTF Peaks/Valleys confirmed by LTF actions (BOS/QMR/iFVG).",
  [
    new InputField("higherTimeframeMinutes", "Higher TF (Minutes)", "integer", "60", "", 5, 1440, 5),
    new InputField("htfSwingStrength", "HTF Swing Strength", "integer", "5", "", 1, 20, 1),
    new InputField("maxLevels", "Max Levels", "integer", "60", "", 1, 200, 1),
    new InputField("confluenceType", "LTF Confluence Type", "select", "ANY", "", NaN, NaN, NaN, LTF_CONFLUENCE_OPTIONS),
    new InputField("ltfSwingStrength", "LTF Swing Strength", "integer", "5", "", 2, 10, 1),
    new InputField("expirationBars", "Max LTF Bars to Wait", "integer", "20", "", 5, 100, 1),
    new InputField("riskReward", "Risk/Reward Ratio", "number", "2", "", 0.5, 10, 0.5),
    new InputField("showHtfLevels", "Show HTF Levels", "boolean", "true"),
    new InputField("bullishColor", "Bullish Signal Color", "color", "#00E676"),
    new InputField("bearishColor", "Bearish Signal Color", "color", "#FF5252"),
    new InputField("lineWidth", "Level Line Width", "number", "1", "", 1, 4, 1),
    new InputField("arrowSize", "Arrow Size", "number", "14", "", 8, 32, 1),
  ],
  ["ray", "plotshape", "label", "signal"],
);

let higherTimeframeMinutes: i32 = 60;
let htfSwingStrength: i32 = 5;
let maxLevels: i32 = 60;
let confluenceType = "ANY";
let ltfSwingStrength: i32 = 5;
let expirationBars: i32 = 20;
let riskReward: f64 = 2.0;
let showHtfLevels: bool = true;
let bullishColor = "#00E676";
let bearishColor = "#FF5252";
let lineWidth: f64 = 1.0;
let arrowSize: f64 = 14.0;

let bars = new Array<Bar>();
let levels = new Array<HtfLevel>();
let signals = new Array<ConfluenceSignal>();

export function describe(): string {
  return describeIndicator(descriptor);
}

export function init(): void {
  higherTimeframeMinutes = inputInt("higherTimeframeMinutes", 60);
  htfSwingStrength = inputInt("htfSwingStrength", 5);
  maxLevels = inputInt("maxLevels", 60);
  confluenceType = inputString("confluenceType", "ANY");
  ltfSwingStrength = inputInt("ltfSwingStrength", 5);
  expirationBars = inputInt("expirationBars", 20);
  riskReward = inputNumber("riskReward", 2.0);
  showHtfLevels = inputBool("showHtfLevels", true);
  bullishColor = inputString("bullishColor", "#00E676");
  bearishColor = inputString("bearishColor", "#FF5252");
  lineWidth = inputNumber("lineWidth", 1.0);
  arrowSize = inputNumber("arrowSize", 14.0);
}

export function reset(): void {
  bars = new Array<Bar>();
  levels = new Array<HtfLevel>();
  signals = new Array<ConfluenceSignal>();
}

export function destroy(): void {
  reset();
}

export function saveState(): string {
  return serializeBarsSnapshot(bars);
}

export function loadState(state: string): void {
  bars = deserializeBarsSnapshot(state);
  levels = new Array<HtfLevel>();
  signals = new Array<ConfluenceSignal>();
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

  calculateState();
  emitState(context, bar.time);
}

function buildHtfBars(sourceBars: Array<Bar>, timeframeMinutes: i32): Array<HtfBar> {
  const aggregated = new Array<HtfBar>();

  if (sourceBars.length == 0) {
    return aggregated;
  }

  const intervalMs = f64(timeframeMinutes) * 60.0 * 1000.0;
  let current: HtfBar | null = null;

  for (let i = 0; i < sourceBars.length; i += 1) {
    const bar = sourceBars[i];
    const bucketStart = bucketStartMs(bar.time, intervalMs);

    if (current == null || current.time != bucketStart) {
      if (current != null) {
        aggregated.push(current);
      }

      current = new HtfBar(
        bucketStart,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.spread,
        bucketStart + intervalMs,
      );
      continue;
    }

    current.high = max<f64>(current.high, bar.high);
    current.low = min<f64>(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  }

  if (current != null) {
    aggregated.push(current);
  }

  return aggregated;
}

function calculateHtfLevels(sourceBars: Array<Bar>): Array<HtfLevel> {
  const htfBars = buildHtfBars(sourceBars, higherTimeframeMinutes);
  const calculatedLevels = new Array<HtfLevel>();

  if (htfBars.length < htfSwingStrength * 2 + 1) {
    return calculatedLevels;
  }

  for (
    let i = htfSwingStrength;
    i < htfBars.length - htfSwingStrength;
    i += 1
  ) {
    const bar = htfBars[i];
    const activeFromTime =
      htfBars[i + htfSwingStrength] != null
        ? htfBars[i + htfSwingStrength].endTime
        : bar.endTime;

    if (isSwingHigh(changetype<Array<Bar>>(htfBars), i, htfSwingStrength)) {
      calculatedLevels.push(
        new HtfLevel("peak-" + bar.time.toString(), "peak", bar.high, bar.time, activeFromTime),
      );
    }

    if (isSwingLow(changetype<Array<Bar>>(htfBars), i, htfSwingStrength)) {
      calculatedLevels.push(
        new HtfLevel("valley-" + bar.time.toString(), "valley", bar.low, bar.time, activeFromTime),
      );
    }
  }

  calculatedLevels.sort((left: HtfLevel, right: HtfLevel): i32 => {
    if (left.time > right.time) return -1;
    if (left.time < right.time) return 1;
    return 0;
  });

  if (calculatedLevels.length > maxLevels) {
    calculatedLevels.splice(maxLevels);
  }

  calculatedLevels.sort((left: HtfLevel, right: HtfLevel): i32 => {
    if (left.time < right.time) return -1;
    if (left.time > right.time) return 1;
    return 0;
  });

  for (let i = 0; i < calculatedLevels.length; i += 1) {
    const level = calculatedLevels[i];
    let bodyBroken = false;

    for (let j = 0; j < sourceBars.length; j += 1) {
      const bar = sourceBars[j];

      if (bar.time < level.activeFromTime) {
        continue;
      }

      const epsilon = epsilonForPrice(level.price);

      if (level.type == "peak") {
        const bodyTop = max<f64>(bar.open, bar.close);
        if (bodyTop > level.price + epsilon) {
          bodyBroken = true;
        }
      } else {
        const bodyBottom = min<f64>(bar.open, bar.close);
        if (bodyBottom < level.price - epsilon) {
          bodyBroken = true;
        }
      }

      if (bodyBroken) {
        break;
      }
    }

    level.bodyBroken = bodyBroken;
  }

  return calculatedLevels;
}

function getLtfSwings(sourceBars: Array<Bar>, strength: i32): Array<SwingPoint> {
  const swings = new Array<SwingPoint>();

  if (sourceBars.length < strength * 2 + 1) {
    return swings;
  }

  for (let i = strength; i < sourceBars.length - strength; i += 1) {
    const bar = sourceBars[i];

    if (isSwingHigh(sourceBars, i, strength)) {
      swings.push(new SwingPoint(i, bar.high, bar.time, "H"));
    }

    if (isSwingLow(sourceBars, i, strength)) {
      swings.push(new SwingPoint(i, bar.low, bar.time, "L"));
    }
  }

  if (swings.length == 0) {
    return swings;
  }

  const cleanSwings = new Array<SwingPoint>();

  cleanSwings.push(swings[0]);

  for (let i = 1; i < swings.length; i += 1) {
    const previous = cleanSwings[cleanSwings.length - 1];
    const current = swings[i];

    if (previous.type != current.type) {
      cleanSwings.push(current);
      continue;
    }

    if (previous.type == "H" && current.price > previous.price) {
      cleanSwings[cleanSwings.length - 1] = current;
    } else if (previous.type == "L" && current.price < previous.price) {
      cleanSwings[cleanSwings.length - 1] = current;
    }
  }

  return cleanSwings;
}

function checkQmr(swings: Array<SwingPoint>, direction: string): bool {
  if (swings.length < 4) {
    return false;
  }

  const p1 = swings[swings.length - 4];
  const p2 = swings[swings.length - 3];
  const p3 = swings[swings.length - 2];
  const p4 = swings[swings.length - 1];

  if (direction == "SHORT") {
    if (p1.type == "H" && p2.type == "L" && p3.type == "H" && p4.type == "L") {
      return p3.price > p1.price && p4.price < p2.price;
    }
  } else if (p1.type == "L" && p2.type == "H" && p3.type == "L" && p4.type == "H") {
    return p3.price < p1.price && p4.price > p2.price;
  }

  return false;
}

function checkiFvg(sourceBars: Array<Bar>, currentIndex: i32, direction: string): bool {
  const maxLookback = 10;
  const startIndex = max<i32>(2, currentIndex - maxLookback);

  for (let i = currentIndex; i >= startIndex; i -= 1) {
    const currentBar = sourceBars[i];

    for (let f = i - 1; f >= startIndex; f -= 1) {
      const candle1 = sourceBars[f - 2];
      const candle3 = sourceBars[f];

      if (direction == "LONG") {
        const fvgTop = candle1.low;
        const fvgBottom = candle3.high;

        if (fvgTop > fvgBottom && currentBar.close > fvgTop) {
          return true;
        }
      } else {
        const fvgTop = candle3.low;
        const fvgBottom = candle1.high;

        if (fvgTop > fvgBottom && currentBar.close < fvgBottom) {
          return true;
        }
      }
    }
  }

  return false;
}

function calculateState(): void {
  levels = new Array<HtfLevel>();
  signals = new Array<ConfluenceSignal>();

  if (bars.length < 50) {
    return;
  }

  levels = calculateHtfLevels(bars);
  const ltfSwings = getLtfSwings(bars, ltfSwingStrength);
  let phase = "IDLE";
  let armedState: ArmedState | null = null;

  for (let i = 50; i < bars.length; i += 1) {
    const bar = bars[i];
    let swept = false;

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex];

      if (level.bodyBroken || bar.time < level.activeFromTime) {
        continue;
      }

      const epsilon = epsilonForPrice(level.price);

      if (level.type == "peak") {
        const bodyTop = max<f64>(bar.open, bar.close);

        if (bar.high > level.price + epsilon && bodyTop <= level.price) {
          phase = "ARMED";
          armedState = new ArmedState("SHORT", level.id, i, bar.high);
          swept = true;
          break;
        }
      } else {
        const bodyBottom = min<f64>(bar.open, bar.close);

        if (bar.low < level.price - epsilon && bodyBottom >= level.price) {
          phase = "ARMED";
          armedState = new ArmedState("LONG", level.id, i, bar.low);
          swept = true;
          break;
        }
      }
    }

    if (swept) {
      continue;
    }

    if (phase != "ARMED" || armedState == null) {
      continue;
    }

    const barsSinceSweep = i - armedState.sweepBarIndex;

    if (barsSinceSweep > expirationBars) {
      phase = "IDLE";
      armedState = null;
      continue;
    }

    if (armedState.direction == "SHORT" && bar.high > armedState.extremePrice) {
      armedState.extremePrice = bar.high;
    }

    if (armedState.direction == "LONG" && bar.low < armedState.extremePrice) {
      armedState.extremePrice = bar.low;
    }

    let confirmed = false;
    let reason = "";
    const currentSwings = new Array<SwingPoint>();

    for (let swingIndex = 0; swingIndex < ltfSwings.length; swingIndex += 1) {
      const swing = ltfSwings[swingIndex];

      if (swing.index <= i) {
        currentSwings.push(swing);
      }
    }

    if (confluenceType == "BOS" || confluenceType == "ANY") {
      const lastSwing = currentSwings.length > 0
        ? currentSwings[currentSwings.length - 1]
        : null;

      if (lastSwing != null && lastSwing.index > armedState.sweepBarIndex) {
        if (
          armedState.direction == "LONG"
          && lastSwing.type == "H"
          && bar.close > lastSwing.price
        ) {
          confirmed = true;
          reason = "BOS";
        }

        if (
          armedState.direction == "SHORT"
          && lastSwing.type == "L"
          && bar.close < lastSwing.price
        ) {
          confirmed = true;
          reason = "BOS";
        }
      }
    }

    if (!confirmed && (confluenceType == "QMR" || confluenceType == "ANY")) {
      if (checkQmr(currentSwings, armedState.direction)) {
        confirmed = true;
        reason = "QMR";
      }
    }

    if (!confirmed && (confluenceType == "iFVG" || confluenceType == "ANY")) {
      if (checkiFvg(bars, i, armedState.direction)) {
        confirmed = true;
        reason = "iFVG";
      }
    }

    if (!confirmed) {
      continue;
    }

    const stopLoss = armedState.direction == "LONG"
      ? armedState.extremePrice - (bar.close * 0.0001)
      : armedState.extremePrice + (bar.close * 0.0001);
    const risk = abs<f64>(bar.close - stopLoss);
    const target = armedState.direction == "LONG"
      ? bar.close + risk * riskReward
      : bar.close - risk * riskReward;
    const signalType = armedState.direction == "LONG" ? BUY_SIDE : SELL_SIDE;

    signals.push(
      new ConfluenceSignal(
        "confluence-" + signalType + "-" + bar.time.toString(),
        signalType,
        bar.close,
        stopLoss,
        target,
        bar.time,
        "Wick Sweep -> " + reason,
      ),
    );

    phase = "IDLE";
    armedState = null;
  }
}

function emitState(context: IndicatorContext, currentBarTime: f64): void {
  if (showHtfLevels) {
    for (let i = 0; i < levels.length; i += 1) {
      const level = levels[i];

      if (level.bodyBroken) {
        continue;
      }

      context.ray(
        level.id,
        level.time,
        level.price,
        level.type == "peak" ? bearishColor : bullishColor,
        lineWidth,
        0.5,
        true,
        true,
      );
    }
  }

  for (let i = 0; i < signals.length; i += 1) {
    const signal = signals[i];
    const committed = context.barState.isConfirmed || signal.time < currentBarTime;
    const color = signal.side == BUY_SIDE ? bullishColor : bearishColor;
    const markerOffsetY = signal.side == BUY_SIDE
      ? arrowSize + 10.0
      : -arrowSize - 10.0;
    const labelOffsetY = signal.side == BUY_SIDE
      ? markerOffsetY + arrowSize + 15.0
      : markerOffsetY - arrowSize - 12.0;

    context.plotshape(
      signal.id + "-marker",
      signal.time,
      signal.price,
      signal.side == BUY_SIDE ? "arrow-up" : "arrow-down",
      color,
      arrowSize,
      0,
      markerOffsetY,
      committed,
      "",
    );
    context.label(
      signal.id + "-label",
      signal.time,
      signal.price,
      signal.reason,
      "#ffffff",
      "rgba(0, 0, 0, 0.72)",
      10,
      0,
      labelOffsetY,
      committed,
    );
    context.signal(
      signal.id,
      signal.side,
      signal.time,
      signal.price,
      signal.stopLoss,
      signal.target,
      signal.reason,
      committed,
      "",
    );
  }
}
