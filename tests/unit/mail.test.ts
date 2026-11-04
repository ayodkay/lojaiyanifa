import { describe, expect, it } from "vitest";

import { escapeHtml, html, safeUrl } from "~/.server/mail/html";
import { type MailContext, type MailOrder, renderMail } from "~/.server/mail/render";
import { backoffMs, mailConfig, sendErrorKind, smtpOptions } from "~/.server/mail/send";
import { stepMail } from "~/.server/order-fulfillment";
import { orderTokenMatches } from "~/.server/orders";

/** formatBRL puts a non-breaking space after R$; compare with ordinary spaces. */
const plain = (m: { subject: string; text: string; html: string }) => ({ subject: m.subject.replace(/ /g, " "), text: m.text.replace(/ /g, " "), html: m.html });

const ctx: MailContext = { siteUrl: "https://loja.example", storeName: "Loja Iyanifa", supportEmail: "atendimento@loja.example", whatsappHref: null, businessHours: [] };

const order = (overrides: Partial<MailOrder> = {}): MailOrder => ({
  number: 1001,
  status: "pending_payment",
  createdAt: "2026-11-04T13:00:00.000Z",
  expiresAt: "2026-11-05T13:00:00.000Z",
  customer: { name: "Maria da Silva", email: "maria@exemplo.com", phone: "+5521987654321" },
  shipping: {
    method: "flat_rate",
    label: "Entrega em todo o Brasil",
    priceCents: 2500,
    address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
    pickupAddress: null,
    estimateDays: { min: 3, max: 7 },
  },
  lines: [{ productId: "p1", sku: "COLAR-1", name: "Colar", variantName: null, imageUrl: null, unitPriceCents: 12990, quantity: 2, lineTotalCents: 25980 }],
  totals: { subtotalCents: 25980, shippingCents: 2500, discountCents: 0, totalCents: 28480, savingsCents: 0 },
  payment: { method: "pix", status: "pending", amountCents: 28480, txid: "PEDIDO1001", brCode: "00020126PIXCODE6304ABCD", refundedCents: 0 },
  fulfillment: { stage: "unfulfilled", carrier: null, trackingCode: null, trackingUrl: null, processingAt: null, shippedAt: null, deliveredAt: null },
  refunds: [],
  linkToken: "link-token-1",
  cancellationReason: null,
  ...overrides,
});

describe("html", () => {
  it("escapes interpolated values but keeps nested html as it is", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    expect(html`<p>${"<b>"}${html`<i>ok</i>`}</p>`.value).toBe("<p>&lt;b&gt;<i>ok</i></p>");
  });

  it("allows only https links (and http on localhost for development)", () => {
    expect(safeUrl("https://rastreio.example/x?a=1")).toBe("https://rastreio.example/x?a=1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("http://rastreio.example")).toBeNull();
    expect(safeUrl("http://localhost:5173/a")).toBe("http://localhost:5173/a");
    expect(safeUrl("não é url")).toBeNull();
  });
});

describe("renderMail", () => {
  it("order_placed: amount, deadline in Brasília time, Pix code, items, address and the order link", () => {
    const mail = plain(renderMail("order_placed", {}, order(), ctx));
    expect(mail.subject).toBe("Pedido nº 1001 recebido — pague com Pix para confirmar");
    expect(mail.text).toContain("pague R$ 284,80 com Pix até 05/11/2026, 10:00 (horário de Brasília)");
    expect(mail.text).toContain("00020126PIXCODE6304ABCD");
    expect(mail.text).toContain("- Colar × 2: R$ 259,80");
    expect(mail.text).toContain("Estrada do Portela, 99 – Madureira, Rio de Janeiro – RJ, CEP 21360-201");
    expect(mail.text).toContain("3 a 7 dias úteis após a confirmação do pagamento");
    expect(mail.text).toContain("https://loja.example/order-confirmation/1001?t=link-token-1");
    expect(mail.html).toContain('href="https://loja.example/order-confirmation/1001?t=link-token-1"');
  });

  it("escapes what the customer typed", () => {
    const evil = order({ customer: { name: `<script>alert("x")</script> Silva`, email: "m@exemplo.com", phone: "+5521987654321" } });
    const mail = plain(renderMail("order_placed", {}, evil, ctx));
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("without a link token (older orders) it says where to follow the order instead of linking", () => {
    const mail = plain(renderMail("payment_confirmed", {}, order({ linkToken: null }), ctx));
    expect(mail.text).not.toContain("order-confirmation");
    expect(mail.text).toContain("pelo link da página que abriu ao finalizar a compra");
  });

  it("order_shipped links the https tracking page and never a javascript: link", () => {
    const shipped = order({ fulfillment: { ...order().fulfillment, stage: "shipped", carrier: "Correios", trackingCode: "AA123BR", trackingUrl: "https://rastreio.example/AA123BR" } });
    const mail = plain(renderMail("order_shipped", {}, shipped, ctx));
    expect(mail.subject).toBe("Seu pedido nº 1001 foi enviado");
    expect(mail.text).toContain("Código de rastreamento: AA123BR");
    expect(mail.text).toContain("Acompanhar a entrega: https://rastreio.example/AA123BR");

    const evil = order({ fulfillment: { ...shipped.fulfillment, trackingUrl: "javascript:alert(1)" } });
    expect(plain(renderMail("order_shipped", {}, evil, ctx)).html).not.toContain("javascript:");
  });

  it("order_cancelled tells an automatic cancellation from the store's", () => {
    expect(plain(renderMail("order_cancelled", { expired: true }, order({ status: "cancelled" }), ctx)).text).toContain("foi cancelado automaticamente. Nada foi cobrado.");
    const byStore = plain(renderMail("order_cancelled", { expired: false }, order({ status: "cancelled", cancellationReason: "customer_request" }), ctx));
    expect(byStore.text).toContain("foi cancelado porque você pediu o cancelamento.");
    expect(byStore.text).toContain("Se você já tinha pago");
  });

  it("order_refunded says how much came back, partial or full, and refuses bad data", () => {
    const paid = order({ status: "partially_refunded" });
    expect(plain(renderMail("order_refunded", { amountCents: 1000, refundedCents: 1000 }, paid, ctx)).text).toContain("Até agora, devolvemos R$ 10,00 de R$ 284,80 pagos.");
    expect(plain(renderMail("order_refunded", { amountCents: 27480, refundedCents: 28480 }, paid, ctx)).text).toContain("foi devolvido integralmente");
    expect(() => plain(renderMail("order_refunded", { amountCents: "x" }, paid, ctx))).toThrow(/invalid data/);
  });

  it("store_new_order goes to the store with the customer's contact and the admin link", () => {
    const mail = plain(renderMail("store_new_order", {}, order(), ctx));
    expect(mail.subject).toBe("Novo pedido nº 1001 — R$ 284,80 (aguardando Pix)");
    expect(mail.text).toContain("E-mail: maria@exemplo.com");
    expect(mail.text).toContain("Abrir no painel: https://loja.example/admin/orders/1001");
    expect(mail.text).not.toContain("Responda a este e-mail");
  });
});

describe("support e-mails", () => {
  const ticket = { number: 1001, topic: "returns", name: "Maria da Silva", message: "Quero devolver.\nObrigada.", orderNumber: 1007, returnReason: "withdrawal" };

  it("the automatic answer gives the protocol number and confirms a withdrawal as the decree requires", () => {
    const mail = plain(renderMail("ticket_received", ticket, null, { ...ctx, businessHours: ["Segunda a sexta: 9h às 18h"] }));
    expect(mail.subject).toBe("Recebemos o seu pedido de troca ou devolução — atendimento nº 1001");
    expect(mail.text).toContain("sobre troca, devolução ou desistência (pedido nº 1007). O número do seu atendimento é 1001.");
    expect(mail.text).toContain("confirma o recebimento do seu pedido de desistência da compra");
    expect(mail.text).toContain("Respondemos em até 5 dias. Nosso horário de atendimento: Segunda a sexta: 9h às 18h.");
    expect(mail.text).toContain("> Quero devolver.\n> Obrigada.");
  });

  it("a plain question gets no return wording", () => {
    const mail = plain(renderMail("ticket_received", { ...ticket, topic: "order", returnReason: null }, null, ctx));
    expect(mail.subject).toBe("Recebemos a sua mensagem — atendimento nº 1001");
    expect(mail.text).not.toContain("desistência");
  });

  it("the store's notice lists the request and links the inbox", () => {
    const mail = plain(renderMail("store_new_ticket", { ...ticket, email: "maria@exemplo.com", phone: null, returnPreference: "refund", returnItems: "1 Colar" }, null, ctx));
    expect(mail.subject).toBe("Atendimento nº 1001 — Troca, devolução ou desistência — pedido nº 1007");
    expect(mail.text).toContain("Motivo: Desisti da compra (até 7 dias após receber)");
    expect(mail.text).toContain("Prefere: Reembolso");
    expect(mail.text).toContain("Responder no painel: https://loja.example/admin/support/1001");
  });

  it("the team's reply is escaped in HTML and refuses missing data", () => {
    const mail = renderMail("ticket_reply", { number: 1001, name: "Maria", reply: "<b>Oi</b>" }, null, ctx);
    expect(mail.html).toContain("&lt;b&gt;Oi&lt;/b&gt;");
    expect(() => renderMail("ticket_reply", { number: 1001, name: "Maria" }, null, ctx)).toThrow(/needs data.reply/);
  });

  it("an order e-mail without its order is refused", () => {
    expect(() => renderMail("payment_confirmed", {}, null, ctx)).toThrow(/needs its order/);
  });
});

describe("stepMail", () => {
  it("e-mails the customer when an order ships, is ready for pickup or is delivered — not while it's prepared", () => {
    expect(stepMail("processing", "flat_rate")).toBeNull();
    expect(stepMail("shipped", "flat_rate")).toBe("order_shipped");
    expect(stepMail("shipped", "pickup")).toBe("order_ready_for_pickup");
    expect(stepMail("delivered", "pickup")).toBe("order_delivered");
  });
});

describe("SMTP configuration", () => {
  const vars = { MAIL_FROM: "Loja <pedidos@loja.example>", MAIL_REPLY_TO: undefined, SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: 587 as const, SMTP_USER: "login@smtp-brevo.com" };

  it("is missing until sender, login and key are all set ('unset' counts as missing)", () => {
    expect(mailConfig("chave", null, vars)).toMatchObject({ from: vars.MAIL_FROM, user: vars.SMTP_USER, password: "chave", replyTo: null });
    expect(mailConfig("chave", "atendimento@loja.example", vars)?.replyTo).toBe("atendimento@loja.example");
    expect(mailConfig(undefined, null, vars)).toBeNull();
    expect(mailConfig("unset", null, vars)).toBeNull();
    expect(mailConfig("chave", null, { ...vars, MAIL_FROM: undefined })).toBeNull();
    expect(mailConfig("chave", null, { ...vars, SMTP_USER: undefined })).toBeNull();
  });

  it("never sends in clear text: STARTTLS required on 587, TLS from the start on 465", () => {
    const base = mailConfig("chave", null, vars)!;
    expect(smtpOptions(base)).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(smtpOptions({ ...base, port: 465 })).toMatchObject({ port: 465, secure: true, requireTLS: false });
  });

  it("waits 2, 4, 8 then 16 minutes between attempts", () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n) / 60_000)).toEqual([2, 4, 8, 16]);
  });
});

/** Built like nodemailer's errors (smtp-connection _formatError): the response appended, its code, the SMTP command. */
const smtpError = (text: string, code: string, command: string, response?: string) =>
  Object.assign(new Error(response ? `${text}: ${response}` : text), { code, command }, response ? { response, responseCode: Number(/^\d+/.exec(response)![0]) } : {});

describe("sendErrorKind", () => {
  it("charges the e-mail only when the server refused its recipient or its content: 5xx for good, 4xx retried", () => {
    expect(sendErrorKind(smtpError("Recipient command failed", "EENVELOPE", "RCPT TO", "550 5.1.1 User unknown"))).toBe("permanent");
    expect(sendErrorKind(smtpError("Can't send mail - all recipients were rejected", "EENVELOPE", "RCPT TO", "550 5.1.1 User unknown"))).toBe("permanent");
    expect(sendErrorKind(smtpError("Message failed", "EMESSAGE", "DATA", "552 5.3.4 Message too big"))).toBe("permanent");
    expect(sendErrorKind(smtpError('Invalid recipient "x"', "EENVELOPE", "API"))).toBe("permanent");
    expect(sendErrorKind(smtpError("Recipient command failed", "EENVELOPE", "RCPT TO", "450 4.2.1 Mailbox busy"))).toBe("retry");
    expect(sendErrorKind(smtpError("Message failed", "EMESSAGE", "DATA", "451 4.3.0 Try again later"))).toBe("retry");
  });

  it("puts the login, the sender, the connection and anything unknown on the service, even with a 5xx", () => {
    expect(sendErrorKind(smtpError("Invalid login", "EAUTH", "AUTH PLAIN", "525 5.7.1 Unauthorized IP address"))).toBe("service");
    expect(sendErrorKind(smtpError("Invalid login", "EAUTH", "AUTH PLAIN", "535 5.7.8 Authentication failed"))).toBe("service");
    expect(sendErrorKind(smtpError("Mail command failed", "EENVELOPE", "MAIL FROM", "550 5.7.1 Sender not allowed"))).toBe("service");
    expect(sendErrorKind(smtpError('Invalid sender "x"', "EENVELOPE", "API"))).toBe("service");
    expect(sendErrorKind(smtpError("Data command failed", "EENVELOPE", "DATA", "554 5.7.1 Rejected"))).toBe("service");
    expect(sendErrorKind(smtpError("Connection closed unexpectedly", "ECONNECTION", "CONN"))).toBe("service");
    expect(sendErrorKind(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }))).toBe("service");
    expect(sendErrorKind(new Error("boom"))).toBe("service");
    expect(sendErrorKind("not an error")).toBe("service");
  });
});

describe("orderTokenMatches", () => {
  const sha256hex = async (s: string) => (await import("node:crypto")).createHash("sha256").update(s).digest("hex");

  it("opens the order with the checkout key or the e-mail link token, nothing else", async () => {
    const doc = { accessTokenHash: await sha256hex("checkout-key"), customerLinkToken: "link-token" };
    expect(orderTokenMatches(doc, "checkout-key")).toBe(true);
    expect(orderTokenMatches(doc, "link-token")).toBe(true);
    expect(orderTokenMatches(doc, "wrong")).toBe(false);
    expect(orderTokenMatches(doc, "")).toBe(false);
    expect(orderTokenMatches({ accessTokenHash: doc.accessTokenHash }, "link-token")).toBe(false);
  });
});
