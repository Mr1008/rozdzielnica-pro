import { describe, expect, it } from "vitest";
import { CABINETS_PATH, cabinetEditPath, cabinetsErrorPath, isUuid, sortForCatalogList } from "./cabinet-catalog";

describe("isUuid", () => {
  it("accepts a canonical UUID in either case", () => {
    expect(isUuid("00000000-0000-0000-0000-0000000ad301")).toBe(true);
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "new",
      "not-a-uuid",
      "3f2504e0-4f89-11d3-9a0c-0305e82c330",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301x",
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});

describe("paths", () => {
  it("builds the edit path and the error redirect", () => {
    expect(cabinetEditPath("abc")).toBe(`${CABINETS_PATH}/abc`);
    expect(cabinetsErrorPath("not_found")).toBe(`${CABINETS_PATH}?error=not_found`);
    expect(cabinetsErrorPath("a&b")).toBe(`${CABINETS_PATH}?error=a%26b`);
  });
});

describe("sortForCatalogList", () => {
  const row = (name: string, archived = false) => ({ name, archived_at: archived ? "2026-09-23T10:00:00Z" : null });

  it("puts active cabinets first, each group by name", () => {
    const rows = [row("Zeta", true), row("Beta"), row("Alfa", true), row("Alfa")];
    expect(sortForCatalogList(rows)).toEqual([row("Alfa"), row("Beta"), row("Alfa", true), row("Zeta", true)]);
  });

  it("orders Polish letters by Polish collation", () => {
    expect(sortForCatalogList([row("Źródło"), row("Łódź"), row("Lampa"), row("Zamek")]).map((r) => r.name)).toEqual([
      "Lampa",
      "Łódź",
      "Zamek",
      "Źródło",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [row("B"), row("A")];
    sortForCatalogList(rows);
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
  });
});
