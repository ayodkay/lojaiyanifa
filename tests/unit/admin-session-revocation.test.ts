// firebase-admin checks revocation ONLY when asked (`checkRevoked = true`) —
// except against the emulator, where it always checks (base-auth.js:
// `if (checkRevoked || isEmulator)`). The integration tests therefore can't
// notice a missing flag; this test pins it, because in production that flag is
// what makes sign-out and role removal take effect immediately.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakeAuth = vi.hoisted(() => ({ verifySessionCookie: vi.fn(), verifyIdToken: vi.fn() }));
vi.mock("~/.server/firebase", () => ({
  adminAuth: () => fakeAuth,
  db: () => {
    throw new Error("Firestore is not expected in this test");
  },
}));

const { createAdminSession, readAdminSession } = await import("~/.server/session");

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("revocation is always checked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("when reading an admin session cookie", async () => {
    fakeAuth.verifySessionCookie.mockResolvedValue({ uid: "u1", email: "dono@example.com", email_verified: true, firebase: {}, role: "owner" });

    await readAdminSession(new Request("http://localhost/admin", { headers: { cookie: "__session=abc" } }), { requireMfa: false });

    expect(fakeAuth.verifySessionCookie).toHaveBeenCalledExactlyOnceWith("abc", true);
  });

  it("when turning an ID token into a session", async () => {
    fakeAuth.verifyIdToken.mockResolvedValue({ uid: "u1", firebase: {}, auth_time: nowSeconds() }); // no role: refused before any write

    expect(await createAdminSession("id-token", { requireMfa: false })).toEqual({ ok: false, reason: "not_admin" });
    expect(fakeAuth.verifyIdToken).toHaveBeenCalledExactlyOnceWith("id-token", true);
  });
});
