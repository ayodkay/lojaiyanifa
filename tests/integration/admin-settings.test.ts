import { beforeEach, describe, expect, it } from "vitest";

import {
  CheckoutStateError,
  getAdminSettings,
  savePaymentSettings,
  saveShippingSettings,
  setCheckoutOpen,
  SettingsChangedError,
} from "~/.server/admin-settings";
import { db } from "~/.server/firebase";
import { loadOrderDeps } from "~/.server/orders";
import type { AdminUser } from "~/.server/session";
import { CheckoutClosedError } from "~/.server/settings";
import { paymentSettingsSchema, shippingSettingsSchema } from "~/lib/store-settings";

import { clearFirestore } from "./emulators";

const owner: AdminUser = { uid: "owner-1", email: "dono@example.com", role: "owner" };
/** Banco Central's documentation key: a code made with it can't pay anyone. */
const TEST_KEY = "123e4567-e12b-12d1-a456-426655440000";
const payment = paymentSettingsSchema.parse({ pix: { key: TEST_KEY, merchantName: "Loja Teste", merchantCity: "Rio de Janeiro" }, expiryHours: 24 });
const shipping = shippingSettingsSchema.parse({
  flatRate: { enabled: true, priceCents: 2500 },
  pickup: { enabled: true, address: "Rua de Teste, 100 – Centro, Rio de Janeiro – RJ" },
});

const auditEntries = async () => (await db().collection("auditLogs").get()).docs.map((doc) => doc.data());

describe("admin settings", () => {
  beforeEach(clearFirestore);

  it("starts closed, with nothing saved and the reasons checkout can't open yet", async () => {
    const view = await getAdminSettings();
    expect(view.checkout).toEqual({ open: false, version: "none", blockers: ["Falta salvar o pagamento Pix.", "Falta salvar as formas de entrega."] });
    expect(view.payment).toMatchObject({ values: null, problem: null, version: "none", test: null });
    expect(view.shipping).toEqual({ values: null, problem: null, version: "none" });
  });

  it("saves the Pix settings with an audit entry that never holds the key; saving them again writes nothing", async () => {
    expect(await savePaymentSettings(payment, "none", owner)).toEqual({ changed: true });
    const stored = (await db().doc("settings/payment").get()).data();
    expect(stored).toMatchObject({ ...payment, updatedBy: { uid: owner.uid, email: owner.email } });

    const [entry, ...more] = await auditEntries();
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({ action: "settings.payment_updated", target: "settings/payment", actor: { uid: owner.uid, role: "owner" } });
    expect(entry!.details.changes).toEqual([
      { field: "pix.key", before: null, after: "chave aleatória …0000" },
      { field: "pix.merchantName", before: null, after: "Loja Teste" },
      { field: "pix.merchantCity", before: null, after: "Rio de Janeiro" },
      { field: "expiryHours", before: null, after: 24 },
    ]);
    expect(JSON.stringify(entry)).not.toContain(TEST_KEY);

    const view = await getAdminSettings();
    expect(view.payment).toMatchObject({ values: payment, problem: null, keyType: "chave aleatória", printed: { name: "LOJA TESTE", city: "RIO DE JANEIRO" } });
    expect(view.payment.test?.brCode).toContain("TESTE");
    expect(view.payment.test?.qr).toMatch(/^data:image\/svg\+xml;base64,/);

    expect(await savePaymentSettings(payment, view.payment.version, owner)).toEqual({ changed: false });
    expect(await auditEntries()).toHaveLength(1);
  });

  it("refuses a page that was loaded before someone else saved, and writes nothing", async () => {
    await savePaymentSettings(payment, "none", owner); // another tab, after this page loaded
    const stale = { ...payment, expiryHours: 48 };
    await expect(savePaymentSettings(stale, "none", owner)).rejects.toBeInstanceOf(SettingsChangedError);
    expect((await db().doc("settings/payment").get()).get("expiryHours")).toBe(24);
    expect(await auditEntries()).toHaveLength(1);
  });

  it("opens checkout only once both settings are valid, and closes it at any time", async () => {
    const refused = await setCheckoutOpen(true, "none", owner).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CheckoutStateError);
    expect((refused as CheckoutStateError).reasons).toEqual(["Falta salvar o pagamento Pix.", "Falta salvar as formas de entrega."]);
    expect((await db().doc("settings/store").get()).exists).toBe(false);

    await savePaymentSettings(payment, "none", owner);
    await saveShippingSettings(shipping, "none", owner);
    const ready = await getAdminSettings();
    expect(ready.checkout).toMatchObject({ open: false, blockers: [] });

    expect(await setCheckoutOpen(true, ready.checkout.version, owner)).toEqual({ changed: true });
    const opened = await getAdminSettings();
    expect(opened.checkout.open).toBe(true);
    expect(await setCheckoutOpen(false, opened.checkout.version, owner)).toEqual({ changed: true });
    expect((await getAdminSettings()).checkout.open).toBe(false);

    const actions = (await auditEntries()).map((entry) => entry.action).sort();
    expect(actions).toEqual(["settings.checkout_closed", "settings.checkout_opened", "settings.payment_updated", "settings.shipping_updated"]);
  });

  it("won't leave an open checkout with no way to deliver", async () => {
    await savePaymentSettings(payment, "none", owner);
    await saveShippingSettings(shipping, "none", owner);
    await setCheckoutOpen(true, (await getAdminSettings()).checkout.version, owner);

    const none = { ...shipping, flatRate: { ...shipping.flatRate, enabled: false }, pickup: { ...shipping.pickup, enabled: false } };
    const refused = await saveShippingSettings(none, (await getAdminSettings()).shipping.version, owner).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(CheckoutStateError);
    expect((refused as CheckoutStateError).reasons[0]).toMatch(/Com o checkout aberto/);
    expect((await db().doc("settings/shipping").get()).get("flatRate.enabled")).toBe(true);
  });

  it("places no order while checkout is closed, checking that before anything else", async () => {
    // Nothing is saved: had the payment settings been read first, this would be a PixConfigError.
    await expect(loadOrderDeps()).rejects.toBeInstanceOf(CheckoutClosedError);
  });
});
