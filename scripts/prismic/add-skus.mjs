// Adds SKUs to Product documents that are already published in Prismic.
//
// Prismic's API can only read published documents, so publish the Migration
// Release that created the products before running this. The SKU changes land
// in a new Migration Release for you to review and publish.
//
// Usage (from the project root, Node 22+):
//   node scripts/prismic/add-skus.mjs
// Reads PRISMIC_REPO, PRISMIC_WRITE_TOKEN (and optional PRISMIC_ACCESS_TOKEN,
// PRISMIC_TYPE) from .env.local. Never hardcode the tokens in this file.

import { existsSync } from "node:fs";
import * as prismic from "@prismicio/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const repo = process.env.PRISMIC_REPO;
const writeToken = process.env.PRISMIC_WRITE_TOKEN;
const type = process.env.PRISMIC_TYPE || "products";
const accessToken = process.env.PRISMIC_ACCESS_TOKEN || undefined; // only needed if your Content API is private

if (!repo || !writeToken) {
  console.error("Set PRISMIC_REPO and PRISMIC_WRITE_TOKEN first (in .env.local).");
  process.exit(1);
}

// Product UID → SKU. Change any code to match your own system.
const SKUS = {
  // VES – clothing and cloths
  "conjunto-masculino": "VES-001",
  "conjunto-feminino": "VES-002",
  "pano-da-costa": "VES-003",
  "pano-de-cabeca": "VES-004",
  "alaka": "VES-005",
  "ekete": "VES-006",
  // DIV – divination (Ifá and búzios)
  "opon-ifa": "DIV-001",
  "ikin-ifa": "DIV-002",
  "buzios": "DIV-003",
  "opele": "DIV-004",
  "ifa-divination-mat": "DIV-005",
  "iroke-ifa": "DIV-006",
  "iyerosun-powder": "DIV-007",
  "ajere-ifa": "DIV-008",
  // INS – instruments
  "agogo-bell": "INS-001",
  "adjas": "INS-002",
  // BAN – baths, soaps and aromas
  "banho-de-ori": "BAN-001",
  "turari": "BAN-002",
  "ose-dudu": "BAN-003",
  "ose-dudu-ingredients": "BAN-004",
  // SEM – seeds and spices
  "ataare": "SEM-001",
  "aridan": "SEM-002",
  "obi": "SEM-003",
  "obi-abata": "SEM-004",
  "orogbo": "SEM-005",
  "bejerekun-seed": "SEM-006",
  "alibe-seed": "SEM-007",
  "pimenta-da-costa": "SEM-008",
};

const client = prismic.createWriteClient(repo, { writeToken, accessToken });
const migration = prismic.createMigration();

try {
  const docs = await client.getAllByType(type);
  if (docs.length === 0) {
    console.log(`No published "${type}" documents found. Publish the Migration Release first, or check PRISMIC_TYPE.`);
    process.exit(1);
  }

  // Each document is sent back in full with only the SKU changed, so prices,
  // images and anything else already filled in stay as they are.
  let queued = 0;
  for (const doc of docs) {
    const sku = SKUS[doc.uid];
    if (!sku || doc.data.sku === sku) continue;
    migration.updateDocument({ ...doc, data: { ...doc.data, sku } }, doc.data.product_name || doc.uid);
    queued++;
  }

  const found = new Set(docs.map((doc) => doc.uid));
  const missing = Object.keys(SKUS).filter((uid) => !found.has(uid));
  if (missing.length) {
    console.log(`Not published yet, skipped (${missing.length}): ${missing.join(", ")}`);
  }

  if (queued === 0) {
    console.log("Nothing to update: every published product already has its SKU.");
    process.exit(0);
  }

  await client.migrate(migration, {
    reporter: (event) => {
      if (event.type === "documents:updating") {
        const { current, total, document } = event.data;
        console.log(`updating ${current}/${total}  ${document.document.uid}`);
      }
    },
  });

  console.log(`Done: ${queued} product${queued === 1 ? "" : "s"} got a SKU. Review and publish under Migration Releases in Prismic.`);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  if (error.response) console.error(JSON.stringify(error.response, null, 2));
  process.exit(1);
}
