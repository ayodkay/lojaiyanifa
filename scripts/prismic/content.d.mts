// Types for scripts/prismic/content.mjs (imported by tests/unit/prismic-content.test.ts).

export function stripComments(text: string): string;

export function modelFields(model: unknown): Map<string, { type: string; config?: Record<string, unknown> }>;

export function linkResolver(documentIds: Map<string, string>): (href: string) => Record<string, string>;

export function pageData(source: string, model: unknown, resolveLink: (href: string) => unknown): Record<string, unknown>;

export function faqData(source: string, model: unknown, resolveLink: (href: string) => unknown): Record<string, unknown> & {
  items: { topic: string; question: string; answer: unknown[] }[];
};

export function sectionsData(source: string, model: unknown, resolveLink: (href: string) => unknown): Record<string, unknown>;
