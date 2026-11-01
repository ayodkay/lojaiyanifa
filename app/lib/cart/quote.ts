// Prices a cart from the catalog (Prismic) and stock levels (Firestore).
// Pure: no I/O, so it is unit tested and reused by checkout and order creation.
//
// The browser only sends { productId, sku, quantity }. Every name, price and
// limit below comes from the server's catalog, so a tampered cart can't change
// what is charged.
//
// Stock rules (docs/architecture.md §4.2 "Stock"):
// - limits apply only to lines whose availability is "in_stock" and whose SKU is
//   tracked; pre-order and backorder can be ordered beyond stock;
// - an untracked SKU (no Firestore inventory and no stock typed in Prismic) has
//   no quantity limit.
import type { Catalog, ProductSummary } from "~/lib/catalog/query";
import type { Availability, CatalogImage, CatalogProduct } from "~/lib/catalog/types";
import type { Cents } from "~/lib/money";

import { MAX_LINE_QUANTITY } from "./limits";

export interface CartLineInput {
  productId: string;
  sku: string;
  quantity: number;
}

/** Stock for one SKU. `available` is what can still be sold (on hand minus reserved). */
export type StockLevel = { tracked: false } | { tracked: true; available: number };

export type LineProblem =
  /** Product or variant no longer exists, has no price, or isn't for sale. */
  | "unavailable"
  /** Tracked stock is exhausted. */
  | "out_of_stock"
  /** Fewer units left than requested: the quantity was lowered to what exists. */
  | "quantity_reduced";

export interface QuoteLine {
  sku: string;
  productId: string;
  /** null when the product no longer exists in the catalog. */
  uid: string | null;
  name: string;
  variantName: string | null;
  image: CatalogImage | null;
  /** null when the product no longer exists. Stock is only reserved for "in_stock" lines. */
  availability: Availability | null;
  unitPriceCents: Cents | null;
  /** Compare-at unit price, only when there is a real discount. */
  originalUnitPriceCents: Cents | null;
  requestedQuantity: number;
  /** Units that can be bought now (0 when the line can't be bought at all). */
  quantity: number;
  /** Upper bound for the quantity selector. */
  maxQuantity: number;
  lineTotalCents: Cents;
  problem: LineProblem | null;
  /** Variants of the same product the customer can switch this line to. */
  variantChoices: { sku: string; name: string; purchasable: boolean }[];
}

export interface CartQuote {
  lines: QuoteLine[];
  /** Units that can be bought now. */
  itemCount: number;
  subtotalCents: Cents;
  /** Compare-at savings already included in the subtotal (shown, not subtracted again). */
  savingsCents: Cents;
  totalCents: Cents;
  /** Every line can be bought exactly as requested. */
  ready: boolean;
}

/** Body of POST /api/cart/quote. */
export interface CartQuoteResponse {
  quote: CartQuote;
  recommendations: ProductSummary[];
  /** A product in the cart is "pickup only" in Prismic: delivery can't be offered. */
  pickupOnly: boolean;
}

/** Sums duplicate SKUs (e.g. two tabs added the same item), capped per line. */
export function mergeLines(items: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      // Callers validate input first; reaching this is a programming error, not a customer error.
      throw new Error(`mergeLines: quantity must be a whole number ≥ 1, got ${item.quantity} for SKU "${item.sku}"`);
    }
    const existing = merged.get(item.sku);
    if (existing) existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + item.quantity);
    else merged.set(item.sku, { ...item, quantity: Math.min(MAX_LINE_QUANTITY, item.quantity) });
  }
  return [...merged.values()];
}

interface Resolved {
  product: CatalogProduct;
  variantName: string | null;
  image: CatalogImage | null;
  priceCents: Cents | null;
  originalCents: Cents | null;
  availability: Availability;
  purchasable: boolean;
}

/** The catalog entry a line refers to, or null when the SKU doesn't belong to the product. */
function resolve(product: CatalogProduct, sku: string): Resolved | null {
  if (product.variants.length > 0) {
    const variant = product.variants.find((v) => v.sku === sku);
    if (!variant) return null;
    return {
      product,
      variantName: variant.name,
      image: variant.image ?? product.images[0] ?? null,
      priceCents: variant.priceCents,
      originalCents: null,
      availability: variant.availability,
      purchasable: variant.purchasable,
    };
  }
  if (product.sku !== sku) return null;
  return {
    product,
    variantName: null,
    image: product.images[0] ?? null,
    priceCents: product.priceCents,
    originalCents: product.originalPriceCents,
    availability: product.availability,
    purchasable: product.purchasable,
  };
}

/** SKU → Prismic stock (the seed used when Firestore has no inventory document yet). */
export function prismicStockBySku(catalog: Catalog, items: CartLineInput[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const { productId, sku } of items) {
    const product = catalog.productsById.get(productId);
    if (!product) continue;
    const stock = product.variants.length > 0 ? product.variants.find((v) => v.sku === sku)?.prismicStock : product.sku === sku ? product.prismicStock : undefined;
    if (stock !== undefined) out.set(sku, stock);
  }
  return out;
}

export function quoteCart(catalog: Catalog, items: CartLineInput[], stock: ReadonlyMap<string, StockLevel>): CartQuote {
  const lines = mergeLines(items).map((item): QuoteLine => {
    const product = catalog.productsById.get(item.productId);
    const resolved = product ? resolve(product, item.sku) : null;
    const variantChoices = product
      ? product.variants.map((v) => ({ sku: v.sku, name: v.name, purchasable: v.purchasable }))
      : [];

    const base = {
      sku: item.sku,
      productId: item.productId,
      uid: product?.uid ?? null,
      name: product?.name ?? "Produto indisponível",
      variantName: resolved?.variantName ?? null,
      image: resolved?.image ?? product?.images[0] ?? null,
      availability: resolved?.availability ?? null,
      requestedQuantity: item.quantity,
      variantChoices,
    };

    if (!resolved || !resolved.purchasable || resolved.priceCents === null) {
      return {
        ...base,
        unitPriceCents: resolved?.priceCents ?? null,
        originalUnitPriceCents: null,
        quantity: 0,
        maxQuantity: 0,
        lineTotalCents: 0,
        problem: "unavailable",
      };
    }

    let limit = MAX_LINE_QUANTITY;
    if (resolved.availability === "in_stock") {
      const level = stock.get(item.sku);
      if (!level) throw new Error(`quoteCart: no stock level supplied for SKU "${item.sku}"`);
      if (level.tracked) limit = Math.min(limit, Math.max(0, level.available));
    }

    const quantity = Math.min(item.quantity, limit);
    const problem: LineProblem | null = limit === 0 ? "out_of_stock" : quantity < item.quantity ? "quantity_reduced" : null;
    return {
      ...base,
      unitPriceCents: resolved.priceCents,
      originalUnitPriceCents: resolved.originalCents,
      quantity,
      maxQuantity: limit,
      lineTotalCents: quantity * resolved.priceCents,
      problem,
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const savingsCents = lines.reduce(
    (sum, l) =>
      l.originalUnitPriceCents !== null && l.unitPriceCents !== null && l.originalUnitPriceCents > l.unitPriceCents
        ? sum + (l.originalUnitPriceCents - l.unitPriceCents) * l.quantity
        : sum,
    0,
  );
  return {
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotalCents,
    savingsCents,
    totalCents: subtotalCents,
    ready: lines.length > 0 && lines.every((l) => l.problem === null),
  };
}

/** "Complete your order": bought-together picks first, then related products; never items already in the cart. */
export function recommendForCart(catalog: Catalog, productIds: string[], limit = 4): CatalogProduct[] {
  const inCart = new Set(productIds);
  const cartProducts = productIds.map((id) => catalog.productsById.get(id)).filter((p): p is CatalogProduct => Boolean(p));
  const candidateIds = [...cartProducts.flatMap((p) => p.boughtTogetherIds), ...cartProducts.flatMap((p) => p.relatedIds)];
  const out: CatalogProduct[] = [];
  for (const id of candidateIds) {
    const candidate = catalog.productsById.get(id);
    if (!candidate || !candidate.purchasable || inCart.has(id) || out.includes(candidate)) continue;
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}
