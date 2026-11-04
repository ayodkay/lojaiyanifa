// Sends the store's texts kept in content/prismic/ — the content pages (legal pages and "about"), the FAQ and the
// policy summaries of the settings document — to Prismic through the Migration API.
//
// Nothing goes live: the Migration API puts every document in the repository's Migration Release, which the owner
// reviews and publishes in Prismic (Releases).
//
//   node scripts/prismic/seed-content.mjs                 dry run: checks every file against the models, prints the plan
//   node scripts/prismic/seed-content.mjs --apply         creates what's missing (and resumes an interrupted run)
//   node scripts/prismic/seed-content.mjs --apply --overwrite privacy,faq
//                                                         also replaces those existing documents with the repo's text
//   node scripts/prismic/seed-content.mjs --apply --adopt faq=<document id>
//                                                         fills an unpublished document someone already created (the
//                                                         Content API can't see drafts; a singleton type refuses a
//                                                         second document). Only for a draft checked to be empty:
//                                                         its content is replaced.
//
// Safety:
// - Two passes, like the Prismic client's own migrate(): documents are created empty first, then filled, because
//   their links point at each other. Every created ID is written to content/prismic/migration-ids.json at once, so
//   an interrupted run is resumed instead of creating duplicates.
// - A document that is published, or that a previous run completed, may have been edited in Prismic since: it is
//   only replaced when named in --overwrite (or --overwrite all).
// - The settings document holds the owner's company data and contact channels: it is created only when the
//   repository has none, and never changed afterwards.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as prismic from "@prismicio/client";

import { faqData, linkResolver, pageData, sectionsData } from "./content.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const repo = process.env.PRISMIC_REPO;
const writeToken = process.env.PRISMIC_WRITE_TOKEN;
const accessToken = process.env.PRISMIC_ACCESS_TOKEN || undefined;
const lang = process.env.PRISMIC_LOCALE || "pt-br";
if (!repo || !writeToken) {
  console.error("Set PRISMIC_REPO and PRISMIC_WRITE_TOKEN first (in .env.local).");
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const overwriteArg = args.includes("--overwrite") ? args[args.indexOf("--overwrite") + 1] ?? "" : "";
const overwrite = new Set(overwriteArg.split(",").map((s) => s.trim()).filter(Boolean));
const mayOverwrite = (key) => overwrite.has("all") || overwrite.has(key);
// --skip settings: leaves those documents out of this run (e.g. a settings document exists but is archived, which
// the Content API doesn't show and which still blocks creating another one).
const skip = new Set((args.includes("--skip") ? args[args.indexOf("--skip") + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean));
const adoptArg = args.includes("--adopt") ? args[args.indexOf("--adopt") + 1] ?? "" : "";
const adopt = new Map(
  adoptArg
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [key, id] = pair.split("=").map((s) => s.trim());
      if (!key || !id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error(`--adopt expects key=<document id>, got "${pair}"`);
      return [key, id];
    }),
);

const STATE_FILE = "content/prismic/migration-ids.json";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const models = { page: readJson("customtypes/page/index.json"), faq: readJson("customtypes/faq/index.json"), settings: readJson("customtypes/settings/index.json") };

// --- what the repo holds ----------------------------------------------------------------------------------------
const sources = [
  // The FAQ first: most of the store-path links (/contact) are in it.
  { key: "faq", type: "faq", uid: null, file: "content/prismic/faq.md", build: faqData },
  ...readdirSync("content/prismic/pages")
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ key: f.replace(/\.md$/, ""), type: "page", uid: f.replace(/\.md$/, ""), file: `content/prismic/pages/${f}`, build: pageData })),
  { key: "settings", type: "settings", uid: null, file: "content/prismic/settings.md", build: sectionsData },
];

const state = existsSync(STATE_FILE) ? readJson(STATE_FILE) : {};
const saveState = () => writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
for (const [key, id] of adopt) {
  if (!sources.some((s) => s.key === key)) throw new Error(`--adopt: no content file for "${key}"`);
  if (state[key] && state[key].id !== id) throw new Error(`--adopt: ${key} is already recorded as ${state[key].id}`);
  // Recorded as an unfinished document of ours: the run below fills it ("resume"). Saved only with --apply.
  state[key] = { id, type: sources.find((s) => s.key === key).type, complete: false, adopted: true };
}

const client = prismic.createWriteClient(repo, { writeToken, accessToken });

try {
  // --- what Prismic holds (published) ------------------------------------------------------------------------
  const published = new Map();
  for (const doc of await client.getAllByType("page", { lang })) published.set(doc.uid, doc);
  for (const type of ["faq", "settings"]) {
    try {
      published.set(type, await client.getSingle(type, { lang }));
    } catch (error) {
      if (!(error instanceof prismic.NotFoundError)) throw error;
    }
  }

  // --- plan --------------------------------------------------------------------------------------------------
  const plan = sources.map((source) => {
    const live = published.get(source.key);
    const saved = state[source.key];
    if (skip.has(source.key)) return { ...source, action: "skip", why: "left out with --skip" };
    if (source.type === "settings" && (live || saved?.complete)) {
      return { ...source, action: "skip", why: "the owner's settings document exists; it is never changed by this script" };
    }
    if (saved && !saved.complete) {
      return { ...source, id: saved.id, action: "resume", why: saved.adopted ? "existing empty draft, adopted with --adopt" : "created by an interrupted run" };
    }
    const existingId = live?.id ?? saved?.id;
    if (existingId) {
      return mayOverwrite(source.key)
        ? { ...source, id: existingId, action: "overwrite", why: live ? "published; replaced with the repo's text" : "in the Migration Release; replaced" }
        : { ...source, id: existingId, action: "skip", why: `${live ? "published" : "already sent"}; may have been edited in Prismic (pass --overwrite ${source.key})` };
    }
    return { ...source, action: "create", why: "missing" };
  });

  // Every document a link may point to: those this run sends, plus those already in Prismic.
  const linkTargets = (resolveId) =>
    new Map(sources.filter((s) => s.type !== "settings").map((s) => [s.key, resolveId(s)]).filter(([, id]) => id));
  const knownId = (s) => plan.find((p) => p.key === s.key)?.id ?? published.get(s.key)?.id ?? state[s.key]?.id ?? `(new ${s.key})`;

  // Build everything before writing anything: a content error stops the run with nothing sent.
  const dryResolve = linkResolver(linkTargets(knownId));
  for (const item of plan) item.data = item.build(readFileSync(item.file, "utf8"), models[item.type], dryResolve);

  const title = (item) => (item.type === "settings" ? "Configurações da loja" : item.data.title);
  console.log(`Repository ${repo} (${lang}). Plan:`);
  for (const item of plan) {
    const size = item.type === "faq" ? `${item.data.items.length} questions` : item.type === "page" ? `${item.data.body.length} blocks` : `${Object.keys(item.data).length} fields`;
    console.log(`  ${item.action.padEnd(9)} ${item.key.padEnd(9)} ${String(title(item)).slice(0, 44).padEnd(44)} ${size.padEnd(12)} ${item.why}`);
  }
  const work = plan.filter((p) => p.action !== "skip");
  if (work.length === 0) {
    console.log("\nNothing to send.");
    process.exit(0);
  }
  if (!apply) {
    console.log("\nDry run: nothing was sent. Re-run with --apply to send this to the Migration Release.");
    process.exit(0);
  }

  // --- pass 1: create missing documents (empty), recording each ID at once ------------------------------------
  for (const item of work.filter((p) => p.action === "create")) {
    const { id } = await client.createDocument({ type: item.type, uid: item.uid ?? undefined, lang, data: {} }, title(item));
    item.id = id;
    state[item.key] = { id, type: item.type, complete: false };
    saveState();
    console.log(`created   ${item.key} → ${id}`);
  }

  // --- pass 2: fill every document, links resolved to real IDs ------------------------------------------------
  const resolve = linkResolver(linkTargets(knownId));
  for (const item of work) {
    const data = item.build(readFileSync(item.file, "utf8"), models[item.type], resolve);
    await client.updateDocument(item.id, { documentTitle: title(item), uid: item.uid ?? undefined, data });
    state[item.key] = { id: item.id, type: item.type, complete: true };
    saveState();
    console.log(`filled    ${item.key}`);
  }

  console.log(`\nDone: ${work.length} document(s) sent. Review and publish them in Prismic → Releases → Migration Release.`);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  if (error.response) console.error(JSON.stringify(error.response, null, 2));
  console.error(`Created IDs so far are in ${STATE_FILE}; re-running with --apply resumes.`);
  process.exit(1);
}
