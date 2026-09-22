import { describe, expect, it } from "vitest";
import { resolveUserRole } from "./roles";

/**
 * The gate in phase 4 fails closed on `null`, so "everything unrecognised resolves to null" is a
 * security property, not a convenience — these cases are the ones that keep it true.
 */
describe("resolveUserRole", () => {
  it("resolves a valid admin claim", () => {
    expect(resolveUserRole({ sub: "u1", role: "authenticated", user_role: "admin" })).toBe("admin");
  });

  it("resolves a valid elektryk claim", () => {
    expect(resolveUserRole({ sub: "u1", role: "authenticated", user_role: "elektryk" })).toBe("elektryk");
  });

  it("returns null when the claim is absent", () => {
    expect(resolveUserRole({ sub: "u1", role: "authenticated" })).toBeNull();
  });

  it("returns null for an unknown role string", () => {
    expect(resolveUserRole({ user_role: "superadmin" })).toBeNull();
  });

  it("returns null for a non-string claim value", () => {
    expect(resolveUserRole({ user_role: 42 })).toBeNull();
    expect(resolveUserRole({ user_role: null })).toBeNull();
    expect(resolveUserRole({ user_role: { name: "admin" } })).toBeNull();
  });

  it("never reads the built-in role claim, which carries authenticated/anon", () => {
    expect(resolveUserRole({ role: "authenticated" })).toBeNull();
    expect(resolveUserRole({ role: "admin" })).toBeNull();
  });

  it("returns null when there are no claims at all", () => {
    expect(resolveUserRole(undefined)).toBeNull();
    expect(resolveUserRole(null)).toBeNull();
  });
});
