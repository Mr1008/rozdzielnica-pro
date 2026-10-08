# Quote Cost Estimate (S-08) — Plan Brief

> Full plan: `context/changes/quote-cost-estimate/plan.md`

## What & Why

The electrician sees the material cost and the labour cost for a project, and can override the estimated time before the quote is finalized (FR-010, FR-011, FR-013, US-01). Without this, the tool has no answer to "how much does it cost", and S-09 has nothing to print.

## Starting Point

- S-04 stores a device snapshot whose rows each carry `price_grosze`. Catalog PE/N bars are included as rows.
- S-07 stores a `pricing_profiles` row with the rate, mount minutes and overhead. A missing row means "not configured".
- The project already snapshots its cabinet's price.
- Nothing yet combines these, and nothing stores an override.

## Desired End State

A "Wycena" section on the project page (and a row in the aside) shows the cabinet line, the devices (count + summed price), the material total, the estimated time with its formula, the time used, the hourly rate, the labour cost and the grand total. The electrician enters an override in hours + minutes; it persists and can be reset to the estimate. If the estimate changes later, the override stays but carries a warning showing the new estimate. Without a profile, or without a current match, the section blocks and shows no numbers.

Worked example: 11 devices × 15 min + 90 min = 255 min (4 h 15 min); at 120,50 zł/h the labour is 512,13 zł.

## Key Decisions Made

| Decision                | Choice                                                           | Why (1 sentence)                                                                                                          |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| What counts as a device | Every snapshot row, catalog PE/N bars included                   | Bars are really mounted and wired, and the count matches the material list one-to-one.                                    |
| Cabinet in material     | Yes, as its own line (`cabinet_price_grosze` snapshot)           | The electrician buys the cabinet, and its price is already snapshotted.                                                   |
| Override storage        | Nullable `labour_minutes_override` + base estimate on `projects` | It survives reloads and is what S-09 prints, with no new table.                                                           |
| Estimate moves later    | Keep the override, flag it outdated (base ≠ today's estimate)    | The electrician's number is never silently lost or silently kept stale; computed on render, so profile changes count too. |
| Rounding                | Half-up to the grosz, integer math `(min × rate + 30) div 60`    | Standard, exact, easy to check by hand.                                                                                   |
| Rate ceiling            | None; warn above 500 zł/h on the quote and profile pages         | Catches the `12050` vs `120,50` typo without a migration on `pricing_profiles`.                                           |
| Gating                  | Match `current` + profile row; layout not required               | Follows the AGENTS.md tripwire and S-08's prerequisites (S-04, S-07).                                                     |
| Override input          | Hours (0–999) + minutes (0–59), stored as total minutes 1–59 999 | Matches how electricians state time, and stays integer.                                                                   |

## Scope

**In scope:**

- A pure `src/lib/quote.ts` with hand-computed unit tests.
- A migration with CHECKs mirrored in TypeScript, plus an RLS integration test.
- `POST /api/projects/[id]/quote` (set or clear).
- `QuoteSection.astro` and an aside row.
- The rate warning on the profile page.
- Kitchen-sink states.
- Updates to AGENTS.md and README.

**Out of scope:** printing (S-09), a rate CHECK or cap, VAT, per-device times, a finalized-quote table, trigger-based reset of the override, layout gating, a cabinet-exclusion toggle.

## Architecture / Approach

`computeQuoteView(matchView, cabinet, profile, override)` is the single source of every number and state. The page renders it, and the endpoint calls it to recompute the estimate it stores as the override's base. Only minutes are stored; money is always derived on render. The override bounds are guarded twice: by a named CHECK on `projects` and by the constants and parser in `quote.ts`.

## Phases at a Glance

| Phase                   | What it delivers                                   | Key risk                                                      |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| 1. Quote domain         | View model, parser and rounding, with oracle tests | Tests that copy the formula instead of using hand values      |
| 2. Storage and endpoint | Override columns, CHECKs, POST endpoint, RLS test  | The CHECK and the parser drifting apart; client-supplied base |
| 3. Project page section | Section, aside row, profile warning, kitchen sink  | Showing numbers in a blocked state                            |
| 4. Docs and contracts   | AGENTS tripwire, README route                      | —                                                             |

**Prerequisites:** S-04 and S-07 done. The local Supabase stack runs on Docker for Phase 2.
**Estimated effort:** about 2 sessions across 4 phases.

## Open Risks & Assumptions

- Catalog prices are summed as entered, with no VAT semantics. If the admin mixes net and gross prices, the quote inherits that.
- The 500 zł/h warning threshold is a judgment call. It is one constant in `quote.ts`.

## Success Criteria (Summary)

- The quote's numbers match a hand calculation in grosze and minutes on a real project.
- An overridden time persists, changes the labour cost and can be reset. A changed estimate visibly flags it.
- A missing profile or a non-current match blocks the quote with a Polish pointer to the fix, never with invented numbers.
