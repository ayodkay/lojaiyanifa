// Reading the parts of an order document (orders/{number}) that several
// modules share: the customer page, the admin, and the transactions that
// change orders. Corrupt data fails loudly. The one tolerated gap: orders
// written before fulfilment and notes existed (2026-11-02) lack those fields.
import type { DocumentData, Timestamp } from "firebase-admin/firestore";

import type { AdminOrderNote, AdminOrderRefund } from "~/lib/admin/orders";
import { REFUND_REASONS } from "~/lib/admin/refunds";
import type { Cents } from "~/lib/money";
import { FULFILLMENT_STAGES, type OrderFulfillment, type OrderStatus } from "~/lib/orders";

export const iso = (value: unknown): string => (value as Timestamp).toDate().toISOString();
const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);

/** `fulfillment` of a new order (written by createOrder). */
export const NEW_FULFILLMENT = {
  stage: "unfulfilled",
  carrier: null,
  trackingCode: null,
  trackingUrl: null,
  processingAt: null,
  shippedAt: null,
  deliveredAt: null,
} as const;

/** The only statuses an order could have before `fulfillment` was written. */
const BEFORE_FULFILLMENT: readonly OrderStatus[] = ["pending_payment", "paid", "cancelled"];

/** The stored `fulfillment` map as it is (Timestamps), for transactions that rewrite it. */
export function rawFulfillmentOf(order: DocumentData): Record<string, unknown> {
  const f: unknown = order.fulfillment;
  if (f === undefined) {
    if (BEFORE_FULFILLMENT.includes(order.status)) return { ...NEW_FULFILLMENT };
    throw new Error(`orders/${order.number} is ${order.status} but has no fulfillment`);
  }
  const stage = (f as { stage?: unknown } | null)?.stage;
  if (typeof stage !== "string" || !(FULFILLMENT_STAGES as readonly string[]).includes(stage)) {
    throw new Error(`orders/${order.number} has a corrupt fulfillment: ${JSON.stringify(f)}`);
  }
  return f as Record<string, unknown>;
}

export function fulfillmentOf(order: DocumentData): OrderFulfillment {
  const f = rawFulfillmentOf(order);
  return {
    stage: f.stage as OrderFulfillment["stage"],
    carrier: (f.carrier as string | null) ?? null,
    trackingCode: (f.trackingCode as string | null) ?? null,
    trackingUrl: (f.trackingUrl as string | null) ?? null,
    processingAt: isoOrNull(f.processingAt),
    shippedAt: isoOrNull(f.shippedAt),
    deliveredAt: isoOrNull(f.deliveredAt),
  };
}

/** Internal notes as stored (Timestamps); orders from before notes existed have none. */
export function rawNotesOf(order: DocumentData): DocumentData[] {
  const notes: unknown = order.notes ?? [];
  const valid =
    Array.isArray(notes) &&
    notes.every((n) => typeof n?.id === "string" && typeof n?.text === "string" && typeof n?.by?.email === "string" && typeof n?.at?.toDate === "function");
  if (!valid) throw new Error(`orders/${order.number} has corrupt notes`);
  return notes as DocumentData[];
}

export const notesOf = (order: DocumentData): AdminOrderNote[] =>
  rawNotesOf(order).map((n) => ({ id: n.id, at: iso(n.at), by: { uid: n.by.uid, email: n.by.email }, text: n.text }));

/** Refunds as stored (Timestamps); orders from before refunds existed have none. */
export function rawRefundsOf(order: DocumentData): DocumentData[] {
  const refunds: unknown = order.refunds ?? [];
  const valid =
    Array.isArray(refunds) &&
    refunds.every(
      (r) =>
        typeof r?.id === "string" &&
        typeof r?.key === "string" &&
        Number.isInteger(r?.amountCents) &&
        r.amountCents > 0 &&
        (REFUND_REASONS as readonly string[]).includes(r?.reason) &&
        Array.isArray(r?.restock) &&
        r.restock.every((l: { sku?: unknown; quantity?: unknown }) => typeof l?.sku === "string" && Number.isInteger(l?.quantity) && (l.quantity as number) > 0) &&
        typeof r?.at?.toDate === "function",
    );
  if (!valid) throw new Error(`orders/${order.number} has corrupt refunds`);
  return refunds as DocumentData[];
}

/** Total refunded; the stored total must match the refund records (an edit by hand fails loudly). */
export function refundedCentsOf(order: DocumentData): Cents {
  const sum = rawRefundsOf(order).reduce((total, r) => total + (r.amountCents as number), 0);
  const stored: unknown = order.payment?.refundedCents ?? 0;
  if (stored !== sum) throw new Error(`orders/${order.number}: payment.refundedCents is ${String(stored)} but its refunds add up to ${sum}`);
  return sum;
}

export const refundsOf = (order: DocumentData): AdminOrderRefund[] =>
  rawRefundsOf(order).map((r) => ({
    id: r.id,
    at: iso(r.at),
    by: { uid: r.by.uid, email: r.by.email },
    amountCents: r.amountCents,
    reason: r.reason,
    note: r.note ?? null,
    restock: r.restock,
  }));
