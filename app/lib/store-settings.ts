// Commerce settings stored in Firestore (settings/payment, settings/shipping)
// and edited in the admin. The schemas live here so the admin form, the server
// and the tests share one definition. Money in centavos.
//
// Owner decisions 2026-11-01: at launch, delivery = one flat rate for all of
// Brazil + local pickup (Mercadão de Madureira); no free shipping; Melhor Envio
// later. Payment = static Pix (docs/architecture.md §5).
import { z } from "zod";

import type { Cents } from "~/lib/money";

export const paymentSettingsSchema = z.object({
  pix: z.object({
    key: z.string().trim().min(1),
    merchantName: z.string().trim().min(1),
    merchantCity: z.string().trim().min(1),
  }),
  /** Unpaid Pix orders are cancelled (and release their stock) after this many hours. */
  expiryHours: z.number().int().min(1).max(168).default(24),
});
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;

const dayRange = z
  .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
  .refine((r) => r.max >= r.min, { message: "max must be ≥ min" });

export const shippingSettingsSchema = z.object({
  /** Business days to prepare an order before it ships or is ready for pickup. */
  handlingDays: z.number().int().min(0).max(30).default(1),
  flatRate: z.object({
    enabled: z.boolean(),
    label: z.string().trim().min(1).default("Entrega em todo o Brasil"),
    priceCents: z.number().int().min(0),
    /** Carrier business days after dispatch; null = no estimate shown. */
    transitDays: dayRange.nullable().default(null),
  }),
  pickup: z.object({
    enabled: z.boolean(),
    label: z.string().trim().min(1).default("Retirar na loja"),
    address: z.string().trim().min(1),
    instructions: z.string().trim().nullable().default(null),
  }),
});
export type ShippingSettings = z.infer<typeof shippingSettingsSchema>;

export type ShippingMethodId = "flat_rate" | "pickup";

export interface ShippingOption {
  id: ShippingMethodId;
  label: string;
  priceCents: Cents;
  needsAddress: boolean;
  /** Business days after payment confirmation (handling + transit); null when not stated. */
  estimateDays: { min: number; max: number } | null;
  /** Pickup only. */
  address: string | null;
  instructions: string | null;
}

/** Delivery choices for a cart. A product marked "pickup only" in Prismic rules out delivery. */
export function shippingOptions(settings: ShippingSettings, cart: { pickupOnly: boolean }): ShippingOption[] {
  const { handlingDays, flatRate, pickup } = settings;
  const options: ShippingOption[] = [];
  if (flatRate.enabled && !cart.pickupOnly) {
    options.push({
      id: "flat_rate",
      label: flatRate.label,
      priceCents: flatRate.priceCents,
      needsAddress: true,
      estimateDays: flatRate.transitDays
        ? { min: handlingDays + flatRate.transitDays.min, max: handlingDays + flatRate.transitDays.max }
        : null,
      address: null,
      instructions: null,
    });
  }
  if (pickup.enabled) {
    options.push({
      id: "pickup",
      label: pickup.label,
      priceCents: 0,
      needsAddress: false,
      estimateDays: { min: handlingDays, max: handlingDays },
      address: pickup.address,
      instructions: pickup.instructions,
    });
  }
  return options;
}
