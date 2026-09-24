<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin Device Catalog Implementation Plan

- **Plan**: context/changes/admin-device-catalog/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Verification re-run for this review: `npm run test:unit` (19 files, 229 tests) PASS · `npm run lint` PASS · `npx astro check` (0 errors, 0 warnings, 5 hints) PASS · `npm run build` PASS · `npx supabase db reset` PASS · `npm run db:types` left no diff (PASS) · `npm run test:integration` (3 files, 54 tests) PASS · `npm run smoke` against `astro preview` on :4321 (15/15 steps) PASS.

Extra files not named in the plan (`device-summary.ts`, `device-draft.ts`, `draft-fields.ts`, `draft-storage.test.ts`) only split the planned work into smaller modules. They mirror the cabinet siblings and add no new surface, so they are not scope creep.

## Findings

### F1 — Numeric fields have no upper bound in TS, so the database refuses values the island shows as valid

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-spec.ts:122-130
- **Detail**: Only the price is capped (`MAX_PRICE_GROSZE`). `width_mm` (numeric(6,2), max 9999.99), `height_mm`/`depth_mm` (numeric(6,1), max 99999.9), `breaking_capacity_ka` (numeric(4,1), max 999.9) and the int4 currents have no maximum in `oneDecimalSchema` / `widthSchema` / `currentSchema`. An out-of-range value passes the island and `parseDeviceForm`, then PostgREST fails with 22003. `deviceErrorFromPostgrest` passes that code through, so the admin sees the generic "Coś poszło nie tak" with no field marked. One plausible way to hit it: type "1750" with the width unit still on modules, which gives 30 625 mm. The row is refused, not corrupted. But this breaks the stated contract in the device-spec header and the AGENTS.md tripwire that the island, the server and the CHECK reject the same inputs.
- **Fix A ⭐ Recommended**: Add per-column max constants next to `WIDTH_DECIMAL_PLACES`, plus a `too_large` issue code with a Polish `deviceIssues` message, and apply them in both the zod schemas and the `check*` functions
  - Strength: Restores the "same rejections in every layer" contract and gives an inline Polish message on the field itself.
  - Tradeoff: One new issue code, one i18n key and a few tests. The limits also need a comment tying them to the column precisions.
  - Confidence: HIGH — the price cap is already this exact pattern.
  - Blind spot: Realistic ceilings (for example a sane maximum width in modules) are a product choice that has not been discussed.
- **Fix B**: Map 22003 to `invalid_input` in `deviceErrorFromPostgrest` only
  - Strength: One-line change, and the message becomes specific.
  - Tradeoff: The island still shows the value as valid, and no field is marked.
  - Confidence: MED — it narrows the symptom but not the layer mismatch.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — MAX_WIDTH_MM / MAX_DIMENSION_MM / MAX_BREAKING_CAPACITY_KA / MAX_INTEGER at the column limits, new too_large code + t.deviceIssues.tooLarge, in zod and the check functions; boundary tests added

### F2 — Seeded FR rows are still called fuse switch-disconnectors

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/seed.sql:124, 152-154
- **Detail**: The seed comment says "fuse switch-disconnectors", and the three `switch_disconnector` rows are named "Rozłącznik bezpiecznikowy …". This change itself established that FR is a plain switch-disconnector with no fuse links. Phase 4 reworded AGENTS.md, the PRD and `t.devices.kinds.switchDisconnector` ("Rozłącznik izolacyjny (FR)") to match. The seeded names are visible in the admin list and will be what S-04 developers see.
- **Fix**: Rename the comment and the three row names to "Rozłącznik izolacyjny …". The `on conflict` key is manufacturer + model, so this affects only fresh seeds.
- **Decision**: FIXED — seed comment and the three FR rows renamed to "Rozłącznik izolacyjny …" (supabase/seed.sql:124, 152-154)

### F3 — Kind immutability rests only on the app never sending `kind`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260923130628_devices_catalog.sql:155; src/lib/device-form.ts:138-149
- **Detail**: The plan says a device's kind is locked after creation. Only the app layer enforces that: `parseDeviceForm` strips `kind` from the update payload (device-form.ts:148). `grant update` covers every column, so an admin JWT sent straight to PostgREST can PATCH `kind`. For `pe_bar` ↔ `n_bar` the per-kind CHECK even allows the swap, because the two kinds share one parameter set. Also, contrary to the plan's wording "kind is ignored on update", the posted `kind` still decides which parameter fields are read on update, and the endpoint never loads the stored kind. This is safe today: a mismatched set is refused with 23514 and `kind` is never written. It matters from S-04 on, when projects reference or snapshot devices by kind.
- **Fix A ⭐ Recommended**: Leave the code as it is, and record in `change.md` / the S-04 contract that kind is immutable by application convention only
  - Strength: No code churn. Only admins can reach the gap, and the admin is the catalog owner anyway.
  - Tradeoff: The guarantee stays a convention, and it is not greppable in the schema.
  - Confidence: MED — this depends on S-04 snapshotting kind along with the rest of the device, which is already its contract.
  - Blind spot: No check yet on whether any S-04 design would rely on kind being immutable at the DB level.
- **Fix B**: Enforce it in the database with a column-level `grant update (…)` that leaves out `kind`, or with a BEFORE UPDATE trigger raising 42501 when `kind` changes
  - Strength: The rule becomes a schema fact, like the role-change trigger on `profiles`.
  - Tradeoff: It needs a new forward-compatible migration and an integration test, and a column-level grant must be kept in sync whenever a column is added.
  - Confidence: HIGH — this is an established Postgres pattern, and the repo already uses a guard trigger.
  - Blind spot: A column-level grant has not been checked against how the generated types / PostgREST behave.
- **Decision**: FIXED via Fix B — migration 20260924094718_devices_kind_immutable.sql: BEFORE UPDATE trigger refusing any kind change (errcode check_violation / 23514, not 42501, so the endpoints never misreport it as a missing permission); integration test covers pe_bar -> n_bar, the case the per-kind CHECK cannot catch; break-checked

### F4 — Decimal-place check uses a relative tolerance, so very long fractions are rounded, not rejected

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-spec.ts:115-118
- **Detail**: `hasAtMostDecimals` allows `1e-9 × |scaled|`, so inputs such as `1234.5000001` (one place allowed) or `17.50000001` pass, and Postgres then rounds them. Ordinary typos like "17,555" are still rejected. This contradicts the plan's Critical Implementation Detail ("rejected — never rounded") and the AGENTS.md wording, but only for sub-micron amounts.
- **Fix**: Either count decimals on the typed string in `deviceCandidate` / `numberFromField` (for example `/^\d+(?:[.,]\d{1,N})?$/`) and keep the float check for re-parsing stored rows, or accept it as a risk and soften the wording.
- **Decision**: FIXED (differently) — hasAtMostDecimals now requires an exact round-trip (Number(value.toFixed(places)) === value) instead of a relative tolerance, so 17.50000001 is rejected in both the form and a stored row; the old test accepting 0.1*3 was replaced by the real input path (mmFromModules for half modules), since the app never produces float noise

### F5 — Plan text still says 0.1 mm width precision and describes an unreachable pole case

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/admin-device-catalog/plan.md:99, 114, 123, 467
- **Detail**: `change.md` and `plan-brief.md` record the user's `width_mm numeric(6,2)` decision, but the plan's parameter-matrix note (l.99), its S-05 contract (l.114) and its Critical Implementation Detail (l.123) still say "0.1 precision" / `numeric(…,1)`. Manual check 4.7 asks for "choosing a pole configuration not offered for the kind", which the UI cannot do, because the select only offers `POLES_BY_KIND[kind]`. The server still refuses a tampered value, as `device-spec.test.ts` shows. This matters only if the plan is re-read as the contract, for example by S-05.
- **Fix**: Add a one-line addendum to the plan pointing at `change.md` for the width precision, and note that 4.7's pole case is covered by the parser tests rather than the UI.
- **Decision**: FIXED — dated Addendum (2026-09-24) section in plan.md before Progress: width numeric(6,2), 4.7 pole case covered by parser tests, and review fixes F1/F3/F4; phase text and Progress left as executed

### F6 — `deviceIssues` doc comment is attached to `deviceErrors`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/i18n/pl.ts:384-401
- **Detail**: The "Keyed by `DeviceIssueCode`…" JSDoc (l.384-387) sits directly above the `deviceErrors` JSDoc, so `deviceErrors` (l.392) carries two stacked comments and `deviceIssues` (l.401) carries none. Every other section in `pl.ts` has its comment directly above it.
- **Fix**: Move the first comment block down to sit above `deviceIssues`.
- **Decision**: FIXED — the DeviceIssueCode JSDoc block moved from above deviceErrors to above deviceIssues (src/lib/i18n/pl.ts)
