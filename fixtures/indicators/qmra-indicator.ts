// Ported verbatim from orion
// src/library/models/chart/indicators/assemblyscript/qmra-indicator.ts
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
  deserializeBarsSnapshot,
  epsilonForPrice,
  inputInt,
  inputNumber,
  inputString,
  serializeBarsSnapshot,
} from "@fxtoolkit/indicator-stdlib";

class SwingPoint {
  constructor(
    public index: i32,
    public price: f64,
    public time: f64,
    public type: string,
  ) {}
}

class QuasimodoPattern {
  constructor(
    public id: string,
    public direction: string,
    public p1: SwingPoint,
    public p2: SwingPoint,
    public p3: SwingPoint,
    public p4: SwingPoint,
    public entryLevel: f64,
    public status: string,
    public breakTime: f64 = 0.0,
  ) {}
}

const STATUS_ACTIVE = "active";
const STATUS_BROKEN = "broken";
const DIRECTION_BULLISH = "bullish";
const DIRECTION_BEARISH = "bearish";

const DEFAULT_SWING_STRENGTH: i32 = 5;
const DEFAULT_LINE_WIDTH: f64 = 1.0;
const DEFAULT_BULLISH_COLOR = "#00ffff";
const DEFAULT_BEARISH_COLOR = "#ff00ff";
const DEFAULT_IGNORED_COLOR = "#ffa500";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

const descriptor = new IndicatorDescriptor(
  "qmra-indicator",
  "Advanced Quasimodo",
  "1.0.0",
  "Detects active and ignored Quasimodo patterns with zigzag structure and left-shoulder projections.",
  [
    new InputField("swingStrength", "Swing Strength", "integer", DEFAULT_SWING_STRENGTH.toString(), "", 2, 12, 1),
    new InputField("lineWidth", "Line Width", "number", DEFAULT_LINE_WIDTH.toString(), "", 1, 4, 0.5),
    new InputField("bullishColor", "Bullish Color", "color", DEFAULT_BULLISH_COLOR),
    new InputField("bearishColor", "Bearish Color", "color", DEFAULT_BEARISH_COLOR),
    new InputField("ignoredColor", "Ignored Pattern Color", "color", DEFAULT_IGNORED_COLOR),
  ],
  ["line", "ray", "label"],
);

let swingStrength: i32 = DEFAULT_SWING_STRENGTH;
let lineWidth: f64 = DEFAULT_LINE_WIDTH;
let bullishColor = DEFAULT_BULLISH_COLOR;
let bearishColor = DEFAULT_BEARISH_COLOR;
let ignoredColor = DEFAULT_IGNORED_COLOR;

let bars = new Array<Bar>();
let patterns = new Array<QuasimodoPattern>();

export function describe(): string {
  return describeIndicator(descriptor);
}

export function init(): void {
  swingStrength = inputInt("swingStrength", DEFAULT_SWING_STRENGTH);
  lineWidth = inputNumber("lineWidth", DEFAULT_LINE_WIDTH);
  bullishColor = inputString("bullishColor", DEFAULT_BULLISH_COLOR);
  bearishColor = inputString("bearishColor", DEFAULT_BEARISH_COLOR);
  ignoredColor = inputString("ignoredColor", DEFAULT_IGNORED_COLOR);
}

export function reset(): void {
  bars = new Array<Bar>();
  patterns = new Array<QuasimodoPattern>();
}

export function destroy(): void {
  reset();
}

export function saveState(): string {
  return serializeBarsSnapshot(bars);
}

export function loadState(state: string): void {
  bars = deserializeBarsSnapshot(state);
  patterns = new Array<QuasimodoPattern>();
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

  calculatePatterns();
  emitPatterns(context);
}

function calculatePatterns(): void {
  const swings = getSwingPoints(bars, swingStrength);
  const nextPatterns = new Array<QuasimodoPattern>();

  if (swings.length < 4) {
    patterns = nextPatterns;
    return;
  }

  for (let i = 0; i <= swings.length - 4; i += 1) {
    const p1 = swings[i];
    const p2 = swings[i + 1];
    const p3 = swings[i + 2];
    const p4 = swings[i + 3];

    if (isBearishQuasimodo(p1, p2, p3, p4)) {
      const ignoredState = findBearishBreak(p3.price, p4.index);

      nextPatterns.push(
        new QuasimodoPattern(
          "qmra-bear-" + p3.time.toString(),
          DIRECTION_BEARISH,
          p1,
          p2,
          p3,
          p4,
          p1.price,
          ignoredState.breakTime > 0 ? STATUS_BROKEN : STATUS_ACTIVE,
          ignoredState.breakTime,
        ),
      );
    }

    if (isBullishQuasimodo(p1, p2, p3, p4)) {
      const ignoredState = findBullishBreak(p3.price, p4.index);

      nextPatterns.push(
        new QuasimodoPattern(
          "qmra-bull-" + p3.time.toString(),
          DIRECTION_BULLISH,
          p1,
          p2,
          p3,
          p4,
          p1.price,
          ignoredState.breakTime > 0 ? STATUS_BROKEN : STATUS_ACTIVE,
          ignoredState.breakTime,
        ),
      );
    }
  }

  patterns = nextPatterns;
}

function emitPatterns(context: IndicatorContext): void {
  const committed = context.barState.isConfirmed;

  for (let i = 0; i < patterns.length; i += 1) {
    const pattern = patterns[i];
    const color = pattern.status == STATUS_BROKEN
      ? ignoredColor
      : (pattern.direction == DIRECTION_BULLISH ? bullishColor : bearishColor);
    const zigZagOpacity = pattern.status == STATUS_BROKEN ? 0.5 : 1.0;
    const zigZagWidth = pattern.status == STATUS_BROKEN ? 1.0 : lineWidth;
    const dashed = pattern.status == STATUS_BROKEN;

    context.line(
      pattern.id + "-zig-1",
      pattern.p1.time,
      pattern.p2.time,
      pattern.p1.price,
      pattern.p2.price,
      color,
      zigZagWidth,
      zigZagOpacity,
      dashed,
      committed,
    );
    context.line(
      pattern.id + "-zig-2",
      pattern.p2.time,
      pattern.p3.time,
      pattern.p2.price,
      pattern.p3.price,
      color,
      zigZagWidth,
      zigZagOpacity,
      dashed,
      committed,
    );
    context.line(
      pattern.id + "-zig-3",
      pattern.p3.time,
      pattern.p4.time,
      pattern.p3.price,
      pattern.p4.price,
      color,
      zigZagWidth,
      zigZagOpacity,
      dashed,
      committed,
    );

    if (pattern.status == STATUS_BROKEN && pattern.breakTime > 0) {
      context.line(
        pattern.id + "-entry",
        pattern.p1.time,
        pattern.breakTime,
        pattern.entryLevel,
        pattern.entryLevel,
        color,
        lineWidth,
        0.8,
        false,
        committed,
      );
    } else {
      context.ray(
        pattern.id + "-entry",
        pattern.p1.time,
        pattern.entryLevel,
        color,
        lineWidth,
        0.8,
        false,
        committed,
      );
    }

    context.label(
      pattern.id + "-label",
      pattern.p3.time,
      pattern.p3.price,
      pattern.status == STATUS_BROKEN ? "IGNORED / BREAKER" : "QM",
      color,
      TRANSPARENT,
      10,
      0,
      -10,
      committed,
    );

    if (pattern.status == STATUS_BROKEN && pattern.breakTime > 0) {
      context.label(
        pattern.id + "-break",
        pattern.breakTime,
        pattern.p3.price,
        "X",
        color,
        TRANSPARENT,
        11,
        0,
        0,
        committed,
      );
    }
  }
}

function getSwingPoints(sourceBars: Array<Bar>, strength: i32): Array<SwingPoint> {
  const swings = new Array<SwingPoint>();

  if (sourceBars.length < strength * 2 + 1) {
    return swings;
  }

  for (let i = strength; i < sourceBars.length - strength; i += 1) {
    const bar = sourceBars[i];
    let swingHigh = true;
    let swingLow = true;

    for (let j = 1; j <= strength; j += 1) {
      if (sourceBars[i - j].high >= bar.high || sourceBars[i + j].high >= bar.high) {
        swingHigh = false;
      }

      if (sourceBars[i - j].low <= bar.low || sourceBars[i + j].low <= bar.low) {
        swingLow = false;
      }
    }

    if (swingHigh) {
      swings.push(new SwingPoint(i, bar.high, bar.time, "H"));
    }

    if (swingLow) {
      swings.push(new SwingPoint(i, bar.low, bar.time, "L"));
    }
  }

  const cleaned = new Array<SwingPoint>();

  if (swings.length == 0) {
    return cleaned;
  }

  cleaned.push(swings[0]);

  for (let i = 1; i < swings.length; i += 1) {
    const previous = cleaned[cleaned.length - 1];
    const current = swings[i];

    if (previous.type != current.type) {
      cleaned.push(current);
      continue;
    }

    if (previous.type == "H" && current.price > previous.price) {
      cleaned[cleaned.length - 1] = current;
    } else if (previous.type == "L" && current.price < previous.price) {
      cleaned[cleaned.length - 1] = current;
    }
  }

  return cleaned;
}

function isBearishQuasimodo(
  p1: SwingPoint,
  p2: SwingPoint,
  p3: SwingPoint,
  p4: SwingPoint,
): bool {
  return (
    p1.type == "H"
    && p2.type == "L"
    && p3.type == "H"
    && p4.type == "L"
    && p3.price > p1.price
    && p4.price < p2.price
  );
}

function isBullishQuasimodo(
  p1: SwingPoint,
  p2: SwingPoint,
  p3: SwingPoint,
  p4: SwingPoint,
): bool {
  return (
    p1.type == "L"
    && p2.type == "H"
    && p3.type == "L"
    && p4.type == "H"
    && p3.price < p1.price
    && p4.price > p2.price
  );
}

function findBearishBreak(headPrice: f64, startIndex: i32): BreakState {
  const epsilon = epsilonForPrice(headPrice);

  for (let i = startIndex + 1; i < bars.length; i += 1) {
    if (bars[i].close > headPrice + epsilon) {
      return new BreakState(bars[i].time);
    }
  }

  return new BreakState(0.0);
}

function findBullishBreak(headPrice: f64, startIndex: i32): BreakState {
  const epsilon = epsilonForPrice(headPrice);

  for (let i = startIndex + 1; i < bars.length; i += 1) {
    if (bars[i].close < headPrice - epsilon) {
      return new BreakState(bars[i].time);
    }
  }

  return new BreakState(0.0);
}

class BreakState {
  constructor(public breakTime: f64) {}
}
