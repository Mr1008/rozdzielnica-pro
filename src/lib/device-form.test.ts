import { describe, expect, it } from "vitest";
import { DEVICE_FORM_FIELDS, formatDecimalInput, parseDeviceForm, type DeviceFormField } from "./device-form";
import type { DeviceKind, DeviceSpec } from "./device-spec";

const COMMON_FIELDS = {
  name: "Aparat testowy",
  manufacturer: "Producent",
  model: "T-1",
  price: "49,99",
  width_mm: "17,5",
  height_mm: "85",
  depth_mm: "69,5",
};

const COMMON_SPEC = {
  name: "Aparat testowy",
  manufacturer: "Producent",
  model: "T-1",
  price_grosze: 4999,
  width_mm: 17.5,
  height_mm: 85,
  depth_mm: 69.5,
};

const NO_PARAMETERS = {
  poles: null,
  rated_current_a: null,
  residual_current_ma: null,
  rcd_type: null,
  breaking_capacity_ka: null,
  terminal_groups: null,
};

type Fields = Partial<Record<DeviceFormField, string>>;

const CASES: Record<DeviceKind, { fields: Fields; spec: DeviceSpec }> = {
  switch_disconnector: {
    fields: { poles: "3P", rated_current_a: "63" },
    spec: { ...COMMON_SPEC, ...NO_PARAMETERS, kind: "switch_disconnector", poles: "3P", rated_current_a: 63 },
  },
  rcd: {
    fields: { poles: "4P", rated_current_a: "40", residual_current_ma: "30", rcd_type: "A" },
    spec: {
      ...COMMON_SPEC,
      ...NO_PARAMETERS,
      kind: "rcd",
      poles: "4P",
      rated_current_a: 40,
      residual_current_ma: 30,
      rcd_type: "A",
    },
  },
  rcbo: {
    fields: {
      poles: "1P+N",
      rated_current_a: "16",
      residual_current_ma: "30",
      rcd_type: "AC",
      breaking_capacity_ka: "6",
    },
    spec: {
      ...COMMON_SPEC,
      ...NO_PARAMETERS,
      kind: "rcbo",
      poles: "1P+N",
      rated_current_a: 16,
      residual_current_ma: 30,
      rcd_type: "AC",
      breaking_capacity_ka: 6,
    },
  },
  mcb_b: {
    fields: { poles: "1P", rated_current_a: "16", breaking_capacity_ka: "4,5" },
    spec: {
      ...COMMON_SPEC,
      ...NO_PARAMETERS,
      kind: "mcb_b",
      poles: "1P",
      rated_current_a: 16,
      breaking_capacity_ka: 4.5,
    },
  },
  pe_bar: {
    fields: { terminal_groups: JSON.stringify([{ count: 7, minMm2: 1.5, maxMm2: 16 }]) },
    spec: {
      ...COMMON_SPEC,
      ...NO_PARAMETERS,
      kind: "pe_bar",
      terminal_groups: [{ count: 7, minMm2: 1.5, maxMm2: 16 }],
    },
  },
  n_bar: {
    fields: {
      terminal_groups: JSON.stringify([
        { count: 10, minMm2: 1.5, maxMm2: 16 },
        { count: 1, minMm2: 10, maxMm2: 25 },
      ]),
    },
    spec: {
      ...COMMON_SPEC,
      ...NO_PARAMETERS,
      kind: "n_bar",
      terminal_groups: [
        { count: 10, minMm2: 1.5, maxMm2: 16 },
        { count: 1, minMm2: 10, maxMm2: 25 },
      ],
    },
  },
};

function form(kind: DeviceKind, overrides: Fields = {}): FormData {
  const values: Fields = { kind, ...COMMON_FIELDS, ...CASES[kind].fields, ...overrides };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(DEVICE_FORM_FIELDS[key as DeviceFormField], value);
  return data;
}

const INVALID = { ok: false, code: "invalid_input" };

describe("parseDeviceForm", () => {
  it("round-trips every kind into its row payload", () => {
    for (const kind of Object.keys(CASES) as DeviceKind[]) {
      expect(parseDeviceForm(form(kind), "create"), kind).toEqual({ ok: true, value: CASES[kind].spec });
    }
  });

  it("reads comma and dot decimals, and a half-module width to two places", () => {
    const result = parseDeviceForm(form("mcb_b", { width_mm: "26,25", depth_mm: "69.5", price: "12.5" }), "create");
    expect(result).toMatchObject({ ok: true, value: { width_mm: 26.25, depth_mm: 69.5, price_grosze: 1250 } });
  });

  it("rejects a decimal place beyond the column's scale instead of rounding it", () => {
    expect(parseDeviceForm(form("mcb_b", { height_mm: "85,25" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("mcb_b", { breaking_capacity_ka: "4,55" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("mcb_b", { width_mm: "26,255" }), "create")).toEqual(INVALID);
  });

  it("rejects a missing, unreadable or non-integer parameter", () => {
    expect(parseDeviceForm(form("rcd", { residual_current_ma: "" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("rcd", { rated_current_a: "40 A" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("rcd", { rated_current_a: "16,5" }), "create")).toEqual(INVALID);
    const data = form("rcd");
    data.delete(DEVICE_FORM_FIELDS.rcd_type);
    expect(parseDeviceForm(data, "create")).toEqual(INVALID);
  });

  it("rejects a pole configuration the kind is not made in, and an unknown kind", () => {
    expect(parseDeviceForm(form("rcd", { poles: "1P" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("mcb_b", { kind: "fuse" }), "create")).toEqual(INVALID);
    expect(parseDeviceForm(form("mcb_b", { kind: "" }), "create")).toEqual(INVALID);
  });

  it("ignores fields of other kinds present in the form", () => {
    const result = parseDeviceForm(
      form("mcb_b", {
        residual_current_ma: "30",
        rcd_type: "A",
        terminal_groups: JSON.stringify([{ count: 1, minMm2: 1, maxMm2: 2 }]),
      }),
      "create",
    );
    expect(result).toEqual({ ok: true, value: CASES.mcb_b.spec });
    const bar = parseDeviceForm(form("pe_bar", { poles: "2P", rated_current_a: "16" }), "create");
    expect(bar).toEqual({ ok: true, value: CASES.pe_bar.spec });
  });

  it("rejects malformed or invalid terminal-group JSON", () => {
    for (const raw of ["", "{", "not json", "null", "{}", "[]", '[{"count":0,"minMm2":1,"maxMm2":2}]']) {
      expect(parseDeviceForm(form("n_bar", { terminal_groups: raw }), "create"), raw).toEqual(INVALID);
    }
    const reversed = JSON.stringify([{ count: 2, minMm2: 16, maxMm2: 1.5 }]);
    expect(parseDeviceForm(form("n_bar", { terminal_groups: reversed }), "create")).toEqual(INVALID);
  });

  it("rejects blank text fields and an invalid price", () => {
    for (const field of ["name", "manufacturer", "model"] as const) {
      expect(parseDeviceForm(form("mcb_b", { [field]: "  " }), "create"), field).toEqual(INVALID);
    }
    for (const price of ["", "0", "12,345", "12 zł"]) {
      expect(parseDeviceForm(form("mcb_b", { price }), "create"), price).toEqual(INVALID);
    }
  });

  it("never puts kind in an update payload", () => {
    const result = parseDeviceForm(form("rcbo", { rated_current_a: "20" }), "update");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty("kind");
    const { kind: _kind, ...expected } = CASES.rcbo.spec;
    expect(result.value).toEqual({ ...expected, rated_current_a: 20 });
  });
});

describe("formatDecimalInput", () => {
  it("pre-fills decimals with a comma in a shape the parser reads back", () => {
    expect(formatDecimalInput(26.25)).toBe("26,25");
    expect(formatDecimalInput(85)).toBe("85");
    const result = parseDeviceForm(form("mcb_b", { width_mm: formatDecimalInput(52.5) }), "create");
    expect(result).toMatchObject({ ok: true, value: { width_mm: 52.5 } });
  });
});
