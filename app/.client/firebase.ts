// Browser-only Firebase Auth, used just to sign in to /admin. On the server,
// React Router replaces this module's exports with `undefined` (`.client`
// directory), so call these only from event handlers.
//
// The lasting session is the server's HttpOnly cookie, so the SDK keeps
// nothing on the device: in-memory persistence (no IndexedDB/localStorage),
// and initializeAuth without the popup/redirect resolver keeps the bundle small.
import { getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  inMemoryPersistence,
  initializeAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import type { FirebaseWebConfig } from "~/.server/firebase";

let auth: Auth | null = null;

function authFor(config: FirebaseWebConfig): Auth {
  if (auth) return auth;
  const app = getApps()[0] ?? initializeApp({ apiKey: config.apiKey, ...(config.authDomain ? { authDomain: config.authDomain } : {}) });
  const instance = initializeAuth(app, { persistence: inMemoryPersistence });
  instance.languageCode = "pt-BR"; // verification and password-reset e-mails in Portuguese
  if (config.emulatorUrl) connectAuthEmulator(instance, config.emulatorUrl, { disableWarnings: true });
  auth = instance;
  return instance;
}

/** E-mail + password sign-in; returns a fresh ID token for the server to turn into a session. */
export async function signInForIdToken(config: FirebaseWebConfig, email: string, password: string): Promise<string> {
  const { user } = await signInWithEmailAndPassword(authFor(config), email, password);
  return user.getIdToken();
}

/** Sends the verification e-mail to the account that just signed in on this page. */
export async function sendVerificationEmail(config: FirebaseWebConfig): Promise<void> {
  const user = authFor(config).currentUser;
  if (!user) throw new Error("sendVerificationEmail: nobody is signed in on this page");
  await sendEmailVerification(user);
}

export async function sendPasswordReset(config: FirebaseWebConfig, email: string): Promise<void> {
  await sendPasswordResetEmail(authFor(config), email);
}

/** Forgets the in-memory sign-in once the server has answered (no-op if the SDK was never used). */
export async function forgetSignIn(): Promise<void> {
  if (auth) await signOut(auth);
}

/** Firebase error code ("auth/…"), or null for anything else. */
export function firebaseErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}
