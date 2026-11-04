// Live e-mail check: `npm run test:mail-live` (vitest.mail-live.config.ts; never part of the unit or integration runs).
// One fake order on the test emulator; its two e-mails (confirmation + store notice) go to MAIL_STORE_TO only, through
// the production path: createOrder queues them, runMailOutbox sends them with the SMTP settings in .env.local.
// Prints what happened (recipients shown by domain only); fails when the e-mails didn't go out.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { describe, expect, it } from "vitest";

/** Copies only the named keys from .env.local, and never over a value the test run already has. */
function pick(keys: string[]) {
  const vars = parseEnv(readFileSync(".env.local", "utf8"));
  for (const k of keys) if (vars[k] !== undefined && process.env[k] === undefined) process.env[k] = vars[k];
}

const mask = (to: string) => to.replace(/[^\s<@]+@/g, "…@");

describe("live e-mail through the configured SMTP relay", () => {
  it("sends one fake order's e-mails to the store inbox", async () => {
    // Never anything but the test emulator (firebase.test.json).
    expect(process.env.FIRESTORE_EMULATOR_HOST ?? "").toMatch(/:8280$/);
    expect(process.env.FIREBASE_PROJECT_ID ?? "").toMatch(/^demo-/);
    pick(["MAIL_FROM", "MAIL_REPLY_TO", "MAIL_STORE_TO", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "PRISMIC_ACCESS_TOKEN", "PRISMIC_LOCALE"]);
    const inbox = process.env.MAIL_STORE_TO ?? "";
    expect(inbox, "MAIL_STORE_TO in .env.local: the only address this check sends to").toContain("@");

    // Imported only now: env() caches the variables on its first call.
    const { createOrder } = await import("~/.server/orders");
    const { runMailOutbox } = await import("~/.server/mail/send");
    const { db } = await import("~/.server/firebase");
    const { MAIL_COLLECTION } = await import("~/.server/mail/outbox");
    const { shippingSettingsSchema } = await import("~/lib/store-settings");
    const { catalogOf, catalogProduct } = await import("../factories");
    const { clearFirestore } = await import("../integration/emulators");

    await clearFirestore();
    const deps = {
      catalog: catalogOf([catalogProduct("colar", { name: "Colar (produto de teste)", sku: "TESTE-1", priceCents: 12990, prismicStock: 50 })]),
      // A made-up Pix key: nobody can pay this test order.
      payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
      shipping: shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: true, address: "Mercadão de Madureira" } }),
    };
    await createOrder(
      {
        idempotencyKey: randomUUID(),
        name: "Teste Brevo",
        email: inbox,
        phone: "+5521987654321",
        cpf: "52998224725",
        shippingMethod: "flat_rate",
        address: { cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
        acceptTerms: true,
        couponCode: null,
        items: [{ productId: "colar", sku: "TESTE-1", quantity: 1 }],
      },
      deps,
    );

    const run = await runMailOutbox(process.env.SMTP_PASSWORD);
    const mails = (await db().collection(MAIL_COLLECTION).get()).docs.map((d) => d.data());
    console.log(
      JSON.stringify(
        {
          run: { sent: run.sent.length, retrying: run.retrying.length, failed: run.failed.length, expired: run.expired.length, waiting: run.waiting, blocked: run.blocked },
          mails: mails.map((m) => ({ template: m.template, to: mask(String(m.to)), status: m.status, subject: m.subject, messageId: m.messageId, lastError: m.lastError })),
        },
        null,
        2,
      ),
    );
    expect(run.blocked, "the SMTP relay refused the login or the connection").toBeNull();
    expect(run.waiting, "SMTP isn't configured in .env.local (MAIL_FROM, SMTP_USER, SMTP_PASSWORD)").toBe(0);
    expect(run.failed).toEqual([]);
    expect(run.sent).toHaveLength(mails.length);
  });
});
