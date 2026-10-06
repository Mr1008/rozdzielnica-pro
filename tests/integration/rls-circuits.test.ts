import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/database.types";
import type { SupplyParams } from "@/lib/supply-params";
import {
  SEEDED_ADMIN,
  createElectrician,
  createServiceClient,
  createUserClient,
  readStackEnv,
  signIn,
  type Electrician,
  type ServiceClient,
  type StackEnv,
  type UserClient,
} from "./support";

/**
 * `public.rcd_groups`, `public.circuits` and `public.project_devices` belong to their parent project:
 * the owner reads and writes them (a write also needs the `elektryk` claim), another electrician and
 * the admin see nothing and write nothing. `save_project_circuits` is the one write path the app
 * uses — security invoker, one transaction. The device snapshot is owned by the
 * `project_devices_snapshot_device` trigger (a client-sent price is ignored, an archived device is
 * refused with P0002), and `projects_clear_device_snapshot` drops the snapshot when the supply
 * changes.
 *
 * Needs the local stack up with the `circuits_and_device_matching` migration applied:
 * `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

const TEST_MANUFACTURER = "Producent testowy RLS obwodów";

/** Seeded by `supabase/seed.sql`; looked up by model so the test never hard-codes an id. */
const SEEDED_MODELS = {
  rcd: "PRZ-RCD-2P-40-30-A",
  mcbB16: "PRZ-B16-1P",
  mcbB10: "PRZ-B10-1P",
  rcbo: "PRZ-RCBO-B16-30-A",
} as const;

const SUPPLY: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-C-S",
  phase_count: 1,
  wlz_length_m: 15,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

/** The RPC's JSON payload shapes, as `save_project_circuits` reads them. */
interface GroupPayload {
  id: string;
  label: string;
  residual_current_ma: number;
  min_rcd_type: "AC" | "A" | "F" | "B";
  /** Optional: the RPC falls back to the column default (15) for a caller that predates it. */
  rcd_margin_percent?: number;
}

interface CircuitPayload {
  id: string;
  rcd_group_id: string | null;
  name: string;
  rated_current_a: number;
  phase_count: number;
  cross_section_mm2: number;
  installation: SupplyParams["wlz_installation"];
  entry_side: "top" | "bottom" | "left" | "right";
}

interface DevicePayload {
  device_id: string;
  role: "main_switch" | "rcd" | "rcbo" | "mcb";
  rcd_group_id: string | null;
  circuit_id: string | null;
  notes: string[];
  /** Optional (S-05): an item carrying both gets a placement row; one without them gets none. */
  rail_index?: number;
  x_mm?: number;
}

interface Payload {
  groups: GroupPayload[];
  circuits: CircuitPayload[];
  devices: DevicePayload[];
}

/** Interfaces carry no index signature, so a plain object array needs a cast to the RPC's `Json`. */
function toJson(rows: readonly object[]): Json {
  return rows as unknown as Json;
}

function group(overrides: Partial<GroupPayload> = {}): GroupPayload {
  return {
    id: randomUUID(),
    label: "Grupa 1",
    residual_current_ma: 30,
    min_rcd_type: "A",
    rcd_margin_percent: 15,
    ...overrides,
  };
}

function circuit(overrides: Partial<CircuitPayload> = {}): CircuitPayload {
  return {
    id: randomUUID(),
    rcd_group_id: null,
    name: "Gniazda kuchnia",
    rated_current_a: 16,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: "top",
    ...overrides,
  };
}

describe("row level security and the device snapshot on circuits, groups and project devices", () => {
  const createdUserIds: string[] = [];
  const createdDeviceIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianA: Electrician;
  let electricianB: Electrician;
  let clientA: UserClient;
  let clientB: UserClient;
  let adminClient: UserClient;
  let cabinetId: string;
  let devices: Record<keyof typeof SEEDED_MODELS, { id: string; price_grosze: number }>;
  let projectA: string;
  let projectB: string;
  /** A's saved state in `projectA`, written in `beforeAll` so the isolation cases never depend on test order. */
  let savedA: Payload;

  async function insertProject(client: UserClient, userId: string, supply: SupplyParams | null = null) {
    const { data, error } = await client
      .from("projects")
      .insert({ user_id: userId, name: "Projekt testowy obwodów", cabinet_id: cabinetId, ...(supply ?? {}) })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create a test project: ${error.code}`);
    return data.id;
  }

  function save(client: UserClient, projectId: string, payload: Payload) {
    return client.rpc("save_project_circuits", {
      p_project_id: projectId,
      p_groups: toJson(payload.groups),
      p_circuits: toJson(payload.circuits),
      p_device_ids: toJson(payload.devices),
    });
  }

  async function saveOrThrow(client: UserClient, projectId: string, payload: Payload) {
    const { error } = await save(client, projectId, payload);
    if (error) throw new Error(`Could not save circuits: ${error.code} ${error.message}`);
  }

  /** Every row of the project's three tables, read past RLS, in position order. */
  async function readAll(projectId: string) {
    const [groups, circuits, projectDevices] = await Promise.all([
      service.from("rcd_groups").select("*").eq("project_id", projectId).order("position"),
      service.from("circuits").select("*").eq("project_id", projectId).order("position"),
      service.from("project_devices").select("*").eq("project_id", projectId).order("position"),
    ]);
    if (groups.error) throw new Error(`Could not read the groups of ${projectId}: ${groups.error.code}`);
    if (circuits.error) throw new Error(`Could not read the circuits of ${projectId}: ${circuits.error.code}`);
    if (projectDevices.error) {
      throw new Error(`Could not read the devices of ${projectId}: ${projectDevices.error.code}`);
    }
    return { groups: groups.data, circuits: circuits.data, projectDevices: projectDevices.data };
  }

  /** One RCD group with two MCB circuits, plus a one-circuit RCBO group, and their devices. */
  function samplePayload(): Payload {
    const rcdGroup = group({ label: "Kuchnia" });
    const rcboGroup = group({ label: "Łazienka" });
    const sockets = circuit({ rcd_group_id: rcdGroup.id, name: "Gniazda kuchnia" });
    const lights = circuit({
      rcd_group_id: rcdGroup.id,
      name: "Oświetlenie",
      rated_current_a: 10,
      cross_section_mm2: 1.5,
    });
    const bathroom = circuit({ rcd_group_id: rcboGroup.id, name: "Łazienka", entry_side: "bottom" });
    return {
      groups: [rcdGroup, rcboGroup],
      circuits: [sockets, lights, bathroom],
      devices: [
        { device_id: devices.rcd.id, role: "rcd", rcd_group_id: rcdGroup.id, circuit_id: null, notes: [] },
        { device_id: devices.mcbB16.id, role: "mcb", rcd_group_id: rcdGroup.id, circuit_id: sockets.id, notes: [] },
        { device_id: devices.mcbB10.id, role: "mcb", rcd_group_id: rcdGroup.id, circuit_id: lights.id, notes: [] },
        {
          device_id: devices.rcbo.id,
          role: "rcbo",
          rcd_group_id: rcboGroup.id,
          circuit_id: bathroom.id,
          notes: ["rcbo_fallback"],
        },
      ],
    };
  }

  async function seedDevice(overrides: Partial<DeviceInsert> = {}): Promise<string> {
    const { data, error } = await service
      .from("devices")
      .insert({
        kind: "mcb_b",
        name: "Aparat testowy obwodów",
        manufacturer: TEST_MANUFACTURER,
        model: `RLS-CIR-${randomUUID()}`,
        price_grosze: 1000,
        width_mm: 17.5,
        height_mm: 85,
        depth_mm: 70,
        poles: "1P",
        rated_current_a: 16,
        breaking_capacity_ka: 6,
        ...overrides,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create a test device: ${error.message}`);
    createdDeviceIds.push(data.id);
    return data.id;
  }

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    // Record each id as soon as its user exists, not after both — see `rls-profiles.test.ts`.
    electricianA = await createElectrician(service, "circuits-a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "circuits-b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const cabinet = await service.from("cabinets").select("id").is("archived_at", null).limit(1).single();
    if (cabinet.error) throw new Error(`No seeded cabinet to build projects on: ${cabinet.error.code}`);
    cabinetId = cabinet.data.id;

    const seeded = await service
      .from("devices")
      .select("id, model, price_grosze")
      .in("model", Object.values(SEEDED_MODELS));
    if (seeded.error) throw new Error(`Could not read the seeded devices: ${seeded.error.code}`);
    const byModel = new Map(seeded.data.map((row) => [row.model, row]));
    devices = Object.fromEntries(
      Object.entries(SEEDED_MODELS).map(([key, model]) => {
        const row = byModel.get(model);
        if (!row) throw new Error(`The seeded device ${model} is missing — run \`npx supabase db reset\`.`);
        return [key, { id: row.id, price_grosze: row.price_grosze }];
      }),
    ) as typeof devices;

    projectA = await insertProject(clientA, electricianA.id, SUPPLY);
    projectB = await insertProject(clientB, electricianB.id, SUPPLY);

    savedA = samplePayload();
    await saveOrThrow(clientA, projectA, savedA);
  });

  afterAll(async () => {
    // Deleting the auth user cascades through `profiles` and `projects` to all three tables, which
    // frees the test devices of the `device_id` foreign key.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
    if (createdDeviceIds.length > 0) {
      const { error } = await service.from("devices").delete().in("id", createdDeviceIds);
      if (error) throw new Error(`Test devices were not cleaned up: ${error.code}`);
    }
  });

  describe("as the owner", () => {
    it("saves groups, circuits and devices through the RPC and reads them back", async () => {
      const { groups, circuits, projectDevices } = await readAll(projectA);

      expect(groups.map((row) => [row.id, row.label])).toEqual(savedA.groups.map((g) => [g.id, g.label]));
      expect(circuits.map((row) => [row.id, row.rcd_group_id, row.name])).toEqual(
        savedA.circuits.map((c) => [c.id, c.rcd_group_id, c.name]),
      );
      expect(projectDevices.map((row) => [row.device_id, row.role, row.circuit_id])).toEqual(
        savedA.devices.map((d) => [d.device_id, d.role, d.circuit_id]),
      );

      const read = await clientA.from("circuits").select("id").eq("project_id", projectA);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(savedA.circuits.length);
    });

    it("stores position in array order, and a re-save deletes a dropped circuit but keeps the other's id", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const first = circuit({ name: "Pierwszy" });
      const second = circuit({ name: "Drugi" });
      const third = circuit({ name: "Trzeci" });

      await saveOrThrow(clientA, projectId, { groups: [], circuits: [first, second, third], devices: [] });
      const saved = await readAll(projectId);
      expect(saved.circuits.map((row) => row.id)).toEqual([first.id, second.id, third.id]);
      expect(new Set(saved.circuits.map((row) => row.position)).size).toBe(3);

      // Reversed and with `second` dropped: position follows the new order, ids are stable.
      await saveOrThrow(clientA, projectId, {
        groups: [],
        circuits: [{ ...third, name: "Trzeci po zmianie" }, first],
        devices: [],
      });
      const resaved = await readAll(projectId);
      expect(resaved.circuits.map((row) => [row.id, row.name])).toEqual([
        [third.id, "Trzeci po zmianie"],
        [first.id, "Pierwszy"],
      ]);
    });

    it("replaces the project's devices on every save, and an empty device array leaves none", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const payload = samplePayload();
      await saveOrThrow(clientA, projectId, payload);
      expect((await readAll(projectId)).projectDevices).toHaveLength(payload.devices.length);

      await saveOrThrow(clientA, projectId, { ...payload, devices: [] });
      const after = await readAll(projectId);
      expect(after.projectDevices).toEqual([]);
      expect(after.circuits).toHaveLength(payload.circuits.length);
    });

    it("stores placements for device items that carry rail_index / x_mm, and none for the rest", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const payload = samplePayload();
      payload.devices[0] = { ...payload.devices[0], rail_index: 0, x_mm: 0 };
      payload.devices[2] = { ...payload.devices[2], rail_index: 1, x_mm: 52.5 };
      await saveOrThrow(clientA, projectId, payload);

      const { projectDevices } = await readAll(projectId);
      const placements = await service
        .from("project_device_placements")
        .select("project_device_id, rail_index, x_mm")
        .eq("project_id", projectId);
      expect(placements.error).toBeNull();
      const byDevice = new Map((placements.data ?? []).map((row) => [row.project_device_id, row]));
      expect(projectDevices.map((row) => byDevice.get(row.id) ?? null)).toEqual([
        { project_device_id: projectDevices[0].id, rail_index: 0, x_mm: 0 },
        null,
        { project_device_id: projectDevices[2].id, rail_index: 1, x_mm: 52.5 },
        null,
      ]);

      // The sample payload itself carries no placement fields: the devices are saved, unplaced.
      expect(savedA.devices.every((d) => d.rail_index === undefined)).toBe(true);
      const unplaced = await service
        .from("project_device_placements")
        .select("project_device_id")
        .eq("project_id", projectA);
      expect(unplaced.data).toEqual([]);
    });

    it("stores a group's RCD margin, defaults an absent one to 15, and refuses one off the list", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const set = group({ rcd_margin_percent: 25 });
      const { rcd_margin_percent: _omitted, ...legacy } = group();
      await saveOrThrow(clientA, projectId, { groups: [set, legacy], circuits: [], devices: [] });
      const { groups } = await readAll(projectId);
      expect(groups.map((row) => [row.id, row.rcd_margin_percent])).toEqual([
        [set.id, 25],
        [legacy.id, 15],
      ]);

      const { error } = await save(clientA, projectId, {
        groups: [{ ...set, rcd_margin_percent: 7 }],
        circuits: [],
        devices: [],
      });
      expect(error?.code).toBe("23514");
      expect((await readAll(projectId)).groups.map((row) => row.rcd_margin_percent)).toEqual([25, 15]);
    });

    it("reusing a group or circuit id from the owner's other project raises 42501 and rolls back", async () => {
      // The upsert has already overwritten the other project's row when the guard raises, so this
      // pins that the exception rolls the whole call back.
      const source = await insertProject(clientA, electricianA.id);
      const target = await insertProject(clientA, electricianA.id);
      const sourceGroup = group({ label: "Źródłowa" });
      const sourceCircuit = circuit({ rcd_group_id: sourceGroup.id, name: "Źródłowy" });
      await saveOrThrow(clientA, source, { groups: [sourceGroup], circuits: [sourceCircuit], devices: [] });
      const before = await readAll(source);

      const groupReuse = await save(clientA, target, {
        groups: [{ ...sourceGroup, label: "Przejęta" }],
        circuits: [],
        devices: [],
      });
      expect(groupReuse.error?.code).toBe("42501");

      const circuitReuse = await save(clientA, target, {
        groups: [],
        circuits: [{ ...sourceCircuit, rcd_group_id: null, name: "Przejęty" }],
        devices: [],
      });
      expect(circuitReuse.error?.code).toBe("42501");

      expect(await readAll(source)).toEqual(before);
      expect(await readAll(target)).toEqual({ groups: [], circuits: [], projectDevices: [] });
    });

    it("cannot update a project device — there is no UPDATE grant — 42501", async () => {
      const { error } = await clientA.from("project_devices").update({ notes: [] }).eq("project_id", projectA);
      expect(error?.code).toBe("42501");
    });
  });

  describe("the device snapshot", () => {
    it("ignores a client-sent price and copies the catalog price on a direct insert", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const { data, error } = await clientA
        .from("project_devices")
        .insert({
          project_id: projectId,
          position: 0,
          role: "mcb",
          device_id: devices.mcbB16.id,
          notes: [],
          price_grosze: 1,
          name: "Podrobiona nazwa",
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      const stored = await service
        .from("project_devices")
        .select("price_grosze, name, model")
        .eq("id", data?.id ?? "")
        .single();
      expect(stored.data?.price_grosze).toBe(devices.mcbB16.price_grosze);
      expect(stored.data?.model).toBe(SEEDED_MODELS.mcbB16);
      expect(stored.data?.name).not.toBe("Podrobiona nazwa");
    });

    it("snapshots the catalog price through the RPC too", async () => {
      const { projectDevices } = await readAll(projectA);
      const prices = Object.fromEntries(Object.values(devices).map((d) => [d.id, d.price_grosze]));
      for (const row of projectDevices) {
        expect(row.price_grosze, row.device_id).toBe(prices[row.device_id]);
      }
    });

    it("copies the N terminal side from the catalog", async () => {
      const { projectDevices } = await readAll(projectA);
      const catalog = await service
        .from("devices")
        .select("id, n_terminal_side")
        .in(
          "id",
          projectDevices.map((row) => row.device_id),
        );
      expect(catalog.error).toBeNull();
      const sides = new Map((catalog.data ?? []).map((row) => [row.id, row.n_terminal_side]));
      for (const row of projectDevices) {
        expect(row.n_terminal_side, row.device_id).toBe(sides.get(row.device_id));
      }
      // The sample match holds an RCD and an RCBO, so at least one side is really copied, not just null.
      expect(projectDevices.some((row) => row.n_terminal_side !== null)).toBe(true);
    });

    it("refuses an archived device with P0002 and rolls back the whole RPC", async () => {
      const archivedDevice = await seedDevice({ archived_at: new Date().toISOString() });
      const projectId = await insertProject(clientA, electricianA.id);
      const payload = samplePayload();
      await saveOrThrow(clientA, projectId, payload);
      const before = await readAll(projectId);

      const { error } = await save(clientA, projectId, {
        groups: payload.groups,
        circuits: [{ ...payload.circuits[0], name: "Zmiana, która ma zniknąć" }, circuit({ name: "Nowy obwód" })],
        devices: [{ device_id: archivedDevice, role: "mcb", rcd_group_id: null, circuit_id: null, notes: [] }],
      });
      expect(error?.code).toBe("P0002");

      expect(await readAll(projectId)).toEqual(before);
    });

    it("refuses a device that does not exist with P0002", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      const { error } = await clientA
        .from("project_devices")
        .insert({ project_id: projectId, position: 0, role: "mcb", device_id: randomUUID(), notes: [] });
      expect(error?.code).toBe("P0002");
    });
  });

  describe("the supply-change clear", () => {
    it("keeps the devices on a name-only update and drops them when the supply changes", async () => {
      const projectId = await insertProject(clientA, electricianA.id, SUPPLY);
      const payload = samplePayload();
      await saveOrThrow(clientA, projectId, payload);

      const renamed = await clientA.from("projects").update({ name: "Projekt po zmianie nazwy" }).eq("id", projectId);
      expect(renamed.error).toBeNull();
      expect((await readAll(projectId)).projectDevices).toHaveLength(payload.devices.length);

      const resupplied = await clientA.from("projects").update({ premeter_protection_a: 32 }).eq("id", projectId);
      expect(resupplied.error).toBeNull();
      const after = await readAll(projectId);
      expect(after.projectDevices).toEqual([]);
      // Only the snapshot goes: the electrician's circuits and groups stay.
      expect(after.circuits).toHaveLength(payload.circuits.length);
      expect(after.groups).toHaveLength(payload.groups.length);
    });
  });

  describe("foreign keys", () => {
    it("refuse a circuit that references another project's group with 23503", async () => {
      const otherProject = await insertProject(clientA, electricianA.id);
      const foreignGroup = group({ label: "Obca grupa" });
      await saveOrThrow(clientA, otherProject, { groups: [foreignGroup], circuits: [], devices: [] });

      const { error } = await save(clientA, projectA, {
        ...savedA,
        circuits: [...savedA.circuits, circuit({ rcd_group_id: foreignGroup.id })],
      });
      expect(error?.code).toBe("23503");

      const direct = await clientA
        .from("circuits")
        .insert({ ...circuit({ rcd_group_id: foreignGroup.id }), project_id: projectA, position: 99 });
      expect(direct.error?.code).toBe("23503");

      expect((await readAll(projectA)).circuits).toHaveLength(savedA.circuits.length);
    });

    it("cascade all three tables away when the project is deleted", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveOrThrow(clientA, projectId, samplePayload());

      const { error } = await clientA.from("projects").delete().eq("id", projectId);
      expect(error).toBeNull();

      expect(await readAll(projectId)).toEqual({ groups: [], circuits: [], projectDevices: [] });
    });
  });

  describe("as another electrician", () => {
    it("reads zero of A's rows", async () => {
      for (const table of ["rcd_groups", "circuits", "project_devices"] as const) {
        const { data, error } = await clientB.from(table).select("id").eq("project_id", projectA);
        expect(error, table).toBeNull();
        expect(data, table).toEqual([]);
      }
    });

    it("is refused an insert into A's project with 42501", async () => {
      const groupInsert = await clientB.from("rcd_groups").insert({ ...group(), project_id: projectA, position: 9 });
      expect(groupInsert.error?.code).toBe("42501");

      const circuitInsert = await clientB.from("circuits").insert({ ...circuit(), project_id: projectA, position: 9 });
      expect(circuitInsert.error?.code).toBe("42501");

      const deviceInsert = await clientB
        .from("project_devices")
        .insert({ project_id: projectA, position: 9, role: "mcb", device_id: devices.mcbB16.id, notes: [] });
      expect(deviceInsert.error?.code).toBe("42501");
    });

    it("updates and deletes zero of A's rows", async () => {
      const before = await readAll(projectA);

      for (const table of ["rcd_groups", "circuits"] as const) {
        const updated = await clientB.from(table).update({ position: 42 }).eq("project_id", projectA).select("id");
        expect(updated.error, table).toBeNull();
        expect(updated.data, table).toEqual([]);
      }
      for (const table of ["rcd_groups", "circuits", "project_devices"] as const) {
        const deleted = await clientB.from(table).delete().eq("project_id", projectA).select("id");
        expect(deleted.error, table).toBeNull();
        expect(deleted.data, table).toEqual([]);
      }

      expect(await readAll(projectA)).toEqual(before);
    });

    it("cannot save through the RPC into A's project — P0002", async () => {
      const before = await readAll(projectA);

      const { error } = await save(clientB, projectA, { groups: [], circuits: [circuit()], devices: [] });
      expect(error?.code).toBe("P0002");

      expect(await readAll(projectA)).toEqual(before);
    });

    it("upserting with A's circuit id into B's own project raises 42501 and leaves A's row unchanged", async () => {
      const before = await readAll(projectA);
      const stolen = { ...savedA.circuits[0], rcd_group_id: null, name: "Przejęty obwód" };

      const { error } = await save(clientB, projectB, { groups: [], circuits: [stolen], devices: [] });
      expect(error?.code).toBe("42501");

      expect(await readAll(projectA)).toEqual(before);
      expect((await readAll(projectB)).circuits).toEqual([]);
    });
  });

  describe("as the admin", () => {
    it("reads zero rows", async () => {
      for (const table of ["rcd_groups", "circuits", "project_devices"] as const) {
        const { data, error } = await adminClient.from(table).select("id");
        expect(error, table).toBeNull();
        expect(data, table).toEqual([]);
      }
    });

    it("cannot save through the RPC, and A's rows are unchanged", async () => {
      const before = await readAll(projectA);

      const { error } = await save(adminClient, projectA, { groups: [], circuits: [circuit()], devices: [] });
      expect(error?.code).toBe("P0002");

      expect(await readAll(projectA)).toEqual(before);
    });

    it("is refused a direct insert into A's project with 42501", async () => {
      const { error } = await adminClient.from("circuits").insert({ ...circuit(), project_id: projectA, position: 9 });
      expect(error?.code).toBe("42501");
    });
  });

  it("refuses anon a select on all three tables and the RPC", async () => {
    const anon = createUserClient(env);

    for (const table of ["rcd_groups", "circuits", "project_devices"] as const) {
      const { error } = await anon.from(table).select("id");
      expect(error?.code, table).toBe("42501");
    }

    const { error } = await save(anon, projectA, { groups: [], circuits: [], devices: [] });
    expect(error?.code).toBe("42501");
  });
});
