import { describe, expect, it } from "vitest";
import {
  deviceRect,
  barTerminalPoints,
  deviceTerminals,
  GROUP_GAP_MM,
  layoutFailureMessage,
  proposeLayout,
  validateLayout,
  type LayoutCircuit,
  type LayoutDevice,
  type LayoutGroup,
  type LayoutInput,
  type LayoutResult,
  type Placement,
} from "./cabinet-layout";
import { geometry, SEED_A, SEED_B, SEED_C, TERMINALS } from "./cabinet-layout.fixtures";
import type { EntrySide } from "./circuit-params";
import { polesCarryN, type NTerminalSide, type PoleConfig } from "./device-spec";

/*
 * Oracles from the plan's precedence record ("Precedence and placement rules"), not from the code:
 * every expected rail and offset below is worked out by hand from the rule text and the seed
 * geometries in `supabase/seed.sql`.
 */

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

type Draft = Omit<LayoutDevice, "position" | "id"> & { id?: string };

const KIND = { main_switch: "switch_disconnector", rcd: "rcd", rcbo: "rcbo", mcb: "mcb_b" } as const;

function draft(
  role: keyof typeof KIND,
  poles: PoleConfig,
  widthMm: number,
  extra: { id?: string; group?: string | null; circuit?: string | null; nSide?: NTerminalSide } = {},
): Draft {
  return {
    id: extra.id,
    role,
    kind: KIND[role],
    rcd_group_id: extra.group ?? null,
    circuit_id: extra.circuit ?? null,
    width_mm: widthMm,
    height_mm: 85,
    poles,
    n_terminal_side: polesCarryN(poles) ? (extra.nSide ?? "left") : null,
  };
}

const mainSwitch = (id = "fr") => draft("main_switch", "2P", 35, { id });
const rcd = (group: string, id: string, extra: { poles?: PoleConfig; width?: number; nSide?: NTerminalSide } = {}) =>
  draft("rcd", extra.poles ?? "2P", extra.width ?? 35, { id, group, nSide: extra.nSide });
const mcb = (circuit: string, group: string | null, id = `mcb-${circuit}`, poles: PoleConfig = "1P", width = 17.5) =>
  draft("mcb", poles, width, { id, group, circuit });

/** Positions follow the array order; ids default to `dev-<index>`. */
function devices(...drafts: Draft[]): LayoutDevice[] {
  return drafts.map((d, index) => ({ ...d, id: d.id ?? `dev-${String(index)}`, position: index }));
}

function circuits(entries: [string, EntrySide][]): LayoutCircuit[] {
  return entries.map(([id, entry_side]) => ({ id, entry_side }));
}

function groups(...ids: string[]): LayoutGroup[] {
  return ids.map((id) => ({ id, label: id }));
}

function placed(result: LayoutResult): Placement[] {
  if (!result.ok) throw new Error(`expected a layout, got ${JSON.stringify(result.reason)}`);
  return result.placements;
}

function at(result: LayoutResult, id: string): Placement {
  const placement = placed(result).find((p) => p.projectDeviceId === id);
  if (placement === undefined) throw new Error(`device ${id} not placed`);
  return placement;
}

function proposeValid(input: LayoutInput): LayoutResult {
  const result = proposeLayout(input);
  if (result.ok) expect(validateLayout(input.devices, result.placements, input.geometry, input.groups)).toEqual([]);
  return result;
}

/** A group `g` of an RCD and one 1P MCB per circuit, all circuits entering from `side`. */
function simpleGroup(g: string, sides: EntrySide[], rcdExtra: Parameters<typeof rcd>[2] = {}) {
  const ids = sides.map((_, i) => `${g}-c${String(i)}`);
  return {
    drafts: [rcd(g, `${g}-rcd`, rcdExtra), ...ids.map((id) => mcb(id, g))],
    circuits: ids.map((id, i): [string, EntrySide] => [id, sides[i]]),
  };
}

// ---------------------------------------------------------------------------------------------
// Rule 2 — sides and rail ranking
// ---------------------------------------------------------------------------------------------

describe("rule 2: a block goes to the rails its circuits enter from", () => {
  it("puts a top-entry group on the top rail of (b)", () => {
    const g = simpleGroup("G1", ["top", "top"]);
    const input = {
      devices: devices(mainSwitch(), ...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_B,
    };
    const result = proposeValid(input);
    for (const id of ["fr", "G1-rcd", "mcb-G1-c0", "mcb-G1-c1"]) expect(at(result, id).railIndex).toBe(0);
  });

  it("puts a bottom-entry group on the bottom rail of (b)", () => {
    const g = simpleGroup("G1", ["bottom", "bottom"]);
    const result = proposeValid({
      devices: devices(mainSwitch(), ...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_B,
    });
    expect(at(result, "fr").railIndex).toBe(0); // entries[0] is the top entry
    for (const id of ["G1-rcd", "mcb-G1-c0", "mcb-G1-c1"]) expect(at(result, id).railIndex).toBe(2);
  });

  it("puts a bottom-entry group on the bottom row of (c)", () => {
    const g = simpleGroup("G1", ["bottom", "bottom"]);
    const result = proposeValid({
      devices: devices(...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_C,
    });
    expect([3, 4]).toContain(at(result, "G1-rcd").railIndex);
  });

  it("puts a left-entry group at the start of the rail nearest the left entries' midpoint in (c)", () => {
    // Left entry spans y 200–600, midpoint 400; rail centres 117.5 / 267.5 / 417.5 / 567.5 → rail 2.
    const g = simpleGroup("G1", ["left", "left", "left"]);
    const result = proposeValid({
      devices: devices(mainSwitch(), ...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_C,
    });
    expect(at(result, "G1-rcd")).toEqual({ projectDeviceId: "G1-rcd", railIndex: 2, xMm: 0 });
    expect(at(result, "mcb-G1-c0")).toMatchObject({ railIndex: 2, xMm: 35 });
    expect(at(result, "mcb-G1-c2")).toMatchObject({ railIndex: 2, xMm: 70 });
  });

  it("takes the side most circuits use", () => {
    const g = simpleGroup("G1", ["bottom", "top", "top"]);
    const result = proposeValid({
      devices: devices(...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_B,
    });
    expect(at(result, "G1-rcd").railIndex).toBe(0);
  });

  it("breaks a tie by the earliest circuit in group order", () => {
    const bottomFirst = simpleGroup("G1", ["bottom", "top"]);
    const topFirst = simpleGroup("G1", ["top", "bottom"]);
    const run = (g: ReturnType<typeof simpleGroup>) =>
      proposeValid({
        devices: devices(...g.drafts),
        groups: groups("G1"),
        circuits: circuits(g.circuits),
        geometry: SEED_B,
      });
    expect(at(run(bottomFirst), "G1-rcd").railIndex).toBe(2);
    expect(at(run(topFirst), "G1-rcd").railIndex).toBe(0);
  });

  it("skips a side the cabinet has no entry on, and falls back to top when none is usable", () => {
    // (b) has only top and bottom entries.
    const skipped = simpleGroup("G1", ["left", "left", "bottom"]);
    const none = simpleGroup("G1", ["left", "right"]);
    const run = (g: ReturnType<typeof simpleGroup>) =>
      proposeValid({
        devices: devices(...g.drafts),
        groups: groups("G1"),
        circuits: circuits(g.circuits),
        geometry: SEED_B,
      });
    expect(at(run(skipped), "G1-rcd").railIndex).toBe(2);
    expect(at(run(none), "G1-rcd").railIndex).toBe(0);
  });

  it("puts the main switch on the rail ranked first for entries[0], at the end nearest the entry", () => {
    // (b): entries[0] is top → rail 0.
    const b = proposeValid({ devices: devices(mainSwitch()), groups: [], circuits: [], geometry: SEED_B });
    expect(at(b, "fr").railIndex).toBe(0);

    // (c): entries[0] is bottom (x 100–500, midpoint 300) → rails 3 and 4 tie on rank. The rail ends
    // nearest x 300 are rail 3's end (x 270) and rail 4's start (x 330), 30 mm each; rule 3 breaks
    // the tie: the FR's N (left slot, x 243.75 vs 338.75) is nearer the N bar's first terminal group
    // (x ≈ 277.8), and the PE term is equal (both centres sit above the PE bar). → rail 3, end.
    const c = proposeValid({ devices: devices(mainSwitch()), groups: [], circuits: [], geometry: SEED_C });
    expect(at(c, "fr")).toEqual({ projectDeviceId: "fr", railIndex: 3, xMm: 205 });
  });

  it("places the ungrouped block after every group, whatever its snapshot position", () => {
    // Rail 0 of (b) is 320 mm: the FR (35) and the group (70 + 12 × 17.5 = 280) leave 5 mm.
    const groupCircuits = Array.from({ length: 12 }, (_, i) => `g${String(i)}`);
    const input = {
      devices: devices(
        mcb("u0", null),
        mcb("u1", null),
        mainSwitch(),
        rcd("G1", "G1-rcd", { poles: "4P", width: 70 }),
        ...groupCircuits.map((id) => mcb(id, "G1")),
      ),
      groups: groups("G1"),
      circuits: circuits([
        ...groupCircuits.map((id): [string, EntrySide] => [id, "top"]),
        ["u0", "top"],
        ["u1", "top"],
      ]),
      geometry: SEED_B,
    };
    const result = proposeValid(input);
    expect(at(result, "G1-rcd").railIndex).toBe(0);
    expect(at(result, "mcb-u0").railIndex).toBe(1);
    expect(at(result, "mcb-u1").railIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Rule 3 — tie-break only
// ---------------------------------------------------------------------------------------------

describe("rule 3: the N + PE score breaks ties", () => {
  it("decides the fill end and the tied rail in (c)", () => {
    // Bottom group (RCD 2P, N right + one MCB, 52.5 mm) → rails 3 and 4 tie on rank. The PE bar spans
    // x 50–550 under all four candidate positions, so the PE term is equal; the RCD's line N lands at
    // x 56.25 (rail 3 start), 243.75 (rail 3 end), 356.25 (rail 4 start) or 543.75 (rail 4 end), and
    // the N bar's terminal groups sit at x ≈ 277.8 and ≈ 477.8 → rail 3, end (xMm 240 − 52.5).
    const result = proposeValid({
      devices: devices(rcd("G1", "G1-rcd", { nSide: "right" }), mcb("c0", "G1")),
      groups: groups("G1"),
      circuits: circuits([["c0", "bottom"]]),
      geometry: SEED_C,
    });
    expect(at(result, "G1-rcd")).toEqual({ projectDeviceId: "G1-rcd", railIndex: 3, xMm: 187.5 });
    expect(at(result, "mcb-c0")).toEqual({ projectDeviceId: "mcb-c0", railIndex: 3, xMm: 222.5 });
  });

  it("decides nothing in (a), which has no bars: the block fills from the rail start", () => {
    for (const nSide of ["left", "right"] as const) {
      const result = proposeValid({
        devices: devices(rcd("G1", "G1-rcd", { nSide }), mcb("c0", "G1")),
        groups: groups("G1"),
        circuits: circuits([["c0", "top"]]),
        geometry: SEED_A,
      });
      expect(at(result, "G1-rcd")).toEqual({ projectDeviceId: "G1-rcd", railIndex: 0, xMm: 0 });
    }
  });

  it("never overrides rule 2: a left-entry block still starts at the rail start", () => {
    const result = proposeValid({
      devices: devices(rcd("G1", "G1-rcd", { nSide: "right" }), mcb("c0", "G1")),
      groups: groups("G1"),
      circuits: circuits([["c0", "left"]]),
      geometry: SEED_C,
    });
    expect(at(result, "G1-rcd")).toMatchObject({ railIndex: 2, xMm: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------------------------

describe("gaps between blocks", () => {
  it("opens a 1-TE gap where the rail has room", () => {
    // (a): FR at the rail start (both ends 115 mm from the entry midpoint, no bars), group after it.
    const result = proposeValid({
      devices: devices(mainSwitch(), rcd("G1", "G1-rcd"), mcb("c0", "G1")),
      groups: groups("G1"),
      circuits: circuits([["c0", "top"]]),
      geometry: SEED_A,
    });
    expect(at(result, "fr").xMm).toBe(0);
    expect(at(result, "G1-rcd").xMm).toBe(35 + GROUP_GAP_MM);
    expect(at(result, "mcb-c0").xMm).toBe(70 + GROUP_GAP_MM);
  });

  it("keeps a rail packed when it has no room for every gap", () => {
    // 35 + 70 + 7 × 17.5 = 227.5 of 230 mm: 2.5 mm free < 17.5 mm.
    const ids = Array.from({ length: 7 }, (_, i) => `c${String(i)}`);
    const result = proposeValid({
      devices: devices(
        mainSwitch(),
        rcd("G1", "G1-rcd", { poles: "4P", width: 70 }),
        ...ids.map((id) => mcb(id, "G1")),
      ),
      groups: groups("G1"),
      circuits: circuits(ids.map((id): [string, EntrySide] => [id, "top"])),
      geometry: SEED_A,
    });
    expect(at(result, "G1-rcd").xMm).toBe(35);
  });

  it("shifts end-anchored blocks toward the start, keeping the anchor end flush", () => {
    // (c), two bottom groups (RCD 2P with N on the left + one MCB, 52.5 mm each) → rails 3 and 4 tie
    // on rank; the PE term is equal everywhere (the PE bar spans x 50–550 below all of them). The N
    // bar's terminal groups sit at x ≈ 277.8 and ≈ 477.8. A's line N would land at x 38.75 / 226.25
    // (rail 3 start / end) or 338.75 / 526.25 (rail 4): rail 4's end is nearest (48.5 mm off).
    // B's N at rail 4's end, next to A, lands at x 473.75 (4 mm off) → rail 4, end too.
    // A stays flush with the rail end; B shifts one gap toward the start.
    const a = simpleGroup("A", ["bottom"]);
    const b = simpleGroup("B", ["bottom"]);
    const result = proposeValid({
      devices: devices(...a.drafts, ...b.drafts),
      groups: groups("A", "B"),
      circuits: circuits([...a.circuits, ...b.circuits]),
      geometry: SEED_C,
    });
    expect(at(result, "A-rcd")).toMatchObject({ railIndex: 4, xMm: 240 - 52.5 });
    expect(at(result, "B-rcd")).toMatchObject({ railIndex: 4, xMm: 240 - 105 - GROUP_GAP_MM });
  });

  it("lets the PE term outweigh the N term in (b), where the bars sit on opposite sides", () => {
    // Bottom group on rail 2 (y 320). Start: the line N at x 48.75 is ≈ 342 mm to the N bar's
    // nearest group + 41.25 mm from the centre to the PE bar ≈ 383. End: ≈ 99 + 308.75 ≈ 408 → start.
    const g = simpleGroup("G1", ["bottom"]);
    const result = proposeValid({
      devices: devices(...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_B,
    });
    expect(at(result, "G1-rcd")).toEqual({ projectDeviceId: "G1-rcd", railIndex: 2, xMm: 0 });
  });
});

// ---------------------------------------------------------------------------------------------
// Rule 1 — one rail, except a group wider than every rail; does_not_fit
// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// Catalog PE/N bars (plan Phase 5b)
// ---------------------------------------------------------------------------------------------

describe("catalog PE/N bars", () => {
  const catalogBar = (role: "pe_bar" | "n_bar", width = 35): Draft => ({
    id: role,
    role,
    kind: role,
    rcd_group_id: null,
    circuit_id: null,
    width_mm: width,
    height_mm: 15,
    poles: null,
    n_terminal_side: null,
  });
  const g = simpleGroup("G1", ["top", "top"]);

  it("go last, PE then N, at the end of the WLZ entry's rail opposite the main switch", () => {
    // (a): one 230 mm rail, top entry midpoint x 125 — both rail ends 115 mm away, no bars, so the FR
    // takes the rail start. G1 (52.5) follows it; the bars (70) fill from the rail end: 230 − 70 = 160.
    // Three blocks, 157.5 mm used, 72.5 free ≥ 2 gaps: G1 shifts one TE toward the middle.
    // Snapshot order puts the bars first; placement order does not follow it.
    const result = proposeValid({
      devices: devices(catalogBar("pe_bar"), catalogBar("n_bar"), mainSwitch(), ...g.drafts),
      groups: groups("G1"),
      circuits: circuits(g.circuits),
      geometry: SEED_A,
    });
    expect(at(result, "fr").xMm).toBe(0);
    expect(at(result, "G1-rcd").xMm).toBe(52.5);
    expect(at(result, "pe_bar")).toEqual({ projectDeviceId: "pe_bar", railIndex: 0, xMm: 160 });
    expect(at(result, "n_bar")).toEqual({ projectDeviceId: "n_bar", railIndex: 0, xMm: 195 });
  });

  it("take the rail start when the main switch sits at the rail end", () => {
    // (c) without its bars: entries[0] is bottom (midpoint x 300) → rails 3 and 4 tie; the FR goes to
    // rail 3's end (30 mm from the entry, the earlier rail) and the bars to rail 3's start.
    const result = proposeValid({
      devices: devices(mainSwitch(), catalogBar("pe_bar"), catalogBar("n_bar")),
      groups: [],
      circuits: [],
      geometry: { ...SEED_C, bars: [] },
    });
    expect(at(result, "fr")).toEqual({ projectDeviceId: "fr", railIndex: 3, xMm: 205 });
    expect(at(result, "pe_bar")).toEqual({ projectDeviceId: "pe_bar", railIndex: 3, xMm: 0 });
    expect(at(result, "n_bar")).toEqual({ projectDeviceId: "n_bar", railIndex: 3, xMm: 35 });
  });

  it("count toward does_not_fit like any device, and are named when they are what does not fit", () => {
    // FR 35 + G1 (35 + 4 × 17.5 = 105) + two 70 mm bars = 280 mm = 16 TE on (a)'s 13 TE rail.
    const big = simpleGroup("G1", ["top", "top", "top", "top"]);
    const result = proposeLayout({
      devices: devices(mainSwitch(), ...big.drafts, catalogBar("pe_bar", 70), catalogBar("n_bar", 70)),
      groups: groups("G1"),
      circuits: circuits(big.circuits),
      geometry: SEED_A,
    });
    expect(result).toEqual({
      ok: false,
      reason: {
        code: "does_not_fit",
        requiredModules: 16,
        availableModules: 13,
        blockLabel: "Szyny PE/N z katalogu",
      },
    });
  });

  it("are not part of the ungrouped block", () => {
    const result = proposeValid({
      devices: devices(mainSwitch(), mcb("u0", null), catalogBar("pe_bar")),
      groups: [],
      circuits: circuits([["u0", "top"]]),
      geometry: SEED_A,
    });
    // The ungrouped MCB follows the FR from the start; the bar fills from the end.
    expect(at(result, "mcb-u0").xMm).toBeLessThan(at(result, "pe_bar").xMm);
    expect(at(result, "pe_bar").xMm).toBe(230 - 35);
  });
});

describe("rule 1 and the shortfall", () => {
  // RCD 4P (70 mm) + 16 MCBs (280 mm) = 350 mm = 20 TE: wider than every rail of (a) and (b).
  const wideIds = Array.from({ length: 16 }, (_, i) => `w${String(i)}`);
  const wide = {
    devices: devices(rcd("G1", "G1-rcd", { poles: "4P", width: 70 }), ...wideIds.map((id) => mcb(id, "G1"))),
    groups: groups("G1"),
    circuits: circuits(wideIds.map((id): [string, EntrySide] => [id, "top"])),
  };

  it("continues a group wider than every rail onto the next rail in its order", () => {
    // Top → rails 0, 1, 2. Rail 0 (320 mm) takes the RCD and 14 MCBs (315 mm); the rest go to rail 1.
    const result = proposeValid({ ...wide, geometry: SEED_B });
    expect(at(result, "G1-rcd").railIndex).toBe(0);
    for (const id of wideIds.slice(0, 14)) expect(at(result, `mcb-${id}`).railIndex).toBe(0);
    for (const id of wideIds.slice(14)) expect(at(result, `mcb-${id}`).railIndex).toBe(1);
  });

  it("reports does_not_fit with the TE counts when the cabinet has one rail", () => {
    // 350 mm = 20 TE needed; the 230 mm rail holds 13 whole modules (13.14 → 13).
    const result = proposeLayout({ ...wide, geometry: SEED_A });
    expect(result).toEqual({
      ok: false,
      reason: { code: "does_not_fit", requiredModules: 20, availableModules: 13, blockLabel: "Grupa „G1”" },
    });
    if (!result.ok) {
      expect(layoutFailureMessage(result.reason)).toBe(
        "Dobrane aparaty nie mieszczą się na szynach DIN tej szafki: potrzeba 20 TE, a szyny mają łącznie 13 TE. Pierwszy blok, który się nie zmieścił: Grupa „G1”. Wybierz większą szafkę albo zmniejsz liczbę obwodów.",
      );
    }
  });

  it("never splits a block narrower than a rail, even when the total length would suffice", () => {
    // (a): FR 35 + group A 140 = 175 mm; group B 70 mm does not fit the remaining 55 mm.
    const aIds = Array.from({ length: 6 }, (_, i) => `a${String(i)}`);
    const result = proposeLayout({
      devices: devices(
        mainSwitch(),
        rcd("A", "A-rcd"),
        ...aIds.map((id) => mcb(id, "A")),
        rcd("B", "B-rcd"),
        mcb("b0", "B"),
        mcb("b1", "B"),
      ),
      groups: groups("A", "B"),
      circuits: circuits([...aIds.map((id): [string, EntrySide] => [id, "top"]), ["b0", "top"], ["b1", "top"]]),
      geometry: SEED_A,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.blockLabel).toBe("Grupa „B”");
      expect(result.reason.requiredModules).toBe(14); // 245 mm
      expect(result.reason.availableModules).toBe(13);
    }
  });

  it("reports the main switch as its own block", () => {
    const tiny = geometry({
      version: 1,
      interior: { widthMm: 100, heightMm: 200, depthMm: 90 },
      rails: [{ xMm: 10, yMm: 80, lengthMm: 30 }],
      entries: [{ side: "top", offsetMm: 0, lengthMm: 100 }],
      bars: [],
    });
    const result = proposeLayout({ devices: devices(mainSwitch()), groups: [], circuits: [], geometry: tiny });
    expect(result.ok ? null : result.reason.blockLabel).toBe("Rozłącznik główny (FR)");
  });
});

// ---------------------------------------------------------------------------------------------
// Vertical fit (hand-built: no seed rail ever rejects an 85 mm device)
// ---------------------------------------------------------------------------------------------

describe("vertical fit makes a rail a non-candidate", () => {
  const twoRails = (extra: { rail0Y?: number; bars?: unknown[] }) =>
    geometry({
      version: 1,
      interior: { widthMm: 300, heightMm: 400, depthMm: 100 },
      rails: [
        { xMm: 10, yMm: extra.rail0Y ?? 50, lengthMm: 280 },
        { xMm: 10, yMm: 250, lengthMm: 280 },
      ],
      entries: [{ side: "top", offsetMm: 0, lengthMm: 300 }],
      bars: extra.bars ?? [],
    });
  const g = simpleGroup("G1", ["top"]);
  const input = { devices: devices(...g.drafts), groups: groups("G1"), circuits: circuits(g.circuits) };

  it("skips a rail whose device band crosses a horizontal bar", () => {
    // Rail 0 at y 50: devices span y 25–110; the bar at y 95–105 sits inside that band.
    const bar = {
      kind: "PE",
      orientation: "horizontal",
      xMm: 10,
      yMm: 95,
      lengthMm: 280,
      heightMm: 10,
      zMm: 20,
      terminalGroups: TERMINALS,
    };
    const result = proposeValid({ ...input, geometry: twoRails({ bars: [bar] }) });
    expect(at(result, "G1-rcd").railIndex).toBe(1);
  });

  it("skips a top rail closer than 25 mm to the interior's top edge", () => {
    // Rail 0 at y 10: devices would start at y −15.
    const result = proposeValid({ ...input, geometry: twoRails({ rail0Y: 10 }) });
    expect(at(result, "G1-rcd").railIndex).toBe(1);
  });

  const pitched = (withThirdRail: boolean) =>
    geometry({
      version: 1,
      interior: { widthMm: 300, heightMm: 400, depthMm: 100 },
      rails: [
        { xMm: 10, yMm: 100, lengthMm: 100 },
        { xMm: 10, yMm: 160, lengthMm: 100 },
        ...(withThirdRail ? [{ xMm: 10, yMm: 300, lengthMm: 100 }] : []),
      ],
      entries: [{ side: "top", offsetMm: 0, lengthMm: 300 }],
      bars: [],
    });
  // Group A (87.5 mm) fills rail 0; group B (52.5 mm) cannot share it, and rail 1, 60 mm below,
  // would put B's devices on top of A's.
  const aIds = ["a0", "a1", "a2"];
  const pitchedInput = {
    devices: devices(rcd("A", "A-rcd"), ...aIds.map((id) => mcb(id, "A")), rcd("B", "B-rcd"), mcb("b0", "B")),
    groups: groups("A", "B"),
    circuits: circuits([...aIds.map((id): [string, EntrySide] => [id, "top"]), ["b0", "top"]]),
  };

  it("skips a rail at a pitch under 85 mm where devices would collide, for the next-ranked rail", () => {
    const result = proposeValid({ ...pitchedInput, geometry: pitched(true) });
    expect(at(result, "A-rcd").railIndex).toBe(0);
    expect(at(result, "B-rcd").railIndex).toBe(2);
  });

  it("is does_not_fit when no candidate rail is left", () => {
    const result = proposeLayout({ ...pitchedInput, geometry: pitched(false) });
    expect(result.ok ? null : result.reason.blockLabel).toBe("Grupa „B”");
  });
});

// ---------------------------------------------------------------------------------------------
// Terminals and rects
// ---------------------------------------------------------------------------------------------

describe("deviceRect and deviceTerminals", () => {
  it("centres the device on its rail", () => {
    const [device] = devices(mainSwitch());
    expect(deviceRect({ railIndex: 0, xMm: 10 }, device, SEED_B)).toEqual({ x: 50, y: 55, w: 35, h: 85 });
    expect(deviceRect({ railIndex: 3, xMm: 0 }, device, SEED_B)).toBeNull();
  });

  it("splits the width per pole and puts N by its side", () => {
    const rect = { x: 0, y: 10, w: 70, h: 85 };
    const [left, right, threeP, oneP] = devices(
      draft("rcd", "4P", 70, { nSide: "left" }),
      draft("rcd", "4P", 70, { nSide: "right" }),
      draft("mcb", "3P", 70),
      draft("mcb", "1P", 70),
    );
    expect(deviceTerminals(left, rect).top.map((t) => [t.pole, t.x])).toEqual([
      ["N", 8.75],
      ["L1", 26.25],
      ["L2", 43.75],
      ["L3", 61.25],
    ]);
    expect(deviceTerminals(right, rect).bottom.map((t) => [t.pole, t.x, t.y])).toEqual([
      ["L1", 8.75, 95],
      ["L2", 26.25, 95],
      ["L3", 43.75, 95],
      ["N", 61.25, 95],
    ]);
    expect(deviceTerminals(threeP, rect).top.map((t) => t.pole)).toEqual(["L1", "L2", "L3"]);
    expect(deviceTerminals(oneP, rect).top).toEqual([{ pole: "L", x: 35, y: 10 }]);
  });

  it("throws on an N-carrying device without a side — a bug, not a state", () => {
    const [device] = devices({ ...draft("rcd", "2P", 35), n_terminal_side: null });
    expect(() => deviceTerminals(device, { x: 0, y: 0, w: 35, h: 85 })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// The validator — one hand-built bad placement per issue code
// ---------------------------------------------------------------------------------------------

describe("validateLayout", () => {
  const set = devices(mainSwitch(), rcd("G1", "G1-rcd"), mcb("c0", "G1"), mcb("c1", "G1"), mcb("u0", null));
  const good: Placement[] = [
    { projectDeviceId: "fr", railIndex: 0, xMm: 0 },
    { projectDeviceId: "G1-rcd", railIndex: 0, xMm: 52.5 },
    { projectDeviceId: "mcb-c0", railIndex: 0, xMm: 87.5 },
    { projectDeviceId: "mcb-c1", railIndex: 0, xMm: 105 },
    { projectDeviceId: "mcb-u0", railIndex: 1, xMm: 0 },
  ];
  const validate = (placements: Placement[], geo = SEED_B, devs = set) =>
    validateLayout(devs, placements, geo, groups("G1"));
  const replace = (id: string, patch: Partial<Placement>) =>
    good.map((p) => (p.projectDeviceId === id ? { ...p, ...patch } : p));

  it("accepts a valid layout", () => {
    expect(validate(good)).toEqual([]);
  });

  it("reports coverage: not placed, placed twice, unknown", () => {
    expect(validate(good.filter((p) => p.projectDeviceId !== "mcb-u0"))).toEqual([
      { code: "device_not_placed", deviceId: "mcb-u0" },
    ]);
    expect(validate([...good, { projectDeviceId: "mcb-u0", railIndex: 2, xMm: 0 }])).toEqual([
      { code: "device_placed_twice", deviceId: "mcb-u0" },
    ]);
    expect(validate([...good, { projectDeviceId: "ghost", railIndex: 2, xMm: 0 }])).toEqual([
      { code: "unknown_device", deviceId: "ghost" },
    ]);
  });

  it("reports a device outside its rail", () => {
    expect(validate(replace("mcb-u0", { xMm: 310 }))).toEqual([{ code: "outside_rail", deviceId: "mcb-u0" }]);
    expect(validate(replace("mcb-u0", { railIndex: 5 }))).toEqual([{ code: "outside_rail", deviceId: "mcb-u0" }]);
    expect(validate(replace("mcb-u0", { xMm: -1 }))).toEqual([{ code: "outside_rail", deviceId: "mcb-u0" }]);
  });

  it("reports overlapping devices on a rail", () => {
    expect(validate(replace("fr", { xMm: 30 }))).toEqual([
      { code: "overlaps_device", deviceId: "fr", otherDeviceId: "G1-rcd" },
    ]);
  });

  it("reports a device outside the interior or over a bar", () => {
    const geo = geometry({
      version: 1,
      interior: { widthMm: 300, heightMm: 400, depthMm: 100 },
      rails: [
        { xMm: 10, yMm: 10, lengthMm: 280 },
        { xMm: 10, yMm: 200, lengthMm: 280 },
      ],
      entries: [{ side: "top", offsetMm: 0, lengthMm: 300 }],
      bars: [
        {
          kind: "N",
          orientation: "horizontal",
          xMm: 10,
          yMm: 250,
          lengthMm: 280,
          heightMm: 10,
          zMm: 20,
          terminalGroups: TERMINALS,
        },
      ],
    });
    const [only] = devices(mcb("u0", null));
    expect(validate([{ projectDeviceId: "mcb-u0", railIndex: 0, xMm: 0 }], geo, [only])).toEqual([
      { code: "outside_interior", deviceId: "mcb-u0" },
    ]);
    expect(validate([{ projectDeviceId: "mcb-u0", railIndex: 1, xMm: 0 }], geo, [only])).toEqual([
      { code: "overlaps_bar", deviceId: "mcb-u0" },
    ]);
  });

  it("reports a collision with a device on another rail", () => {
    const geo = geometry({
      version: 1,
      interior: { widthMm: 300, heightMm: 400, depthMm: 100 },
      rails: [
        { xMm: 10, yMm: 100, lengthMm: 280 },
        { xMm: 10, yMm: 160, lengthMm: 280 },
      ],
      entries: [{ side: "top", offsetMm: 0, lengthMm: 300 }],
      bars: [],
    });
    const pair = devices(mcb("u0", null), mcb("u1", null));
    const placements = (x: number): Placement[] => [
      { projectDeviceId: "mcb-u0", railIndex: 0, xMm: 0 },
      { projectDeviceId: "mcb-u1", railIndex: 1, xMm: x },
    ];
    expect(validate(placements(10), geo, pair)).toEqual([
      { code: "overlaps_other_rail_device", deviceId: "mcb-u0", otherDeviceId: "mcb-u1" },
    ]);
    expect(validate(placements(17.5), geo, pair)).toEqual([]); // touching edges do not overlap
  });

  it("reports a group that is not contiguous", () => {
    // A foreign device between the group's devices.
    expect(
      validate(
        replace("mcb-u0", { railIndex: 0, xMm: 87.5 }).map((p) =>
          p.projectDeviceId === "mcb-c0" ? { ...p, xMm: 140 } : p,
        ),
      ),
    ).toEqual([{ code: "group_not_contiguous", groupId: "G1" }]);
    // Split over two rails while narrower than a rail.
    expect(validate(replace("mcb-c1", { railIndex: 1, xMm: 50 }))).toEqual([
      { code: "group_not_contiguous", groupId: "G1" },
    ]);
  });

  it("allows a group wider than every rail to continue on another rail", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `w${String(i)}`);
    const wide = devices(rcd("G1", "G1-rcd", { poles: "4P", width: 70 }), ...ids.map((id) => mcb(id, "G1")));
    const placements: Placement[] = [
      { projectDeviceId: "G1-rcd", railIndex: 0, xMm: 0 },
      ...ids.map((id, i) =>
        i < 14
          ? { projectDeviceId: `mcb-${id}`, railIndex: 0, xMm: 70 + i * 17.5 }
          : { projectDeviceId: `mcb-${id}`, railIndex: 1, xMm: (i - 14) * 17.5 },
      ),
    ];
    expect(validate(placements, SEED_B, wide)).toEqual([]);
  });

  it("reports an RCBO that is not alone in its group", () => {
    const devs = devices(draft("rcbo", "1P+N", 35, { id: "rcbo", group: "G1", circuit: "c0" }), mcb("c1", "G1"));
    const placements: Placement[] = [
      { projectDeviceId: "rcbo", railIndex: 0, xMm: 0 },
      { projectDeviceId: "mcb-c1", railIndex: 0, xMm: 35 },
    ];
    expect(validate(placements, SEED_B, devs)).toEqual([{ code: "rcbo_not_alone", groupId: "G1" }]);
  });
});

describe("barTerminalPoints", () => {
  it("spreads each group's terminals evenly along its share of the bar, one point per terminal", () => {
    const bar = {
      kind: "PE" as const,
      orientation: "horizontal" as const,
      xMm: 100,
      yMm: 50,
      lengthMm: 60,
      heightMm: 10,
      zMm: 0,
      terminalGroups: [
        { count: 4, minMm2: 1.5, maxMm2: 16 },
        { count: 2, minMm2: 6, maxMm2: 35 },
      ],
    };
    const terminals = barTerminalPoints(bar);
    // Six terminals on 60 mm: one 10 mm slot each, the point in the slot's centre on the centre line.
    expect(terminals.map((terminal) => terminal.point)).toEqual(
      [105, 115, 125, 135, 145, 155].map((x) => ({ x, y: 55 })),
    );
    expect(terminals.map((terminal) => [terminal.index, terminal.groupIndex, terminal.maxMm2])).toEqual([
      [0, 0, 16],
      [1, 0, 16],
      [2, 0, 16],
      [3, 0, 16],
      [4, 1, 35],
      [5, 1, 35],
    ]);
    expect(
      barTerminalPoints({ ...bar, orientation: "vertical", terminalGroups: [{ count: 2, minMm2: 1, maxMm2: 4 }] }).map(
        (terminal) => terminal.point,
      ),
    ).toEqual([
      { x: 105, y: 65 },
      { x: 105, y: 95 },
    ]);
    expect(barTerminalPoints({ ...bar, terminalGroups: [] })).toEqual([]);
  });
});
