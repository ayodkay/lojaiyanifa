// Order shapes shared by the server and the pages. Firestore stores orders in
// orders/{number}; pages only ever receive a view without internal fields.
// Lifecycle: docs/architecture.md §4.3.
import type { Cents } from "~/lib/money";
import type { ShippingMethodId } from "~/lib/store-settings";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pagamento confirmado",
  processing: "Em preparação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  partially_refunded: "Reembolsado parcialmente",
};

/** A pickup order isn't shipped: "shipped" means ready at the store, "delivered" means picked up. */
export function orderStatusLabel(status: OrderStatus, method: ShippingMethodId): string {
  if (method === "pickup" && status === "shipped") return "Pronto para retirada";
  if (method === "pickup" && status === "delivered") return "Retirado";
  return ORDER_STATUS_LABEL[status];
}

// --- fulfilment (docs/architecture.md §4.3) ----------------------------------------------------
// Preparing and shipping a paid order is tracked in its own field, `fulfillment.stage`, because a
// partial refund gives the order the status "partially_refunded" while the rest still ships
// (owner decision 2026-11-02). Without a refund, the status follows the stage.

export const FULFILLMENT_STAGES = ["unfulfilled", "processing", "shipped", "delivered"] as const;
export type FulfillmentStage = (typeof FULFILLMENT_STAGES)[number];
/** The steps an admin can take, in order. Steps only go forward; "processing" may be skipped. */
export type FulfillmentStep = Exclude<FulfillmentStage, "unfulfilled">;

export interface OrderFulfillment {
  stage: FulfillmentStage;
  /** Shipped flat-rate orders: who carries it and how to follow it (all optional). */
  carrier: string | null;
  trackingCode: string | null;
  trackingUrl: string | null;
  /** ISO dates of the steps reached. */
  processingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

/** Order statuses in which preparing/shipping goes on (a full refund or a cancellation ends it). */
const FULFILLABLE: readonly OrderStatus[] = ["paid", "processing", "shipped", "delivered", "partially_refunded"];

export function canTakeStep(status: OrderStatus, stage: FulfillmentStage, step: FulfillmentStep): boolean {
  return FULFILLABLE.includes(status) && FULFILLMENT_STAGES.indexOf(step) > FULFILLMENT_STAGES.indexOf(stage);
}

/** The status after a step: the stage itself, unless a partial refund has taken over the status. */
export function statusAfterStep(status: OrderStatus, step: FulfillmentStep): OrderStatus {
  return status === "partially_refunded" ? status : step;
}

/** Tracking can be filled in or corrected once the order has left (or is ready), unless it was cancelled. */
export function canEditTracking(status: OrderStatus, stage: FulfillmentStage): boolean {
  return status !== "cancelled" && (stage === "shipped" || stage === "delivered");
}

export interface OrderAddress {
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

export interface OrderLine {
  productId: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  unitPriceCents: Cents;
  quantity: number;
  lineTotalCents: Cents;
}

/** What a customer may see about their order (no CPF, no internal fields). Dates are ISO strings. */
export interface CustomerOrderView {
  number: number;
  status: OrderStatus;
  createdAt: string;
  /** When an unpaid Pix order is cancelled. */
  expiresAt: string;
  customer: { name: string; email: string; phone: string };
  shipping: {
    method: ShippingMethodId;
    label: string;
    priceCents: Cents;
    address: OrderAddress | null;
    pickupAddress: string | null;
    estimateDays: { min: number; max: number } | null;
  };
  lines: OrderLine[];
  totals: { subtotalCents: Cents; shippingCents: Cents; discountCents: Cents; totalCents: Cents; savingsCents: Cents };
  payment: { method: "pix"; status: "pending" | "confirmed"; amountCents: Cents; txid: string; brCode: string; refundedCents: Cents };
  fulfillment: OrderFulfillment;
  /** Money returned to the customer (no internal reasons or notes). */
  refunds: { at: string; amountCents: Cents }[];
}
