// Server-side assembly of product listing pages (category, collection, all,
// offers, search): filter → facet → sort → paginate, all driven by the URL.
import {
  facets,
  filterProducts,
  paginate,
  parseFilters,
  parseSort,
  sortProducts,
  toSummary,
  type Catalog,
  type Facets,
  type ProductSummary,
  type SortOption,
} from "~/lib/catalog/query";
import type { CatalogProduct } from "~/lib/catalog/types";

export interface Listing {
  products: ProductSummary[];
  page: number;
  pageCount: number;
  total: number;
  /** Total before filters (facets describe the unfiltered set). */
  unfilteredTotal: number;
  facets: Facets;
  sort: SortOption;
  filtered: boolean;
}

export function buildListing(
  catalog: Catalog,
  products: CatalogProduct[],
  url: URL,
  { defaultSort = "featured" as SortOption, unitsSold = new Map<string, number>() } = {},
): Listing {
  const params = url.searchParams;
  const filters = parseFilters(params);
  const sort = params.has("ordem") ? parseSort(params.get("ordem")) : defaultSort;
  const filtered = filterProducts(products, filters, catalog);
  const sorted = sortProducts(filtered, sort, unitsSold);
  const page = paginate(sorted, Number(params.get("pagina") ?? "1"));
  return {
    products: page.items.map(toSummary),
    page: page.page,
    pageCount: page.pageCount,
    total: page.total,
    unfilteredTotal: products.length,
    facets: facets(products),
    sort,
    filtered: ["min", "max", "disponivel", "tamanho", "cor", "material", "categoria"].some((k) => params.has(k)),
  };
}

/** Canonical path for a listing: filters and sort are dropped; the page number is kept. */
export function listingCanonical(path: string, page: number): string {
  return page > 1 ? `${path}?pagina=${page}` : path;
}
