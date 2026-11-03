// Admin second factor: a TOTP code from an authenticator app (docs/architecture.md §3).
// What the sign-in page shows and accepts; the Firebase calls are in
// app/.client/firebase.ts. Firebase (Identity Platform) generates 6-digit codes.

/** Shown by the authenticator app next to the codes. */
export const TOTP_ISSUER = "Loja Iyanifa";
/** How the factor is listed on the account (Firebase console, Admin SDK). */
export const TOTP_FACTOR_NAME = "Aplicativo autenticador";
export const TOTP_CODE_LENGTH = 6;

/** Error codes of our own (Firebase's are "auth/…"), raised by app/.client/firebase.ts. */
export const TOTP_ERROR = {
  /** The account's second factor isn't an authenticator app (e.g. SMS): the admin accepts only TOTP. */
  unsupportedFactor: "app/unsupported-second-factor",
  /** The project generates codes of another length than the page asks for. */
  unsupportedCodeLength: "app/unsupported-code-length",
} as const;

/** The code as typed ("123456", "123 456", "123-456"), or null when it isn't 6 digits. */
export function parseTotpCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** The secret key in groups of four, for typing it into an app by hand. */
export function groupSecretKey(key: string): string {
  return (key.replace(/\s/g, "").match(/.{1,4}/g) ?? []).join(" ");
}
