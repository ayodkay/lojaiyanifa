import { describe, expect, it } from "vitest";

import { markdownToRichText, parseFrontMatter, parseInline, richTextRules } from "../../scripts/prismic/markdown.mjs";

const link = (href: string) => ({ href });

describe("parseInline", () => {
  it("turns **strong**, *em* and [links](…) into spans over the plain text", () => {
    const { text, spans } = parseInline("Leia a **política** e *depois* [fale conosco](/contact).", link);
    expect(text).toBe("Leia a política e depois fale conosco.");
    expect(spans).toEqual([
      { start: 7, end: 15, type: "strong" },
      { start: 18, end: 24, type: "em" },
      { start: 25, end: 37, type: "hyperlink", data: { href: "/contact" } },
    ]);
    expect(text.slice(25, 37)).toBe("fale conosco");
  });

  it("keeps accented text intact and counts offsets in characters", () => {
    const { text, spans } = parseInline("Até **7 (sete) dias** após", link);
    expect(text).toBe("Até 7 (sete) dias após");
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe("7 (sete) dias");
  });

  it("treats a backslash-escaped character literally", () => {
    expect(parseInline("2 \\* 3", link)).toEqual({ text: "2 * 3", spans: [] });
  });

  it("refuses unclosed markers, empty emphasis and formatted link labels", () => {
    expect(() => parseInline("**sem fim", link)).toThrow(/Unclosed/);
    expect(() => parseInline("[sem alvo](", link)).toThrow(/Unclosed link/);
    expect(() => parseInline("****", link)).toThrow(/Empty strong/);
    expect(() => parseInline("[**negrito**](/x)", link)).toThrow(/plain, non-empty/);
    expect(() => parseInline("[x](/a b)", link)).toThrow(/without spaces/);
  });
});

describe("markdownToRichText", () => {
  const body = ["## Título", "", "Primeira linha", "continua aqui.", "", "- item um", "- item **dois**", "", "1. passo", "### Sub"].join("\n");

  it("builds headings, joined paragraphs and both list types", () => {
    const nodes = markdownToRichText(body, { resolveLink: link });
    expect(nodes.map((n) => [n.type, n.text])).toEqual([
      ["heading2", "Título"],
      ["paragraph", "Primeira linha continua aqui."],
      ["list-item", "item um"],
      ["list-item", "item dois"],
      ["o-list-item", "passo"],
      ["heading3", "Sub"],
    ]);
    expect(nodes[3]!.spans).toEqual([{ start: 5, end: 9, type: "strong" }]);
  });

  it("refuses a level-1 heading and a lazy list continuation", () => {
    expect(() => markdownToRichText("# Grande", { resolveLink: link })).toThrow(/Unsupported heading/);
    expect(() => markdownToRichText("- item\ncontinuação", { resolveLink: link })).toThrow(/right after a list item/);
  });

  it("checks node and span types against the field's custom type rules", () => {
    const answer = richTextRules({ type: "StructuredText", config: { multi: "paragraph,strong,em,hyperlink,list-item,o-list-item" } });
    expect(markdownToRichText("Texto com [link](/x).\n\n- a", { resolveLink: link, rules: answer })).toHaveLength(2);
    expect(() => markdownToRichText("## Título", { resolveLink: link, rules: answer })).toThrow(/"heading2" is not allowed/);

    const plain = richTextRules({ type: "StructuredText", config: { multi: "paragraph" } });
    expect(() => markdownToRichText("**forte**", { resolveLink: link, rules: plain })).toThrow(/"strong" is not allowed/);

    const single = richTextRules({ type: "StructuredText", config: { single: "paragraph,hyperlink" } });
    expect(single.single).toBe(true);
    expect(() => markdownToRichText("um\n\ndois", { resolveLink: link, rules: single })).toThrow(/single block/);
  });

  it("refuses a field that isn't rich text", () => {
    expect(() => richTextRules({ type: "Text", config: {} })).toThrow(/Not a rich text field/);
  });
});

describe("parseFrontMatter", () => {
  it("splits key: value lines (values may contain colons) from the body", () => {
    const { meta, body: rest } = parseFrontMatter("---\ntitle: Termos: uso\nlast_updated: 2026-11-04\n---\nCorpo\n");
    expect(meta).toEqual({ title: "Termos: uso", last_updated: "2026-11-04" });
    expect(rest).toBe("Corpo\n");
  });

  it("returns the whole text as body when there is no front matter", () => {
    expect(parseFrontMatter("Só corpo")).toEqual({ meta: {}, body: "Só corpo" });
  });

  it("refuses a front matter line without a key", () => {
    expect(() => parseFrontMatter("---\nsem chave\n---\n")).toThrow(/key: value/);
  });
});
