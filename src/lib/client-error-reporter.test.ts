import { describe, expect, it } from "vitest";
import { createReportGate } from "./client-error-reporter";

describe("createReportGate", () => {
  it("lets a distinct source and message through once", () => {
    const allow = createReportGate();
    expect(allow("window", "boom")).toBe(true);
    expect(allow("window", "boom")).toBe(false);
    expect(allow("rejection", "boom")).toBe(true);
    expect(allow("window", "other")).toBe(true);
  });

  it("stops after the cap, even for new messages", () => {
    const allow = createReportGate(2);
    expect(allow("window", "a")).toBe(true);
    expect(allow("window", "b")).toBe(true);
    expect(allow("window", "c")).toBe(false);
  });
});
