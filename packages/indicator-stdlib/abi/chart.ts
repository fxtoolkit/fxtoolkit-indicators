/**
 * Indicator-related chart types.
 *
 * Ported from orion `src/library/models/chart/types.ts` (indicator subset only).
 * Keep this file textually close to the Orion source while Orion remains the parity reference.
 */

export type IndicatorModule = string;

export type IndicatorInputType =
  | "number"
  | "integer"
  | "boolean"
  | "string"
  | "select"
  | "color";

export type IndicatorOutputKind =
  | "bgcolor"
  | "plot"
  | "fill"
  | "plotshape"
  | "candle"
  | "line"
  | "linefill"
  | "ray"
  | "box"
  | "polyline"
  | "label"
  | "table"
  | "panel"
  | "signal"
  | "alert";

export type IndicatorSignalSide = "BUY" | "SELL";

export type IndicatorSignalEventType =
  | "provisional"
  | "confirmed"
  | "revoked";

export type IndicatorAlertEventType =
  | "provisional"
  | "confirmed"
  | "revoked";

export type IndicatorSeriesKind = "bgcolor" | "plot" | "plotshape";

export type IndicatorObjectKind =
  | "candle"
  | "line"
  | "linefill"
  | "ray"
  | "box"
  | "polyline"
  | "label"
  | "table"
  | "panel";

export interface IndicatorInputChoice {
  label: string;
  value: boolean | number | string;
}

export interface IndicatorInputField {
  key: string;
  label: string;
  type: IndicatorInputType;
  defaultValue: boolean | number | string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  choices?: IndicatorInputChoice[];
}

export interface IndicatorDescriptor {
  module: IndicatorModule;
  title: string;
  version: string;
  description?: string;
  inputs: IndicatorInputField[];
  outputKinds: IndicatorOutputKind[];
}

export interface IndicatorConfig {
  id?: string;
  /** Stable logical id used when this indicator is mirrored to peer charts. */
  syncId?: string;
  module: IndicatorModule;
  params?: Record<string, unknown>;
  enabled?: boolean;
  scaleId?: string;
}

export interface IndicatorInstance {
  id: string;
  /** Stable logical id used when this indicator is mirrored to peer charts. */
  syncId?: string;
  module: IndicatorModule;
  descriptor: IndicatorDescriptor;
  enabled: boolean;
  params: Record<string, unknown>;
  scaleId?: string;
}

export interface IndicatorSeriesPoint {
  committed: boolean;
  revision: number;
  style: Record<string, unknown>;
  text: string | null;
  time: number;
  value: number;
}

export interface IndicatorSeries {
  id: string;
  indicatorId: string;
  kind: IndicatorSeriesKind;
  points: IndicatorSeriesPoint[];
  style: Record<string, unknown>;
  scaleId?: string;
}

export interface IndicatorFill {
  id: string;
  indicatorId: string;
  lowerSeriesId: string;
  revision: number;
  style: Record<string, unknown>;
  upperSeriesId: string;
}

export interface IndicatorObject {
  committed: boolean;
  endPrice: number | null;
  endTime: number | null;
  id: string;
  indicatorId: string;
  kind: IndicatorObjectKind;
  price: number;
  revision: number;
  style: Record<string, unknown>;
  text: string | null;
  time: number;
  scaleId?: string;
}

export interface IndicatorTableCell {
  backgroundColor?: string;
  column: number;
  height?: number;
  row: number;
  text: string;
  textColor?: string;
  textHAlign?: string;
  textSize?: number;
  textVAlign?: string;
  width?: number;
}

export interface IndicatorTableMerge {
  endColumn: number;
  endRow: number;
  startColumn: number;
  startRow: number;
}

export interface IndicatorSignal {
  committed: boolean;
  id: string;
  indicatorId: string;
  message: string;
  payload: Record<string, unknown> | null;
  price: number;
  revision: number;
  side: IndicatorSignalSide;
  stopLoss: number;
  takeProfit: number;
  time: number;
}

export interface IndicatorSignalEvent {
  signal: IndicatorSignal;
  type: IndicatorSignalEventType;
}

export interface IndicatorAlert {
  committed: boolean;
  id: string;
  indicatorId: string;
  message: string;
  payload: Record<string, unknown> | null;
  price: number;
  revision: number;
  time: number;
  title: string;
}

export interface IndicatorAlertEvent {
  alert: IndicatorAlert;
  type: IndicatorAlertEventType;
}

export interface IndicatorRenderBundle {
  alerts: IndicatorAlert[];
  id: string;
  module: IndicatorModule;
  descriptor: IndicatorDescriptor;
  fills: IndicatorFill[];
  objects: IndicatorObject[];
  series: IndicatorSeries[];
  signals: IndicatorSignal[];
  scaleId?: string;
}

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  spread?: number;
  meta?: unknown;
}
