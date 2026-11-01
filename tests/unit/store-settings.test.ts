import { describe, expect, it } from "vitest";

import { paymentSettingsSchema, shippingOptions, shippingSettingsSchema } from "~/lib/store-settings";

const input = {
  flatRate: { enabled: true, priceCents: 2500 },
  pickup: { enabled: true, address: "Mercadão de Madureira – Anexo, Galeria K" },
};
const base = shippingSettingsSchema.parse(input);

describe("shipping settings schema", () => {
  it("fills defaults: labels, 1 handling day, no transit estimate", () => {
    expect(base.handlingDays).toBe(1);
    expect(base.flatRate.label).toBe("Entrega em todo o Brasil");
    expect(base.flatRate.transitDays).toBeNull();
    expect(base.pickup.label).toBe("Retirar na loja");
    expect(base.pickup.instructions).toBeNull();
  });

  it("refuses negative prices and inverted day ranges", () => {
    expect(shippingSettingsSchema.safeParse({ ...input, flatRate: { enabled: true, priceCents: -1 } }).success).toBe(false);
    expect(
      shippingSettingsSchema.safeParse({ ...input, flatRate: { enabled: true, priceCents: 0, transitDays: { min: 5, max: 2 } } }).success,
    ).toBe(false);
  });
});

describe("shippingOptions", () => {
  it("offers the flat rate (needs an address) and free pickup", () => {
    expect(shippingOptions(base, { pickupOnly: false }).map((o) => [o.id, o.priceCents, o.needsAddress])).toEqual([
      ["flat_rate", 2500, true],
      ["pickup", 0, false],
    ]);
  });

  it("adds the store's handling days to the carrier's transit days", () => {
    const settings = { ...base, handlingDays: 2, flatRate: { ...base.flatRate, transitDays: { min: 3, max: 8 } } };
    expect(shippingOptions(settings, { pickupOnly: false })[0]!.estimateDays).toEqual({ min: 5, max: 10 });
  });

  it("allows only pickup when a product in the cart is pickup-only", () => {
    expect(shippingOptions(base, { pickupOnly: true }).map((o) => o.id)).toEqual(["pickup"]);
  });

  it("offers nothing when both methods are off (checkout must say so, not guess)", () => {
    const off = { ...base, flatRate: { ...base.flatRate, enabled: false }, pickup: { ...base.pickup, enabled: false } };
    expect(shippingOptions(off, { pickupOnly: false })).toEqual([]);
  });
});

describe("payment settings schema", () => {
  it("defaults the Pix expiry to 24 hours and requires key, name and city", () => {
    expect(paymentSettingsSchema.parse({ pix: { key: "k", merchantName: "n", merchantCity: "c" } }).expiryHours).toBe(24);
    expect(paymentSettingsSchema.safeParse({ pix: { key: " ", merchantName: "n", merchantCity: "c" } }).success).toBe(false);
  });
});
