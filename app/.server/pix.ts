// Static Pix (BR Code) for orders. Owner decision 2026-10-31: no payment
// gateway; the customer pays the exact amount by QR code or "Pix copia e cola"
// and an admin confirms the payment (docs/architecture.md §5).
//
// pix-utils builds the EMV payload, but (checked 2026-11-01, v2.8.2) it accepts
// an empty key, a txid with symbols and negative amounts. So every input is
// validated here first, and each generated code is parsed back and compared
// with its inputs before it can reach a customer.
import { createStaticPix, hasError, isStaticPix, parsePix } from "pix-utils";
import { toString as qrToString } from "qrcode";

import { isValidCnpj, isValidCpf } from "~/lib/br";
import { type Cents, toDecimalString } from "~/lib/money";
import { PIX_CITY_MAX, PIX_NAME_MAX } from "~/lib/store-settings";

export type PixKeyType = "cpf" | "cnpj" | "phone" | "email" | "evp";

export interface PixKey {
  type: PixKeyType;
  /** As registered in the DICT: digits only (CPF/CNPJ), +55… (phone), lowercase (e-mail, random key). */
  value: string;
}

/** Store Pix settings (Firestore settings/payment, edited in the admin). */
export interface PixSettings {
  key: string;
  merchantName: string;
  merchantCity: string;
}

export interface PixPayment {
  /** "Pix copia e cola" — also the content of the QR code. */
  brCode: string;
  amountCents: Cents;
  txid: string;
  keyType: PixKeyType;
}

/** A configuration problem the store owner must fix (shown in the admin, blocks checkout). */
export class PixConfigError extends Error {
  override name = "PixConfigError";
}

// --- key validation (CPF/CNPJ check digits live in ~/lib/br) -----------------------------------

const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Recognises a Pix key and normalises it the way the DICT stores it. */
export function parsePixKey(input: string): PixKey {
  const raw = input.trim();
  if (!raw) throw new PixConfigError("Chave Pix não configurada.");
  if (EVP.test(raw)) return { type: "evp", value: raw.toLowerCase() };
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    if (!EMAIL.test(email) || email.length > 77) throw new PixConfigError(`Chave Pix (e-mail) inválida: ${raw}`);
    return { type: "email", value: email };
  }
  if (raw.startsWith("+")) {
    const phone = `+${raw.replace(/\D/g, "")}`;
    if (!/^\+55\d{10,11}$/.test(phone)) {
      throw new PixConfigError(`Chave Pix (telefone) inválida: ${raw}. Use +55, DDD e número, ex.: +5511987654321.`);
    }
    return { type: "phone", value: phone };
  }
  const compact = raw.replace(/[.\-/\s]/g, "").toUpperCase();
  if (/^\d{11}$/.test(compact)) {
    if (!isValidCpf(compact)) {
      throw new PixConfigError(`CPF inválido como chave Pix: ${raw}. Se for um telefone, use o formato +55DDNÚMERO.`);
    }
    return { type: "cpf", value: compact };
  }
  if (/^[0-9A-Z]{12}\d{2}$/.test(compact)) {
    if (!isValidCnpj(compact)) throw new PixConfigError(`CNPJ inválido como chave Pix: ${raw}.`);
    return { type: "cnpj", value: compact };
  }
  throw new PixConfigError(`Chave Pix não reconhecida: ${raw}. Use CPF, CNPJ, e-mail, telefone (+55…) ou chave aleatória.`);
}

// --- BR Code ----------------------------------------------------------------------------------

/** BR Code text field: uppercase ASCII without accents, single spaces, at most `max` characters. */
export function brCodeText(value: string, max: number): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
    .toUpperCase();
}

/** Transaction ID for an order: printed on the payer's receipt, used to match payments to orders. */
export function pixTxid(orderNumber: number): string {
  if (!Number.isInteger(orderNumber) || orderNumber < 1) throw new Error(`pixTxid: invalid order number ${orderNumber}`);
  return `PEDIDO${orderNumber}`;
}

export function buildPixPayment(settings: PixSettings, amountCents: Cents, txid: string): PixPayment {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`buildPixPayment: amount must be whole centavos above 0, got ${amountCents}`);
  }
  if (!/^[A-Za-z0-9]{1,25}$/.test(txid)) throw new Error(`buildPixPayment: invalid txid "${txid}" (1–25 letters/digits)`);
  const key = parsePixKey(settings.key);
  const merchantName = brCodeText(settings.merchantName, PIX_NAME_MAX);
  const merchantCity = brCodeText(settings.merchantCity, PIX_CITY_MAX);
  if (!merchantName) throw new PixConfigError("Nome do recebedor Pix não configurado.");
  if (!merchantCity) throw new PixConfigError("Cidade do recebedor Pix não configurada.");

  const pix = createStaticPix({
    merchantName,
    merchantCity,
    pixKey: key.value,
    transactionAmount: Number(toDecimalString(amountCents)),
    txid,
  });
  if (hasError(pix)) throw new Error(`pix-utils refused the payment: ${pix.message}`);
  const brCode = pix.toBRCode();

  // Never hand out a code we haven't read back.
  const parsed = parsePix(brCode);
  if (
    hasError(parsed) ||
    !isStaticPix(parsed) ||
    parsed.pixKey !== key.value ||
    parsed.txid !== txid ||
    parsed.transactionAmount === undefined || // static codes may omit the amount; ours never may
    Math.round(parsed.transactionAmount * 100) !== amountCents
  ) {
    throw new Error(`buildPixPayment: the generated BR Code doesn't match its inputs (txid ${txid})`);
  }
  return { brCode, amountCents, txid, keyType: key.type };
}

/** QR code of a BR Code as an SVG document (rendered through an <img> data URL; CSP allows data: images). */
export function pixQrSvg(brCode: string): Promise<string> {
  return qrToString(brCode, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
}
