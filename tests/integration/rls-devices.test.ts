import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { DEVICE_KINDS, PARAMETERS_BY_KIND, parseDeviceSpec, type DeviceKind } from "@/lib/device-spec";
import {
  SEEDED_ADMIN,
  createElectrician,
  createServiceClient,
  createUserClient,
  readStackEnv,
  signIn,
  type ServiceClient,
  type StackEnv,
  type UserClient,
} from "./support";

/**
 * The device catalog's admin boundary and its per-kind parameter rules live in the database:
 * electricians read active rows, only an admin writes, nobody deletes, anon sees nothing, and
 * `devices_parameters_match_kind` refuses a row whose parameters do not fit its kind. These tests
 * also prove the seeded sample catalog passes `parseDeviceSpec` and carries the cases S-04 relies on.
 */

type DeviceInsert = Database["public"]["Tables"]["devices"]["Insert"];

const SAMPLE_MANUFACTURERS = ["Przykładowy producent", "Inny przykładowy producent"];
const TEST_MANUFACTURER = "Producent testowy RLS";

const NO_PARAMETERS = {
  poles: null,
  rated_current_a: null,
  residual_current_ma: null,
  rcd_type: null,
  breaking_capacity_ka: null,
  terminal_groups: null,
} as const;

/** One valid parameter set per kind, each a complete row once `common` fields are added. */
const VALID_PARAMETERS: Record<DeviceKind, Partial<DeviceInsert>> = {
  switch_disconnector: { ...NO_PARAMETERS, poles: "3P", rated_current_a: 63 },
  rcd: { ...NO_PARAMETERS, poles: "2P", rated_current_a: 40, residual_current_ma: 30, rcd_type: "A" },
  rcbo: {
    ...NO_PARAMETERS,
    poles: "1P+N",
    rated_current_a: 16,
    residual_current_ma: 30,
    rcd_type: "A",
    breaking_capacity_ka: 6,
  },
  mcb_b: { ...NO_PARAMETERS, poles: "1P", rated_current_a: 16, breaking_capacity_ka: 6 },
  pe_bar: { ...NO_PARAMETERS, terminal_groups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }] },
  n_bar: { ...NO_PARAMETERS, terminal_groups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }] },
};

/** A value for each parameter, used to put a foreign parameter onto a kind that must not carry it. */
const FOREIGN_VALUES: Required<Pick<DeviceInsert, keyof typeof NO_PARAMETERS>> = {
  poles: "1P",
  rated_current_a: 16,
  residual_current_ma: 30,
  rcd_type: "A",
  breaking_capacity_ka: 6,
  terminal_groups: [{ count: 4, minMm2: 1.5, maxMm2: 16 }],
};

/** Unique per call, so repeated runs against a persistent volume never collide on the unique index. */
function testDevice(kind: DeviceKind = "mcb_b", overrides: Partial<DeviceInsert> = {}): DeviceInsert {
  return {
    kind,
    name: "Aparat testowy",
    manufacturer: TEST_MANUFACTURER,
    model: `RLS-${randomUUID()}`,
    price_grosze: 1000,
    width_mm: 17.5,
    height_mm: 85,
    depth_mm: 70,
    ...VALID_PARAMETERS[kind],
    ...overrides,
  };
}

describe("row level security on public.devices", () => {
  const createdUserIds: string[] = [];
  const createdDeviceIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianClient: UserClient;
  let adminClient: UserClient;
  let activeId: string;
  let archivedId: string;

  /** Inserts through the service client, bypassing RLS, and records the row for cleanup. */
  async function seedDevice(overrides: Partial<DeviceInsert> = {}): Promise<string> {
    const { data, error } = await service.from("devices").insert(testDevice("mcb_b", overrides)).select("id").single();
    if (error) {
      throw new Error(`Could not create a test device: ${error.message}`);
    }
    createdDeviceIds.push(data.id);
    return data.id;
  }

  /** Admin insert that is expected to fail; tracks the id anyway so a wrongly accepted row is cleaned up. */
  async function adminInsertErrorCode(device: DeviceInsert): Promise<string | undefined> {
    const { data, error } = await adminClient.from("devices").insert(device).select("id");
    for (const row of data ?? []) {
      if (row.id) createdDeviceIds.push(row.id);
    }
    return error?.code;
  }

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    const electrician = await createElectrician(service, "devices");
    createdUserIds.push(electrician.id);

    ({ client: electricianClient } = await signIn(env, electrician.email, electrician.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    activeId = await seedDevice();
    archivedId = await seedDevice({ archived_at: new Date().toISOString() });
  });

  afterAll(async () => {
    if (createdDeviceIds.length > 0) {
      const { error } = await service.from("devices").delete().in("id", createdDeviceIds);
      if (error) throw new Error(`Test devices were not cleaned up: ${error.code}`);
    }
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
  });

  describe("as an electrician", () => {
    it("reads active devices", async () => {
      const { data, error } = await electricianClient.from("devices").select("id").eq("id", activeId);

      expect(error).toBeNull();
      expect(data).toEqual([{ id: activeId }]);
    });

    it("does not see an archived device", async () => {
      const { data, error } = await electricianClient.from("devices").select("id").eq("id", archivedId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is refused an insert", async () => {
      const { error } = await electricianClient.from("devices").insert(testDevice());

      expect(error?.code).toBe("42501");
    });

    it("updates zero rows", async () => {
      const { data, error } = await electricianClient
        .from("devices")
        .update({ price_grosze: 1 })
        .eq("id", activeId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("devices").select("price_grosze").eq("id", activeId).single();
      expect(after.data?.price_grosze).toBe(1000);
    });
  });

  it("refuses anon a select with 42501", async () => {
    const { error } = await createUserClient(env).from("devices").select("id");

    expect(error?.code).toBe("42501");
  });

  describe("as the admin", () => {
    it("inserts, updates, archives and restores a device", async () => {
      const inserted = await adminClient.from("devices").insert(testDevice()).select("id").single();
      expect(inserted.error).toBeNull();
      const id = inserted.data?.id ?? "";
      // An empty id would make the cleanup's `.in("id", …)` fail with 22P02 and leak every row.
      if (id) createdDeviceIds.push(id);

      const updated = await adminClient
        .from("devices")
        .update({ price_grosze: 2500 })
        .eq("id", id)
        .select("price_grosze");
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual([{ price_grosze: 2500 }]);

      const archived = await adminClient
        .from("devices")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select("archived_at");
      expect(archived.error).toBeNull();
      expect(archived.data?.[0]?.archived_at).not.toBeNull();

      const restored = await adminClient
        .from("devices")
        .update({ archived_at: null })
        .eq("id", id)
        .select("archived_at");
      expect(restored.error).toBeNull();
      expect(restored.data).toEqual([{ archived_at: null }]);
    });

    it("still sees an archived device", async () => {
      const { data, error } = await adminClient.from("devices").select("id").eq("id", archivedId);

      expect(error).toBeNull();
      expect(data).toEqual([{ id: archivedId }]);
    });

    it("is refused a delete with 42501", async () => {
      const { error } = await adminClient.from("devices").delete().eq("id", activeId);

      expect(error?.code).toBe("42501");

      const after = await service.from("devices").select("id").eq("id", activeId);
      expect(after.data).toEqual([{ id: activeId }]);
    });

    it("advances updated_at on update", async () => {
      const id = await seedDevice();
      const before = await service.from("devices").select("updated_at").eq("id", id).single();

      const { error } = await adminClient.from("devices").update({ name: "Aparat testowy po zmianie" }).eq("id", id);
      expect(error).toBeNull();

      const after = await service.from("devices").select("updated_at").eq("id", id).single();
      expect(Date.parse(after.data?.updated_at ?? "")).toBeGreaterThan(Date.parse(before.data?.updated_at ?? ""));
    });

    it("stores a half-module width exactly", async () => {
      const id = await seedDevice({ width_mm: 26.25 });

      const { data } = await adminClient.from("devices").select("width_mm").eq("id", id).single();
      expect(data?.width_mm).toBe(26.25);
    });
  });

  describe("check constraints", () => {
    it("accepts one valid row of every kind", async () => {
      for (const kind of DEVICE_KINDS) {
        const { data, error } = await adminClient.from("devices").insert(testDevice(kind)).select("id").single();
        expect(error, kind).toBeNull();
        if (data?.id) createdDeviceIds.push(data.id);
      }
    });

    it("rejects a duplicate manufacturer and model differing only in case with 23505", async () => {
      const model = `RLS-case-${randomUUID()}`;
      await seedDevice({ model });

      const code = await adminInsertErrorCode(
        testDevice("mcb_b", { manufacturer: TEST_MANUFACTURER.toUpperCase(), model: model.toLowerCase() }),
      );
      expect(code).toBe("23505");
    });

    it("rejects a price of zero or less", async () => {
      for (const price of [0, -100]) {
        expect(await adminInsertErrorCode(testDevice("mcb_b", { price_grosze: price }))).toBe("23514");
      }
    });

    it("rejects a dimension of zero or less", async () => {
      for (const field of ["width_mm", "height_mm", "depth_mm"] as const) {
        expect(await adminInsertErrorCode(testDevice("mcb_b", { [field]: 0 })), field).toBe("23514");
      }
    });

    it("rejects terminal groups that are not a non-empty array", async () => {
      for (const terminal_groups of [[], { count: 4, minMm2: 1.5, maxMm2: 16 }]) {
        expect(await adminInsertErrorCode(testDevice("pe_bar", { terminal_groups }))).toBe("23514");
      }
    });

    describe.each(DEVICE_KINDS)("for %s", (kind) => {
      const own: readonly string[] = PARAMETERS_BY_KIND[kind];
      const foreign = (Object.keys(NO_PARAMETERS) as (keyof typeof NO_PARAMETERS)[]).find((p) => !own.includes(p));

      it("rejects a row missing any required parameter with 23514", async () => {
        for (const parameter of PARAMETERS_BY_KIND[kind]) {
          expect(await adminInsertErrorCode(testDevice(kind, { [parameter]: null })), parameter).toBe("23514");
        }
      });

      it(`rejects a row carrying the foreign ${String(foreign)} with 23514`, async () => {
        if (!foreign) throw new Error(`${kind} has no foreign parameter to test`);
        expect(await adminInsertErrorCode(testDevice(kind, { [foreign]: FOREIGN_VALUES[foreign] }))).toBe("23514");
      });
    });

    it("rejects a pole configuration outside the kind's set with 23514", async () => {
      const cases: [DeviceKind, NonNullable<DeviceInsert["poles"]>][] = [
        ["rcd", "1P"],
        ["rcd", "3P"],
        ["rcbo", "1P"],
        ["switch_disconnector", "1P+N"],
      ];
      for (const [kind, poles] of cases) {
        expect(await adminInsertErrorCode(testDevice(kind, { poles })), `${kind} ${poles}`).toBe("23514");
      }
    });
  });

  describe("seeded sample catalog", () => {
    async function seededDevices() {
      const { data, error } = await service.from("devices").select("*").in("manufacturer", SAMPLE_MANUFACTURERS);
      expect(error).toBeNull();
      return data ?? [];
    }

    it("passes parseDeviceSpec, row by row", async () => {
      const rows = await seededDevices();
      expect(rows.length).toBeGreaterThanOrEqual(20);

      for (const row of rows) {
        expect(parseDeviceSpec(row), `${row.model} must be a valid device`).toMatchObject({ ok: true });
      }
    });

    it("contains all six kinds", async () => {
      const kinds = new Set((await seededDevices()).map((row) => row.kind));

      expect([...kinds].sort()).toEqual([...DEVICE_KINDS].sort());
    });

    it("offers the MCB B16 1P at two prices from two manufacturers", async () => {
      const b16 = (await seededDevices()).filter(
        (row) => row.kind === "mcb_b" && row.poles === "1P" && row.rated_current_a === 16,
      );

      expect(new Set(b16.map((row) => row.manufacturer)).size).toBe(2);
      expect(new Set(b16.map((row) => row.price_grosze)).size).toBe(2);
    });

    it("has no B40 in any pole configuration — the catalog-gap case", async () => {
      const b40 = (await seededDevices()).filter((row) => row.kind === "mcb_b" && row.rated_current_a === 40);

      expect(b40).toEqual([]);
    });
  });
});
