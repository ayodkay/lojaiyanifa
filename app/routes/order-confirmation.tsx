// /order-confirmation/:number?t=… — the guest's order page: Pix QR code and
// "copia e cola" while unpaid, then the order status. `t` is the checkout's
// random key (only its hash is stored) or the order's e-mail link token
// (customerLinkToken); a wrong or missing `t` is a 404, so order numbers can't
// be enumerated. Private: never cached, never indexed. The page itself is
// app/components/order-view.tsx, shared with /account/orders/:number.
import { useEffect } from "react";
import { data, type ShouldRevalidateFunctionArgs, useSearchParams } from "react-router";

import { env } from "~/.server/env";
import { getOrderForCustomer } from "~/.server/orders";
import { pixQrSvg } from "~/.server/pix";
import { getContent } from "~/.server/prismic";
import { OrderView } from "~/components/order-view";
import { cart } from "~/lib/client-store";
import { NO_STORE, noStore } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { whatsappHref } from "~/lib/shell";

import type { Route } from "./+types/order-confirmation";

export async function loader({ params, request }: Route.LoaderArgs) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const order = await getOrderForCustomer(Number(params.number), token);
  if (!order) throw data("Pedido não encontrado.", { status: 404, headers: NO_STORE });

  const { settings } = await getContent();
  const qrDataUrl =
    order.status === "pending_payment"
      ? `data:image/svg+xml;base64,${Buffer.from(await pixQrSvg(order.payment.brCode)).toString("base64")}`
      : null;
  const whatsapp = settings.contact.whatsappNumber
    ? whatsappHref(settings.contact.whatsappNumber, `Olá! Sobre o meu pedido nº ${order.number}.`)
    : null;
  return data({ order, qrDataUrl, whatsapp, siteUrl: env().SITE_URL, storeName: settings.storeName }, { headers: NO_STORE });
}

export const headers = noStore;

/** Dropping `novo` from the URL after clearing the cart must not reload the order. */
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  const sameOrder = currentUrl.pathname === nextUrl.pathname && currentUrl.searchParams.get("t") === nextUrl.searchParams.get("t");
  return sameOrder && !nextUrl.searchParams.has("novo") ? false : defaultShouldRevalidate;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Pedido" }, { name: "robots", content: "noindex, nofollow" }];
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: `/order-confirmation/${loaderData.order.number}`,
    title: `Pedido nº ${loaderData.order.number}`,
    noindex: true,
  });
}

export default function OrderConfirmation({ loaderData }: Route.ComponentProps) {
  const { order, qrDataUrl, whatsapp } = loaderData;
  const [params, setParams] = useSearchParams();

  // First visit straight from checkout: the order now holds the items, so empty the cart.
  useEffect(() => {
    if (params.get("novo") !== "1") return;
    cart.clear();
    setParams(
      (p) => {
        p.delete("novo");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [params, setParams]);

  return (
    <OrderView
      order={order}
      qrDataUrl={qrDataUrl}
      whatsapp={whatsapp}
      variant="guest"
      breadcrumbs={[
        { name: "Início", href: "/" },
        { name: `Pedido nº ${order.number}`, href: `/order-confirmation/${order.number}` },
      ]}
    />
  );
}
