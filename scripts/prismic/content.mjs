// Turns the store's texts kept in content/prismic/ into Prismic document data, checked against the custom type
// models in customtypes/. Pure functions (no I/O), used by scripts/prismic/seed-content.mjs and unit-tested.
import { markdownToRichText, parseFrontMatter, richTextRules } from "./markdown.mjs";

/** HTML comments are notes for editors of the Markdown files, never content. */
export const stripComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

/** Limits the models' placeholders give for SEO fields (characters). */
const SEO_LIMITS = { meta_title: 60, meta_description: 160 };

/** Every field of a custom type, whatever its tab: id → definition. */
export function modelFields(model) {
  const fields = new Map();
  for (const tab of Object.values(model.json ?? {})) for (const [id, def] of Object.entries(tab)) fields.set(id, def);
  return fields;
}

/**
 * A link target in the Markdown → Prismic link data.
 * - doc:<uid>  a page (or doc:faq, the FAQ) — must be one of `documentIds` (uid → Prismic ID)
 * - /path      a page of the store that isn't a Prismic document (e.g. /contact)
 * - https://…  another site, opened in a new tab
 */
export function linkResolver(documentIds) {
  return (href) => {
    if (href.startsWith("doc:")) {
      const uid = href.slice(4);
      const id = documentIds.get(uid);
      if (!id) throw new Error(`Link to unknown document "${uid}" (known: ${[...documentIds.keys()].join(", ")})`);
      return { link_type: "Document", id };
    }
    if (/^\/(?!\/)/.test(href)) return { link_type: "Web", url: href };
    if (/^https:\/\/[^\s/]+\.[^\s]+$/.test(href)) return { link_type: "Web", url: href, target: "_blank" };
    throw new Error(`Unsupported link target "${href}": use doc:<uid>, /path or https://…`);
  };
}

/** A front matter value → the field's data, by the field's type in the model. */
function fieldValue(id, raw, def, resolveLink) {
  if (!def) throw new Error(`"${id}" is not a field of this document type`);
  switch (def.type) {
    case "Text": {
      if (!raw) throw new Error(`"${id}" is empty`);
      const limit = SEO_LIMITS[id];
      if (limit && raw.length > limit) throw new Error(`"${id}" has ${raw.length} characters; keep it under ${limit}`);
      return raw;
    }
    case "Date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw new Error(`"${id}" must be a date YYYY-MM-DD, got "${raw}"`);
      return raw;
    case "StructuredText":
      return markdownToRichText(raw, { resolveLink, rules: richTextRules(def) });
    default:
      throw new Error(`"${id}" is a ${def.type} field, which the content files can't fill`);
  }
}

function frontMatterData(meta, fields, resolveLink) {
  const data = {};
  for (const [id, raw] of Object.entries(meta)) data[id] = fieldValue(id, raw, fields.get(id), resolveLink);
  return data;
}

/** A content page (customtypes/page): front matter fields + the Markdown body as `body`. */
export function pageData(source, model, resolveLink) {
  const { meta, body } = parseFrontMatter(stripComments(source));
  const fields = modelFields(model);
  if (!meta.title) throw new Error("A page needs a title");
  const content = markdownToRichText(body, { resolveLink, rules: richTextRules(fields.get("body")) });
  if (content.length === 0) throw new Error(`Page "${meta.title}" has no content`);
  return { ...frontMatterData(meta, fields, resolveLink), body: content };
}

/** "## <topic> | <question>" headings, each followed by its answer. */
export function faqData(source, model, resolveLink) {
  const { meta, body } = parseFrontMatter(stripComments(source));
  const fields = modelFields(model);
  const itemFields = fields.get("items")?.config?.fields;
  if (!itemFields) throw new Error("The FAQ model has no items group");
  const topics = itemFields.topic.config.options;
  const answerRules = richTextRules(itemFields.answer);

  const items = [];
  const chunks = body.split(/^## /m);
  if (chunks[0].trim()) throw new Error(`Text before the first question: ${chunks[0].trim().slice(0, 60)}`);
  for (const chunk of chunks.slice(1)) {
    const newline = chunk.indexOf("\n");
    const heading = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const answer = newline === -1 ? "" : chunk.slice(newline + 1);
    const bar = heading.indexOf(" | ");
    if (bar === -1) throw new Error(`FAQ heading must be "<topic> | <question>": ${heading}`);
    const topic = heading.slice(0, bar).trim();
    const question = heading.slice(bar + 3).trim();
    if (!topics.includes(topic)) throw new Error(`Unknown FAQ topic "${topic}" (the model has: ${topics.join(", ")})`);
    if (!question) throw new Error(`Empty question under topic ${topic}`);
    const nodes = markdownToRichText(answer, { resolveLink, rules: answerRules });
    if (nodes.length === 0) throw new Error(`No answer for: ${question}`);
    items.push({ topic, question, answer: nodes });
  }
  if (items.length === 0) throw new Error("The FAQ has no questions");
  const questions = items.map((i) => i.question);
  const repeated = questions.find((q, i) => questions.indexOf(q) !== i);
  if (repeated) throw new Error(`Question asked twice: ${repeated}`);
  return { ...frontMatterData(meta, fields, resolveLink), items };
}

/** Front matter fields + "## <field id>" sections, each a rich text field of the model. */
export function sectionsData(source, model, resolveLink) {
  const { meta, body } = parseFrontMatter(stripComments(source));
  const fields = modelFields(model);
  const data = frontMatterData(meta, fields, resolveLink);
  const chunks = body.split(/^## /m);
  if (chunks[0].trim()) throw new Error(`Text before the first section: ${chunks[0].trim().slice(0, 60)}`);
  for (const chunk of chunks.slice(1)) {
    const newline = chunk.indexOf("\n");
    const id = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    if (id in data) throw new Error(`"${id}" is set twice`);
    const def = fields.get(id);
    if (def?.type !== "StructuredText") throw new Error(`"${id}" is not a rich text field of this document type`);
    const nodes = markdownToRichText(newline === -1 ? "" : chunk.slice(newline + 1), { resolveLink, rules: richTextRules(def) });
    if (nodes.length === 0) throw new Error(`Section "${id}" is empty`);
    data[id] = nodes;
  }
  return data;
}
