import { deviceLabelLines, type DrawableDevice } from "@/lib/cabinet-drawing";
import type { LayoutDevice, LayoutGroup, LayoutIssueNames, Placement } from "@/lib/cabinet-layout";
import type { CircuitInput } from "@/lib/circuit-params";
import { t } from "@/lib/i18n";

/**
 * What the layout editor island is given (S-06): the snapshot devices with every field both the
 * layout rules and the drawing read, the groups with their labels, the saved placements, and the
 * names its refusal messages use. Plain data — the island is mounted `client:only`, so every prop is
 * serialised — and built from the server's snapshot, never from a client-side query.
 */

/** A snapshot row cut down to what `validateLayout`, the moves and `buildDrawnDevices` read. */
export type EditorDevice = LayoutDevice & DrawableDevice;

export interface LayoutEditorData {
  devices: EditorDevice[];
  groups: Pick<LayoutGroup, "id" | "label">[];
  /** The saved placements. */
  placements: Placement[];
  names: LayoutIssueNames;
  /** A draft to start from instead of `placements` — the kitchen sink's dirty state. */
  initialDraft?: Placement[];
}

/** Only the fields the editor reads, so a `project_devices` row's price and snapshot columns stay off the wire. */
export function toEditorDevices(snapshot: readonly (LayoutDevice & DrawableDevice)[]): EditorDevice[] {
  return snapshot.map((device) => ({
    id: device.id,
    position: device.position,
    role: device.role,
    rcd_group_id: device.rcd_group_id,
    circuit_id: device.circuit_id,
    kind: device.kind,
    width_mm: device.width_mm,
    height_mm: device.height_mm,
    poles: device.poles,
    n_terminal_side: device.n_terminal_side,
    rated_current_a: device.rated_current_a,
    residual_current_ma: device.residual_current_ma,
    terminal_groups: device.terminal_groups,
  }));
}

const BAR_ROLE_NAMES: Readonly<Record<string, string>> = {
  pe_bar: t.matching.roles.peBar,
  n_bar: t.matching.roles.nBar,
};

/**
 * The names a refusal reads — "B16 Gniazda kuchnia", "RCD 40A 30mA Kuchnia" — keyed by device id, and
 * the group labels keyed by group id. A device is named by its drawn label lines plus the circuit it
 * serves (an RCD: its group), so two B16 breakers can be told apart.
 */
export function layoutIssueNames(
  devices: readonly (Pick<LayoutDevice, "id" | "role" | "rcd_group_id" | "circuit_id"> &
    Pick<DrawableDevice, "rated_current_a" | "residual_current_ma">)[],
  groups: readonly Pick<LayoutGroup, "id" | "label">[],
  circuits: readonly Pick<CircuitInput, "id" | "name">[],
): LayoutIssueNames {
  const groupLabels = Object.fromEntries(groups.map((group) => [group.id, group.label]));
  const circuitNames = new Map(circuits.map((circuit) => [circuit.id, circuit.name]));
  const deviceNames: Record<string, string> = {};
  for (const device of devices) {
    const lines = deviceLabelLines(
      device.role === "main_switch" ||
        device.role === "rcd" ||
        device.role === "rcbo" ||
        device.role === "pe_bar" ||
        device.role === "n_bar"
        ? device.role
        : "mcb",
      device.rated_current_a,
      device.residual_current_ma,
    );
    const base = lines.length > 0 ? lines.join(" ") : (BAR_ROLE_NAMES[device.role] ?? device.role);
    const context =
      device.circuit_id !== null
        ? circuitNames.get(device.circuit_id)
        : device.role !== "main_switch" && device.rcd_group_id !== null
          ? groupLabels[device.rcd_group_id]
          : undefined;
    deviceNames[device.id] = context === undefined ? base : `${base} ${context}`;
  }
  return { devices: deviceNames, groups: groupLabels };
}
