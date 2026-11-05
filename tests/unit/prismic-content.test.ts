import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { faqData, linkResolver, pageData, sectionsData, stripComments } from "../../scripts/prismic/content.mjs";

const model = (type: string) => JSON.parse(readFileSync(`customtypes/${type}/index.json`, "utf8")) as unknown;
const PAGE = model("page");
const FAQ = model("faq");
const SETTINGS = model("settings");

const PAGE_UIDS = ["about", "privacy", "terms", "cookies", "shipping", "returns", "warranty"];
const ids = new Map([...PAGE_UIDS, "faq"].map((uid) => [uid, `id-${uid}`]));
const resolve = linkResolver(ids);

describe("linkResolver", () => {
  it("maps doc:, /path and https:// targets to Prismic link data", () => {
    expect(resolve("doc:privacy")).toEqual({ link_type: "Document", id: "id-privacy" });
    expect(resolve("/contact")).toEqual({ link_type: "Web", url: "/contact" });
    expect(resolve("https://www.gov.br/anpd")).toEqual({ link_type: "Web", url: "https://www.gov.br/anpd", target: "_blank" });
  });

  it("refuses unknown documents, protocol-relative, http and javascript targets", () => {
    expect(() => resolve("doc:nope")).toThrow(/unknown document "nope"/);
    expect(() => resolve("//evil.example")).toThrow(/Unsupported/);
    expect(() => resolve("http://example.com")).toThrow(/Unsupported/);
    expect(() => resolve("javascript:alert(1)")).toThrow(/Unsupported/);
  });
});

describe("pageData", () => {
  it("fills the page fields from the front matter and the body", () => {
    const data = pageData("---\ntitle: Teste\nlast_updated: 2026-11-04\n---\n## A\n\nVeja [termos](doc:terms).\n", PAGE, resolve);
    expect(data.title).toBe("Teste");
    expect(data.last_updated).toBe("2026-11-04");
    expect(data.body).toEqual([
      { type: "heading2", text: "A", spans: [] },
      { type: "paragraph", text: "Veja termos.", spans: [{ start: 5, end: 11, type: "hyperlink", data: { link_type: "Document", id: "id-terms" } }] },
    ]);
  });

  it("refuses unknown fields, bad dates, long SEO texts and empty pages", () => {
    expect(() => pageData("---\ntitle: T\nautor: X\n---\nTexto", PAGE, resolve)).toThrow(/"autor" is not a field/);
    expect(() => pageData("---\ntitle: T\nlast_updated: 04/11/2026\n---\nTexto", PAGE, resolve)).toThrow(/YYYY-MM-DD/);
    expect(() => pageData(`---\ntitle: T\nmeta_description: ${"x".repeat(161)}\n---\nTexto`, PAGE, resolve)).toThrow(/under 160/);
    expect(() => pageData("---\ntitle: T\n---\n<!-- só nota -->\n", PAGE, resolve)).toThrow(/no content/);
  });
});

describe("faqData", () => {
  it("reads topic | question headings and their answers, ignoring comments", () => {
    const data = faqData("---\ntitle: FAQ\n---\n<!-- nota -->\n## Payment | Aceitam Pix?\n\nSim, **só Pix**.\n", FAQ, resolve);
    expect(data.items).toEqual([
      { topic: "Payment", question: "Aceitam Pix?", answer: [{ type: "paragraph", text: "Sim, só Pix.", spans: [{ start: 5, end: 11, type: "strong" }] }] },
    ]);
  });

  it("refuses unknown topics, headings in answers, missing answers and repeated questions", () => {
    expect(() => faqData("## Frete | Quanto custa?\n\nVaria.", FAQ, resolve)).toThrow(/Unknown FAQ topic "Frete"/);
    expect(() => faqData("## Orders | P?\n\n### Sub\n", FAQ, resolve)).toThrow(/"heading3" is not allowed/);
    expect(() => faqData("## Orders | P?\n", FAQ, resolve)).toThrow(/No answer/);
    expect(() => faqData("## Orders | P?\n\nA\n\n## Payment | P?\n\nB", FAQ, resolve)).toThrow(/asked twice/);
  });
});

describe("sectionsData", () => {
  it("fills rich text fields from ## sections and text fields from the front matter", () => {
    const data = sectionsData("---\nstore_name: Loja\n---\n## warranty_summary\n\nGarantia legal.\n", SETTINGS, resolve);
    expect(data).toEqual({ store_name: "Loja", warranty_summary: [{ type: "paragraph", text: "Garantia legal.", spans: [] }] });
  });

  it("refuses sections that aren't rich text fields", () => {
    expect(() => sectionsData("## store_name\n\nLoja", SETTINGS, resolve)).toThrow(/not a rich text field/);
  });
});

describe("the content in content/prismic/", () => {
  it("every page, the FAQ and the settings parse against the models, with links only to known documents", () => {
    const files = readdirSync("content/prismic/pages").filter((f) => f.endsWith(".md"));
    expect(files.map((f) => f.replace(/\.md$/, "")).sort()).toEqual([...PAGE_UIDS].sort());
    for (const file of files) {
      const data = pageData(readFileSync(`content/prismic/pages/${file}`, "utf8"), PAGE, resolve);
      expect(data.title, file).toBeTruthy();
      expect(data.last_updated, file).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const faq = faqData(readFileSync("content/prismic/faq.md", "utf8"), FAQ, resolve);
    expect(faq.items.length).toBeGreaterThan(10);
    const settings = sectionsData(readFileSync("content/prismic/settings.md", "utf8"), SETTINGS, resolve);
    expect(Object.keys(settings).sort()).toEqual(["default_meta_description", "return_policy_summary", "shipping_summary", "store_name", "warranty_summary"]);
  });

  it("strips every editor note", () => {
    expect(stripComments("a<!-- x\ny -->b")).toBe("ab");
  });
});
