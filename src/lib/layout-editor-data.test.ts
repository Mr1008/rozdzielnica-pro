import { describe, expect, it } from "vitest";
import { layoutIssueNames, toEditorDevices } from "./layout-editor-data";

const ROW = {
  id: "d1",
  position: 0,
  role: "mcb",
  rcd_group_id: "g1",
  circuit_id: "c1",
  kind: "mcb_b" as const,
  width_mm: 17.5,
  height_mm: 85,
  poles: "1P" as const,
  n_terminal_side: null,
  rated_current_a: 16,
  residual_current_ma: null,
  terminal_groups: null,
};

describe("toEditorDevices", () => {
  it("keeps only the fields the editor reads", () => {
    const row = { ...ROW, price_grosze: 1850, manufacturer: "X", notes: [] };
    expect(toEditorDevices([row])).toEqual([ROW]);
  });
});

describe("layoutIssueNames", () => {
  const groups = [{ id: "g1", label: "Kuchnia" }];
  const circuits = [{ id: "c1", name: "Gniazda kuchnia" }];

  it("names an MCB by its rating and circuit", () => {
    expect(layoutIssueNames([ROW], groups, circuits).devices.d1).toBe("B16 Gniazda kuchnia");
  });

  it("names an RCD by its ratings and group, and the main switch by its rating alone", () => {
    const rcd = { ...ROW, id: "d2", role: "rcd", circuit_id: null, rated_current_a: 40, residual_current_ma: 30 };
    const fr = { ...ROW, id: "d3", role: "main_switch", rcd_group_id: null, circuit_id: null, rated_current_a: 40 };
    const names = layoutIssueNames([rcd, fr], groups, circuits);
    expect(names.devices.d2).toBe("RCD 40A 30mA Kuchnia");
    expect(names.devices.d3).toBe("FR 40A");
  });

  it("names a catalog bar by its role and gives the group labels by id", () => {
    const bar = { ...ROW, id: "d4", role: "pe_bar", rcd_group_id: null, circuit_id: null, rated_current_a: null };
    const names = layoutIssueNames([bar], groups, circuits);
    expect(names.devices.d4).toBe("Szyna PE (z katalogu)");
    expect(names.groups).toEqual({ g1: "Kuchnia" });
  });
});
