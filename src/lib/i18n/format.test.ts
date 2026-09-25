import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, formatDate, formatDateTime, resolveTimeZone } from "./format";

describe("resolveTimeZone", () => {
  it("keeps a zone the runtime knows", () => {
    expect(resolveTimeZone("Europe/Warsaw")).toBe("Europe/Warsaw");
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("falls back to the default for a missing, blank, non-string or unknown zone", () => {
    for (const raw of [undefined, null, "", 42, "Mars/Olympus_Mons", "not a zone"]) {
      expect(resolveTimeZone(raw), String(raw)).toBe(DEFAULT_TIME_ZONE);
    }
  });

  it("never falls back to UTC by default", () => {
    expect(DEFAULT_TIME_ZONE).not.toBe("UTC");
  });
});

describe("formatDate", () => {
  // 23:30 UTC on 24 September is already 25 September in Warsaw (UTC+2 in summer).
  const lateEveningUtc = "2026-09-24T23:30:00Z";

  it("applies the viewer's zone, not the runtime's UTC", () => {
    expect(formatDate(lateEveningUtc, "Europe/Warsaw")).toBe("25 wrz 2026");
    expect(formatDate(lateEveningUtc, "UTC")).toBe("24 wrz 2026");
  });

  it("formats the time in the viewer's zone too", () => {
    expect(formatDateTime(lateEveningUtc, "Europe/Warsaw")).toContain("01:30");
  });
});
