// Order shapes shared by the server and the pages. Firestore stores orders in
// orders/{number}; pages only ever receive a view without internal fields.
// Lifecycle: docs/architecture.md §4.3.
import type { Cents } from "~/lib/money";
import type { ShippingMethodId } from "~/lib/store-settings";

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Aguardando pagamento",
  paid: "Pagamento confirmado",
  processing: "Em preparação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  partially_refunded: "Reembolsado parcialmente",
};

export interface OrderAddress {
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

export interface OrderLine {
  productId: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  unitPriceCents: Cents;
  quantity: number;
  lineTotalCents: Cents;
}

/** What a customer may see about their order (no CPF, no internal fields). Dates are ISO strings. */
export interface CustomerOrderView {
  number: number;
  status: OrderStatus;
  createdAt: string;
  /** When an unpaid Pix order is cancelled. */
  expiresAt: string;
  customer: { name: string; email: string; phone: string };
  shipping: {
    method: ShippingMethodId;
    label: string;
    priceCents: Cents;
    address: OrderAddress | null;
    pickupAddress: string | null;
    estimateDays: { min: number; max: number } | null;
  };
  lines: OrderLine[];
  totals: { subtotalCents: Cents; shippingCents: Cents; discountCents: Cents; totalCents: Cents; savingsCents: Cents };
  payment: { method: "pix"; status: "pending" | "confirmed"; amountCents: Cents; txid: string; brCode: string };
}
