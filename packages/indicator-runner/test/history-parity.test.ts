import { beforeAll, describe, expect, it } from "vitest";
import type { IndicatorManifest } from "@fxtoolkit/indicator-stdlib/abi";
import { IndicatorRuntime } from "@fxtoolkit/indicator-runner";
import { createStaticModuleSource } from "@fxtoolkit/indicator-runner";
import {
  MODULES,
  readBarBatch,
  readExpectedHistory,
  readGoldenBytes,
  readGoldenManifest,
  type ExpectedHistory,
} from "./support/indicator-fixtures";

/**
 * M3 parity gate: the ported runtime, driving orion's own compiled binaries, must reproduce
 * orion's own outputs for the same bar batch — exactly, including `saveState()` and the
 * params resolved from the descriptor.
 */
describe("runner history parity vs orion", () => {
  let bars: Awaited<ReturnType<typeof readBarBatch>>;
  let oracleByModule: Map<string, ExpectedHistory>;
  let runtime: IndicatorRuntime;

  beforeAll(async () => {
    bars = await readBarBatch();
    oracleByModule = new Map(
      await Promise.all(
        MODULES.map(async (module) => [module, await readExpectedHistory(module)] as const),
      ),
    );

    const manifest: IndicatorManifest = await readGoldenManifest();
    const bytes = new Map<string, Uint8Array>();
    for (const entry of manifest.indicators) {
      bytes.set(entry.module, await readGoldenBytes(entry));
    }

    runtime = new IndicatorRuntime(
      createStaticModuleSource({ manifest, bytes }),
    );
  });

  it("has an oracle for every module it drives", () => {
    expect([...oracleByModule.keys()].sort()).toEqual([...MODULES].sort());
  });

  it.each(MODULES)("reproduces orion's onBars output for %s", async (module) => {
    const oracle = oracleByModule.get(module)!;
    const indicator = await runtime.resolveIndicator({ module });

    expect(indicator.id, `${module} instance id`).toBe(oracle.instanceId);
    expect(indicator.enabled, `${module} enabled`).toBe(oracle.enabled);
    expect(indicator.params, `${module} resolved params`).toEqual(oracle.params);

    const session = await runtime.createSession(indicator, oracle.runtimeInfo);

    try {
      const outputs = session.processHistoryBars(bars);

      expect(outputs, `${module} outputs`).toEqual(oracle.outputs);
      expect(session.saveState(), `${module} saved state`).toBe(oracle.savedState);
    } finally {
      session.destroy();
    }
  });

  it("is deterministic across repeated runs", async () => {
    const module = "lumina-trend-channels";
    const oracle = oracleByModule.get(module)!;
    const indicator = await runtime.resolveIndicator({ module });

    const first = await runtime.createSession(indicator, oracle.runtimeInfo);
    const firstOutputs = first.processHistoryBars(bars);
    const firstState = first.saveState();
    first.destroy();

    const second = await runtime.createSession(indicator, oracle.runtimeInfo);
    const secondOutputs = second.processHistoryBars(bars);
    const secondState = second.saveState();
    second.destroy();

    expect(secondOutputs).toEqual(firstOutputs);
    expect(secondState).toBe(firstState);
  });
});
