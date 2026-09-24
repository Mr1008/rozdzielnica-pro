import { describe, expect, it } from "vitest";
import { USER_ROLES } from "./roles";
import {
  NO_ROLE_PATH,
  PROTECTED_ROUTES,
  ROLE_HOME,
  SIGN_IN_PATH,
  resolveRouteAccess,
  signInLanding,
} from "./route-access";

describe("resolveRouteAccess", () => {
  it("allows an unprotected path to anyone", () => {
    expect(resolveRouteAccess({ pathname: "/", isSignedIn: false, role: null })).toEqual({ allowed: true });
    expect(resolveRouteAccess({ pathname: "/auth/signin", isSignedIn: false, role: null })).toEqual({ allowed: true });
  });

  it("sends an anonymous visitor to sign in", () => {
    expect(resolveRouteAccess({ pathname: "/dashboard", isSignedIn: false, role: null })).toEqual({
      allowed: false,
      redirectTo: SIGN_IN_PATH,
    });
    expect(resolveRouteAccess({ pathname: "/admin", isSignedIn: false, role: null })).toEqual({
      allowed: false,
      redirectTo: SIGN_IN_PATH,
    });
  });

  it("allows the role the route names", () => {
    expect(resolveRouteAccess({ pathname: "/dashboard", isSignedIn: true, role: "elektryk" })).toEqual({
      allowed: true,
    });
    expect(resolveRouteAccess({ pathname: "/admin", isSignedIn: true, role: "admin" })).toEqual({ allowed: true });
  });

  it("keeps covering nested paths under a protected prefix", () => {
    expect(resolveRouteAccess({ pathname: "/dashboard/projects/7", isSignedIn: true, role: "elektryk" })).toEqual({
      allowed: true,
    });
    expect(resolveRouteAccess({ pathname: "/admin/devices", isSignedIn: true, role: "elektryk" })).toEqual({
      allowed: false,
      redirectTo: ROLE_HOME.elektryk,
    });
  });

  /**
   * A same-prefix sibling is a different route, not a subtree. `/administrator` starting with
   * `/admin` must not make it admin-gated — the failure direction is over-restrictive rather than
   * open, so it would surface as a page mysteriously redirecting rather than as a breach.
   */
  it("does not match a same-prefix sibling path", () => {
    for (const pathname of ["/administrator", "/dashboardowy-eksport", "/admin-status"]) {
      expect(resolveRouteAccess({ pathname, isSignedIn: false, role: null })).toEqual({ allowed: true });
    }
  });

  it("still matches a protected prefix exactly, with or without a trailing slash", () => {
    expect(resolveRouteAccess({ pathname: "/admin", isSignedIn: true, role: "admin" })).toEqual({ allowed: true });
    expect(resolveRouteAccess({ pathname: "/admin/", isSignedIn: false, role: null })).toEqual({
      allowed: false,
      redirectTo: SIGN_IN_PATH,
    });
  });

  it("gates the admin API for the admin role only", () => {
    const pathname = "/api/admin/cabinets/00000000-0000-0000-0000-000000000001/archive";
    expect(resolveRouteAccess({ pathname, isSignedIn: true, role: "admin" })).toEqual({ allowed: true });
    expect(resolveRouteAccess({ pathname, isSignedIn: true, role: "elektryk" })).toEqual({
      allowed: false,
      redirectTo: ROLE_HOME.elektryk,
    });
    expect(resolveRouteAccess({ pathname, isSignedIn: false, role: null })).toEqual({
      allowed: false,
      redirectTo: SIGN_IN_PATH,
    });
  });

  it("gates the profile API for the elektryk role only", () => {
    const pathname = "/api/profile/pricing";
    expect(resolveRouteAccess({ pathname, isSignedIn: true, role: "elektryk" })).toEqual({ allowed: true });
    expect(resolveRouteAccess({ pathname, isSignedIn: true, role: "admin" })).toEqual({
      allowed: false,
      redirectTo: ROLE_HOME.admin,
    });
    expect(resolveRouteAccess({ pathname, isSignedIn: false, role: null })).toEqual({
      allowed: false,
      redirectTo: SIGN_IN_PATH,
    });
  });

  it("leaves the auth API open, since it sits outside /api/admin", () => {
    expect(resolveRouteAccess({ pathname: "/api/auth/signin", isSignedIn: false, role: null })).toEqual({
      allowed: true,
    });
  });

  it("bounces the wrong role to its own home", () => {
    expect(resolveRouteAccess({ pathname: "/dashboard", isSignedIn: true, role: "admin" })).toEqual({
      allowed: false,
      redirectTo: ROLE_HOME.admin,
    });
    expect(resolveRouteAccess({ pathname: "/admin", isSignedIn: true, role: "elektryk" })).toEqual({
      allowed: false,
      redirectTo: ROLE_HOME.elektryk,
    });
  });

  it("refuses a signed-in user carrying no recognised role", () => {
    for (const { prefix } of PROTECTED_ROUTES) {
      expect(resolveRouteAccess({ pathname: prefix, isSignedIn: true, role: null })).toEqual({
        allowed: false,
        redirectTo: NO_ROLE_PATH,
      });
    }
  });

  /**
   * The property that rules out an infinite redirect loop: whatever `ROLE_HOME` points a role at,
   * that role must be allowed to open. Asserted over the whole vocabulary rather than the two
   * cases above, so adding a third role cannot quietly reintroduce the loop.
   */
  it("never redirects a role somewhere that role is refused", () => {
    for (const role of USER_ROLES) {
      expect(resolveRouteAccess({ pathname: ROLE_HOME[role], isSignedIn: true, role })).toEqual({ allowed: true });
    }
  });

  it("points the roleless redirect at an ungated path", () => {
    const pathname = new URL(NO_ROLE_PATH, "http://localhost").pathname;
    expect(resolveRouteAccess({ pathname, isSignedIn: true, role: null })).toEqual({ allowed: true });
  });
});

describe("signInLanding", () => {
  it("sends an admin to the admin panel", () => {
    expect(signInLanding("admin")).toBe(ROLE_HOME.admin);
  });

  it("sends everyone else to the public home page", () => {
    expect(signInLanding("elektryk")).toBe("/");
    expect(signInLanding(null)).toBe("/");
  });
});
