<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Electrician Pricing Profile

- **Plan**: context/changes/electrician-pricing-profile/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2
- **Date**: 2026-09-24
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run during review: `npm run lint` (clean), `npx astro check` (0 errors / 0 warnings),
`npm run test:unit` (21 files / 258 tests), `npm run test:integration` (4 files / 69 tests), `npm run build`
(ok), `npm run smoke` against the dev server (all steps passed). Manual items 1.6 and 2.7–2.11 were confirmed
by the user in session.

## Findings

### F1 — Number inputs accept values the parser rejects, and the typed value is lost

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard/profile.astro:107, 127 · src/lib/pricing-profile.ts:40
- **Detail**: The two `type="number"` minute inputs pass browser validation for `15.0`, `1e2` or `-0`, and the browser
  submits them exactly as typed. `WHOLE_MINUTES = /^\d+$/` rejects all three, so the user gets a generic
  `invalid_input` banner for input the browser accepted. The redirect then re-renders the stored row, so the typed values
  are lost. This is a UX gap, not a guardrail gap: the strictness is deliberate, and the database CHECKs agree.
- **Fix**: Make `parseMinutes` accept a whole number with a zero fractional part (`^\d+(?:\.0+)?$`) and add a test
  case. Also add `inputmode="numeric"` so the keyboard hint matches.
- **Decision**: FIXED — `WHOLE_MINUTES` now `^\d+(?:\.0+)?$` (accepts `15.0`, still rejects `7.5`/`15.`/`15.01`/`-0`/`1e2`), new test cases, `inputmode="numeric"` on both minute inputs

### F2 — S-08 needs to know the hourly rate has no real upper bound and labour cost can exceed int4

- **Severity**: 💬 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_pricing_profiles.sql:33-37 · src/lib/pricing-profile.ts:62
- **Detail**: The rate's only ceiling is the int4 limit (`MAX_PRICE_GROSZE`, about 21.4 M zł/h). A typo such as `12050`
  instead of `120,50` is therefore stored silently. Rate × hours in grosze can also exceed int4 once S-08 stores
  computed totals.
- **Fix A ⭐ Recommended**: Record it in `change.md` Notes as an S-08 contract: compute totals in JS (or store them as
  `bigint`), and decide there whether to cap the rate.
  - Strength: Costs nothing now. It lands where S-08 planning reads its contracts, and the change.md Notes already hold
    the S-08 unit rules.
  - Tradeoff: The typo risk stays until S-08.
  - Confidence: HIGH — nothing reads the rate yet.
  - Blind spot: The sensible cap value is a business call we haven't discussed.
- **Fix B**: Add a sane cap now (e.g. 10 000 zł/h) to both the CHECK and the parser, in a new migration.
  - Strength: Catches the typo at entry.
  - Tradeoff: A new migration plus the two-guard sync, for a speculative problem with one user.
  - Confidence: MED — the right cap value is a guess.
  - Blind spot: Whether a cap would ever refuse a legitimate rate.
- **Decision**: FIXED via Fix A — S-08 contract note added to `change.md` Notes (compute totals in JS or `bigint`; decide on a rate cap in S-08)

### F3 — RLS suite does not assert three refused paths

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/rls-pricing-profiles.test.ts
- **Detail**: The suite has no test for: the admin upserting over an electrician's row, an anon insert or update, or an
  owner updating their own row's `user_id` to another user's id. The policies already refuse all three (write
  predicates and `with check`), but nothing guards against a future policy edit.
- **Fix**: Add three cases following the existing ones: expect 42501, or zero rows with the victim row unchanged.
- **Decision**: FIXED — three cases added to `rls-pricing-profiles.test.ts` (owner moving row → 42501, admin upsert over A → 42501 with row unchanged, anon insert/update → 42501); suite 17/17

### F4 — Two small, documented drifts from the plan's contract wording

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/migrations/20260924120000_pricing_profiles.sql:33-37 · tests/integration/rls-pricing-profiles.test.ts:137-148
- **Detail**:
  1. The plan asks for named CHECKs for the whole bounds table, but the rate has only `>= 1`. Its upper bound is the int4
     ceiling itself, and a comment says so.
  2. The "B inserts a row with `user_id = A`" case uses a fresh victim account instead of A, because A's existing row
     would hit the primary key before the policy. The upsert-over-A case still covers A.

  Both were reported as adaptations at implementation time, and both keep the plan's intent.

- **Fix**: None needed. Accept as documented adaptations.
- **Decision**: ACCEPTED — documented adaptations; intent preserved

### F5 — Minor by-design edges: `created_at` settable, admin cascade delete, 23503 unmapped

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924120000_pricing_profiles.sql:22, 63 · src/lib/pricing-errors.ts:43-51
- **Detail**:
  1. The table-wide `grant insert, update` lets an owner write `created_at` directly through PostgREST. Cabinets and
     devices behave the same way.
  2. The admin's existing `profiles_delete_admin` policy plus `on delete cascade` lets an admin remove an electrician's
     pricing row indirectly, without seeing it. That is the intended account-deletion path.
  3. An FK violation (`23503`, meaning the profile row is missing) passes through as a raw code and shows the generic
     message, as the sibling mappers do.
- **Fix**: Accept as risk. There is nothing to change at this scale.
- **Decision**: ACCEPTED — by-design at this scale; consistent with cabinets/devices and sibling error mappers
