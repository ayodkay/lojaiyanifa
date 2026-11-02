// /admin/orders/:number — one order in full, and the Pix decisions:
// confirm the payment (after seeing it in the bank account) or cancel the
// order (releasing its stock). Every action re-checks the role's capability on
// the server; the page only hides what the role can't use.
import { data, Form, isRouteErrorResponse, Link, type ShouldRevalidateFunctionArgs, useNavigation } from "react-router";

import { cancelPendingOrder, confirmPixPayment, getOrderForAdmin, OrderNotFoundError, OrderNotPendingError } from "~/.server/admin-orders";
import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import { OrderStatusBadge } from "~/components/admin";
import { Button, cx, Notice } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";
import { type AdminOrderView, CANCEL_NOTE_MAX, CANCEL_REASON_LABEL, CANCEL_REASONS, type CancelForm, parseCancelForm, parseOrderNumber } from "~/lib/admin/orders";
import { can } from "~/lib/admin/roles";
import { formatBrPhone, formatCep, formatCpf } from "~/lib/br";
import { formatBRL } from "~/lib/money";
import { ORDER_STATUS_LABEL } from "~/lib/orders";

import type { Route } from "./+types/admin.order";

const NOT_FOUND = "Pedido não encontrado.";

export async function loader({ params, context }: Route.LoaderArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "orders.view");
  const number = parseOrderNumber(params.number);
  const order = number === null ? null : await getOrderForAdmin(number);
  if (!order) throw data(NOT_FOUND, { status: 404 });
  return {
    order,
    allowed: { confirm: can(user.role, "orders.confirm_payment"), cancel: can(user.role, "orders.cancel") },
    now: Date.now(),
  };
}

interface ActionResult {
  intent: string;
  ok?: string;
  error?: string;
  fieldErrors?: Partial<Record<keyof CancelForm, string>>;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(adminUserContext);
  const number = parseOrderNumber(params.number);
  if (number === null) throw data(NOT_FOUND, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "confirm_payment") {
      requireCapability(user, "orders.confirm_payment");
      if (form.get("received") !== "yes") {
        return data<ActionResult>({ intent, error: "Marque a caixa confirmando que o valor entrou na conta." }, { status: 400 });
      }
      await confirmPixPayment(number, user);
      return data<ActionResult>({ intent, ok: "Pagamento confirmado. O pedido está pago e o estoque reservado foi baixado." });
    }
    if (intent === "cancel") {
      requireCapability(user, "orders.cancel");
      const parsed = parseCancelForm(form);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      await cancelPendingOrder(number, user, parsed.value);
      return data<ActionResult>({ intent, ok: "Pedido cancelado. Os itens voltaram a ficar à venda." });
    }
    return data<ActionResult>({ intent, error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof OrderNotPendingError) {
      return data<ActionResult>(
        { intent, error: `Este pedido já tinha sido atualizado (${ORDER_STATUS_LABEL[error.status]}). A página abaixo mostra a situação atual.` },
        { status: 409 },
      );
    }
    if (error instanceof OrderNotFoundError) throw data(NOT_FOUND, { status: 404 });
    throw error;
  }
}

export const meta = ({ params }: Route.MetaArgs) => adminMeta(`Pedido nº ${params.number}`);

/**
 * React Router doesn't reload data after an action answers 4xx. That's right
 * for a validation error (nothing changed), but a 409 means someone else
 * changed the order: reload it so the page shows what actually happened.
 */
export function shouldRevalidate({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return actionStatus === 409 ? true : defaultShouldRevalidate;
}

const when = (iso: string) => adminDateTime.format(new Date(iso));

export default function AdminOrder({ loaderData, actionData }: Route.ComponentProps) {
  const { order, allowed, now } = loaderData;
  const busy = useNavigation().state === "submitting";
  const pending = order.status === "pending_payment";

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin/orders" className="text-sm text-muted hover:text-ink">
          ← Pedidos
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-3xl md:text-4xl">Pedido nº {order.number}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-2 text-sm text-muted">
          Feito em {when(order.createdAt)} · Atualizado em {when(order.updatedAt)}
        </p>
      </div>

      {actionData?.ok && <Notice tone="success">{actionData.ok}</Notice>}
      {actionData?.error && <Notice tone="danger">{actionData.error}</Notice>}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          <Items order={order} />
          <Timeline order={order} />
        </div>
        <div className="space-y-6">
          <section aria-labelledby="pagamento" className="space-y-4 border border-line bg-surface p-5">
            <h2 id="pagamento" className="text-xl">
              Pagamento Pix
            </h2>
            <PixSummary order={order} now={now} />
            {pending && allowed.confirm && <ConfirmPayment order={order} busy={busy} />}
            {pending && allowed.cancel && (
              <CancelOrder busy={busy} result={actionData?.intent === "cancel" ? actionData : undefined} />
            )}
            {pending && !allowed.cancel && (
              <p className="border-t border-line pt-4 text-sm text-muted">Somente proprietário(a) e administradores podem cancelar pedidos.</p>
            )}
          </section>
          <Customer order={order} />
          <Delivery order={order} />
        </div>
      </div>
    </div>
  );
}

function PixSummary({ order, now }: { order: AdminOrderView; now: number }) {
  const { payment, cancellation } = order;
  const overdue = order.status === "pending_payment" && Date.parse(order.expiresAt) < now;
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Valor</dt>
        <dd className="text-2xl tabular-nums">{formatBRL(payment.amountCents)}</dd>
        <dt className="text-muted">Identificador</dt>
        <dd className="font-mono">{payment.txid}</dd>
        {order.status === "pending_payment" && (
          <>
            <dt className="text-muted">Prazo</dt>
            <dd className={overdue ? "font-medium text-danger" : undefined}>
              {overdue ? `Venceu em ${when(order.expiresAt)}` : `Vence em ${when(order.expiresAt)}`}
            </dd>
          </>
        )}
      </dl>
      {payment.confirmedAt && (
        <p className="text-sm text-success">
          Confirmado em {when(payment.confirmedAt)}
          {payment.confirmedBy && <> por {payment.confirmedBy.email}</>}.
        </p>
      )}
      {cancellation && (
        <div className="space-y-1 text-sm">
          <p>
            Cancelado em {when(cancellation.at)} por {cancellation.by.email}.
          </p>
          <p className="text-muted">
            Motivo: {CANCEL_REASON_LABEL[cancellation.reason]}
            {cancellation.note && <> — {cancellation.note}</>}
          </p>
        </div>
      )}
    </>
  );
}

function ConfirmPayment({ order, busy }: { order: AdminOrderView; busy: boolean }) {
  return (
    <Form method="post" className="space-y-3 border-t border-line pt-4">
      <input type="hidden" name="intent" value="confirm_payment" />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="received" value="yes" required className="mt-0.5 size-5 shrink-0 accent-ink" />
        <span>
          Conferi no extrato do banco: recebi <strong className="whitespace-nowrap">{formatBRL(order.payment.amountCents)}</strong> via Pix por este pedido.
        </span>
      </label>
      <Button type="submit" className="w-full" disabled={busy}>
        Confirmar pagamento
      </Button>
      <p className="text-xs text-muted">O pedido passa a “Pagamento confirmado” e o estoque reservado é baixado. Isso não pode ser desfeito aqui.</p>
    </Form>
  );
}

function CancelOrder({ busy, result }: { busy: boolean; result: ActionResult | undefined }) {
  const errors = result?.fieldErrors ?? {};
  return (
    <details className="border-t border-line pt-4" open={Boolean(result?.fieldErrors)}>
      <summary className="cursor-pointer text-sm text-danger underline-offset-4 hover:underline">Cancelar pedido…</summary>
      <Form method="post" className="mt-4 space-y-4">
        <input type="hidden" name="intent" value="cancel" />
        <fieldset aria-describedby={errors.reason ? "motivo-erro" : undefined}>
          <legend className="mb-2 text-sm">Motivo</legend>
          <div className="space-y-2">
            {CANCEL_REASONS.map((reason) => (
              <label key={reason} className="flex items-center gap-3 text-sm">
                <input type="radio" name="reason" value={reason} required className="size-4 accent-ink" />
                {CANCEL_REASON_LABEL[reason]}
              </label>
            ))}
          </div>
          {errors.reason && (
            <p id="motivo-erro" className="mt-1 text-sm text-danger">
              {errors.reason}
            </p>
          )}
        </fieldset>
        <div>
          <label htmlFor="nota" className="mb-1 block text-sm">
            Observação <span className="text-muted">(obrigatória em “Outro motivo”)</span>
          </label>
          <textarea
            id="nota"
            name="note"
            rows={3}
            maxLength={CANCEL_NOTE_MAX}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={errors.note ? "nota-erro" : undefined}
            className={cx("w-full rounded-md border bg-paper px-3 py-2 text-base", errors.note ? "border-danger" : "border-line-strong")}
          />
          {errors.note && (
            <p id="nota-erro" className="mt-1 text-sm text-danger">
              {errors.note}
            </p>
          )}
        </div>
        <p className="text-xs text-muted">
          O cliente verá o pedido como cancelado e os itens voltam a ficar à venda. Se o cliente já tiver pago, devolva o valor pelo banco.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[var(--radius-control)] border border-danger px-6 py-3 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-paper disabled:opacity-50"
        >
          Confirmar cancelamento
        </button>
      </Form>
    </details>
  );
}

function Items({ order }: { order: AdminOrderView }) {
  const { totals } = order;
  return (
    <section aria-labelledby="itens" className="space-y-3">
      <h2 id="itens" className="text-xl">
        Itens
      </h2>
      <ul className="divide-y divide-line border border-line bg-surface">
        {order.lines.map((line) => (
          <li key={line.sku} className="flex justify-between gap-4 p-4 text-sm">
            <span className="min-w-0">
              <span className="block">
                {line.name}
                {line.variantName && <span className="text-muted"> — {line.variantName}</span>}
              </span>
              <span className="block text-muted">
                SKU {line.sku} · {line.quantity} × {formatBRL(line.unitPriceCents)}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">{formatBRL(line.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Subtotal</dt>
          <dd className="tabular-nums">{formatBRL(totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Frete</dt>
          <dd className="tabular-nums">{totals.shippingCents === 0 ? "Grátis" : formatBRL(totals.shippingCents)}</dd>
        </div>
        {totals.discountCents > 0 && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Desconto</dt>
            <dd className="tabular-nums">−{formatBRL(totals.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 border-t border-line pt-2 font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatBRL(totals.totalCents)}</dd>
        </div>
      </dl>
    </section>
  );
}

const BY_LABEL = { customer: "Pelo cliente, no checkout", system: "Automático" } as const;

function Timeline({ order }: { order: AdminOrderView }) {
  return (
    <section aria-labelledby="historico" className="space-y-3">
      <h2 id="historico" className="text-xl">
        Histórico
      </h2>
      <ol className="space-y-4 border-l border-line pl-5 text-sm">
        {order.timeline.map((entry, i) => (
          <li key={`${entry.at}-${i}`}>
            <p>
              <time dateTime={entry.at}>{when(entry.at)}</time> — <strong>{ORDER_STATUS_LABEL[entry.status]}</strong>
            </p>
            <p className="text-muted">
              {entry.by === "admin" ? (entry.actor?.email ?? "Equipe") : BY_LABEL[entry.by]}
              {entry.note && <> · {entry.note}</>}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Customer({ order }: { order: AdminOrderView }) {
  const { customer } = order;
  return (
    <section aria-labelledby="cliente" className="space-y-1 border border-line bg-surface p-5 text-sm">
      <h2 id="cliente" className="mb-2 text-xl">
        Cliente
      </h2>
      <p className="text-base">{customer.name}</p>
      <p>
        <a href={`mailto:${customer.email}`} className="underline underline-offset-4">
          {customer.email}
        </a>
      </p>
      <p>
        <a href={`tel:${customer.phone}`} className="underline underline-offset-4">
          {formatBrPhone(customer.phone)}
        </a>
      </p>
      <p>CPF {formatCpf(customer.cpf)}</p>
      <p className="text-muted">{customer.uid ? "Cliente com conta" : "Compra sem conta"}</p>
    </section>
  );
}

function Delivery({ order }: { order: AdminOrderView }) {
  const { shipping } = order;
  return (
    <section aria-labelledby="entrega" className="space-y-1 border border-line bg-surface p-5 text-sm">
      <h2 id="entrega" className="mb-2 text-xl">
        Entrega
      </h2>
      <p>
        {shipping.label} · {shipping.priceCents === 0 ? "sem custo" : formatBRL(shipping.priceCents)}
      </p>
      {shipping.address && (
        <address className="not-italic">
          {shipping.address.street}, {shipping.address.number}
          {shipping.address.complement && <> — {shipping.address.complement}</>}
          <br />
          {shipping.address.neighborhood} · {shipping.address.city} – {shipping.address.state}
          <br />
          CEP {formatCep(shipping.address.cep)}
        </address>
      )}
      {shipping.pickupAddress && <p className="text-muted">Retirada: {shipping.pickupAddress}</p>}
      {shipping.estimateDays && (
        <p className="text-muted">
          Prazo: {shipping.estimateDays.min === shipping.estimateDays.max ? shipping.estimateDays.max : `${shipping.estimateDays.min} a ${shipping.estimateDays.max}`} dia(s)
          útil(eis) após a confirmação do pagamento
        </p>
      )}
    </section>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  let message = "Não foi possível carregar este pedido. Tente novamente; se continuar, avise o responsável técnico.";
  if (isRouteErrorResponse(error) && typeof error.data === "string" && error.data) message = error.data;
  else if (import.meta.env.DEV && error instanceof Error) message = error.message;
  const title = status === 404 ? "Pedido não encontrado" : status === 403 ? "Ação não permitida" : "Erro no pedido";
  return (
    <div className="max-w-xl space-y-4">
      <title>{`${title} | Painel da Loja Iyanifa`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <Link to="/admin/orders" className="text-sm text-muted hover:text-ink">
        ← Pedidos
      </Link>
      <h1 className="text-3xl">{title}</h1>
      <p className="text-muted">{message}</p>
    </div>
  );
}
