// The discount engine (docs/architecture.md §4.2 `promotions`): pure, so the cart preview and the order transaction
// apply exactly the same rules. Money in centavos.
//
// What applies to an order (the terms of use, §9, promise this):
// - at most ONE discount on the products: the best for the customer among the coupon typed and the automatic
//   promotions (a tie goes to the coupon);
// - at most ONE free-shipping promotion, which may come on top of the products discount.
// A coupon that is valid but beaten by an automatic promotion is reported ("not_best"), never silently dropped.
//
// Some conditions need to know who buys (first order, specific customers, uses per customer). The cart doesn't know
// yet: there the coupon is "provisional" and the order transaction decides.
import type { Cents } from "~/lib/money";

export const PROMOTION_KINDS = ["percent", "fixed", "free_shipping", "buy_x_get_y"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export type PromotionScope = { type: "all" } | { type: "products"; productIds: string[]; requireAll: boolean } | { type: "categories"; categoryIds: string[] };

export interface Promotion {
  id: string;
  /** Internal name; customers see `label`. */
  name: string;
  /** What the customer sees ("10% em toda a loja"). */
  label: string;
  /** Uppercase coupon code; null = automatic promotion. */
  code: string | null;
  kind: PromotionKind;
  /** percent: 1–100; fixed: centavos; buy_x_get_y and free_shipping: unused (0). */
  value: number;
  buyQuantity: number;
  getQuantity: number;
  scope: PromotionScope;
  minSubtotalCents: Cents | null;
  /** ms since epoch; null = no limit. */
  startsAt: number | null;
  endsAt: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  maxPerCustomer: number | null;
  firstOrderOnly: boolean;
  /** Lowercase e-mails allowed to use it; null = everyone. */
  allowedEmails: string[] | null;
  active: boolean;
}

export interface DiscountLine {
  productId: string;
  categoryIds: string[];
  unitPriceCents: Cents;
  quantity: number;
  lineTotalCents: Cents;
}

/** Who buys, as far as it's known. null fields = unknown yet (the cart): conditions on them stay provisional. */
export interface BuyerContext {
  now: number;
  email: string | null;
  /** Earlier orders of this buyer that weren't cancelled (by e-mail or CPF). */
  priorOrders: number | null;
  /** Earlier orders of this buyer that used each promotion (id → count), not cancelled. */
  priorUses: Map<string, number> | null;
}

export type Refusal =
  | "inactive"
  | "not_started"
  | "ended"
  | "min_subtotal"
  | "exhausted"
  | "per_customer"
  | "first_order"
  | "not_allowed"
  | "no_eligible_items"
  | "bundle_incomplete";

export const REFUSAL_MESSAGE: Record<Refusal, string> = {
  inactive: "Este cupom não está disponível.",
  not_started: "Este cupom ainda não está valendo.",
  ended: "Este cupom expirou.",
  min_subtotal: "O pedido não atinge o valor mínimo deste cupom.",
  exhausted: "Este cupom já foi usado o número máximo de vezes.",
  per_customer: "Você já usou este cupom o número máximo de vezes.",
  first_order: "Este cupom vale só para a primeira compra.",
  not_allowed: "Este cupom não é válido para este e-mail.",
  no_eligible_items: "Nenhum produto do carrinho participa deste cupom.",
  bundle_incomplete: "Este cupom vale para um conjunto de produtos: adicione todos ao carrinho.",
};

export type Evaluation =
  | { ok: true; itemsDiscountCents: Cents; freeShipping: boolean; provisional: boolean }
  | { ok: false; refusal: Refusal };

const eligible = (scope: PromotionScope, line: DiscountLine) =>
  scope.type === "all" ||
  (scope.type === "products" && scope.productIds.includes(line.productId)) ||
  (scope.type === "categories" && line.categoryIds.some((id) => scope.categoryIds.includes(id)));

/** Buy X get Y: in each group of X + Y eligible units (dearest first), the Y cheapest are free. */
function buyXGetYDiscount(lines: DiscountLine[], buy: number, get: number): Cents {
  if (buy < 1 || get < 1) return 0;
  const units = lines.flatMap((l) => Array.from({ length: l.quantity }, () => l.unitPriceCents)).sort((a, b) => b - a);
  let discount = 0;
  for (let start = 0; start + buy + get <= units.length; start += buy + get) {
    discount += units.slice(start + buy, start + buy + get).reduce((sum, price) => sum + price, 0);
  }
  return discount;
}

/** Whether one promotion applies to these lines, and how much it takes off the products. */
export function evaluatePromotion(p: Promotion, lines: DiscountLine[], subtotalCents: Cents, buyer: BuyerContext): Evaluation {
  if (!p.active) return { ok: false, refusal: "inactive" };
  if (p.startsAt !== null && buyer.now < p.startsAt) return { ok: false, refusal: "not_started" };
  if (p.endsAt !== null && buyer.now >= p.endsAt) return { ok: false, refusal: "ended" };
  if (p.minSubtotalCents !== null && subtotalCents < p.minSubtotalCents) return { ok: false, refusal: "min_subtotal" };
  if (p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions) return { ok: false, refusal: "exhausted" };

  let provisional = false;
  if (p.allowedEmails !== null) {
    if (buyer.email === null) provisional = true;
    else if (!p.allowedEmails.includes(buyer.email.toLowerCase())) return { ok: false, refusal: "not_allowed" };
  }
  if (p.firstOrderOnly) {
    if (buyer.priorOrders === null) provisional = true;
    else if (buyer.priorOrders > 0) return { ok: false, refusal: "first_order" };
  }
  if (p.maxPerCustomer !== null) {
    if (buyer.priorUses === null) provisional = true;
    else if ((buyer.priorUses.get(p.id) ?? 0) >= p.maxPerCustomer) return { ok: false, refusal: "per_customer" };
  }

  const scoped = lines.filter((l) => eligible(p.scope, l));
  if (p.scope.type === "products" && p.scope.requireAll && !p.scope.productIds.every((id) => lines.some((l) => l.productId === id))) {
    return { ok: false, refusal: "bundle_incomplete" };
  }
  if (p.kind === "free_shipping") return { ok: true, itemsDiscountCents: 0, freeShipping: true, provisional };
  if (scoped.length === 0) return { ok: false, refusal: "no_eligible_items" };

  const base = scoped.reduce((sum, l) => sum + l.lineTotalCents, 0);
  let amount: Cents;
  switch (p.kind) {
    case "percent":
      amount = Math.round((base * Math.min(100, Math.max(0, p.value))) / 100);
      break;
    case "fixed":
      amount = Math.min(base, Math.max(0, Math.round(p.value)));
      break;
    case "buy_x_get_y":
      amount = buyXGetYDiscount(scoped, p.buyQuantity, p.getQuantity);
      if (amount === 0) return { ok: false, refusal: "no_eligible_items" };
      break;
  }
  return { ok: true, itemsDiscountCents: Math.min(amount, subtotalCents), freeShipping: false, provisional };
}

export interface AppliedDiscount {
  promotionId: string;
  code: string | null;
  label: string;
  kind: PromotionKind;
  /** Taken off the products (0 for free shipping). */
  amountCents: Cents;
  freeShipping: boolean;
  /** The cart can't check it yet (who buys); the order decides. */
  provisional: boolean;
}

export type CouponStatus =
  | { state: "applied" }
  | { state: "not_best"; beatenBy: string }
  | { state: "refused"; refusal: Refusal; message: string }
  | { state: "unknown"; message: string };

export interface DiscountResult {
  applied: AppliedDiscount[];
  itemsDiscountCents: Cents;
  freeShipping: boolean;
  coupon: CouponStatus | null;
}

const toApplied = (p: Promotion, e: Extract<Evaluation, { ok: true }>): AppliedDiscount => ({
  promotionId: p.id,
  code: p.code,
  label: p.label,
  kind: p.kind,
  amountCents: e.itemsDiscountCents,
  freeShipping: e.freeShipping,
  provisional: e.provisional,
});

/**
 * Picks what applies. `coupon` is the promotion found for the typed code (null when none was typed or found —
 * `couponCode` tells which); `automatic` are the promotions without a code.
 */
export function chooseDiscounts(input: {
  lines: DiscountLine[];
  subtotalCents: Cents;
  couponCode: string | null;
  coupon: Promotion | null;
  automatic: Promotion[];
  buyer: BuyerContext;
}): DiscountResult {
  const { lines, subtotalCents, couponCode, coupon, automatic, buyer } = input;
  type Candidate = { promotion: Promotion; evaluation: Extract<Evaluation, { ok: true }>; isCoupon: boolean };
  const candidates: Candidate[] = [];
  let couponStatus: CouponStatus | null = null;

  if (couponCode) {
    if (!coupon) couponStatus = { state: "unknown", message: "Cupom não encontrado. Confira o código." };
    else {
      const evaluation = evaluatePromotion(coupon, lines, subtotalCents, buyer);
      if (evaluation.ok) candidates.push({ promotion: coupon, evaluation, isCoupon: true });
      else couponStatus = { state: "refused", refusal: evaluation.refusal, message: REFUSAL_MESSAGE[evaluation.refusal] };
    }
  }
  for (const p of automatic) {
    if (p.code !== null) continue;
    const evaluation = evaluatePromotion(p, lines, subtotalCents, buyer);
    if (evaluation.ok) candidates.push({ promotion: p, evaluation, isCoupon: false });
  }

  // The coupon is the first candidate and only a strictly larger discount replaces the best so far, so a tie keeps the
  // coupon the customer typed.
  const best = (list: Candidate[]) => list.reduce<Candidate | null>((top, c) => (!top || c.evaluation.itemsDiscountCents > top.evaluation.itemsDiscountCents ? c : top), null);
  const itemsPick = best(candidates.filter((c) => !c.evaluation.freeShipping && c.evaluation.itemsDiscountCents > 0));
  const shippingPick = candidates.find((c) => c.evaluation.freeShipping && c.isCoupon) ?? candidates.find((c) => c.evaluation.freeShipping) ?? null;

  const applied = [itemsPick, shippingPick].filter((c): c is Candidate => c !== null).map((c) => toApplied(c.promotion, c.evaluation));
  if (couponCode && coupon && !couponStatus) {
    const used = applied.some((a) => a.promotionId === coupon.id);
    couponStatus = used ? { state: "applied" } : { state: "not_best", beatenBy: itemsPick?.promotion.label ?? "" };
  }
  return {
    applied,
    itemsDiscountCents: itemsPick?.evaluation.itemsDiscountCents ?? 0,
    freeShipping: shippingPick !== null,
    coupon: couponStatus,
  };
}

/** A coupon code as stored: trimmed, uppercase, letters/digits/hyphen only (3–24). null if it can't be one. */
export function normalizeCouponCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/.test(code) ? code : null;
}
