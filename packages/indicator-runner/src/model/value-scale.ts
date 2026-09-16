// Ported from orion src/library/models/chart/plots/value-scales.ts
//
// Changes: imports come from the local model types instead of Orion's chart types, and
// `getVisibleValueScaleConfigs` was dropped — it resolves chart-layer scale bindings, which only
// exist in Orion's multi-pane document model and have no counterpart here.

import type {
  ChartPriceRange,
  ValueScaleProjection,
} from "./types";

export function createLinearValueScaleProjection(options: {
  id: string;
  unit: ValueScaleProjection["unit"];
  domain: ChartPriceRange;
  height: number;
  quantization?: number;
}): ValueScaleProjection {
  const domain = normalizeDomain(options.domain, options.unit);
  const span = Math.max(domain.to - domain.from, minimumSpan(domain, options.unit));
  const quantization = options.quantization ?? defaultQuantization(options.unit, span);

  return {
    id: options.id,
    unit: options.unit,
    domain,
    valueToY(value) {
      return ((domain.to - value) / span) * options.height;
    },
    yToValue(y) {
      return domain.to - (y / Math.max(options.height, 1)) * span;
    },
    formatValue(value) {
      return formatScaleValue(value, options.unit, quantization);
    },
    quantizeValue(value) {
      return quantize(value, quantization);
    },
  };
}

/** Creates a price scale whose vertical distance is proportional to ratio. */
export function createLogarithmicValueScaleProjection(options: {
  id: string;
  domain: ChartPriceRange;
  height: number;
  quantization?: number;
}): ValueScaleProjection {
  const domain = normalizeLogarithmicDomain(options.domain);
  const fromLog = Math.log(domain.from);
  const toLog = Math.log(domain.to);
  const span = Math.max(toLog - fromLog, 1e-8);
  const quantization = options.quantization ?? defaultQuantization(
    "price",
    domain.to - domain.from,
  );

  return {
    id: options.id,
    unit: "price",
    domain,
    valueToY(value) {
      if (value <= 0 || !Number.isFinite(value)) return options.height;
      return ((toLog - Math.log(value)) / span) * options.height;
    },
    yToValue(y) {
      return Math.exp(toLog - (y / Math.max(options.height, 1)) * span);
    },
    formatValue(value) {
      return formatScaleValue(value, "price", quantization);
    },
    quantizeValue(value) {
      return quantize(value, quantization);
    },
  };
}

export function getAutomaticScaleDomain(
  values: readonly number[],
  unit: ValueScaleProjection["unit"],
) {
  const finiteValues = values.filter(Number.isFinite);

  if (!finiteValues.length) {
    return unit === "percent" ? { from: -1, to: 1 } : { from: 0, to: 1 };
  }

  let from = Math.min(...finiteValues);
  let to = Math.max(...finiteValues);

  if (unit === "percent") {
    from = Math.min(from, 0);
    to = Math.max(to, 0);
  }

  if (from === to) {
    const padding = Math.max(Math.abs(from) * 0.01, unit === "percent" ? 1 : 0.0001);
    from -= padding;
    to += padding;
  }

  const padding = (to - from) * 0.05;
  return {
    from: unit === "percent" ? Math.min(from - padding, 0) : from - padding,
    to: to + padding,
  };
}

function normalizeDomain(
  range: ChartPriceRange,
  unit: ValueScaleProjection["unit"],
) {
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);

  if (unit === "percent") {
    return { from: Math.min(from, 0), to: Math.max(to, 0) };
  }

  return { from, to };
}

function normalizeLogarithmicDomain(range: ChartPriceRange) {
  const values = [range.from, range.to].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const fallback = values[0] ?? 1;
  const from = Math.max(Math.min(...values, fallback), Number.MIN_VALUE);
  const to = Math.max(Math.max(...values, fallback), from * (1 + 1e-8));
  return { from, to };
}

function minimumSpan(
  range: ChartPriceRange,
  unit: ValueScaleProjection["unit"],
) {
  return unit === "percent" ? 0.01 : Math.max(Math.abs(range.to) * 1e-8, 1e-8);
}

function defaultQuantization(
  unit: ValueScaleProjection["unit"],
  span: number,
) {
  if (unit === "percent") return 0.01;
  if (unit === "numeric") return Math.max(span / 1000, 0.01);
  return Math.max(span / 1000, 0.00001);
}

function quantize(value: number, increment: number) {
  return Math.round(value / increment) * increment;
}

function formatScaleValue(
  value: number,
  unit: ValueScaleProjection["unit"],
  increment: number,
) {
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(increment))));
  const text = value.toFixed(decimals);
  return unit === "percent" ? `${text}%` : text;
}
