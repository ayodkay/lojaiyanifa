// Orders as the admin sees them: the list (by status, newest first, paged by
// order number), per-tab counts, one order in full, and the two ways a Pix
// order leaves "pending_payment" (docs/architecture.md §4.3):
//   paid      — the admin saw the money arrive; the reservation becomes a sale
//   cancelled — the reservation is released and the stock is for sale again
// Admin SDK: callers must have passed the admin gate (app/.server/admin-guard.ts)
// and checked the capability for the action.
//
// Index: status == X ordered by number desc needs the composite index in
// firestore.indexes.json (the emulator doesn't enforce indexes; production does).
import { type DocumentData, type Query, Timestamp } from "firebase-admin/firestore";

import { type AdminOrderRow, type AdminOrderView, type CancelForm, ORDER_FILTERS, type OrderFilter } from "~/lib/admin/orders";
import type { OrderStatus } from "~/lib/orders";

import { writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import { inventoryRef, skuDocId } from "./inventory";
import type { AdminUser } from "./session";

export class OrderNotFoundError extends Error {
  override name = "OrderNotFoundError";
}

/** The order no longer awaits payment: someone confirmed or cancelled it first. */
export class OrderNotPendingError extends Error {
  override name = "OrderNotPendingError";
  constructor(
    readonly number: number,
    readonly status: OrderStatus,
  ) {
    super(`orders/${number} is ${status}, not pending_payment`);
  }
}

export const ORDERS_PAGE_SIZE = 25;

const orders = () => db().collection("orders");
const iso = (value: unknown): string => (value as Timestamp).toDate().toISOString();

function toRow(d: DocumentData): AdminOrderRow {
  return {
    number: d.number,
    status: d.status,
    createdAt: iso(d.createdAt),
    expiresAt: iso(d.expiresAt),
    customerName: d.customer.name,
    customerEmail: d.customer.email,
    itemCount: (d.lines as { quantity: number }[]).reduce((sum, line) => sum + line.quantity, 0),
    totalCents: d.totals.totalCents,
    shippingMethod: d.shipping.method,
  };
}

/** Newest first. `before` = the last order number of the previous page. */
export async function listOrders(
  filter: OrderFilter,
  before: number | null,
  pageSize = ORDERS_PAGE_SIZE,
): Promise<{ rows: AdminOrderRow[]; nextBefore: number | null }> {
  let query: Query = filter === "all" ? orders() : orders().where("status", "==", filter);
  query = query.orderBy("number", "desc");
  if (before !== null) query = query.startAfter(before);
  const snap = await query.limit(pageSize + 1).get(); // one extra tells whether another page exists
  const page = snap.docs.slice(0, pageSize);
  return {
    rows: page.map((doc) => toRow(doc.data())),
    nextBefore: snap.size > pageSize ? (page.at(-1)!.get("number") as number) : null,
  };
}

export async function countOrders(): Promise<Record<OrderFilter, number>> {
  const counts = await Promise.all(
    ORDER_FILTERS.map((filter) => (filter === "all" ? orders() : orders().where("status", "==", filter)).count().get()),
  );
  return Object.fromEntries(ORDER_FILTERS.map((filter, i) => [filter, counts[i]!.data().count])) as Record<OrderFilter, number>;
}

// --- one order -----------------------------------------------------------------------------------

const orderRef = (number: number) => orders().doc(String(number));

function toAdminView(d: DocumentData): AdminOrderView {
  return {
    number: d.number,
    status: d.status,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    expiresAt: iso(d.expiresAt),
    customer: { name: d.customer.name, email: d.customer.email, phone: d.customer.phone, cpf: d.customer.cpf, uid: d.customer.uid ?? null },
    shipping: d.shipping,
    lines: d.lines,
    totals: d.totals,
    payment: {
      method: "pix",
      status: d.payment.status,
      amountCents: d.payment.amountCents,
      txid: d.payment.txid,
      brCode: d.payment.brCode,
      confirmedAt: d.payment.confirmedAt ? iso(d.payment.confirmedAt) : null,
      confirmedBy: d.payment.confirmedBy ?? null,
    },
    cancellation: d.cancellation
      ? { at: iso(d.cancellation.at), reason: d.cancellation.reason, note: d.cancellation.note ?? null, by: d.cancellation.by }
      : null,
    timeline: (d.timeline as DocumentData[]).map((t) => ({ at: iso(t.at), status: t.status, by: t.by, actor: t.actor ?? null, note: t.note ?? null })),
  };
}

export async function getOrderForAdmin(number: number): Promise<AdminOrderView | null> {
  const snap = await orderRef(number).get();
  return snap.exists ? toAdminView(snap.data()!) : null;
}

// --- leaving pending_payment ------------------------------------------------------------------------

interface Reservation {
  sku: string;
  quantity: number;
}

/** The stock an order holds (written by createOrder). Corrupt data fails loudly instead of being guessed at. */
function reservationsOf(number: number, order: DocumentData): Reservation[] {
  const list: unknown = order.reservations;
  const valid =
    Array.isArray(list) &&
    list.every((r) => typeof r?.sku === "string" && Number.isInteger(r?.quantity) && r.quantity > 0) &&
    new Set(list.map((r) => r.sku)).size === list.length;
  if (!valid) throw new Error(`orders/${number} has corrupt reservations: ${JSON.stringify(list)}`);
  return list as Reservation[];
}

type Settlement = { kind: "paid"; actor: AdminUser } | { kind: "cancelled"; actor: AdminUser; form: CancelForm };

/**
 * One transaction: the order must still be pending; each reserved SKU's stock
 * document must cover the reservation. Paid turns the reservation into a sale
 * (onHand and reserved drop); cancelled releases it (reserved drops). The
 * order's timeline and the audit log are written in the same transaction.
 */
async function settlePendingOrder(number: number, settlement: Settlement, now: Date): Promise<void> {
  const ref = orderRef(number);
  await db().runTransaction(async (tx) => {
    // Firestore transactions: every read before any write.
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    if (order.status !== "pending_payment") throw new OrderNotPendingError(number, order.status);
    const reservations = reservationsOf(number, order);
    const stock = reservations.length > 0 ? await tx.getAll(...reservations.map((r) => inventoryRef(r.sku))) : [];

    const sold = settlement.kind === "paid";
    const stockWrites = reservations.map((r, i) => {
      const doc = stock[i]!;
      const onHand: unknown = doc.get("onHand");
      const reserved: unknown = doc.get("reserved");
      if (!doc.exists || !Number.isInteger(onHand) || !Number.isInteger(reserved) || (reserved as number) < r.quantity || (sold && (onHand as number) < r.quantity)) {
        throw new Error(
          `inventory/${skuDocId(r.sku)} can't ${sold ? "sell" : "release"} ${r.quantity} for order ${number} ` +
            `(exists=${doc.exists}, onHand=${String(onHand)}, reserved=${String(reserved)})`,
        );
      }
      return { ref: doc.ref, onHand: sold ? (onHand as number) - r.quantity : (onHand as number), reserved: (reserved as number) - r.quantity };
    });

    // --- writes ---
    const ts = Timestamp.fromDate(now);
    const actor = { uid: settlement.actor.uid, email: settlement.actor.email };
    const note = settlement.kind === "cancelled" ? settlement.form.note : null;
    for (const w of stockWrites) tx.update(w.ref, { onHand: w.onHand, reserved: w.reserved, updatedAt: ts });
    const timeline = [...(order.timeline as unknown[]), { at: ts, status: settlement.kind, by: "admin", actor, note }];
    if (settlement.kind === "paid") {
      tx.update(ref, { status: "paid", updatedAt: ts, timeline, "payment.status": "confirmed", "payment.confirmedAt": ts, "payment.confirmedBy": actor });
    } else {
      tx.update(ref, { status: "cancelled", updatedAt: ts, timeline, cancellation: { at: ts, reason: settlement.form.reason, note, by: actor } });
    }
    writeAuditInTransaction(
      tx,
      {
        action: sold ? "order.payment_confirmed" : "order.cancelled",
        actor: settlement.actor,
        target: `orders/${number}`,
        details: settlement.kind === "paid" ? { amountCents: order.payment.amountCents, txid: order.payment.txid } : { reason: settlement.form.reason, note },
      },
      now,
    );
  });
}

/** The admin saw the Pix arrive: pending_payment → paid. Requires "orders.confirm_payment". */
export const confirmPixPayment = (number: number, actor: AdminUser, now = new Date()) => settlePendingOrder(number, { kind: "paid", actor }, now);

/** pending_payment → cancelled, stock released. Requires "orders.cancel". */
export const cancelPendingOrder = (number: number, actor: AdminUser, form: CancelForm, now = new Date()) =>
  settlePendingOrder(number, { kind: "cancelled", actor, form }, now);
