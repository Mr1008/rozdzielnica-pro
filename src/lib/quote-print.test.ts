import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "./business-profile";
import type { SnapshotRow } from "./device-matching-server";
import { kitchenSinkMatchStates, kitchenSinkQuoteStates } from "./kitchen-sink-circuits";
import type { LayoutView } from "./layout-server";
import type { PricingProfile } from "./pricing-profile";
import {
  computePrintView,
  printBlockLinkLabel,
  printBlockMessage,
  printNoticeMessage,
  type PrintBlockReason,
  type PrintInput,
  type PrintNotice,
} from "./quote-print";
import { computeQuoteView, type LabourOverride } from "./quote";

const PROFILE: PricingProfile = {
  hourly_rate_grosze: 12_050,
  mount_minutes_per_device: 15,
  project_overhead_minutes: 90,
};
const CABINET = { name: "Szafka testowa", priceGrosze: 24_999 };

function row(position: number, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: `row-${String(position)}`,
    project_id: "project",
    created_at: "2026-10-08T10:00:00Z",
    position,
    device_id: "mcb-b16",
    role: "mcb",
    rcd_group_id: null,
    circuit_id: null,
    notes: [],
    busbar_piece: null,
    kind: "mcb_b",
    name: "MCB B16",
    manufacturer: "Producent",
    model: "M-16",
    price_grosze: 1_000,
    width_mm: 17.5,
    height_mm: 90,
    depth_mm: 60,
    poles: "1P",
    rated_current_a: 16,
    residual_current_ma: null,
    rcd_type: null,
    breaking_capacity_ka: 6,
    n_terminal_side: null,
    terminal_groups: null,
    ...overrides,
  };
}

const PLACED: LayoutView = { state: "placed", placements: [], editedManually: false };
const BUSINESS: BusinessProfile = {
  company_name: "Elektro Test",
  nip: "5260250274",
  address: "ul. Prosta 1, Warszawa",
  phone: "+48 600 100 200",
  email: "biuro@elektro.test",
};

function quoteFor(
  rows: readonly SnapshotRow[],
  opts: { profile?: PricingProfile | null; override?: LabourOverride | null; current?: boolean } = {},
) {
  return computeQuoteView({
    matchView: { state: opts.current === false ? "stale" : "current", snapshot: rows },
    cabinet: CABINET,
    profile: opts.profile === undefined ? PROFILE : opts.profile,
    override: opts.override ?? null,
  });
}

const ROWS = [row(0), row(1)];

function input(overrides: Partial<PrintInput> = {}): PrintInput {
  return {
    quote: quoteFor(ROWS),
    matchCurrent: true,
    layout: PLACED,
    snapshot: ROWS,
    business: BUSINESS,
    fullName: "Jan Kowalski",
    userEmail: "jan@example.com",
    ...overrides,
  };
}

function reasons(view: ReturnType<typeof computePrintView>): PrintBlockReason[] {
  if (view.state !== "blocked") throw new Error("expected a blocked view");
  return view.reasons;
}

describe("computePrintView gates", () => {
  it("blocks without a pricing profile", () => {
    expect(reasons(computePrintView(input({ quote: quoteFor(ROWS, { profile: null }) })))).toEqual(["no_profile"]);
  });

  it("blocks a non-current match", () => {
    const view = computePrintView(input({ quote: quoteFor(ROWS, { current: false }), matchCurrent: false }));
    expect(reasons(view)).toEqual(["match_not_current"]);
  });

  it("blocks a layout that is not placed, or missing", () => {
    expect(reasons(computePrintView(input({ layout: null })))).toEqual(["layout_not_placed"]);
    const missing: LayoutView = { state: "missing", proposal: [] };
    expect(reasons(computePrintView(input({ layout: missing })))).toEqual(["layout_not_placed"]);
  });

  it("reports no profile and a non-current match together, in order", () => {
    const view = computePrintView(input({ quote: { state: "no_profile" }, matchCurrent: false }));
    expect(reasons(view)).toEqual(["no_profile", "match_not_current"]);
  });

  it("never adds layout_not_placed for a non-current match", () => {
    const view = computePrintView(input({ matchCurrent: false, layout: null, quote: { state: "no_profile" } }));
    expect(reasons(view)).not.toContain("layout_not_placed");
  });

  it("records match_not_current for a not_current quote with a current match, and no layout reason", () => {
    const view = computePrintView(input({ quote: { state: "not_current" }, matchCurrent: true, layout: null }));
    expect(reasons(view)).toEqual(["match_not_current"]);
  });

  it("is ready for a ready quote, a current match and a placed layout", () => {
    expect(computePrintView(input()).state).toBe("ready");
  });
});

describe("material lines", () => {
  function linesOf(rows: SnapshotRow[]) {
    const view = computePrintView(input({ quote: quoteFor(rows), snapshot: rows }));
    if (view.state !== "ready") throw new Error("expected ready");
    return view.lines;
  }

  it("collapses identical devices into one line with a quantity", () => {
    expect(linesOf([row(0), row(1)])).toEqual([
      expect.objectContaining({ deviceId: "mcb-b16", quantity: 2, unitGrosze: 1_000, totalGrosze: 2_000 }),
    ]);
  });

  it("keeps the same device at two prices as two lines, in order of first position", () => {
    const lines = linesOf([row(0), row(1, { price_grosze: 1_200 }), row(2)]);
    expect(lines.map((line) => [line.unitGrosze, line.quantity, line.totalGrosze])).toEqual([
      [1_000, 2, 2_000],
      [1_200, 1, 1_200],
    ]);
  });

  it("orders lines by position, not by array order", () => {
    const lines = linesOf([row(2, { device_id: "b", name: "B" }), row(0, { device_id: "a", name: "A" })]);
    expect(lines.map((line) => line.deviceId)).toEqual(["a", "b"]);
  });

  it("itemises a busbar by pieces, not segments, and names its pins; the lines still sum to devicesGrosze", () => {
    const busbar = (position: number, piece: number): SnapshotRow =>
      row(position, {
        device_id: "busbar-1f",
        role: "busbar",
        kind: "comb_busbar",
        poles: "1P",
        width_mm: 210,
        price_grosze: 5_000,
        busbar_piece: piece,
      });
    const rows = [row(0), busbar(1, 0), busbar(2, 0), busbar(3, 1)];
    const view = computePrintView(input({ quote: quoteFor(rows), snapshot: rows }));
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.lines).toEqual([
      expect.objectContaining({ deviceId: "mcb-b16", quantity: 1, pins: null }),
      expect.objectContaining({ deviceId: "busbar-1f", quantity: 2, pins: 12, unitGrosze: 5_000, totalGrosze: 10_000 }),
    ]);
    expect(view.quote.devicesGrosze).toBe(11_000);
  });

  it("itemises catalog PE/N bars", () => {
    const lines = linesOf([
      row(0),
      row(1, { device_id: "pe", role: "pe_bar", kind: "pe_bar", name: "Szyna PE", price_grosze: 3_000 }),
      row(2, { device_id: "n", role: "n_bar", kind: "n_bar", name: "Szyna N", price_grosze: 2_500 }),
    ]);
    expect(lines.map((line) => line.kind)).toEqual(["mcb_b", "pe_bar", "n_bar"]);
  });

  it("sums to devicesGrosze on the kitchen-sink fixtures", () => {
    const matched = kitchenSinkMatchStates().find((fixture) => fixture.key === "matched");
    if (matched === undefined) throw new Error("fixture missing");
    const rows = matched.view.snapshot;
    const view = computePrintView(input({ quote: quoteFor(rows), snapshot: rows }));
    if (view.state !== "ready") throw new Error("expected ready");
    expect(view.lines.reduce((sum, line) => sum + line.totalGrosze, 0)).toBe(view.quote.devicesGrosze);
    expect(view.lines.reduce((sum, line) => sum + line.quantity, 0)).toBe(rows.length);

    const ready = kitchenSinkQuoteStates().find((fixture) => fixture.key === "ready");
    expect(ready?.view.state === "ready" ? ready.view.devicesGrosze : null).toBe(view.quote.devicesGrosze);
  });

  it("throws when the quote's devices total does not match the snapshot", () => {
    const quote = quoteFor(ROWS);
    if (quote.state !== "ready") throw new Error("expected ready");
    expect(() => computePrintView(input({ quote: { ...quote, devicesGrosze: quote.devicesGrosze + 1 } }))).toThrow(
      Error,
    );
  });
});

describe("letterhead", () => {
  function head(overrides: Partial<PrintInput>) {
    const view = computePrintView(input(overrides));
    if (view.state !== "ready") throw new Error("expected ready");
    return view.letterhead;
  }

  it("uses the company details when set", () => {
    expect(head({})).toEqual({
      title: "Elektro Test",
      nip: "5260250274",
      address: "ul. Prosta 1, Warszawa",
      phone: "+48 600 100 200",
      email: "biuro@elektro.test",
    });
  });

  it("falls back from company name to full name to email to null", () => {
    const noName = { ...BUSINESS, company_name: null, email: null };
    expect(head({ business: noName })).toMatchObject({ title: "Jan Kowalski", email: null });
    expect(head({ business: noName, fullName: null }).title).toBe("jan@example.com");
    expect(head({ business: null, fullName: null, userEmail: null })).toEqual({
      title: null,
      nip: null,
      address: null,
      phone: null,
      email: null,
    });
  });

  it("prints the login email only when no company details are stored", () => {
    expect(head({ business: null }).email).toBe("jan@example.com");
    expect(head({ business: { ...BUSINESS, email: null } }).email).toBeNull();
  });

  it("treats empty and whitespace-only names as absent", () => {
    expect(head({ business: null, fullName: "   " }).title).toBe("jan@example.com");
    expect(head({ business: null, fullName: "", userEmail: "  " })).toMatchObject({ title: null, email: null });
  });
});

describe("notices", () => {
  function noticesOf(overrides: Partial<PrintInput>): PrintNotice[] {
    const view = computePrintView(input(overrides));
    if (view.state !== "ready") throw new Error("expected ready");
    return view.notices;
  }

  it("has none for a complete, ordinary quote", () => {
    expect(noticesOf({})).toEqual([]);
  });

  it("flags missing company details", () => {
    expect(noticesOf({ business: null })).toEqual([{ code: "business_missing" }]);
  });

  it("flags an outdated override with the current estimate", () => {
    const quote = quoteFor(ROWS, { override: { minutes: 200, baseMinutes: 1 } });
    // 2 devices × 15 min + 90 min = 120 min
    expect(noticesOf({ quote })).toEqual([{ code: "override_outdated", estimateMinutes: 120 }]);
  });

  it("does not flag an override set against the current estimate", () => {
    const quote = quoteFor(ROWS, { override: { minutes: 200, baseMinutes: 120 } });
    expect(noticesOf({ quote })).toEqual([]);
  });

  it("orders override, company, rate", () => {
    const quote = quoteFor(ROWS, {
      profile: { ...PROFILE, hourly_rate_grosze: 60_000 },
      override: { minutes: 200, baseMinutes: 1 },
    });
    expect(noticesOf({ quote, business: null }).map((notice) => notice.code)).toEqual([
      "override_outdated",
      "business_missing",
      "rate_warning",
    ]);
  });
});

describe("messages", () => {
  it("has Polish text for every reason and notice", () => {
    for (const reason of ["no_profile", "match_not_current", "layout_not_placed"] as const) {
      expect(printBlockMessage(reason)).not.toBe("");
      expect(printBlockLinkLabel(reason)).not.toBe("");
    }
    expect(printNoticeMessage({ code: "override_outdated", estimateMinutes: 135 })).toContain("2 h 15 min");
    expect(printNoticeMessage({ code: "business_missing" })).not.toBe("");
    expect(printNoticeMessage({ code: "rate_warning" })).not.toBe("");
  });
});
