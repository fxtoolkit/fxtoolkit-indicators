import { describe, expect, it } from "vitest";
import type { ChartBar } from "@fxtoolkit/indicator-stdlib/abi";
import {
  createChartFrame,
  createViewport,
  mountIndicatorSurface,
  type IndicatorProjection,
  type TimeAxis,
} from "@fxtoolkit/indicator-runner";
import { installCanvasContextStub } from "./support/fake-canvas";

const HOUR_MS = 60 * 60 * 1000;
const PLOT_WIDTH = 900;
const PLOT_HEIGHT = 500;

function makeBars(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    close: 1000 + index,
    high: 1005 + index,
    low: 995 + index,
    open: 1000 + index,
    spread: 0,
    time: 1_700_000_000_000 + index * HOUR_MS,
    volume: 100,
  })) as ChartBar[];
}

/**
 * TradingView's transform: `x = width - (rightOffset + barsFromRight(time) + 1) * barSpacing`,
 * where `barsFromRight` counts bar *indexes* back from the newest bar.
 *
 * This is the shape the built-in `viewport` model cannot express, and the reason `TimeAxis` exists.
 */
function createTradingViewAxis(options: {
  barSpacing: number;
  rightOffset: number;
  lastBarTime: number;
  from: number;
  to: number;
}): TimeAxis {
  const { barSpacing, lastBarTime, rightOffset } = options;

  const barsFromRight = (time: number) => (lastBarTime - time) / HOUR_MS;
  const toX = (time: number) =>
    PLOT_WIDTH - (rightOffset + barsFromRight(time) + 1) * barSpacing;
  const toTime = (x: number) =>
    lastBarTime -
    ((PLOT_WIDTH - x) / barSpacing - rightOffset - 1) * HOUR_MS;

  return {
    pixelsPerBar: barSpacing,
    toTime,
    toX,
    visibleTimeRange: { from: options.from, to: options.to },
  };
}

const BARS = makeBars(300);
const NEWEST = BARS[BARS.length - 1].time;

describe("host-supplied time axis", () => {
  it("uses the host projection verbatim", () => {
    const axis = createTradingViewAxis({
      barSpacing: 7.5,
      from: BARS[200].time,
      lastBarTime: NEWEST,
      rightOffset: 12,
      to: NEWEST,
    });

    const frame = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      timeAxis: axis,
    });

    for (const time of [BARS[200].time, BARS[240].time, BARS[299].time]) {
      expect(frame.timeToX(time), `toX(${time})`).toBeCloseTo(axis.toX(time), 9);
    }
    for (const x of [0, 250, PLOT_WIDTH]) {
      expect(frame.xToTime(x), `toTime(${x})`).toBeCloseTo(axis.toTime(x), 6);
    }

    expect(frame.pixelsPerBar).toBe(7.5);
    expect(frame.visibleTimeRange).toEqual({ from: BARS[200].time, to: NEWEST });
  });

  it("inverts its own projection exactly in both modes", () => {
    const axis = createTradingViewAxis({
      barSpacing: 4,
      from: BARS[100].time,
      lastBarTime: NEWEST,
      rightOffset: 0,
      to: NEWEST,
    });

    const hostFrame = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      timeAxis: axis,
    });

    const viewportFrame = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(120, 0),
    });

    for (const frame of [hostFrame, viewportFrame]) {
      for (const x of [0, 120, 450, 899]) {
        expect(frame.timeToX(frame.xToTime(x)), `x=${x}`).toBeCloseTo(x, 4);
      }
    }
  });

  it("follows the host's range when choosing visible bars and the price domain", () => {
    // Only the last 50 bars are on screen, priced around 1250-1300.
    const windowed = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      timeAxis: createTradingViewAxis({
        barSpacing: 8,
        from: BARS[250].time,
        lastBarTime: NEWEST,
        rightOffset: 0,
        to: NEWEST,
      }),
    });

    const whole = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(300, 0),
    });

    // The host's window must drive the auto price domain, not our viewport.
    expect(windowed.visiblePriceRange.from).toBeGreaterThan(1200);
    expect(windowed.visiblePriceRange.from).toBeGreaterThan(whole.visiblePriceRange.from);
  });

  it("matches TradingView across a matrix of scroll and zoom states", () => {
    // The M4 parity gate in miniature: our frame must reproduce the host transform, not approximate it.
    for (const barSpacing of [2, 7.5, 18.25]) {
      for (const rightOffset of [0, 5, 37]) {
        for (const firstVisibleIndex of [60, 200]) {
          const axis = createTradingViewAxis({
            barSpacing,
            from: BARS[firstVisibleIndex].time,
            lastBarTime: NEWEST,
            rightOffset,
            to: NEWEST,
          });

          const frame = createChartFrame({
            bars: BARS,
            plotHeight: PLOT_HEIGHT,
            plotWidth: PLOT_WIDTH,
            timeAxis: axis,
          });

          for (let index = firstVisibleIndex; index < 300; index += 37) {
            const time = BARS[index].time;
            expect(
              frame.timeToX(time),
              `spacing=${barSpacing} offset=${rightOffset} bar=${index}`,
            ).toBeCloseTo(axis.toX(time), 9);
          }
        }
      }
    }
  });

  it("is ignored when no axis is supplied", () => {
    const frame = createChartFrame({
      bars: BARS,
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      viewport: createViewport(100, 0),
    });

    // The built-in model still places the first visible bar at the plot's left edge.
    expect(frame.timeToX(frame.visibleTimeRange.from)).toBeCloseTo(0, 6);
    expect(frame.pixelsPerBar).toBeCloseTo(PLOT_WIDTH / 100, 9);
  });
});

describe("surface with a host time axis", () => {
  it("projects through the supplied axis", () => {
    installCanvasContextStub();

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: PLOT_WIDTH });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: PLOT_HEIGHT });
    document.body.appendChild(container);

    const axis = createTradingViewAxis({
      barSpacing: 6,
      from: BARS[220].time,
      lastBarTime: NEWEST,
      rightOffset: 3,
      to: NEWEST,
    });

    const surface = mountIndicatorSurface(container, {
      getProjection: () => ({
        plotHeight: PLOT_HEIGHT,
        plotWidth: PLOT_WIDTH,
        timeAxis: axis,
      }),
      prefer: "canvas",
    });

    try {
      surface.setBars(BARS);
      surface.renderNow();

      const frame = surface.getFrame()!;
      expect(frame.pixelsPerBar).toBe(6);
      expect(frame.timeToX(BARS[250].time)).toBeCloseTo(axis.toX(BARS[250].time), 9);
      expect(frame.visibleTimeRange).toEqual({ from: BARS[220].time, to: NEWEST });
    } finally {
      surface.destroy();
    }
  });

  it("falls back to the built-in viewport when the provider returns null", () => {
    installCanvasContextStub();

    // A supplied canvas, so the plot size is explicit. In container mode the surface sizes itself
    // from the canvas it creates, which depends on CSS layout and is meaningless under jsdom.
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: PLOT_WIDTH });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: PLOT_HEIGHT });
    document.body.appendChild(canvas);

    const surface = mountIndicatorSurface(canvas, {
      getProjection: () => null,
      prefer: "canvas",
      viewport: { barCount: 80 },
    });

    try {
      surface.setBars(BARS);
      surface.renderNow();

      expect(surface.getFrame()!.pixelsPerBar).toBeCloseTo(PLOT_WIDTH / 80, 9);
      expect(surface.getFrame()!.visibleTimeRange.to).toBe(NEWEST);
    } finally {
      surface.destroy();
    }
  });
});

describe("host projection", () => {
  const bars = makeBars(50);
  const priceRange = { from: 1000, to: 1100 };

  /** A trivial axis — these tests are about the plot box and the price domain. */
  function projection(): IndicatorProjection {
    return {
      plotHeight: PLOT_HEIGHT,
      plotWidth: PLOT_WIDTH,
      priceRange,
      timeAxis: {
        pixelsPerBar: 10,
        toTime: (x: number) => x,
        toX: (time: number) => time,
        visibleTimeRange: { from: bars[0].time, to: bars[49].time },
      },
    };
  }

  it("draws to the host's price domain and plot box", () => {
    installCanvasContextStub();

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);

    const surface = mountIndicatorSurface(canvas, {
      getProjection: projection,
      // Explicit, so the range is not re-snapped around a different pip size.
      pipSize: 0.01,
      prefer: "canvas",
    });

    try {
      surface.setBars(bars);
      surface.renderNow();

      const frame = surface.getFrame()!;
      expect(frame.visiblePriceRange).toEqual(priceRange);
      expect(frame.plotWidth).toBe(PLOT_WIDTH);
      expect(frame.plotHeight).toBe(PLOT_HEIGHT);
      // The host's range spans the box exactly, which is what makes the overlay land on the candle.
      expect(frame.valueToY(priceRange.to)).toBeCloseTo(0, 6);
      expect(frame.valueToY(priceRange.from)).toBeCloseTo(PLOT_HEIGHT, 6);
    } finally {
      surface.destroy();
    }
  });

  it("sizes the canvas from the host's box, not its own client box", () => {
    installCanvasContextStub();

    const canvas = document.createElement("canvas");
    // Nothing like the projection's box — the canvas must follow the host, not the DOM.
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 10 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 10 });
    document.body.appendChild(canvas);

    const surface = mountIndicatorSurface(canvas, {
      getProjection: projection,
      pixelRatio: 1,
      prefer: "canvas",
    });

    try {
      surface.renderNow();

      expect(canvas.style.width).toBe(`${PLOT_WIDTH}px`);
      expect(canvas.style.height).toBe(`${PLOT_HEIGHT}px`);
      expect(canvas.width).toBe(PLOT_WIDTH);
      expect(canvas.height).toBe(PLOT_HEIGHT);
    } finally {
      surface.destroy();
    }
  });

  it("still falls back to the canvas box when the projection has no price range", () => {
    installCanvasContextStub();

    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: PLOT_WIDTH });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: PLOT_HEIGHT });
    document.body.appendChild(canvas);

    const surface = mountIndicatorSurface(canvas, {
      getProjection: () => ({ ...projection(), priceRange: null }),
      prefer: "canvas",
    });

    try {
      surface.setBars(bars);
      surface.renderNow();

      // Automatic scale: fitted to the bars, which reach ~1055, so not the host's range.
      const frame = surface.getFrame()!;
      expect(frame.visiblePriceRange.to).not.toBe(priceRange.to);
      expect(frame.visiblePriceRange.from).toBeLessThan(995);
      expect(frame.visiblePriceRange.to).toBeGreaterThan(1055);
    } finally {
      surface.destroy();
    }
  });
});
