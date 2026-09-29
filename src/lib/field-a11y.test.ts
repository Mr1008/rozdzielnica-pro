import { describe, expect, it } from "vitest";
import { fieldControlProps, fieldErrorId, fieldHintId } from "./field-a11y";

describe("fieldControlProps", () => {
  it("describes nothing and is valid without messages", () => {
    expect(fieldControlProps("name")).toEqual({ id: "name", "aria-describedby": undefined, "aria-invalid": undefined });
  });

  it("points at the hint when there is only a hint", () => {
    expect(fieldControlProps("name", { hint: "h" })).toEqual({
      id: "name",
      "aria-describedby": "name-hint",
      "aria-invalid": undefined,
    });
  });

  it("points at the error, not the hint, and marks the control invalid", () => {
    expect(fieldControlProps("name", { hint: "h", error: "e" })).toEqual({
      id: "name",
      "aria-describedby": "name-error",
      "aria-invalid": true,
    });
  });

  it("builds the ids the messages carry", () => {
    expect(fieldHintId("x")).toBe("x-hint");
    expect(fieldErrorId("x")).toBe("x-error");
  });
});
