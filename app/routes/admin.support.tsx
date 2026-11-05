// /admin/support — customer messages (support tickets) by status, newest first. The default tab is the work queue:
// messages waiting for the store's answer (the store must answer within 5 days, Decreto 7.962/2013).
import { Link } from "react-router";

import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import { countTickets, listTickets } from "~/.server/support";
import { cx } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";
import { TICKET_STATUS_LABEL, TICKET_STATUSES, type TicketStatus, TOPIC_LABEL } from "~/lib/support";

import type { Route } from "./+types/admin.support";

const FIVE_DAYS = 5 * 24 * 3_600_000;

const parseStatus = (value: string | null): TicketStatus => ((TICKET_STATUSES as readonly string[]).includes(value ?? "") ? (value as TicketStatus) : "open");
const parseCursor = (value: string | null): number | null => (value && /^\d{1,9}$/.test(value) ? Number(value) : null);

export async function loader({ request, context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "support.view");
  const url = new URL(request.url);
  const status = parseStatus(url.searchParams.get("status"));
  const before = parseCursor(url.searchParams.get("before"));
  const [page, counts] = await Promise.all([listTickets(status, before), countTickets()]);
  return { status, before, page, counts, now: Date.now() };
}

export const meta = () => adminMeta("Atendimento");

const statusHref = (status: TicketStatus) => (status === "open" ? "/admin/support" : `/admin/support?status=${status}`);

export default function AdminSupport({ loaderData }: Route.ComponentProps) {
  const { status, before, page, counts, now } = loaderData;
  const base = statusHref(status);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-4xl">Atendimento</h1>
      <nav aria-label="Filtrar mensagens por situação">
        <ul className="flex flex-wrap gap-2">
          {TICKET_STATUSES.map((s) => (
            <li key={s}>
              <Link
                to={statusHref(s)}
                aria-current={s === status ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm",
                  s === status ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink",
                )}
              >
                {TICKET_STATUS_LABEL[s]}
                <span className={cx("tabular-nums", s === status ? "text-paper/80" : "text-muted")}>{counts[s]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {page.rows.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-8 text-center text-muted">
          {before === null ? `Nenhuma mensagem em “${TICKET_STATUS_LABEL[status]}”.` : "Não há mensagens mais antigas."}
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line bg-surface">
          {page.rows.map((row) => {
            const late = row.status === "open" && now - Date.parse(row.lastMessageAt) > FIVE_DAYS;
            return (
              <li key={row.number}>
                <Link to={`/admin/support/${row.number}`} className="grid gap-x-6 gap-y-1 px-4 py-4 hover:bg-paper md:grid-cols-[9rem_10rem_minmax(0,1fr)_14rem] md:items-center">
                  <span className="font-medium">nº {row.number}</span>
                  <span className="text-sm text-muted">
                    <time dateTime={row.lastMessageAt}>{adminDateTime.format(new Date(row.lastMessageAt))}</time>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{row.name}</span>
                    <span className="block truncate text-sm text-muted">{row.email}</span>
                  </span>
                  <span className="text-sm">
                    {TOPIC_LABEL[row.topic]}
                    {row.orderNumber && <span className="block text-muted">Pedido nº {row.orderNumber}</span>}
                    {late && <span className="block font-medium text-danger">Mais de 5 dias sem resposta</span>}
                    {row.status === "open" && row.lastFrom === "store" && <span className="block text-muted">Reaberto</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {(before !== null || page.nextBefore !== null) && (
        <nav aria-label="Páginas de mensagens" className="flex items-center justify-between text-sm">
          {before !== null ? (
            <Link to={base} className="underline underline-offset-4">
              ← Mais recentes
            </Link>
          ) : (
            <span />
          )}
          {page.nextBefore !== null && (
            <Link to={`${base}${base.includes("?") ? "&" : "?"}before=${page.nextBefore}`} className="underline underline-offset-4">
              Mais antigas →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
