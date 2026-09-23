import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SEEDED_ADMIN,
  createElectrician,
  createServiceClient,
  decodeClaims,
  readStackEnv,
  signIn,
  type Electrician,
  type ServiceClient,
  type StackEnv,
  type UserClient,
} from "./support";

/**
 * Row level security is the only isolation boundary this application has: `src/lib/supabase.ts`
 * builds a cookie-scoped client that acts as the signed-in user, and there is no service-role
 * escape hatch anywhere in application code. An HTTP test cannot see an RLS denial — a policy that
 * returns the wrong rows still answers 200 — so these assertions run against the database itself.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

describe("row level security on public.profiles", () => {
  const createdUserIds: string[] = [];

  let env: StackEnv;
  let service: ServiceClient;
  let electricianA: Electrician;
  let electricianB: Electrician;
  let clientA: UserClient;
  let clientB: UserClient;
  let adminClient: UserClient;
  let tokenA: string;
  let adminToken: string;

  beforeAll(async () => {
    env = readStackEnv();
    service = createServiceClient(env);

    // Record each id as soon as its user exists, not after both: if the second creation throws, the
    // first user would otherwise never reach `afterAll`'s cleanup and would outlive the run in a
    // developer's persistent Docker volume.
    electricianA = await createElectrician(service, "a");
    createdUserIds.push(electricianA.id);
    electricianB = await createElectrician(service, "b");
    createdUserIds.push(electricianB.id);

    ({ client: clientA, accessToken: tokenA } = await signIn(env, electricianA.email, electricianA.password));
    ({ client: clientB } = await signIn(env, electricianB.email, electricianB.password));
    ({ client: adminClient, accessToken: adminToken } = await signIn(env, SEEDED_ADMIN.email, SEEDED_ADMIN.password));
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id);
    }
  });

  it("gives an electrician their own profile row", async () => {
    const { data, error } = await clientB.from("profiles").select("id, role").eq("id", electricianB.id);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: electricianB.id, role: "elektryk" }]);
  });

  it("returns zero rows — not an error — when an electrician asks for another electrician's row", async () => {
    const { data, error } = await clientA.from("profiles").select("id, role").eq("id", electricianB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses to let an electrician change their own role", async () => {
    const { error } = await clientA.from("profiles").update({ role: "admin" }).eq("id", electricianA.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toContain("Only an admin may change a profile role");

    const { data } = await clientA.from("profiles").select("role").eq("id", electricianA.id);
    expect(data).toEqual([{ role: "elektryk" }]);
  });

  it("still lets an electrician edit the rest of their own profile", async () => {
    const { error } = await clientA.from("profiles").update({ full_name: "Anna Elektryk" }).eq("id", electricianA.id);

    expect(error).toBeNull();

    const { data } = await clientA.from("profiles").select("full_name").eq("id", electricianA.id);
    expect(data).toEqual([{ full_name: "Anna Elektryk" }]);
  });

  it("lets the seeded admin read every profile row", async () => {
    const { data, error } = await adminClient.from("profiles").select("id");

    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(electricianA.id);
    expect(ids).toContain(electricianB.id);
  });

  it("stamps user_role into every issued JWT without touching the built-in role claim", () => {
    const electricianClaims = decodeClaims(tokenA);
    const adminClaims = decodeClaims(adminToken);

    expect(electricianClaims.user_role).toBe("elektryk");
    expect(adminClaims.user_role).toBe("admin");
    expect(electricianClaims.role).toBe("authenticated");
    expect(adminClaims.role).toBe("authenticated");
  });

  it("cascades a profile away when its auth.users row is deleted", async () => {
    const doomed = await createElectrician(service, "cascade");

    const before = await service.from("profiles").select("id").eq("id", doomed.id);
    expect(before.error).toBeNull();
    expect(before.data).toEqual([{ id: doomed.id }]);

    const { error } = await service.auth.admin.deleteUser(doomed.id);
    expect(error).toBeNull();

    const after = await service.from("profiles").select("id").eq("id", doomed.id);
    expect(after.error).toBeNull();
    expect(after.data).toEqual([]);
  });
});
