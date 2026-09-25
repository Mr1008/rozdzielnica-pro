import { describe, expect, it } from "vitest";
import {
  CONDUCTOR_MATERIALS,
  EARTHING_SYSTEMS,
  MAX_WLZ_LENGTH_M,
  PHASE_COUNTS,
  PREMETER_PROTECTIONS_A,
  SUPPLY_FIELDS,
  WLZ_CROSS_SECTIONS_MM2,
  WLZ_INSTALLATIONS,
  WLZ_LENGTH_INPUT_PATTERN,
  parseSupplyForm,
  supplyFormDefaults,
  supplyFromRow,
  type SupplyColumn,
  type SupplyParams,
  type SupplyRow,
} from "./supply-params";

/**
 * The parser must reject exactly what the `projects` supply CHECKs and enums reject — these cases
 * pin every list and bound on the TypeScript side; `tests/integration/rls-projects.test.ts` pins the
 * database side.
 */

const VALID: Record<SupplyColumn, string> = {
  premeter_protection_a: "25",
  earthing_system: "TN-C-S",
  phase_count: "1",
  wlz_length_m: "15",
  wlz_cross_section_mm2: "10",
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

const VALID_VALUE: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-C-S",
  phase_count: 1,
  wlz_length_m: 15,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

const UNSET: SupplyRow = {
  premeter_protection_a: null,
  earthing_system: null,
  phase_count: null,
  wlz_length_m: null,
  wlz_cross_section_mm2: null,
  wlz_material: null,
  wlz_installation: null,
};

function form(fields: Partial<Record<SupplyColumn, string>>, omit: SupplyColumn[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...VALID, ...fields })) {
    if (!omit.includes(name as SupplyColumn)) data.set(name, value);
  }
  return data;
}

function parsedValue(fields: Partial<Record<SupplyColumn, string>>) {
  const result = parseSupplyForm(form(fields));
  return result.ok ? result.value : null;
}

describe("supply value lists", () => {
  it("match the migration's CHECKs and enums", () => {
    expect(PREMETER_PROTECTIONS_A).toEqual([16, 20, 25, 32, 40, 50, 63]);
    expect(EARTHING_SYSTEMS).toEqual(["TN-C", "TN-S", "TN-C-S", "TT"]);
    expect(PHASE_COUNTS).toEqual([1, 3]);
    expect(WLZ_CROSS_SECTIONS_MM2).toEqual([2.5, 4, 6, 10, 16, 25, 35]);
    expect(CONDUCTOR_MATERIALS).toEqual(["Cu", "Al"]);
    expect(WLZ_INSTALLATIONS).toEqual(["surface", "conduit_surface", "conduit_flush", "in_wall", "in_ground"]);
    expect(MAX_WLZ_LENGTH_M).toBe(500);
  });

  it("name the form fields after the columns", () => {
    expect(Object.values(SUPPLY_FIELDS).sort()).toEqual(Object.keys(VALID).sort());
  });
});

describe("parseSupplyForm", () => {
  it("turns a valid form into the column shape", () => {
    expect(parseSupplyForm(form({}))).toEqual({ ok: true, value: VALID_VALUE });
  });

  it("accepts every list value", () => {
    for (const value of PREMETER_PROTECTIONS_A) {
      expect(parsedValue({ premeter_protection_a: String(value) })?.premeter_protection_a).toBe(value);
    }
    for (const value of EARTHING_SYSTEMS) {
      expect(parsedValue({ earthing_system: value })?.earthing_system).toBe(value);
    }
    for (const value of PHASE_COUNTS) {
      expect(parsedValue({ phase_count: String(value) })?.phase_count).toBe(value);
    }
    for (const value of WLZ_CROSS_SECTIONS_MM2) {
      expect(parsedValue({ wlz_cross_section_mm2: String(value) })?.wlz_cross_section_mm2).toBe(value);
    }
    for (const value of CONDUCTOR_MATERIALS) {
      expect(parsedValue({ wlz_material: value })?.wlz_material).toBe(value);
    }
    for (const value of WLZ_INSTALLATIONS) {
      expect(parsedValue({ wlz_installation: value })?.wlz_installation).toBe(value);
    }
  });

  it("rejects a value just outside each list", () => {
    const cases: Partial<Record<SupplyColumn, string>>[] = [
      { premeter_protection_a: "15" },
      { premeter_protection_a: "30" },
      { premeter_protection_a: "64" },
      { premeter_protection_a: "25.0" },
      { earthing_system: "IT" },
      { earthing_system: "tn-c" },
      { earthing_system: "TNC" },
      { phase_count: "2" },
      { phase_count: "0" },
      { wlz_cross_section_mm2: "1.5" },
      { wlz_cross_section_mm2: "2,5" },
      { wlz_cross_section_mm2: "50" },
      { wlz_cross_section_mm2: "10.5" },
      { wlz_material: "cu" },
      { wlz_material: "Fe" },
      { wlz_installation: "overhead" },
      { wlz_installation: "Surface" },
    ];
    for (const patch of cases) {
      expect(parseSupplyForm(form(patch)), JSON.stringify(patch)).toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("enforces the length bounds 0 < L ≤ 500 with at most one decimal place", () => {
    expect(parsedValue({ wlz_length_m: "0" })).toBeNull();
    expect(parsedValue({ wlz_length_m: "0,0" })).toBeNull();
    expect(parsedValue({ wlz_length_m: "0,1" })?.wlz_length_m).toBe(0.1);
    expect(parsedValue({ wlz_length_m: "500" })?.wlz_length_m).toBe(500);
    expect(parsedValue({ wlz_length_m: "500,0" })?.wlz_length_m).toBe(500);
    expect(parsedValue({ wlz_length_m: "500,1" })).toBeNull();
    expect(parsedValue({ wlz_length_m: "12,34" })).toBeNull();
    expect(parsedValue({ wlz_length_m: "-1" })).toBeNull();
  });

  it("accepts a comma or a dot in the length, after trimming", () => {
    expect(parsedValue({ wlz_length_m: "12,5" })?.wlz_length_m).toBe(12.5);
    expect(parsedValue({ wlz_length_m: "12.5" })?.wlz_length_m).toBe(12.5);
    expect(parsedValue({ wlz_length_m: " 12,5 " })?.wlz_length_m).toBe(12.5);
    for (const length of ["12,", ",5", "12 m", "1e2", "+5", "1 000", "", " "]) {
      expect(parsedValue({ wlz_length_m: length }), length).toBeNull();
    }
  });

  it("rejects a form missing any field", () => {
    for (const field of Object.keys(VALID) as SupplyColumn[]) {
      expect(parseSupplyForm(form({}, [field])), field).toEqual({ ok: false, code: "invalid_input" });
    }
  });

  it("rejects a file where a text field is expected", () => {
    const data = form({});
    data.set("wlz_length_m", new Blob(["15"]));
    expect(parseSupplyForm(data)).toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("WLZ_LENGTH_INPUT_PATTERN", () => {
  it("accepts the same shapes as the parser", () => {
    const pattern = new RegExp(`^(?:${WLZ_LENGTH_INPUT_PATTERN})$`);
    for (const length of ["15", "12,5", "12.5", "0", "500,1"]) expect(pattern.test(length), length).toBe(true);
    for (const length of ["12,34", "-1", "12,", "1e2"]) expect(pattern.test(length), length).toBe(false);
  });
});

describe("supplyFromRow", () => {
  it("is null when the supply is not configured", () => {
    expect(supplyFromRow(UNSET)).toBeNull();
  });

  it("is null for a partial or off-list row", () => {
    expect(supplyFromRow({ ...UNSET, premeter_protection_a: 25 })).toBeNull();
    expect(supplyFromRow({ ...VALID_VALUE, premeter_protection_a: 30 })).toBeNull();
  });

  it("returns the seven values of a configured row", () => {
    expect(supplyFromRow(VALID_VALUE)).toEqual(VALID_VALUE);
  });
});

describe("supplyFormDefaults", () => {
  it("returns empty strings when nothing is configured", () => {
    for (const row of [null, UNSET]) {
      expect(Object.values(supplyFormDefaults(row)).every((value) => value === "")).toBe(true);
      expect(Object.keys(supplyFormDefaults(row)).sort()).toEqual(Object.keys(VALID).sort());
    }
  });

  it("pre-fills a stored row in a shape the parser accepts unchanged", () => {
    const row = { ...VALID_VALUE, wlz_length_m: 12.5, wlz_cross_section_mm2: 2.5 };
    const defaults = supplyFormDefaults(row);

    expect(defaults.wlz_length_m).toBe("12,5");
    expect(defaults.wlz_cross_section_mm2).toBe("2.5");
    expect(parseSupplyForm(form(defaults))).toEqual({ ok: true, value: row });
  });

  it("round-trips every list value", () => {
    for (const wlz_cross_section_mm2 of WLZ_CROSS_SECTIONS_MM2) {
      for (const premeter_protection_a of PREMETER_PROTECTIONS_A) {
        const row = { ...VALID_VALUE, wlz_cross_section_mm2, premeter_protection_a, wlz_length_m: 500 };
        expect(parseSupplyForm(form(supplyFormDefaults(row)))).toEqual({ ok: true, value: row });
      }
    }
  });
});
