// How the store describes itself to machines: the LocalBusiness JSON-LD on the home page and /llms.txt
// (https://llmstxt.org). Only the description and the offerings are written here. The phone, the WhatsApp link, the
// social profiles and the address come from the Prismic settings, because the owner's phone number never goes into the
// repository. The page titles and the product list come from the catalog, so they always match the site.
import { normalizeBrPhone } from "~/lib/br";
import { pagePath } from "~/lib/catalog/links";
import type { Catalog } from "~/lib/catalog/query";
import type { ContentPage, Homepage, StoreSettings } from "~/lib/catalog/types";
import { whatsappHref } from "~/lib/shell";

export const STORE_DESCRIPTION =
  "A Loja Iyanifa é uma loja online que vende artigos religiosos de tradição iorubá, incluindo ferramentas de Ifá, " +
  "sementes, panos da costa, roupas e banhos. Oferece pagamento via Pix e entrega para todo o Brasil.";

const OFFERINGS = [
  { name: "Ferramentas de Ifá", text: "Ferramentas utilizadas em rituais e práticas religiosas da tradição iorubá." },
  { name: "Sementes", text: "Sementes com significado simbólico e espiritual na tradição iorubá." },
  { name: "Panos da Costa", text: "Panos tradicionais usados em cerimônias e rituais religiosos." },
  { name: "Roupas e Banhos", text: "Produtos destinados à preparação espiritual e ritualística." },
];

/** A page's `<title>`, written the way seoMeta writes it (app/lib/seo.ts). */
const pageTitle = (title: string, storeName: string) => (title === storeName ? title : `${title} | ${storeName}`);

export function localBusinessJsonLd(settings: StoreSettings, siteUrl: string) {
  const phone = settings.contact.phone;
  // The footer's tel: link reads the same field; a number it can't normalize (e.g. 0800) is used as typed.
  const telephone = phone ? (normalizeBrPhone(phone) ?? phone.trim()) : null;
  const sameAs = settings.socialLinks.map((s) => s.href);
  // Google requires an address for a LocalBusiness. It reads the company address (the footer's), which the owner
  // confirmed on 2026-11-06 is the physical store. Should the registered address ever differ from the store's, the
  // store needs fields of its own.
  const { addressLine, city, state, postalCode } = settings.company;
  const address = addressLine
    ? {
        "@type": "PostalAddress",
        streetAddress: addressLine,
        ...(city ? { addressLocality: city } : {}),
        ...(state ? { addressRegion: state } : {}),
        ...(postalCode ? { postalCode } : {}),
        addressCountry: "BR",
      }
    : null;
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: settings.storeName,
    description: STORE_DESCRIPTION,
    url: `${siteUrl}/`,
    ...(telephone ? { telephone } : {}),
    ...(address ? { address } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export interface LlmsTxtInput {
  siteUrl: string;
  catalog: Catalog;
  settings: StoreSettings;
  homepage: Homepage | null;
  pages: Map<string, ContentPage>;
}

export function llmsTxt({ siteUrl, catalog, settings, homepage, pages }: LlmsTxtInput): string {
  const store = settings.storeName;
  // The home route takes its title from the homepage's SEO fields, else the settings' (app/routes/home.tsx).
  const home = { title: pageTitle((homepage?.seo ?? settings.seo).title ?? store, store), url: `${siteUrl}/` };
  const about = pages.get("about");
  const aboutLink = about ? [{ title: pageTitle(about.seo.title ?? about.title, store), url: `${siteUrl}${pagePath("about")}` }] : [];
  const products = catalog.products
    .map((p) => ({ title: pageTitle(p.seo.title ?? p.name, store), url: `${siteUrl}/products/${p.uid}` }))
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const { whatsappNumber, whatsappMessage } = settings.contact;
  const profiles = [
    ...settings.socialLinks.map((s) => ({ name: s.network.toLowerCase(), url: s.href })),
    ...(whatsappNumber ? [{ name: "whatsapp", url: whatsappHref(whatsappNumber, whatsappMessage) }] : []),
  ];
  return [
    `# ${store}`,
    "",
    `> ${STORE_DESCRIPTION}`,
    "",
    "## Offerings",
    "",
    ...OFFERINGS.map((o) => `- ${o.name}: ${o.text}`),
    "",
    "## Pages",
    "",
    ...[home, ...aboutLink, ...products].map((l) => `- [${l.title}](${l.url})`),
    "",
    ...(profiles.length ? ["## Profiles", "", ...profiles.map((p) => `- ${p.name}: ${p.url}`), ""] : []),
    `Website: ${siteUrl}/`,
    "",
  ].join("\n");
}
