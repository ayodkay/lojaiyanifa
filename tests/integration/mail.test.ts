// The e-mail outbox against the Firestore emulator: each business event queues exactly its e-mail inside its own
// transaction, and the sender claims, renders, sends, retries and expires them as documented in
// app/.server/mail/send.ts. No real SMTP: the transport is a fake that records or fails.

// Set before anything reads the (cached) server configuration: the store's inbox gets new-order notices.
process.env.MAIL_STORE_TO = "loja@exemplo.com";

import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it } from "vitest";

import { cancelPendingOrder, confirmPixPayment, expireOverdueOrders } from "~/.server/admin-orders";
import { db } from "~/.server/firebase";
import { MAIL_COLLECTION } from "~/.server/mail/outbox";
import type { MailContext } from "~/.server/mail/render";
import { type MailConfig, type MailTransport, MAX_ATTEMPTS, type OutgoingMessage, sendQueuedMail } from "~/.server/mail/send";
import { takeFulfillmentStep, updateTracking } from "~/.server/order-fulfillment";
import { recordRefund } from "~/.server/order-refunds";
import { createOrder, getOrderForCustomer, type OrderDeps } from "~/.server/orders";
import type { AdminUser } from "~/.server/session";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const deps: OrderDeps = {
  catalog: catalogOf([catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, prismicStock: 50 })]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: true, address: "Mercadão de Madureira" } }),
};
const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const t0 = new Date("2026-11-04T12:00:00.000Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

const ctx: MailContext = { siteUrl: "https://loja.example", storeName: "Loja Iyanifa", supportEmail: "atendimento@loja.example", whatsappHref: null, businessHours: [] };
const config: MailConfig = { from: "Loja Iyanifa <pedidos@loja.example>", replyTo: "atendimento@loja.example", host: "smtp.test", port: 587, user: "u", password: "p" };

function recorder(fail?: (m: OutgoingMessage, call: number) => Error | null): MailTransport & { sent: OutgoingMessage[] } {
  let calls = 0;
  const sent: OutgoingMessage[] = [];
  return {
    sent,
    async sendMail(message) {
      const error = fail?.(message, ++calls) ?? null;
      if (error) throw error;
      sent.push(message);
      return { messageId: `<msg-${sent.length}@test>` };
    },
  };
}

const order = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: "+5521987654321",
  cpf: "52998224725",
  shippingMethod: "flat_rate",
  address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
  acceptTerms: true, couponCode: null,
  items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }],
  ...overrides,
});

async function outbox() {
  const snap = await db().collection(MAIL_COLLECTION).orderBy("createdAt").get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { template: string; to: string; orderNumber: number; data: Record<string, unknown>; status: string; attempts: number; lastError: string | null; subject: string | null; messageId: string | null; nextAttemptAt: Timestamp }) }));
}
/** Sorted: e-mails queued by one transaction share a timestamp, so their order is Firestore's (document IDs). */
const templates = async () => (await outbox()).map((m) => `${m.template} → ${m.to}`).sort();

describe("e-mails queued by order events", () => {
  beforeEach(clearFirestore);

  it("a new order queues the customer's e-mail and the store's notice — once, even when submitted twice", async () => {
    const input = order();
    await createOrder(input, deps, { now: t0 });
    await createOrder(input, deps, { now: t0 });
    expect(await templates()).toEqual(["order_placed → maria@exemplo.com", "store_new_order → loja@exemplo.com"]);
    const [placed] = await outbox();
    expect(placed).toMatchObject({ orderNumber: 1001, status: "pending", attempts: 0, data: {} });
  });

  it("Pix confirmed, cancelled by the store and cancelled by the expiry job each queue their e-mail", async () => {
    await createOrder(order(), deps, { now: t0 });
    await createOrder(order(), deps, { now: t0 });
    await createOrder(order(), deps, { now: t0 });
    await clearMail();
    await confirmPixPayment(1001, owner, at(1));
    await cancelPendingOrder(1002, owner, { reason: "customer_request", note: null }, at(2));
    await expireOverdueOrders(at(25 * 60));
    const mails = await outbox();
    expect(mails.map((m) => [m.template, m.orderNumber, m.data])).toEqual([
      ["payment_confirmed", 1001, {}],
      ["order_cancelled", 1002, { expired: false }],
      ["order_cancelled", 1003, { expired: true }],
    ]);
  });

  it("shipping, pickup readiness and delivery queue e-mails; preparing doesn't; tracking only when it changes", async () => {
    await createOrder(order(), deps, { now: t0 });
    await createOrder(order({ shippingMethod: "pickup", address: null }), deps, { now: t0 });
    await confirmPixPayment(1001, owner, at(1));
    await confirmPixPayment(1002, owner, at(1));
    await clearMail();

    await takeFulfillmentStep(1001, "processing", null, owner, at(2));
    const tracking = { carrier: "Correios", trackingCode: "AA123456789BR", trackingUrl: "https://rastreio.example/AA123456789BR" };
    await takeFulfillmentStep(1001, "shipped", tracking, owner, at(3));
    await updateTracking(1001, tracking, owner, at(4)); // nothing new
    await updateTracking(1001, { ...tracking, trackingCode: "BB987654321BR" }, owner, at(5));
    await takeFulfillmentStep(1001, "delivered", null, owner, at(6));
    await takeFulfillmentStep(1002, "shipped", null, owner, at(7));

    expect((await outbox()).map((m) => [m.template, m.orderNumber])).toEqual([
      ["order_shipped", 1001],
      ["order_tracking_updated", 1001],
      ["order_delivered", 1001],
      ["order_ready_for_pickup", 1002],
    ]);
  });

  it("a refund queues an e-mail with its amount and the running total; a repeated form submission doesn't", async () => {
    await createOrder(order(), deps, { now: t0 });
    await confirmPixPayment(1001, owner, at(1));
    await clearMail();
    const refund = { key: randomUUID(), amountCents: 1000, reason: "other" as const, note: "teste", restock: [] };
    await recordRefund(1001, refund, owner, at(2));
    await recordRefund(1001, refund, owner, at(3));
    expect((await outbox()).map((m) => [m.template, m.data])).toEqual([["order_refunded", { amountCents: 1000, refundedCents: 1000 }]]);
  });

  it("a failed order creation queues nothing", async () => {
    await expect(createOrder(order({ items: [{ productId: "colar", sku: "COLAR-1", quantity: 51 }] }), deps, { now: t0 })).rejects.toThrow();
    expect(await outbox()).toEqual([]);
  });
});

async function clearMail() {
  const snap = await db().collection(MAIL_COLLECTION).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

describe("sendQueuedMail", () => {
  beforeEach(clearFirestore);

  it("sends what's due, rendered from the order, with a link the order page accepts; a second run sends nothing", async () => {
    await createOrder(order(), deps, { now: t0 });
    const transport = recorder();
    const run = await sendQueuedMail({ config, transport, context: ctx, now: at(1) });
    expect(run.sent).toHaveLength(2);
    // Both were queued at the same moment: their order is Firestore's (document IDs), so look them up by recipient.
    expect(transport.sent.map((m) => [m.to, m.from, m.replyTo]).sort()).toEqual([
      ["loja@exemplo.com", config.from, config.replyTo],
      ["maria@exemplo.com", config.from, config.replyTo],
    ]);
    const toCustomer = transport.sent.find((m) => m.to === "maria@exemplo.com")!;
    expect(toCustomer.subject).toBe("Pedido nº 1001 recebido — pague com Pix para confirmar");
    const link = /https:\/\/loja\.example\/order-confirmation\/1001\?t=([0-9a-f-]+)/.exec(toCustomer.text);
    expect(link).not.toBeNull();
    expect((await getOrderForCustomer(1001, link![1]!))?.number).toBe(1001);

    const mails = await outbox();
    expect(mails.map((m) => [m.status, m.attempts]).sort()).toEqual([
      ["sent", 1],
      ["sent", 1],
    ]);
    expect(mails.map((m) => m.messageId).sort()).toEqual(["<msg-1@test>", "<msg-2@test>"]);
    expect(mails.find((m) => m.to === "maria@exemplo.com")!.subject).toBe(toCustomer.subject);

    expect((await sendQueuedMail({ config, transport, context: ctx, now: at(30) })).sent).toEqual([]);
    expect(transport.sent).toHaveLength(2);
  });

  it("retries a temporary refusal of the e-mail (4xx) with backoff, then gives up after the last attempt", async () => {
    await createOrder(order(), deps, { now: t0 });
    await clearStoreNotice();
    const busy = "Recipient command failed: 450 4.2.1 Mailbox busy";
    const down = recorder(() => Object.assign(new Error(busy), { code: "EENVELOPE", command: "RCPT TO", responseCode: 450 }));
    let now = at(1);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const run = await sendQueuedMail({ config, transport: down, context: ctx, now });
      const [mail] = await outbox();
      if (attempt < MAX_ATTEMPTS) {
        expect(run.retrying).toHaveLength(1);
        expect(mail).toMatchObject({ status: "pending", attempts: attempt, lastError: busy });
        expect(mail!.nextAttemptAt.toMillis() - now.getTime()).toBe(2 ** attempt * 60_000);
        // Not due yet: a run right away leaves it alone.
        expect((await sendQueuedMail({ config, transport: down, context: ctx, now })).retrying).toEqual([]);
        now = new Date(mail!.nextAttemptAt.toMillis());
      } else {
        expect(run.failed).toHaveLength(1);
        expect(mail).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
      }
    }
  });

  it("fails at once when the SMTP server refuses the e-mail's recipient for good (5xx)", async () => {
    await createOrder(order(), deps, { now: t0 });
    await clearStoreNotice();
    const unknown = "Recipient command failed: 550 5.1.1 mailbox unavailable";
    const refusing = recorder(() => Object.assign(new Error(unknown), { code: "EENVELOPE", command: "RCPT TO", responseCode: 550 }));
    expect((await sendQueuedMail({ config, transport: refusing, context: ctx, now: at(1) })).failed).toHaveLength(1);
    expect((await outbox())[0]).toMatchObject({ status: "failed", attempts: 1, lastError: unknown });
  });

  it("a refused login isn't the e-mails' fault: no attempt is used, the run stops, and they go out once it's fixed", async () => {
    await createOrder(order(), deps, { now: t0 });
    const reason = "Invalid login: 525 5.7.1 Unauthorized IP address";
    let tries = 0;
    const blocked = recorder(() => {
      tries++;
      return Object.assign(new Error(reason), { code: "EAUTH", command: "AUTH PLAIN", responseCode: 525 });
    });
    expect(await sendQueuedMail({ config, transport: blocked, context: ctx, now: at(1) })).toEqual({ sent: [], retrying: [], failed: [], expired: [], waiting: 2, blocked: reason });
    expect(tries).toBe(1); // the run stopped: the other e-mail would have met the same refusal
    // An hour-long outage, a run every 2 minutes: at most one try per run, and no e-mail is charged an attempt.
    for (let minute = 3; minute <= 61; minute += 2) {
      const before = tries;
      await sendQueuedMail({ config, transport: blocked, context: ctx, now: at(minute) });
      expect(tries - before).toBeLessThanOrEqual(1);
    }
    expect((await outbox()).map((m) => [m.status, m.attempts, m.lastError])).toEqual([
      ["pending", 0, reason],
      ["pending", 0, reason],
    ]);
    // Fixed (e.g. the IP authorized in Brevo): both go out within the next few runs.
    const transport = recorder();
    for (let minute = 63; minute <= 71; minute += 2) await sendQueuedMail({ config, transport, context: ctx, now: at(minute) });
    expect(transport.sent).toHaveLength(2);
    expect((await outbox()).map((m) => [m.status, m.attempts])).toEqual([
      ["sent", 1],
      ["sent", 1],
    ]);
  });

  it("without SMTP configuration claims nothing: the e-mails wait, counted", async () => {
    await createOrder(order(), deps, { now: t0 });
    const run = await sendQueuedMail({ config: null, transport: null, context: ctx, now: at(1) });
    expect(run).toEqual({ sent: [], retrying: [], failed: [], expired: [], waiting: 2, blocked: null });
    expect((await outbox()).map((m) => [m.status, m.attempts])).toEqual([
      ["pending", 0],
      ["pending", 0],
    ]);
  });

  it("lets e-mails older than 72 hours expire instead of sending them late", async () => {
    await createOrder(order(), deps, { now: t0 });
    const transport = recorder();
    const run = await sendQueuedMail({ config, transport, context: ctx, now: at(72 * 60 + 1) });
    expect(run.expired).toHaveLength(2);
    expect(transport.sent).toEqual([]);
    expect((await outbox()).every((m) => m.status === "expired")).toBe(true);
  });

  it("an e-mail that can't be rendered (its order is gone) fails at once and doesn't stop the others", async () => {
    await createOrder(order(), deps, { now: t0 });
    await db().collection(MAIL_COLLECTION).doc("orfa").set({
      template: "payment_confirmed", to: "x@exemplo.com", orderNumber: 4242, data: {}, status: "pending", attempts: 0,
      createdAt: Timestamp.fromDate(t0), updatedAt: Timestamp.fromDate(t0), nextAttemptAt: Timestamp.fromDate(t0), lastError: null, sentAt: null, messageId: null, subject: null,
    });
    const transport = recorder();
    const run = await sendQueuedMail({ config, transport, context: ctx, now: at(1) });
    expect(run.failed).toEqual(["orfa"]);
    expect(run.sent).toHaveLength(2);
    expect((await db().collection(MAIL_COLLECTION).doc("orfa").get()).get("lastError")).toBe("render: orders/4242 does not exist");
  });
});

async function clearStoreNotice() {
  const snap = await db().collection(MAIL_COLLECTION).where("template", "==", "store_new_order").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}
