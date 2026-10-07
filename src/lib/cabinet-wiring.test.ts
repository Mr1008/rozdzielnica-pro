import { describe, expect, it } from "vitest";
import {
  deviceRect,
  deviceTerminals,
  proposeLayout,
  type LayoutDevice,
  type Placement,
  type Point,
} from "./cabinet-layout";
import { SEED_A, SEED_B, SEED_C } from "./cabinet-layout.fixtures";
import type { CabinetGeometry } from "./cabinet-geometry";
import {
  WIRE_SLACK_RATIO,
  WIRE_TRACK_PITCH_MM,
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

function isTerminal(endpoint: Endpoint, deviceId: string, side: "line" | "load", pole?: string): boolean {
  return (
    endpoint.type === "terminal" &&
    endpoint.deviceId === deviceId &&
    endpoint.side === side &&
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
        expect(c.from).toEqual({ type: "entry", entryIndex: 0 });
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

  it("lands each phase on its own protective device's load side", () => {
    const protection = [MCB_1, MCB_2, RCBO, MCB_4, MCB_5, MCB_6];
    protection.forEach((dev, index) => {
      const phases = ofCircuit(conductors, index + 1).filter((c) => wireClass(c.role) === "L");
      for (const c of phases) expect(isTerminal(c.to, dev.id, "load", c.role)).toBe(true);
    });
  });

  it("ends a grouped circuit's N at its group's RCD — never at the N bar", () => {
    for (const n of [1, 2]) {
      const neutral = only(ofCircuit(conductors, n).filter((c) => c.role === "N"));
      expect(isTerminal(neutral.to, RCD.id, "load", "N")).toBe(true);
    }
  });

  it("ends an RCBO circuit's N at the RCBO, and a 1P+N MCB circuit's N at that MCB", () => {
    expect(isTerminal(only(ofCircuit(conductors, 3).filter((c) => c.role === "N")).to, RCBO.id, "load", "N")).toBe(
      true,
    );
    expect(isTerminal(only(ofCircuit(conductors, 5).filter((c) => c.role === "N")).to, MCB_5.id, "load", "N")).toBe(
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
    expect(isTerminal(split.to, MAIN.id, "line", "N")).toBe(true);
  });

  it("wires the circuits like TN-S after the split: separate N and PE, grouped N from the RCD", () => {
    expect(
      ofCircuit(conductors, 1)
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L", "N", "PE"]);
    expect(isTerminal(only(ofCircuit(conductors, 1).filter((c) => c.role === "N")).to, RCD.id, "load", "N")).toBe(true);
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
    for (const c of wlz) expect(c.from).toEqual({ type: "entry", entryIndex: 0 });
    for (const c of wlz.filter((c) => c.role !== "PE")) expect(isTerminal(c.to, MAIN.id, "line", c.role)).toBe(true);
    expect(only(wlz.filter((c) => c.role === "PE")).to).toMatchObject({ type: "bar", kind: "PE" });
  });

  it("feeds every RCD, RCBO and ungrouped MCB phase from the main switch's load side", () => {
    for (const dev of [RCD, RCBO, MCB_4, MCB_5, MCB_6]) {
      const toDevice = feeds.filter((c) => isTerminal(c.to, dev.id, "line") && c.role !== "N");
      expect(toDevice.length).toBeGreaterThan(0);
      for (const c of toDevice) expect(isTerminal(c.from, MAIN.id, "load")).toBe(true);
    }
    expect(
      feeds
        .filter((c) => isTerminal(c.to, MCB_6.id, "line"))
        .map((c) => c.role)
        .sort(),
    ).toEqual(["L1", "L2", "L3"]);
  });

  it("feeds each grouped MCB from its RCD's load side, not from the main switch", () => {
    for (const dev of [MCB_1, MCB_2]) {
      const c = only(feeds.filter((f) => isTerminal(f.to, dev.id, "line")));
      expect(isTerminal(c.from, RCD.id, "load", "L")).toBe(true);
    }
  });

  it("runs the main switch's N to the N bar and the N bar to every line-side N the main switch feeds", () => {
    expect(only(feeds.filter((c) => isTerminal(c.from, MAIN.id, "load", "N"))).to).toMatchObject({
      type: "bar",
      kind: "N",
    });
    for (const dev of [RCD, RCBO, MCB_5]) {
      const c = only(feeds.filter((f) => isTerminal(f.to, dev.id, "line", "N")));
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
  if (endpoint.type === "entry") {
    const entry = input.geometry.entries[endpoint.entryIndex];
    const mid = entry.offsetMm + entry.lengthMm / 2;
    const { widthMm, heightMm } = input.geometry.interior;
    return {
      top: { x: mid, y: 0 },
      bottom: { x: mid, y: heightMm },
      left: { x: 0, y: mid },
      right: { x: widthMm, y: mid },
    }[entry.side];
  }
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

  // The user's requirement: every trace visible — no two conductors on one track. Two parallel
  // segments of different conductors that overlap along their length must lie more than half a
  // pitch apart. The one exception is a pair of end segments touching the same endpoint: conductors
  // sharing a terminal, an entry or a bar terminal group necessarily share its last stub.
  it("never runs two conductors along the same track", () => {
    const segments = conductors.flatMap((c, conductor) =>
      c.path.slice(1).map((b, i) => {
        const a = c.path[i];
        const vertical = a.x === b.x;
        const last = i === c.path.length - 2;
        return {
          conductor,
          vertical,
          at: vertical ? a.x : a.y,
          low: vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x),
          high: vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x),
          /** The endpoint this segment touches, if it is the route's first or last segment. */
          end: i === 0 ? c.path[0] : last ? b : null,
        };
      }),
    );
    const clashes: string[] = [];
    for (const [n, s] of segments.entries()) {
      for (const t of segments.slice(n + 1)) {
        if (s.conductor === t.conductor || s.vertical !== t.vertical) continue;
        if (Math.abs(s.at - t.at) >= WIRE_TRACK_PITCH_MM * 0.5) continue;
        if (Math.min(s.high, t.high) - Math.max(s.low, t.low) <= 1e-6) continue;
        if (s.end !== null && t.end !== null && s.end.x === t.end.x && s.end.y === t.end.y) continue;
        clashes.push(`${conductors[s.conductor].key}/${conductors[t.conductor].key} at ${String(s.at)}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps the 3 mm pitch wide enough for the drawn strokes", () => {
    expect(WIRE_TRACK_PITCH_MM).toBeGreaterThanOrEqual(2.5);
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

  it("spreads the shared top lane: cables running alongside each other get their own tracks", () => {
    for (const c of phases) {
      // Still an entry stub straight down, then the lane, then the rest.
      expect(c.path[0]).toEqual({ x: 125, y: 0 });
      expect(c.path[1].x).toBe(125);
    }
    const lanes = phases.map((c) => ({
      y: c.path[1].y,
      x1: Math.min(125, c.path[2].x),
      x2: Math.max(125, c.path[2].x),
    }));
    lanes.forEach((a, i) => {
      for (const b of lanes.slice(i + 1)) {
        if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 1e-6) {
          expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(WIRE_TRACK_PITCH_MM - 1e-6);
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
