// /account/support/:number — one of the customer's messages and the store's answers. Another customer's ticket (or
// none) is a 404, indistinguishable on purpose.
import { data, Link } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { getCustomerTicket } from "~/.server/support";
import { cx } from "~/components/ui";
import { RETURN_PREFERENCE_LABEL, RETURN_REASON_LABEL, type ReturnPreference, type ReturnReason, TICKET_STATUS_LABEL, TOPIC_LABEL } from "~/lib/support";

import type { Route } from "./+types/account.ticket";

export async function loader({ params, context }: Route.LoaderArgs) {
  const ticket = await getCustomerTicket(context.get(customerContext), Number(params.number));
  if (!ticket) throw data("Atendimento não encontrado.", { status: 404, headers: ACCOUNT_HEADERS });
  return data({ ticket }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function AccountTicket({ loaderData }: Route.ComponentProps) {
  const { ticket } = loaderData;
  const rr = ticket.returnRequest;
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Atendimento nº {ticket.number}</p>
        <h1 className="mt-2 text-4xl">{TOPIC_LABEL[ticket.topic]}</h1>
        <p className="mt-2 text-muted">
          {TICKET_STATUS_LABEL[ticket.status]}
          {ticket.orderNumber && (
            <>
              {" "}
              · pedido{" "}
              <Link to={`/account/orders/${ticket.orderNumber}`} className="underline underline-offset-4">
                nº {ticket.orderNumber}
              </Link>
            </>
          )}
        </p>
      </div>
      {rr && (
        <p className="text-sm text-muted">
          {RETURN_REASON_LABEL[rr.reason as ReturnReason] ?? rr.reason} · {RETURN_PREFERENCE_LABEL[rr.preference as ReturnPreference] ?? rr.preference}
          {rr.items && <> · {rr.items}</>}
        </p>
      )}
      <ol className="space-y-4">
        {ticket.messages.map((m) => (
          <li key={m.id} className={cx("border p-4", m.from === "store" ? "border-ink/30 bg-surface" : "border-line")}>
            <p className="mb-2 text-xs text-muted">
              {m.from === "store" ? "Loja" : "Você"} · {dateTime.format(new Date(m.at))}
            </p>
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          </li>
        ))}
      </ol>
      <p className="text-sm text-muted">Para acrescentar algo, responda ao e-mail que você recebeu ou envie uma nova mensagem.</p>
      <Link to="/account/support" className="inline-block text-sm underline underline-offset-4">
        ← Atendimento
      </Link>
    </div>
  );
}
