// Orders as the admin sees them: the list (by status, newest first, paged by
// order number), per-tab counts, one order in full, and the ways a Pix order
// leaves "pending_payment" (docs/architecture.md §4.3):
//   paid      — the admin saw the money arrive; the reservation becomes a sale
//   cancelled — by an admin, or by the expiry job once the Pix deadline passed;
//               the reservation is released and the stock is for sale again
// Admin SDK: callers must have passed the admin gate (app/.server/admin-guard.ts)
// and checked the capability for the action. The expiry job runs on its own
// (server/app.ts, scheduled).
//
// Indexes (firestore.indexes.json; the emulator doesn't enforce them, production does):
//   status == X ordered by number desc   — the admin list tabs
//   status == X, expiresAt <= now, asc  — the expiry job
import { type DocumentData, type Query, Timestamp } from "firebase-admin/firestore";

import { type AdminOrderRow, type AdminOrderView, type CancelForm, ORDER_FILTERS, type OrderFilter } from "~/lib/admin/orders";
import { restockable } from "~/lib/admin/refunds";
import type { OrderStatus } from "~/lib/orders";

import { type SystemActor, writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import { inventoryRef, skuDocId } from "./inventory";
import { queueMailInTransaction } from "./mail/outbox";
import { fulfillmentOf, iso, notesOf, refundedCentsOf, refundsOf } from "./order-doc";
import { readOrderPromotions, releaseRedemptions } from "./promotions";
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

/** The expiry job found an order whose Pix deadline hasn't passed (it is never cancelled early). */
export class OrderNotExpiredError extends Error {
  override name = "OrderNotExpiredError";
  constructor(readonly number: number) {
    super(`orders/${number}'s payment deadline hasn't passed`);
  }
}

export const ORDERS_PAGE_SIZE = 25;

const orders = () => db().collection("orders");

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
    fulfillmentStage: fulfillmentOf(d).stage,
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

export const orderRef = (number: number) => orders().doc(String(number));

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
      refundedCents: refundedCentsOf(d),
      confirmedAt: d.payment.confirmedAt ? iso(d.payment.confirmedAt) : null,
      confirmedBy: d.payment.confirmedBy ?? null,
    },
    cancellation: d.cancellation
      ? { at: iso(d.cancellation.at), reason: d.cancellation.reason, note: d.cancellation.note ?? null, by: d.cancellation.by ?? null }
      : null,
    timeline: (d.timeline as DocumentData[]).map((t) => ({ at: iso(t.at), status: t.status, by: t.by, actor: t.actor ?? null, note: t.note ?? null })),
    fulfillment: fulfillmentOf(d),
    notes: notesOf(d),
    refunds: refundsOf(d),
    restockable: Object.fromEntries(restockable(reservationsOf(d.number, d), refundsOf(d))),
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
export function reservationsOf(number: number, order: DocumentData): Reservation[] {
  const list: unknown = order.reservations;
  const valid =
    Array.isArray(list) &&
    list.every((r) => typeof r?.sku === "string" && Number.isInteger(r?.quantity) && r.quantity > 0) &&
    new Set(list.map((r) => r.sku)).size === list.length;
  if (!valid) throw new Error(`orders/${number} has corrupt reservations: ${JSON.stringify(list)}`);
  return list as Reservation[];
}

/** Who cancels orders whose Pix deadline passed (audit log actor). */
export const PIX_EXPIRY_ACTOR: SystemActor = { type: "system", name: "pix-expiry" };
/** What an automatic cancellation records. */
const EXPIRED: CancelForm = { reason: "payment_not_received", note: "Prazo de pagamento vencido (cancelamento automático)" };

type Settlement =
  | { kind: "paid"; actor: AdminUser }
  | { kind: "cancelled"; actor: AdminUser; form: CancelForm }
  /** The Pix deadline passed: the expiry job cancels the order. */
  | { kind: "expired" };

/**
 * One transaction: the order must still be pending (and, for "expired", past
 * its deadline); each reserved SKU's stock document must cover the
 * reservation. Paid turns the reservation into a sale (onHand and reserved
 * drop); a cancellation releases it (reserved drops). The order's timeline and
 * the audit log are written in the same transaction.
 */
async function settlePendingOrder(number: number, settlement: Settlement, now: Date): Promise<void> {
  try {
    await settleInTransaction(number, settlement, now);
  } catch (error) {
    if (error instanceof OrderNotFoundError || error instanceof OrderNotPendingError || error instanceof OrderNotExpiredError) throw error;
    // A transaction that lost a race doesn't always say so: the emulator closes it ("3 INVALID_ARGUMENT:
    // Transaction is invalid or closed") instead of retrying it into OrderNotPendingError. The order decides.
    const fresh = await orderRef(number).get();
    if (fresh.exists && fresh.get("status") !== "pending_payment") throw new OrderNotPendingError(number, fresh.get("status"));
    throw error;
  }
}

async function settleInTransaction(number: number, settlement: Settlement, now: Date): Promise<void> {
  const ref = orderRef(number);
  await db().runTransaction(async (tx) => {
    // Firestore transactions: every read before any write.
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    if (order.status !== "pending_payment") throw new OrderNotPendingError(number, order.status);
    if (settlement.kind === "expired" && (order.expiresAt as Timestamp).toMillis() > now.getTime()) throw new OrderNotExpiredError(number);
    const reservations = reservationsOf(number, order);
    const stock = reservations.length > 0 ? await tx.getAll(...reservations.map((r) => inventoryRef(r.sku))) : [];
    // A cancelled unpaid order gives back the coupon uses it took (app/.server/promotions.ts).
    const usedPromotions = settlement.kind === "paid" ? [] : await readOrderPromotions(tx, order);

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
    const admin = settlement.kind === "expired" ? null : settlement.actor;
    const actor = admin ? { uid: admin.uid, email: admin.email } : null;
    const cancel = settlement.kind === "cancelled" ? settlement.form : settlement.kind === "expired" ? EXPIRED : null;
    const status: OrderStatus = cancel ? "cancelled" : "paid";
    for (const w of stockWrites) tx.update(w.ref, { onHand: w.onHand, reserved: w.reserved, updatedAt: ts });
    releaseRedemptions(tx, usedPromotions, now);
    const timeline = [...(order.timeline as unknown[]), { at: ts, status, by: admin ? "admin" : "system", actor, note: cancel?.note ?? null }];
    if (cancel) {
      tx.update(ref, { status, updatedAt: ts, timeline, cancellation: { at: ts, reason: cancel.reason, note: cancel.note, by: actor } });
    } else {
      tx.update(ref, { status, updatedAt: ts, timeline, "payment.status": "confirmed", "payment.confirmedAt": ts, "payment.confirmedBy": actor });
    }
    writeAuditInTransaction(
      tx,
      {
        action: cancel ? "order.cancelled" : "order.payment_confirmed",
        actor: admin ?? PIX_EXPIRY_ACTOR,
        target: `orders/${number}`,
        details: cancel ? { reason: cancel.reason, note: cancel.note } : { amountCents: order.payment.amountCents, txid: order.payment.txid },
      },
      now,
    );
    queueMailInTransaction(
      tx,
      cancel
        ? { template: "order_cancelled", to: order.customer.email, orderNumber: number, data: { expired: settlement.kind === "expired" } }
        : { template: "payment_confirmed", to: order.customer.email, orderNumber: number, data: {} },
      now,
    );
  });
}

/** The admin saw the Pix arrive: pending_payment → paid. Requires "orders.confirm_payment". */
export const confirmPixPayment = (number: number, actor: AdminUser, now = new Date()) => settlePendingOrder(number, { kind: "paid", actor }, now);

/** pending_payment → cancelled, stock released. Requires "orders.cancel". */
export const cancelPendingOrder = (number: number, actor: AdminUser, form: CancelForm, now = new Date()) =>
  settlePendingOrder(number, { kind: "cancelled", actor, form }, now);

// --- the Pix expiry job ------------------------------------------------------------------------

/** Orders per run; a fuller backlog continues on the next run. */
export const EXPIRY_BATCH = 100;

export interface ExpiryRun {
  /** Cancelled by this run. */
  expired: number[];
  /** Confirmed or cancelled by someone else between the query and the end of the transaction. */
  skipped: number[];
  failed: { number: number; error: string }[];
  /** More overdue orders than one batch: the next run continues. */
  more: boolean;
}

export class ExpiryRunError extends Error {
  override name = "ExpiryRunError";
  constructor(readonly run: ExpiryRun) {
    super(`Pix expiry: ${run.failed.length} order(s) could not be cancelled: ${run.failed.map((f) => `${f.number} (${f.error})`).join("; ")}`);
  }
}

/**
 * Cancels every order still awaiting payment after its Pix deadline
 * (settings/payment.expiryHours, fixed on the order as `expiresAt`) and
 * releases its stock. Each order is its own transaction — the same one an
 * admin's cancellation uses — so an order an admin confirms at the same moment
 * is settled exactly once. An order that fails (e.g. corrupt stock) doesn't
 * stop the others; the run then throws, listing it, so the failure is logged.
 */
export async function expireOverdueOrders(now = new Date(), batch = EXPIRY_BATCH): Promise<ExpiryRun> {
  const snap = await orders()
    .where("status", "==", "pending_payment")
    .where("expiresAt", "<=", Timestamp.fromDate(now))
    .orderBy("expiresAt")
    .limit(batch + 1) // one extra tells whether more remain
    .get();
  const run: ExpiryRun = { expired: [], skipped: [], failed: [], more: snap.size > batch };
  for (const doc of snap.docs.slice(0, batch)) {
    const number = doc.get("number") as number;
    try {
      await settlePendingOrder(number, { kind: "expired" }, now);
      run.expired.push(number);
    } catch (error) {
      // settlePendingOrder reports a lost race as OrderNotPendingError, whatever the database said.
      if (error instanceof OrderNotPendingError || error instanceof OrderNotExpiredError) run.skipped.push(number);
      else run.failed.push({ number, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (run.failed.length > 0) throw new ExpiryRunError(run);
  return run;
}
