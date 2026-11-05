// A small Markdown subset → Prismic rich text, for content kept in the repo (content/prismic/) and sent to Prismic
// with scripts/prismic/seed-content.mjs. Anything it can't represent exactly throws: legal text must never be
// mangled silently.
//
// Blocks (one per line, a blank line ends a paragraph):
//   ## / ### / ####   heading2 / heading3 / heading4
//   - text            list-item          (one line per item)
//   1. text           o-list-item        (one line per item)
//   other lines       paragraph          (consecutive lines are joined with a space)
// Inline: **strong**, *em*, [label](href), and \x for a literal x. The label of a link is plain text.
// Links are turned into Prismic link data by the caller's resolveLink(href).

/** "---\nkey: value\n---\nbody" → { meta, body }. No front matter → empty meta. */
export function parseFrontMatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`Front matter line is not "key: value": ${line}`);
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

/** One line of inline Markdown → { text, spans } (Prismic offsets are positions in `text`). */
export function parseInline(source, resolveLink) {
  let text = "";
  const spans = [];
  const open = { strong: null, em: null };
  const toggle = (type) => {
    if (open[type] === null) {
      open[type] = text.length;
      return;
    }
    if (open[type] === text.length) throw new Error(`Empty ${type} in: ${source}`);
    spans.push({ start: open[type], end: text.length, type });
    open[type] = null;
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\" && i + 1 < source.length) {
      text += source[i + 1];
      i += 2;
    } else if (source.startsWith("**", i)) {
      toggle("strong");
      i += 2;
    } else if (ch === "*") {
      toggle("em");
      i += 1;
    } else if (ch === "[") {
      const middle = source.indexOf("](", i);
      const close = middle === -1 ? -1 : source.indexOf(")", middle + 2);
      if (middle === -1 || close === -1) throw new Error(`Unclosed link in: ${source}`);
      const label = source.slice(i + 1, middle);
      const href = source.slice(middle + 2, close);
      if (!label || /[*[\]\\]/.test(label)) throw new Error(`A link label must be plain, non-empty text: [${label}] in: ${source}`);
      if (!href || /\s/.test(href)) throw new Error(`A link needs a target without spaces: (${href}) in: ${source}`);
      const start = text.length;
      text += label;
      spans.push({ start, end: text.length, type: "hyperlink", data: resolveLink(href) });
      i = close + 1;
    } else {
      text += ch;
      i += 1;
    }
  }
  if (open.strong !== null || open.em !== null) throw new Error(`Unclosed ** or * in: ${source}`);
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  return { text, spans };
}

const BLOCK_PATTERNS = [
  [/^#### (.+)$/, "heading4"],
  [/^### (.+)$/, "heading3"],
  [/^## (.+)$/, "heading2"],
  [/^- (.+)$/, "list-item"],
  [/^\d+\. (.+)$/, "o-list-item"],
];
const LIST_TYPES = new Set(["list-item", "o-list-item"]);

/**
 * What a rich text field accepts, from its custom type definition ("multi" or "single": comma-separated node and
 * span types). `single` fields hold exactly one block.
 */
export function richTextRules(fieldDefinition) {
  const config = fieldDefinition?.config ?? {};
  if (fieldDefinition?.type !== "StructuredText") throw new Error(`Not a rich text field: ${JSON.stringify(fieldDefinition)}`);
  const list = config.multi ?? config.single;
  if (!list) throw new Error(`Rich text field without "multi"/"single": ${JSON.stringify(config)}`);
  return { allowed: new Set(list.split(",").map((s) => s.trim())), single: !config.multi };
}

/** Markdown body → Prismic rich text nodes, checked against the field's rules (see richTextRules). */
export function markdownToRichText(body, { resolveLink, rules }) {
  const nodes = [];
  let paragraph = [];
  let previous = null; // type of the last block line, to refuse lazy list continuations
  const flush = () => {
    if (paragraph.length === 0) return;
    nodes.push({ type: "paragraph", ...parseInline(paragraph.join(" "), resolveLink) });
    paragraph = [];
  };

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      previous = null;
      continue;
    }
    const block = BLOCK_PATTERNS.find(([pattern]) => pattern.test(line));
    if (block) {
      flush();
      const [pattern, type] = block;
      nodes.push({ type, ...parseInline(pattern.exec(line)[1], resolveLink) });
      previous = type;
      continue;
    }
    if (/^#/.test(line)) throw new Error(`Unsupported heading (use ##, ### or ####): ${line}`);
    if (previous && LIST_TYPES.has(previous)) {
      throw new Error(`A line right after a list item must be a list item or follow a blank line: ${line}`);
    }
    paragraph.push(line);
    previous = "paragraph";
  }
  flush();

  if (rules) {
    if (rules.single && nodes.length > 1) throw new Error(`This field holds a single block, got ${nodes.length}`);
    for (const node of nodes) {
      if (!rules.allowed.has(node.type)) throw new Error(`"${node.type}" is not allowed in this field: ${node.text}`);
      for (const span of node.spans) {
        if (!rules.allowed.has(span.type)) throw new Error(`"${span.type}" is not allowed in this field: ${node.text}`);
      }
    }
  }
  return nodes;
}
