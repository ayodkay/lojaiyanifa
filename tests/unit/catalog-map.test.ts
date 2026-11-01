import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { flagDuplicateSkus, mapAvailability, mapCategory, mapProduct, mapSettings, videoFromEmbedUrl } from "~/lib/catalog/map";
import type { ProductCategoryDocument, ProductsDocument, SettingsDocument } from "~/types/prismic.generated";

// A real document as returned by the Prismic Content API on 2026-10-31
// (published before the model gained weight/SEO/related fields).
const fixture: ProductsDocument = JSON.parse(
  readFileSync(new URL("../fixtures/prismic/product-conjunto-masculino.json", import.meta.url), "utf8"),
);

function product(data: Record<string, unknown> = {}, overrides: Partial<ProductsDocument> = {}): ProductsDocument {
  return { ...fixture, ...overrides, data: { ...fixture.data, ...data } } as ProductsDocument;
}

const codes = (p: ReturnType<typeof mapProduct>) => p.issues.map((i) => i.code);

describe("mapProduct — real fixture", () => {
  const p = mapProduct(fixture);

  it("maps identity and editorial fields", () => {
    expect(p.uid).toBe("conjunto-masculino");
    expect(p.name).toBe("Conjunto masculino");
    expect(p.sku).toBe("VES-001");
    expect(p.availability).toBe("in_stock");
    expect(p.images).toEqual([]);
    expect(p.variants).toEqual([]);
  });

  it("tolerates fields that don't exist on documents published before the model change", () => {
    expect(p.shipping).toEqual({ weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, pickupOnly: false });
    expect(p.relatedIds).toEqual([]);
    expect(p.seo).toEqual({ title: null, description: null, image: null });
    expect(p.keywords).toEqual([]);
  });

  it("is not purchasable without a price, and says why", () => {
    expect(p.priceCents).toBeNull();
    expect(p.purchasable).toBe(false);
    expect(codes(p)).toEqual(expect.arrayContaining(["missing_price", "missing_image", "missing_shipping_dimensions"]));
  });
});

describe("mapProduct — pricing rules", () => {
  it("computes the discount from the two prices", () => {
    const p = mapProduct(product({ price: 129.9, original_price: 159.9 }));
    expect(p.priceCents).toBe(12990);
    expect(p.originalPriceCents).toBe(15990);
    expect(p.discountPercent).toBe(19);
    expect(p.purchasable).toBe(true);
    expect(codes(p)).not.toContain("missing_price");
  });

  it("never displays a stated discount that disagrees with the prices", () => {
    const p = mapProduct(product({ price: 129.9, original_price: 159.9, discount_percentage: 50 }));
    expect(p.discountPercent).toBe(19);
    expect(codes(p)).toContain("discount_mismatch");
  });

  it("ignores a discount percentage without an original price", () => {
    const p = mapProduct(product({ price: 100, discount_percentage: 20 }));
    expect(p.discountPercent).toBeNull();
    expect(p.originalPriceCents).toBeNull();
    expect(codes(p)).toContain("discount_without_original_price");
  });

  it("treats an original price that isn't higher as no discount", () => {
    const p = mapProduct(product({ price: 100, original_price: 90 }));
    expect(p.discountPercent).toBeNull();
    expect(p.originalPriceCents).toBeNull();
    expect(codes(p)).toContain("original_price_not_higher");
  });

  it("does not sell discontinued or out-of-stock products", () => {
    expect(mapProduct(product({ price: 50, availability: "Discontinued" })).purchasable).toBe(false);
    expect(mapProduct(product({ price: 50, availability: "Out of stock" })).purchasable).toBe(false);
    expect(mapProduct(product({ price: 50, availability: "Pre-order" })).purchasable).toBe(true);
  });
});

describe("mapProduct — variants", () => {
  const baseRow = {
    variant_name: null, variant_sku: null, size: null, color: null, color_swatch: null, material: null,
    other_option: null, variant_price: null, variant_stock: null, variant_availability: "In stock", variant_image: {},
  };

  it("skips rows that only hold default values", () => {
    const p = mapProduct(product({ price: 100, variants: [baseRow] }));
    expect(p.variants).toEqual([]);
  });

  it("inherits the product price and requires a SKU", () => {
    const p = mapProduct(
      product({
        price: 100,
        variants: [
          { ...baseRow, size: "M", variant_sku: "VES-001-M" },
          { ...baseRow, size: "G", variant_sku: "VES-001-G", variant_price: 120 },
          { ...baseRow, size: "GG" },
        ],
      }),
    );
    expect(p.variants.map((v) => [v.sku, v.name, v.priceCents])).toEqual([
      ["VES-001-M", "M", 10000],
      ["VES-001-G", "G", 12000],
    ]);
    expect(codes(p)).toContain("variant_missing_sku");
    expect(p.purchasable).toBe(true);
  });
});

describe("mapProduct — stock typed in Prismic", () => {
  const variantRow = {
    variant_name: null, variant_sku: "VES-001-M", size: "M", color: null, color_swatch: null, material: null,
    other_option: null, variant_price: null, variant_availability: "In stock", variant_image: {},
  };

  it("keeps 0 as sold out (not as 'not tracked')", () => {
    expect(mapProduct(product({ price: 50, stock_quantity: 0 })).prismicStock).toBe(0);
    expect(mapProduct(product({ price: 50, stock_quantity: 7 })).prismicStock).toBe(7);
  });

  it("treats an empty field as not tracked, without complaining", () => {
    const p = mapProduct(product({ price: 50, stock_quantity: null }));
    expect(p.prismicStock).toBeNull();
    expect(codes(p)).not.toContain("invalid_stock");
  });

  it("refuses negative or fractional stock and flags it", () => {
    for (const bad of [-1, 2.5]) {
      const p = mapProduct(product({ price: 50, stock_quantity: bad }));
      expect(p.prismicStock).toBeNull();
      expect(codes(p)).toContain("invalid_stock");
    }
  });

  it("maps each variant's own stock", () => {
    const p = mapProduct(
      product({
        price: 50,
        variants: [
          { ...variantRow, variant_stock: 3 },
          { ...variantRow, variant_sku: "VES-001-G", size: "G", variant_stock: null },
          { ...variantRow, variant_sku: "VES-001-GG", size: "GG", variant_stock: -2 },
        ],
      }),
    );
    expect(p.variants.map((v) => [v.sku, v.prismicStock])).toEqual([
      ["VES-001-M", 3],
      ["VES-001-G", null],
      ["VES-001-GG", null],
    ]);
    expect(codes(p)).toContain("invalid_stock");
  });
});

describe("mapProduct — content health", () => {
  it("flags the U+FFFD encoding damage seen on 2026-10-31", () => {
    expect(codes(mapProduct(product({ product_name: "Alak�" })))).toContain("broken_encoding");
    expect(codes(mapProduct(product({ product_name: "Alaká" })))).not.toContain("broken_encoding");
  });

  it("flags SKUs shared by two products", () => {
    const a = mapProduct(product({ sku: "DUP-1" }, { id: "a", uid: "a" }));
    const b = mapProduct(product({ sku: "DUP-1" }, { id: "b", uid: "b" }));
    flagDuplicateSkus([a, b]);
    expect(codes(a)).toContain("duplicate_sku");
    expect(codes(b)).toContain("duplicate_sku");
  });
});

describe("helpers", () => {
  it("maps an empty availability to the model default", () => {
    expect(mapAvailability(null)).toBe("in_stock");
    expect(mapAvailability("Backorder")).toBe("backorder");
  });

  it("builds privacy-friendly video embeds and rejects unknown providers", () => {
    expect(videoFromEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "x")?.src).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoFromEmbedUrl("https://youtu.be/dQw4w9WgXcQ", "x")?.provider).toBe("youtube");
    expect(videoFromEmbedUrl("https://vimeo.com/76979871", "x")?.src).toBe("https://player.vimeo.com/video/76979871?dnt=1");
    expect(videoFromEmbedUrl("https://example.com/video", "x")).toBeNull();
  });

  it("maps categories, defaulting kind to Category", () => {
    const doc = {
      id: "c1", uid: "divinacao", type: "product_category", tags: [], lang: "pt-br",
      data: { title: "Divinação", intro: [], show_all_products: false, products: [{ product: { link_type: "Document", id: "p1", type: "products", uid: "opele", lang: "pt-br", tags: [], isBroken: false } }, { product: { link_type: "Document", id: "p2", isBroken: true } }] },
    } as unknown as ProductCategoryDocument;
    const c = mapCategory(doc);
    expect(c.kind).toBe("category");
    expect(c.productIds).toEqual(["p1"]);
    expect(c.parentId).toBeNull();
  });

  it("validates WhatsApp numbers and business hours in settings", () => {
    const s = mapSettings({
      data: {
        whatsapp_number: "+55 (11) 99999-9999",
        business_hours: [
          { day: "Monday", opens: "09:00", closes: "18:00" },
          { day: "Sunday", opens: "9h", closes: "12h" },
        ],
      },
    } as unknown as SettingsDocument);
    expect(s.contact.whatsappNumber).toBe("5511999999999");
    expect(s.contact.hours).toEqual([{ day: 1, opens: "09:00", closes: "18:00" }]);
    expect(mapSettings(null).storeName).toBe("Loja Iyanifa");
  });
});
