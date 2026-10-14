# Database guards and snapshots

Every "guarded twice" pair below is a database CHECK and a TypeScript parser encoding the same rule.
Change one, change the other in the same change.

- **Cabinet `geometry` is validated only by `parseCabinetGeometry`** in
  `src/lib/cabinet-geometry.ts`. The database CHECK asserts nothing but an object at `version: 1`, so
  every write of `cabinets.geometry` — endpoint, seed, migration — must go through it (the editor's
  endpoints do, via `parseCabinetForm`); never write the column around it.
  `projects.cabinet_geometry` has no TypeScript writer at all: only the `projects_snapshot_cabinet`
  trigger writes it, copying a `cabinets.geometry` that has already passed the parser.
- **A project must snapshot its cabinet's `geometry`, not reference it live** (S-03). Admin edits to
  a cabinet must never shift an existing project's layout or quote; archiving only hides the cabinet
  from the picker. The snapshot (`cabinet_geometry`, `cabinet_name`, `cabinet_manufacturer`,
  `cabinet_model`, `cabinet_price_grosze`) is written **only** by the `projects_snapshot_cabinet`
  trigger in `supabase/migrations/20260924150000_projects.sql`: it re-snapshots when `cabinet_id`
  changes and otherwise resets those columns, so client-sent values are ignored. Send `cabinet_id`
  alone; never write the snapshot columns from TypeScript. Downstream slices read the snapshot, never
  `cabinets.geometry`.
- **Device parameters are guarded twice, and the two guards must change together.** The
  `devices_parameters_match_kind` CHECK in `supabase/migrations/20260923130628_devices_catalog.sql`
  and `parseDeviceSpec` in `src/lib/device-spec.ts` (`POLES_BY_KIND`, `PARAMETERS_BY_KIND`, the
  decimal scales) encode the same per-kind rules; a migration that changes one without the other
  lets the editor accept rows the database refuses, or the reverse. `parseDeviceSpec` also rejects
  extra decimal places because `numeric` columns would round them silently. An FR is a plain
  switch-disconnector — a rated current and poles, no protection — so the matcher must never treat
  it as overcurrent or residual-current protection.
- **The device N-terminal side is guarded twice, and the two guards must change together.** The
  `devices_parameters_match_kind` CHECK in `supabase/migrations/20261006120000_device_n_terminal_side.sql`
  and `parseDeviceSpec` in `src/lib/device-spec.ts` both require `n_terminal_side` exactly when the
  poles carry N (`POLES_WITH_N`) and forbid it otherwise — by poles, not by kind.
- **Supply value lists are guarded twice, and the two guards must change together.** The CHECKs and
  enums on the seven supply columns in `supabase/migrations/20260924150000_projects.sql` and the lists
  in `src/lib/supply-params.ts` encode the same values (the enum unions are asserted against
  `database.types.ts`; the numeric lists are not). **A null supply means "not configured"** — the
  seven columns are all set or all null (`projects_supply_all_or_nothing`), and that is the contract
  S-04 reads: it must block and send the electrician to the project page, never fall back to
  invented defaults. The warnings in `src/lib/supply-warnings.ts` are informational and never block a
  save; `AMPACITY_A` is transcribed from PN-HD 60364-5-52 and its completeness test must keep every
  combination present.
- **Circuit value lists are guarded twice, and the two guards must change together.** The CHECKs on
  `rcd_groups` / `circuits` in `supabase/migrations/20260929120000_circuits_and_device_matching.sql`
  (plus `rcd_groups_margin_valid` in `20260930120000_rcd_group_margin.sql`) and the lists in
  `src/lib/circuit-params.ts` encode the same values. A group RCD must satisfy
  `In ≥ ΣIn × (100 + rcd_margin_percent) / 100`, compared in integers; never go back to "≥ the
  largest circuit".
- **Pricing bounds are guarded twice, and the two guards must change together.** The named CHECKs
  in `supabase/migrations/20260924120000_pricing_profiles.sql` and the `MIN_`/`MAX_` constants in
  `src/lib/pricing-profile.ts` (plus `MAX_PRICE_GROSZE` for the rate) encode the same ranges. The
  table is `pricing_profiles`, not a column on `profiles`, because `profiles` has admin policies.
  **No row means "not configured"** — that is the contract S-08 reads: it must block and send the
  electrician to `/dashboard/profile`, never fall back to invented defaults.
- **`business_profiles` is owner-only, with no admin policy** — the admin can read `profiles`, so
  company details cannot live there. **Its bounds are guarded twice, and the two guards must change
  together:** the `business_profiles_*_valid` CHECKs in
  `supabase/migrations/20261008130000_business_profiles.sql` and the `MAX_*` constants in
  `src/lib/business-profile.ts`. The NIP checksum is checked in TypeScript only, by design (stricter
  than the CHECK — the safe direction). No row means "no company details": the letterhead falls back
  to the full name or email, and printing is never blocked.
- **`project_devices` snapshot columns are written only by the `project_devices_snapshot_device`
  trigger** — send `device_id` alone, never the snapshot columns. S-08 reads the snapshot, never the
  live catalog. A supply change (`projects_clear_device_snapshot`) deletes the whole snapshot, so the
  project reads "not matched" until the circuits are saved or re-matched.
  **A stored snapshot is not proof of compliance**: the trigger copies whatever the catalog row holds
  at save time and checks only `archived_at`, so an admin editing a device in place, or a supply
  change racing the save, can leave a row that fails its circuit. S-08 and S-09 therefore quote and
  print only when `computeMatchView(...).state === "current"` (`src/lib/device-matching-server.ts`);
  any other state blocks and sends the electrician to "Dobierz ponownie".
- **`save_project_circuits` upserts groups and circuits by their stable client ids** — S-05/S-06
  reference circuits by id, so never replace-all. Call it via `saveCircuitsArgs` in
  `src/lib/device-matching-server.ts`.
- **`busbar_piece` and the labour override bounds are guarded twice too** — see
  `context/foundation/agent-rules/layout-wiring.md` and `context/foundation/agent-rules/matching-quote.md`.
