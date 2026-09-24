import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
 * `public.pricing_profiles` is owner-only: an electrician reads and writes their own row, another
 * electrician and the admin see nothing and write nothing, and nobody deletes. The bounds CHECKs
 * mirror `src/lib/pricing-profile.ts`, so the CHECK cases here pin the database side of that pair.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

const PRICING = { hourly_rate_grosze: 12050, mount_minutes_per_device: 15, project_overhead_minutes: 30 };

describe("row level security on public.pricing_profiles", () => {
  const createdUserIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianA: Electrician;
  let electricianB: Electrician;
  let clientA: UserClient;
  let clientB: UserClient;
  let adminClient: UserClient;
  let adminId: string;

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    // Record each id as soon as its user exists, not after both — see `rls-profiles.test.ts`.
    electricianA = await createElectrician(service, "pricing-a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "pricing-b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const { data: adminUser, error } = await adminClient.auth.getUser();
    if (error) throw new Error(`Could not read the seeded admin: ${error.message}`);
    adminId = adminUser.user.id;

    // A's row exists before any test runs, so the isolation cases never depend on test order.
    const seeded = await service.from("pricing_profiles").insert({ user_id: electricianA.id, ...PRICING });
    if (seeded.error) throw new Error(`Could not seed A's pricing row: ${seeded.error.message}`);
  });

  afterAll(async () => {
    // Deleting the auth user cascades through `profiles` to `pricing_profiles`.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
    // The admin is seeded, not created here, so its row (if a regression let one through) is
    // removed explicitly rather than by cascade.
    if (adminId) await service.from("pricing_profiles").delete().eq("user_id", adminId);
  });

  describe("as the owner", () => {
    it("upserts and reads their own row", async () => {
      const updated = { ...PRICING, mount_minutes_per_device: 20 };
      const { error } = await clientA
        .from("pricing_profiles")
        .upsert({ user_id: electricianA.id, ...updated }, { onConflict: "user_id" });
      expect(error).toBeNull();

      const { data, error: readError } = await clientA
        .from("pricing_profiles")
        .select("user_id, hourly_rate_grosze, mount_minutes_per_device, project_overhead_minutes");
      expect(readError).toBeNull();
      expect(data).toEqual([{ user_id: electricianA.id, ...updated }]);
    });

    it("can create a first row by upsert", async () => {
      const { error } = await clientB
        .from("pricing_profiles")
        .upsert({ user_id: electricianB.id, ...PRICING }, { onConflict: "user_id" });
      expect(error).toBeNull();

      const { data } = await clientB.from("pricing_profiles").select("user_id");
      expect(data).toEqual([{ user_id: electricianB.id }]);
    });

    it("is refused an out-of-range value with 23514", async () => {
      const cases = [
        { mount_minutes_per_device: 0 },
        { mount_minutes_per_device: 601 },
        { project_overhead_minutes: -1 },
        { project_overhead_minutes: 6001 },
        { hourly_rate_grosze: 0 },
      ];
      for (const patch of cases) {
        const { error } = await clientA.from("pricing_profiles").update(patch).eq("user_id", electricianA.id);
        expect(error?.code, JSON.stringify(patch)).toBe("23514");
      }
    });

    it("accepts every bound value", async () => {
      const cases = [
        { mount_minutes_per_device: 1, project_overhead_minutes: 0, hourly_rate_grosze: 1 },
        { mount_minutes_per_device: 600, project_overhead_minutes: 6000, hourly_rate_grosze: 2_147_483_647 },
      ];
      for (const patch of cases) {
        const { error } = await clientA.from("pricing_profiles").update(patch).eq("user_id", electricianA.id);
        expect(error, JSON.stringify(patch)).toBeNull();
      }
    });

    it("is refused a delete, and the row survives", async () => {
      const { error } = await clientA.from("pricing_profiles").delete().eq("user_id", electricianA.id);
      expect(error?.code).toBe("42501");

      const { data } = await service.from("pricing_profiles").select("user_id").eq("user_id", electricianA.id);
      expect(data).toEqual([{ user_id: electricianA.id }]);
    });
  });

  describe("as another electrician", () => {
    it("reads zero rows of A's data", async () => {
      const { data, error } = await clientB.from("pricing_profiles").select("user_id").eq("user_id", electricianA.id);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is refused an insert of a row for A with 42501", async () => {
      // A's row already exists, so a plain insert could fail on the primary key instead; a fresh
      // electrician without a row isolates the policy refusal.
      const victim = await createElectrician(service, "pricing-victim");
      createdUserIds.push(victim.id);

      const { error } = await clientB.from("pricing_profiles").insert({ user_id: victim.id, ...PRICING });
      expect(error?.code).toBe("42501");

      const { data } = await service.from("pricing_profiles").select("user_id").eq("user_id", victim.id);
      expect(data).toEqual([]);
    });

    it("is refused an upsert over A's row with 42501", async () => {
      const { error } = await clientB
        .from("pricing_profiles")
        .upsert({ user_id: electricianA.id, ...PRICING, hourly_rate_grosze: 1 }, { onConflict: "user_id" });
      expect(error?.code).toBe("42501");
    });

    it("updates zero rows of A's data", async () => {
      const before = await service.from("pricing_profiles").select("*").eq("user_id", electricianA.id).single();

      const { data, error } = await clientB
        .from("pricing_profiles")
        .update({ hourly_rate_grosze: 1 })
        .eq("user_id", electricianA.id)
        .select("user_id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("pricing_profiles").select("*").eq("user_id", electricianA.id).single();
      expect(after.data).toEqual(before.data);
    });
  });

  describe("as the admin", () => {
    it("reads zero rows", async () => {
      const { data, error } = await adminClient.from("pricing_profiles").select("user_id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot insert a row even for themselves (role predicate) — 42501", async () => {
      const { error } = await adminClient.from("pricing_profiles").insert({ user_id: adminId, ...PRICING });
      expect(error?.code).toBe("42501");

      const { data } = await service.from("pricing_profiles").select("user_id").eq("user_id", adminId);
      expect(data).toEqual([]);
    });

    it("updates zero rows of an electrician's data", async () => {
      const { data, error } = await adminClient
        .from("pricing_profiles")
        .update({ hourly_rate_grosze: 1 })
        .eq("user_id", electricianA.id)
        .select("user_id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  it("refuses anon a select with 42501", async () => {
    const { error } = await createUserClient(env).from("pricing_profiles").select("user_id");

    expect(error?.code).toBe("42501");
  });

  it("cascades a pricing row away when its account is deleted", async () => {
    const doomed = await createElectrician(service, "pricing-cascade");
    createdUserIds.push(doomed.id);
    const inserted = await service.from("pricing_profiles").insert({ user_id: doomed.id, ...PRICING });
    expect(inserted.error).toBeNull();

    const { error } = await service.auth.admin.deleteUser(doomed.id);
    expect(error).toBeNull();

    const after = await service.from("pricing_profiles").select("user_id").eq("user_id", doomed.id);
    expect(after.data).toEqual([]);
  });
});
