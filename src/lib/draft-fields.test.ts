import { describe, expect, it } from "vitest";
import { draftKeySchema, fieldFromNumber, newDraftKey, numberFromField } from "./draft-fields";

describe("numberFromField", () => {
  it("reads plain decimals with either separator", () => {
    expect(numberFromField("12")).toBe(12);
    expect(numberFromField(" 1,5 ")).toBe(1.5);
    expect(numberFromField("2.5")).toBe(2.5);
    expect(numberFromField("-3")).toBe(-3);
  });

  it("is NaN for anything else, so the validators flag the field", () => {
    for (const raw of ["", " ", "1e3", "12 mm", "0x10", ","]) expect(numberFromField(raw), raw).toBeNaN();
  });
});

describe("fieldFromNumber", () => {
  it("writes decimals with a comma and round-trips through numberFromField", () => {
    expect(fieldFromNumber(26.25)).toBe("26,25");
    expect(fieldFromNumber(12)).toBe("12");
    expect(numberFromField(fieldFromNumber(52.5))).toBe(52.5);
  });
});

describe("draft keys", () => {
  it("are unique, and a restored key is always re-minted", () => {
    const minted = [newDraftKey(), newDraftKey()];
    const restored = [draftKeySchema.parse(minted[0]), draftKeySchema.parse(undefined)];
    const keys = [...minted, ...restored];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
