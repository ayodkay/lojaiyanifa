// /admin/orders — orders by status, newest first. The default tab is the work
// queue: Pix payments to look for in the bank account. Pix orders past their
// deadline are flagged until the expiry job (every 15 minutes) cancels them.
import { Link } from "react-router";

import { countOrders, listOrders } from "~/.server/admin-orders";
import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import { OrderStatusBadge } from "~/components/admin";
import { cx } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";
import {
  type AdminOrderRow,
  DEFAULT_ORDER_FILTER,
  ORDER_FILTER_LABEL,
  ORDER_FILTERS,
  type OrderFilter,
  parseOrderCursor,
  parseOrderFilter,
} from "~/lib/admin/orders";
import { formatBRL } from "~/lib/money";
import { orderStatusLabel } from "~/lib/orders";

import type { Route } from "./+types/admin.orders";

export async function loader({ request, context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "orders.view");
  const url = new URL(request.url);
  const filter = parseOrderFilter(url.searchParams.get("status"));
  const before = parseOrderCursor(url.searchParams.get("before"));
  const [page, counts] = await Promise.all([listOrders(filter, before), countOrders()]);
  // "Overdue" is decided with the server's clock, so the page renders the same everywhere.
  return { filter, before, page, counts, now: Date.now() };
}

export const meta = () => adminMeta("Pedidos");

const filterHref = (filter: OrderFilter) => (filter === DEFAULT_ORDER_FILTER ? "/admin/orders" : `/admin/orders?status=${filter}`);
const SHIPPING_SHORT = { flat_rate: "Entrega", pickup: "Retirada" } as const;

export default function AdminOrders({ loaderData }: Route.ComponentProps) {
  const { filter, before, page, counts, now } = loaderData;
  const base = filterHref(filter);
  const withCursor = (cursor: number) => `${base}${base.includes("?") ? "&" : "?"}before=${cursor}`;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-4xl">Pedidos</h1>

      <nav aria-label="Filtrar pedidos por situação">
        <ul className="flex flex-wrap gap-2">
          {ORDER_FILTERS.map((f) => (
            <li key={f}>
              <Link
                to={filterHref(f)}
                aria-current={f === filter ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm",
                  f === filter ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink",
                )}
              >
                {ORDER_FILTER_LABEL[f]}
                <span className={cx("tabular-nums", f === filter ? "text-paper/80" : "text-muted")}>{counts[f]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {page.rows.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-8 text-center text-muted">
          {before === null ? `Nenhum pedido em “${ORDER_FILTER_LABEL[filter]}”.` : "Não há pedidos mais antigos."}
        </p>
      ) : (
        <OrderList rows={page.rows} now={now} />
      )}

      {(before !== null || page.nextBefore !== null) && (
        <nav aria-label="Páginas de pedidos" className="flex items-center justify-between text-sm">
          {before !== null ? (
            <Link to={base} className="underline underline-offset-4">
              ← Mais recentes
            </Link>
          ) : (
            <span />
          )}
          {page.nextBefore !== null && (
            <Link to={withCursor(page.nextBefore)} className="underline underline-offset-4">
              Mais antigos →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

const COLUMNS = "md:grid-cols-[8rem_9rem_minmax(0,1fr)_10rem_13rem]";

function OrderList({ rows, now }: { rows: AdminOrderRow[]; now: number }) {
  return (
    <div className="border border-line bg-surface">
      {/* Column titles for wide screens; each row also reads on its own. */}
      <div aria-hidden="true" className={cx("hidden gap-x-6 border-b border-line px-4 py-2 text-xs uppercase tracking-[0.12em] text-muted md:grid", COLUMNS)}>
        <span>Pedido</span>
        <span>Data</span>
        <span>Cliente</span>
        <span className="text-right">Total</span>
        <span>Situação</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const pendingPix = row.status === "pending_payment";
          const overdue = pendingPix && Date.parse(row.expiresAt) < now;
          return (
            <li key={row.number}>
              <Link to={`/admin/orders/${row.number}`} className={cx("grid gap-x-6 gap-y-1 px-4 py-4 hover:bg-paper md:items-center", COLUMNS)}>
                <span className="font-medium">Pedido nº {row.number}</span>
                <span className="text-sm text-muted">
                  <time dateTime={row.createdAt}>{adminDateTime.format(new Date(row.createdAt))}</time>
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{row.customerName}</span>
                  <span className="block truncate text-sm text-muted">{row.customerEmail}</span>
                </span>
                <span className="md:text-right">
                  <span className="tabular-nums">{formatBRL(row.totalCents)}</span>
                  <span className="block text-sm text-muted">
                    {row.itemCount} {row.itemCount === 1 ? "item" : "itens"} · {SHIPPING_SHORT[row.shippingMethod]}
                  </span>
                </span>
                <span>
                  <OrderStatusBadge status={row.status} method={row.shippingMethod} />
                  {/* A partial refund takes over the status; the shipping stage still matters to the team. */}
                  {row.status === "partially_refunded" && row.fulfillmentStage !== "unfulfilled" && (
                    <span className="mt-1 block text-sm text-muted">{orderStatusLabel(row.fulfillmentStage, row.shippingMethod)}</span>
                  )}
                  {overdue && <span className="mt-1 block text-sm font-medium text-danger">Prazo do Pix vencido</span>}
                  {pendingPix && !overdue && (
                    <span className="mt-1 block text-sm text-muted">Pix vence {adminDateTime.format(new Date(row.expiresAt))}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
