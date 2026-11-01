// Product search: accent-insensitive, typo-tolerant (fuzzy), prefix-aware,
// synonym-expanding. The index is built from the in-memory catalog; with a
// catalog of hundreds of products this is faster and more capable than a
// round-trip to Prismic's full-text search.
import { asText } from "@prismicio/client";
import MiniSearch, { type Query } from "minisearch";

import { categoryProducts, type Catalog } from "~/lib/catalog/query";
import type { CatalogProduct } from "~/lib/catalog/types";
import { fold } from "~/lib/text";

interface IndexedProduct {
  id: string;
  name: string;
  skus: string;
  categories: string;
  keywords: string;
  description: string;
}

export interface SearchIndex {
  mini: MiniSearch<IndexedProduct>;
  synonyms: string[][];
}

const tokenize = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function buildSearchIndex(catalog: Catalog, synonymGroups: string[][]): SearchIndex {
  const categoryNames = new Map<string, string[]>();
  for (const category of catalog.categories) {
    for (const p of categoryProducts(catalog, category.id)) {
      if (category.showAll) continue; // "all products" pages add no meaning to a product
      categoryNames.set(p.id, [...(categoryNames.get(p.id) ?? []), category.title]);
    }
  }
  const mini = new MiniSearch<IndexedProduct>({
    idField: "id",
    fields: ["name", "skus", "categories", "keywords", "description"],
    tokenize,
    processTerm: (term) => fold(term),
    searchOptions: {
      boost: { name: 4, skus: 5, keywords: 3, categories: 2, description: 1 },
      fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 6 ? 1 : 2),
      prefix: (term) => term.length >= 2,
      combineWith: "AND",
    },
  });
  mini.addAll(
    catalog.products.map((p) => ({
      id: p.id,
      name: p.name,
      skus: [p.sku, ...p.variants.map((v) => v.sku)].filter(Boolean).join(" "),
      categories: (categoryNames.get(p.id) ?? []).join(" "),
      keywords: p.keywords.join(" "),
      description: `${asText(p.shortDescription)} ${asText(p.description)}`,
    })),
  );
  return { mini, synonyms: synonymGroups };
}

/** Each query term must match (AND); a term that belongs to a synonym group matches any of its synonyms (OR). */
export function buildQuery(query: string, synonyms: string[][]): Query | null {
  const folded = fold(query).trim();
  if (!folded) return null;
  const phraseGroup = synonyms.find((group) => group.includes(folded));
  if (phraseGroup) return { combineWith: "OR", queries: phraseGroup };
  const terms = tokenize(folded);
  if (terms.length === 0) return null;
  return {
    combineWith: "AND",
    queries: terms.map((term) => {
      const group = synonyms.find((g) => g.some((entry) => tokenize(entry).includes(term)));
      return group ? { combineWith: "OR", queries: [term, ...group.filter((s) => s !== term)] } : term;
    }),
  };
}

export function searchProducts(index: SearchIndex, catalog: Catalog, query: string): CatalogProduct[] {
  const q = buildQuery(query, index.synonyms);
  if (!q) return [];
  return index.mini
    .search(q)
    .map((hit) => catalog.productsById.get(String(hit.id)))
    .filter((p): p is CatalogProduct => Boolean(p));
}
