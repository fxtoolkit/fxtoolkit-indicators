// Indicator runner demo.
//
// Loads the golden indicator binaries, drives them through the worker-backed engine, and paints
// their output with `mountIndicatorSurface`. Exercises both target modes (a container we create a
// canvas inside, or a canvas the host owns) and all three backend preferences.

import {
  createUrlModuleSource,
  mountIndicatorSurface,
  IndicatorEngine,
  type IndicatorSurface,
  type ChartBar,
  type IndicatorRenderBundle,
  type IndicatorRendererBackend,
  type IndicatorRendererPreference,
} from "@fxtoolkit/indicator-runner";
import EngineWorker from "@fxtoolkit/indicator-runner/engine/worker?worker";

const MANIFEST_URL = "/orion-indicators/manifest.json";
const BARS_URL = "/orion-indicators/bars.json";

interface DemoState {
  backend: IndicatorRendererBackend | null;
  bars: ChartBar[];
  bundles: IndicatorRenderBundle[];
  indicator: string;
  preference: IndicatorRendererPreference;
  target: "canvas" | "container";
  viewport: { barCount: number; offsetBars: number };
}

const state: DemoState = {
  backend: null,
  bars: [],
  bundles: [],
  indicator: "lumina-trend-channels",
  preference: "auto",
  target: "container",
  viewport: { barCount: 220, offsetBars: 0 },
};

const surfaceHost = document.querySelector<HTMLDivElement>("#surface")!;
const statusLine = document.querySelector<HTMLDivElement>("#status")!;
const indicatorSelect = document.querySelector<HTMLSelectElement>("#indicator")!;
const backendSelect = document.querySelector<HTMLSelectElement>("#backend")!;
const hostSelect = document.querySelector<HTMLSelectElement>("#host")!;

let surface: IndicatorSurface | null = null;
let engine: IndicatorEngine | null = null;

function getEngine(): IndicatorEngine {
  engine ??= new IndicatorEngine({
    createWorker: () => new EngineWorker(),
    manifestUrl: MANIFEST_URL,
  });

  return engine;
}

function setStatus(text: string, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("error", isError);
}

async function loadBars(): Promise<ChartBar[]> {
  const response = await fetch(BARS_URL, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Failed to load the demo bar series");
  }

  const payload = (await response.json()) as { data: { ticks: ChartBar[] } };
  return payload.data.ticks;
}

function teardown() {
  surface?.destroy();
  surface = null;
  surfaceHost.replaceChildren();
}

/**
 * Mounts a surface for the current target mode, pushing whatever we already have.
 */
function mount(bars: ChartBar[], bundles: IndicatorRenderBundle[]) {
  teardown();

  let target: HTMLCanvasElement | HTMLElement;

  if (state.target === "canvas") {
    const canvas = document.createElement("canvas");
    canvas.id = "host-canvas";
    surfaceHost.appendChild(canvas);
    target = canvas;
  } else {
    target = surfaceHost;
  }

  surface = mountIndicatorSurface(target, {
    prefer: state.preference,
    viewport: state.viewport,
  });

  state.backend = surface.getBackend();
  surface.setBars(bars);
  surface.setBundles(bundles);
  surface.renderNow();
}

/** Loads the compiled module in the worker and returns its render bundle for the current bars. */
async function runIndicator(module: string) {
  const broker = getEngine();

  await broker.init();
  await broker.loadIndicator({ module });

  const history = await broker.replaceHistoryBars(state.bars);
  return history.bundles;
}

function describeState() {
  const frame = surface?.getFrame();
  const parts = [
    `backend: ${state.backend ?? "unknown"}`,
    `target: ${state.target}`,
    `indicator: ${state.indicator}`,
    `bars: ${state.bars.length}`,
    `visible: last ${state.viewport.barCount} @ offset ${state.viewport.offsetBars}`,
  ];

  if (frame) {
    parts.push(
      `timeframe: ${Math.round(frame.timeFrameMs / 60_000)}m`,
      `pixels/bar: ${frame.pixelsPerBar.toFixed(2)}`,
      `price: ${frame.visiblePriceRange.from.toFixed(2)} – ${frame.visiblePriceRange.to.toFixed(2)}`,
      `rebuilds: ${surface!.getPerformanceSnapshot().geometryRebuilds}`,
    );
  }

  setStatus(parts.join("\n"));
}

async function selectIndicator(module: string) {
  state.indicator = module;
  setStatus(`Running ${module}…`);

  state.bundles = await runIndicator(module);
  mount(state.bars, state.bundles);
  describeState();
}

async function main() {
  setStatus("Loading bars…");
  state.bars = await loadBars();

  const source = createUrlModuleSource({ manifestUrl: MANIFEST_URL });
  const manifest = await source.getManifest();

  indicatorSelect.replaceChildren(
    ...manifest.indicators.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.module;
      option.textContent = entry.descriptor.title;
      return option;
    }),
  );
  indicatorSelect.value = state.indicator;

  // The demo fetches bars from a static asset so the worker path has a symbol/timeframe to infer.
  await selectIndicator(state.indicator);
}

indicatorSelect.addEventListener("change", () => {
  void selectIndicator(indicatorSelect.value).catch((error: unknown) => {
    setStatus(String(error), true);
  });
});

backendSelect.addEventListener("change", () => {
  state.preference = backendSelect.value as IndicatorRendererPreference;
  mount(state.bars, state.bundles);
  describeState();
});

hostSelect.addEventListener("change", () => {
  state.target = hostSelect.value === "canvas" ? "canvas" : "container";
  mount(state.bars, state.bundles);
  describeState();
});

document.querySelector<HTMLButtonElement>("#zoom-in")!.addEventListener("click", () => {
  state.viewport.barCount = Math.max(30, Math.round(state.viewport.barCount * 0.7));
  surface?.setViewport(state.viewport);
  describeState();
});

document.querySelector<HTMLButtonElement>("#zoom-out")!.addEventListener("click", () => {
  state.viewport.barCount = Math.min(600, Math.round(state.viewport.barCount * 1.4));
  surface?.setViewport(state.viewport);
  describeState();
});

document.querySelector<HTMLButtonElement>("#pan-left")!.addEventListener("click", () => {
  state.viewport.offsetBars += 20;
  surface?.setViewport(state.viewport);
  describeState();
});

document.querySelector<HTMLButtonElement>("#pan-right")!.addEventListener("click", () => {
  state.viewport.offsetBars = Math.max(0, state.viewport.offsetBars - 20);
  surface?.setViewport(state.viewport);
  describeState();
});

main().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});
