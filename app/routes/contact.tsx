// /contact — support channels, business hours and company details from Prismic settings.
// The contact form (support tickets) is added with the support backend.
import { data, Link } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { WhatsAppIcon } from "~/components/icons";
import { Breadcrumbs } from "~/components/ui";
import { PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { formatHours, isOpenNow, whatsappHref } from "~/lib/shell";

import type { Route } from "./+types/contact";

export async function loader() {
  const { settings } = await getContent();
  return data(
    { siteUrl: env().SITE_URL, storeName: settings.storeName, contact: settings.contact, company: settings.company },
    { headers: PUBLIC_CACHE },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: "/contact",
    title: "Atendimento",
    description: `Fale com a ${loaderData.storeName}: WhatsApp, e-mail e horário de atendimento.`,
  });
}

export default function Contact({ loaderData }: Route.ComponentProps) {
  const { contact, company, storeName } = loaderData;
  const hours = formatHours(contact.hours);
  const open = isOpenNow(contact.hours);
  const hasChannel = Boolean(contact.whatsappNumber || contact.email || contact.phone);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Atendimento", href: "/contact" }]} />
      <h1 className="mt-8 text-4xl md:text-5xl">Atendimento</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Dúvidas sobre produtos, pedidos, pagamento via Pix ou entrega? Fale com a {storeName}.
      </p>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <section aria-labelledby="canais">
          <h2 id="canais" className="mb-6 text-2xl">
            Canais
          </h2>
          {!hasChannel && <p className="text-muted">Os canais de atendimento serão publicados em breve.</p>}
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
                <a href={`mailto:${contact.email}`} className="text-lg underline underline-offset-4">
                  {contact.email}
                </a>
              </li>
            )}
            {contact.phone && (
              <li>
                <p className="eyebrow">Telefone</p>
                <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="text-lg underline underline-offset-4">
                  {contact.phone}
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

        <section aria-labelledby="horario">
          {hours.length > 0 && (
            <>
              <h2 id="horario" className="mb-6 text-2xl">
                Horário de atendimento
              </h2>
              <ul className="space-y-1">
                {hours.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {open !== null && <p className={`mt-3 text-sm ${open ? "text-success" : "text-muted"}`}>{open ? "Aberto agora" : "Fechado agora"} (horário de Brasília)</p>}
            </>
          )}
          {(company.legalName || company.taxId || company.addressLine) && (
            <div className="mt-10 text-sm text-ink-soft">
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
