// Builds the parity scenario matrix that both Orion and this repo execute verbatim.
//
// The spec is data-only and fully literal so the two sides cannot drift: each side reads the same
// JSON, feeds the same bars, and records the same operations.
//
//   node scripts/build-parity-scenarios.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const goldenDirectory = resolve(projectRoot, "fixtures/golden");
const outputDirectory = resolve(projectRoot, "fixtures/parity");

const MODULES = [
  "htf-confluence",
  "lumina-trend-channels",
  "qmra-indicator",
  "reverse-logic-scalper",
];

const RUNTIME_INFO = {
  pipSize: 0.01,
  symbol: "ETHUSD",
  timeframeMs: 24 * 60 * 60 * 1000,
};

/** Non-default params, clamped/coerced differently by each module's descriptor. */
const CUSTOM_PARAMS = {
  "lumina-trend-channels": { length: 9, outerMultiplier: 3.5, showDashboard: false },
  "reverse-logic-scalper": { bbLength: 10, minScore: 1, maType: "WMA" },
  "qmra-indicator": { swingStrength: 3 },
  "htf-confluence": { confluenceType: "QMR", riskReward: 4, showHtfLevels: false },
};

/**
 * A realtime bar derived from the last bar of a slice, so both sides get identical input.
 */
function liveBarFor(bars, barCount, hourStep) {
  const last = bars[barCount - 1];

  return {
    close: last.close * 1.001,
    high: last.close * 1.002,
    low: last.close * 0.999,
    open: last.close,
    spread: last.spread ?? 0,
    time: last.time + hourStep,
    volume: 1 + (last.volume ?? 0),
  };
}

async function main() {
  const payload = JSON.parse(
    await readFile(resolve(goldenDirectory, "bar-batch.json"), "utf8"),
  );
  const bars = payload.data.ticks;
  const hourStep = 60 * 60 * 1000;

  const scenarios = [];

  for (const module of MODULES) {
    scenarios.push({
      barCount: bars.length,
      id: `${module}__default-history`,
      module,
      runtimeInfo: RUNTIME_INFO,
      steps: [{ barCount: bars.length, kind: "history" }],
    });

    scenarios.push({
      barCount: bars.length,
      id: `${module}__truncated-history`,
      module,
      runtimeInfo: RUNTIME_INFO,
      steps: [{ barCount: 60, kind: "history" }],
    });

    scenarios.push({
      barCount: bars.length,
      id: `${module}__custom-params`,
      module,
      params: CUSTOM_PARAMS[module],
      runtimeInfo: RUNTIME_INFO,
      steps: [{ barCount: bars.length, kind: "history" }],
    });

    scenarios.push({
      barCount: bars.length,
      id: `${module}__realtime`,
      module,
      runtimeInfo: RUNTIME_INFO,
      steps: [
        { barCount: bars.length, kind: "history" },
        { bar: liveBarFor(bars, bars.length, hourStep), kind: "realtime" },
        {
          bar: liveBarFor(bars, bars.length, hourStep * 2),
          kind: "realtime",
          commit: true,
        },
      ],
    });
  }

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "scenarios.json"),
    `${JSON.stringify(
      { barsSource: "fixtures/golden/bar-batch.json", scenarios },
      null,
      2,
    )}\n`,
  );

  console.log(`Wrote ${scenarios.length} scenarios to ${outputDirectory}/scenarios.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
