import { randomUUID } from "node:crypto";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmPixPayment, getOrderForAdmin } from "~/.server/admin-orders";
import { db } from "~/.server/firebase";
import { addOrderNote, NotesLimitError, OrderStateError, takeFulfillmentStep, updateTracking } from "~/.server/order-fulfillment";
import { createOrder, getOrderForCustomer, type OrderDeps } from "~/.server/orders";
import type { AdminUser } from "~/.server/session";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const deps: OrderDeps = {
  catalog: catalogOf([catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, prismicStock: 50 })]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({
    flatRate: { enabled: true, priceCents: 2500 },
    pickup: { enabled: true, address: "Mercadão de Madureira – Anexo, Galeria K" },
  }),
};

const ADDRESS = { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" as const };

const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: "+5521987654321",
  cpf: "52998224725",
  shippingMethod: "flat_rate",
  address: ADDRESS,
  acceptTerms: true, couponCode: null,
  items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }],
  ...overrides,
});

const staff: AdminUser = { uid: "uid-equipe", email: "equipe@example.com", role: "staff" };
const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const t0 = new Date("2026-11-02T12:00:00.000Z");
const at = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);

/** A paid order, ready to be prepared; `accessToken` opens the customer's page. */
async function paidOrder(overrides: Partial<CheckoutInput> = {}): Promise<{ number: number; accessToken: string }> {
  const { number, accessToken } = await createOrder(checkout(overrides), deps, { now: t0 });
  await confirmPixPayment(number, owner, at(1));
  return { number, accessToken };
}

const auditOf = async (action: string) =>
  (await db().collection("auditLogs").where("action", "==", action).orderBy("at").get()).docs.map((d) => ({
    target: d.get("target"),
    actor: d.get("actor").email,
    details: d.get("details"),
  }));

describe("fulfilment", () => {
  beforeEach(clearFirestore);

  it("walks a delivery order through preparing, shipping (with tracking) and delivery, keeping each date and step", async () => {
    const { number, accessToken } = await paidOrder();
    const tracking = { carrier: "Correios", trackingCode: "AA123456789BR", trackingUrl: "https://rastreamento.example.com/AA123456789BR" };

    await takeFulfillmentStep(number, "processing", null, staff, at(2));
    expect((await getOrderForAdmin(number))!.status).toBe("processing");
    await takeFulfillmentStep(number, "shipped", tracking, staff, at(3));
    await takeFulfillmentStep(number, "delivered", null, staff, at(50));

    const order = (await getOrderForAdmin(number))!;
    expect(order.status).toBe("delivered");
    expect(order.updatedAt).toBe(at(50).toISOString());
    expect(order.fulfillment).toEqual({
      stage: "delivered",
      ...tracking,
      processingAt: at(2).toISOString(),
      shippedAt: at(3).toISOString(),
      deliveredAt: at(50).toISOString(),
    });
    expect(order.timeline.map((t) => [t.status, t.by, t.actor?.email ?? null, t.note])).toEqual([
      ["pending_payment", "customer", null, null],
      ["paid", "admin", "dono@example.com", null],
      ["processing", "admin", "equipe@example.com", null],
      ["shipped", "admin", "equipe@example.com", "Correios · AA123456789BR"],
      ["delivered", "admin", "equipe@example.com", null],
    ]);
    expect(await auditOf("order.fulfillment_updated")).toEqual([
      { target: `orders/${number}`, actor: "equipe@example.com", details: { step: "processing" } },
      { target: `orders/${number}`, actor: "equipe@example.com", details: { step: "shipped", ...tracking } },
      { target: `orders/${number}`, actor: "equipe@example.com", details: { step: "delivered" } },
    ]);
    // The customer's page shows the same progress and tracking.
    expect((await getOrderForCustomer(number, accessToken))!.fulfillment).toEqual(order.fulfillment);
  });

  it("may skip preparing, and hands a pickup order over at the counter straight from paid", async () => {
    const delivery = (await paidOrder()).number;
    const pickup = (await paidOrder({ shippingMethod: "pickup", address: null })).number;

    await takeFulfillmentStep(delivery, "shipped", { carrier: "Motoboy", trackingCode: null, trackingUrl: null }, staff, at(2));
    await takeFulfillmentStep(pickup, "delivered", null, staff, at(2));

    expect((await getOrderForAdmin(delivery))!.fulfillment).toMatchObject({ stage: "shipped", carrier: "Motoboy", processingAt: null, shippedAt: at(2).toISOString() });
    expect((await getOrderForAdmin(pickup))!).toMatchObject({ status: "delivered", fulfillment: { stage: "delivered", shippedAt: null, deliveredAt: at(2).toISOString() } });
  });

  it("refuses steps that repeat, go back, come before payment or after cancellation — and writes nothing", async () => {
    const shipped = (await paidOrder()).number;
    await takeFulfillmentStep(shipped, "shipped", null, staff, at(2));
    const unpaid = (await createOrder(checkout(), deps, { now: t0 })).number;
    const cancelled = (await createOrder(checkout(), deps, { now: t0 })).number;
    await db().doc(`orders/${cancelled}`).update({ status: "cancelled" });
    const before = (await db().doc(`orders/${shipped}`).get()).data();
    const audits = (await db().collection("auditLogs").get()).size;

    for (const [number, step] of [[shipped, "shipped"], [shipped, "processing"], [unpaid, "processing"], [cancelled, "shipped"]] as const) {
      await expect(takeFulfillmentStep(number, step, null, staff, at(3))).rejects.toBeInstanceOf(OrderStateError);
    }
    await expect(takeFulfillmentStep(9999, "processing", null, staff)).rejects.toMatchObject({ name: "OrderNotFoundError" });

    expect((await db().doc(`orders/${shipped}`).get()).data()).toEqual(before);
    expect((await getOrderForAdmin(unpaid))!.status).toBe("pending_payment");
    expect((await db().collection("auditLogs").get()).size).toBe(audits);
  });

  it("reports a step lost to a race as a state change even when the database only says the transaction was closed", async () => {
    const { number } = await paidOrder();
    const spy = vi.spyOn(db(), "runTransaction").mockImplementationOnce(async () => {
      await takeFulfillmentStep(number, "shipped", null, owner, at(2)); // the winner (runs for real)
      throw Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed."), { code: 3 });
    });

    await expect(takeFulfillmentStep(number, "shipped", null, staff, at(2))).rejects.toBeInstanceOf(OrderStateError);
    spy.mockRestore();
    // …but a step that still applies after the other change passes the database's error on.
    vi.spyOn(db(), "runTransaction").mockRejectedValueOnce(new Error("14 UNAVAILABLE: connection reset"));
    await expect(takeFulfillmentStep(number, "delivered", null, staff, at(3))).rejects.toThrow("14 UNAVAILABLE");
    vi.restoreAllMocks();
  });

  it("keeps the status of a partially refunded order while its stage moves on", async () => {
    const { number } = await paidOrder();
    await db().doc(`orders/${number}`).update({ status: "partially_refunded" }); // as a partial refund leaves it

    await takeFulfillmentStep(number, "shipped", null, staff, at(2));

    const order = (await getOrderForAdmin(number))!;
    expect([order.status, order.fulfillment.stage]).toEqual(["partially_refunded", "shipped"]);
    expect(order.timeline.at(-1)).toMatchObject({ status: "shipped", by: "admin" }); // the step, for the history
  });

  it("lets tracking be filled in or corrected once shipped, never before, without adding history steps", async () => {
    const { number } = await paidOrder();
    const tracking = { carrier: "Correios", trackingCode: "AA123456789BR", trackingUrl: null };
    await expect(updateTracking(number, tracking, staff, at(2))).rejects.toBeInstanceOf(OrderStateError);

    await takeFulfillmentStep(number, "shipped", null, staff, at(3));
    await updateTracking(number, tracking, staff, at(4));

    const order = (await getOrderForAdmin(number))!;
    expect(order.fulfillment).toMatchObject({ stage: "shipped", ...tracking, shippedAt: at(3).toISOString() });
    expect(order.timeline.map((t) => t.status)).toEqual(["pending_payment", "paid", "shipped"]);
    expect(await auditOf("order.tracking_updated")).toEqual([{ target: `orders/${number}`, actor: "equipe@example.com", details: tracking }]);
  });
});

describe("internal notes", () => {
  beforeEach(clearFirestore);

  it("are kept in order with author and time, and never reach the customer's page", async () => {
    const { number, accessToken } = await paidOrder();

    const first = await addOrderNote(number, "Cliente pediu embrulho para presente.", staff, at(2));
    await addOrderNote(number, "Embrulhado.", owner, at(3));

    expect((await getOrderForAdmin(number))!.notes).toEqual([
      { id: first, at: at(2).toISOString(), by: { uid: "uid-equipe", email: "equipe@example.com" }, text: "Cliente pediu embrulho para presente." },
      { id: expect.any(String), at: at(3).toISOString(), by: { uid: "uid-dono", email: "dono@example.com" }, text: "Embrulhado." },
    ]);
    expect(Object.keys((await getOrderForCustomer(number, accessToken))!)).not.toContain("notes");
    expect((await auditOf("order.note_added")).map((a) => a.details)).toEqual([{ noteId: first }, { noteId: expect.any(String) }]);
  });

  it("stop at 200 per order, writing nothing more", async () => {
    const { number } = await paidOrder();
    const note = { id: "n", at: Timestamp.fromDate(t0), by: { uid: "u", email: "x@example.com" }, text: "x" };
    await db().doc(`orders/${number}`).update({ notes: Array.from({ length: 200 }, (_, i) => ({ ...note, id: `n${i}` })) });

    await expect(addOrderNote(number, "201ª", staff)).rejects.toBeInstanceOf(NotesLimitError);
    expect((await getOrderForAdmin(number))!.notes).toHaveLength(200);
  });
});

describe("orders written before fulfilment existed", () => {
  beforeEach(clearFirestore);

  it("read as unfulfilled with no notes, and can be prepared like any other", async () => {
    const { number } = await paidOrder();
    await db().doc(`orders/${number}`).update({ fulfillment: FieldValue.delete(), notes: FieldValue.delete() });

    expect((await getOrderForAdmin(number))!).toMatchObject({ fulfillment: { stage: "unfulfilled" }, notes: [] });
    await takeFulfillmentStep(number, "processing", null, staff, at(2));
    expect((await getOrderForAdmin(number))!.fulfillment).toMatchObject({ stage: "processing", carrier: null, processingAt: at(2).toISOString() });
  });

  it("fail loudly when a shipped order has no fulfilment record", async () => {
    const { number } = await paidOrder();
    await db().doc(`orders/${number}`).update({ status: "shipped", fulfillment: FieldValue.delete() });

    await expect(getOrderForAdmin(number)).rejects.toThrow(`orders/${number} is shipped but has no fulfillment`);
  });
});
