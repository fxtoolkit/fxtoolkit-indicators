import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ABI_VERSION,
  type IndicatorManifest,
  type IndicatorManifestEntry,
} from "@fxtoolkit/indicator-stdlib/abi";
import {
  compileScript,
  type CompileScriptOptions,
  type CompileScriptResult,
} from "@fxtoolkit/indicator-stdlib/compiler";
import {
  createStaticModuleSource,
  IndicatorRuntime,
} from "@fxtoolkit/indicator-runner";
import {
  readBarBatch,
  readExpectedHistory,
  readGoldenManifest,
} from "./support/indicator-fixtures";

const MODULE = "lumina-trend-channels";
const FIXTURE_PATH = resolve(process.cwd(), "fixtures/indicators", `${MODULE}.ts`);

// The browser build is a separate, lazily-loaded artifact. Loaded by path so this test exercises the
// shipped file rather than the source it came from. It intentionally does not share the Node
// compiler's module type — `compileScriptInBrowser` is a distinct export on a distinct subpath.
const BROWSER_BUILD = "../../indicator-stdlib/dist/compiler/browser.js";

interface BrowserCompilerModule {
  compileScriptInBrowser(
    source: string,
    options: CompileScriptOptions,
  ): Promise<CompileScriptResult>;
}

/**
 * Loads the browser compiler under browser conditions.
 *
 * `asc` picks its filesystem strategy from a runtime guard on `globalThis.process`. In Node that
 * guard is true, so it would take the Node branch and reach the throwing stub that replaced the
 * builtins at build time. Removing `process` for the duration of the import is what makes this a
 * genuine test of the browser path — the same condition the browser itself provides.
 */
async function loadBrowserCompiler(): Promise<BrowserCompilerModule> {
  const savedProcess = globalThis.process;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).process;

  try {
    return (await import(BROWSER_BUILD)) as BrowserCompilerModule;
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).process = savedProcess;
  }
}

describe("browser compiler", () => {
  let source: string;
  let nodeResult: CompileScriptResult;
  let browserResult: CompileScriptResult;

  beforeAll(async () => {
    source = await readFile(FIXTURE_PATH, "utf8");
    nodeResult = await compileScript(source, { module: MODULE });

    const browser = await loadBrowserCompiler();
    browserResult = await browser.compileScriptInBrowser(source, { module: MODULE });
  }, 120_000);

  it("compiles the fixture without errors", () => {
    expect(browserResult.ok).toBe(true);
    expect(browserResult.wasm).toBeInstanceOf(Uint8Array);
    expect(browserResult.diagnostics.filter((d) => d.level === "error")).toEqual([]);
  });

  it("produces bytes identical to the Node compiler", () => {
    expect(Buffer.from(browserResult.wasm!).equals(Buffer.from(nodeResult.wasm!))).toBe(
      true,
    );
    expect(browserResult.descriptor).toEqual(nodeResult.descriptor);
  });

  it("reports structured diagnostics with positions", async () => {
    const browser = await loadBrowserCompiler();
    const broken = await browser.compileScriptInBrowser(
      "export function describe(): string { return ",
      { module: "broken" },
    );

    expect(broken.ok).toBe(false);
    expect(broken.wasm).toBeUndefined();

    const errors = broken.diagnostics.filter((d) => d.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBeGreaterThan(0);
  }, 120_000);

  it("refuses imports outside the standard library", async () => {
    const browser = await loadBrowserCompiler();
    const result = await browser.compileScriptInBrowser(
      'import { x } from "some-other-package";\nexport function describe(): string { return x; }',
      { module: "bad-import" },
    );

    expect(result.ok).toBe(false);
  }, 120_000);

  it("produces a module the runner reproduces the oracle with", async () => {
    const oracle = await readExpectedHistory(MODULE);
    const entry: IndicatorManifestEntry = {
      abiVersion: ABI_VERSION,
      descriptor: browserResult.descriptor!,
      module: MODULE,
      wasmUrl: "unused",
    };
    const manifest: IndicatorManifest = { indicators: [entry] };

    const runtime = new IndicatorRuntime(
      createStaticModuleSource({
        bytes: new Map([[MODULE, browserResult.wasm!]]),
        manifest,
      }),
    );

    const indicator = await runtime.resolveIndicator({ module: MODULE });
    const session = await runtime.createSession(indicator, oracle.runtimeInfo);

    try {
      expect(session.processHistoryBars(await readBarBatch())).toEqual(oracle.outputs);
      expect(session.saveState()).toBe(oracle.savedState);
    } finally {
      session.destroy();
    }
  }, 60_000);

  it("ships the artifact as a lazy-loadable module, separate from the Node compiler", async () => {
    // The barrel must not pull in 15 MB of compiler: the browser entry is a distinct subpath.
    const indexManifest = JSON.parse(
      await readFile(
        resolve(process.cwd(), "packages/indicator-stdlib/package.json"),
        "utf8",
      ),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(indexManifest.exports)).toContain("./compiler/browser");

    const golden = await readGoldenManifest();
    expect(golden.indicators.length).toBeGreaterThan(0);
  });
});
