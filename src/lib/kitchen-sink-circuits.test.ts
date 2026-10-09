import { describe, expect, it } from "vitest";
import {
  kitchenSinkLayoutStates,
  kitchenSinkMatchStates,
  kitchenSinkPrintStates,
  kitchenSinkQuoteStates,
  landingLayoutFixture,
} from "@/lib/kitchen-sink-circuits";
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

/** The busbar states must show what their captions promise (plan `rcd-group-busbars`, Phase 5). */
describe("kitchen sink — busbar states", () => {
  it("cuts two single-phase groups from one shared piece", () => {
    const state = kitchenSinkMatchStates().find((candidate) => candidate.key === "busbars");
    const segments = state?.view.snapshot.filter((row) => row.role === "busbar") ?? [];
    expect(segments).toHaveLength(2);
    expect(new Set(segments.map((row) => row.busbar_piece)).size).toBe(1);
  });

  it("gives the three-phase group a 3P busbar and the layout draws it", () => {
    const match = kitchenSinkMatchStates().find((candidate) => candidate.key === "busbars-3f");
    expect(match?.view.snapshot.filter((row) => row.role === "busbar").map((row) => row.poles)).toEqual(["3P"]);
    for (const key of ["placed-busbars-3f", "placed-busbars-3f-schematic"]) {
      const layout = kitchenSinkLayoutStates().find((candidate) => candidate.key === key);
      expect(layout?.view?.state).toBe("placed");
      expect(layout?.busbars).toHaveLength(1);
    }
  });

  it("raises only an informational note for a catalog without busbars", () => {
    const state = kitchenSinkMatchStates().find((candidate) => candidate.key === "busbar-missing");
    expect(state?.view.state).toBe("current");
    expect(state?.view.snapshot.some((row) => row.role === "busbar")).toBe(false);
  });

  it("feeds the landing hero's groups by busbars", () => {
    expect(landingLayoutFixture().busbars.length).toBeGreaterThan(0);
  });

  it("quotes the busbar state and prints it with a drawing", () => {
    const quote = kitchenSinkQuoteStates().find((candidate) => candidate.key === "busbars");
    expect(quote?.view.state).toBe("ready");
    const doc = kitchenSinkPrintStates().documents.find((candidate) => candidate.key === "busbars");
    expect(doc?.drawing?.wiring).not.toBeNull();
  });
});
