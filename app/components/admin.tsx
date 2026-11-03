// Small pieces shared by the admin pages.
import { cx } from "~/components/ui";
import { orderStatusLabel, type OrderStatus } from "~/lib/orders";
import type { ShippingMethodId } from "~/lib/store-settings";

const STATUS_TONE: Record<OrderStatus, string> = {
  pending_payment: "border-warning/50 text-warning",
  paid: "border-success/50 text-success",
  processing: "border-success/50 text-success",
  shipped: "border-success/50 text-success",
  delivered: "border-success/50 text-success",
  cancelled: "border-line-strong text-muted",
  refunded: "border-line-strong text-muted",
  partially_refunded: "border-line-strong text-muted",
};

/** `method` names pickup orders' steps as the customer lives them ("Pronto para retirada", "Retirado"). */
export function OrderStatusBadge({ status, method }: { status: OrderStatus; method: ShippingMethodId }) {
  return (
    <span className={cx("inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[status])}>
      {orderStatusLabel(status, method)}
    </span>
  );
}
