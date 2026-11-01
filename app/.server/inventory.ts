// Stock from Firestore. Document: inventory/{skuDocId(sku)}
//   { sku, productId, onHand, reserved, lowStockThreshold, updatedAt }
// For a SKU without a document, the stock typed in Prismic is the starting
// value (the first order creates the document from it); a SKU with neither is
// not tracked. See docs/architecture.md §4.2 "Stock".
import type { DocumentData } from "firebase-admin/firestore";

import type { StockLevel } from "~/lib/cart/quote";

import { db } from "./firebase";

export const INVENTORY = "inventory";

/**
 * Firestore document ID for a SKU. SKUs are typed by editors, and a "/" would
 * otherwise be read as a sub-path; encodeURIComponent leaves ordinary SKUs
 * (letters, digits, "-", "_", ".") unchanged.
 */
export function skuDocId(sku: string): string {
  const id = encodeURIComponent(sku);
  if (id === "" || id === "." || id === ".." || /^__.*__$/.test(id)) {
    throw new Error(`SKU "${sku}" can't be used as an inventory document ID`);
  }
  return id;
}

export const inventoryRef = (sku: string) => db().collection(INVENTORY).doc(skuDocId(sku));

/** Reads a stock document, refusing corrupt counts instead of guessing. */
export function availableFrom(sku: string, data: DocumentData): number {
  const { onHand, reserved } = data;
  if (!Number.isInteger(onHand) || !Number.isInteger(reserved) || reserved < 0) {
    throw new Error(`${INVENTORY}/${skuDocId(sku)} is corrupt (onHand=${String(onHand)}, reserved=${String(reserved)})`);
  }
  return Math.max(0, onHand - reserved);
}

/**
 * Current stock per SKU, in one Firestore round trip.
 * @param seeds SKU → stock typed in Prismic (null = not tracked in Prismic).
 */
export async function stockLevels(seeds: ReadonlyMap<string, number | null>): Promise<Map<string, StockLevel>> {
  const skus = [...seeds.keys()];
  const levels = new Map<string, StockLevel>();
  if (skus.length === 0) return levels;

  const snapshots = await db().getAll(...skus.map(inventoryRef));
  snapshots.forEach((snap, i) => {
    const sku = skus[i]!;
    const data = snap.data();
    if (data) {
      levels.set(sku, { tracked: true, available: availableFrom(sku, data) });
      return;
    }
    const seed = seeds.get(sku) ?? null;
    levels.set(sku, seed === null ? { tracked: false } : { tracked: true, available: seed });
  });
  return levels;
}
