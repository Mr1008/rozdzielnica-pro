import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { DEVICE_ERROR, deviceErrorFromPostgrest, deviceErrorMessage } from "./device-errors";

describe("deviceErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(deviceErrorMessage(null)).toBeNull();
    expect(deviceErrorMessage(undefined)).toBeNull();
    expect(deviceErrorMessage("")).toBeNull();
  });

  it.each(Object.values(DEVICE_ERROR))("has a Polish message for %s", (code) => {
    const message = deviceErrorMessage(code);
    expect(message).toBeTruthy();
    expect(message).not.toContain(code);
  });

  it("maps the codes to their own messages", () => {
    expect(deviceErrorMessage(DEVICE_ERROR.notFound)).toBe(t.deviceErrors.notFound);
    expect(deviceErrorMessage(DEVICE_ERROR.notConfigured)).toBe(t.deviceErrors.notConfigured);
    expect(deviceErrorMessage(DEVICE_ERROR.duplicateModel)).toBe(t.deviceErrors.duplicateModel);
  });

  it("shows the generic message for an unrecognised code, including inherited object keys", () => {
    expect(deviceErrorMessage("23514")).toBe(t.deviceErrors.unknown);
    expect(deviceErrorMessage("toString")).toBe(t.deviceErrors.unknown);
  });
});

describe("deviceErrorFromPostgrest", () => {
  it("maps a unique violation to a duplicate model", () => {
    expect(deviceErrorFromPostgrest({ code: "23505" })).toBe(DEVICE_ERROR.duplicateModel);
  });

  it("maps an insufficient-privilege error to forbidden", () => {
    expect(deviceErrorFromPostgrest({ code: "42501" })).toBe(DEVICE_ERROR.forbidden);
  });

  it("passes an unmapped code through so the URL stays diagnosable", () => {
    expect(deviceErrorFromPostgrest({ code: "23514" })).toBe("23514");
    expect(deviceErrorFromPostgrest({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("falls back to unknown when there is no code", () => {
    expect(deviceErrorFromPostgrest({ code: null })).toBe(DEVICE_ERROR.unknown);
    expect(deviceErrorFromPostgrest({})).toBe(DEVICE_ERROR.unknown);
  });
});
