import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryDatabase } from "./support";

/**
 * A schema-wide guard: a new public table that ships without RLS, or without an RLS suite, fails
 * here. Classify the table below and write `tests/integration/rls-<table>.test.ts` for it.
 *
 * Needs the local stack up: `npx supabase start`, or `npx supabase db reset` for a clean one.
 */

type TableKind = "electrician" | "catalog" | "profile";

const TABLES: Record<string, { kind: TableKind; suite: string }> = {
  business_profiles: { kind: "electrician", suite: "rls-business-profiles.test.ts" },
  cabinets: { kind: "catalog", suite: "rls-cabinets.test.ts" },
  circuits: { kind: "electrician", suite: "rls-circuits.test.ts" },
  devices: { kind: "catalog", suite: "rls-devices.test.ts" },
  pricing_profiles: { kind: "electrician", suite: "rls-pricing-profiles.test.ts" },
  // The admin may read profiles by design, so this is neither electrician-only nor a catalog.
  profiles: { kind: "profile", suite: "rls-profiles.test.ts" },
  project_device_placements: { kind: "electrician", suite: "rls-layout.test.ts" },
  project_devices: { kind: "electrician", suite: "rls-circuits.test.ts" },
  projects: { kind: "electrician", suite: "rls-projects.test.ts" },
  rcd_groups: { kind: "electrician", suite: "rls-circuits.test.ts" },
};

const tableRowsSchema = z.array(z.object({ name: z.string(), rls: z.boolean() }));
const nameRowsSchema = z.array(z.object({ name: z.string() }));

const publicTables = tableRowsSchema.parse(
  queryDatabase(
    `select c.relname as name, c.relrowsecurity as rls
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p')
     order by c.relname`,
  ),
);

describe("row level security coverage of the public schema", () => {
  it("classifies every public table and writes an RLS suite for it", () => {
    const actual = publicTables.map((row) => row.name).sort();
    const classified = Object.keys(TABLES).sort();

    const unclassified = actual.filter((name) => !classified.includes(name));
    const stale = classified.filter((name) => !actual.includes(name));
    expect(
      unclassified,
      `Unclassified public tables: add each to TABLES in rls-coverage.test.ts and write its RLS suite.`,
    ).toEqual([]);
    expect(stale, `TABLES lists tables that no longer exist in schema public: remove them.`).toEqual([]);
  });

  it("enables row level security on every public table", () => {
    const withoutRls = publicTables.filter((row) => !row.rls).map((row) => row.name);
    expect(withoutRls, "Tables without `enable row level security`.").toEqual([]);
  });

  it("has an existing suite that mentions each table", () => {
    for (const [table, { suite }] of Object.entries(TABLES)) {
      const path = resolve(__dirname, suite);
      expect(existsSync(path), `The suite ${suite} for ${table} does not exist.`).toBe(true);
      expect(readFileSync(path, "utf8"), `The suite ${suite} never mentions ${table}.`).toContain(table);
    }
  });

  it("grants anon no privilege on any public table", () => {
    const rows = nameRowsSchema.parse(
      queryDatabase(
        `select distinct table_name as name from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'anon' order by 1`,
      ),
    );
    expect(rows.map((row) => row.name)).toEqual([]);
  });

  it("allows only handle_new_user as a security definer function in public", () => {
    const rows = nameRowsSchema.parse(
      queryDatabase(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef order by 1`,
      ),
    );
    expect(rows.map((row) => row.name)).toEqual(["handle_new_user"]);
  });
});
