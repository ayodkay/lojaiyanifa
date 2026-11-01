// Search-as-you-type suggestions for the header combobox (used via a fetcher).
import { data } from "react-router";

import { getSearch } from "~/.server/search";
import { priceRange } from "~/lib/catalog/query";
import { imgixSrc } from "~/lib/images";
import { searchProducts } from "~/lib/search";
import { categoryHref } from "~/lib/shell";
import { fold } from "~/lib/text";

import type { Route } from "./+types/api.search.suggest";

export async function loader({ request }: Route.LoaderArgs) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80).trim();
  const { content, index } = await getSearch();
  const folded = fold(query);
  const products =
    query.length < 2
      ? []
      : searchProducts(index, content.catalog, query)
          .slice(0, 6)
          .map((p) => ({
            uid: p.uid,
            name: p.name,
            priceCents: priceRange(p)?.min ?? null,
            image: p.images[0] ? imgixSrc(p.images[0].url, { w: 80, ar: "4:5", fit: "crop" }) : null,
          }));
  const categories =
    query.length < 2
      ? []
      : content.catalog.categories
          .filter((c) => fold(c.title).includes(folded))
          .slice(0, 3)
          .map((c) => ({ title: c.title, href: categoryHref(c) }));
  return data({ query, products, categories }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}
