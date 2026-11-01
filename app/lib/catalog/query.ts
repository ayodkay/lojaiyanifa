// Pure catalog queries: membership, breadcrumbs, sorting, filtering, facets,
// pagination, related products. No I/O; the catalog is loaded once per Prismic
// release (app/.server/prismic.server.ts) and queried in memory.
import type { Cents } from "~/lib/money";
import { fold } from "~/lib/text";

import { SELLABLE } from "./map";
import type { Availability, CatalogCategory, CatalogImage, CatalogProduct } from "./types";

export interface Catalog {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  productsById: Map<string, CatalogProduct>;
  productsByUid: Map<string, CatalogProduct>;
  categoriesById: Map<string, CatalogCategory>;
  categoriesByUid: Map<string, CatalogCategory>;
}

export function buildCatalog(products: CatalogProduct[], categories: CatalogCategory[]): Catalog {
  const productsById = new Map(products.map((p) => [p.id, p]));
  // Drop links to products that aren't published (or were deleted).
  const cleanCategories = categories.map((c) => ({
    ...c,
    productIds: c.productIds.filter((id) => productsById.has(id)),
    parentId: c.parentId && c.parentId !== c.id ? c.parentId : null,
  }));
  return {
    products,
    categories: cleanCategories,
    productsById,
    productsByUid: new Map(products.map((p) => [p.uid, p])),
    categoriesById: new Map(cleanCategories.map((c) => [c.id, c])),
    categoriesByUid: new Map(cleanCategories.map((c) => [c.uid, c])),
  };
}

export function childCategories(catalog: Catalog, parentId: string): CatalogCategory[] {
  return catalog.categories.filter((c) => c.parentId === parentId);
}

export function topLevelCategories(catalog: Catalog, kind: CatalogCategory["kind"] = "category"): CatalogCategory[] {
  return catalog.categories.filter((c) => c.kind === kind && (!c.parentId || !catalog.categoriesById.has(c.parentId)));
}

/** Parent chain from the top down (excluding the category itself). Cycle-safe. */
export function ancestors(catalog: Catalog, categoryId: string): CatalogCategory[] {
  const chain: CatalogCategory[] = [];
  const seen = new Set([categoryId]);
  let parentId = catalog.categoriesById.get(categoryId)?.parentId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = catalog.categoriesById.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

/** Products of a category: all products if "show all", else its own links plus every subcategory's. */
export function categoryProducts(catalog: Catalog, categoryId: string): CatalogProduct[] {
  const root = catalog.categoriesById.get(categoryId);
  if (!root) return [];
  if (root.showAll) return [...catalog.products];
  const ids: string[] = [];
  const visit = (category: CatalogCategory, seen: Set<string>) => {
    for (const id of category.productIds) if (!ids.includes(id)) ids.push(id);
    for (const child of childCategories(catalog, category.id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      visit(child, seen);
    }
  };
  visit(root, new Set([root.id]));
  return ids.map((id) => catalog.productsById.get(id)!).filter(Boolean);
}

/** First category (not collection) that links the product explicitly; then any collection. */
export function primaryCategory(catalog: Catalog, productId: string, menuOrder: string[] = []): CatalogCategory | null {
  const candidates = catalog.categories.filter((c) => c.productIds.includes(productId));
  const rank = (c: CatalogCategory) => {
    const menuIndex = menuOrder.indexOf(c.id);
    return [c.kind === "category" ? 0 : 1, menuIndex === -1 ? Number.MAX_SAFE_INTEGER : menuIndex, ancestors(catalog, c.id).length * -1] as const;
  };
  candidates.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.title.localeCompare(b.title, "pt-BR");
  });
  return candidates[0] ?? null;
}

/** Lowest and highest sellable price across a product's variants (or its own price). */
export function priceRange(p: CatalogProduct): { min: Cents; max: Cents } | null {
  const prices = (p.variants.length > 0 ? p.variants.map((v) => v.priceCents) : [p.priceCents]).filter(
    (c): c is Cents => c !== null,
  );
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Compact shape for product cards and listings (keeps loader payloads small). */
export interface ProductSummary {
  id: string;
  uid: string;
  name: string;
  priceCents: Cents | null;
  /** True when variants have different prices: show "a partir de". */
  priceFrom: boolean;
  originalPriceCents: Cents | null;
  discountPercent: number | null;
  availability: Availability;
  purchasable: boolean;
  hasVariants: boolean;
  image: CatalogImage | null;
  hoverImage: CatalogImage | null;
  sku: string | null;
}

export function toSummary(p: CatalogProduct): ProductSummary {
  const range = priceRange(p);
  return {
    id: p.id,
    uid: p.uid,
    name: p.name,
    priceCents: range?.min ?? null,
    priceFrom: range !== null && range.min !== range.max,
    originalPriceCents: p.variants.length === 0 ? p.originalPriceCents : null,
    discountPercent: p.variants.length === 0 ? p.discountPercent : null,
    availability: p.availability,
    purchasable: p.purchasable,
    hasVariants: p.variants.length > 0,
    image: p.images[0] ?? null,
    hoverImage: p.images[1] ?? null,
    sku: p.sku,
  };
}

export const SORT_OPTIONS = [
  { value: "featured", label: "Destaques" },
  { value: "bestsellers", label: "Mais vendidos" },
  { value: "newest", label: "Novidades" },
  { value: "price_asc", label: "Menor preço" },
  { value: "price_desc", label: "Maior preço" },
  { value: "name", label: "Nome (A–Z)" },
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number]["value"];

export function parseSort(value: string | null): SortOption {
  return SORT_OPTIONS.some((o) => o.value === value) ? (value as SortOption) : "featured";
}

/**
 * Stable sort. Products without a price go last for price sorts. `unitsSold`
 * comes from Firestore order stats; products with no sales tie on name.
 */
export function sortProducts(products: CatalogProduct[], sort: SortOption, unitsSold: Map<string, number> = new Map()): CatalogProduct[] {
  const byName = (a: CatalogProduct, b: CatalogProduct) => a.name.localeCompare(b.name, "pt-BR");
  const indexed = products.map((p, i) => ({ p, i }));
  const min = (p: CatalogProduct) => priceRange(p)?.min ?? null;
  const compare: Record<SortOption, (a: { p: CatalogProduct; i: number }, b: { p: CatalogProduct; i: number }) => number> = {
    featured: (a, b) => a.i - b.i,
    bestsellers: (a, b) => (unitsSold.get(b.p.id) ?? 0) - (unitsSold.get(a.p.id) ?? 0) || byName(a.p, b.p),
    newest: (a, b) => b.p.firstPublishedAt.localeCompare(a.p.firstPublishedAt) || byName(a.p, b.p),
    price_asc: (a, b) => nullsLast(min(a.p), min(b.p), 1) || byName(a.p, b.p),
    price_desc: (a, b) => nullsLast(min(a.p), min(b.p), -1) || byName(a.p, b.p),
    name: (a, b) => byName(a.p, b.p),
  };
  return indexed.sort(compare[sort]).map(({ p }) => p);
}

function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

export interface ProductFilters {
  minCents?: Cents;
  maxCents?: Cents;
  availableOnly?: boolean;
  sizes?: string[];
  colors?: string[];
  materials?: string[];
  categoryIds?: string[];
}

export function parseFilters(params: URLSearchParams): ProductFilters {
  const cents = (key: string) => {
    const raw = params.get(key);
    if (!raw) return undefined;
    const reais = Number(raw.replace(",", "."));
    return Number.isFinite(reais) && reais >= 0 ? Math.round(reais * 100) : undefined;
  };
  const list = (key: string) => params.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  return {
    minCents: cents("min"),
    maxCents: cents("max"),
    availableOnly: params.get("disponivel") === "1",
    sizes: list("tamanho"),
    colors: list("cor"),
    materials: list("material"),
    categoryIds: list("categoria"),
  };
}

function optionValues(p: CatalogProduct, key: "size" | "color" | "material"): string[] {
  return [...new Set(p.variants.map((v) => v.options[key]).filter((v): v is string => Boolean(v)))];
}

export function filterProducts(products: CatalogProduct[], filters: ProductFilters, catalog?: Catalog): CatalogProduct[] {
  const inCategories =
    filters.categoryIds?.length && catalog
      ? new Set(filters.categoryIds.flatMap((uid) => {
          const category = catalog.categoriesByUid.get(uid);
          return category ? categoryProducts(catalog, category.id).map((p) => p.id) : [];
        }))
      : null;
  const matchesAny = (values: string[], wanted?: string[]) =>
    !wanted?.length || values.some((v) => wanted.some((w) => fold(w) === fold(v)));

  return products.filter((p) => {
    const range = priceRange(p);
    if (filters.minCents !== undefined && (!range || range.max < filters.minCents)) return false;
    if (filters.maxCents !== undefined && (!range || range.min > filters.maxCents)) return false;
    if (filters.availableOnly && !(p.purchasable && SELLABLE.has(p.availability))) return false;
    if (!matchesAny(optionValues(p, "size"), filters.sizes)) return false;
    if (!matchesAny(optionValues(p, "color"), filters.colors)) return false;
    if (!matchesAny(optionValues(p, "material"), filters.materials)) return false;
    if (inCategories && !inCategories.has(p.id)) return false;
    return true;
  });
}

export interface Facets {
  sizes: { value: string; count: number }[];
  colors: { value: string; count: number }[];
  materials: { value: string; count: number }[];
  price: { min: Cents; max: Cents } | null;
  availableCount: number;
}

export function facets(products: CatalogProduct[]): Facets {
  const count = (key: "size" | "color" | "material") => {
    const counts = new Map<string, number>();
    for (const p of products) for (const v of optionValues(p, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts].map(([value, n]) => ({ value, count: n })).sort((a, b) => a.value.localeCompare(b.value, "pt-BR"));
  };
  const ranges = products.map(priceRange).filter((r): r is { min: Cents; max: Cents } => r !== null);
  return {
    sizes: count("size"),
    colors: count("color"),
    materials: count("material"),
    price: ranges.length ? { min: Math.min(...ranges.map((r) => r.min)), max: Math.max(...ranges.map((r) => r.max)) } : null,
    availableCount: products.filter((p) => p.purchasable && SELLABLE.has(p.availability)).length,
  };
}

export const PAGE_SIZE = 24;

export function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return {
    items: items.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageCount,
    total: items.length,
  };
}

/** Editor-picked related products first, then same-category products; purchasable ones first. */
export function relatedProducts(catalog: Catalog, product: CatalogProduct, limit = 8): CatalogProduct[] {
  const picked = product.relatedIds.map((id) => catalog.productsById.get(id)).filter((p): p is CatalogProduct => Boolean(p));
  const category = primaryCategory(catalog, product.id);
  const sameCategory = category ? categoryProducts(catalog, category.id) : [];
  const out: CatalogProduct[] = [];
  for (const p of [...picked, ...sameCategory.filter((p) => p.purchasable), ...sameCategory]) {
    if (p.id !== product.id && !out.includes(p)) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}
