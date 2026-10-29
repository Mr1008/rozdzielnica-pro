import { DIN_MODULE_MM } from "@/lib/din-module";
import { POLE_CONFIGS, RCD_TYPES } from "@/lib/device-spec";
import { LOCALE } from "@/lib/i18n/format";

/**
 * What the three catalog lists (admin devices, admin cabinets, the electrician's cabinet picker) must
 * agree on: cabinet capacity, ordering, filter predicates and the cabinet view modes. Pure and
 * DOM-free, so the server renderer and the browser filter script share it.
 *
 * Inputs are minimal structural shapes rather than `database.types` rows, so a list can pass a
 * row, a `data-*` read-back or a test fixture alike.
 */

/** Mirrors `CABINET_MOUNTINGS` in `cabinet-form.ts`; `null` is a legacy row not yet classified. */
export type CatalogMounting = "surface" | "flush";

export const CABINET_VIEWS = ["large", "small", "list"] as const;
export type CabinetView = (typeof CABINET_VIEWS)[number];
export const DEFAULT_CABINET_VIEW: CabinetView = "small";

export function isCabinetView(value: unknown): value is CabinetView {
  return typeof value === "string" && (CABINET_VIEWS as readonly string[]).includes(value);
}

export interface CabinetCapacity {
  rails: { modules: number }[];
  total: number;
}

/** Whole DIN modules per rail; the epsilon absorbs float noise on exact multiples (210 / 17.5). */
export function cabinetModuleCapacity(geometry: { rails: readonly { lengthMm: number }[] }): CabinetCapacity {
  const rails = geometry.rails.map((rail) => ({ modules: Math.floor(rail.lengthMm / DIN_MODULE_MM + 1e-9) }));
  return { rails, total: rails.reduce((sum, rail) => sum + rail.modules, 0) };
}

/** `3×12 = 36` when every rail is equal, `12 + 12 + 8 = 32` otherwise, `6` for a single rail. */
export function cabinetCapacityLabel(capacity: CabinetCapacity): string {
  const modules = capacity.rails.map((rail) => rail.modules);
  if (modules.length <= 1) return String(capacity.total);
  if (modules.every((m) => m === modules[0]))
    return `${String(modules.length)}×${String(modules[0])} = ${String(capacity.total)}`;
  return `${modules.join(" + ")} = ${String(capacity.total)}`;
}

const collator = new Intl.Collator(LOCALE, { numeric: true });

/** Name order shared by every list: Polish collation, digits compared as numbers (B6 before B10). */
export function compareCatalogNames(a: string, b: string): number {
  return collator.compare(a, b);
}

function compareArchived(a: { archived_at: string | null }, b: { archived_at: string | null }): number {
  return Number(a.archived_at !== null) - Number(b.archived_at !== null);
}

/** Missing values sort before present ones. */
function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number(a !== null) - Number(b !== null);
  return a - b;
}

/** Position in a closed list; missing values first, unknown values last. */
function compareByOrder(order: readonly string[], a: string | null, b: string | null): number {
  const rank = (value: string | null) => {
    if (value === null) return -1;
    const index = order.indexOf(value);
    return index === -1 ? order.length : index;
  };
  return rank(a) - rank(b);
}

export interface CatalogDevice {
  name: string;
  model: string;
  manufacturer: string;
  archived_at: string | null;
  rated_current_a: number | null;
  poles: string | null;
  residual_current_ma: number | null;
  rcd_type: string | null;
  breaking_capacity_ka: number | null;
  width_mm: number;
}

/**
 * Parameters before manufacturer, so the same device from two manufacturers sits side by side:
 * archived last, then In, poles, IΔn, RCD type, breaking capacity, width, manufacturer, name.
 */
export function compareDevicesForCatalog(a: CatalogDevice, b: CatalogDevice): number {
  return (
    compareArchived(a, b) ||
    compareNullableNumber(a.rated_current_a, b.rated_current_a) ||
    compareByOrder(POLE_CONFIGS, a.poles, b.poles) ||
    compareNullableNumber(a.residual_current_ma, b.residual_current_ma) ||
    compareByOrder(RCD_TYPES, a.rcd_type, b.rcd_type) ||
    compareNullableNumber(a.breaking_capacity_ka, b.breaking_capacity_ka) ||
    a.width_mm - b.width_mm ||
    compareCatalogNames(a.manufacturer, b.manufacturer) ||
    compareCatalogNames(a.name, b.name)
  );
}

export interface CatalogCabinet {
  name: string;
  model: string;
  manufacturer: string;
  archived_at: string | null;
  mounting: CatalogMounting | null;
  /** `cabinetModuleCapacity(geometry).total`. */
  totalModules: number;
}

/** Archived last, then capacity ascending, then name. */
export function compareCabinetsForCatalog(a: CatalogCabinet, b: CatalogCabinet): number {
  return compareArchived(a, b) || a.totalModules - b.totalModules || compareCatalogNames(a.name, b.name);
}

/** Lower case without diacritics — `ł` has no decomposition, so it is mapped by hand. */
export function normalizeSearchText(text: string): string {
  return text.toLocaleLowerCase(LOCALE).normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").trim();
}

function matchesQuery(query: string, item: { name: string; model: string }): boolean {
  const needle = normalizeSearchText(query);
  if (needle === "") return true;
  return normalizeSearchText(item.name).includes(needle) || normalizeSearchText(item.model).includes(needle);
}

/** `null` in a filter field means "all". */
export interface DeviceFilter {
  query: string;
  manufacturer: string | null;
  poles: string | null;
  ratedCurrentA: number | null;
  showArchived: boolean;
}

export const EMPTY_DEVICE_FILTER: DeviceFilter = {
  query: "",
  manufacturer: null,
  poles: null,
  ratedCurrentA: null,
  showArchived: false,
};

export function matchesDeviceFilter(device: CatalogDevice, filter: DeviceFilter): boolean {
  return (
    (filter.showArchived || device.archived_at === null) &&
    (filter.manufacturer === null || device.manufacturer === filter.manufacturer) &&
    (filter.poles === null || device.poles === filter.poles) &&
    (filter.ratedCurrentA === null || device.rated_current_a === filter.ratedCurrentA) &&
    matchesQuery(filter.query, device)
  );
}

/** `null` in a filter field means "all". */
export interface CabinetFilter {
  query: string;
  mounting: CatalogMounting | null;
  minModules: number | null;
  showArchived: boolean;
}

export const EMPTY_CABINET_FILTER: CabinetFilter = { query: "", mounting: null, minModules: null, showArchived: false };

/** `minModules` is total capacity, not a per-rail fit; a cabinet with no mounting matches only "all". */
export function matchesCabinetFilter(cabinet: CatalogCabinet, filter: CabinetFilter): boolean {
  return (
    (filter.showArchived || cabinet.archived_at === null) &&
    (filter.mounting === null || cabinet.mounting === filter.mounting) &&
    (filter.minModules === null || cabinet.totalModules >= filter.minModules) &&
    matchesQuery(filter.query, cabinet)
  );
}
