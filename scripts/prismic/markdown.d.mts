// Types for scripts/prismic/markdown.mjs (imported by tests/unit/prismic-markdown.test.ts).

export interface RichTextSpan {
  start: number;
  end: number;
  type: "strong" | "em" | "hyperlink";
  data?: unknown;
}

export interface RichTextNode {
  type: "paragraph" | "heading2" | "heading3" | "heading4" | "list-item" | "o-list-item";
  text: string;
  spans: RichTextSpan[];
}

export interface RichTextRules {
  allowed: Set<string>;
  single: boolean;
}

export function parseFrontMatter(source: string): { meta: Record<string, string>; body: string };

export function parseInline(source: string, resolveLink: (href: string) => unknown): { text: string; spans: RichTextSpan[] };

export function richTextRules(fieldDefinition: unknown): RichTextRules;

export function markdownToRichText(
  body: string,
  options: { resolveLink: (href: string) => unknown; rules?: RichTextRules },
): RichTextNode[];
