import eatonRows from "../../supabase/catalog/source/eaton.json";
import legrandRows from "../../supabase/catalog/source/legrand.json";
import {
  DEVICE_FIELDS,
  DEVICE_KINDS,
  parseDeviceSpec,
  polesCarryN,
  type DeviceKind,
  type DeviceSpec,
  type PoleConfig,
  type RcdType,
} from "@/lib/device-spec";
import { DIN_MODULE_MM } from "@/lib/din-module";
import { t } from "@/lib/i18n";

/**
 * The Eaton + Legrand production catalog: turns the curated source rows in
 * `supabase/catalog/source/*.json` into `DeviceSpec` rows and into `supabase/catalog/eaton-legrand.sql`.
 *
 * Every rule that invents data lives here, named and commented, so nothing is ever hand-edited in the
 * SQL file. The file is pinned by `catalog-seed.test.ts` (`toMatchFileSnapshot`); regenerate it with
 * `npx vitest run --config vitest.config.ts src/lib/catalog-seed.test.ts -u`.
 *
 * What the source does not carry is completed by fixed rules:
 * - width: the source width, else `modules × DIN_MODULE_MM`; PE/N bars (no width in the catalogs) are
 *   `terminals × 6 + 10` mm;
 * - height/depth: a per-series default (`DIMENSION_DEFAULTS`) — the series' own web value where the
 *   source had none, else a sibling series of the same brand, else a generic 85 × 70 mm;
 * - N terminal side: "left" on every N-carrying pole set, as the 20261006120000 backfill did;
 * - a bar terminal group without a minimum section: 1.5 mm² when its maximum is ≤ 16 mm², else 6 mm².
 *
 * Prices are NOT catalog data: the source has none. They are an estimate of the Polish net list level
 * (whole PLN, stored as integer grosze) built by `priceGrosze` from the named tables below, and must
 * be reviewed by the owner before they are trusted for quoting. The generated file is immutable once
 * deployed: a price or model fix goes into a new migration, never a regeneration.
 */

export const CATALOG_MANUFACTURERS = ["Eaton", "Legrand"] as const;
type Manufacturer = (typeof CATALOG_MANUFACTURERS)[number];

/** One row of `supabase/catalog/source/*.json`; every value the catalogs did not state is `null`. */
interface SourceRow {
  kind: DeviceKind;
  manufacturer: Manufacturer;
  series: string;
  model: string;
  poles: PoleConfig | null;
  rated_current_a: number | null;
  residual_current_ma: number | null;
  rcd_type: RcdType | null;
  breaking_capacity_ka: number | null;
  modules: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  terminal_groups: { count: number; minMm2: number | null; maxMm2: number }[] | null;
}

const SOURCE_ROWS = [...(eatonRows as unknown as SourceRow[]), ...(legrandRows as unknown as SourceRow[])];

/** Height and depth (mm) for a series whose source rows lack them. Only series that need it are listed. */
const GENERIC_DIMENSIONS = { heightMm: 85, depthMm: 70 };
/** Legrand DX3 MCB body, the sibling of the DX3 RCD/RCBO/FR 300 modules (which the PDFs give no depth for). */
const LEGRAND_DX3 = { heightMm: 94.8, depthMm: 77.8 };
/** A comb busbar is never placed on a rail; this is the same thin profile `supabase/seed.sql` uses. */
const BUSBAR_DIMENSIONS = { heightMm: 20, depthMm: 12 };
const BAR_DIMENSIONS = { heightMm: 30, depthMm: 25 };

const DIMENSION_DEFAULTS: Record<string, { heightMm: number; depthMm: number }> = {
  "Legrand|P 302 DX3": LEGRAND_DX3,
  "Legrand|P 304 DX3": LEGRAND_DX3,
  "Legrand|P 312 DX3": LEGRAND_DX3,
  "Legrand|FR 300": LEGRAND_DX3,
  "Eaton|EVG": BUSBAR_DIMENSIONS,
  "Legrand|HX3 prong-type": BUSBAR_DIMENSIONS,
  "Legrand|HX3 fork-type": BUSBAR_DIMENSIONS,
};

/** Terminal width of a PE/N bar and the fixed part, in mm: `terminals × 6 + 10`. */
const BAR_TERMINAL_PITCH_MM = 6;
const BAR_END_MM = 10;
/** A bar terminal group without a stated minimum section. */
const THIN_MIN_MM2 = 1.5;
const THICK_MIN_MM2 = 6;
const THIN_MAX_MM2_LIMIT = 16;

const round = (value: number, places: number) => Number(value.toFixed(places));

function dimensionsFor(row: SourceRow): { heightMm: number; depthMm: number } {
  if (row.height_mm !== null && row.depth_mm !== null) return { heightMm: row.height_mm, depthMm: row.depth_mm };
  const isBar = row.kind === "pe_bar" || row.kind === "n_bar";
  const fallback = isBar
    ? BAR_DIMENSIONS
    : (DIMENSION_DEFAULTS[`${row.manufacturer}|${row.series}`] ?? GENERIC_DIMENSIONS);
  return { heightMm: row.height_mm ?? fallback.heightMm, depthMm: row.depth_mm ?? fallback.depthMm };
}

function terminalCount(row: SourceRow): number {
  return (row.terminal_groups ?? []).reduce((sum, group) => sum + group.count, 0);
}

function widthFor(row: SourceRow): number {
  if (row.width_mm !== null) return row.width_mm;
  if (row.kind === "pe_bar" || row.kind === "n_bar") return terminalCount(row) * BAR_TERMINAL_PITCH_MM + BAR_END_MM;
  if (row.modules !== null) return row.modules * DIN_MODULE_MM;
  throw new Error(`No width for ${row.model}`);
}

// --- Prices -----------------------------------------------------------------------------------------

/** The Legrand DX3 tier against Eaton; applied to every Legrand row. */
const BRAND_TIER: Record<Manufacturer, number> = { Eaton: 1, Legrand: 1.08 };

/** PLN of the reference part of each kind: MCB 1P B16 / RCD 2P 40 A 30 mA AC / RCBO 1P+N B16 30 mA AC / FR 2P 40 A. */
const BASE_PLN = { mcb_b: 28, rcd: 120, rcbo: 135, switch_disconnector: 55 } as const;

/** Each table rises (never falls) with the rating, so a higher current never costs less. */
const MCB_CURRENT: Record<number, number> = {
  6: 0.95,
  10: 0.95,
  13: 0.97,
  16: 1,
  20: 1.04,
  25: 1.1,
  32: 1.2,
  40: 1.45,
  50: 1.7,
  63: 1.95,
};
const RCD_CURRENT: Record<number, number> = { 16: 0.7, 25: 0.8, 40: 1, 63: 1.35, 80: 1.7, 100: 2.1 };
const RCBO_CURRENT: Record<number, number> = { ...MCB_CURRENT, 40: 1.4 };
const FR_CURRENT: Record<number, number> = {
  16: 0.7,
  20: 0.75,
  25: 0.8,
  32: 0.9,
  40: 1,
  63: 1.3,
  80: 1.6,
  100: 1.9,
  125: 2.3,
};

/** Rises with the pole count along `POLE_CONFIGS`, so more poles are never cheaper. */
const POLES_FACTOR: Record<DeviceKind, Partial<Record<PoleConfig, number>>> = {
  mcb_b: { "1P": 1, "1P+N": 1.7, "2P": 1.9, "3P": 2.8, "3P+N": 3.7, "4P": 3.8 },
  rcd: { "2P": 1, "4P": 1.75 },
  rcbo: { "1P+N": 1, "2P": 1.05, "3P+N": 2, "4P": 2.1 },
  switch_disconnector: { "1P": 0.5, "2P": 1, "3P": 1.5, "4P": 2 },
  comb_busbar: {},
  pe_bar: {},
  n_bar: {},
};

/** Type factor: AC < A < F < B. */
const RCD_TYPE_FACTOR: Record<RcdType, number> = { AC: 1, A: 1.18, F: 1.6, B: 4.5 };
/** 10 mA is the dear sensitivity; 100 and 300 mA are slightly cheaper than the 30 mA reference. */
const SENSITIVITY_FACTOR: Record<number, number> = { 10: 1.25, 30: 1, 100: 0.95, 300: 0.92 };

/** Comb busbar: PLN per pin, with a floor; a part rated above 63 A costs a little more. */
const BUSBAR_PIN_PLN = { "1P": 1.2, "3P": 3.2 } as const;
const BUSBAR_MIN_PLN = 12;
const BUSBAR_HIGH_CURRENT_FACTOR = 1.1;
/** PE/N bar: fixed part plus a price per terminal. */
const BAR_BASE_PLN = 8;
const BAR_TERMINAL_PLN = 2.5;

function lookup(table: Record<number, number>, key: number | null, row: SourceRow, what: string): number {
  const value = key === null ? undefined : table[key];
  if (value === undefined) throw new Error(`No ${what} price factor for ${row.model}`);
  return value;
}

function priceGrosze(row: SourceRow, width: number): number {
  let pln: number;
  switch (row.kind) {
    case "pe_bar":
    case "n_bar":
      pln = BAR_BASE_PLN + BAR_TERMINAL_PLN * terminalCount(row);
      break;
    case "comb_busbar": {
      if (row.poles !== "1P" && row.poles !== "3P") throw new Error(`Bad busbar poles for ${row.model}`);
      const pins = Math.floor(width / DIN_MODULE_MM + 1e-9);
      const highCurrent = (row.rated_current_a ?? 0) > 63 ? BUSBAR_HIGH_CURRENT_FACTOR : 1;
      pln = Math.max(BUSBAR_MIN_PLN, pins * BUSBAR_PIN_PLN[row.poles]) * highCurrent;
      break;
    }
    default: {
      const poles = row.poles === null ? undefined : POLES_FACTOR[row.kind][row.poles];
      if (poles === undefined) throw new Error(`No pole price factor for ${row.model}`);
      const current = {
        mcb_b: MCB_CURRENT,
        rcd: RCD_CURRENT,
        rcbo: RCBO_CURRENT,
        switch_disconnector: FR_CURRENT,
      }[row.kind];
      pln = BASE_PLN[row.kind] * poles * lookup(current, row.rated_current_a, row, "current");
      if (row.kind === "rcd" || row.kind === "rcbo") {
        if (row.rcd_type === null) throw new Error(`No RCD type for ${row.model}`);
        pln *= RCD_TYPE_FACTOR[row.rcd_type] * lookup(SENSITIVITY_FACTOR, row.residual_current_ma, row, "sensitivity");
      }
    }
  }
  return Math.round(pln * BRAND_TIER[row.manufacturer]) * 100;
}

// --- Names ------------------------------------------------------------------------------------------

/** "P 302 DX3" is written "P302 DX3" in a name; the source keeps the catalog's own spacing. */
const nameSeries = (series: string) => series.replace(/^([A-Z]) (\d)/, "$1$2");

function nameFor(row: SourceRow, width: number): string {
  const n = t.catalogSeed;
  const series = nameSeries(row.series);
  const need = <T>(value: T | null): T => {
    if (value === null) throw new Error(`Missing parameter for ${row.model}`);
    return value;
  };
  switch (row.kind) {
    case "mcb_b":
      return n.mcb(series, need(row.rated_current_a), need(row.poles));
    case "rcd":
      return n.rcd(
        series,
        need(row.rated_current_a),
        need(row.poles),
        need(row.residual_current_ma),
        need(row.rcd_type),
      );
    case "rcbo":
      return n.rcbo(
        series,
        need(row.rated_current_a),
        need(row.poles),
        need(row.residual_current_ma),
        need(row.rcd_type),
      );
    case "switch_disconnector":
      return n.switchDisconnector(series, need(row.rated_current_a), need(row.poles));
    case "comb_busbar": {
      const poles = need(row.poles);
      if (poles !== "1P" && poles !== "3P") throw new Error(`Bad busbar poles for ${row.model}`);
      return n.combBusbar(
        series,
        t.devices.busbarPhases[poles],
        Math.floor(width / DIN_MODULE_MM + 1e-9),
        need(row.rated_current_a),
      );
    }
    case "pe_bar":
      return n.peBar(row.model, terminalCount(row));
    case "n_bar":
      return n.nBar(row.model, terminalCount(row));
  }
}

// --- Rows -------------------------------------------------------------------------------------------

function toDevice(row: SourceRow): DeviceSpec {
  const width = round(widthFor(row), 2);
  const { heightMm, depthMm } = dimensionsFor(row);
  const candidate = {
    kind: row.kind,
    name: nameFor(row, width),
    manufacturer: row.manufacturer,
    model: row.model,
    price_grosze: priceGrosze(row, width),
    width_mm: width,
    height_mm: round(heightMm, 1),
    depth_mm: round(depthMm, 1),
    poles: row.poles,
    rated_current_a: row.rated_current_a,
    residual_current_ma: row.residual_current_ma,
    rcd_type: row.rcd_type,
    breaking_capacity_ka: row.breaking_capacity_ka,
    terminal_groups:
      row.terminal_groups?.map((group) => ({
        count: group.count,
        minMm2: group.minMm2 ?? (group.maxMm2 <= THIN_MAX_MM2_LIMIT ? THIN_MIN_MM2 : THICK_MIN_MM2),
        maxMm2: group.maxMm2,
      })) ?? null,
    n_terminal_side: polesCarryN(row.poles) ? "left" : null,
  };
  const parsed = parseDeviceSpec(candidate);
  if (!parsed.ok) {
    throw new Error(
      `Catalog row ${row.model} rejected: ${parsed.issues.map((i) => `${i.field}:${i.code}`).join(", ")}`,
    );
  }
  return parsed.spec;
}

/** Manufacturer, then kind in `DEVICE_KINDS` order, then model — so a regeneration diffs stably. */
function compareDevices(a: DeviceSpec, b: DeviceSpec): number {
  return (
    a.manufacturer.localeCompare(b.manufacturer, "en") ||
    DEVICE_KINDS.indexOf(a.kind) - DEVICE_KINDS.indexOf(b.kind) ||
    (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)
  );
}

export function buildCatalogDevices(): DeviceSpec[] {
  return SOURCE_ROWS.map(toDevice).sort(compareDevices);
}

// --- SQL --------------------------------------------------------------------------------------------

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return sqlText(value);
  if (Array.isArray(value)) return `${sqlText(JSON.stringify(value))}::jsonb`;
  throw new Error("Unsupported SQL value");
}

export function renderCatalogSql(): string {
  const rows = buildCatalogDevices().map((device) => {
    const record: Record<string, unknown> = device;
    return `  (${DEVICE_FIELDS.map((field) => sqlValue(record[field])).join(", ")})`;
  });
  return [
    "-- Generated by src/lib/catalog-seed.ts - do not edit.",
    "-- Regenerate with: npx vitest run --config vitest.config.ts src/lib/catalog-seed.test.ts -u",
    "-- Eaton + Legrand production device catalog. Prices are estimated net list levels in grosze.",
    "begin;",
    "",
    `insert into public.devices (${DEVICE_FIELDS.join(", ")})`,
    "values",
    rows.join(",\n"),
    "on conflict ((lower(manufacturer)), (lower(model))) do nothing;",
    "",
    "commit;",
    "",
  ].join("\n");
}
