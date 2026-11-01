// /faq — help centre built from the Prismic `faq` document, grouped by topic.
import { asText } from "@prismicio/client";
import { data, Link } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { RichText } from "~/components/rich-text";
import { Breadcrumbs } from "~/components/ui";
import { PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";

import type { Route } from "./+types/faq";

const TOPIC_LABELS: Record<string, string> = {
  Orders: "Pedidos",
  Payment: "Pagamento",
  Shipping: "Entrega",
  "Returns & refunds": "Trocas e devoluções",
  Products: "Produtos",
  Account: "Minha conta",
};

export async function loader() {
  const { faq, settings } = await getContent();
  if (!faq || faq.items.length === 0) throw data("Página não encontrada", { status: 404 });
  return data({ siteUrl: env().SITE_URL, storeName: settings.storeName, faq }, { headers: PUBLIC_CACHE });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Perguntas frequentes" }, { name: "robots", content: "noindex" }];
  const { faq, siteUrl, storeName } = loaderData;
  return seoMeta({
    siteUrl,
    storeName,
    path: "/faq",
    title: faq.seo.title ?? faq.title,
    description: faq.seo.description ?? `Respostas sobre pedidos, pagamento via Pix, entrega e trocas na ${storeName}.`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: asText(item.answer) },
        })),
      },
    ],
  });
}

export default function Faq({ loaderData }: Route.ComponentProps) {
  const { faq } = loaderData;
  const topics = [...new Set(faq.items.map((i) => i.topic))];
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: faq.title, href: "/faq" }]} />
      <h1 className="mt-8 text-4xl md:text-5xl">{faq.title}</h1>
      <RichText field={faq.intro} className="prose-store mt-4 text-lg" />
      {topics.length > 1 && (
        <nav aria-label="Tópicos" className="mt-8">
          <ul className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <li key={t}>
                <a href={`#${encodeURIComponent(t)}`} className="inline-block rounded-full border border-line-strong px-4 py-1.5 text-sm hover:border-ink">
                  {TOPIC_LABELS[t] ?? t}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {topics.map((topic) => (
        <section key={topic} id={encodeURIComponent(topic)} aria-labelledby={`t-${encodeURIComponent(topic)}`} className="mt-12">
          <h2 id={`t-${encodeURIComponent(topic)}`} className="mb-4 text-2xl">
            {TOPIC_LABELS[topic] ?? topic}
          </h2>
          {faq.items
            .filter((i) => i.topic === topic)
            .map((item) => (
              <details key={item.question} className="group border-t border-line py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg">
                  {item.question}
                  <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <RichText field={item.answer} className="prose-store pt-3 text-sm" />
              </details>
            ))}
        </section>
      ))}
      <p className="mt-16 text-muted">
        Não encontrou sua resposta?{" "}
        <Link to="/contact" className="text-ink underline underline-offset-4">
          Fale com a gente
        </Link>
        .
      </p>
    </div>
  );
}
