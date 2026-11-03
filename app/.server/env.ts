// Server configuration, validated once. Fails loudly with every problem listed,
// instead of letting a missing variable surface later as a confusing bug.
import { z } from "zod";

const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Public origin of the store, no trailing slash. Used for canonical URLs, emails, sitemaps. */
  SITE_URL: z
    .url()
    .transform((v) => v.replace(/\/+$/, "")),
  PRISMIC_REPO: z.string().min(1),
  PRISMIC_LOCALE: z.string().default("pt-br"),
  PRISMIC_ACCESS_TOKEN: optional,
  PRISMIC_WRITE_TOKEN: optional,
  /** Firebase project. In Cloud Functions it comes from the runtime (GCLOUD_PROJECT). */
  FIREBASE_PROJECT_ID: optional,
  /** host:port of the local emulators. Required in development and tests (see app/.server/firebase.ts). */
  FIRESTORE_EMULATOR_HOST: optional,
  FIREBASE_AUTH_EMULATOR_HOST: optional,
  /**
   * Firebase web app config for the browser sign-in (Firebase console → Project
   * settings → Your apps). Public values, not secrets. Not needed against the
   * Auth emulator, which ignores the API key. Not named FIREBASE_*: the Firebase
   * CLI refuses that (reserved) prefix in a deployed function's environment.
   */
  WEB_API_KEY: optional,
  WEB_AUTH_DOMAIN: optional,
  /** Production: admins must sign in with a second factor. */
  ADMIN_REQUIRE_MFA: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server configuration (see .env.example):\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
