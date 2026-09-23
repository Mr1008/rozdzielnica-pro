# Admin Device Catalog — Plan Brief

> Full plan: `context/changes/admin-device-catalog/plan.md`

## What & Why

Roadmap S-01 (FR-001): the admin maintains the catalog of the six MVP device kinds — switch-disconnectors
(FR), RCD, RCBO, type-B MCBs, PE bars, N bars — with manufacturer data, dimensions, price and electrical
parameters. S-04's guardrail ("never propose an under-rated device") can only check what this catalog
stores, so the parameter model is the heart of the change.

## Starting Point

The cabinet catalog (S-02) already provides every pattern needed: revoke-then-grant migration with
per-operation RLS, archive-not-delete, list/new/edit pages, four form endpoints, error-code mapping and
the RLS test harness. Route gates already cover `/admin/devices`. Nothing device-related exists yet.

## Desired End State

At `/admin/devices` the admin sees devices grouped by kind, with parameter summaries and widths like
"2 TE (35 mm)". They create a device by picking its kind, fill in only that kind's fields, and enter
width in DIN modules or mm. Invalid devices are refused in Polish by the island, the server and a
per-kind database CHECK. Electricians read active devices only. Locally, ~20 sample devices include
two price tiers at one rating and a deliberate B40 gap for S-04.

## Key Decisions Made

| Decision      | Choice                                                                                          | Why (1 sentence)                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Data model    | One `devices` table, typed nullable parameter columns, per-kind CHECK                           | The database itself refuses an under-specified device — defence in depth for the guardrail.    |
| Parameters    | Poles + In (FR/RCD/RCBO/MCB), IΔn + RCD type (RCD/RCBO), Icn (MCB/RCBO), terminal groups (bars) | Covers what simple circuit specs, 1F/3F and the OSD pre-meter check need, nothing more.        |
| FR            | Plain switch-disconnector with rated current and poles, no fuse links                           | User clarification: physical disconnectors only; FR is never overcurrent protection.           |
| Width         | Stored in mm (0.1 precision); UI defaults to DIN modules (17.5 mm) with a mm toggle             | Exact datasheet values (12 × 17.5 = 210 mm fits a 210 mm rail); electricians think in modules. |
| Seed          | ~20 realistic devices, two price tiers, deliberate B40 gap                                      | S-04 can test cheapest-match and "catalog gap → contact admin" from day one.                   |
| Kind on edit  | Locked after creation                                                                           | A different kind is a different product; archive and recreate instead.                         |
| Shared code   | Move `isUuid`, list sort, price helpers, editor field components to shared modules              | Two catalogs, one implementation; the cabinet behaviour stays unchanged.                       |
| S-04 contract | Projects snapshot the chosen device; archived devices never matched                             | Same rule as the cabinet geometry snapshot — admin edits never shift an existing quote.        |

## Scope

**In scope:** device domain model and DIN-module helpers; `devices` table, enums, RLS, generated types;
sample seed; list grouped by kind; archive/restore; editor island with kind-driven fields and width
toggle; create/update endpoints; AGENTS/README/PRD wording sync ("FR = switch-disconnector, no fuse
links").

**Out of scope:** fuse links; non-B characteristics or other device kinds; rated voltage / terminal
ranges / series; device drawing; kind change; hard delete; import; the matching algorithm (S-04).

## Architecture / Approach

Pure `device-spec.ts` (zod union on kind + parameter matrix) is shared by the island and
`parseDeviceForm`; the `devices_parameters_match_kind` CHECK mirrors it in Postgres, and integration
tests pit the two against each other (invalid rows via service client, seed re-parsed in TS). Pages and
endpoints copy the cabinet shape.

## Phases at a Glance

| Phase                            | What it delivers                                                       | Key risk                                                |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| 1. Device model & shared helpers | Parameter matrix in TS, DIN conversion, helper extraction, Polish text | Matrix drifts from what S-04 will need                  |
| 2. Database, types & seed        | `devices` table + per-kind CHECK, RLS, ~20 sample devices, tests       | CHECK and TS schema disagree; `numeric` rounds silently |
| 3. Read-only surface             | List grouped by kind, archive/restore, hub link                        | Parameter summaries unclear per kind                    |
| 4. Editor & write path           | Kind-driven editor, TE/mm toggle, endpoints, docs                      | Shared-component extraction regresses cabinet editor    |

**Prerequisites:** F-01 and S-02 done (both archived); local Supabase stack for Phase 2+.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- Icn is stored now but only useful if S-03/S-04 collect a short-circuit requirement.
- 1 TE = 17.5 mm is assumed; a manufacturer quoting 18 mm per module is entered in mm mode.
- The PRD wording "rozłączniki bezpiecznikowe" is changed to plain switch-disconnectors in Phase 4, based on the user's clarification.

## Success Criteria (Summary)

- The admin can create, edit, archive and restore a device of every kind, entirely in Polish.
- No device without its kind's required parameters can exist in the database.
- S-04 can start straight away against a realistic seed with a known price tier and a known gap.
