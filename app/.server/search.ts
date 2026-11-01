// Search index cached per Prismic release (rebuilt when content changes).
import { buildSearchIndex, type SearchIndex } from "~/lib/search";

import { getContent, type Content } from "./prismic";

let cached: { ref: string; index: SearchIndex } | null = null;

export async function getSearch(): Promise<{ content: Content; index: SearchIndex }> {
  const content = await getContent();
  if (cached?.ref !== content.ref) {
    cached = { ref: content.ref, index: buildSearchIndex(content.catalog, content.settings.synonymGroups) };
  }
  return { content, index: cached.index };
}
