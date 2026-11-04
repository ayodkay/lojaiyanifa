// Customer sessions and account data against the Auth + Firestore emulators, with real emulator ID tokens.
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { createCustomerSession, type CustomerUser, endCustomerSession, readCustomerSession, verifyRecentSignIn } from "~/.server/customer-session";
import {
  AddressLimitError,
  createCustomerProfile,
  deleteAddress,
  deleteCustomerAccount,
  exportCustomerData,
  getCustomerOrder,
  getCustomerProfile,
  getWishlist,
  listAddresses,
  listCustomerOrders,
  saveAddress,
  setWishlist,
  updateCustomerProfile,
} from "~/.server/customers";
import { adminAuth, db } from "~/.server/firebase";
import { createOrder, type OrderDeps } from "~/.server/orders";
import type { SavedAddressInput } from "~/lib/account";
import type { CheckoutInput } from "~/lib/checkout";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearAuth, clearFirestore, emulatorHost } from "./emulators";

const PASSWORD = "senha-de-teste-123";

async function signIn(email: string): Promise<string> {
  const res = await fetch(`http://${emulatorHost("FIREBASE_AUTH_EMULATOR_HOST")}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const json = (await res.json()) as { idToken?: string };
  if (!json.idToken) throw new Error(`no ID token for ${email}: ${JSON.stringify(json)}`);
  return json.idToken;
}

async function customer(email: string, emailVerified = true): Promise<CustomerUser> {
  const { uid } = await adminAuth().createUser({ email, password: PASSWORD, emailVerified });
  return { uid, email, emailVerified };
}

const requestWith = (setCookie: string) => new Request("http://localhost:5173/account", { headers: { cookie: setCookie.split(";")[0]! } });

const registration = { name: "Maria da Silva", phone: "+5521987654321", cpf: "52998224725", marketingEmail: false, acceptTerms: true as const };
const address = (overrides: Partial<SavedAddressInput> = {}): SavedAddressInput => ({
  cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ", label: null, isDefault: false, ...overrides,
});

const deps: OrderDeps = {
  catalog: catalogOf([catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 12990, prismicStock: 50 })]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: false, address: "x" } }),
};
const checkout = (email: string): CheckoutInput => ({
  idempotencyKey: randomUUID(), name: "Maria da Silva", email, phone: "+5521987654321", cpf: "52998224725", shippingMethod: "flat_rate",
  address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
  acceptTerms: true, couponCode: null, items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }],
});

describe("customer sessions", () => {
  beforeEach(async () => {
    await clearAuth();
    await clearFirestore();
  });

  it("a fresh sign-in becomes a 14-day HttpOnly cookie the account pages accept", async () => {
    const maria = await customer("maria@exemplo.com", false);
    const result = await createCustomerSession(await signIn(maria.email));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user).toEqual({ uid: maria.uid, email: "maria@exemplo.com", emailVerified: false });
    expect(result.setCookie).toMatch(/^__session=[^;]+; Max-Age=1209600; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    expect(await readCustomerSession(requestWith(result.setCookie))).toEqual({ status: "ok", user: result.user });
  });

  it("refuses an old sign-in, a forged token, and reads no cookie as signed out", async () => {
    const maria = await customer("maria@exemplo.com");
    const token = await signIn(maria.email);
    expect(await createCustomerSession(token, { now: new Date(Date.now() + 6 * 60_000) })).toEqual({ ok: false, reason: "stale_sign_in" });
    expect(await createCustomerSession("not-a-token")).toEqual({ ok: false, reason: "invalid_token" });
    expect(await readCustomerSession(new Request("http://localhost:5173/account"))).toEqual({ status: "signed_out", staleCookie: false });
  });

  it("signing out revokes every session of the account", async () => {
    const maria = await customer("maria@exemplo.com");
    const result = await createCustomerSession(await signIn(maria.email));
    if (!result.ok) throw new Error("no session");
    await sleep(1100); // revocation works in whole seconds
    expect(await endCustomerSession(requestWith(result.setCookie))).toMatch(/^__session=; Max-Age=0;/);
    expect(await readCustomerSession(requestWith(result.setCookie))).toEqual({ status: "signed_out", staleCookie: true });
  });

  it("re-checks a typed password: same account, signed in within 5 minutes", async () => {
    const maria = await customer("maria@exemplo.com");
    const other = await customer("outra@exemplo.com");
    const token = await signIn(maria.email);
    expect(await verifyRecentSignIn(token, maria.uid)).toBe(true);
    expect(await verifyRecentSignIn(token, other.uid)).toBe(false);
    expect(await verifyRecentSignIn(token, maria.uid, new Date(Date.now() + 6 * 60_000))).toBe(false);
  });
});

describe("customer profile, addresses and wishlist", () => {
  beforeEach(async () => {
    await clearAuth();
    await clearFirestore();
  });

  it("registration saves the profile and its consents once, and queues one welcome e-mail", async () => {
    const maria = await customer("maria@exemplo.com");
    expect(await createCustomerProfile(maria, registration)).toEqual({ created: true });
    expect(await createCustomerProfile(maria, { ...registration, name: "Outro Nome" })).toEqual({ created: false });
    expect(await getCustomerProfile(maria.uid)).toMatchObject({ name: "Maria da Silva", email: "maria@exemplo.com", cpf: "52998224725", marketingEmail: false });
    const mail = await db().collection("mail").get();
    expect(mail.docs.map((d) => [d.get("template"), d.get("to"), d.get("data")])).toEqual([["welcome", "maria@exemplo.com", { name: "Maria da Silva" }]]);
    const consents = (await db().doc(`customers/${maria.uid}`).get()).get("consents");
    expect(consents.termsAcceptedAt).toBeDefined();
    expect(consents.marketingEmail).toMatchObject({ granted: false, source: "registration" });
  });

  it("records each change of the marketing consent, with its time", async () => {
    const maria = await customer("maria@exemplo.com");
    await createCustomerProfile(maria, registration);
    await updateCustomerProfile(maria, { name: "Maria da Silva", phone: "+5521987654321", cpf: "52998224725", marketingEmail: true });
    await updateCustomerProfile(maria, { name: "Maria Souza", phone: "+5521987654321", cpf: "52998224725", marketingEmail: true });
    const d = (await db().doc(`customers/${maria.uid}`).get()).data()!;
    expect(d.name).toBe("Maria Souza");
    expect(d.consents.history.map((h: { granted: boolean; source: string }) => [h.granted, h.source])).toEqual([
      [false, "registration"],
      [true, "profile"],
    ]);
  });

  it("keeps exactly one default address, moves it when the default is deleted, and stops at 10", async () => {
    const maria = await customer("maria@exemplo.com");
    const casa = await saveAddress(maria.uid, null, address({ label: "Casa" }));
    const trabalho = await saveAddress(maria.uid, null, address({ label: "Trabalho" }));
    expect((await listAddresses(maria.uid)).map((a) => [a.label, a.isDefault])).toEqual([["Casa", true], ["Trabalho", false]]);
    await saveAddress(maria.uid, trabalho, address({ label: "Trabalho", isDefault: true }));
    expect((await listAddresses(maria.uid)).map((a) => [a.label, a.isDefault])).toEqual([["Trabalho", true], ["Casa", false]]);
    await deleteAddress(maria.uid, trabalho);
    expect((await listAddresses(maria.uid)).map((a) => [a.id, a.isDefault])).toEqual([[casa, true]]);
    for (let i = 0; i < 9; i++) await saveAddress(maria.uid, null, address({ label: `E${i}` }));
    await expect(saveAddress(maria.uid, null, address())).rejects.toBeInstanceOf(AddressLimitError);
  });

  it("stores the wishlist without duplicates or junk", async () => {
    const maria = await customer("maria@exemplo.com");
    expect(await setWishlist(maria.uid, ["a", "b", "a", 7, "", "x".repeat(65)])).toEqual(["a", "b"]);
    expect(await getWishlist(maria.uid)).toEqual(["a", "b"]);
  });
});

describe("the customer's orders", () => {
  beforeEach(async () => {
    await clearAuth();
    await clearFirestore();
  });

  it("orders placed signed in are always theirs; guest orders with the same e-mail only once it is verified", async () => {
    const unverified = await customer("maria@exemplo.com", false);
    await createOrder(checkout("maria@exemplo.com"), deps, { uid: unverified.uid }); // 1001, signed in
    await createOrder(checkout("maria@exemplo.com"), deps); // 1002, as a guest
    await createOrder(checkout("outra@exemplo.com"), deps); // 1003, someone else

    expect((await listCustomerOrders(unverified)).map((o) => o.number)).toEqual([1001]);
    expect(await getCustomerOrder(unverified, 1002)).toBeNull();

    const verified = { ...unverified, emailVerified: true };
    expect((await listCustomerOrders(verified)).map((o) => o.number)).toEqual([1002, 1001]);
    expect((await getCustomerOrder(verified, 1002))?.number).toBe(1002);
    expect(await getCustomerOrder(verified, 1003)).toBeNull();
    expect(await getCustomerOrder(verified, 4242)).toBeNull();
    expect((await listCustomerOrders(verified))[0]).toMatchObject({ number: 1002, status: "pending_payment", method: "flat_rate", totalCents: 15490, itemCount: 1 });
  });
});

describe("LGPD: export and deletion", () => {
  beforeEach(async () => {
    await clearAuth();
    await clearFirestore();
  });

  it("exports profile, consents, addresses, wishlist and orders (with the CPF), and records the request", async () => {
    const maria = await customer("maria@exemplo.com");
    await createCustomerProfile(maria, registration);
    await saveAddress(maria.uid, null, address({ label: "Casa" }));
    await setWishlist(maria.uid, ["colar"]);
    await createOrder(checkout("maria@exemplo.com"), deps, { uid: maria.uid });
    const data = await exportCustomerData(maria);
    expect(data).toMatchObject({ account: { uid: maria.uid, email: "maria@exemplo.com" }, profile: { name: "Maria da Silva", cpf: "52998224725" }, wishlist: ["colar"] });
    expect((data.addresses as unknown[]).length).toBe(1);
    expect((data.orders as { number: number; cpf: string }[]).map((o) => [o.number, o.cpf])).toEqual([[1001, "52998224725"]]);
    const audit = await db().collection("auditLogs").where("action", "==", "customer.data_exported").get();
    expect(audit.docs.map((d) => d.get("actor"))).toEqual([{ type: "customer", name: maria.uid }]);
  });

  it("deletes profile, addresses, wishlist and the sign-in, keeps the orders, and records it without personal data", async () => {
    const maria = await customer("maria@exemplo.com");
    await createCustomerProfile(maria, registration);
    await saveAddress(maria.uid, null, address());
    await setWishlist(maria.uid, ["colar"]);
    await createOrder(checkout("maria@exemplo.com"), deps, { uid: maria.uid });

    expect(await deleteCustomerAccount(maria)).toEqual({ ordersKept: 1 });
    expect((await db().doc(`customers/${maria.uid}`).get()).exists).toBe(false);
    expect((await db().collection(`customers/${maria.uid}/addresses`).get()).size).toBe(0);
    expect((await db().doc(`wishlists/${maria.uid}`).get()).exists).toBe(false);
    await expect(adminAuth().getUser(maria.uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
    expect((await db().doc("orders/1001").get()).exists).toBe(true);
    const audit = (await db().collection("auditLogs").where("action", "==", "customer.account_deleted").get()).docs[0]!.data();
    expect(JSON.stringify(audit)).not.toContain("maria@exemplo.com");
  });
});
