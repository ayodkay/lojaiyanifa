// POST /api/cart/quote — prices the browser's cart on the server.
// Request:  { "items": [{ "productId": "…", "sku": "…", "quantity": 1 }] }  (JSON, ≤ 50 lines)
// Response: CartQuoteResponse (app/lib/cart/quote.ts). Never cached: prices and stock change.
//
// A plain JSON endpoint called with fetch(), not a React Router fetcher action:
// a fetcher POST would make React Router re-run every loader on the page after
// each quantity change.
import { z } from "zod";

import { stockLevels } from "~/.server/inventory";
import { getContent } from "~/.server/prismic";
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
  const { catalog } = await getContent();
  const stock = await stockLevels(prismicStockBySku(catalog, items));
  const response: CartQuoteResponse = {
    quote: quoteCart(catalog, items, stock),
    recommendations: recommendForCart(catalog, [...new Set(items.map((i) => i.productId))]).map(toSummary),
    pickupOnly: items.some((i) => catalog.productsById.get(i.productId)?.shipping.pickupOnly === true),
  };
  return json(response);
}
