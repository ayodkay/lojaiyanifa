// Admin orders: list tabs and URL parameters, the cancel form, and the shapes
// the pages receive. Shared by the server (app/.server/admin-orders.ts) and the pages.
import type { RefundReason, RestockLine } from "~/lib/admin/refunds";
import type { Cents } from "~/lib/money";
import type { CustomerOrderView, FulfillmentStage, OrderStatus } from "~/lib/orders";
import type { ShippingMethodId } from "~/lib/store-settings";

/** Order numbers in URLs: digits only, else the page is a 404. */
export function parseOrderNumber(value: string | undefined): number | null {
  return value && /^\d{1,9}$/.test(value) ? Number(value) : null;
}

export const CANCEL_REASONS = ["payment_not_received", "customer_request", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  payment_not_received: "Pagamento não recebido",
  customer_request: "A pedido do cliente",
  other: "Outro motivo",
};
export const CANCEL_NOTE_MAX = 500;

export type CancelForm = { reason: CancelReason; note: string | null };

/** Validates the cancel form. A note is optional, except for "other", which must say why. */
export function parseCancelForm(form: FormData): { ok: true; value: CancelForm } | { ok: false; errors: Partial<Record<keyof CancelForm, string>> } {
  const reason = CANCEL_REASONS.find((r) => r === form.get("reason"));
  const rawNote = form.get("note");
  const note = typeof rawNote === "string" && rawNote.trim() !== "" ? rawNote.trim() : null;
  const errors: Partial<Record<keyof CancelForm, string>> = {};
  if (!reason) errors.reason = "Escolha o motivo do cancelamento.";
  if (note && note.length > CANCEL_NOTE_MAX) errors.note = `Use no máximo ${CANCEL_NOTE_MAX} caracteres.`;
  else if (reason === "other" && !note) errors.note = "Descreva o motivo.";
  return reason && Object.keys(errors).length === 0 ? { ok: true, value: { reason, note } } : { ok: false, errors };
}

/** Who did something to an order, as the admin shows it. */
export interface OrderActor {
  uid: string;
  email: string;
}

export interface AdminTimelineEntry {
  at: string;
  status: OrderStatus;
  by: "customer" | "admin" | "system";
  actor: OrderActor | null;
  note: string | null;
}

/** Internal note on an order: only the team sees it. */
export interface AdminOrderNote {
  id: string;
  at: string;
  by: OrderActor;
  text: string;
}

/** A refund recorded by the team (the money went back through the bank). */
export interface AdminOrderRefund {
  id: string;
  at: string;
  by: OrderActor;
  amountCents: Cents;
  reason: RefundReason;
  note: string | null;
  /** Units put back on sale. */
  restock: RestockLine[];
}

/** Everything the admin may see about an order, including the CPF (needed for the nota fiscal). Dates are ISO strings. */
export interface AdminOrderView extends Omit<CustomerOrderView, "customer" | "payment"> {
  updatedAt: string;
  customer: { name: string; email: string; phone: string; cpf: string; uid: string | null };
  payment: CustomerOrderView["payment"] & { confirmedAt: string | null; confirmedBy: OrderActor | null };
  /** `by` is null when the store cancelled on its own (the Pix deadline passed). */
  cancellation: { at: string; reason: CancelReason; note: string | null; by: OrderActor | null } | null;
  timeline: AdminTimelineEntry[];
  notes: AdminOrderNote[];
  refunds: AdminOrderRefund[];
  /** Units of each stock-tracked SKU that a refund can still put back on sale. */
  restockable: Record<string, number>;
}

/** Tabs: the statuses the store can produce today, in the order an order goes through them, plus everything. */
export const ORDER_FILTERS = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "partially_refunded", "refunded", "all"] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];

export const ORDER_FILTER_LABEL: Record<OrderFilter, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pagos",
  processing: "Em preparação",
  // Pickup orders ready at the store are here too; their rows say "Pronto para retirada".
  shipped: "Enviados",
  delivered: "Entregues",
  cancelled: "Cancelados",
  partially_refunded: "Reembolso parcial",
  refunded: "Reembolsados",
  all: "Todos",
};

/** The work queue: Pix payments to look for in the bank account. */
export const DEFAULT_ORDER_FILTER: OrderFilter = "pending_payment";

export const parseOrderFilter = (value: string | null): OrderFilter => ORDER_FILTERS.find((f) => f === value) ?? DEFAULT_ORDER_FILTER;

/** `before` cursor = an order number; anything else means the first page. */
export const parseOrderCursor = (value: string | null): number | null => parseOrderNumber(value ?? undefined);

export interface AdminOrderRow {
  number: number;
  status: OrderStatus;
  /** ISO dates. */
  createdAt: string;
  expiresAt: string;
  customerName: string;
  customerEmail: string;
  itemCount: number;
  totalCents: Cents;
  shippingMethod: ShippingMethodId;
  /** Shown next to statuses that don't tell the shipping stage (a partial refund). */
  fulfillmentStage: FulfillmentStage;
}
