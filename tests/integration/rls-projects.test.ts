import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Database } from "@/lib/database.types";
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
 * `public.projects` is owner-only: an electrician reads, writes and deletes their own projects,
 * another electrician and the admin see nothing and write nothing. The cabinet snapshot is owned by
 * the `projects_snapshot_cabinet` trigger — a client-sent snapshot is ignored, an admin edit or
 * archive of the cabinet never reaches an existing project. The supply CHECKs mirror
 * `src/lib/supply-params.ts`, so the CHECK cases here pin the database side of that pair.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

type CabinetInsert = Database["public"]["Tables"]["cabinets"]["Insert"];

const TEST_MANUFACTURER = "Producent testowy RLS projektów";

const GEOMETRY_A: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 200, heightMm: 150, depthMm: 80 },
  rails: [{ xMm: 10, yMm: 50, lengthMm: 180 }],
  entries: [{ side: "top", offsetMm: 20, lengthMm: 100 }],
  bars: [],
};

const GEOMETRY_B: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 400, heightMm: 300, depthMm: 100 },
  rails: [
    { xMm: 10, yMm: 50, lengthMm: 380 },
    { xMm: 10, yMm: 200, lengthMm: 380 },
  ],
  entries: [{ side: "bottom", offsetMm: 50, lengthMm: 200 }],
  bars: [],
};

const SUPPLY: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-C-S",
  phase_count: 1,
  wlz_length_m: 15,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

/** Unique per call, so repeated runs against a persistent volume never collide on the unique index. */
function testCabinet(overrides: Partial<CabinetInsert> = {}): CabinetInsert {
  return {
    name: "Szafka testowa projektów",
    manufacturer: TEST_MANUFACTURER,
    model: `RLS-PRJ-${randomUUID()}`,
    price_grosze: 15000,
    geometry: GEOMETRY_A,
    ...overrides,
  };
}

describe("row level security and the cabinet snapshot on public.projects", () => {
  const createdUserIds: string[] = [];
  const createdCabinetIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianA: Electrician;
  let electricianB: Electrician;
  let clientA: UserClient;
  let clientB: UserClient;
  let adminClient: UserClient;
  let adminId: string;
  let cabinetA: string;
  let cabinetB: string;
  let archivedCabinet: string;
  let projectA: string;

  /** Inserts through the service client, bypassing RLS, and records the row for cleanup. */
  async function seedCabinet(overrides: Partial<CabinetInsert> = {}): Promise<string> {
    const { data, error } = await service.from("cabinets").insert(testCabinet(overrides)).select("id").single();
    if (error) throw new Error(`Could not create a test cabinet: ${error.message}`);
    createdCabinetIds.push(data.id);
    return data.id;
  }

  /** A project for A, inserted as A so the trigger runs under A's RLS. */
  async function insertProjectAsA(cabinetId: string): Promise<string> {
    const { data, error } = await clientA
      .from("projects")
      .insert({ user_id: electricianA.id, name: "Projekt testowy", cabinet_id: cabinetId })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create A's project: ${error.code}`);
    return data.id;
  }

  async function readSnapshot(projectId: string) {
    const { data, error } = await service
      .from("projects")
      .select("cabinet_id, cabinet_geometry, cabinet_name, cabinet_manufacturer, cabinet_model, cabinet_price_grosze")
      .eq("id", projectId)
      .single();
    if (error) throw new Error(`Could not read project ${projectId}: ${error.code}`);
    return data;
  }

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    // Record each id as soon as its user exists, not after both — see `rls-profiles.test.ts`.
    electricianA = await createElectrician(service, "projects-a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "projects-b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const { data: adminUser, error } = await adminClient.auth.getUser();
    if (error) throw new Error(`Could not read the seeded admin: ${error.message}`);
    adminId = adminUser.user.id;

    cabinetA = await seedCabinet({ name: "Szafka A", price_grosze: 15000, geometry: GEOMETRY_A });
    cabinetB = await seedCabinet({ name: "Szafka B", price_grosze: 32000, geometry: GEOMETRY_B });
    archivedCabinet = await seedCabinet({ archived_at: new Date().toISOString() });

    // A's project exists before any test runs, so the isolation cases never depend on test order.
    projectA = await insertProjectAsA(cabinetA);
  });

  afterAll(async () => {
    // Projects first: deleting the auth user cascades through `profiles` to `projects`, and only
    // then are the cabinets free of the `cabinet_id` foreign key.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
    // The admin is seeded, not created here, so its rows (if a regression let one through) are
    // removed explicitly rather than by cascade.
    if (adminId) await service.from("projects").delete().eq("user_id", adminId);
    if (createdCabinetIds.length > 0) {
      const { error } = await service.from("cabinets").delete().in("id", createdCabinetIds);
      if (error) throw new Error(`Test cabinets were not cleaned up: ${error.code}`);
    }
  });

  describe("as the owner", () => {
    it("inserts, reads, updates and deletes their own project", async () => {
      const inserted = await clientA
        .from("projects")
        .insert({
          user_id: electricianA.id,
          name: "Dom Kowalskich",
          client_name: "Jan Kowalski",
          site_address: "ul. Polna 1",
          cabinet_id: cabinetA,
        })
        .select("id, name, client_name, site_address")
        .single();
      expect(inserted.error).toBeNull();
      const id = inserted.data?.id ?? "";
      expect(inserted.data).toEqual({
        id,
        name: "Dom Kowalskich",
        client_name: "Jan Kowalski",
        site_address: "ul. Polna 1",
      });

      const read = await clientA.from("projects").select("id").eq("id", id);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id }]);

      const updated = await clientA
        .from("projects")
        .update({ name: "Dom Nowaków", ...SUPPLY })
        .eq("id", id)
        .select("name, premeter_protection_a, wlz_length_m, wlz_cross_section_mm2");
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual([
        { name: "Dom Nowaków", premeter_protection_a: 25, wlz_length_m: 15, wlz_cross_section_mm2: 10 },
      ]);

      const deleted = await clientA.from("projects").delete().eq("id", id).select("id");
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([{ id }]);

      const after = await service.from("projects").select("id").eq("id", id);
      expect(after.data).toEqual([]);
    });

    it("is refused moving their project to another user with 42501", async () => {
      const { error } = await clientA.from("projects").update({ user_id: electricianB.id }).eq("id", projectA);
      expect(error?.code).toBe("42501");

      const { data } = await service.from("projects").select("user_id").eq("id", projectA).single();
      expect(data?.user_id).toBe(electricianA.id);
    });

    it("is refused an insert of a project for another user with 42501", async () => {
      const { error } = await clientA
        .from("projects")
        .insert({ user_id: electricianB.id, name: "Cudzy projekt", cabinet_id: cabinetA });
      expect(error?.code).toBe("42501");
    });

    it("advances updated_at on update", async () => {
      const before = await service.from("projects").select("updated_at").eq("id", projectA).single();

      const { error } = await clientA.from("projects").update({ client_name: "Anna Nowak" }).eq("id", projectA);
      expect(error).toBeNull();

      const after = await service.from("projects").select("updated_at").eq("id", projectA).single();
      expect(Date.parse(after.data?.updated_at ?? "")).toBeGreaterThan(Date.parse(before.data?.updated_at ?? ""));
    });
  });

  describe("as another electrician", () => {
    it("reads zero of A's rows", async () => {
      const { data, error } = await clientB.from("projects").select("id").eq("user_id", electricianA.id);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("updates zero rows of A's project", async () => {
      const before = await service.from("projects").select("*").eq("id", projectA).single();

      const { data, error } = await clientB
        .from("projects")
        .update({ name: "Przejęty projekt" })
        .eq("id", projectA)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("projects").select("*").eq("id", projectA).single();
      expect(after.data).toEqual(before.data);
    });

    it("deletes zero rows of A's project", async () => {
      const { data, error } = await clientB.from("projects").delete().eq("id", projectA).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("projects").select("id").eq("id", projectA);
      expect(after.data).toEqual([{ id: projectA }]);
    });
  });

  describe("as the admin", () => {
    it("reads zero rows", async () => {
      const { data, error } = await adminClient.from("projects").select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot insert a project even for themselves (role predicate) — 42501", async () => {
      const { error } = await adminClient
        .from("projects")
        .insert({ user_id: adminId, name: "Projekt admina", cabinet_id: cabinetA });
      expect(error?.code).toBe("42501");

      const { data } = await service.from("projects").select("id").eq("user_id", adminId);
      expect(data).toEqual([]);
    });

    it("updates and deletes zero rows of an electrician's project", async () => {
      const updated = await adminClient
        .from("projects")
        .update({ name: "Zmiana admina" })
        .eq("id", projectA)
        .select("id");
      expect(updated.error).toBeNull();
      expect(updated.data).toEqual([]);

      const deleted = await adminClient.from("projects").delete().eq("id", projectA).select("id");
      expect(deleted.error).toBeNull();
      expect(deleted.data).toEqual([]);

      const after = await service.from("projects").select("name").eq("id", projectA).single();
      expect(after.data?.name).not.toBe("Zmiana admina");
    });
  });

  it("refuses anon a select, an insert, an update and a delete with 42501", async () => {
    const anon = createUserClient(env);

    const selected = await anon.from("projects").select("id");
    expect(selected.error?.code).toBe("42501");

    const inserted = await anon
      .from("projects")
      .insert({ user_id: electricianA.id, name: "Projekt anonima", cabinet_id: cabinetA });
    expect(inserted.error?.code).toBe("42501");

    const updated = await anon.from("projects").update({ name: "Zmiana anonima" }).eq("id", projectA);
    expect(updated.error?.code).toBe("42501");

    const deleted = await anon.from("projects").delete().eq("id", projectA);
    expect(deleted.error?.code).toBe("42501");
  });

  describe("the cabinet snapshot", () => {
    it("replaces a client-sent snapshot with the cabinet's values on insert", async () => {
      const { data, error } = await clientA
        .from("projects")
        .insert({
          user_id: electricianA.id,
          name: "Projekt z podrobionym snapshotem",
          cabinet_id: cabinetA,
          cabinet_geometry: GEOMETRY_B,
          cabinet_name: "Podrobiona nazwa",
          cabinet_price_grosze: 1,
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      const snapshot = await readSnapshot(data?.id ?? "");
      expect(snapshot.cabinet_geometry).toEqual(GEOMETRY_A);
      expect(snapshot.cabinet_name).toBe("Szafka A");
      expect(snapshot.cabinet_manufacturer).toBe(TEST_MANUFACTURER);
      expect(snapshot.cabinet_price_grosze).toBe(15000);
    });

    it("refuses an insert with an archived cabinet with P0002", async () => {
      const { error } = await clientA
        .from("projects")
        .insert({ user_id: electricianA.id, name: "Projekt z archiwalną szafką", cabinet_id: archivedCabinet });
      expect(error?.code).toBe("P0002");
    });

    it("refuses an insert with a cabinet that does not exist with P0002", async () => {
      const { error } = await clientA
        .from("projects")
        .insert({ user_id: electricianA.id, name: "Projekt z nieistniejącą szafką", cabinet_id: randomUUID() });
      expect(error?.code).toBe("P0002");
    });

    it("ignores an update of the snapshot columns alone", async () => {
      const before = await readSnapshot(projectA);

      const { error } = await clientA
        .from("projects")
        .update({ cabinet_geometry: GEOMETRY_B, cabinet_name: "Podrobiona nazwa", cabinet_price_grosze: 1 })
        .eq("id", projectA);
      expect(error).toBeNull();

      expect(await readSnapshot(projectA)).toEqual(before);
    });

    it("refuses changing to an archived cabinet with P0002, and keeps the snapshot", async () => {
      const before = await readSnapshot(projectA);

      const { error } = await clientA.from("projects").update({ cabinet_id: archivedCabinet }).eq("id", projectA);
      expect(error?.code).toBe("P0002");

      expect(await readSnapshot(projectA)).toEqual(before);
    });

    it("re-snapshots from the new cabinet when cabinet_id changes", async () => {
      const id = await insertProjectAsA(cabinetA);

      const { error } = await clientA.from("projects").update({ cabinet_id: cabinetB }).eq("id", id);
      expect(error).toBeNull();

      const snapshot = await readSnapshot(id);
      expect(snapshot.cabinet_id).toBe(cabinetB);
      expect(snapshot.cabinet_geometry).toEqual(GEOMETRY_B);
      expect(snapshot.cabinet_name).toBe("Szafka B");
      expect(snapshot.cabinet_price_grosze).toBe(32000);
    });

    it("survives the admin editing and archiving the cabinet, and the project still reads", async () => {
      const cabinet = await seedCabinet({ name: "Szafka do archiwizacji", geometry: GEOMETRY_A });
      const id = await insertProjectAsA(cabinet);
      const before = await readSnapshot(id);

      const edited = await service
        .from("cabinets")
        .update({ name: "Szafka po zmianie", price_grosze: 99900, geometry: GEOMETRY_B })
        .eq("id", cabinet);
      expect(edited.error).toBeNull();
      const archived = await service
        .from("cabinets")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", cabinet);
      expect(archived.error).toBeNull();

      expect(await readSnapshot(id)).toEqual(before);

      const { data, error } = await clientA.from("projects").select("id, cabinet_name, cabinet_geometry").eq("id", id);
      expect(error).toBeNull();
      expect(data).toEqual([{ id, cabinet_name: "Szafka do archiwizacji", cabinet_geometry: GEOMETRY_A }]);

      // An unrelated edit of the project neither fails on the now-archived cabinet nor re-snapshots.
      const renamed = await clientA.from("projects").update({ name: "Po archiwizacji szafki" }).eq("id", id);
      expect(renamed.error).toBeNull();
      expect(await readSnapshot(id)).toEqual(before);
    });
  });

  describe("check constraints", () => {
    it("accept a complete supply", async () => {
      const { error } = await clientA.from("projects").update(SUPPLY).eq("id", projectA);
      expect(error).toBeNull();
    });

    it("refuse a partial supply with 23514", async () => {
      const cases = [
        { premeter_protection_a: 25 },
        { ...SUPPLY, wlz_installation: null },
        { ...SUPPLY, wlz_length_m: null },
      ];
      for (const patch of cases) {
        const id = await insertProjectAsA(cabinetA);
        const { error } = await clientA.from("projects").update(patch).eq("id", id);
        expect(error?.code, JSON.stringify(patch)).toBe("23514");
      }
    });

    it("refuse an off-list or out-of-range supply value with 23514", async () => {
      const cases = [
        { premeter_protection_a: 30 },
        { phase_count: 2 },
        { wlz_length_m: 0 },
        { wlz_length_m: 500.1 },
        { wlz_cross_section_mm2: 1.5 },
      ];
      for (const patch of cases) {
        const { error } = await clientA
          .from("projects")
          .update({ ...SUPPLY, ...patch })
          .eq("id", projectA);
        expect(error?.code, JSON.stringify(patch)).toBe("23514");
      }
    });

    it("accept the length bounds", async () => {
      for (const wlz_length_m of [0.1, 500]) {
        const { error } = await clientA
          .from("projects")
          .update({ ...SUPPLY, wlz_length_m })
          .eq("id", projectA);
        expect(error, String(wlz_length_m)).toBeNull();
      }
    });

    it("refuse an off-enum supply value with 22P02", async () => {
      const { error } = await clientA
        .from("projects")
        // Cast past the generated types on purpose: this is what a tampered request sends.
        .update({ ...SUPPLY, earthing_system: "IT" as unknown as SupplyParams["earthing_system"] })
        .eq("id", projectA);
      expect(error?.code).toBe("22P02");
    });

    it("refuse a blank, untrimmed or over-long name and a blank client or address with 23514", async () => {
      const cases = [
        { name: "" },
        { name: " Dom" },
        { name: "a".repeat(201) },
        { client_name: "" },
        { client_name: "k".repeat(201) },
        { site_address: "" },
        { site_address: "a".repeat(301) },
      ];
      for (const patch of cases) {
        const { error } = await clientA.from("projects").update(patch).eq("id", projectA);
        expect(error?.code, JSON.stringify(patch).slice(0, 60)).toBe("23514");
      }
    });

    it("accept the text limits, counted in characters", async () => {
      const { error } = await clientA
        .from("projects")
        .update({ name: "🔌".repeat(200), client_name: "k".repeat(200), site_address: "a".repeat(300) })
        .eq("id", projectA);
      expect(error).toBeNull();
    });
  });

  it("cascades projects away when their account is deleted", async () => {
    const doomed = await createElectrician(service, "projects-cascade");
    createdUserIds.push(doomed.id);
    const inserted = await service
      .from("projects")
      .insert({ user_id: doomed.id, name: "Projekt do usunięcia", cabinet_id: cabinetA })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const { error } = await service.auth.admin.deleteUser(doomed.id);
    expect(error).toBeNull();

    const after = await service.from("projects").select("id").eq("user_id", doomed.id);
    expect(after.data).toEqual([]);
  });
});
