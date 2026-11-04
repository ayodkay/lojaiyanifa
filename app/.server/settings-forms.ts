// The /admin/settings forms (docs/architecture.md §4, §5). Expected mistakes come back as a Portuguese message
// per field, for the page to show next to the field; a valid form becomes exactly the document to store, checked
// again by the settings schemas. The Pix key is stored the way the DICT holds it (parsePixKey); the receiver's
// name and city as typed, since the code normalises them when it is built. Server-only: it needs parsePixKey.
import {
  ADDRESS_MAX,
  EXPIRY_HOURS,
  HANDLING_DAYS_MAX,
  INSTRUCTIONS_MAX,
  LABEL_MAX,
  RECEIVER_INPUT_MAX,
  TRANSIT_DAYS_MAX,
} from "~/lib/admin/settings";
import { parseDecimalToCents } from "~/lib/money";
import {
  PIX_CITY_MAX,
  PIX_NAME_MAX,
  type PaymentSettings,
  paymentSettingsSchema,
  type ShippingSettings,
  shippingSettingsSchema,
} from "~/lib/store-settings";

import { brCodeText, parsePixKey, PixConfigError, type PixKeyType } from "./pix";

export type PaymentErrors = Partial<Record<"pixKey" | "merchantName" | "merchantCity" | "expiryHours", string>>;
export type ShippingErrors = Partial<
  Record<"handlingDays" | "flatRateLabel" | "flatRatePrice" | "transitDays" | "pickupLabel" | "pickupAddress" | "pickupInstructions", string>
>;

type Parsed<T, E> = { ok: true; value: T } | { ok: false; errors: E };

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** A whole number written with digits only, within [min, max]; anything else is null. */
function wholeNumber(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

function receiverProblem(value: string, max: number, what: string): string | null {
  if (value.length > RECEIVER_INPUT_MAX) return `Use no máximo ${RECEIVER_INPUT_MAX} caracteres.`;
  const printed = brCodeText(value, RECEIVER_INPUT_MAX);
  if (!printed) return `Informe ${what}.`;
  if (printed.length > max) return `No código Pix, ${what} tem no máximo ${max} caracteres (sem acentos); use uma forma mais curta.`;
  return null;
}

export function parsePaymentForm(form: FormData): Parsed<PaymentSettings, PaymentErrors> {
  const errors: PaymentErrors = {};
  let key: string | null = null;
  try {
    key = parsePixKey(text(form, "pixKey")).value;
  } catch (error) {
    if (!(error instanceof PixConfigError)) throw error;
    errors.pixKey = error.message;
  }
  const merchantName = text(form, "merchantName");
  const merchantCity = text(form, "merchantCity");
  const nameProblem = receiverProblem(merchantName, PIX_NAME_MAX, "o nome do recebedor");
  const cityProblem = receiverProblem(merchantCity, PIX_CITY_MAX, "a cidade");
  if (nameProblem) errors.merchantName = nameProblem;
  if (cityProblem) errors.merchantCity = cityProblem;
  const expiryHours = wholeNumber(text(form, "expiryHours"), EXPIRY_HOURS.min, EXPIRY_HOURS.max);
  if (expiryHours === null) errors.expiryHours = `Use um número inteiro de horas entre ${EXPIRY_HOURS.min} e ${EXPIRY_HOURS.max} (7 dias).`;

  if (Object.keys(errors).length > 0 || key === null || expiryHours === null) return { ok: false, errors };
  return { ok: true, value: paymentSettingsSchema.parse({ pix: { key, merchantName, merchantCity }, expiryHours }) };
}

function labelProblem(value: string): string | null {
  if (!value) return "Informe o nome desta forma de entrega, como o cliente o verá no checkout.";
  return value.length > LABEL_MAX ? `Use no máximo ${LABEL_MAX} caracteres.` : null;
}

export function parseShippingForm(form: FormData): Parsed<ShippingSettings, ShippingErrors> {
  const errors: ShippingErrors = {};
  const handlingDays = wholeNumber(text(form, "handlingDays"), 0, HANDLING_DAYS_MAX);
  if (handlingDays === null) errors.handlingDays = `Use um número inteiro de dias entre 0 e ${HANDLING_DAYS_MAX}.`;

  const flatRateLabel = text(form, "flatRateLabel");
  const flatLabelProblem = labelProblem(flatRateLabel);
  if (flatLabelProblem) errors.flatRateLabel = flatLabelProblem;
  const priceCents = parseDecimalToCents(text(form, "flatRatePrice"));
  if (priceCents === null) errors.flatRatePrice = "Informe o valor do frete, por exemplo 25,00.";

  const transitMin = text(form, "transitMin");
  const transitMax = text(form, "transitMax");
  let transitDays: { min: number; max: number } | null = null;
  if (transitMin || transitMax) {
    const min = wholeNumber(transitMin, 0, TRANSIT_DAYS_MAX);
    const max = wholeNumber(transitMax, 0, TRANSIT_DAYS_MAX);
    if (min === null || max === null) {
      errors.transitDays = `Preencha os dois prazos com números inteiros entre 0 e ${TRANSIT_DAYS_MAX}, ou deixe os dois em branco.`;
    } else if (max < min) {
      errors.transitDays = "O prazo máximo não pode ser menor que o mínimo.";
    } else {
      transitDays = { min, max };
    }
  }

  const pickupLabel = text(form, "pickupLabel");
  const pickupLabelProblem = labelProblem(pickupLabel);
  if (pickupLabelProblem) errors.pickupLabel = pickupLabelProblem;
  const pickupAddress = text(form, "pickupAddress");
  if (!pickupAddress) errors.pickupAddress = "Informe o endereço de retirada.";
  else if (pickupAddress.length > ADDRESS_MAX) errors.pickupAddress = `Use no máximo ${ADDRESS_MAX} caracteres.`;
  const instructions = text(form, "pickupInstructions");
  if (instructions.length > INSTRUCTIONS_MAX) errors.pickupInstructions = `Use no máximo ${INSTRUCTIONS_MAX} caracteres.`;

  if (Object.keys(errors).length > 0 || handlingDays === null || priceCents === null) return { ok: false, errors };
  return {
    ok: true,
    value: shippingSettingsSchema.parse({
      handlingDays,
      flatRate: { enabled: form.get("flatRateEnabled") === "yes", label: flatRateLabel, priceCents, transitDays },
      pickup: { enabled: form.get("pickupEnabled") === "yes", label: pickupLabel, address: pickupAddress, instructions: instructions || null },
    }),
  };
}

/** The version a form was rendered with ("none" before the first save): the stale-page check compares it. */
const VERSION = /^(?:none|\d{1,12}\.\d{9})$/;

export function parseVersion(form: FormData): string | null {
  const value = form.get("version");
  return typeof value === "string" && VERSION.test(value) ? value : null;
}

export const PIX_KEY_TYPE_LABEL: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  phone: "telefone",
  email: "e-mail",
  evp: "chave aleatória",
};

/** For the audit log: the key's type and its last four characters — enough to see that it changed, not to use it. */
export function maskPixKey(key: string): string {
  try {
    const parsed = parsePixKey(key);
    return `${PIX_KEY_TYPE_LABEL[parsed.type]} …${parsed.value.slice(-4)}`;
  } catch (error) {
    if (!(error instanceof PixConfigError)) throw error;
    return `chave inválida …${key.trim().slice(-4)}`;
  }
}
