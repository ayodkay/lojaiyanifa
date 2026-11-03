// Admin forms for preparing and shipping orders, and for internal notes.
// Shared by the order page and the server (app/.server/order-fulfillment.ts).
import type { FulfillmentStep } from "~/lib/orders";
import type { ShippingMethodId } from "~/lib/store-settings";

export const FULFILLMENT_STEPS: readonly FulfillmentStep[] = ["processing", "shipped", "delivered"];

/** What each step's button says; pickup orders are handed over at the store, not shipped. */
export function stepLabel(step: FulfillmentStep, method: ShippingMethodId): string {
  if (step === "processing") return "Marcar como em preparação";
  if (step === "shipped") return method === "pickup" ? "Marcar como pronto para retirada" : "Marcar como enviado";
  return method === "pickup" ? "Marcar como retirado" : "Marcar como entregue";
}

export const CARRIER_MAX = 60;
export const TRACKING_CODE_MAX = 60;
export const TRACKING_URL_MAX = 500;
export const NOTE_MAX = 1000;
/** Keeps an order document far below Firestore's 1 MiB limit. */
export const NOTES_PER_ORDER_MAX = 200;

export interface TrackingInput {
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
}
export type TrackingErrors = Partial<Record<keyof TrackingInput, string>>;

type Parsed<T, E> = { ok: true; value: T } | { ok: false; errors: E };

const text = (form: FormData, name: string): string | null => {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

// Control characters (tabs, line breaks…) have no place in a one-line field shown to customers.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Carrier, tracking code and link: all optional, but a code or link needs the carrier, and a link must be https. */
export function parseTracking(form: FormData): Parsed<TrackingInput, TrackingErrors> {
  const value: TrackingInput = { carrier: text(form, "carrier"), trackingCode: text(form, "trackingCode"), trackingUrl: text(form, "trackingUrl") };
  const errors: TrackingErrors = {};
  if (value.carrier && (value.carrier.length > CARRIER_MAX || CONTROL.test(value.carrier))) errors.carrier = `Use até ${CARRIER_MAX} caracteres, em uma linha.`;
  if (value.trackingCode && (value.trackingCode.length > TRACKING_CODE_MAX || CONTROL.test(value.trackingCode))) {
    errors.trackingCode = `Use até ${TRACKING_CODE_MAX} caracteres, em uma linha.`;
  }
  if (value.trackingUrl) {
    let url: URL | null = null;
    try {
      url = new URL(value.trackingUrl);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== "https:" || value.trackingUrl.length > TRACKING_URL_MAX) {
      errors.trackingUrl = "Informe o link completo de rastreamento, começando com https://.";
    }
  }
  if ((value.trackingCode || value.trackingUrl) && !value.carrier && !errors.carrier) errors.carrier = "Informe a transportadora.";
  return Object.keys(errors).length === 0 ? { ok: true, value } : { ok: false, errors };
}

export type StepForm = { step: FulfillmentStep; tracking: TrackingInput | null };

/** The step button's form. Tracking is read only when marking a delivery order as shipped. */
export function parseStepForm(form: FormData, method: ShippingMethodId): Parsed<StepForm, TrackingErrors & { step?: string }> {
  const step = FULFILLMENT_STEPS.find((s) => s === form.get("step"));
  if (!step) return { ok: false, errors: { step: "Etapa desconhecida." } };
  if (step === "delivered" && form.get("confirmed") !== "yes") {
    return { ok: false, errors: { step: method === "pickup" ? "Marque a caixa confirmando que o cliente retirou o pedido." : "Marque a caixa confirmando a entrega." } };
  }
  if (step !== "shipped" || method === "pickup") return { ok: true, value: { step, tracking: null } };
  const tracking = parseTracking(form);
  return tracking.ok ? { ok: true, value: { step, tracking: tracking.value } } : tracking;
}

/** An internal note: never shown to the customer. */
export function parseNote(form: FormData): Parsed<string, { text?: string }> {
  const value = form.get("text");
  const note = typeof value === "string" ? value.trim() : "";
  if (!note) return { ok: false, errors: { text: "Escreva a nota." } };
  if (note.length > NOTE_MAX) return { ok: false, errors: { text: `Use no máximo ${NOTE_MAX} caracteres.` } };
  return { ok: true, value: note };
}
