// /categories and /collections — index pages.
import { data, Link, useLocation } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { Breadcrumbs, ProductImage } from "~/components/ui";
import { categoryProducts, childCategories, topLevelCategories } from "~/lib/catalog/query";
import { PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { categoryHref } from "~/lib/shell";

import type { Route } from "./+types/categories";

export async function loader({ request }: Route.LoaderArgs) {
  const kind = new URL(request.url).pathname.startsWith("/collections") ? "collection" : "category";
  const { catalog, settings } = await getContent();
  const items = topLevelCategories(catalog, kind)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
    .map((c) => ({
      id: c.id,
      title: c.title,
      href: categoryHref(c),
      image: c.image,
      count: categoryProducts(catalog, c.id).length,
      children: childCategories(catalog, c.id).map((child) => ({ title: child.title, href: categoryHref(child) })),
    }));
  return data({ siteUrl: env().SITE_URL, storeName: settings.storeName, kind, items }, { headers: PUBLIC_CACHE });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const isCollection = loaderData.kind === "collection";
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: isCollection ? "/collections" : "/categories",
    title: isCollection ? "Coleções" : "Categorias",
    description: `${isCollection ? "Coleções" : "Categorias"} de produtos da ${loaderData.storeName}.`,
  });
}

export default function Categories({ loaderData }: Route.ComponentProps) {
  const isCollection = loaderData.kind === "collection";
  const title = isCollection ? "Coleções" : "Categorias";
  const path = useLocation().pathname;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: title, href: path }]} />
      <h1 className="mb-12 mt-8 text-4xl md:text-6xl">{title}</h1>
      {loaderData.items.length === 0 ? (
        <p className="text-muted">
          Ainda não há {isCollection ? "coleções" : "categorias"} publicadas.{" "}
          <Link to="/collections/all" className="text-ink underline underline-offset-4">
            Ver todos os produtos
          </Link>
        </p>
      ) : (
        <ul className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {loaderData.items.map((c) => (
            <li key={c.id}>
              <Link to={c.href} className="group block">
                <ProductImage image={c.image} name={c.title} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" aspect="4 / 3" />
                <h2 className="mt-4 text-2xl group-hover:underline">{c.title}</h2>
                <p className="text-sm text-muted">{c.count === 1 ? "1 produto" : `${c.count} produtos`}</p>
              </Link>
              {c.children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {c.children.map((child) => (
                    <li key={child.href}>
                      <Link to={child.href} className="text-ink-soft underline-offset-4 hover:underline">
                        {child.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
