import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/i18n";
import { formatPriceInput, parsePriceGrosze } from "./price-input";

describe("parsePriceGrosze", () => {
  it("accepts a comma or a dot as the decimal separator", () => {
    expect(parsePriceGrosze("12,5")).toBe(1250);
    expect(parsePriceGrosze("12.5")).toBe(1250);
    expect(parsePriceGrosze("12,05")).toBe(1205);
    expect(parsePriceGrosze("249,99")).toBe(24999);
  });

  it("accepts whole złote and surrounding whitespace", () => {
    expect(parsePriceGrosze("12")).toBe(1200);
    expect(parsePriceGrosze("  7,10 ")).toBe(710);
    expect(parsePriceGrosze("0,01")).toBe(1);
  });

  it("rejects zero, negatives and non-numbers", () => {
    for (const raw of ["0", "0,00", "-1", "-1,50", "abc", "", " ", "12,", ",5", "1e3", "12 zł"]) {
      expect(parsePriceGrosze(raw), raw).toBeNull();
    }
  });

  it("rejects a third decimal and thousands separators", () => {
    expect(parsePriceGrosze("12,345")).toBeNull();
    expect(parsePriceGrosze("1 234,56")).toBeNull();
    expect(parsePriceGrosze("1.234,56")).toBeNull();
  });

  it("rejects an amount that overflows the integer column", () => {
    expect(parsePriceGrosze("21474836,47")).toBe(2_147_483_647);
    expect(parsePriceGrosze("21474836,48")).toBeNull();
  });
});

describe("formatPriceInput", () => {
  it("renders a plain decimal with a comma", () => {
    expect(formatPriceInput(123456)).toBe("1234,56");
    expect(formatPriceInput(100)).toBe("1,00");
    expect(formatPriceInput(5)).toBe("0,05");
  });

  it("round-trips through the parser", () => {
    for (const grosze of [1, 5, 100, 1250, 24999, 123456]) {
      expect(parsePriceGrosze(formatPriceInput(grosze))).toBe(grosze);
    }
  });

  it("differs from formatMoney, whose output the parser rejects", () => {
    expect(parsePriceGrosze(formatMoney(1234.56))).toBeNull();
  });
});
