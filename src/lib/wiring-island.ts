import {
  buildCableTies,
  buildDrawnBusbars,
  buildDrawnCables,
  buildDrawnWires,
  type DrawnBusbar,
  type DrawnCable,
  type DrawnDevice,
  type DrawnTie,
  type DrawnWire,
  type WiringVariant,
} from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Placement } from "@/lib/cabinet-layout";
import {
  routeWiring,
  wireLengthsBySection,
  wiringWarnings,
  type WireLengthRow,
  type WiringCircuit,
  type WiringDevice,
  type WiringSupply,
  type WiringWarning,
} from "@/lib/cabinet-wiring";

/**
 * Wiring in the browser (S-11 Phase 5, decision 2026-10-09 in
 * `context/changes/realistic-wiring-render/change.md`). On Cloudflare the worst-case render path takes
 * a 19 ms median, which is over the Worker CPU budget. So the server only decides the layout state and
 * validates the placements, and it hands a `placed` layout to an island as this plain, serialisable
 * data. The island routes and draws the wires with `buildWiringDrawing`.
 *
 * Bundle-safe on purpose: it imports only the pure router and drawing modules, never
 * `layout-server.ts`. Only the fields the router reads are kept, so prices and other snapshot columns
 * stay off the wire.
 */

export type WiringDataCircuit = WiringCircuit & { name: string };

export interface WiringData {
  geometry: CabinetGeometry;
  devices: WiringDevice[];
  /** A layout that passed `validateLayout` (state `placed`). */
  placements: Placement[];
  /** Ordered by position. The names title the wires. */
  circuits: WiringDataCircuit[];
  supply: WiringSupply;
}

export interface WiringDrawing {
  wires: DrawnWire[];
  cables: DrawnCable[];
  /** The comb busbars of the groups that have one, drawn between the devices and the wires. */
  busbars: DrawnBusbar[];
  /** The realistic variant's cable ties; the schematic one draws none. */
  ties: DrawnTie[];
  lengths: WireLengthRow[];
  warnings: WiringWarning[];
}

/** The router's input from a `placed` layout, cut down to the fields `routeConductors` reads. */
export function toWiringData(input: {
  geometry: CabinetGeometry;
  devices: readonly WiringDevice[];
  placements: readonly Placement[];
  circuits: readonly WiringDataCircuit[];
  supply: WiringSupply;
}): WiringData {
  return {
    geometry: input.geometry,
    devices: input.devices.map((device) => ({
      id: device.id,
      role: device.role,
      rcd_group_id: device.rcd_group_id,
      circuit_id: device.circuit_id,
      width_mm: device.width_mm,
      height_mm: device.height_mm,
      poles: device.poles,
      n_terminal_side: device.n_terminal_side,
      terminal_groups: device.terminal_groups ?? null,
      busbar_piece: device.busbar_piece ?? null,
    })),
    placements: input.placements.map(({ projectDeviceId, railIndex, xMm }) => ({ projectDeviceId, railIndex, xMm })),
    circuits: input.circuits.map((circuit) => ({
      id: circuit.id,
      name: circuit.name,
      rcd_group_id: circuit.rcd_group_id,
      phase_count: circuit.phase_count,
      cross_section_mm2: circuit.cross_section_mm2,
      entry_side: circuit.entry_side,
    })),
    supply: {
      earthing_system: input.supply.earthing_system,
      wlz_cross_section_mm2: input.supply.wlz_cross_section_mm2,
    },
  };
}

/**
 * The wires, cables, busbars, ties, lengths and overflow warnings of a placed layout: the same router and drawing
 * calls the server made before the island. `devices` are the drawn devices, whose labels title the
 * feeds; `variant` shapes the wires' bends and sag, and must match the drawing's `wiring` prop.
 */
export function buildWiringDrawing(
  data: WiringData,
  devices: readonly DrawnDevice[],
  variant: WiringVariant = "realistic",
): WiringDrawing {
  const { conductors, busbars } = routeWiring(data);
  const groupLabels = new Map(
    devices.flatMap((device) =>
      device.groupKey === null || device.groupLabel === null ? [] : [[device.groupKey, device.groupLabel] as const],
    ),
  );
  return {
    wires: buildDrawnWires(
      conductors,
      {
        circuits: new Map(data.circuits.map((circuit) => [circuit.id, circuit.name])),
        devices,
      },
      variant,
    ),
    cables: buildDrawnCables(conductors),
    busbars: buildDrawnBusbars(busbars, variant, groupLabels),
    ties: variant === "realistic" ? buildCableTies(conductors) : [],
    lengths: wireLengthsBySection(conductors),
    warnings: wiringWarnings(conductors),
  };
}
