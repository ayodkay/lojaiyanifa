// Repairs product names that Prismic stored with U+FFFD (the Unicode
// replacement character) because the first version of add-product.sh sent
// accented characters in the Windows legacy code page instead of UTF-8.
// The correct spellings are read from scripts/prismic/add-product.sh.
//
// Dry run (default) — prints the planned changes, writes nothing:
//   node scripts/prismic/fix-product-names.mjs
// Apply — sends the updates through the Migration API. They land in a
// Migration Release that must be reviewed and published in Prismic:
//   node scripts/prismic/fix-product-names.mjs --apply

import { existsSync, readFileSync } from "node:fs";
import * as prismic from "@prismicio/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const repo = process.env.PRISMIC_REPO;
const writeToken = process.env.PRISMIC_WRITE_TOKEN;
const accessToken = process.env.PRISMIC_ACCESS_TOKEN || undefined;
const type = process.env.PRISMIC_TYPE || "products";
const apply = process.argv.includes("--apply");
const REPLACEMENT = "�";

if (!repo || !writeToken) {
  console.error("Set PRISMIC_REPO and PRISMIC_WRITE_TOKEN first (in .env.local).");
  process.exit(1);
}

// "uid|name|short description" rows, exactly as the owner wrote them.
const source = readFileSync(new URL("./add-product.sh", import.meta.url), "utf8");
const expected = new Map();
for (const match of source.matchAll(/^\s*"([a-z0-9-]+)\|([^|"]+)\|[^"]*"\s*$/gm)) {
  expected.set(match[1], match[2]);
}
if (expected.size !== 28) {
  console.error(`Expected 28 product rows in add-product.sh, parsed ${expected.size}. Aborting.`);
  process.exit(1);
}

// The damaged name must equal the correct one at every position except where
// a non-ASCII character became U+FFFD. Anything else means an editor changed
// the name since, and we must not overwrite their edit.
function linesUp(damaged, correct) {
  const a = [...damaged];
  const b = [...correct];
  if (a.length !== b.length) return false;
  return a.every((ch, i) => ch === b[i] || (ch === REPLACEMENT && b[i].codePointAt(0) > 127));
}

const client = prismic.createWriteClient(repo, { writeToken, accessToken });

try {
  const docs = await client.getAllByType(type, { lang: "*" });
  const plan = [];
  const skipped = [];

  for (const doc of docs) {
    const current = doc.data.product_name ?? "";
    if (!current.includes(REPLACEMENT)) continue;
    const correct = expected.get(doc.uid);
    if (!correct) {
      skipped.push(`${doc.uid}: damaged, but add-product.sh has no row for it`);
    } else if (!linesUp(current, correct)) {
      skipped.push(`${doc.uid}: "${current}" does not line up with "${correct}"`);
    } else {
      plan.push({ doc, current, correct });
    }
  }

  console.log(`Scanned ${docs.length} published "${type}" documents.`);
  console.log(`${plan.length} name(s) to repair:`);
  for (const { doc, current, correct } of plan) {
    console.log(`  ${doc.uid.padEnd(20)} "${current}" -> "${correct}"`);
  }
  if (skipped.length) {
    console.log(`${skipped.length} skipped (needs a human):`);
    for (const line of skipped) console.log(`  ${line}`);
  }

  if (plan.length === 0) process.exit(0);
  if (!apply) {
    console.log("\nDry run: nothing was written. Re-run with --apply to send these to a Migration Release.");
    process.exit(0);
  }

  const migration = prismic.createMigration();
  for (const { doc, correct } of plan) {
    // Full document sent back with only product_name changed; the second
    // argument is the title shown in the Prismic editor.
    migration.updateDocument({ ...doc, data: { ...doc.data, product_name: correct } }, correct);
  }

  await client.migrate(migration, {
    reporter: (event) => {
      if (event.type === "documents:updating") {
        const { current, total, document } = event.data;
        console.log(`updating ${current}/${total}  ${document.document.uid}`);
      }
    },
  });

  console.log(`\nDone: ${plan.length} name(s) sent. Review and publish them in Prismic under Migration Releases.`);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  if (error.response) console.error(JSON.stringify(error.response, null, 2));
  process.exit(1);
}
