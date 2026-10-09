import { describe, expect, it } from "vitest";
import { kitchenSinkLayoutStates } from "@/lib/kitchen-sink-circuits";
import { buildWiringDrawing } from "@/lib/wiring-island";

/** The kitchen sink's wiring states must show what their captions promise (S-11 Phase 7). */
describe("kitchenSinkLayoutStates — wiring", () => {
  const states = new Map(kitchenSinkLayoutStates().map((state) => [state.key, state]));
  const placed = (key: string) => {
    const state = states.get(key);
    if (state?.view?.state !== "placed" || state.wiring === null) throw new Error(`expected placed wiring: ${key}`);
    return { state, wiring: state.wiring };
  };

  it("draws the medium cabinet in both views", () => {
    expect(placed("placed-b").state.wiringVariant).toBe("realistic");
    expect(placed("placed-b-schematic").state.wiringVariant).toBe("schematic");
  });

  it("raises the overflow warning in its overflow state, in both variants", () => {
    const { state, wiring } = placed("placed-overflow");
    for (const variant of ["realistic", "schematic"] as const) {
      const warnings = buildWiringDrawing(wiring, state.devices, variant).warnings;
      expect(warnings.map((warning) => warning.code)).toEqual(["conductors_do_not_fit"]);
    }
  });

  it("raises no overflow warning in the ordinary placed states", () => {
    for (const key of ["placed-b", "placed-c"]) {
      const { state, wiring } = placed(key);
      expect(buildWiringDrawing(wiring, state.devices).warnings).toEqual([]);
    }
  });
});
