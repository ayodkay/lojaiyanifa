// The e-mail outbox (docs/architecture.md §7). A business event writes a small `mail/{id}` document in the SAME
// transaction as the change it reports, so an e-mail can never be lost or announced for a change that didn't happen.
// The scheduled sender (./send.ts) renders and sends it later, retrying on failure.
import { Timestamp, type Transaction } from "firebase-admin/firestore";

import { db } from "../firebase";

export const MAIL_COLLECTION = "mail";

export const MAIL_TEMPLATES = [
  "order_placed",
  "store_new_order",
  "payment_confirmed",
  "order_shipped",
  "order_ready_for_pickup",
  "order_delivered",
  "order_cancelled",
  "order_refunded",
  "order_tracking_updated",
  // Not about an order: everything they show is in `data`.
  "welcome",
  "ticket_received",
  "store_new_ticket",
  "ticket_reply",
] as const;
export type MailTemplate = (typeof MAIL_TEMPLATES)[number];

export const isMailTemplate = (value: unknown): value is MailTemplate =>
  typeof value === "string" && (MAIL_TEMPLATES as readonly string[]).includes(value);

export type MailStatus = "pending" | "sending" | "sent" | "failed" | "expired";

export interface QueuedMail {
  template: MailTemplate;
  to: string;
  /** The order the e-mail is about; the sender reads it when rendering. */
  orderNumber: number | null;
  /** What the event knew that the order alone doesn't tell (e.g. the amount of this refund). JSON values only. */
  data: Record<string, string | number | boolean | null>;
}

/** Adds an e-mail to the outbox as part of `tx` (call it after the transaction's reads). */
export function queueMailInTransaction(tx: Transaction, mail: QueuedMail, now: Date): void {
  const ts = Timestamp.fromDate(now);
  tx.create(db().collection(MAIL_COLLECTION).doc(), {
    template: mail.template,
    to: mail.to,
    orderNumber: mail.orderNumber,
    data: mail.data,
    status: "pending" satisfies MailStatus,
    attempts: 0,
    createdAt: ts,
    updatedAt: ts,
    nextAttemptAt: ts,
    lastError: null,
    sentAt: null,
    messageId: null,
    subject: null,
  });
}
