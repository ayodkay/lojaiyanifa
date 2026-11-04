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
  // --- E-mail (Brevo SMTP relay; app/.server/mail). All optional: without them e-mails wait in the outbox. ---
  /** Sender, e.g. `Loja Iyanifa <pedidos@lojaiyanifa.com.br>`. Its domain must be verified in Brevo. */
  MAIL_FROM: optional,
  /** Where customers' replies go (the support address). Defaults to the support e-mail in Prismic settings. */
  MAIL_REPLY_TO: optional,
  /** The store's own inbox for notifications (new orders, contact messages). Owner data: never committed. */
  MAIL_STORE_TO: optional,
  SMTP_HOST: z.string().trim().default("smtp-relay.brevo.com"),
  /** 587 = STARTTLS (required, never plain text); 465 = TLS from the start. */
  SMTP_PORT: z.coerce.number().int().refine((p) => p === 587 || p === 465 || p === 2525, "use 587, 465 or 2525").default(587),
  /** The SMTP login shown in Brevo → SMTP & API → SMTP. */
  SMTP_USER: optional,
  /** The SMTP key. Production: Secret Manager (`firebase functions:secrets:set SMTP_PASSWORD`), never an env file. */
  SMTP_PASSWORD: optional,
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
