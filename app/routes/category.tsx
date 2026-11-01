// /categories/:uid and /collections/:uid (and /collections/all).
// Both prefixes render any product_category; the non-canonical one redirects.
import { data, redirect } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { ListingPage } from "~/components/listing";
import { buildListing, listingCanonical } from "~/lib/catalog/listing";
import { ancestors, categoryProducts, childCategories } from "~/lib/catalog/query";
import { PUBLIC_CACHE } from "~/lib/http";
import { breadcrumbJsonLd, seoMeta } from "~/lib/seo";
import { categoryHref } from "~/lib/shell";
import { asText, type RichTextField } from "@prismicio/client";

import type { Route } from "./+types/category";

const ALL = "all";

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { catalog, settings } = await getContent();
  const uid = params.uid;
  const category = catalog.categoriesByUid.get(uid);

  if (!category) {
    if (uid === ALL && url.pathname.startsWith("/collections/")) {
      const listing = buildListing(catalog, catalog.products, url);
      return data(
        {
          siteUrl: env().SITE_URL,
          storeName: settings.storeName,
          path: "/collections/all",
          title: "Todos os produtos",
          eyebrow: "Loja",
          intro: [] as RichTextField,
          seoDescription: `Todos os produtos da ${settings.storeName}.`,
          image: null,
          breadcrumbs: [
            { name: "Início", href: "/" },
            { name: "Todos os produtos", href: "/collections/all" },
          ],
          subcategories: catalog.categories
            .filter((c) => c.kind === "category" && !c.parentId)
            .map((c) => ({ title: c.title, href: categoryHref(c) })),
          listing,
        },
        { headers: PUBLIC_CACHE },
      );
    }
    throw data("Categoria não encontrada", { status: 404 });
  }

  const canonicalPath = categoryHref(category);
  if (!url.pathname.startsWith(canonicalPath)) throw redirect(`${canonicalPath}${url.search}`, 301);

  const chain = ancestors(catalog, category.id);
  const listing = buildListing(catalog, categoryProducts(catalog, category.id), url);
  return data(
    {
      siteUrl: env().SITE_URL,
      storeName: settings.storeName,
      path: canonicalPath,
      title: category.title,
      eyebrow: chain.at(-1)?.title ?? (category.kind === "collection" ? "Coleção" : "Categoria"),
      intro: category.intro,
      seoDescription: category.seo.description ?? (asText(category.intro) || null),
      image: category.seo.image ?? category.image,
      seoTitle: category.seo.title,
      breadcrumbs: [
        { name: "Início", href: "/" },
        category.kind === "collection" ? { name: "Coleções", href: "/collections" } : { name: "Categorias", href: "/categories" },
        ...chain.map((c) => ({ name: c.title, href: categoryHref(c) })),
        { name: category.title, href: canonicalPath },
      ],
      subcategories: childCategories(catalog, category.id).map((c) => ({ title: c.title, href: categoryHref(c) })),
      listing,
    },
    { headers: PUBLIC_CACHE },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Categoria não encontrada" }, { name: "robots", content: "noindex" }];
  const d = loaderData;
  return seoMeta({
    siteUrl: d.siteUrl,
    storeName: d.storeName,
    path: listingCanonical(d.path, d.listing.page),
    title: ("seoTitle" in d && d.seoTitle) || (d.listing.page > 1 ? `${d.title} — página ${d.listing.page}` : d.title),
    description: d.seoDescription,
    image: d.image,
    jsonLd: [
      breadcrumbJsonLd(d.siteUrl, d.breadcrumbs.map((b) => ({ name: b.name, path: b.href }))),
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: d.title,
        url: `${d.siteUrl}${d.path}`,
        numberOfItems: d.listing.total,
      },
    ],
  });
}

export default function Category({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  return (
    <ListingPage
      title={d.title}
      eyebrow={d.eyebrow}
      intro={d.intro as RichTextField}
      breadcrumbs={d.breadcrumbs}
      listing={d.listing}
      subcategories={d.subcategories}
    />
  );
}
