import { describe, expect, it, vi } from "vitest";
import type { ChartBar } from "@fxtoolkit/indicator-stdlib/abi";
import {
  createChartFrame,
  createLinearValueScaleProjection,
  createLogarithmicValueScaleProjection,
  createLogicalTimeScale,
  createViewport,
  RenderScheduler,
  panViewport,
  resolveVisibleWindow,
  zoomViewport,
} from "@fxtoolkit/indicator-runner";

const HOUR_MS = 60 * 60 * 1000;
const START_TIME = Date.UTC(2024, 0, 1);

function makeBars(count: number, stepMs = HOUR_MS): ChartBar[] {
  return Array.from({ length: count }, (_, index) => ({
    close: 1000 + index + 1,
    high: 1000 + index + 5,
    low: 1000 + index - 5,
    open: 1000 + index,
    spread: 0,
    time: START_TIME + index * stepMs,
    volume: 100 + index,
  }));
}

const BARS = makeBars(300);

describe("viewport windowing", () => {
  it("pins to the newest bars at offset 0 and slides back with offsetBars", () => {
    const newest = resolveVisibleWindow(BARS, createViewport(100, 0));
    expect(newest.startIndex).toBe(200);
    expect(newest.endIndex).toBe(299);
    expect(newest.bars).toHaveLength(100);

    const older = resolveVisibleWindow(BARS, createViewport(100, 10));
    expect(older.startIndex).toBe(190);
    expect(older.endIndex).toBe(289);
  });

  it("never runs past either end of the series", () => {
    const clampedBack = resolveVisibleWindow(BARS, createViewport(100, 250));
    expect(clampedBack.startIndex).toBe(0);
    expect(clampedBack.endIndex).toBe(99);

    const clampedFront = resolveVisibleWindow(BARS, createViewport(100, -50));
    expect(clampedFront.endIndex).toBe(299);

    expect(resolveVisibleWindow([], createViewport(100, 0)).bars).toEqual([]);
  });

  it("pans without mutating the bar series", () => {
    const before = BARS.map((bar) => bar.time);
    const panned = panViewport(BARS, createViewport(100, 0), -10);

    expect(panned.offsetBars).toBe(10);
    expect(BARS.map((bar) => bar.time)).toEqual(before);
  });

  it("zooms while keeping the newest visible bar fixed", () => {
    const zoomedOut = zoomViewport(BARS, createViewport(100, 0), 2);
    expect(zoomedOut.barCount).toBe(200);
    expect(resolveVisibleWindow(BARS, zoomedOut).endIndex).toBe(299);

    const zoomedIn = zoomViewport(BARS, createViewport(100, 0), 0.5);
    expect(zoomedIn.barCount).toBe(50);
    expect(resolveVisibleWindow(BARS, zoomedIn).endIndex).toBe(299);
  });
});

describe("logical time scale", () => {
  // Logical positions are anchored to absolute time divided by the step, so they are not
  // bar-relative; only their differences are (which is all the frame's projections rely on).
  const logical = (scale: { timeToLogical(time: number): number }, time: number) =>
    scale.timeToLogical(time);

  it("is monotonic and one slot per uniform interval", () => {
    const scale = createLogicalTimeScale({
      mode: "continuous",
      timeFrameMs: HOUR_MS,
      times: BARS.map((bar) => bar.time),
    });

    const base = logical(scale, BARS[0].time);
    expect(logical(scale, BARS[1].time) - base).toBeCloseTo(1, 9);
    expect(logical(scale, BARS[10].time) - base).toBeCloseTo(10, 9);
    expect(logical(scale, BARS[10].time)).toBeGreaterThan(
      logical(scale, BARS[9].time),
    );
  });

  it("widens ordinary gaps in continuous mode and compresses closures in sessions mode", () => {
    const times = [START_TIME, START_TIME + HOUR_MS, START_TIME + HOUR_MS * 10];

    const continuous = createLogicalTimeScale({
      mode: "continuous",
      timeFrameMs: HOUR_MS,
      times,
    });
    // one slot for the first interval plus the full nine-slot gap
    expect(logical(continuous, times[2]) - logical(continuous, times[0])).toBeCloseTo(10, 9);

    const sessions = createLogicalTimeScale({
      mode: "sessions",
      timeFrameMs: HOUR_MS,
      times,
    });
    expect(logical(sessions, times[2]) - logical(sessions, times[0])).toBeCloseTo(2, 9);
  });

  it("round-trips through logicalToTime", () => {
    const scale = createLogicalTimeScale({
      mode: "continuous",
      timeFrameMs: HOUR_MS,
      times: BARS.map((bar) => bar.time),
    });

    const position = scale.timeToLogical(BARS[123].time);
    expect(scale.logicalToTime(position)).toBeCloseTo(BARS[123].time, 3);
  });
});

describe("value scale", () => {
  it("maps the domain onto the plot box, inverted", () => {
    const scale = createLinearValueScaleProjection({
      domain: { from: 100, to: 200 },
      height: 400,
      id: "price",
      unit: "price",
    });

    expect(scale.valueToY(200)).toBeCloseTo(0, 9);
    expect(scale.valueToY(100)).toBeCloseTo(400, 9);
    expect(scale.valueToY(150)).toBeCloseTo(200, 9);
    expect(scale.yToValue(200)).toBeCloseTo(150, 9);
  });

  it("inverts for a logarithmic scale", () => {
    const scale = createLogarithmicValueScaleProjection({
      domain: { from: 100, to: 10000 },
      height: 400,
      id: "price",
    });

    // Equal ratios occupy equal vertical distance.
    expect(scale.valueToY(10000)).toBeCloseTo(0, 6);
    expect(scale.valueToY(100)).toBeCloseTo(400, 6);
    expect(scale.valueToY(1000)).toBeCloseTo(200, 6);
    expect(scale.yToValue(200)).toBeCloseTo(1000, 4);
  });
});

describe("chart frame", () => {
  it("projects the first visible bar to the plot's left edge", () => {
    const viewport = createViewport(100, 0);
    const frame = createChartFrame({
      bars: BARS,
      plotHeight: 400,
      plotWidth: 800,
      viewport,
    });
    const window = resolveVisibleWindow(BARS, viewport);

    expect(frame.plotOffsetX).toBe(0);
    expect(frame.timeToX(window.bars[0].time)).toBeCloseTo(0, 6);
    // 100 bars across 800px, so each bar advances 8px and the last sits just inside the edge.
    expect(frame.pixelsPerBar).toBeCloseTo(8, 9);
    expect(frame.timeToX(window.bars[99].time)).toBeCloseTo(792, 6);
    expect(frame.plotRightX).toBe(800);
  });

  it("changes projections when panned but not the underlying data", () => {
    const pinned = createViewport(100, 0);
    const panned = panViewport(BARS, pinned, -20);
    const options = { bars: BARS, plotHeight: 400, plotWidth: 800 };

    const pinnedFrame = createChartFrame({ ...options, viewport: pinned });
    const pannedFrame = createChartFrame({ ...options, viewport: panned });
    const sampleTime = BARS[200].time;

    expect(pannedFrame.timeToX(sampleTime)).not.toBeCloseTo(
      pinnedFrame.timeToX(sampleTime),
      3,
    );
    // Stored chart geometry is untouched: the same time still projects from the same bars.
    expect(BARS).toHaveLength(300);
    expect(pannedFrame.visibleTimeRange.to).toBe(BARS[279].time);
  });

  it("scales the time axis with bar count and the price axis with the domain", () => {
    const options = { bars: BARS, plotHeight: 400, plotWidth: 800 };

    const wide = createChartFrame({ ...options, viewport: createViewport(100, 0) });
    const narrow = createChartFrame({ ...options, viewport: createViewport(200, 0) });
    expect(narrow.pixelsPerBar).toBeCloseTo(wide.pixelsPerBar / 2, 9);

    const tight = createChartFrame({
      ...options,
      freePriceRange: { from: 1200, to: 1250 },
      priceScaleMode: "free",
      viewport: createViewport(100, 0),
    });
    const loose = createChartFrame({
      ...options,
      freePriceRange: { from: 1200, to: 1300 },
      priceScaleMode: "free",
      viewport: createViewport(100, 0),
    });
    // The same price delta spans twice the pixels in a domain half as tall.
    const tightSpan = tight.valueToY(1210) - tight.valueToY(1220);
    const looseSpan = loose.valueToY(1210) - loose.valueToY(1220);
    expect(tightSpan).toBeCloseTo(looseSpan * 2, 6);
    expect(tightSpan).toBeCloseTo(80, 6);
  });

  it("fits an automatic price domain to the visible bars and extra values", () => {
    const base = createChartFrame({
      bars: BARS,
      plotHeight: 400,
      plotWidth: 800,
      viewport: createViewport(100, 0),
    });
    expect(base.visiblePriceRange.from).toBeLessThan(1195);
    expect(base.visiblePriceRange.to).toBeGreaterThan(1304);

    const withIndicator = createChartFrame({
      additionalPriceValues: [5000],
      bars: BARS,
      plotHeight: 400,
      plotWidth: 800,
      viewport: createViewport(100, 0),
    });
    expect(withIndicator.visiblePriceRange.to).toBeGreaterThan(5000);
  });

  it("reports adjacency and carries the data revision", () => {
    const frame = createChartFrame({
      bars: BARS,
      dataRevision: 7,
      plotHeight: 400,
      plotWidth: 800,
      viewport: createViewport(100, 0),
    });

    expect(frame.dataRevision).toBe(7);
    expect(frame.areTimesAdjacent(BARS[10].time, BARS[11].time)).toBe(true);
    expect(frame.areTimesAdjacent(BARS[10].time, BARS[13].time)).toBe(false);
  });

  it("infers the bar interval and pip size", () => {
    const hourly = createChartFrame({
      bars: BARS,
      plotHeight: 400,
      plotWidth: 800,
      symbol: "EURUSD",
      viewport: createViewport(100, 0),
    });
    expect(hourly.timeFrameMs).toBe(HOUR_MS);
    expect(hourly.pipSize).toBeGreaterThan(0);

    const daily = createChartFrame({
      bars: makeBars(300, 24 * HOUR_MS),
      plotHeight: 400,
      plotWidth: 800,
      viewport: createViewport(100, 0),
    });
    expect(daily.timeFrameMs).toBe(24 * HOUR_MS);
  });

  it("routes named value scales", () => {
    const frame = createChartFrame({
      bars: BARS,
      plotHeight: 400,
      plotWidth: 800,
      valueScales: { rsi: { domain: { from: 0, to: 100 } } },
      viewport: createViewport(100, 0),
    });

    expect(frame.valueToY(100, "rsi")).toBeCloseTo(0, 6);
    expect(frame.valueToY(0, "rsi")).toBeCloseTo(400, 6);
    // Unknown scale ids fall back to the primary scale.
    expect(frame.valueToY(100, "missing")).toBeCloseTo(
      frame.valueToY(100),
      9,
    );
  });

  it("survives an empty series", () => {
    const frame = createChartFrame({
      bars: [],
      plotHeight: 400,
      plotWidth: 800,
      viewport: createViewport(100, 0),
    });

    expect(frame.visibleTimeRange).toEqual({ from: 0, to: 0 });
    expect(Number.isFinite(frame.valueToY(100))).toBe(true);
  });
});

describe("render scheduler", () => {
  it("coalesces requests into one frame and accumulates reasons", () => {
    const render = vi.fn();
    const callbacks: Array<() => void> = [];
    const scheduler = new RenderScheduler(render, {
      cancel: vi.fn(),
      request: (callback) => {
        callbacks.push(() => callback(0));
        return callbacks.length;
      },
    });

    scheduler.request("data");
    scheduler.request("viewport");
    scheduler.request("data");

    expect(callbacks).toHaveLength(1);
    expect(render).not.toHaveBeenCalled();

    callbacks[0]();

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0].sort()).toEqual(["data", "viewport"]);

    // A new request after the frame schedules again.
    scheduler.request("resize");
    expect(callbacks).toHaveLength(2);
  });

  it("cancels pending work and stops after destroy", () => {
    const render = vi.fn();
    const cancelSpy = vi.fn();
    let pending: (() => void) | null = null;
    let handle = 0;

    const scheduler = new RenderScheduler(render, {
      cancel: (id) => {
        cancelSpy(id);
        pending = null;
      },
      request: (callback) => {
        pending = () => callback(0);
        handle += 1;
        return handle;
      },
    });

    scheduler.request("data");
    expect(pending).not.toBeNull();

    scheduler.cancel();
    expect(cancelSpy).toHaveBeenCalledWith(1);
    expect(pending).toBeNull();

    scheduler.destroy();
    scheduler.request("data");
    expect(pending).toBeNull();
    expect(render).not.toHaveBeenCalled();
  });
});
