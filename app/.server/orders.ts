// Order creation: ONE Firestore transaction prices the cart from the catalog,
// checks and reserves stock, takes the next order number, builds the Pix code
// and writes the order — so two customers can never both buy the last unit,
// and a number is never handed out twice.
//
// Idempotent: the checkout form sends a random key per attempt. A repeated
// submission (double click, retry after a lost response) returns the same
// order. That key is also the guest's secret for the order page; only its
// SHA-256 is stored.
import { createHash, timingSafeEqual } from "node:crypto";

import { type DocumentData, Timestamp } from "firebase-admin/firestore";

import { type CartQuote, prismicStockBySku, quoteCart, type StockLevel } from "~/lib/cart/quote";
import type { CheckoutInput } from "~/lib/checkout";
import type { Catalog } from "~/lib/catalog/query";
import type { CustomerOrderView, OrderLine, OrderStatus } from "~/lib/orders";
import { type PaymentSettings, type ShippingSettings, shippingOptions } from "~/lib/store-settings";

import { db } from "./firebase";
import { availableFrom, inventoryRef } from "./inventory";
import { fulfillmentOf, iso, NEW_FULFILLMENT, rawRefundsOf, refundedCentsOf } from "./order-doc";
import { buildPixPayment, pixTxid } from "./pix";
import { getContent } from "./prismic";
import { CheckoutClosedError, getPaymentSettings, getShippingSettings, getStoreSettings } from "./settings";

export const FIRST_ORDER_NUMBER = 1001;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The cart can't be bought as it is (stock, prices or products changed); the customer must review it. */
export class CartChangedError extends Error {
  override name = "CartChangedError";
  constructor(readonly quote: CartQuote) {
    super("The cart changed since it was quoted");
  }
}

/** The chosen delivery method isn't offered for this cart. */
export class ShippingUnavailableError extends Error {
  override name = "ShippingUnavailableError";
}

export interface OrderDeps {
  catalog: Catalog;
  payment: PaymentSettings;
  shipping: ShippingSettings;
}

export async function loadOrderDeps(): Promise<OrderDeps> {
  // Checked first: while the owner keeps checkout closed (/admin/settings), no order is placed, whatever else says.
  if (!(await getStoreSettings()).checkoutOpen) throw new CheckoutClosedError("checkout is closed (settings/store)");
  const [{ catalog }, payment, shipping] = await Promise.all([getContent(), getPaymentSettings(), getShippingSettings()]);
  return { catalog, payment, shipping };
}

export interface CreatedOrder {
  number: number;
  /** Secret for the guest order page (/order-confirmation/:number?t=…). */
  accessToken: string;
  /** true when this was a repeated submission of an order that already exists. */
  reused: boolean;
}

export async function createOrder(
  input: CheckoutInput,
  deps: OrderDeps,
  options: { now?: Date; uid?: string | null } = {},
): Promise<CreatedOrder> {
  const now = options.now ?? new Date();
  const { catalog, payment, shipping } = deps;
  const attemptRef = db().collection("checkoutAttempts").doc(sha256(input.idempotencyKey));
  const counterRef = db().collection("counters").doc("orders");
  const seeds = prismicStockBySku(catalog, input.items);
  const skus = [...seeds.keys()];

  return db().runTransaction(async (tx) => {
    // Firestore transactions: every read before any write.
    const [attempt, counter, ...inventory] = await tx.getAll(attemptRef, counterRef, ...skus.map(inventoryRef));
    if (attempt!.exists) {
      return { number: attempt!.get("orderNumber") as number, accessToken: input.idempotencyKey, reused: true };
    }

    const stock = new Map<string, StockLevel>();
    skus.forEach((sku, i) => {
      const data = inventory[i]!.data();
      const seed = seeds.get(sku) ?? null;
      stock.set(sku, data ? { tracked: true, available: availableFrom(sku, data) } : seed === null ? { tracked: false } : { tracked: true, available: seed });
    });

    const quote = quoteCart(catalog, input.items, stock);
    if (!quote.ready) throw new CartChangedError(quote);

    const pickupOnly = quote.lines.some((l) => catalog.productsById.get(l.productId)?.shipping.pickupOnly === true);
    const option = shippingOptions(shipping, { pickupOnly }).find((o) => o.id === input.shippingMethod);
    if (!option) throw new ShippingUnavailableError(`"${input.shippingMethod}" isn't offered for this cart`);

    const number = counter!.exists ? (counter!.get("next") as unknown) : FIRST_ORDER_NUMBER;
    if (typeof number !== "number" || !Number.isInteger(number) || number < FIRST_ORDER_NUMBER) {
      throw new Error(`counters/orders is corrupt (next=${String(number)})`);
    }
    const totalCents = quote.subtotalCents + option.priceCents;
    const pix = buildPixPayment(payment.pix, totalCents, pixTxid(number)); // throws PixConfigError when unset

    // --- writes ---
    const ts = Timestamp.fromDate(now);
    const reservations: { sku: string; quantity: number }[] = [];
    skus.forEach((sku, i) => {
      const line = quote.lines.find((l) => l.sku === sku);
      const level = stock.get(sku)!;
      if (!line || line.availability !== "in_stock" || !level.tracked) return; // untracked / pre-order: nothing to hold
      reservations.push({ sku, quantity: line.quantity });
      const snap = inventory[i]!;
      if (snap.exists) {
        tx.update(snap.ref, { reserved: (snap.get("reserved") as number) + line.quantity, updatedAt: ts });
      } else {
        // First order for this SKU: Firestore takes over from the stock typed in Prismic.
        tx.create(snap.ref, {
          sku,
          productId: line.productId,
          onHand: seeds.get(sku)!,
          reserved: line.quantity,
          lowStockThreshold: null,
          seededFrom: "prismic",
          createdAt: ts,
          updatedAt: ts,
        });
      }
    });

    const lines: OrderLine[] = quote.lines.map((l) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      variantName: l.variantName,
      imageUrl: l.image?.url ?? null,
      unitPriceCents: l.unitPriceCents!,
      quantity: l.quantity,
      lineTotalCents: l.lineTotalCents,
    }));
    const status: OrderStatus = "pending_payment";
    tx.create(db().collection("orders").doc(String(number)), {
      number,
      status,
      createdAt: ts,
      updatedAt: ts,
      expiresAt: Timestamp.fromMillis(now.getTime() + payment.expiryHours * 3_600_000),
      customer: { name: input.name, email: input.email, phone: input.phone, cpf: input.cpf, uid: options.uid ?? null },
      shipping: {
        method: option.id,
        label: option.label,
        priceCents: option.priceCents,
        address: option.needsAddress ? input.address : null,
        pickupAddress: option.address,
        estimateDays: option.estimateDays,
      },
      lines,
      totals: { subtotalCents: quote.subtotalCents, shippingCents: option.priceCents, discountCents: 0, totalCents, savingsCents: quote.savingsCents },
      payment: {
        method: "pix",
        status: "pending",
        amountCents: pix.amountCents,
        txid: pix.txid,
        brCode: pix.brCode,
        keyType: pix.keyType,
        confirmedAt: null,
        confirmedBy: null,
        refundedCents: 0,
      },
      reservations,
      fulfillment: NEW_FULFILLMENT,
      notes: [],
      refunds: [],
      consents: { termsAcceptedAt: ts },
      accessTokenHash: sha256(input.idempotencyKey),
      timeline: [{ at: ts, status, by: "customer", note: null }],
    });
    tx.set(counterRef, { next: number + 1 }, { merge: true });
    tx.create(attemptRef, { orderNumber: number, createdAt: ts });
    return { number, accessToken: input.idempotencyKey, reused: false };
  });
}

function toCustomerView(d: DocumentData): CustomerOrderView {
  return {
    number: d.number,
    status: d.status,
    createdAt: iso(d.createdAt),
    expiresAt: iso(d.expiresAt),
    customer: { name: d.customer.name, email: d.customer.email, phone: d.customer.phone },
    shipping: d.shipping,
    lines: d.lines,
    totals: d.totals,
    payment: {
      method: "pix",
      status: d.payment.status,
      amountCents: d.payment.amountCents,
      txid: d.payment.txid,
      brCode: d.payment.brCode,
      refundedCents: refundedCentsOf(d),
    },
    fulfillment: fulfillmentOf(d),
    refunds: rawRefundsOf(d).map((r) => ({ at: iso(r.at), amountCents: r.amountCents as number })),
  };
}

/** The order for its guest link, or null (unknown number or wrong secret — indistinguishable on purpose). */
export async function getOrderForCustomer(number: number, accessToken: string): Promise<CustomerOrderView | null> {
  if (!Number.isInteger(number) || number < FIRST_ORDER_NUMBER || !accessToken) return null;
  const data = (await db().collection("orders").doc(String(number)).get()).data();
  if (!data || typeof data.accessTokenHash !== "string") return null;
  const expected = Buffer.from(data.accessTokenHash, "hex");
  const given = Buffer.from(sha256(accessToken), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return toCustomerView(data);
}
