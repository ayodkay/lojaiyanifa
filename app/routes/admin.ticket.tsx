// /admin/support/:number — one customer message: who, about what (order, return request), the thread, and the
// answer form. Answering sends the text to the customer by e-mail (app/.server/support.ts, replyToTicket) and marks
// the ticket answered; it can be closed and reopened. Every action is audited.
import { useEffect, useRef } from "react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";

import { ADMIN_HEADERS, adminUserContext, requireCapability } from "~/.server/admin-guard";
import { getTicket, REPLY_MAX, replyToTicket, setTicketStatus, TicketNotFoundError, TicketStateError } from "~/.server/support";
import { Button, cx, Notice } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";
import { formatBrPhone } from "~/lib/br";
import { RETURN_PREFERENCE_LABEL, RETURN_REASON_LABEL, type ReturnPreference, type ReturnReason, TICKET_STATUS_LABEL, TOPIC_LABEL } from "~/lib/support";

import type { Route } from "./+types/admin.ticket";

export async function loader({ params, context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "support.view");
  const ticket = await getTicket(Number(params.number));
  if (!ticket) throw data("Mensagem não encontrada.", { status: 404, headers: ADMIN_HEADERS });
  return { ticket };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "support.reply");
  const number = Number(params.number);
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    if (intent === "reply") {
      const text = String(form.get("reply") ?? "").trim();
      if (!text) return data({ error: "Escreva a resposta." }, { status: 400, headers: ADMIN_HEADERS });
      await replyToTicket(number, text, user);
    } else if (intent === "close" || intent === "reopen") {
      await setTicketStatus(number, intent === "close" ? "closed" : "open", user);
    } else {
      return data({ error: "Ação desconhecida." }, { status: 400, headers: ADMIN_HEADERS });
    }
  } catch (error) {
    if (error instanceof TicketNotFoundError) throw data("Mensagem não encontrada.", { status: 404, headers: ADMIN_HEADERS });
    if (error instanceof TicketStateError) return data({ error: error.message }, { status: 409, headers: ADMIN_HEADERS });
    throw error;
  }
  return redirect(`/admin/support/${number}${intent === "reply" ? "?respondido=1" : ""}`, { headers: ADMIN_HEADERS });
}

export const meta = ({ params }: Route.MetaArgs) => adminMeta(`Atendimento nº ${params.number}`);

export default function AdminTicket({ loaderData, actionData }: Route.ComponentProps) {
  const { ticket } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement>(null);
  const [params] = useSearchParams();
  const replied = params.has("respondido");

  // A reply that went through: clear the text box.
  useEffect(() => {
    if (navigation.state === "idle" && replied) formRef.current?.reset();
  }, [navigation.state, replied]);

  const rr = ticket.returnRequest;
  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin/support" className="text-sm underline underline-offset-4">
          ← Atendimento
        </Link>
        <h1 className="mt-4 text-3xl md:text-4xl">Atendimento nº {ticket.number}</h1>
        <p className="mt-2 text-muted">
          {TOPIC_LABEL[ticket.topic]} · {TICKET_STATUS_LABEL[ticket.status]} · aberto em {adminDateTime.format(new Date(ticket.createdAt))}
        </p>
      </div>

      {actionData?.error && <Notice tone="danger">{actionData.error}</Notice>}
      {replied && !busy && <Notice tone="success">Resposta enviada por e-mail para {ticket.email}.</Notice>}

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="conversa" className="space-y-4">
          <h2 id="conversa" className="text-2xl">
            Conversa
          </h2>
          <ol className="space-y-4">
            {ticket.messages.map((m) => (
              <li key={m.id} className={cx("border p-4", m.from === "store" ? "border-ink/30 bg-surface lg:ml-12" : "border-line bg-paper")}>
                <p className="mb-2 text-xs text-muted">
                  {m.from === "store" ? "Loja" : ticket.name} · {adminDateTime.format(new Date(m.at))}
                </p>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </li>
            ))}
          </ol>
          <Form ref={formRef} method="post" className="space-y-3">
            <input type="hidden" name="intent" value="reply" />
            <label htmlFor="f-reply" className="block text-sm">
              Responder (vai por e-mail para {ticket.email})
            </label>
            <textarea id="f-reply" name="reply" rows={6} maxLength={REPLY_MAX} required className="w-full rounded-xl border border-line-strong bg-paper p-3" />
            <Button type="submit" disabled={busy}>
              {busy ? "Enviando…" : "Enviar resposta"}
            </Button>
          </Form>
        </section>

        <aside className="h-fit space-y-6 border border-line bg-surface p-6 text-sm">
          <div>
            <h2 className="mb-2 font-medium">Cliente</h2>
            <p>{ticket.name}</p>
            <p>
              <a href={`mailto:${ticket.email}`} className="break-all underline underline-offset-4">
                {ticket.email}
              </a>
            </p>
            {ticket.phone && <p>{formatBrPhone(ticket.phone)}</p>}
            <p className="mt-1 text-muted">{ticket.customerUid ? "Enviado com a conta logada" : "Enviado sem login"}</p>
          </div>
          {ticket.orderNumber && (
            <div>
              <h2 className="mb-2 font-medium">Pedido</h2>
              <Link to={`/admin/orders/${ticket.orderNumber}`} className="underline underline-offset-4">
                Pedido nº {ticket.orderNumber}
              </Link>
              <p className="mt-1 text-muted">Confira se o pedido é deste cliente antes de agir.</p>
            </div>
          )}
          {rr && (
            <div>
              <h2 className="mb-2 font-medium">Pedido de troca ou devolução</h2>
              <p>Motivo: {RETURN_REASON_LABEL[rr.reason as ReturnReason] ?? rr.reason}</p>
              <p>Prefere: {RETURN_PREFERENCE_LABEL[rr.preference as ReturnPreference] ?? rr.preference}</p>
              {rr.items && <p>Itens: {rr.items}</p>}
              {rr.reason === "withdrawal" && (
                <p className="mt-2 text-muted">Desistência (art. 49 do CDC): frete de devolução por conta da loja e reembolso integral, inclusive do frete pago.</p>
              )}
            </div>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value={ticket.status === "closed" ? "reopen" : "close"} />
            <Button type="submit" variant="secondary" disabled={busy}>
              {ticket.status === "closed" ? "Reabrir" : "Encerrar atendimento"}
            </Button>
          </Form>
        </aside>
      </div>
    </div>
  );
}
