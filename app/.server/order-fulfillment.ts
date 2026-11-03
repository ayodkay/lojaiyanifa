// Preparing, shipping and handing over paid orders, tracking codes, and
// internal notes (docs/architecture.md §4.3). Each change is ONE transaction:
// re-read the order, check the change is allowed from its current state
// (another admin may have moved it meanwhile), write the order — timeline
// included — and the audit entry. No stock moves here: the sale was booked
// when the payment was confirmed.
// Callers must have passed the admin gate and checked "orders.fulfill" /
// "orders.add_note".
import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";

import { NOTES_PER_ORDER_MAX, type TrackingInput } from "~/lib/admin/fulfillment";
import { canEditTracking, canTakeStep, type FulfillmentStage, type FulfillmentStep, type OrderStatus, statusAfterStep } from "~/lib/orders";

import { OrderNotFoundError, orderRef } from "./admin-orders";
import { writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import { rawFulfillmentOf, rawNotesOf } from "./order-doc";
import type { AdminUser } from "./session";

/** The order's state doesn't allow the change (someone else changed it first, or the request was crafted). */
export class OrderStateError extends Error {
  override name = "OrderStateError";
  constructor(
    readonly number: number,
    readonly status: OrderStatus,
    readonly stage: FulfillmentStage,
    message: string,
  ) {
    super(message);
  }
}

/** The order already holds NOTES_PER_ORDER_MAX notes. */
export class NotesLimitError extends Error {
  override name = "NotesLimitError";
}

const trackingNote = (t: TrackingInput | null): string | null => (t ? [t.carrier, t.trackingCode].filter(Boolean).join(" · ") || null : null);

/** paid → processing → shipped (or ready for pickup) → delivered (or picked up); forward only, "processing" may be skipped. */
export async function takeFulfillmentStep(number: number, step: FulfillmentStep, tracking: TrackingInput | null, actor: AdminUser, now = new Date()): Promise<void> {
  try {
    await stepInTransaction(number, step, tracking, actor, now);
  } catch (error) {
    if (error instanceof OrderNotFoundError || error instanceof OrderStateError) throw error;
    // A transaction that lost a race doesn't always say so (the emulator closes it: "3 INVALID_ARGUMENT:
    // Transaction is invalid or closed"). If the order moved meanwhile so the step no longer applies, say that.
    const fresh = (await orderRef(number).get()).data();
    if (fresh) {
      const stage = rawFulfillmentOf(fresh).stage as FulfillmentStage;
      if (!canTakeStep(fresh.status, stage, step)) throw new OrderStateError(number, fresh.status, stage, `orders/${number} changed meanwhile (${fresh.status}, ${stage})`);
    }
    throw error;
  }
}

async function stepInTransaction(number: number, step: FulfillmentStep, tracking: TrackingInput | null, actor: AdminUser, now: Date): Promise<void> {
  const ref = orderRef(number);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    const fulfillment = rawFulfillmentOf(order);
    const stage = fulfillment.stage as FulfillmentStage;
    if (!canTakeStep(order.status, stage, step)) {
      throw new OrderStateError(number, order.status, stage, `orders/${number} (${order.status}, ${stage}) can't move to ${step}`);
    }

    const ts = Timestamp.fromDate(now);
    const by = { uid: actor.uid, email: actor.email };
    tx.update(ref, {
      status: statusAfterStep(order.status, step),
      updatedAt: ts,
      fulfillment: { ...fulfillment, stage: step, [`${step}At`]: ts, ...(tracking ?? {}) },
      timeline: [...(order.timeline as unknown[]), { at: ts, status: step, by: "admin", actor: by, note: trackingNote(tracking) }],
    });
    writeAuditInTransaction(tx, { action: "order.fulfillment_updated", actor, target: `orders/${number}`, details: { step, ...(tracking ?? {}) } }, now);
  });
}

/** Fills in or corrects the carrier, tracking code and link of an order that has left. */
export async function updateTracking(number: number, tracking: TrackingInput, actor: AdminUser, now = new Date()): Promise<void> {
  const ref = orderRef(number);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    const fulfillment = rawFulfillmentOf(order);
    const stage = fulfillment.stage as FulfillmentStage;
    if (!canEditTracking(order.status, stage)) {
      throw new OrderStateError(number, order.status, stage, `orders/${number} (${order.status}, ${stage}) has no shipment to track`);
    }
    const ts = Timestamp.fromDate(now);
    tx.update(ref, { updatedAt: ts, fulfillment: { ...fulfillment, ...tracking } });
    writeAuditInTransaction(tx, { action: "order.tracking_updated", actor, target: `orders/${number}`, details: { ...tracking } }, now);
  });
}

/** Adds an internal note (never shown to the customer). Notes can't be edited or deleted. */
export async function addOrderNote(number: number, text: string, actor: AdminUser, now = new Date()): Promise<string> {
  const ref = orderRef(number);
  const id = randomUUID();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new OrderNotFoundError(`orders/${number} does not exist`);
    const order = snap.data()!;
    const notes = rawNotesOf(order);
    if (notes.length >= NOTES_PER_ORDER_MAX) throw new NotesLimitError(`orders/${number} already has ${notes.length} notes`);
    const ts = Timestamp.fromDate(now);
    tx.update(ref, { notes: [...notes, { id, at: ts, by: { uid: actor.uid, email: actor.email }, text }] });
    writeAuditInTransaction(tx, { action: "order.note_added", actor, target: `orders/${number}`, details: { noteId: id } }, now);
  });
  return id;
}
