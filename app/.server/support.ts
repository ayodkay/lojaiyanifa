// Support tickets (docs/architecture.md §4.2 `tickets`): the contact form creates one, the team answers in
// /admin/support, the customer reads them in /account/support. Each change is one transaction with its e-mails
// (app/.server/mail) and, for the team's actions, an audit entry.
//
// Creation answers at once with an automatic e-mail carrying the protocol number (Decreto 7.962/2013, art. 4, VI:
// immediate confirmation; art. 5, §4: immediate confirmation of a withdrawal request).
//
// Abuse: hourly limits per client IP (hashed with the hour, never stored raw), per e-mail and for the whole store, in
// `rateLimits/{key}` (with `expiresAt`, for a Firestore TTL policy). Speed bumps only: Cloudflare is the real guard.
import { createHash, randomUUID } from "node:crypto";

import { type DocumentData, type Query, Timestamp } from "firebase-admin/firestore";

import { type ContactInput, REPLY_MAX, type TicketStatus, type TicketTopic } from "~/lib/support";

import { writeAuditInTransaction } from "./audit";
import type { CustomerUser } from "./customer-session";
import { db } from "./firebase";
import { queueMailInTransaction } from "./mail/outbox";
import { iso } from "./order-doc";
import type { AdminUser } from "./session";

export const FIRST_TICKET_NUMBER = 1001;
export const TICKETS_PAGE_SIZE = 25;
export const MAX_MESSAGES = 100;
export const RATE_LIMITS = { perIp: 5, perEmail: 5, global: 60 } as const;

const tickets = () => db().collection("tickets");
export const ticketRef = (number: number) => tickets().doc(String(number));
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export class RateLimitError extends Error {
  override name = "RateLimitError";
}

export class TicketNotFoundError extends Error {
  override name = "TicketNotFoundError";
}

export class TicketStateError extends Error {
  override name = "TicketStateError";
}

export interface TicketMessage {
  id: string;
  at: string;
  from: "customer" | "store";
  text: string;
}

export interface TicketView {
  number: number;
  status: TicketStatus;
  topic: TicketTopic;
  name: string;
  email: string;
  phone: string | null;
  orderNumber: number | null;
  customerUid: string | null;
  returnRequest: { reason: string; preference: string; items: string | null } | null;
  messages: TicketMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketRow {
  number: number;
  status: TicketStatus;
  topic: TicketTopic;
  name: string;
  email: string;
  orderNumber: number | null;
  createdAt: string;
  lastMessageAt: string;
  lastFrom: "customer" | "store";
}

function toView(d: DocumentData): TicketView {
  return {
    number: d.number,
    status: d.status,
    topic: d.topic,
    name: d.name,
    email: d.email,
    phone: d.phone ?? null,
    orderNumber: d.orderNumber ?? null,
    customerUid: d.customerUid ?? null,
    returnRequest: d.returnRequest ?? null,
    messages: (d.messages as DocumentData[]).map((m) => ({ id: m.id, at: iso(m.at), from: m.from, text: m.text })),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

function toRow(d: DocumentData): TicketRow {
  const last = (d.messages as DocumentData[]).at(-1)!;
  return {
    number: d.number,
    status: d.status,
    topic: d.topic,
    name: d.name,
    email: d.email,
    orderNumber: d.orderNumber ?? null,
    createdAt: iso(d.createdAt),
    lastMessageAt: iso(last.at),
    lastFrom: last.from,
  };
}

// --- creation (the contact form) ----------------------------------------------------------------

export interface TicketOptions {
  /** The signed-in customer, if any (their tickets show in Minha conta). */
  uid?: string | null;
  /** The visitor's IP, only for the hourly limit (hashed with the hour). */
  clientIp?: string | null;
  /** The store's inbox for the notice (MAIL_STORE_TO, else the support e-mail in Prismic). */
  storeInbox?: string | null;
  now?: Date;
}

export async function createTicket(input: ContactInput, options: TicketOptions = {}): Promise<{ number: number }> {
  const now = options.now ?? new Date();
  const hour = Math.floor(now.getTime() / 3_600_000);
  const expiresAt = Timestamp.fromMillis((hour + 2) * 3_600_000);
  const limits = [
    ...(options.clientIp ? [{ ref: db().collection("rateLimits").doc(`contact-ip-${sha256(`${options.clientIp}|${hour}`)}`), max: RATE_LIMITS.perIp }] : []),
    { ref: db().collection("rateLimits").doc(`contact-email-${sha256(`${input.email}|${hour}`)}`), max: RATE_LIMITS.perEmail },
    { ref: db().collection("rateLimits").doc(`contact-all-${hour}`), max: RATE_LIMITS.global },
  ];
  const counterRef = db().collection("counters").doc("tickets");

  return db().runTransaction(async (tx) => {
    const [counter, ...used] = await tx.getAll(counterRef, ...limits.map((l) => l.ref));
    limits.forEach((limit, i) => {
      if (((used[i]!.get("count") as number | undefined) ?? 0) >= limit.max) throw new RateLimitError(`contact form limit reached (${limit.ref.id.split("-").slice(0, 2).join("-")})`);
    });
    const number = counter!.exists ? (counter!.get("next") as unknown) : FIRST_TICKET_NUMBER;
    if (typeof number !== "number" || !Number.isInteger(number) || number < FIRST_TICKET_NUMBER) throw new Error(`counters/tickets is corrupt (next=${String(number)})`);

    const ts = Timestamp.fromDate(now);
    limits.forEach((limit, i) => tx.set(limit.ref, { count: ((used[i]!.get("count") as number | undefined) ?? 0) + 1, expiresAt }));
    const returnRequest =
      input.topic === "returns" && input.returnReason && input.returnPreference
        ? { reason: input.returnReason, preference: input.returnPreference, items: input.returnItems }
        : null;
    tx.create(ticketRef(number), {
      number,
      status: "open" satisfies TicketStatus,
      topic: input.topic,
      name: input.name,
      email: input.email,
      phone: input.phone,
      orderNumber: input.orderNumber,
      customerUid: options.uid ?? null,
      returnRequest,
      messages: [{ id: randomUUID(), at: ts, from: "customer", text: input.message }],
      createdAt: ts,
      updatedAt: ts,
      lastMessageAt: ts,
    });
    tx.set(counterRef, { next: number + 1 }, { merge: true });

    const common = { number, topic: input.topic, orderNumber: input.orderNumber, returnReason: returnRequest?.reason ?? null };
    queueMailInTransaction(tx, { template: "ticket_received", to: input.email, orderNumber: null, data: { ...common, name: input.name, message: input.message } }, now);
    if (options.storeInbox) {
      queueMailInTransaction(
        tx,
        {
          template: "store_new_ticket",
          to: options.storeInbox,
          orderNumber: null,
          data: { ...common, name: input.name, email: input.email, phone: input.phone, message: input.message, returnPreference: returnRequest?.preference ?? null, returnItems: returnRequest?.items ?? null },
        },
        now,
      );
    }
    return { number };
  });
}

// --- the team (/admin/support) --------------------------------------------------------------------

export type TicketFilter = TicketStatus;

export async function listTickets(status: TicketFilter, before: number | null, pageSize = TICKETS_PAGE_SIZE): Promise<{ rows: TicketRow[]; nextBefore: number | null }> {
  let query: Query = tickets().where("status", "==", status).orderBy("number", "desc");
  if (before !== null) query = query.startAfter(before);
  const snap = await query.limit(pageSize + 1).get();
  const page = snap.docs.slice(0, pageSize);
  return { rows: page.map((d) => toRow(d.data())), nextBefore: snap.size > pageSize ? (page.at(-1)!.get("number") as number) : null };
}

export async function countTickets(): Promise<Record<TicketStatus, number>> {
  const statuses: TicketStatus[] = ["open", "answered", "closed"];
  const counts = await Promise.all(statuses.map((s) => tickets().where("status", "==", s).count().get()));
  return Object.fromEntries(statuses.map((s, i) => [s, counts[i]!.data().count])) as Record<TicketStatus, number>;
}

export async function getTicket(number: number): Promise<TicketView | null> {
  if (!Number.isInteger(number) || number < 1) return null;
  const d = (await ticketRef(number).get()).data();
  return d ? toView(d) : null;
}

/** The team answers: the message joins the thread and goes to the customer by e-mail. */
export async function replyToTicket(number: number, text: string, actor: AdminUser, now = new Date()): Promise<void> {
  const reply = text.trim();
  if (!reply || reply.length > REPLY_MAX) throw new TicketStateError(`a reply must have 1 to ${REPLY_MAX} characters`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef(number));
    if (!snap.exists) throw new TicketNotFoundError(`tickets/${number} does not exist`);
    const d = snap.data()!;
    if ((d.messages as unknown[]).length >= MAX_MESSAGES) throw new TicketStateError(`tickets/${number} has ${MAX_MESSAGES} messages; open a new one`);
    const ts = Timestamp.fromDate(now);
    tx.update(snap.ref, {
      status: "answered" satisfies TicketStatus,
      updatedAt: ts,
      lastMessageAt: ts,
      messages: [...(d.messages as unknown[]), { id: randomUUID(), at: ts, from: "store", text: reply, by: { uid: actor.uid, email: actor.email } }],
    });
    queueMailInTransaction(tx, { template: "ticket_reply", to: d.email, orderNumber: null, data: { number, topic: d.topic, name: d.name, reply } }, now);
    writeAuditInTransaction(tx, { action: "ticket.replied", actor, target: `tickets/${number}`, details: { length: reply.length } }, now);
  });
}

/** Closes a ticket, or opens it again. */
export async function setTicketStatus(number: number, status: "open" | "closed", actor: AdminUser, now = new Date()): Promise<void> {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef(number));
    if (!snap.exists) throw new TicketNotFoundError(`tickets/${number} does not exist`);
    if (snap.get("status") === status) return; // already so (double click, another tab)
    tx.update(snap.ref, { status, updatedAt: Timestamp.fromDate(now) });
    writeAuditInTransaction(tx, { action: status === "closed" ? "ticket.closed" : "ticket.reopened", actor, target: `tickets/${number}` }, now);
  });
}

// --- the customer (/account/support) --------------------------------------------------------------

/** Like orders: tickets sent signed in, plus — once the e-mail is verified — those sent with the same e-mail. */
export function ownsTicket(user: CustomerUser, d: DocumentData): boolean {
  if (d.customerUid === user.uid) return true;
  return user.emailVerified && typeof d.email === "string" && d.email.toLowerCase() === user.email;
}

export async function listCustomerTickets(user: CustomerUser): Promise<TicketRow[]> {
  const [byUid, byEmail] = await Promise.all([
    tickets().where("customerUid", "==", user.uid).limit(200).get(),
    user.emailVerified ? tickets().where("email", "==", user.email).limit(200).get() : null,
  ]);
  const found = new Map<number, DocumentData>();
  for (const doc of [...byUid.docs, ...(byEmail?.docs ?? [])]) if (ownsTicket(user, doc.data())) found.set(doc.get("number") as number, doc.data());
  return [...found.values()].sort((a, b) => b.number - a.number).map(toRow);
}

export async function getCustomerTicket(user: CustomerUser, number: number): Promise<TicketView | null> {
  if (!Number.isInteger(number) || number < 1) return null;
  const d = (await ticketRef(number).get()).data();
  return d && ownsTicket(user, d) ? toView(d) : null;
}
