// Ported from orion src/library/models/chart/scene/render-scheduler.ts
//
// Change: `requestAnimationFrame`/`cancelAnimationFrame` are no longer hard-coded. A frame
// scheduler can be injected, and the default falls back to timers where rAF is unavailable
// (e.g. Node), so the package does not assume a browser.

export type RenderReason =
  | "data"
  | "interaction"
  | "resize"
  | "state"
  | "viewport";

export interface FrameScheduler {
  cancel(handle: number): void;
  request(callback: (time: number) => void): number;
}

export const defaultFrameScheduler: FrameScheduler = {
  cancel(handle) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
      return;
    }

    clearTimeout(handle);
  },
  request(callback) {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(callback);
    }

    return setTimeout(() => callback(Date.now()), 16) as unknown as number;
  },
};

export default class RenderScheduler {
  private frameId: number | null = null;
  private destroyed = false;
  private readonly reasons = new Set<RenderReason>();

  constructor(
    private readonly render: (reasons: readonly RenderReason[]) => void,
    private readonly scheduler: FrameScheduler = defaultFrameScheduler,
  ) {}

  request(reason: RenderReason = "state") {
    if (this.destroyed) {
      return;
    }

    this.reasons.add(reason);

    if (this.frameId !== null) {
      return;
    }

    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      const reasons = [...this.reasons];
      this.reasons.clear();
      this.render(reasons);
    });
  }

  cancel() {
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }

    this.reasons.clear();
  }

  destroy() {
    this.destroyed = true;
    this.cancel();
  }
}
