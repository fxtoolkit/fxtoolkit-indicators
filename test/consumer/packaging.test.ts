import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ABI_VERSION } from "@fxtoolkit/indicator-stdlib/abi";
import { compileScript } from "@fxtoolkit/indicator-stdlib/compiler";
import {
  createStaticModuleSource,
  mountIndicatorSurface,
  IndicatorRuntime,
  type ChartBar,
  type IndicatorRenderBundle,
} from "@fxtoolkit/indicator-runner";
import { installCanvasContextStub } from "../../packages/indicator-runner/test/support/fake-canvas";

const MODULE = "lumina-trend-channels";
const STDLIB_ROOT = resolve(process.cwd(), "node_modules/@fxtoolkit/indicator-stdlib");
const RUNNER_ROOT = resolve(process.cwd(), "node_modules/@fxtoolkit/indicator-runner");

/**
 * M9 gate: exercise the packages the way a consumer does — resolved by package name through
 * `node_modules` and `package.json#exports` to built `dist` output, never through source.
 *
 * The main suite runs against source (via tsconfig/vitest aliases), so it cannot catch a missing
 * build artifact or a wrong `exports` entry. This can.
 */
describe("packaging", () => {
  it("resolves both packages from their built output", async () => {
    const stdlibManifest = JSON.parse(
      await readFile(resolve(STDLIB_ROOT, "package.json"), "utf8"),
    ) as { exports: Record<string, unknown>; version: string };
    const runnerManifest = JSON.parse(
      await readFile(resolve(RUNNER_ROOT, "package.json"), "utf8"),
    ) as {
      exports: Record<string, { import?: string }>;
      peerDependencies: Record<string, string>;
      version: string;
    };

    // Every declared export subpath must actually exist on disk.
    expect(Object.keys(stdlibManifest.exports).sort()).toEqual([
      "./abi",
      "./compiler",
      "./compiler/browser",
      "./package.json",
    ]);

    // The browser compiler is a distinct artifact that must not be pulled in by the barrel.
    expect(
      existsSync(resolve(STDLIB_ROOT, "dist/compiler/browser.js")),
      "browser compiler artifact",
    ).toBe(true);

    for (const [subpath, target] of Object.entries(runnerManifest.exports)) {
      if (subpath === "./package.json") continue;
      expect(existsSync(resolve(RUNNER_ROOT, target.import!)), subpath).toBe(true);
    }

    expect(
      existsSync(resolve(RUNNER_ROOT, "dist/engine/worker.js")),
      "worker entry artifact",
    ).toBe(true);
  });

  it("declares a matching peer dependency on the stdlib", async () => {
    const runnerManifest = JSON.parse(
      await readFile(resolve(RUNNER_ROOT, "package.json"), "utf8"),
    ) as { peerDependencies: Record<string, string>; version: string };
    const stdlibManifest = JSON.parse(
      await readFile(resolve(STDLIB_ROOT, "package.json"), "utf8"),
    ) as { version: string };

    expect(stdlibManifest.version).toBe(runnerManifest.version);
    expect(runnerManifest.peerDependencies["@fxtoolkit/indicator-stdlib"]).toBeDefined();
  });
});

describe("consumer end-to-end", () => {
  let source: string;

  beforeAll(async () => {
    installCanvasContextStub();
    source = await readFile(
      resolve(process.cwd(), "fixtures/indicators", `${MODULE}.ts`),
      "utf8",
    );
  });

  it("compiles a script with the packaged compiler", async () => {
    const compiled = await compileScript(source, { module: MODULE });

    expect(compiled.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(compiled.wasm!.length).toBeGreaterThan(0);
  }, 60_000);

  it("runs the compiled module and matches the parity oracle", async () => {
    const compiled = await compileScript(source, { module: MODULE });
    const oracle = JSON.parse(
      await readFile(
        resolve(process.cwd(), "fixtures/golden/expected-history", `${MODULE}.json`),
        "utf8",
      ),
    ) as { outputs: unknown; runtimeInfo: { pipSize: number; symbol: string; timeframeMs: number }; savedState: string };

    const bars = (
      JSON.parse(
        await readFile(resolve(process.cwd(), "fixtures/golden/bar-batch.json"), "utf8"),
      ) as { data: { ticks: ChartBar[] } }
    ).data.ticks;

    const runtime = new IndicatorRuntime(
      createStaticModuleSource({
        bytes: new Map([[MODULE, compiled.wasm!]]),
        manifest: {
          indicators: [
            {
              abiVersion: ABI_VERSION,
              descriptor: compiled.descriptor!,
              module: MODULE,
              wasmUrl: "unused",
            },
          ],
        },
      }),
    );

    const indicator = await runtime.resolveIndicator({ module: MODULE });
    const session = await runtime.createSession(indicator, oracle.runtimeInfo);

    try {
      expect(session.processHistoryBars(bars)).toEqual(oracle.outputs);
      expect(session.saveState()).toBe(oracle.savedState);
    } finally {
      session.destroy();
    }
  }, 60_000);

  it("renders through the mounting API into a container", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 400 });
    document.body.appendChild(container);

    // A hand-built bundle: the point here is packaging, not indicator fidelity.
    const bundle: IndicatorRenderBundle = {
      alerts: [],
      descriptor: {
        inputs: [],
        module: "smoke",
        outputKinds: ["plot"],
        title: "Smoke",
        version: "1.0.0",
      },
      fills: [],
      id: "smoke",
      module: "smoke",
      objects: [],
      series: [
        {
          id: "smoke-line",
          indicatorId: "smoke",
          kind: "plot",
          points: [
            { committed: true, revision: 0, style: { color: "#00e676" }, text: null, time: 1_700_000_000_000, value: 100 },
            { committed: true, revision: 0, style: { color: "#00e676" }, text: null, time: 1_700_086_400_000, value: 110 },
            { committed: true, revision: 0, style: { color: "#00e676" }, text: null, time: 1_700_172_800_000, value: 105 },
          ],
          style: { color: "#00e676", width: 2, opacity: 1, dashed: false },
        },
      ],
      signals: [],
    };

    const bars = [
      { close: 105, high: 112, low: 98, open: 100, time: 1_700_000_000_000 },
      { close: 110, high: 115, low: 104, open: 105, time: 1_700_086_400_000 },
      { close: 105, high: 118, low: 101, open: 110, time: 1_700_172_800_000 },
    ];

    const surface = mountIndicatorSurface(container, { prefer: "canvas" });

    try {
      surface.setBars(bars);
      surface.setBundles([bundle]);
      surface.renderNow();

      expect(container.querySelectorAll("canvas")).toHaveLength(1);
      expect(surface.getBackend()).toBe("canvas");
      expect(surface.getFrame()).not.toBeNull();
      expect(surface.getPerformanceSnapshot().geometryRebuilds).toBeGreaterThan(0);
    } finally {
      surface.destroy();
    }

    expect(container.querySelectorAll("canvas")).toHaveLength(0);
  });
});
