import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { PRICING_ERROR, pricingErrorFromPostgrest, pricingErrorMessage } from "./pricing-errors";

describe("pricingErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(pricingErrorMessage(null)).toBeNull();
    expect(pricingErrorMessage(undefined)).toBeNull();
    expect(pricingErrorMessage("")).toBeNull();
  });

  it.each(Object.values(PRICING_ERROR))("has a Polish message for %s", (code) => {
    const message = pricingErrorMessage(code);
    expect(message).toBeTruthy();
    expect(message).not.toContain(code);
  });

  it("maps the codes to their own messages", () => {
    expect(pricingErrorMessage(PRICING_ERROR.notConfigured)).toBe(t.pricingErrors.notConfigured);
    expect(pricingErrorMessage(PRICING_ERROR.forbidden)).toBe(t.pricingErrors.forbidden);
    expect(pricingErrorMessage(PRICING_ERROR.invalidInput)).toBe(t.pricingErrors.invalidInput);
  });

  it("shows the generic message for an unrecognised code, including inherited object keys", () => {
    expect(pricingErrorMessage("PGRST204")).toBe(t.pricingErrors.unknown);
    expect(pricingErrorMessage("toString")).toBe(t.pricingErrors.unknown);
  });
});

describe("pricingErrorFromPostgrest", () => {
  it("maps an RLS refusal of the upsert to forbidden", () => {
    expect(pricingErrorFromPostgrest({ code: "42501" })).toBe(PRICING_ERROR.forbidden);
  });

  it("maps a bounds CHECK violation to invalid input", () => {
    expect(pricingErrorFromPostgrest({ code: "23514" })).toBe(PRICING_ERROR.invalidInput);
  });

  it("passes an unmapped code through so the URL stays diagnosable", () => {
    expect(pricingErrorFromPostgrest({ code: "23503" })).toBe("23503");
    expect(pricingErrorFromPostgrest({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("falls back to unknown when there is no code", () => {
    expect(pricingErrorFromPostgrest({ code: null })).toBe(PRICING_ERROR.unknown);
    expect(pricingErrorFromPostgrest({})).toBe(PRICING_ERROR.unknown);
  });
});
