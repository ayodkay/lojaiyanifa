// Seeds the Firestore EMULATOR with store settings for local development.
// Refuses to run against anything but the emulator of a demo- project.
//
// Values come from .env.local when set (STORE_PIX_KEY, STORE_PIX_NAME,
// STORE_PIX_CITY, STORE_FLAT_RATE_CENTS); otherwise test-safe defaults:
// the Pix key is Banco Central's documentation example, so a QR code made
// with it can't pay anyone. Production settings are entered in the admin.
//
// Run through the emulators: npm run dev:emulated (seeds, then starts the dev server).
import { existsSync } from "node:fs";

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-lojaiyanifa";
if (!host) {
  console.error("[seed] FIRESTORE_EMULATOR_HOST is not set: this script only writes to the emulator.");
  process.exit(1);
}
if (!projectId.startsWith("demo-")) {
  console.error(`[seed] refusing: "${projectId}" is not a demo- project.`);
  process.exit(1);
}

const env = (name, fallback) => process.env[name]?.trim() || fallback;
const TEST_PIX_KEY = "123e4567-e12b-12d1-a456-426655440000";

const payment = {
  pix: {
    key: env("STORE_PIX_KEY", TEST_PIX_KEY),
    merchantName: env("STORE_PIX_NAME", "Loja Iyanifa"),
    merchantCity: env("STORE_PIX_CITY", "Rio de Janeiro"),
  },
  expiryHours: 24,
};

const shipping = {
  handlingDays: 1,
  flatRate: {
    enabled: true,
    label: "Entrega em todo o Brasil",
    priceCents: Number(env("STORE_FLAT_RATE_CENTS", "2500")),
    transitDays: null,
  },
  pickup: {
    enabled: true,
    label: "Retirar na loja",
    address: "Mercadão de Madureira – Anexo, Galeria K, Lojas 219-220, Madureira, Rio de Janeiro – RJ, CEP 21360-201",
    instructions: null,
  },
};

const db = getFirestore(initializeApp({ projectId }));
await db.doc("settings/payment").set(payment);
await db.doc("settings/shipping").set(shipping);

const pixSource = payment.pix.key === TEST_PIX_KEY ? "Banco Central test key" : "STORE_PIX_KEY";
const rateSource = process.env.STORE_FLAT_RATE_CENTS ? "STORE_FLAT_RATE_CENTS" : "PLACEHOLDER until the owner sets the price";
console.log(`[seed] ${host}: settings/payment (Pix: ${pixSource}), settings/shipping (flat rate R$ ${(shipping.flatRate.priceCents / 100).toFixed(2)} — ${rateSource}; pickup on)`);
