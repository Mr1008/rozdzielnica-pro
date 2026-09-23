import { z } from "zod";
import type { CabinetRow } from "@/lib/cabinet-form";
import { formatPriceInput } from "@/lib/price-input";
import { BAR_KINDS, BAR_ORIENTATIONS, ENTRY_SIDES, type CabinetGeometry } from "@/lib/cabinet-geometry";

/**
 * The cabinet editor's state. Every number is kept as the string the admin typed, so a half-typed
 * or emptied field never snaps to 0; `geometryFromDraft` derives the candidate document that
 * `parseCabinetGeometry` judges and the preview draws. Nothing here validates — that stays in
 * `parseCabinetGeometry`, the one validator every geometry write goes through.
 */

let nextKey = 0;

/**
 * A client-side identity for a rail, entry, bar or terminal group, used as its React `key` so a
 * removal does not hand one element's DOM node (and focus) to the next. Never part of the geometry.
 */
export function newDraftKey(): string {
  nextKey += 1;
  return `d${String(nextKey)}`;
}

const field = z.string();

/**
 * Every restored element is re-keyed: the counter restarts on each page load, so a stored key could
 * collide with one minted later, and a draft stored before keys existed has none.
 */
const key = z
  .string()
  .optional()
  .transform(() => newDraftKey());

const railDraftSchema = z.object({ key, xMm: field, yMm: field, lengthMm: field });
const entryDraftSchema = z.object({ key, side: z.enum(ENTRY_SIDES), offsetMm: field, lengthMm: field });
const terminalGroupDraftSchema = z.object({ key, count: field, minMm2: field, maxMm2: field });
const barDraftSchema = z.object({
  key,
  kind: z.enum(BAR_KINDS),
  orientation: z.enum(BAR_ORIENTATIONS),
  xMm: field,
  yMm: field,
  lengthMm: field,
  heightMm: field,
  zMm: field,
  terminalGroups: z.array(terminalGroupDraftSchema),
});

const geometryDraftSchema = z.object({
  interior: z.object({ widthMm: field, heightMm: field, depthMm: field }),
  rails: z.array(railDraftSchema),
  entries: z.array(entryDraftSchema),
  bars: z.array(barDraftSchema),
});

/** Also the shape a draft stored in `sessionStorage` must have to be restored. */
export const cabinetDraftSchema = z.object({
  name: field,
  manufacturer: field,
  model: field,
  price: field,
  geometry: geometryDraftSchema,
});

export type CabinetDraft = z.infer<typeof cabinetDraftSchema>;
export type GeometryDraft = CabinetDraft["geometry"];
export type RailDraft = GeometryDraft["rails"][number];
export type EntryDraft = GeometryDraft["entries"][number];
export type BarDraft = GeometryDraft["bars"][number];
export type TerminalGroupDraft = BarDraft["terminalGroups"][number];

/** A new cabinet starts valid, so the preview is never empty: one full-width rail, one top entry. */
export const DEFAULT_GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 400, heightMm: 300, depthMm: 100 },
  rails: [{ xMm: 0, yMm: 100, lengthMm: 400 }],
  entries: [{ side: "top", offsetMm: 0, lengthMm: 400 }],
  bars: [],
};

/** Typical spacing between DIN rail rows, used to place an added rail below the last one. */
const RAIL_PITCH_MM = 125;

const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

/**
 * A typed field to a number: `","` and `"."` both mark decimals; anything else — empty, `1e3`,
 * `12 mm` — is `NaN`, which `parseCabinetGeometry` reports as an issue on that element.
 */
export function numberFromField(value: string): number {
  const trimmed = value.trim();
  return PLAIN_NUMBER.test(trimmed) ? Number(trimmed.replace(",", ".")) : Number.NaN;
}

/** Decimals are shown with a comma, like everywhere else in the Polish UI. */
export function fieldFromNumber(value: number): string {
  return String(value).replace(".", ",");
}

/** The candidate document. Its numbers may be `NaN`; judge it with `parseCabinetGeometry`. */
export function geometryFromDraft(draft: GeometryDraft): CabinetGeometry {
  const n = numberFromField;
  return {
    version: 1,
    interior: {
      widthMm: n(draft.interior.widthMm),
      heightMm: n(draft.interior.heightMm),
      depthMm: n(draft.interior.depthMm),
    },
    rails: draft.rails.map((rail) => ({ xMm: n(rail.xMm), yMm: n(rail.yMm), lengthMm: n(rail.lengthMm) })),
    entries: draft.entries.map((entry) => ({
      side: entry.side,
      offsetMm: n(entry.offsetMm),
      lengthMm: n(entry.lengthMm),
    })),
    bars: draft.bars.map((bar) => ({
      kind: bar.kind,
      orientation: bar.orientation,
      xMm: n(bar.xMm),
      yMm: n(bar.yMm),
      lengthMm: n(bar.lengthMm),
      heightMm: n(bar.heightMm),
      zMm: n(bar.zMm),
      terminalGroups: bar.terminalGroups.map((group) => ({
        count: n(group.count),
        minMm2: n(group.minMm2),
        maxMm2: n(group.maxMm2),
      })),
    })),
  };
}

const finite = (...values: number[]) => values.every(Number.isFinite);
const positive = (...values: number[]) => values.every((value) => Number.isFinite(value) && value > 0);

/**
 * Whether the SVG can render this candidate at all — every coordinate a number, every size positive.
 * Looser than `parseCabinetGeometry` on purpose: an overlapping or out-of-bounds element is exactly
 * what the preview must show.
 */
export function isDrawable(geometry: CabinetGeometry): boolean {
  const { interior, rails, entries, bars } = geometry;
  return (
    positive(interior.widthMm, interior.heightMm, interior.depthMm) &&
    rails.every((rail) => finite(rail.xMm, rail.yMm) && positive(rail.lengthMm)) &&
    entries.every((entry) => finite(entry.offsetMm) && positive(entry.lengthMm)) &&
    bars.every((bar) => finite(bar.xMm, bar.yMm, bar.zMm) && positive(bar.lengthMm, bar.heightMm))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function numberField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? fieldFromNumber(value) : "";
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

/**
 * Stored geometry to editable fields. Tolerant, because a stored row may not parse — the list sends
 * the admin here to fix it — so a missing or wrong-typed value becomes an empty field the editor
 * then flags, instead of the page failing.
 */
export function draftFromGeometry(input: unknown): GeometryDraft {
  const doc = isRecord(input) ? input : {};
  const interior = isRecord(doc.interior) ? doc.interior : {};
  return {
    interior: {
      widthMm: numberField(interior, "widthMm"),
      heightMm: numberField(interior, "heightMm"),
      depthMm: numberField(interior, "depthMm"),
    },
    rails: records(doc.rails).map((rail) => ({
      key: newDraftKey(),
      xMm: numberField(rail, "xMm"),
      yMm: numberField(rail, "yMm"),
      lengthMm: numberField(rail, "lengthMm"),
    })),
    entries: records(doc.entries).map((entry) => ({
      key: newDraftKey(),
      side: oneOf(ENTRY_SIDES, entry.side, "top"),
      offsetMm: numberField(entry, "offsetMm"),
      lengthMm: numberField(entry, "lengthMm"),
    })),
    bars: records(doc.bars).map((bar) => ({
      key: newDraftKey(),
      kind: oneOf(BAR_KINDS, bar.kind, "PE"),
      orientation: oneOf(BAR_ORIENTATIONS, bar.orientation, "horizontal"),
      xMm: numberField(bar, "xMm"),
      yMm: numberField(bar, "yMm"),
      lengthMm: numberField(bar, "lengthMm"),
      heightMm: numberField(bar, "heightMm"),
      zMm: numberField(bar, "zMm"),
      terminalGroups: records(bar.terminalGroups).map((group) => ({
        key: newDraftKey(),
        count: numberField(group, "count"),
        minMm2: numberField(group, "minMm2"),
        maxMm2: numberField(group, "maxMm2"),
      })),
    })),
  };
}

/** The editor's starting state: the row being edited, or an empty new cabinet. */
export function draftFromRow(row?: CabinetRow): CabinetDraft {
  if (!row) return { name: "", manufacturer: "", model: "", price: "", geometry: draftFromGeometry(DEFAULT_GEOMETRY) };
  return {
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    price: formatPriceInput(row.price_grosze),
    geometry: draftFromGeometry(row.geometry),
  };
}

/** A full-width rail one row pitch below the lowest existing one. */
export function newRailDraft(geometry: GeometryDraft): RailDraft {
  const lowest = Math.max(...geometry.rails.map((rail) => numberFromField(rail.yMm)).filter(Number.isFinite), -1);
  return {
    key: newDraftKey(),
    xMm: "0",
    yMm: String(lowest < 0 ? 0 : lowest + RAIL_PITCH_MM),
    lengthMm: geometry.interior.widthMm,
  };
}

export function newEntryDraft(geometry: GeometryDraft): EntryDraft {
  return { key: newDraftKey(), side: "bottom", offsetMm: "0", lengthMm: geometry.interior.widthMm };
}

export function newTerminalGroupDraft(): TerminalGroupDraft {
  return { key: newDraftKey(), count: "8", minMm2: "1,5", maxMm2: "16" };
}

export function newBarDraft(): BarDraft {
  return {
    key: newDraftKey(),
    kind: "PE",
    orientation: "horizontal",
    xMm: "0",
    yMm: "0",
    lengthMm: "100",
    heightMm: "15",
    zMm: "20",
    terminalGroups: [newTerminalGroupDraft()],
  };
}
