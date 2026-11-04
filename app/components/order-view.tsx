// One order as its customer sees it: the Pix QR code and "copia e cola" while unpaid, then where the order is.
// Shared by the guest page (/order-confirmation/:number?t=…) and the account page (/account/orders/:number).
import { useState } from "react";
import { Link } from "react-router";

import { Breadcrumbs, Button, cx } from "~/components/ui";
import { formatBrPhone, formatCep } from "~/lib/br";
import { formatBRL } from "~/lib/money";
import { type CustomerOrderView, type FulfillmentStep, orderStatusLabel } from "~/lib/orders";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const STEPS: readonly FulfillmentStep[] = ["processing", "shipped", "delivered"];

/** "guest": the page behind the order's secret link; "account": the same order inside Minha conta. */
export type OrderViewVariant = "guest" | "account";

/** Paid orders: where the order is, and how to follow the parcel. */
function Progress({ order, variant }: { order: CustomerOrderView; variant: OrderViewVariant }) {
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
      {variant === "guest" && <p className="text-muted">Guarde este link para acompanhar o pedido.</p>}
    </section>
  );
}

export function OrderView({
  order,
  qrDataUrl,
  whatsapp,
  variant,
  breadcrumbs,
}: {
  order: CustomerOrderView;
  qrDataUrl: string | null;
  whatsapp: string | null;
  variant: OrderViewVariant;
  /** The guest page's own breadcrumbs; the account layout shows its own. */
  breadcrumbs?: { name: string; href: string }[];
}) {
  const pending = order.status === "pending_payment";
  const cancelled = order.status === "cancelled";
  const help = `/contact?pedido=${order.number}`;

  return (
    <div className={variant === "guest" ? "mx-auto max-w-5xl px-4 py-10 md:px-8" : undefined}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <p className={cx("eyebrow", breadcrumbs && "mt-8")}>Pedido nº {order.number}</p>
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
          <PixPayment order={order} qrDataUrl={qrDataUrl} whatsapp={whatsapp} variant={variant} />
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
                <Link to={help} className="text-ink underline underline-offset-4">
                  Falar com a loja
                </Link>
              )}
            </p>
          </section>
        ) : (
          <Progress order={order} variant={variant} />
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
            {order.totals.discountCents > 0 && (
              <div className="flex justify-between gap-4">
                <dt>Desconto</dt>
                <dd>− {formatBRL(order.totals.discountCents)}</dd>
              </div>
            )}
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
          <div className="border-t border-line pt-4 text-sm">
            <Link to={help} className="text-ink underline underline-offset-4">
              Precisa de ajuda com este pedido?
            </Link>
          </div>
        </aside>
      </div>

      {variant === "account" ? (
        <Link to="/account/orders" className="mt-10 inline-block text-sm underline underline-offset-4">
          ← Meus pedidos
        </Link>
      ) : (
        <Link to="/collections/all" className="mt-10 inline-block text-sm underline underline-offset-4">
          ← Continuar comprando
        </Link>
      )}
    </div>
  );
}

function PixPayment({ order, qrDataUrl, whatsapp, variant }: { order: CustomerOrderView; qrDataUrl: string; whatsapp: string | null; variant: OrderViewVariant }) {
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
        <p>
          Conferimos cada pagamento e atualizamos a situação desta página.
          {variant === "guest" && " Guarde este link para acompanhar o pedido."}
        </p>
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
