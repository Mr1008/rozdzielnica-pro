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
 * `public.business_profiles` is owner-only: an electrician reads and writes their own row, another
 * electrician and the admin see nothing and write nothing, and nobody deletes. The CHECKs mirror
 * `src/lib/business-profile.ts`, so the CHECK cases here pin the database side of that pair.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

const BUSINESS = {
  company_name: "Elektro Kowalski",
  nip: "5260250995",
  address: "ul. Długa 1\n00-001 Warszawa",
  phone: "+48 123 456 789",
  email: "biuro@example.pl",
};

describe("row level security on public.business_profiles", () => {
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
    electricianA = await createElectrician(service, "business-a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "business-b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));

    const { data: adminUser, error } = await adminClient.auth.getUser();
    if (error) throw new Error(`Could not read the seeded admin: ${error.message}`);
    adminId = adminUser.user.id;

    // A's row exists before any test runs, so the isolation cases never depend on test order.
    const seeded = await service.from("business_profiles").insert({ user_id: electricianA.id, ...BUSINESS });
    if (seeded.error) throw new Error(`Could not seed A's business row: ${seeded.error.message}`);
  });

  afterAll(async () => {
    // Deleting the auth user cascades through `profiles` to `business_profiles`.
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
    // The admin is seeded, not created here, so its row (if a regression let one through) is
    // removed explicitly rather than by cascade.
    if (adminId) await service.from("business_profiles").delete().eq("user_id", adminId);
  });

  describe("as the owner", () => {
    it("upserts and reads their own row", async () => {
      const updated = { ...BUSINESS, company_name: "Elektro Nowak" };
      const { error } = await clientA
        .from("business_profiles")
        .upsert({ user_id: electricianA.id, ...updated }, { onConflict: "user_id" });
      expect(error).toBeNull();

      const { data, error: readError } = await clientA
        .from("business_profiles")
        .select("user_id, company_name, nip, address, phone, email");
      expect(readError).toBeNull();
      expect(data).toEqual([{ user_id: electricianA.id, ...updated }]);
    });

    it("can create a first row by upsert, with every column null", async () => {
      const empty = { company_name: null, nip: null, address: null, phone: null, email: null };
      const { error } = await clientB
        .from("business_profiles")
        .upsert({ user_id: electricianB.id, ...empty }, { onConflict: "user_id" });
      expect(error).toBeNull();

      const { data } = await clientB.from("business_profiles").select("user_id");
      expect(data).toEqual([{ user_id: electricianB.id }]);
    });

    it("is refused an invalid value with 23514", async () => {
      const cases = [
        { nip: "52602509950" },
        { nip: "526025099" },
        { nip: "52602509ab" },
        { company_name: "" },
        { company_name: " padded " },
        { company_name: "a".repeat(201) },
        { address: "a".repeat(301) },
        { phone: "12 345 abc" },
        { phone: "1".repeat(31) },
        { email: "no-at-sign" },
        { email: "a b@c.pl" },
      ];
      for (const patch of cases) {
        const { error } = await clientA.from("business_profiles").update(patch).eq("user_id", electricianA.id);
        expect(error?.code, JSON.stringify(patch)).toBe("23514");
      }
    });

    it("accepts every bound value", async () => {
      const cases = [
        { company_name: "a".repeat(200), address: "a".repeat(300), phone: "1".repeat(30) },
        { company_name: "a", address: "a", phone: "1", nip: null, email: "a@b" },
      ];
      for (const patch of cases) {
        const { error } = await clientA.from("business_profiles").update(patch).eq("user_id", electricianA.id);
        expect(error, JSON.stringify(patch)).toBeNull();
      }
    });

    it("is refused moving their row to another user with 42501", async () => {
      // A fresh electrician without a row, so the refusal is the `with check`, not the primary key.
      const victim = await createElectrician(service, "business-move");
      createdUserIds.push(victim.id);

      const { error } = await clientA
        .from("business_profiles")
        .update({ user_id: victim.id })
        .eq("user_id", electricianA.id);
      expect(error?.code).toBe("42501");

      const { data } = await service
        .from("business_profiles")
        .select("user_id")
        .in("user_id", [electricianA.id, victim.id]);
      expect(data).toEqual([{ user_id: electricianA.id }]);
    });

    it("is refused a delete, and the row survives", async () => {
      const { error } = await clientA.from("business_profiles").delete().eq("user_id", electricianA.id);
      expect(error?.code).toBe("42501");

      const { data } = await service.from("business_profiles").select("user_id").eq("user_id", electricianA.id);
      expect(data).toEqual([{ user_id: electricianA.id }]);
    });
  });

  describe("as another electrician", () => {
    it("reads zero rows of A's data", async () => {
      const { data, error } = await clientB.from("business_profiles").select("user_id").eq("user_id", electricianA.id);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("is refused an insert of a row for A with 42501", async () => {
      // A's row already exists, so a plain insert could fail on the primary key instead; a fresh
      // electrician without a row isolates the policy refusal.
      const victim = await createElectrician(service, "business-victim");
      createdUserIds.push(victim.id);

      const { error } = await clientB.from("business_profiles").insert({ user_id: victim.id, ...BUSINESS });
      expect(error?.code).toBe("42501");

      const { data } = await service.from("business_profiles").select("user_id").eq("user_id", victim.id);
      expect(data).toEqual([]);
    });

    it("is refused an upsert over A's row with 42501", async () => {
      const { error } = await clientB
        .from("business_profiles")
        .upsert({ user_id: electricianA.id, ...BUSINESS, company_name: "Hijacked" }, { onConflict: "user_id" });
      expect(error?.code).toBe("42501");
    });

    it("updates zero rows of A's data", async () => {
      const before = await service.from("business_profiles").select("*").eq("user_id", electricianA.id).single();

      const { data, error } = await clientB
        .from("business_profiles")
        .update({ company_name: "Hijacked" })
        .eq("user_id", electricianA.id)
        .select("user_id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const after = await service.from("business_profiles").select("*").eq("user_id", electricianA.id).single();
      expect(after.data).toEqual(before.data);
    });
  });

  describe("as the admin", () => {
    it("reads zero rows", async () => {
      const { data, error } = await adminClient.from("business_profiles").select("user_id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot insert a row even for themselves (role predicate) — 42501", async () => {
      const { error } = await adminClient.from("business_profiles").insert({ user_id: adminId, ...BUSINESS });
      expect(error?.code).toBe("42501");

      const { data } = await service.from("business_profiles").select("user_id").eq("user_id", adminId);
      expect(data).toEqual([]);
    });

    it("is refused an upsert over an electrician's row with 42501", async () => {
      const before = await service.from("business_profiles").select("*").eq("user_id", electricianA.id).single();

      const { error } = await adminClient
        .from("business_profiles")
        .upsert({ user_id: electricianA.id, ...BUSINESS, company_name: "Hijacked" }, { onConflict: "user_id" });
      expect(error?.code).toBe("42501");

      const after = await service.from("business_profiles").select("*").eq("user_id", electricianA.id).single();
      expect(after.data).toEqual(before.data);
    });

    it("updates zero rows of an electrician's data", async () => {
      const { data, error } = await adminClient
        .from("business_profiles")
        .update({ company_name: "Hijacked" })
        .eq("user_id", electricianA.id)
        .select("user_id");

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  it("refuses anon a select with 42501", async () => {
    const { error } = await createUserClient(env).from("business_profiles").select("user_id");

    expect(error?.code).toBe("42501");
  });

  it("refuses anon an insert and an update with 42501", async () => {
    const anon = createUserClient(env);

    const inserted = await anon.from("business_profiles").insert({ user_id: electricianA.id, ...BUSINESS });
    expect(inserted.error?.code).toBe("42501");

    const updated = await anon
      .from("business_profiles")
      .update({ company_name: "Hijacked" })
      .eq("user_id", electricianA.id);
    expect(updated.error?.code).toBe("42501");
  });

  it("cascades a business row away when its account is deleted", async () => {
    const doomed = await createElectrician(service, "business-cascade");
    createdUserIds.push(doomed.id);
    const inserted = await service.from("business_profiles").insert({ user_id: doomed.id, ...BUSINESS });
    expect(inserted.error).toBeNull();

    const { error } = await service.auth.admin.deleteUser(doomed.id);
    expect(error).toBeNull();

    const after = await service.from("business_profiles").select("user_id").eq("user_id", doomed.id);
    expect(after.data).toEqual([]);
  });
});
