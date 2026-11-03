// Browser-only Firebase Auth, used just to sign in to /admin. On the server,
// React Router replaces this module's exports with `undefined` (`.client`
// directory), so call these only from event handlers.
//
// The lasting session is the server's HttpOnly cookie, so the SDK keeps
// nothing on the device: in-memory persistence (no IndexedDB/localStorage),
// and initializeAuth without the popup/redirect resolver keeps the bundle small.
//
// Second factor (docs/architecture.md §3): TOTP from an authenticator app.
// Accounts that have one must type its code after the password; admins
// without one enrol here (the secret is created by Firebase and shown only
// in this browser — it never reaches our server).
import { getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  getMultiFactorResolver,
  inMemoryPersistence,
  initializeAuth,
  multiFactor,
  type MultiFactorError,
  type MultiFactorResolver,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type TotpSecret,
} from "firebase/auth";

import type { FirebaseWebConfig } from "~/.server/firebase";
import { TOTP_CODE_LENGTH, TOTP_ERROR, TOTP_FACTOR_NAME, TOTP_ISSUER } from "~/lib/admin/totp";

let auth: Auth | null = null;

// Between the steps of one sign-in or enrolment on this page. Memory only, like the sign-in itself.
let pendingSignIn: { resolver: MultiFactorResolver; factorUid: string } | null = null;
let pendingSecret: TotpSecret | null = null;

const appError = (code: string, message: string) => Object.assign(new Error(message), { code });

function authFor(config: FirebaseWebConfig): Auth {
  if (auth) return auth;
  const app = getApps()[0] ?? initializeApp({ apiKey: config.apiKey, ...(config.authDomain ? { authDomain: config.authDomain } : {}) });
  const instance = initializeAuth(app, { persistence: inMemoryPersistence });
  instance.languageCode = "pt-BR"; // verification and password-reset e-mails in Portuguese
  if (config.emulatorUrl) connectAuthEmulator(instance, config.emulatorUrl, { disableWarnings: true });
  auth = instance;
  return instance;
}

export type PasswordSignIn =
  /** No second factor on the account: here is the fresh ID token for the server. */
  | { kind: "signed_in"; idToken: string }
  /** The password was right; now the authenticator code (completeTotpSignIn). */
  | { kind: "code_required" };

/** E-mail + password, the first step of every sign-in. */
export async function signInWithPassword(config: FirebaseWebConfig, email: string, password: string): Promise<PasswordSignIn> {
  const instance = authFor(config);
  pendingSignIn = null;
  try {
    const { user } = await signInWithEmailAndPassword(instance, email, password);
    return { kind: "signed_in", idToken: await user.getIdToken() };
  } catch (error) {
    if (firebaseErrorCode(error) !== "auth/multi-factor-auth-required") throw error;
    const resolver = getMultiFactorResolver(instance, error as MultiFactorError);
    const totp = resolver.hints.find((hint) => hint.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!totp) {
      const factors = resolver.hints.map((hint) => hint.factorId).join(", ");
      throw appError(TOTP_ERROR.unsupportedFactor, `this account's second factors (${factors}) don't include an authenticator app`);
    }
    pendingSignIn = { resolver, factorUid: totp.uid };
    return { kind: "code_required" };
  }
}

/** Second step: the authenticator code. Returns the ID token (now with the second factor) for the server. */
export async function completeTotpSignIn(code: string): Promise<string> {
  if (!pendingSignIn) throw new Error("completeTotpSignIn: no sign-in on this page is waiting for a code");
  const { user } = await pendingSignIn.resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(pendingSignIn.factorUid, code));
  pendingSignIn = null;
  return user.getIdToken();
}

export interface TotpSetup {
  /** otpauth:// link: the QR code's content, and a tap target on the phone that has the app. */
  otpauthUri: string;
  /** Base32 secret, for typing into the app by hand. */
  secretKey: string;
}

/** Enrolment, step 1 — the account signed in with its password only: a new secret for the authenticator app. */
export async function startTotpEnrollment(config: FirebaseWebConfig): Promise<TotpSetup> {
  const user = authFor(config).currentUser;
  if (!user) throw new Error("startTotpEnrollment: nobody is signed in on this page");
  const secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession());
  if (secret.codeLength !== TOTP_CODE_LENGTH) {
    throw appError(TOTP_ERROR.unsupportedCodeLength, `the project generates ${secret.codeLength}-digit codes; the page asks for ${TOTP_CODE_LENGTH}`);
  }
  pendingSecret = secret;
  return { otpauthUri: secret.generateQrCodeUrl(user.email ?? undefined, TOTP_ISSUER), secretKey: secret.secretKey };
}

/** Enrolment, step 2: the app's first code proves it was set up, and the factor is added to the account. */
export async function finishTotpEnrollment(config: FirebaseWebConfig, code: string): Promise<void> {
  const user = authFor(config).currentUser;
  if (!user || !pendingSecret) throw new Error("finishTotpEnrollment: no enrolment in progress on this page");
  await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(pendingSecret, code), TOTP_FACTOR_NAME);
  pendingSecret = null;
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

/** Forgets the in-memory sign-in (and any half-done second step) once the server has answered. No-op if the SDK was never used. */
export async function forgetSignIn(): Promise<void> {
  pendingSignIn = null;
  pendingSecret = null;
  if (auth) await signOut(auth);
}

/** Firebase error code ("auth/…"), our own "app/…" codes, or null for anything else. */
export function firebaseErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}
