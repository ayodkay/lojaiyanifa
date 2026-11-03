// /order-confirmation/:number?t=… — the guest's order page: Pix QR code and
// "copia e cola" while unpaid, then the order status. `t` is the checkout's
// random key (only its hash is stored); a wrong or missing `t` is a 404, so
// order numbers can't be enumerated. Private: never cached, never indexed.
import { useEffect, useState } from "react";
import { data, Link, type ShouldRevalidateFunctionArgs, useSearchParams } from "react-router";

import { env } from "~/.server/env";
import { getOrderForCustomer } from "~/.server/orders";
import { pixQrSvg } from "~/.server/pix";
import { getContent } from "~/.server/prismic";
import { Breadcrumbs, Button } from "~/components/ui";
import { formatBrPhone, formatCep } from "~/lib/br";
import { cart } from "~/lib/client-store";
import { NO_STORE, noStore } from "~/lib/http";
import { formatBRL } from "~/lib/money";
import { type CustomerOrderView, type FulfillmentStep, orderStatusLabel } from "~/lib/orders";
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

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const STEPS: readonly FulfillmentStep[] = ["processing", "shipped", "delivered"];

/** Paid orders: where the order is, and how to follow the parcel. */
function Progress({ order }: { order: CustomerOrderView }) {
  const { fulfillment: f, shipping } = order;
  const reached = { processing: f.processingAt, shipped: f.shippedAt, delivered: f.deliveredAt };
  const readyForPickup = shipping.method === "pickup" && f.stage === "shipped";
  return (
    <section aria-labelledby="acompanhe" className="space-y-4">
      <h2 id="acompanhe" className="text-2xl">
        Acompanhe o seu pedido
      </h2>
      <ol className="space-y-2">
        <li>
          <span aria-hidden="true">✓</span> Pagamento confirmado
        </li>
        {STEPS.map((step) => (
          <li key={step} className={reached[step] ? undefined : "text-muted"}>
            <span aria-hidden="true">{reached[step] ? "✓" : "○"}</span> {orderStatusLabel(step, shipping.method)}
            {reached[step] ? <> — {dateTime.format(new Date(reached[step]))}</> : <span className="sr-only"> (ainda não)</span>}
          </li>
        ))}
      </ol>
      {readyForPickup && shipping.pickupAddress && (
        <p>
          Já pode retirar em: <strong>{shipping.pickupAddress}</strong>
        </p>
      )}
      {(f.carrier || f.trackingCode) && (
        <p>
          Enviado por {f.carrier}
          {f.trackingCode && (
            <>
              {" "}
              · código <span className="font-mono">{f.trackingCode}</span>
            </>
          )}
          {f.trackingUrl && (
            <>
              {" "}
              ·{" "}
              <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
                Rastrear a entrega
              </a>
            </>
          )}
        </p>
      )}
      {order.refunds.length > 0 && (
        <div className="space-y-1 border-t border-line pt-4">
          <h3 className="font-medium">{order.status === "refunded" ? "Valor devolvido" : "Reembolso parcial"}</h3>
          <ul>
            {order.refunds.map((r) => (
              <li key={r.at}>
                {formatBRL(r.amountCents)} devolvidos em {dateTime.format(new Date(r.at))}
              </li>
            ))}
          </ul>
          <p className="text-muted">Ficou com alguma dúvida sobre o reembolso? Fale com a loja.</p>
        </div>
      )}
      <p className="text-muted">Guarde este link para acompanhar o pedido.</p>
    </section>
  );
}

export default function OrderConfirmation({ loaderData }: Route.ComponentProps) {
  const { order, qrDataUrl, whatsapp } = loaderData;
  const [params, setParams] = useSearchParams();
  const pending = order.status === "pending_payment";
  const cancelled = order.status === "cancelled";

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
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <Breadcrumbs
        items={[
          { name: "Início", href: "/" },
          { name: `Pedido nº ${order.number}`, href: `/order-confirmation/${order.number}` },
        ]}
      />
      <p className="eyebrow mt-8">Pedido nº {order.number}</p>
      <h1 className="mb-3 mt-3 text-4xl md:text-5xl">
        {pending
          ? "Pedido recebido! Agora é só pagar com Pix."
          : cancelled
            ? "Pedido cancelado"
            : order.status === "refunded"
              ? "Pedido reembolsado"
              : "Obrigado pela sua compra!"}
      </h1>
      <p className="text-muted">
        Situação: <strong className="text-ink">{orderStatusLabel(order.status, order.shipping.method)}</strong>
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
        {pending && qrDataUrl ? (
          <PixPayment order={order} qrDataUrl={qrDataUrl} whatsapp={whatsapp} />
        ) : cancelled ? (
          <section aria-labelledby="cancelado" className="space-y-3">
            <h2 id="cancelado" className="text-2xl">
              Este pedido foi cancelado
            </h2>
            <p className="text-muted">Ele não será enviado, e os produtos voltaram a ficar disponíveis na loja.</p>
            <p className="text-muted">Se você já tinha feito o Pix, fale com a gente para receber o reembolso.</p>
            <p>
              {whatsapp ? (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
                  Falar com a loja pelo WhatsApp
                </a>
              ) : (
                <Link to="/contact" className="text-ink underline underline-offset-4">
                  Falar com a loja
                </Link>
              )}
            </p>
          </section>
        ) : (
          <Progress order={order} />
        )}

        <aside aria-labelledby="resumo" className="h-fit space-y-6 border border-line bg-surface p-6">
          <h2 id="resumo" className="text-2xl">
            Resumo
          </h2>
          <ul className="space-y-3 text-sm">
            {order.lines.map((line) => (
              <li key={line.sku} className="flex justify-between gap-4">
                <span className="min-w-0">
                  {line.name}
                  {line.variantName && <span className="text-muted"> — {line.variantName}</span>}
                  <span className="text-muted"> × {line.quantity}</span>
                </span>
                <span className="shrink-0">{formatBRL(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd>{formatBRL(order.totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{order.shipping.label}</dt>
              <dd>{order.totals.shippingCents === 0 ? "Grátis" : formatBRL(order.totals.shippingCents)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-base font-medium">
              <dt>Total</dt>
              <dd>{formatBRL(order.totals.totalCents)}</dd>
            </div>
          </dl>
          <div className="border-t border-line pt-4 text-sm">
            <h3 className="font-medium">{order.shipping.method === "pickup" ? "Retirada" : "Entrega"}</h3>
            {order.shipping.address ? (
              <p className="mt-1 text-muted">
                {order.shipping.address.street}, {order.shipping.address.number}
                {order.shipping.address.complement && ` — ${order.shipping.address.complement}`}
                <br />
                {order.shipping.address.neighborhood}, {order.shipping.address.city} – {order.shipping.address.state}
                <br />
                CEP {formatCep(order.shipping.address.cep)}
              </p>
            ) : (
              <p className="mt-1 text-muted">{order.shipping.pickupAddress}</p>
            )}
          </div>
          <div className="border-t border-line pt-4 text-sm">
            <h3 className="font-medium">Contato</h3>
            <p className="mt-1 text-muted">
              {order.customer.name}
              <br />
              {order.customer.email}
              <br />
              {formatBrPhone(order.customer.phone)}
            </p>
          </div>
        </aside>
      </div>

      <Link to="/collections/all" className="mt-10 inline-block text-sm underline underline-offset-4">
        ← Continuar comprando
      </Link>
    </div>
  );
}

function PixPayment({
  order,
  qrDataUrl,
  whatsapp,
}: {
  order: Route.ComponentProps["loaderData"]["order"];
  qrDataUrl: string;
  whatsapp: string | null;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const amount = formatBRL(order.payment.amountCents);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.payment.brCode);
      setCopied("copied");
    } catch (error) {
      console.warn("[pix] clipboard unavailable", error);
      setCopied("failed");
    }
  };

  return (
    <section aria-labelledby="pix" className="space-y-6">
      <h2 id="pix" className="text-2xl">
        Pague {amount} com Pix
      </h2>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <img
          src={qrDataUrl}
          width={240}
          height={240}
          alt={`QR Code Pix do pedido nº ${order.number}, valor ${amount}`}
          className="h-60 w-60 shrink-0 border border-line bg-white p-2"
        />
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Abra o app do seu banco e escolha pagar com Pix.</li>
          <li>Escaneie o QR Code ou use o código “copia e cola”.</li>
          <li>Confira o valor ({amount}) e o recebedor, e confirme.</li>
        </ol>
      </div>
      <div>
        <label htmlFor="pix-copia-e-cola" className="mb-1 block text-sm">
          Pix copia e cola
        </label>
        <textarea
          id="pix-copia-e-cola"
          readOnly
          rows={4}
          value={order.payment.brCode}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-none break-all rounded-xl border border-line-strong bg-paper p-3 font-mono text-xs"
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={copy}>
            Copiar código Pix
          </Button>
          <span aria-live="polite" className="text-sm">
            {copied === "copied" && <span className="text-success">Código copiado.</span>}
            {copied === "failed" && <span className="text-danger">Não foi possível copiar; selecione o código acima.</span>}
          </span>
        </div>
      </div>
      <div className="space-y-2 text-sm text-muted">
        <p>
          Pague até <strong className="text-ink">{dateTime.format(new Date(order.expiresAt))}</strong> (horário de Brasília) para garantir os
          itens reservados.
        </p>
        <p>Conferimos cada pagamento e atualizamos a situação desta página. Guarde este link para acompanhar o pedido.</p>
        {whatsapp && (
          <p>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-4">
              Enviar o comprovante pelo WhatsApp
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
