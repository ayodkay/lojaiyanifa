// Hand-built catalog objects for tests. Shared so that a model change is made
// in one place (adding CatalogProduct.prismicStock broke two copies of this).
import { buildCatalog, type Catalog } from "~/lib/catalog/query";
import type { CatalogCategory, CatalogProduct, CatalogVariant } from "~/lib/catalog/types";

export function catalogProduct(id: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id, uid: id, name: id.toUpperCase(), sku: `SKU-${id}`, shortDescription: [], description: [], keywords: [],
    priceCents: 1000, originalPriceCents: null, discountPercent: null, availability: "in_stock", showStock: false,
    prismicStock: null, images: [], videos: [], variants: [], variantImages: [], sizeGuide: [], sizeGuideImage: null,
    specifications: [], materials: [], warrantyInfo: [], returnInfo: [],
    shipping: { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, pickupOnly: false },
    relatedIds: [], boughtTogetherIds: [], seo: { title: null, description: null, image: null }, tags: [],
    firstPublishedAt: "2026-10-01T00:00:00+0000", lastPublishedAt: "2026-10-01T00:00:00+0000",
    purchasable: true, issues: [],
    ...overrides,
  };
}

export function catalogVariant(sku: string, overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    sku, name: sku, options: { size: null, color: null, material: null, other: null }, colorSwatch: null,
    priceCents: 1000, availability: "in_stock", image: null, weightGrams: null, prismicStock: null, purchasable: true,
    ...overrides,
  };
}

export const catalogOf = (products: CatalogProduct[], categories: CatalogCategory[] = []): Catalog =>
  buildCatalog(products, categories);
