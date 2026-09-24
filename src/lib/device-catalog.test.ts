import { describe, expect, it } from "vitest";
import {
  DEVICES_API_PATH,
  DEVICES_PATH,
  NEW_DEVICE_PATH,
  deviceApiPath,
  deviceArchivePath,
  deviceEditPath,
  deviceFormErrorPath,
  deviceRestorePath,
  devicesErrorPath,
} from "./device-catalog";

describe("paths", () => {
  it("builds the list, new and edit paths", () => {
    expect(DEVICES_PATH).toBe("/admin/devices");
    expect(NEW_DEVICE_PATH).toBe("/admin/devices/new");
    expect(deviceEditPath("abc")).toBe("/admin/devices/abc");
  });

  it("builds the list error redirect, encoding the code", () => {
    expect(devicesErrorPath("not_found")).toBe(`${DEVICES_PATH}?error=not_found`);
    expect(devicesErrorPath("a&b")).toBe(`${DEVICES_PATH}?error=a%26b`);
  });

  it("builds the form endpoints and the form error redirects", () => {
    expect(DEVICES_API_PATH).toBe("/api/admin/devices");
    expect(deviceApiPath("abc")).toBe(`${DEVICES_API_PATH}/abc`);
    expect(deviceFormErrorPath(null, "duplicate_model")).toBe(`${NEW_DEVICE_PATH}?error=duplicate_model`);
    expect(deviceFormErrorPath("abc", "a&b")).toBe(`${DEVICES_PATH}/abc?error=a%26b`);
  });

  it("builds the archive and restore endpoints the list posts to", () => {
    expect(deviceArchivePath("abc")).toBe("/api/admin/devices/abc/archive");
    expect(deviceRestorePath("abc")).toBe("/api/admin/devices/abc/restore");
  });
});
