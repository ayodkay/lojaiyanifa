// Applies docs/checklist-status.json to the canonical checklist in
// ecommerce_master_build_prompt.md. Section-aware (item names repeat across
// sections) and idempotent. Statuses:
//   done → "- [x] Item — note"
//   todo → "- [ ] Item — note"   (partial / blocked: the note says what's missing)
//   na   → "- [ ] Item — **N/A**: note"
//   node scripts/checklist-update.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "ecommerce_master_build_prompt.md";
const status = JSON.parse(readFileSync("docs/checklist-status.json", "utf8"));
const lines = readFileSync(FILE, "utf8").split("\n");

let section = null;
const unmatched = new Set(Object.entries(status).flatMap(([s, items]) => Object.keys(items).map((i) => `${s}::${i}`)));
let changed = 0;

const out = lines.map((line) => {
  const heading = /^### (\d+)\./.exec(line);
  if (heading) {
    section = heading[1];
    return line;
  }
  const item = /^- \[( |x)\] (.+?)(?: — .*)?$/.exec(line);
  if (!item || !section) return line;
  const name = item[2].trim();
  const entry = status[section]?.[name];
  if (!entry) return line;
  unmatched.delete(`${section}::${name}`);
  const box = entry.status === "done" ? "x" : " ";
  const note = entry.status === "na" ? ` — **N/A**: ${entry.note}` : entry.note ? ` — ${entry.note}` : "";
  const next = `- [${box}] ${name}${note}`;
  if (next !== line) changed++;
  return next;
});

writeFileSync(FILE, out.join("\n"));
const counts = { done: 0, todo: 0, na: 0 };
for (const items of Object.values(status)) for (const e of Object.values(items)) counts[e.status]++;
console.log(`checklist: ${changed} line(s) changed | status file: ${counts.done} done, ${counts.todo} with notes, ${counts.na} N/A`);
if (unmatched.size) {
  console.error(`Unmatched entries (typo in docs/checklist-status.json?):\n  ${[...unmatched].join("\n  ")}`);
  process.exit(1);
}
