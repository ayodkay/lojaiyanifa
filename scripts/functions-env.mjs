// Firebase predeploy hook for functions (see firebase.json): gives the deployed
// functions their configuration.
//
// When it deploys, the Firebase CLI loads `.env` and `.env.<project-id>` from the
// functions source (build/functions/), which `npm run build` recreates from
// scratch. The production values must stay out of git, so they live in a
// gitignored file at the repo root named after the project (.env.lojaiyanifa).
// This hook checks that file and copies it into build/functions/ right before
// each functions deploy. A deploy without usable production config stops here
// instead of shipping a site where every page fails.
//
//   Run by `firebase deploy` (it sets GCLOUD_PROJECT, PROJECT_DIR, RESOURCE_DIR).
//   By hand (bash): GCLOUD_PROJECT=lojaiyanifa node scripts/functions-env.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

/** What the deployed server needs (app/.server/env.ts), made explicit for production. */
export const REQUIRED = ["SITE_URL", "PRISMIC_REPO", "PRISMIC_LOCALE", "WEB_API_KEY", "WEB_AUTH_DOMAIN", "ADMIN_REQUIRE_MFA"];

/** Never deployed, with the reason shown to whoever put them there. */
const FORBIDDEN = {
  FIRESTORE_EMULATOR_HOST: "emulator variable (pointed at an emulator, the Admin SDK accepts unsigned tokens)",
  FIREBASE_AUTH_EMULATOR_HOST: "emulator variable (pointed at an emulator, the Admin SDK accepts unsigned tokens)",
  FUNCTIONS_EMULATOR: "it would switch off the server's emulator-in-production guard",
  FIREBASE_PROJECT_ID: "development only; Cloud Functions provides the project",
  GOOGLE_APPLICATION_CREDENTIALS: "a local key file; Cloud Functions provides the credentials",
  PRISMIC_WRITE_TOKEN: "a secret; use Secret Manager (firebase functions:secrets:set) if the server ever needs it",
  PRISMIC_ACCESS_TOKEN: "a secret; use Secret Manager (firebase functions:secrets:set) if the Content API becomes private",
  SMTP_PASSWORD: "a secret (the Brevo SMTP key); use Secret Manager: firebase functions:secrets:set SMTP_PASSWORD --project prod",
};

/** Prefixes the Firebase CLI refuses in a function's environment (firebase-tools lib/functions/env.js). */
const RESERVED_PREFIXES = ["FIREBASE_", "X_GOOGLE_", "EXT_"];

/**
 * Problems that keep a production env file from being deployed; empty when it
 * can go. Only SITE_URL and ADMIN_REQUIRE_MFA values are ever echoed (not secret).
 */
export function productionEnvProblems(text) {
  const vars = parseEnv(text);
  const problems = [];
  for (const key of REQUIRED) {
    if (!vars[key]?.trim()) problems.push(`${key} is missing or empty`);
  }
  for (const key of Object.keys(vars)) {
    if (Object.hasOwn(FORBIDDEN, key)) problems.push(`${key} must not be deployed: ${FORBIDDEN[key]}`);
    else if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      problems.push(`${key}: the Firebase CLI refuses names starting with ${RESERVED_PREFIXES.join(", ")}; rename it`);
    }
  }
  const site = vars.SITE_URL?.trim();
  if (site && !/^https:\/\/[^/\s?#]+\/?$/.test(site)) problems.push(`SITE_URL must be an https origin with no path, got "${site}"`);
  const mfa = vars.ADMIN_REQUIRE_MFA?.trim();
  if (mfa && mfa !== "true") problems.push(`ADMIN_REQUIRE_MFA must be "true" in production, got "${mfa}"`);
  return problems;
}

/**
 * The dev .env.local as the functions emulator (`npm run preview`) can load it. If one name in the file has a reserved
 * prefix, the CLI loads none of it (discovery fails), and the dev file has two: FIREBASE_PROJECT_ID and
 * FIREBASE_AUTH_EMULATOR_HOST. The emulator sets FIREBASE_CONFIG and the emulator hosts itself, so those lines are
 * dropped; every other line is kept exactly as written (quotes, comments, line endings).
 */
export function emulatorEnvFile(text) {
  const dropped = [];
  const lines = text.split(/(?<=\n)/).filter((line) => {
    const name = /^\s*(?:export\s+)?([\w./]+)\s*=/.exec(line)?.[1];
    if (!name || !RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
    dropped.push(name);
    return false;
  });
  return { text: lines.join(""), dropped };
}

function fail(message) {
  console.error(`\n[functions-env] ERROR: ${message}\n`);
  process.exit(1);
}

function main() {
  const project = process.env.GCLOUD_PROJECT;
  if (!project) fail("GCLOUD_PROJECT is not set. `firebase deploy` sets it; by hand: GCLOUD_PROJECT=<project-id> node scripts/functions-env.mjs");
  const root = process.env.PROJECT_DIR ?? process.cwd();
  const target = process.env.RESOURCE_DIR ?? join(root, "build", "functions");
  const name = `.env.${project}`;
  const source = join(root, name);
  if (!existsSync(source)) {
    fail(`${name} not found at the repo root: deploying to ${project} needs its production config (see .env.example, "Production").`);
  }
  if (!existsSync(join(target, "package.json"))) fail(`${target} isn't a built functions package: run \`npm run build\` first.`);
  const text = readFileSync(source, "utf8");
  const problems = productionEnvProblems(text);
  if (problems.length > 0) fail(`${name} can't be deployed:\n  - ${problems.join("\n  - ")}`);
  writeFileSync(join(target, name), text);
  console.log(`[functions-env] ${name} checked and copied to ${relative(root, target)}: ${Object.keys(parseEnv(text)).join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
