// Ported verbatim from orion src/library/models/chart/components/scene/scene-commands.ts
// (only the type-import path changed).

import type {
  IndicatorTableCell,
  IndicatorTableMerge,
} from "@fxtoolkit/indicator-stdlib/abi";

export interface SceneTextDrawCommand {
  align?: "center" | "left" | "right";
  backgroundColor: string;
  color: string;
  fontSize: number;
  opacity: number;
  text: string;
  x: number;
  y: number;
}

export interface ScenePanelDrawCommand {
  accentColor: string;
  anchor: string;
  backgroundColor: string;
  borderColor?: string;
  borderWidth?: number;
  cells?: IndicatorTableCell[];
  color: string;
  columns?: number;
  fontSize: number;
  frameColor?: string;
  frameWidth?: number;
  kind: "panel" | "table";
  merges?: IndicatorTableMerge[];
  opacity: number;
  rows?: number;
  text: string;
  title: string;
}
