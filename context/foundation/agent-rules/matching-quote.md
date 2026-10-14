# Device matching, quote and printout

- **The matcher filters for correctness before price** (`src/lib/device-matching.ts`): only compliant
  devices are ever sorted, "cheapest" is picked among them, and no compliant device is a catalog gap.
  Exact `In` for overcurrent protection is deliberate — never relax it to "≥". A partial match is
  never stored: a gap or blocker saves an empty snapshot.
- **Quote numbers come only from `computeQuoteView`** (`src/lib/quote.ts`), and only in state
  `ready` — S-09 prints that view, never re-derives a sum. Every snapshot row counts as a device
  in labour (catalog bars and comb busbar segments too), but a busbar piece is priced once —
  `devicesCostGrosze` sums one price per distinct `(device_id, busbar_piece)`, and the printout's
  busbar line counts pieces, not segments; the cabinet's snapshot price is its own material line; labour cost rounds
  half-up in integers (`(minutes × rate + 30) div 60`). **The labour override bounds are guarded
  twice, and the two guards must change together:** the `projects_labour_override_*` CHECKs in
  `supabase/migrations/20261008090000_project_labour_override.sql` and the `*_LABOUR_OVERRIDE_*`
  constants in `quote.ts`. The override is stored with the estimate it was set against
  (`labour_override_base_minutes`, written by the endpoint from a server-side recompute — a
  convention, not enforced by the database: the owner's own token can write it); "outdated" is a
  comparison on render, never a stored flag, so a profile change counts too.
- **The printout reads only `computePrintView`** (`src/lib/quote-print.ts`). It prints only a `ready`
  quote over a `current` match and a `placed` layout; any other state blocks with a link to the fix,
  never a partial document. Its material lines only itemise `devicesGrosze` and must sum to it exactly
  — a mismatch throws, it is never shown as a state.
- **Quoting and printing need a `current` match** — a stored `project_devices` snapshot is not proof
  of compliance; see `context/foundation/agent-rules/data-guards.md`.
