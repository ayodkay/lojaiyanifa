// Audit log: who did what, when (docs/architecture.md §4.2 `auditLogs`).
// Order actions write their entry inside the same transaction as the change,
// so a change can never happen without its record (or the reverse).
import { Timestamp, type Transaction } from "firebase-admin/firestore";

import type { AdminRole } from "~/lib/admin/roles";

import { db } from "./firebase";

export type AuditAction =
  | "admin.signed_in"
  | "admin.signed_out"
  | "order.payment_confirmed"
  | "order.cancelled"
  | "order.fulfillment_updated"
  | "order.tracking_updated"
  | "order.note_added"
  | "order.refunded"
  | "settings.payment_updated"
  | "settings.shipping_updated"
  | "settings.checkout_opened"
  | "settings.checkout_closed"
  // Support tickets (the team's answers and status changes).
  | "ticket.replied"
  | "ticket.closed"
  | "ticket.reopened"
  // LGPD requests made by customers themselves (no personal data in the entry: the UID only).
  | "customer.data_exported"
  | "customer.account_deleted";

/** A signed-in admin. */
export interface AuditActor {
  uid: string;
  email: string;
  role: AdminRole;
}

/** The store acting on its own (a scheduled job). Scripts write `{ type: "script", name, by }` themselves. */
export interface SystemActor {
  type: "system";
  name: string;
}

/** A customer acting on their own account; `name` is the Auth UID. */
export interface CustomerActor {
  type: "customer";
  name: string;
}

export interface AuditEntry {
  action: AuditAction;
  actor: AuditActor | SystemActor | CustomerActor;
  /** Document path the action is about, e.g. "orders/1001" or "users/<uid>". */
  target: string;
  details?: Record<string, unknown>;
}

const AUDIT_LOGS = "auditLogs";

const record = (entry: AuditEntry, at: Date) => ({
  at: Timestamp.fromDate(at),
  action: entry.action,
  actor: "type" in entry.actor
    ? { type: entry.actor.type, name: entry.actor.name }
    : { uid: entry.actor.uid, email: entry.actor.email, role: entry.actor.role },
  target: entry.target,
  details: entry.details ?? {},
});

export async function writeAudit(entry: AuditEntry, at = new Date()): Promise<void> {
  await db().collection(AUDIT_LOGS).doc().create(record(entry, at));
}

export function writeAuditInTransaction(tx: Transaction, entry: AuditEntry, at: Date): void {
  tx.create(db().collection(AUDIT_LOGS).doc(), record(entry, at));
}
