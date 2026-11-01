import { describe, expect, it } from "vitest";

import { buildCatalog } from "~/lib/catalog/query";
import type { CatalogCategory, CatalogProduct } from "~/lib/catalog/types";
import { buildSearchIndex, searchProducts } from "~/lib/search";

function p(id: string, name: string, sku: string, keywords: string[] = []): CatalogProduct {
  return {
    id, uid: id, name, sku, shortDescription: [], description: [], keywords, priceCents: 1000, originalPriceCents: null,
    discountPercent: null, availability: "in_stock", showStock: false, prismicStock: null, images: [], videos: [], variants: [], variantImages: [],
    sizeGuide: [], sizeGuideImage: null, specifications: [], materials: [], warrantyInfo: [], returnInfo: [],
    shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, pickupOnly: false },
    relatedIds: [], boughtTogetherIds: [], seo: { title: null, description: null, image: null }, tags: [],
    firstPublishedAt: "", lastPublishedAt: "", purchasable: true, issues: [],
  };
}

const products = [
  p("buzios", "Búzios", "DIV-003"),
  p("obi", "Obi", "SEM-003", ["noz de cola"]),
  p("opon", "Opon Ifá", "DIV-001"),
  p("pano", "Pano de cabeça", "VES-004"),
];
const category: CatalogCategory = {
  id: "div", uid: "divinacao", title: "Divinação", intro: [], kind: "category", image: null, parentId: null,
  productIds: ["buzios", "opon"], showAll: false, seo: { title: null, description: null, image: null },
};
const catalog = buildCatalog(products, [category]);
const index = buildSearchIndex(catalog, [["buzios", "cowrie", "dilogun"]]);
const ids = (q: string) => searchProducts(index, catalog, q).map((x) => x.id);

describe("search", () => {
  it("ignores accents and case", () => {
    expect(ids("buzios")).toContain("buzios");
    expect(ids("IFA")).toContain("opon");
    expect(ids("cabeca")).toContain("pano");
  });

  it("tolerates typos", () => {
    expect(ids("obbi")).toContain("obi");
    expect(ids("divinaçao")).toEqual(expect.arrayContaining(["buzios", "opon"]));
  });

  it("finds products by SKU and SKU prefix", () => {
    expect(ids("DIV-003")[0]).toBe("buzios");
    expect(ids("DIV")).toEqual(expect.arrayContaining(["buzios", "opon"]));
  });

  it("expands owner-defined synonyms", () => {
    expect(ids("cowrie")).toContain("buzios");
    expect(ids("dilogun")).toContain("buzios");
  });

  it("matches product keywords and category names", () => {
    expect(ids("noz de cola")).toContain("obi");
    expect(ids("divinação")).toEqual(expect.arrayContaining(["buzios", "opon"]));
  });

  it("returns nothing for empty or unrelated queries", () => {
    expect(ids("")).toEqual([]);
    expect(ids("   ")).toEqual([]);
    expect(ids("xyzzyqwerty")).toEqual([]);
  });
});
