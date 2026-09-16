// Type surface for `scenario-runner.mjs`, which is deliberately plain JS so Orion can import it
// without a build step.

export interface ParityScenarioStep {
  bar?: unknown;
  barCount?: number;
  commit?: boolean;
  kind: string;
}

export interface ParityScenario {
  barCount: number;
  id: string;
  module: string;
  params?: Record<string, unknown>;
  runtimeInfo: {
    pipSize: number;
    symbol: string;
    timeframeMs: number;
  };
  steps: ParityScenarioStep[];
}

export interface ParityStepResult {
  barCount?: number;
  committed?: boolean;
  kind: string;
  outputs: unknown;
  savedState: string;
}

export interface ParityScenarioResult {
  params: Record<string, unknown>;
  steps: ParityStepResult[];
}

export declare function runScenarios(input: {
  runtime: unknown;
  scenarios: ParityScenario[];
  bars: unknown[];
}): Promise<Record<string, ParityScenarioResult>>;
