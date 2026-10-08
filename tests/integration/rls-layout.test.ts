import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
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
 * `public.project_device_placements` (S-05) belongs to its parent project, like `project_devices`:
 * the owner reads, inserts and deletes (writes need the `elektryk` claim); another electrician and the
 * admin see nothing and write nothing; there is no UPDATE grant. Placements are written by
 * `save_project_circuits` (in the same transaction as the device set, joined by position) and by
 * `save_project_layout`; they cascade away with the device set, and
 * `projects_clear_layout_on_cabinet_change` drops them when the project's cabinet changes. Each row
 * carries the S-06 `edited_manually` marker: `save_project_layout`'s `p_edited_manually` (default
 * false) and a device item's optional `edited_manually` in `save_project_circuits` set it, and it goes
 * with the rows.
 *
 * Needs the local stack up with the `project_device_placements` migration applied:
 * `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

const SEEDED_MODELS = {
  fr: "PRZ-FR-2P-40",
  rcd: "PRZ-RCD-2P-40-30-A",
  mcb: "PRZ-B16-1P",
} as const;

interface DeviceItem {
  device_id: string;
  role: "main_switch" | "rcd" | "rcbo" | "mcb";
  rcd_group_id: string | null;
  circuit_id: string | null;
  notes: string[];
  rail_index?: number;
  x_mm?: number;
  edited_manually?: boolean;
}

interface PlacementItem {
  project_device_id: string;
  rail_index: number;
  x_mm: number;
}

function toJson(rows: readonly object[]): Json {
  return rows as unknown as Json;
}

describe("row level security and lifetime of project device placements", () => {
  const createdUserIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianA: Electrician;
  let electricianB: Electrician;
  let clientA: UserClient;
  let clientB: UserClient;
  let adminClient: UserClient;
  let cabinetIds: [string, string];
  let deviceIds: Record<keyof typeof SEEDED_MODELS, string>;
  let projectA: string;
  let projectB: string;

  async function insertProject(client: UserClient, userId: string) {
    const { data, error } = await client
      .from("projects")
      .insert({ user_id: userId, name: "Projekt testowy układu", cabinet_id: cabinetIds[0] })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create a test project: ${error.code}`);
    return data.id;
  }

  /** One RCD group with two circuits: FR, RCD, two MCBs — placed or not, per `placements`. */
  function payload(placements: ({ rail_index: number; x_mm: number; edited_manually?: boolean } | null)[] = []) {
    const groupId = randomUUID();
    const circuits = [randomUUID(), randomUUID()].map((id, i) => ({
      id,
      rcd_group_id: groupId,
      name: `Obwód ${String(i + 1)}`,
      rated_current_a: 16,
      phase_count: 1,
      cross_section_mm2: 2.5,
      installation: "conduit_flush",
      entry_side: "top",
    }));
    const unplaced: DeviceItem[] = [
      { device_id: deviceIds.fr, role: "main_switch", rcd_group_id: null, circuit_id: null, notes: [] },
      { device_id: deviceIds.rcd, role: "rcd", rcd_group_id: groupId, circuit_id: null, notes: [] },
      ...circuits.map((c): DeviceItem => ({
        device_id: deviceIds.mcb,
        role: "mcb",
        rcd_group_id: groupId,
        circuit_id: c.id,
        notes: [],
      })),
    ];
    const devices = unplaced.map((item, i): DeviceItem => ({ ...item, ...(placements[i] ?? {}) }));
    return {
      groups: [{ id: groupId, label: "Grupa 1", residual_current_ma: 30, min_rcd_type: "A", rcd_margin_percent: 15 }],
      circuits,
      devices,
    };
  }

  function saveCircuits(client: UserClient, projectId: string, body: ReturnType<typeof payload>) {
    return client.rpc("save_project_circuits", {
      p_project_id: projectId,
      p_groups: toJson(body.groups),
      p_circuits: toJson(body.circuits),
      p_device_ids: toJson(body.devices),
    });
  }

  async function saveCircuitsOrThrow(client: UserClient, projectId: string, body: ReturnType<typeof payload>) {
    const { error } = await saveCircuits(client, projectId, body);
    if (error) throw new Error(`Could not save circuits: ${error.code} ${error.message}`);
  }

  function saveLayout(client: UserClient, projectId: string, placements: PlacementItem[]) {
    return client.rpc("save_project_layout", { p_project_id: projectId, p_placements: toJson(placements) });
  }

  /** The three-argument call the manual save makes. */
  function saveManualLayout(client: UserClient, projectId: string, placements: PlacementItem[]) {
    return client.rpc("save_project_layout", {
      p_project_id: projectId,
      p_placements: toJson(placements),
      p_edited_manually: true,
    });
  }

  /** The project's `edited_manually` flags in device position order, read past RLS. */
  async function readFlags(projectId: string) {
    const [devices, placements] = await Promise.all([
      service.from("project_devices").select("id, position").eq("project_id", projectId),
      service
        .from("project_device_placements")
        .select("project_device_id, edited_manually")
        .eq("project_id", projectId),
    ]);
    if (devices.error) throw new Error(`Could not read devices: ${devices.error.code}`);
    if (placements.error) throw new Error(`Could not read placements: ${placements.error.code}`);
    const positionOf = new Map(devices.data.map((d) => [d.id, d.position]));
    return placements.data
      .map((p) => [positionOf.get(p.project_device_id) ?? -1, p.edited_manually] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, flag]) => flag);
  }

  /** The project's devices and placements, read past RLS; placements as [position, rail, x]. */
  async function readLayout(projectId: string) {
    const [devices, placements] = await Promise.all([
      service.from("project_devices").select("id, position").eq("project_id", projectId).order("position"),
      service.from("project_device_placements").select("*").eq("project_id", projectId),
    ]);
    if (devices.error) throw new Error(`Could not read devices: ${devices.error.code}`);
    if (placements.error) throw new Error(`Could not read placements: ${placements.error.code}`);
    const positionOf = new Map(devices.data.map((d) => [d.id, d.position]));
    return {
      deviceIds: devices.data.map((d) => d.id),
      placements: placements.data
        .map((p) => [positionOf.get(p.project_device_id), p.rail_index, p.x_mm] as const)
        .sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1)),
    };
  }

  const FULL = [
    { rail_index: 0, x_mm: 285 },
    { rail_index: 0, x_mm: 0 },
    { rail_index: 0, x_mm: 35 },
    { rail_index: 0, x_mm: 52.5 },
  ];
  const FULL_ROWS = FULL.map((p, i) => [i, p.rail_index, p.x_mm]);

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    electricianA = await createElectrician(service, "layout-a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "layout-b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const cabinets = await service.from("cabinets").select("id").is("archived_at", null).order("model").limit(2);
    if (cabinets.error || cabinets.data.length < 2) throw new Error("Two seeded cabinets are needed.");
    cabinetIds = [cabinets.data[0].id, cabinets.data[1].id];

    const seeded = await service.from("devices").select("id, model").in("model", Object.values(SEEDED_MODELS));
    if (seeded.error) throw new Error(`Could not read the seeded devices: ${seeded.error.code}`);
    const byModel = new Map(seeded.data.map((row) => [row.model, row.id]));
    deviceIds = Object.fromEntries(
      Object.entries(SEEDED_MODELS).map(([key, model]) => {
        const id = byModel.get(model);
        if (!id) throw new Error(`The seeded device ${model} is missing — run \`npx supabase db reset\`.`);
        return [key, id];
      }),
    ) as typeof deviceIds;

    projectA = await insertProject(clientA, electricianA.id);
    projectB = await insertProject(clientB, electricianB.id);
    await saveCircuitsOrThrow(clientA, projectA, payload(FULL));
    await saveCircuitsOrThrow(clientB, projectB, payload(FULL));
  });

  afterAll(async () => {
    // Deleting the auth user cascades through `projects` to devices and placements.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
  });

  describe("save_project_circuits", () => {
    it("stores a placement for each device item that carries one, joined by position", async () => {
      const layout = await readLayout(projectA);
      expect(layout.deviceIds).toHaveLength(4);
      expect(layout.placements).toEqual(FULL_ROWS);
    });

    it("stores none for items without placement fields — an older caller keeps working", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload([FULL[0], null, FULL[2], null]));
      expect((await readLayout(projectId)).placements).toEqual([FULL_ROWS[0], FULL_ROWS[2]]);

      await saveCircuitsOrThrow(clientA, projectId, payload());
      const legacy = await readLayout(projectId);
      expect(legacy.deviceIds).toHaveLength(4);
      expect(legacy.placements).toEqual([]);
    });

    it("replaces the placements on every save, together with the device set", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      const before = await readLayout(projectId);

      const moved = FULL.map((p) => ({ rail_index: 1, x_mm: p.x_mm }));
      await saveCircuitsOrThrow(clientA, projectId, payload(moved));
      const after = await readLayout(projectId);
      expect(after.deviceIds.some((id) => before.deviceIds.includes(id))).toBe(false);
      expect(after.placements).toEqual(moved.map((p, i) => [i, 1, p.x_mm]));

      const { count } = await service
        .from("project_device_placements")
        .select("project_device_id", { count: "exact", head: true })
        .in("project_device_id", before.deviceIds);
      expect(count).toBe(0);
    });

    it("stores edited_manually per placed item and defaults it to false", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      expect(await readFlags(projectId)).toEqual([false, false, false, false]);

      const carried = FULL.map((p, i) => ({ ...p, edited_manually: i !== 1 }));
      await saveCircuitsOrThrow(clientA, projectId, payload(carried));
      expect(await readFlags(projectId)).toEqual([true, false, true, true]);
      expect((await readLayout(projectId)).placements).toEqual(FULL_ROWS);
    });

    it("refuses a negative rail index or offset with 23514 and rolls the whole save back", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      const before = await readLayout(projectId);

      const badRail = await saveCircuits(clientA, projectId, payload([{ rail_index: -1, x_mm: 0 }]));
      expect(badRail.error?.code).toBe("23514");
      const badX = await saveCircuits(clientA, projectId, payload([{ rail_index: 0, x_mm: -0.5 }]));
      expect(badX.error?.code).toBe("23514");

      expect(await readLayout(projectId)).toEqual(before);
    });
  });

  describe("lifetime", () => {
    it("keeps placements on a name-only update and clears them — not the devices — on a cabinet change", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));

      const renamed = await clientA.from("projects").update({ name: "Nowa nazwa" }).eq("id", projectId);
      expect(renamed.error).toBeNull();
      expect((await readLayout(projectId)).placements).toEqual(FULL_ROWS);

      const recabined = await clientA.from("projects").update({ cabinet_id: cabinetIds[1] }).eq("id", projectId);
      expect(recabined.error).toBeNull();
      const after = await readLayout(projectId);
      expect(after.placements).toEqual([]);
      expect(after.deviceIds).toHaveLength(4);
    });

    it("clears a manual layout, and with it the marker, on a cabinet change", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      const { deviceIds: ids } = await readLayout(projectId);
      const manual = ids.map((id, i) => ({
        project_device_id: id,
        rail_index: FULL[i].rail_index,
        x_mm: FULL[i].x_mm,
      }));
      const saved = await saveManualLayout(clientA, projectId, manual);
      expect(saved.error).toBeNull();
      expect(await readFlags(projectId)).toEqual([true, true, true, true]);

      const recabined = await clientA.from("projects").update({ cabinet_id: cabinetIds[1] }).eq("id", projectId);
      expect(recabined.error).toBeNull();
      expect(await readFlags(projectId)).toEqual([]);
      expect((await readLayout(projectId)).deviceIds).toEqual(ids);
    });

    it("drops placements with the device set when the supply changes", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));

      const resupplied = await clientA
        .from("projects")
        .update({
          premeter_protection_a: 25,
          earthing_system: "TN-C-S",
          phase_count: 1,
          wlz_length_m: 15,
          wlz_cross_section_mm2: 10,
          wlz_material: "Cu",
          wlz_installation: "conduit_flush",
        })
        .eq("id", projectId);
      expect(resupplied.error).toBeNull();
      expect(await readLayout(projectId)).toEqual({ deviceIds: [], placements: [] });
    });

    it("cannot update a placement — there is no UPDATE grant — 42501", async () => {
      const { error } = await clientA.from("project_device_placements").update({ x_mm: 1 }).eq("project_id", projectA);
      expect(error?.code).toBe("42501");
    });
  });

  describe("save_project_layout", () => {
    it("replaces the project's placements and leaves the device set alone", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      const { deviceIds: ids } = await readLayout(projectId);

      const next = ids.slice(0, 3).map((id, i) => ({ project_device_id: id, rail_index: 2, x_mm: i * 17.5 }));
      const { error } = await saveLayout(clientA, projectId, next);
      expect(error).toBeNull();

      const after = await readLayout(projectId);
      expect(after.deviceIds).toEqual(ids);
      expect(after.placements).toEqual(next.map((p, i) => [i, 2, p.x_mm]));
    });

    it("stores edited_manually on every row with p_edited_manually, and false without it", async () => {
      const projectId = await insertProject(clientA, electricianA.id);
      await saveCircuitsOrThrow(clientA, projectId, payload(FULL));
      const { deviceIds: ids } = await readLayout(projectId);
      const next = ids.map((id, i) => ({ project_device_id: id, rail_index: 1, x_mm: i * 35 }));

      const manual = await saveManualLayout(clientA, projectId, next);
      expect(manual.error).toBeNull();
      expect(await readFlags(projectId)).toEqual([true, true, true, true]);
      expect((await readLayout(projectId)).placements).toEqual(next.map((p, i) => [i, 1, p.x_mm]));

      // The two-argument call (the deployed code's) still resolves, and stores a proposal.
      const proposed = await saveLayout(clientA, projectId, next);
      expect(proposed.error).toBeNull();
      expect(await readFlags(projectId)).toEqual([false, false, false, false]);
    });

    it("refuses another project's device id with P0002 project_device_unavailable and changes nothing", async () => {
      const before = await readLayout(projectA);
      const foreign = (await readLayout(projectB)).deviceIds[0];
      const { error } = await saveLayout(clientA, projectA, [
        { project_device_id: before.deviceIds[0], rail_index: 1, x_mm: 0 },
        { project_device_id: foreign, rail_index: 1, x_mm: 35 },
      ]);
      expect(error?.code).toBe("P0002");
      expect(error?.message).toBe("project_device_unavailable");

      const unknown = await saveLayout(clientA, projectA, [
        { project_device_id: randomUUID(), rail_index: 0, x_mm: 0 },
      ]);
      expect(unknown.error?.message).toBe("project_device_unavailable");

      expect(await readLayout(projectA)).toEqual(before);
    });

    it("refuses another electrician and the admin with P0002 project_not_found", async () => {
      const before = await readLayout(projectA);
      const flags = await readFlags(projectA);
      for (const client of [clientB, adminClient]) {
        for (const save of [saveLayout, saveManualLayout]) {
          const { error } = await save(client, projectA, []);
          expect(error?.code).toBe("P0002");
          expect(error?.message).toBe("project_not_found");
        }
      }
      expect(await readLayout(projectA)).toEqual(before);
      expect(await readFlags(projectA)).toEqual(flags);
    });

    it("refuses A's device id inside B's own project", async () => {
      const aDevice = (await readLayout(projectA)).deviceIds[0];
      const { error } = await saveLayout(clientB, projectB, [{ project_device_id: aDevice, rail_index: 0, x_mm: 0 }]);
      expect(error?.message).toBe("project_device_unavailable");
    });
  });

  describe("as another electrician", () => {
    it("reads zero of A's placements", async () => {
      const { data, error } = await clientB.from("project_device_placements").select("*").eq("project_id", projectA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is refused an insert into A's project with 42501", async () => {
      const before = await readLayout(projectA);
      const { error } = await clientB
        .from("project_device_placements")
        .insert({ project_device_id: before.deviceIds[0], project_id: projectA, rail_index: 0, x_mm: 0 });
      expect(error?.code).toBe("42501");
    });

    it("deletes zero of A's placements", async () => {
      const before = await readLayout(projectA);
      const { data, error } = await clientB
        .from("project_device_placements")
        .delete()
        .eq("project_id", projectA)
        .select("project_device_id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await readLayout(projectA)).toEqual(before);
    });
  });

  describe("as the admin", () => {
    it("reads zero placements and is refused an insert with 42501", async () => {
      const read = await adminClient.from("project_device_placements").select("*");
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);

      const { deviceIds: ids } = await readLayout(projectA);
      const insert = await adminClient
        .from("project_device_placements")
        .insert({ project_device_id: ids[0], project_id: projectA, rail_index: 0, x_mm: 0 });
      expect(insert.error?.code).toBe("42501");
    });
  });

  it("refuses anon a select and both RPCs", async () => {
    const anon = createUserClient(env);
    const read = await anon.from("project_device_placements").select("*");
    expect(read.error?.code).toBe("42501");
    const layout = await saveLayout(anon, projectA, []);
    expect(layout.error?.code).toBe("42501");
    const manual = await saveManualLayout(anon, projectA, []);
    expect(manual.error?.code).toBe("42501");
  });
});
