// Recording a refund (docs/architecture.md §4.3, §5): the owner returned the
// money through the bank; this writes, in ONE transaction, the refund record,
// the new status (full → "refunded", partial → "partially_refunded"), the units
// that go back on sale, the timeline entry and the audit entry.
// Callers must have passed the admin gate and checked "orders.refund".
import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import { canRefund, REFUND_REASON_LABEL, type RefundInput, restockable, statusAfterRefund } from "~/lib/admin/refunds";
import { type Cents, formatBRL } from "~/lib/money";
import type { OrderStatus } from "~/lib/orders";

import { OrderNotFoundError, orderRef, reservationsOf } from "./admin-orders";
import { writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import { inventoryRef, skuDocId } from "./inventory";
import { rawRefundsOf, refundedCentsOf } from "./order-doc";
import type { AdminUser } from "./session";

/** The refund doesn't fit the order as it is now (status, remaining amount or units — someone changed it, or the request was crafted). */
export class RefundStateError extends Error {
  override name = "RefundStateError";
  constructor(
    readonly number: number,
    readonly status: OrderStatus,
    message: string,
  ) {
    super(message);
  }
}

export interface RecordedRefund {
  status: OrderStatus;
  refundedCents: Cents;
  /** The same form was submitted again (double click): nothing new was written. */
  repeated: boolean;
}

export async function recordRefund(number: number, input: RefundInput, actor: AdminUser, now = new Date()): Promise<RecordedRefund> {
  try {
    return await refundInTransaction(number, input, actor, now);
  } catch (error) {
    if (error instanceof OrderNotFoundError || error instanceof RefundStateError) throw error;
    // A transaction that lost a race doesn't always say so (the emulator closes it: "3 INVALID_ARGUMENT:
    // Transaction is invalid or closed"). The order decides what to report.
    const fresh = (await orderRef(number).get()).data();
    if (fresh) {
      if (rawRefundsOf(fresh).some((r) => r.key === input.key)) return { status: fresh.status, refundedCents: refundedCentsOf(fresh), repeated: true };
      if (!canRefund(fresh.status) || input.amountCents > fresh.payment.amountCents - refundedCentsOf(fresh)) {
        throw new RefundStateError(number, fresh.status, `orders/${number} changed meanwhile (${fresh.status})`);
      }
    }
    throw error;
  }
}

async function refundInTransaction(number: number, input: RefundInput, actor: AdminUser, now: Date): Promise<RecordedRefund> {
  const ref = orderRef(number);
  return db().runTransaction(async (tx) => {
    // Firestore transactions: every read before any write.
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    const refunds = rawRefundsOf(order);
    const before = refundedCentsOf(order);
    if (refunds.some((r) => r.key === input.key)) return { status: order.status, refundedCents: before, repeated: true };

    if (!canRefund(order.status)) throw new RefundStateError(number, order.status, `orders/${number} is ${order.status}: nothing to refund`);
    const paid = order.payment.amountCents as Cents;
    if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > paid - before) {
      throw new RefundStateError(number, order.status, `orders/${number}: a refund of ${input.amountCents} doesn't fit (paid ${paid}, refunded ${before})`);
    }
    const available = restockable(reservationsOf(number, order), refunds as { restock: { sku: string; quantity: number }[] }[]);
    for (const line of input.restock) {
      const max = available.get(line.sku);
      if (max === undefined || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > max) {
        throw new RefundStateError(number, order.status, `orders/${number}: can't put ${line.quantity} × ${line.sku} back on sale (at most ${max ?? 0})`);
      }
    }
    const stock = input.restock.length > 0 ? await tx.getAll(...input.restock.map((l) => inventoryRef(l.sku))) : [];
    const stockWrites = input.restock.map((line, i) => {
      const doc = stock[i]!;
      const onHand: unknown = doc.get("onHand");
      if (!doc.exists || !Number.isInteger(onHand)) {
        throw new Error(`inventory/${skuDocId(line.sku)} can't take back ${line.quantity} for order ${number} (exists=${doc.exists}, onHand=${String(onHand)})`);
      }
      return { ref: doc.ref, onHand: (onHand as number) + line.quantity };
    });

    // --- writes ---
    const ts = Timestamp.fromDate(now);
    const by = { uid: actor.uid, email: actor.email };
    const refundedCents = before + input.amountCents;
    const status = statusAfterRefund(paid, before, input.amountCents);
    for (const w of stockWrites) tx.update(w.ref, { onHand: w.onHand, updatedAt: ts });
    const note = `${formatBRL(input.amountCents)} — ${REFUND_REASON_LABEL[input.reason]}${input.note ? `: ${input.note}` : ""}`;
    tx.update(ref, {
      status,
      updatedAt: ts,
      "payment.refundedCents": refundedCents,
      refunds: [
        ...refunds,
        { id: randomUUID(), key: input.key, at: ts, by, amountCents: input.amountCents, reason: input.reason, note: input.note, restock: input.restock },
      ],
      timeline: [...(order.timeline as unknown[]), { at: ts, status, by: "admin", actor: by, note }],
    });
    writeAuditInTransaction(
      tx,
      {
        action: "order.refunded",
        actor,
        target: `orders/${number}`,
        details: { amountCents: input.amountCents, refundedCents, reason: input.reason, note: input.note, restock: input.restock },
      },
      now,
    );
    return { status, refundedCents, repeated: false };
  });
}
