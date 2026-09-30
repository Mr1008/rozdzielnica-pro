# Circuit Input and Device Matching Implementation Plan

## Overview

Roadmap S-04 (FR-006, FR-007, US-01, the `## Success Criteria` guardrail). On the project page an
`elektryk` enters the circuits brought into the cabinet and groups them under RCDs. Entry happens in
a drag-and-drop editor: circuits can be reordered, moved between RCD groups and taken out of every
group, and the groups themselves can be reordered. On save the system matches devices for the whole
set:

- the main switch-disconnector (FR);
- an RCD for each group;
- an MCB B for each circuit;
- an RCBO for each single-circuit group.

For each role it picks the **cheapest device that satisfies every parameter**. When anything cannot
be matched it shows a catalog-gap error asking the user to contact the admin, and it never falls
back to an under-rated device. The chosen set is **snapshotted** into the project, so that later
catalog edits never shift it. The page also shows informational cable-ampacity warnings per circuit.

## Current State Analysis

- **Projects.** They exist with a cabinet snapshot and the OSD/WLZ supply
  (`supabase/migrations/20260924150000_projects.sql`). The seven supply columns are all set or all
  null (`projects_supply_all_or_nothing`, `:122-134`), and **null means "not configured"**. That
  state must block matching and must never fall back to defaults
  (`context/archive/2026-09-24-project-setup-and-supply-params/change.md:21-23`).
- **Project page.** `src/pages/dashboard/projects/[id].astro` is fully server-rendered:
  - It has sections for details, cabinet, supply and delete. The `sections` nav array is at `:116-121`.
  - Each section's form posts FormData to its own endpoint under `src/pages/api/projects/[id]/`. The
    endpoint redirects back with `?saved=` (`:37-45`) or `?error=`.
  - The sticky aside carries status badges (`:344-355`).
  - There are no React islands on electrician pages yet.
- **Endpoint pattern.** `src/pages/api/projects/[id]/supply.ts` shows the shape:
  - UUID guard.
  - `formData().catch(() => new FormData())`.
  - Parser.
  - `createClient` null branch.
  - `projectErrorFromPostgrest`.
  - A zero-row update is treated as `not_found`.
  - Error codes live in `src/lib/project-errors.ts:10-62`.
- **Dynamic-list editor pattern.** `src/components/cabinets/CabinetEditor.tsx` works like this:
  - State is held in React.
  - The whole document goes out as one hidden JSON field (`:315`).
  - The same parser runs on the client (`:206`).
  - On submit, a sessionStorage draft is saved (`:292-300`) and restored on an `?error=` redirect
    (`:178-191`, helpers in `src/components/forms/draft-storage.ts`).
  - The server re-validates (`parseCabinetForm`, `src/lib/cabinet-form.ts:53-73`).
- **Device catalog.**
  - Table and per-kind CHECK: `supabase/migrations/20260923130628_devices_catalog.sql`.
  - `devices_select_active` (`:163-166`) lets every authenticated user read non-archived rows. The
    admin additionally sees archived ones, so the matcher filters `archived_at is null` explicitly.
  - `src/lib/device-spec.ts` owns `POLES_BY_KIND`, `RCD_TYPES` and `parseDeviceSpec`.
  - An FR is never overcurrent or residual-current protection
    (`context/archive/2026-09-23-admin-device-catalog/change.md:17-19`).
  - A project copies the chosen device at selection time (`…/admin-device-catalog/change.md:20-22`).
  - There is no electrician-side device loader yet.
- **Seed.** `supabase/seed.sql:135-158` covers:
  - MCB B6–B32 1P, including a cheaper second-manufacturer B16 (the cheapest-pick case);
  - B16/B20/B25 3P;
  - RCD 40 A 30 mA 2P/4P in types A and AC;
  - RCBO B10/B16 1P+N type A;
  - FR 63 A 1P and FR 40/63 A 3P.

  **No FR 2P/4P**, so a single-phase or TN-S/TN-C-S three-phase supply would be a catalog gap on the
  main switch. There is a deliberate **B40 gap**.

- **Ampacity.** `AMPACITY_A` in `src/lib/supply-warnings.ts` holds verified values for Cu/Al,
  2/3 loaded conductors and methods B2/C/D1, for 2.5–35 mm². It is keyed by `WlzCrossSectionMm2`.
  `REFERENCE_METHOD_BY_INSTALLATION` maps the `wlz_installation` enum. There is no 1.5 mm² row.
- **Other anchors.**
  - `ENTRY_SIDES` lives in `src/lib/cabinet-geometry.ts:17`.
  - The RLS test harness is `tests/integration/support.ts` (`createElectrician`, `signIn`,
    `createServiceClient`), with the pattern shown in `tests/integration/rls-projects.test.ts`.
- **Drag and drop.** No drag-and-drop library is in `package.json`.

## Desired End State

- A new **"Obwody i dobór aparatów"** section sits on the project page, between supply and delete,
  and appears in the section nav.
- **Groups.** The `CircuitEditor` React island lists the RCD groups as cards plus a "Bez grupy" area.
  - Each group card has a label (auto "RCD 1…"), IΔn (10/30/100/300 mA, default 30) and a minimum
    RCD type (AC/A/F/B, default A).
  - Groups can be added and removed. Removing a group moves its circuits to "Bez grupy".
- **Circuits.** Each circuit row has:
  - name;
  - rated current In (6–63 A list);
  - phase count (1/3);
  - cable cross-section (1.5–16 mm²);
  - installation method (the WLZ list);
  - cable entry side (top/bottom/left/right, with the sides the cabinet actually has marked).

  Circuits can be added and removed.

- **Rearranging.**
  - Drag a circuit to reorder it within its group, or into another group or "Bez grupy".
  - Drag groups to reorder them.
  - The keyboard works for dragging (dnd-kit keyboard sensor).
  - Every drag also has a non-drag equivalent: a group select and move-up/down buttons.
- **Saving** posts the whole set once. The server:
  1. parses it;
  2. matches it against the active catalog;
  3. saves groups and circuits (stable ids) plus the device snapshot in one transaction;
  4. redirects back with `?saved=circuits`.

  On a gap the circuits still save, the snapshot is cleared, and the page shows the gap.

- **Result panel**, server-rendered:
  - the matched list: role, device name, model, a parameter summary via `deviceParameterSummary`,
    catalog price, and an "RCBO niedostępny — zastosowano RCD + MCB" note where the fallback applied;
  - **or** catalog-gap errors naming exactly what is missing (e.g. "MCB B40 1P, obwód: Piekarnik").
    Each error tells the user to contact the admin and never suggests a substitute;
  - **or** a blocker: supply not configured (links to `#supply`), TN-C with RCD groups, a 3-phase
    circuit on a single-phase supply, or no circuits;
  - cable warnings (In > ampacity) as non-blocking alerts;
  - a "katalog zmienił się od ostatniego doboru" hint with a "Dobierz ponownie" button, shown when
    a fresh match differs from the stored snapshot or the snapshot was cleared by a supply change.
- **Aside** gets a "Dobór aparatów" badge: matched N aparatów / luka w katalogu / nieaktualny /
  brak obwodów.
- **Isolation.** RLS isolates circuits, groups and the device snapshot per electrician, and the
  admin sees none of it.
- **Verification.** All of the above can be checked in the kitchen sink, in the unit tests, in the
  RLS integration tests, and by clicking through the seeded stack.

### Key Discoveries:

- The snapshot-by-trigger pattern to copy is `projects_snapshot_cabinet`
  (`supabase/migrations/20260924150000_projects.sql:151-181`). It is security invoker, so the lookup
  runs under the caller's RLS. It repeats `archived_at is null`, raises `P0002` on no match, and
  ignores client-sent snapshot values.
- `projectErrorFromPostgrest` already maps `P0002` → `cabinet_unavailable` (`src/lib/project-errors.ts:51-62`).
  The device snapshot needs its own code, so P0002 must be distinguished by call site, not globally.
- The double-guard pattern (CHECK + TS list + enum type-equality assertions) is in
  `src/lib/supply-params.ts` and `src/lib/device-spec.ts`. Circuit lists follow the same pattern.
- `seed.sql` is local/CI only. The cloud admin must add FR 2P/4P rows by hand.

## What We're NOT Doing

- **Breaking capacity (Icn) filtering.** Nothing collects a short-circuit requirement, so the matcher
  ignores `breaking_capacity_ka`. This is recorded as a risk, and it is the natural next parameter.
- **PE/N bar selection from the catalog.** The bars come with the cabinet snapshot. S-04 only warns
  when the cabinet's bars have fewer terminals, or smaller terminal ranges, than the circuits (+ WLZ)
  need, or when the cabinet has no bars. Catalog `pe_bar`/`n_bar` devices stay unused.
- **Sizing In from a load.** The electrician chooses In, and the system never computes it.
- **Physical layout.** Rails, positions and rule precedence belong to S-05. The circuit order and
  the drag-and-drop here are list order only, not cabinet placement.
- **Quote, labour and the total material cost.** These belong to S-08. The panel shows each
  device's catalog price only.
- **Manufacturer preference, circuit templates and copying between projects.** These are parked in
  the roadmap.
- **Aluminium circuit cables.** Circuits are copper only.
- **A standards-grade cable calculation.** No correction factors: the ampacity check reuses the
  simplified WLZ approach and stays informational.
- **TN-C modernisation workflows.** A TN-C supply with RCD groups is blocked, and the fix is to enter
  TN-C-S.
- **Touch-specific drag handling.** PRD non-goal. Pointer and keyboard only.

## Implementation Approach

Pure logic first, then the database, then the server-rendered page, then the island.

The matcher is a **pure function** (`matchDevices(input, catalog) → MatchResult`) with no I/O, so
every guardrail branch is unit-tested without a database. It applies the correctness filter
**first** and only then sorts by `price_grosze` ascending. Ties are broken by `manufacturer`, then
`model`, then `id`: a deterministic but deliberately arbitrary order, stated in code.

Matching rules (decided in planning):

| Role                    | Kind                  | Must satisfy                                                                                                                                                                                                                           |
| ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main switch             | `switch_disconnector` | `rated_current_a ≥ premeter_protection_a`. Poles: 1-phase → `2P` (`1P` in TN-C); 3-phase → `4P` (`3P` in TN-C)                                                                                                                         |
| Circuit protection      | `mcb_b`               | `rated_current_a = circuit In` **exactly**. Poles: 1-phase ∈ {1P, 1P+N, 2P}, 3-phase ∈ {3P, 3P+N, 4P}. In TN-C only 1P / 3P (the PEN is never switched)                                                                                |
| Group RCD (≥2 circuits) | `rcd`                 | `rated_current_a ≥ max(In of the group's circuits)`, `residual_current_ma = group IΔn` exactly, `rcd_type` rank ≥ the group minimum (AC<A<F<B). Poles: `4P` if any circuit is 3-phase, else {2P, 4P}                                   |
| Single-circuit group    | `rcbo`                | `rated_current_a = circuit In` exactly, IΔn exact, type rank ≥ minimum. Poles: 1-phase ∈ {1P+N, 2P}, 3-phase ∈ {3P+N, 4P}. **If no RCBO qualifies → a compliant RCD + MCB pair (flagged `rcbo_fallback`); gap only if that fails too** |
| Ungrouped circuit       | `mcb_b`               | As circuit protection. An info note says the circuit has no residual-current protection                                                                                                                                                |

The result is all-or-nothing:

- **matched:** every role has a device;
- **gaps:** at least one role has none. Every gap is listed, and nothing is stored;
- **blocked:** a precondition fails, and no matching is attempted.

A partial set is never stored, because a quote over a partial set would understate the job.

## Critical Implementation Details

- **Stable ids and upsert safety.** The editor assigns client-generated UUIDs to groups and circuits,
  and the RPC **upserts by id and deletes the rows missing from the payload**. It never does
  replace-all, so S-05/S-06 can reference circuits. Suppose an electrician sends an id belonging to
  another project's row. `INSERT … ON CONFLICT DO UPDATE` then hits an existing row the UPDATE
  policy cannot see, and Postgres raises `42501` instead of touching it. The RLS test must assert
  exactly this.
- **Order inside the RPC.**
  1. Upsert the groups.
  2. Upsert the circuits.
  3. Delete the missing circuits.
  4. Delete the missing groups.
  5. Replace the `project_devices` rows.

  This order matters because circuits reference groups through the composite FK
  `(project_id, rcd_group_id)`.

- **Supply change clears the snapshot.** An AFTER UPDATE trigger on `projects` deletes the project's
  `project_devices` whenever any supply column `is distinct from` its old value. The "Dobierz
  ponownie" button then matches without re-posting the editor.
- **Race with the catalog.** A device can be archived between the endpoint's read and the RPC. The
  snapshot trigger then raises `P0002`, the transaction rolls back, and the endpoint redirects with
  `device_unavailable` ("katalog zmienił się w trakcie — spróbuj ponownie"). Nothing half-saved
  remains.

## Phase 1: Domain logic (pure, unit-tested)

### Overview

Value lists, the editor payload parser, the cable check, the draft operations for drag-and-drop and
the matcher. No database, no UI.

### Changes Required:

#### 1. Circuit value lists and payload parser

**File**: `src/lib/circuit-params.ts` (+ `circuit-params.test.ts`)

**Intent**: The single TypeScript source of the circuit and group value lists (mirrored by the
Phase 2 CHECKs), and the parser for the editor's hidden JSON field. It turns untrusted input into
the row shapes, reporting coded issues per group or circuit the way `parseDeviceSpec` does, so the
island and the server reject exactly the same things.

**Contract**:

- **Value lists:**
  - `CIRCUIT_RATED_CURRENTS_A = [6,10,13,16,20,25,32,40,50,63]`
  - `CIRCUIT_PHASE_COUNTS = [1,3]`
  - `CIRCUIT_CROSS_SECTIONS_MM2 = [1.5,2.5,4,6,10,16]`
  - `RESIDUAL_CURRENTS_MA = [10,30,100,300]`
  - defaults `DEFAULT_RESIDUAL_CURRENT_MA = 30` and `DEFAULT_MIN_RCD_TYPE = "A"`
  - reuse `RCD_TYPES`, `WLZ_INSTALLATIONS` and `ENTRY_SIDES`
  - `MAX_CIRCUITS = 60`, `MAX_GROUPS = 20`, `MAX_CIRCUIT_NAME_LENGTH = 100` (code points)
- **Row shapes:**
  - `RcdGroupInput { id, label, residual_current_ma, min_rcd_type }`
  - `CircuitInput { id, rcd_group_id | null, name, rated_current_a, phase_count, cross_section_mm2, installation, entry_side }`
  - `position` is derived from array order.
- **Parser:** `parseCircuitsPayload(raw: unknown) → { ok: true, value: { groups, circuits } } | { ok: false, issues: CircuitIssue[] }`.
  It is exhaustive over a closed `CIRCUIT_ISSUE_CODES` list:
  - `malformed`, `required`, `not_in_list`, `too_long`;
  - `unknown_group` (a circuit points at a group not in the payload);
  - `duplicate_id`, `too_many`.

  Every id is checked with `isUuid`. Issue messages are in Polish via `circuitIssueMessage`.

- **Form field:** `CIRCUIT_FORM_FIELDS.payload`.
- **Sync assertions:** add enum type-equality assertions for any new DB enum (`entry_side`).

#### 2. Circuit cable warnings

**File**: `src/lib/circuit-warnings.ts` (+ test); `src/lib/supply-warnings.ts` (export only)

**Intent**: Warn, never block, when a circuit's In exceeds the tabulated ampacity of its copper
cable for its installation method and loaded conductors (2 for 1-phase, 3 for 3-phase). It reuses
the verified `AMPACITY_A.Cu` for 2.5–16 mm² plus a new, clearly marked `CU_1_5_MM2_AMPACITY_A`
transcribed from PN-HD 60364-5-52 tables B.52.2 / B.52.4 (PVC):

- 2 loaded conductors: B2 16.5, C 19.5, D1 22;
- 3 loaded conductors: B2 15, C 17.5, D1 18.

These values are **for the electrician to verify** (Phase 1 manual step), with the same comment
style as the existing table. The file also warns about PE/N bars, comparing the terminal count and
range in the cabinet snapshot against the circuits' cross-sections plus the WLZ.

**Contract**:

- `circuitAmpacityA(circuit) → number`
- `circuitWarnings(circuits, supply | null, geometry | null) → CircuitWarning[]`, a coded union:
  - `cable_ampacity_below_in` (circuitId, ampacityA, ratedA)
  - `bars_missing`
  - `bar_terminals_insufficient` (kind, needed, available)
  - `entry_side_not_in_cabinet` (circuitId)
- `circuitWarningMessage` is exhaustive.
- A completeness test asserts that every (cross-section × method × conductors) combination has a
  value.

#### 3. Draft operations for the editor

**File**: `src/lib/circuit-draft.ts` (+ test)

**Intent**: Pure state transitions behind drag-and-drop and its button equivalents, so reordering
logic is tested without a DOM.

**Contract**: all operations are pure and return a new draft `{ groups: GroupDraft[], circuits: CircuitDraft[] }`:

- `addGroup`, `removeGroup(id)`: its circuits become ungrouped and keep their relative order.
- `moveGroup(id, toIndex)`.
- `addCircuit(groupId | null)`, `removeCircuit(id)`.
- `moveCircuit(id, toGroupId | null, toIndex)`: covers within-container reorder and cross-container
  moves.
- `nextGroupLabel(groups)`: "RCD n", lowest unused n.
- `draftToPayload(draft)`: ordered arrays for `parseCircuitsPayload`.
- `payloadToDraft(rows)`: from stored rows.

Circuit order is kept per container. Invalid moves (unknown id) return the draft unchanged.

#### 4. Device matcher

**File**: `src/lib/device-matching.ts` (+ `device-matching.test.ts`)

**Intent**: The guardrail. A pure function that implements the rule table in Implementation Approach.
It filters for correctness first and takes the cheapest only among compliant devices. It reports
every catalog gap with the exact requirement that failed, so the page can tell the admin what to
add.

**Contract**:

- `matchDevices(input: MatchInput, catalog: readonly DeviceSpecWithId[]) → MatchResult`.
  - `MatchInput = { supply: SupplyParams | null, groups, circuits }`.
  - The catalog is the active devices, each already passed through `parseDeviceSpec`. Rows that
    fail it are excluded, never guessed.
- `MatchResult`:
  - `{ status: "blocked"; reasons: BlockReason[] }`, with reasons `supply_missing`, `no_circuits`,
    `tn_c_with_rcd`, `circuit_phase_exceeds_supply` (circuitId);
  - `{ status: "gaps"; gaps: CatalogGap[] }`. Each gap carries role, kind, the required
    poles/In/IΔn/type and the group/circuit it serves;
  - `{ status: "matched"; selections: Selection[] }`. Each selection has role `main_switch` | `rcd`
    | `rcbo` | `mcb`, `deviceId`, groupId/circuitId, and `notes` (`rcbo_fallback`, `no_rcd`).
- **Order of selections:** main switch, then each group in order (RCD or RCBO, then its MCBs in
  circuit order), then ungrouped MCBs.
- **Other exports:** `rcdTypeRank`, `catalogGapMessage`, `blockReasonMessage` (Polish, exhaustive),
  and `sameSelection(a, b)` for the stale-snapshot comparison.
- **Tests must pin:**
  - B20 is never chosen for a B16 circuit, and a type AC is never chosen when A is required;
  - the cheaper B16 from the second manufacturer wins;
  - the B40 gap produces a gap, never a B32;
  - the RCBO → RCD+MCB fallback;
  - TN-C with a group blocks;
  - TN-C accepts only 1P/3P MCBs;
  - RCD In below the largest MCB is rejected;
  - 4P is required when any circuit is 3-phase;
  - FR `≥` premeter, and FR poles by system;
  - an FR is never used as protection;
  - archived or unparseable devices are never chosen;
  - null supply blocks;
  - deterministic tie-break.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Electrician verifies the 1.5 mm² Cu ampacity values against PN-HD 60364-5-52 tables B.52.2 / B.52.4 and the comment is updated with the verification date
- Electrician reviews the matching rule table (poles per system, exact In, IΔn exact, type rank, RCD In ≥ max MCB, FR ≥ premeter) and confirms it matches practice

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Database — circuits, groups, device snapshot

### Overview

Three owner-isolated tables, the snapshot trigger, the supply-change trigger, and the atomic save
RPC. Regenerated types, seed additions and RLS integration tests.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260929120000_circuits_and_device_matching.sql`

**Intent**: Persist groups and circuits with their value-list CHECKs mirrored from
`circuit-params.ts`, and the matched device set as a trigger-written snapshot. Isolation follows the
parent project's owner, per operation, requiring the `elektryk` claim for writes. It is re-runnable
like the earlier migrations.

**Contract**:

- **Enum:** `public.entry_side ('top','bottom','left','right')`.
- **`rcd_groups`:**
  - `id uuid pk` (client-supplied)
  - `project_id uuid not null → projects on delete cascade`
  - `position smallint`
  - `label text` (trimmed, 1–40)
  - `residual_current_ma integer` CHECK in the list
  - `min_rcd_type public.rcd_type`
  - `unique (project_id, id)` (target of the composite FK)
  - timestamps + `touch_updated_at`
- **`circuits`:**
  - `id uuid pk`, `project_id`, `rcd_group_id uuid null`
  - `foreign key (project_id, rcd_group_id) references rcd_groups (project_id, id) on delete set null (rcd_group_id)`,
    so a circuit can only join a group of its own project
  - `position`, `name` (trimmed, 1–100)
  - `rated_current_a` CHECK list, `phase_count` CHECK (1,3), `cross_section_mm2 numeric(3,1)` CHECK list
  - `installation public.wlz_installation`, `entry_side public.entry_side`
  - timestamps
- **`project_devices`:**
  - `id`, `project_id → projects cascade`, `position`
  - `role text` CHECK in (`main_switch`,`rcd`,`rcbo`,`mcb`)
  - `rcd_group_id` / `circuit_id` nullable, with composite FKs to the same project,
    `on delete cascade`
  - `device_id uuid not null → devices` (devices are never deleted)
  - `notes text[]`
  - **snapshot columns** `kind, name, manufacturer, model, price_grosze, width_mm, height_mm,
depth_mm, poles, rated_current_a, residual_current_ma, rcd_type, breaking_capacity_ka`, each with
    a default so the generated `Insert` type leaves them optional (same trick as `projects`)
  - `created_at`
- **Trigger `project_devices_snapshot_device`:** BEFORE INSERT, security invoker, `search_path = ''`.
  It copies from `public.devices where id = new.device_id and archived_at is null`, else raises
  `P0002`. There is no UPDATE grant: snapshot rows are only inserted and deleted.
- **Trigger `projects_clear_device_snapshot`:** AFTER UPDATE on `projects` when any of the seven
  supply columns changed. It deletes that project's `project_devices`.
- **RPC** `public.save_project_circuits(p_project_id uuid, p_groups jsonb, p_circuits jsonb, p_device_ids jsonb) returns void`:
  - security invoker, so all RLS applies;
  - upserts groups and circuits by id, then deletes the rows missing from the payload;
  - deletes all `project_devices` for the project, then inserts the new ones from `p_device_ids`
    (ordered `{device_id, role, rcd_group_id, circuit_id, notes}`);
  - an empty device array means "gap — no snapshot";
  - raises `P0002` with `errcode` and a distinct message hint when the project is not visible, and
    lets the snapshot trigger's `P0002` propagate;
  - grant execute to `authenticated` only.
- **Privileges:** revoke all from anon/authenticated on the three tables (local auto-grant
  and TRUNCATE, as in earlier migrations). Then:
  - groups and circuits: grant select/insert/update/delete;
  - `project_devices`: grant select/insert/delete.
- **RLS policies, per table and per operation:**
  - `using` / `with check`:
    `exists (select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid()))`;
  - writes additionally require
    `coalesce((select auth.jwt()) ->> 'user_role','') = 'elektryk'`;
  - no admin policy;
  - index on `project_id` for each table.

#### 2. Generated types and seed

**File**: `src/lib/database.types.ts` (via `npm run db:types`); `supabase/seed.sql`

**Intent**: Regenerate the types after the migration. Add FR 2P 40 A, FR 2P 63 A, FR 4P 40 A and
FR 4P 63 A rows, so the single-phase and TN-S/TN-C-S three-phase demo paths match. Keep the
deliberate B40 gap and the cheaper B16.

**Contract**: the new FR rows follow the existing seed row style (`seed.sql:152-154`) and must pass
`parseDeviceSpec` (add them to any seed-parse test if one exists).

#### 3. RLS integration tests

**File**: `tests/integration/rls-circuits.test.ts`

**Intent**: Prove the isolation and the snapshot guarantees against the live local stack, following
`rls-projects.test.ts`.

**Contract**: the tests assert that:

- A can save circuits/groups/devices through the RPC on their own project;
- B cannot read, insert, update or delete A's rows;
- B upserting with A's circuit id raises `42501` and leaves A's row unchanged;
- the admin sees none of the rows and cannot call the RPC successfully;
- a client-sent snapshot price is ignored, and the trigger copies the catalog price;
- an archived device raises `P0002` and rolls back the whole RPC (circuits unchanged);
- a circuit cannot reference another project's group (FK violation);
- updating the supply clears `project_devices` while a name-only update does not;
- deleting the project cascades.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on a fresh stack: `npx supabase db reset`
- Types regenerate with no manual edits: `npm run db:types`
- RLS integration tests pass: `npm run test:integration`
- Unit tests pass: `npm run test:unit`
- Lint and type check pass: `npm run lint` and `npx astro check`

#### Manual Verification:

- In Supabase Studio, the three tables show RLS enabled and no admin policy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Endpoints and the server-rendered result

### Overview

The save-and-match endpoint, the re-match endpoint, the loaders, and the "Obwody i dobór aparatów"
section with its result panel and aside badge. Circuits can be exercised through a temporary plain
JSON textarea only if needed. The real editor lands in Phase 4.

### Changes Required:

#### 1. Paths, error codes, i18n

**File**: `src/lib/project.ts`, `src/lib/project-errors.ts`, `src/lib/i18n/pl.ts`

**Intent**: Add the endpoint paths and error codes, and add every Polish string: section, editor
labels, roles, gap and blocker messages, warning texts, badges and notes.

**Contract**:

- **Paths:** `projectCircuitsApiPath(id)`, `projectRematchApiPath(id)`.
- **Error codes:** `PROJECT_ERROR.deviceUnavailable = "device_unavailable"` and
  `circuitsInvalid = "circuits_invalid"`, with `MESSAGES` entries.
- **P0002 mapping:** it stays `cabinet_unavailable` in the cabinet endpoints. The circuits endpoints
  map P0002 themselves to `device_unavailable` rather than changing the global mapper.
- **i18n:** new `t.circuits.*`, `t.matching.*` and `t.circuitWarnings.*` groups, plus
  `t.projects.page.savedCircuits` and `t.projects.page.matchingStatus` badge texts. Use `plural()`
  for "N aparatów" and `formatMoney` for prices.

#### 2. Catalog loader and match orchestration

**File**: `src/lib/device-matching-server.ts` (or a function in the endpoint module, whichever keeps the page and both endpoints DRY)

**Intent**: One place that loads the project's supply, circuits, groups and active devices under the
caller's RLS. It parses each device with `parseDeviceSpec`, dropping and logging (SQLSTATE or id
only) any that fail, and runs `matchDevices`. The page and both endpoints call it.

**Contract**:

- `loadMatchContext(supabase, projectId)` returns `{ supply, groups, circuits, catalog, snapshot }`
  or a load error.
- The catalog query repeats `.is("archived_at", null)`.

#### 3. Save-and-match endpoint

**File**: `src/pages/api/projects/[id]/circuits.ts`

**Intent**: FormData with the payload field is parsed with `parseCircuitsPayload`. The endpoint then
loads the supply and catalog, runs `matchDevices` on the submitted set, calls
`save_project_circuits` with the selections (an empty array on gaps or blocked), and redirects.

**Contract**:

- Same guard sequence as `supply.ts`.
- An invalid payload goes to `?error=circuits_invalid`. The island has already shown per-field
  issues, so this is the tampered-POST path.
- An RPC P0002 whose message marks the device path goes to `device_unavailable`, and a project that
  is not visible goes to `not_found` (the list).
- Success, including a stored gap, redirects to `?saved=circuits#circuits`.

#### 4. Re-match endpoint

**File**: `src/pages/api/projects/[id]/rematch.ts`

**Intent**: Re-run matching on the **stored** circuits and replace the snapshot. It backs the
"Dobierz ponownie" button after a catalog or supply change, with no editor round-trip.

**Contract**: POST with no body fields. It calls the same RPC with the stored groups and circuits
unchanged and redirects to `?saved=rematch#circuits`.

#### 5. Project page section and aside

**File**: `src/pages/dashboard/projects/[id].astro`; new `src/components/projects/MatchResult.astro`

**Intent**: Render the section from `loadMatchContext`. The page computes a fresh `MatchResult` and
compares it with the stored snapshot through `sameSelection`, which gives four states:

- **Matched and current:** the snapshot list.
- **Stale:** the snapshot list, a warning and "Dobierz ponownie".
- **Cleared by a supply change:** the fresh preview, a warning and "Dobierz ponownie".
- **Gaps or blocked:** destructive alerts listing each gap with the contact-admin line, or each
  blocker with its fix link.

Circuit warnings render as warning alerts, following the supply-warnings markup. The section is
added to `sections` between supply and delete, and the aside gets the matching badge.

**Contract**:

- The section id is `circuits`.
- `saved=circuits` and `saved=rematch` are added to the flash mapping.
- Nothing is shown as "matched" unless it comes from the stored snapshot. The fresh result is used
  only for gaps, blockers and the stale check.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (including new `project-errors` cases): `npm run test:unit`
- Lint, type check and build pass: `npm run lint`, `npx astro check`, `npm run build`
- RLS integration tests still pass: `npm run test:integration`

#### Manual Verification:

- On the seeded stack, a project with no supply shows the "uzupełnij przyłącze" blocker linking to `#supply`
- A project whose circuits include B40 shows a catalog-gap error naming "B40" and the circuit, with the contact-admin line and no substitute device
- Changing the supply after a match shows the stale state; "Dobierz ponownie" restores a current snapshot

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Drag-and-drop circuit editor

### Overview

The `CircuitEditor` island: group cards and a "Bez grupy" area, sortable circuit rows that can be
dragged within and across groups, sortable groups, and keyboard and button equivalents for every
drag. It adds a new dependency, gets kitchen-sink coverage, is verified in the browser, and closes
out the docs.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `@dnd-kit/core` and `@dnd-kit/sortable` (+ `@dnd-kit/utilities` if needed).
**This adds a dependency**, justified by its accessible keyboard dragging, its screen-reader
announcements and its support for sorting across multiple containers. Nothing in the repo does
drag-and-drop today.

**Contract**: `npm install @dnd-kit/core @dnd-kit/sortable`. Confirm React 19 peer compatibility at
install time. If the peer range refuses React 19, stop and ask rather than forcing.

#### 2. Editor island

**File**: `src/components/circuits/CircuitEditor.tsx` (+ small subcomponents in the same folder)

**Intent**: Edit the draft through the `circuit-draft.ts` operations only.

**Contract**:

- **Drag and drop:**
  - `DndContext` with pointer and keyboard sensors.
  - One `SortableContext` for the groups, plus one per container (each group and "Bez grupy") for
    its circuits.
  - `onDragOver` / `onDragEnd` call `moveCircuit` / `moveGroup`.
  - A drag handle (grip icon, `aria-label` from i18n) on each group card and circuit row.
  - A `DragOverlay` shows the dragged row.
  - Announcements go through dnd-kit `accessibility.announcements`, with the Polish strings in
    `pl.ts`.
- **Non-drag equivalents:**
  - A "Grupa" select on each row (groups + "Bez grupy").
  - Move up/down icon buttons on circuits and groups.
  - Remove buttons.
- **Group card:**
  - label, IΔn select, minimum type select, circuit count;
  - a "1 obwód → zostanie dobrany RCBO" hint when a group has exactly one circuit;
  - the group's rows.
- **Circuit row:**
  - name input and selects for In, phases, cross-section, installation method and entry side;
  - the cabinet's entry sides are listed first, and others are marked "brak w szafce".
- **Validation and submit:**
  - Client validation runs through `parseCircuitsPayload`, with field-level issues shown via the
    existing `src/components/forms/fields.tsx` and `field-a11y` helpers.
  - Submit posts a native form with a hidden payload JSON field, following `CabinetEditor.tsx:308-315`.
    It saves a sessionStorage draft and restores it on an `?error=` redirect
    (`src/components/forms/draft-storage.ts`).
  - The submit button is labelled "Zapisz obwody i dobierz aparaty".
- **Styling:** token classes only and `cn()`. No palette classes, hex values or `rgba()`.
- **Mounting:** the island is mounted on the project page with `client:only="react"`, inside the
  `circuits` section, above `MatchResult`. Initial data comes from `payloadToDraft`, the entry sides
  from the parsed cabinet snapshot, and the action from `projectCircuitsApiPath`.

#### 3. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro`, `src/lib/i18n/pl.ts` (`devTools.kitchenSink`)

**Intent**: Every new UI state appears there first, per AGENTS.md `## UI`.

**Contract**:

- Editor states: empty; filled (2 groups + ungrouped); single-circuit group with the RCBO hint;
  invalid row; entry side missing from the cabinet.
- `MatchResult` states: matched (with an `rcbo_fallback` note); gaps; blocked by supply; blocked by
  TN-C; stale.
- Circuit warnings.

#### 4. Docs

**File**: `AGENTS.md`, `README.md`

**Intent**:

- Add tripwires:
  - circuit value lists are guarded twice (the migration CHECKs + `circuit-params.ts`), and the
    two must change together;
  - `project_devices` snapshot columns are written only by `project_devices_snapshot_device`;
    S-08 reads the snapshot, never the live catalog;
  - a supply change clears the snapshot;
  - the matcher filters for correctness before price, and exact In for overcurrent protection is
    deliberate.
- Update the product-code summary line and the README project-page route description.

**Contract**: tripwires in the existing bullet style, and the `@`-paths referenced rather than
pasted.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint, type check and build pass: `npm run lint`, `npx astro check`, `npm run build`
- RLS integration tests pass: `npm run test:integration`
- Smoke passes against the dev server: `npm run smoke`

#### Manual Verification:

- Kitchen sink renders every editor and result state listed above; screenshot captured
- In the browser: drag a circuit from group 1 to group 2, reorder groups, drag a circuit to "Bez grupy"; after save the order and membership persist on reload
- Keyboard only: pick up a circuit with Space, move with arrows, drop with Space; the move is announced; the select and up/down buttons reach the same result
- A seeded single-phase project with two groups (B16 + B10 circuits, 30 mA type A) and one single-circuit group matches FR 2P, RCD 2P type A (never AC), the cheaper B16, and an RCBO; the prices shown equal the catalog prices
- After an `?error=` redirect the editor restores the unsaved draft

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `circuit-params.test.ts`: each list is rejected outside its values, and ids must be UUIDs.
  Rejected payloads: duplicate ids, `unknown_group`, overlong names, `too_many`, a non-object.
  Stored rows re-parse unchanged.
- `circuit-warnings.test.ts`: the ampacity table is complete; the 1.5 mm² values are pinned; the
  boundaries In = ampacity (no warning) and In = ampacity + 1 (warning); the bar terminal count and
  range warnings; a cabinet with no bars.
- `circuit-draft.test.ts`: every operation, including cross-container moves at the first, middle and
  last index, removing a group while keeping order, and invalid ids as no-ops.
- `device-matching.test.ts`: every rule-table row and every "tests must pin" item in Phase 1 §4,
  written as small catalog fixtures (not the seed).

### Integration Tests:

- `tests/integration/rls-circuits.test.ts`, as listed in Phase 2 §3.

### Manual Testing Steps:

1. Create a single-phase TN-S project on the PRZ-M3 cabinet, fill the supply, and add groups and
   circuits by drag-and-drop. Check the matched list and the prices.
2. Add a B40 circuit and check the gap message. Remove it and check that the match is back.
3. Switch the supply to TN-C and check the RCD blocker. Switch back and check the stale state, then
   run "Dobierz ponownie".
4. Archive a matched device as the admin. As the electrician, check the stale hint and run the
   re-match.
5. Sign in as a second electrician and open the first one's project URL, which must give a 404.
6. Run the keyboard-only drag-and-drop pass.

## Performance Considerations

The catalog is tens of rows and a project has at most 60 circuits, so matching is a linear filter
per role and runs on each page render in well under a millisecond. There is one catalog query per
render and per save, with no caching.

## Migration Notes

This is a new migration, forward-compatible with the deployed code: it adds tables and triggers
only. The supply-clear trigger only deletes rows from a table the current code does not read. In the
cloud catalog the admin must add FR 2P/4P devices by hand, because the seed never reaches the cloud.
Otherwise single-phase and three-phase TN-S projects there will show a main-switch catalog gap,
which is the correct behaviour.

## References

- Roadmap: `context/foundation/roadmap.md` §S-04
- PRD: `context/foundation/prd.md` FR-006, FR-007, `## Business Logic`, `## Success Criteria`
- Prior contracts: `context/archive/2026-09-24-project-setup-and-supply-params/change.md:17-25`, `context/archive/2026-09-23-admin-device-catalog/change.md:17-22`
- Snapshot trigger pattern: `supabase/migrations/20260924150000_projects.sql:151-181`
- Editor pattern: `src/components/cabinets/CabinetEditor.tsx:178-315`, `src/lib/cabinet-form.ts:53-73`
- Endpoint pattern: `src/pages/api/projects/[id]/supply.ts`
- Ampacity source: `src/lib/supply-warnings.ts` (`AMPACITY_A`, `REFERENCE_METHOD_BY_INSTALLATION`)

## Addendum (implementation and impl-review, 2026-09-30)

Behaviour that landed beyond the phases above. Everything except the last group came from implementation.

- **Matcher.** A circuit that points at a group missing from the payload is blocked
  (`circuit_group_unknown`); it is not treated as ungrouped. An empty RCD group is skipped and gets
  no RCD.
- **View states.** There is a fifth state, `cleared`: a fresh match succeeds, the snapshot is
  empty, and the fresh result is shown as a labelled, unsaved preview. The aside also has
  "Zablokowany" and "Niedostępny" badges.
- **RPC.** A group or circuit id that belongs to another project of the **same** owner is refused
  with 42501 and rolled back. The endpoints map 42501 to `forbidden`. AGENTS.md has a fifth
  tripwire: upsert by stable id via `saveCircuitsArgs`.
- **impl-review F5 — the group RCD rule changed.** The rule table's `rated_current_a ≥ max(In of
the group's circuits)` is replaced:
  - The rule is now `rated_current_a × 100 ≥ ΣIn × (100 + rcd_margin_percent)`. It is compared in
    integers, and the RCD of an RCBO fallback is sized the same way.
  - `rcd_margin_percent` is a per-group field: list `0, 5, 10, 15, 20, 25, 30, 40, 50`, default 15,
    selectable in the group card.
  - It is guarded twice: in `RCD_MARGINS_PERCENT` in `circuit-params.ts` and in the
    `rcd_groups_margin_valid` CHECK in `20260930120000_rcd_group_margin.sql`.
  - For forward compatibility, the RPC falls back to 15 when a group arrives without the field.
  - The sum ignores how single-phase circuits spread across phases, so it errs on the high side.
  - With only 40 A RCDs in the seed, a group whose ΣIn × margin exceeds 40 A is a catalog gap.
    The gap text names the sum and the margin.
- **impl-review F2 / F7.** Devices dropped as unparseable are now logged by id. `loadMatchBase`
  (supply + cabinet + catalog) is split out: the save endpoint uses it, and the page passes its
  already-loaded project row.
- **impl-review F1.** S-08 and S-09 act only on view state `current`; see the AGENTS.md
  `project_devices` tripwire and change.md.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Domain logic (pure, unit-tested)

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:unit` — 648219f
- [x] 1.2 Lint passes: `npm run lint` — 648219f
- [x] 1.3 Type check passes: `npx astro check` — 648219f

#### Manual

- [x] 1.4 Electrician verifies the 1.5 mm² Cu ampacity values against PN-HD 60364-5-52 tables B.52.2 / B.52.4 and the comment is updated with the verification date — 648219f
- [x] 1.5 Electrician reviews the matching rule table (poles per system, exact In, IΔn exact, type rank, RCD In ≥ max MCB, FR ≥ premeter) and confirms it matches practice — 648219f

### Phase 2: Database — circuits, groups, device snapshot

#### Automated

- [x] 2.1 Migration applies cleanly on a fresh stack: `npx supabase db reset` — 53d5b4f
- [x] 2.2 Types regenerate with no manual edits: `npm run db:types` — 53d5b4f
- [x] 2.3 RLS integration tests pass: `npm run test:integration` — 53d5b4f
- [x] 2.4 Unit tests pass: `npm run test:unit` — 53d5b4f
- [x] 2.5 Lint and type check pass: `npm run lint` and `npx astro check` — 53d5b4f

#### Manual

- [x] 2.6 In Supabase Studio, the three tables show RLS enabled and no admin policy — 53d5b4f

### Phase 3: Endpoints and the server-rendered result

#### Automated

- [x] 3.1 Unit tests pass (including new `project-errors` cases): `npm run test:unit` — 389442a
- [x] 3.2 Lint, type check and build pass: `npm run lint`, `npx astro check`, `npm run build` — 389442a
- [x] 3.3 RLS integration tests still pass: `npm run test:integration` — 389442a

#### Manual

- [x] 3.4 On the seeded stack, a project with no supply shows the "uzupełnij przyłącze" blocker linking to `#supply` — 389442a
- [x] 3.5 A project whose circuits include B40 shows a catalog-gap error naming "B40" and the circuit, with the contact-admin line and no substitute device — 389442a
- [x] 3.6 Changing the supply after a match shows the stale state; "Dobierz ponownie" restores a current snapshot — 389442a

### Phase 4: Drag-and-drop circuit editor

#### Automated

- [x] 4.1 Unit tests pass: `npm run test:unit` — 8f9ac8a
- [x] 4.2 Lint, type check and build pass: `npm run lint`, `npx astro check`, `npm run build` — 8f9ac8a
- [x] 4.3 RLS integration tests pass: `npm run test:integration` — 8f9ac8a
- [x] 4.4 Smoke passes against the dev server: `npm run smoke` — 8f9ac8a

#### Manual

- [x] 4.5 Kitchen sink renders every editor and result state listed above; screenshot captured — 8f9ac8a
- [x] 4.6 In the browser: drag a circuit from group 1 to group 2, reorder groups, drag a circuit to "Bez grupy"; after save the order and membership persist on reload — 8f9ac8a
- [x] 4.7 Keyboard only: pick up a circuit with Space, move with arrows, drop with Space; the move is announced; the select and up/down buttons reach the same result — 8f9ac8a
- [x] 4.8 A seeded single-phase project with two groups (B16 + B10 circuits, 30 mA type A) and one single-circuit group matches FR 2P, RCD 2P type A (never AC), the cheaper B16, and an RCBO; the prices shown equal the catalog prices — 8f9ac8a
- [x] 4.9 After an `?error=` redirect the editor restores the unsaved draft — 8f9ac8a
