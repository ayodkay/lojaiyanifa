// Recording refunds (docs/architecture.md §4.3, §5). The money goes back
// through the owner's bank app; the admin records it here: how much, why, and
// which units return to stock. Owner decisions 2026-11-02:
// - a full refund → "refunded" (final); a partial one → "partially_refunded",
//   and preparing/shipping goes on in `fulfillment`;
// - stock: chosen per item; by default every unit before the order ships, none after.
// Shared by the order page and the server (app/.server/order-refunds.ts).
import { type Cents, parseDecimalToCents } from "~/lib/money";
import type { FulfillmentStage, OrderStatus } from "~/lib/orders";
import type { ShippingMethodId } from "~/lib/store-settings";

export const REFUND_REASONS = ["customer_request", "out_of_stock", "defective", "delivery_problem", "other"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];
export const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  customer_request: "A pedido do cliente (desistência)",
  out_of_stock: "Produto em falta",
  defective: "Produto com defeito ou avariado",
  delivery_problem: "Problema na entrega",
  other: "Outro motivo",
};
export const REFUND_NOTE_MAX = 500;

/** A payment exists and isn't fully refunded yet. */
const REFUNDABLE: readonly OrderStatus[] = ["paid", "processing", "shipped", "delivered", "partially_refunded"];
export const canRefund = (status: OrderStatus): boolean => REFUNDABLE.includes(status);

export interface RestockLine {
  sku: string;
  quantity: number;
}

/**
 * Units of each stock-tracked SKU that can still go back on sale: what the
 * order took from stock (its reservations, sold when the Pix was confirmed)
 * minus what earlier refunds already put back. SKUs that don't track stock
 * have no entry.
 */
export function restockable(sold: readonly RestockLine[], earlier: readonly { restock: readonly RestockLine[] }[]): Map<string, number> {
  const left = new Map(sold.map((line) => [line.sku, line.quantity]));
  for (const refund of earlier) {
    for (const line of refund.restock) left.set(line.sku, (left.get(line.sku) ?? 0) - line.quantity);
  }
  return left;
}

/**
 * Before the order leaves the store, its units are still there; after, they come back only if returned.
 * A delivery order leaves when shipped; a pickup order when the customer picks it up ("shipped" = ready at the counter).
 */
export const restockByDefault = (stage: FulfillmentStage, method: ShippingMethodId): boolean =>
  method === "pickup" ? stage !== "delivered" : stage === "unfulfilled" || stage === "processing";

/** A full refund ends the order; anything less leaves it partially refunded. */
export function statusAfterRefund(paidCents: Cents, refundedBefore: Cents, amountCents: Cents): "refunded" | "partially_refunded" {
  return refundedBefore + amountCents >= paidCents ? "refunded" : "partially_refunded";
}

export interface RefundInput {
  /** One per rendering of the form: a repeated submission (double click) records nothing new. */
  key: string;
  amountCents: Cents;
  reason: RefundReason;
  note: string | null;
  /** Only lines with quantity > 0. */
  restock: RestockLine[];
}

export type RefundErrors = Partial<Record<"key" | "amount" | "reason" | "note" | "restock" | "confirmed", string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Field name of the restock quantity for a SKU. */
export const restockField = (sku: string) => `restock:${sku}`;

export function parseRefundForm(
  form: FormData,
  limits: { remainingCents: Cents; restockable: ReadonlyMap<string, number> },
): { ok: true; value: RefundInput } | { ok: false; errors: RefundErrors } {
  const errors: RefundErrors = {};
  const key = form.get("key");
  if (typeof key !== "string" || !UUID.test(key)) errors.key = "O formulário expirou. Recarregue a página e tente de novo.";

  const rawAmount = form.get("amount");
  const amountCents = typeof rawAmount === "string" ? parseDecimalToCents(rawAmount) : null;
  if (amountCents === null || amountCents < 1) errors.amount = "Informe o valor devolvido, por exemplo 129,90.";
  else if (amountCents > limits.remainingCents) errors.amount = "O valor passa do que ainda pode ser reembolsado neste pedido.";

  const reason = REFUND_REASONS.find((r) => r === form.get("reason"));
  if (!reason) errors.reason = "Escolha o motivo do reembolso.";
  const rawNote = form.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote.trim() : null;
  if (note && note.length > REFUND_NOTE_MAX) errors.note = `Use no máximo ${REFUND_NOTE_MAX} caracteres.`;
  else if (reason === "other" && !note) errors.note = "Descreva o motivo.";

  const restock: RestockLine[] = [];
  for (const [sku, max] of limits.restockable) {
    const raw = form.get(restockField(sku));
    const quantity = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : 0;
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > max) {
      errors.restock = `A quantidade que volta ao estoque de ${sku} deve ficar entre 0 e ${max}.`;
    } else if (quantity > 0) {
      restock.push({ sku, quantity });
    }
  }

  if (form.get("confirmed") !== "yes") errors.confirmed = "Marque a caixa confirmando que o valor já foi devolvido pelo banco.";

  return Object.keys(errors).length === 0 && reason && amountCents !== null && typeof key === "string"
    ? { ok: true, value: { key, amountCents, reason, note, restock } }
    : { ok: false, errors };
}
