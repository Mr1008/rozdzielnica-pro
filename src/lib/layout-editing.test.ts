import { describe, expect, it } from "vitest";
import { layoutIssueMessage, type LayoutDevice, type LayoutIssue, type Placement } from "./cabinet-layout";
import { geometry, SEED_A, SEED_B, TERMINALS } from "./cabinet-layout.fixtures";
import { polesCarryN, type PoleConfig } from "./device-spec";
import {
  carryOverPlacements,
  editUnits,
  history,
  keyboardStep,
  moveDevice,
  moveUnit,
  parsePlacementsPayload,
  previewMove,
  snapX,
  type EditContext,
  type EditUnit,
  type LayoutDraft,
} from "./layout-editing";

/*
 * Oracles are literals worked out by hand from the seed geometries in `supabase/seed.sql` (the
 * fixtures) and the 17.5 mm DIN module: (b) PRZ-M3 has three 320 mm rails at x 40, y 80 / 200 / 320,
 * and its PE / N bars are vertical at x 10–25 and 375–390, outside every rail. A device is 85 mm tall,
 * centred on its rail (rail centre = y + 17.5). Nothing below is computed with the module's own rules.
 */

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const KIND = { main_switch: "switch_disconnector", rcd: "rcd", rcbo: "rcbo", mcb: "mcb_b" } as const;

function device(
  id: string,
  role: keyof typeof KIND,
  poles: PoleConfig,
  widthMm: number,
  position: number,
  group: string | null = null,
  circuit: string | null = null,
): LayoutDevice {
  return {
    id,
    role,
    kind: KIND[role],
    rcd_group_id: group,
    circuit_id: circuit,
    width_mm: widthMm,
    height_mm: 85,
    poles,
    n_terminal_side: polesCarryN(poles) ? "left" : null,
    position,
  };
}

/** FR, group G1 (RCD + two MCBs), an ungrouped MCB and group G2 (a lone RCBO). */
const DEVICES: LayoutDevice[] = [
  device("fr", "main_switch", "2P", 35, 0),
  device("G1-rcd", "rcd", "2P", 35, 1, "G1"),
  device("mcb-a", "mcb", "1P", 17.5, 2, "G1", "a"),
  device("mcb-b", "mcb", "1P", 17.5, 3, "G1", "b"),
  device("mcb-u", "mcb", "1P", 17.5, 4, null, "u"),
  device("G2-rcbo", "rcbo", "1P+N", 35, 5, "G2", "r"),
];
const GROUPS = [{ id: "G1" }, { id: "G2" }];

/**
 * A valid draft on (b), by hand. Rail 0: FR 0–35, G1 packed at 52.5–122.5 (RCD 52.5, a 87.5, b 105).
 * Rail 1: u 0–17.5, RCBO 35–70. Rails 120 mm apart, so the 85 mm bands (y 55–140, 175–260) never meet.
 */
const START: LayoutDraft = {
  placements: [
    { projectDeviceId: "fr", railIndex: 0, xMm: 0 },
    { projectDeviceId: "G1-rcd", railIndex: 0, xMm: 52.5 },
    { projectDeviceId: "mcb-a", railIndex: 0, xMm: 87.5 },
    { projectDeviceId: "mcb-b", railIndex: 0, xMm: 105 },
    { projectDeviceId: "mcb-u", railIndex: 1, xMm: 0 },
    { projectDeviceId: "G2-rcbo", railIndex: 1, xMm: 35 },
  ],
};

const CONTEXT: EditContext = { devices: DEVICES, geometry: SEED_B, groups: GROUPS };

const G1_BLOCK: EditUnit = { kind: "block", groupId: "G1", deviceIds: ["G1-rcd", "mcb-a", "mcb-b"] };

function accepted(result: ReturnType<typeof moveUnit>): LayoutDraft {
  if (!result.ok) throw new Error(`expected an accepted move, got ${JSON.stringify(result.issues)}`);
  return result.draft;
}

function refused(result: ReturnType<typeof moveUnit>): LayoutIssue[] {
  if (result.ok) throw new Error(`expected a refused move, got ${JSON.stringify(result.draft)}`);
  return result.issues;
}

/** The draft with the listed placements replaced. */
function patched(draft: LayoutDraft, changes: Placement[]): LayoutDraft {
  return {
    placements: draft.placements.map(
      (placement) => changes.find((change) => change.projectDeviceId === placement.projectDeviceId) ?? placement,
    ),
  };
}

const startCopy = structuredClone(START);

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

describe("editUnits", () => {
  it("gives one block per non-empty group, RCD / RCBO first, then one unit per device", () => {
    expect(editUnits(DEVICES, GROUPS)).toEqual([
      { kind: "block", groupId: "G1", deviceIds: ["G1-rcd", "mcb-a", "mcb-b"] },
      { kind: "block", groupId: "G2", deviceIds: ["G2-rcbo"] },
      { kind: "device", deviceId: "fr", groupId: null },
      { kind: "device", deviceId: "G1-rcd", groupId: "G1" },
      { kind: "device", deviceId: "mcb-a", groupId: "G1" },
      { kind: "device", deviceId: "mcb-b", groupId: "G1" },
      { kind: "device", deviceId: "mcb-u", groupId: null },
      { kind: "device", deviceId: "G2-rcbo", groupId: "G2" },
    ]);
  });

  it("skips an empty group", () => {
    expect(editUnits(DEVICES, [...GROUPS, { id: "G3" }]).filter((unit) => unit.kind === "block")).toHaveLength(2);
  });

  it("gives no block to a group wider than every rail (impl review F3)", () => {
    const g1Width = DEVICES.filter((device) => device.rcd_group_id === "G1").reduce((sum, d) => sum + d.width_mm, 0);
    const rail = { xMm: 0, yMm: 0, lengthMm: g1Width - 1 };
    const blocks = editUnits(DEVICES, GROUPS, { rails: [rail, rail] }).filter((unit) => unit.kind === "block");
    expect(blocks).toEqual([{ kind: "block", groupId: "G2", deviceIds: ["G2-rcbo"] }]);
  });
});

// ---------------------------------------------------------------------------------------------
// Named moves on (b)
// ---------------------------------------------------------------------------------------------

describe("moves", () => {
  it("moves a block to another rail and keeps it packed", () => {
    // Rail 2 at x 100: RCD 100–135, a 135–152.5, b 152.5–170.
    const next = accepted(moveUnit(CONTEXT, START, G1_BLOCK, { railIndex: 2, xMm: 100 }));
    expect(next).toEqual(
      patched(START, [
        { projectDeviceId: "G1-rcd", railIndex: 2, xMm: 100 },
        { projectDeviceId: "mcb-a", railIndex: 2, xMm: 135 },
        { projectDeviceId: "mcb-b", railIndex: 2, xMm: 152.5 },
      ]),
    );
    expect(START).toEqual(startCopy);
  });

  it("reorders inside a group, re-packing from the group's start", () => {
    // b dropped at 52.5 (centre 61.25) lands before the RCD (centre 70): b 52.5, RCD 70, a 105.
    const next = accepted(moveDevice(CONTEXT, START, "mcb-b", { railIndex: 0, xMm: 52.5 }));
    expect(next).toEqual(
      patched(START, [
        { projectDeviceId: "mcb-b", railIndex: 0, xMm: 52.5 },
        { projectDeviceId: "G1-rcd", railIndex: 0, xMm: 70 },
        { projectDeviceId: "mcb-a", railIndex: 0, xMm: 105 },
      ]),
    );
    // A block move afterwards keeps the new order: b 0, RCD 17.5, a 52.5 on rail 2.
    expect(accepted(moveUnit(CONTEXT, next, G1_BLOCK, { railIndex: 2, xMm: 0 }))).toEqual(
      patched(next, [
        { projectDeviceId: "mcb-b", railIndex: 2, xMm: 0 },
        { projectDeviceId: "G1-rcd", railIndex: 2, xMm: 17.5 },
        { projectDeviceId: "mcb-a", railIndex: 2, xMm: 52.5 },
      ]),
    );
  });

  it("swaps same-width neighbours on a one-module step, in either direction", () => {
    // b one module left (87.5, centre 96.25) lands exactly on a's centre and passes it leftwards;
    // a one module right (105, centre 113.75) lands exactly on b's centre and passes it rightwards.
    const swapped = patched(START, [
      { projectDeviceId: "G1-rcd", railIndex: 0, xMm: 52.5 },
      { projectDeviceId: "mcb-b", railIndex: 0, xMm: 87.5 },
      { projectDeviceId: "mcb-a", railIndex: 0, xMm: 105 },
    ]);
    expect(accepted(moveDevice(CONTEXT, START, "mcb-b", { railIndex: 0, xMm: 87.5 }))).toEqual(swapped);
    expect(accepted(moveDevice(CONTEXT, START, "mcb-a", { railIndex: 0, xMm: 105 }))).toEqual(swapped);
  });

  it("refuses a group device dropped outside its group (group_not_contiguous)", () => {
    // G1 spans 52.5–122.5 on rail 0: a at 200 (centre 208.75) is outside; rail 2 holds no G1 device.
    expect(refused(moveDevice(CONTEXT, START, "mcb-a", { railIndex: 0, xMm: 200 }))).toEqual([
      { code: "group_not_contiguous", groupId: "G1" },
    ]);
    expect(refused(moveDevice(CONTEXT, START, "mcb-a", { railIndex: 2, xMm: 0 }))).toEqual([
      { code: "group_not_contiguous", groupId: "G1" },
    ]);
    expect(START).toEqual(startCopy);
  });

  it("refuses a drop that overlaps another device (overlaps_device)", () => {
    // FR at 40 spans 40–75 and covers the RCD at 52.5–87.5.
    expect(refused(moveDevice(CONTEXT, START, "fr", { railIndex: 0, xMm: 40 }))).toEqual([
      { code: "overlaps_device", deviceId: "fr", otherDeviceId: "G1-rcd" },
    ]);
    expect(START).toEqual(startCopy);
  });

  it("clamps a drop past the rail end through the snap", () => {
    // (b) rail 320 mm, FR 35 mm → at most 285 (= 32.57 TE, off the grid; staying on the rail wins).
    const x = snapX(SEED_B.rails[0], 400, 35);
    expect(x).toBe(285);
    expect(accepted(moveDevice(CONTEXT, START, "fr", { railIndex: 0, xMm: x }))).toEqual(
      patched(START, [{ projectDeviceId: "fr", railIndex: 0, xMm: 285 }]),
    );
  });

  it("refuses a drop onto a bar (overlaps_bar)", () => {
    // (b) plus a horizontal N bar at x 300–360, y 240–250: under rail 1 (y 200–235) but inside its
    // 85 mm device band (y 175–260). u at 270 spans x 310–327.5 → on the bar; at 200 (x 240–257.5) → clear.
    const withBar = geometry({
      ...SEED_B,
      bars: [
        ...SEED_B.bars,
        {
          kind: "N",
          orientation: "horizontal",
          xMm: 300,
          yMm: 240,
          lengthMm: 60,
          heightMm: 10,
          zMm: 20,
          terminalGroups: TERMINALS,
        },
      ],
    });
    const context = { ...CONTEXT, geometry: withBar };
    expect(refused(moveDevice(context, START, "mcb-u", { railIndex: 1, xMm: 270 }))).toEqual([
      { code: "overlaps_bar", deviceId: "mcb-u" },
    ]);
    expect(accepted(moveDevice(context, START, "mcb-u", { railIndex: 1, xMm: 200 }))).toEqual(
      patched(START, [{ projectDeviceId: "mcb-u", railIndex: 1, xMm: 200 }]),
    );
  });

  it("never lets an RCBO join another group", () => {
    // The RCBO dropped between G1's MCBs (87.5–122.5) sits inside G1 and breaks its contiguity.
    const issues = refused(moveDevice(CONTEXT, START, "G2-rcbo", { railIndex: 0, xMm: 87.5 }));
    expect(issues).toContainEqual({ code: "group_not_contiguous", groupId: "G1" });
    // Free on its own: right after G1 (122.5 + 1 TE = 140) is fine, and it stays in G2.
    expect(accepted(moveDevice(CONTEXT, START, "G2-rcbo", { railIndex: 0, xMm: 140 }))).toEqual(
      patched(START, [{ projectDeviceId: "G2-rcbo", railIndex: 0, xMm: 140 }]),
    );
    expect(START).toEqual(startCopy);
  });

  it("refuses a move of a device it does not know", () => {
    expect(refused(moveDevice(CONTEXT, START, "ghost", { railIndex: 0, xMm: 0 }))).toEqual([
      { code: "unknown_device", deviceId: "ghost" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Snapping and keyboard steps
// ---------------------------------------------------------------------------------------------

describe("snapX", () => {
  it("rounds to 0.5 TE (8.75 mm) from the rail start and clamps to the rail", () => {
    expect(snapX(SEED_B.rails[0], 13, 17.5)).toBe(8.75); // 13 / 8.75 = 1.49 → 1
    expect(snapX(SEED_B.rails[0], 14, 17.5)).toBe(17.5); // 1.6 → 2
    expect(snapX(SEED_B.rails[0], -20, 35)).toBe(0);
    expect(snapX(SEED_A.rails[0], 300, 35)).toBe(195); // (a) rail 230 − 35
    expect(snapX(SEED_A.rails[0], 0, 400)).toBe(0); // wider than the rail
  });
});

describe("keyboardStep", () => {
  it("moves 0.5 TE left or right on the rail", () => {
    expect(keyboardStep(CONTEXT, START, G1_BLOCK, "right")).toEqual({ railIndex: 0, xMm: 61.25 });
    expect(keyboardStep(CONTEXT, START, G1_BLOCK, "left")).toEqual({ railIndex: 0, xMm: 43.75 });
  });

  it("stops at the rail ends", () => {
    const fr: EditUnit = { kind: "device", deviceId: "fr", groupId: null };
    expect(keyboardStep(CONTEXT, START, fr, "left")).toEqual({ railIndex: 0, xMm: 0 });
    const atEnd = patched(START, [{ projectDeviceId: "fr", railIndex: 0, xMm: 285 }]);
    expect(keyboardStep(CONTEXT, atEnd, fr, "right")).toEqual({ railIndex: 0, xMm: 285 });
  });

  it("moves to the adjacent rail with the snapped x kept, and stays at the first and last rail", () => {
    expect(keyboardStep(CONTEXT, START, G1_BLOCK, "down")).toEqual({ railIndex: 1, xMm: 52.5 });
    expect(keyboardStep(CONTEXT, START, G1_BLOCK, "up")).toEqual({ railIndex: 0, xMm: 52.5 });
    const u: EditUnit = { kind: "device", deviceId: "mcb-u", groupId: null };
    expect(keyboardStep(CONTEXT, START, u, "up")).toEqual({ railIndex: 0, xMm: 0 });
  });

  it("returns a preview, not a verdict: the step onto the RCBO is still offered", () => {
    // u at 0 → right 8.75 is inside rail 1 and clear; the drop decides, not the step.
    const u: EditUnit = { kind: "device", deviceId: "mcb-u", groupId: null };
    const atRcbo = patched(START, [{ projectDeviceId: "mcb-u", railIndex: 1, xMm: 17.5 }]);
    expect(keyboardStep(CONTEXT, atRcbo, u, "right")).toEqual({ railIndex: 1, xMm: 26.25 });
    expect(moveUnit(CONTEXT, atRcbo, u, { railIndex: 1, xMm: 26.25 }).ok).toBe(false);
  });
});

describe("previewMove", () => {
  it("packs a block at the target with no verdict, and leaves the draft alone", () => {
    // RCD 0–35, a 35–52.5, b 52.5–70 on rail 1 at x 0 — right over mcb-u, which a drop would refuse.
    const preview = previewMove(CONTEXT, START, G1_BLOCK, { railIndex: 1, xMm: 0 });
    expect(preview.placements.slice(1, 5)).toEqual([
      { projectDeviceId: "G1-rcd", railIndex: 1, xMm: 0 },
      { projectDeviceId: "mcb-a", railIndex: 1, xMm: 35 },
      { projectDeviceId: "mcb-b", railIndex: 1, xMm: 52.5 },
      { projectDeviceId: "mcb-u", railIndex: 1, xMm: 0 },
    ]);
    expect(moveUnit(CONTEXT, START, G1_BLOCK, { railIndex: 1, xMm: 0 }).ok).toBe(false);
    expect(START).toEqual(startCopy);
  });

  it("places a single device where it is dropped", () => {
    const fr: EditUnit = { kind: "device", deviceId: "fr", groupId: null };
    expect(previewMove(CONTEXT, START, fr, { railIndex: 2, xMm: 17.5 }).placements[0]).toEqual({
      projectDeviceId: "fr",
      railIndex: 2,
      xMm: 17.5,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------------------------

describe("history", () => {
  const d1 = accepted(moveUnit(CONTEXT, START, G1_BLOCK, { railIndex: 2, xMm: 100 }));
  const d2 = accepted(moveDevice(CONTEXT, d1, "fr", { railIndex: 0, xMm: 285 }));

  it("undo and redo restore exact drafts", () => {
    let h = history.start(START);
    h = history.commit(h, d1);
    h = history.commit(h, d2);
    h = history.undo(h);
    expect(h.present).toEqual(d1);
    h = history.undo(h);
    expect(h.present).toEqual(START);
    expect(history.undo(h)).toBe(h);
    h = history.redo(h);
    expect(h.present).toEqual(d1);
    h = history.redo(h);
    expect(h.present).toEqual(d2);
    expect(history.redo(h)).toBe(h);
  });

  it("drops the redo branch on a new commit, and never mutates", () => {
    const h0 = history.commit(history.commit(history.start(START), d1), d2);
    const undone = history.undo(h0);
    const branched = history.commit(undone, START);
    expect(branched.future).toEqual([]);
    expect(undone.future).toEqual([d2]);
    expect(h0.present).toEqual(d2);
  });

  it("keeps at most 50 undo steps and resets to a fresh present", () => {
    let h = history.start(0);
    for (let i = 1; i <= 60; i++) h = history.commit(h, i);
    expect(h.past).toHaveLength(50);
    expect(h.past[0]).toBe(10);
    expect(history.reset(START)).toEqual({ past: [], present: START, future: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// The hidden field
// ---------------------------------------------------------------------------------------------

describe("parsePlacementsPayload", () => {
  const ID = "5b1d6a3e-0c2f-4e8a-9b7d-1a2b3c4d5e6f";
  const ID2 = "6c2e7b4f-1d3a-4f9b-8c8e-2b3c4d5e6f70";
  const item = { projectDeviceId: ID, railIndex: 1, xMm: 26.25 };

  it("accepts a well-formed array and drops extra keys", () => {
    expect(
      parsePlacementsPayload([
        { ...item, extra: true },
        { projectDeviceId: ID2, railIndex: 0, xMm: 0 },
      ]),
    ).toEqual({
      ok: true,
      placements: [item, { projectDeviceId: ID2, railIndex: 0, xMm: 0 }],
    });
    expect(parsePlacementsPayload([])).toEqual({ ok: true, placements: [] });
  });

  it.each([
    ["not an array", { placements: [item] }],
    ["null", null],
    ["a string", JSON.stringify([item])],
    ["an item that is not an object", [item, 3]],
    ["an array item", [[ID, 1, 0]]],
    ["a missing id", [{ railIndex: 1, xMm: 0 }]],
    ["a non-uuid id", [{ ...item, projectDeviceId: "fr" }]],
    ["a negative rail", [{ ...item, railIndex: -1 }]],
    ["a fractional rail", [{ ...item, railIndex: 1.5 }]],
    ["a rail as text", [{ ...item, railIndex: "1" }]],
    ["a rail beyond smallint", [{ ...item, railIndex: 32768 }]],
    ["a negative offset", [{ ...item, xMm: -0.01 }]],
    ["three decimals", [{ ...item, xMm: 1.234 }]],
    ["an infinite offset", [{ ...item, xMm: Infinity }]],
    ["NaN", [{ ...item, xMm: Number.NaN }]],
    ["an offset as text", [{ ...item, xMm: "26.25" }]],
    ["an offset beyond numeric(7,2)", [{ ...item, xMm: 100000 }]],
    ["a duplicate id (any case)", [item, { ...item, projectDeviceId: ID.toUpperCase() }]],
    ["more than 200 items", Array.from({ length: 201 }, () => item)],
  ])("rejects %s", (_name, raw) => {
    expect(parsePlacementsPayload(raw)).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Carry-over across a re-match
// ---------------------------------------------------------------------------------------------

describe("carryOverPlacements", () => {
  /** The same devices under index ids, as `proposeSelectionLayout` builds them. */
  const reindexed = (devices: LayoutDevice[]) => devices.map((d, i) => ({ ...d, id: String(i), position: i }));
  const old = { devices: DEVICES, placements: START.placements };

  it("keeps an identical set, under the new ids", () => {
    expect(carryOverPlacements(old, reindexed(DEVICES), SEED_B, GROUPS)).toEqual([
      { projectDeviceId: "0", railIndex: 0, xMm: 0 },
      { projectDeviceId: "1", railIndex: 0, xMm: 52.5 },
      { projectDeviceId: "2", railIndex: 0, xMm: 87.5 },
      { projectDeviceId: "3", railIndex: 0, xMm: 105 },
      { projectDeviceId: "4", railIndex: 1, xMm: 0 },
      { projectDeviceId: "5", railIndex: 1, xMm: 35 },
    ]);
  });

  it("keeps the layout when a circuit was renamed (same group and circuit ids, another catalog row)", () => {
    // Circuit names are not part of the key; the matcher may also pick another row of the same width.
    const next = reindexed(DEVICES).map((d) => (d.circuit_id === "a" ? { ...d, n_terminal_side: null } : d));
    expect(carryOverPlacements(old, next, SEED_B, GROUPS)).toEqual([
      { projectDeviceId: "0", railIndex: 0, xMm: 0 },
      { projectDeviceId: "1", railIndex: 0, xMm: 52.5 },
      { projectDeviceId: "2", railIndex: 0, xMm: 87.5 },
      { projectDeviceId: "3", railIndex: 0, xMm: 105 },
      { projectDeviceId: "4", railIndex: 1, xMm: 0 },
      { projectDeviceId: "5", railIndex: 1, xMm: 35 },
    ]);
  });

  it("returns null for an added circuit (a new device has no old counterpart)", () => {
    const next = reindexed([...DEVICES, device("mcb-c", "mcb", "1P", 17.5, 6, "G1", "c")]);
    expect(carryOverPlacements(old, next, SEED_B, GROUPS)).toBeNull();
  });

  it("returns null for a removed circuit (an old placement has no new device)", () => {
    const next = reindexed(DEVICES.filter((d) => d.id !== "mcb-u"));
    expect(carryOverPlacements(old, next, SEED_B, GROUPS)).toBeNull();
  });

  it("returns null when a wider replacement device overlaps its neighbour", () => {
    // a becomes 35 mm wide: 87.5–122.5 covers b at 105–122.5.
    const next = reindexed(DEVICES.map((d) => (d.id === "mcb-a" ? { ...d, width_mm: 35 } : d)));
    expect(carryOverPlacements(old, next, SEED_B, GROUPS)).toBeNull();
  });

  it("returns null when a key repeats on either side", () => {
    const twin = device("mcb-a2", "mcb", "1P", 17.5, 6, "G1", "a");
    expect(carryOverPlacements(old, reindexed([...DEVICES, twin]), SEED_B, GROUPS)).toBeNull();
    const oldTwin = {
      devices: [...DEVICES, twin],
      placements: [...START.placements, { projectDeviceId: "mcb-a2", railIndex: 2, xMm: 0 }],
    };
    expect(carryOverPlacements(oldTwin, reindexed(DEVICES), SEED_B, GROUPS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Issue messages
// ---------------------------------------------------------------------------------------------

describe("layoutIssueMessage", () => {
  const names = { devices: { fr: "FR 40A", "mcb-a": "B16 Oświetlenie" }, groups: { G1: "RCD 1" } };

  it.each<[LayoutIssue, string]>([
    [{ code: "device_not_placed", deviceId: "fr" }, "Aparat „FR 40A” nie ma miejsca w układzie."],
    [{ code: "device_placed_twice", deviceId: "fr" }, "Aparat „FR 40A” występuje w układzie więcej niż raz."],
    [{ code: "unknown_device", deviceId: "x" }, "Układ zawiera aparat „x”, którego nie ma w doborze aparatów."],
    [{ code: "outside_rail", deviceId: "fr" }, "Aparat „FR 40A” wystaje poza szynę DIN."],
    [
      { code: "overlaps_device", deviceId: "mcb-a", otherDeviceId: "fr" },
      "Aparat „B16 Oświetlenie” nachodzi na aparat „FR 40A”.",
    ],
    [{ code: "outside_interior", deviceId: "fr" }, "Aparat „FR 40A” wystaje poza wnętrze szafki."],
    [{ code: "overlaps_bar", deviceId: "mcb-a" }, "Aparat „B16 Oświetlenie” nachodzi na szynę PE/N."],
    [
      { code: "overlaps_other_rail_device", deviceId: "fr", otherDeviceId: "mcb-a" },
      "Aparat „FR 40A” nachodzi na aparat „B16 Oświetlenie” na sąsiedniej szynie DIN.",
    ],
    [
      { code: "group_not_contiguous", groupId: "G1" },
      "Aparaty grupy „RCD 1” muszą stać obok siebie na jednej szynie DIN — między nie nie może wejść inny aparat.",
    ],
    [{ code: "rcbo_not_alone", groupId: "G2" }, "Wyłącznik RCBO grupy „G2” musi być jedynym aparatem w tej grupie."],
  ])("names the device or group: %j", (issue, message) => {
    expect(layoutIssueMessage(issue, names)).toBe(message);
  });
});

// ---------------------------------------------------------------------------------------------
// Comb busbar rows (rcd-group-busbars, Phase 3)
// ---------------------------------------------------------------------------------------------

describe("busbar rows in the editing model", () => {
  const busbar: LayoutDevice = {
    ...device("bus-G1", "mcb", "1P", 105, 6, "G1"),
    role: "busbar",
    kind: "comb_busbar",
    height_mm: 20,
  };
  const WITH_BUSBAR = [...DEVICES, busbar];
  const context: EditContext = { devices: WITH_BUSBAR, geometry: SEED_B, groups: GROUPS };

  it("never lists a busbar row as a block member or a draggable device", () => {
    const units = editUnits(WITH_BUSBAR, GROUPS, SEED_B);
    expect(units).toEqual(editUnits(DEVICES, GROUPS, SEED_B));
    expect(JSON.stringify(units)).not.toContain("bus-G1");
  });

  it("moves a group device without a placement for the busbar row being required", () => {
    expect(moveUnit(context, START, G1_BLOCK, { railIndex: 1, xMm: 100 }).ok).toBe(true);
    expect(moveDevice(context, START, "mcb-a", { railIndex: 0, xMm: 105 }).ok).toBeDefined();
  });

  it("refuses to move a busbar row", () => {
    expect(moveDevice(context, START, "bus-G1", { railIndex: 0, xMm: 0 })).toEqual({
      ok: false,
      issues: [{ code: "unknown_device", deviceId: "bus-G1" }],
    });
  });

  it("carries a manual layout over a device set that gained a busbar row", () => {
    const next = WITH_BUSBAR.map((d, i) => ({ ...d, id: String(i), position: i }));
    const carried = carryOverPlacements({ devices: DEVICES, placements: START.placements }, next, SEED_B, GROUPS);
    expect(carried).toHaveLength(DEVICES.length);
    expect(carried?.map((p) => p.projectDeviceId)).not.toContain("6");
  });

  it("carries a layout from a snapshot that already had a busbar row", () => {
    const carried = carryOverPlacements(
      { devices: WITH_BUSBAR, placements: START.placements },
      DEVICES.map((d, i) => ({ ...d, id: String(i), position: i })),
      SEED_B,
      GROUPS,
    );
    expect(carried).toHaveLength(DEVICES.length);
  });
});
