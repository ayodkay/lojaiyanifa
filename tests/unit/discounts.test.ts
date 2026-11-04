import { describe, expect, it } from "vitest";

import { type BuyerContext, chooseDiscounts, type DiscountLine, evaluatePromotion, normalizeCouponCode, type Promotion } from "~/lib/discounts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: "P",
  name: "interno",
  label: "Promoção",
  code: null,
  kind: "percent",
  value: 10,
  buyQuantity: 0,
  getQuantity: 0,
  scope: { type: "all" },
  minSubtotalCents: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  redemptionCount: 0,
  maxPerCustomer: null,
  firstOrderOnly: false,
  allowedEmails: null,
  active: true,
  ...overrides,
});
const line = (productId: string, unitPriceCents: number, quantity: number, categoryIds: string[] = []): DiscountLine => ({
  productId,
  categoryIds,
  unitPriceCents,
  quantity,
  lineTotalCents: unitPriceCents * quantity,
});
const cart = [line("colar", 12990, 2, ["joias"]), line("pano", 4500, 1, ["tecidos"])]; // 30480
const SUBTOTAL = 30480;
const known: BuyerContext = { now: NOW, email: "maria@exemplo.com", priorOrders: 0, priorUses: new Map() };
const unknown: BuyerContext = { now: NOW, email: null, priorOrders: null, priorUses: null };

describe("evaluatePromotion", () => {
  it("percent of the eligible products, rounded to the centavo", () => {
    expect(evaluatePromotion(promo({ value: 10 }), cart, SUBTOTAL, known)).toEqual({ ok: true, itemsDiscountCents: 3048, freeShipping: false, provisional: false });
    expect(evaluatePromotion(promo({ value: 15, scope: { type: "categories", categoryIds: ["tecidos"] } }), cart, SUBTOTAL, known)).toMatchObject({ itemsDiscountCents: 675 });
  });

  it("a fixed amount never exceeds what the eligible products cost", () => {
    expect(evaluatePromotion(promo({ kind: "fixed", value: 2000 }), cart, SUBTOTAL, known)).toMatchObject({ itemsDiscountCents: 2000 });
    expect(evaluatePromotion(promo({ kind: "fixed", value: 9000, scope: { type: "products", productIds: ["pano"], requireAll: false } }), cart, SUBTOTAL, known)).toMatchObject({ itemsDiscountCents: 4500 });
  });

  it("buy X get Y: the cheapest units of each group are free", () => {
    const three = [line("a", 100, 1), line("b", 80, 1), line("c", 50, 1)];
    expect(evaluatePromotion(promo({ kind: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 }), three, 230, known)).toMatchObject({ itemsDiscountCents: 50 });
    expect(evaluatePromotion(promo({ kind: "buy_x_get_y", buyQuantity: 1, getQuantity: 1 }), [line("a", 100, 4)], 400, known)).toMatchObject({ itemsDiscountCents: 200 });
    expect(evaluatePromotion(promo({ kind: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 }), [line("a", 100, 2)], 200, known)).toEqual({ ok: false, refusal: "no_eligible_items" });
  });

  it("schedule: not before the start, not from the end on", () => {
    expect(evaluatePromotion(promo({ startsAt: NOW + 1 }), cart, SUBTOTAL, known)).toEqual({ ok: false, refusal: "not_started" });
    expect(evaluatePromotion(promo({ endsAt: NOW }), cart, SUBTOTAL, known)).toEqual({ ok: false, refusal: "ended" });
    expect(evaluatePromotion(promo({ startsAt: NOW, endsAt: NOW + 1 }), cart, SUBTOTAL, known).ok).toBe(true);
  });

  it("minimum subtotal, total uses and inactive", () => {
    expect(evaluatePromotion(promo({ minSubtotalCents: SUBTOTAL + 1 }), cart, SUBTOTAL, known)).toEqual({ ok: false, refusal: "min_subtotal" });
    expect(evaluatePromotion(promo({ minSubtotalCents: SUBTOTAL }), cart, SUBTOTAL, known).ok).toBe(true);
    expect(evaluatePromotion(promo({ maxRedemptions: 3, redemptionCount: 3 }), cart, SUBTOTAL, known)).toEqual({ ok: false, refusal: "exhausted" });
    expect(evaluatePromotion(promo({ active: false }), cart, SUBTOTAL, known)).toEqual({ ok: false, refusal: "inactive" });
  });

  it("who buys: provisional while unknown, then decided", () => {
    const first = promo({ firstOrderOnly: true });
    expect(evaluatePromotion(first, cart, SUBTOTAL, unknown)).toMatchObject({ ok: true, provisional: true });
    expect(evaluatePromotion(first, cart, SUBTOTAL, known)).toMatchObject({ ok: true, provisional: false });
    expect(evaluatePromotion(first, cart, SUBTOTAL, { ...known, priorOrders: 1 })).toEqual({ ok: false, refusal: "first_order" });

    const vip = promo({ allowedEmails: ["maria@exemplo.com"] });
    expect(evaluatePromotion(vip, cart, SUBTOTAL, { ...known, email: "MARIA@exemplo.com" }).ok).toBe(true);
    expect(evaluatePromotion(vip, cart, SUBTOTAL, { ...known, email: "joao@exemplo.com" })).toEqual({ ok: false, refusal: "not_allowed" });

    const once = promo({ maxPerCustomer: 1 });
    expect(evaluatePromotion(once, cart, SUBTOTAL, { ...known, priorUses: new Map([["P", 1]]) })).toEqual({ ok: false, refusal: "per_customer" });
  });

  it("a bundle needs every listed product in the cart", () => {
    const bundle = promo({ value: 20, scope: { type: "products", productIds: ["colar", "pano"], requireAll: true } });
    expect(evaluatePromotion(bundle, cart, SUBTOTAL, known)).toMatchObject({ itemsDiscountCents: 6096 });
    expect(evaluatePromotion(bundle, [cart[0]!], 25980, known)).toEqual({ ok: false, refusal: "bundle_incomplete" });
  });
});

describe("chooseDiscounts", () => {
  const coupon = promo({ id: "DEZ", code: "DEZ", label: "Cupom DEZ", value: 10 });
  const auto15 = promo({ id: "auto_a", label: "15% na loja", value: 15 });
  const freeShip = promo({ id: "auto_frete", label: "Frete grátis", kind: "free_shipping", value: 0 });

  it("one products discount — the best for the customer; the beaten coupon is reported", () => {
    const result = chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: "DEZ", coupon, automatic: [auto15], buyer: known });
    expect(result.applied.map((a) => a.promotionId)).toEqual(["auto_a"]);
    expect(result.itemsDiscountCents).toBe(4572);
    expect(result.coupon).toEqual({ state: "not_best", beatenBy: "15% na loja" });
  });

  it("a tie goes to the coupon the customer typed", () => {
    const result = chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: "DEZ", coupon, automatic: [promo({ id: "auto_b", value: 10 })], buyer: known });
    expect(result.applied.map((a) => a.promotionId)).toEqual(["DEZ"]);
    expect(result.coupon).toEqual({ state: "applied" });
  });

  it("free shipping comes on top of a products discount", () => {
    const result = chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: "DEZ", coupon, automatic: [freeShip], buyer: known });
    expect(result.applied.map((a) => [a.promotionId, a.amountCents, a.freeShipping])).toEqual([
      ["DEZ", 3048, false],
      ["auto_frete", 0, true],
    ]);
    expect(result.freeShipping).toBe(true);
  });

  it("an unknown or refused coupon says why, and automatic promotions still apply", () => {
    expect(chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: "XYZ", coupon: null, automatic: [auto15], buyer: known }).coupon).toEqual({
      state: "unknown",
      message: "Cupom não encontrado. Confira o código.",
    });
    const expired = chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: "DEZ", coupon: { ...coupon, endsAt: NOW }, automatic: [auto15], buyer: known });
    expect(expired.coupon).toEqual({ state: "refused", refusal: "ended", message: "Este cupom expirou." });
    expect(expired.applied.map((a) => a.promotionId)).toEqual(["auto_a"]);
  });

  it("a promotion with a code is never applied without its code", () => {
    expect(chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: null, coupon: null, automatic: [coupon], buyer: known }).applied).toEqual([]);
  });

  it("nothing applies: no discount", () => {
    expect(chooseDiscounts({ lines: cart, subtotalCents: SUBTOTAL, couponCode: null, coupon: null, automatic: [], buyer: known })).toEqual({
      applied: [],
      itemsDiscountCents: 0,
      freeShipping: false,
      coupon: null,
    });
  });
});

describe("normalizeCouponCode", () => {
  it("uppercases and trims; refuses anything else", () => {
    expect(normalizeCouponCode("  bemvindo10 ")).toBe("BEMVINDO10");
    expect(normalizeCouponCode("BLACK-FRIDAY")).toBe("BLACK-FRIDAY");
    for (const bad of ["", "ab", "-ABC", "ABC-", "com espaço", "ÇUPOM", "x".repeat(25), 10, null]) expect(normalizeCouponCode(bad)).toBeNull();
  });
});
