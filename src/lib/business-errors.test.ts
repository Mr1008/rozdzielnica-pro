import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { BUSINESS_ERROR, businessErrorFromPostgrest, businessErrorMessage } from "./business-errors";

describe("businessErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(businessErrorMessage(null)).toBeNull();
    expect(businessErrorMessage(undefined)).toBeNull();
    expect(businessErrorMessage("")).toBeNull();
  });

  it.each(Object.values(BUSINESS_ERROR))("has a Polish message for %s", (code) => {
    const message = businessErrorMessage(code);
    expect(message).toBeTruthy();
    expect(message).not.toContain(code);
  });

  it("maps the codes to their own messages", () => {
    expect(businessErrorMessage(BUSINESS_ERROR.notConfigured)).toBe(t.businessErrors.notConfigured);
    expect(businessErrorMessage(BUSINESS_ERROR.forbidden)).toBe(t.businessErrors.forbidden);
    expect(businessErrorMessage(BUSINESS_ERROR.invalidInput)).toBe(t.businessErrors.invalidInput);
  });

  it("shows the generic message for an unrecognised code, including inherited object keys", () => {
    expect(businessErrorMessage("PGRST204")).toBe(t.businessErrors.unknown);
    expect(businessErrorMessage("toString")).toBe(t.businessErrors.unknown);
  });
});

describe("businessErrorFromPostgrest", () => {
  it("maps an RLS refusal of the upsert to forbidden", () => {
    expect(businessErrorFromPostgrest({ code: "42501" })).toBe(BUSINESS_ERROR.forbidden);
  });

  it("maps a bounds CHECK violation to invalid input", () => {
    expect(businessErrorFromPostgrest({ code: "23514" })).toBe(BUSINESS_ERROR.invalidInput);
  });

  it("passes an unmapped code through so the URL stays diagnosable", () => {
    expect(businessErrorFromPostgrest({ code: "23503" })).toBe("23503");
    expect(businessErrorFromPostgrest({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("falls back to unknown when there is no code", () => {
    expect(businessErrorFromPostgrest({ code: null })).toBe(BUSINESS_ERROR.unknown);
    expect(businessErrorFromPostgrest({})).toBe(BUSINESS_ERROR.unknown);
  });
});
