// /account/orders — the customer's orders, newest first (app/.server/customers.ts decides which are theirs).
import { data, Link } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { listCustomerOrders } from "~/.server/customers";
import { ButtonLink, Notice } from "~/components/ui";
import { formatBRL } from "~/lib/money";
import { orderStatusLabel } from "~/lib/orders";

import type { Route } from "./+types/account.orders";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(customerContext);
  return data({ orders: await listCustomerOrders(user), emailVerified: user.emailVerified }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function AccountOrders({ loaderData }: Route.ComponentProps) {
  const { orders, emailVerified } = loaderData;
  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Pedidos</h1>
      {!emailVerified && <Notice tone="info">Pedidos feitos sem login aparecem aqui depois que você confirmar o seu e-mail.</Notice>}
      {orders.length === 0 ? (
        <div className="space-y-4">
          <p className="text-muted">Nenhum pedido por aqui ainda.</p>
          <ButtonLink to="/collections/all">Explorar produtos</ButtonLink>
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Seus pedidos</caption>
          <thead className="border-b border-line text-muted">
            <tr>
              <th scope="col" className="py-2 font-normal">Pedido</th>
              <th scope="col" className="py-2 font-normal">Data</th>
              <th scope="col" className="py-2 font-normal">Situação</th>
              <th scope="col" className="py-2 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((o) => (
              <tr key={o.number}>
                <td className="py-3">
                  <Link to={`/account/orders/${o.number}`} className="font-medium underline underline-offset-4">
                    nº {o.number}
                  </Link>
                  <span className="block text-xs text-muted">
                    {o.itemCount} {o.itemCount === 1 ? "item" : "itens"}
                  </span>
                </td>
                <td className="py-3">{date.format(new Date(o.createdAt))}</td>
                <td className="py-3">{orderStatusLabel(o.status, o.method)}</td>
                <td className="py-3 text-right">{formatBRL(o.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
