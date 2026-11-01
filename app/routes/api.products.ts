// Product summaries by ID, for client-side lists (recently viewed, wishlist).
// GET /api/products?ids=a,b,c  (max 24). Public, cacheable.
import { data } from "react-router";

import { getContent } from "~/.server/prismic";
import { toSummary } from "~/lib/catalog/query";

import type { Route } from "./+types/api.products";

export async function loader({ request }: Route.LoaderArgs) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 24);
  const { catalog } = await getContent();
  const products = ids.flatMap((id) => {
    const p = catalog.productsById.get(id);
    return p ? [toSummary(p)] : [];
  });
  return data({ products }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}
