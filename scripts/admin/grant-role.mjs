// Grants or removes an admin role, and signs the account out everywhere so
// the change applies on its next request. Roles: docs/architecture.md §3.
//
// Local emulator (reads .env.local; refuses anything that isn't an emulator of a demo- project):
//   node scripts/admin/grant-role.mjs --email dono@example.com --role owner
//
// Production (Application Default Credentials: `gcloud auth application-default login`
// with an account that can manage the project's users; .env.local is NOT read):
//   node scripts/admin/grant-role.mjs --production --project <firebase-project-id> --email <email> --role owner
//
// Remove a role: --role none
// The account must already exist (Firebase console → Authentication → Add user),
// and its owner must verify the e-mail address before signing in to /admin.
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { ROLES, setRole } from "./roles.mjs";

const fail = (message) => {
  console.error(`[grant-role] ${message}`);
  process.exit(1);
};

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string" },
    production: { type: "boolean", default: false },
    project: { type: "string" },
  },
});
if (!values.email || !values.role) fail(`usage: --email <email> --role <${ROLES.join("|")}|none> [--production --project <id>]`);
if (![...ROLES, "none"].includes(values.role)) fail(`unknown role "${values.role}". Use one of: ${ROLES.join(", ")}, none.`);

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
const target = values.production ? `PRODUCTION project ${projectId}` : `emulator ${process.env.FIREBASE_AUTH_EMULATOR_HOST} (${projectId})`;
try {
  const result = await setRole(getAuth(app), getFirestore(app), { email: values.email, role: values.role, by: userInfo().username });
  console.log(`[grant-role] ${target}: ${values.email} role ${result.before ?? "(none)"} → ${result.after ?? "(none)"}; all sessions revoked.`);
  if (result.after && !result.emailVerified) {
    console.log("[grant-role] note: this e-mail is not verified yet — /admin/login will ask the user to verify it first.");
  }
} catch (error) {
  if (error?.code === "auth/user-not-found") fail(`${target}: no account with e-mail ${values.email}. Create it first (Firebase console → Authentication → Add user).`);
  throw error;
}
