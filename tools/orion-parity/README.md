# Orion parity harness

The pre-swap gate. It proves these packages behave identically to Orion Charts before Orion's
indicator runtime and renderer are deleted.

## How it works

```
fixtures/parity/scenarios.json          declarative spec (data only, fully literal)
          |
          +------------------------------+
          v                              v
  scenario-runner.mjs             scenario-runner.mjs
   ^ run inside Orion              ^ run against our runtime
   |                               |
fixtures/parity/orion/*.json  -->  diff  -->  parity-report/report.{json,md}
```

Both sides execute **the same runner file** against their own runtime over **the same scenario
spec**, so the only thing that differs is the implementation under test. The runner is deliberately
plain JS and duck-typed: Orion's `OrionIndicatorRuntime` and our `IndicatorRuntime` expose the same
methods (`resolveIndicator`, `createSession`, `processHistoryBars`, `restore`, `processBar`,
`saveState`, `destroy`).

**It compares behaviour, never bytes.** The committed golden binaries are *not* reproducible from
Orion's current sources with the installed `asc` (they differ from an Orion-source rebuild), so a
byte comparison would be meaningless. Outputs, `savedState`, resolved params and the render geometry
digests are what get compared.

## Scenarios

Generated from the golden bar batch by `npm run build:parity-scenarios`. Four per module:

| Scenario | Exercises |
| --- | --- |
| `__default-history` | the full 300-bar batch with default params |
| `__truncated-history` | 60 bars — indicator warm-up and seeding paths |
| `__custom-params` | non-default params — coercion and clamping against the descriptor |
| `__realtime` | history, then a provisional live bar and its commit (`restore` + `processBar`) |

The realtime steps replay committed state via `restore(snapshot)` before each `processBar`, which is
what Orion's worker does for a live bar. Scenario semantics live in `scenario-runner.mjs` — if you
change that file, both sides change together.

## Regenerating the Orion oracle

Orion's runtime resolves its own `@/library/...` aliases, which this repo cannot satisfy, so the
capture has to run *inside* Orion. It takes seconds and leaves Orion untouched:

```bash
cp tools/orion-parity/parity-capture.test.ts ../orion/src/test/__parity-capture.test.ts
cd ../orion && npx vitest run src/test/__parity-capture.test.ts
rm ../orion/src/test/__parity-capture.test.ts
```

The capture harness imports `scenario-runner.mjs` from this repo, so there is no copy to keep in
sync. It writes one JSON file per scenario into `fixtures/parity/orion/`.

> **Layout requirement:** the two checkouts must be siblings (`<parent>/orion` and
> `<parent>/fxtoolkit-indicators`). The harness resolves this repo relative to the running one, and
> its import of `scenario-runner.mjs` must be a *static* relative specifier — vitest resolves static
> imports at transform time but refuses a dynamically computed path outside its own root.

## Running the harness

```bash
npm test          # includes it
# or
npx vitest run packages/indicator-runner/test/orion-parity.dom.test.ts
```

It writes `parity-report/report.json` and a readable `parity-report/report.md`. Both are build
artifacts (gitignored) — regenerate rather than commit them.

## Fixture size

`fixtures/parity/orion/` is ~4.5 MB (16 scenarios, the history ones carrying full outputs). Combined
with `fixtures/golden/expected-history/` the committed fixtures are ~7 MB. If that becomes
unwelcome, the `__default-history` scenarios are redundant with the M1 oracle and could be dropped.
