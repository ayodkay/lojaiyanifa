import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "~/.server/firebase";
import { CartChangedError, createOrder, getOrderForCustomer, type OrderDeps, ShippingUnavailableError } from "~/.server/orders";
import { PixConfigError } from "~/.server/pix";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearFirestore } from "./emulators";

const catalog = catalogOf([
  catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, originalPriceCents: 13990, discountPercent: 7, prismicStock: 5 }),
  catalogProduct("pulseira", { name: "Pulseira", sku: "PULS-1", priceCents: 4500, prismicStock: null }),
  catalogProduct("pre", { name: "Pré-venda", sku: "PRE-1", priceCents: 9900, availability: "preorder", prismicStock: 0 }),
  catalogProduct("imagem", {
    name: "Imagem",
    sku: "IMG-1",
    priceCents: 30000,
    shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, pickupOnly: true },
  }),
]);

const deps: OrderDeps = {
  catalog,
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({
    flatRate: { enabled: true, priceCents: 2500 },
    pickup: { enabled: true, address: "Mercadão de Madureira – Anexo, Galeria K" },
  }),
};

const input = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: randomUUID(),
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: "+5521987654321",
  cpf: "52998224725",
  shippingMethod: "flat_rate",
  address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
  acceptTerms: true,
  items: [{ productId: "colar", sku: "COLAR-1", quantity: 2 }],
  ...overrides,
});

const orderDoc = async (n: number) => (await db().doc(`orders/${n}`).get()).data();
const count = async (collection: string) => (await db().collection(collection).get()).size;

describe("createOrder — basics", () => {
  beforeEach(clearFirestore);

  it("creates order 1001 priced on the server, with flat shipping and a Pix code for the total", async () => {
    const order = input();
    expect(await createOrder(order, deps)).toEqual({ number: 1001, accessToken: order.idempotencyKey, reused: false });

    const saved = (await orderDoc(1001))!;
    expect(saved.status).toBe("pending_payment");
    expect(saved.totals).toEqual({ subtotalCents: 25980, shippingCents: 2500, discountCents: 0, totalCents: 28480, savingsCents: 2000 });
    expect(saved.payment).toMatchObject({ method: "pix", status: "pending", amountCents: 28480, txid: "PEDIDO1001" });
    expect(saved.payment.brCode).toContain("5406284.80");
    expect(saved.customer).toEqual({ name: "Maria da Silva", email: "maria@exemplo.com", phone: "+5521987654321", cpf: "52998224725", uid: null });
    expect(saved.shipping).toMatchObject({ method: "flat_rate", priceCents: 2500, address: { cep: "21360201" }, pickupAddress: null });
    expect(saved.expiresAt.toMillis() - saved.createdAt.toMillis()).toBe(24 * 3_600_000);
    expect(saved.accessTokenHash).not.toContain(order.idempotencyKey);
    expect((await db().doc("counters/orders").get()).get("next")).toBe(1002);
  });

  it("numbers orders sequentially", async () => {
    expect((await createOrder(input(), deps)).number).toBe(1001);
    expect((await createOrder(input({ items: [{ productId: "pulseira", sku: "PULS-1", quantity: 1 }] }), deps)).number).toBe(1002);
  });

  it("returns the same order for a repeated submission and reserves stock once", async () => {
    const order = input();
    const first = await createOrder(order, deps);
    const again = await createOrder(order, deps);
    expect(again).toEqual({ ...first, reused: true });
    expect(await count("orders")).toBe(1);
    expect((await db().doc("inventory/COLAR-1").get()).get("reserved")).toBe(2);
  });

  it("shows the order only with its secret, and never the CPF", async () => {
    const { number, accessToken } = await createOrder(input(), deps);
    const view = await getOrderForCustomer(number, accessToken);
    expect(view).toMatchObject({ number: 1001, status: "pending_payment", totals: { totalCents: 28480 } });
    expect(JSON.stringify(view)).not.toContain("52998224725");
    expect(await getOrderForCustomer(number, randomUUID())).toBeNull();
    expect(await getOrderForCustomer(9999, accessToken)).toBeNull();
  });
});

describe("createOrder — stock", () => {
  beforeEach(clearFirestore);

  it("takes over from the Prismic stock on the first order, then reserves until nothing is left", async () => {
    await createOrder(input({ items: [{ productId: "colar", sku: "COLAR-1", quantity: 2 }] }), deps);
    expect((await db().doc("inventory/COLAR-1").get()).data()).toMatchObject({ onHand: 5, reserved: 2, seededFrom: "prismic" });

    await createOrder(input({ items: [{ productId: "colar", sku: "COLAR-1", quantity: 3 }] }), deps);
    expect((await db().doc("inventory/COLAR-1").get()).get("reserved")).toBe(5);

    const refused = createOrder(input({ items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }] }), deps);
    await expect(refused).rejects.toBeInstanceOf(CartChangedError);
    await refused.catch((error: CartChangedError) => expect(error.quote.lines[0]!.problem).toBe("out_of_stock"));
    expect(await count("orders")).toBe(2);
    expect((await db().doc("counters/orders").get()).get("next")).toBe(1003); // no number burned
  });

  it("holds no stock for untracked or pre-order items", async () => {
    const { number } = await createOrder(
      input({ items: [{ productId: "pulseira", sku: "PULS-1", quantity: 10 }, { productId: "pre", sku: "PRE-1", quantity: 3 }] }),
      deps,
    );
    expect((await orderDoc(number))!.reservations).toEqual([]);
    expect(await count("inventory")).toBe(0);
  });

  it("never sells the last unit twice, even to simultaneous buyers", async () => {
    const lastUnit: OrderDeps = { ...deps, catalog: catalogOf([catalogProduct("colar", { sku: "COLAR-1", priceCents: 12990, prismicStock: 1 })]) };
    const buy = () => createOrder(input({ items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }] }), lastUnit);

    const results = await Promise.allSettled([buy(), buy()]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(CartChangedError);
    expect(await count("orders")).toBe(1);
    expect((await db().doc("inventory/COLAR-1").get()).data()).toMatchObject({ onHand: 1, reserved: 1 });
  });
});

describe("createOrder — delivery and failures", () => {
  beforeEach(clearFirestore);

  const nothingWritten = async () => {
    for (const collection of ["orders", "inventory", "checkoutAttempts", "counters"]) expect(await count(collection)).toBe(0);
  };

  it("pickup stores no delivery address and costs nothing", async () => {
    const { number } = await createOrder(input({ shippingMethod: "pickup", address: null }), deps);
    const saved = (await orderDoc(number))!;
    expect(saved.shipping).toMatchObject({ method: "pickup", priceCents: 0, address: null, pickupAddress: "Mercadão de Madureira – Anexo, Galeria K" });
    expect(saved.totals.totalCents).toBe(saved.totals.subtotalCents);
  });

  it("refuses delivery for a pickup-only product, writing nothing", async () => {
    await expect(createOrder(input({ items: [{ productId: "imagem", sku: "IMG-1", quantity: 1 }] }), deps)).rejects.toBeInstanceOf(
      ShippingUnavailableError,
    );
    await nothingWritten();
  });

  it("aborts without writing anything when Pix isn't configured", async () => {
    const noPix: OrderDeps = { ...deps, payment: { ...deps.payment, pix: { ...deps.payment.pix, key: "" } } };
    await expect(createOrder(input(), noPix)).rejects.toBeInstanceOf(PixConfigError);
    await nothingWritten();
  });

  it("treats a product that no longer exists as a changed cart", async () => {
    await expect(createOrder(input({ items: [{ productId: "gone", sku: "X-1", quantity: 1 }] }), deps)).rejects.toBeInstanceOf(CartChangedError);
    await nothingWritten();
  });
});
