import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ChartBar,
  IndicatorBundleDelta,
} from "@fxtoolkit/indicator-stdlib/abi";
import { applyIndicatorBundleDelta } from "@fxtoolkit/indicator-runner";
import {
  createGoldenEngineHarness,
  type GoldenEngineHarness,
} from "./support/golden-engine";

const MODULE = "lumina-trend-channels";
const DAY_MS = 24 * 60 * 60 * 1000;

function committedFlags(delta: IndicatorBundleDelta) {
  return delta.series.flatMap((series) => [...series.committed]);
}

describe("runner realtime delta path", () => {
  let harness: GoldenEngineHarness;

  beforeAll(async () => {
    harness = await createGoldenEngineHarness([MODULE]);
  });

  afterAll(() => {
    harness.destroy();
  });

  it(
    "streams provisional live bars, then commits them, through worker + engine",
    async () => {
      const { bars, engine } = harness;

      expect(harness.bundles).toHaveLength(1);

      const bundle = harness.bundles[0];
      expect(bundle.module).toBe(MODULE);
      expect(bundle.series.length).toBeGreaterThan(0);

      const lastBar = bars[bars.length - 1];
      const liveBar: ChartBar = {
        ...lastBar,
        close: lastBar.close + 5,
        high: lastBar.high + 5,
        time: lastBar.time + DAY_MS,
      };

      // A first live tick is provisional: nothing it emits is committed yet.
      const live = await engine.updateRealtimeBar(liveBar);
      expect(live.bundleDeltas).toHaveLength(1);

      const provisional = live.bundleDeltas[0];
      expect(provisional.indicatorId).toBe(bundle.id);
      expect(provisional.series.length).toBeGreaterThan(0);
      expect(committedFlags(provisional).every((flag) => flag === 0)).toBe(true);

      // Apply it the way a chart would, and confirm the live point is not committed.
      applyIndicatorBundleDelta(bundle, provisional);

      const liveSeries = bundle.series.find((series) =>
        series.points.some((point) => point.time === liveBar.time),
      );
      expect(liveSeries, "live bar produced a series point").toBeDefined();
      expect(
        liveSeries!.points.find((point) => point.time === liveBar.time)!.committed,
      ).toBe(false);

      // Appending the next bar commits the previous live bar, then opens a new one.
      const appended = await engine.appendRealtimeBar({
        ...liveBar,
        close: liveBar.close + 5,
        high: liveBar.high + 5,
        time: liveBar.time + DAY_MS,
      });
      expect(appended.bundleDeltas).toHaveLength(2);

      const [commitDelta, nextProvisional] = appended.bundleDeltas;
      expect(committedFlags(commitDelta).some((flag) => flag === 1)).toBe(true);
      expect(committedFlags(nextProvisional).every((flag) => flag === 0)).toBe(true);
      expect(commitDelta.revision).toBeGreaterThan(provisional.revision);

      applyIndicatorBundleDelta(bundle, commitDelta);

      const committedPoint = bundle.series
        .flatMap((series) => series.points)
        .find((point) => point.time === liveBar.time);

      expect(committedPoint?.committed, "live bar is committed").toBe(true);
    },
    30_000,
  );
});
