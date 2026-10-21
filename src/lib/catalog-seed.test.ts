import { describe, expect, it } from "vitest";
import eatonRows from "../../supabase/catalog/source/eaton.json";
import legrandRows from "../../supabase/catalog/source/legrand.json";
import { buildCatalogDevices, renderCatalogSql, CATALOG_MANUFACTURERS } from "@/lib/catalog-seed";
import { DEVICE_FIELDS, DEVICE_KINDS, POLE_CONFIGS, parseDeviceSpec, polesCarryN } from "@/lib/device-spec";
import type { DeviceSpec } from "@/lib/device-spec";

const devices = buildCatalogDevices();
const sourceRows = [...eatonRows, ...legrandRows] as { manufacturer: string; model: string; series: string }[];
const seriesByModel = new Map(sourceRows.map((r) => [`${r.manufacturer}|${r.model}`, r.series]));
const seriesOf = (d: DeviceSpec) => seriesByModel.get(`${d.manufacturer}|${d.model}`) ?? "";

/** Every series the source files carry; a new or excluded series must be added here on purpose. */
const ALLOWED_SERIES: Record<(typeof CATALOG_MANUFACTURERS)[number], readonly string[]> = {
  Eaton: ["PL6", "PF6", "PFL6", "FRBm6", "IS", "EVG", "KL", "SK-KLV", "BFZ-TS-KL"],
  Legrand: [
    "S301 DX3",
    "S301N DX3",
    "S302 DX3",
    "S303 DX3",
    "S304 DX3",
    "P 302 DX3",
    "P 304 DX3",
    "P 312 DX3",
    "FR 300",
    "HX3 prong-type",
    "HX3 fork-type",
    "Listwy przyłączeniowe",
  ],
};

const poleRank = (d: DeviceSpec) => (d.poles === null ? -1 : POLE_CONFIGS.indexOf(d.poles));

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

describe("catalog seed", () => {
  it("builds rows that all pass parseDeviceSpec", () => {
    for (const device of devices) expect(parseDeviceSpec(device).ok, device.model).toBe(true);
  });

  it("has unique (lower(manufacturer), lower(model))", () => {
    const keys = devices.map((d) => `${d.manufacturer.toLowerCase()}|${d.model.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays in the agreed size, well under the row cap", () => {
    expect(devices.length).toBeGreaterThanOrEqual(300);
    expect(devices.length).toBeLessThanOrEqual(450);
  });

  it("carries only Eaton and Legrand, every kind for both", () => {
    expect(new Set(devices.map((d) => d.manufacturer))).toEqual(new Set(CATALOG_MANUFACTURERS));
    for (const manufacturer of CATALOG_MANUFACTURERS) {
      const kinds = new Set(devices.filter((d) => d.manufacturer === manufacturer).map((d) => d.kind));
      expect([...kinds].sort()).toEqual([...DEVICE_KINDS].sort());
    }
  });

  it("holds no excluded RCD variant", () => {
    for (const device of devices) {
      if (device.kind !== "rcd" && device.kind !== "rcbo") continue;
      expect(["AC", "A", "B"], device.model).toContain(device.rcd_type);
      expect([10, 30, 100, 300], device.model).toContain(device.residual_current_ma);
    }
  });

  it("only uses series on the allow-list (source series, nothing excluded)", () => {
    for (const manufacturer of CATALOG_MANUFACTURERS) {
      const series = sourceRows.filter((r) => r.manufacturer === manufacturer).map((r) => r.series);
      expect(new Set(series)).toEqual(new Set(ALLOWED_SERIES[manufacturer]));
    }
    expect(devices.length).toBe(sourceRows.length);
  });

  it("gives every N-carrying row an N terminal side and no other row one", () => {
    for (const device of devices) {
      expect(device.n_terminal_side !== null, device.model).toBe(polesCarryN(device.poles));
    }
  });

  it("never prices a higher current below a lower one in the same series, poles, type and sensitivity", () => {
    const protective = devices.filter((d) => d.kind !== "pe_bar" && d.kind !== "n_bar");
    const groups = groupBy(
      protective,
      (d) =>
        `${d.manufacturer}|${d.kind}|${seriesOf(d)}|${d.poles}|${d.rcd_type}|${d.residual_current_ma}|${d.kind === "comb_busbar" ? d.width_mm : 0}`,
    );
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.rated_current_a - b.rated_current_a);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].price_grosze, sorted[i].model).toBeGreaterThanOrEqual(sorted[i - 1].price_grosze);
      }
    }
  });

  it("never prices more poles below fewer in the same series and current", () => {
    const poled = devices.filter((d) => d.kind !== "comb_busbar" && d.poles !== null);
    const groups = groupBy(
      poled,
      (d) => `${d.manufacturer}|${d.kind}|${seriesOf(d)}|${d.rated_current_a}|${d.rcd_type}|${d.residual_current_ma}`,
    );
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => poleRank(a) - poleRank(b));
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].price_grosze, sorted[i].model).toBeGreaterThanOrEqual(sorted[i - 1].price_grosze);
      }
    }
  });

  it("matches the committed SQL file", async () => {
    await expect(renderCatalogSql()).toMatchFileSnapshot("../../supabase/catalog/eaton-legrand.sql");
  });

  it("lists only device columns in the SQL", () => {
    const sql = renderCatalogSql();
    expect(sql).toContain(`insert into public.devices (${DEVICE_FIELDS.join(", ")})`);
    expect(sql).toContain("on conflict ((lower(manufacturer)), (lower(model))) do nothing;");
  });
});
