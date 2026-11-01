// /search?q= — results page with filters, sorting and no-results recommendations.
import { data, Link } from "react-router";

import { env } from "~/.server/env";
import { getSearch } from "~/.server/search";
import { ListingPage } from "~/components/listing";
import { ProductGrid } from "~/components/product-card";
import { buildListing } from "~/lib/catalog/listing";
import { sortProducts, toSummary } from "~/lib/catalog/query";
import { PUBLIC_CACHE } from "~/lib/http";
import { searchProducts } from "~/lib/search";
import { seoMeta } from "~/lib/seo";

import type { Route } from "./+types/search";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 120).trim();
  const { content, index } = await getSearch();
  const results = query ? searchProducts(index, content.catalog, query) : [];
  const listing = buildListing(content.catalog, results, url);
  return data(
    {
      siteUrl: env().SITE_URL,
      storeName: content.settings.storeName,
      query,
      listing,
      popular: content.settings.popularSearches.slice(0, 8),
      recommended: query && results.length === 0 ? sortProducts(content.catalog.products, "newest").slice(0, 8).map(toSummary) : [],
    },
    // Results are the same for everyone, so they are cacheable. Personal search history lives in the browser.
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
    path: "/search",
    title: loaderData.query ? `Busca: ${loaderData.query}` : "Buscar",
    noindex: true, // internal search results should not be indexed
  });
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, listing, popular, recommended } = loaderData;
  const suggestions = popular.length > 0 && (
    <div className="mt-6">
      <p className="eyebrow mb-3">Buscas populares</p>
      <ul className="flex flex-wrap gap-2">
        {popular.map((term) => (
          <li key={term}>
            <Link to={`/search?q=${encodeURIComponent(term)}`} className="inline-block rounded-full border border-line-strong px-4 py-1.5 text-sm hover:border-ink">
              {term}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  if (!query) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 md:px-8">
        <h1 className="text-4xl md:text-5xl">Buscar produtos</h1>
        <p className="mt-4 text-muted">Use a busca no topo da página para encontrar produtos por nome, SKU ou categoria.</p>
        {suggestions}
      </div>
    );
  }

  return (
    <>
      <ListingPage
        title={`“${query}”`}
        eyebrow="Resultados da busca"
        breadcrumbs={[
          { name: "Início", href: "/" },
          { name: "Busca", href: `/search?q=${encodeURIComponent(query)}` },
        ]}
        listing={listing}
        extraHidden={{ q: query }}
        empty={
          <div>
            <p className="text-lg">Não encontramos produtos para “{query}”.</p>
            <p className="mt-2 text-muted">Confira a ortografia, use menos palavras ou tente um termo mais geral.</p>
            {suggestions}
          </div>
        }
      />
      {recommended.length > 0 && (
        <section aria-labelledby="recomendados" className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
          <h2 id="recomendados" className="mb-8 border-b border-line pb-4 text-3xl">
            Você pode gostar
          </h2>
          <ProductGrid products={recommended} />
        </section>
      )}
    </>
  );
}
