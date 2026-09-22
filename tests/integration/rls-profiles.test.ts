import { execSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Row level security is the only isolation boundary this application has: `src/lib/supabase.ts`
 * builds a cookie-scoped client that acts as the signed-in user, and there is no service-role
 * escape hatch anywhere in application code. An HTTP test cannot see an RLS denial — a policy that
 * returns the wrong rows still answers 200 — so these assertions run against the database itself.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

type UserRole = "admin" | "elektryk";

/**
 * A hand-written slice of the generated `Database` type, covering only what these tests query.
 * Without it every PostgREST response comes back as `any`, which the repo's `strictTypeChecked`
 * ESLint config rejects.
 */
interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { id: string; role?: UserRole; full_name?: string | null };
        Update: { role?: UserRole; full_name?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

interface StackEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface Electrician {
  id: string;
  email: string;
  password: string;
}

/** Seeded by `supabase/seed.sql` on every `supabase start` and `supabase db reset`. */
const SEEDED_ADMIN = { email: "admin@example.com", password: "admin123456" };

function runSupabaseStatus(): string {
  try {
    return execSync("npx supabase status -o env", { encoding: "utf8" });
  } catch {
    throw new Error("The local Supabase stack is not reachable. Start it with `npx supabase start`.");
  }
}

/**
 * Never read the stack's credentials from a committed file: `.env` and `.dev.vars` are gitignored
 * and CI has neither. `supabase status -o env` is the one source that is correct everywhere.
 */
function readStackEnv(): StackEnv {
  const values = new Map<string, string>();
  const output = runSupabaseStatus();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line);
    if (match) {
      values.set(match[1], match[2]);
    }
  }

  const apiUrl = values.get("API_URL");
  const anonKey = values.get("ANON_KEY");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error("`supabase status -o env` reported no API_URL, ANON_KEY or SERVICE_ROLE_KEY.");
  }

  return { apiUrl, anonKey, serviceRoleKey };
}

/** The shape the application uses: the anon key plus a user's own token, so RLS applies. */
function createUserClient(env: StackEnv) {
  return createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Test-harness only. The application never holds a service-role key — see AGENTS.md. */
function createServiceClient(env: StackEnv) {
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type UserClient = ReturnType<typeof createUserClient>;
type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The custom claim is `user_role`, never `role`: the built-in `role` claim already carries
 * `authenticated`/`anon` and PostgREST switches database roles on it.
 */
const claimsSchema = z.object({
  sub: z.string(),
  role: z.string(),
  user_role: z.string().optional(),
});

function decodeClaims(accessToken: string) {
  const payloadSegment = accessToken.split(".")[1];
  const payload: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  return claimsSchema.parse(payload);
}

/**
 * Created through the admin API with `email_confirm: true` rather than through the public signup
 * endpoint, so these tests keep working when `enable_confirmations` is turned on later.
 */
async function createElectrician(service: ServiceClient, label: string): Promise<Electrician> {
  const email = `rls-${label}-${Date.now()}@example.com`;
  const password = "test-password-123";

  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    throw new Error(`Could not create the test user ${email}: ${error.message}`);
  }

  return { id: data.user.id, email, password };
}

async function signIn(env: StackEnv, email: string, password: string) {
  const client = createUserClient(env);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Could not sign in as ${email}: ${error.message}`);
  }

  return { client, accessToken: data.session.access_token };
}

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

    electricianA = await createElectrician(service, "a");
    electricianB = await createElectrician(service, "b");
    createdUserIds.push(electricianA.id, electricianB.id);

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
