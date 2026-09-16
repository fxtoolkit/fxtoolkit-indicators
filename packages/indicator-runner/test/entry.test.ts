import { describe, expect, it } from "vitest";
import * as runner from "@fxtoolkit/indicator-runner";

describe("indicator-runner scaffold", () => {
  it("exposes an importable public entry", () => {
    expect(runner).toBeTypeOf("object");
  });
});
