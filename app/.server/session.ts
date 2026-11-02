// Admin sessions (docs/architecture.md §3).
//
// The browser signs in with the Firebase Auth JS SDK and posts the fresh ID
// token to /admin/login; the server checks it and answers with a Firebase
// session cookie in `__session`, the only cookie Firebase Hosting forwards to
// the function. Every admin request re-verifies the cookie, including whether
// it was revoked (sign-out, role change), so lost access ends immediately.
//
// Who may open an admin session: a user whose `role` claim is owner, admin or
// staff; whose e-mail is verified (otherwise someone could pre-register the
// owner's address and inherit a role granted to it later); and, when
// ADMIN_REQUIRE_MFA is on (production), who signed in with a second factor.
import type { DecodedIdToken } from "firebase-admin/auth";

import { type AdminRole, isAdminRole } from "~/lib/admin/roles";

import { writeAudit } from "./audit";
import { env } from "./env";
import { adminAuth } from "./firebase";

export const SESSION_COOKIE = "__session";
/** Owner decision 2026-11-01: admins sign in again after 12 hours. */
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
/** Sessions are minted only from a sign-in that just happened, so an old leaked ID token can't be turned into one. */
export const RECENT_SIGN_IN_SECONDS = 5 * 60;

export interface AdminUser {
  uid: string;
  email: string;
  role: AdminRole;
}

/** Why a signed-in Firebase user can't use the admin. */
export type AdminRefusal = "not_admin" | "email_unverified" | "mfa_required";

/** The token fields the admission rule reads (a DecodedIdToken satisfies it). */
interface Claims {
  uid: string;
  email?: string;
  email_verified?: boolean;
  firebase: { sign_in_second_factor?: string };
  role?: unknown;
}

export function adminRefusal(claims: Claims, { requireMfa }: { requireMfa: boolean }): AdminRefusal | null {
  if (!isAdminRole(claims.role)) return "not_admin";
  if (claims.email_verified !== true || !claims.email) return "email_unverified";
  if (requireMfa && !claims.firebase.sign_in_second_factor) return "mfa_required";
  return null;
}

function toAdminUser(claims: Claims): AdminUser {
  if (!isAdminRole(claims.role) || !claims.email) throw new Error(`toAdminUser: uid ${claims.uid} is not an admin`);
  return { uid: claims.uid, email: claims.email, role: claims.role };
}

// --- cookie ------------------------------------------------------------------------------------

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Set-Cookie value. Session cookies are JWTs (base64url and dots), safe in a cookie as they are. */
export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export const expiredSessionCookie = (): string => sessionCookie("", 0);

// --- Firebase ----------------------------------------------------------------------------------

/**
 * firebase-admin errors that mean "this token or cookie is no good, sign in
 * again". Anything else (network, quota, misconfiguration) is a real failure
 * and must surface as one, not as a silent sign-out.
 */
const INVALID_CREDENTIAL = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/session-cookie-expired",
  "auth/session-cookie-revoked",
  "auth/user-disabled",
  "auth/user-not-found",
]);

export function isInvalidCredential(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && INVALID_CREDENTIAL.has(code);
}

export type SignInResult =
  | { ok: true; user: AdminUser; setCookie: string }
  | { ok: false; reason: AdminRefusal | "invalid_token" | "stale_sign_in" };

/** Turns the ID token of a sign-in that just happened into an admin session cookie, or says why not. */
export async function createAdminSession(
  idToken: string,
  options: { requireMfa?: boolean; now?: Date } = {},
): Promise<SignInResult> {
  const requireMfa = options.requireMfa ?? env().ADMIN_REQUIRE_MFA;
  const now = options.now ?? new Date();
  let claims: DecodedIdToken;
  try {
    claims = await adminAuth().verifyIdToken(idToken, true);
  } catch (error) {
    if (isInvalidCredential(error)) return { ok: false, reason: "invalid_token" };
    throw error;
  }
  if (now.getTime() / 1000 - claims.auth_time > RECENT_SIGN_IN_SECONDS) return { ok: false, reason: "stale_sign_in" };

  const refusal = adminRefusal(claims, { requireMfa });
  if (refusal) {
    console.warn(`[admin] sign-in refused (${refusal}) for uid ${claims.uid}`);
    return { ok: false, reason: refusal };
  }
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: ADMIN_SESSION_MS });
  const user = toAdminUser(claims);
  await writeAudit({
    action: "admin.signed_in",
    actor: user,
    target: `users/${user.uid}`,
    details: { secondFactor: claims.firebase.sign_in_second_factor ?? null },
  });
  return { ok: true, user, setCookie: sessionCookie(cookie, ADMIN_SESSION_MS / 1000) };
}

export type AdminSession =
  /** No cookie, or one that expired / was revoked (`staleCookie`: clear it). */
  | { status: "signed_out"; staleCookie: boolean }
  /** A valid session that isn't allowed in the admin (e.g. role removed without revocation, MFA now required). */
  | { status: "forbidden"; reason: AdminRefusal }
  | { status: "ok"; user: AdminUser };

export async function readAdminSession(request: Request, options: { requireMfa?: boolean } = {}): Promise<AdminSession> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return { status: "signed_out", staleCookie: false };
  let claims: DecodedIdToken;
  try {
    claims = await adminAuth().verifySessionCookie(cookie, true);
  } catch (error) {
    if (isInvalidCredential(error)) return { status: "signed_out", staleCookie: true };
    throw error;
  }
  const refusal = adminRefusal(claims, { requireMfa: options.requireMfa ?? env().ADMIN_REQUIRE_MFA });
  return refusal ? { status: "forbidden", reason: refusal } : { status: "ok", user: toAdminUser(claims) };
}

/**
 * Signs the account out everywhere: revokes all its sessions and refresh
 * tokens, and returns the Set-Cookie that clears this browser's cookie.
 */
export async function endAdminSession(request: Request): Promise<string> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie) {
    try {
      const claims = await adminAuth().verifySessionCookie(cookie, true);
      await adminAuth().revokeRefreshTokens(claims.uid);
      if (isAdminRole(claims.role) && claims.email) {
        await writeAudit({ action: "admin.signed_out", actor: toAdminUser(claims), target: `users/${claims.uid}` });
      }
    } catch (error) {
      if (!isInvalidCredential(error)) throw error; // expired or already revoked: nothing left to end
    }
  }
  return expiredSessionCookie();
}
