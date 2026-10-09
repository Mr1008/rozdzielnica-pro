import { busbarPins, type DeviceSpec, type NTerminalSide } from "@/lib/device-spec";
import { modulesFromMm } from "@/lib/din-module";
import { t } from "@/lib/i18n";

/**
 * The one-line Polish parameter summary the catalog list shows per device, e.g. "B16 1P, 6 kA" for
 * an MCB or "2 × 1,5–16 mm²" for a bar. Takes a parsed spec, so every parameter the kind needs is
 * guaranteed present — a stored row that fails `parseDeviceSpec` is listed with a warning instead.
 * A device whose poles carry N ends with its N terminal side, e.g. "…, N z lewej".
 */
export function deviceParameterSummary(spec: DeviceSpec): string {
  const s = t.devices.summary;
  const join = (parts: string[]) => parts.join(s.separator);
  const withN = (parts: string[], side: NTerminalSide | null) =>
    join(side === null ? parts : [...parts, s.nTerminalSide[side]]);

  switch (spec.kind) {
    case "switch_disconnector":
      return withN([s.ratedCurrent(spec.rated_current_a, t.devices.poles[spec.poles])], spec.n_terminal_side);
    case "rcd":
      return withN(
        [
          s.ratedCurrent(spec.rated_current_a, t.devices.poles[spec.poles]),
          s.residualCurrent(spec.residual_current_ma),
          s.rcdType(spec.rcd_type),
        ],
        spec.n_terminal_side,
      );
    case "rcbo":
      return withN(
        [
          s.characteristicB(spec.rated_current_a, t.devices.poles[spec.poles]),
          s.residualCurrent(spec.residual_current_ma),
          s.rcdType(spec.rcd_type),
          s.breakingCapacity(spec.breaking_capacity_ka),
        ],
        spec.n_terminal_side,
      );
    case "mcb_b":
      return withN(
        [
          s.characteristicB(spec.rated_current_a, t.devices.poles[spec.poles]),
          s.breakingCapacity(spec.breaking_capacity_ka),
        ],
        spec.n_terminal_side,
      );
    case "comb_busbar":
      return join([s.busbar(t.devices.busbarPhases[spec.poles], spec.rated_current_a, busbarPins(spec.width_mm))]);
    case "pe_bar":
    case "n_bar":
      return join(spec.terminal_groups.map((group) => s.terminalGroup(group.count, group.minMm2, group.maxMm2)));
  }
}

/** "2 TE (35 mm)" for a whole number of half-modules, otherwise just "36 mm". */
export function deviceWidthLabel(widthMm: number): string {
  return t.devices.catalog.width(modulesFromMm(widthMm), widthMm);
}
