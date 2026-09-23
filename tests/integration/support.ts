import { execSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";

/**
 * The shared harness for the RLS integration suite. Every file here talks to the local stack as
 * real users, because an HTTP test cannot see an RLS denial — a policy that returns the wrong rows
 * still answers 200.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

export interface StackEnv {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface Electrician {
  id: string;
  email: string;
  password: string;
}

/** Seeded by `supabase/seed.sql` on every `supabase start` and `supabase db reset`. */
export const SEEDED_ADMIN = { email: "admin@example.com", password: "admin123456" };

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
export function readStackEnv(): StackEnv {
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

/**
 * The shape the application uses: the anon key plus a user's own token, so RLS applies. Unsigned,
 * it is also the `anon` client.
 */
export function createUserClient(env: StackEnv) {
  return createClient<Database>(env.apiUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Test-harness only. The application never holds a service-role key — see AGENTS.md. */
export function createServiceClient(env: StackEnv) {
  return createClient<Database>(env.apiUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type UserClient = ReturnType<typeof createUserClient>;
export type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The custom claim is `user_role`, never `role`: the built-in `role` claim already carries
 * `authenticated`/`anon` and PostgREST switches database roles on it.
 */
const claimsSchema = z.object({
  sub: z.string(),
  role: z.string(),
  user_role: z.string().optional(),
});

export function decodeClaims(accessToken: string) {
  const payloadSegment = accessToken.split(".")[1];
  const payload: unknown = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  return claimsSchema.parse(payload);
}

/**
 * Created through the admin API with `email_confirm: true` rather than through the public signup
 * endpoint, so these tests keep working when `enable_confirmations` is turned on later.
 */
export async function createElectrician(service: ServiceClient, label: string): Promise<Electrician> {
  const email = `rls-${label}-${Date.now()}@example.com`;
  const password = "test-password-123";

  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    throw new Error(`Could not create the test user ${email}: ${error.message}`);
  }

  return { id: data.user.id, email, password };
}

export async function signIn(env: StackEnv, email: string, password: string) {
  const client = createUserClient(env);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Could not sign in as ${email}: ${error.message}`);
  }

  return { client, accessToken: data.session.access_token };
}
