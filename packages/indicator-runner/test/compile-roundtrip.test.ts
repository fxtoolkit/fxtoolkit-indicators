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
const FIXTURE_PATH = resolve(
  process.cwd(),
  "fixtures/indicators",
  `${MODULE}.ts`,
);

/**
 * M8 gate: a script compiled from source, in memory, must produce a module that behaves exactly like
 * the Orion-built binary — same descriptor, same output for the same bars, same saved state.
 */
describe("compileScript round trip", () => {
  let source: string;
  let compiled: CompileScriptResult;

  beforeAll(async () => {
    source = await readFile(FIXTURE_PATH, "utf8");
    compiled = await compileScript(source, { module: MODULE });
  }, 60_000);

  it("compiles a real indicator script without touching the filesystem", () => {
    expect(compiled.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(compiled.ok).toBe(true);
    expect(compiled.wasm).toBeInstanceOf(Uint8Array);
    expect(compiled.wasm!.length).toBeGreaterThan(0);
  });

  it("reports the same descriptor as the golden binary", async () => {
    expect(compiled.descriptor).toBeDefined();

    const golden = await readGoldenManifest();
    const goldenEntry = golden.indicators.find((entry) => entry.module === MODULE)!;

    expect(compiled.descriptor).toEqual(goldenEntry.descriptor);
  });

  it("reproduces orion's outputs when run against the same bars", async () => {
    const oracle = await readExpectedHistory(MODULE);
    const entry: IndicatorManifestEntry = {
      abiVersion: ABI_VERSION,
      descriptor: compiled.descriptor!,
      module: MODULE,
      wasmUrl: "unused",
    };
    const manifest: IndicatorManifest = { indicators: [entry] };

    const runtime = new IndicatorRuntime(
      createStaticModuleSource({
        bytes: new Map([[MODULE, compiled.wasm!]]),
        manifest,
      }),
    );

    const indicator = await runtime.resolveIndicator({ module: MODULE });
    expect(indicator.params).toEqual(oracle.params);

    const session = await runtime.createSession(indicator, oracle.runtimeInfo);

    try {
      const bars = await readBarBatch();
      const outputs = session.processHistoryBars(bars);

      expect(outputs).toEqual(oracle.outputs);
      expect(session.saveState()).toBe(oracle.savedState);
    } finally {
      session.destroy();
    }
  }, 30_000);

  it("produces identical bytes when compiled on a worker thread", async () => {
    // The isolated compiler spawns a worker from its *built* output, so it is loaded from dist
    // rather than the source alias the rest of this file uses. The specifier is assembled at
    // runtime so type-checking does not depend on the build having run.
    const distEntry = [
      "..",
      "..",
      "indicator-stdlib",
      "dist",
      "compiler",
      "index.js",
    ].join("/");

    const { compileScriptIsolated } = (await import(
      /* @vite-ignore */ distEntry
    )) as typeof import("@fxtoolkit/indicator-stdlib/compiler");

    const isolated = await compileScriptIsolated(source, { module: MODULE });

    expect(isolated.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(isolated.ok).toBe(true);
    expect(isolated.wasm).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(isolated.wasm!)).toEqual(Buffer.from(compiled.wasm!));
    expect(isolated.descriptor).toEqual(compiled.descriptor);
  }, 60_000);
});

describe("compileScript diagnostics", () => {
  it("reports a syntax error with a position", async () => {
    const result = await compileScript("export function describe(): string { return ", {
      module: "broken",
    });

    expect(result.ok).toBe(false);
    expect(result.wasm).toBeUndefined();

    const errors = result.diagnostics.filter((d) => d.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message.length).toBeGreaterThan(0);
    expect(errors[0].line).toBeGreaterThan(0);
  }, 60_000);

  it("reports a type error against the standard library", async () => {
    const result = await compileScript(
      [
        'import { Bar } from "@fxtoolkit/indicator-stdlib";',
        "export function describe(): string {",
        '  const bar: Bar = "not a bar";',
        "  return bar.toString();",
        "}",
      ].join("\n"),
      { module: "type-error" },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(true);
  }, 60_000);

  it("refuses imports outside the standard library", async () => {
    const result = await compileScript(
      [
        'import { helper } from "some-other-package";',
        "export function describe(): string { return helper; }",
      ].join("\n"),
      { module: "bad-import" },
    );

    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((d) => /some-other-package|not found/i.test(d.message)),
    ).toBe(true);
  }, 60_000);

  it("refuses a relative import that escapes the virtual filesystem", async () => {
    const result = await compileScript(
      [
        'import { secret } from "../../etc/passwd";',
        "export function describe(): string { return secret; }",
      ].join("\n"),
      { module: "escaping-import" },
    );

    expect(result.ok).toBe(false);
    expect(result.wasm).toBeUndefined();
  }, 60_000);
});
