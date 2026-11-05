// Customer sessions (docs/architecture.md §3). Same mechanism as the admin's (app/.server/session.ts): the browser
// signs in with the Firebase Auth JS SDK (memory only) and posts the fresh ID token; the server answers with a
// Firebase session cookie in `__session` — the only cookie Firebase Hosting forwards — valid 14 days. Every account
// request re-verifies it, revocation included.
//
// Unlike the admin: no role, no second factor and no verified e-mail are required to sign in. A verified e-mail is
// what links orders placed as a guest with the same address (app/.server/customers.ts), so an unverified account
// only sees the orders it placed while signed in.
import type { DecodedIdToken } from "firebase-admin/auth";

import { CUSTOMER_SESSION_DAYS } from "~/lib/account";

import { adminAuth } from "./firebase";
import { expiredSessionCookie, isInvalidCredential, readCookie, RECENT_SIGN_IN_SECONDS, SESSION_COOKIE, sessionCookie } from "./session";

export const CUSTOMER_SESSION_MS = CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000;

export interface CustomerUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export type CustomerSignIn =
  | { ok: true; user: CustomerUser; setCookie: string }
  | { ok: false; reason: "invalid_token" | "stale_sign_in" | "no_email" };

const toUser = (claims: Pick<DecodedIdToken, "uid" | "email" | "email_verified">): CustomerUser | null =>
  claims.email ? { uid: claims.uid, email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true } : null;

/** Turns the ID token of a sign-in that just happened (< 5 min) into a 14-day session cookie, or says why not. */
export async function createCustomerSession(idToken: string, options: { now?: Date } = {}): Promise<CustomerSignIn> {
  const now = options.now ?? new Date();
  let claims: DecodedIdToken;
  try {
    claims = await adminAuth().verifyIdToken(idToken, true);
  } catch (error) {
    if (isInvalidCredential(error)) return { ok: false, reason: "invalid_token" };
    throw error;
  }
  if (now.getTime() / 1000 - claims.auth_time > RECENT_SIGN_IN_SECONDS) return { ok: false, reason: "stale_sign_in" };
  const user = toUser(claims);
  if (!user) return { ok: false, reason: "no_email" };
  const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn: CUSTOMER_SESSION_MS });
  return { ok: true, user, setCookie: sessionCookie(cookie, CUSTOMER_SESSION_MS / 1000) };
}

export type CustomerSession = { status: "signed_out"; staleCookie: boolean } | { status: "ok"; user: CustomerUser };

export async function readCustomerSession(request: Request): Promise<CustomerSession> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return { status: "signed_out", staleCookie: false };
  let claims: DecodedIdToken;
  try {
    claims = await adminAuth().verifySessionCookie(cookie, true);
  } catch (error) {
    if (isInvalidCredential(error)) return { status: "signed_out", staleCookie: true };
    throw error;
  }
  const user = toUser(claims);
  return user ? { status: "ok", user } : { status: "signed_out", staleCookie: true };
}

/**
 * Re-checks a fresh ID token for an action that needs the password typed again (deleting the account): the same
 * account as the session, signed in within the last 5 minutes.
 */
export async function verifyRecentSignIn(idToken: string, uid: string, now = new Date()): Promise<boolean> {
  try {
    const claims = await adminAuth().verifyIdToken(idToken, true);
    return claims.uid === uid && now.getTime() / 1000 - claims.auth_time <= RECENT_SIGN_IN_SECONDS;
  } catch (error) {
    if (isInvalidCredential(error)) return false;
    throw error;
  }
}

/** Signs the account out on every device (revokes its sessions) and clears this browser's cookie. */
export async function endCustomerSession(request: Request): Promise<string> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie) {
    try {
      const claims = await adminAuth().verifySessionCookie(cookie, true);
      await adminAuth().revokeRefreshTokens(claims.uid);
    } catch (error) {
      if (!isInvalidCredential(error)) throw error; // expired or already revoked: nothing left to end
    }
  }
  return expiredSessionCookie();
}
