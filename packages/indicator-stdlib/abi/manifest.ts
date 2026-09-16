/**
 * Indicator compile/load manifest types.
 *
 * Ported from orion `src/library/models/chart/indicators/indicator-runtime-types.ts`.
 */

import type {
  IndicatorModule,
  IndicatorDescriptor,
} from "./chart";

export interface IndicatorCompileDiagnostic {
  column?: number;
  level: "error" | "warning" | "info";
  line?: number;
  message: string;
}

export interface IndicatorManifestEntry {
  abiVersion: number;
  diagnostics?: IndicatorCompileDiagnostic[];
  descriptor: IndicatorDescriptor;
  generatedSourcePath?: string;
  module: IndicatorModule;
  sourceLanguage?: "assemblyscript" | "pine";
  wasmUrl: string;
}

export interface IndicatorManifest {
  indicators: IndicatorManifestEntry[];
}
