import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/i18n";
import { CABINET_FORM_FIELDS, formatPriceInput, parseCabinetForm, parsePriceGrosze } from "./cabinet-form";
import type { CabinetGeometry } from "./cabinet-geometry";

const GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 400, heightMm: 300, depthMm: 100 },
  rails: [{ xMm: 0, yMm: 100, lengthMm: 400 }],
  entries: [{ side: "top", offsetMm: 0, lengthMm: 400 }],
  bars: [],
};

function form(overrides: Partial<Record<keyof typeof CABINET_FORM_FIELDS, string>> = {}): FormData {
  const values = {
    name: "Szafka testowa",
    manufacturer: "Producent",
    model: "T-1",
    price: "249,99",
    geometry: JSON.stringify(GEOMETRY),
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

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

describe("parseCabinetForm", () => {
  it("returns a trimmed payload in grosze with the parsed geometry", () => {
    const result = parseCabinetForm(form({ name: "  Szafka  ", manufacturer: " Producent ", model: " T-1 " }));
    expect(result).toEqual({
      ok: true,
      value: { name: "Szafka", manufacturer: "Producent", model: "T-1", price_grosze: 24999, geometry: GEOMETRY },
    });
  });

  it("rejects a blank text field", () => {
    for (const field of ["name", "manufacturer", "model"] as const) {
      expect(parseCabinetForm(form({ [field]: "   " })), field).toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("rejects a missing field", () => {
    const data = form();
    data.delete(CABINET_FORM_FIELDS.model);
    expect(parseCabinetForm(data)).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects an invalid price", () => {
    expect(parseCabinetForm(form({ price: "0" })).ok).toBe(false);
    expect(parseCabinetForm(form({ price: "12,345" })).ok).toBe(false);
  });

  it("rejects malformed geometry JSON", () => {
    for (const raw of ["", "{", "not json", "null", "[]", '"text"'])
      expect(parseCabinetForm(form({ geometry: raw })), raw).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects geometry that parses as JSON but breaks a rule", () => {
    const outside = { ...GEOMETRY, rails: [{ xMm: 0, yMm: 290, lengthMm: 400 }] };
    expect(parseCabinetForm(form({ geometry: JSON.stringify(outside) })).ok).toBe(false);
  });
});
