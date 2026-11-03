// Removes an account's second factors (the authenticator app) and signs it out
// everywhere: for an admin who lost or replaced the phone with the app. At the
// next sign-in /admin/login asks them to set up a new one.
//
// Confirm who is asking by another channel first (call them): after the reset,
// whoever knows the account's password can enrol their own authenticator.
// Every reset is recorded in auditLogs (action "mfa.reset").
//
// Local emulator (reads .env.local; refuses anything that isn't an emulator of a demo- project):
//   node scripts/admin/reset-mfa.mjs --email dono@example.com
//
// Production (Application Default Credentials: `gcloud auth application-default login`
// with an account that can manage the project's users; .env.local is NOT read):
//   node scripts/admin/reset-mfa.mjs --production --project <firebase-project-id> --email <email>
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const fail = (message) => {
  console.error(`[reset-mfa] ${message}`);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    production: { type: "boolean", default: false },
    project: { type: "string" },
  },
});
if (!values.email) fail("usage: --email <email> [--production --project <id>]");

let projectId;
if (values.production) {
  // Never let emulator variables from the shell redirect (or fake) a production change.
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  projectId = values.project;
  if (!projectId) fail("--production needs --project <firebase-project-id>.");
  if (projectId.startsWith("demo-")) fail(`"${projectId}" is a demo project; drop --production to use the emulator.`);
} else {
  if (values.project) fail("--project is only for --production; the emulator project comes from .env.local.");
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-lojaiyanifa";
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
    fail("FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST are not set: without --production this script only touches the emulators.");
  }
  if (!projectId.startsWith("demo-")) fail(`refusing: "${projectId}" is not a demo- project (use --production for a real one).`);
}

const app = initializeApp({ projectId });
const auth = getAuth(app);
const target = values.production ? `PRODUCTION project ${projectId}` : `emulator ${process.env.FIREBASE_AUTH_EMULATOR_HOST} (${projectId})`;

let user;
try {
  user = await auth.getUserByEmail(values.email);
} catch (error) {
  if (error?.code === "auth/user-not-found") fail(`${target}: no account with e-mail ${values.email}.`);
  throw error;
}

const factors = user.multiFactor?.enrolledFactors ?? [];
if (factors.length === 0) {
  console.log(`[reset-mfa] ${target}: ${values.email} has no second factor; nothing changed.`);
  process.exit(0);
}

await auth.updateUser(user.uid, { multiFactor: { enrolledFactors: null } });
await auth.revokeRefreshTokens(user.uid);
await getFirestore(app)
  .collection("auditLogs")
  .doc()
  .create({
    at: Timestamp.now(),
    action: "mfa.reset",
    actor: { type: "script", name: "reset-mfa", by: userInfo().username },
    target: `users/${user.uid}`,
    details: {
      email: user.email,
      removed: factors.map((f) => ({ factorId: f.factorId, displayName: f.displayName ?? null, enrolledAt: f.enrollmentTime ?? null })),
    },
  });

const after = (await auth.getUser(user.uid)).multiFactor?.enrolledFactors ?? [];
if (after.length > 0) fail(`${target}: ${values.email} still has ${after.length} second factor(s) after the reset — check the Firebase console.`);
console.log(
  `[reset-mfa] ${target}: removed ${factors.length} second factor(s) from ${values.email} ` +
    `(${factors.map((f) => f.factorId).join(", ")}); all sessions revoked. At the next sign-in they set up a new authenticator.`,
);
