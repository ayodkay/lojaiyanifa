// Brazilian document and contact formats. Pure and isomorphic: the checkout form
// uses them for hints in the browser and the server uses them to validate.

export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

/** CPF check digits (11 digits, no punctuation). Rejects repeated digits such as 111.111.111-11. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const checkDigit = (base: string) => {
    const sum = [...base].reduce((acc, c, i) => acc + Number(c) * (base.length + 1 - i), 0);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = checkDigit(digits.slice(0, 9));
  const d2 = checkDigit(digits.slice(0, 9) + d1);
  return digits.endsWith(`${d1}${d2}`);
}

/**
 * CNPJ check digits, numeric or alphanumeric (Receita Federal, 2026): 12
 * characters [0-9A-Z] + 2 digits; each character counts as its char code − 48,
 * which reduces to the classic rule for all-digit CNPJs.
 */
export function isValidCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const checkDigit = (base: string, weights: number[]) => {
    const sum = [...base].reduce((acc, c, i) => acc + (c.charCodeAt(0) - 48) * weights[i]!, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const base = value.slice(0, 12);
  const d1 = checkDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${d1}${d2}`);
}

/** "52998224725" → "529.982.247-25" (input must be 11 digits). */
export const formatCpf = (digits: string): string => digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

/**
 * Brazilian phone → E.164 ("+5521987654321"), or null. Accepts the usual ways
 * people type it: "(21) 98765-4321", "21987654321", "+55 21 98765-4321".
 * DDD (2 digits, no leading 0) + 8 digits (landline) or 9 digits starting with 9 (mobile).
 */
export function normalizeBrPhone(input: string): string | null {
  let digits = onlyDigits(input);
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  else if (digits.length === 12 && digits.startsWith("55") && input.trim().startsWith("+")) digits = digits.slice(2);
  if (!/^[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(digits)) return null;
  return `+55${digits}`;
}

/** "+5521987654321" → "(21) 98765-4321". */
export function formatBrPhone(e164: string): string {
  const d = e164.replace(/^\+55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
}

/**
 * A phone typed by hand (the store's, in Prismic) for display and for its tel: link: "5521987654321" →
 * "(21) 98765-4321" and "tel:+5521987654321". Anything else (e.g. a 0800 number) is shown as typed.
 */
export function phoneLink(input: string): { text: string; href: string } {
  const e164 = normalizeBrPhone(input);
  return e164 ? { text: formatBrPhone(e164), href: `tel:${e164}` } : { text: input.trim(), href: `tel:${input.replace(/[^\d+]/g, "")}` };
}

/** CEP → 8 digits, or null. */
export function normalizeCep(input: string): string | null {
  const digits = onlyDigits(input);
  return /^\d{8}$/.test(digits) ? digits : null;
}

export const formatCep = (digits: string): string => digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");

/** The 27 federative units, for address forms. */
export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type Uf = (typeof UFS)[number];
export const isUf = (value: string): value is Uf => (UFS as readonly string[]).includes(value);
