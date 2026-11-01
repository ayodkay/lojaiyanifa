import { beforeEach, describe, expect, it } from "vitest";

import { db } from "~/.server/firebase";
import { PixConfigError } from "~/.server/pix";
import { getPaymentSettings, getShippingSettings, ShippingConfigError } from "~/.server/settings";

import { clearFirestore } from "./emulators";

describe("settings from Firestore", () => {
  beforeEach(clearFirestore);

  it("reports missing settings as configuration errors the owner can act on", async () => {
    await expect(getPaymentSettings()).rejects.toBeInstanceOf(PixConfigError);
    await expect(getShippingSettings()).rejects.toBeInstanceOf(ShippingConfigError);
  });

  it("parses stored settings and fills the defaults", async () => {
    const pix = { key: "+5521987654321", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" };
    await db().doc("settings/payment").set({ pix });
    expect(await getPaymentSettings()).toEqual({ pix, expiryHours: 24 });
  });

  it("refuses malformed settings, naming the field", async () => {
    await db().doc("settings/shipping").set({ flatRate: { enabled: true, priceCents: "25" }, pickup: { enabled: true, address: "x" } });
    await expect(getShippingSettings()).rejects.toThrow(/flatRate\.priceCents/);
  });
});
