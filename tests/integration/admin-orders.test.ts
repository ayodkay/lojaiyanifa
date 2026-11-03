import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPendingOrder,
  confirmPixPayment,
  countOrders,
  expireOverdueOrders,
  ExpiryRunError,
  getOrderForAdmin,
  listOrders,
  OrderNotFoundError,
  OrderNotPendingError,
} from "~/.server/admin-orders";
import { db } from "~/.server/firebase";
import { createOrder, type OrderDeps } from "~/.server/orders";
import type { AdminUser } from "~/.server/session";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const deps: OrderDeps = {
  catalog: catalogOf([
    catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, prismicStock: 50 }),
    catalogProduct("pulseira", { name: "Pulseira", sku: "PULS-1", priceCents: 4500, prismicStock: null }),
    catalogProduct("brinco", { name: "Brinco", sku: "BRINCO-1", priceCents: 3000, prismicStock: 10 }),
  ]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({
    flatRate: { enabled: true, priceCents: 2500 },
    pickup: { enabled: true, address: "Mercadão de Madureira – Anexo, Galeria K" },
  }),
};

const checkout = (quantity = 1, overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: "+5521987654321",
  cpf: "52998224725",
  shippingMethod: "pickup",
  address: null,
  acceptTerms: true,
  items: [{ productId: "colar", sku: "COLAR-1", quantity }],
  ...overrides,
});

async function placeOrders(count: number): Promise<number[]> {
  const numbers: number[] = [];
  for (let i = 0; i < count; i++) numbers.push((await createOrder(checkout(), deps)).number);
  return numbers;
}

const setStatus = (number: number, status: string) => db().doc(`orders/${number}`).update({ status });
const numbers = (page: { rows: { number: number }[] }) => page.rows.map((r) => r.number);

describe("admin orders list", () => {
  beforeEach(clearFirestore);

  it("lists newest first, filters by status, and counts every tab", async () => {
    await placeOrders(4); // 1001–1004
    await setStatus(1002, "paid");
    await setStatus(1003, "cancelled");

    expect(numbers(await listOrders("all", null))).toEqual([1004, 1003, 1002, 1001]);
    expect(numbers(await listOrders("pending_payment", null))).toEqual([1004, 1001]);
    expect(numbers(await listOrders("paid", null))).toEqual([1002]);
    expect(numbers(await listOrders("cancelled", null))).toEqual([1003]);
    expect(await countOrders()).toEqual({ pending_payment: 2, paid: 1, processing: 0, shipped: 0, delivered: 0, cancelled: 1, partially_refunded: 0, refunded: 0, all: 4 });
  });

  it("returns the row the list shows, straight from the order checkout wrote", async () => {
    await createOrder(checkout(3, { name: "João Souza", email: "joao@exemplo.com", shippingMethod: "flat_rate", address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" } }), deps);

    const [row] = (await listOrders("all", null)).rows;
    const saved = (await db().doc("orders/1001").get()).data()!;
    expect(row).toEqual({
      number: 1001,
      status: "pending_payment",
      createdAt: saved.createdAt.toDate().toISOString(),
      expiresAt: saved.expiresAt.toDate().toISOString(),
      customerName: "João Souza",
      customerEmail: "joao@exemplo.com",
      itemCount: 3,
      totalCents: 3 * 12990 + 2500,
      shippingMethod: "flat_rate",
      fulfillmentStage: "unfulfilled",
    });
  });

  it("pages with a 'before' cursor until there are no more orders", async () => {
    await placeOrders(5);

    const first = await listOrders("all", null, 2);
    expect([numbers(first), first.nextBefore]).toEqual([[1005, 1004], 1004]);
    const second = await listOrders("all", first.nextBefore, 2);
    expect([numbers(second), second.nextBefore]).toEqual([[1003, 1002], 1002]);
    const last = await listOrders("all", second.nextBefore, 2);
    expect([numbers(last), last.nextBefore]).toEqual([[1001], null]);
    // An exact multiple of the page size must not promise an empty extra page.
    expect((await listOrders("all", null, 5)).nextBefore).toBeNull();
  });

  it("returns an empty first page and zero counts when there are no orders", async () => {
    expect(await listOrders("pending_payment", null)).toEqual({ rows: [], nextBefore: null });
    expect(await countOrders()).toEqual({ pending_payment: 0, paid: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0, partially_refunded: 0, refunded: 0, all: 0 });
  });
});

const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const stockOf = async (sku: string) => {
  const d = (await db().doc(`inventory/${sku}`).get()).data();
  return d ? { onHand: d.onHand, reserved: d.reserved } : null;
};
const auditOf = async () => (await db().collection("auditLogs").get()).docs.map((d) => ({ action: d.get("action"), target: d.get("target"), details: d.get("details") }));

describe("confirming and cancelling Pix orders", () => {
  beforeEach(clearFirestore);

  it("confirming a payment marks the order paid and turns the reservation into a sale", async () => {
    await createOrder(checkout(2), deps);
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 2 });
    const at = new Date("2026-11-02T12:00:00.000Z");

    await confirmPixPayment(1001, owner, at);

    expect(await stockOf("COLAR-1")).toEqual({ onHand: 48, reserved: 0 });
    const order = (await getOrderForAdmin(1001))!;
    expect(order.status).toBe("paid");
    expect(order.payment).toMatchObject({ status: "confirmed", confirmedAt: at.toISOString(), confirmedBy: { uid: "uid-dono", email: "dono@example.com" } });
    expect(order.timeline.map((t) => [t.status, t.by, t.actor?.email ?? null])).toEqual([
      ["pending_payment", "customer", null],
      ["paid", "admin", "dono@example.com"],
    ]);
    expect(order.updatedAt).toBe(at.toISOString());
    expect(await auditOf()).toEqual([
      { action: "order.payment_confirmed", target: "orders/1001", details: { amountCents: 2 * 12990, txid: "PEDIDO1001" } },
    ]);
  });

  it("cancelling releases the reservation, keeps the stock on hand, and records why", async () => {
    await createOrder(checkout(2), deps);
    await createOrder(checkout(3), deps);
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 5 });

    await cancelPendingOrder(1001, owner, { reason: "customer_request", note: "Desistiu da compra" });

    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 3 });
    const order = (await getOrderForAdmin(1001))!;
    expect(order.status).toBe("cancelled");
    expect(order.payment).toMatchObject({ status: "pending", confirmedAt: null, confirmedBy: null });
    expect(order.cancellation).toMatchObject({ reason: "customer_request", note: "Desistiu da compra", by: { email: "dono@example.com" } });
    expect(order.timeline.at(-1)).toMatchObject({ status: "cancelled", by: "admin", note: "Desistiu da compra" });
    expect((await getOrderForAdmin(1002))!.status).toBe("pending_payment");
    expect(await auditOf()).toEqual([{ action: "order.cancelled", target: "orders/1001", details: { reason: "customer_request", note: "Desistiu da compra" } }]);
  });

  it("refuses to settle an order twice, either way, and changes nothing when it refuses", async () => {
    await createOrder(checkout(2), deps);
    await confirmPixPayment(1001, owner);

    await expect(confirmPixPayment(1001, owner)).rejects.toThrow(OrderNotPendingError);
    await expect(cancelPendingOrder(1001, owner, { reason: "other", note: "teste" })).rejects.toMatchObject({ name: "OrderNotPendingError", status: "paid" });
    await expect(confirmPixPayment(9999, owner)).rejects.toThrow(OrderNotFoundError);

    expect(await stockOf("COLAR-1")).toEqual({ onHand: 48, reserved: 0 });
    expect((await auditOf()).length).toBe(1);
  });

  it("when a confirmation and a cancellation race, exactly one wins and the stock matches the winner", async () => {
    await createOrder(checkout(2), deps);

    const [confirmed, cancelled] = await Promise.allSettled([
      confirmPixPayment(1001, owner),
      cancelPendingOrder(1001, { ...owner, uid: "uid-admin", email: "admin@example.com", role: "admin" }, { reason: "payment_not_received", note: null }),
    ]);

    expect([confirmed.status, cancelled.status].sort()).toEqual(["fulfilled", "rejected"]);
    const loser = [confirmed, cancelled].find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(OrderNotPendingError);
    const status = (await getOrderForAdmin(1001))!.status;
    expect(await stockOf("COLAR-1")).toEqual(status === "paid" ? { onHand: 48, reserved: 0 } : { onHand: 50, reserved: 0 });
    expect((await auditOf()).length).toBe(1);
  });

  it("reports a lost race as 'not pending' even when the database only says the transaction was closed", async () => {
    // The emulator sometimes closes the losing transaction instead of retrying it into OrderNotPendingError.
    await createOrder(checkout(2), deps);
    const closed = () => Object.assign(new Error("3 INVALID_ARGUMENT: Transaction is invalid or closed."), { code: 3 });
    const spy = vi.spyOn(db(), "runTransaction").mockImplementationOnce(async () => {
      await confirmPixPayment(1001, owner); // the winner (its own transaction runs for real)
      throw closed();
    });

    await expect(cancelPendingOrder(1001, owner, { reason: "other", note: "x" })).rejects.toMatchObject({ name: "OrderNotPendingError", status: "paid" });
    spy.mockRestore();
  });

  it("passes the database's error on when the order is still pending (nothing was settled)", async () => {
    await createOrder(checkout(2), deps);
    const spy = vi.spyOn(db(), "runTransaction").mockRejectedValueOnce(Object.assign(new Error("14 UNAVAILABLE: connection reset"), { code: 14 }));

    await expect(confirmPixPayment(1001, owner)).rejects.toThrow("14 UNAVAILABLE: connection reset");
    spy.mockRestore();
    expect((await getOrderForAdmin(1001))!.status).toBe("pending_payment");
  });

  it("fails loudly, writing nothing, when the stock document can't cover the reservation", async () => {
    await createOrder(checkout(2), deps);
    await db().doc("inventory/COLAR-1").update({ reserved: 1 }); // e.g. a hand edit in the console

    await expect(confirmPixPayment(1001, owner)).rejects.toThrow(/inventory\/COLAR-1 can't sell 2 for order 1001 \(exists=true, onHand=50, reserved=1\)/);
    await expect(cancelPendingOrder(1001, owner, { reason: "other", note: "x" })).rejects.toThrow(/can't release 2/);

    expect((await getOrderForAdmin(1001))!.status).toBe("pending_payment");
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 1 });
    expect(await auditOf()).toEqual([]);
  });

  it("settles orders whose products don't track stock without touching inventory", async () => {
    await createOrder(checkout(1, { items: [{ productId: "pulseira", sku: "PULS-1", quantity: 4 }] }), deps);
    expect((await db().doc("orders/1001").get()).get("reservations")).toEqual([]);

    await confirmPixPayment(1001, owner);

    expect((await getOrderForAdmin(1001))!.status).toBe("paid");
    expect(await stockOf("PULS-1")).toBeNull();
  });
});

describe("the Pix expiry job", () => {
  beforeEach(clearFirestore);

  // deps.payment.expiryHours = 24
  const t0 = new Date("2026-11-02T12:00:00.000Z");
  const at = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);
  const cancellations = async () =>
    (await db().collection("auditLogs").where("action", "==", "order.cancelled").get()).docs.map((d) => ({ target: d.get("target"), actor: d.get("actor") }));

  it("cancels only pending orders past their deadline, releases their stock, and records the system as the actor", async () => {
    await createOrder(checkout(2), deps, { now: t0 }); // 1001, due at +24h
    await createOrder(checkout(3), deps, { now: at(2) }); // 1002, due at +26h
    await createOrder(checkout(1), deps, { now: t0 }); // 1003, due at +24h but paid
    await confirmPixPayment(1003, owner, at(1));
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 49, reserved: 5 });

    const run = await expireOverdueOrders(at(25));

    expect(run).toEqual({ expired: [1001], skipped: [], failed: [], more: false });
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 49, reserved: 3 });
    const order = (await getOrderForAdmin(1001))!;
    expect(order.status).toBe("cancelled");
    expect(order.updatedAt).toBe(at(25).toISOString());
    expect(order.cancellation).toEqual({
      at: at(25).toISOString(),
      reason: "payment_not_received",
      note: "Prazo de pagamento vencido (cancelamento automático)",
      by: null,
    });
    expect(order.timeline.at(-1)).toEqual({ at: at(25).toISOString(), status: "cancelled", by: "system", actor: null, note: order.cancellation!.note });
    expect((await getOrderForAdmin(1002))!.status).toBe("pending_payment");
    expect((await getOrderForAdmin(1003))!.status).toBe("paid");
    expect(await cancellations()).toEqual([{ target: "orders/1001", actor: { type: "system", name: "pix-expiry" } }]);
  });

  it("never cancels before the deadline, and cancels from the deadline on", async () => {
    await createOrder(checkout(2), deps, { now: t0 });
    const deadline = at(24);

    expect(await expireOverdueOrders(new Date(deadline.getTime() - 1))).toEqual({ expired: [], skipped: [], failed: [], more: false });
    expect((await getOrderForAdmin(1001))!.status).toBe("pending_payment");

    expect((await expireOverdueOrders(deadline)).expired).toEqual([1001]);
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 0 });
  });

  it("changes nothing when it runs again", async () => {
    await createOrder(checkout(2), deps, { now: t0 });
    await expireOverdueOrders(at(25));

    expect(await expireOverdueOrders(at(26))).toEqual({ expired: [], skipped: [], failed: [], more: false });
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 0 });
    expect(await cancellations()).toHaveLength(1);
  });

  it("when an admin confirms the payment while the job runs, exactly one of them wins", async () => {
    await createOrder(checkout(2), deps, { now: t0 });

    const [confirmed, job] = await Promise.allSettled([confirmPixPayment(1001, owner, at(25)), expireOverdueOrders(at(25))]);

    // The job never fails because someone else got there first — even when the emulator
    // closes its transaction under contention instead of answering OrderNotPendingError.
    expect(job.status).toBe("fulfilled");
    const status = (await getOrderForAdmin(1001))!.status;
    if (status === "paid") {
      expect(confirmed.status).toBe("fulfilled");
      expect((job as PromiseFulfilledResult<Awaited<ReturnType<typeof expireOverdueOrders>>>).value.expired).toEqual([]);
      expect(await stockOf("COLAR-1")).toEqual({ onHand: 48, reserved: 0 });
    } else {
      expect(status).toBe("cancelled");
      expect((confirmed as PromiseRejectedResult).reason).toBeInstanceOf(OrderNotPendingError);
      expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 0 });
    }
    expect((await db().collection("auditLogs").get()).size).toBe(1);
  });

  it("keeps going when one order can't be cancelled, then fails loudly naming it", async () => {
    await createOrder(checkout(2), deps, { now: t0 }); // 1001: COLAR-1
    await createOrder(checkout(1, { items: [{ productId: "brinco", sku: "BRINCO-1", quantity: 1 }] }), deps, { now: at(1) }); // 1002
    await db().doc("inventory/COLAR-1").update({ reserved: 1 }); // can't cover 1001's reservation of 2

    const error = await expireOverdueOrders(at(26)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExpiryRunError);
    const { run } = error as ExpiryRunError;
    expect(run.expired).toEqual([1002]);
    expect(run.failed).toEqual([{ number: 1001, error: expect.stringMatching(/inventory\/COLAR-1 can't release 2 for order 1001/) }]);
    expect((error as Error).message).toMatch(/1 order\(s\) could not be cancelled: 1001/);
    expect((await getOrderForAdmin(1001))!.status).toBe("pending_payment");
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 1 });
    expect(await stockOf("BRINCO-1")).toEqual({ onHand: 10, reserved: 0 });
  });

  it("works through a backlog in batches, oldest deadline first", async () => {
    for (let h = 0; h < 3; h++) await createOrder(checkout(1), deps, { now: at(h) }); // 1001–1003, due at +24/+25/+26h

    expect(await expireOverdueOrders(at(30), 2)).toEqual({ expired: [1001, 1002], skipped: [], failed: [], more: true });
    expect(await expireOverdueOrders(at(30), 2)).toEqual({ expired: [1003], skipped: [], failed: [], more: false });
    expect(await stockOf("COLAR-1")).toEqual({ onHand: 50, reserved: 0 });
  });
});
