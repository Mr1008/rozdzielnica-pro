import { describe, expect, it } from "vitest";
import { demandPins, planBusbarCuts, type BusbarDemand, type PickCheapest } from "./busbar-cutting";
import type { DeviceSpecWithId } from "./device-matching";
import { parseDeviceSpec } from "./device-spec";

/** A catalog busbar: `pins` DIN modules long (17.5 mm each). */
function busbar(
  id: string,
  poles: "1P" | "3P",
  rated: number,
  pins: number,
  price: number,
  extra: Record<string, unknown> = {},
): DeviceSpecWithId {
  const parsed = parseDeviceSpec({
    kind: "comb_busbar",
    name: id,
    manufacturer: "Alfa",
    model: id,
    price_grosze: price,
    width_mm: pins * 17.5,
    height_mm: 20,
    depth_mm: 20,
    poles,
    rated_current_a: rated,
    ...extra,
  });
  if (!parsed.ok) throw new Error(`fixture ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

/** A price-then-id pick, the shape of the matcher's own tie-break. */
const pick: PickCheapest = (candidates) =>
  [...candidates].sort((a, b) => a.price_grosze - b.price_grosze || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(0) ??
  null;

/** A group `pins` modules wide (the width is exact, so `demandPins` returns `pins`). */
function demand(groupId: string, pins: number, extra: Partial<BusbarDemand> = {}): BusbarDemand {
  return { groupId, mcbCount: 3, phases: 1, minRatedA: 40, groupWidthMm: pins * 17.5, ...extra };
}

const RAIL_MM = 54 * 17.5;

describe("demandPins", () => {
  it("rounds a width up to whole modules", () => {
    expect(demandPins(70)).toBe(4);
    expect(demandPins(70.5)).toBe(5);
    expect(demandPins(17.5 * 8)).toBe(8);
  });
});

describe("planBusbarCuts", () => {
  const ONE_F_12 = busbar("bb-1f-12", "1P", 63, 12, 3000);
  const ONE_F_54 = busbar("bb-1f-54", "1P", 63, 54, 9000);
  const THREE_F_54 = busbar("bb-3f-54", "3P", 63, 54, 12000);

  it("buys a second piece when the first one's offcut is too short", () => {
    const plan = planBusbarCuts([demand("g1", 8), demand("g2", 10)], [ONE_F_12, ONE_F_54], RAIL_MM, pick);
    // g2 (10 pins) goes first and buys the cheapest piece that holds it: the 12-pin one. g1 (8) no
    // longer fits its 2-pin offcut, so it buys a second piece.
    expect(plan.segments).toEqual([
      { groupId: "g1", deviceId: "bb-1f-12", piece: 1 },
      { groupId: "g2", deviceId: "bb-1f-12", piece: 0 },
    ]);
    expect(plan.reasons).toEqual([]);
  });

  it("serves later groups from the offcut of an earlier piece, widest first", () => {
    const plan = planBusbarCuts(
      [demand("g1", 4), demand("g2", 6), demand("g3", 20)],
      [ONE_F_12, ONE_F_54],
      RAIL_MM,
      pick,
    );
    // g3 (20 pins) buys the 54-pin piece; g2 (6) and g1 (4) are cut from its offcut.
    expect(plan.segments).toEqual([
      { groupId: "g1", deviceId: "bb-1f-54", piece: 0 },
      { groupId: "g2", deviceId: "bb-1f-54", piece: 0 },
      { groupId: "g3", deviceId: "bb-1f-54", piece: 0 },
    ]);
  });

  it("gives a single-MCB group a segment only from an offcut", () => {
    const alone = planBusbarCuts([demand("g1", 4, { mcbCount: 1 })], [ONE_F_12], RAIL_MM, pick);
    expect(alone.segments).toEqual([]);
    expect(alone.reasons).toEqual([]);

    const withOffcut = planBusbarCuts([demand("g1", 4, { mcbCount: 1 }), demand("g2", 6)], [ONE_F_12], RAIL_MM, pick);
    expect(withOffcut.segments).toEqual([
      { groupId: "g1", deviceId: "bb-1f-12", piece: 0 },
      { groupId: "g2", deviceId: "bb-1f-12", piece: 0 },
    ]);
  });

  it("never takes a 1F piece for a 3F group, nor a 3F one for a 1F group", () => {
    const three = planBusbarCuts([demand("g1", 4, { phases: 3 })], [ONE_F_54], RAIL_MM, pick);
    expect(three.segments).toEqual([]);
    expect(three.reasons).toEqual([{ groupId: "g1", reason: "busbar_missing" }]);

    const one = planBusbarCuts([demand("g1", 4)], [THREE_F_54], RAIL_MM, pick);
    expect(one.segments).toEqual([]);

    // A 3F offcut does not serve a 1F group either.
    const mixed = planBusbarCuts([demand("g3", 20, { phases: 3 }), demand("g1", 4)], [THREE_F_54], RAIL_MM, pick);
    expect(mixed.segments.map((s) => s.groupId)).toEqual(["g3"]);
    expect(mixed.reasons).toEqual([{ groupId: "g1", reason: "busbar_missing" }]);
  });

  it("never chooses an under-rated busbar, even when it is cheaper", () => {
    const cheapWeak = busbar("bb-weak", "1P", 32, 12, 100);
    const plan = planBusbarCuts([demand("g1", 4, { minRatedA: 40 })], [cheapWeak, ONE_F_12], RAIL_MM, pick);
    expect(plan.segments).toEqual([{ groupId: "g1", deviceId: "bb-1f-12", piece: 0 }]);
  });

  it("never cuts from an under-rated offcut", () => {
    const weak = busbar("bb-weak", "1P", 32, 54, 100);
    // g1 (RCD 25 A) buys the cheap 32 A piece; g2 (RCD 40 A) must not take its offcut.
    const plan = planBusbarCuts(
      [demand("g1", 20, { minRatedA: 25 }), demand("g2", 4, { minRatedA: 40 })],
      [weak, ONE_F_12],
      RAIL_MM,
      pick,
    );
    expect(plan.segments).toEqual([
      { groupId: "g1", deviceId: "bb-weak", piece: 0 },
      { groupId: "g2", deviceId: "bb-1f-12", piece: 1 },
    ]);
  });

  it("reports busbar_missing when nothing is compliant, and keeps going", () => {
    const plan = planBusbarCuts([demand("g1", 30), demand("g2", 4)], [ONE_F_12], RAIL_MM, pick);
    expect(plan.reasons).toEqual([{ groupId: "g1", reason: "busbar_missing" }]);
    expect(plan.segments).toEqual([{ groupId: "g2", deviceId: "bb-1f-12", piece: 0 }]);
  });

  it("excludes a group wider than every rail with group_too_wide", () => {
    const plan = planBusbarCuts([demand("g1", 40)], [ONE_F_54], 30 * 17.5, pick);
    expect(plan.segments).toEqual([]);
    expect(plan.reasons).toEqual([{ groupId: "g1", reason: "group_too_wide" }]);
  });

  it("is deterministic and keeps ties in stored group order", () => {
    const demands = [demand("g1", 6), demand("g2", 6), demand("g3", 6)];
    const first = planBusbarCuts(demands, [ONE_F_12], RAIL_MM, pick);
    expect(planBusbarCuts(demands, [ONE_F_12], RAIL_MM, pick)).toEqual(first);
    // 12 pins hold g1 and g2 (ties in stored order); g3 buys the second piece.
    expect(first.segments.map((s) => [s.groupId, s.piece])).toEqual([
      ["g1", 0],
      ["g2", 0],
      ["g3", 1],
    ]);
  });

  it("returns nothing for no demand", () => {
    expect(planBusbarCuts([], [ONE_F_12], RAIL_MM, pick)).toEqual({ segments: [], reasons: [] });
  });
});
