<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Printable Quote Export (S-09)

- **Plan**: context/changes/printable-quote-export/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated gates run in this review: `npm run lint` ✅, `npx astro check` ✅ (0 errors), `npm run test:unit` ✅ (1031), `npm run test:integration` ✅ (168, local stack), `npm run build` ✅.

## Findings

### F1 — Login email printed as the company contact email

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/quote-print.ts:98
- **Detail**: `email: business?.email ?? userEmail`. An electrician who leaves the company email empty on purpose still gets their account email printed on a client-facing document. The plan specified this, so it is a plan flaw. AGENTS.md only documents the fallback for the letterhead _title_.
- **Fix**: Fall back to `userEmail` only for `title` and when `business` is null; keep `email: business?.email ?? null` when a business row exists. Update the letterhead test.
- **Decision**: FIXED — login email only when no business row exists; letterhead tests updated

### F2 — Multi-line address near the limit is refused because of CRLF

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/business-profile.ts:76 (readOptional)
- **Detail**: Browsers submit textarea newlines as `\r\n`, which is two code points, while `maxlength` counts one per newline. So an address of about 295–300 characters passes the browser and is then refused by the server with only a generic `invalid_input`. It also stores `\r` in the database.
- **Fix**: Normalise `\r\n` → `\n` in `readOptional` before trimming and counting, and add a unit test.
- **Decision**: FIXED — CRLF normalised in readOptional; test at the exact limit

### F3 — "Company details missing" notice keys only on company name

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/business-profile.ts:155
- **Detail**: If NIP, address, phone and email are filled but the company name is not, the user still sees "Nie uzupełniono danych firmy". This matches the plan, but the notice wording is misleading.
- **Fix**: Reword `t.quotePrint.notices.businessMissing` so it says the company name is missing.
- **Decision**: FIXED — notice reworded to "Nie podano nazwy firmy …"

### F4 — Sum-invariant throw surfaces as a bare 500 page

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/projects/[id]/print.astro:101
- **Detail**: When `computePrintView` throws (the lines do not sum to `devicesGrosze`), Astro shows its default error page instead of `t.quotePrint.loadFailed`. Throwing is intended, but the user sees a non-Polish page.
- **Fix**: Wrap the call in a try/catch, set `status = 500`, and show `t.quotePrint.loadFailed`.
- **Decision**: FIXED — computePrintView wrapped; a throw renders t.quotePrint.loadFailed with status 500

### F5 — Plan names a DrawingLegend.astro extraction that was not needed

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/printable-quote-export/plan.md (Phase 4 §2)
- **Detail**: The legend was already a shared island, `LayoutLegend.tsx`. `QuoteDocument.astro:196` reuses it, so nothing is duplicated. The plan text is stale. `PrintBlocked.astro`, `PrintNotices.astro` and `projectPrintPath` are benign additions that the plan does not list.
- **Fix**: Add a note to Phase 4 §2 in the plan, saying the legend was reused via `LayoutLegend.tsx`.
- **Decision**: FIXED — addendum in plan Phase 4 §2

### F6 — Page 1 has no guard against spilling onto a third sheet

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/projects/QuoteDocument.astro
- **Detail**: Rows group by device, so a large project (up to 60 circuits, many distinct devices) could push the material table onto a second page. The drawing would then land on page 3. Rows are `break-inside-avoid`, so the document is not broken, only longer than the plan's "exactly 2 pages". Manual check 4.4 used a small project.
- **Fix**: Accept it (correct, just longer), or test once with a large kitchen-sink fixture.
- **Decision**: ACCEPTED — rows never split; a longer document is correct
