import { describe, expect, it } from "vitest";
import {
  deviceDraftSchema,
  draftFromRow,
  formValuesFromDraft,
  widthMmFromDraft,
  withKind,
  withWidthUnit,
  type DeviceDraft,
} from "./device-draft";
import { deviceCandidate, type DeviceRow } from "./device-form";
import { parseDeviceSpec } from "./device-spec";

const MCB: DeviceRow = {
  id: "00000000-0000-0000-0000-000000000001",
  kind: "mcb_b",
  name: "S301 B16",
  manufacturer: "Producent",
  model: "S301-B16",
  price_grosze: 1899,
  width_mm: 17.5,
  height_mm: 85,
  depth_mm: 69.5,
  poles: "1P",
  rated_current_a: 16,
  residual_current_ma: null,
  rcd_type: null,
  breaking_capacity_ka: 6,
  terminal_groups: null,
};

const N_BAR: DeviceRow = {
  ...MCB,
  kind: "n_bar",
  width_mm: 36,
  poles: null,
  rated_current_a: null,
  breaking_capacity_ka: null,
  terminal_groups: [{ count: 10, minMm2: 1.5, maxMm2: 16 }],
};

function judge(draft: DeviceDraft) {
  return parseDeviceSpec(deviceCandidate(formValuesFromDraft(draft)));
}

describe("draftFromRow", () => {
  it("pre-fills a stored row so it parses back to the same spec", () => {
    for (const row of [MCB, N_BAR]) {
      const { id: _id, ...spec } = row;
      expect(judge(draftFromRow(row)), row.kind).toEqual({ ok: true, spec });
    }
  });

  it("opens a half-module width in modules and any other width in millimetres", () => {
    expect(draftFromRow(MCB)).toMatchObject({ width: "1", widthUnit: "modules" });
    expect(draftFromRow({ ...MCB, width_mm: 26.25 })).toMatchObject({ width: "1,5", widthUnit: "modules" });
    expect(draftFromRow(N_BAR)).toMatchObject({ width: "36", widthUnit: "mm" });
  });

  it("starts a new device with no kind, in modules", () => {
    expect(draftFromRow()).toMatchObject({ kind: "", widthUnit: "modules", terminalGroups: [] });
  });
});

describe("width", () => {
  const draft = (width: string, widthUnit: DeviceDraft["widthUnit"]) => ({ ...draftFromRow(MCB), width, widthUnit });

  it("submits a module count as millimetres", () => {
    expect(widthMmFromDraft(draft("3", "modules"))).toEqual({ mm: "52,5", stepInvalid: false });
    expect(widthMmFromDraft(draft("1,5", "modules"))).toEqual({ mm: "26,25", stepInvalid: false });
    expect(widthMmFromDraft(draft("36", "mm"))).toEqual({ mm: "36", stepInvalid: false });
  });

  it("flags a module count that is not a 0.5 step", () => {
    expect(widthMmFromDraft(draft("1,25", "modules"))).toEqual({ mm: "", stepInvalid: true });
    expect(widthMmFromDraft(draft("", "modules")).stepInvalid).toBe(false);
  });

  it("converts on a unit switch, and clears a value with no exact counterpart", () => {
    expect(withWidthUnit(draft("3", "modules"), "mm").width).toBe("52,5");
    expect(withWidthUnit(draft("52,5", "mm"), "modules").width).toBe("3");
    expect(withWidthUnit(draft("36", "mm"), "modules").width).toBe("");
    expect(withWidthUnit(draft("1,25", "modules"), "mm").width).toBe("");
  });
});

describe("withKind", () => {
  it("clears the previous kind's parameters and gives a bar one terminal group", () => {
    const mcb = draftFromRow(MCB);
    const bar = withKind(mcb, "pe_bar");
    expect(bar).toMatchObject({ kind: "pe_bar", poles: "", ratedCurrentA: "", breakingCapacityKa: "", name: mcb.name });
    expect(bar.terminalGroups).toHaveLength(1);
    expect(judge(bar).ok).toBe(true);
    expect(withKind(bar, "rcd").terminalGroups).toEqual([]);
    expect(withKind(mcb, "mcb_b")).toBe(mcb);
  });
});

describe("stored draft", () => {
  it("survives JSON storage and the restore schema", () => {
    const draft = draftFromRow(N_BAR);
    const restored = deviceDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(formValuesFromDraft(restored)).toEqual(formValuesFromDraft(draft));
    expect(deviceDraftSchema.safeParse({ ...draft, kind: "fuse" }).success).toBe(false);
  });
});
