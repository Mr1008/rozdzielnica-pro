import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { CABINET_ERROR, cabinetErrorFromPostgrest, cabinetErrorMessage } from "./cabinet-errors";

describe("cabinetErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(cabinetErrorMessage(null)).toBeNull();
    expect(cabinetErrorMessage(undefined)).toBeNull();
    expect(cabinetErrorMessage("")).toBeNull();
  });

  it.each(Object.values(CABINET_ERROR))("has a Polish message for %s", (code) => {
    const message = cabinetErrorMessage(code);
    expect(message).toBeTruthy();
    expect(message).not.toContain(code);
  });

  it("maps the codes to their own messages", () => {
    expect(cabinetErrorMessage(CABINET_ERROR.notFound)).toBe(t.cabinetErrors.notFound);
    expect(cabinetErrorMessage(CABINET_ERROR.notConfigured)).toBe(t.cabinetErrors.notConfigured);
  });

  it("shows the generic message for an unrecognised code, including inherited object keys", () => {
    expect(cabinetErrorMessage("PGRST116")).toBe(t.cabinetErrors.unknown);
    expect(cabinetErrorMessage("toString")).toBe(t.cabinetErrors.unknown);
  });
});

describe("cabinetErrorFromPostgrest", () => {
  it("maps a unique violation to a duplicate model", () => {
    expect(cabinetErrorFromPostgrest({ code: "23505" })).toBe(CABINET_ERROR.duplicateModel);
  });

  it("maps an insufficient-privilege error to forbidden", () => {
    expect(cabinetErrorFromPostgrest({ code: "42501" })).toBe(CABINET_ERROR.forbidden);
  });

  it("passes an unmapped code through so the URL stays diagnosable", () => {
    expect(cabinetErrorFromPostgrest({ code: "23514" })).toBe("23514");
    expect(cabinetErrorFromPostgrest({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("falls back to unknown when there is no code", () => {
    expect(cabinetErrorFromPostgrest({ code: null })).toBe(CABINET_ERROR.unknown);
    expect(cabinetErrorFromPostgrest({})).toBe(CABINET_ERROR.unknown);
  });
});
