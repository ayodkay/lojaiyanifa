import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { confirmPixPayment, getOrderForAdmin } from "~/.server/admin-orders";
import { db } from "~/.server/firebase";
import { OrderStateError, takeFulfillmentStep } from "~/.server/order-fulfillment";
import { recordRefund, RefundStateError } from "~/.server/order-refunds";
import { createOrder, getOrderForCustomer, type OrderDeps } from "~/.server/orders";
import type { AdminUser } from "~/.server/session";
import type { RefundInput } from "~/lib/admin/refunds";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const deps: OrderDeps = {
  catalog: catalogOf([
    catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, prismicStock: 50 }),
    catalogProduct("pulseira", { name: "Pulseira", sku: "PULS-1", priceCents: 4500, prismicStock: null }), // doesn't track stock
  ]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({
    flatRate: { enabled: true, priceCents: 2500 },
    pickup: { enabled: true, address: "Mercadão de Madureira – Anexo, Galeria K" },
  }),
};

const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const t0 = new Date("2026-11-02T12:00:00.000Z");
const at = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);

/** 3 colares (stock-tracked) + 2 pulseiras (not tracked), delivered by flat rate: 3 × 129,90 + 2 × 45,00 + 25,00 = 504,70. */
const TOTAL = 3 * 12990 + 2 * 4500 + 2500;
async function paidOrder(): Promise<{ number: number; accessToken: string }> {
  const input: CheckoutInput = {
    idempotencyKey: randomUUID(),
    name: "Maria da Silva",
    email: "maria@exemplo.com",
    phone: "+5521987654321",
    cpf: "52998224725",
    shippingMethod: "flat_rate",
    address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
    acceptTerms: true,
    items: [
      { productId: "colar", sku: "COLAR-1", quantity: 3 },
      { productId: "pulseira", sku: "PULS-1", quantity: 2 },
    ],
  };
  const { number, accessToken } = await createOrder(input, deps, { now: t0 });
  await confirmPixPayment(number, owner, at(1));
  return { number, accessToken };
}

const refund = (amountCents: number, overrides: Partial<RefundInput> = {}): RefundInput => ({
  key: randomUUID(),
  amountCents,
  reason: "out_of_stock",
  note: null,
  restock: [],
  ...overrides,
});

const colarStock = async () => {
  const d = (await db().doc("inventory/COLAR-1").get()).data()!;
  return { onHand: d.onHand, reserved: d.reserved };
};

describe("refunds", () => {
  beforeEach(clearFirestore);

  it("a partial refund before shipping puts the chosen units back on sale, and the order still ships", async () => {
    const { number } = await paidOrder();
    expect(await colarStock()).toEqual({ onHand: 47, reserved: 0 });

    const result = await recordRefund(number, refund(12990, { note: "Um colar quebrou no estoque", restock: [{ sku: "COLAR-1", quantity: 1 }] }), owner, at(2));

    expect(result).toEqual({ status: "partially_refunded", refundedCents: 12990, repeated: false });
    expect(await colarStock()).toEqual({ onHand: 48, reserved: 0 });
    let order = (await getOrderForAdmin(number))!;
    expect(order.status).toBe("partially_refunded");
    expect(order.payment.refundedCents).toBe(12990);
    expect(order.refunds).toEqual([
      {
        id: expect.any(String),
        at: at(2).toISOString(),
        by: { uid: "uid-dono", email: "dono@example.com" },
        amountCents: 12990,
        reason: "out_of_stock",
        note: "Um colar quebrou no estoque",
        restock: [{ sku: "COLAR-1", quantity: 1 }],
      },
    ]);
    expect(order.restockable).toEqual({ "COLAR-1": 2 }); // PULS-1 doesn't track stock
    expect(order.timeline.at(-1)).toMatchObject({ status: "partially_refunded", by: "admin", note: expect.stringContaining("Produto em falta: Um colar quebrou no estoque") });
    const audit = (await db().collection("auditLogs").where("action", "==", "order.refunded").get()).docs.map((d) => d.get("details"));
    expect(audit).toEqual([{ amountCents: 12990, refundedCents: 12990, reason: "out_of_stock", note: "Um colar quebrou no estoque", restock: [{ sku: "COLAR-1", quantity: 1 }] }]);

    await takeFulfillmentStep(number, "shipped", null, owner, at(3));
    order = (await getOrderForAdmin(number))!;
    expect([order.status, order.fulfillment.stage]).toEqual(["partially_refunded", "shipped"]);
  });

  it("a second refund completing the amount makes the order refunded, which ends shipping and further refunds", async () => {
    const { number } = await paidOrder();
    await recordRefund(number, refund(12990), owner, at(2));

    expect(await recordRefund(number, refund(TOTAL - 12990, { reason: "customer_request" }), owner, at(3))).toEqual({
      status: "refunded",
      refundedCents: TOTAL,
      repeated: false,
    });

    await expect(takeFulfillmentStep(number, "processing", null, owner, at(4))).rejects.toBeInstanceOf(OrderStateError);
    await expect(recordRefund(number, refund(1), owner, at(4))).rejects.toBeInstanceOf(RefundStateError);
    expect((await getOrderForAdmin(number))!.payment.refundedCents).toBe(TOTAL);
  });

  it("a full refund of a delivered order leaves the stock alone unless units are chosen", async () => {
    const { number } = await paidOrder();
    await takeFulfillmentStep(number, "delivered", null, owner, at(2));

    expect((await recordRefund(number, refund(TOTAL, { reason: "defective" }), owner, at(30))).status).toBe("refunded");
    expect(await colarStock()).toEqual({ onHand: 47, reserved: 0 });
    expect((await getOrderForAdmin(number))!.fulfillment.stage).toBe("delivered"); // what happened to the parcel stays recorded
  });

  it("refuses what doesn't fit — unpaid order, too much money, too many units, untracked SKU — writing nothing", async () => {
    const { number } = await paidOrder();
    const before = (await db().doc(`orders/${number}`).get()).data();
    const audits = (await db().collection("auditLogs").get()).size;

    for (const input of [
      refund(TOTAL + 1),
      refund(0),
      refund(100, { restock: [{ sku: "COLAR-1", quantity: 4 }] }),
      refund(100, { restock: [{ sku: "PULS-1", quantity: 1 }] }),
    ]) {
      await expect(recordRefund(number, input, owner, at(2))).rejects.toBeInstanceOf(RefundStateError);
    }
    await expect(recordRefund(9999, refund(100), owner)).rejects.toMatchObject({ name: "OrderNotFoundError" });

    expect((await db().doc(`orders/${number}`).get()).data()).toEqual(before);
    expect(await colarStock()).toEqual({ onHand: 47, reserved: 0 });
    expect((await db().collection("auditLogs").get()).size).toBe(audits);
  });

  it("refuses refunds of orders that were never paid", async () => {
    const { number } = await paidOrder();
    await db().doc(`orders/${number}`).update({ status: "pending_payment" });
    await expect(recordRefund(number, refund(100), owner)).rejects.toMatchObject({ name: "RefundStateError", status: "pending_payment" });
    await db().doc(`orders/${number}`).update({ status: "cancelled" });
    await expect(recordRefund(number, refund(100), owner)).rejects.toMatchObject({ name: "RefundStateError", status: "cancelled" });
  });

  it("records a refund once when the same form is submitted twice", async () => {
    const { number } = await paidOrder();
    const input = refund(5000, { restock: [{ sku: "COLAR-1", quantity: 1 }] });

    const [first, second] = [await recordRefund(number, input, owner, at(2)), await recordRefund(number, input, owner, at(2))];

    expect([first.repeated, second.repeated]).toEqual([false, true]);
    const order = (await getOrderForAdmin(number))!;
    expect([order.refunds.length, order.payment.refundedCents]).toEqual([1, 5000]);
    expect(await colarStock()).toEqual({ onHand: 48, reserved: 0 });
  });

  it("recognises its own refund after the database closed the transaction under it", async () => {
    const { number } = await paidOrder();
    const input = refund(5000);
    const spy = vi.spyOn(db(), "runTransaction").mockImplementationOnce(async () => {
      await recordRefund(number, input, owner, at(2)); // committed (by the "other" attempt)…
      throw Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed."), { code: 3 }); // …but this one hears an error
    });

    expect(await recordRefund(number, input, owner, at(2))).toEqual({ status: "partially_refunded", refundedCents: 5000, repeated: true });
    spy.mockRestore();
    expect((await getOrderForAdmin(number))!.refunds).toHaveLength(1);
  });

  it("shows the customer the money returned, without the internal reason or note", async () => {
    const { number, accessToken } = await paidOrder();
    await recordRefund(number, refund(12990, { note: "nota interna" }), owner, at(2));

    const view = (await getOrderForCustomer(number, accessToken))!;
    expect(view.payment.refundedCents).toBe(12990);
    expect(view.refunds).toEqual([{ at: at(2).toISOString(), amountCents: 12990 }]);
    expect(JSON.stringify(view)).not.toContain("nota interna");
    expect(JSON.stringify(view)).not.toContain("out_of_stock");
  });

  it("fails loudly when the stored total doesn't match the refund records (e.g. a hand edit)", async () => {
    const { number } = await paidOrder();
    await recordRefund(number, refund(5000), owner, at(2));
    await db().doc(`orders/${number}`).update({ "payment.refundedCents": 4000 });

    await expect(getOrderForAdmin(number)).rejects.toThrow(`orders/${number}: payment.refundedCents is 4000 but its refunds add up to 5000`);
    await expect(recordRefund(number, refund(100), owner)).rejects.toThrow(/refundedCents is 4000/);
  });
});
