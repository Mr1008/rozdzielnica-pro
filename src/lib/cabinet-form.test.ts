import { describe, expect, it } from "vitest";
import { CABINET_FORM_FIELDS, parseCabinetForm } from "./cabinet-form";
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
