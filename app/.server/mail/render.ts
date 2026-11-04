// E-mail contents (pt-BR), rendered by the sender from the outbox entry and the order as it is at send time.
// Pure: no I/O. Each template is a subject + blocks; every block renders to escaped HTML and to plain text.
import { formatCep } from "~/lib/br";
import { formatBRL } from "~/lib/money";
import type { CustomerOrderView } from "~/lib/orders";

import { html, type SafeHtml, safeUrl } from "./html";
import type { MailTemplate } from "./outbox";

export interface MailContext {
  /** Public origin, no trailing slash. */
  siteUrl: string;
  storeName: string;
  supportEmail: string | null;
  whatsappHref: string | null;
}

/** The order as the e-mails see it: the customer's view plus what links and cancellations need. */
export interface MailOrder extends CustomerOrderView {
  /** Secret for the customer's order page link (orders created before 2026-11-04 have none). */
  linkToken: string | null;
  cancellationReason: "payment_not_received" | "customer_request" | "other" | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

type Block =
  | { kind: "p"; text: string; strong?: boolean }
  | { kind: "button"; label: string; href: string }
  | { kind: "code"; label: string; value: string }
  | { kind: "rows"; title: string; rows: [string, string][] }
  | { kind: "lines"; order: MailOrder };

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const SAO_PAULO = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
export const formatSaoPaulo = (iso: string): string => SAO_PAULO.format(new Date(iso));

export function orderLink(ctx: MailContext, order: MailOrder): string | null {
  return order.linkToken ? `${ctx.siteUrl}/order-confirmation/${order.number}?t=${encodeURIComponent(order.linkToken)}` : null;
}

function addressLine(order: MailOrder): string | null {
  const a = order.shipping.address;
  if (!a) return null;
  return `${a.street}, ${a.number}${a.complement ? ` – ${a.complement}` : ""} – ${a.neighborhood}, ${a.city} – ${a.state}, CEP ${formatCep(a.cep)}`;
}

function deliveryRows(order: MailOrder): [string, string][] {
  const rows: [string, string][] = [["Forma de entrega", order.shipping.label]];
  const address = addressLine(order);
  if (address) rows.push(["Endereço", address]);
  if (order.shipping.pickupAddress) rows.push(["Retirada em", order.shipping.pickupAddress]);
  const days = order.shipping.estimateDays;
  if (days) {
    const range = days.min === days.max ? `${days.max}` : `${days.min} a ${days.max}`;
    rows.push(["Prazo", `${range} dia${days.max === 1 ? "" : "s"} út${days.max === 1 ? "il" : "eis"} após a confirmação do pagamento`]);
  }
  return rows;
}

function orderButton(ctx: MailContext, order: MailOrder, label = "Ver o pedido"): Block {
  const href = orderLink(ctx, order);
  return href
    ? { kind: "button", label, href }
    : { kind: "p", text: "Você acompanha o pedido pelo link da página que abriu ao finalizar a compra." };
}

const CANCEL_REASON: Record<NonNullable<MailOrder["cancellationReason"]>, string | null> = {
  payment_not_received: "o pagamento não foi identificado",
  customer_request: "você pediu o cancelamento",
  other: null,
};

const dataText = (data: Record<string, unknown>, key: string, template: MailTemplate): string => {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${template} e-mail needs data.${key}: ${JSON.stringify(data)}`);
  return value.trim();
};

/** Templates that aren't about an order: subject + blocks from `data` alone. */
function composeOther(template: MailTemplate, data: Record<string, unknown>, ctx: MailContext): { subject: string; blocks: Block[] } | null {
  switch (template) {
    case "welcome":
      return {
        subject: `Boas-vindas à ${ctx.storeName}`,
        blocks: [
          { kind: "p", text: `Olá, ${firstName(dataText(data, "name", template))}!` },
          { kind: "p", text: `Sua conta na ${ctx.storeName} foi criada. Nela você acompanha seus pedidos, salva endereços e favoritos e cuida dos seus dados.` },
          { kind: "p", text: "Se você ainda não confirmou o seu e-mail, use o link que enviamos em outra mensagem." },
          { kind: "button", label: "Ir para a minha conta", href: `${ctx.siteUrl}/account` },
        ],
      };
    default:
      return null;
  }
}

/** Subject + blocks for each template. `data` is what the event stored in the outbox entry. */
function compose(template: MailTemplate, data: Record<string, unknown>, maybeOrder: MailOrder | null, ctx: MailContext): { subject: string; blocks: Block[] } {
  const other = composeOther(template, data, ctx);
  if (other) return other;
  if (!maybeOrder) throw new Error(`the ${template} e-mail needs its order`);
  const order = maybeOrder;
  const n = order.number;
  const hello: Block = { kind: "p", text: `Olá, ${firstName(order.customer.name)}!` };
  switch (template) {
    case "order_placed":
      return {
        subject: `Pedido nº ${n} recebido — pague com Pix para confirmar`,
        blocks: [
          hello,
          { kind: "p", text: `Recebemos o seu pedido nº ${n}. Para confirmá-lo, pague ${formatBRL(order.payment.amountCents)} com Pix até ${formatSaoPaulo(order.expiresAt)} (horário de Brasília).` },
          { kind: "code", label: "Pix copia e cola", value: order.payment.brCode },
          { kind: "p", text: "Abra o app do seu banco, escolha pagar com Pix e cole o código acima, ou leia o QR Code na página do pedido. Se o pagamento não for identificado até o prazo, o pedido é cancelado automaticamente e nada é cobrado." },
          orderButton(ctx, order, "Ver o pedido e o QR Code"),
          { kind: "lines", order },
          { kind: "rows", title: "Entrega", rows: deliveryRows(order) },
        ],
      };
    case "store_new_order":
      return {
        subject: `Novo pedido nº ${n} — ${formatBRL(order.totals.totalCents)} (aguardando Pix)`,
        blocks: [
          { kind: "p", text: `Pedido nº ${n} feito em ${formatSaoPaulo(order.createdAt)}. O Pix vence em ${formatSaoPaulo(order.expiresAt)}.` },
          { kind: "rows", title: "Cliente", rows: [["Nome", order.customer.name], ["E-mail", order.customer.email], ["Celular", order.customer.phone]] },
          { kind: "lines", order },
          { kind: "rows", title: "Entrega", rows: deliveryRows(order) },
          { kind: "button", label: "Abrir no painel", href: `${ctx.siteUrl}/admin/orders/${n}` },
        ],
      };
    case "payment_confirmed":
      return {
        subject: `Pagamento confirmado — pedido nº ${n}`,
        blocks: [
          hello,
          { kind: "p", text: `Recebemos o seu pagamento de ${formatBRL(order.payment.amountCents)}. Agora vamos preparar o seu pedido nº ${n}.` },
          { kind: "rows", title: "Entrega", rows: deliveryRows(order) },
          orderButton(ctx, order),
        ],
      };
    case "order_shipped":
    case "order_tracking_updated": {
      const f = order.fulfillment;
      const rows: [string, string][] = [];
      if (f.carrier) rows.push(["Transportadora", f.carrier]);
      if (f.trackingCode) rows.push(["Código de rastreamento", f.trackingCode]);
      const address = addressLine(order);
      if (address) rows.push(["Endereço", address]);
      const tracking = safeUrl(f.trackingUrl);
      const shipped = template === "order_shipped";
      return {
        subject: shipped ? `Seu pedido nº ${n} foi enviado` : `Rastreamento do pedido nº ${n}`,
        blocks: [
          hello,
          { kind: "p", text: shipped ? `O seu pedido nº ${n} saiu para entrega.` : `Atualizamos os dados de rastreamento do seu pedido nº ${n}.` },
          ...(rows.length ? [{ kind: "rows", title: "Envio", rows } satisfies Block] : []),
          tracking ? ({ kind: "button", label: "Acompanhar a entrega", href: tracking } satisfies Block) : orderButton(ctx, order),
        ],
      };
    }
    case "order_ready_for_pickup":
      return {
        subject: `Pedido nº ${n} pronto para retirada`,
        blocks: [
          hello,
          { kind: "p", text: `O seu pedido nº ${n} está pronto para retirada.` },
          { kind: "rows", title: "Retirada", rows: order.shipping.pickupAddress ? [["Endereço", order.shipping.pickupAddress]] : [] },
          { kind: "p", text: "Leve o número do pedido e um documento com foto. Se outra pessoa for retirar por você, avise-nos antes." },
          orderButton(ctx, order),
        ],
      };
    case "order_delivered": {
      const pickup = order.shipping.method === "pickup";
      return {
        subject: pickup ? `Pedido nº ${n} retirado` : `Pedido nº ${n} entregue`,
        blocks: [
          hello,
          { kind: "p", text: pickup ? `O seu pedido nº ${n} foi retirado. Obrigado pela compra!` : `O seu pedido nº ${n} foi entregue. Obrigado pela compra!` },
          { kind: "p", text: `Se algo não estiver certo, fale com a gente. Você pode desistir da compra em até 7 dias a partir do recebimento: ${ctx.siteUrl}/returns` },
          orderButton(ctx, order),
        ],
      };
    }
    case "order_cancelled": {
      const expired = data.expired === true;
      const reason = order.cancellationReason ? CANCEL_REASON[order.cancellationReason] : null;
      return {
        subject: `Pedido nº ${n} cancelado`,
        blocks: [
          hello,
          {
            kind: "p",
            text: expired
              ? `O prazo para pagar o pedido nº ${n} terminou e ele foi cancelado automaticamente. Nada foi cobrado.`
              : `O seu pedido nº ${n} foi cancelado${reason ? ` porque ${reason}` : ""}.`,
          },
          {
            kind: "p",
            text: expired
              ? "Se ainda quiser os produtos, é só fazer um novo pedido. Se você pagou depois do prazo, fale com a gente: devolvemos o valor."
              : "Se você já tinha pago, fale com a gente para receber o reembolso.",
          },
          orderButton(ctx, order),
        ],
      };
    }
    case "order_refunded": {
      const amount = Number(data.amountCents);
      const total = Number(data.refundedCents);
      if (!Number.isInteger(amount) || amount < 1 || !Number.isInteger(total) || total < amount) {
        throw new Error(`order_refunded e-mail for order ${n} has invalid data: ${JSON.stringify(data)}`);
      }
      const full = total >= order.payment.amountCents;
      return {
        subject: `Reembolso de ${formatBRL(amount)} — pedido nº ${n}`,
        blocks: [
          hello,
          { kind: "p", text: `Devolvemos ${formatBRL(amount)} referentes ao seu pedido nº ${n}, por Pix.` },
          {
            kind: "p",
            text: full
              ? `O valor pago (${formatBRL(order.payment.amountCents)}) foi devolvido integralmente.`
              : `Até agora, devolvemos ${formatBRL(total)} de ${formatBRL(order.payment.amountCents)} pagos.`,
          },
          orderButton(ctx, order),
        ],
      };
    }
    default:
      throw new Error(`no order e-mail named ${template}`);
  }
}

// --- rendering ------------------------------------------------------------------------------------

const C = { ink: "#1f1a14", muted: "#6b6258", line: "#e4ddd2", paper: "#f6f3ec", surface: "#ffffff" };

function linesHtml(order: MailOrder): SafeHtml {
  const t = order.totals;
  const row = (label: string, value: string, strong = false) =>
    html`<tr><td style="padding:4px 0;color:${strong ? C.ink : C.muted};${strong ? "font-weight:bold;" : ""}">${label}</td><td style="padding:4px 0;text-align:right;${strong ? "font-weight:bold;" : ""}">${value}</td></tr>`;
  return html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;font-size:14px">
${order.lines.map(
  (l) =>
    html`<tr><td style="padding:6px 0;border-bottom:1px solid ${C.line}">${l.name}${l.variantName ? ` — ${l.variantName}` : ""} × ${l.quantity}</td><td style="padding:6px 0;border-bottom:1px solid ${C.line};text-align:right;white-space:nowrap">${formatBRL(l.lineTotalCents)}</td></tr>`,
)}
${row("Subtotal", formatBRL(t.subtotalCents))}
${t.discountCents > 0 ? row("Desconto", `− ${formatBRL(t.discountCents)}`) : null}
${row("Entrega", t.shippingCents === 0 ? "Grátis" : formatBRL(t.shippingCents))}
${row("Total", formatBRL(t.totalCents), true)}
</table>`;
}

function linesText(order: MailOrder): string {
  const t = order.totals;
  return [
    ...order.lines.map((l) => `- ${l.name}${l.variantName ? ` — ${l.variantName}` : ""} × ${l.quantity}: ${formatBRL(l.lineTotalCents)}`),
    `Subtotal: ${formatBRL(t.subtotalCents)}`,
    ...(t.discountCents > 0 ? [`Desconto: − ${formatBRL(t.discountCents)}`] : []),
    `Entrega: ${t.shippingCents === 0 ? "Grátis" : formatBRL(t.shippingCents)}`,
    `Total: ${formatBRL(t.totalCents)}`,
  ].join("\n");
}

function blockHtml(block: Block): SafeHtml {
  switch (block.kind) {
    case "p":
      return html`<p style="margin:0 0 16px;line-height:1.5">${block.strong ? html`<strong>${block.text}</strong>` : block.text}</p>`;
    case "button":
      return html`<p style="margin:24px 0"><a href="${block.href}" style="display:inline-block;background:${C.ink};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:14px">${block.label}</a></p>`;
    case "code":
      return html`<p style="margin:0 0 4px;color:${C.muted};font-size:13px">${block.label}</p><p style="margin:0 0 16px;padding:12px;background:${C.paper};border:1px solid ${C.line};font-family:monospace;font-size:12px;word-break:break-all">${block.value}</p>`;
    case "rows":
      if (block.rows.length === 0) return html``;
      return html`<p style="margin:16px 0 6px;font-weight:bold">${block.title}</p><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${block.rows.map(([k, v]) => html`<tr><td style="padding:2px 12px 2px 0;color:${C.muted};vertical-align:top;white-space:nowrap">${k}</td><td style="padding:2px 0">${v}</td></tr>`)}</table>`;
    case "lines":
      return linesHtml(block.order);
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "button":
      return `${block.label}: ${block.href}`;
    case "code":
      return `${block.label}:\n${block.value}`;
    case "rows":
      return block.rows.length ? [`${block.title}:`, ...block.rows.map(([k, v]) => `${k}: ${v}`)].join("\n") : "";
    case "lines":
      return linesText(block.order);
  }
}

function footer(ctx: MailContext, template: MailTemplate): { html: SafeHtml; text: string } {
  if (template === "store_new_order") {
    return { html: html`<p style="margin:0;color:${C.muted};font-size:12px">Aviso automático do site ${ctx.siteUrl}.</p>`, text: `Aviso automático do site ${ctx.siteUrl}.` };
  }
  const contact = `${ctx.siteUrl}/contact`;
  return {
    html: html`<p style="margin:0 0 6px;color:${C.muted};font-size:12px">Dúvidas? Responda a este e-mail ou fale com a gente em <a href="${contact}" style="color:${C.muted}">${contact}</a>${ctx.whatsappHref ? html` ou pelo <a href="${ctx.whatsappHref}" style="color:${C.muted}">WhatsApp</a>` : null}.</p><p style="margin:0;color:${C.muted};font-size:12px">${ctx.storeName} · ${ctx.siteUrl}</p>`,
    text: `Dúvidas? Responda a este e-mail ou fale com a gente em ${contact}${ctx.whatsappHref ? ` ou pelo WhatsApp: ${ctx.whatsappHref}` : ""}.\n${ctx.storeName} · ${ctx.siteUrl}`,
  };
}

export function renderMail(template: MailTemplate, data: Record<string, unknown>, order: MailOrder | null, ctx: MailContext): RenderedMail {
  const { subject, blocks } = compose(template, data, order, ctx);
  const foot = footer(ctx, template);
  const body = html`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:${C.paper};color:${C.ink};font-family:Helvetica,Arial,sans-serif;font-size:15px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.surface};border:1px solid ${C.line}">
<tr><td style="padding:20px 24px;border-bottom:1px solid ${C.line};font-size:20px;font-family:Georgia,serif">${ctx.storeName}</td></tr>
<tr><td style="padding:24px">${blocks.map(blockHtml)}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${C.line}">${foot.html}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [...blocks.map(blockText).filter(Boolean), "—", foot.text].join("\n\n");
  return { subject, html: body.value, text };
}
