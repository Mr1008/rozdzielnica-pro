import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCabinetGeometry, type CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Database } from "@/lib/database.types";
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
 * The cabinet catalog's admin boundary lives in the database: electricians read active rows, only an
 * admin writes, nobody deletes, and anon sees nothing. These tests also prove the three seeded
 * starter cabinets are valid geometry, since the database itself only checks the envelope.
 */

type CabinetInsert = Database["public"]["Tables"]["cabinets"]["Insert"];

const SAMPLE_MANUFACTURER = "Przykładowy producent";
const SEEDED_MODELS = ["PRZ-S1", "PRZ-M3", "PRZ-L4"];
const TEST_MANUFACTURER = "Producent testowy RLS";

const MINIMAL_GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 200, heightMm: 150, depthMm: 80 },
  rails: [{ xMm: 10, yMm: 50, lengthMm: 180 }],
  entries: [{ side: "top", offsetMm: 20, lengthMm: 100 }],
  bars: [],
};

/** Unique per call, so repeated runs against a persistent volume never collide on the unique index. */
function testCabinet(overrides: Partial<CabinetInsert> = {}): CabinetInsert {
  return {
    name: "Szafka testowa",
    manufacturer: TEST_MANUFACTURER,
    model: `RLS-${randomUUID()}`,
    price_grosze: 1000,
    geometry: MINIMAL_GEOMETRY,
    ...overrides,
  };
}

describe("row level security on public.cabinets", () => {
  const createdUserIds: string[] = [];
  const createdCabinetIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianClient: UserClient;
  let adminClient: UserClient;
  let activeId: string;
  let archivedId: string;

  /** Inserts through the service client, bypassing RLS, and records the row for cleanup. */
  async function seedCabinet(overrides: Partial<CabinetInsert> = {}): Promise<string> {
    const { data, error } = await service.from("cabinets").insert(testCabinet(overrides)).select("id").single();
    if (error) {
      throw new Error(`Could not create a test cabinet: ${error.message}`);
    }
    createdCabinetIds.push(data.id);
    return data.id;
  }

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    const electrician = await createElectrician(service, "cabinets");
    createdUserIds.push(electrician.id);

    ({ client: electricianClient } = await signIn(env, electrician.email, electrician.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    activeId = await seedCabinet();
    archivedId = await seedCabinet({ archived_at: new Date().toISOString() });
  });

  afterAll(async () => {
    if (createdCabinetIds.length > 0) {
      const { error } = await service.from("cabinets").delete().in("id", createdCabinetIds);
      if (error) throw new Error(`Test cabinets were not cleaned up: ${error.code}`);
    }
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
  });

  describe("as an electrician", () => {
    it("reads active cabinets", async () => {
      const { data, error } = await electricianClient.from("cabinets").select("id").eq("id", activeId);

      expect(error).toBeNull();
      expect(data).toEqual([{ id: activeId }]);
    });

    it("does not see an archived cabinet", async () => {
      const { data, error } = await electricianClient.from("cabinets").select("id").eq("id", archivedId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is refused an insert", async () => {
      const { error } = await electricianClient.from("cabinets").insert(testCabinet());

      expect(error?.code).toBe("42501");
    });

    it("updates zero rows", async () => {
      const { data, error } = await electricianClient
        .from("cabinets")
        .update({ price_grosze: 1 })
        .eq("id", activeId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("cabinets").select("price_grosze").eq("id", activeId).single();
      expect(after.data?.price_grosze).toBe(1000);
    });
  });

  it("refuses anon a select with 42501", async () => {
    const { error } = await createUserClient(env).from("cabinets").select("id");

    expect(error?.code).toBe("42501");
  });

  describe("as the admin", () => {
    it("inserts, updates, archives and restores a cabinet", async () => {
      const inserted = await adminClient.from("cabinets").insert(testCabinet()).select("id").single();
      expect(inserted.error).toBeNull();
      const id = inserted.data?.id ?? "";
      // An empty id would make the cleanup's `.in("id", …)` fail with 22P02 and leak every row.
      if (id) createdCabinetIds.push(id);

      const updated = await adminClient
        .from("cabinets")
        .update({ price_grosze: 2500 })
        .eq("id", id)
        .select("price_grosze");
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual([{ price_grosze: 2500 }]);

      const archived = await adminClient
        .from("cabinets")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .select("archived_at");
      expect(archived.error).toBeNull();
      expect(archived.data?.[0]?.archived_at).not.toBeNull();

      const restored = await adminClient
        .from("cabinets")
        .update({ archived_at: null })
        .eq("id", id)
        .select("archived_at");
      expect(restored.error).toBeNull();
      expect(restored.data).toEqual([{ archived_at: null }]);
    });

    it("still sees an archived cabinet", async () => {
      const { data, error } = await adminClient.from("cabinets").select("id").eq("id", archivedId);

      expect(error).toBeNull();
      expect(data).toEqual([{ id: archivedId }]);
    });

    it("is refused a delete with 42501", async () => {
      const { error } = await adminClient.from("cabinets").delete().eq("id", activeId);

      expect(error?.code).toBe("42501");

      const after = await service.from("cabinets").select("id").eq("id", activeId);
      expect(after.data).toEqual([{ id: activeId }]);
    });

    it("advances updated_at on update", async () => {
      const id = await seedCabinet();
      const before = await service.from("cabinets").select("updated_at").eq("id", id).single();

      const { error } = await adminClient.from("cabinets").update({ name: "Szafka testowa po zmianie" }).eq("id", id);
      expect(error).toBeNull();

      const after = await service.from("cabinets").select("updated_at").eq("id", id).single();
      expect(Date.parse(after.data?.updated_at ?? "")).toBeGreaterThan(Date.parse(before.data?.updated_at ?? ""));
    });
  });

  describe("check constraints", () => {
    it("rejects a price of zero or less", async () => {
      for (const price of [0, -100]) {
        const { error } = await adminClient.from("cabinets").insert(testCabinet({ price_grosze: price }));
        expect(error?.code).toBe("23514");
      }
    });

    it("rejects a geometry that is not an object", async () => {
      for (const geometry of [[MINIMAL_GEOMETRY], "geometria", 1]) {
        const { error } = await adminClient.from("cabinets").insert(testCabinet({ geometry }));
        expect(error?.code).toBe("23514");
      }
    });

    it("rejects a geometry at another version", async () => {
      const { error } = await adminClient
        .from("cabinets")
        .insert(testCabinet({ geometry: { ...MINIMAL_GEOMETRY, version: 2 } }));
      expect(error?.code).toBe("23514");
    });

    it("rejects a duplicate manufacturer and model differing only in case with 23505", async () => {
      const model = `RLS-case-${randomUUID()}`;
      await seedCabinet({ model });

      const { error } = await adminClient
        .from("cabinets")
        .insert(testCabinet({ manufacturer: TEST_MANUFACTURER.toUpperCase(), model: model.toLowerCase() }));
      expect(error?.code).toBe("23505");
    });
  });

  describe("seeded starter cabinets", () => {
    it("are three valid, clearly different geometries", async () => {
      const { data, error } = await service
        .from("cabinets")
        .select("model, geometry")
        .eq("manufacturer", SAMPLE_MANUFACTURER)
        // Keyed on the seeded models, so a sample cabinet added locally through the UI doesn't break it.
        .in("model", SEEDED_MODELS);

      expect(error).toBeNull();
      const rows = data ?? [];
      expect(rows).toHaveLength(3);

      const geometries = rows.map((row) => {
        const parsed = parseCabinetGeometry(row.geometry);
        expect(parsed, `${row.model} must be valid geometry`).toMatchObject({ ok: true });
        if (!parsed.ok) throw new Error(`${row.model} is not valid geometry`);
        return parsed.geometry;
      });

      const interiors = geometries.map(
        ({ interior }) => `${interior.widthMm}x${interior.heightMm}x${interior.depthMm}`,
      );
      expect(new Set(interiors).size).toBe(3);
      expect(new Set(geometries.map(({ rails }) => rails.length)).size).toBe(3);
    });
  });
});
