import { describe, expect, it } from "vitest";

import { mergeLines, prismicStockBySku, quoteCart, recommendForCart, type StockLevel } from "~/lib/cart/quote";

import { catalogOf, catalogProduct, catalogVariant } from "../factories";

const untracked: StockLevel = { tracked: false };
const tracked = (available: number): StockLevel => ({ tracked: true, available });
const stockFor = (entries: Record<string, StockLevel>) => new Map(Object.entries(entries));

describe("quoteCart — prices come from the catalog", () => {
  const catalog = catalogOf([
    catalogProduct("a", { name: "Colar", priceCents: 12990, originalPriceCents: 15990, discountPercent: 19 }),
    catalogProduct("b", { name: "Pulseira", priceCents: 4500 }),
  ]);

  it("prices each line and totals the cart", () => {
    const q = quoteCart(
      catalog,
      [
        { productId: "a", sku: "SKU-a", quantity: 2 },
        { productId: "b", sku: "SKU-b", quantity: 1 },
      ],
      stockFor({ "SKU-a": untracked, "SKU-b": untracked }),
    );
    expect(q.lines.map((l) => [l.name, l.unitPriceCents, l.quantity, l.lineTotalCents, l.problem])).toEqual([
      ["Colar", 12990, 2, 25980, null],
      ["Pulseira", 4500, 1, 4500, null],
    ]);
    expect(q.subtotalCents).toBe(30480);
    expect(q.totalCents).toBe(30480);
    expect(q.itemCount).toBe(3);
    expect(q.savingsCents).toBe(6000); // (159,90 − 129,90) × 2, already inside the subtotal
    expect(q.ready).toBe(true);
  });

  it("merges duplicate SKUs and caps a line at 99 units", () => {
    expect(
      mergeLines([
        { productId: "b", sku: "SKU-b", quantity: 60 },
        { productId: "b", sku: "SKU-b", quantity: 60 },
      ]),
    ).toEqual([{ productId: "b", sku: "SKU-b", quantity: 99 }]);
  });

  it("refuses quantities that aren't whole numbers ≥ 1", () => {
    expect(() => mergeLines([{ productId: "b", sku: "SKU-b", quantity: 0 }])).toThrow(/quantity/);
    expect(() => mergeLines([{ productId: "b", sku: "SKU-b", quantity: 1.5 }])).toThrow(/quantity/);
  });
});

describe("quoteCart — lines that can't be bought", () => {
  const catalog = catalogOf([
    catalogProduct("a"),
    catalogProduct("noprice", { priceCents: null, purchasable: false }),
    catalogProduct("shirt", { sku: null, variants: [catalogVariant("V-1")] }),
  ]);

  it("marks deleted products, foreign SKUs, unpriced products and removed variants unavailable, outside the totals", () => {
    const q = quoteCart(
      catalog,
      [
        { productId: "deleted", sku: "X", quantity: 1 },
        { productId: "a", sku: "SKU-OTHER", quantity: 1 },
        { productId: "noprice", sku: "SKU-noprice", quantity: 1 },
        { productId: "shirt", sku: "V-2", quantity: 1 },
        { productId: "a", sku: "SKU-a", quantity: 1 },
      ],
      stockFor({ "SKU-a": untracked }),
    );
    expect(q.lines.map((l) => [l.sku, l.problem, l.quantity, l.lineTotalCents])).toEqual([
      ["X", "unavailable", 0, 0],
      ["SKU-OTHER", "unavailable", 0, 0],
      ["SKU-noprice", "unavailable", 0, 0],
      ["V-2", "unavailable", 0, 0],
      ["SKU-a", null, 1, 1000],
    ]);
    expect(q.lines[0]!.name).toBe("Produto indisponível");
    expect(q.subtotalCents).toBe(1000);
    expect(q.ready).toBe(false);
  });

  it("is not ready when empty", () => {
    expect(quoteCart(catalog, [], new Map()).ready).toBe(false);
  });
});

describe("quoteCart — stock", () => {
  const catalog = catalogOf([catalogProduct("a"), catalogProduct("pre", { availability: "preorder" })]);
  const line = (quantity: number) => [{ productId: "a", sku: "SKU-a", quantity }];

  it("lowers the quantity to what is left and says so", () => {
    const [l] = quoteCart(catalog, line(5), stockFor({ "SKU-a": tracked(2) })).lines;
    expect(l).toMatchObject({ quantity: 2, requestedQuantity: 5, maxQuantity: 2, lineTotalCents: 2000, problem: "quantity_reduced" });
  });

  it("reports sold out when nothing is left (negative counts count as 0)", () => {
    for (const available of [0, -3]) {
      const q = quoteCart(catalog, line(1), stockFor({ "SKU-a": tracked(available) }));
      expect(q.lines[0]).toMatchObject({ quantity: 0, maxQuantity: 0, problem: "out_of_stock" });
      expect(q.ready).toBe(false);
    }
  });

  it("has no limit for untracked SKUs", () => {
    expect(quoteCart(catalog, line(40), stockFor({ "SKU-a": untracked })).lines[0]).toMatchObject({
      quantity: 40,
      maxQuantity: 99,
      problem: null,
    });
  });

  it("lets pre-orders exceed stock (no stock level needed)", () => {
    const q = quoteCart(catalog, [{ productId: "pre", sku: "SKU-pre", quantity: 3 }], new Map());
    expect(q.lines[0]).toMatchObject({ quantity: 3, problem: null });
  });

  it("fails loudly when the caller forgot a stock level", () => {
    expect(() => quoteCart(catalog, line(1), new Map())).toThrow(/SKU-a/);
  });
});

describe("quoteCart — variants", () => {
  const catalog = catalogOf([
    catalogProduct("shirt", {
      sku: null,
      variants: [
        catalogVariant("S-M", { name: "M", priceCents: 10000 }),
        catalogVariant("S-G", { name: "G", priceCents: 12000 }),
        catalogVariant("S-GG", { name: "GG", purchasable: false, availability: "out_of_stock" }),
      ],
    }),
  ]);

  it("prices the chosen variant and lists the others to switch to", () => {
    const [l] = quoteCart(catalog, [{ productId: "shirt", sku: "S-G", quantity: 1 }], stockFor({ "S-G": untracked })).lines;
    expect(l).toMatchObject({ variantName: "G", unitPriceCents: 12000, problem: null });
    expect(l!.variantChoices).toEqual([
      { sku: "S-M", name: "M", purchasable: true },
      { sku: "S-G", name: "G", purchasable: true },
      { sku: "S-GG", name: "GG", purchasable: false },
    ]);
  });

  it("reads each variant's Prismic stock (the inventory seed)", () => {
    const withStock = catalogOf([
      catalogProduct("x", { sku: null, variants: [catalogVariant("X-1", { prismicStock: 4 }), catalogVariant("X-2")] }),
    ]);
    expect(
      prismicStockBySku(withStock, [
        { productId: "x", sku: "X-1", quantity: 1 },
        { productId: "x", sku: "X-2", quantity: 1 },
        { productId: "x", sku: "X-9", quantity: 1 },
      ]),
    ).toEqual(
      new Map([
        ["X-1", 4],
        ["X-2", null],
      ]),
    );
  });
});

describe("recommendForCart", () => {
  it("prefers bought-together picks and skips cart items and unpurchasable products", () => {
    const catalog = catalogOf([
      catalogProduct("a", { boughtTogetherIds: ["b", "c"], relatedIds: ["d", "b"] }),
      catalogProduct("b"),
      catalogProduct("c", { purchasable: false }),
      catalogProduct("d"),
      catalogProduct("e"),
    ]);
    expect(recommendForCart(catalog, ["a"]).map((p) => p.id)).toEqual(["b", "d"]);
    expect(recommendForCart(catalog, ["a", "b"]).map((p) => p.id)).toEqual(["d"]);
  });
});
