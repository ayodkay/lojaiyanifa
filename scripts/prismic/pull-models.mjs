// Downloads every custom type from Prismic into customtypes/<id>/index.json.
// Refuses to overwrite a local file that differs from the remote unless --force,
// so local edits that haven't been pushed are never lost.
//   node scripts/prismic/pull-models.mjs [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { api, canonical } from "./lib.mjs";

const force = process.argv.includes("--force");
const types = await api("/customtypes");

for (const type of types) {
  const dir = join("customtypes", type.id);
  const file = join(dir, "index.json");
  if (existsSync(file) && !force) {
    const local = JSON.parse(readFileSync(file, "utf8"));
    if (canonical(local) !== canonical(type)) {
      console.log(`SKIP ${type.id}: local file differs from Prismic (push it, or re-run with --force to discard local changes)`);
      continue;
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(type, null, 2)}\n`);
  console.log(`pulled ${type.id} (${type.label}${type.status ? "" : ", disabled"})`);
}
