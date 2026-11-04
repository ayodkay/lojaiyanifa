// Reads commerce settings from Firestore. Missing settings are a configuration
// error the owner must fix (checkout shows it instead of guessing); malformed
// settings fail loudly with every problem listed.
import type { z } from "zod";

import {
  type PaymentSettings,
  paymentSettingsSchema,
  type ShippingSettings,
  shippingSettingsSchema,
  type StoreSettings,
  storeSettingsSchema,
} from "~/lib/store-settings";

import { db } from "./firebase";
import { PixConfigError } from "./pix";

export class ShippingConfigError extends Error {
  override name = "ShippingConfigError";
}

/** Checkout is closed (settings/store): the owner's choice, not a configuration error. */
export class CheckoutClosedError extends Error {
  override name = "CheckoutClosedError";
}

/** "field.path: message; …" for a settings document that doesn't match its schema. */
export const settingsIssues = (error: z.ZodError): string => error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

async function readSettings<T>(id: string, schema: z.ZodType<T>, missing: () => Error): Promise<T> {
  const snap = await db().collection("settings").doc(id).get();
  if (!snap.exists) throw missing();
  const parsed = schema.safeParse(snap.data());
  if (!parsed.success) throw new Error(`settings/${id} is invalid: ${settingsIssues(parsed.error)}`);
  return parsed.data;
}

/** settings/store. An absent document is a valid state: checkout closed. */
export async function getStoreSettings(): Promise<StoreSettings> {
  const snap = await db().collection("settings").doc("store").get();
  const parsed = storeSettingsSchema.safeParse(snap.exists ? snap.data() : {});
  if (!parsed.success) throw new Error(`settings/store is invalid: ${settingsIssues(parsed.error)}`);
  return parsed.data;
}

export const getPaymentSettings = (): Promise<PaymentSettings> =>
  readSettings("payment", paymentSettingsSchema, () => new PixConfigError("Pagamento Pix não configurado (settings/payment)."));

export const getShippingSettings = (): Promise<ShippingSettings> =>
  readSettings("shipping", shippingSettingsSchema, () => new ShippingConfigError("Entrega não configurada (settings/shipping)."));
