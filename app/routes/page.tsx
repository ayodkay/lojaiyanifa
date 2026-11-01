// Prismic `page` documents: /about, /privacy, /terms, /cookies, /shipping,
// /returns, /warranty, and any other page at /pages/:uid.
import { asText } from "@prismicio/client";
import { data, redirect } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { RichText } from "~/components/rich-text";
import { Breadcrumbs } from "~/components/ui";
import { PAGE_PATHS, pagePath } from "~/lib/catalog/links";
import { PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";

import type { Route } from "./+types/page";

const UID_BY_PATH = Object.fromEntries(Object.entries(PAGE_PATHS).map(([uid, path]) => [path, uid]));

export async function loader({ request, params }: Route.LoaderArgs) {
  const { pathname } = new URL(request.url);
  const uid = params.uid ?? UID_BY_PATH[pathname];
  const { pages, settings } = await getContent();
  const page = uid ? pages.get(uid) : undefined;
  if (!page) throw data("Página não encontrada", { status: 404 });
  // /pages/privacy → /privacy (one URL per page)
  if (pathname !== pagePath(page.uid)) throw redirect(pagePath(page.uid), 301);
  return data({ siteUrl: env().SITE_URL, storeName: settings.storeName, page }, { headers: PUBLIC_CACHE });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Página não encontrada" }, { name: "robots", content: "noindex" }];
  const { page, siteUrl, storeName } = loaderData;
  return seoMeta({
    siteUrl,
    storeName,
    path: pagePath(page.uid),
    title: page.seo.title ?? page.title,
    description: page.seo.description ?? (asText(page.body).slice(0, 300) || null),
    image: page.seo.image,
    type: "article",
  });
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  const updated = page.lastUpdated
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${page.lastUpdated}T00:00:00Z`))
    : null;
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: page.title, href: pagePath(page.uid) }]} />
      <h1 className="mt-8 text-4xl md:text-5xl">{page.title}</h1>
      {updated && <p className="mt-3 text-sm text-muted">Atualizado em {updated}</p>}
      <RichText field={page.body} className="prose-store mt-10 text-base" />
    </article>
  );
}
