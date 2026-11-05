// The admin's promotion form (/admin/discounts): parsing and checks shared by the page and the server. Amounts come
// from `<input type="number" step="0.01">` (reais with a dot); dates from `<input type="datetime-local">`, read as
// Brasília time (UTC−3; Brazil has had no daylight saving since 2019).
import { normalizeCouponCode, PROMOTION_KINDS, type PromotionKind, type PromotionScope } from "~/lib/discounts";
import type { Cents } from "~/lib/money";
import { parseDecimalToCents } from "~/lib/money";

export interface PromotionInput {
  name: string;
  label: string;
  code: string | null;
  kind: PromotionKind;
  value: number;
  buyQuantity: number;
  getQuantity: number;
  scope: PromotionScope;
  minSubtotalCents: Cents | null;
  startsAt: number | null;
  endsAt: number | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  firstOrderOnly: boolean;
  allowedEmails: string[] | null;
  active: boolean;
}

export const KIND_LABEL: Record<PromotionKind, string> = {
  percent: "Porcentagem nos produtos",
  fixed: "Valor fixo nos produtos",
  free_shipping: "Frete grátis",
  buy_x_get_y: "Leve X, ganhe Y",
};

/** "2026-11-28T00:00" (Brasília) → ms since epoch, or null. */
export function parseBrasiliaDateTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00-03:00`);
  return Number.isNaN(ms) ? null : ms;
}

/** ms since epoch → the datetime-local value in Brasília time (for editing). */
export function toBrasiliaInput(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms - 3 * 3_600_000).toISOString().slice(0, 16);
}

export type PromotionForm = { ok: true; value: PromotionInput } | { ok: false; errors: Record<string, string> };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `existingCode`: when editing, the stored code (a coupon's code can't change). */
export function parsePromotionForm(form: FormData, existingCode: string | null | undefined = undefined): PromotionForm {
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v.trim() : "";
  };
  const errors: Record<string, string> = {};
  const optionalInt = (key: string, min: number, message: string): number | null => {
    const raw = text(key);
    if (!raw) return null;
    if (!/^\d{1,7}$/.test(raw) || Number(raw) < min) {
      errors[key] = message;
      return null;
    }
    return Number(raw);
  };

  const name = text("name");
  if (!name || name.length > 80) errors.name = "Dê um nome interno (até 80 caracteres).";
  const label = text("label");
  if (!label || label.length > 80) errors.label = "Escreva o que o cliente vê (até 80 caracteres).";

  let code: string | null = null;
  if (existingCode !== undefined) code = existingCode; // editing: kept as it is
  else if (text("type") === "coupon") {
    code = normalizeCouponCode(text("code"));
    if (!code) errors.code = "Código de 3 a 24 letras, números ou hífens (sem acentos nem espaços).";
  } else if (text("type") !== "automatic") errors.type = "Escolha cupom ou promoção automática.";

  const kind = text("kind") as PromotionKind;
  if (!(PROMOTION_KINDS as readonly string[]).includes(kind)) errors.kind = "Escolha o tipo de desconto.";
  let value = 0;
  if (kind === "percent") {
    value = Number(text("percent"));
    if (!Number.isInteger(value) || value < 1 || value > 99) errors.percent = "Use uma porcentagem inteira de 1 a 99.";
  } else if (kind === "fixed") {
    const cents = parseDecimalToCents(text("amount"));
    if (cents === null || cents < 1) errors.amount = "Informe o valor em reais, ex.: 20.00.";
    else value = cents;
  }
  let buyQuantity = 0;
  let getQuantity = 0;
  if (kind === "buy_x_get_y") {
    buyQuantity = Number(text("buyQuantity"));
    getQuantity = Number(text("getQuantity"));
    if (!Number.isInteger(buyQuantity) || buyQuantity < 1 || buyQuantity > 20) errors.buyQuantity = "De 1 a 20.";
    if (!Number.isInteger(getQuantity) || getQuantity < 1 || getQuantity > 20) errors.getQuantity = "De 1 a 20.";
  }

  let scope: PromotionScope = { type: "all" };
  const scopeType = text("scope");
  if (scopeType === "products") {
    const productIds = form.getAll("productIds").filter((v): v is string => typeof v === "string" && v.length > 0);
    if (productIds.length === 0) errors.productIds = "Escolha pelo menos um produto.";
    scope = { type: "products", productIds, requireAll: form.get("requireAll") === "on" };
  } else if (scopeType === "categories") {
    const categoryIds = form.getAll("categoryIds").filter((v): v is string => typeof v === "string" && v.length > 0);
    if (categoryIds.length === 0) errors.categoryIds = "Escolha pelo menos uma categoria.";
    scope = { type: "categories", categoryIds };
  } else if (scopeType !== "all") errors.scope = "Escolha onde o desconto vale.";

  let minSubtotalCents: Cents | null = null;
  if (text("minSubtotal")) {
    minSubtotalCents = parseDecimalToCents(text("minSubtotal"));
    if (minSubtotalCents === null) errors.minSubtotal = "Informe o valor em reais, ex.: 150.00.";
  }
  const startsAt = text("startsAt") ? parseBrasiliaDateTime(text("startsAt")) : null;
  if (text("startsAt") && startsAt === null) errors.startsAt = "Data e hora inválidas.";
  const endsAt = text("endsAt") ? parseBrasiliaDateTime(text("endsAt")) : null;
  if (text("endsAt") && endsAt === null) errors.endsAt = "Data e hora inválidas.";
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) errors.endsAt = "O fim precisa ser depois do início.";

  const maxRedemptions = optionalInt("maxRedemptions", 1, "Um número inteiro a partir de 1, ou vazio para ilimitado.");
  const maxPerCustomer = optionalInt("maxPerCustomer", 1, "Um número inteiro a partir de 1, ou vazio para ilimitado.");

  let allowedEmails: string[] | null = null;
  if (text("allowedEmails")) {
    const emails = [...new Set(text("allowedEmails").toLowerCase().split(/[\s,;]+/).filter(Boolean))];
    const bad = emails.find((e) => !EMAIL.test(e));
    if (bad) errors.allowedEmails = `E-mail inválido: ${bad}`;
    else if (emails.length > 500) errors.allowedEmails = "No máximo 500 e-mails.";
    else allowedEmails = emails;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      label,
      code,
      kind,
      value,
      buyQuantity,
      getQuantity,
      scope,
      minSubtotalCents,
      startsAt,
      endsAt,
      maxRedemptions,
      maxPerCustomer,
      firstOrderOnly: form.get("firstOrderOnly") === "on",
      allowedEmails,
      active: form.get("active") === "on",
    },
  };
}
