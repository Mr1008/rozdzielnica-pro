import { describe, expect, it } from "vitest";
import { buildDrawnCables } from "./cabinet-drawing";
import {
  deviceRect,
  deviceTerminals,
  proposeLayout,
  type LayoutDevice,
  type Placement,
  type Point,
} from "./cabinet-layout";
import { SEED_A, SEED_B, SEED_C } from "./cabinet-layout.fixtures";
import { barRect, type CabinetGeometry } from "./cabinet-geometry";
import {
  WIRE_CLEARANCE_MM,
  WIRE_SLACK_RATIO,
  PACK_FILL_FACTOR,
  packBundleWidthMm,
  packStrips,
  wiringWarningMessage,
  wiringWarnings,
  routeConductors,
  wireClass,
  wireLengthsBySection,
  type Conductor,
  type Endpoint,
  type WiringCircuit,
  type WiringInput,
  type WiringSupply,
} from "./cabinet-wiring";
import type { PoleConfig } from "./device-spec";
import { computeMatchView } from "./device-matching-server";
import { computeLayoutView, computeWiring } from "./layout-server";
import { conductorDiameterMm } from "./wire-dimensions";
import { realisticFixture, renderFixture, worstCaseFixture, type RenderFixture } from "./wiring-bench-fixtures";

// ---------------------------------------------------------------------------------------------
// Fixtures — the expectations below come from the domain rules, not from the router
// ---------------------------------------------------------------------------------------------

const G1 = "7c2e8b4f-0000-4000-8000-000000000001";
const G2 = "7c2e8b4f-0000-4000-8000-000000000002";

function circuitId(n: number): string {
  return `8d3f9c5a-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function circuit(n: number, group: string | null, phases: 1 | 3, section: WiringCircuit["cross_section_mm2"]) {
  return {
    id: circuitId(n),
    rcd_group_id: group,
    phase_count: phases,
    cross_section_mm2: section,
    entry_side: "top" as const,
  };
}

const WITH_N: readonly PoleConfig[] = ["1P+N", "2P", "3P+N", "4P"];

function device(
  position: number,
  role: LayoutDevice["role"],
  poles: PoleConfig,
  widthMm: number,
  refs: { group?: string | null; circuit?: string | null; nSide?: "left" | "right" } = {},
): LayoutDevice {
  const kind = { main_switch: "switch_disconnector", rcd: "rcd", rcbo: "rcbo", mcb: "mcb_b" }[
    role
  ] as LayoutDevice["kind"];
  return {
    id: `b2000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    position,
    role,
    kind,
    rcd_group_id: refs.group ?? null,
    circuit_id: refs.circuit ?? null,
    width_mm: widthMm,
    height_mm: 85,
    poles,
    n_terminal_side: WITH_N.includes(poles) ? (refs.nSide ?? "left") : null,
  };
}

/**
 * Every circuit kind the contract names, on a three-phase TN-S supply:
 * c1, c2 — 1P MCBs in RCD group G1; c3 — the single circuit of G2, an RCBO 1P+N;
 * c4 — an ungrouped 1P MCB; c5 — an ungrouped 1P+N MCB; c6 — an ungrouped three-phase 3P MCB.
 */
const CIRCUITS = [
  circuit(1, G1, 1, 2.5),
  circuit(2, G1, 1, 1.5),
  circuit(3, G2, 1, 2.5),
  circuit(4, null, 1, 1.5),
  circuit(5, null, 1, 2.5),
  circuit(6, null, 3, 4),
];
const MAIN = device(0, "main_switch", "4P", 70, { nSide: "right" });
const RCD = device(1, "rcd", "2P", 35, { group: G1, nSide: "right" });
const MCB_1 = device(2, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(1) });
const MCB_2 = device(3, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(2) });
const RCBO = device(4, "rcbo", "1P+N", 35, { group: G2, circuit: circuitId(3), nSide: "left" });
const MCB_4 = device(5, "mcb", "1P", 17.5, { circuit: circuitId(4) });
const MCB_5 = device(6, "mcb", "1P+N", 35, { circuit: circuitId(5), nSide: "right" });
const MCB_6 = device(7, "mcb", "3P", 52.5, { circuit: circuitId(6) });
const DEVICES = [MAIN, RCD, MCB_1, MCB_2, RCBO, MCB_4, MCB_5, MCB_6];

const TN_S: WiringSupply = { earthing_system: "TN-S", wlz_cross_section_mm2: 16 };

function wiringInput(
  geometry: CabinetGeometry,
  devices: readonly LayoutDevice[] = DEVICES,
  circuits: readonly WiringCircuit[] = CIRCUITS,
  supply: WiringSupply = TN_S,
): WiringInput {
  const result = proposeLayout({
    devices,
    groups: [
      { id: G1, label: "RCD 1" },
      { id: G2, label: "RCD 2" },
    ],
    circuits,
    geometry,
  });
  if (!result.ok) throw new Error(`fixture does not fit: ${JSON.stringify(result.reason)}`);
  return { geometry, devices, placements: result.placements, circuits, supply };
}

function isTerminal(endpoint: Endpoint, deviceId: string, side?: "top" | "bottom", pole?: string): boolean {
  return (
    endpoint.type === "terminal" &&
    endpoint.deviceId === deviceId &&
    (side === undefined || endpoint.side === side) &&
    (pole === undefined || endpoint.pole === pole)
  );
}

function ofCircuit(conductors: readonly Conductor[], n: number): Conductor[] {
  return conductors.filter((conductor) => conductor.circuitId === circuitId(n));
}

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0];
}

// ---------------------------------------------------------------------------------------------
// Circuit cables
// ---------------------------------------------------------------------------------------------

describe("routeConductors — circuit cables (TN-S)", () => {
  const conductors = routeConductors(wiringInput(SEED_B));

  it("gives every single-phase circuit one L, one N and one PE, all from its entry", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const own = ofCircuit(conductors, n);
      expect(own.map((c) => c.role).sort()).toEqual(["L", "N", "PE"]);
      for (const c of own) {
        expect(c.kind).toBe("circuit");
        expect(c.from).toMatchObject({ type: "entry", entryIndex: 0 });
      }
    }
  });

  it("gives the three-phase circuit L1, L2, L3, N and PE", () => {
    expect(
      ofCircuit(conductors, 6)
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L1", "L2", "L3", "N", "PE"]);
  });

  it("lands each phase on its own protective device's edge facing the cable's entry — the top one here", () => {
    // Every cable of this fixture enters from the top, above every device: each circuit leaves its
    // MCB / RCBO on the top edge, grouped or not.
    const protection = [
      [MCB_1, "top"],
      [MCB_2, "top"],
      [RCBO, "top"],
      [MCB_4, "top"],
      [MCB_5, "top"],
      [MCB_6, "top"],
    ] as const;
    protection.forEach(([dev, side], index) => {
      const phases = ofCircuit(conductors, index + 1).filter((c) => wireClass(c.role) === "L");
      for (const c of phases) expect(isTerminal(c.to, dev.id, side, c.role)).toBe(true);
    });
  });

  it("ends a grouped circuit's N at its group's RCD — never at the N bar", () => {
    for (const n of [1, 2]) {
      const neutral = only(ofCircuit(conductors, n).filter((c) => c.role === "N"));
      expect(isTerminal(neutral.to, RCD.id, "bottom", "N")).toBe(true);
    }
  });

  it("ends an RCBO circuit's N at the RCBO, and a 1P+N MCB circuit's N at that MCB", () => {
    expect(isTerminal(only(ofCircuit(conductors, 3).filter((c) => c.role === "N")).to, RCBO.id, "top", "N")).toBe(true);
    expect(isTerminal(only(ofCircuit(conductors, 5).filter((c) => c.role === "N")).to, MCB_5.id, "top", "N")).toBe(
      true,
    );
  });

  it("ends an ungrouped circuit's N on the N bar when its device has no N pole", () => {
    for (const n of [4, 6]) {
      const neutral = only(ofCircuit(conductors, n).filter((c) => c.role === "N"));
      expect(neutral.to).toMatchObject({ type: "bar", kind: "N" });
    }
  });

  it("ends every circuit's PE on the PE bar", () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(only(ofCircuit(conductors, n).filter((c) => c.role === "PE")).to).toMatchObject({
        type: "bar",
        kind: "PE",
      });
    }
  });

  it("uses each circuit's own cross-section", () => {
    CIRCUITS.forEach((c, index) => {
      for (const conductor of ofCircuit(conductors, index + 1))
        expect(conductor.crossSectionMm2).toBe(c.cross_section_mm2);
    });
  });
});

describe("routeConductors — TN-C-S splits the PEN in the switchboard", () => {
  const conductors = routeConductors(
    wiringInput(SEED_B, DEVICES, CIRCUITS, { earthing_system: "TN-C-S", wlz_cross_section_mm2: 16 }),
  );
  const wlz = conductors.filter((c) => c.kind === "wlz");

  it("brings the WLZ's PEN to the PE bar and no separate WLZ N", () => {
    expect(only(wlz.filter((c) => c.role === "PEN")).to).toMatchObject({ type: "bar", kind: "PE" });
    expect(wlz.filter((c) => c.role === "N" || c.role === "PE")).toEqual([]);
  });

  it("links the PE bar to the main switch's line-side N — the split point", () => {
    const split = only(conductors.filter((c) => c.from.type === "bar" && c.from.kind === "PE" && c.role === "N"));
    expect(isTerminal(split.to, MAIN.id, "top", "N")).toBe(true);
  });

  it("wires the circuits like TN-S after the split: separate N and PE, grouped N from the RCD", () => {
    expect(
      ofCircuit(conductors, 1)
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L", "N", "PE"]);
    expect(isTerminal(only(ofCircuit(conductors, 1).filter((c) => c.role === "N")).to, RCD.id, "bottom", "N")).toBe(
      true,
    );
  });

  it("draws separate PE and N without a PE bar, since there is no split point", () => {
    const bare = routeConductors(
      wiringInput(SEED_A, [MAIN, RCD, MCB_1], CIRCUITS.slice(0, 1), {
        earthing_system: "TN-C-S",
        wlz_cross_section_mm2: 16,
      }),
    );
    expect(bare.some((c) => c.role === "PEN")).toBe(false);
    expect(bare.filter((c) => c.kind === "wlz" && c.role === "N")).toHaveLength(1);
  });
});

describe("routeConductors — TN-C", () => {
  const circuits = [circuit(1, null, 1, 2.5), circuit(2, null, 3, 4)];
  const devices = [
    device(0, "main_switch", "3P", 52.5),
    device(1, "mcb", "1P", 17.5, { circuit: circuitId(1) }),
    device(2, "mcb", "3P", 52.5, { circuit: circuitId(2) }),
  ];
  const conductors = routeConductors(
    wiringInput(SEED_B, devices, circuits, { earthing_system: "TN-C", wlz_cross_section_mm2: 16 }),
  );

  it("has no N conductor anywhere", () => {
    expect(conductors.filter((c) => c.role === "N")).toEqual([]);
    expect(conductors.some((c) => c.role === "PE")).toBe(false);
  });

  it("sends each circuit's PEN and the WLZ's PEN to the PE bar", () => {
    for (const n of [1, 2]) {
      expect(only(ofCircuit(conductors, n).filter((c) => c.role === "PEN")).to).toMatchObject({
        type: "bar",
        kind: "PE",
      });
    }
    expect(only(conductors.filter((c) => c.kind === "wlz" && c.role === "PEN")).to).toMatchObject({
      type: "bar",
      kind: "PE",
    });
    expect(
      ofCircuit(conductors, 1)
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L", "PEN"]);
    expect(
      ofCircuit(conductors, 2)
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L1", "L2", "L3", "PEN"]);
  });
});

// ---------------------------------------------------------------------------------------------
// WLZ and feeds
// ---------------------------------------------------------------------------------------------

describe("routeConductors — WLZ and feeds", () => {
  const conductors = routeConductors(wiringInput(SEED_B));
  const wlz = conductors.filter((c) => c.kind === "wlz");
  const feeds = conductors.filter((c) => c.kind === "feed");

  it("brings the WLZ from the first entry to the main switch's line side, its PE to the PE bar", () => {
    expect(wlz.map((c) => c.role).sort()).toEqual(["L1", "L2", "L3", "N", "PE"]);
    for (const c of wlz) expect(c.from).toMatchObject({ type: "entry", entryIndex: 0 });
    for (const c of wlz.filter((c) => c.role !== "PE")) expect(isTerminal(c.to, MAIN.id, "top", c.role)).toBe(true);
    expect(only(wlz.filter((c) => c.role === "PE")).to).toMatchObject({ type: "bar", kind: "PE" });
  });

  it("feeds every RCD, RCBO and ungrouped MCB phase from the main switch's load side", () => {
    for (const dev of [RCD, RCBO, MCB_4, MCB_5, MCB_6]) {
      const toDevice = feeds.filter((c) => isTerminal(c.to, dev.id) && c.role !== "N");
      expect(toDevice.length).toBeGreaterThan(0);
      for (const c of toDevice) expect(isTerminal(c.from, MAIN.id, "bottom")).toBe(true);
    }
    expect(
      feeds
        .filter((c) => isTerminal(c.to, MCB_6.id))
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L1", "L2", "L3"]);
  });

  it("feeds each grouped MCB from its RCD's load side, not from the main switch", () => {
    for (const dev of [MCB_1, MCB_2]) {
      const c = only(feeds.filter((f) => isTerminal(f.to, dev.id, "bottom")));
      expect(isTerminal(c.from, RCD.id, "bottom", "L")).toBe(true);
    }
  });

  it("runs the main switch's N to the N bar and the N bar to every line-side N the main switch feeds", () => {
    expect(only(feeds.filter((c) => isTerminal(c.from, MAIN.id, "bottom", "N"))).to).toMatchObject({
      type: "bar",
      kind: "N",
    });
    for (const dev of [RCD, RCBO, MCB_5]) {
      const c = only(feeds.filter((f) => isTerminal(f.to, dev.id, undefined, "N")));
      expect(c.from).toMatchObject({ type: "bar", kind: "N" });
    }
  });

  it("uses the WLZ cross-section for the WLZ and every feed", () => {
    for (const c of [...wlz, ...feeds]) expect(c.crossSectionMm2).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------
// No bars
// ---------------------------------------------------------------------------------------------

describe("routeConductors — a cabinet without PE/N bars", () => {
  const circuits = [circuit(1, G1, 1, 2.5), circuit(2, G1, 1, 2.5), circuit(4, null, 1, 1.5)];
  const devices = [
    device(0, "main_switch", "2P", 35),
    device(1, "rcd", "2P", 35, { group: G1 }),
    device(2, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(1) }),
    device(3, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(2) }),
    device(4, "mcb", "1P", 17.5, { circuit: circuitId(4) }),
  ];
  const conductors = routeConductors(wiringInput(SEED_A, devices, circuits));

  it("omits every conductor to or from a bar", () => {
    expect(conductors.length).toBeGreaterThan(0);
    for (const c of conductors) {
      expect(c.from.type).not.toBe("bar");
      expect(c.to.type).not.toBe("bar");
    }
    expect(conductors.some((c) => c.role === "PE")).toBe(false);
  });

  it("still wires the phases and the grouped circuits' N to their RCD", () => {
    for (const n of [1, 2]) {
      expect(
        ofCircuit(conductors, n)
          .map((c) => c.role)
          .sort(),
      ).toEqual(["L", "N"]);
    }
    expect(ofCircuit(conductors, 4).map((c) => c.role)).toEqual(["L"]);
  });
});

describe("routeConductors — catalog PE/N bars on a rail (plan Phase 5b)", () => {
  const circuits = [circuit(1, G1, 1, 2.5), circuit(2, G1, 1, 2.5), circuit(4, null, 1, 1.5)];
  const terminals = [{ count: 6, minMm2: 1.5, maxMm2: 16 }];
  const bar = (position: number, role: "pe_bar" | "n_bar") => ({
    id: `b2000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
    position,
    role,
    kind: role,
    rcd_group_id: null,
    circuit_id: null,
    width_mm: 35,
    height_mm: 15,
    poles: null,
    n_terminal_side: null,
    terminal_groups: terminals,
  });
  const PE_BAR = bar(5, "pe_bar");
  const N_BAR = bar(6, "n_bar");
  const devices = [
    device(0, "main_switch", "2P", 35),
    device(1, "rcd", "2P", 35, { group: G1 }),
    device(2, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(1) }),
    device(3, "mcb", "1P", 17.5, { group: G1, circuit: circuitId(2) }),
    device(4, "mcb", "1P", 17.5, { circuit: circuitId(4) }),
    PE_BAR,
    N_BAR,
  ];
  const input = wiringInput(SEED_A, devices, circuits);
  const conductors = routeConductors(input);
  const rectOf = (id: string) => {
    const placement = input.placements.find((p) => p.projectDeviceId === id);
    const dev = devices.find((d) => d.id === id);
    const rect = placement && dev ? deviceRect(placement, dev, SEED_A) : null;
    if (rect === null) throw new Error(`${id} not placed`);
    return rect;
  };
  // (a) has no built-in bars, so the catalog bars are bars 0 (PE) and 1 (N), in placement order.
  const toBar = (c: Conductor, kind: "PE" | "N") =>
    (c.to.type === "bar" && c.to.kind === kind) || (c.from.type === "bar" && c.from.kind === kind);

  it("gives every circuit its PE on the catalog PE bar", () => {
    for (const n of [1, 2, 4]) {
      const pe = only(ofCircuit(conductors, n).filter((c) => c.role === "PE"));
      expect(pe.to).toMatchObject({ type: "bar", kind: "PE", barIndex: 0 });
    }
  });

  it("lands an ungrouped 1P circuit's N on the catalog N bar; grouped circuits keep their RCD's N", () => {
    const n4 = only(ofCircuit(conductors, 4).filter((c) => c.role === "N"));
    expect(n4.to).toMatchObject({ type: "bar", kind: "N", barIndex: 1 });
    const n1 = only(ofCircuit(conductors, 1).filter((c) => c.role === "N"));
    expect(n1.to.type).toBe("terminal");
  });

  it("ends each bar conductor on the bar's own rectangle", () => {
    const bars = { PE: rectOf(PE_BAR.id), N: rectOf(N_BAR.id) };
    for (const c of conductors) {
      for (const [end, point] of [
        [c.from, c.path[0]],
        [c.to, c.path.at(-1)],
      ] as const) {
        if (end.type !== "bar" || point === undefined) continue;
        const rect = bars[end.kind];
        expect(point.x).toBeGreaterThanOrEqual(rect.x);
        expect(point.x).toBeLessThanOrEqual(rect.x + rect.w);
        expect(point.y).toBeCloseTo(rect.y + rect.h / 2, 6);
      }
    }
  });

  it("splits the PEN on the catalog PE bar in TN-C-S, like on a built-in one", () => {
    const tnCS = routeConductors(
      wiringInput(SEED_A, devices, circuits, { earthing_system: "TN-C-S", wlz_cross_section_mm2: 16 }),
    );
    const pen = only(tnCS.filter((c) => c.kind === "wlz" && c.role === "PEN"));
    expect(toBar(pen, "PE")).toBe(true);
    expect(tnCS.some((c) => c.kind === "feed" && c.role === "N" && c.from.type === "bar")).toBe(true);
  });

  it("feeds the N bar from the main switch and the RCD's line-side N from the N bar", () => {
    const feeds = conductors.filter((c) => c.kind === "feed" && c.role === "N");
    expect(feeds.some((c) => c.to.type === "bar" && c.to.kind === "N")).toBe(true);
    expect(feeds.some((c) => c.from.type === "bar" && c.from.kind === "N")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Paths and lengths
// ---------------------------------------------------------------------------------------------

function endpointPoint(endpoint: Endpoint, input: WiringInput): Point | null {
  // An entry point depends on the other cables of its entry; the entry-spread tests check it.
  if (endpoint.type === "terminal") {
    const dev = input.devices.find((d) => d.id === endpoint.deviceId);
    const placement = input.placements.find((p: Placement) => p.projectDeviceId === endpoint.deviceId);
    const rect = dev && placement ? deviceRect(placement, dev, input.geometry) : null;
    if (!dev || !rect) return null;
    const terminal = deviceTerminals(dev, rect)[endpoint.side].find((t) => t.pole === endpoint.pole);
    return terminal ? { x: terminal.x, y: terminal.y } : null;
  }
  return null;
}

/** True-scale spacing of two cross-sections: half of each outer diameter plus the clearance. */
function trackSpacingOf(a: 1.5 | 2.5 | 4 | 16, b: 1.5 | 2.5 | 4 | 16): number {
  return conductorDiameterMm(a) / 2 + conductorDiameterMm(b) / 2 + WIRE_CLEARANCE_MM;
}

/** Centre-to-centre spacing the router gives two neighbouring tracks of these conductors. */
function spacing(a: Conductor, b: Conductor): number {
  return a.diameterMm / 2 + b.diameterMm / 2 + WIRE_CLEARANCE_MM;
}

/**
 * The segments of a conductor that run in a tied round bundle (a pack, a lane or a channel), by bundle.
 */
function tiedBundle(c: Conductor, segment: number): number | null {
  return c.tied.find((tie) => tie.segment === segment)?.bundle ?? null;
}

/** The lane run a packed core takes to its pack from a top or bottom entry, still in its cable's sheath. */
function sheathSegment(c: Conductor): number | null {
  return c.from.type === "entry" && c.packSegment !== null && c.packSegment >= 2 ? c.packSegment - 1 : null;
}

/**
 * The user's requirement: every trace visible — no two conductors on one track, and at true scale no
 * two conductor bodies overlapping. Two parallel segments of different conductors that overlap along
 * their length must lie at least `rA + rB` apart (r: half the outer diameter), unless the router
 * recorded it: either segment is listed in its conductor's `squeezed` (a range too narrow for true
 * scale) or `stubOverlaps` (a fixed end stub the geometry puts there). The exceptions by design: end
 * segments touching the same terminal or bar endpoint (conductors sharing it share its stub); the cores
 * of one cable on their cable's stub line — each core's first segment, from the entry point to where it
 * turns off — and on their cable's sheathed lane run to its pack (plan Phase 4); and two segments of one
 * tied round bundle (`Conductor.tied`, user decision 2026-10-09), whose cores overlap in the front view.
 * A core that has turned off and runs alongside its own cable's stub is a clash like any other.
 */
function trackClashes(conductors: readonly Conductor[]): string[] {
  const segments = conductors.flatMap((c, conductor) =>
    c.path.slice(1).map((b, i) => {
      const a = c.path[i];
      const vertical = a.x === b.x;
      const last = i === c.path.length - 2;
      return {
        conductor,
        recorded: c.squeezed.includes(i) || c.stubOverlaps.includes(i),
        vertical,
        at: vertical ? a.x : a.y,
        low: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
        high: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
        /** The endpoint this segment touches, if it is the route's first or last segment. */
        end: i === 0 ? c.path[0] : last ? b : null,
        /** The segment runs on its cable's stub line: a cable core's first segment. */
        onStub: i === 0 && c.from.type === "entry",
        bundle: tiedBundle(c, i),
        /** The cable and pack of a sheathed lane run, else null. */
        sheath: sheathSegment(c) === i ? `${String(c.path[0].x)}:${String(c.path[0].y)}:${String(c.packSide)}` : null,
      };
    }),
  );
  const clashes: string[] = [];
  for (const [n, s] of segments.entries()) {
    for (const t of segments.slice(n + 1)) {
      if (s.conductor === t.conductor || s.vertical !== t.vertical || s.recorded || t.recorded) continue;
      const bodies = (conductors[s.conductor].diameterMm + conductors[t.conductor].diameterMm) / 2;
      if (Math.abs(s.at - t.at) >= bodies - 1e-6) continue;
      if (Math.min(s.high, t.high) - Math.max(s.low, t.low) <= 1e-6) continue;
      const sameEnd = s.end !== null && t.end !== null && s.end.x === t.end.x && s.end.y === t.end.y;
      // A shared entry point means one cable; only its stub runs may coincide.
      if (sameEnd && s.onStub === t.onStub) continue;
      if (s.bundle !== null && s.bundle === t.bundle) continue;
      if (s.sheath !== null && s.sheath === t.sheath) continue;
      clashes.push(`${conductors[s.conductor].key}/${conductors[t.conductor].key} at ${String(s.at)}`);
    }
  }
  return clashes;
}

describe.each([
  ["seed (b)", SEED_B],
  ["seed (c)", SEED_C],
])("routeConductors — paths on %s", (_name, geometry) => {
  const input = wiringInput(geometry);
  const conductors = routeConductors(input);
  const rects = input.placements.flatMap((p) => {
    const dev = input.devices.find((d) => d.id === p.projectDeviceId);
    const rect = dev ? deviceRect(p, dev, geometry) : null;
    return rect ? [rect] : [];
  });

  it("starts and ends each path exactly at its endpoints", () => {
    for (const c of conductors) {
      const from = endpointPoint(c.from, input);
      const to = endpointPoint(c.to, input);
      if (from) expect(c.path[0]).toEqual(from);
      if (to) expect(c.path.at(-1)).toEqual(to);
    }
  });

  // Wires may run behind the devices, under the DIN rail (the electrician, 2026-10-06): a route
  // may pass a device body, but never leaves the interior.
  it("is orthogonal and stays inside the interior", () => {
    for (const c of conductors) {
      for (let i = 1; i < c.path.length; i++) {
        const [a, b] = [c.path[i - 1], c.path[i]];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const p of [a, b]) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(geometry.interior.widthMm);
          expect(p.y).toBeLessThanOrEqual(geometry.interior.heightMm);
        }
      }
    }
  });

  it("passes behind a device only along its length, never ending inside one", () => {
    // Every corner and endpoint off the device bodies: a run may cross behind a device, but no route
    // turns or stops behind one (terminals sit on the body's edge, which is not inside it).
    for (const c of conductors) {
      for (const p of c.path) {
        for (const rect of rects) {
          const inside =
            p.x > rect.x + 1e-6 && p.x < rect.x + rect.w - 1e-6 && p.y > rect.y + 1e-6 && p.y < rect.y + rect.h - 1e-6;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it("adds exactly 30 % to the routed (Manhattan) length", () => {
    expect(WIRE_SLACK_RATIO).toBe(0.3);
    for (const c of conductors) {
      let manhattan = 0;
      for (let i = 1; i < c.path.length; i++) {
        manhattan += Math.abs(c.path[i].x - c.path[i - 1].x) + Math.abs(c.path[i].y - c.path[i - 1].y);
      }
      expect(c.routedMm).toBeCloseTo(manhattan, 9);
      expect(c.routedMm).toBeGreaterThan(0);
      expect(c.lengthMm / c.routedMm).toBeCloseTo(1.3, 12);
    }
  });

  it("is deterministic", () => {
    expect(routeConductors(input)).toEqual(conductors);
  });

  // See `trackClashes`.
  it("never runs two conductors along the same track", () => {
    expect(trackClashes(conductors)).toEqual([]);
  });

  it("gives every conductor its true outer diameter", () => {
    for (const c of conductors) {
      expect(c.diameterMm).toBe(conductorDiameterMm(c.crossSectionMm2 as Parameters<typeof conductorDiameterMm>[0]));
    }
  });

  it("spaces neighbouring untied movable tracks by both radii plus the clearance", () => {
    expect(spacingCheck(conductors).tooClose).toEqual([]);
  });
});

/**
 * Neighbouring movable runs of different conductors, at true scale: those closer than `rA + rB +
 * WIRE_CLEARANCE_MM`, and how many 1.5 mm² / 16 mm² pairs lie within a millimetre of that spacing.
 * Movable segments only (a route's first and last pass through their endpoints and never move), and
 * none the router recorded (squeezed, or overlapping a fixed stub). A run tied into a round bundle (a
 * pack, a crowded lane or channel) gives up true-scale spacing by design, as does a cable's sheathed
 * lane run; `trackClashes` and the bundle tests check those instead.
 */
function spacingCheck(conductors: readonly Conductor[]): { tooClose: string[]; mixedNeighbours: number } {
  const runs = conductors.flatMap((c) =>
    c.path.slice(1).flatMap((b, i) => {
      if (i === 0 || i === c.path.length - 2 || c.squeezed.includes(i) || c.stubOverlaps.includes(i)) return [];
      if (tiedBundle(c, i) !== null || sheathSegment(c) === i) return [];
      const a = c.path[i];
      const vertical = a.x === b.x;
      return [
        {
          c,
          vertical,
          at: vertical ? a.x : a.y,
          low: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
          high: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
        },
      ];
    }),
  );
  const tooClose: string[] = [];
  let mixedNeighbours = 0;
  for (const [n, s] of runs.entries()) {
    for (const t of runs.slice(n + 1)) {
      if (s.c === t.c || s.vertical !== t.vertical) continue;
      if (Math.min(s.high, t.high) - Math.max(s.low, t.low) <= 1e-6) continue;
      const gap = Math.abs(s.at - t.at);
      const needed = spacing(s.c, t.c);
      if (gap < needed - 1e-6) tooClose.push(`${s.c.key}/${t.c.key}: ${gap.toFixed(2)} < ${needed.toFixed(2)}`);
      const sections = [s.c.crossSectionMm2, t.c.crossSectionMm2].sort((p, q) => p - q);
      if (sections[0] === 1.5 && sections[1] === 16 && gap < needed + 1) mixedNeighbours++;
    }
  }
  return { tooClose, mixedNeighbours };
}

describe("routeConductors — a 1.5 mm² core beside a 16 mm² one", () => {
  // A lone 1.5 mm² circuit on seed (a) with a 16 mm² WLZ: its runs meet the WLZ-section feeds in the
  // free channel, untied. (The fuller fixtures put their circuit cores into side packs and tied
  // channel bundles, where true-scale spacing gives way by design.)
  const conductors = routeConductors(wiringInput(SEED_A, [MAIN, MCB_4], [circuit(4, null, 1, 1.5)]));

  it("spaces them by both radii plus the clearance", () => {
    const { tooClose, mixedNeighbours } = spacingCheck(conductors);
    expect(tooClose).toEqual([]);
    // The fixture really puts a thin core next to a WLZ-section one: 3.0 / 2 + 7.8 / 2 + 0.5 mm apart.
    expect(mixedNeighbours).toBeGreaterThan(0);
    expect(trackSpacingOf(1.5, 16)).toBeCloseTo(1.5 + 3.9 + WIRE_CLEARANCE_MM, 9);
  });
});

describe("routeConductors — track assignment in a crowded passage", () => {
  // Ten ungrouped 1P circuits from the top entry of the single-rail seed (a): their L cables all
  // leave the entry along the top lane and turn down beside the devices. Without nudging they share
  // one horizontal track and one vertical passage.
  const circuits = Array.from({ length: 10 }, (_, i) => circuit(i + 1, null, 1, 2.5));
  const devices = [
    device(0, "main_switch", "2P", 35),
    ...circuits.map((c, i) => device(i + 1, "mcb", "1P", 17.5, { circuit: c.id })),
  ];
  const input = wiringInput(SEED_A, devices, circuits);
  const conductors = routeConductors(input);
  const phases = conductors.filter((c) => c.kind === "circuit");

  it("spreads the shared top lane: cables running alongside each other get their own tracks, or a tied bundle", () => {
    for (const c of phases) {
      // Still an entry stub straight down from the cable's own point, then the lane, then the rest.
      expect(c.path[0].y).toBe(0);
      expect(c.path[1].x).toBe(c.path[0].x);
    }
    const lanes = phases.map((c) => ({
      y: c.path[1].y,
      x1: Math.min(c.path[0].x, c.path[2].x),
      x2: Math.max(c.path[0].x, c.path[2].x),
      squeezed: c.squeezed.includes(1),
      bundle: tiedBundle(c, 1),
    }));
    // Every core here is 2.5 mm²: neighbouring lanes sit a full true-scale spacing apart — unless the
    // lane is too low for that and they run tied in one round bundle (user decision 2026-10-09).
    lanes.forEach((a, i) => {
      for (const b of lanes.slice(i + 1)) {
        if (a.squeezed || b.squeezed || (a.bundle !== null && a.bundle === b.bundle)) continue;
        if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 1e-6) {
          expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(trackSpacingOf(2.5, 2.5) - 1e-6);
        }
      }
    });
    // Ten cables leave one entry, so the lane really is shared before nudging.
    expect(new Set(lanes.map((lane) => lane.y.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("keeps every route inside the interior", () => {
    for (const c of conductors) {
      for (let i = 1; i < c.path.length; i++) {
        expect(c.path[i].x).toBeGreaterThanOrEqual(0);
        expect(c.path[i].x).toBeLessThanOrEqual(SEED_A.interior.widthMm);
        expect(c.path[i].y).toBeGreaterThanOrEqual(0);
        expect(c.path[i].y).toBeLessThanOrEqual(SEED_A.interior.heightMm);
      }
    }
  });

  it("measures the lengths on the nudged path", () => {
    for (const c of conductors) {
      let manhattan = 0;
      for (let i = 1; i < c.path.length; i++) {
        manhattan += Math.abs(c.path[i].x - c.path[i - 1].x) + Math.abs(c.path[i].y - c.path[i - 1].y);
      }
      expect(c.routedMm).toBeCloseTo(manhattan, 9);
      expect(c.lengthMm).toBeCloseTo(manhattan * (1 + WIRE_SLACK_RATIO), 9);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Plan Phase 5c — cables side by side, one conductor per bar terminal, bidirectional devices
// ---------------------------------------------------------------------------------------------

/** The cable a conductor from an entry belongs to: the WLZ, or its circuit's cable. */
function cableOf(c: Conductor): string | null {
  if (c.from.type !== "entry") return null;
  return c.kind === "wlz" ? "wlz" : (c.circuitId ?? "?");
}

function rectOfDevice(input: WiringInput, id: string) {
  const placement = input.placements.find((p) => p.projectDeviceId === id);
  const dev = input.devices.find((d) => d.id === id);
  const rect = placement && dev ? deviceRect(placement, dev, input.geometry) : null;
  if (rect === null) throw new Error(`${id} not placed`);
  return rect;
}

const TEN_CIRCUITS = Array.from({ length: 10 }, (_, i) => circuit(i + 1, null, 1, 2.5));
const TEN_DEVICES = [
  device(0, "main_switch", "2P", 35),
  ...TEN_CIRCUITS.map((c, i) => device(i + 1, "mcb", "1P", 17.5, { circuit: c.id })),
];
/** Seed (a) with a 20 mm entry: eleven cables cannot keep true-scale spacing there. */
const NARROW_ENTRY: CabinetGeometry = { ...SEED_A, entries: [{ side: "top", offsetMm: 115, lengthMm: 20 }] };

describe.each([
  ["seed (b)", wiringInput(SEED_B)],
  [
    "seed (c)",
    wiringInput(
      SEED_C,
      DEVICES,
      CIRCUITS.map((c, i) => ({ ...c, entry_side: i % 2 ? "bottom" : "left" })),
    ),
  ],
  ["seed (a), ten circuits", wiringInput(SEED_A, TEN_DEVICES, TEN_CIRCUITS)],
  ["a 20 mm entry, eleven cables", wiringInput(NARROW_ENTRY, TEN_DEVICES, TEN_CIRCUITS)],
])("routeConductors — cables enter side by side on %s", (_name, input) => {
  const conductors = routeConductors(input);
  const cables = new Map<string, Conductor[]>();
  for (const c of conductors) {
    const cable = cableOf(c);
    if (cable === null) continue;
    cables.set(cable, [...(cables.get(cable) ?? []), c]);
  }

  it("gives each cable one entry point, shared by its cores, and never one point to two cables", () => {
    const points = [...cables.values()].map((cores) => {
      const first = cores[0].path[0];
      for (const core of cores) expect(core.path[0]).toEqual(first);
      return `${first.x.toFixed(6)}:${first.y.toFixed(6)}`;
    });
    expect(cables.size).toBeGreaterThan(1);
    expect(new Set(points).size).toBe(points.length);
  });

  it("puts each point on its entry's edge, inside the entry's span", () => {
    const { widthMm, heightMm } = input.geometry.interior;
    for (const cores of cables.values()) {
      const from = cores[0].from;
      if (from.type !== "entry") throw new Error("not an entry");
      const entry = input.geometry.entries[from.entryIndex];
      const point = cores[0].path[0];
      const along = entry.side === "top" || entry.side === "bottom" ? point.x : point.y;
      const across = { top: point.y, bottom: point.y - heightMm, left: point.x, right: point.x - widthMm }[entry.side];
      expect(across).toBe(0);
      expect(along).toBeGreaterThan(entry.offsetMm);
      expect(along).toBeLessThan(entry.offsetMm + entry.lengthMm);
    }
  });

  it("keeps the cables in the order of where they go, so they do not cross after the entry", () => {
    const byEntry = new Map<number, { slot: number; along: number; toward: number }[]>();
    for (const cores of cables.values()) {
      const from = cores[0].from;
      if (from.type !== "entry") throw new Error("not an entry");
      const entry = input.geometry.entries[from.entryIndex];
      const horizontal = entry.side === "top" || entry.side === "bottom";
      // Where the cable goes: the device its phase lands on.
      const phase = cores.find((c) => wireClass(c.role) === "L" && c.to.type === "terminal");
      if (phase?.to.type !== "terminal") throw new Error("a cable without a phase");
      const rect = rectOfDevice(input, phase.to.deviceId);
      const point = cores[0].path[0];
      byEntry.set(from.entryIndex, [
        ...(byEntry.get(from.entryIndex) ?? []),
        {
          slot: from.slot,
          along: horizontal ? point.x : point.y,
          toward: horizontal ? rect.x + rect.w / 2 : rect.y + rect.h / 2,
        },
      ]);
    }
    for (const list of byEntry.values()) {
      list.sort((a, b) => a.slot - b.slot);
      expect(list.map((item) => item.slot)).toEqual(list.map((_, i) => i));
      for (let i = 1; i < list.length; i++) {
        expect(list[i].along).toBeGreaterThan(list[i - 1].along);
        expect(list[i].toward).toBeGreaterThanOrEqual(list[i - 1].toward);
      }
    }
  });
});

/**
 * Seed (a) with only a 4P main switch and its WLZ entering 1 mm right of the main switch's L1 terminal:
 * L1's natural passage runs straight down to its terminal, a millimetre beside the WLZ's stub, while the
 * WLZ's other cores still run down that stub to their deeper lanes. Without the own-stub rule in
 * `avoidPins` that passage stays alongside the stub.
 */
function wlzBesideTerminal(): WiringInput {
  const placed = wiringInput(SEED_A, [MAIN], []);
  const placement = placed.placements.find((p) => p.projectDeviceId === MAIN.id);
  const rect = placement ? deviceRect(placement, MAIN, SEED_A) : null;
  const l1 = rect ? deviceTerminals(MAIN, rect).top.find((t) => t.pole === "L1") : undefined;
  if (l1 === undefined) throw new Error("no L1 terminal");
  return wiringInput({ ...SEED_A, entries: [{ side: "top", offsetMm: l1.x + 1 - 10, lengthMm: 20 }] }, [MAIN], []);
}

/**
 * The oracle for where a cable splits into its cores. A cable whose cores all run in one side pack
 * keeps its sheath until it reaches the pack and splits there (plan Phase 4): the sheath follows the
 * cores' shared route to the first point where one of them enters the pack. Any other cable splits
 * progressively (the electrician, 2026-10-07): its cores leave its stub line one at a time, like
 * stripping a cable, and the sheath runs from the entry point to the last turn-off — the point past which
 * at most one core is left on the line. Either way, a core that has turned off never runs so close to its
 * own cable's stub that their bodies overlap (one core diameter, the cores of a cable sharing a
 * cross-section), unless the router recorded that run (squeezed, or overlapping a fixed stub).
 */
describe.each([
  ["seed (a), one RCD group", wiringInput(SEED_A, [MAIN, RCD, MCB_1, MCB_2], CIRCUITS.slice(0, 2))],
  ["seed (a), ten circuits", wiringInput(SEED_A, TEN_DEVICES, TEN_CIRCUITS)],
  ["seed (a), the WLZ entering beside a main switch terminal", wlzBesideTerminal()],
  ["seed (b), top entry", wiringInput(SEED_B)],
  ["seed (b), bottom entry", wiringInput(SEED_B, DEVICES, entering("bottom"))],
  ["seed (c), bottom entry", wiringInput(SEED_C)],
  [
    "seed (c), bottom and left entries",
    wiringInput(
      SEED_C,
      DEVICES,
      CIRCUITS.map((c, i) => ({ ...c, entry_side: i % 2 ? "bottom" : "left" })),
    ),
  ],
])("routeConductors — cores leave their cable one at a time on %s", (_name, input) => {
  const conductors = routeConductors(input);
  const cables = new Map<string, Conductor[]>();
  for (const c of conductors) {
    const cable = cableOf(c);
    if (cable !== null) cables.set(cable, [...(cables.get(cable) ?? []), c]);
  }
  const sheaths = new Map(buildDrawnCables(conductors).map((sheath) => [sheath.key, sheath.d]));
  const sheathKey = (cable: string) => (cable === "wlz" ? "wlz" : `c:${cable}`);
  /** How far along the stub a core turns off: the length of its first segment. */
  const depth = (c: Conductor) => Math.abs(c.path[1].x - c.path[0].x) + Math.abs(c.path[1].y - c.path[0].y);
  const multiCore = [...cables].filter(([, cores]) => cores.length > 1);

  /** The cable's cores all run in one side pack. */
  const packed = (cores: readonly Conductor[]) =>
    cores.every((c) => c.packSide !== null && c.packSide === cores[0].packSide && c.packSegment !== null);
  /** The route from the entry to where the first core enters the pack. */
  const toPack = (cores: readonly Conductor[]) =>
    cores
      .map((c) => c.path.slice(0, (c.packSegment ?? 0) + 1))
      .map((points) => ({
        points,
        length: points
          .slice(1)
          .reduce((sum, p, i) => sum + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0),
      }))
      .filter((route) => route.length > 0)
      .sort((a, b) => a.length - b.length)[0].points;

  it("ends a packed cable's sheath where it reaches its pack, any other one at its last turn-off", () => {
    expect(multiCore.length).toBeGreaterThan(0);
    for (const [cable, cores] of multiCore) {
      const numbers = (sheaths.get(sheathKey(cable)) ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
      if (packed(cores)) {
        const expected = toPack(cores).flatMap((p) => [p.x, p.y]);
        expect(numbers).toHaveLength(expected.length);
        expected.forEach((value, i) => {
          expect(numbers[i]).toBeCloseTo(value, 1);
        });
        continue;
      }
      const byDepth = [...cores].sort((a, b) => depth(b) - depth(a));
      const last = byDepth[1].path[1];
      expect(numbers).toHaveLength(4);
      expect(numbers[0]).toBeCloseTo(cores[0].path[0].x, 1);
      expect(numbers[1]).toBeCloseTo(cores[0].path[0].y, 1);
      expect(numbers[2]).toBeCloseTo(last.x, 1);
      expect(numbers[3]).toBeCloseTo(last.y, 1);
    }
  });

  it("never runs two conductors along the same track", () => {
    expect(trackClashes(conductors)).toEqual([]);
  });

  it("splits each cable in its pack, or else in the free margin by its entry, before the first device or bar", () => {
    // A packed cable splits where it reaches its pack: inside the pack's room (strip plus the band
    // behind the rail ends). Any other cable's cores turn off onto their lanes, which lie between the
    // entry's cabinet edge and the nearest device or bar facing it; a sheath reaching past that would
    // mean several cores ran on together.
    const rects = [
      ...input.placements.map((p) => rectOfDevice(input, p.projectDeviceId)),
      ...input.geometry.bars.map(barRect),
    ];
    const strips = packStrips(input.geometry);
    for (const [, cores] of multiCore) {
      if (packed(cores)) {
        const end = toPack(cores).at(-1);
        const strip = strips[cores[0].packSide ?? "left"];
        expect(end?.x).toBeGreaterThanOrEqual(Math.min(strip.outer, strip.deep) - 1e-6);
        expect(end?.x).toBeLessThanOrEqual(Math.max(strip.outer, strip.deep) + 1e-6);
        continue;
      }
      const from = cores[0].from;
      if (from.type !== "entry") throw new Error("not an entry");
      const end = [...cores].sort((a, b) => depth(b) - depth(a))[1].path[1];
      const side = input.geometry.entries[from.entryIndex].side;
      if (side === "top") expect(end.y).toBeLessThanOrEqual(Math.min(...rects.map((r) => r.y)));
      if (side === "bottom") expect(end.y).toBeGreaterThanOrEqual(Math.max(...rects.map((r) => r.y + r.h)));
      if (side === "left") expect(end.x).toBeLessThanOrEqual(Math.min(...rects.map((r) => r.x)));
      if (side === "right") expect(end.x).toBeGreaterThanOrEqual(Math.max(...rects.map((r) => r.x + r.w)));
    }
  });

  it("never runs a core that has turned off into its own cable's stub at true scale", () => {
    const clashes: string[] = [];
    for (const [cable, cores] of multiCore) {
      const entry = cores[0].path[0];
      const vertical = cores[0].path[1].x === entry.x;
      const stubAt = vertical ? entry.x : entry.y;
      const lastDepth = [...cores].map(depth).sort((a, b) => b - a)[1];
      const reach = vertical ? entry.y : entry.x;
      // The stub's extent along its line, from the entry point to the last turn-off.
      const inward = vertical ? (cores[0].path[1].y > entry.y ? 1 : -1) : cores[0].path[1].x > entry.x ? 1 : -1;
      const [stubLow, stubHigh] = [reach, reach + inward * lastDepth].sort((a, b) => a - b);
      for (const core of cores) {
        for (let i = 2; i < core.path.length; i++) {
          const [a, b] = [core.path[i - 1], core.path[i]];
          if ((a.x === b.x) !== vertical || core.squeezed.includes(i - 1) || core.stubOverlaps.includes(i - 1))
            continue;
          const at = vertical ? a.x : a.y;
          const [low, high] = vertical
            ? [Math.min(a.y, b.y), Math.max(a.y, b.y)]
            : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
          if (Math.abs(at - stubAt) >= core.diameterMm - 1e-6) continue;
          if (Math.min(high, stubHigh) - Math.max(low, stubLow) <= 1e-6) continue;
          clashes.push(`${cable}: ${core.key} at ${String(at)}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe("routeConductors — squeezed segments", () => {
  it("lists none where every track keeps true-scale spacing", () => {
    const roomy = routeConductors(
      wiringInput(SEED_C, [device(0, "main_switch", "2P", 35), MCB_4], [circuit(4, null, 1, 1.5)], {
        earthing_system: "TN-S",
        wlz_cross_section_mm2: 4,
      }),
    );
    expect(roomy.length).toBeGreaterThan(0);
    for (const c of roomy) expect(c.squeezed).toEqual([]);
  });

  it("lists the segments of a channel too narrow for its conductors, as sorted valid segment indices", () => {
    const crowded = routeConductors(wiringInput(SEED_A, TEN_DEVICES, TEN_CIRCUITS));
    expect(crowded.some((c) => c.squeezed.length > 0)).toBe(true);
    for (const c of crowded) {
      expect([...c.squeezed].sort((p, q) => p - q)).toEqual(c.squeezed);
      expect(new Set(c.squeezed).size).toBe(c.squeezed.length);
      for (const i of c.squeezed) {
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(c.path.length - 1);
      }
    }
  });
});

describe("routeConductors — a crowded entry closes the cables up, never onto one point", () => {
  const conductors = routeConductors(wiringInput(NARROW_ENTRY, TEN_DEVICES, TEN_CIRCUITS));
  it("spaces eleven cables closer than the true-scale spacing of their cores, still apart", () => {
    const xs = [...new Set(conductors.filter((c) => c.from.type === "entry").map((c) => c.path[0].x))].sort(
      (a, b) => a - b,
    );
    expect(xs).toHaveLength(11);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(trackSpacingOf(2.5, 2.5));
    }
  });
});

/** Every bar end of a wiring, with the conductor's cross-section. */
function barEnds(conductors: readonly Conductor[]) {
  return conductors.flatMap((c) =>
    [c.from, c.to].flatMap((end) => (end.type === "bar" ? [{ end, section: c.crossSectionMm2, conductor: c }] : [])),
  );
}

describe.each([
  ["seed (b), TN-S", SEED_B, TN_S],
  ["seed (b), TN-C-S", SEED_B, { earthing_system: "TN-C-S", wlz_cross_section_mm2: 16 } as const],
  ["seed (c), TN-S", SEED_C, TN_S],
  ["seed (c), TN-C", SEED_C, { earthing_system: "TN-C", wlz_cross_section_mm2: 16 } as const],
])("routeConductors — one conductor per bar terminal on %s", (_name, geometry, supply) => {
  const conductors = routeConductors(wiringInput(geometry, DEVICES, CIRCUITS, supply));
  const ends = barEnds(conductors);

  it("never lands two conductors on one terminal", () => {
    expect(ends.length).toBeGreaterThan(0);
    const keys = ends.map(({ end }) => `${String(end.barIndex)}:${String(end.terminalIndex)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lands each conductor on a terminal whose cross-section range takes it", () => {
    for (const { end, section } of ends) {
      const bar = geometry.bars[end.barIndex];
      expect(bar.kind).toBe(end.kind);
      const group = bar.terminalGroups[end.groupIndex];
      expect(group.minMm2).toBeLessThanOrEqual(section);
      expect(section).toBeLessThanOrEqual(group.maxMm2);
      // The terminal index belongs to its group: the groups before it hold the lower indices.
      const before = bar.terminalGroups.slice(0, end.groupIndex).reduce((sum, g) => sum + g.count, 0);
      expect(end.terminalIndex).toBeGreaterThanOrEqual(before);
      expect(end.terminalIndex).toBeLessThan(before + group.count);
    }
  });

  it("ends every bar conductor on its own point of the bar", () => {
    const points = conductors.flatMap((c) => [
      ...(c.from.type === "bar" ? [c.path[0]] : []),
      ...(c.to.type === "bar" ? [c.path[c.path.length - 1]] : []),
    ]);
    expect(new Set(points.map((p) => `${p.x.toFixed(6)}:${p.y.toFixed(6)}`)).size).toBe(points.length);
  });
});

describe("routeConductors — the TN-C-S split link takes a PE-bar terminal of its own", () => {
  const conductors = routeConductors(
    wiringInput(SEED_B, DEVICES, CIRCUITS, { earthing_system: "TN-C-S", wlz_cross_section_mm2: 16 }),
  );
  it("puts the WLZ's PEN and the split link on different PE terminals", () => {
    const pen = only(conductors.filter((c) => c.kind === "wlz" && c.role === "PEN"));
    const link = only(conductors.filter((c) => c.kind === "feed" && c.from.type === "bar" && c.from.kind === "PE"));
    expect(pen.to.type === "bar" && link.from.type === "bar").toBe(true);
    if (pen.to.type === "bar" && link.from.type === "bar") {
      expect(`${String(pen.to.barIndex)}:${String(pen.to.terminalIndex)}`).not.toBe(
        `${String(link.from.barIndex)}:${String(link.from.terminalIndex)}`,
      );
    }
  });
});

describe("routeConductors — too few bar terminals leave conductors unrouted, never doubled", () => {
  const withBars = (pe: CabinetGeometry["bars"][number]["terminalGroups"]): CabinetGeometry => ({
    ...SEED_B,
    bars: SEED_B.bars.map((bar) => (bar.kind === "PE" ? { ...bar, terminalGroups: pe } : bar)),
  });

  it("wires exactly as many PE conductors as there are PE terminals", () => {
    // Six circuits and the WLZ bring seven PE conductors to a PE bar with three terminals.
    const conductors = routeConductors(wiringInput(withBars([{ count: 3, minMm2: 1.5, maxMm2: 16 }])));
    const pe = barEnds(conductors).filter(({ end }) => end.kind === "PE");
    expect(pe).toHaveLength(3);
    expect(new Set(pe.map(({ end }) => end.terminalIndex)).size).toBe(3);
    // The circuits without a PE terminal keep their other cores.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(ofCircuit(conductors, n).some((c) => wireClass(c.role) === "L")).toBe(true);
    }
  });

  it("leaves a conductor no terminal's range takes unrouted, rather than on a terminal too small", () => {
    // Terminals up to 4 mm²: every circuit's PE fits, the 16 mm² WLZ PE does not.
    const conductors = routeConductors(wiringInput(withBars([{ count: 10, minMm2: 1.5, maxMm2: 4 }])));
    expect(conductors.filter((c) => c.kind === "wlz" && c.role === "PE")).toEqual([]);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(only(ofCircuit(conductors, n).filter((c) => c.role === "PE")).to).toMatchObject({ type: "bar" });
    }
  });

  it("routes as many as the best assignment: the one wider terminal goes to the conductor only it takes", () => {
    // Six circuit PEs (one of 4 mm², the rest at most 2.5 mm²) and six terminals, only the first of
    // which takes 4 mm². Handing terminals out nearest-first could give it to a thinner conductor and
    // strand the 4 mm² one; every circuit PE must land. (The 16 mm² WLZ PE fits none.)
    const conductors = routeConductors(
      wiringInput(
        withBars([
          { count: 1, minMm2: 1.5, maxMm2: 4 },
          { count: 5, minMm2: 1.5, maxMm2: 2.5 },
        ]),
      ),
    );
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(only(ofCircuit(conductors, n).filter((c) => c.role === "PE")).to).toMatchObject({ type: "bar" });
    }
    expect(only(ofCircuit(conductors, 6).filter((c) => c.role === "PE")).to).toMatchObject({ groupIndex: 0 });
    expect(conductors.filter((c) => c.kind === "wlz" && c.role === "PE")).toEqual([]);
  });
});

/** Every circuit of the fixture entering from `side`. */
function entering(side: WiringCircuit["entry_side"], circuits: readonly WiringCircuit[] = CIRCUITS): WiringCircuit[] {
  return circuits.map((c) => ({ ...c, entry_side: side }));
}

/**
 * The oracle for the electrician's complaint (user 2026-10-07): no RCD → MCB jumper loops around the
 * devices. The MCBs take their supply on the edge the RCD gives out on, so every jumper runs along that
 * one edge within the group, and the circuit cables leave the MCBs on the other edge — the edge facing
 * their cable entry when it lies above or below the group.
 */
describe.each([
  ["seed (a), top entry", wiringInput(SEED_A, [MAIN, RCD, MCB_1, MCB_2], CIRCUITS.slice(0, 2)), "top"],
  ["seed (b), top entry", wiringInput(SEED_B), "top"],
  ["seed (b), bottom entry", wiringInput(SEED_B, DEVICES, entering("bottom")), "bottom"],
  ["seed (c), bottom entry", wiringInput(SEED_C, DEVICES, entering("bottom")), "bottom"],
  ["seed (c), left entry", wiringInput(SEED_C, DEVICES, entering("left")), null],
] as const)("routeConductors — RCD → MCB jumpers on one side, %s", (_name, input, circuitsEdge) => {
  const conductors = routeConductors(input);
  const feeds = conductors.filter((c) => c.kind === "feed");
  const groupRects = [RCD, MCB_1, MCB_2].map((d) => rectOfDevice(input, d.id));
  const left = Math.min(...groupRects.map((r) => r.x));
  const right = Math.max(...groupRects.map((r) => r.x + r.w));
  const top = Math.min(...groupRects.map((r) => r.y));
  const bottom = Math.max(...groupRects.map((r) => r.y + r.h));
  const jumpers = feeds.filter(
    (c) =>
      c.from.type === "terminal" &&
      c.from.deviceId === RCD.id &&
      c.to.type === "terminal" &&
      [MCB_1.id, MCB_2.id].includes(c.to.deviceId),
  );
  const sideOf = (c: Conductor) => {
    if (c.path.every((p) => p.y >= bottom - 1e-6)) return "bottom";
    if (c.path.every((p) => p.y <= top + 1e-6)) return "top";
    return "crosses";
  };

  it("runs every jumper within the group's span, along one and the same edge", () => {
    expect(jumpers).toHaveLength(2);
    for (const c of jumpers) {
      for (const p of c.path) {
        expect(p.x).toBeGreaterThanOrEqual(left - 1e-6);
        expect(p.x).toBeLessThanOrEqual(right + 1e-6);
      }
      // The RCD's output edge is the MCBs' supply edge.
      expect(c.from.type === "terminal" && c.to.type === "terminal" && c.from.side === c.to.side).toBe(true);
    }
    const sides = new Set(jumpers.map(sideOf));
    expect(sides.size).toBe(1);
    expect(sides.has("crosses")).toBe(false);
  });

  it("sends the circuit cables out of the MCBs on the other edge — the one facing their entry", () => {
    const jumperSide = sideOf(jumpers[0]);
    for (const [n, mcb] of [
      [1, MCB_1],
      [2, MCB_2],
    ] as const) {
      const phase = only(ofCircuit(conductors, n).filter((c) => wireClass(c.role) === "L"));
      expect(phase.to.type === "terminal" && phase.to.deviceId === mcb.id).toBe(true);
      if (phase.to.type !== "terminal") continue;
      expect(phase.to.side).not.toBe(jumperSide);
      if (circuitsEdge !== null) expect(phase.to.side).toBe(circuitsEdge);
    }
  });

  it("brings the WLZ to the main switch's edge facing its entry and feeds out of the other one", () => {
    const entry = input.geometry.entries[0];
    const main = rectOfDevice(input, MAIN.id);
    const wlzPhase = conductors.find((c) => c.kind === "wlz" && wireClass(c.role) === "L");
    if (wlzPhase?.to.type !== "terminal") throw new Error("no WLZ phase");
    if (entry.side === "top" || entry.side === "bottom") expect(wlzPhase.to.side).toBe(entry.side);
    expect(main.h).toBeGreaterThan(0);
    for (const c of feeds) {
      if (c.from.type === "terminal" && c.from.deviceId === MAIN.id) expect(c.from.side).not.toBe(wlzPhase.to.side);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Plan Phase 4 — side packs, tied round bundles and the overflow warning
// ---------------------------------------------------------------------------------------------

/** A render fixture's wiring, through the same path the project page takes. */
function fixtureWiring(fixture: RenderFixture): Conductor[] {
  const matchView = computeMatchView(fixture.context);
  const view = computeLayoutView(matchView, fixture.context, fixture.placements);
  return computeWiring(view, matchView, fixture.context);
}

/** A packed core's run in its pack, and where and which way it leaves it. */
function packRun(c: Conductor) {
  if (c.packSegment === null) throw new Error(`${c.key} has no pack run`);
  const [a, b] = [c.path[c.packSegment], c.path[c.packSegment + 1]];
  const next = c.path.at(c.packSegment + 2) ?? b;
  return {
    x: a.x,
    vertical: a.x === b.x,
    low: Math.min(a.y, b.y),
    high: Math.max(a.y, b.y),
    /** The height the core leaves the pack at, and the x it heads for there. */
    exitY: b.y,
    nextX: next.x,
    /** It travels down the pack (from the top lane, or a side entry above its exit). */
    down: b.y > a.y,
  };
}

/** The widest a set of runs gets at any height: the tied round bundle there (`packBundleWidthMm`). */
function peakBundleWidth(conductors: readonly Conductor[]): number {
  const runs = conductors.map((c) => ({ ...packRun(c), d: c.diameterMm }));
  let peak = 0;
  for (const y of runs.flatMap((r) => [r.low, r.high])) {
    const here = runs.filter((r) => r.low <= y + 1e-6 && r.high >= y - 1e-6).map((r) => r.d);
    peak = Math.max(peak, packBundleWidthMm(here));
  }
  return peak;
}

const PACKED_FIXTURES = [
  ["seed (b), top entry", wiringInput(SEED_B)],
  ["seed (b), bottom entry", wiringInput(SEED_B, DEVICES, entering("bottom"))],
  ["seed (c), bottom entry", wiringInput(SEED_C)],
  [
    "seed (c), bottom and left entries",
    wiringInput(
      SEED_C,
      DEVICES,
      CIRCUITS.map((c, i) => ({ ...c, entry_side: i % 2 ? "bottom" : "left" })),
    ),
  ],
] as const;

describe("packBundleWidthMm — a tied round bundle", () => {
  it("is √(Σd² / PACK_FILL_FACTOR) across, with a fill factor of 0.6", () => {
    expect(PACK_FILL_FACTOR).toBe(0.6);
    expect(packBundleWidthMm([3.6, 3.6, 3.6])).toBeCloseTo(Math.sqrt((3 * 3.6 * 3.6) / 0.6), 9);
    expect(packBundleWidthMm([3.0, 7.8])).toBeCloseTo(Math.sqrt((9 + 60.84) / 0.6), 9);
  });

  it("is never narrower than its widest core, and nothing for no cores", () => {
    expect(packBundleWidthMm([7.8])).toBeGreaterThanOrEqual(7.8);
    expect(packBundleWidthMm([])).toBe(0);
  });
});

describe("packStrips — the side strips", () => {
  it("runs from a vertical bar's inner edge to the rail ends on seed (b), each 3 mm off, with a 30 mm band behind", () => {
    // PE bar at x 10–25, rails 40–360, N bar at x 375–390.
    expect(packStrips(SEED_B)).toEqual({
      left: { side: "left", outer: 28, inner: 37, deep: 67, present: true, line: 32.5 },
      right: { side: "right", outer: 372, inner: 363, deep: 333, present: true, line: 367.5 },
    });
  });

  it("runs from the side wall where no vertical bar stands (seed (c))", () => {
    const { left, right } = packStrips(SEED_C);
    expect([left.outer, left.inner, left.deep, left.present]).toEqual([3, 27, 57, true]);
    expect([right.outer, right.inner, right.deep, right.present]).toEqual([597, 573, 543, true]);
  });

  it("is absent when narrower than the thinnest core", () => {
    const { left, right } = packStrips(NO_STRIPS);
    expect(left.present).toBe(false);
    expect(right.present).toBe(false);
  });
});

/** Seed (a) with one rail across the whole interior: no room for a strip on either side. */
const NO_STRIPS: CabinetGeometry = { ...SEED_A, rails: [{ xMm: 2, yMm: 80, lengthMm: 246 }] };

describe.each(PACKED_FIXTURES)("routeConductors — side packs on %s", (_name, input) => {
  const conductors = routeConductors(input);
  const strips = packStrips(input.geometry);
  const cores = conductors.filter((c) => c.kind !== "feed");

  it("runs every circuit and WLZ core vertically inside its pack's room", () => {
    expect(cores.length).toBeGreaterThan(0);
    for (const c of cores) {
      expect(c.packSide).not.toBeNull();
      if (c.packSide === null) continue;
      const run = packRun(c);
      const strip = strips[c.packSide];
      expect(run.vertical).toBe(true);
      expect(run.x).toBeGreaterThanOrEqual(Math.min(strip.outer, strip.deep) - 1e-6);
      expect(run.x).toBeLessThanOrEqual(Math.max(strip.outer, strip.deep) + 1e-6);
      expect(c.tied.some((tie) => tie.segment === c.packSegment)).toBe(true);
    }
  });

  it("follows the side rule: a side entry's own side, else the strip nearer the destination", () => {
    for (const c of cores) {
      if (c.from.type !== "entry") continue;
      const side = input.geometry.entries[c.from.entryIndex].side;
      if (side === "left" || side === "right") {
        expect(c.packSide).toBe(side);
        continue;
      }
      const target = c.path[c.path.length - 1].x;
      const dl = Math.abs(target - strips.left.line);
      const dr = Math.abs(target - strips.right.line);
      if (Math.abs(dl - dr) > 1e-6) expect(c.packSide).toBe(dl < dr ? "left" : "right");
    }
  });

  it("orders each pack innermost-exits-first: no core's branch crosses a core still in the pack", () => {
    // A core leaves its pack along a horizontal branch from its own x to the next point of its route;
    // it crosses every core of the pack lying between those two x that still runs past that height.
    // Two cores travelling opposite ways along overlapping heights cannot both avoid that (each would
    // have to sit inside the other), so the oracle compares cores travelling the same way.
    const crossings: string[] = [];
    for (const side of ["left", "right"] as const) {
      const pack = cores.filter((c) => c.packSide === side && c.packLayer === "bundle");
      for (const a of pack) {
        const run = packRun(a);
        for (const b of pack) {
          if (b === a || packRun(b).down !== run.down) continue;
          const other = packRun(b);
          const between = other.x > Math.min(run.x, run.nextX) + 1e-6 && other.x < Math.max(run.x, run.nextX) - 1e-6;
          if (between && other.low < run.exitY - 1e-6 && other.high > run.exitY + 1e-6) {
            crossings.push(`${a.key} crosses ${b.key}`);
          }
        }
      }
    }
    expect(crossings).toEqual([]);
  });

  it("keeps every feed out of the packs and, between two devices, out of the strips", () => {
    const feeds = conductors.filter((c) => c.kind === "feed");
    expect(feeds.length).toBeGreaterThan(0);
    for (const c of feeds) {
      expect(c.packSide).toBeNull();
      expect(c.packSegment).toBeNull();
      if (c.from.type !== "terminal" || c.to.type !== "terminal") continue;
      for (let i = 1; i < c.path.length; i++) {
        const [a, b] = [c.path[i - 1], c.path[i]];
        if (a.x !== b.x) continue;
        for (const strip of [strips.left, strips.right]) {
          if (!strip.present) continue;
          const inside =
            a.x > Math.min(strip.outer, strip.inner) + 1e-6 && a.x < Math.max(strip.outer, strip.inner) - 1e-6;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it("raises no overflow warning", () => {
    expect(wiringWarnings(conductors)).toEqual([]);
  });
});

describe("routeConductors — the pack side rule's ties (seed (a), one MCB centred under the entry)", () => {
  // Seed (a) is symmetric: strip lines at x 5 and 245. An MCB centred at x 125 is as near one strip as
  // the other; so is a cable entering at x 125.
  const mcb = device(1, "mcb", "1P", 17.5, { circuit: circuitId(4) });
  const placements: Placement[] = [{ projectDeviceId: mcb.id, railIndex: 0, xMm: 125 - 10 - 8.75 }];
  const input = (entry: CabinetGeometry["entries"][number]): WiringInput => ({
    geometry: { ...SEED_A, entries: [entry] },
    devices: [mcb],
    placements,
    circuits: [circuit(4, null, 1, 2.5)],
    supply: TN_S,
  });

  it("goes to the side nearer the cable's entry point when the destination ties", () => {
    // One cable on a 100–200 mm entry enters at x 150: nearer the right strip.
    const [core] = routeConductors(input({ side: "top", offsetMm: 100, lengthMm: 100 }));
    expect(core.path[0].x).toBe(150);
    expect(core.packSide).toBe("right");
  });

  it("goes left when the entry point ties too", () => {
    const [core] = routeConductors(input({ side: "top", offsetMm: 50, lengthMm: 150 }));
    expect(core.path[0].x).toBe(125);
    expect(core.packSide).toBe("left");
  });

  it("goes to the strip nearer the destination otherwise", () => {
    const near = (xMm: number) =>
      routeConductors({
        ...input({ side: "top", offsetMm: 50, lengthMm: 150 }),
        placements: [{ ...placements[0], xMm }],
      })[0].packSide;
    expect(near(20)).toBe("left");
    expect(near(200)).toBe("right");
  });
});

describe("routeConductors — the band behind the rail ends is pack room (realistic project, seed (b))", () => {
  const conductors = fixtureWiring(realisticFixture());
  const { left } = packStrips(SEED_B);
  const pack = conductors.filter((c) => c.packSide === "left");

  it("holds a left pack wider than its 9 mm strip without spilling a core", () => {
    expect(left.inner - left.outer).toBe(9);
    const peak = peakBundleWidth(pack.filter((c) => c.packLayer === "bundle"));
    expect(peak).toBeGreaterThan(left.inner - left.outer);
    expect(peak).toBeLessThanOrEqual(left.deep - left.outer);
    expect(pack.filter((c) => c.packLayer === "overflow")).toEqual([]);
    expect(pack.some((c) => packRun(c).x > left.inner)).toBe(true);
  });
});

describe("routeConductors — overflow", () => {
  it("spills the cores a pack cannot hold into the overflow layer, and warns", () => {
    // Twelve 16 mm² circuits entering from the left of seed (c): 36 cores of 7.8 mm in a pack with
    // 44 mm of room (strip, band, cut short before the PE bar).
    const circuits = Array.from({ length: 12 }, (_, i) => ({
      ...circuit(i + 1, null, 1, 16),
      entry_side: "left" as const,
    }));
    const devices = [
      device(0, "main_switch", "2P", 35),
      ...circuits.map((c, i) => device(i + 1, "mcb", "1P", 17.5, { circuit: c.id })),
    ];
    const conductors = routeConductors(wiringInput(SEED_C, devices, circuits));
    const spilled = conductors.filter((c) => c.packLayer === "overflow");
    expect(spilled.length).toBeGreaterThan(0);
    for (const c of spilled) {
      expect(c.overflow).toBe(true);
      expect(c.kind).not.toBe("feed");
      expect(c.tied.find((tie) => tie.segment === c.packSegment)?.layer).toBe("overflow");
    }
    // The bundle left in the pack fits its room.
    const { left } = packStrips(SEED_C);
    const kept = conductors.filter((c) => c.packSide === "left" && c.packLayer === "bundle");
    expect(peakBundleWidth(kept)).toBeLessThanOrEqual(44 + 1e-6);
    expect(left.present).toBe(true);
    const count = conductors.filter((c) => c.overflow).length;
    expect(wiringWarnings(conductors)).toEqual([{ code: "conductors_do_not_fit", count }]);
  });

  it("flags a circuit or WLZ core no strip can take, routed like a feed", () => {
    const conductors = routeConductors(wiringInput(NO_STRIPS, TEN_DEVICES, TEN_CIRCUITS));
    const cores = conductors.filter((c) => c.kind !== "feed");
    expect(cores.length).toBeGreaterThan(0);
    for (const c of cores) {
      expect(c.packSide).toBeNull();
      expect(c.overflow).toBe(true);
    }
    expect(wiringWarnings(conductors)).toEqual([{ code: "conductors_do_not_fit", count: cores.length }]);
  });

  it("never counts squeezed runs or fixed stub overlaps as overflow", () => {
    const conductors = routeConductors(wiringInput(SEED_A, TEN_DEVICES, TEN_CIRCUITS));
    expect(conductors.some((c) => c.squeezed.length > 0 || c.stubOverlaps.length > 0)).toBe(true);
    for (const c of conductors) {
      const spilled = c.tied.some((tie) => tie.layer === "overflow");
      expect(c.overflow).toBe(spilled || (c.kind !== "feed" && c.packSide === null));
    }
  });

  it("lists stub overlaps only where a fixed end stub is involved", () => {
    for (const [, input] of PACKED_FIXTURES) {
      const conductors = routeConductors(input);
      for (const c of conductors) {
        expect([...c.stubOverlaps].sort((p, q) => p - q)).toEqual(c.stubOverlaps);
        for (const i of c.stubOverlaps) {
          const own = i === 0 || i === c.path.length - 2;
          // Not an end stub itself: then another conductor's end stub overlaps it.
          const [a, b] = [c.path[i], c.path[i + 1]];
          const vertical = a.x === b.x;
          const at = vertical ? a.x : a.y;
          const [low, high] = vertical
            ? [Math.min(a.y, b.y), Math.max(a.y, b.y)]
            : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
          const byStub = conductors.some((o) =>
            o === c
              ? false
              : [0, o.path.length - 2].some((j) => {
                  const [p, q] = [o.path[j], o.path[j + 1]];
                  if ((p.x === q.x) !== vertical) return false;
                  const oAt = vertical ? p.x : p.y;
                  const [oLow, oHigh] = vertical
                    ? [Math.min(p.y, q.y), Math.max(p.y, q.y)]
                    : [Math.min(p.x, q.x), Math.max(p.x, q.x)];
                  return (
                    Math.abs(oAt - at) < (o.diameterMm + c.diameterMm) / 2 &&
                    Math.min(high, oHigh) - Math.max(low, oLow) > 1e-6
                  );
                }),
          );
          expect(own || byStub).toBe(true);
        }
      }
    }
  });
});

describe("wiringWarnings — the bench fixtures", () => {
  it("raises none on the realistic project (12 circuits, 4 groups, seed (b))", () => {
    expect(wiringWarnings(fixtureWiring(realisticFixture()))).toEqual([]);
  });

  it("raises none on the 12-circuit, 4-group project on seed (c)", () => {
    expect(wiringWarnings(fixtureWiring(renderFixture(4, 3, SEED_C)))).toEqual([]);
  });

  it("raises none on the worst case either: every bundle fits its room (measured 2026-10-09)", () => {
    // 60 circuits in 20 groups on seed (c). Measured: left pack 38.4 of 44 mm, right pack 41.1 of
    // 44 mm, the bottom lane 64.1 of 98 mm and the busiest row channel 40.4 of 63 mm — tied round
    // bundles hold all of it, so the honest answer is no warning (user decision 2026-10-09: report it,
    // never force it).
    const conductors = fixtureWiring(worstCaseFixture());
    expect(conductors.length).toBeGreaterThan(200);
    expect(conductors.filter((c) => c.overflow)).toEqual([]);
    expect(wiringWarnings(conductors)).toEqual([]);
    const strips = packStrips(SEED_C);
    for (const side of ["left", "right"] as const) {
      const pack = conductors.filter((c) => c.packSide === side && c.packLayer === "bundle");
      expect(pack.length).toBeGreaterThan(0);
      // The room of each seed (c) pack ends 3 mm before the horizontal PE bar: 44 mm.
      expect(peakBundleWidth(pack)).toBeLessThanOrEqual(44 + 1e-6);
      expect(Math.abs(strips[side].deep - strips[side].outer)).toBe(54);
    }
  });
});

describe("wiringWarningMessage", () => {
  it("says in Polish, with the right plural, how many conductors are drawn behind the rail ends", () => {
    const message = (count: number) => wiringWarningMessage({ code: "conductors_do_not_fit", count });
    expect(message(1)).toMatch(/^1 przewód nie zmieścił się w prawdziwej skali .* jest narysowany w drugiej warstwie/);
    expect(message(3)).toMatch(/^3 przewody nie zmieściły się .* są narysowane w drugiej warstwie/);
    expect(message(5)).toMatch(/^5 przewodów nie zmieściło się .* jest narysowanych w drugiej warstwie/);
    expect(message(5)).toContain("nie są blokowane");
  });
});

describe("wireLengthsBySection", () => {
  const conductors = routeConductors(wiringInput(SEED_B));
  const rows = wireLengthsBySection(conductors);

  it("totals every conductor once, slack included, per cross-section and wire class", () => {
    const routed = conductors.reduce((sum, c) => sum + c.routedMm, 0);
    expect(rows.reduce((sum, row) => sum + row.totalMm, 0)).toBeCloseTo(routed * 1.3, 6);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(conductors.length);
    const keys = rows.map((row) => `${String(row.crossSectionMm2)}:${row.wireClass}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("orders by cross-section, then L, N, PE, PEN, and names the kinds in each row", () => {
    expect(rows.map((row) => [row.crossSectionMm2, row.wireClass])).toEqual([
      [1.5, "L"],
      [1.5, "N"],
      [1.5, "PE"],
      [2.5, "L"],
      [2.5, "N"],
      [2.5, "PE"],
      [4, "L"],
      [4, "N"],
      [4, "PE"],
      [16, "L"],
      [16, "N"],
      [16, "PE"],
    ]);
    expect(rows.find((row) => row.crossSectionMm2 === 16 && row.wireClass === "L")?.kinds).toEqual(["wlz", "feed"]);
    expect(rows.find((row) => row.crossSectionMm2 === 16 && row.wireClass === "PE")?.kinds).toEqual(["wlz"]);
  });

  it("sums a hand-built pair exactly", () => {
    const base = conductors[0];
    const pair: Conductor[] = [
      { ...base, role: "L1", routedMm: 100, lengthMm: 115 },
      { ...base, role: "L3", routedMm: 200, lengthMm: 230 },
    ];
    expect(wireLengthsBySection(pair)).toEqual([
      { crossSectionMm2: base.crossSectionMm2, wireClass: "L", kinds: [base.kind], count: 2, totalMm: 345 },
    ]);
  });
});
