// Admin sessions against the Auth emulator, with real emulator ID tokens and
// session cookies (the emulator implements createSessionCookie, revocation and
// SMS second factors; it does not implement TOTP).
import { setTimeout as sleep } from "node:timers/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { adminAuth, db } from "~/.server/firebase";
import { createAdminSession, endAdminSession, readAdminSession } from "~/.server/session";
import type { AdminRole } from "~/lib/admin/roles";

import { clearAuth, clearFirestore, emulatorHost, TEST_PROJECT } from "./emulators";

const PASSWORD = "senha-de-teste-123";
const authBase = () => `http://${emulatorHost("FIREBASE_AUTH_EMULATOR_HOST")}`;

async function identityToolkit(path: string, body: unknown): Promise<Record<string, any>> {
  const res = await fetch(`${authBase()}/identitytoolkit.googleapis.com/${path}?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, any>;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function makeUser(email: string, opts: { role?: AdminRole | "customer"; emailVerified?: boolean; phoneFactor?: boolean } = {}) {
  const user = await adminAuth().createUser({
    email,
    password: PASSWORD,
    emailVerified: opts.emailVerified ?? true,
    ...(opts.phoneFactor ? { multiFactor: { enrolledFactors: [{ factorId: "phone", phoneNumber: "+5521987654321" }] } } : {}),
  });
  if (opts.role) await adminAuth().setCustomUserClaims(user.uid, { role: opts.role });
  return user.uid;
}

/** E-mail + password sign-in, as the browser SDK does it. */
async function signIn(email: string): Promise<string> {
  const res = await identityToolkit("v1/accounts:signInWithPassword", { email, password: PASSWORD, returnSecureToken: true });
  if (!res.idToken) throw new Error(`no ID token for ${email}: ${JSON.stringify(res)}`);
  return res.idToken;
}

/** Password, then the SMS code the emulator hands out for the enrolled phone. */
async function signInWithSecondFactor(email: string): Promise<string> {
  const first = await identityToolkit("v1/accounts:signInWithPassword", { email, password: PASSWORD, returnSecureToken: true });
  expect(first.idToken).toBeUndefined();
  const pending = first.mfaPendingCredential as string;
  const start = await identityToolkit("v2/accounts/mfaSignIn:start", {
    mfaPendingCredential: pending,
    mfaEnrollmentId: first.mfaInfo[0].mfaEnrollmentId,
  });
  const sessionInfo = start.phoneResponseInfo.sessionInfo as string;
  const codes = (await (await fetch(`${authBase()}/emulator/v1/projects/${TEST_PROJECT}/verificationCodes`)).json()) as {
    verificationCodes: { sessionInfo: string; code: string }[];
  };
  const code = codes.verificationCodes.find((c) => c.sessionInfo === sessionInfo)!.code;
  const done = await identityToolkit("v2/accounts/mfaSignIn:finalize", { mfaPendingCredential: pending, phoneVerificationInfo: { sessionInfo, code } });
  return done.idToken as string;
}

const requestWith = (setCookie: string) => new Request("http://localhost:5173/admin/orders", { headers: { cookie: setCookie.split(";")[0]! } });

async function newSession(email: string, opts: { requireMfa?: boolean; secondFactor?: boolean } = {}): Promise<string> {
  const idToken = opts.secondFactor ? await signInWithSecondFactor(email) : await signIn(email);
  const result = await createAdminSession(idToken, { requireMfa: opts.requireMfa ?? false });
  if (!result.ok) throw new Error(`session refused: ${result.reason}`);
  return result.setCookie;
}

const auditActions = async () => (await db().collection("auditLogs").orderBy("at").get()).docs.map((d) => d.get("action") as string);

/** Revocation is compared in whole seconds: let a second pass after the sign-in. */
const nextSecond = () => sleep(1100);

describe("admin sessions", () => {
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  it("turns an owner's fresh sign-in into a 12-hour session cookie that reads back as the owner", async () => {
    const uid = await makeUser("dono@example.com", { role: "owner" });

    const result = await createAdminSession(await signIn("dono@example.com"), { requireMfa: false });

    expect(result).toMatchObject({ ok: true, user: { uid, email: "dono@example.com", role: "owner" } });
    const setCookie = (result as { setCookie: string }).setCookie;
    expect(setCookie).toMatch(/^__session=[^;]+; Max-Age=43200; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(await readAdminSession(requestWith(setCookie), { requireMfa: false })).toEqual({
      status: "ok",
      user: { uid, email: "dono@example.com", role: "owner" },
    });
    expect(await auditActions()).toEqual(["admin.signed_in"]);
  });

  it("refuses customers, unverified e-mails, stale sign-ins and bad tokens, without a cookie or an audit entry", async () => {
    await makeUser("cliente@example.com");
    await makeUser("outro@example.com", { role: "customer" });
    await makeUser("equipe@example.com", { role: "staff", emailVerified: false });
    await makeUser("dono@example.com", { role: "owner" });
    const inSixMinutes = new Date(Date.now() + 6 * 60_000);

    expect(await createAdminSession(await signIn("cliente@example.com"), { requireMfa: false })).toEqual({ ok: false, reason: "not_admin" });
    expect(await createAdminSession(await signIn("outro@example.com"), { requireMfa: false })).toEqual({ ok: false, reason: "not_admin" });
    expect(await createAdminSession(await signIn("equipe@example.com"), { requireMfa: false })).toEqual({ ok: false, reason: "email_unverified" });
    expect(await createAdminSession(await signIn("dono@example.com"), { requireMfa: false, now: inSixMinutes })).toEqual({
      ok: false,
      reason: "stale_sign_in",
    });
    expect(await createAdminSession("not-a-token", { requireMfa: false })).toEqual({ ok: false, reason: "invalid_token" });
    expect(await auditActions()).toEqual([]);
  });

  it("with MFA required, admits only sign-ins that used a second factor, and the claim survives in the cookie", async () => {
    await makeUser("sem-2fa@example.com", { role: "owner" });
    await makeUser("com-2fa@example.com", { role: "owner", phoneFactor: true });

    expect(await createAdminSession(await signIn("sem-2fa@example.com"), { requireMfa: true })).toEqual({ ok: false, reason: "mfa_required" });

    const setCookie = await newSession("com-2fa@example.com", { requireMfa: true, secondFactor: true });
    expect(await readAdminSession(requestWith(setCookie), { requireMfa: true })).toMatchObject({ status: "ok", user: { role: "owner" } });
    // A password-only session made while MFA was off stops working once it's switched on.
    const passwordOnly = await newSession("sem-2fa@example.com", { requireMfa: false });
    expect(await readAdminSession(requestWith(passwordOnly), { requireMfa: true })).toEqual({ status: "forbidden", reason: "mfa_required" });
  });

  it("keeps old claims in a live cookie until revoked, which is why role changes revoke", async () => {
    const uid = await makeUser("equipe@example.com", { role: "staff" });
    const setCookie = await newSession("equipe@example.com");
    await nextSecond();

    await adminAuth().setCustomUserClaims(uid, {});
    expect(await readAdminSession(requestWith(setCookie), { requireMfa: false })).toMatchObject({ status: "ok", user: { role: "staff" } });

    await adminAuth().revokeRefreshTokens(uid);
    expect(await readAdminSession(requestWith(setCookie), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: true });
  });

  it("signs the account out on every device and clears this browser's cookie", async () => {
    await makeUser("dono@example.com", { role: "owner" });
    const laptop = await newSession("dono@example.com");
    const phone = await newSession("dono@example.com");
    await nextSecond();

    const cleared = await endAdminSession(requestWith(laptop));

    expect(cleared).toBe("__session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(await readAdminSession(requestWith(laptop), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: true });
    expect(await readAdminSession(requestWith(phone), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: true });
    expect(await auditActions()).toEqual(["admin.signed_in", "admin.signed_in", "admin.signed_out"]);
    // Signing out again with the dead cookie is harmless.
    expect(await endAdminSession(requestWith(laptop))).toBe(cleared);
  });

  it("reads a disabled account or a malformed cookie as signed out, and no cookie as signed out without a stale cookie", async () => {
    const uid = await makeUser("dono@example.com", { role: "owner" });
    const setCookie = await newSession("dono@example.com");
    await adminAuth().updateUser(uid, { disabled: true });

    expect(await readAdminSession(requestWith(setCookie), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: true });
    expect(await readAdminSession(requestWith("__session=not-a-jwt"), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: true });
    expect(await readAdminSession(new Request("http://localhost:5173/admin"), { requireMfa: false })).toEqual({ status: "signed_out", staleCookie: false });
  });
});
