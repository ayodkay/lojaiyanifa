// URL rules for Prismic documents (used by mappers and rich-text rendering).
import type { FilledContentRelationshipField, LinkField } from "@prismicio/client";
import { isFilled } from "@prismicio/client";

/** Content pages with fixed, checklist-defined paths. Other pages live under /pages/:uid. */
export const PAGE_PATHS: Readonly<Record<string, string>> = {
  about: "/about",
  privacy: "/privacy",
  terms: "/terms",
  cookies: "/cookies",
  shipping: "/shipping",
  returns: "/returns",
  warranty: "/warranty",
};

export function pagePath(uid: string): string {
  return PAGE_PATHS[uid] ?? `/pages/${uid}`;
}

type DocumentRef = Pick<FilledContentRelationshipField, "type" | "uid">;

/**
 * Path for a Prismic document. Category links always use /categories/:uid; the
 * category route redirects collections to their canonical /collections/:uid.
 */
export function linkResolver(doc: DocumentRef): string | null {
  switch (doc.type) {
    case "products":
      return doc.uid ? `/products/${doc.uid}` : null;
    case "product_category":
      return doc.uid ? `/categories/${doc.uid}` : null;
    case "page":
      return doc.uid ? pagePath(doc.uid) : null;
    case "homepage":
      return "/";
    case "faq":
      return "/faq";
    default:
      return null;
  }
}

/** Resolves any Prismic link field to an href, or null if empty/broken. */
export function hrefFromLink(field: LinkField | null | undefined): string | null {
  if (!field || !isFilled.link(field)) return null;
  if (field.link_type === "Document") {
    if ("isBroken" in field && field.isBroken) return null;
    return linkResolver(field as FilledContentRelationshipField);
  }
  return "url" in field && field.url ? field.url : null;
}
