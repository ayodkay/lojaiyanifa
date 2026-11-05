import { describe, expect, it } from "vitest";

import { parseBrasiliaDateTime, parsePromotionForm, toBrasiliaInput } from "~/lib/admin/promotions";

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const base: [string, string][] = [
  ["name", "Boas-vindas"],
  ["label", "10% na primeira compra"],
  ["type", "coupon"],
  ["code", " bemvindo10 "],
  ["kind", "percent"],
  ["percent", "10"],
  ["scope", "all"],
  ["active", "on"],
];

describe("parsePromotionForm", () => {
  it("a percentage coupon for the whole store", () => {
    const result = parsePromotionForm(form([...base, ["firstOrderOnly", "on"], ["maxPerCustomer", "1"]]));
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Boas-vindas",
        label: "10% na primeira compra",
        code: "BEMVINDO10",
        kind: "percent",
        value: 10,
        buyQuantity: 0,
        getQuantity: 0,
        scope: { type: "all" },
        minSubtotalCents: null,
        startsAt: null,
        endsAt: null,
        maxRedemptions: null,
        maxPerCustomer: 1,
        firstOrderOnly: true,
        allowedEmails: null,
        active: true,
      },
    });
  });

  it("an automatic fixed discount on a bundle, with a minimum, a schedule in Brasília time and a customer list", () => {
    const result = parsePromotionForm(
      form([
        ["name", "Kit"],
        ["label", "R$ 20 no kit"],
        ["type", "automatic"],
        ["kind", "fixed"],
        ["amount", "20.00"],
        ["scope", "products"],
        ["productIds", "colar"],
        ["productIds", "pano"],
        ["requireAll", "on"],
        ["minSubtotal", "150"],
        ["startsAt", "2026-11-27T00:00"],
        ["endsAt", "2026-11-30T23:59"],
        ["allowedEmails", "Maria@exemplo.com, joao@exemplo.com\nmaria@exemplo.com"],
      ]),
    );
    expect(result.ok && result.value).toMatchObject({
      code: null,
      value: 2000,
      scope: { type: "products", productIds: ["colar", "pano"], requireAll: true },
      minSubtotalCents: 15000,
      startsAt: Date.parse("2026-11-27T03:00:00Z"),
      endsAt: Date.parse("2026-12-01T02:59:00Z"),
      allowedEmails: ["maria@exemplo.com", "joao@exemplo.com"],
      active: false,
    });
  });

  it("explains every problem", () => {
    const result = parsePromotionForm(
      form([
        ["type", "coupon"],
        ["code", "com espaço"],
        ["kind", "percent"],
        ["percent", "100"],
        ["scope", "categories"],
        ["startsAt", "2026-11-30T00:00"],
        ["endsAt", "2026-11-01T00:00"],
        ["maxRedemptions", "0"],
        ["allowedEmails", "não-é-email"],
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["allowedEmails", "categoryIds", "code", "endsAt", "label", "maxRedemptions", "name", "percent"]);
  });

  it("editing keeps the stored code, whatever the form says", () => {
    const result = parsePromotionForm(form([...base, ["code", "OUTRO"]]), "BEMVINDO10");
    expect(result.ok && result.value.code).toBe("BEMVINDO10");
  });

  it("buy X get Y needs both quantities", () => {
    const result = parsePromotionForm(form([...base.filter(([k]) => k !== "kind"), ["kind", "buy_x_get_y"], ["buyQuantity", "2"], ["getQuantity", "0"]]));
    expect(result.ok ? null : result.errors).toEqual({ getQuantity: "De 1 a 20." });
  });
});

describe("Brasília date-times", () => {
  it("round-trips a datetime-local value", () => {
    const ms = parseBrasiliaDateTime("2026-11-28T09:30")!;
    expect(new Date(ms).toISOString()).toBe("2026-11-28T12:30:00.000Z");
    expect(toBrasiliaInput(ms)).toBe("2026-11-28T09:30");
    expect(parseBrasiliaDateTime("28/11/2026")).toBeNull();
    expect(toBrasiliaInput(null)).toBe("");
  });
});
