import { Link } from "react-router";

import { openConsentPreferences } from "~/lib/consent";
import { formatHours, isOpenNow, type Shell, whatsappHref } from "~/lib/shell";

import { ChatIcon, PixIcon, ShieldIcon, WhatsAppIcon } from "./icons";

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h2 className="eyebrow mb-4 font-sans">{title}</h2>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link to={l.href} className="text-ink-soft hover:text-ink hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TrustStrip({ shell }: { shell: Shell }) {
  const support = shell.contact.whatsappNumber ? "Atendimento por WhatsApp" : shell.contact.email ? "Atendimento por e-mail" : null;
  return (
    <ul className="grid gap-6 text-sm sm:grid-cols-3">
      <li className="flex items-start gap-3">
        <PixIcon className="mt-0.5 shrink-0" />
        <span>
          <strong className="block font-medium text-ink">Pagamento via Pix</strong>
          <span className="text-muted">Aprovação após a confirmação do pagamento.</span>
        </span>
      </li>
      <li className="flex items-start gap-3">
        <ShieldIcon className="mt-0.5 shrink-0" />
        <span>
          <strong className="block font-medium text-ink">Compra segura</strong>
          <span className="text-muted">Conexão criptografada; não pedimos dados de cartão.</span>
        </span>
      </li>
      {support && (
        <li className="flex items-start gap-3">
          <ChatIcon className="mt-0.5 shrink-0" />
          <span>
            <strong className="block font-medium text-ink">{support}</strong>
            <Link to="/contact" className="text-muted underline-offset-4 hover:underline">
              Fale conosco
            </Link>
          </span>
        </li>
      )}
    </ul>
  );
}

export function Footer({ shell }: { shell: Shell }) {
  const { company, contact } = shell;
  const hours = formatHours(contact.hours);
  const address = [
    company.addressLine,
    [company.city, company.state].filter(Boolean).join(" – "),
    company.postalCode ? `CEP ${company.postalCode}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const open = isOpenNow(contact.hours);

  return (
    <footer className="mt-24 border-t border-line bg-paper-deep/60">
      <div className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <TrustStrip shell={shell} />
      </div>
      <div className="mx-auto grid max-w-7xl gap-10 border-t border-line px-4 py-12 sm:grid-cols-2 md:px-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <p className="font-display text-2xl">{shell.storeName}</p>
          {shell.tagline && <p className="mt-2 max-w-sm text-sm text-muted">{shell.tagline}</p>}
          {shell.socialLinks.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-4 text-sm">
              {shell.socialLinks.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-ink-soft hover:text-ink hover:underline">
                    {s.network}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <FooterColumn
          title="Loja"
          links={[
            { label: "Todos os produtos", href: "/collections/all" },
            { label: "Categorias", href: "/categories" },
            { label: "Ofertas", href: "/offers" },
            { label: "Sobre nós", href: "/about" },
            ...shell.footerLinks.map((l) => ({ label: l.label, href: l.href })),
          ]}
        />
        <FooterColumn
          title="Ajuda"
          links={[
            { label: "Atendimento", href: "/contact" },
            { label: "Perguntas frequentes", href: "/faq" },
            { label: "Entregas", href: "/shipping" },
            { label: "Trocas e devoluções", href: "/returns" },
            { label: "Meus pedidos", href: "/orders" },
          ]}
        />
        <div>
          <FooterColumn
            title="Legal"
            links={[
              { label: "Política de privacidade", href: "/privacy" },
              { label: "Termos de uso", href: "/terms" },
              { label: "Política de cookies", href: "/cookies" },
              { label: "Garantia", href: "/warranty" },
            ]}
          />
          <button type="button" onClick={openConsentPreferences} className="mt-2 text-sm text-ink-soft hover:text-ink hover:underline">
            Preferências de cookies
          </button>
          {(contact.email || contact.phone || contact.whatsappNumber || hours.length > 0) && (
            <div className="mt-8 space-y-1 text-sm text-ink-soft">
              {contact.email && (
                <p>
                  <a href={`mailto:${contact.email}`} className="hover:underline">
                    {contact.email}
                  </a>
                </p>
              )}
              {contact.phone && (
                <p>
                  <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">
                    {contact.phone}
                  </a>
                </p>
              )}
              {hours.map((line) => (
                <p key={line} className="text-muted">
                  {line}
                </p>
              ))}
              {open !== null && <p className={open ? "text-success" : "text-muted"}>{open ? "Aberto agora" : "Fechado agora"}</p>}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 text-xs text-muted md:flex-row md:justify-between md:px-8">
          <p>
            © {new Date().getFullYear()} {company.legalName ?? shell.storeName}
            {company.taxId && <> · CNPJ/CPF {company.taxId}</>}
          </p>
          {address && <p>{address}</p>}
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppButton({ shell }: { shell: Shell }) {
  if (!shell.contact.whatsappNumber) return null;
  return (
    <a
      href={whatsappHref(shell.contact.whatsappNumber, shell.contact.whatsappMessage)}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-[#1f7a4d] text-white shadow-lg transition-transform hover:scale-105"
      aria-label="Conversar no WhatsApp (abre em nova aba)"
    >
      <WhatsAppIcon width={28} height={28} />
    </a>
  );
}
