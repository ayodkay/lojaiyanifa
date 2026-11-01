// Pushes customtypes/<id>/index.json to Prismic through the Custom Types API.
//
// Safety: by default only ADDITIVE changes are allowed. If any field that exists
// in Prismic would be removed or changed, the script stops and lists them,
// because removing a field deletes its content from every document.
//
//   node scripts/prismic/push-models.mjs            dry run: show what would change
//   node scripts/prismic/push-models.mjs --apply    push, then re-read and verify
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { api, canonical, fieldMap } from "./lib.mjs";

const apply = process.argv.includes("--apply");

const local = readdirSync("customtypes", { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => JSON.parse(readFileSync(join("customtypes", d.name, "index.json"), "utf8")));
const remote = new Map((await api("/customtypes")).map((t) => [t.id, t]));

const plan = [];
let blocked = false;

for (const type of local) {
  const current = remote.get(type.id);
  if (!current) {
    plan.push({ type, action: "insert", added: [...fieldMap(type).keys()] });
    continue;
  }
  if (canonical(current) === canonical(type)) continue;

  const before = fieldMap(current);
  const after = fieldMap(type);
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...before.keys()].filter((k) => after.has(k) && canonical(before.get(k)) !== canonical(after.get(k)));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const metaChanged = ["label", "repeatable", "status", "format"].filter((k) => current[k] !== type[k]);

  if (removed.length || changed.length || metaChanged.length) {
    blocked = true;
    console.log(`\n✗ ${type.id}: non-additive change refused`);
    for (const k of removed) console.log(`    removed: ${k}`);
    for (const k of changed) console.log(`    changed: ${k}`);
    for (const k of metaChanged) console.log(`    changed type property: ${k} (${current[k]} → ${type[k]})`);
    continue;
  }
  plan.push({ type, action: "update", added });
}

if (plan.length === 0 && !blocked) {
  console.log("Prismic models are already up to date.");
  process.exit(0);
}

for (const { type, action, added } of plan) {
  console.log(`\n${action === "insert" ? "+ new type" : "~ update"} ${type.id} (${type.label}) — ${added.length} field(s) added:`);
  for (const k of added) console.log(`    + ${k}`);
}

if (blocked) {
  console.log("\nNothing pushed: fix the refused changes above first.");
  process.exit(1);
}
if (!apply) {
  console.log("\nDry run: nothing was pushed. Re-run with --apply.");
  process.exit(0);
}

for (const { type, action } of plan) {
  await api(`/customtypes/${action}`, { method: "POST", body: JSON.stringify(type) });
  console.log(`pushed ${type.id}`);
}

// Verify: what Prismic now stores must equal the local files.
const after = new Map((await api("/customtypes")).map((t) => [t.id, t]));
let mismatches = 0;
for (const { type } of plan) {
  if (canonical(after.get(type.id)) !== canonical(type)) {
    mismatches++;
    console.log(`✗ verify ${type.id}: Prismic's copy differs from customtypes/${type.id}/index.json`);
  } else {
    console.log(`✓ verify ${type.id}`);
  }
}
process.exit(mismatches ? 1 : 0);
