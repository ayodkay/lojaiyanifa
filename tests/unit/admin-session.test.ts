import { describe, expect, it } from "vitest";

import { assertNoEmulatorInProduction } from "~/.server/firebase";
import { adminRefusal, expiredSessionCookie, isInvalidCredential, readCookie, sessionCookie } from "~/.server/session";
import { ADMIN_ROLES, can, isAdminRole } from "~/lib/admin/roles";

describe("admin roles", () => {
  it("allows every role to view orders and confirm Pix, but only owner and admin to cancel", () => {
    const matrix = Object.fromEntries(
      ADMIN_ROLES.map((role) => [role, [can(role, "orders.view"), can(role, "orders.confirm_payment"), can(role, "orders.cancel")]]),
    );
    expect(matrix).toEqual({ owner: [true, true, true], admin: [true, true, true], staff: [true, true, false] });
  });

  it("recognises only the exact role names", () => {
    expect(ADMIN_ROLES.every(isAdminRole)).toBe(true);
    for (const value of ["customer", "Owner", "", " admin", null, undefined, 1, ["owner"]]) expect(isAdminRole(value)).toBe(false);
  });
});

describe("adminRefusal", () => {
  const owner = { uid: "u1", email: "dono@example.com", email_verified: true, firebase: {}, role: "owner" };

  it("admits a verified admin when no second factor is required", () => {
    expect(adminRefusal(owner, { requireMfa: false })).toBeNull();
  });

  it("refuses accounts without an admin role", () => {
    expect(adminRefusal({ ...owner, role: undefined }, { requireMfa: false })).toBe("not_admin");
    expect(adminRefusal({ ...owner, role: "customer" }, { requireMfa: false })).toBe("not_admin");
  });

  it("refuses unverified or missing e-mail addresses", () => {
    expect(adminRefusal({ ...owner, email_verified: false }, { requireMfa: false })).toBe("email_unverified");
    expect(adminRefusal({ ...owner, email_verified: undefined }, { requireMfa: false })).toBe("email_unverified");
    expect(adminRefusal({ ...owner, email: undefined }, { requireMfa: false })).toBe("email_unverified");
  });

  it("requires a second factor only when configured", () => {
    expect(adminRefusal(owner, { requireMfa: true })).toBe("mfa_required");
    expect(adminRefusal({ ...owner, firebase: { sign_in_second_factor: "totp" } }, { requireMfa: true })).toBeNull();
  });
});

describe("session cookie", () => {
  const request = (cookie?: string) => new Request("http://localhost/admin", { headers: cookie ? { cookie } : {} });

  it("reads __session among other cookies, by exact name", () => {
    expect(readCookie(request("a=1; __session=abc.def.; b=2"), "__session")).toBe("abc.def.");
    expect(readCookie(request("x__session=evil; __session=good"), "__session")).toBe("good");
    expect(readCookie(request("x__session=evil"), "__session")).toBeNull();
    expect(readCookie(request("__session="), "__session")).toBeNull();
    expect(readCookie(request(), "__session")).toBeNull();
  });

  it("is HttpOnly, Secure, SameSite=Lax on the whole site, and clearable", () => {
    expect(sessionCookie("abc", 43200)).toBe("__session=abc; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(expiredSessionCookie()).toBe("__session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
  });
});

describe("isInvalidCredential", () => {
  it("treats bad, expired, revoked and disabled credentials as 'sign in again'", () => {
    for (const code of ["auth/argument-error", "auth/session-cookie-expired", "auth/session-cookie-revoked", "auth/user-disabled"]) {
      expect(isInvalidCredential({ code })).toBe(true);
    }
  });

  it("lets every other failure surface", () => {
    for (const error of [{ code: "auth/internal-error" }, { code: "app/network-error" }, new Error("boom"), "auth/argument-error", null]) {
      expect(isInvalidCredential(error)).toBe(false);
    }
  });
});

describe("assertNoEmulatorInProduction", () => {
  const base = { prod: true, functionsEmulator: false, firestoreEmulatorHost: undefined, authEmulatorHost: undefined };

  it("refuses a production build pointed at an emulator", () => {
    expect(() => assertNoEmulatorInProduction({ ...base, authEmulatorHost: "127.0.0.1:9099" })).toThrow(/unsigned tokens/);
    expect(() => assertNoEmulatorInProduction({ ...base, firestoreEmulatorHost: "127.0.0.1:8180" })).toThrow(/unsigned tokens/);
  });

  it("allows production without emulators, the functions emulator, and development", () => {
    expect(() => assertNoEmulatorInProduction(base)).not.toThrow();
    expect(() => assertNoEmulatorInProduction({ ...base, functionsEmulator: true, authEmulatorHost: "127.0.0.1:9099" })).not.toThrow();
    expect(() => assertNoEmulatorInProduction({ ...base, prod: false, authEmulatorHost: "127.0.0.1:9099" })).not.toThrow();
  });
});
