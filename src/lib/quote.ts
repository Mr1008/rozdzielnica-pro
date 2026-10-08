import type { MatchViewState, SnapshotRow } from "@/lib/device-matching-server";
import type { PricingProfile } from "@/lib/pricing-profile";

/**
 * The quote (FR-011, FR-013, S-08): material cost, estimated labour time and labour cost, with the
 * electrician's optional time override. The single place S-08's arithmetic and states live, so the
 * project page, the override endpoint and the printed quote (S-09) all read the same numbers. Pure:
 * every input is loaded by the caller, and nothing here is stored except the override minutes.
 *
 * Units are integers end to end — grosze and whole minutes — so no float ever reaches a total. The
 * PRD formula (`## Business Logic`) is applied as written: device count × the profile's average mount
 * time + the profile's fixed overhead = minutes; minutes × hourly rate = labour cost; catalog prices
 * = material cost. The S-07 contract holds: no profile means "not configured" and blocks — never
 * invented defaults. And only a `current` device match is quoted (AGENTS.md, "A stored snapshot is
 * not proof of compliance").
 */

/**
 * The override bounds. They mirror the `projects_labour_override_range` CHECK — change one, change
 * the other: the parser must reject exactly what the database rejects. 59 999 min is 999 h 59 min,
 * the largest value the hours + minutes form can express.
 */
export const MIN_LABOUR_OVERRIDE_MINUTES = 1;
export const MAX_LABOUR_OVERRIDE_HOURS = 999;
export const MAX_LABOUR_OVERRIDE_MINUTES = 59_999;

const MINUTES_PER_HOUR = 60;

/** The minutes field of the override form: 0–59, the rest goes in hours. */
export const MAX_LABOUR_OVERRIDE_MINUTE_PART = MINUTES_PER_HOUR - 1;

/**
 * An hourly rate above 500 zł/h warns as a likely typo (S-07 left the ceiling to S-08; the decision
 * was a warning, not a CHECK). Equality never warns, as in `supply-warnings.ts`.
 */
export const RATE_WARNING_THRESHOLD_GROSZE = 50_000;

export function rateWarning(rateGrosze: number): boolean {
  return rateGrosze > RATE_WARNING_THRESHOLD_GROSZE;
}

/** The PRD's estimate: device count × average mount minutes + fixed project overhead. */
export function estimateLabourMinutes(
  deviceCount: number,
  profile: Pick<PricingProfile, "mount_minutes_per_device" | "project_overhead_minutes">,
): number {
  return deviceCount * profile.mount_minutes_per_device + profile.project_overhead_minutes;
}

/**
 * Minutes × rate per hour, in grosze, rounded half-up — integer arithmetic only: adding 30 before
 * the floor division by 60 is half-up for non-negative integers. Never `minutes / 60 * rate`, whose
 * float intermediate can land a hair below a .5 boundary. Exact for every stored input: 59 999 min ×
 * an int4 rate stays far below 2^53.
 */
export function labourCostGrosze(minutes: number, rateGrosze: number): number {
  return Math.floor((minutes * rateGrosze + MINUTES_PER_HOUR / 2) / MINUTES_PER_HOUR);
}

/** 255 → 4 h 15 min: the form's default values and the displayed duration. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  return { hours: Math.floor(total / MINUTES_PER_HOUR), minutes: total % MINUTES_PER_HOUR };
}

/** The stored override: the electrician's minutes and the estimate they were set against. */
export interface LabourOverride {
  minutes: number;
  baseMinutes: number;
}

export interface QuoteCabinet {
  name: string;
  priceGrosze: number;
}

export interface QuoteInput {
  /** The project's match view; a `MatchView` is one as is. */
  matchView: { state: MatchViewState; snapshot: readonly Pick<SnapshotRow, "price_grosze">[] };
  /** The project's cabinet snapshot (`cabinet_name`, `cabinet_price_grosze`). */
  cabinet: QuoteCabinet;
  /** The electrician's `pricing_profiles` row, or null when none is configured. */
  profile: PricingProfile | null;
  override: LabourOverride | null;
}

export interface ReadyQuote {
  state: "ready";
  /** Every snapshot row, catalog PE/N bars included — each is mounted and priced. */
  deviceCount: number;
  devicesGrosze: number;
  cabinet: QuoteCabinet;
  materialGrosze: number;
  /** The estimate's two profile inputs, so a printout can show the formula from the view alone. */
  mountMinutesPerDevice: number;
  overheadMinutes: number;
  estimateMinutes: number;
  /** `outdated`: the estimate moved since the override was set; the override is still used. */
  override: (LabourOverride & { outdated: boolean }) | null;
  /** The override when one exists (outdated or not), otherwise the estimate. */
  labourMinutes: number;
  rateGrosze: number;
  labourGrosze: number;
  totalGrosze: number;
  rateWarning: boolean;
}

export type QuoteView = { state: "no_profile" } | { state: "not_current" } | ReadyQuote;

export type QuoteViewState = QuoteView["state"];

/**
 * The quote, or why there is none. A missing profile is checked first: it blocks even when the match
 * is also not current, so the electrician is sent to fix it rather than told only half the story.
 * The cabinet is always its own material line; a catalog bar exists only when the cabinet lacks that
 * built-in bar, so cabinet + snapshot never double-counts. "Outdated" is compared on every render,
 * never stored, so a profile change — which no trigger on `projects` can see — is caught too.
 */
export function computeQuoteView(input: QuoteInput): QuoteView {
  const { matchView, cabinet, profile, override } = input;
  if (profile === null) return { state: "no_profile" };
  if (matchView.state !== "current") return { state: "not_current" };

  const deviceCount = matchView.snapshot.length;
  const devicesGrosze = matchView.snapshot.reduce((sum, row) => sum + row.price_grosze, 0);
  const materialGrosze = cabinet.priceGrosze + devicesGrosze;
  const estimateMinutes = estimateLabourMinutes(deviceCount, profile);
  const labourMinutes = override === null ? estimateMinutes : override.minutes;
  const rateGrosze = profile.hourly_rate_grosze;
  const labourGrosze = labourCostGrosze(labourMinutes, rateGrosze);

  return {
    state: "ready",
    deviceCount,
    devicesGrosze,
    cabinet: { name: cabinet.name, priceGrosze: cabinet.priceGrosze },
    materialGrosze,
    mountMinutesPerDevice: profile.mount_minutes_per_device,
    overheadMinutes: profile.project_overhead_minutes,
    estimateMinutes,
    override:
      override === null
        ? null
        : {
            minutes: override.minutes,
            baseMinutes: override.baseMinutes,
            outdated: override.baseMinutes !== estimateMinutes,
          },
    labourMinutes,
    rateGrosze,
    labourGrosze,
    totalGrosze: materialGrosze + labourGrosze,
    rateWarning: rateWarning(rateGrosze),
  };
}

/** The override form's field names, shared by the section's inputs and the parser. */
export const QUOTE_FIELDS = {
  intent: "intent",
  hours: "labour_hours",
  minutes: "labour_minutes",
} as const;

/** `intent=set` stores the typed time; `intent=clear` restores the estimate. */
export type LabourOverrideFormResult =
  { ok: true; intent: "set"; minutes: number } | { ok: true; intent: "clear" } | { ok: false; code: "invalid_input" };

/**
 * Whole numbers: digits, optionally with a zero fraction (`4.0`) because a `type="number"` input
 * submits that as typed. No sign, no comma, no exponent and no real fraction — `Number()` would
 * accept all of them. The same rule as `pricing-profile.ts`, kept local so that module's public
 * surface does not grow.
 */
const WHOLE_NUMBER = /^\d+(?:\.0+)?$/;

function readText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

function parseWhole(raw: string | null, max: number): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value > max) return null;
  return value;
}

/**
 * The override form to an action, or `invalid_input`. Hours 0–999 and minutes 0–59, together at
 * least 1 minute; `clear` ignores both fields, so a stale override can always be cleared. Never
 * throws. A single code is enough: the inputs' native constraints stop almost every bad value, so a
 * server rejection means a tampered or scripted POST.
 */
export function parseLabourOverrideForm(form: FormData): LabourOverrideFormResult {
  const intent = readText(form, QUOTE_FIELDS.intent);
  if (intent === "clear") return { ok: true, intent: "clear" };
  if (intent !== "set") return { ok: false, code: "invalid_input" };

  const hours = parseWhole(readText(form, QUOTE_FIELDS.hours), MAX_LABOUR_OVERRIDE_HOURS);
  const minutes = parseWhole(readText(form, QUOTE_FIELDS.minutes), MAX_LABOUR_OVERRIDE_MINUTE_PART);
  if (hours === null || minutes === null) return { ok: false, code: "invalid_input" };

  const total = hours * MINUTES_PER_HOUR + minutes;
  if (total < MIN_LABOUR_OVERRIDE_MINUTES || total > MAX_LABOUR_OVERRIDE_MINUTES) {
    return { ok: false, code: "invalid_input" };
  }
  return { ok: true, intent: "set", minutes: total };
}
