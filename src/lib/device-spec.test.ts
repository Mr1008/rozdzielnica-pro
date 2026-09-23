import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  DEVICE_FIELDS,
  DEVICE_ISSUE_CODES,
  DEVICE_KINDS,
  DEVICE_PARAMETERS,
  PARAMETERS_BY_KIND,
  POLES_BY_KIND,
  deviceIssueMessage,
  deviceKindLabel,
  deviceSpecSchema,
  parseDeviceSpec,
  type DeviceIssue,
  type DeviceKind,
} from "./device-spec";

const COMMON = {
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

const VALID: Record<DeviceKind, Record<string, unknown>> = {
  switch_disconnector: { ...COMMON, ...NO_PARAMETERS, kind: "switch_disconnector", poles: "3P", rated_current_a: 63 },
  rcd: {
    ...COMMON,
    ...NO_PARAMETERS,
    kind: "rcd",
    poles: "4P",
    rated_current_a: 40,
    residual_current_ma: 30,
    rcd_type: "A",
  },
  rcbo: {
    ...COMMON,
    ...NO_PARAMETERS,
    kind: "rcbo",
    poles: "1P+N",
    rated_current_a: 16,
    residual_current_ma: 30,
    rcd_type: "AC",
    breaking_capacity_ka: 6,
  },
  mcb_b: { ...COMMON, ...NO_PARAMETERS, kind: "mcb_b", poles: "1P", rated_current_a: 16, breaking_capacity_ka: 6 },
  pe_bar: {
    ...COMMON,
    ...NO_PARAMETERS,
    kind: "pe_bar",
    terminal_groups: [{ count: 7, minMm2: 1.5, maxMm2: 16 }],
  },
  n_bar: {
    ...COMMON,
    ...NO_PARAMETERS,
    kind: "n_bar",
    terminal_groups: [
      { count: 10, minMm2: 1.5, maxMm2: 16 },
      { count: 1, minMm2: 10, maxMm2: 25 },
    ],
  },
};

function issuesOf(input: unknown): DeviceIssue[] {
  const result = parseDeviceSpec(input);
  return result.ok ? [] : result.issues;
}

describe("the parameter matrix", () => {
  it("lists kinds in display order", () => {
    expect(DEVICE_KINDS).toEqual(["switch_disconnector", "rcd", "rcbo", "mcb_b", "pe_bar", "n_bar"]);
  });

  it("matches the plan's pole sets", () => {
    expect(POLES_BY_KIND).toEqual({
      switch_disconnector: ["1P", "2P", "3P", "4P"],
      rcd: ["2P", "4P"],
      rcbo: ["1P+N", "2P", "3P+N", "4P"],
      mcb_b: ["1P", "1P+N", "2P", "3P", "3P+N", "4P"],
      pe_bar: [],
      n_bar: [],
    });
  });

  it("gives poles exactly to the kinds that have a pole set", () => {
    for (const kind of DEVICE_KINDS) {
      expect((PARAMETERS_BY_KIND[kind] as readonly string[]).includes("poles"), kind).toBe(
        POLES_BY_KIND[kind].length > 0,
      );
    }
  });
});

describe("parseDeviceSpec — valid devices", () => {
  it.each(DEVICE_KINDS)("accepts a valid %s", (kind) => {
    const result = parseDeviceSpec(VALID[kind]);
    expect(result).toEqual({ ok: true, spec: VALID[kind] });
    expect(deviceSpecSchema.safeParse(VALID[kind]).success).toBe(true);
  });

  it("trims text fields", () => {
    const result = parseDeviceSpec({ ...VALID.mcb_b, name: "  MCB  ", manufacturer: " P ", model: " M " });
    expect(result.ok && [result.spec.name, result.spec.manufacturer, result.spec.model]).toEqual(["MCB", "P", "M"]);
  });

  it("treats a missing foreign parameter as null and ignores unrelated row columns", () => {
    const { breaking_capacity_ka: _dropped, ...rest } = VALID.rcd;
    const result = parseDeviceSpec({ ...rest, id: "abc", archived_at: null });
    expect(result).toEqual({ ok: true, spec: VALID.rcd });
  });

  it("accepts one decimal place, including values with binary noise", () => {
    expect(parseDeviceSpec({ ...VALID.mcb_b, depth_mm: 35.3, breaking_capacity_ka: 4.5 }).ok).toBe(true);
    expect(parseDeviceSpec({ ...VALID.mcb_b, width_mm: 0.1 * 3 }).ok).toBe(true);
  });
});

describe("parseDeviceSpec — one failure per issue code", () => {
  const cases: [DeviceIssueCase: string, input: unknown, expected: DeviceIssue][] = [
    ["malformed (not an object)", "device", { field: "kind", code: "malformed" }],
    [
      "malformed (a number field holds text)",
      { ...VALID.mcb_b, height_mm: "85" },
      { field: "height_mm", code: "malformed" },
    ],
    ["required (blank text)", { ...VALID.mcb_b, name: "   " }, { field: "name", code: "required" }],
    ["required (missing parameter)", { ...VALID.rcd, rcd_type: null }, { field: "rcd_type", code: "required" }],
    ["invalid_kind", { ...VALID.mcb_b, kind: "mcb_c" }, { field: "kind", code: "invalid_kind" }],
    ["price_invalid", { ...VALID.mcb_b, price_grosze: 0 }, { field: "price_grosze", code: "price_invalid" }],
    ["not_positive", { ...VALID.mcb_b, width_mm: 0 }, { field: "width_mm", code: "not_positive" }],
    ["not_integer", { ...VALID.rcd, residual_current_ma: 30.5 }, { field: "residual_current_ma", code: "not_integer" }],
    ["too_many_decimals", { ...VALID.mcb_b, width_mm: 17.555 }, { field: "width_mm", code: "too_many_decimals" }],
    ["pole_not_allowed", { ...VALID.mcb_b, poles: "5P" }, { field: "poles", code: "pole_not_allowed" }],
    ["invalid_rcd_type", { ...VALID.rcd, rcd_type: "S" }, { field: "rcd_type", code: "invalid_rcd_type" }],
    [
      "no_terminal_groups",
      { ...VALID.pe_bar, terminal_groups: [] },
      { field: "terminal_groups", code: "no_terminal_groups" },
    ],
    [
      "terminal_count_invalid",
      { ...VALID.pe_bar, terminal_groups: [{ count: 0, minMm2: 1.5, maxMm2: 16 }] },
      { field: "terminal_groups", code: "terminal_count_invalid" },
    ],
    [
      "terminal_range_invalid",
      { ...VALID.pe_bar, terminal_groups: [{ count: 4, minMm2: 16, maxMm2: 1.5 }] },
      { field: "terminal_groups", code: "terminal_range_invalid" },
    ],
    [
      "foreign_parameter",
      { ...VALID.mcb_b, residual_current_ma: 30 },
      { field: "residual_current_ma", code: "foreign_parameter" },
    ],
  ];

  it("covers every issue code", () => {
    expect(new Set(cases.map(([, , issue]) => issue.code))).toEqual(new Set(DEVICE_ISSUE_CODES));
  });

  it.each(cases)("%s", (_label, input, expected) => {
    expect(issuesOf(input)).toEqual([expected]);
  });
});

describe("parseDeviceSpec — per-kind rules", () => {
  it("rejects a pole configuration outside the kind's set", () => {
    expect(issuesOf({ ...VALID.rcd, poles: "1P" })).toEqual([{ field: "poles", code: "pole_not_allowed" }]);
    expect(issuesOf({ ...VALID.rcbo, poles: "1P" })).toEqual([{ field: "poles", code: "pole_not_allowed" }]);
    expect(issuesOf({ ...VALID.switch_disconnector, poles: "1P+N" })).toEqual([
      { field: "poles", code: "pole_not_allowed" },
    ]);
  });

  it("rejects a second decimal place rather than rounding it", () => {
    expect(issuesOf({ ...VALID.mcb_b, breaking_capacity_ka: 6.25 })).toEqual([
      { field: "breaking_capacity_ka", code: "too_many_decimals" },
    ]);
    expect(issuesOf({ ...VALID.mcb_b, depth_mm: 69.55 })).toEqual([{ field: "depth_mm", code: "too_many_decimals" }]);
  });

  it("accepts half-module widths to two decimals, but not a third", () => {
    expect(issuesOf({ ...VALID.mcb_b, width_mm: 26.25 })).toEqual([]);
    expect(issuesOf({ ...VALID.mcb_b, width_mm: 43.75 })).toEqual([]);
    expect(issuesOf({ ...VALID.mcb_b, width_mm: 26.255 })).toEqual([{ field: "width_mm", code: "too_many_decimals" }]);
    expect(issuesOf({ ...VALID.mcb_b, height_mm: 85.25 })).toEqual([{ field: "height_mm", code: "too_many_decimals" }]);
  });

  it("names the allowed decimal places in the message", () => {
    expect(deviceIssueMessage({ field: "width_mm", code: "too_many_decimals" })).toContain("2 miejsca");
    expect(deviceIssueMessage({ field: "depth_mm", code: "too_many_decimals" })).toContain("jedno miejsce");
  });

  it("rejects a parameter that belongs to another kind, for every kind", () => {
    const foreignValue: Record<(typeof DEVICE_PARAMETERS)[number], unknown> = {
      poles: "2P",
      rated_current_a: 16,
      residual_current_ma: 30,
      rcd_type: "A",
      breaking_capacity_ka: 6,
      terminal_groups: [{ count: 1, minMm2: 1.5, maxMm2: 16 }],
    };
    for (const kind of DEVICE_KINDS) {
      const own: readonly string[] = PARAMETERS_BY_KIND[kind];
      for (const field of DEVICE_PARAMETERS.filter((parameter) => !own.includes(parameter))) {
        expect(issuesOf({ ...VALID[kind], [field]: foreignValue[field] }), `${kind}.${field}`).toEqual([
          { field, code: "foreign_parameter" },
        ]);
      }
    }
  });

  it("rejects a non-integer rated current", () => {
    expect(issuesOf({ ...VALID.mcb_b, rated_current_a: 16.5 })).toEqual([
      { field: "rated_current_a", code: "not_integer" },
    ]);
  });

  it("reports every problem at once", () => {
    expect(issuesOf({ ...VALID.rcd, model: "", width_mm: -1, rcd_type: "X", terminal_groups: [] })).toEqual([
      { field: "model", code: "required" },
      { field: "width_mm", code: "not_positive" },
      { field: "rcd_type", code: "invalid_rcd_type" },
      { field: "terminal_groups", code: "foreign_parameter" },
    ]);
  });

  it("still checks the common fields when the kind is unknown", () => {
    expect(issuesOf({ ...COMMON, kind: undefined, price_grosze: -5 })).toEqual([
      { field: "kind", code: "invalid_kind" },
      { field: "price_grosze", code: "price_invalid" },
    ]);
  });
});

describe("deviceIssueMessage", () => {
  it("has a Polish message for every code on every field", () => {
    for (const code of DEVICE_ISSUE_CODES) {
      for (const field of DEVICE_FIELDS) {
        const message = deviceIssueMessage({ field, code });
        expect(message, `${field}:${code}`).toMatch(/\S/);
      }
    }
  });

  it("names the field the issue is on", () => {
    expect(deviceIssueMessage({ field: "rated_current_a", code: "required" })).toContain(
      t.devices.fields.ratedCurrentA,
    );
    expect(deviceIssueMessage({ field: "width_mm", code: "too_many_decimals" })).toContain(t.devices.fields.width);
  });
});

describe("deviceKindLabel", () => {
  it("labels every kind", () => {
    expect(DEVICE_KINDS.map(deviceKindLabel)).toEqual([
      "Rozłącznik izolacyjny (FR)",
      "Wyłącznik różnicowoprądowy (RCD)",
      "Wyłącznik różnicowonadprądowy (RCBO)",
      "Wyłącznik nadprądowy B (MCB)",
      "Szyna PE",
      "Szyna N",
    ]);
  });
});

describe("t.devices.catalog.width", () => {
  it("shows modules with millimetres, or millimetres alone", () => {
    expect(t.devices.catalog.width(2, 35)).toBe("2 TE (35 mm)");
    expect(t.devices.catalog.width(1.5, 26.25)).toBe("1,5 TE (26,25 mm)");
    expect(t.devices.catalog.width(null, 36)).toBe("36 mm");
  });
});
