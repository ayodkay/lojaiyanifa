import { describe, expect, it } from "vitest";

import {
  ancestors,
  buildCatalog,
  categoryProducts,
  filterProducts,
  paginate,
  parseFilters,
  primaryCategory,
  relatedProducts,
  sortProducts,
  toSummary,
} from "~/lib/catalog/query";
import type { CatalogCategory, CatalogProduct } from "~/lib/catalog/types";

function p(id: string, priceCents: number | null, extra: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id, uid: id, name: id.toUpperCase(), sku: `SKU-${id}`, shortDescription: [], description: [], keywords: [],
    priceCents, originalPriceCents: null, discountPercent: null, availability: "in_stock", showStock: false, prismicStock: null,
    images: [], videos: [], variants: [], variantImages: [], sizeGuide: [], sizeGuideImage: null, specifications: [],
    materials: [], warrantyInfo: [], returnInfo: [],
    shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, pickupOnly: false },
    relatedIds: [], boughtTogetherIds: [], seo: { title: null, description: null, image: null }, tags: [],
    firstPublishedAt: "2026-01-01T00:00:00+0000", lastPublishedAt: "2026-01-01T00:00:00+0000",
    purchasable: priceCents !== null, issues: [], ...extra,
  };
}

function c(id: string, productIds: string[], extra: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id, uid: id, title: id, intro: [], kind: "category", image: null, parentId: null, productIds, showAll: false,
    seo: { title: null, description: null, image: null }, ...extra,
  };
}

const products = [
  p("a", 3000, { firstPublishedAt: "2026-03-01T00:00:00+0000" }),
  p("b", 1000),
  p("c", null),
  p("d", 2000, { firstPublishedAt: "2026-05-01T00:00:00+0000" }),
];

describe("category membership", () => {
  const catalog = buildCatalog(products, [
    c("root", ["a"]),
    c("child", ["b", "a", "missing"], { parentId: "root" }),
    c("all", [], { showAll: true }),
    c("col", ["d"], { kind: "collection" }),
  ]);

  it("includes subcategory products, dedupes, and drops unpublished links", () => {
    expect(categoryProducts(catalog, "root").map((x) => x.id)).toEqual(["a", "b"]);
    expect(catalog.categoriesById.get("child")!.productIds).toEqual(["b", "a"]);
  });

  it("returns the whole catalog for 'show all products'", () => {
    expect(categoryProducts(catalog, "all")).toHaveLength(4);
  });

  it("prefers a category over a collection as the primary category", () => {
    const withBoth = buildCatalog(products, [c("col", ["a"], { kind: "collection" }), c("cat", ["a"])]);
    expect(primaryCategory(withBoth, "a")?.id).toBe("cat");
  });
});

describe("breadcrumbs", () => {
  it("survives a parent cycle", () => {
    const catalog = buildCatalog(products, [c("x", [], { parentId: "y" }), c("y", [], { parentId: "x" })]);
    expect(ancestors(catalog, "x").map((a) => a.id)).toEqual(["y"]);
    expect(categoryProducts(catalog, "x")).toEqual([]);
  });
});

describe("sorting, filtering, pagination", () => {
  it("sorts by price with unpriced products last", () => {
    expect(sortProducts(products, "price_asc").map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
    expect(sortProducts(products, "price_desc").map((x) => x.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("sorts by newest and by units sold", () => {
    expect(sortProducts(products, "newest").map((x) => x.id).slice(0, 2)).toEqual(["d", "a"]);
    expect(sortProducts(products, "bestsellers", new Map([["c", 5], ["b", 9]])).map((x) => x.id).slice(0, 2)).toEqual(["b", "c"]);
  });

  it("filters by price range parsed from the URL (reais, comma decimals)", () => {
    const filters = parseFilters(new URLSearchParams("min=15&max=25,50"));
    expect(filters.minCents).toBe(1500);
    expect(filters.maxCents).toBe(2550);
    expect(filterProducts(products, filters).map((x) => x.id)).toEqual(["d"]);
  });

  it("clamps pages into range", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(paginate(items, 3, 24)).toMatchObject({ page: 3, pageCount: 3, total: 50, items: [48, 49] });
    expect(paginate(items, 99, 24).page).toBe(3);
    expect(paginate(items, -1, 24).page).toBe(1);
    expect(paginate([], 1, 24)).toMatchObject({ page: 1, pageCount: 1, items: [] });
  });
});

describe("related products and summaries", () => {
  it("puts editor picks first and never includes the product itself", () => {
    const catalog = buildCatalog(
      [p("a", 100, { relatedIds: ["d"] }), p("b", 100), p("c", null), p("d", 100)],
      [c("cat", ["a", "b", "c"])],
    );
    expect(relatedProducts(catalog, catalog.productsById.get("a")!).map((x) => x.id)).toEqual(["d", "b", "c"]);
  });

  it("shows 'a partir de' only when variant prices differ", () => {
    const variant = (sku: string, priceCents: number) => ({
      sku, name: sku, options: { size: null, color: null, material: null, other: null }, colorSwatch: null,
      priceCents, availability: "in_stock" as const, image: null, weightGrams: null, prismicStock: null, purchasable: true,
    });
    expect(toSummary(p("v", null, { variants: [variant("1", 500), variant("2", 900)] }))).toMatchObject({ priceCents: 500, priceFrom: true });
    expect(toSummary(p("w", null, { variants: [variant("1", 500), variant("2", 500)] }))).toMatchObject({ priceFrom: false });
  });
});
