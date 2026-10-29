import { describe, expect, it } from "vitest";
import {
  CABINET_VIEWS,
  DEFAULT_CABINET_VIEW,
  EMPTY_CABINET_FILTER,
  EMPTY_DEVICE_FILTER,
  cabinetCapacityLabel,
  cabinetModuleCapacity,
  compareCabinetsForCatalog,
  compareDevicesForCatalog,
  isCabinetView,
  matchesCabinetFilter,
  matchesDeviceFilter,
  normalizeSearchText,
  type CatalogCabinet,
  type CatalogDevice,
} from "./catalog-list";
import { KARWASZ_CABINETS, karwaszGeometry } from "./karwasz-cabinets";

const ARCHIVED = "2026-10-01T10:00:00Z";

function karwasz(model: string) {
  const cabinet = KARWASZ_CABINETS.find((c) => c.model === model);
  if (!cabinet) throw new Error(`no Karwasz cabinet ${model}`);
  return karwaszGeometry(cabinet);
}

describe("cabinetModuleCapacity", () => {
  it("counts a single-rail cabinet", () => {
    const capacity = cabinetModuleCapacity(karwasz("RN-6-P"));
    expect(capacity).toEqual({ rails: [{ modules: 6 }], total: 6 });
    expect(cabinetCapacityLabel(capacity)).toBe("6");
  });

  it("counts equal rails and labels them as a product", () => {
    const capacity = cabinetModuleCapacity(karwasz("RN-24"));
    expect(capacity).toEqual({ rails: [{ modules: 12 }, { modules: 12 }], total: 24 });
    expect(cabinetCapacityLabel(capacity)).toBe("2×12 = 24");
  });

  it("labels uneven rails as a sum and floors partial modules", () => {
    const capacity = cabinetModuleCapacity({ rails: [{ lengthMm: 210 }, { lengthMm: 210 }, { lengthMm: 150 }] });
    expect(capacity.total).toBe(32);
    expect(cabinetCapacityLabel(capacity)).toBe("12 + 12 + 8 = 32");
  });
});

function device(overrides: Partial<CatalogDevice> & { name: string }): CatalogDevice {
  return {
    model: overrides.name,
    manufacturer: "Eaton",
    archived_at: null,
    rated_current_a: null,
    poles: null,
    residual_current_ma: null,
    rcd_type: null,
    breaking_capacity_ka: null,
    width_mm: 17.5,
    ...overrides,
  };
}

const sortDevices = (devices: CatalogDevice[]) => [...devices].sort(compareDevicesForCatalog).map((d) => d.name);

describe("compareDevicesForCatalog", () => {
  it("orders rated current numerically, B6 before B10", () => {
    const devices = [16, 10, 6, 50, 13, 2].map((a) =>
      device({ name: `B${String(a)}`, rated_current_a: a, poles: "1P" }),
    );
    expect(sortDevices(devices)).toEqual(["B2", "B6", "B10", "B13", "B16", "B50"]);
  });

  it("orders poles 1P before 1P+N before 3P at the same current", () => {
    const devices = (["3P", "1P+N", "1P"] as const).map((poles) =>
      device({ name: `B16 ${poles}`, rated_current_a: 16, poles }),
    );
    expect(sortDevices(devices)).toEqual(["B16 1P", "B16 1P+N", "B16 3P"]);
  });

  it("keeps the same device from two manufacturers adjacent", () => {
    const devices = [
      device({ name: "Legrand B16", manufacturer: "Legrand", rated_current_a: 16, poles: "1P" }),
      device({ name: "Eaton B20", rated_current_a: 20, poles: "1P" }),
      device({ name: "Eaton B16 3P", rated_current_a: 16, poles: "3P" }),
      device({ name: "Eaton B16", rated_current_a: 16, poles: "1P" }),
    ];
    expect(sortDevices(devices)).toEqual(["Eaton B16", "Legrand B16", "Eaton B16 3P", "Eaton B20"]);
  });

  it("puts archived devices last regardless of parameters", () => {
    const devices = [
      device({ name: "B6 old", rated_current_a: 6, poles: "1P", archived_at: ARCHIVED }),
      device({ name: "B32", rated_current_a: 32, poles: "1P" }),
    ];
    expect(sortDevices(devices)).toEqual(["B32", "B6 old"]);
  });

  it("orders RCDs by residual current, then type", () => {
    const rcd = (name: string, ma: number, type: string) =>
      device({ name, rated_current_a: 40, poles: "3P+N", residual_current_ma: ma, rcd_type: type });
    expect(sortDevices([rcd("300 A", 300, "A"), rcd("30 A", 30, "A"), rcd("30 AC", 30, "AC")])).toEqual([
      "30 AC",
      "30 A",
      "300 A",
    ]);
  });

  it("sorts a missing parameter before a present one, then by width", () => {
    const devices = [
      device({ name: "MCB", rated_current_a: 16, poles: "1P" }),
      device({ name: "Szyna PE 12", width_mm: 140 }),
      device({ name: "Szyna PE 7", width_mm: 87.5 }),
    ];
    expect(sortDevices(devices)).toEqual(["Szyna PE 7", "Szyna PE 12", "MCB"]);
  });

  it("falls back to manufacturer, then name in numeric collation", () => {
    const devices = [
      device({ name: "Listwa 12", manufacturer: "Legrand" }),
      device({ name: "Listwa 12", manufacturer: "Eaton" }),
      device({ name: "Szyna 10" }),
      device({ name: "Szyna 9" }),
    ];
    expect(sortDevices(devices).slice(0, 3)).toEqual(["Listwa 12", "Szyna 9", "Szyna 10"]);
    expect([...devices].sort(compareDevicesForCatalog).map((d) => d.manufacturer)[3]).toBe("Legrand");
  });
});

function cabinet(overrides: Partial<CatalogCabinet> & { name: string }): CatalogCabinet {
  return {
    model: overrides.name,
    manufacturer: "Karwasz",
    archived_at: null,
    mounting: "surface",
    totalModules: 12,
    ...overrides,
  };
}

describe("compareCabinetsForCatalog", () => {
  it("orders by capacity, then name numerically, archived last", () => {
    const cabinets = [
      cabinet({ name: "RN-12-P", totalModules: 12 }),
      cabinet({ name: "RN-6-P", totalModules: 6, archived_at: ARCHIVED }),
      cabinet({ name: "RN-24", totalModules: 24 }),
      cabinet({ name: "RN-8-P", totalModules: 8 }),
      cabinet({ name: "RP-12", totalModules: 12 }),
    ];
    expect([...cabinets].sort(compareCabinetsForCatalog).map((c) => c.name)).toEqual([
      "RN-8-P",
      "RN-12-P",
      "RP-12",
      "RN-24",
      "RN-6-P",
    ]);
  });

  it("orders names with numbers numerically at equal capacity", () => {
    const cabinets = [cabinet({ name: "RN-12-P" }), cabinet({ name: "RN-6-P" })];
    expect([...cabinets].sort(compareCabinetsForCatalog).map((c) => c.name)).toEqual(["RN-6-P", "RN-12-P"]);
  });
});

describe("normalizeSearchText", () => {
  it("drops case and Polish diacritics, including ł", () => {
    expect(normalizeSearchText("  Rozdzielnica PODTYNKOWA Łódź źćśąęóń ")).toBe("rozdzielnica podtynkowa lodz zcsaeon");
  });
});

describe("matchesDeviceFilter", () => {
  const b16 = device({ name: "Wyłącznik nadprądowy B16", model: "PL6-B16/1", rated_current_a: 16, poles: "1P" });

  it("matches everything active with the empty filter, archived only when shown", () => {
    expect(matchesDeviceFilter(b16, EMPTY_DEVICE_FILTER)).toBe(true);
    const archived = { ...b16, archived_at: ARCHIVED };
    expect(matchesDeviceFilter(archived, EMPTY_DEVICE_FILTER)).toBe(false);
    expect(matchesDeviceFilter(archived, { ...EMPTY_DEVICE_FILTER, showArchived: true })).toBe(true);
  });

  it("searches name and model ignoring case and diacritics", () => {
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, query: "WYLACZNIK" })).toBe(true);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, query: "pl6-b16" })).toBe(true);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, query: "różnicowo" })).toBe(false);
  });

  it("narrows by manufacturer, poles and exact rated current", () => {
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, manufacturer: "Eaton" })).toBe(true);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, manufacturer: "Legrand" })).toBe(false);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, poles: "1P" })).toBe(true);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, poles: "1P+N" })).toBe(false);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, ratedCurrentA: 16 })).toBe(true);
    expect(matchesDeviceFilter(b16, { ...EMPTY_DEVICE_FILTER, ratedCurrentA: 20 })).toBe(false);
  });
});

describe("matchesCabinetFilter", () => {
  const rp24 = cabinet({ name: "Rozdzielnica podtynkowa RP-24", model: "RP-24", mounting: "flush", totalModules: 24 });

  it("passes the module minimum at exactly N and fails one above", () => {
    expect(matchesCabinetFilter(rp24, { ...EMPTY_CABINET_FILTER, minModules: 24 })).toBe(true);
    expect(matchesCabinetFilter(rp24, { ...EMPTY_CABINET_FILTER, minModules: 25 })).toBe(false);
  });

  it("matches a null mounting only under 'all'", () => {
    const legacy = { ...rp24, mounting: null };
    expect(matchesCabinetFilter(legacy, EMPTY_CABINET_FILTER)).toBe(true);
    expect(matchesCabinetFilter(legacy, { ...EMPTY_CABINET_FILTER, mounting: "flush" })).toBe(false);
    expect(matchesCabinetFilter(legacy, { ...EMPTY_CABINET_FILTER, mounting: "surface" })).toBe(false);
    expect(matchesCabinetFilter(rp24, { ...EMPTY_CABINET_FILTER, mounting: "flush" })).toBe(true);
  });

  it("searches ignoring diacritics and hides archived unless shown", () => {
    expect(matchesCabinetFilter(rp24, { ...EMPTY_CABINET_FILTER, query: "PODTYNKOWA" })).toBe(true);
    expect(
      matchesCabinetFilter({ ...rp24, name: "Skrzynka złączowa" }, { ...EMPTY_CABINET_FILTER, query: "zlacz" }),
    ).toBe(true);
    const archived = { ...rp24, archived_at: ARCHIVED };
    expect(matchesCabinetFilter(archived, EMPTY_CABINET_FILTER)).toBe(false);
    expect(matchesCabinetFilter(archived, { ...EMPTY_CABINET_FILTER, showArchived: true })).toBe(true);
  });
});

describe("CABINET_VIEWS", () => {
  it("defaults to small and recognises only its own values", () => {
    expect(CABINET_VIEWS).toEqual(["large", "small", "list"]);
    expect(DEFAULT_CABINET_VIEW).toBe("small");
    expect(isCabinetView("list")).toBe(true);
    expect(isCabinetView("grid")).toBe(false);
    expect(isCabinetView(null)).toBe(false);
  });
});
