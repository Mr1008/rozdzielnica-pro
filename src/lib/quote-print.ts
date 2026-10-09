import { hasCompanyDetails, type BusinessProfile } from "@/lib/business-profile";
import type { SnapshotRow } from "@/lib/device-matching-server";
import type { DeviceKind } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import type { LayoutView } from "@/lib/layout-server";
import { splitMinutes, type QuoteView, type ReadyQuote } from "@/lib/quote";

/**
 * The printed quote's view model (FR-012, S-09). The print page reads only `computePrintView`: it
 * renders and never decides. Money comes from `computeQuoteView`'s `ReadyQuote` and is never
 * re-derived — the material lines only itemise `devicesGrosze`, and throw when they do not add up
 * to it (a bug here must never print a wrong number). A quote prints only for a current match, a
 * `placed` layout and a configured pricing profile.
 */

export type PrintBlockReason = "no_profile" | "match_not_current" | "layout_not_placed";

export interface MaterialLine {
  deviceId: string;
  kind: DeviceKind;
  name: string;
  manufacturer: string;
  model: string;
  quantity: number;
  unitGrosze: number;
  totalGrosze: number;
}

export interface Letterhead {
  title: string | null;
  nip: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export type PrintNotice =
  { code: "override_outdated"; estimateMinutes: number } | { code: "business_missing" } | { code: "rate_warning" };

export type PrintView =
  | { state: "blocked"; reasons: PrintBlockReason[] }
  | { state: "ready"; quote: ReadyQuote; lines: MaterialLine[]; letterhead: Letterhead; notices: PrintNotice[] };

export interface PrintInput {
  quote: QuoteView;
  /** `computeMatchView(...).state === "current"`; `computeQuoteView` hides a non-current match behind `no_profile`. */
  matchCurrent: boolean;
  layout: LayoutView | null;
  snapshot: readonly SnapshotRow[];
  business: BusinessProfile | null;
  fullName: string | null;
  userEmail: string | null;
}

/** Trimmed text, with empty or whitespace-only input treated as absent. */
function presentText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The snapshot grouped by `(device_id, price_grosze)` in order of the first `position`. The price is
 * part of the key because the snapshot copies the catalog price at save time: one device can sit in
 * the snapshot at two prices, and each is its own line.
 */
function materialLines(snapshot: readonly SnapshotRow[]): MaterialLine[] {
  const lines = new Map<string, MaterialLine>();
  for (const row of [...snapshot].sort((a, b) => a.position - b.position)) {
    const key = `${row.device_id}|${String(row.price_grosze)}`;
    const line = lines.get(key);
    if (line === undefined) {
      lines.set(key, {
        deviceId: row.device_id,
        kind: row.kind,
        name: row.name,
        manufacturer: row.manufacturer,
        model: row.model,
        quantity: 1,
        unitGrosze: row.price_grosze,
        totalGrosze: row.price_grosze,
      });
    } else {
      line.quantity += 1;
      line.totalGrosze = line.quantity * line.unitGrosze;
    }
  }
  return [...lines.values()];
}

function letterhead(input: Pick<PrintInput, "business" | "fullName" | "userEmail">): Letterhead {
  const { business } = input;
  const userEmail = presentText(input.userEmail);
  return {
    title: presentText(business?.company_name) ?? presentText(input.fullName) ?? userEmail,
    nip: business?.nip ?? null,
    address: business?.address ?? null,
    phone: business?.phone ?? null,
    // The login email stands in only when no company details are stored at all; an electrician who
    // saved company details without an email chose not to print one.
    email: business === null ? userEmail : business.email,
  };
}

/**
 * The verdict for the print page. Reasons are collected in a fixed order, never twice: no profile,
 * then a non-current match, then a layout that is not `placed` — the last only for a current match,
 * since a non-current match makes the layout moot. Nothing prints while any reason stands.
 */
export function computePrintView(input: PrintInput): PrintView {
  const { quote, layout } = input;
  const reasons: PrintBlockReason[] = [];
  if (quote.state === "no_profile") reasons.push("no_profile");
  if (!input.matchCurrent || quote.state === "not_current") reasons.push("match_not_current");
  if (input.matchCurrent && quote.state !== "not_current" && layout?.state !== "placed") {
    reasons.push("layout_not_placed");
  }
  if (reasons.length > 0 || quote.state !== "ready") return { state: "blocked", reasons };

  const lines = materialLines(input.snapshot);
  const itemised = lines.reduce((sum, line) => sum + line.totalGrosze, 0);
  if (itemised !== quote.devicesGrosze) {
    throw new Error(
      `print view: material lines sum to ${String(itemised)} gr, the quote's devices to ${String(quote.devicesGrosze)} gr`,
    );
  }

  const notices: PrintNotice[] = [];
  if (quote.override?.outdated === true) {
    notices.push({ code: "override_outdated", estimateMinutes: quote.estimateMinutes });
  }
  if (!hasCompanyDetails(input.business)) notices.push({ code: "business_missing" });
  if (quote.rateWarning) notices.push({ code: "rate_warning" });

  return { state: "ready", quote, lines, letterhead: letterhead(input), notices };
}

/** Polish text for a notice. The `Record` keeps it exhaustive over the notice codes. */
export function printNoticeMessage(notice: PrintNotice): string {
  const m = t.quotePrint.notices;
  const messages: Record<PrintNotice["code"], () => string> = {
    override_outdated: () => {
      const estimate = notice.code === "override_outdated" ? notice.estimateMinutes : 0;
      const { hours, minutes } = splitMinutes(estimate);
      return m.overrideOutdated(t.quote.duration(hours, minutes));
    },
    business_missing: () => m.businessMissing,
    rate_warning: () => m.rateWarning,
  };
  return messages[notice.code]();
}

/** Polish text for a block reason. */
export function printBlockMessage(reason: PrintBlockReason): string {
  const messages: Record<PrintBlockReason, string> = {
    no_profile: t.quotePrint.blocked.noProfile,
    match_not_current: t.quotePrint.blocked.matchNotCurrent,
    layout_not_placed: t.quotePrint.blocked.layoutNotPlaced,
  };
  return messages[reason];
}

/** The link label that sends the electrician to fix a block reason. */
export function printBlockLinkLabel(reason: PrintBlockReason): string {
  const messages: Record<PrintBlockReason, string> = {
    no_profile: t.quotePrint.blocked.noProfileLink,
    match_not_current: t.quotePrint.blocked.matchNotCurrentLink,
    layout_not_placed: t.quotePrint.blocked.layoutNotPlacedLink,
  };
  return messages[reason];
}
