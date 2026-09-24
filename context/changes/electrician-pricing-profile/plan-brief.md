# Electrician Pricing Profile — Plan Brief

> Full plan: `context/changes/electrician-pricing-profile/plan.md`

## What & Why

Roadmap S-07 (FR-010): an electrician saves their hourly rate, average mount time per device and
fixed per-project overhead. S-08 turns these into a labour quote. The PRD makes them a **profile**
attribute, per electrician, not catalog data or a global constant.

## Starting Point

`public.profiles` exists, but its admin policies let the admin read and edit every row. `/dashboard`
is `elektryk`-gated and is a bare greeting card. The table, endpoint, error-map and RLS-test patterns
come from the device catalog (S-01).

## Desired End State

An electrician edits the three values at `/dashboard/profile`, linked from the dashboard. The dashboard
flags an unconfigured profile. The data sits in an owner-only table the admin cannot see, and invalid
values are refused by both the parser and the database.

## Key Decisions Made

| Decision           | Choice                                                               | Why (1 sentence)                                                                                        |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Storage            | Separate `pricing_profiles` table, owner-only RLS, no admin policy   | Columns on `profiles` would be readable and editable by the admin via existing policies.                |
| Units              | Rate in integer grosze; mount time and overhead in whole minutes     | No float rounding; matches catalog money handling.                                                      |
| Bounds             | Rate > 0; mount time 1–600 min; overhead 0–6000 min                  | Zero overhead is legitimate, while zero rate or mount time makes a quote meaningless; caps catch typos. |
| Unconfigured state | No defaults; no row = not configured, S-08 blocks                    | A quote is never computed from numbers the electrician didn't choose.                                   |
| UI                 | Plain `.astro` form at `/dashboard/profile`, native HTML constraints | Three fields need no React island; follows the FormData + `?error=` convention.                         |
| Write roles        | Insert and update also require the `elektryk` claim                  | RLS, not the route gate, is the boundary: an admin can't create a row for themselves.                   |

## Scope

**In scope:** migration + RLS, parser with mirrored bounds, RLS integration test, `/api/profile` gate,
endpoint, profile page, dashboard link and notice, `pl.ts` keys, README/AGENTS updates.

**Out of scope:** quote calculation (S-08), defaults, admin visibility, other profile fields, per-kind
mount times, delete.

## Architecture / Approach

Form → `POST /api/profile/pricing` → `parsePricingForm` (bounds = CHECKs) → upsert on `user_id` →
redirect `?saved=1` or `?error=<code>` → the page re-renders the stored row with a Polish banner.
RLS is the isolation boundary. Both the route gate and the page stay free of role logic.

## Phases at a Glance

| Phase                          | What it delivers                                             | Key risk                                            |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| 1. Data and validation         | Table, CHECKs, RLS, types, parser + unit and RLS tests       | Parser and CHECK bounds drifting apart              |
| 2. Profile page and write path | Gate, endpoint, error map, page, dashboard entry, i18n, docs | Upsert refusal is an error (`42501`), not zero rows |

**Prerequisites:** F-01 (done); a running local Supabase for `test:integration` and smoke.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The caps (600 / 6000 min) are judgement calls. Raising them means changing both the CHECK and the constants.
- A rejected server-side save does not echo typed values. This is accepted, because native constraints make it rare.

## Success Criteria (Summary)

- An electrician can save and re-open their pricing parameters, in Polish, from the dashboard.
- Neither the admin nor another electrician can read or write them (asserted by the RLS suite).
- S-08 has a clear contract: the table, its units, and "no row = block".
