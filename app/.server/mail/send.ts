// Sends the e-mail outbox (./outbox.ts) through SMTP (Brevo's relay in production). Run by the scheduled function
// `sendMailOutbox` (server/app.ts) every 2 minutes.
//
// Each due e-mail is claimed in a transaction (pending → sending, with a 10-minute lease), so two runs can't send it
// twice; a run that dies mid-send leaves the lease to expire and the e-mail goes out again (at least once).
// Failures are retried with backoff (2, 4, 8, 16 min); an SMTP 5xx answer (e.g. the address doesn't exist) or a
// rendering error fails at once. E-mails that couldn't go out within 72 hours expire instead of reaching a customer
// days late. Without SMTP configuration nothing is claimed: the e-mails wait and every run logs an error.
import { type DocumentData, Timestamp } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

import { formatHours, whatsappHref } from "~/lib/shell";

import { env } from "../env";
import { db } from "../firebase";
import { toCustomerView } from "../orders";
import { getContent } from "../prismic";
import { isMailTemplate, MAIL_COLLECTION, type MailStatus } from "./outbox";
import { type MailContext, type MailOrder, renderMail } from "./render";

export const MAX_ATTEMPTS = 5;
export const MAX_AGE_MS = 72 * 3_600_000;
export const LEASE_MS = 10 * 60_000;
/** Wait before attempt n + 1 after n failed attempts: 2, 4, 8, 16 minutes. */
export const backoffMs = (attempts: number): number => 2 ** attempts * 60_000;

export interface MailConfig {
  from: string;
  replyTo: string | null;
  host: string;
  port: number;
  user: string;
  password: string;
}

type MailEnv = Pick<ReturnType<typeof env>, "MAIL_FROM" | "MAIL_REPLY_TO" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER">;

/** The SMTP configuration, or null when something is missing (e-mails then wait in the outbox). */
export function mailConfig(password: string | undefined, replyToFallback: string | null = null, vars: MailEnv = env()): MailConfig | null {
  const { MAIL_FROM, MAIL_REPLY_TO, SMTP_HOST, SMTP_PORT, SMTP_USER } = vars;
  const pass = password?.trim();
  if (!MAIL_FROM || !SMTP_USER || !pass || pass === "unset") return null;
  return { from: MAIL_FROM, replyTo: MAIL_REPLY_TO ?? replyToFallback, host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, password: pass };
}

/** nodemailer options: 465 is TLS from the start; on 587/2525 STARTTLS is required, so nothing goes out in clear text. */
export function smtpOptions(config: MailConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  };
}

export interface OutgoingMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface MailTransport {
  sendMail(message: OutgoingMessage): Promise<{ messageId?: string }>;
}

export async function mailContext(): Promise<MailContext> {
  const { settings } = await getContent();
  const { whatsappNumber, whatsappMessage, email } = settings.contact;
  return {
    siteUrl: env().SITE_URL,
    storeName: settings.storeName,
    supportEmail: email,
    whatsappHref: whatsappNumber ? whatsappHref(whatsappNumber, whatsappMessage) : null,
    businessHours: formatHours(settings.contact.hours),
  };
}

/** The order as the e-mails see it, from its stored document. */
export function mailOrderFrom(d: DocumentData): MailOrder {
  const reason: unknown = d.cancellation?.reason ?? null;
  return {
    ...toCustomerView(d),
    linkToken: typeof d.customerLinkToken === "string" ? d.customerLinkToken : null,
    cancellationReason: reason === "payment_not_received" || reason === "customer_request" || reason === "other" ? reason : null,
  };
}

export interface MailRun {
  sent: string[];
  retrying: string[];
  failed: string[];
  expired: string[];
  /** Due e-mails left untouched because SMTP isn't configured. */
  waiting: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 500);
/** SMTP 5xx: the server refused this message for good (unknown mailbox, rejected content). */
const isPermanent = (error: unknown) => {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === "number" && code >= 500 && code < 600;
};

type Claim = { kind: "send"; mail: DocumentData; attempts: number } | { kind: "expired" } | { kind: "failed" } | { kind: "skip" };

export async function sendQueuedMail(options: {
  config: MailConfig | null;
  transport: MailTransport | null;
  context: MailContext;
  now?: Date;
  batch?: number;
}): Promise<MailRun> {
  const now = options.now ?? new Date();
  const run: MailRun = { sent: [], retrying: [], failed: [], expired: [], waiting: 0 };
  const due = await db()
    .collection(MAIL_COLLECTION)
    .where("status", "in", ["pending", "sending"] satisfies MailStatus[])
    .where("nextAttemptAt", "<=", Timestamp.fromDate(now))
    .orderBy("nextAttemptAt")
    .limit(options.batch ?? 25)
    .get();
  if (!options.config || !options.transport) {
    run.waiting = due.size;
    return run;
  }
  const { config, transport, context } = options;

  for (const doc of due.docs) {
    const ts = Timestamp.fromDate(now);
    const claim = await db().runTransaction<Claim>(async (tx) => {
      const snap = await tx.get(doc.ref);
      const m = snap.data();
      if (!m || (m.status !== "pending" && m.status !== "sending") || (m.nextAttemptAt as Timestamp).toMillis() > now.getTime()) return { kind: "skip" };
      if (now.getTime() - (m.createdAt as Timestamp).toMillis() > MAX_AGE_MS) {
        tx.update(doc.ref, { status: "expired", updatedAt: ts, lastError: m.lastError ?? "Não enviado em 72 horas" });
        return { kind: "expired" };
      }
      if ((m.attempts as number) >= MAX_ATTEMPTS) {
        tx.update(doc.ref, { status: "failed", updatedAt: ts });
        return { kind: "failed" };
      }
      const attempts = (m.attempts as number) + 1;
      tx.update(doc.ref, { status: "sending", attempts, nextAttemptAt: Timestamp.fromMillis(now.getTime() + LEASE_MS), updatedAt: ts });
      return { kind: "send", mail: m, attempts };
    });
    if (claim.kind === "skip") continue;
    if (claim.kind === "expired") {
      run.expired.push(doc.id);
      continue;
    }
    if (claim.kind === "failed") {
      run.failed.push(doc.id);
      continue;
    }

    const { mail, attempts } = claim;
    let message: OutgoingMessage;
    try {
      if (!isMailTemplate(mail.template)) throw new Error(`unknown template "${String(mail.template)}"`);
      let order: MailOrder | null = null;
      if (typeof mail.orderNumber === "number") {
        const snap = await db().collection("orders").doc(String(mail.orderNumber)).get();
        if (!snap.exists) throw new Error(`orders/${mail.orderNumber} does not exist`);
        order = mailOrderFrom(snap.data()!);
      }
      const rendered = renderMail(mail.template, (mail.data ?? {}) as Record<string, unknown>, order, context);
      message = { from: config.from, to: mail.to, subject: rendered.subject, html: rendered.html, text: rendered.text, ...(config.replyTo ? { replyTo: config.replyTo } : {}) };
    } catch (error) {
      // A rendering problem is a bug or corrupt data: retrying can't fix it.
      console.error(`[mail] ${doc.id} (${String(mail.template)}) can't be rendered:`, error);
      await doc.ref.update({ status: "failed", lastError: `render: ${errorText(error)}`, updatedAt: Timestamp.now() });
      run.failed.push(doc.id);
      continue;
    }

    try {
      const info = await transport.sendMail(message);
      await doc.ref.update({ status: "sent", sentAt: Timestamp.now(), updatedAt: Timestamp.now(), messageId: info.messageId ?? null, subject: message.subject, lastError: null });
      run.sent.push(doc.id);
    } catch (error) {
      const last = attempts >= MAX_ATTEMPTS || isPermanent(error);
      await doc.ref.update({
        status: last ? "failed" : "pending",
        nextAttemptAt: Timestamp.fromMillis(now.getTime() + backoffMs(attempts)),
        lastError: errorText(error),
        subject: message.subject,
        updatedAt: Timestamp.now(),
      });
      (last ? run.failed : run.retrying).push(doc.id);
      if (last) console.error(`[mail] ${doc.id} (${String(mail.template)}) to order ${String(mail.orderNumber)} failed for good:`, error);
    }
  }
  return run;
}

/** The scheduled run: production configuration, Brevo's SMTP relay. */
export async function runMailOutbox(smtpPassword: string | undefined): Promise<MailRun> {
  const context = await mailContext();
  const config = mailConfig(smtpPassword, context.supportEmail);
  const transport = config ? nodemailer.createTransport(smtpOptions(config)) : null;
  try {
    return await sendQueuedMail({ config, transport, context });
  } finally {
    transport?.close();
  }
}
