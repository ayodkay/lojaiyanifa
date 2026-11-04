// /admin/settings on the server (docs/architecture.md §3–§5): what the page shows, saving the Pix and delivery
// settings, and opening or closing checkout. Owner decision 2026-11-03: saving settings never opens checkout; the
// owner opens it explicitly (settings/store.checkoutOpen), and only while both settings are valid.
// Each write checks, inside ONE transaction with every read before any write, that the document is still the
// version the page showed (another tab or person may have saved meanwhile), then writes it and its audit entry.
// A save that changes nothing writes nothing. Callers must have passed the admin gate and checked
// "settings.view" (reads) or "settings.edit" (writes).
import { type DocumentReference, type DocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import type { z } from "zod";

import { TEST_AMOUNT_CENTS, TEST_TXID } from "~/lib/admin/settings";
import {
  PIX_CITY_MAX,
  PIX_NAME_MAX,
  type PaymentSettings,
  paymentSettingsSchema,
  type ShippingSettings,
  shippingSettingsSchema,
  type StoreSettings,
  storeSettingsSchema,
} from "~/lib/store-settings";

import { writeAuditInTransaction } from "./audit";
import { db } from "./firebase";
import { brCodeText, buildPixPayment, PixConfigError, pixQrSvg } from "./pix";
import type { AdminUser } from "./session";
import { settingsIssues } from "./settings";
import { maskPixKey, PIX_KEY_TYPE_LABEL } from "./settings-forms";

/** The settings document changed after the page was loaded: nothing was written; the page must reload. */
export class SettingsChangedError extends Error {
  override name = "SettingsChangedError";
}

/** Checkout can't open, or the change would leave an open checkout with no way to deliver: what to fix, in Portuguese. */
export class CheckoutStateError extends Error {
  override name = "CheckoutStateError";
  constructor(readonly reasons: string[]) {
    super(reasons.join(" "));
  }
}

type SettingsId = "store" | "payment" | "shipping";
const settingsRef = (id: SettingsId): DocumentReference => db().collection("settings").doc(id);

/** For the stale-page check: the document's last update time, or "none" while it doesn't exist. */
export function versionOf(snap: DocumentSnapshot): string {
  const time = snap.exists ? snap.updateTime : undefined;
  return time ? `${time.seconds}.${String(time.nanoseconds).padStart(9, "0")}` : "none";
}

const dataOf = (snap: DocumentSnapshot): unknown => (snap.exists ? snap.data() : undefined);

function storeOf(snap: DocumentSnapshot): StoreSettings {
  const parsed = storeSettingsSchema.safeParse(snap.exists ? snap.data() : {});
  if (!parsed.success) throw new Error(`settings/store is invalid: ${settingsIssues(parsed.error)}`);
  return parsed.data;
}

/** What keeps checkout from opening with these stored documents (undefined = absent); empty when it can open. */
export function checkoutBlockers(payment: unknown, shipping: unknown): string[] {
  const blockers: string[] = [];
  if (payment === undefined) {
    blockers.push("Falta salvar o pagamento Pix.");
  } else {
    const parsed = paymentSettingsSchema.safeParse(payment);
    if (!parsed.success) {
      blockers.push("O pagamento Pix salvo está incompleto ou inválido.");
    } else {
      try {
        buildPixPayment(parsed.data.pix, TEST_AMOUNT_CENTS, TEST_TXID); // the same checks every order's code goes through
      } catch (error) {
        if (!(error instanceof PixConfigError)) throw error;
        blockers.push(`Pagamento Pix: ${error.message}`);
      }
    }
  }
  if (shipping === undefined) {
    blockers.push("Falta salvar as formas de entrega.");
  } else {
    const parsed = shippingSettingsSchema.safeParse(shipping);
    if (!parsed.success) blockers.push("As formas de entrega salvas estão incompletas ou inválidas.");
    else if (!parsed.data.flatRate.enabled && !parsed.data.pickup.enabled) blockers.push("Ative ao menos uma forma de entrega.");
  }
  return blockers;
}

// --- reading, for the page --------------------------------------------------------------------

export interface SettingsDoc<T> {
  /** null: not saved yet, or the stored document is invalid (then `problem` says why). */
  values: T | null;
  problem: string | null;
  version: string;
}

export interface AdminSettingsView {
  checkout: { open: boolean; version: string; blockers: string[] };
  payment: SettingsDoc<PaymentSettings> & {
    /** "chave aleatória", "CPF"… */
    keyType: string | null;
    /** The receiver's name and city as the code carries them. */
    printed: { name: string; city: string } | null;
    /** R$ 1,00 to the stored key, to read in the bank app without paying: QR code (data URL) and "copia e cola". */
    test: { brCode: string; qr: string } | null;
  };
  shipping: SettingsDoc<ShippingSettings>;
}

function readDoc<T>(snap: DocumentSnapshot, schema: z.ZodType<T>, invalid: (issues: string) => string): SettingsDoc<T> {
  const version = versionOf(snap);
  if (!snap.exists) return { values: null, problem: null, version };
  const parsed = schema.safeParse(snap.data());
  return parsed.success ? { values: parsed.data, problem: null, version } : { values: null, problem: invalid(settingsIssues(parsed.error)), version };
}

async function getAll(...ids: SettingsId[]): Promise<DocumentSnapshot[]> {
  const snaps = await db().getAll(...ids.map(settingsRef));
  if (snaps.length !== ids.length) throw new Error(`getAll returned ${snaps.length} documents for ${ids.length}`);
  return snaps;
}

export async function getAdminSettings(): Promise<AdminSettingsView> {
  const [store, payment, shipping] = (await getAll("store", "payment", "shipping")) as [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot];
  const paymentDoc = readDoc(
    payment,
    paymentSettingsSchema,
    (issues) => `O pagamento salvo está incompleto ou inválido (${issues}). Preencha e salve de novo.`,
  );
  let extra: Pick<AdminSettingsView["payment"], "keyType" | "printed" | "test"> = { keyType: null, printed: null, test: null };
  if (paymentDoc.values) {
    const { pix } = paymentDoc.values;
    try {
      const code = buildPixPayment(pix, TEST_AMOUNT_CENTS, TEST_TXID);
      const svg = await pixQrSvg(code.brCode);
      extra = {
        keyType: PIX_KEY_TYPE_LABEL[code.keyType],
        printed: { name: brCodeText(pix.merchantName, PIX_NAME_MAX), city: brCodeText(pix.merchantCity, PIX_CITY_MAX) },
        test: { brCode: code.brCode, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` },
      };
    } catch (error) {
      if (!(error instanceof PixConfigError)) throw error;
      paymentDoc.problem = error.message;
    }
  }
  return {
    checkout: { open: storeOf(store).checkoutOpen, version: versionOf(store), blockers: checkoutBlockers(dataOf(payment), dataOf(shipping)) },
    payment: { ...paymentDoc, ...extra },
    shipping: readDoc(
      shipping,
      shippingSettingsSchema,
      (issues) => `As formas de entrega salvas estão incompletas ou inválidas (${issues}). Preencha e salve de novo.`,
    ),
  };
}

// --- writing ------------------------------------------------------------------------------------

export interface SaveResult {
  /** false: the stored document already said this, so nothing was written. */
  changed: boolean;
}

interface Change {
  field: string;
  before: unknown;
  after: unknown;
}

interface FieldSpec<T> {
  field: string;
  get: (settings: T) => unknown;
  /** What the audit log shows, when not the value itself. */
  show?: (settings: T) => unknown;
}

/** Every stored field, as the audit log names it. Keep in step with ~/lib/store-settings (a unit test checks). */
export const PAYMENT_FIELDS: readonly FieldSpec<PaymentSettings>[] = [
  { field: "pix.key", get: (s) => s.pix.key, show: (s) => maskPixKey(s.pix.key) },
  { field: "pix.merchantName", get: (s) => s.pix.merchantName },
  { field: "pix.merchantCity", get: (s) => s.pix.merchantCity },
  { field: "expiryHours", get: (s) => s.expiryHours },
];

export const SHIPPING_FIELDS: readonly FieldSpec<ShippingSettings>[] = [
  { field: "handlingDays", get: (s) => s.handlingDays },
  { field: "flatRate.enabled", get: (s) => s.flatRate.enabled },
  { field: "flatRate.label", get: (s) => s.flatRate.label },
  { field: "flatRate.priceCents", get: (s) => s.flatRate.priceCents },
  { field: "flatRate.transitDays", get: (s) => s.flatRate.transitDays },
  { field: "pickup.enabled", get: (s) => s.pickup.enabled },
  { field: "pickup.label", get: (s) => s.pickup.label },
  { field: "pickup.address", get: (s) => s.pickup.address },
  { field: "pickup.instructions", get: (s) => s.pickup.instructions },
];

/** The fields that differ (all of them when nothing valid was stored before), compared by value, shown masked. */
export function changesOf<T>(fields: readonly FieldSpec<T>[], before: T | null, after: T): Change[] {
  return fields.flatMap(({ field, get, show = get }) =>
    before !== null && JSON.stringify(get(before)) === JSON.stringify(get(after))
      ? []
      : [{ field, before: before === null ? null : show(before), after: show(after) }],
  );
}

/**
 * Runs a settings transaction. A transaction that lost a race doesn't always say so (the emulator closes it:
 * "3 INVALID_ARGUMENT: Transaction is invalid or closed"); if the document moved on meanwhile, that is the answer.
 */
async function guarded<T>(ref: DocumentReference, version: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SettingsChangedError || error instanceof CheckoutStateError) throw error;
    if (versionOf(await ref.get()) !== version) throw new SettingsChangedError(`${ref.path} changed meanwhile`);
    throw error;
  }
}

function assertVersion(snap: DocumentSnapshot, version: string): void {
  if (versionOf(snap) !== version) throw new SettingsChangedError(`${snap.ref.path} changed after the page was loaded`);
}

const stamp = (actor: AdminUser, now: Date) => ({ updatedAt: Timestamp.fromDate(now), updatedBy: { uid: actor.uid, email: actor.email } });

export function savePaymentSettings(value: PaymentSettings, version: string, actor: AdminUser, now = new Date()): Promise<SaveResult> {
  const ref = settingsRef("payment");
  return guarded(ref, version, () =>
    db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      assertVersion(snap, version);
      const before = snap.exists ? paymentSettingsSchema.safeParse(snap.data()) : null;
      const changes = changesOf(PAYMENT_FIELDS, before?.success ? before.data : null, value);
      if (changes.length === 0) return { changed: false };
      tx.set(ref, { ...value, ...stamp(actor, now) });
      writeAuditInTransaction(tx, { action: "settings.payment_updated", actor, target: "settings/payment", details: { changes } }, now);
      return { changed: true };
    }),
  );
}

export function saveShippingSettings(value: ShippingSettings, version: string, actor: AdminUser, now = new Date()): Promise<SaveResult> {
  const ref = settingsRef("shipping");
  return guarded(ref, version, () =>
    db().runTransaction(async (tx) => {
      const [snap, store] = (await tx.getAll(ref, settingsRef("store"))) as [DocumentSnapshot, DocumentSnapshot];
      assertVersion(snap, version);
      if (storeOf(store).checkoutOpen && !value.flatRate.enabled && !value.pickup.enabled) {
        throw new CheckoutStateError(["Com o checkout aberto, deixe ao menos uma forma de entrega ativa (ou feche o checkout antes)."]);
      }
      const before = snap.exists ? shippingSettingsSchema.safeParse(snap.data()) : null;
      const changes = changesOf(SHIPPING_FIELDS, before?.success ? before.data : null, value);
      if (changes.length === 0) return { changed: false };
      tx.set(ref, { ...value, ...stamp(actor, now) });
      writeAuditInTransaction(tx, { action: "settings.shipping_updated", actor, target: "settings/shipping", details: { changes } }, now);
      return { changed: true };
    }),
  );
}

export function setCheckoutOpen(open: boolean, version: string, actor: AdminUser, now = new Date()): Promise<SaveResult> {
  const ref = settingsRef("store");
  return guarded(ref, version, () =>
    db().runTransaction(async (tx) => {
      const [store, payment, shipping] = (await tx.getAll(ref, settingsRef("payment"), settingsRef("shipping"))) as [
        DocumentSnapshot,
        DocumentSnapshot,
        DocumentSnapshot,
      ];
      assertVersion(store, version);
      if (storeOf(store).checkoutOpen === open) return { changed: false };
      if (open) {
        const blockers = checkoutBlockers(dataOf(payment), dataOf(shipping));
        if (blockers.length > 0) throw new CheckoutStateError(blockers);
      }
      tx.set(ref, { checkoutOpen: open, ...stamp(actor, now) });
      writeAuditInTransaction(tx, { action: open ? "settings.checkout_opened" : "settings.checkout_closed", actor, target: "settings/store" }, now);
      return { changed: true };
    }),
  );
}
