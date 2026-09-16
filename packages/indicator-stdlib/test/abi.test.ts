import { describe, expect, it } from "vitest";
import { ABI_VERSION } from "@fxtoolkit/indicator-stdlib/abi";

describe("indicator-stdlib ABI", () => {
  it("pins the host ABI version targeted by compiled indicators", () => {
    expect(ABI_VERSION).toBe(4);
  });
});
