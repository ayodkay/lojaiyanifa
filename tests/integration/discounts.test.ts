// Discounts in the order transaction (app/.server/orders.ts + app/.server/promotions.ts) against the Firestore emulator.
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { cancelPendingOrder, expireOverdueOrders } from "~/.server/admin-orders";
import { db } from "~/.server/firebase";
import { CouponRefusedError, createOrder, type OrderDeps } from "~/.server/orders";
import { savePromotion } from "~/.server/promotions";
import type { AdminUser } from "~/.server/session";
import type { PromotionInput } from "~/lib/admin/promotions";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const t0 = new Date("2026-11-04T12:00:00.000Z");
const deps: OrderDeps = {
  catalog: catalogOf([
    catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 10000, prismicStock: 50 }),
    catalogProduct("pano", { name: "Pano", sku: "PANO-1", priceCents: 5000, prismicStock: 50 }),
  ]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: false, address: "x" } }),
};

const order = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: "+5521987654321",
  cpf: "52998224725",
  shippingMethod: "flat_rate",
  address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
  acceptTerms: true,
  couponCode: null,
  items: [{ productId: "colar", sku: "COLAR-1", quantity: 2 }],
  ...overrides,
});

const promotion = (overrides: Partial<PromotionInput> = {}): PromotionInput => ({
  name: "teste",
  label: "10% na loja",
  code: "DEZ",
  kind: "percent",
  value: 10,
  buyQuantity: 0,
  getQuantity: 0,
  scope: { type: "all" },
  minSubtotalCents: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxPerCustomer: null,
  firstOrderOnly: false,
  allowedEmails: null,
  active: true,
  ...overrides,
});

const orderDoc = async (n: number) => (await db().doc(`orders/${n}`).get()).data()!;
const uses = async (id: string) => (await db().doc(`promotions/${id}`).get()).get("redemptionCount") as number;

describe("orders with discounts", () => {
  beforeEach(clearFirestore);

  it("a coupon comes off the products, the Pix charges the discounted total and the use is counted", async () => {
    await savePromotion(null, promotion(), owner, t0);
    await createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 });
    const saved = await orderDoc(1001);
    expect(saved.totals).toEqual({ subtotalCents: 20000, shippingCents: 2500, discountCents: 2000, totalCents: 20500, savingsCents: 0 });
    expect(saved.payment.amountCents).toBe(20500);
    expect(saved.payment.brCode).toContain("5406205.00");
    expect(saved.discounts).toEqual([{ promotionId: "DEZ", code: "DEZ", label: "10% na loja", kind: "percent", amountCents: 2000, freeShipping: false }]);
    expect(saved.couponCode).toBe("DEZ");
    expect(await uses("DEZ")).toBe(1);
  });

  it("an unknown or expired coupon stops the order with the reason, writing nothing", async () => {
    await savePromotion(null, promotion({ endsAt: t0.getTime() }), owner, t0);
    await expect(createOrder(order({ couponCode: "NAOEXISTE" }), deps, { now: t0 })).rejects.toThrow(new CouponRefusedError("Cupom não encontrado. Confira o código."));
    await expect(createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 })).rejects.toThrow("Este cupom expirou.");
    expect((await db().collection("orders").get()).size).toBe(0);
    expect((await db().doc("counters/orders").get()).exists).toBe(false);
    expect(await uses("DEZ")).toBe(0);
  });

  it("first-order coupons know returning buyers by e-mail or by CPF", async () => {
    await savePromotion(null, promotion({ code: "PRIMEIRA", firstOrderOnly: true }), owner, t0);
    await createOrder(order({ couponCode: "PRIMEIRA" }), deps, { now: t0 });
    await expect(createOrder(order({ couponCode: "PRIMEIRA", email: "outro@exemplo.com" }), deps, { now: t0 })).rejects.toThrow("Este cupom vale só para a primeira compra.");
  });

  it("free shipping comes on top of the products discount; delivery is charged 0", async () => {
    await savePromotion(null, promotion(), owner, t0);
    await savePromotion(null, promotion({ code: null, label: "Frete grátis", kind: "free_shipping", value: 0 }), owner, t0);
    await createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 });
    const saved = await orderDoc(1001);
    expect(saved.totals).toMatchObject({ shippingCents: 0, discountCents: 2000, totalCents: 18000 });
    expect(saved.shipping.priceCents).toBe(2500);
    expect(saved.discounts.map((d: { label: string }) => d.label)).toEqual(["10% na loja", "Frete grátis"]);
  });

  it("a better automatic promotion wins over the coupon, which isn't counted", async () => {
    await savePromotion(null, promotion(), owner, t0);
    const auto = await savePromotion(null, promotion({ code: null, label: "20% na loja", value: 20 }), owner, t0);
    await createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 });
    expect((await orderDoc(1001)).totals.discountCents).toBe(4000);
    expect(await uses(auto)).toBe(1);
    expect(await uses("DEZ")).toBe(0);
  });

  it("two buyers racing for a coupon's last use: one gets it, the other is told", async () => {
    await savePromotion(null, promotion({ maxRedemptions: 1 }), owner, t0);
    const results = await Promise.allSettled([
      createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 }),
      createOrder(order({ couponCode: "DEZ", email: "joao@exemplo.com", cpf: "11144477735" }), deps, { now: t0 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(CouponRefusedError);
    expect(await uses("DEZ")).toBe(1);
  });

  it("cancelling an unpaid order — by the store or the expiry job — gives the use back", async () => {
    await savePromotion(null, promotion({ maxRedemptions: 1 }), owner, t0);
    await createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 });
    await cancelPendingOrder(1001, owner, { reason: "customer_request", note: null }, t0);
    expect(await uses("DEZ")).toBe(0);
    await createOrder(order({ couponCode: "DEZ" }), deps, { now: t0 });
    expect(await uses("DEZ")).toBe(1);
    await expireOverdueOrders(new Date(t0.getTime() + 25 * 3_600_000));
    expect(await uses("DEZ")).toBe(0);
  });
});
