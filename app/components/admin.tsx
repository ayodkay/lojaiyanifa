// Small pieces shared by the admin pages.
import { cx } from "~/components/ui";
import { ORDER_STATUS_LABEL, type OrderStatus } from "~/lib/orders";

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

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={cx("inline-block whitespace-nowrap rounded-[var(--radius-control)] border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[status])}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  );
}
