import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { USER_ROLES } from "./roles";
import { roleHomeLink } from "./role-home-link";
import { ROLE_HOME } from "./route-access";

describe("roleHomeLink", () => {
  it("links an admin at the admin panel", () => {
    expect(roleHomeLink("admin")).toEqual({ href: "/admin", label: t.nav.admin });
  });

  it("links an electrician at the dashboard", () => {
    expect(roleHomeLink("elektryk")).toEqual({ href: "/dashboard", label: t.nav.dashboard });
  });

  it("gives a user with no recognised role no link", () => {
    expect(roleHomeLink(null)).toBeNull();
  });

  it("points every role at its own ROLE_HOME", () => {
    for (const role of USER_ROLES) {
      expect(roleHomeLink(role)?.href).toBe(ROLE_HOME[role]);
    }
  });
});
