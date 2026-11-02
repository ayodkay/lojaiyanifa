// Audit log: who did what, when (docs/architecture.md §4.2 `auditLogs`).
// Order actions write their entry inside the same transaction as the change,
// so a change can never happen without its record (or the reverse).
import { Timestamp, type Transaction } from "firebase-admin/firestore";

import type { AdminRole } from "~/lib/admin/roles";

import { db } from "./firebase";

export type AuditAction = "admin.signed_in" | "admin.signed_out" | "order.payment_confirmed" | "order.cancelled";

export interface AuditActor {
  uid: string;
  email: string;
  role: AdminRole;
}

export interface AuditEntry {
  action: AuditAction;
  actor: AuditActor;
  /** Document path the action is about, e.g. "orders/1001" or "users/<uid>". */
  target: string;
  details?: Record<string, unknown>;
}

const AUDIT_LOGS = "auditLogs";

const record = (entry: AuditEntry, at: Date) => ({
  at: Timestamp.fromDate(at),
  action: entry.action,
  actor: { uid: entry.actor.uid, email: entry.actor.email, role: entry.actor.role },
  target: entry.target,
  details: entry.details ?? {},
});

export async function writeAudit(entry: AuditEntry, at = new Date()): Promise<void> {
  await db().collection(AUDIT_LOGS).doc().create(record(entry, at));
}

export function writeAuditInTransaction(tx: Transaction, entry: AuditEntry, at: Date): void {
  tx.create(db().collection(AUDIT_LOGS).doc(), record(entry, at));
}
