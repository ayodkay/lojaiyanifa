// Firebase Admin SDK for server code: one app per process, created lazily on
// first use (public pages never touch Firestore, so they don't pay for it).
//
// Where it connects:
// - Cloud Functions (production) and the functions emulator (`npm run preview`):
//   project and credentials come from the runtime (FIREBASE_CONFIG). In the
//   emulator the CLI also sets FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST,
//   which the SDK honours on its own.
// - `react-router dev` and integration tests: the emulators are REQUIRED. Without
//   them the SDK would fall back to whatever Google credentials exist on the
//   machine and could read or write a real project by accident, so it refuses.
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { env } from "./env";

/**
 * Pointed at an emulator, the Admin SDK accepts UNSIGNED tokens, so a
 * production server with an emulator variable set would let anyone forge an
 * admin session cookie. The functions emulator (`npm run preview`) is the one
 * place a production build legitimately runs against the emulators.
 */
export function assertNoEmulatorInProduction(runtime: {
  prod: boolean;
  functionsEmulator: boolean;
  firestoreEmulatorHost: string | undefined;
  authEmulatorHost: string | undefined;
}): void {
  if (runtime.prod && !runtime.functionsEmulator && (runtime.firestoreEmulatorHost || runtime.authEmulatorHost)) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST are set in a production build outside the Firebase emulators. " +
        "Remove them from the deployed environment: with them set, the Admin SDK accepts unsigned tokens.",
    );
  }
}

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  assertNoEmulatorInProduction({
    prod: import.meta.env.PROD,
    functionsEmulator: process.env.FUNCTIONS_EMULATOR === "true",
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    authEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  });
  const { FIREBASE_PROJECT_ID, FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST } = env();
  if (import.meta.env.DEV && (!FIRESTORE_EMULATOR_HOST || !FIREBASE_AUTH_EMULATOR_HOST)) {
    throw new Error(
      "Firebase emulators are required in development and tests. Start them with `npm run emulators` and set " +
        "FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 and FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 in .env.local, " +
        "or run the command through `firebase emulators:exec`, which sets both.",
    );
  }

  // Runtime-provided configuration: Cloud Functions and the functions emulator.
  if (process.env.FIREBASE_CONFIG) return initializeApp();

  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is not set. Use demo-lojaiyanifa for local development (see .env.example).");
  }
  return initializeApp({ projectId: FIREBASE_PROJECT_ID });
}

/** Firestore (Admin SDK: bypasses security rules, so every caller must authorize first). */
export const db = (): Firestore => getFirestore(adminApp());

/** Firebase Auth (Admin SDK): session cookies, custom claims, user management. */
export const adminAuth = (): Auth => getAuth(adminApp());

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string | null;
  /** The Auth emulator's URL in development; null in production. */
  emulatorUrl: string | null;
}

/**
 * Config for the browser SDK on the sign-in page. Against the emulators (dev
 * server, or a production build in the functions emulator) the browser must
 * use the same Auth emulator as the server, and the emulator ignores the key.
 */
export function firebaseWebConfig(): FirebaseWebConfig {
  const { FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_AUTH_EMULATOR_HOST } = env();
  const emulated = Boolean(FIREBASE_AUTH_EMULATOR_HOST) && (import.meta.env.DEV || process.env.FUNCTIONS_EMULATOR === "true");
  if (emulated) {
    return { apiKey: FIREBASE_WEB_API_KEY ?? "emulator-ignores-the-key", authDomain: null, emulatorUrl: `http://${FIREBASE_AUTH_EMULATOR_HOST}` };
  }
  if (!FIREBASE_WEB_API_KEY) {
    throw new Error(
      "FIREBASE_WEB_API_KEY is not set: /admin/login needs the Firebase web app's API key " +
        "(Firebase console → Project settings → Your apps). See .env.example.",
    );
  }
  return { apiKey: FIREBASE_WEB_API_KEY, authDomain: FIREBASE_AUTH_DOMAIN ?? null, emulatorUrl: null };
}
