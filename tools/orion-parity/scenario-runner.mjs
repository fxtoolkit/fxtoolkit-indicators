// Shared parity scenario runner.
//
// Executed by BOTH sides of the parity harness — Orion and this repo — against their own runtime.
// It is deliberately plain JS and duck-typed so either runtime can be passed in: both expose
// `resolveIndicator`, `createSession`, `processHistoryBars`, `restore`, `processBar`, `saveState`
// and `destroy` with the same shapes.
//
// Whatever this file does defines the scenario semantics. Keep it the single source of truth: the
// Orion capture harness imports it by absolute path rather than keeping a copy.

/**
 * @param {{ runtime: any, scenarios: any[], bars: any[] }} input
 * @returns {Promise<Record<string, any>>} scenario id -> recorded steps
 */
export async function runScenarios({ runtime, scenarios, bars }) {
  const results = {};

  for (const scenario of scenarios) {
    const indicator = await runtime.resolveIndicator({
      module: scenario.module,
      params: scenario.params,
    });

    const session = await runtime.createSession(indicator, scenario.runtimeInfo);
    const steps = [];
    let snapshot = "";
    let historyBarCount = 0;

    try {
      for (const step of scenario.steps) {
        if (step.kind === "history") {
          const slice = bars.slice(0, step.barCount);
          const outputs = session.processHistoryBars(slice);
          snapshot = session.saveState();
          historyBarCount = slice.length;

          steps.push({
            barCount: step.barCount,
            kind: "history",
            outputs,
            savedState: snapshot,
          });
          continue;
        }

        if (step.kind === "realtime") {
          // Replay committed state, then feed the live bar exactly as the worker would.
          session.restore(snapshot);

          const outputs = session.processBar(step.bar, {
            index: historyBarCount,
            isConfirmed: step.commit === true,
            isFirst: false,
            isHistory: false,
            isLastBar: step.commit !== true,
            isNew: true,
            isRealtime: step.commit !== true,
          });

          if (step.commit === true) {
            snapshot = session.saveState();
          }

          steps.push({
            committed: step.commit === true,
            kind: "realtime",
            outputs,
            savedState: session.saveState(),
          });
          continue;
        }

        throw new Error(`Unknown parity step kind: ${String(step.kind)}`);
      }
    } finally {
      session.destroy();
    }

    results[scenario.id] = {
      params: indicator.params,
      steps,
    };
  }

  return results;
}
