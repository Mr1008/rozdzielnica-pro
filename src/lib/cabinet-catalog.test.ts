import { describe, expect, it } from "vitest";
import {
  CABINETS_API_PATH,
  CABINETS_PATH,
  NEW_CABINET_PATH,
  cabinetApiPath,
  cabinetArchivePath,
  cabinetEditPath,
  cabinetFormErrorPath,
  cabinetRestorePath,
  cabinetsErrorPath,
} from "./cabinet-catalog";

describe("paths", () => {
  it("builds the edit path and the error redirect", () => {
    expect(cabinetEditPath("abc")).toBe(`${CABINETS_PATH}/abc`);
    expect(cabinetsErrorPath("not_found")).toBe(`${CABINETS_PATH}?error=not_found`);
    expect(cabinetsErrorPath("a&b")).toBe(`${CABINETS_PATH}?error=a%26b`);
  });

  it("builds the form endpoints and the form error redirects", () => {
    expect(cabinetApiPath("abc")).toBe(`${CABINETS_API_PATH}/abc`);
    expect(cabinetFormErrorPath(null, "duplicate_model")).toBe(`${NEW_CABINET_PATH}?error=duplicate_model`);
    expect(cabinetFormErrorPath("abc", "a&b")).toBe(`${CABINETS_PATH}/abc?error=a%26b`);
  });

  it("builds the archive and restore endpoints the list posts to", () => {
    expect(cabinetArchivePath("abc")).toBe("/api/admin/cabinets/abc/archive");
    expect(cabinetRestorePath("abc")).toBe("/api/admin/cabinets/abc/restore");
  });
});
