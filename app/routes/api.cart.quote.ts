// POST /api/cart/quote — prices the browser's cart on the server.
// Request:  { "items": [{ "productId": "…", "sku": "…", "quantity": 1 }], "coupon": "DEZ" | null }  (JSON, ≤ 50 lines)
// Response: CartQuoteResponse (app/lib/cart/quote.ts). Never cached: prices and stock change.
// The discount is a preview with the same engine as the order (app/lib/discounts.ts); conditions about who buys
// (first order, specific customers, uses per customer) stay "provisional" until checkout.
//
// A plain JSON endpoint called with fetch(), not a React Router fetcher action:
// a fetcher POST would make React Router re-run every loader on the page after
// each quantity change.
import { z } from "zod";

import { stockLevels } from "~/.server/inventory";
import { getContent } from "~/.server/prismic";
import { discountLines, loadPromotions } from "~/.server/promotions";
import { chooseDiscounts, normalizeCouponCode } from "~/lib/discounts";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "~/lib/cart/limits";
import { type CartQuoteResponse, prismicStockBySku, quoteCart, recommendForCart } from "~/lib/cart/quote";
import { toSummary } from "~/lib/catalog/query";
import { NO_STORE } from "~/lib/http";

import type { Route } from "./+types/api.cart.quote";

const requestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        sku: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
      }),
    )
    .max(MAX_CART_LINES),
  coupon: z.string().max(40).nullable().optional(),
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(NO_STORE);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return Response.json(body, { status, headers });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return json({ error: "invalid_cart", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
  }

  const { items } = parsed.data;
  const couponCode = parsed.data.coupon?.trim() ? parsed.data.coupon.trim() : null;
  const { catalog } = await getContent();
  const [stock, promotions] = await Promise.all([stockLevels(prismicStockBySku(catalog, items)), loadPromotions(couponCode)]);
  const quote = quoteCart(catalog, items, stock);
  const discount = chooseDiscounts({
    lines: discountLines(
      catalog,
      quote.lines.filter((l) => l.quantity > 0),
    ),
    subtotalCents: quote.subtotalCents,
    couponCode: couponCode ? (normalizeCouponCode(couponCode) ?? couponCode) : null,
    coupon: promotions.coupon,
    automatic: promotions.automatic,
    buyer: { now: Date.now(), email: null, priorOrders: null, priorUses: null },
  });
  const response: CartQuoteResponse = {
    quote,
    recommendations: recommendForCart(catalog, [...new Set(items.map((i) => i.productId))]).map(toSummary),
    pickupOnly: items.some((i) => catalog.productsById.get(i.productId)?.shipping.pickupOnly === true),
    discount,
  };
  return json(response);
}
