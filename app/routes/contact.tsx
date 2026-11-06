// /contact — support channels, business hours and company details from Prismic settings, and the contact form, which
// opens a support ticket (app/.server/support.ts): the customer gets the protocol number on screen and by e-mail at
// once, the store gets a notice and answers in /admin/support. ?pedido=1001&assunto=returns fills the form in (links
// from order pages). The page is public and cached; the form's answer is personal and never cached.
import { useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";

import { readCustomerSession } from "~/.server/customer-session";
import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { RateLimitError, createTicket } from "~/.server/support";
import { Field, focusFirstError, INPUT_CLASS } from "~/components/form";
import { WhatsAppIcon } from "~/components/icons";
import { Breadcrumbs, Button, cx, Notice } from "~/components/ui";
import { fieldErrors } from "~/lib/account";
import { phoneLink } from "~/lib/br";
import { NO_STORE, PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { formatHours, isOpenNow, whatsappHref } from "~/lib/shell";
import {
  botReason,
  contactFormToObject,
  contactSchema,
  isTicketTopic,
  MESSAGE_MAX,
  RETURN_PREFERENCE_LABEL,
  RETURN_PREFERENCES,
  RETURN_REASON_LABEL,
  RETURN_REASONS,
  TICKET_TOPICS,
  TOPIC_LABEL,
} from "~/lib/support";

import type { Route } from "./+types/contact";

export async function loader() {
  const { settings } = await getContent();
  return data(
    { siteUrl: env().SITE_URL, storeName: settings.storeName, contact: settings.contact, company: settings.company },
    { headers: PUBLIC_CACHE },
  );
}

interface ActionResult {
  fieldErrors?: Record<string, string>;
  formError?: string;
  ticketNumber?: number;
}

/** The visitor's IP as Firebase Hosting forwards it (first `x-forwarded-for` entry), only for the hourly limit. */
const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

export async function action({ request }: Route.ActionArgs) {
  const { input, guard } = contactFormToObject(await request.formData());
  const bot = botReason(guard);
  if (bot) {
    console.warn(`[contact] refused as automated (${bot})`);
    return data<ActionResult>({ formError: "Não foi possível enviar. Recarregue a página e tente de novo." }, { status: 400, headers: NO_STORE });
  }
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return data<ActionResult>({ fieldErrors: fieldErrors(parsed.error) }, { status: 400, headers: NO_STORE });
  const [{ settings }, session] = await Promise.all([getContent(), readCustomerSession(request)]);
  try {
    const { number } = await createTicket(parsed.data, {
      uid: session.status === "ok" ? session.user.uid : null,
      clientIp: clientIp(request),
      storeInbox: env().MAIL_STORE_TO ?? settings.contact.email,
    });
    return data<ActionResult>({ ticketNumber: number }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RateLimitError) {
      console.warn(`[contact] ${error.message}`);
      return data<ActionResult>(
        { formError: "Recebemos muitas mensagens em pouco tempo. Tente de novo daqui a uma hora ou fale com a gente pelo WhatsApp." },
        { status: 429, headers: NO_STORE },
      );
    }
    throw error;
  }
}

// The page is the same for everyone; the form's answer is personal.
export function headers({ loaderHeaders, actionHeaders }: Route.HeadersArgs) {
  return actionHeaders.has("Cache-Control") ? actionHeaders : loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: "/contact",
    title: "Atendimento",
    description: `Fale com a ${loaderData.storeName}: formulário de contato, WhatsApp, e-mail e horário de atendimento.`,
  });
}

export default function Contact({ loaderData, actionData }: Route.ComponentProps) {
  const { contact, company, storeName } = loaderData;
  const hours = formatHours(contact.hours);
  const open = isOpenNow(contact.hours);
  const phone = contact.phone ? phoneLink(contact.phone) : null;
  const hasChannel = Boolean(contact.whatsappNumber || contact.email || contact.phone);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Atendimento", href: "/contact" }]} />
      <h1 className="mt-8 text-4xl md:text-5xl">Atendimento</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Dúvidas sobre produtos, pedidos, pagamento via Pix, entrega, trocas ou devoluções? Fale com a {storeName}. Respondemos em até 5 dias.
      </p>

      <div className="mt-12 grid gap-12 md:grid-cols-[1fr_20rem]">
        <section aria-labelledby="formulario">
          <h2 id="formulario" className="mb-6 text-2xl">
            Envie uma mensagem
          </h2>
          <ContactForm result={actionData} />
        </section>

        <div className="space-y-10">
          <section aria-labelledby="canais">
            <h2 id="canais" className="mb-6 text-2xl">
              Canais
            </h2>
            {!hasChannel && <p className="text-muted">Use o formulário: os outros canais serão publicados em breve.</p>}
            <ul className="space-y-5">
              {contact.whatsappNumber && (
                <li>
                  <a
                    href={whatsappHref(contact.whatsappNumber, contact.whatsappMessage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-3 rounded-full bg-[#1f7a4d] px-6 py-3 text-white"
                  >
                    <WhatsAppIcon /> Conversar no WhatsApp
                  </a>
                </li>
              )}
              {contact.email && (
                <li>
                  <p className="eyebrow">E-mail</p>
                  <a href={`mailto:${contact.email}`} className="break-all text-lg underline underline-offset-4">
                    {contact.email}
                  </a>
                </li>
              )}
              {phone && (
                <li>
                  <p className="eyebrow">Telefone</p>
                  <a href={phone.href} className="text-lg underline underline-offset-4">
                    {phone.text}
                  </a>
                </li>
              )}
            </ul>
            <p className="mt-8 text-sm text-muted">
              Veja também as{" "}
              <Link to="/faq" className="text-ink underline underline-offset-4">
                perguntas frequentes
              </Link>
              .
            </p>
          </section>

          {hours.length > 0 && (
            <section aria-labelledby="horario">
              <h2 id="horario" className="mb-6 text-2xl">
                Horário de atendimento
              </h2>
              <ul className="space-y-1">
                {hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {open !== null && <p className={`mt-3 text-sm ${open ? "text-success" : "text-muted"}`}>{open ? "Aberto agora" : "Fechado agora"} (horário de Brasília)</p>}
            </section>
          )}
          {(company.legalName || company.taxId || company.addressLine) && (
            <section className="text-sm text-ink-soft">
              <h2 className="mb-3 text-2xl text-ink">Empresa</h2>
              {company.legalName && <p>{company.legalName}</p>}
              {company.taxId && <p>CNPJ/CPF: {company.taxId}</p>}
              {company.addressLine && (
                <p>
                  {company.addressLine}
                  {company.city && `, ${company.city}`}
                  {company.state && ` – ${company.state}`}
                  {company.postalCode && `, CEP ${company.postalCode}`}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactForm({ result }: { result: ActionResult | undefined }) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle" && navigation.formAction === "/contact";
  const shownAt = useRef<number>(0);
  const [topic, setTopic] = useState(() => {
    const asked = params.get("assunto");
    return isTicketTopic(asked) ? asked : params.get("pedido") ? "order" : "";
  });
  const errors = result?.fieldErrors ?? {};

  useEffect(() => {
    shownAt.current = Date.now();
  }, []);
  useEffect(() => {
    if (result && !result.ticketNumber) focusFirstError();
  }, [result]);

  if (result?.ticketNumber) {
    return (
      <div role="status" className="space-y-4">
        <Notice tone="success">
          Mensagem enviada! O número do seu atendimento é <strong>{result.ticketNumber}</strong>. Enviamos uma confirmação para o seu e-mail e respondemos em até
          5 dias.
        </Notice>
        <Link to="/" className="inline-block underline underline-offset-4">
          Voltar para a loja
        </Link>
      </div>
    );
  }

  return (
    <Form
      method="post"
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        const elapsed = event.currentTarget.elements.namedItem("elapsedMs") as HTMLInputElement;
        elapsed.value = String(shownAt.current ? Date.now() - shownAt.current : 0);
      }}
    >
      {result?.formError && (
        <div data-form-error tabIndex={-1} className="outline-none">
          <Notice tone="danger">{result.formError}</Notice>
        </div>
      )}
      <input type="hidden" name="elapsedMs" defaultValue="0" />
      {/* For bots only: hidden from people and from assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="f-website">Não preencha este campo</label>
        <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nome" autoComplete="name" required error={errors.name} />
        <Field name="email" label="E-mail" type="email" autoComplete="email" required error={errors.email} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="phone" label="Celular (opcional)" type="tel" autoComplete="tel-national" placeholder="(21) 99999-9999" error={errors.phone} />
        <Field name="orderNumber" label="Número do pedido (se houver)" inputMode="numeric" defaultValue={params.get("pedido") ?? ""} error={errors.orderNumber} />
      </div>
      <div>
        <label htmlFor="f-topic" className="mb-1 block text-sm">
          Assunto
        </label>
        <select
          id="f-topic"
          name="topic"
          required
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          aria-invalid={errors.topic ? true : undefined}
          aria-describedby={errors.topic ? "f-topic-erro" : undefined}
          className={cx(INPUT_CLASS, errors.topic ? "border-danger" : "border-line-strong")}
        >
          <option value="">Escolha…</option>
          {TICKET_TOPICS.map((t) => (
            <option key={t} value={t}>
              {TOPIC_LABEL[t]}
            </option>
          ))}
        </select>
        {errors.topic && (
          <p id="f-topic-erro" className="mt-1 text-sm text-danger">
            {errors.topic}
          </p>
        )}
      </div>
      {topic === "returns" && (
        <fieldset className="space-y-4 border border-line p-4">
          <legend className="px-1 text-sm font-medium">Troca, devolução ou desistência</legend>
          <ChoiceGroup name="returnReason" legend="Motivo" options={RETURN_REASONS.map((r) => [r, RETURN_REASON_LABEL[r]])} error={errors.returnReason} />
          <ChoiceGroup name="returnPreference" legend="Você prefere" options={RETURN_PREFERENCES.map((p) => [p, RETURN_PREFERENCE_LABEL[p]])} error={errors.returnPreference} />
          <Field name="returnItems" label="Quais produtos? (opcional)" placeholder="Ex.: 1 Alaká" error={errors.returnItems} />
          <p className="text-xs text-muted">
            Para desistir da compra você tem 7 dias a partir do recebimento, e o frete da devolução é por nossa conta. Veja a{" "}
            <Link to="/returns" className="underline underline-offset-4">
              política de trocas e devoluções
            </Link>
            .
          </p>
        </fieldset>
      )}
      <div>
        <label htmlFor="f-message" className="mb-1 block text-sm">
          Mensagem
        </label>
        <textarea
          id="f-message"
          name="message"
          required
          rows={6}
          maxLength={MESSAGE_MAX}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? "f-message-erro" : undefined}
          className={cx("w-full rounded-xl border bg-paper p-3", errors.message ? "border-danger" : "border-line-strong")}
        />
        {errors.message && (
          <p id="f-message-erro" className="mt-1 text-sm text-danger">
            {errors.message}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        Usamos os seus dados só para responder a esta mensagem. Veja a{" "}
        <Link to="/privacy" className="underline underline-offset-4">
          política de privacidade
        </Link>
        .
      </p>
      <Button type="submit" disabled={submitting}>
        {submitting ? "Enviando…" : "Enviar mensagem"}
      </Button>
    </Form>
  );
}

function ChoiceGroup({ name, legend, options, error }: { name: string; legend: string; options: [string, string][]; error?: string }) {
  return (
    <fieldset aria-describedby={error ? `f-${name}-erro` : undefined}>
      <legend className="mb-2 text-sm">{legend}</legend>
      <div className="space-y-2">
        {options.map(([value, label], i) => (
          <label key={value} className="flex gap-3 text-sm">
            <input type="radio" name={name} value={value} aria-invalid={error && i === 0 ? true : undefined} className="mt-0.5" />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p id={`f-${name}-erro`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
