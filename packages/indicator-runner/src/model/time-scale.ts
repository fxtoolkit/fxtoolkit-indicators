// Ported verbatim from orion src/library/models/chart/plots/logical-time-scale.ts
// (no changes; it has no imports).

export type TimeScaleMode = "continuous" | "sessions";

export interface LogicalTimeScale {
  logicalToTime(logical: number): number;
  timeToLogical(time: number): number;
}

export function resolveTimeScaleMode(options: {
  hasMarketCalendar: boolean;
  requestedMode?: TimeScaleMode;
  symbols: readonly string[];
}): TimeScaleMode {
  if (options.requestedMode) return options.requestedMode;
  if (new Set(options.symbols).size > 1) return "continuous";
  return options.hasMarketCalendar ? "sessions" : "continuous";
}

interface LogicalTimeScaleOptions {
  isMarketClosedGap?: (
    fromTime: number,
    toTime: number,
    timeFrameMs: number,
  ) => boolean;
  mode: TimeScaleMode;
  timeFrameMs: number;
  times: readonly number[];
}

/**
 * Builds a monotonic, piecewise-linear mapping between real timestamps and
 * visual bar positions. In session mode, known closed-market intervals occupy
 * one bar slot; ordinary missing-data intervals retain their elapsed width.
 */
export function createLogicalTimeScale({
  isMarketClosedGap,
  mode,
  timeFrameMs,
  times,
}: LogicalTimeScaleOptions): LogicalTimeScale {
  const step = Math.max(1, timeFrameMs);
  const timeline = deduplicateSortedTimes(times);
  const positions = new Array<number>(timeline.length);

  if (timeline.length) positions[0] = timeline[0] / step;
  for (let index = 1; index < timeline.length; index += 1) {
    const left = timeline[index - 1];
    const right = timeline[index];
    const elapsedSlots = Math.max((right - left) / step, Number.EPSILON);
    const compress = mode === "sessions"
      && elapsedSlots > 1
      && (isMarketClosedGap?.(left, right, step) ?? true);
    positions[index] = positions[index - 1] + (compress ? 1 : elapsedSlots);
  }

  return {
    logicalToTime(logical: number) {
      if (!timeline.length) return logical * step;
      const insertion = upperBound(positions, logical);
      if (insertion === 0) {
        return timeline[0] + (logical - positions[0]) * step;
      }
      if (insertion >= positions.length) {
        const last = positions.length - 1;
        return timeline[last] + (logical - positions[last]) * step;
      }

      const left = insertion - 1;
      const span = positions[insertion] - positions[left];
      const fraction = span > 0 ? (logical - positions[left]) / span : 0;
      return timeline[left] + fraction * (timeline[insertion] - timeline[left]);
    },
    timeToLogical(time: number) {
      if (!timeline.length) return time / step;
      const insertion = upperBound(timeline, time);
      if (insertion === 0) {
        return positions[0] + (time - timeline[0]) / step;
      }
      if (insertion >= timeline.length) {
        const last = timeline.length - 1;
        return positions[last] + (time - timeline[last]) / step;
      }

      const left = insertion - 1;
      const elapsed = timeline[insertion] - timeline[left];
      const fraction = elapsed > 0 ? (time - timeline[left]) / elapsed : 0;
      return positions[left] + fraction * (positions[insertion] - positions[left]);
    },
  };
}

function deduplicateSortedTimes(times: readonly number[]) {
  const result: number[] = [];
  const sorted = times.filter(Number.isFinite).slice().sort((left, right) => left - right);
  for (const time of sorted) {
    if (result.at(-1) === time) continue;
    result.push(time);
  }
  return result;
}

function upperBound(values: readonly number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
