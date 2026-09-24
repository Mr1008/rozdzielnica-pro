import { describe, expect, it } from "vitest";
import { type DeviceSpec, parseDeviceSpec } from "./device-spec";
import { deviceParameterSummary, deviceWidthLabel } from "./device-summary";

const common = {
  name: "Aparat",
  manufacturer: "Producent",
  model: "M-1",
  price_grosze: 1000,
  width_mm: 17.5,
  height_mm: 85,
  depth_mm: 70,
};

function spec(row: Record<string, unknown>): DeviceSpec {
  const parsed = parseDeviceSpec({ ...common, ...row });
  if (!parsed.ok) throw new Error(`fixture does not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.spec;
}

describe("deviceParameterSummary", () => {
  it("summarises an MCB as characteristic, rating, poles and breaking capacity", () => {
    expect(
      deviceParameterSummary(spec({ kind: "mcb_b", poles: "1P", rated_current_a: 16, breaking_capacity_ka: 6 })),
    ).toBe("B16 1P, 6 kA");
  });

  it("formats a decimal breaking capacity with a Polish comma", () => {
    expect(
      deviceParameterSummary(spec({ kind: "mcb_b", poles: "3P", rated_current_a: 20, breaking_capacity_ka: 4.5 })),
    ).toBe("B20 3P, 4,5 kA");
  });

  it("summarises an RCD as rating, poles, residual current and type", () => {
    expect(
      deviceParameterSummary(
        spec({ kind: "rcd", poles: "2P", rated_current_a: 40, residual_current_ma: 30, rcd_type: "A" }),
      ),
    ).toBe("40 A 2P, 30 mA, typ A");
  });

  it("summarises an RCBO with its overcurrent and residual-current parameters", () => {
    expect(
      deviceParameterSummary(
        spec({
          kind: "rcbo",
          poles: "1P+N",
          rated_current_a: 16,
          residual_current_ma: 30,
          rcd_type: "A",
          breaking_capacity_ka: 6,
        }),
      ),
    ).toBe("B16 1P+N, 30 mA, typ A, 6 kA");
  });

  it("summarises a switch-disconnector as rating and poles", () => {
    expect(deviceParameterSummary(spec({ kind: "switch_disconnector", poles: "3P", rated_current_a: 63 }))).toBe(
      "63 A 3P",
    );
  });

  it.each(["pe_bar", "n_bar"])("summarises a %s as its terminal groups", (kind) => {
    expect(
      deviceParameterSummary(
        spec({
          kind,
          terminal_groups: [
            { count: 2, minMm2: 1.5, maxMm2: 16 },
            { count: 8, minMm2: 1.5, maxMm2: 4 },
          ],
        }),
      ),
    ).toBe("2 × 1,5–16 mm², 8 × 1,5–4 mm²");
  });
});

describe("deviceWidthLabel", () => {
  it("shows modules and millimetres for a whole number of half-modules", () => {
    expect(deviceWidthLabel(35)).toBe("2 TE (35 mm)");
    expect(deviceWidthLabel(17.5)).toBe("1 TE (17,5 mm)");
    expect(deviceWidthLabel(26.25)).toBe("1,5 TE (26,25 mm)");
  });

  it("falls back to millimetres only otherwise", () => {
    expect(deviceWidthLabel(36)).toBe("36 mm");
  });
});
