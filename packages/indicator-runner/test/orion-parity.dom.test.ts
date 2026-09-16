import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChartBar, IndicatorManifest } from "@fxtoolkit/indicator-stdlib/abi";
import {
  createChartFrame,
  createStaticModuleSource,
  createViewport,
  IndicatorCanvasRenderer,
  IndicatorRuntime,
  SceneWebGLCompositor,
  type ChartRenderFrame,
} from "@fxtoolkit/indicator-runner";
import {
  runScenarios,
  type ParityScenario as Scenario,
  type ParityScenarioResult as ScenarioResult,
} from "../../../tools/orion-parity/scenario-runner.mjs";
import { installCanvasContextStub } from "./support/fake-canvas";
import { createRecordingWebGLCanvas } from "./support/fake-webgl";
import {
  createGoldenEngineHarness,
  findBundle,
  type GoldenEngineHarness,
} from "./support/golden-engine";
import { MODULES, readGoldenBytes, readGoldenManifest } from "./support/indicator-fixtures";

const PROJECT_ROOT = resolve(process.cwd());
const PARITY_DIRECTORY = resolve(PROJECT_ROOT, "fixtures/parity");
const ORION_RESULTS = resolve(PARITY_DIRECTORY, "orion");
const REPORT_DIRECTORY = resolve(PROJECT_ROOT, "parity-report");

interface ReportEntry {
  id: string;
  module: string;
  paramsMatch: boolean;
  steps: Array<{ kind: string; outputsMatch: boolean; savedStateMatch: boolean }>;
}

interface RenderEntry {
  canvasDigest: string;
  match: boolean;
  module: string;
  webglDigest: string;
}

const report = {
  execution: [] as ReportEntry[],
  render: [] as RenderEntry[],
};

/**
 * Loaded at module scope, not in `beforeAll`: `it.each` builds its cases during collection, before
 * any hook runs.
 */
const scenarios: Scenario[] = (
  JSON.parse(
    await readFile(resolve(PARITY_DIRECTORY, "scenarios.json"), "utf8"),
  ) as { scenarios: Scenario[] }
).scenarios;

const bars: ChartBar[] = (
  JSON.parse(
    await readFile(resolve(PROJECT_ROOT, "fixtures/golden/bar-batch.json"), "utf8"),
  ) as { data: { ticks: ChartBar[] } }
).data.ticks;

let restoreCanvasContext: () => void;

function digest(data: Float32Array) {
  return createHash("sha256")
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest("hex")
    .slice(0, 16);
}

/**
 * M10 — the pre-swap gate.
 *
 * Both sides execute `tools/orion-parity/scenario-runner.mjs` against their own runtime over the
 * same declarative scenarios. Orion's results were captured by running that runner inside Orion
 * (see `tools/orion-parity/README.md`); this replays them through our runtime and diffs.
 *
 * It compares **behaviour**, never bytes: the golden binaries are not reproducible from Orion's
 * current sources, so a byte comparison would be meaningless.
 */
describe("orion parity — execution", () => {
  let ourResults: Record<string, ScenarioResult>;
  let orionResults: Record<string, ScenarioResult>;

  beforeAll(async () => {
    const manifest: IndicatorManifest = await readGoldenManifest();
    const bytes = new Map<string, Uint8Array>();
    for (const entry of manifest.indicators) {
      bytes.set(entry.module, await readGoldenBytes(entry));
    }

    ourResults = await runScenarios({
      bars,
      runtime: new IndicatorRuntime(createStaticModuleSource({ bytes, manifest })),
      scenarios,
    });

    orionResults = {};
    for (const scenario of scenarios) {
      orionResults[scenario.id] = JSON.parse(
        await readFile(resolve(ORION_RESULTS, `${scenario.id}.json`), "utf8"),
      ) as ScenarioResult;
    }
  }, 120_000);

  it("has an Orion result for every scenario", () => {
    expect(Object.keys(orionResults).sort()).toEqual(
      scenarios.map((scenario) => scenario.id).sort(),
    );
    expect(scenarios.length).toBe(16);
  });

  it("resolves identical params for every scenario", () => {
    for (const scenario of scenarios) {
      const ours = ourResults[scenario.id];
      const theirs = orionResults[scenario.id];

      expect(ours.params, `${scenario.id} params`).toEqual(theirs.params);
    }
  });

  it.each(scenarios.map((scenario) => scenario.id))(
    "matches Orion step for step: %s",
    (id) => {
      const ours = ourResults[id];
      const theirs = orionResults[id];

      expect(ours.steps.length, `${id} step count`).toBe(theirs.steps.length);

      const entry: ReportEntry = {
        id,
        module: scenarios.find((scenario) => scenario.id === id)!.module,
        paramsMatch: true,
        steps: [],
      };

      ours.steps.forEach((step, index) => {
        const reference = theirs.steps[index];
        const outputsMatch = JSON.stringify(step.outputs) === JSON.stringify(reference.outputs);
        const savedStateMatch = step.savedState === reference.savedState;

        entry.steps.push({ kind: step.kind, outputsMatch, savedStateMatch });

        expect(
          step.outputs,
          `${id} step ${index} (${step.kind}) outputs`,
        ).toEqual(reference.outputs);
        expect(
          step.savedState,
          `${id} step ${index} (${step.kind}) savedState`,
        ).toBe(reference.savedState);
      });

      report.execution.push(entry);
    },
    60_000,
  );
});

describe("orion parity — render backends", () => {
  let harness: GoldenEngineHarness;
  let frame: ChartRenderFrame;

  beforeAll(async () => {
    restoreCanvasContext = installCanvasContextStub();
    harness = await createGoldenEngineHarness(MODULES);

    frame = createChartFrame({
      bars: harness.bars,
      plotHeight: 500,
      plotWidth: 900,
      viewport: createViewport(120, 0),
    });
  });

  afterAll(() => {
    harness.destroy();
    restoreCanvasContext();
  });

  it.each([...MODULES])("both backends agree for %s", (module) => {
    const canvasCanvas = document.createElement("canvas");
    Object.defineProperty(canvasCanvas, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(canvasCanvas, "clientHeight", { configurable: true, value: 500 });

    const webglCanvas = createRecordingWebGLCanvas({ height: 500, width: 900 });
    const canvasRenderer = new IndicatorCanvasRenderer({
      canvas: canvasCanvas,
      pixelRatio: 1,
    });
    const webglRenderer = new SceneWebGLCompositor({
      canvas: webglCanvas.canvas,
      pixelRatio: 1,
    });

    const bundle = findBundle(harness, module);
    canvasRenderer.setBundles([bundle]);
    webglRenderer.setBundles([bundle]);
    canvasRenderer.render(frame);
    webglRenderer.render(frame);

    const canvasGeometry = canvasRenderer.getLayerGeometry(bundle.id)!;
    const webglGeometry = webglRenderer.getLayerGeometry(bundle.id)!;

    const canvasDigest = digest(canvasGeometry.triangleData);
    const webglDigest = digest(webglGeometry.triangleData);

    expect(webglDigest, `${module} triangle digest`).toBe(canvasDigest);
    expect(webglGeometry.pointData).toEqual(canvasGeometry.pointData);

    report.render.push({
      canvasDigest,
      match: webglDigest === canvasDigest,
      module,
      webglDigest,
    });

    canvasRenderer.destroy();
    webglRenderer.destroy();
  }, 30_000);
});

afterAll(async () => {
  const executionMatching = report.execution.filter(
    (entry) =>
      entry.paramsMatch && entry.steps.every((step) => step.outputsMatch && step.savedStateMatch),
  ).length;
  const renderMatching = report.render.filter((entry) => entry.match).length;

  const summary = {
    execution: { matching: executionMatching, total: report.execution.length },
    render: { matching: renderMatching, total: report.render.length },
    scenarios: scenarios?.length ?? 0,
  };

  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(
    resolve(REPORT_DIRECTORY, "report.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, ...report }, null, 2)}\n`,
  );

  const lines = [
    "# Orion parity report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Both sides ran `tools/orion-parity/scenario-runner.mjs` against their own runtime over the",
    "same declarative scenarios. Comparison is behavioural — never byte-level, because the golden",
    "binaries are not reproducible from Orion's current sources.",
    "",
    `## Execution: ${summary.execution.matching}/${summary.execution.total} scenarios match`,
    "",
    "| Scenario | Params | Steps | Outputs | savedState |",
    "| --- | --- | --- | --- | --- |",
    ...report.execution.map((entry) => {
      const outputs = entry.steps.every((step) => step.outputsMatch) ? "ok" : "**DIFF**";
      const state = entry.steps.every((step) => step.savedStateMatch) ? "ok" : "**DIFF**";
      return `| \`${entry.id}\` | ${entry.paramsMatch ? "ok" : "**DIFF**"} | ${entry.steps.length} | ${outputs} | ${state} |`;
    }),
    "",
    `## Render backends: ${summary.render.matching}/${summary.render.total} modules agree`,
    "",
    "| Module | WebGL digest | Canvas2D digest | Match |",
    "| --- | --- | --- | --- |",
    ...report.render.map(
      (entry) =>
        `| \`${entry.module}\` | \`${entry.webglDigest}\` | \`${entry.canvasDigest}\` | ${entry.match ? "ok" : "**DIFF**"} |`,
    ),
    "",
  ];

  await writeFile(resolve(REPORT_DIRECTORY, "report.md"), lines.join("\n"));
});
