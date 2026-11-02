import { describe, expect, it } from "vitest";

import { ADMIN_HOME, safeAdminRedirect } from "~/lib/admin/redirect";

describe("safeAdminRedirect", () => {
  it("keeps paths inside the admin, with their query", () => {
    expect(safeAdminRedirect("/admin")).toBe("/admin");
    expect(safeAdminRedirect("/admin/orders/1001")).toBe("/admin/orders/1001");
    expect(safeAdminRedirect("/admin/orders?status=paid&before=1050")).toBe("/admin/orders?status=paid&before=1050");
  });

  it("sends anything that could leave the site to the admin home", () => {
    for (const value of ["https://evil.com/admin", "//evil.com/admin", "/\\evil.com/admin", "/\t/evil.com/admin", "\\\\evil.com", "javascript:alert(1)"]) {
      expect(safeAdminRedirect(value)).toBe(ADMIN_HOME);
    }
  });

  it("sends paths outside the admin, the login/logout pages, and junk to the admin home", () => {
    for (const value of ["/", "/account", "/adminx", "/admin/../account", "/admin%2F..%2Faccount", "/admin/login", "/admin/logout", "", null, undefined, 42]) {
      expect(safeAdminRedirect(value)).toBe(ADMIN_HOME);
    }
  });
});
