// Customer accounts' data (docs/architecture.md §4.2): `customers/{uid}` (profile + consents),
// `customers/{uid}/addresses/{id}`, `wishlists/{uid}`, and the customer's view of their orders.
// Admin SDK: callers must have passed the account gate (app/.server/account-guard.ts) and pass the session's user.
//
// Which orders are the customer's: those placed while signed in (`customer.uid`), and — only once the account's
// e-mail is verified — those placed as a guest with the same e-mail. Without verification, anyone could register
// someone else's address and read their orders.
import { randomUUID } from "node:crypto";

import { type DocumentData, Timestamp } from "firebase-admin/firestore";

import type { ProfileInput, RegistrationInput, SavedAddressInput } from "~/lib/account";
import { MAX_ADDRESSES } from "~/lib/account";
import type { Cents } from "~/lib/money";
import type { CustomerOrderView, OrderAddress, OrderStatus } from "~/lib/orders";
import type { ShippingMethodId } from "~/lib/store-settings";

import { writeAudit } from "./audit";
import type { CustomerUser } from "./customer-session";
import { adminAuth, db } from "./firebase";
import { queueMailInTransaction } from "./mail/outbox";
import { iso } from "./order-doc";
import { toCustomerView } from "./orders";
import { ownsOrder } from "./ownership";
import { customerReviews, deleteCustomerReviews } from "./reviews";

const customerRef = (uid: string) => db().collection("customers").doc(uid);
const addressesRef = (uid: string) => customerRef(uid).collection("addresses");
const wishlistRef = (uid: string) => db().collection("wishlists").doc(uid);

export const MAX_WISHLIST = 100;

export class AddressLimitError extends Error {
  override name = "AddressLimitError";
}

// --- profile ------------------------------------------------------------------------------------

export interface CustomerProfile {
  name: string;
  email: string;
  phone: string;
  cpf: string;
  marketingEmail: boolean;
  createdAt: string;
}

export async function getCustomerProfile(uid: string): Promise<CustomerProfile | null> {
  const d = (await customerRef(uid).get()).data();
  if (!d) return null;
  return { name: d.name, email: d.email, phone: d.phone, cpf: d.cpf, marketingEmail: d.marketingEmail === true, createdAt: iso(d.createdAt) };
}

/** A consent as recorded (LGPD art. 8: the controller must be able to show it was given). */
const consentRecord = (granted: boolean, source: string, ts: Timestamp) => ({ granted, at: ts, source });

/**
 * The profile of a new account (registration, or completing one whose profile was never saved). Idempotent: a repeated
 * submission changes nothing. Queues the welcome e-mail in the same transaction.
 */
export async function createCustomerProfile(user: CustomerUser, input: RegistrationInput, now = new Date()): Promise<{ created: boolean }> {
  return db().runTransaction(async (tx) => {
    const ref = customerRef(user.uid);
    if ((await tx.get(ref)).exists) return { created: false };
    const ts = Timestamp.fromDate(now);
    tx.create(ref, {
      name: input.name,
      email: user.email,
      phone: input.phone,
      cpf: input.cpf,
      marketingEmail: input.marketingEmail,
      consents: {
        termsAcceptedAt: ts,
        marketingEmail: consentRecord(input.marketingEmail, "registration", ts),
        history: [{ kind: "marketingEmail", ...consentRecord(input.marketingEmail, "registration", ts) }],
      },
      createdAt: ts,
      updatedAt: ts,
    });
    queueMailInTransaction(tx, { template: "welcome", to: user.email, orderNumber: null, data: { name: input.name } }, now);
    return { created: true };
  });
}

/** Saves the profile form. A change of the marketing consent is recorded with its time (and kept in its history). */
export async function updateCustomerProfile(user: CustomerUser, input: ProfileInput, now = new Date()): Promise<void> {
  await db().runTransaction(async (tx) => {
    const ref = customerRef(user.uid);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`customers/${user.uid} does not exist: complete the registration first`);
    const d = snap.data()!;
    const ts = Timestamp.fromDate(now);
    const changes: DocumentData = { name: input.name, phone: input.phone, cpf: input.cpf, email: user.email, updatedAt: ts };
    if ((d.marketingEmail === true) !== input.marketingEmail) {
      const history = Array.isArray(d.consents?.history) ? d.consents.history : [];
      changes.marketingEmail = input.marketingEmail;
      changes["consents.marketingEmail"] = consentRecord(input.marketingEmail, "profile", ts);
      changes["consents.history"] = [...history, { kind: "marketingEmail", ...consentRecord(input.marketingEmail, "profile", ts) }].slice(-50);
    }
    tx.update(ref, changes);
  });
}

// --- addresses ------------------------------------------------------------------------------------

export interface SavedAddress extends OrderAddress {
  id: string;
  label: string | null;
  isDefault: boolean;
}

const toSavedAddress = (id: string, d: DocumentData): SavedAddress => ({
  id,
  label: d.label ?? null,
  isDefault: d.isDefault === true,
  cep: d.cep,
  street: d.street,
  number: d.number,
  complement: d.complement ?? null,
  neighborhood: d.neighborhood,
  city: d.city,
  state: d.state,
});

/** The default address first, then the others in the order they were added. */
export async function listAddresses(uid: string): Promise<SavedAddress[]> {
  const snap = await addressesRef(uid).orderBy("createdAt").get();
  const all = snap.docs.map((d) => toSavedAddress(d.id, d.data()));
  return [...all.filter((a) => a.isDefault), ...all.filter((a) => !a.isDefault)];
}

/** Adds (id = null) or edits an address. The first address, or one marked default, becomes the only default. */
export async function saveAddress(uid: string, id: string | null, input: SavedAddressInput, now = new Date()): Promise<string> {
  return db().runTransaction(async (tx) => {
    const existing = await tx.get(addressesRef(uid));
    if (id !== null && !existing.docs.some((d) => d.id === id)) throw new Error(`customers/${uid}/addresses/${id} does not exist`);
    if (id === null && existing.size >= MAX_ADDRESSES) throw new AddressLimitError(`at most ${MAX_ADDRESSES} addresses`);
    const others = existing.docs.filter((d) => d.id !== id);
    const makeDefault = input.isDefault || others.length === 0;
    const ts = Timestamp.fromDate(now);
    const ref = id === null ? addressesRef(uid).doc() : addressesRef(uid).doc(id);
    const { isDefault: _ignored, ...fields } = input;
    if (makeDefault) for (const d of others) if (d.get("isDefault") === true) tx.update(d.ref, { isDefault: false, updatedAt: ts });
    if (id === null) tx.create(ref, { ...fields, isDefault: makeDefault, createdAt: ts, updatedAt: ts });
    else tx.update(ref, { ...fields, isDefault: makeDefault || existing.docs.find((d) => d.id === id)!.get("isDefault") === true, updatedAt: ts });
    return ref.id;
  });
}

/** Deletes an address; if it was the default, the oldest remaining one becomes the default. */
export async function deleteAddress(uid: string, id: string, now = new Date()): Promise<void> {
  await db().runTransaction(async (tx) => {
    const existing = await tx.get(addressesRef(uid).orderBy("createdAt"));
    const target = existing.docs.find((d) => d.id === id);
    if (!target) return; // already gone (double click): nothing to do
    tx.delete(target.ref);
    const rest = existing.docs.filter((d) => d.id !== id);
    if (target.get("isDefault") === true && rest.length > 0) tx.update(rest[0]!.ref, { isDefault: true, updatedAt: Timestamp.fromDate(now) });
  });
}

// --- orders ------------------------------------------------------------------------------------

export interface AccountOrderSummary {
  number: number;
  createdAt: string;
  status: OrderStatus;
  method: ShippingMethodId;
  totalCents: Cents;
  itemCount: number;
}

const ORDER_QUERY_LIMIT = 200;

export { ownsOrder };

/** The customer's orders, newest first. Single-field equality queries: no composite index needed. */
export async function listCustomerOrders(user: CustomerUser): Promise<AccountOrderSummary[]> {
  const orders = db().collection("orders");
  const [byUid, byEmail] = await Promise.all([
    orders.where("customer.uid", "==", user.uid).limit(ORDER_QUERY_LIMIT).get(),
    user.emailVerified ? orders.where("customer.email", "==", user.email).limit(ORDER_QUERY_LIMIT).get() : null,
  ]);
  const found = new Map<number, DocumentData>();
  for (const doc of [...byUid.docs, ...(byEmail?.docs ?? [])]) {
    const d = doc.data();
    if (ownsOrder(user, d)) found.set(d.number as number, d);
  }
  return [...found.values()]
    .sort((a, b) => b.number - a.number)
    .map((d) => ({
      number: d.number,
      createdAt: iso(d.createdAt),
      status: d.status,
      method: d.shipping.method,
      totalCents: d.totals.totalCents,
      itemCount: (d.lines as { quantity: number }[]).reduce((sum, l) => sum + l.quantity, 0),
    }));
}

/** One of the customer's orders, or null (not theirs or doesn't exist — indistinguishable on purpose). */
export async function getCustomerOrder(user: CustomerUser, number: number): Promise<CustomerOrderView | null> {
  if (!Number.isInteger(number) || number < 1) return null;
  const d = (await db().collection("orders").doc(String(number)).get()).data();
  return d && ownsOrder(user, d) ? toCustomerView(d) : null;
}

// --- wishlist ------------------------------------------------------------------------------------

const validIds = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, MAX_WISHLIST) : [];

export async function getWishlist(uid: string): Promise<string[]> {
  return validIds((await wishlistRef(uid).get()).get("productIds"));
}

/** Replaces the saved wishlist (the browser merges before saving). Returns what was stored. */
export async function setWishlist(uid: string, ids: unknown, now = new Date()): Promise<string[]> {
  const productIds = validIds(ids);
  await wishlistRef(uid).set({ productIds, updatedAt: Timestamp.fromDate(now) });
  return productIds;
}

// --- LGPD: export and deletion ---------------------------------------------------------------------

/** Everything the store keeps about the account (LGPD art. 18, II and V), as one JSON document. */
export async function exportCustomerData(user: CustomerUser, now = new Date()): Promise<Record<string, unknown>> {
  const [profileSnap, addresses, wishlist, orderList, reviews] = await Promise.all([
    customerRef(user.uid).get(),
    listAddresses(user.uid),
    getWishlist(user.uid),
    listCustomerOrders(user),
    customerReviews(user.uid),
  ]);
  const p = profileSnap.data();
  const orders = await Promise.all(
    orderList.map(async (o) => {
      const d = (await db().collection("orders").doc(String(o.number)).get()).data()!;
      return { ...toCustomerView(d), cpf: d.customer.cpf ?? null };
    }),
  );
  await writeAudit({ action: "customer.data_exported", actor: { type: "customer", name: user.uid }, target: `customers/${user.uid}`, details: { orders: orders.length } }, now);
  return {
    exportedAt: now.toISOString(),
    account: { uid: user.uid, email: user.email, emailVerified: user.emailVerified },
    profile: p
      ? {
          name: p.name,
          phone: p.phone,
          cpf: p.cpf,
          marketingEmail: p.marketingEmail === true,
          createdAt: iso(p.createdAt),
          consents: {
            termsAcceptedAt: p.consents?.termsAcceptedAt ? iso(p.consents.termsAcceptedAt) : null,
            marketingEmail: p.consents?.marketingEmail ? { granted: p.consents.marketingEmail.granted, at: iso(p.consents.marketingEmail.at), source: p.consents.marketingEmail.source } : null,
          },
        }
      : null,
    addresses,
    wishlist,
    orders,
    reviews: reviews.map((r) => ({
      productId: r.productId,
      rating: r.rating,
      title: r.title ?? null,
      text: r.text,
      displayName: r.displayName,
      videoUrl: r.videoUrl ?? null,
      status: r.status,
      createdAt: iso(r.createdAt),
    })),
  };
}

/**
 * Deletes the account (LGPD art. 18, VI): reviews, profile, consents, addresses and wishlist, then the sign-in itself. Orders
 * stay, as the law requires (fiscal and consumer records), and so does the audit entry, which holds only the UID.
 */
export async function deleteCustomerAccount(user: CustomerUser, now = new Date()): Promise<{ ordersKept: number }> {
  const orders = await listCustomerOrders(user);
  await deleteCustomerReviews(user.uid, now); // approved ones leave the product's stats too
  const addresses = await addressesRef(user.uid).get();
  const batch = db().batch();
  for (const doc of addresses.docs) batch.delete(doc.ref);
  batch.delete(customerRef(user.uid));
  batch.delete(wishlistRef(user.uid));
  await batch.commit();
  try {
    await adminAuth().deleteUser(user.uid);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "auth/user-not-found") throw error;
  }
  await writeAudit(
    { action: "customer.account_deleted", actor: { type: "customer", name: user.uid }, target: `customers/${user.uid}`, details: { ordersKept: orders.length, requestId: randomUUID() } },
    now,
  );
  return { ordersKept: orders.length };
}
