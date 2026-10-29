import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBusinessForm } from "@/lib/business-profile";
import { parseCabinetForm } from "@/lib/cabinet-form";
import { parseCircuitsPayload } from "@/lib/circuit-params";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Database, Enums, Json } from "@/lib/database.types";
import { parseDeviceSpec, type DeviceKind } from "@/lib/device-spec";
import { parsePricingForm } from "@/lib/pricing-profile";
import { parseProjectDetailsForm } from "@/lib/project";
import { parseLabourOverrideForm } from "@/lib/quote";
import { parseSupplyForm } from "@/lib/supply-params";
import {
  SEEDED_ADMIN,
  createElectrician,
  createServiceClient,
  readStackEnv,
  signIn,
  type Electrician,
  type ServiceClient,
  type UserClient,
} from "./support";

/**
 * CHECK-to-parser parity. `context/foundation/agent-rules/data-guards.md` lists every "guarded twice"
 * pair — a database CHECK and a TypeScript parser that encode the same rule. A new pair there needs a
 * `describe` here: one fixture table drives BOTH guards, and each row asserts the same literal
 * verdict on both sides:
 *
 *   - `valid`:           the parser accepts and the database accepts the write;
 *   - `invalid`:         the parser rejects and the database answers `23514` (check_violation);
 *   - `parser-stricter`: the parser rejects and the database accepts — the recorded, safe-direction
 *                        asymmetries (a `numeric` column rounds an extra decimal place silently, a
 *                        checksum or a JSON shape is checked in TypeScript only).
 *
 * Verdicts are literals taken from the CHECK text and the PRD, never computed from the parser's own
 * `MIN_` / `MAX_` constants — a constant changed on one side only must fail a row, not move with it.
 *
 * What is written to the database: where the parser accepts, the endpoint would write the parser's
 * OUTPUT (trimmed, comma decimals resolved, blank turned into null), so that is what the adapter
 * writes; where the parser rejects, the endpoint never writes, so the adapter writes the RAW row
 * value to ask the database the same question. Every accepted write is reverted or deleted at once,
 * so each row starts from a known state.
 *
 * Not covered on purpose: enum-typed columns (earthing system, installation, rcd type, entry side).
 * An off-list enum value is refused by the type cast with 22P02, not by a CHECK, so it has no
 * `23514` verdict to compare. An integer overflow is likewise refused by 22003, not by a CHECK.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

type Verdict = "valid" | "invalid" | "parser-stricter";

interface Fixture<Row> {
  label: string;
  row: Row;
  verdict: Verdict;
}

interface Adapter<Row, Parsed> {
  /** `toParserInput` builds what the endpoint's parser sees, and returns its output or `null` when it rejects. */
  parse: (row: Row) => Parsed | null;
  /** `writeToDatabase`: the Postgres error code, or `null` on success. Cleans up after itself. */
  write: (row: Row, parsed: Parsed | null) => Promise<string | null>;
}

/** Registers one `it` per fixture row, asserting its verdict on the parser and on the database. */
function runParity<Row, Parsed>(fixtures: readonly Fixture<Row>[], adapter: Adapter<Row, Parsed>): void {
  for (const { label, row, verdict } of fixtures) {
    it(`${verdict}: ${label}`, async () => {
      const parsed = adapter.parse(row);
      const code = await adapter.write(row, parsed);

      if (verdict === "valid") {
        expect(parsed, "the parser must accept").not.toBeNull();
        expect(code, "the database must accept").toBeNull();
      } else if (verdict === "invalid") {
        expect(parsed, "the parser must reject").toBeNull();
        expect(code, "the database must refuse with check_violation").toBe("23514");
      } else {
        expect(parsed, "the parser must reject").toBeNull();
        expect(code, "the database must accept").toBeNull();
      }
    });
  }
}

type DeviceRow = Database["public"]["Tables"]["devices"]["Insert"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

const GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 200, heightMm: 150, depthMm: 80 },
  rails: [{ xMm: 10, yMm: 50, lengthMm: 180 }],
  entries: [{ side: "top", offsetMm: 20, lengthMm: 100 }],
  bars: [],
};

/** A project with no supply, no company text beyond its name and no labour override. */
const PROJECT_BASELINE: ProjectUpdate = {
  name: "Projekt parytetu",
  client_name: null,
  site_address: null,
  premeter_protection_a: null,
  earthing_system: null,
  phase_count: null,
  wlz_length_m: null,
  wlz_cross_section_mm2: null,
  wlz_material: null,
  wlz_installation: null,
  labour_minutes_override: null,
  labour_override_base_minutes: null,
};

describe("CHECK to parser parity", () => {
  const createdUserIds: string[] = [];
  const createdCabinetIds: string[] = [];

  let service: ServiceClient;
  let owner: Electrician;
  let ownerClient: UserClient;
  let adminClient: UserClient;
  let projectId: string;
  let cabinetId: string;

  /** Updates the shared project as its owner; refuses to treat an RLS-filtered (zero-row) update as a verdict. */
  async function updateProject(patch: ProjectUpdate): Promise<string | null> {
    const { data, error } = await ownerClient.from("projects").update(patch).eq("id", projectId).select("id");
    if (error) return error.code;
    if (data.length !== 1) throw new Error("The project update touched no row: that is a test setup fault.");
    return null;
  }

  async function resetProject(): Promise<void> {
    const { error } = await service.from("projects").update(PROJECT_BASELINE).eq("id", projectId);
    if (error) throw new Error(`Could not reset the parity project: ${error.code}`);
  }

  /** The write adapter shared by every `projects` pair: write, then restore the baseline if it stuck. */
  async function writeProject(patch: ProjectUpdate): Promise<string | null> {
    const code = await updateProject(patch);
    if (code === null) await resetProject();
    return code;
  }

  beforeAll(async () => {
    const env = readStackEnv();
    service = createServiceClient(env);

    owner = await createElectrician(service, "parity");
    createdUserIds.push(owner.id);
    ({ client: ownerClient } = await signIn(env, owner.email, owner.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const cabinet = await service
      .from("cabinets")
      .insert({
        name: "Szafka parytetu",
        manufacturer: "Producent testowy parytetu",
        model: `PARITY-${randomUUID()}`,
        price_grosze: 10000,
        geometry: GEOMETRY,
      })
      .select("id")
      .single();
    if (cabinet.error) throw new Error(`Could not create the parity cabinet: ${cabinet.error.message}`);
    createdCabinetIds.push(cabinet.data.id);
    cabinetId = cabinet.data.id;

    const project = await ownerClient
      .from("projects")
      .insert({ user_id: owner.id, name: "Projekt parytetu", cabinet_id: cabinet.data.id })
      .select("id")
      .single();
    if (project.error) throw new Error(`Could not create the parity project: ${project.error.code}`);
    projectId = project.data.id;
  });

  afterAll(async () => {
    // Deleting the auth user cascades to the project, its circuits and both profile rows; only then
    // is the cabinet free of the `cabinet_id` foreign key.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
    if (createdCabinetIds.length > 0) {
      const { error } = await service.from("cabinets").delete().in("id", createdCabinetIds);
      if (error) throw new Error(`Test cabinets were not cleaned up: ${error.code}`);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Device spec: parseDeviceSpec <-> devices_parameters_match_kind (20261009120100_comb_busbar_parameters.sql)
  // and the price / dimension checks in 20260923130628_devices_catalog.sql. The row is the `devices`
  // row shape, which is also exactly what `parseDeviceSpec` takes.
  // ---------------------------------------------------------------------------------------------
  describe("device spec", () => {
    const NO_PARAMETERS = {
      poles: null,
      rated_current_a: null,
      residual_current_ma: null,
      rcd_type: null,
      breaking_capacity_ka: null,
      terminal_groups: null,
      n_terminal_side: null,
    } as const;

    const PARAMETERS: Record<DeviceKind, Partial<DeviceRow>> = {
      switch_disconnector: { poles: "3P", rated_current_a: 63 },
      rcd: { poles: "2P", rated_current_a: 40, residual_current_ma: 30, rcd_type: "A", n_terminal_side: "left" },
      rcbo: {
        poles: "1P+N",
        rated_current_a: 16,
        residual_current_ma: 30,
        rcd_type: "A",
        breaking_capacity_ka: 6,
        n_terminal_side: "right",
      },
      mcb_b: { poles: "1P", rated_current_a: 16, breaking_capacity_ka: 6 },
      comb_busbar: { poles: "3P", rated_current_a: 63 },
      pe_bar: { terminal_groups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }] },
      n_bar: { terminal_groups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }] },
    };

    /** A fresh model per row, so the unique (manufacturer, model) index never decides a verdict. */
    function device(kind: DeviceKind, overrides: Partial<DeviceRow> = {}): DeviceRow {
      return {
        kind,
        name: "Aparat parytetu",
        manufacturer: "Producent testowy parytetu",
        model: `PARITY-${randomUUID()}`,
        price_grosze: 1000,
        width_mm: 17.5,
        height_mm: 85,
        depth_mm: 70,
        ...NO_PARAMETERS,
        ...PARAMETERS[kind],
        ...overrides,
      };
    }

    const fixtures: Fixture<DeviceRow>[] = [
      // One valid row per kind.
      { label: "switch-disconnector 3P", row: device("switch_disconnector"), verdict: "valid" },
      { label: "rcd 2P with its N side", row: device("rcd"), verdict: "valid" },
      { label: "rcbo 1P+N with its N side", row: device("rcbo"), verdict: "valid" },
      { label: "mcb_b 1P", row: device("mcb_b"), verdict: "valid" },
      { label: "comb busbar 3P (3F)", row: device("comb_busbar"), verdict: "valid" },
      { label: "pe_bar with one terminal group", row: device("pe_bar"), verdict: "valid" },
      { label: "n_bar with one terminal group", row: device("n_bar"), verdict: "valid" },
      // Comb busbar poles: 1P is a 1F busbar, 3P a 3F one, nothing else.
      { label: "comb busbar 1P (1F)", row: device("comb_busbar", { poles: "1P" }), verdict: "valid" },
      {
        label: "comb busbar 2P",
        row: device("comb_busbar", { poles: "2P", n_terminal_side: "left" }),
        verdict: "invalid",
      },
      {
        label: "comb busbar 4P",
        row: device("comb_busbar", { poles: "4P", n_terminal_side: "left" }),
        verdict: "invalid",
      },
      {
        label: "comb busbar 1P+N",
        row: device("comb_busbar", { poles: "1P+N", n_terminal_side: "left" }),
        verdict: "invalid",
      },
      // Off-set poles for the other kinds.
      { label: "rcd 1P", row: device("rcd", { poles: "1P", n_terminal_side: null }), verdict: "invalid" },
      { label: "rcd 3P", row: device("rcd", { poles: "3P", n_terminal_side: null }), verdict: "invalid" },
      {
        label: "rcd 4P with its N side",
        row: device("rcd", { poles: "4P", n_terminal_side: "right" }),
        verdict: "valid",
      },
      { label: "rcbo 1P", row: device("rcbo", { poles: "1P", n_terminal_side: null }), verdict: "invalid" },
      {
        label: "switch-disconnector 1P+N",
        row: device("switch_disconnector", { poles: "1P+N", n_terminal_side: "left" }),
        verdict: "invalid",
      },
      { label: "switch-disconnector 1P", row: device("switch_disconnector", { poles: "1P" }), verdict: "valid" },
      {
        label: "mcb_b 3P+N with its N side",
        row: device("mcb_b", { poles: "3P+N", n_terminal_side: "right" }),
        verdict: "valid",
      },
      {
        label: "mcb_b 4P with its N side",
        row: device("mcb_b", { poles: "4P", n_terminal_side: "left" }),
        verdict: "valid",
      },
      // A missing required parameter.
      { label: "poles missing", row: device("mcb_b", { poles: null }), verdict: "invalid" },
      { label: "rated current missing", row: device("mcb_b", { rated_current_a: null }), verdict: "invalid" },
      { label: "breaking capacity missing", row: device("mcb_b", { breaking_capacity_ka: null }), verdict: "invalid" },
      { label: "rcd residual current missing", row: device("rcd", { residual_current_ma: null }), verdict: "invalid" },
      { label: "rcd type missing", row: device("rcd", { rcd_type: null }), verdict: "invalid" },
      {
        label: "rcbo breaking capacity missing",
        row: device("rcbo", { breaking_capacity_ka: null }),
        verdict: "invalid",
      },
      { label: "bar terminal groups missing", row: device("pe_bar", { terminal_groups: null }), verdict: "invalid" },
      // A foreign parameter.
      { label: "mcb_b with a residual current", row: device("mcb_b", { residual_current_ma: 30 }), verdict: "invalid" },
      { label: "mcb_b with an rcd type", row: device("mcb_b", { rcd_type: "A" }), verdict: "invalid" },
      {
        label: "mcb_b with terminal groups",
        row: device("mcb_b", { terminal_groups: [{ count: 4, minMm2: 1.5, maxMm2: 16 }] }),
        verdict: "invalid",
      },
      {
        label: "switch-disconnector with a breaking capacity",
        row: device("switch_disconnector", { breaking_capacity_ka: 6 }),
        verdict: "invalid",
      },
      { label: "rcd with a breaking capacity", row: device("rcd", { breaking_capacity_ka: 6 }), verdict: "invalid" },
      {
        label: "comb busbar with a breaking capacity",
        row: device("comb_busbar", { breaking_capacity_ka: 6 }),
        verdict: "invalid",
      },
      { label: "pe_bar with poles", row: device("pe_bar", { poles: "1P" }), verdict: "invalid" },
      { label: "n_bar with a rated current", row: device("n_bar", { rated_current_a: 16 }), verdict: "invalid" },
      // The N terminal side is present exactly when the poles carry N.
      { label: "mcb_b 1P with an N side", row: device("mcb_b", { n_terminal_side: "left" }), verdict: "invalid" },
      { label: "mcb_b 1P+N without an N side", row: device("mcb_b", { poles: "1P+N" }), verdict: "invalid" },
      { label: "rcd 2P without an N side", row: device("rcd", { n_terminal_side: null }), verdict: "invalid" },
      {
        label: "switch-disconnector 2P without an N side",
        row: device("switch_disconnector", { poles: "2P" }),
        verdict: "invalid",
      },
      {
        label: "switch-disconnector 2P with an N side",
        row: device("switch_disconnector", { poles: "2P", n_terminal_side: "left" }),
        verdict: "valid",
      },
      {
        label: "comb busbar 3P with an N side",
        row: device("comb_busbar", { n_terminal_side: "left" }),
        verdict: "invalid",
      },
      { label: "pe_bar with an N side", row: device("pe_bar", { n_terminal_side: "left" }), verdict: "invalid" },
      // Price, dimensions and text. `price_grosze > 0`, `width_mm > 0`, `length(trim(name)) > 0`.
      { label: "price of 1 grosz", row: device("mcb_b", { price_grosze: 1 }), verdict: "valid" },
      { label: "price of 0", row: device("mcb_b", { price_grosze: 0 }), verdict: "invalid" },
      { label: "negative price", row: device("mcb_b", { price_grosze: -1 }), verdict: "invalid" },
      { label: "width of 0.01 mm", row: device("mcb_b", { width_mm: 0.01 }), verdict: "valid" },
      { label: "width of 0", row: device("mcb_b", { width_mm: 0 }), verdict: "invalid" },
      { label: "height of 0", row: device("mcb_b", { height_mm: 0 }), verdict: "invalid" },
      { label: "negative depth", row: device("mcb_b", { depth_mm: -1 }), verdict: "invalid" },
      { label: "blank name", row: device("mcb_b", { name: "   " }), verdict: "invalid" },
      { label: "blank model", row: device("mcb_b", { model: "" }), verdict: "invalid" },
      { label: "empty terminal group list", row: device("pe_bar", { terminal_groups: [] }), verdict: "invalid" },
      // Parser-stricter: a `numeric` column rounds an extra decimal place silently, and the database
      // checks only the envelope of the terminal groups.
      {
        label: "width with a third decimal place",
        row: device("mcb_b", { width_mm: 17.505 }),
        verdict: "parser-stricter",
      },
      {
        label: "height with a second decimal place",
        row: device("mcb_b", { height_mm: 85.05 }),
        verdict: "parser-stricter",
      },
      {
        label: "depth with a second decimal place",
        row: device("mcb_b", { depth_mm: 70.05 }),
        verdict: "parser-stricter",
      },
      {
        label: "breaking capacity with a second decimal place",
        row: device("mcb_b", { breaking_capacity_ka: 6.05 }),
        verdict: "parser-stricter",
      },
      {
        label: "terminal group with a zero count",
        row: device("pe_bar", { terminal_groups: [{ count: 0, minMm2: 1.5, maxMm2: 16 }] }),
        verdict: "parser-stricter",
      },
      {
        label: "terminal group with min above max",
        row: device("pe_bar", { terminal_groups: [{ count: 4, minMm2: 16, maxMm2: 1.5 }] }),
        verdict: "parser-stricter",
      },
    ];

    runParity<DeviceRow, DeviceRow>(fixtures, {
      parse: (row) => {
        const result = parseDeviceSpec(row);
        return result.ok ? { ...result.spec } : null;
      },
      write: async (row, parsed) => {
        const { data, error } = await adminClient
          .from("devices")
          .insert(parsed ?? row)
          .select("id");
        for (const created of data ?? []) {
          const { error: cleanupError } = await service.from("devices").delete().eq("id", created.id);
          if (cleanupError) throw new Error(`Could not delete a parity device: ${cleanupError.code}`);
        }
        return error?.code ?? null;
      },
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Supply: parseSupplyForm <-> projects_premeter_protection_valid, projects_phase_count_valid,
  // projects_wlz_length_valid, projects_wlz_cross_section_valid and projects_supply_all_or_nothing
  // (20260924150000_projects.sql). The form sends every value as text, the length with a comma.
  // ---------------------------------------------------------------------------------------------
  describe("supply", () => {
    interface SupplyRow {
      premeter_protection_a: number | null;
      earthing_system: Enums<"earthing_system">;
      phase_count: number;
      wlz_length_m: number | null;
      wlz_cross_section_mm2: number;
      wlz_material: Enums<"conductor_material">;
      wlz_installation: Enums<"wlz_installation">;
    }

    const BASE: SupplyRow = {
      premeter_protection_a: 25,
      earthing_system: "TN-C-S",
      phase_count: 1,
      wlz_length_m: 15,
      wlz_cross_section_mm2: 10,
      wlz_material: "Cu",
      wlz_installation: "conduit_flush",
    };

    const fixtures: Fixture<SupplyRow>[] = [
      { label: "a typical supply", row: BASE, verdict: "valid" },
      // premeter_protection_a in (16, 20, 25, 32, 40, 50, 63)
      { label: "premeter protection 16 A", row: { ...BASE, premeter_protection_a: 16 }, verdict: "valid" },
      { label: "premeter protection 63 A", row: { ...BASE, premeter_protection_a: 63 }, verdict: "valid" },
      { label: "premeter protection 15 A", row: { ...BASE, premeter_protection_a: 15 }, verdict: "invalid" },
      { label: "premeter protection 64 A", row: { ...BASE, premeter_protection_a: 64 }, verdict: "invalid" },
      { label: "premeter protection 0 A", row: { ...BASE, premeter_protection_a: 0 }, verdict: "invalid" },
      // phase_count in (1, 3)
      { label: "three phases", row: { ...BASE, phase_count: 3 }, verdict: "valid" },
      { label: "two phases", row: { ...BASE, phase_count: 2 }, verdict: "invalid" },
      { label: "zero phases", row: { ...BASE, phase_count: 0 }, verdict: "invalid" },
      { label: "four phases", row: { ...BASE, phase_count: 4 }, verdict: "invalid" },
      // wlz_cross_section_mm2 in (2.5, 4, 6, 10, 16, 25, 35)
      { label: "cross-section 2.5 mm2", row: { ...BASE, wlz_cross_section_mm2: 2.5 }, verdict: "valid" },
      { label: "cross-section 35 mm2", row: { ...BASE, wlz_cross_section_mm2: 35 }, verdict: "valid" },
      { label: "cross-section 1.5 mm2", row: { ...BASE, wlz_cross_section_mm2: 1.5 }, verdict: "invalid" },
      { label: "cross-section 50 mm2", row: { ...BASE, wlz_cross_section_mm2: 50 }, verdict: "invalid" },
      { label: "cross-section 3 mm2", row: { ...BASE, wlz_cross_section_mm2: 3 }, verdict: "invalid" },
      // wlz_length_m > 0 and <= 500.0
      { label: "WLZ length 0 m", row: { ...BASE, wlz_length_m: 0 }, verdict: "invalid" },
      { label: "WLZ length 0.1 m", row: { ...BASE, wlz_length_m: 0.1 }, verdict: "valid" },
      { label: "WLZ length 12.5 m", row: { ...BASE, wlz_length_m: 12.5 }, verdict: "valid" },
      { label: "WLZ length 500 m", row: { ...BASE, wlz_length_m: 500 }, verdict: "valid" },
      { label: "WLZ length 500.1 m", row: { ...BASE, wlz_length_m: 500.1 }, verdict: "invalid" },
      // Every enum value the closed lists name is accepted by both sides.
      { label: "earthing TN-C", row: { ...BASE, earthing_system: "TN-C" }, verdict: "valid" },
      { label: "earthing TN-S", row: { ...BASE, earthing_system: "TN-S" }, verdict: "valid" },
      { label: "earthing TT", row: { ...BASE, earthing_system: "TT" }, verdict: "valid" },
      { label: "aluminium conductor", row: { ...BASE, wlz_material: "Al" }, verdict: "valid" },
      { label: "installation surface", row: { ...BASE, wlz_installation: "surface" }, verdict: "valid" },
      {
        label: "installation conduit_surface",
        row: { ...BASE, wlz_installation: "conduit_surface" },
        verdict: "valid",
      },
      { label: "installation in_wall", row: { ...BASE, wlz_installation: "in_wall" }, verdict: "valid" },
      { label: "installation in_ground", row: { ...BASE, wlz_installation: "in_ground" }, verdict: "valid" },
      // All seven or none: a form missing one field never reaches the database half-filled.
      { label: "premeter protection missing", row: { ...BASE, premeter_protection_a: null }, verdict: "invalid" },
      { label: "WLZ length missing", row: { ...BASE, wlz_length_m: null }, verdict: "invalid" },
      // Parser-stricter: `numeric` rounds a surplus decimal place and the CHECK sees the rounded value.
      { label: "WLZ length 12.34 m", row: { ...BASE, wlz_length_m: 12.34 }, verdict: "parser-stricter" },
      {
        label: "WLZ length 500.04 m (rounds to 500.0)",
        row: { ...BASE, wlz_length_m: 500.04 },
        verdict: "parser-stricter",
      },
      {
        label: "cross-section 2.51 mm2 (rounds to 2.5)",
        row: { ...BASE, wlz_cross_section_mm2: 2.51 },
        verdict: "parser-stricter",
      },
    ];

    function toParserInput(row: SupplyRow): FormData {
      const form = new FormData();
      for (const [name, value] of Object.entries(row)) {
        if (value === null) continue;
        form.set(name, name === "wlz_length_m" ? String(value).replace(".", ",") : String(value));
      }
      return form;
    }

    runParity<SupplyRow, SupplyRow>(fixtures, {
      parse: (row) => {
        const result = parseSupplyForm(toParserInput(row));
        return result.ok ? result.value : null;
      },
      write: (row, parsed) => writeProject(parsed ?? row),
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Circuits and groups: parseCircuitsPayload <-> rcd_groups_label_valid, rcd_groups_residual_current_valid
  // (20260929120000_circuits_and_device_matching.sql), rcd_groups_margin_valid
  // (20260930120000_rcd_group_margin.sql), circuits_name_valid, circuits_rated_current_valid,
  // circuits_phase_count_valid and circuits_cross_section_valid. The database side is the
  // `save_project_circuits` RPC, the app's one write path, with no devices.
  // ---------------------------------------------------------------------------------------------
  describe("circuits and groups", () => {
    interface CircuitRow {
      label: string;
      residual_current_ma: number;
      min_rcd_type: string;
      rcd_margin_percent: number;
      name: string;
      rated_current_a: number;
      phase_count: number;
      cross_section_mm2: number;
    }

    const BASE: CircuitRow = {
      label: "Kuchnia",
      residual_current_ma: 30,
      min_rcd_type: "A",
      rcd_margin_percent: 15,
      name: "Gniazda kuchnia",
      rated_current_a: 16,
      phase_count: 1,
      cross_section_mm2: 2.5,
    };

    const fixtures: Fixture<CircuitRow>[] = [
      { label: "a typical group with one circuit", row: BASE, verdict: "valid" },
      // circuits.rated_current_a in (6, 10, 13, 16, 20, 25, 32, 40, 50, 63)
      { label: "rated current 6 A", row: { ...BASE, rated_current_a: 6 }, verdict: "valid" },
      { label: "rated current 63 A", row: { ...BASE, rated_current_a: 63 }, verdict: "valid" },
      { label: "rated current 5 A", row: { ...BASE, rated_current_a: 5 }, verdict: "invalid" },
      { label: "rated current 7 A", row: { ...BASE, rated_current_a: 7 }, verdict: "invalid" },
      { label: "rated current 64 A", row: { ...BASE, rated_current_a: 64 }, verdict: "invalid" },
      // circuits.phase_count in (1, 3)
      { label: "three-phase circuit", row: { ...BASE, phase_count: 3 }, verdict: "valid" },
      { label: "two-phase circuit", row: { ...BASE, phase_count: 2 }, verdict: "invalid" },
      { label: "zero-phase circuit", row: { ...BASE, phase_count: 0 }, verdict: "invalid" },
      // circuits.cross_section_mm2 in (1.5, 2.5, 4, 6, 10, 16)
      { label: "cross-section 1.5 mm2", row: { ...BASE, cross_section_mm2: 1.5 }, verdict: "valid" },
      { label: "cross-section 16 mm2", row: { ...BASE, cross_section_mm2: 16 }, verdict: "valid" },
      { label: "cross-section 1 mm2", row: { ...BASE, cross_section_mm2: 1 }, verdict: "invalid" },
      { label: "cross-section 2 mm2", row: { ...BASE, cross_section_mm2: 2 }, verdict: "invalid" },
      { label: "cross-section 25 mm2", row: { ...BASE, cross_section_mm2: 25 }, verdict: "invalid" },
      // rcd_groups.residual_current_ma in (10, 30, 100, 300)
      { label: "residual current 10 mA", row: { ...BASE, residual_current_ma: 10 }, verdict: "valid" },
      { label: "residual current 300 mA", row: { ...BASE, residual_current_ma: 300 }, verdict: "valid" },
      { label: "residual current 20 mA", row: { ...BASE, residual_current_ma: 20 }, verdict: "invalid" },
      { label: "residual current 500 mA", row: { ...BASE, residual_current_ma: 500 }, verdict: "invalid" },
      { label: "residual current 0 mA", row: { ...BASE, residual_current_ma: 0 }, verdict: "invalid" },
      // rcd_groups.rcd_margin_percent in (0, 5, 10, 15, 20, 25, 30, 40, 50)
      { label: "margin 0 %", row: { ...BASE, rcd_margin_percent: 0 }, verdict: "valid" },
      { label: "margin 50 %", row: { ...BASE, rcd_margin_percent: 50 }, verdict: "valid" },
      { label: "margin 35 %", row: { ...BASE, rcd_margin_percent: 35 }, verdict: "invalid" },
      { label: "margin 55 %", row: { ...BASE, rcd_margin_percent: 55 }, verdict: "invalid" },
      { label: "margin -5 %", row: { ...BASE, rcd_margin_percent: -5 }, verdict: "invalid" },
      // The RCD type is an enum, so only its four values are compared.
      { label: "minimum RCD type AC", row: { ...BASE, min_rcd_type: "AC" }, verdict: "valid" },
      { label: "minimum RCD type F", row: { ...BASE, min_rcd_type: "F" }, verdict: "valid" },
      { label: "minimum RCD type B", row: { ...BASE, min_rcd_type: "B" }, verdict: "valid" },
      // Text: stored trimmed, 1-40 code points for a group label and 1-100 for a circuit name.
      { label: "group label of 40 characters", row: { ...BASE, label: "a".repeat(40) }, verdict: "valid" },
      { label: "group label of 41 characters", row: { ...BASE, label: "a".repeat(41) }, verdict: "invalid" },
      { label: "group label of 40 code points (emoji)", row: { ...BASE, label: "😀".repeat(40) }, verdict: "valid" },
      { label: "group label of 41 code points (emoji)", row: { ...BASE, label: "😀".repeat(41) }, verdict: "invalid" },
      { label: "empty group label", row: { ...BASE, label: "" }, verdict: "invalid" },
      { label: "blank group label", row: { ...BASE, label: "   " }, verdict: "invalid" },
      { label: "padded group label", row: { ...BASE, label: "  Kuchnia  " }, verdict: "valid" },
      { label: "circuit name of 100 characters", row: { ...BASE, name: "a".repeat(100) }, verdict: "valid" },
      { label: "circuit name of 101 characters", row: { ...BASE, name: "a".repeat(101) }, verdict: "invalid" },
      { label: "circuit name of 100 code points (emoji)", row: { ...BASE, name: "😀".repeat(100) }, verdict: "valid" },
      {
        label: "circuit name of 101 code points (emoji)",
        row: { ...BASE, name: "😀".repeat(101) },
        verdict: "invalid",
      },
      { label: "empty circuit name", row: { ...BASE, name: "" }, verdict: "invalid" },
      { label: "blank circuit name", row: { ...BASE, name: "   " }, verdict: "invalid" },
      { label: "padded circuit name", row: { ...BASE, name: "  Gniazda  " }, verdict: "valid" },
      // Parser-stricter: `numeric(3,1)` rounds 2.51 to 2.5, which the CHECK then accepts.
      {
        label: "cross-section 2.51 mm2 (rounds to 2.5)",
        row: { ...BASE, cross_section_mm2: 2.51 },
        verdict: "parser-stricter",
      },
    ];

    interface Payload {
      groups: object[];
      circuits: object[];
    }

    function toParserInput(row: CircuitRow): Payload {
      const groupId = randomUUID();
      return {
        groups: [
          {
            id: groupId,
            label: row.label,
            residual_current_ma: row.residual_current_ma,
            min_rcd_type: row.min_rcd_type,
            rcd_margin_percent: row.rcd_margin_percent,
          },
        ],
        circuits: [
          {
            id: randomUUID(),
            rcd_group_id: groupId,
            name: row.name,
            rated_current_a: row.rated_current_a,
            phase_count: row.phase_count,
            cross_section_mm2: row.cross_section_mm2,
            installation: "conduit_flush",
            entry_side: "top",
          },
        ],
      };
    }

    /** `Json` has an index signature that an `object` does not, so the RPC arguments need a cast. */
    function toJson(rows: readonly object[]): Json {
      return rows as unknown as Json;
    }

    async function saveCircuits(payload: Payload): Promise<string | null> {
      const { error } = await ownerClient.rpc("save_project_circuits", {
        p_project_id: projectId,
        p_groups: toJson(payload.groups),
        p_circuits: toJson(payload.circuits),
        p_device_ids: toJson([]),
      });
      return error?.code ?? null;
    }

    runParity<CircuitRow, Payload>(fixtures, {
      parse: (row) => {
        const result = parseCircuitsPayload(toParserInput(row));
        return result.ok ? { groups: result.value.groups, circuits: result.value.circuits } : null;
      },
      write: async (row, parsed) => {
        const code = await saveCircuits(parsed ?? toParserInput(row));
        if (code === null) {
          const cleared = await saveCircuits({ groups: [], circuits: [] });
          if (cleared !== null) throw new Error(`Could not clear the parity circuits: ${cleared}`);
        }
        return code;
      },
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Pricing: parsePricingForm <-> pricing_profiles_hourly_rate_positive (>= 1),
  // pricing_profiles_mount_minutes_range (1..600), pricing_profiles_overhead_minutes_range (0..6000)
  // (20260924120000_pricing_profiles.sql). The row holds grosze, the form sends złoty text.
  // ---------------------------------------------------------------------------------------------
  describe("pricing", () => {
    interface PricingRow {
      hourly_rate_grosze: number;
      mount_minutes_per_device: number;
      project_overhead_minutes: number;
    }

    const BASE: PricingRow = { hourly_rate_grosze: 12050, mount_minutes_per_device: 15, project_overhead_minutes: 30 };

    const fixtures: Fixture<PricingRow>[] = [
      { label: "a typical profile", row: BASE, verdict: "valid" },
      { label: "hourly rate 0", row: { ...BASE, hourly_rate_grosze: 0 }, verdict: "invalid" },
      { label: "hourly rate 1 grosz", row: { ...BASE, hourly_rate_grosze: 1 }, verdict: "valid" },
      {
        label: "hourly rate at the integer ceiling",
        row: { ...BASE, hourly_rate_grosze: 2_147_483_647 },
        verdict: "valid",
      },
      { label: "mount minutes 0", row: { ...BASE, mount_minutes_per_device: 0 }, verdict: "invalid" },
      { label: "mount minutes 1", row: { ...BASE, mount_minutes_per_device: 1 }, verdict: "valid" },
      { label: "mount minutes 600", row: { ...BASE, mount_minutes_per_device: 600 }, verdict: "valid" },
      { label: "mount minutes 601", row: { ...BASE, mount_minutes_per_device: 601 }, verdict: "invalid" },
      { label: "overhead minutes -1", row: { ...BASE, project_overhead_minutes: -1 }, verdict: "invalid" },
      { label: "overhead minutes 0", row: { ...BASE, project_overhead_minutes: 0 }, verdict: "valid" },
      { label: "overhead minutes 6000", row: { ...BASE, project_overhead_minutes: 6000 }, verdict: "valid" },
      { label: "overhead minutes 6001", row: { ...BASE, project_overhead_minutes: 6001 }, verdict: "invalid" },
    ];

    /** 12050 -> "120,50": the plain decimal the profile form sends. */
    function zloty(grosze: number): string {
      return `${String(Math.floor(grosze / 100))},${String(grosze % 100).padStart(2, "0")}`;
    }

    function toParserInput(row: PricingRow): FormData {
      const form = new FormData();
      form.set("hourly_rate", zloty(row.hourly_rate_grosze));
      form.set("mount_minutes_per_device", String(row.mount_minutes_per_device));
      form.set("project_overhead_minutes", String(row.project_overhead_minutes));
      return form;
    }

    runParity<PricingRow, PricingRow>(fixtures, {
      parse: (row) => {
        const result = parsePricingForm(toParserInput(row));
        return result.ok ? result.value : null;
      },
      write: async (row, parsed) => {
        const { error } = await ownerClient
          .from("pricing_profiles")
          .upsert({ user_id: owner.id, ...(parsed ?? row) }, { onConflict: "user_id" });
        if (error) return error.code;
        // There is no DELETE grant for the owner, so the service client removes the row.
        const cleanup = await service.from("pricing_profiles").delete().eq("user_id", owner.id);
        if (cleanup.error) throw new Error(`Could not delete the parity pricing row: ${cleanup.error.code}`);
        return null;
      },
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Business: parseBusinessForm <-> business_profiles_*_valid (20261008130000_business_profiles.sql).
  // Every column is null or a trimmed non-empty value within its bound. The NIP checksum is
  // TypeScript-only by design.
  // ---------------------------------------------------------------------------------------------
  describe("business", () => {
    interface BusinessRow {
      company_name: string | null;
      nip: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    }

    // NIP 5260250995: weights 6 5 7 2 3 4 5 6 7 over 5 2 6 0 2 5 0 9 9 give
    // 30 + 10 + 42 + 0 + 6 + 20 + 0 + 54 + 63 = 225; 225 mod 11 = 5, the last digit. Valid.
    // Any other last digit (5260250996) fails the checksum but still matches `^[0-9]{10}$`.
    const BASE: BusinessRow = {
      company_name: "Elektro Kowalski",
      nip: "5260250995",
      address: "ul. Długa 1\n00-001 Warszawa",
      phone: "+48 123 456 789",
      email: "biuro@example.pl",
    };
    const EMPTY: BusinessRow = { company_name: null, nip: null, address: null, phone: null, email: null };

    const fixtures: Fixture<BusinessRow>[] = [
      { label: "a full set of company details", row: BASE, verdict: "valid" },
      { label: "every field empty", row: EMPTY, verdict: "valid" },
      // company_name: 1-200 characters, trimmed
      { label: "company name of 200 characters", row: { ...EMPTY, company_name: "a".repeat(200) }, verdict: "valid" },
      { label: "company name of 201 characters", row: { ...EMPTY, company_name: "a".repeat(201) }, verdict: "invalid" },
      {
        label: "company name of 200 code points (emoji)",
        row: { ...EMPTY, company_name: "😀".repeat(200) },
        verdict: "valid",
      },
      {
        label: "company name of 201 code points (emoji)",
        row: { ...EMPTY, company_name: "😀".repeat(201) },
        verdict: "invalid",
      },
      { label: "padded company name", row: { ...EMPTY, company_name: "  Elektro  " }, verdict: "valid" },
      { label: "empty company name", row: { ...EMPTY, company_name: "" }, verdict: "valid" },
      // address: 1-300 characters
      { label: "address of 300 characters", row: { ...EMPTY, address: "a".repeat(300) }, verdict: "valid" },
      { label: "address of 301 characters", row: { ...EMPTY, address: "a".repeat(301) }, verdict: "invalid" },
      // phone: 1-30 characters of digits, spaces and + ( ) -
      { label: "phone of 30 characters", row: { ...EMPTY, phone: "1".repeat(30) }, verdict: "valid" },
      { label: "phone of 31 characters", row: { ...EMPTY, phone: "1".repeat(31) }, verdict: "invalid" },
      { label: "phone with every allowed symbol", row: { ...EMPTY, phone: "+48 (22) 123-45-67" }, verdict: "valid" },
      { label: "phone with letters", row: { ...EMPTY, phone: "12 345 abc" }, verdict: "invalid" },
      { label: "phone with a dot", row: { ...EMPTY, phone: "12.345.678" }, verdict: "invalid" },
      // email: 1-254 characters, one @, no whitespace, something on both sides
      { label: "email a@b", row: { ...EMPTY, email: "a@b" }, verdict: "valid" },
      { label: "email of 254 characters", row: { ...EMPTY, email: `${"a".repeat(252)}@b` }, verdict: "valid" },
      { label: "email of 255 characters", row: { ...EMPTY, email: `${"a".repeat(253)}@b` }, verdict: "invalid" },
      { label: "email without an @", row: { ...EMPTY, email: "no-at-sign" }, verdict: "invalid" },
      { label: "email with a space", row: { ...EMPTY, email: "a b@c.pl" }, verdict: "invalid" },
      { label: "email with two @", row: { ...EMPTY, email: "a@@b" }, verdict: "invalid" },
      { label: "email with nothing before the @", row: { ...EMPTY, email: "@b" }, verdict: "invalid" },
      { label: "email with nothing after the @", row: { ...EMPTY, email: "a@" }, verdict: "invalid" },
      // nip: exactly ten digits
      { label: "NIP of 10 digits with a valid checksum", row: { ...EMPTY, nip: "5260250995" }, verdict: "valid" },
      { label: "NIP typed with dashes", row: { ...EMPTY, nip: "526-025-09-95" }, verdict: "valid" },
      { label: "NIP of 9 digits", row: { ...EMPTY, nip: "526025099" }, verdict: "invalid" },
      { label: "NIP of 11 digits", row: { ...EMPTY, nip: "52602509950" }, verdict: "invalid" },
      { label: "NIP with letters", row: { ...EMPTY, nip: "52602509ab" }, verdict: "invalid" },
      // Parser-stricter: ten digits satisfy the CHECK, the checksum is TypeScript-only.
      {
        label: "NIP of 10 digits with a bad checksum",
        row: { ...EMPTY, nip: "5260250996" },
        verdict: "parser-stricter",
      },
    ];

    function toParserInput(row: BusinessRow): FormData {
      const form = new FormData();
      const fields: [string, string | null][] = [
        ["company_name", row.company_name],
        ["nip", row.nip],
        ["address", row.address],
        ["phone", row.phone],
        ["email", row.email],
      ];
      for (const [name, value] of fields) {
        if (value !== null) form.set(name, value);
      }
      return form;
    }

    runParity<BusinessRow, BusinessRow>(fixtures, {
      parse: (row) => {
        const result = parseBusinessForm(toParserInput(row));
        return result.ok ? result.value : null;
      },
      write: async (row, parsed) => {
        // A dashed NIP is written as the parser normalised it, so a rejected row keeps its raw value.
        const { error } = await ownerClient
          .from("business_profiles")
          .upsert({ user_id: owner.id, ...(parsed ?? row) }, { onConflict: "user_id" });
        if (error) return error.code;
        const cleanup = await service.from("business_profiles").delete().eq("user_id", owner.id);
        if (cleanup.error) throw new Error(`Could not delete the parity business row: ${cleanup.error.code}`);
        return null;
      },
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Labour override: parseLabourOverrideForm <-> projects_labour_override_range (1..59999 minutes,
  // 20261008090000_project_labour_override.sql). The row is the total in minutes; the form sends it
  // as hours and minutes, and the base estimate is a valid 0 so only the range can refuse the write.
  // ---------------------------------------------------------------------------------------------
  describe("labour override", () => {
    interface LabourRow {
      minutes: number;
    }

    const fixtures: Fixture<LabourRow>[] = [
      { label: "0 minutes", row: { minutes: 0 }, verdict: "invalid" },
      { label: "1 minute", row: { minutes: 1 }, verdict: "valid" },
      { label: "59 minutes", row: { minutes: 59 }, verdict: "valid" },
      { label: "60 minutes (1 h 0 min)", row: { minutes: 60 }, verdict: "valid" },
      { label: "59999 minutes (999 h 59 min)", row: { minutes: 59_999 }, verdict: "valid" },
      { label: "60000 minutes (1000 h 0 min)", row: { minutes: 60_000 }, verdict: "invalid" },
    ];

    function toParserInput(row: LabourRow): FormData {
      const form = new FormData();
      form.set("intent", "set");
      form.set("labour_hours", String(Math.floor(row.minutes / 60)));
      form.set("labour_minutes", String(row.minutes % 60));
      return form;
    }

    runParity<LabourRow, number>(fixtures, {
      parse: (row) => {
        const result = parseLabourOverrideForm(toParserInput(row));
        return result.ok && result.intent === "set" ? result.minutes : null;
      },
      write: (row, parsed) =>
        writeProject({ labour_minutes_override: parsed ?? row.minutes, labour_override_base_minutes: 0 }),
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Project details: parseProjectDetailsForm <-> projects_name_valid (1-200 code points, trimmed),
  // projects_client_name_valid (null or 1-200) and projects_site_address_valid (null or 1-300)
  // (20260924150000_projects.sql). Blank optional text becomes null before the write.
  // ---------------------------------------------------------------------------------------------
  describe("project details", () => {
    interface DetailsRow {
      name: string;
      client_name: string | null;
      site_address: string | null;
    }

    const BASE: DetailsRow = { name: "Dom Kowalskich", client_name: "Jan Kowalski", site_address: "ul. Polna 1" };

    const fixtures: Fixture<DetailsRow>[] = [
      { label: "typical details", row: BASE, verdict: "valid" },
      { label: "name only", row: { name: "Dom", client_name: null, site_address: null }, verdict: "valid" },
      { label: "name of 200 characters", row: { ...BASE, name: "a".repeat(200) }, verdict: "valid" },
      { label: "name of 201 characters", row: { ...BASE, name: "a".repeat(201) }, verdict: "invalid" },
      { label: "name of 200 code points (emoji)", row: { ...BASE, name: "😀".repeat(200) }, verdict: "valid" },
      { label: "name of 201 code points (emoji)", row: { ...BASE, name: "😀".repeat(201) }, verdict: "invalid" },
      { label: "empty name", row: { ...BASE, name: "" }, verdict: "invalid" },
      { label: "blank name", row: { ...BASE, name: "   " }, verdict: "invalid" },
      { label: "padded name", row: { ...BASE, name: "  Dom  " }, verdict: "valid" },
      { label: "client name of 200 characters", row: { ...BASE, client_name: "a".repeat(200) }, verdict: "valid" },
      { label: "client name of 201 characters", row: { ...BASE, client_name: "a".repeat(201) }, verdict: "invalid" },
      { label: "empty client name (becomes null)", row: { ...BASE, client_name: "" }, verdict: "valid" },
      { label: "site address of 300 characters", row: { ...BASE, site_address: "a".repeat(300) }, verdict: "valid" },
      { label: "site address of 301 characters", row: { ...BASE, site_address: "a".repeat(301) }, verdict: "invalid" },
      { label: "empty site address (becomes null)", row: { ...BASE, site_address: "" }, verdict: "valid" },
    ];

    function toParserInput(row: DetailsRow): FormData {
      const form = new FormData();
      form.set("name", row.name);
      if (row.client_name !== null) form.set("client_name", row.client_name);
      if (row.site_address !== null) form.set("site_address", row.site_address);
      return form;
    }

    runParity<DetailsRow, DetailsRow>(fixtures, {
      parse: (row) => {
        const result = parseProjectDetailsForm(toParserInput(row));
        return result.ok ? result.value : null;
      },
      write: (row, parsed) => writeProject(parsed ?? row),
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Cabinet mounting: parseCabinetForm / CABINET_MOUNTINGS <-> cabinets_mounting_valid
  // (20261029120000_cabinet_mounting.sql). The column stays nullable for rows written by code that
  // predates it, so null is the one recorded asymmetry: the parser always requires a value.
  // ---------------------------------------------------------------------------------------------
  describe("cabinet mounting", () => {
    interface MountingRow {
      mounting: string | null;
    }

    const fixtures: Fixture<MountingRow>[] = [
      { label: "surface", row: { mounting: "surface" }, verdict: "valid" },
      { label: "flush", row: { mounting: "flush" }, verdict: "valid" },
      { label: "padded surface (trimmed)", row: { mounting: "  surface  " }, verdict: "valid" },
      { label: "empty mounting", row: { mounting: "" }, verdict: "invalid" },
      { label: "unknown mounting", row: { mounting: "hermetic" }, verdict: "invalid" },
      { label: "wrong case", row: { mounting: "Surface" }, verdict: "invalid" },
      { label: "null (legacy row)", row: { mounting: null }, verdict: "parser-stricter" },
    ];

    function toParserInput(row: MountingRow): FormData {
      const form = new FormData();
      form.set("name", "Szafka parytetu");
      form.set("manufacturer", "Producent testowy parytetu");
      form.set("model", "PARITY");
      form.set("price", "100,00");
      form.set("geometry", JSON.stringify(GEOMETRY));
      if (row.mounting !== null) form.set("mounting", row.mounting);
      return form;
    }

    runParity<MountingRow, string>(fixtures, {
      parse: (row) => {
        const result = parseCabinetForm(toParserInput(row));
        return result.ok ? result.value.mounting : null;
      },
      // Written as the admin, the only role the cabinet policies let write; reset by the service role.
      write: async (row, parsed) => {
        const { data, error } = await adminClient
          .from("cabinets")
          .update({ mounting: parsed ?? row.mounting })
          .eq("id", cabinetId)
          .select("id");
        if (error) return error.code;
        if (data.length !== 1) throw new Error("The cabinet update touched no row: that is a test setup fault.");
        const reset = await service.from("cabinets").update({ mounting: null }).eq("id", cabinetId);
        if (reset.error) throw new Error(`Could not reset the parity cabinet: ${reset.error.code}`);
        return null;
      },
    });
  });
});
