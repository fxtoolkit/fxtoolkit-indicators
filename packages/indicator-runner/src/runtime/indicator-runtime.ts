// Ported from orion src/library/models/chart/workers/indicator-runtime.ts
//
// Changes from Orion:
//   - ABI types and constants come from @fxtoolkit/indicator-stdlib/abi (single source of truth);
//     the local type declarations were removed in favour of those.
//   - Manifest/WASM loading is delegated to an injected IndicatorModuleSource instead of
//     fetching a hardcoded "/orion-indicators/manifest.json" and entry.wasmUrl.

import { instantiate } from "@assemblyscript/loader";
import type { ASUtil } from "@assemblyscript/loader";
import {
  ABI_VERSION,
  TABLE_FIELD_SEPARATOR,
  TABLE_RECORD_SEPARATOR,
  type IndicatorWasmExports,
  type ChartBar,
  type IndicatorConfig,
  type IndicatorInstance,
  type IndicatorSignal,
  type IndicatorTableCell,
  type IndicatorTableMerge,
  type IndicatorBarState,
  type IndicatorInputField,
  type IndicatorManifest,
  type IndicatorManifestEntry,
  type IndicatorModuleRecord,
  type IndicatorRuntimeInfo,
  type IndicatorSessionOutputs,
} from "@fxtoolkit/indicator-stdlib/abi";
import type { IndicatorModuleSource } from "./module-source";

export default class IndicatorRuntime {
  private manifestPromise: Promise<IndicatorManifest> | null = null;
  private readonly moduleCache = new Map<
    string,
    Promise<IndicatorModuleRecord>
  >();

  constructor(private readonly source: IndicatorModuleSource) {}

  async getManifest() {
    if (!this.manifestPromise) {
      this.manifestPromise = this.source.getManifest();
    }

    return this.manifestPromise;
  }

  async resolveIndicator(
    config: IndicatorConfig,
  ): Promise<IndicatorInstance> {
    const moduleRecord = await this.getModuleRecord(config.module);
    const descriptor = moduleRecord.entry.descriptor;
    const params = resolveIndicatorParams(descriptor.inputs, config.params ?? {});

    return {
      descriptor,
      enabled: config.enabled ?? true,
      id: config.id ?? `${config.module}-instance`,
      module: config.module,
      params,
    };
  }

  async createSession(
    indicator: IndicatorInstance,
    runtimeInfo: IndicatorRuntimeInfo,
  ) {
    const moduleRecord = await this.getModuleRecord(indicator.module);
    return IndicatorSession.create(indicator, runtimeInfo, moduleRecord);
  }

  private async getModuleRecord(
    moduleName: IndicatorConfig["module"],
  ) {
    const cachedModule = this.moduleCache.get(moduleName);

    if (cachedModule) {
      return cachedModule;
    }

    const nextModule = this.loadModuleRecord(moduleName);

    this.moduleCache.set(moduleName, nextModule);
    return nextModule;
  }

  private async loadModuleRecord(moduleName: string) {
    const manifest = await this.getManifest();
    const indicatorEntry = manifest.indicators.find(
      (entry) => entry.module === moduleName,
    );

    if (!indicatorEntry) {
      throw new Error(`Indicator module not found for "${moduleName}"`);
    }

    if (indicatorEntry.abiVersion !== ABI_VERSION) {
      throw new Error(
        `Indicator "${moduleName}" uses ABI ${indicatorEntry.abiVersion}, expected ${ABI_VERSION}`,
      );
    }

    return {
      bytes: await this.source.loadModuleBytes(indicatorEntry),
      entry: indicatorEntry,
    };
  }
}

class IndicatorSession {
  private readonly outputs: IndicatorSessionOutputs = {
    alerts: [],
    fills: [],
    objects: [],
    seriesPoints: [],
    signals: [],
  };
  private exports: (ASUtil & IndicatorWasmExports) | null = null;
  private stateSnapshot = "";
  private stateSnapshotPointer = 0;

  private constructor(
    private readonly indicator: IndicatorInstance,
    private readonly runtimeInfo: IndicatorRuntimeInfo,
  ) {}

  static async create(
    indicator: IndicatorInstance,
    runtimeInfo: IndicatorRuntimeInfo,
    moduleRecord: IndicatorModuleRecord,
  ) {
    const session = new IndicatorSession(indicator, runtimeInfo);

    await session.instantiate(moduleRecord);
    session.init();
    return session;
  }

  destroy() {
    this.releaseStateSnapshot();
    this.exports?.destroy?.();
    this.exports?.__collect();
    this.exports = null;
  }

  loadState(snapshot: string | null) {
    if (!snapshot || !snapshot.length || !this.exports) {
      return;
    }

    if (snapshot !== this.stateSnapshot || !this.stateSnapshotPointer) {
      this.releaseStateSnapshot();
      this.stateSnapshotPointer = this.exports.__newString(snapshot);
      this.exports.__pin(this.stateSnapshotPointer);
      this.stateSnapshot = snapshot;
    }

    this.exports.loadState(this.stateSnapshotPointer);
  }

  restore(snapshot: string | null) {
    if (!this.exports) {
      throw new Error("Indicator session has not been initialized");
    }

    this.init();
    if (!snapshot) this.releaseStateSnapshot();
    this.loadState(snapshot);
  }

  processBar(
    bar: ChartBar,
    barState: IndicatorBarState,
  ): IndicatorSessionOutputs {
    if (!this.exports) {
      throw new Error("Indicator session has not been initialized");
    }

    this.outputs.seriesPoints = [];
    this.outputs.alerts = [];
    this.outputs.fills = [];
    this.outputs.objects = [];
    this.outputs.signals = [];

    this.exports.onBar(
      bar.time,
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume ?? 0,
      bar.spread ?? 0,
      barState.index,
      barState.isRealtime ? 1 : 0,
      barState.isConfirmed ? 1 : 0,
      barState.isLastBar ? 1 : 0,
      barState.isFirst ? 1 : 0,
      barState.isHistory ? 1 : 0,
      barState.isNew ? 1 : 0,
    );

    return cloneSessionOutputs(this.outputs);
  }

  processHistoryBars(bars: ChartBar[]): IndicatorSessionOutputs {
    if (!this.exports) {
      throw new Error("Indicator session has not been initialized");
    }

    this.clearOutputs();
    const arrayId = this.exports.FLOAT64_ARRAY_ID;
    const values = [
      Float64Array.from(bars, (bar) => bar.time),
      Float64Array.from(bars, (bar) => bar.open),
      Float64Array.from(bars, (bar) => bar.high),
      Float64Array.from(bars, (bar) => bar.low),
      Float64Array.from(bars, (bar) => bar.close),
      Float64Array.from(bars, (bar) => bar.volume ?? 0),
      Float64Array.from(bars, (bar) => bar.spread ?? 0),
    ];
    // Pin each allocation before asking the AssemblyScript heap for the next
    // one. Larger history batches can trigger collection between allocations;
    // deferring all pins until the end would leave earlier array pointers
    // eligible for reclamation.
    const pointers = values.map((value) =>
      this.exports!.__pin(this.exports!.__newArray(arrayId, value))
    );

    try {
      this.exports.onBars(
        pointers[0],
        pointers[1],
        pointers[2],
        pointers[3],
        pointers[4],
        pointers[5],
        pointers[6],
      );
      return cloneSessionOutputs(this.outputs);
    } finally {
      for (const pointer of pointers) this.exports.__unpin(pointer);
      this.exports.__collect();
    }
  }

  saveState() {
    if (!this.exports) {
      return "";
    }

    const statePtr = this.exports.saveState();

    if (!statePtr) {
      return "";
    }

    return this.exports.__getString(statePtr);
  }

  private init() {
    if (!this.exports) {
      throw new Error("Indicator session has not been initialized");
    }

    this.exports.reset();
    this.clearOutputs();
    this.exports.init();
  }

  private clearOutputs() {
    this.outputs.seriesPoints = [];
    this.outputs.alerts = [];
    this.outputs.fills = [];
    this.outputs.objects = [];
    this.outputs.signals = [];
  }

  private releaseStateSnapshot() {
    if (this.exports && this.stateSnapshotPointer) {
      this.exports.__unpin(this.stateSnapshotPointer);
    }
    this.stateSnapshot = "";
    this.stateSnapshotPointer = 0;
  }

  private async instantiate(moduleRecord: IndicatorModuleRecord) {
    let runtimeExports: (ASUtil & IndicatorWasmExports) | null =
      null;

    const decodeString = (pointer: number) =>
      !pointer || !runtimeExports ? "" : runtimeExports.__getString(pointer);
    const encodeString = (value: string) =>
      !runtimeExports ? 0 : runtimeExports.__newString(value);
    const decodePayload = (pointer: number) => {
      const payloadText = decodeString(pointer);
      let payload: Record<string, unknown> | null = null;

      if (payloadText) {
        try {
          payload = JSON.parse(payloadText) as Record<string, unknown>;
        } catch {
          payload = { raw: payloadText };
        }
      }

      return payload;
    };
    const coerceBoolean = (value: unknown, fallback: boolean) => {
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number") {
        return value !== 0;
      }

      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();

        if (normalized === "true" || normalized === "1") {
          return true;
        }

        if (normalized === "false" || normalized === "0") {
          return false;
        }
      }

      return fallback;
    };
    const parseTablePayload = (payloadText: string) => {
      if (!payloadText.includes(TABLE_RECORD_SEPARATOR)) {
        return null;
      }

      const cells = new Map<string, IndicatorTableCell>();
      let merges: IndicatorTableMerge[] = [];
      const style: Record<string, unknown> = {};

      for (const record of payloadText.split(TABLE_RECORD_SEPARATOR)) {
        if (!record.length) {
          continue;
        }

        const fields = record.split(TABLE_FIELD_SEPARATOR);
        const kind = fields[0];

        if (kind === "style") {
          const borderWidth = Number(fields[4] ?? "0");
          const frameWidth = Number(fields[6] ?? "0");

          style.color = fields[1] || "";
          style.backgroundColor = fields[2] || "";
          style.borderColor = fields[3] || "";
          style.borderWidth = Number.isFinite(borderWidth) ? borderWidth : 0;
          style.frameColor = fields[5] || "";
          style.frameWidth = Number.isFinite(frameWidth) ? frameWidth : 0;
          continue;
        }

        if (kind === "cell") {
          const column = Number(fields[1] ?? "0");
          const row = Number(fields[2] ?? "0");

          if (!Number.isFinite(column) || !Number.isFinite(row)) {
            continue;
          }

          const textSize = Number(fields[6] ?? "10");
          const width = Number(fields[7] ?? "NaN");
          const height = Number(fields[8] ?? "NaN");

          cells.set(`${column}:${row}`, {
            backgroundColor: fields[5] || undefined,
            column,
            height: Number.isFinite(height) ? height : undefined,
            row,
            text: fields[3] ?? "",
            textColor: fields[4] || undefined,
            textHAlign: fields[9] || undefined,
            textSize: Number.isFinite(textSize) ? textSize : undefined,
            textVAlign: fields[10] || undefined,
            width: Number.isFinite(width) ? width : undefined,
          });
          continue;
        }

        if (kind === "merge") {
          const startColumn = Number(fields[1] ?? "0");
          const startRow = Number(fields[2] ?? "0");
          const endColumn = Number(fields[3] ?? "0");
          const endRow = Number(fields[4] ?? "0");

          if (
            Number.isFinite(startColumn)
            && Number.isFinite(startRow)
            && Number.isFinite(endColumn)
            && Number.isFinite(endRow)
          ) {
            merges.push({
              endColumn,
              endRow,
              startColumn,
              startRow,
            });
          }
          continue;
        }

        if (kind === "clear") {
          const startColumn = Number(fields[1] ?? "0");
          const startRow = Number(fields[2] ?? "0");
          const endColumn = Number(fields[3] ?? "0");
          const endRow = Number(fields[4] ?? "0");

          if (
            !Number.isFinite(startColumn)
            || !Number.isFinite(startRow)
            || !Number.isFinite(endColumn)
            || !Number.isFinite(endRow)
          ) {
            continue;
          }

          for (const [key, cell] of cells.entries()) {
            if (
              cell.column >= startColumn
              && cell.column <= endColumn
              && cell.row >= startRow
              && cell.row <= endRow
            ) {
              cells.delete(key);
            }
          }

          merges = merges.filter((merge) =>
            merge.endColumn < startColumn
            || merge.startColumn > endColumn
            || merge.endRow < startRow
            || merge.startRow > endRow);
        }
      }

      return {
        cells: Array.from(cells.values()).sort(
          (left, right) => left.row - right.row || left.column - right.column,
        ),
        merges,
        style,
      };
    };
    const imports = {
      env: {
        abort(messagePtr?: number, fileNamePtr?: number, line?: number, column?: number) {
          const message = decodeString(messagePtr ?? 0);
          const fileName = decodeString(fileNamePtr ?? 0);
          const location =
            typeof line === "number" && typeof column === "number"
              ? `:${line}:${column}`
              : "";

          throw new Error(
            `Indicator "${moduleRecord.entry.module}" aborted${
              fileName ? ` at ${fileName}${location}` : ""
            }${message ? `: ${message}` : ""}`,
          );
        },
      },
      orion: {
        beginBar: () => {
          this.outputs.objects = [];
        },
        bgcolor: (
          seriesIdPtr: number,
          time: number,
          colorPtr: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time)) {
            return;
          }

          const color = decodeString(colorPtr);

          if (!color.length) {
            return;
          }

          this.outputs.seriesPoints.push({
            baseStyle: {
              color,
            },
            committed: committed !== 0,
            indicatorId: this.indicator.id,
            kind: "bgcolor",
            revision: 0,
            seriesId: decodeString(seriesIdPtr),
            style: {
              color,
            },
            text: null,
            time,
            value: 0,
          });
        },
        plot: (
          seriesIdPtr: number,
          time: number,
          value: number,
          colorPtr: number,
          width: number,
          opacity: number,
          dashed: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(value)) {
            return;
          }

          this.outputs.seriesPoints.push({
            baseStyle: {
              color: decodeString(colorPtr),
              dashed: dashed !== 0,
              opacity,
              width,
            },
            committed: committed !== 0,
            indicatorId: this.indicator.id,
            kind: "plot",
            revision: 0,
            seriesId: decodeString(seriesIdPtr),
            style: {
              color: decodeString(colorPtr),
            },
            text: null,
            time,
            value,
          });
        },
        fill: (
          fillIdPtr: number,
          upperSeriesIdPtr: number,
          lowerSeriesIdPtr: number,
          colorPtr: number,
          opacity: number,
        ) => {
          this.outputs.fills.push({
            id: decodeString(fillIdPtr),
            indicatorId: this.indicator.id,
            lowerSeriesId: decodeString(lowerSeriesIdPtr),
            revision: 0,
            style: {
              color: decodeString(colorPtr),
              opacity,
            },
            upperSeriesId: decodeString(upperSeriesIdPtr),
          });
        },
        plotshape: (
          seriesIdPtr: number,
          time: number,
          value: number,
          shapePtr: number,
          colorPtr: number,
          size: number,
          offsetX: number,
          offsetY: number,
          committed: number,
          textPtr: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(value)) {
            return;
          }

          this.outputs.seriesPoints.push({
            baseStyle: {
              color: decodeString(colorPtr),
              offsetX,
              offsetY,
              shape: decodeString(shapePtr),
              size,
            },
            committed: committed !== 0,
            indicatorId: this.indicator.id,
            kind: "plotshape",
            revision: 0,
            seriesId: decodeString(seriesIdPtr),
            style: {
              color: decodeString(colorPtr),
              offsetX,
              offsetY,
              size,
            },
            text: decodeString(textPtr) || null,
            time,
            value,
          });
        },
        line: (
          objectIdPtr: number,
          time: number,
          endTime: number,
          price: number,
          endPrice: number,
          colorPtr: number,
          width: number,
          opacity: number,
          dashed: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(price)) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: Number.isFinite(endPrice) ? endPrice : null,
            endTime: Number.isFinite(endTime) ? endTime : null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "line",
            price,
            revision: 0,
            style: {
              color: decodeString(colorPtr),
              dashed: dashed !== 0,
              opacity,
              width,
            },
            text: null,
            time,
          });
        },
        linefill: (
          objectIdPtr: number,
          pointsPtr: number,
          colorPtr: number,
          opacity: number,
          committed: number,
        ) => {
          const pointsText = decodeString(pointsPtr);
          let points: Array<{ time: number; price: number }> = [];

          if (pointsText) {
            try {
              points = JSON.parse(pointsText) as Array<{ time: number; price: number }>;
            } catch {
              points = [];
            }
          }

          points = points.filter((point) =>
            Number.isFinite(point?.time) && Number.isFinite(point?.price)
          );

          const firstPoint = points[0];

          if (!firstPoint) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "linefill",
            price: firstPoint.price,
            revision: 0,
            style: {
              color: decodeString(colorPtr),
              opacity,
              points,
            },
            text: null,
            time: firstPoint.time,
          });
        },
        ray: (
          objectIdPtr: number,
          time: number,
          price: number,
          colorPtr: number,
          width: number,
          opacity: number,
          dashed: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(price)) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "ray",
            price,
            revision: 0,
            style: {
              color: decodeString(colorPtr),
              dashed: dashed !== 0,
              opacity,
              width,
            },
            text: null,
            time,
          });
        },
        box: (
          objectIdPtr: number,
          time: number,
          endTime: number,
          price: number,
          endPrice: number,
          colorPtr: number,
          backgroundColorPtr: number,
          width: number,
          opacity: number,
          dashed: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(price)) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: Number.isFinite(endPrice) ? endPrice : null,
            endTime: Number.isFinite(endTime) ? endTime : null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "box",
            price,
            revision: 0,
            style: {
              backgroundColor: decodeString(backgroundColorPtr),
              color: decodeString(colorPtr),
              dashed: dashed !== 0,
              opacity,
              width,
            },
            text: null,
            time,
          });
        },
        polyline: (
          objectIdPtr: number,
          pointsPtr: number,
          colorPtr: number,
          width: number,
          opacity: number,
          dashed: number,
          committed: number,
        ) => {
          const pointsText = decodeString(pointsPtr);
          let points: Array<{ time: number; price: number }> = [];

          if (pointsText) {
            try {
              points = JSON.parse(pointsText) as Array<{ time: number; price: number }>;
            } catch {
              points = [];
            }
          }

          points = points.filter((point) =>
            Number.isFinite(point?.time) && Number.isFinite(point?.price)
          );

          const firstPoint = points[0];

          if (!firstPoint) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "polyline",
            price: firstPoint.price,
            revision: 0,
            style: {
              color: decodeString(colorPtr),
              dashed: dashed !== 0,
              opacity,
              points,
              width,
            },
            text: null,
            time: firstPoint.time,
          });
        },
        label: (
          objectIdPtr: number,
          time: number,
          price: number,
          textPtr: number,
          colorPtr: number,
          backgroundColorPtr: number,
          fontSize: number,
          offsetX: number,
          offsetY: number,
          committed: number,
        ) => {
          if (!Number.isFinite(time) || !Number.isFinite(price)) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "label",
            price,
            revision: 0,
            style: {
              backgroundColor: decodeString(backgroundColorPtr),
              color: decodeString(colorPtr),
              fontSize,
              offsetX,
              offsetY,
            },
            text: decodeString(textPtr),
            time,
          });
        },
        panel: (
          objectIdPtr: number,
          anchorPtr: number,
          titlePtr: number,
          textPtr: number,
          colorPtr: number,
          backgroundColorPtr: number,
          accentColorPtr: number,
          fontSize: number,
          committed: number,
        ) => {
          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "panel",
            price: 0,
            revision: 0,
            style: {
              accentColor: decodeString(accentColorPtr),
              anchor: decodeString(anchorPtr),
              backgroundColor: decodeString(backgroundColorPtr),
              color: decodeString(colorPtr),
              fontSize,
              title: decodeString(titlePtr),
            },
            text: decodeString(textPtr),
            time: 0,
          });
        },
        table: (
          objectIdPtr: number,
          anchorPtr: number,
          titlePtr: number,
          textPtr: number,
          colorPtr: number,
          backgroundColorPtr: number,
          columns: number,
          rows: number,
          committed: number,
        ) => {
          const payloadText = decodeString(textPtr);
          const parsedTable = parseTablePayload(payloadText);
          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: null,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "table",
            price: 0,
            revision: 0,
            style: {
              anchor: decodeString(anchorPtr),
              backgroundColor:
                typeof parsedTable?.style.backgroundColor === "string"
                  ? parsedTable.style.backgroundColor
                  : decodeString(backgroundColorPtr),
              borderColor:
                typeof parsedTable?.style.borderColor === "string"
                  ? parsedTable.style.borderColor
                  : "",
              borderWidth:
                typeof parsedTable?.style.borderWidth === "number"
                  ? parsedTable.style.borderWidth
                  : 0,
              cells: parsedTable?.cells ?? [],
              color:
                typeof parsedTable?.style.color === "string"
                  ? parsedTable.style.color
                  : decodeString(colorPtr),
              columns,
              frameColor:
                typeof parsedTable?.style.frameColor === "string"
                  ? parsedTable.style.frameColor
                  : "",
              frameWidth:
                typeof parsedTable?.style.frameWidth === "number"
                  ? parsedTable.style.frameWidth
                  : 0,
              merges: parsedTable?.merges ?? [],
              rows,
              title: decodeString(titlePtr),
            },
            text: parsedTable ? null : payloadText,
            time: 0,
          });
        },
        candle: (
          objectIdPtr: number,
          time: number,
          open: number,
          high: number,
          low: number,
          close: number,
          colorPtr: number,
          wickColorPtr: number,
          borderColorPtr: number,
          committed: number,
          modePtr: number,
        ) => {
          if (
            !Number.isFinite(time)
            || !Number.isFinite(open)
            || !Number.isFinite(high)
            || !Number.isFinite(low)
            || !Number.isFinite(close)
          ) {
            return;
          }

          const color = decodeString(colorPtr);
          const wickColor = decodeString(wickColorPtr);
          const borderColor = decodeString(borderColorPtr);

          if (!color && !wickColor && !borderColor) {
            return;
          }

          this.outputs.objects.push({
            committed: committed !== 0,
            endPrice: high,
            endTime: null,
            id: decodeString(objectIdPtr),
            indicatorId: this.indicator.id,
            kind: "candle",
            price: low,
            revision: 0,
            style: {
              borderColor,
              close,
              color,
              high,
              low,
              mode: decodeString(modePtr) || "candle",
              open,
              wickColor,
            },
            text: null,
            time,
          });
        },
        signal: (
          signalIdPtr: number,
          sidePtr: number,
          time: number,
          price: number,
          stopLoss: number,
          takeProfit: number,
          messagePtr: number,
          committed: number,
          payloadPtr: number,
        ) => {
          this.outputs.signals.push({
            committed: committed !== 0,
            id: decodeString(signalIdPtr),
            indicatorId: this.indicator.id,
            message: decodeString(messagePtr),
            payload: decodePayload(payloadPtr),
            price,
            revision: 0,
            side: decodeString(sidePtr) as IndicatorSignal["side"],
            stopLoss,
            takeProfit,
            time,
          });
        },
        alert: (
          alertIdPtr: number,
          titlePtr: number,
          messagePtr: number,
          time: number,
          price: number,
          committed: number,
          payloadPtr: number,
        ) => {
          this.outputs.alerts.push({
            committed: committed !== 0,
            id: decodeString(alertIdPtr),
            indicatorId: this.indicator.id,
            message: decodeString(messagePtr),
            payload: decodePayload(payloadPtr),
            price,
            revision: 0,
            time,
            title: decodeString(titlePtr),
          });
        },
        inputBool: (keyPtr: number, defaultValue: number) => {
          const key = decodeString(keyPtr);
          const fallback = defaultValue !== 0;

          return coerceBoolean(this.indicator.params[key], fallback) ? 1 : 0;
        },
        inputInt: (keyPtr: number, defaultValue: number) => {
          const key = decodeString(keyPtr);
          const rawValue = this.indicator.params[key];

          if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            return Math.round(rawValue);
          }

          if (typeof rawValue === "string" && rawValue.trim().length) {
            const parsed = Number(rawValue);

            if (Number.isFinite(parsed)) {
              return Math.round(parsed);
            }
          }

          return defaultValue;
        },
        inputNumber: (keyPtr: number, defaultValue: number) => {
          const key = decodeString(keyPtr);
          const rawValue = this.indicator.params[key];

          if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
            return rawValue;
          }

          if (typeof rawValue === "string" && rawValue.trim().length) {
            const parsed = Number(rawValue);

            if (Number.isFinite(parsed)) {
              return parsed;
            }
          }

          return defaultValue;
        },
        inputString: (keyPtr: number, defaultPtr: number) => {
          const key = decodeString(keyPtr);
          const defaultValue = decodeString(defaultPtr);
          const rawValue = this.indicator.params[key];

          if (typeof rawValue === "string") {
            return encodeString(rawValue);
          }

          if (typeof rawValue === "number" || typeof rawValue === "boolean") {
            return encodeString(String(rawValue));
          }

          return encodeString(defaultValue);
        },
        runtimePipSize: () => this.runtimeInfo.pipSize,
        runtimeSymbol: () => encodeString(this.runtimeInfo.symbol),
        runtimeTimeframeMs: () => this.runtimeInfo.timeframeMs,
      },
    };

    const nextRuntime = await instantiate<IndicatorWasmExports>(
      moduleRecord.bytes,
      imports,
    );

    runtimeExports = nextRuntime.exports;
    this.assertRuntimeExports(moduleRecord.entry, nextRuntime.exports);
    this.exports = nextRuntime.exports;
  }

  private assertRuntimeExports(
    entry: IndicatorManifestEntry,
    exports: Partial<ASUtil & IndicatorWasmExports>,
  ) {
    const requiredExports = [
      "__collect",
      "__getString",
      "__newString",
      "__pin",
      "__unpin",
      "describe",
      "init",
      "loadState",
      "onBar",
      "reset",
      "saveState",
    ] satisfies (keyof (ASUtil & IndicatorWasmExports))[];

    for (const requiredExport of requiredExports) {
      if (requiredExport in exports && exports[requiredExport]) {
        continue;
      }

      throw new Error(
        `Indicator module "${entry.module}" is missing export "${requiredExport.toString()}"`,
      );
    }
  }
}

function normalizeBooleanDefault(
  field: IndicatorInputField,
): boolean {
  return field.defaultValue === true;
}

function cloneSessionOutputs(
  outputs: IndicatorSessionOutputs,
): IndicatorSessionOutputs {
  return {
    alerts: outputs.alerts.map((alert) => ({
      ...alert,
      payload: alert.payload ? { ...alert.payload } : null,
    })),
    fills: outputs.fills.map((fill) => ({
      ...fill,
      style: { ...fill.style },
    })),
    objects: outputs.objects.map((object) => ({
      ...object,
      style: { ...object.style },
    })),
    seriesPoints: outputs.seriesPoints.map((point) => ({
      ...point,
      baseStyle: { ...point.baseStyle },
      style: { ...point.style },
    })),
    signals: outputs.signals.map((signal) => ({
      ...signal,
      payload: signal.payload ? { ...signal.payload } : null,
    })),
  };
}

function resolveIndicatorParams(
  fields: IndicatorInputField[],
  params: Record<string, unknown>,
) {
  const resolvedParams: Record<string, unknown> = {};

  for (const field of fields) {
    const providedValue = params[field.key];

    if (field.type === "boolean") {
      resolvedParams[field.key] =
        typeof providedValue === "boolean"
          ? providedValue
          : normalizeBooleanDefault(field);
      continue;
    }

    if (field.type === "integer") {
      const parsed = parseNumericInput(providedValue, field.defaultValue);

      resolvedParams[field.key] = clampNumericField(
        field,
        Math.round(parsed),
      );
      continue;
    }

    if (field.type === "number") {
      const parsed = parseNumericInput(providedValue, field.defaultValue);

      resolvedParams[field.key] = clampNumericField(field, parsed);
      continue;
    }

    if (field.type === "select") {
      const defaultValue = field.defaultValue;
      const allowedValues = field.choices?.map((choice) => choice.value) ?? [];

      resolvedParams[field.key] = allowedValues.some(
        (choiceValue) => choiceValue === providedValue,
      )
        ? providedValue
        : defaultValue;
      continue;
    }

    resolvedParams[field.key] =
      typeof providedValue === "string" && providedValue.length
        ? providedValue
        : field.defaultValue;
  }

  return resolvedParams;
}

function parseNumericInput(
  providedValue: unknown,
  defaultValue: IndicatorInputField["defaultValue"],
) {
  if (typeof providedValue === "number" && Number.isFinite(providedValue)) {
    return providedValue;
  }

  if (typeof providedValue === "string" && providedValue.trim().length) {
    const parsed = Number(providedValue);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return typeof defaultValue === "number" ? defaultValue : 0;
}

function clampNumericField(field: IndicatorInputField, value: number) {
  let nextValue = value;

  if (typeof field.min === "number") {
    nextValue = Math.max(field.min, nextValue);
  }

  if (typeof field.max === "number") {
    nextValue = Math.min(field.max, nextValue);
  }

  return nextValue;
}
