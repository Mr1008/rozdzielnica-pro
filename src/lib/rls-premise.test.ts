import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "There is RLS, so the endpoint is secure" holds only while every server path acts with the user's
 * own token. That fails the moment application code can reach the service-role key.
 */

const SRC = resolve(__dirname, "..");
const FORBIDDEN = /service[_-]?role|SERVICE_ROLE_KEY/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("application code never reaches the service-role key", () => {
  const files = walk(SRC)
    .filter((path) => !/\.test\.tsx?$/.test(path))
    .map((path) => relative(SRC, path).split(sep).join("/"));

  it("scans the files it is meant to scan", () => {
    expect(files).toContain("lib/supabase.ts");
    expect(files.some((file) => file.startsWith("pages/api/"))).toBe(true);
  });

  it("finds no service-role reference in any non-test file under src/", () => {
    const offenders = files.filter((file) => FORBIDDEN.test(readFileSync(join(SRC, file), "utf8")));
    expect(
      offenders,
      "These files reference the service-role key; application code must use the user's token only.",
    ).toEqual([]);
  });
});
