// Promotions and coupons in Firestore (`promotions/{id}`), around the pure engine in app/lib/discounts.ts.
// Coupons are stored under their code (unique by construction); automatic promotions under "auto_…".
//
// Use limits: `redemptionCount` goes up in the order's transaction and down again when that order is cancelled
// unpaid (store or expiry job), in the cancellation's transaction — a counter both transactions read and write, so two
// simultaneous orders can't both take a coupon's last use.
import { randomUUID } from "node:crypto";

import { type DocumentData, type DocumentSnapshot, Timestamp, type Transaction } from "firebase-admin/firestore";

import type { PromotionInput } from "~/lib/admin/promotions";
import { type BuyerContext, type DiscountLine, normalizeCouponCode, type Promotion } from "~/lib/discounts";
import type { Catalog } from "~/lib/catalog/query";
import { categoryProducts } from "~/lib/catalog/query";

import { writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import type { AdminUser } from "./session";

const promotions = () => db().collection("promotions");
export const promotionRef = (id: string) => promotions().doc(id);

const ms = (value: unknown): number | null => (value && typeof (value as Timestamp).toMillis === "function" ? (value as Timestamp).toMillis() : null);

export function toPromotion(id: string, d: DocumentData): Promotion {
  return {
    id,
    name: d.name,
    label: d.label,
    code: d.code ?? null,
    kind: d.kind,
    value: d.value ?? 0,
    buyQuantity: d.buyQuantity ?? 0,
    getQuantity: d.getQuantity ?? 0,
    scope: d.scope ?? { type: "all" },
    minSubtotalCents: d.minSubtotalCents ?? null,
    startsAt: ms(d.startsAt),
    endsAt: ms(d.endsAt),
    maxRedemptions: d.maxRedemptions ?? null,
    redemptionCount: d.redemptionCount ?? 0,
    maxPerCustomer: d.maxPerCustomer ?? null,
    firstOrderOnly: d.firstOrderOnly === true,
    allowedEmails: d.allowedEmails ?? null,
    active: d.active === true,
  };
}

/** Every category that holds each product (subcategories count for their parents). */
export function productCategoryIds(catalog: Catalog): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const category of catalog.categories) {
    if (category.showAll) continue; // "show all" holds everything by definition, not by choice
    for (const p of categoryProducts(catalog, category.id)) map.set(p.id, [...(map.get(p.id) ?? []), category.id]);
  }
  return map;
}

export function discountLines(catalog: Catalog, lines: { productId: string; unitPriceCents: number | null; quantity: number; lineTotalCents: number }[]): DiscountLine[] {
  const categories = productCategoryIds(catalog);
  return lines.map((l) => ({
    productId: l.productId,
    categoryIds: categories.get(l.productId) ?? [],
    unitPriceCents: l.unitPriceCents ?? 0,
    quantity: l.quantity,
    lineTotalCents: l.lineTotalCents,
  }));
}

/** The coupon for a typed code (null if the code can't exist or isn't stored) and the automatic promotions. */
export async function loadPromotions(couponCode: string | null): Promise<{ coupon: Promotion | null; automatic: Promotion[] }> {
  const code = normalizeCouponCode(couponCode);
  const [couponSnap, autoSnap] = await Promise.all([
    code ? promotionRef(code).get() : null,
    promotions().where("code", "==", null).where("active", "==", true).get(),
  ]);
  return {
    coupon: couponSnap?.exists && couponSnap.get("code") === code ? toPromotion(couponSnap.id, couponSnap.data()!) : null,
    automatic: autoSnap.docs.map((d) => toPromotion(d.id, d.data())),
  };
}

/** The same, inside the order transaction: every promotion read here is part of the transaction's read set. */
export async function loadPromotionsInTransaction(
  tx: Transaction,
  couponCode: string | null,
): Promise<{ coupon: Promotion | null; automatic: Promotion[]; snapshots: Map<string, DocumentSnapshot> }> {
  const code = normalizeCouponCode(couponCode);
  const [couponSnap, autoSnap] = await Promise.all([code ? tx.get(promotionRef(code)) : null, tx.get(promotions().where("code", "==", null).where("active", "==", true))]);
  const snapshots = new Map<string, DocumentSnapshot>();
  if (couponSnap?.exists) snapshots.set(couponSnap.id, couponSnap);
  for (const d of autoSnap.docs) snapshots.set(d.id, d);
  return {
    coupon: couponSnap?.exists && couponSnap.get("code") === code ? toPromotion(couponSnap.id, couponSnap.data()!) : null,
    automatic: autoSnap.docs.map((d) => toPromotion(d.id, d.data())),
    snapshots,
  };
}

/** Who buys, from their earlier orders (same e-mail or same CPF) that weren't cancelled. */
export async function buyerInTransaction(tx: Transaction, email: string, cpf: string, now: Date): Promise<BuyerContext> {
  const orders = db().collection("orders");
  const [byEmail, byCpf] = await Promise.all([tx.get(orders.where("customer.email", "==", email).limit(500)), tx.get(orders.where("customer.cpf", "==", cpf).limit(500))]);
  const seen = new Map<number, DocumentData>();
  for (const d of [...byEmail.docs, ...byCpf.docs]) if (d.get("status") !== "cancelled") seen.set(d.get("number") as number, d.data());
  const priorUses = new Map<string, number>();
  for (const order of seen.values()) {
    for (const discount of (order.discounts ?? []) as { promotionId: string }[]) priorUses.set(discount.promotionId, (priorUses.get(discount.promotionId) ?? 0) + 1);
  }
  return { now: now.getTime(), email, priorOrders: seen.size, priorUses };
}

/** Counts one use of each promotion an order applied (call after the transaction's reads). */
export function redeemInTransaction(tx: Transaction, snapshots: Map<string, DocumentSnapshot>, promotionIds: string[], now: Date): void {
  for (const id of promotionIds) {
    const snap = snapshots.get(id);
    if (!snap?.exists) throw new Error(`promotions/${id} was applied but not read in this transaction`);
    tx.update(snap.ref, { redemptionCount: ((snap.get("redemptionCount") as number | undefined) ?? 0) + 1, updatedAt: Timestamp.fromDate(now) });
  }
}

/** Reads the promotions an order used, so a cancellation can give their uses back (reads first, then `releaseRedemptions`). */
export async function readOrderPromotions(tx: Transaction, order: DocumentData): Promise<DocumentSnapshot[]> {
  const ids = [...new Set(((order.discounts ?? []) as { promotionId: string }[]).map((d) => d.promotionId))];
  return ids.length ? tx.getAll(...ids.map(promotionRef)) : [];
}

export function releaseRedemptions(tx: Transaction, snapshots: DocumentSnapshot[], now: Date): void {
  for (const snap of snapshots) {
    if (!snap.exists) continue; // deleted since: nothing to give back
    const count = (snap.get("redemptionCount") as number | undefined) ?? 0;
    tx.update(snap.ref, { redemptionCount: Math.max(0, count - 1), updatedAt: Timestamp.fromDate(now) });
  }
}

// --- admin ---------------------------------------------------------------------------------------

export interface AdminPromotion extends Promotion {
  updatedAt: string | null;
}

export async function listPromotions(): Promise<AdminPromotion[]> {
  const snap = await promotions().orderBy("createdAt", "desc").limit(200).get();
  return snap.docs.map((d) => ({ ...toPromotion(d.id, d.data()), updatedAt: d.get("updatedAt") ? (d.get("updatedAt") as Timestamp).toDate().toISOString() : null }));
}

export async function getPromotion(id: string): Promise<AdminPromotion | null> {
  const d = await promotionRef(id).get();
  return d.exists ? { ...toPromotion(d.id, d.data()!), updatedAt: d.get("updatedAt") ? (d.get("updatedAt") as Timestamp).toDate().toISOString() : null } : null;
}

export class PromotionCodeTakenError extends Error {
  override name = "PromotionCodeTakenError";
}

/**
 * Creates (id = null) or edits a promotion. A coupon's ID is its code, so the code can't change after creation (a new
 * coupon is a new code); the use count is never touched here. Audited.
 */
export async function savePromotion(id: string | null, input: PromotionInput, actor: AdminUser, now = new Date()): Promise<string> {
  const newId = id ?? (input.code ?? `auto_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
  const ref = promotionRef(newId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (id === null && snap.exists) throw new PromotionCodeTakenError(`promotions/${newId} exists`);
    if (id !== null && !snap.exists) throw new Error(`promotions/${id} does not exist`);
    if (id !== null && (snap.get("code") ?? null) !== input.code) throw new Error("a coupon's code can't change; create a new coupon");
    const ts = Timestamp.fromDate(now);
    const fields = {
      name: input.name,
      label: input.label,
      code: input.code,
      kind: input.kind,
      value: input.value,
      buyQuantity: input.buyQuantity,
      getQuantity: input.getQuantity,
      scope: input.scope,
      minSubtotalCents: input.minSubtotalCents,
      startsAt: input.startsAt ? Timestamp.fromMillis(input.startsAt) : null,
      endsAt: input.endsAt ? Timestamp.fromMillis(input.endsAt) : null,
      maxRedemptions: input.maxRedemptions,
      maxPerCustomer: input.maxPerCustomer,
      firstOrderOnly: input.firstOrderOnly,
      allowedEmails: input.allowedEmails,
      active: input.active,
      updatedAt: ts,
      updatedBy: { uid: actor.uid, email: actor.email },
    };
    if (snap.exists) tx.update(ref, fields);
    else tx.create(ref, { ...fields, redemptionCount: 0, createdAt: ts, createdBy: { uid: actor.uid, email: actor.email } });
    writeAuditInTransaction(tx, { action: snap.exists ? "promotion.updated" : "promotion.created", actor, target: `promotions/${newId}`, details: { name: input.name, code: input.code, kind: input.kind, value: input.value, active: input.active } }, now);
  });
  return newId;
}
