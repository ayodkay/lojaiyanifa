// /admin/orders/:number — one order in full, and what the team does with it:
// confirm the Pix (after seeing it in the bank account) or cancel the unpaid
// order (releasing its stock); then prepare, ship (or have it ready for
// pickup) and hand it over; tracking codes; internal notes. Every action
// re-checks the role's capability on the server; the page only hides what the
// role can't use.
import { data, Form, isRouteErrorResponse, Link, type ShouldRevalidateFunctionArgs, useNavigation } from "react-router";

import { cancelPendingOrder, confirmPixPayment, getOrderForAdmin, OrderNotFoundError, OrderNotPendingError } from "~/.server/admin-orders";
import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import { addOrderNote, NotesLimitError, OrderStateError, takeFulfillmentStep, updateTracking } from "~/.server/order-fulfillment";
import { recordRefund, RefundStateError } from "~/.server/order-refunds";
import { OrderStatusBadge } from "~/components/admin";
import { Button, cx, Notice } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import {
  CARRIER_MAX,
  NOTE_MAX,
  parseNote,
  parseStepForm,
  parseTracking,
  stepLabel,
  TRACKING_CODE_MAX,
  TRACKING_URL_MAX,
} from "~/lib/admin/fulfillment";
import { adminMeta } from "~/lib/admin/meta";
import { type AdminOrderView, CANCEL_NOTE_MAX, CANCEL_REASON_LABEL, CANCEL_REASONS, parseCancelForm, parseOrderNumber } from "~/lib/admin/orders";
import {
  canRefund,
  parseRefundForm,
  REFUND_NOTE_MAX,
  REFUND_REASON_LABEL,
  REFUND_REASONS,
  restockByDefault,
  restockField,
} from "~/lib/admin/refunds";
import { can } from "~/lib/admin/roles";
import { formatBrPhone, formatCep, formatCpf } from "~/lib/br";
import { formatBRL } from "~/lib/money";
import { canEditTracking, canTakeStep, type FulfillmentStep, orderStatusLabel } from "~/lib/orders";

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
    allowed: {
      confirm: can(user.role, "orders.confirm_payment"),
      cancel: can(user.role, "orders.cancel"),
      fulfill: can(user.role, "orders.fulfill"),
      note: can(user.role, "orders.add_note"),
      refund: can(user.role, "orders.refund"),
    },
    // One per rendering of the refund form: submitting it twice records one refund.
    refundKey: globalThis.crypto.randomUUID(),
    now: Date.now(),
  };
}

interface ActionResult {
  intent: string;
  ok?: string;
  error?: string;
  fieldErrors?: Record<string, string | undefined>;
}

const STEP_DONE: Record<FulfillmentStep, (pickup: boolean) => string> = {
  processing: () => "Pedido marcado como em preparação.",
  shipped: (pickup) => (pickup ? "Pedido marcado como pronto para retirada." : "Pedido marcado como enviado."),
  delivered: (pickup) => (pickup ? "Pedido marcado como retirado." : "Pedido marcado como entregue."),
};

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
    if (intent === "fulfill") {
      requireCapability(user, "orders.fulfill");
      // The delivery method decides which fields count; read it from the order, never from the form.
      const order = await getOrderForAdmin(number);
      if (!order) throw data(NOT_FOUND, { status: 404 });
      const parsed = parseStepForm(form, order.shipping.method);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      await takeFulfillmentStep(number, parsed.value.step, parsed.value.tracking, user);
      return data<ActionResult>({ intent, ok: STEP_DONE[parsed.value.step](order.shipping.method === "pickup") });
    }
    if (intent === "tracking") {
      requireCapability(user, "orders.fulfill");
      const parsed = parseTracking(form);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      await updateTracking(number, parsed.value, user);
      return data<ActionResult>({ intent, ok: "Rastreamento atualizado." });
    }
    if (intent === "refund") {
      requireCapability(user, "orders.refund");
      // Limits come from the stored order; the transaction checks them again.
      const order = await getOrderForAdmin(number);
      if (!order) throw data(NOT_FOUND, { status: 404 });
      const parsed = parseRefundForm(form, {
        remainingCents: order.payment.amountCents - order.payment.refundedCents,
        restockable: new Map(Object.entries(order.restockable)),
      });
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      const result = await recordRefund(number, parsed.value, user);
      const stock = parsed.value.restock.reduce((sum, line) => sum + line.quantity, 0);
      return data<ActionResult>({
        intent,
        ok: result.repeated
          ? "Este reembolso já estava registrado."
          : `Reembolso de ${formatBRL(parsed.value.amountCents)} registrado${stock > 0 ? `; ${stock} ${stock === 1 ? "unidade voltou" : "unidades voltaram"} ao estoque` : ""}. ` +
            (result.status === "refunded" ? "O pedido está totalmente reembolsado." : `Total reembolsado: ${formatBRL(result.refundedCents)}.`),
      });
    }
    if (intent === "note") {
      requireCapability(user, "orders.add_note");
      const parsed = parseNote(form);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      await addOrderNote(number, parsed.value, user);
      return data<ActionResult>({ intent, ok: "Nota adicionada." });
    }
    return data<ActionResult>({ intent, error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof OrderNotPendingError || error instanceof OrderStateError || error instanceof RefundStateError) {
      return data<ActionResult>(
        { intent, error: "Este pedido mudou enquanto você o via (outra pessoa da equipe ou o cancelamento automático). A página abaixo mostra a situação atual." },
        { status: 409 },
      );
    }
    if (error instanceof NotesLimitError) {
      return data<ActionResult>({ intent, fieldErrors: { text: "Este pedido já tem o número máximo de notas (200)." } }, { status: 409 });
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
          <OrderStatusBadge status={order.status} method={order.shipping.method} />
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
          <Notes order={order} allowed={allowed.note} busy={busy} result={actionData?.intent === "note" ? actionData : undefined} />
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
          <Refunds
            order={order}
            allowed={allowed.refund}
            refundKey={loaderData.refundKey}
            busy={busy}
            result={actionData?.intent === "refund" ? actionData : undefined}
          />
          <Customer order={order} />
          <Delivery
            order={order}
            allowed={allowed.fulfill}
            busy={busy}
            result={actionData?.intent === "fulfill" || actionData?.intent === "tracking" ? actionData : undefined}
          />
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
            {cancellation.by ? (
              <>
                Cancelado em {when(cancellation.at)} por {cancellation.by.email}.
              </>
            ) : (
              <>Cancelado automaticamente em {when(cancellation.at)}: o prazo do Pix venceu sem confirmação do pagamento.</>
            )}
          </p>
          <p className="text-muted">
            Motivo: {CANCEL_REASON_LABEL[cancellation.reason]}
            {cancellation.note && <> — {cancellation.note}</>}
          </p>
          {!cancellation.by && (
            <p className="text-muted">
              O código Pix continua válido no banco do cliente. Se o valor entrar depois do prazo, devolva-o pelo banco ou combine um novo pedido com o
              cliente.
            </p>
          )}
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
              <time dateTime={entry.at}>{when(entry.at)}</time> — <strong>{orderStatusLabel(entry.status, order.shipping.method)}</strong>
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

const FIELD = "min-h-11 w-full rounded-[var(--radius-control)] border bg-paper px-3";
const STEPS: readonly FulfillmentStep[] = ["processing", "shipped", "delivered"];

function Delivery({ order, allowed, busy, result }: { order: AdminOrderView; allowed: boolean; busy: boolean; result: ActionResult | undefined }) {
  const { shipping, fulfillment: f } = order;
  const method = shipping.method;
  const pickup = method === "pickup";
  const may = (step: FulfillmentStep) => allowed && canTakeStep(order.status, f.stage, step);
  const shipErrors = result?.intent === "fulfill" ? (result.fieldErrors ?? {}) : {};
  const trackingErrors = result?.intent === "tracking" ? (result.fieldErrors ?? {}) : {};
  const reached = { processing: f.processingAt, shipped: f.shippedAt, delivered: f.deliveredAt };

  return (
    <section aria-labelledby="entrega" className="space-y-4 border border-line bg-surface p-5 text-sm">
      <div className="space-y-1">
        <h2 id="entrega" className="mb-2 text-xl">
          Entrega
        </h2>
        <p>
          {shipping.label} · {shipping.priceCents === 0 ? "sem custo" : formatBRL(shipping.priceCents)}
          {/* Free shipping by a promotion: the customer paid nothing for delivery (totals.shippingCents). */}
          {shipping.priceCents > 0 && order.totals.shippingCents === 0 && <> · cliente não pagou (frete grátis por promoção)</>}
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
            Prazo: {shipping.estimateDays.min === shipping.estimateDays.max ? shipping.estimateDays.max : `${shipping.estimateDays.min} a ${shipping.estimateDays.max}`}{" "}
            dia(s) útil(eis) após a confirmação do pagamento
          </p>
        )}
      </div>

      {order.status === "pending_payment" && <p className="border-t border-line pt-4 text-muted">O preparo começa depois da confirmação do pagamento.</p>}
      {order.status !== "pending_payment" && order.status !== "cancelled" && (
        <div className="space-y-2 border-t border-line pt-4">
          <h3 className="font-medium">Andamento</h3>
          <ol className="space-y-1">
            {STEPS.map((step) => (
              <li key={step} className={reached[step] ? undefined : "text-muted"}>
                <span aria-hidden="true">{reached[step] ? "✓" : "○"}</span> {orderStatusLabel(step, method)}
                {reached[step] ? <> — {when(reached[step])}</> : <span className="sr-only"> (pendente)</span>}
              </li>
            ))}
          </ol>
          {(f.carrier || f.trackingCode) && (
            <p>
              {f.carrier}
              {f.trackingCode && (
                <>
                  {" "}
                  · <span className="font-mono">{f.trackingCode}</span>
                </>
              )}
              {f.trackingUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    Rastrear
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {shipErrors.step && <p className="text-danger">{shipErrors.step}</p>}
      {may("processing") && <StepButton step="processing" method={method} busy={busy} />}
      {may("shipped") &&
        (pickup ? (
          <StepButton step="shipped" method={method} busy={busy} />
        ) : (
          <details open={f.stage === "processing" || Boolean(shipErrors.carrier || shipErrors.trackingCode || shipErrors.trackingUrl)}>
            <summary className="cursor-pointer underline-offset-4 hover:underline">Registrar envio…</summary>
            <Form method="post" className="mt-3 space-y-3">
              <input type="hidden" name="intent" value="fulfill" />
              <input type="hidden" name="step" value="shipped" />
              <TrackingFields idPrefix="envio" errors={shipErrors} defaults={f} />
              <Button type="submit" className="w-full" disabled={busy}>
                {stepLabel("shipped", method)}
              </Button>
            </Form>
          </details>
        ))}
      {may("delivered") && (
        <details open={f.stage === "shipped" || Boolean(shipErrors.step)}>
          <summary className="cursor-pointer underline-offset-4 hover:underline">{pickup ? "Registrar retirada…" : "Registrar entrega…"}</summary>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="fulfill" />
            <input type="hidden" name="step" value="delivered" />
            <label className="flex items-start gap-3">
              <input type="checkbox" name="confirmed" value="yes" required className="mt-0.5 size-5 shrink-0 accent-ink" />
              <span>{pickup ? "Confirmo que o cliente retirou o pedido." : "Confirmo que o pedido foi entregue ao cliente."}</span>
            </label>
            <Button type="submit" className="w-full" disabled={busy}>
              {stepLabel("delivered", method)}
            </Button>
          </Form>
        </details>
      )}
      {allowed && !pickup && canEditTracking(order.status, f.stage) && (
        <details open={Boolean(trackingErrors.carrier || trackingErrors.trackingCode || trackingErrors.trackingUrl)} className="border-t border-line pt-4">
          <summary className="cursor-pointer underline-offset-4 hover:underline">{f.trackingCode ? "Corrigir rastreamento…" : "Adicionar rastreamento…"}</summary>
          {/* key: a saved change resets the fields to what was stored */}
          <Form method="post" className="mt-3 space-y-3" key={`${f.carrier}|${f.trackingCode}|${f.trackingUrl}`}>
            <input type="hidden" name="intent" value="tracking" />
            <TrackingFields idPrefix="rastreio" errors={trackingErrors} defaults={f} />
            <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
              Salvar rastreamento
            </Button>
          </Form>
        </details>
      )}
      {allowed && order.status !== "pending_payment" && order.status !== "cancelled" && f.stage !== "delivered" && (
        <p className="text-xs text-muted">As etapas não podem ser desfeitas; uma etapa pode ser pulada.</p>
      )}
    </section>
  );
}

function StepButton({ step, method, busy }: { step: FulfillmentStep; method: AdminOrderView["shipping"]["method"]; busy: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="fulfill" />
      <input type="hidden" name="step" value={step} />
      <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
        {stepLabel(step, method)}
      </Button>
    </Form>
  );
}

function TrackingFields({
  idPrefix,
  errors,
  defaults,
}: {
  idPrefix: string;
  errors: Record<string, string | undefined>;
  defaults: AdminOrderView["fulfillment"];
}) {
  const fields = [
    { name: "carrier", label: "Transportadora", type: "text", max: CARRIER_MAX, value: defaults.carrier, hint: "Ex.: Correios, motoboy" },
    { name: "trackingCode", label: "Código de rastreamento", type: "text", max: TRACKING_CODE_MAX, value: defaults.trackingCode, hint: null },
    { name: "trackingUrl", label: "Link de rastreamento", type: "url", max: TRACKING_URL_MAX, value: defaults.trackingUrl, hint: "Começa com https://" },
  ] as const;
  return (
    <>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const error = errors[field.name];
        return (
          <div key={field.name}>
            <label htmlFor={id} className="mb-1 block">
              {field.label} <span className="text-muted">(opcional)</span>
            </label>
            <input
              id={id}
              name={field.name}
              type={field.type}
              maxLength={field.max}
              defaultValue={field.value ?? ""}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-erro` : field.hint ? `${id}-dica` : undefined}
              className={cx(FIELD, error ? "border-danger" : "border-line-strong")}
            />
            {error ? (
              <p id={`${id}-erro`} className="mt-1 text-danger">
                {error}
              </p>
            ) : (
              field.hint && (
                <p id={`${id}-dica`} className="mt-1 text-xs text-muted">
                  {field.hint}
                </p>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

function Refunds({
  order,
  allowed,
  refundKey,
  busy,
  result,
}: {
  order: AdminOrderView;
  allowed: boolean;
  refundKey: string;
  busy: boolean;
  result: ActionResult | undefined;
}) {
  const { payment, refunds } = order;
  const remaining = payment.amountCents - payment.refundedCents;
  const showForm = allowed && canRefund(order.status) && remaining > 0;
  if (refunds.length === 0 && !showForm) return null;
  const errors = result?.fieldErrors ?? {};
  const restockLines = order.lines.filter((line) => order.restockable[line.sku] !== undefined);
  const backByDefault = restockByDefault(order.fulfillment.stage, order.shipping.method);
  const error = (field: string) =>
    errors[field] && (
      <p id={`reembolso-${field}-erro`} className="mt-1 text-danger">
        {errors[field]}
      </p>
    );

  return (
    <section aria-labelledby="reembolsos" className="space-y-4 border border-line bg-surface p-5 text-sm">
      <h2 id="reembolsos" className="text-xl">
        Reembolsos
      </h2>
      {refunds.length > 0 && (
        <>
          <ul className="space-y-3">
            {refunds.map((r) => (
              <li key={r.id}>
                <p>
                  <strong className="tabular-nums">{formatBRL(r.amountCents)}</strong> — {REFUND_REASON_LABEL[r.reason]}
                </p>
                {r.note && <p className="text-muted">{r.note}</p>}
                {r.restock.length > 0 && <p className="text-muted">De volta ao estoque: {r.restock.map((l) => `${l.quantity} × ${l.sku}`).join(", ")}</p>}
                <p className="text-muted">
                  {r.by.email} · <time dateTime={r.at}>{when(r.at)}</time>
                </p>
              </li>
            ))}
          </ul>
          <p>
            Total reembolsado: <strong className="tabular-nums">{formatBRL(payment.refundedCents)}</strong> de {formatBRL(payment.amountCents)}
          </p>
        </>
      )}
      {showForm && (
        <details open={Object.keys(errors).length > 0} className={refunds.length > 0 ? "border-t border-line pt-4" : undefined}>
          <summary className="cursor-pointer underline-offset-4 hover:underline">Registrar reembolso…</summary>
          {/* key: a recorded refund brings a new key and empty fields */}
          <Form method="post" className="mt-4 space-y-4" key={refundKey}>
            <input type="hidden" name="intent" value="refund" />
            <input type="hidden" name="key" value={refundKey} />
            <p className="text-muted">Primeiro devolva o valor pelo app do banco; depois registre aqui. Um reembolso registrado não pode ser desfeito.</p>
            <div>
              <label htmlFor="reembolso-amount" className="mb-1 block">
                Valor devolvido (R$)
              </label>
              <input
                id="reembolso-amount"
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max={(remaining / 100).toFixed(2)}
                defaultValue={(remaining / 100).toFixed(2)}
                required
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? "reembolso-amount-erro" : "reembolso-amount-dica"}
                className={cx(FIELD, errors.amount ? "border-danger" : "border-line-strong")}
              />
              {errors.amount ? (
                error("amount")
              ) : (
                <p id="reembolso-amount-dica" className="mt-1 text-xs text-muted">
                  Ainda pode ser reembolsado: {formatBRL(remaining)}
                </p>
              )}
            </div>
            <fieldset aria-describedby={errors.reason ? "reembolso-reason-erro" : undefined}>
              <legend className="mb-2">Motivo</legend>
              <div className="space-y-2">
                {REFUND_REASONS.map((reason) => (
                  <label key={reason} className="flex items-center gap-3">
                    <input type="radio" name="reason" value={reason} required className="size-4 accent-ink" />
                    {REFUND_REASON_LABEL[reason]}
                  </label>
                ))}
              </div>
              {error("reason")}
            </fieldset>
            <div>
              <label htmlFor="reembolso-note" className="mb-1 block">
                Observação <span className="text-muted">(obrigatória em “Outro motivo”)</span>
              </label>
              <textarea
                id="reembolso-note"
                name="note"
                rows={2}
                maxLength={REFUND_NOTE_MAX}
                aria-invalid={errors.note ? true : undefined}
                aria-describedby={errors.note ? "reembolso-note-erro" : undefined}
                className={cx("w-full rounded-md border bg-paper px-3 py-2 text-base", errors.note ? "border-danger" : "border-line-strong")}
              />
              {error("note")}
            </div>
            {restockLines.length > 0 && (
              <fieldset className="space-y-2" aria-describedby={errors.restock ? "reembolso-restock-erro" : "reembolso-restock-dica"}>
                <legend className="mb-1">Voltam ao estoque</legend>
                <p id="reembolso-restock-dica" className="text-xs text-muted">
                  {backByDefault
                    ? "O pedido ainda não saiu da loja: por padrão, todas as unidades voltam à venda."
                    : "O pedido já saiu da loja: devolva ao estoque só o que o cliente mandou de volta em bom estado."}
                </p>
                {restockLines.map((line) => {
                  const max = order.restockable[line.sku]!;
                  const id = `estoque-${line.sku}`;
                  return (
                    <div key={line.sku} className="flex items-center justify-between gap-3">
                      <label htmlFor={id} className="min-w-0">
                        {line.name}
                        {line.variantName && <> — {line.variantName}</>} <span className="text-muted">(até {max})</span>
                      </label>
                      <input
                        id={id}
                        name={restockField(line.sku)}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={max}
                        step={1}
                        defaultValue={backByDefault ? max : 0}
                        className={cx(FIELD, "w-20 shrink-0", errors.restock ? "border-danger" : "border-line-strong")}
                      />
                    </div>
                  );
                })}
                {error("restock")}
              </fieldset>
            )}
            <label className="flex items-start gap-3">
              <input type="checkbox" name="confirmed" value="yes" required className="mt-0.5 size-5 shrink-0 accent-ink" />
              <span>Já devolvi este valor ao cliente pelo app do banco.</span>
            </label>
            {error("confirmed")}
            {error("key")}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-[var(--radius-control)] border border-danger px-6 py-3 text-sm font-medium text-danger transition-colors hover:bg-danger hover:text-paper disabled:opacity-50"
            >
              Registrar reembolso
            </button>
          </Form>
        </details>
      )}
    </section>
  );
}

function Notes({ order, allowed, busy, result }: { order: AdminOrderView; allowed: boolean; busy: boolean; result: ActionResult | undefined }) {
  const error = result?.fieldErrors?.text;
  return (
    <section aria-labelledby="notas" className="space-y-3">
      <h2 id="notas" className="text-xl">
        Notas internas
      </h2>
      <p className="text-sm text-muted">Só a equipe vê. Uma nota não pode ser editada nem apagada.</p>
      {order.notes.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma nota ainda.</p>
      ) : (
        <ul className="space-y-3">
          {order.notes.map((note) => (
            <li key={note.id} className="border border-line bg-surface p-4 text-sm">
              <p className="whitespace-pre-line">{note.text}</p>
              <p className="mt-2 text-muted">
                {note.by.email} · <time dateTime={note.at}>{when(note.at)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      {allowed && (
        // key: after a note is added the box starts empty again
        <Form method="post" className="space-y-2" key={order.notes.length}>
          <input type="hidden" name="intent" value="note" />
          <label htmlFor="nova-nota" className="block text-sm">
            Nova nota
          </label>
          <textarea
            id="nova-nota"
            name="text"
            rows={3}
            maxLength={NOTE_MAX}
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "nova-nota-erro" : undefined}
            className={cx("w-full rounded-md border bg-paper px-3 py-2 text-base", error ? "border-danger" : "border-line-strong")}
          />
          {error && (
            <p id="nova-nota-erro" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="secondary" disabled={busy}>
            Adicionar nota
          </Button>
        </Form>
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
