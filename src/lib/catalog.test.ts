import { describe, expect, it } from "vitest";
import { isUuid } from "./catalog";

describe("isUuid", () => {
  it("accepts a canonical UUID in either case", () => {
    expect(isUuid("00000000-0000-0000-0000-0000000ad301")).toBe(true);
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "new",
      "not-a-uuid",
      "3f2504e0-4f89-11d3-9a0c-0305e82c330",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301x",
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
