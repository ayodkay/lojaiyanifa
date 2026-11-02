// Seeds the EMULATORS for local development: store settings in Firestore and
// three sign-in accounts in Auth. Refuses to run against anything but the
// emulators of a demo- project.
//
// Settings come from .env.local when set (STORE_PIX_KEY, STORE_PIX_NAME,
// STORE_PIX_CITY, STORE_FLAT_RATE_CENTS); otherwise test-safe defaults:
// the Pix key is Banco Central's documentation example, so a QR code made
// with it can't pay anyone. Production settings are entered in the admin.
//
// Run through the emulators: npm run dev:emulated (seeds, then starts the dev server).
import { existsSync } from "node:fs";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { setRole } from "../admin/roles.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-lojaiyanifa";
if (!host || !authHost) {
  console.error("[seed] FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must be set: this script only writes to the emulators.");
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

const app = initializeApp({ projectId });
const db = getFirestore(app);
await db.doc("settings/payment").set(payment);
await db.doc("settings/shipping").set(shipping);

const pixSource = payment.pix.key === TEST_PIX_KEY ? "Banco Central test key" : "STORE_PIX_KEY";
const rateSource = process.env.STORE_FLAT_RATE_CENTS ? "STORE_FLAT_RATE_CENTS" : "PLACEHOLDER until the owner sets the price";
console.log(`[seed] ${host}: settings/payment (Pix: ${pixSource}), settings/shipping (flat rate R$ ${(shipping.flatRate.priceCents / 100).toFixed(2)} — ${rateSource}; pickup on)`);

// Sign-in accounts for /admin/login. They exist only in this emulator.
const DEV_PASSWORD = "senha-dev-123";
const DEV_USERS = [
  { email: "dono@example.com", displayName: "Dona (dev)", role: "owner" },
  { email: "equipe@example.com", displayName: "Equipe (dev)", role: "staff" },
  { email: "cliente@example.com", displayName: "Cliente (dev)", role: "none" },
];
const auth = getAuth(app);
for (const { email, displayName, role } of DEV_USERS) {
  const fields = { email, displayName, password: DEV_PASSWORD, emailVerified: true };
  const existing = await auth.getUserByEmail(email).catch((error) => {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  });
  if (existing) await auth.updateUser(existing.uid, fields);
  else await auth.createUser(fields);
  await setRole(auth, db, { email, role, by: "seed-emulator" });
}
console.log(`[seed] ${authHost}: ${DEV_USERS.map((u) => `${u.email} (${u.role})`).join(", ")} — password "${DEV_PASSWORD}"`);
