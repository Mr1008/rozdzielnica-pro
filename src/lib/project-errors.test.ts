import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { PROJECT_ERROR, projectErrorFromPostgrest, projectErrorMessage } from "./project-errors";

describe("projectErrorMessage", () => {
  it("returns null when there is no error", () => {
    expect(projectErrorMessage(null)).toBeNull();
    expect(projectErrorMessage(undefined)).toBeNull();
    expect(projectErrorMessage("")).toBeNull();
  });

  it.each(Object.values(PROJECT_ERROR))("has a Polish message for %s", (code) => {
    const message = projectErrorMessage(code);
    expect(message).toBeTruthy();
    expect(message).not.toContain(code);
  });

  it("maps the codes to their own messages", () => {
    expect(projectErrorMessage(PROJECT_ERROR.notConfigured)).toBe(t.projectErrors.notConfigured);
    expect(projectErrorMessage(PROJECT_ERROR.forbidden)).toBe(t.projectErrors.forbidden);
    expect(projectErrorMessage(PROJECT_ERROR.notFound)).toBe(t.projectErrors.notFound);
    expect(projectErrorMessage(PROJECT_ERROR.invalidInput)).toBe(t.projectErrors.invalidInput);
    expect(projectErrorMessage(PROJECT_ERROR.cabinetUnavailable)).toBe(t.projectErrors.cabinetUnavailable);
  });

  it("shows the generic message for an unrecognised code, including inherited object keys", () => {
    expect(projectErrorMessage("PGRST204")).toBe(t.projectErrors.unknown);
    expect(projectErrorMessage("toString")).toBe(t.projectErrors.unknown);
  });
});

describe("projectErrorFromPostgrest", () => {
  it("maps an RLS refusal of an insert to forbidden", () => {
    expect(projectErrorFromPostgrest({ code: "42501" })).toBe(PROJECT_ERROR.forbidden);
  });

  it("maps a CHECK violation to invalid input", () => {
    expect(projectErrorFromPostgrest({ code: "23514" })).toBe(PROJECT_ERROR.invalidInput);
  });

  it("maps a missing or archived cabinet to cabinet unavailable", () => {
    expect(projectErrorFromPostgrest({ code: "P0002" })).toBe(PROJECT_ERROR.cabinetUnavailable);
  });

  it("does not label a foreign-key violation as a cabinet problem", () => {
    // The trigger raises P0002 for a missing cabinet first; a 23503 can only be another key.
    expect(projectErrorFromPostgrest({ code: "23503" })).toBe("23503");
  });

  it("passes an unmapped code through so the URL stays diagnosable", () => {
    expect(projectErrorFromPostgrest({ code: "23505" })).toBe("23505");
    expect(projectErrorFromPostgrest({ code: "PGRST204" })).toBe("PGRST204");
  });

  it("falls back to unknown when there is no code", () => {
    expect(projectErrorFromPostgrest({ code: null })).toBe(PROJECT_ERROR.unknown);
    expect(projectErrorFromPostgrest({})).toBe(PROJECT_ERROR.unknown);
  });
});
