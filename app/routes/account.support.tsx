// /account/support — the customer's messages to the store (support tickets): those sent signed in, plus those sent
// with the account's e-mail once it is verified. Read-only here; answers also arrive by e-mail.
import { data, Link } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { listCustomerTickets } from "~/.server/support";
import { ButtonLink } from "~/components/ui";
import { TICKET_STATUS_LABEL, TOPIC_LABEL } from "~/lib/support";

import type { Route } from "./+types/account.support";

export async function loader({ context }: Route.LoaderArgs) {
  return data({ tickets: await listCustomerTickets(context.get(customerContext)) }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function AccountSupport({ loaderData }: Route.ComponentProps) {
  const { tickets } = loaderData;
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Atendimento</h1>
      {tickets.length === 0 ? (
        <p className="text-muted">Você ainda não falou com a gente por aqui.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {tickets.map((t) => (
            <li key={t.number}>
              <Link to={`/account/support/${t.number}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 hover:bg-surface">
                <span className="font-medium">nº {t.number}</span>
                <span className="text-sm">{TOPIC_LABEL[t.topic]}</span>
                <span className="text-sm text-muted">{date.format(new Date(t.lastMessageAt))}</span>
                <span className="text-sm">{TICKET_STATUS_LABEL[t.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink to="/contact" variant="secondary">
        Enviar uma mensagem
      </ButtonLink>
    </div>
  );
}
