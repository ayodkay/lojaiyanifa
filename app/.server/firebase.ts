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

function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

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
