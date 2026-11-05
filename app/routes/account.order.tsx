// /account/orders/:number — one of the customer's orders: the same page as the guest link (app/components/order-view.tsx),
// with the Pix code while it's unpaid. Another customer's order (or none) is a 404, indistinguishable on purpose.
import { data } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { getCustomerOrder } from "~/.server/customers";
import { pixQrSvg } from "~/.server/pix";
import { getContent } from "~/.server/prismic";
import { OrderView } from "~/components/order-view";
import { whatsappHref } from "~/lib/shell";

import type { Route } from "./+types/account.order";

export async function loader({ params, context }: Route.LoaderArgs) {
  const order = await getCustomerOrder(context.get(customerContext), Number(params.number));
  if (!order) throw data("Pedido não encontrado.", { status: 404, headers: ACCOUNT_HEADERS });
  const { settings } = await getContent();
  const qrDataUrl = order.status === "pending_payment" ? `data:image/svg+xml;base64,${Buffer.from(await pixQrSvg(order.payment.brCode)).toString("base64")}` : null;
  const whatsapp = settings.contact.whatsappNumber ? whatsappHref(settings.contact.whatsappNumber, `Olá! Sobre o meu pedido nº ${order.number}.`) : null;
  return data({ order, qrDataUrl, whatsapp }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = ({ params }: Route.MetaArgs) => [{ title: `Pedido nº ${params.number} | Loja Iyanifa` }, { name: "robots", content: "noindex, nofollow" }];

export default function AccountOrder({ loaderData }: Route.ComponentProps) {
  const { order, qrDataUrl, whatsapp } = loaderData;
  // The account layout already frames the page (breadcrumbs, column): the order view goes in its column.
  return <OrderView order={order} qrDataUrl={qrDataUrl} whatsapp={whatsapp} variant="account" />;
}
