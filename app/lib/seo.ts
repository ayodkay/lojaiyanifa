// Meta tag builders: title, description, canonical, Open Graph, Twitter, robots.
import type { MetaDescriptor } from "react-router";

import type { CatalogImage } from "~/lib/catalog/types";
import { imgixSrc } from "~/lib/images";

export interface SeoInput {
  siteUrl: string;
  storeName: string;
  /** Path + optional query that defines the canonical URL, e.g. "/products/opele". */
  path: string;
  title: string;
  description?: string | null;
  image?: CatalogImage | null;
  type?: "website" | "product" | "article";
  noindex?: boolean;
  jsonLd?: object[];
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function seoMeta(input: SeoInput): MetaDescriptor[] {
  const url = `${input.siteUrl}${input.path}`;
  const fullTitle = input.title === input.storeName ? input.title : `${input.title} | ${input.storeName}`;
  const description = input.description ? truncate(input.description, 160) : null;
  const tags: MetaDescriptor[] = [
    { title: fullTitle },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:site_name", content: input.storeName },
    { property: "og:locale", content: "pt_BR" },
    { property: "og:type", content: input.type ?? "website" },
    { property: "og:title", content: input.title },
    { property: "og:url", content: url },
    { name: "twitter:card", content: input.image ? "summary_large_image" : "summary" },
  ];
  if (description) {
    tags.push({ name: "description", content: description }, { property: "og:description", content: description });
  }
  if (input.image) {
    tags.push(
      { property: "og:image", content: imgixSrc(input.image.url, { w: 1200, h: 630, fit: "crop" }) },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: input.image.alt },
    );
  }
  if (input.noindex) tags.push({ name: "robots", content: "noindex, nofollow" });
  for (const data of input.jsonLd ?? []) tags.push({ "script:ld+json": data } as MetaDescriptor);
  return tags;
}

export function breadcrumbJsonLd(siteUrl: string, items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${siteUrl}${item.path}`,
    })),
  };
}
