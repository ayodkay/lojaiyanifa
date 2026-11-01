// All money in the app is integer centavos (BRL). Floats only exist at the
// edges: Prismic Number fields (reais) and display formatting.

export type Cents = number;

/** Converts a value in reais (e.g. 129.9) to integer centavos (12990). */
export function toCents(reais: number | null | undefined): Cents | null {
  if (reais === null || reais === undefined || !Number.isFinite(reais)) return null;
  return Math.round(reais * 100);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 129,90" (with a non-breaking space, as Intl formats it). */
export function formatBRL(cents: Cents): string {
  return brl.format(cents / 100);
}

/** Whole-number percentage saved, or null when there is no real discount. */
export function percentOff(priceCents: Cents, originalCents: Cents): number | null {
  if (originalCents <= 0 || priceCents <= 0 || originalCents <= priceCents) return null;
  return Math.round((1 - priceCents / originalCents) * 100);
}

/** Reais with two decimals and a dot, as required by the Pix BR Code and schema.org. */
export function toDecimalString(cents: Cents): string {
  return (cents / 100).toFixed(2);
}
