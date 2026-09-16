// Ported verbatim from orion src/library/models/chart/components/scene/scene-command-utils.ts
// (only the import paths changed).

import type {
  IndicatorTableCell,
  IndicatorTableMerge,
} from "@fxtoolkit/indicator-stdlib/abi";
import type { ChartRenderFrame } from "../model/types";
import type { ScenePanelDrawCommand } from "./scene-commands";

export function getPanelAnchorPosition(
  anchor: string,
  plotWidth: number,
  plotHeight: number,
  width: number,
  height: number,
  margin: number,
) {
  switch (anchor) {
    case "top-left":
      return { x: margin, y: margin };
    case "top-center":
      return {
        x: Math.max(margin, (plotWidth - width) / 2),
        y: margin,
      };
    case "bottom-left":
      return { x: margin, y: Math.max(margin, plotHeight - height - margin) };
    case "bottom-center":
      return {
        x: Math.max(margin, (plotWidth - width) / 2),
        y: Math.max(margin, plotHeight - height - margin),
      };
    case "bottom-right":
      return {
        x: Math.max(margin, plotWidth - width - margin),
        y: Math.max(margin, plotHeight - height - margin),
      };
    case "middle-left":
      return {
        x: margin,
        y: Math.max(margin, (plotHeight - height) / 2),
      };
    case "middle-center":
      return {
        x: Math.max(margin, (plotWidth - width) / 2),
        y: Math.max(margin, (plotHeight - height) / 2),
      };
    case "middle-right":
      return {
        x: Math.max(margin, plotWidth - width - margin),
        y: Math.max(margin, (plotHeight - height) / 2),
      };
    case "top-right":
    default:
      return {
        x: Math.max(margin, plotWidth - width - margin),
        y: margin,
      };
  }
}

export function ensureSpanExtent(
  values: number[],
  startIndex: number,
  span: number,
  requiredTotal: number,
) {
  if (!Number.isFinite(requiredTotal) || requiredTotal <= 0 || span <= 0) {
    return;
  }

  const endIndex = Math.min(values.length, startIndex + span);
  const currentTotal = values
    .slice(startIndex, endIndex)
    .reduce((sum, value) => sum + value, 0);

  if (currentTotal >= requiredTotal) {
    return;
  }

  const extraPerSlot = Math.ceil((requiredTotal - currentTotal) / Math.max(1, endIndex - startIndex));

  for (let index = startIndex; index < endIndex; index += 1) {
    values[index] += extraPerSlot;
  }
}

export function normalizeTableCells(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: IndicatorTableCell[] = [];

  for (const cell of value) {
    if (!cell || typeof cell !== "object") {
      continue;
    }

    const candidate = cell as Record<string, unknown>;
    const column = typeof candidate.column === "number" ? candidate.column : NaN;
    const row = typeof candidate.row === "number" ? candidate.row : NaN;

    if (!Number.isFinite(column) || !Number.isFinite(row)) {
      continue;
    }

    normalized.push({
      backgroundColor:
        typeof candidate.backgroundColor === "string" ? candidate.backgroundColor : undefined,
      column,
      height:
        typeof candidate.height === "number" && Number.isFinite(candidate.height)
          ? candidate.height
          : undefined,
      row,
      text: typeof candidate.text === "string" ? candidate.text : "",
      textColor: typeof candidate.textColor === "string" ? candidate.textColor : undefined,
      textHAlign: typeof candidate.textHAlign === "string" ? candidate.textHAlign : undefined,
      textSize:
        typeof candidate.textSize === "number" && Number.isFinite(candidate.textSize)
          ? candidate.textSize
          : undefined,
      textVAlign: typeof candidate.textVAlign === "string" ? candidate.textVAlign : undefined,
      width:
        typeof candidate.width === "number" && Number.isFinite(candidate.width)
          ? candidate.width
          : undefined,
    });
  }

  return normalized;
}

export function normalizeTableMerges(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: IndicatorTableMerge[] = [];

  for (const merge of value) {
    if (!merge || typeof merge !== "object") {
      continue;
    }

    const candidate = merge as Record<string, unknown>;
    const startColumn = typeof candidate.startColumn === "number" ? candidate.startColumn : NaN;
    const startRow = typeof candidate.startRow === "number" ? candidate.startRow : NaN;
    const endColumn = typeof candidate.endColumn === "number" ? candidate.endColumn : NaN;
    const endRow = typeof candidate.endRow === "number" ? candidate.endRow : NaN;

    if (
      !Number.isFinite(startColumn)
      || !Number.isFinite(startRow)
      || !Number.isFinite(endColumn)
      || !Number.isFinite(endRow)
    ) {
      continue;
    }

    normalized.push({
      endColumn,
      endRow,
      startColumn,
      startRow,
    });
  }

  return normalized;
}

export function computeTableLayout(
  command: Pick<ScenePanelDrawCommand, "anchor" | "cells" | "color" | "columns" | "fontSize" | "merges" | "rows">,
  frame: ChartRenderFrame,
  devicePixelRatio: number,
  scratchContext: CanvasRenderingContext2D,
) {
  const cells = Array.isArray(command.cells) ? command.cells : [];
  const merges = Array.isArray(command.merges) ? command.merges : [];
  const columns = Math.max(1, Math.round(command.columns ?? 1));
  const rows = Math.max(1, Math.round(command.rows ?? 1));
  const mergeMap = new Map(
    merges.map((merge) => [`${merge.startColumn}:${merge.startRow}`, merge]),
  );
  const coveredCells = new Set<string>();

  for (const merge of merges) {
    for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
      for (let row = merge.startRow; row <= merge.endRow; row += 1) {
        if (column === merge.startColumn && row === merge.startRow) {
          continue;
        }

        coveredCells.add(`${column}:${row}`);
      }
    }
  }

  const visibleCells = cells
    .filter((cell) =>
      cell.column >= 0
      && cell.column < columns
      && cell.row >= 0
      && cell.row < rows
      && !coveredCells.has(`${cell.column}:${cell.row}`))
    .sort((left, right) => left.row - right.row || left.column - right.column);

  if (!visibleCells.length) {
    return null;
  }

  const outerPadding = Math.max(1, Math.round(2 * devicePixelRatio));
  const horizontalPadding = Math.max(1, Math.round(8 * devicePixelRatio));
  const verticalPadding = Math.max(1, Math.round(6 * devicePixelRatio));
  const lineGap = Math.max(1, Math.round(2 * devicePixelRatio));
  const columnWidths = Array.from({ length: columns }, () =>
    Math.max(1, Math.round(42 * devicePixelRatio)));
  const rowHeights = Array.from({ length: rows }, () =>
    Math.max(1, Math.round(22 * devicePixelRatio)));
  const preparedCells = visibleCells.map((cell) => {
    const merge = mergeMap.get(`${cell.column}:${cell.row}`);
    const columnSpan = Math.max(1, (merge?.endColumn ?? cell.column) - cell.column + 1);
    const rowSpan = Math.max(1, (merge?.endRow ?? cell.row) - cell.row + 1);
    const fontSize = Math.max(1, Number(cell.textSize ?? command.fontSize ?? 10));
    const textSize = Math.max(1, Math.round(fontSize * devicePixelRatio));
    const font = `${textSize}px Arial`;
    const lines = (cell.text ?? "").split("\n");
    const metrics = measureTextLines(scratchContext, lines, font);
    const explicitWidth = Number.isFinite(cell.width)
      ? Math.max(1, Math.round(frame.plotWidth * (cell.width ?? 0) * devicePixelRatio / 100))
      : 0;
    const explicitHeight = Number.isFinite(cell.height)
      ? Math.max(1, Math.round(frame.plotHeight * (cell.height ?? 0) * devicePixelRatio / 100))
      : 0;
    const requiredWidth = explicitWidth
      || Math.max(1, Math.ceil(metrics.width + horizontalPadding * 2));
    const requiredHeight = explicitHeight
      || Math.max(
        1,
        Math.ceil(
          metrics.lineHeight * lines.length
          + lineGap * Math.max(lines.length - 1, 0)
          + verticalPadding * 2,
        ),
      );

    ensureSpanExtent(columnWidths, cell.column, columnSpan, requiredWidth);
    ensureSpanExtent(rowHeights, cell.row, rowSpan, requiredHeight);

    return {
      backgroundColor:
        typeof cell.backgroundColor === "string" && cell.backgroundColor.length
          ? cell.backgroundColor
          : "rgba(0, 0, 0, 0)",
      columnSpan,
      fontSize,
      lines,
      metrics,
      rowSpan,
      source: cell,
      textColor:
        typeof cell.textColor === "string" && cell.textColor.length
          ? cell.textColor
          : command.color,
      textHAlign: normalizeTableAlign(cell.textHAlign, "center"),
      textVAlign: normalizeTableAlign(cell.textVAlign, "middle"),
    };
  });

  const width = Math.max(1, columnWidths.reduce((sum, value) => sum + value, 0) + outerPadding * 2);
  const height = Math.max(1, rowHeights.reduce((sum, value) => sum + value, 0) + outerPadding * 2);
  const columnOffsets = [outerPadding];
  const rowOffsets = [outerPadding];

  for (let index = 0; index < columns; index += 1) {
    columnOffsets.push(columnOffsets[index] + columnWidths[index]);
  }

  for (let index = 0; index < rows; index += 1) {
    rowOffsets.push(rowOffsets[index] + rowHeights[index]);
  }

  const renderCells = preparedCells.map((cell) => {
    const left = columnOffsets[cell.source.column];
    const top = rowOffsets[cell.source.row];
    const right = columnOffsets[cell.source.column + cell.columnSpan];
    const bottom = rowOffsets[cell.source.row + cell.rowSpan];
    const textBlockHeight = cell.metrics.lineHeight * cell.lines.length
      + lineGap * Math.max(cell.lines.length - 1, 0);
    const textTop = getAlignedTextTopY(
      top,
      bottom,
      verticalPadding,
      textBlockHeight,
      cell.textVAlign,
    );

    return {
      backgroundColor: cell.backgroundColor,
      bottom,
      left,
      lines: cell.lines,
      right,
      textColor: cell.textColor,
      textHAlign: cell.textHAlign,
      textTop,
      top,
      fontSize: cell.fontSize,
    };
  });

  return {
    anchor: command.anchor,
    columns,
    height,
    horizontalPadding,
    merges,
    renderCells,
    rows,
    width,
  };
}

export function normalizeTableAlign(
  value: string | undefined,
  fallback: "center" | "left" | "middle" | "right" | "top" | "bottom",
) {
  if (value === "left" || value === "right" || value === "center" || value === "top" || value === "bottom" || value === "middle") {
    return value;
  }

  return fallback;
}

export function normalizeHorizontalTextAlign(value: string) {
  switch (value) {
    case "left":
      return "left";
    case "right":
      return "right";
    case "center":
    default:
      return "center";
  }
}

export function getAlignedTextTopY(
  top: number,
  bottom: number,
  padding: number,
  blockHeight: number,
  align: string,
) {
  if (align === "top") {
    return top + padding;
  }

  if (align === "bottom") {
    return bottom - padding - blockHeight;
  }

  return top + Math.max(0, (bottom - top - blockHeight) / 2);
}

export function measureTextLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  font: string,
) {
  context.save();
  context.font = font;

  const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const resolvedFontSize = fontSizeMatch ? Number(fontSizeMatch[1]) : 10;
  const sampleMetrics = context.measureText("M");
  const fallbackAscent = sampleMetrics.actualBoundingBoxAscent || resolvedFontSize * 0.8;
  const fallbackDescent = sampleMetrics.actualBoundingBoxDescent || resolvedFontSize * 0.2;
  let width = 0;
  let ascent = 0;
  let descent = 0;

  for (const line of lines) {
    const measureTarget = line.length ? line : " ";
    const metrics = context.measureText(measureTarget);

    width = Math.max(width, line.length ? metrics.width : 0);
    ascent = Math.max(
      ascent,
      metrics.actualBoundingBoxAscent || fallbackAscent,
    );
    descent = Math.max(
      descent,
      metrics.actualBoundingBoxDescent || fallbackDescent,
    );
  }

  context.restore();

  const resolvedAscent = ascent || fallbackAscent;
  const resolvedDescent = descent || fallbackDescent;

  return {
    ascent: resolvedAscent,
    descent: resolvedDescent,
    lineHeight: Math.max(resolvedFontSize, Math.ceil(resolvedAscent + resolvedDescent)),
    width,
  };
}
