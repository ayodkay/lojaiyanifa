// Customer account forms (docs/architecture.md §3, §4.2 `customers`): one schema for the browser hints and the server
// (the only validation that counts). Messages are shown to customers (pt-BR).
// Owner decision 2026-11-01: CPF is required at account creation, as at checkout.
import { z } from "zod";

import { isValidCpf, normalizeBrPhone, onlyDigits } from "~/lib/br";
import { addressSchema } from "~/lib/checkout";

/** Customers sign in again after 14 days (admins: 12 hours). */
export const CUSTOMER_SESSION_DAYS = 14;
export const MAX_ADDRESSES = 10;
/** Shortest password Firebase accepts is 6; the store asks for 8. */
export const MIN_PASSWORD_LENGTH = 8;

const name = z
  .string()
  .trim()
  .min(1, "Informe seu nome completo.")
  .max(120, "Use no máximo 120 caracteres.")
  .refine((v) => v.split(/\s+/).length >= 2, "Informe nome e sobrenome.");

const phone = z.string().transform((value, ctx) => {
  const normalized = normalizeBrPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: value.trim() ? "Telefone inválido: informe DDD e número, ex.: (21) 99999-9999." : "Informe seu celular com DDD." });
    return z.NEVER;
  }
  return normalized;
});

const cpf = z.string().transform((value, ctx) => {
  const digits = onlyDigits(value);
  if (!isValidCpf(digits)) {
    ctx.addIssue({ code: "custom", message: digits ? "CPF inválido." : "Informe seu CPF." });
    return z.NEVER;
  }
  return digits;
});

export const profileSchema = z.object({
  name,
  phone,
  cpf,
  /** Store news and offers by e-mail: only with consent (LGPD art. 7, I), off unless ticked. */
  marketingEmail: z.boolean(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const registrationSchema = profileSchema.extend({
  acceptTerms: z.literal(true, { error: "Para criar a conta, aceite os termos de uso e a política de privacidade." }),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;

export const savedAddressSchema = addressSchema.extend({
  label: z
    .string()
    .trim()
    .max(40, "Use no máximo 40 caracteres.")
    .transform((v) => v || null),
  isDefault: z.boolean(),
});
export type SavedAddressInput = z.infer<typeof savedAddressSchema>;

const ADDRESS_KEYS = ["cep", "street", "number", "complement", "neighborhood", "city", "state"] as const;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

export const profileFormToObject = (form: FormData) => ({
  name: text(form, "name"),
  phone: text(form, "phone"),
  cpf: text(form, "cpf"),
  marketingEmail: form.get("marketingEmail") === "on",
});

export const registrationFormToObject = (form: FormData) => ({ ...profileFormToObject(form), acceptTerms: form.get("acceptTerms") === "on" });

export const addressFormToObject = (form: FormData) => ({
  ...Object.fromEntries(ADDRESS_KEYS.map((k) => [k, text(form, k)])),
  label: text(form, "label"),
  isDefault: form.get("isDefault") === "on",
});

/** First error per form field ("cep", not "address.cep"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path.at(-1) ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * Where to go after signing in: a path on this site, never another origin ("//evil.example", "/\\evil.example"),
 * never the admin (which has its own sign-in). Anything else → the account page.
 */
export function safeAccountRedirect(value: unknown, fallback = "/account"): string {
  if (typeof value !== "string" || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\r\n\t]/.test(value)) return fallback;
  if (value === "/admin" || value.startsWith("/admin/") || value.startsWith("/admin?")) return fallback;
  return value;
}

/** "Maria da Silva" → "Maria". */
export const firstName = (fullName: string | null | undefined): string | null => fullName?.trim().split(/\s+/)[0] || null;
