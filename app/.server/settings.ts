// Reads commerce settings from Firestore. Missing settings are a configuration
// error the owner must fix (checkout shows it instead of guessing); malformed
// settings fail loudly with every problem listed.
import type { z } from "zod";

import { type PaymentSettings, paymentSettingsSchema, type ShippingSettings, shippingSettingsSchema } from "~/lib/store-settings";

import { db } from "./firebase";
import { PixConfigError } from "./pix";

export class ShippingConfigError extends Error {
  override name = "ShippingConfigError";
}

async function readSettings<T>(id: string, schema: z.ZodType<T>, missing: () => Error): Promise<T> {
  const snap = await db().collection("settings").doc(id).get();
  if (!snap.exists) throw missing();
  const parsed = schema.safeParse(snap.data());
  if (!parsed.success) {
    throw new Error(`settings/${id} is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

export const getPaymentSettings = (): Promise<PaymentSettings> =>
  readSettings("payment", paymentSettingsSchema, () => new PixConfigError("Pagamento Pix não configurado (settings/payment)."));

export const getShippingSettings = (): Promise<ShippingSettings> =>
  readSettings("shipping", shippingSettingsSchema, () => new ShippingConfigError("Entrega não configurada (settings/shipping)."));
